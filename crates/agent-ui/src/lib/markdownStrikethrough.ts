import { cjk } from "@streamdown/cjk";
import type { ComponentProps } from "react";
import type { Streamdown } from "streamdown";

type PluggableList = NonNullable<ComponentProps<typeof Streamdown>["remarkPlugins"]>;
type Pluggable = PluggableList[number];

// 删除线只认 `~~text~~`。GFM 规范同时允许单个 `~`，remark-gfm 与 @streamdown/cjk 的
// CJK 删除线插件也都默认开启 singleTilde，于是 `约 ~5 分钟~`、`1~3 天，3~5 天` 这类
// 用 `~` 表示“约/到”的常见写法会被误渲染成删除线。两个插件都要关，只关一个，
// 另一个仍会解析单 `~`。
const STRICT_STRIKETHROUGH_OPTIONS = { singleTilde: false } as const;

// 给插件追加 singleTilde: false，保留插件原有的其他选项。不认识该选项的插件
// （比如 cjk 里的链接边界拆分）会忽略它。
export function withDoubleTildeStrikethrough(plugin: Pluggable): Pluggable {
  // Preset（{ plugins, settings }）不是单个插件，没法附加选项，原样返回。
  if (typeof plugin !== "function" && !Array.isArray(plugin)) return plugin;
  if (!Array.isArray(plugin)) return [plugin, STRICT_STRIKETHROUGH_OPTIONS];
  const [attacher, options, ...rest] = plugin;
  const merged =
    options && typeof options === "object"
      ? { ...options, ...STRICT_STRIKETHROUGH_OPTIONS }
      : STRICT_STRIKETHROUGH_OPTIONS;
  return [attacher, merged, ...rest] as Pluggable;
}

export function withDoubleTildeStrikethroughList(plugins: PluggableList): PluggableList {
  return plugins.map(withDoubleTildeStrikethrough);
}

// 只有 remarkPluginsAfter 含删除线插件；remarkPluginsBefore（remark-cjk-friendly）
// 只处理强调，不需要改。
// 模块级求值，所以插件结构不完整时（例如测试替身）原样返回，不在导入时抛错。
function createStrictCjkPlugin(plugin: typeof cjk): typeof cjk {
  if (!Array.isArray(plugin?.remarkPluginsAfter)) return plugin;
  const remarkPluginsAfter = withDoubleTildeStrikethroughList(plugin.remarkPluginsAfter);
  return {
    ...plugin,
    remarkPluginsAfter,
    remarkPlugins: [...(plugin.remarkPluginsBefore ?? []), ...remarkPluginsAfter],
  };
}

export const cjkDoubleTildeStrikethrough: typeof cjk = createStrictCjkPlugin(cjk);
