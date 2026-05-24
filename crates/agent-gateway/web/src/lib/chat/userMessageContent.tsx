import { File, Folder } from "../../components/icons";

import {
  parsePastedTextDisplayReferences,
  type PendingUploadedFile,
  type PastedTextDisplayReference,
} from "./uploadedFiles";

export function isMentionToken(token: string) {
  return /^@[^\s@][^\s]*$/.test(token);
}

type UserMessageSegment =
  | { type: "text"; value: string }
  | { type: "mention"; path: string; isDir: boolean }
  | {
      type: "pastedText";
      reference: PastedTextDisplayReference;
      file: PendingUploadedFile;
    };

function pushTextSegment(segments: UserMessageSegment[], value: string) {
  if (!value) return;
  const last = segments[segments.length - 1];
  if (last?.type === "text") {
    last.value += value;
    return;
  }
  segments.push({ type: "text", value });
}

function appendSegments(
  segments: UserMessageSegment[],
  incoming: UserMessageSegment[],
) {
  for (const segment of incoming) {
    if (segment.type === "text") {
      pushTextSegment(segments, segment.value);
    } else {
      segments.push(segment);
    }
  }
}

function unescapeMarkdown(value: string) {
  return value.replace(/\\([\\[\]()])/g, "$1");
}

function normalizeMarkdownDestination(value: string) {
  const trimmed = value.trim();
  const inner =
    trimmed.startsWith("<") && trimmed.endsWith(">")
      ? trimmed.slice(1, -1)
      : trimmed;
  return unescapeMarkdown(inner)
    .replace(/%3C/gi, "<")
    .replace(/%3E/gi, ">");
}

function normalizeReferencePath(value: string) {
  return value.trim().replace(/\\/g, "/");
}

function buildFileReference(rawPath: string) {
  const normalized = normalizeReferencePath(rawPath);
  const isDir = normalized.endsWith("/");
  const path = normalized.replace(/\/+$/, "");
  if (!path || path.startsWith("/") || path.startsWith("#")) return null;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(path)) return null;
  if (path.split("/").some((part) => !part || part === "." || part === "..")) {
    return null;
  }
  return { path, isDir };
}

function markdownFileReference(label: string, rawDestination: string) {
  const reference = buildFileReference(normalizeMarkdownDestination(rawDestination));
  if (!reference) return null;

  const fileName = reference.path.split("/").pop() || reference.path;
  const expectedLabel = reference.isDir ? `${fileName}/` : fileName;
  if (unescapeMarkdown(label.trim()) !== expectedLabel) return null;

  return reference;
}

function tokenizeAtMentions(text: string): UserMessageSegment[] {
  const segments: UserMessageSegment[] = [];
  const mentionPattern = /(^|\s)(@\S+)/g;
  let cursor = 0;

  for (const match of text.matchAll(mentionPattern)) {
    const boundary = match[1] ?? "";
    const token = match[2] ?? "";
    const matchIndex = match.index ?? 0;
    const tokenStart = matchIndex + boundary.length;

    if (tokenStart > cursor) {
      pushTextSegment(segments, text.slice(cursor, tokenStart));
    }

    if (isMentionToken(token)) {
      const reference = buildFileReference(token.slice(1));
      if (reference) {
        segments.push({ type: "mention", ...reference });
      } else {
        pushTextSegment(segments, token);
      }
    } else if (tokenStart + token.length > cursor) {
      pushTextSegment(segments, text.slice(tokenStart, tokenStart + token.length));
    }

    cursor = tokenStart + token.length;
  }

  if (cursor < text.length) {
    pushTextSegment(segments, text.slice(cursor));
  }

  if (segments.length === 0) {
    segments.push({ type: "text", value: text });
  }

  return segments;
}

