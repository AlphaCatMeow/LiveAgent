import type {
  FileToolRoot,
  ReadImageResultDetails,
  ReadNotebookResultDetails,
  ReadPdfResultDetails,
  ReadTextResultDetails,
} from "./builtinTypes";

type FileReadSnapshot =
  | {
      root: FileToolRoot;
      path: string;
      kind: "text";
      mtimeMs: number;
      contentHash: string;
      startLine: number;
      numLines: number;
      totalLines: number;
      isPartialView: boolean;
    }
  | {
      root: FileToolRoot;
      path: string;
      kind: "image";
      mtimeMs: number;
      contentHash: string;
    }
  | {
      root: FileToolRoot;
      path: string;
      kind: "pdf";
      mtimeMs: number;
      contentHash: string;
      pageStart: number;
      numPages: number;
      totalPages: number;
    }
  | {
      root: FileToolRoot;
      path: string;
      kind: "notebook";
      mtimeMs: number;
      contentHash: string;
      cellStart: number;
      numCells: number;
      totalCells: number;
    };

type FileSnapshotBucket = {
  latest?: FileReadSnapshot;
  latestFullText?: Extract<FileReadSnapshot, { kind: "text" }>;
  byRangeKey: Map<string, FileReadSnapshot>;
};

function normalizeRoot(root?: FileToolRoot): FileToolRoot {
  return root === "skills" ? "skills" : "workspace";
}

function buildBucketKey(root: FileToolRoot | undefined, path: string) {
  return `${normalizeRoot(root)}\0${path}`;
}

function getBucket(
  buckets: Map<string, FileSnapshotBucket>,
  root: FileToolRoot | undefined,
  path: string,
): FileSnapshotBucket {
  const key = buildBucketKey(root, path);
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = {
      byRangeKey: new Map<string, FileReadSnapshot>(),
    };
    buckets.set(key, bucket);
  }
  return bucket;
}

function buildTextRangeKey(snapshot: Extract<FileReadSnapshot, { kind: "text" }>) {
  return `text:${snapshot.startLine}:${snapshot.numLines}:${snapshot.totalLines}`;
}

function buildImageRangeKey() {
  return "image";
}

function buildPdfRangeKey(snapshot: Extract<FileReadSnapshot, { kind: "pdf" }>) {
  return `pdf:${snapshot.pageStart}:${snapshot.numPages}:${snapshot.totalPages}`;
}

function buildNotebookRangeKey(snapshot: Extract<FileReadSnapshot, { kind: "notebook" }>) {
  return `notebook:${snapshot.cellStart}:${snapshot.numCells}:${snapshot.totalCells}`;
}

export type FileToolState = ReturnType<typeof createFileToolState>;

