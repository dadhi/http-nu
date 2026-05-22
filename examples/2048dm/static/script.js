// Input handlers for 2048. Server embeds only the nav hrefs as body
// data-* attrs so this file stays parameter-free and cacheable.
const homeHref = document.body.dataset.homeHref;
const newHref = document.body.dataset.newHref;


// End-to-end RTT slots. movePending ticks visibly via tickRtt while a
// user-initiated move is in flight (h/j/k/l/u). pingPending tracks the
// most recent heartbeat probe and never ticks -- its purpose is
// liveness + RTT snapshot on resolution.
let movePending = null;
let pingPending = null;

const isPlay = document.body.classList.contains("play");
const flashRed = () => {
  document.body.classList.remove("flash-red");
  void document.body.offsetWidth;
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

const move = (intent) => dmSet('move-cmd', { playerId: dm.playerId, gameId: dm.gameId, intent, reqId: crypto.randomUUID() });

// SSE liveness. dmax exposes grouped stream status through ^stat.sse.
const setConn = (v) => {
  if (document.body.dataset.conn === v) return;
  document.body.dataset.conn = v;
  if (v === "down") movePending = null, rttEl()?.replaceChildren("");
};
let lastSseOpen = false;
const syncConn = (s = {}) => {
  if (s.open) {
    setConn("ok"), clearPingTimer();
    if (isPlay && !lastSseOpen) stopPinging(), move(""), pingInterval = setInterval(() => move(""), PING_INTERVAL_MS);
  } else if (s.err || s.close) setConn("down"), stopPinging();
  lastSseOpen = !!s.open;
};
dmSub('sse', syncConn);

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

// Below: /play-only handlers gated on the play view.
if (isPlay) {
const boardWrap = document.querySelector("#board-wrap"), clrMove = () => { movePending = null; boardWrap?.removeAttribute("data-pending"); };
dmSub('move-cmd^notimmediate', (cmd) => {
  if (!cmd?.reqId) return;
  const p = { id: cmd.reqId, t: performance.now() };
  if (cmd.intent === "") return pingPending = p, clearPingTimer(), void (pingTimer = setTimeout(() => setConn("down"), PING_TIMEOUT_MS));
  movePending = p;
  if ("hjkl".includes(cmd.intent)) boardWrap?.setAttribute("data-pending", cmd.intent);
  requestAnimationFrame(tickRtt);
});
const ack = (slot, seed) => {
  if (!slot) return 0;
  const rtt = `${Math.round(performance.now() - slot.t)}ms`;
  if (slot === movePending) clrMove(), rttEl()?.replaceChildren(rtt);
  else pingPending = null, clearPingTimer(), setConn("ok"), seed && !movePending && !rttEl()?.textContent && rttEl()?.replaceChildren(rtt);
  return 1;
};
dmSub('last-req-id^notimmediate', (reqId) => {
  if (movePending && reqId === movePending.id) return ack(movePending);
  if (pingPending && reqId === pingPending.id) ack(pingPending, 1);
});
dmSub('move-req^notimmediate', (s) => {
  if (!s?.complete || (!s.err && (!s.code || s.code < 400))) return;
  pingPending = null;
  if (movePending) clrMove();
  flashRed();
});

// Keyboard: hjkl + arrows + u-to-undo. (New game lives on the splash;
// reset key is intentionally gone.)
const keymap = {
  h: "h", ArrowLeft: "h",
  j: "j", ArrowDown: "j",
  k: "k", ArrowUp: "k",
  l: "l", ArrowRight: "l",
};

// Move impulses (h/j/k/l/u). Registered only on /play.
addEventListener("keydown", (e) => {
  if (!isPlay || document.body.dataset.conn === "down") return;
  const dir = keymap[e.key] || keymap[(e.key + "").toLowerCase()];
  const intent = dir || (e.key === "u" ? "undo" : "");
  if (!intent) return;
  move(intent);
  e.preventDefault();
});

// Pointer swipe: detect a directional gesture on the board and dispatch
// a move on release.
const SWIPE_THRESHOLD = 30;
let swipeStart = null;
addEventListener("pointerdown", (e) => {
  if (!isPlay) return;
  swipeStart = e.target.closest(".board") ? [e.clientX, e.clientY] : null;
});
addEventListener("pointerup", (e) => {
  if (!swipeStart) return;
  const dx = e.clientX - swipeStart[0], dy = e.clientY - swipeStart[1];
  swipeStart = null;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_THRESHOLD) return;
  move(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "l" : "h") : (dy > 0 ? "j" : "k"));
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

// Splash audio toggle: [ p ] kbd-btn next to the splash credit. Click
// the button or press the "p" key to toggle play/pause. aria-pressed
// reflects state so CSS can style the kbd-btn while playing.
const audioToggle = document.querySelector(".audio-toggle");
const splashAudio = document.querySelector("#splash-audio");
if (audioToggle && splashAudio) {
  let seeded = false;
  const sync = (playing = !splashAudio.paused) => {
    audioToggle.setAttribute("aria-pressed", playing ? "true" : "false");
    audioToggle.setAttribute("aria-label", playing ? "pause audio" : "play audio");
  };
  const toggleAudio = (e) => {
    e?.preventDefault();
    if (!splashAudio.paused) return splashAudio.pause();
    if (!seeded) splashAudio.currentTime = 48, seeded = true;
    splashAudio.play();
  };
  audioToggle.addEventListener("click", toggleAudio);
  sync();
  splashAudio.addEventListener("play", sync);
  splashAudio.addEventListener("pause", sync);
  splashAudio.addEventListener("ended", sync);
  document.addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || (e.key !== "p" && e.key !== "P")) return;
    e.preventDefault();
    toggleAudio();
  });
  document.querySelector("#splash-slider")?.addEventListener("scrub-end", () => {
    if (splashAudio.paused || !Number.isFinite(splashAudio.duration) || splashAudio.duration <= 0) return;
    splashAudio.currentTime = Math.random() * splashAudio.duration;
  });
}
