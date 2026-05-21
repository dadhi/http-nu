// Input handlers for 2048. Server embeds the player id and the /move URL
// as body data-* attributes so this file stays parameter-free and cacheable.
const playerId = document.body.dataset.playerId;
const gameId = document.body.dataset.gameId;
const moveUrl = document.body.dataset.moveUrl;
const homeHref = document.body.dataset.homeHref;
const newHref = document.body.dataset.newHref;


// End-to-end RTT slots. movePending ticks visibly via tickRtt while a
// user-initiated move is in flight (h/j/k/l/u). pingPending tracks the
// most recent heartbeat probe and never ticks -- its purpose is
// liveness + RTT snapshot on resolution.
let movePending = null;
let pingPending = null;

const flashRed = () => {
  document.body.classList.remove("flash-red");
  void document.body.offsetWidth;  // force reflow so animation restarts
  document.body.classList.add("flash-red");
};

const rttEl = () => document.querySelector("#rtt");
const tickRtt = () => {
  if (movePending == null) return;
  rttEl()?.replaceChildren(`${Math.round(performance.now() - movePending.t)}ms`);
  requestAnimationFrame(tickRtt);
};

// Heartbeat: periodic ping every PING_INTERVAL_MS while SSE is up,
// replacing the server-side --pulse 450 that used to drive liveness.
// Each ping arms a PING_TIMEOUT_MS deadline; expiry flips conn=down.
// Any ack (ping or move) or any other SSE patch clears the deadline.
const PING_INTERVAL_MS = 450;
const PING_TIMEOUT_MS = 1000;
let pingTimer = null;
let pingInterval = null;
const clearPingTimer = () => {
  if (pingTimer != null) { clearTimeout(pingTimer); pingTimer = null; }
};
const stopPinging = () => {
  if (pingInterval != null) { clearInterval(pingInterval); pingInterval = null; }
  clearPingTimer();
  pingPending = null;
};

const move = (intent) => {
  // Each move carries a uuid the server echoes back via the
  // $lastReqId signal. window.onAck filters on that uuid so replay
  // patches and other tabs' acks don't get misattributed.
  const reqId = crypto.randomUUID();
  const stamp = performance.now();
  if (intent === "") {
    // Heartbeat ping. Replaces any prior unacked ping (older one becomes
    // orphaned; if its ack later arrives, no slot matches).
    pingPending = { id: reqId, t: stamp };
    clearPingTimer();
    pingTimer = setTimeout(() => setConn("down"), PING_TIMEOUT_MS);
  } else {
    movePending = { id: reqId, t: stamp };
    if ("hjkl".includes(intent)) {
      document.querySelector("#board-wrap")?.setAttribute("data-pending", intent);
    }
    requestAnimationFrame(tickRtt);
  }
  return fetch(moveUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ playerId, gameId, intent, reqId }),
  }).then((r) => {
    if (!r.ok) {
      if (intent === "") pingPending = null;
      else { movePending = null; document.querySelector("#board-wrap")?.removeAttribute("data-pending"); }
      flashRed();
    }
  }).catch(() => {
    if (intent === "") pingPending = null;
    else { movePending = null; document.querySelector("#board-wrap")?.removeAttribute("data-pending"); }
    flashRed();
  });
};

// SSE liveness. dmax exposes stream lifecycle through signals that we
// reflect onto body data-* attrs from the server-rendered markup.
const setConn = (v) => {
  if (document.body.dataset.conn === v) return;
  document.body.dataset.conn = v;
  if (v === "down") {
    movePending = null;
    rttEl()?.replaceChildren("");
  }
};
let lastSseOpen = false;
const syncSseState = () => {
  const isOpen = document.body.dataset.sseOpen === "1";
  const hasError = (document.body.dataset.sseError || "") !== "";
  if (isOpen) {
    setConn("ok");
    clearPingTimer();
    if (moveUrl && !lastSseOpen) {
      stopPinging();
      move("");
      pingInterval = setInterval(() => move(""), PING_INTERVAL_MS);
    }
  } else if (hasError || document.body.dataset.sseClose === "1") {
    setConn("down");
    stopPinging();
  }
  lastSseOpen = isOpen;
};
new MutationObserver(syncSseState).observe(document.body, {
  attributes: true,
  attributeFilter: ["data-sse-open", "data-sse-close", "data-sse-error"],
});
syncSseState();

