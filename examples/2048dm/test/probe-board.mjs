import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const REPO = resolve("..", "..", "..");
const HTTP_NU = resolve(REPO, "target/debug/http-nu");
const SERVE_NU = resolve(REPO, "examples/2048dm/serve.nu");
const PORT = 39201;
const BASE = `http://127.0.0.1:${PORT}`;
const STORE = `/tmp/2048-probe-${process.pid}-${Date.now()}`;
const srv = spawn(HTTP_NU, ["--services", "--store", STORE, `127.0.0.1:${PORT}`, SERVE_NU], { stdio: "ignore" });
const cleanup = () => { try { srv.kill("SIGTERM"); } catch {} };
process.on("exit", cleanup);
process.on("SIGINT", () => { cleanup(); process.exit(130); });

async function waitReady() {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`${BASE}/`)).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("server not ready");
}

await waitReady();
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await page.goto(`${BASE}/new`);
await page.waitForTimeout(2000);
const out = await page.evaluate(() => {
  const host = document.querySelector("game-board");
  return {
    hasHost: !!host,
    attrs: host ? host.getAttributeNames() : [],
    stateAttr: host ? host.getAttribute("state") : null,
    statePropType: host ? typeof host.state : null,
    stateProp: host ? host.state : null,
    boardStateSignal: window.dm && window.dm.boardState,
    score: document.querySelector("#score")?.textContent ?? null,
    bodyClass: document.body.className,
    html: host ? host.outerHTML : null,
  };
});
console.log(JSON.stringify(out, null, 2));
await browser.close();
cleanup();
