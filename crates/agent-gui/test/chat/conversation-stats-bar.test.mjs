import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createDomTestEnv } from "../helpers/dom-test-env.mjs";

// ConversationStatsBar 组件行为验收
// (docs/design/composer-context-stats-bar.md §4.2、§9 组件层)：
// 空态 null、四档容器收缩、≈ 前缀、role="status" 完整 aria-label、
// 运行中心跳折算、approvalBar 互斥（插槽源码断言）。

const env = await createDomTestEnv();
const { React, act, createRoot } = env;
const doc = env.dom.window.document;

const { ConversationStatsBar } = env.loadModule(
  "@liveagent/ui/components/chat/ConversationStatsBar.tsx",
);
const { LocaleContext } = env.loadModule("@liveagent/ui/i18n/LocaleContext.tsx");
const { t: translate } = env.loadModule("@liveagent/app/i18n/config.ts");
const { EMPTY_CONVERSATION_STATS } = env.loadModule("@liveagent/ui/lib/trajectory/stats.ts");

const enLocale = { locale: "en-US", t: (key) => translate(key, "en-US") };

function sampleStats(overrides = {}) {
  return {
    ...EMPTY_CONVERSATION_STATS,
    turns: 51,
    steps: 672,
    llmMs: 754_000,
    toolMs: 42_000,
    ttftAvgMs: 20_900,
    ttftSamples: 300,
    decodeTokPerSec: 170.4,
    cacheHitRatio: 0.85,
    inputTokens: 111_000_000,
    outputTokens: 2_300_000,
    ...overrides,
  };
}

async function render(statsValue) {
  const container = doc.createElement("div");
  doc.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      React.createElement(
        LocaleContext.Provider,
        { value: enLocale },
        React.createElement(ConversationStatsBar, { stats: statsValue }),
      ),
    );
  });
  return {
    container,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

test("空态与全零读数都返回 null，不占高度", async () => {
  for (const statsValue of [null, EMPTY_CONVERSATION_STATS]) {
    const { container, unmount } = await render(statsValue);
    assert.equal(container.innerHTML, "", `stats=${JSON.stringify(statsValue)} 应渲染为空`);
    await unmount();
  }
});

test("完整读数：role=status + aria-label 拼出全部分组", async () => {
  const { container, unmount } = await render(sampleStats());
  const bar = container.querySelector('[role="status"]');
  assert.ok(bar, "必须有 role=status 容器");
  assert.equal(bar.getAttribute("aria-live"), "off", "数字变化不做 aria-live 播报");

  const label = bar.getAttribute("aria-label");
  assert.equal(
    label,
    "51 turns · 672 steps ｜ LLM 12m34s · Tools 42s ｜ In 111M tok · Out 2.3M tok ｜ Avg TTFT 20.9s · 170 tok/s · Cache hit 85%",
  );
  await unmount();
});

test("容器分档：时间/token/性能分组分别挂 28/40/52rem 断点", async () => {
  const { container, unmount } = await render(sampleStats());
  const groups = [...container.querySelectorAll('[role="status"] > div > span')].filter(
    (node) => !node.className.includes("text-muted-foreground/40"),
  );
  const classesOf = (text) =>
    groups.find((node) => node.textContent.includes(text))?.className ?? "";

  assert.match(classesOf("turns"), /flex/);
  assert.doesNotMatch(classesOf("turns"), /@min-/, "轮·步恒显，不挂断点");
  assert.match(classesOf("LLM"), /hidden @min-\[28rem\]:flex/);
  assert.match(classesOf("In 111M tok"), /hidden @min-\[40rem\]:flex/);
  assert.match(classesOf("Avg TTFT"), /hidden @min-\[52rem\]:flex/);
  await unmount();
});

test("approximate 读数带 ≈ 前缀；精确读数不带", async () => {
  const approx = await render(sampleStats({ approximate: true }));
  const label = approx.container.querySelector('[role="status"]').getAttribute("aria-label");
  assert.ok(label.startsWith("≈ "), `近似读数应带前缀，实际：${label}`);
  await approx.unmount();

  const exact = await render(sampleStats());
  const exactLabel = exact.container.querySelector('[role="status"]').getAttribute("aria-label");
  assert.equal(exactLabel.startsWith("≈"), false);
  await exact.unmount();
});

test("provider 未返回 usage 时 token 与性能分组整组隐藏", async () => {
  const { container, unmount } = await render(
    sampleStats({
      ttftAvgMs: null,
      decodeTokPerSec: null,
      cacheHitRatio: null,
      inputTokens: 0,
      outputTokens: 0,
    }),
  );
  const label = container.querySelector('[role="status"]').getAttribute("aria-label");
  assert.equal(label, "51 turns · 672 steps ｜ LLM 12m34s · Tools 42s");
  await unmount();
});

test("运行中把 RunningSinceAt 折算进显示值并启动心跳", async () => {
  const originalSetInterval = globalThis.setInterval;
  let intervalCount = 0;
  globalThis.setInterval = (...args) => {
    intervalCount += 1;
    return originalSetInterval(...args);
  };
  try {
    const startedAt = Date.now() - 90_000;
    const { container, unmount } = await render(
      sampleStats({
        llmMs: 60_000,
        llmRunningSinceAt: startedAt,
        toolMs: 0,
        toolRunningSinceAt: null,
      }),
    );
    const label = container.querySelector('[role="status"]').getAttribute("aria-label");
    // 60s 已完成 + 约 90s 运行中 ≈ 2m30s；容许秒级误差。
    assert.match(label, /LLM 2m(29|30|31)s/, `折算后的 LLM 时长不对：${label}`);
    assert.equal(intervalCount, 1, "运行中必须注册 1s 心跳");
    await unmount();
  } finally {
    globalThis.setInterval = originalSetInterval;
  }
});

test("空闲时零定时器：无运行段不注册心跳 interval", async () => {
  const originalSetInterval = globalThis.setInterval;
  let intervalCount = 0;
  globalThis.setInterval = (...args) => {
    intervalCount += 1;
    return originalSetInterval(...args);
  };
  try {
    const { unmount } = await render(sampleStats());
    assert.equal(intervalCount, 0, "无 RunningSinceAt 时不应注册任何 interval");
    await unmount();
  } finally {
    globalThis.setInterval = originalSetInterval;
  }
});

test("approvalBar 可见时状态栏让位（ChatComposerBar 插槽互斥）", () => {
  const composerSource = readFileSync(
    new URL("../../../agent-ui/src/pages/chat/ChatComposerBar.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    composerSource,
    /\{statsBar && approvalBar == null \? statsBar : null\}/,
    "statsBar 插槽必须保持 approvalBar 互斥",
  );
});
