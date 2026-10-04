import assert from "node:assert/strict";
import test from "node:test";

import { cjk } from "@streamdown/cjk";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { defaultRemarkPlugins, Streamdown } from "streamdown";

import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

// 用真实的 streamdown / remark-gfm / @streamdown/cjk 渲染，只把本仓库的辅助模块交给 TS 加载器，
// 这样测到的就是聊天界面实际使用的解析链路。
const loader = createTsModuleLoader({
  mocks: {
    "@streamdown/cjk": { cjk },
    streamdown: { Streamdown, defaultRemarkPlugins },
  },
});
const { cjkDoubleTildeStrikethrough, withDoubleTildeStrikethrough } = loader.loadModule(
  "@liveagent/ui/lib/markdownStrikethrough.ts",
);

function render(markdown, { fixed }) {
  const gfm = defaultRemarkPlugins.gfm;
  return renderToStaticMarkup(
    createElement(
      Streamdown,
      {
        mode: "static",
        plugins: { cjk: fixed ? cjkDoubleTildeStrikethrough : cjk },
        remarkPlugins: [fixed ? withDoubleTildeStrikethrough(gfm) : gfm],
      },
      markdown,
    ),
  );
}

const SINGLE_TILDE_CASES = ["a ~one~ b", "约 ~5 分钟~ 后", "1~3 天，3~5 天", "range ~10~20~ ok"];

test("single tildes render as plain text, not strikethrough", () => {
  for (const markdown of SINGLE_TILDE_CASES) {
    const html = render(markdown, { fixed: true });
    assert.doesNotMatch(html, /<del>/, `${markdown} -> ${html}`);
    assert.ok(html.includes("~"), `tilde is kept as text: ${html}`);
  }
});

test("double tildes still render as strikethrough, including next to CJK text", () => {
  assert.match(render("a ~~two~~ b", { fixed: true }), /<del>two<\/del>/);
  assert.match(render("价格~~100~~元", { fixed: true }), /<del>100<\/del>/);
  assert.match(render("**粗体**和~~删除~~", { fixed: true }), /<del>删除<\/del>/);
});

test("the default plugin chain is what produced single-tilde strikethrough", () => {
  // Guards the regression premise: if upstream ever flips the default, this
  // tells us the wrapper is no longer what is doing the work.
  assert.match(render("a ~one~ b", { fixed: false }), /<del>one<\/del>/);
});

test("both the gfm and the cjk strikethrough plugins get singleTilde: false", () => {
  const [, gfmOptions] = withDoubleTildeStrikethrough(defaultRemarkPlugins.gfm);
  assert.equal(gfmOptions.singleTilde, false);
  const options = cjkDoubleTildeStrikethrough.remarkPluginsAfter.map((plugin) => plugin[1]);
  assert.ok(options.length > 0 && options.every((o) => o.singleTilde === false));
  assert.deepEqual(cjkDoubleTildeStrikethrough.remarkPluginsBefore, cjk.remarkPluginsBefore);
});

test("existing plugin options are preserved and bare plugins are wrapped", () => {
  const attacher = () => {};
  assert.deepEqual(withDoubleTildeStrikethrough([attacher, { keep: 1 }]), [
    attacher,
    { keep: 1, singleTilde: false },
  ]);
  assert.deepEqual(withDoubleTildeStrikethrough(attacher), [attacher, { singleTilde: false }]);
});
