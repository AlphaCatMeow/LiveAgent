import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test, { after, before } from "node:test";
import { renderComposerQueue } from "../helpers/composer-queue-render.mjs";

// 真实几何：把真实 ChatComposerBar 的渲染结果套上构建产物 CSS，在无头 Edge 里量。
// 需要 Edge 与 crates/agent-gui/dist、crates/agent-gateway/web/dist 的构建 CSS；缺任一项就跳过。
// 320 = MIN_CONVERSATION_PANE_WIDTH（分屏最窄 Pane）；桌面面层 px-5 → 卡片 280px。

const EDGE = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].find((p) => existsSync(p));

function distCss(relDir) {
  const dir = fileURLToPath(new URL(`../../../${relDir}/`, import.meta.url));
  if (!existsSync(dir)) return null;
  const file = readdirSync(dir).find((f) => /^index-.*\.css$/.test(f));
  return file ? pathToFileURL(join(dir, file)).href : null;
}
const GUI_CSS = distCss("agent-gui/dist/assets");
const WEB_CSS = distCss("agent-gateway/web/dist/assets");
const skip = !EDGE || !GUI_CSS || !WEB_CSS ? "needs Edge and built dist CSS" : false;

const MEASURE = `(() => {
  const rect = (el) => el.getBoundingClientRect();
  const card = document.querySelector(".composer-glass-card");
  const panel = document.querySelector("ul.chat-queue-scroll").closest(".border-b-0");
  const goal = document.querySelector("[data-composer-goal-bar]");
  const title = panel.querySelector("button span");
  const preview = panel.querySelector("li div span");
  return {
    cardRadius: parseFloat(getComputedStyle(card).borderTopLeftRadius),
    insetLeft: rect(panel).left - rect(card).left,
    insetRight: rect(card).right - rect(panel).right,
    panelTopRadius: parseFloat(getComputedStyle(panel).borderTopLeftRadius),
    goalFlushAbove: goal ? Math.abs(rect(goal).bottom - rect(panel).top) < 0.5 && Math.abs(rect(goal).left - rect(panel).left) < 0.5 : false,
    title: { text: title.textContent, cw: title.clientWidth, sw: title.scrollWidth },
    preview: { cw: preview.clientWidth, sw: preview.scrollWidth },
  };
})()`;

