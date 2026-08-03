import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createWebModuleLoader } from "../../test/helpers/load-web-module.mjs";

const loader = createWebModuleLoader({
  rootDir: fileURLToPath(new URL("../", import.meta.url)),
});
const settings = loader.loadModule("src/lib/settings/index.ts");
const sync = loader.loadModule("src/lib/settings/sync.ts");

test("process detail expansion defaults off and survives transcript resizing", () => {
  assert.deepEqual(settings.normalizeChatTranscriptSettings(undefined), {
    width: 768,
    processDetailsExpanded: false,
  });
  assert.deepEqual(
    settings.normalizeChatTranscriptSettings({
      width: 920.4,
      processDetailsExpanded: true,
    }),
    { width: 920, processDetailsExpanded: true },
  );

  const current = settings.normalizeSettings({
    customSettings: {
      chatTranscript: { width: 768, processDetailsExpanded: true },
    },
  });
  const resized = settings.updateChatTranscriptWidth(current, 960);
  assert.deepEqual(resized.customSettings.chatTranscript, {
    width: 960,
    processDetailsExpanded: true,
  });
});

test("Gateway synchronization cannot overwrite the local disclosure preference", () => {
  const current = settings.normalizeSettings({
    customSettings: {
      chatTranscript: { width: 920, processDetailsExpanded: true },
    },
  });
  const remote = settings.normalizeSettings({
    customSettings: {
      chatTranscript: { width: 1100, processDetailsExpanded: false },
    },
  });

  const payload = sync.buildGatewaySettingsSyncPayload(remote);
  const synced = sync.applyGatewaySettingsSyncPayload(current, payload);

  assert.deepEqual(payload.customSettings.chatTranscript, {
    width: 768,
    processDetailsExpanded: false,
  });
  assert.deepEqual(synced.customSettings.chatTranscript, {
    width: 920,
    processDetailsExpanded: true,
  });
});