// Global navigation: Esc -> splash, n -> new game. Registered always so
// every page (play, watch, my games, splash, notes, design) responds.
addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    location.href = homeHref;
    e.preventDefault();
    return;
  }
  if (e.key === "n" && !e.ctrlKey && !e.metaKey && !e.altKey) {
    location.href = newHref;
    e.preventDefault();
  }
});

// Below: /play-only handlers gated on moveUrl (the server-rendered
// page omits the `data-move-url` body attr on non-/play pages).
if (moveUrl) {
// Called by data-on-signal-patch="window.onAck($lastReqId)" on the
// hidden element in the /play body. The SSE pipeline ships a
// $lastReqId signal patch the instant it sees the move frame -- so
// every move (state-changing or no-op) round-trips through here.
// No-op unless reqId matches the pending probe we issued (replay /
// spectator streams carry reqIds we never issued; ignore them).
window.onAck = (reqId) => {
  // User move resolution: writes the visible RTT readout.
  if (movePending && reqId === movePending.id) {
    const rtt = Math.round(performance.now() - movePending.t);
    movePending = null;
    document.querySelector("#board-wrap")?.removeAttribute("data-pending");
    rttEl()?.replaceChildren(`${rtt}ms`);
    return;
  }
  // Heartbeat resolution: clears the ping deadline. Only SEEDS the
  // visible readout (when it's empty -- fresh page load or post-
  // disconnect). Subsequent pings keep liveness up but never touch
  // the display; otherwise the readout would flicker with a new
  // value every PING_INTERVAL_MS. Move acks own the readout after
  // the seed.
  if (pingPending && reqId === pingPending.id) {
    const rtt = Math.round(performance.now() - pingPending.t);
    pingPending = null;
    clearPingTimer();
    setConn("ok");
    const el = rttEl();
    if (el && el.textContent === "" && movePending == null) {
      el.replaceChildren(`${rtt}ms`);
    }
  }
};

// Keyboard: hjkl + arrows + u-to-undo. (New game lives on the splash;
// reset key is intentionally gone.)
const keymap = {
  h: "h", ArrowLeft: "h",
  j: "j", ArrowDown: "j",
  k: "k", ArrowUp: "k",
  l: "l", ArrowRight: "l",
};

// Move impulses (h/j/k/l/u). Registered ONLY on the owner's /play page;
// spectator /watch and chrome pages don't bind this handler at all, so
// keystrokes never reach a move() call from outside the editor.
if (document.body.classList.contains("play")) {
  addEventListener("keydown", (e) => {
    if (document.body.dataset.conn === "down") return;
    // Shift+letter sends uppercase ("H"); fall back to lowercased key.
    const dir = keymap[e.key] || keymap[(e.key + "").toLowerCase()];
    const intent = dir || (e.key === "u" ? "undo" : "");
    if (intent) {
      move(intent);
      e.preventDefault();
    }
  });
}

// Delegated click handler for kbd-btn move triggers. Game-move kbd-btns
// render as <button data-intent="h"|"undo"|...>; nav kbd-btns render as
// <a href> (native navigation, right-click-open-tab works).
document.addEventListener("click", (e) => {
  const intent = e.target.closest("button[data-intent]");
  if (intent) move(intent.dataset.intent);
});



// Pointer swipe: detect a directional gesture on the board and dispatch
// a move on release. No tilt / glow during drag; the edge-line pending
// indicator is wired through move() -> #board-wrap[data-pending].
const SWIPE_THRESHOLD = 30;
let swipeStart = null;
addEventListener("pointerdown", (e) => {
  swipeStart = e.target.closest(".board") ? [e.clientX, e.clientY] : null;
});
addEventListener("pointerup", (e) => {
  if (!swipeStart) return;
  const dx = e.clientX - swipeStart[0];
  const dy = e.clientY - swipeStart[1];
  swipeStart = null;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_THRESHOLD) return;
  const dir = Math.abs(dx) > Math.abs(dy)
    ? (dx > 0 ? "l" : "h")
    : (dy > 0 ? "j" : "k");
  move(dir);
});

}

