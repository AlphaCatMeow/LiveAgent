import type {
  WorkspaceProjectRootClient,
  WorkspaceProjectRootDraft,
  WorkspaceProjectRootGrant,
} from "@liveagent/ui/contracts/workspaceProjectRoots";
import {
  applyScopedWorkspaceRootGrants,
  applyWorkspaceRootGrants,
  listScopedWorkspaceRootGrants,
  listWorkspaceRootGrants,
  revokeWorkspaceRootGrants,
  type WorkspaceRootGrant,
} from "../lib/workspaceRootGrants";

function toProjectRootGrant(grant: WorkspaceRootGrant): WorkspaceProjectRootGrant {
  return {
    id: grant.id,
    alias: grant.alias,
    displayPath: grant.displayPath,
    access: grant.access,
    state: grant.state,
  };
}

function toGrantDrafts(roots: readonly WorkspaceProjectRootDraft[]) {
  return roots.map((root) => ({
    id: root.id.startsWith("draft-") ? undefined : root.id,
    alias: root.alias,
    displayPath: root.displayPath,
    access: root.access,
  }));
}

export const desktopWorkspaceProjectRootClient: WorkspaceProjectRootClient = {
  list: async (project) => (await listWorkspaceRootGrants(project)).map(toProjectRootGrant),
  save: async (project, roots) =>
    (await applyWorkspaceRootGrants(project, toGrantDrafts(roots))).map(toProjectRootGrant),
  revoke: revokeWorkspaceRootGrants,
  scoped: {
    list: async (scope, project) =>
      (await listScopedWorkspaceRootGrants(scope, project.path)).map(toProjectRootGrant),
    save: async (scope, project, roots) =>
      (await applyScopedWorkspaceRootGrants(scope, project.path, toGrantDrafts(roots))).map(
        toProjectRootGrant,
      ),
  },
};
