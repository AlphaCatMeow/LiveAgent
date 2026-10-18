import { workspaceProjectPathKey } from "@liveagent/app/lib/settings";
import { invoke } from "@liveagent/app/shims/tauriCore";
import { rootAliasFromPath } from "@liveagent/ui/components/chat/workspace-project-settings/workspaceProjectSettingsUtils";
import type { ToolRootAccess, ToolRootGrantScope } from "@liveagent/ui/lib/chat/toolRootRequest";
import { loadPersistedSettings } from "./settings/storage";
import {
  applyScopedWorkspaceRootGrants,
  applyWorkspaceRootGrants,
  listScopedWorkspaceRootGrants,
  listWorkspaceRootGrants,
  type WorkspaceRootGrant,
  type WorkspaceRootGrantDraft,
} from "./workspaceRootGrants";

function comparablePath(path: string) {
  return path
    .replace(/^\\\\\?\\/, "")
    .replace(/[\\/]+$/, "")
    .toLowerCase();
}

/** Adds `directory` to an existing grant list, widening access if already present. */
function withGrant(
  existing: readonly WorkspaceRootGrant[],
  directory: string,
  access: ToolRootAccess,
): WorkspaceRootGrantDraft[] {
  const drafts: WorkspaceRootGrantDraft[] = existing.map((grant) => ({
    id: grant.id,
    alias: grant.alias,
    displayPath: grant.displayPath,
    access: grant.access,
  }));
  const match = existing.findIndex(
    (grant) =>
      comparablePath(grant.canonicalPath) === comparablePath(directory) ||
      comparablePath(grant.displayPath) === comparablePath(directory),
  );
  if (match >= 0) {
    if (access === "write") drafts[match].access = "write";
    return drafts;
  }
  const aliases = new Set(existing.map((grant) => grant.alias));
  drafts.push({ alias: rootAliasFromPath(directory, aliases), displayPath: directory, access });
  return drafts;
}

export type ToolRootGrantInput = {
  /** The denied tool path; its nearest existing directory is granted. */
  path: string;
  /** The turn's primary workdir; picks the project/repository to persist into. */
  workdir?: string;
  scope: ToolRootGrantScope;
  access: ToolRootAccess;
};

async function persistGrant(input: ToolRootGrantInput, directory: string): Promise<void> {
  const { scope, access } = input;
  if (scope === "turn") return;
  const workdir = input.workdir?.trim();
  if (!workdir) throw new Error("本轮没有工作目录，无法保存授权");
  if (scope === "project") {
    const pathKey = workspaceProjectPathKey(workdir);
    const project = (await loadPersistedSettings()).system.workspaceProjects.find(
      (candidate) => workspaceProjectPathKey(candidate.path) === pathKey,
    );
    if (!project) throw new Error("当前工作目录不是已登记的工作空间，请改选「本仓库」或「全局」");
    await applyWorkspaceRootGrants(
      project,
      withGrant(await listWorkspaceRootGrants(project), directory, access),
    );
    return;
  }
  await applyScopedWorkspaceRootGrants(
    scope,
    workdir,
    withGrant(await listScopedWorkspaceRootGrants(scope, workdir), directory, access),
  );
}

/**
 * Resolves the directory to grant for a denied tool path and persists it for
 * non-`turn` scopes. Persisting first means a rejected grant (e.g. the home
 * directory as a global root) never reaches the running turn.
 */
export async function grantToolRootDirectory(input: ToolRootGrantInput): Promise<string> {
  const directory = await invoke<string>("workspace_root_grant_directory", { path: input.path });
  await persistGrant(input, directory);
  return directory;
}
