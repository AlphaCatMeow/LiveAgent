import assert from "node:assert/strict";
import test from "node:test";
import { createWebModuleLoader } from "../helpers/load-web-module.mjs";

const loader = createWebModuleLoader();
const { createGatewayGitClient } = loader.loadModule("src/lib/git/gatewayGitClient.ts");

test("gateway git client forwards worktree create and remove operations", async () => {
  const calls = [];
  const api = {
    async gitRequest(action, workdir, args) {
      calls.push({ action, workdir, args });
      if (action === "create_worktree") {
        return { ok: true, worktreePath: "/workspace/.worktrees/topic" };
      }
      return { ok: true };
    },
  };
  const client = createGatewayGitClient(api);

  const created = await client.createWorktree("/workspace/project", "topic", "main");
  await client.removeWorktree(
    "/workspace/project",
    "/workspace/.worktrees/topic",
    true,
    "topic",
  );

  assert.equal(created.worktreePath, "/workspace/.worktrees/topic");
  assert.deepEqual(calls, [
    {
      action: "create_worktree",
      workdir: "/workspace/project",
      args: { name: "topic", startPoint: "main" },
    },
    {
      action: "remove_worktree",
      workdir: "/workspace/project",
      args: {
        worktreePath: "/workspace/.worktrees/topic",
        force: true,
        deleteBranch: "topic",
      },
    },
  ]);
});
