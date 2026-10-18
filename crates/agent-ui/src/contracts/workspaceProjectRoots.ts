import type { WorkspaceProject } from "@liveagent/app/lib/settings";

export type WorkspaceProjectRootAccess = "read" | "write";
export type WorkspaceProjectRootState = "active" | "missing" | "changed" | "pending-approval";

export type WorkspaceProjectRootGrant = {
  id: string;
  alias: string;
  displayPath: string;
  access: WorkspaceProjectRootAccess;
  state: WorkspaceProjectRootState;
};

export type WorkspaceProjectRootDraft = Pick<
  WorkspaceProjectRootGrant,
  "id" | "alias" | "displayPath" | "access"
>;

/**
 * Host-provided adapter for project-scoped filesystem grants. Grants remain in
 * the desktop host and are intentionally excluded from normal settings sync.
 */
export type WorkspaceProjectRootClient = {
  list: (project: WorkspaceProject) => Promise<readonly WorkspaceProjectRootGrant[]>;
  save: (
    project: WorkspaceProject,
    roots: readonly WorkspaceProjectRootDraft[],
  ) => Promise<readonly WorkspaceProjectRootGrant[]>;
  revoke: (project: Pick<WorkspaceProject, "id">) => Promise<void>;
  /**
   * Grants shared beyond one project: `repository` covers the project's git
   * repository and all of its worktrees, `global` covers every conversation.
   * Hosts without layered grants omit this and only show project grants.
   */
  scoped?: WorkspaceScopedRootClient;
};

export type WorkspaceSharedRootScope = "repository" | "global";

export type WorkspaceScopedRootClient = {
  /** Rejects for `repository` when the project is not inside a git repository. */
  list: (
    scope: WorkspaceSharedRootScope,
    project: WorkspaceProject,
  ) => Promise<readonly WorkspaceProjectRootGrant[]>;
  save: (
    scope: WorkspaceSharedRootScope,
    project: WorkspaceProject,
    roots: readonly WorkspaceProjectRootDraft[],
  ) => Promise<readonly WorkspaceProjectRootGrant[]>;
};
