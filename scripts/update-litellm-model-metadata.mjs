#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_REPOSITORY = "BerriAI/litellm";
const SOURCE_PATH = "model_prices_and_context_window.json";
const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/i;
const DEFAULT_OUTPUTS = [
  join(
    repoRoot,
    "crates",
    "agent-gui",
    "src",
    "lib",
    "providers",
    "litellm-model-metadata.generated.json",
  ),
  join(
    repoRoot,
    "crates",
    "agent-gateway",
    "web",
    "src",
    "lib",
    "providers",
    "litellm-model-metadata.generated.json",
  ),
];

function normalizePositiveInteger(value) {
  const numeric =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
  return Math.floor(numeric);
}

function normalizeRevision(revision) {
  const normalized = typeof revision === "string" ? revision.trim().toLowerCase() : "";
  if (!COMMIT_SHA_PATTERN.test(normalized)) {
    throw new Error("A 40-character Git commit SHA is required as the source revision");
  }
  return normalized;
}

export function buildSnapshot(input, revision) {
  const normalizedRevision = normalizeRevision(revision);

  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
  let upstream;
  try {
    upstream = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`LiteLLM metadata is not valid JSON: ${error.message}`);
  }
  if (!upstream || typeof upstream !== "object" || Array.isArray(upstream)) {
    throw new Error("LiteLLM metadata root must be an object");
  }

  const models = {};
  for (const key of Object.keys(upstream).sort()) {
    const row = upstream[key];
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;

    const contextWindow = normalizePositiveInteger(row.max_input_tokens ?? row.max_tokens);
    const maxOutputToken = normalizePositiveInteger(row.max_output_tokens ?? row.max_tokens);
    if (contextWindow === undefined && maxOutputToken === undefined) continue;

    models[key] = {
      ...(contextWindow === undefined ? {} : { contextWindow }),
      ...(maxOutputToken === undefined ? {} : { maxOutputToken }),
    };
  }

  return {
    schemaVersion: 1,
    source: {
      repository: SOURCE_REPOSITORY,
      revision: normalizedRevision,
      path: SOURCE_PATH,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      license: "MIT",
    },
    models,
  };
}

export function serializeSnapshot(snapshot) {
  return `${JSON.stringify(snapshot, null, 2)}\n`;
}

async function restoreOutput(outputPath, previousBytes) {
  if (previousBytes === null) {
    await rm(outputPath, { force: true });
    return;
  }
  const rollbackPath = `${outputPath}.${process.pid}.${randomUUID()}.rollback`;
  await writeFile(rollbackPath, previousBytes);
  await rename(rollbackPath, outputPath);
}

export async function writeSnapshotPair(content, outputPaths = DEFAULT_OUTPUTS) {
  if (!Array.isArray(outputPaths) || outputPaths.length !== 2) {
    throw new Error("Exactly two snapshot output paths are required");
  }

  const bytes = Buffer.from(content, "utf8");
  const temporaryPaths = outputPaths.map(
    (outputPath) => `${outputPath}.${process.pid}.${randomUUID()}.tmp`,
  );
  const previousBytes = await Promise.all(
    outputPaths.map(async (outputPath) => {
      try {
        return await readFile(outputPath);
      } catch (error) {
        if (error?.code === "ENOENT") return null;
        throw error;
      }
    }),
  );

  let replacedCount = 0;
  try {
    await Promise.all(outputPaths.map((outputPath) => mkdir(dirname(outputPath), { recursive: true })));
    await Promise.all(temporaryPaths.map((temporaryPath) => writeFile(temporaryPath, bytes)));

    const verified = await Promise.all(temporaryPaths.map((temporaryPath) => readFile(temporaryPath)));
    if (verified.some((candidate) => !candidate.equals(bytes))) {
      throw new Error("Snapshot verification failed before replacement");
    }

    try {
      for (let index = 0; index < outputPaths.length; index += 1) {
        await rename(temporaryPaths[index], outputPaths[index]);
        replacedCount += 1;
      }
    } catch (error) {
      for (let index = replacedCount - 1; index >= 0; index -= 1) {
        await restoreOutput(outputPaths[index], previousBytes[index]);
      }
      throw error;
    }
  } finally {
    await Promise.all(temporaryPaths.map((temporaryPath) => rm(temporaryPath, { force: true })));
  }
}

async function fetchBytes(url, label) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "LiveAgent-LiteLLM-metadata-updater",
    },
  });
  if (!response.ok) {
    throw new Error(`${label} failed: HTTP ${response.status} ${response.statusText}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function resolveLatestRevision() {
  const apiUrl =
    `https://api.github.com/repos/${SOURCE_REPOSITORY}/commits` +
    `?path=${encodeURIComponent(SOURCE_PATH)}&per_page=1`;
  const bytes = await fetchBytes(apiUrl, "LiteLLM revision lookup");
  const commits = JSON.parse(bytes.toString("utf8"));
  const revision = Array.isArray(commits) && typeof commits[0]?.sha === "string"
    ? commits[0].sha.trim()
    : "";
  if (!revision) throw new Error("LiteLLM revision lookup returned no commit SHA");
  return revision;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === "--help" || name === "-h") {
      options.help = true;
      continue;
    }
    if (!["--input", "--revision", "--gui-output", "--web-output"].includes(name)) {
      throw new Error(`Unknown argument: ${name}`);
    }
    const value = argv[index + 1];
    if (!value) throw new Error(`Missing value for ${name}`);
    options[name.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
    index += 1;
  }
  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/update-litellm-model-metadata.mjs [options]\n\n` +
    `Options:\n` +
    `  --input <path>        Read a local upstream JSON file\n` +
    `  --revision <40-char-sha>  Record/fetch an immutable Git commit revision\n` +
    `  --gui-output <path>   Override the Desktop snapshot destination\n` +
    `  --web-output <path>   Override the Gateway snapshot destination\n` +
    `  -h, --help            Show this help\n`);
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    printHelp();
    return;
  }
  if (options.input && !options.revision) {
    throw new Error("--revision is required when --input is used");
  }

  const revision = normalizeRevision(options.revision ?? (await resolveLatestRevision()));
  const inputBytes = options.input
    ? await readFile(resolve(options.input))
    : await fetchBytes(
        `https://raw.githubusercontent.com/${SOURCE_REPOSITORY}/${revision}/${SOURCE_PATH}`,
        "LiteLLM metadata download",
      );
  const outputPaths = [
    options.guiOutput ? resolve(options.guiOutput) : DEFAULT_OUTPUTS[0],
    options.webOutput ? resolve(options.webOutput) : DEFAULT_OUTPUTS[1],
  ];
  const content = serializeSnapshot(buildSnapshot(inputBytes, revision));
  await writeSnapshotPair(content, outputPaths);
  console.log(
    `Updated ${Object.keys(JSON.parse(content).models).length} LiteLLM model entries from ${revision}`,
  );
}

const isMain =
  process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
