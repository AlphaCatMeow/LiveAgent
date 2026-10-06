import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// A K-brain source checkout for the end-to-end tests that build the real backend:
// KBRAIN_REPO_ROOT (CI checks out the revision pinned in kbrain.lock.json), or a sibling
// ../K-brain next to this repository for local development.
export const kbrainSource =
  process.env.KBRAIN_REPO_ROOT || fileURLToPath(new URL("../../../../../K-brain/", import.meta.url));

/**
 * Skips the test when no checkout was configured. An explicit KBRAIN_REPO_ROOT that does not
 * exist still fails loudly, so a broken CI checkout can never pass silently.
 */
export function skipWithoutKBrainSource(t) {
  if (process.env.KBRAIN_REPO_ROOT || existsSync(path.join(kbrainSource, "go.mod"))) return false;
  t.skip("needs a K-brain source checkout: set KBRAIN_REPO_ROOT or clone it next to this repository");
  return true;
}
