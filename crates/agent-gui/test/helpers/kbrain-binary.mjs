import { prepare } from "../../../../scripts/release/prepare-kbrain.mjs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after } from "node:test";

let prepared;
let directory;

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function prepareBinary() {
  directory = await mkdtemp(join(tmpdir(), "kbrain-release-test-"));
  return prepare({ release: true, artifactDir: false, output: directory });
}

// Use the same pinned, checksum-verified release binaries as desktop packaging.
export async function getKBrainBinary() {
  prepared ??= prepareBinary();
  return (await prepared).binary;
}
