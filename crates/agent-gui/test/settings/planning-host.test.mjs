import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

test("Planning browser-only host returns a domain error without invoking desktop commands", async () => {
  const loader = createTsModuleLoader({ mocks: {
    [new URL("../../src/lib/host.ts", import.meta.url).pathname]: { isKBrainBrowserHost: () => true },
    "@tauri-apps/api/core": { invoke() { throw new Error("unexpected desktop invocation"); } },
    "@tauri-apps/api/event": { listen() { throw new Error("unexpected desktop listener"); } },
  } });
  const { backend } = loader.loadModule("src/lib/planning/backend.ts");
  await assert.rejects(backend.call("query"), /E:desktop_required/);
  backend.subscribe(() => {})();
});