const withTimeout = (promise, ms, what) => {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timeout: ${what}`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 一次启动 Edge，量完全部场景再断言；Browser.close 让 Edge 自己退出，临时目录才能删掉。
const CASES = [
  ...["desktop", "web"].flatMap((surface) =>
    [1280, 390, 320].map((width) => ({ surface, withGoal: false, width })),
  ),
  { surface: "desktop", withGoal: true, width: 1280 },
];
const results = new Map();
const key = ({ surface, withGoal, width }) => `${surface}|${withGoal}|${width}`;
let dir;

before(async () => {
  if (skip) return;
  const markup = new Map();
  for (const c of CASES) {
    const k = `${c.surface}|${c.withGoal}`;
    if (!markup.has(k)) markup.set(k, (await renderComposerQueue(c)).html);
  }
  dir = mkdtempSync(join(tmpdir(), "composer-queue-probe-"));
  const edge = spawn(
    EDGE,
    [
      "--headless=new", "--disable-gpu", "--no-first-run", "--disable-extensions",
      "--allow-file-access-from-files", `--user-data-dir=${join(dir, "profile")}`,
      "--remote-debugging-port=0", "about:blank",
    ],
    { stdio: "ignore" },
  );
  let ws;
  try {
    const portFile = join(dir, "profile", "DevToolsActivePort");
    for (let i = 0; i < 150 && !existsSync(portFile); i += 1) await sleep(100);
    const [port, browserPath] = readFileSync(portFile, "utf8").trim().split(/\s+/);
    ws = new WebSocket(`ws://127.0.0.1:${port}${browserPath}`);
    await withTimeout(new Promise((r) => ws.addEventListener("open", r)), 10_000, "ws open");
    let id = 0;
    const pending = new Map();
    ws.addEventListener("message", (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) {
        pending.get(m.id)(m);
        pending.delete(m.id);
      }
    });
    const send = (method, params = {}, sessionId) =>
      withTimeout(
        new Promise((res) => {
          const i = ++id;
          pending.set(i, res);
          ws.send(JSON.stringify({ id: i, method, params, sessionId }));
        }),
        10_000,
        method,
      );
    const { result: target } = await send("Target.createTarget", { url: "about:blank" });
    const { result: attached } = await send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
    const sid = attached.sessionId;
    for (const c of CASES) {
      const web = c.surface === "web";
      const file = join(dir, `${key(c).replaceAll("|", "-")}.html`);
      writeFileSync(
        file,
        `<!doctype html><html ${web ? 'data-liveagent-webui="gateway"' : ""}><head><meta charset="utf-8"><link rel="stylesheet" href="${web ? WEB_CSS : GUI_CSS}"></head><body style="margin:0"><div class="${web ? "gateway-chat-frame" : ""}" style="position:relative;width:100vw;height:100vh">${markup.get(`${c.surface}|${c.withGoal}`)}</div></body></html>`,
      );
      await send("Emulation.setDeviceMetricsOverride", { width: c.width, height: 900, deviceScaleFactor: 1, mobile: false }, sid);
      const url = pathToFileURL(file).href;
      await send("Page.navigate", { url }, sid);
      for (let i = 0; i < 100; i += 1) {
        const ready = await send("Runtime.evaluate", { expression: `location.href === ${JSON.stringify(url)} && document.readyState === 'complete' && document.styleSheets.length > 0`, returnByValue: true }, sid);
        if (ready.result?.result?.value) break;
        await sleep(50);
      }
      const out = await send("Runtime.evaluate", { expression: MEASURE, returnByValue: true }, sid);
      results.set(key(c), out.result.result.value);
    }
  } finally {
    const exited = new Promise((r) => edge.once("exit", r));
    try {
      ws?.send(JSON.stringify({ id: 1e9, method: "Browser.close" }));
    } catch {}
    await withTimeout(exited, 8_000, "edge exit").catch(() => edge.kill());
    ws?.close();
  }
});

after(async () => {
  if (!dir) return;
  await sleep(500);
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

test("queue panel clears the composer corner radius in GUI and WebUI, wide and narrow", { skip }, () => {
  for (const c of CASES.filter((x) => !x.withGoal)) {
    const m = results.get(key(c));
    assert.ok(m.insetLeft > m.cardRadius && m.insetRight > m.cardRadius, `${key(c)}: ${JSON.stringify(m)}`);
    // An empty goal-bar host must not flatten the queue panel's own top corners.
    assert.ok(m.panelTopRadius > 0, `${key(c)}: queue alone keeps its top radius ${JSON.stringify(m)}`);
  }
});

test("at the narrowest GUI pane the queue still shows its count and some preview text", { skip }, () => {
  const m = results.get(key({ surface: "desktop", withGoal: false, width: 320 }));
  // 改动前同一场景：标题 41/41px 完整、首项预览 46px；阈值 24px ≈ 两个 12px 汉字。
  const summary = `title "${m.title.text}" ${m.title.cw}/${m.title.sw}px, first preview ${m.preview.cw}px`;
  assert.ok(m.title.sw <= m.title.cw && m.preview.cw >= 24, summary);
});

test("goal bar flush on the queue panel leaves no rounded notch at the seam", { skip }, () => {
  const m = results.get(key({ surface: "desktop", withGoal: true, width: 1280 }));
  assert.ok(m.goalFlushAbove, `precondition: goal bar flush and aligned above the panel ${JSON.stringify(m)}`);
  assert.equal(m.panelTopRadius, 0, JSON.stringify(m));
});
