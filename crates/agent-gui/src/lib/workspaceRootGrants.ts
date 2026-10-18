import { invoke } from "@liveagent/app/shims/tauriCore";
import type { WorkspaceProject } from "./settings";

export type WorkspaceRootAccess = "read" | "write";
export type WorkspaceRootGrantState = "active" | "missing" | "changed";

export type WorkspaceRootGrant = {
  id: string;
  projectId: string;
  projectPathKey: string;
  alias: string;
  displayPath: string;
  canonicalPath: string;
  access: WorkspaceRootAccess;
  state: WorkspaceRootGrantState;
  createdAt: number;
  updatedAt: number;
};

export type WorkspaceRootGrantDraft = {
  id?: string;
  alias: string;
  displayPath: string;
  access: WorkspaceRootAccess;
};

function commandArgs(project: Pick<WorkspaceProject, "id" | "path">) {
  return {
    projectId: project.id,
    projectPath: project.path,
  };
}

export async function listWorkspaceRootGrants(project: Pick<WorkspaceProject, "id" | "path">) {
  return invoke<WorkspaceRootGrant[]>("workspace_root_grants_list", commandArgs(project));
}

export async function applyWorkspaceRootGrants(
  project: Pick<WorkspaceProject, "id" | "path">,
  grants: readonly WorkspaceRootGrantDraft[],
) {
  return invoke<WorkspaceRootGrant[]>("workspace_root_grants_apply", {
    ...commandArgs(project),
    grants,
  });
}

export type WorkspaceRootScope = "project" | "repository" | "global";

/** A root in force for one turn after layering project/repository/global grants. */
export type ResolvedWorkspaceRoot = {
  id: string;
  alias: string;
  canonicalPath: string;
  access: WorkspaceRootAccess;
  scope: WorkspaceRootScope;
};

export async function resolveWorkspaceRootGrants(
  workdir: string,
  project?: Pick<WorkspaceProject, "id" | "path">,
) {
  return invoke<ResolvedWorkspaceRoot[]>("workspace_root_grants_resolve", {
    workdir,
    projectId: project?.id ?? null,
    projectPath: project?.path ?? null,
  });
}

/** Repository grants are shared by a repository and all of its worktrees. */
export async function listScopedWorkspaceRootGrants(
  scope: Exclude<WorkspaceRootScope, "project">,
  workdir: string,
) {
  return invoke<WorkspaceRootGrant[]>("workspace_root_grants_list_scoped", { scope, workdir });
}

export async function applyScopedWorkspaceRootGrants(
  scope: Exclude<WorkspaceRootScope, "project">,
  workdir: string,
  grants: readonly WorkspaceRootGrantDraft[],
) {
  return invoke<WorkspaceRootGrant[]>("workspace_root_grants_apply_scoped", {
    scope,
    workdir,
    grants,
  });
}

export async function revokeWorkspaceRootGrants(project: Pick<WorkspaceProject, "id">) {
  await invoke("workspace_root_grants_revoke", {
    projectId: project.id,
  });
}
