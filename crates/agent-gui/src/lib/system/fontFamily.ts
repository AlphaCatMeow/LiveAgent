export const DEFAULT_INTERFACE_FONT_FAMILY =
  'ui-sans-serif, system-ui, "PingFang SC", "Microsoft YaHei", sans-serif';
export const DEFAULT_CHAT_FONT_FAMILY =
  '"OpenAI Sans Semibold", "PingFang SC", "Microsoft YaHei", sans-serif';
export const DEFAULT_CODE_FONT_FAMILY =
  '"SF Mono", SFMono-Regular, Menlo, Monaco, "Cascadia Code", Consolas, "Liberation Mono", monospace';

export const CODE_FONT_FAMILY_CHANGED_EVENT = "liveagent:code-font-family-changed";

export type FontFamilySettings = {
  interfaceFontFamily: string;
  chatFontFamily: string;
  codeFontFamily: string;
};

const MAX_FONT_FAMILY_LENGTH = 200;

// Reject values that could break out of a CSS declaration or inject external resources.
const UNSAFE_FONT_FAMILY_PATTERN = /[;{}<>\\]|url\s*\(|@import|expression\s*\(/i;
const ALLOWED_FONT_FAMILY_PATTERN = /^[\w\s,"'\-\.\+]+$/u;

type LocalFontData = {
  family?: string;
};

type QueryLocalFonts = () => Promise<LocalFontData[]>;

export function normalizeFontFamily(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) return "";
  if (trimmed.length > MAX_FONT_FAMILY_LENGTH) return "";
  if (UNSAFE_FONT_FAMILY_PATTERN.test(trimmed)) return "";
  if (!ALLOWED_FONT_FAMILY_PATTERN.test(trimmed)) return "";
  return trimmed;
}

export function resolveFontFamily(value: string, fallback: string): string {
  return normalizeFontFamily(value) || fallback;
}

export function resolveCodeFontFamily(value: string): string {
  return resolveFontFamily(value, DEFAULT_CODE_FONT_FAMILY);
}

export function applyFontFamilies(
  settings: FontFamilySettings,
  root: HTMLElement = document.documentElement,
): void {
  root.style.setProperty(
    "--app-font-family",
    resolveFontFamily(settings.interfaceFontFamily, DEFAULT_INTERFACE_FONT_FAMILY),
  );
  root.style.setProperty(
    "--chat-font-family",
    resolveFontFamily(settings.chatFontFamily, DEFAULT_CHAT_FONT_FAMILY),
  );
  const codeFontFamily = resolveCodeFontFamily(settings.codeFontFamily);
  root.style.setProperty("--code-font-family", codeFontFamily);
  window.dispatchEvent(
    new CustomEvent(CODE_FONT_FAMILY_CHANGED_EVENT, { detail: { codeFontFamily } }),
  );
}

export function quoteFontFamilyName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "";
  if (/^[a-zA-Z0-9_\-]+$/.test(trimmed)) return trimmed;
  return `"${trimmed.replace(/"/g, '\\"')}"`;
}

export async function listLocalFontFamilies(): Promise<string[]> {
  const queryLocalFonts = (
    globalThis as typeof globalThis & {
      queryLocalFonts?: QueryLocalFonts;
    }
  ).queryLocalFonts;
  if (typeof queryLocalFonts !== "function") return [];

  try {
    const fonts = await queryLocalFonts();
    const names = new Set<string>();
    for (const font of fonts) {
      const family = typeof font.family === "string" ? font.family.trim() : "";
      if (family) names.add(family);
    }
    return [...names].sort((left, right) =>
      left.localeCompare(right, undefined, { sensitivity: "base" }),
    );
  } catch {
    return [];
  }
}
