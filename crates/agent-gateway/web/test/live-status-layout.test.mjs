import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const transcriptSource = fs.readFileSync(
  new URL("../src/components/GatewayTranscript.tsx", import.meta.url),
  "utf8",
);

test("the streaming assistant always owns one stable live-status footer", () => {
  assert.doesNotMatch(transcriptSource, /function shouldShowLiveStatusForRounds/);
  assert.match(
    transcriptSource,
    /isLatestLiveStreaming\s*\?\s*\(\s*<LiveStatusFooter[\s\S]*?status=\{displayedToolStatus \?\? VIBING_STATUS\}/,
  );
  assert.match(transcriptSource, /data-row-key=\{row\.key\}/);
  assert.match(transcriptSource, /gateway-live-status-footer ml-9 min-w-0 overflow-hidden pt-1/);
  assert.match(transcriptSource, /<VibingText className="w-full"/);
  assert.match(transcriptSource, /<AssistantStatus className="w-full"/);
});