// Keep splash card "last played" labels current without a server round
// trip. Each .overlay.active span carries data-played-ms = the unix
// millisecond timestamp from the game's last-move id; we recompute the
// relative string every few seconds. Same shape as the server's
// last-active-from-id in render.nu.
function relativeFromMs(ms) {
  const diff = Math.floor((Date.now() - ms) / 1000);
  if (diff < 60) return "in play";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return `${Math.floor(diff / 604800)}w ago`;
}
function updateActiveLabels() {
  document.querySelectorAll(".overlay.active[data-played-ms]").forEach((el) => {
    const ms = parseInt(el.dataset.playedMs, 10);
    if (!Number.isFinite(ms)) return;
    const next = relativeFromMs(ms);
    if (el.textContent !== next) el.textContent = next;
  });
}
// Tick every 5s: fast enough to catch "in play" -> "1m ago" near the
// minute boundary, slow enough to be cheap.
setInterval(updateActiveLabels, 5000);
updateActiveLabels();

const splashSlider = document.querySelector("#splash-slider");
const splashCounter = document.querySelector("#splash-counter");
if (splashSlider && splashCounter) {
  const seekUrl = splashSlider.dataset.seekUrl;
  const tabId = splashSlider.dataset.tabId;
  const maxPos = Number.parseInt(splashSlider.dataset.maxPos || "0", 10);
  let pos = Number.parseInt(splashSlider.dataset.startPos || "0", 10);
  const paint = () => {
    splashSlider.setAttribute("value", String(pos));
    splashCounter.textContent = `move: ${pos} of ${maxPos}`;
  };
  const postSeek = () => fetch(seekUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pos, tabId }),
  }).catch(() => {});
  splashSlider.addEventListener("scrub", (e) => {
    pos = e.detail.value;
    paint();
  });
  splashSlider.addEventListener("scrub-end", () => postSeek());
  setInterval(() => {
    pos = maxPos > 0 ? (pos + 1) % (maxPos + 1) : 0;
    paint();
    postSeek();
  }, 1200);
  paint();
}

// Splash audio toggle: [ p ] kbd-btn next to the splash credit. Click
// the button or press the "p" key to toggle play/pause. aria-pressed
// reflects state so CSS can style the kbd-btn while playing.
const audioToggle = document.querySelector(".audio-toggle");
const splashAudio = document.querySelector("#splash-audio");
if (audioToggle && splashAudio) {
  let seeded = false;
  const toggleAudio = (e) => {
    if (e) e.preventDefault();
    if (splashAudio.paused) {
      // Seed first play 48s in -- past the long ambient intro on the
      // mobygratis track. Subsequent toggles keep their position.
      if (!seeded) {
        splashAudio.currentTime = 48;
        seeded = true;
      }
      splashAudio.play();
    } else {
      splashAudio.pause();
    }
  };
  audioToggle.addEventListener("click", toggleAudio);
  const sync = () => {
    const playing = !splashAudio.paused;
    audioToggle.setAttribute("aria-pressed", playing ? "true" : "false");
    audioToggle.setAttribute("aria-label", playing ? "pause audio" : "play audio");
  };
  sync();
  splashAudio.addEventListener("play", sync);
  splashAudio.addEventListener("pause", sync);
  splashAudio.addEventListener("ended", sync);
  document.addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.key === "p" || e.key === "P") {
      e.preventDefault();
      toggleAudio();
    }
  });
  // Each splash-slider drag-release jumps the audio to a random spot
  // when playing -- ties the soundtrack mood to the user-driven scrub.
  // The <scrub-knob> WC emits `scrub-end` on pointer release (matches
  // the role the native `change` event used to play here).
  document.querySelector("#splash-slider")?.addEventListener("scrub-end", () => {
    if (splashAudio.paused) return;
    if (Number.isFinite(splashAudio.duration) && splashAudio.duration > 0) {
      splashAudio.currentTime = Math.random() * splashAudio.duration;
    }
  });
}