export function createFileToolState() {
  const buckets = new Map<string, FileSnapshotBucket>();

  function recordTextRead(details: ReadTextResultDetails) {
    const root = normalizeRoot(details.root);
    const snapshot: Extract<FileReadSnapshot, { kind: "text" }> = {
      root,
      path: details.path,
      kind: "text",
      mtimeMs: details.mtimeMs,
      contentHash: details.contentHash,
      startLine: details.startLine,
      numLines: details.numLines,
      totalLines: details.totalLines,
      isPartialView: details.isPartialView,
    };
    const bucket = getBucket(buckets, root, details.path);
    bucket.latest = snapshot;
    bucket.byRangeKey.set(buildTextRangeKey(snapshot), snapshot);
    if (!snapshot.isPartialView) {
      bucket.latestFullText = snapshot;
    }
  }

  function recordImageRead(details: ReadImageResultDetails) {
    const root = normalizeRoot(details.root);
    const snapshot: Extract<FileReadSnapshot, { kind: "image" }> = {
      root,
      path: details.path,
      kind: "image",
      mtimeMs: details.mtimeMs,
      contentHash: details.contentHash,
    };
    const bucket = getBucket(buckets, root, details.path);
    bucket.latest = snapshot;
    bucket.byRangeKey.set(buildImageRangeKey(), snapshot);
  }

  function recordPdfRead(details: ReadPdfResultDetails) {
    const root = normalizeRoot(details.root);
    const snapshot: Extract<FileReadSnapshot, { kind: "pdf" }> = {
      root,
      path: details.path,
      kind: "pdf",
      mtimeMs: details.mtimeMs,
      contentHash: details.contentHash,
      pageStart: details.pageStart,
      numPages: details.numPages,
      totalPages: details.totalPages,
    };
    const bucket = getBucket(buckets, root, details.path);
    bucket.latest = snapshot;
    bucket.byRangeKey.set(buildPdfRangeKey(snapshot), snapshot);
  }

  function recordNotebookRead(details: ReadNotebookResultDetails) {
    const root = normalizeRoot(details.root);
    const snapshot: Extract<FileReadSnapshot, { kind: "notebook" }> = {
      root,
      path: details.path,
      kind: "notebook",
      mtimeMs: details.mtimeMs,
      contentHash: details.contentHash,
      cellStart: details.cellStart,
      numCells: details.numCells,
      totalCells: details.totalCells,
    };
    const bucket = getBucket(buckets, root, details.path);
    bucket.latest = snapshot;
    bucket.byRangeKey.set(buildNotebookRangeKey(snapshot), snapshot);
  }

  function recordTextMutation(params: {
    root?: FileToolRoot;
    path: string;
    mtimeMs: number;
    contentHash: string;
    totalLines: number;
  }) {
    const root = normalizeRoot(params.root);
    const snapshot: Extract<FileReadSnapshot, { kind: "text" }> = {
      root,
      path: params.path,
      kind: "text",
      mtimeMs: params.mtimeMs,
      contentHash: params.contentHash,
      startLine: 1,
      numLines: params.totalLines,
      totalLines: params.totalLines,
      isPartialView: false,
    };
    const bucket = getBucket(buckets, root, params.path);
    bucket.latest = snapshot;
    bucket.latestFullText = snapshot;
    bucket.byRangeKey.set(buildTextRangeKey(snapshot), snapshot);
  }

  function getLatest(path: string, root?: FileToolRoot) {
    return buckets.get(buildBucketKey(root, path))?.latest;
  }

  function getLatestFullText(path: string, root?: FileToolRoot) {
    return buckets.get(buildBucketKey(root, path))?.latestFullText;
  }

  function getExactTextRead(path: string, params: {
    startLine: number;
    numLines: number;
    totalLines: number;
  }, root?: FileToolRoot) {
    return buckets
      .get(buildBucketKey(root, path))
      ?.byRangeKey.get(
        buildTextRangeKey({
          root: normalizeRoot(root),
          path,
          kind: "text",
          mtimeMs: 0,
          contentHash: "",
          startLine: params.startLine,
          numLines: params.numLines,
          totalLines: params.totalLines,
          isPartialView: params.startLine > 1 || params.numLines < params.totalLines,
        }),
      );
  }

  function getExactImageRead(path: string, root?: FileToolRoot) {
    return buckets.get(buildBucketKey(root, path))?.byRangeKey.get(buildImageRangeKey());
  }

  function getExactPdfRead(path: string, params: {
    pageStart: number;
    numPages: number;
    totalPages: number;
  }, root?: FileToolRoot) {
    return buckets
      .get(buildBucketKey(root, path))
      ?.byRangeKey.get(
        buildPdfRangeKey({
          root: normalizeRoot(root),
          path,
          kind: "pdf",
          mtimeMs: 0,
          contentHash: "",
          pageStart: params.pageStart,
          numPages: params.numPages,
          totalPages: params.totalPages,
        }),
      );
  }

  function getExactNotebookRead(path: string, params: {
    cellStart: number;
    numCells: number;
    totalCells: number;
  }, root?: FileToolRoot) {
    return buckets
      .get(buildBucketKey(root, path))
      ?.byRangeKey.get(
        buildNotebookRangeKey({
          root: normalizeRoot(root),
          path,
          kind: "notebook",
          mtimeMs: 0,
          contentHash: "",
          cellStart: params.cellStart,
          numCells: params.numCells,
          totalCells: params.totalCells,
        }),
      );
  }

  function clear(path: string, root?: FileToolRoot) {
    buckets.delete(buildBucketKey(root, path));
  }

  return {
    recordTextRead,
    recordImageRead,
    recordPdfRead,
    recordNotebookRead,
    recordTextMutation,
    getLatest,
    getLatestFullText,
    getExactTextRead,
    getExactImageRead,
    getExactPdfRead,
    getExactNotebookRead,
    clear,
  };
}