function tokenizeMentions(text: string): UserMessageSegment[] {
  const segments: UserMessageSegment[] = [];
  const markdownPattern = /\[((?:\\.|[^\]\\\r\n])+)]\((<[^>\r\n]+>|[^)\r\n]+)\)/g;
  let cursor = 0;

  for (const match of text.matchAll(markdownPattern)) {
    const raw = match[0] ?? "";
    const label = match[1] ?? "";
    const destination = match[2] ?? "";
    const matchIndex = match.index ?? 0;
    const reference = markdownFileReference(label, destination);
    if (!reference) continue;

    if (matchIndex > cursor) {
      appendSegments(segments, tokenizeAtMentions(text.slice(cursor, matchIndex)));
    }
    segments.push({ type: "mention", ...reference });
    cursor = matchIndex + raw.length;
  }

  if (cursor < text.length) {
    appendSegments(segments, tokenizeAtMentions(text.slice(cursor)));
  }

  return segments.length > 0 ? segments : tokenizeAtMentions(text);
}

function tokenizeUserMessage(
  text: string,
  pastedTextFiles: PendingUploadedFile[],
): UserMessageSegment[] {
  const fileByPath = new Map(pastedTextFiles.map((file) => [file.relativePath, file]));
  const references = parsePastedTextDisplayReferences(text);
  if (references.length === 0 || fileByPath.size === 0) {
    return tokenizeMentions(text);
  }

  const segments: UserMessageSegment[] = [];
  let cursor = 0;
  for (const reference of references) {
    const file = fileByPath.get(reference.relativePath);
    if (!file) continue;
    if (reference.start > cursor) {
      appendSegments(segments, tokenizeMentions(text.slice(cursor, reference.start)));
    }
    segments.push({ type: "pastedText", reference, file });
    cursor = reference.end;
  }

  if (cursor < text.length) {
    appendSegments(segments, tokenizeMentions(text.slice(cursor)));
  }

  return segments.length > 0 ? segments : tokenizeMentions(text);
}

function formatPastedTextCount(value: number) {
  return new Intl.NumberFormat().format(value);
}

function PastedTextChip({
  reference,
  file,
}: {
  reference: PastedTextDisplayReference;
  file: PendingUploadedFile;
}) {
  const label = file.displayLabel || reference.label;
  const hasCounts =
    typeof file.displayCharCount === "number" &&
    Number.isFinite(file.displayCharCount) &&
    typeof file.displayLineCount === "number" &&
    Number.isFinite(file.displayLineCount);
  const chipText = hasCounts
    ? `${label} · ${formatPastedTextCount(file.displayCharCount ?? 0)} chars · ${formatPastedTextCount(file.displayLineCount ?? 0)} lines`
    : label;

  return (
    <span
      title={file.relativePath}
      className="mention-chip mx-0.5 inline-flex items-center gap-1 rounded bg-emerald-500/15 px-1.5 text-emerald-700 align-baseline whitespace-nowrap select-none dark:text-emerald-300"
    >
      <File className="h-3 w-3 shrink-0 opacity-70" />
      {chipText}
    </span>
  );
}

function MentionChip({
  path,
  isDir,
}: {
  path: string;
  isDir: boolean;
}) {
  const fileName = path.split("/").pop() || path;
  return (
    <span
      title={isDir ? `${path}/` : path}
      className={
        isDir
          ? "mention-chip mx-0.5 inline-flex items-center gap-1 rounded bg-amber-400/25 px-1.5 align-baseline whitespace-nowrap"
          : "mention-chip mx-0.5 inline-flex items-center gap-1 rounded bg-blue-500/20 px-1.5 align-baseline whitespace-nowrap"
      }
    >
      {isDir ? (
        <Folder className="h-3 w-3 shrink-0 opacity-70" />
      ) : (
        <File className="h-3 w-3 shrink-0 opacity-70" />
      )}
      {fileName}
    </span>
  );
}

export function UserMessageContent({
  text,
  pastedTextFiles = [],
}: {
  text: string;
  pastedTextFiles?: PendingUploadedFile[];
}) {
  const parts = tokenizeUserMessage(text, pastedTextFiles);
  const hasChip = parts.some((part) => part.type === "mention" || part.type === "pastedText");
  if (!hasChip) return <>{text}</>;

  return (
    <>
      {parts.map((part, idx) => {
        if (part.type === "mention") {
          return <MentionChip key={idx} path={part.path} isDir={part.isDir} />;
        }
        if (part.type === "pastedText") {
          return (
            <PastedTextChip
              key={idx}
              reference={part.reference}
              file={part.file}
            />
          );
        }
        return <span key={idx}>{part.value}</span>;
      })}
    </>
  );
}
