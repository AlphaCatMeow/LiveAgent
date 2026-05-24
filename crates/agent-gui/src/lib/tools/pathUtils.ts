import type { FileToolRoot } from "./builtinTypes";

type ParsedToolRelPath =
  | { kind: "missing" }
  | { kind: "root" }
  | { kind: "value"; value: string }
  | { kind: "invalid" };

function parseToolRelPath(input: unknown): ParsedToolRelPath {
  const raw = typeof input === "string" ? input.trim() : "";
  if (!raw) return { kind: "missing" };

  const normalized = raw.replace(/\\/g, "/");
  if (/^[a-zA-Z]:\//.test(normalized)) return { kind: "invalid" };
  if (normalized.startsWith("/") || normalized.startsWith("//")) {
    return { kind: "invalid" };
  }

  const segments: string[] = [];
  for (const segment of normalized.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === ".." || segment.includes(":")) {
      return { kind: "invalid" };
    }
    segments.push(segment);
  }

  if (segments.length === 0) return { kind: "root" };
  return { kind: "value", value: segments.join("/") };
}

export function normalizeRequiredToolRelPath(input: unknown, label: string) {
  const parsed = parseToolRelPath(input);
  if (parsed.kind !== "value") {
    throw new Error(`${label} must be a relative path`);
  }
  return parsed.value;
}

export function normalizeOptionalToolRelPath(input: unknown, label: string) {
  const parsed = parseToolRelPath(input);
  if (parsed.kind === "invalid") {
    throw new Error(`${label} must be a relative path`);
  }
  if (parsed.kind === "value") {
    return parsed.value;
  }
  return undefined;
}

export function normalizeToolFileRoot(
  input: unknown,
  label: string,
  options?: { allowSkillsRoot?: boolean },
): FileToolRoot {
  const raw = typeof input === "string" ? input.trim() : "";
  if (!raw) return "workspace";
  if (raw === "workspace") return "workspace";
  if (raw === "skills") {
    if (options?.allowSkillsRoot) return "skills";
    throw new Error(`${label} root=skills is only available when Skills are enabled`);
  }
  throw new Error(`${label} root must be workspace or skills`);
}

export function normalizeComparablePath(path: string) {
  return path.trim().replace(/\\/g, "/").replace(/\/+$/g, "");
}

export function relativePathFromAbsolute(rawPath: string, rootDir: string) {
  const path = normalizeComparablePath(rawPath);
  const root = normalizeComparablePath(rootDir);
  if (!path || !root) return null;
  if (path === root) return "";
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : null;
}

function rootArgText(root: FileToolRoot) {
  return root === "workspace" ? 'root="workspace" (or omit root)' : `root="${root}"`;
}

export function formatScopedTarget(root: FileToolRoot, path: string | undefined) {
  const displayPath = path || "<root>";
  return root === "workspace" ? displayPath : `root=${root} path=${displayPath}`;
}

export function buildScopedPathError(params: {
  label: string;
  rawPath: unknown;
  workdir: string;
  skillsRootDir?: string;
  required: boolean;
}) {
  const raw = typeof params.rawPath === "string" ? params.rawPath.trim() : "";
  const roots: Array<{ root: FileToolRoot; dir: string }> = [
    { root: "workspace", dir: params.workdir },
  ];
  if (params.skillsRootDir?.trim()) {
    roots.push({ root: "skills", dir: params.skillsRootDir });
  }

  for (const candidate of roots) {
    const relative = relativePathFromAbsolute(raw, candidate.dir);
    if (relative === null) continue;
    const pathHint = relative
      ? `path="${relative}"`
      : params.required
        ? "path=<relative file path under that root>"
        : "omit path";
    return [
      `${params.label} must be a relative path inside the selected tool root.`,
      `Retry with ${rootArgText(candidate.root)}, ${pathHint}.`,
      "Do not use Bash for workspace or Skills file operations.",
    ].join(" ");
  }

  return [
    `${params.label} must be relative to the selected tool root and must not contain absolute paths or .. segments.`,
    params.skillsRootDir?.trim()
      ? 'Use root="workspace" or root="skills" with a relative path.'
      : 'Use root="workspace" with a relative path.',
    "Do not use Bash for workspace or Skills file operations.",
  ].join(" ");
}

function tryRecoverScopedRelPath(params: {
  input: unknown;
  expectedRoot: FileToolRoot;
  workdir: string;
  skillsRootDir?: string;
}): string | null {
  const raw = typeof params.input === "string" ? params.input.trim() : "";
  if (!raw) return null;
  const rootDir =
    params.expectedRoot === "skills" ? params.skillsRootDir : params.workdir;
  if (!rootDir?.trim()) return null;
  return relativePathFromAbsolute(raw, rootDir);
}

export function normalizeRequiredScopedRelPath(params: {
  input: unknown;
  label: string;
  expectedRoot: FileToolRoot;
  workdir: string;
  skillsRootDir?: string;
}) {
  try {
    return normalizeRequiredToolRelPath(params.input, params.label);
  } catch {
    const recovered = tryRecoverScopedRelPath({
      input: params.input,
      expectedRoot: params.expectedRoot,
      workdir: params.workdir,
      skillsRootDir: params.skillsRootDir,
    });
    if (recovered !== null && recovered !== "") {
      try {
        return normalizeRequiredToolRelPath(recovered, params.label);
      } catch {
        /* fall through to scoped error */
      }
    }
    throw new Error(
      buildScopedPathError({
        label: params.label,
        rawPath: params.input,
        workdir: params.workdir,
        skillsRootDir: params.skillsRootDir,
        required: true,
      }),
    );
  }
}

export function normalizeOptionalScopedRelPath(params: {
  input: unknown;
  label: string;
  expectedRoot: FileToolRoot;
  workdir: string;
  skillsRootDir?: string;
}) {
  try {
    return normalizeOptionalToolRelPath(params.input, params.label);
  } catch {
    const recovered = tryRecoverScopedRelPath({
      input: params.input,
      expectedRoot: params.expectedRoot,
      workdir: params.workdir,
      skillsRootDir: params.skillsRootDir,
    });
    if (recovered !== null) {
      if (recovered === "") return undefined;
      try {
        return normalizeOptionalToolRelPath(recovered, params.label);
      } catch {
        /* fall through to scoped error */
      }
    }
    throw new Error(
      buildScopedPathError({
        label: params.label,
        rawPath: params.input,
        workdir: params.workdir,
        skillsRootDir: params.skillsRootDir,
        required: false,
      }),
    );
  }
}
