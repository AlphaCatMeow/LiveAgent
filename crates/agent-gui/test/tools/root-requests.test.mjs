import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const grants = [];
const loader = createTsModuleLoader({
  mocks: {
    "../workspaceRootGrantActions": {
      async grantToolRootDirectory(input) {
        grants.push(input);
        if (input.scope === "global" && input.path.startsWith("C:\\Users\\me\\")) {
          throw new Error("全局附加目录不能是用户主目录");
        }
        return "D:\\shared";
      },
    },
  },
});
const { requestRootGrant, answerRootRequest, getPendingRootRequest, getRootRequestVersion } =
  loader.loadModule("src/lib/tools/rootRequests.ts");

function rootRequest(toolCallId, path = "D:\\shared\\notes.txt") {
  return {
    request_id: `req-${toolCallId}`,
    tool_call_id: toolCallId,
    tool: "Read",
    code: "path_outside_roots",
    path,
    access: "read",
  };
}

test("grant resolves the paused call with the granted directory and persists the scope", async () => {
  const signal = new AbortController().signal;
  const before = getRootRequestVersion();
  const pending = requestRootGrant({ request: rootRequest("c1"), workdir: "D:\\repo", signal });
  assert.equal(getPendingRootRequest("c1")?.path, "D:\\shared\\notes.txt");
  assert.ok(getRootRequestVersion() > before);

  const outcome = await answerRootRequest("c1", { decision: "grant", scope: "repository", access: "write" });
  assert.deepEqual(outcome, { directory: "D:\\shared" });
  assert.deepEqual(await pending, { decision: "grant", roots: [{ path: "D:\\shared", access: "write" }] });
  assert.equal(getPendingRootRequest("c1"), null);
  assert.deepEqual(grants.at(-1), {
    path: "D:\\shared\\notes.txt",
    workdir: "D:\\repo",
    scope: "repository",
    access: "write",
  });
});

test("deny and abort both settle as deny and clear the card", async () => {
  const denied = requestRootGrant({ request: rootRequest("c2"), signal: new AbortController().signal });
  await answerRootRequest("c2", { decision: "deny" });
  assert.deepEqual(await denied, { decision: "deny" });

  const controller = new AbortController();
  const aborted = requestRootGrant({ request: rootRequest("c3"), signal: controller.signal });
  controller.abort();
  assert.deepEqual(await aborted, { decision: "deny" });
  assert.equal(getPendingRootRequest("c3"), null);
  await assert.rejects(answerRootRequest("c3", { decision: "deny" }), /已失效/);
});

test("a rejected grant keeps the call paused so the user can pick another scope", async () => {
  const pending = requestRootGrant({
    request: rootRequest("c4", "C:\\Users\\me\\notes.txt"),
    signal: new AbortController().signal,
  });
  await assert.rejects(
    answerRootRequest("c4", { decision: "grant", scope: "global", access: "read" }),
    /用户主目录/,
  );
  assert.ok(getPendingRootRequest("c4"));
  await answerRootRequest("c4", { decision: "grant", scope: "turn", access: "read" });
  assert.equal((await pending).decision, "grant");
});

test("requests without a tool call id are denied immediately", async () => {
  const request = { ...rootRequest("c5"), tool_call_id: undefined };
  assert.deepEqual(await requestRootGrant({ request, signal: new AbortController().signal }), {
    decision: "deny",
  });
});
