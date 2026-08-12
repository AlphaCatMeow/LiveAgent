import type { WorkspaceProjectRemoveOptions } from "@liveagent/ui/components/chat/ChatHistorySidebar";
import type { ConfirmDialogOptions } from "@liveagent/ui/components/ui/confirm-dialog";
import type { SidebarStore } from "@liveagent/ui/lib/sidebar/store";
import { terminalSessionBelongsToProject } from "@liveagent/ui/lib/terminal/sessionStore";
import type { TerminalSession } from "@liveagent/ui/lib/terminal/types";
import { removeWorkspaceProjectFromGroups } from "@liveagent/ui/lib/workspaceProjects";
import { type Dispatch, type MutableRefObject, type SetStateAction, useCallback } from "react";
import { Terminal } from "../../../components/icons";
import { tauriGitClient } from "../../../lib/git/tauriGitClient";
import {
  type AppSettings,
  DEFAULT_WORKSPACE_PROJECT_ID,
  removeRightDockProjectState,
  resetWorkspaceResourceSettings,
  resolveWorkspaceProjects,
  type WorkspaceProject,
  workspaceProjectPathKey,
} from "../../../lib/settings";
import { tauriTerminalClient } from "../../../lib/terminal/tauriTerminalClient";
import { asErrorMessage } from "../chatPageUtils";
import { getDefaultWorkspaceProjectPath } from "./workspaceProjectsModel";

type UseWorkspaceProjectRemovalParams = {
  settings: AppSettings;
  setSettings: (updater: (prev: AppSettings) => AppSettings) => void;
  t: (key: string) => string;
  requestConfirmDialog: (options: ConfirmDialogOptions) => Promise<boolean>;
  setErrorMessage: Dispatch<SetStateAction<string | null>>;
  sidebarStore: SidebarStore;
  workspaceProjects: WorkspaceProject[];
  archivedWorkspaceProjectPathKeys: Set<string>;
  activeWorkspaceProject: WorkspaceProject | undefined;
  activateWorkspaceProject: (
    project: WorkspaceProject,
    options?: { startConversation?: boolean },
  ) => void;
  setActiveWorkspaceProjectId: Dispatch<SetStateAction<string>>;
  setProjectRenamingId: Dispatch<SetStateAction<string | null>>;
  setProjectRenameDraft: Dispatch<SetStateAction<string>>;
  terminalProjectPathKey: string;
  setTerminalSessions: Dispatch<SetStateAction<TerminalSession[]>>;
  setRightDockOpen: Dispatch<SetStateAction<boolean>>;
  displayedConversationWorkdir: string;
  startNewConversationActionRef: MutableRefObject<(options?: { workdir?: string }) => void>;
};

/**
 * Workspace-project lifecycle actions. Removing an entry only updates settings;
 * deleting a registered Worktree additionally invokes Git and closes terminals
 * that would otherwise keep using the deleted directory.
 */
export function useWorkspaceProjectRemoval(params: UseWorkspaceProjectRemovalParams) {
  const {
    settings,
    setSettings,
    t,
    requestConfirmDialog,
    setErrorMessage,
    sidebarStore,
    workspaceProjects,
    archivedWorkspaceProjectPathKeys,
    activeWorkspaceProject,
    activateWorkspaceProject,
    setActiveWorkspaceProjectId,
    setProjectRenamingId,
    setProjectRenameDraft,
    terminalProjectPathKey,
    setTerminalSessions,
    setRightDockOpen,
    displayedConversationWorkdir,
    startNewConversationActionRef,
  } = params;

  const removeWorkspaceProjectFromSettings = useCallback(
    (project: WorkspaceProject) => {
      if (project.id === DEFAULT_WORKSPACE_PROJECT_ID) return;
      const path = project.path.trim();
      const pathKey = workspaceProjectPathKey(path);
      // Removing the last non-archived workspace would leave nothing usable;
      // the default project is unarchived alongside in that case. The merged
      // list (settings + history workdirs) is the authority on what remains.
      const hasOtherActiveProjects = workspaceProjects.some(
        (item) =>
          item.id !== project.id &&
          workspaceProjectPathKey(item.path) !== pathKey &&
          !archivedWorkspaceProjectPathKeys.has(workspaceProjectPathKey(item.path)),
      );
      setActiveWorkspaceProjectId((current) => {
        const currentProject = workspaceProjects.find((item) => item.id === current);
        if (
          current === project.id ||
          (pathKey && currentProject && workspaceProjectPathKey(currentProject.path) === pathKey)
        ) {
          return DEFAULT_WORKSPACE_PROJECT_ID;
        }
        return current;
      });
      setSettings((prev) => {
        const nextHidden =
          pathKey &&
          prev.system.hiddenWorkspaceProjectPaths.some(
            (item) => workspaceProjectPathKey(item) === pathKey,
          )
            ? prev.system.hiddenWorkspaceProjectPaths
            : path
              ? [...prev.system.hiddenWorkspaceProjectPaths, path]
              : prev.system.hiddenWorkspaceProjectPaths;
        const nextSettings = {
          ...prev,
          system: resolveWorkspaceProjects(
            {
              ...prev.system,
              workspaceProjects: prev.system.workspaceProjects.filter(
                (item) => item.id !== project.id && workspaceProjectPathKey(item.path) !== pathKey,
              ),
              workspaceProjectGroups: removeWorkspaceProjectFromGroups(
                prev.system.workspaceProjectGroups,
                path,
              ),
              hiddenWorkspaceProjectPaths: nextHidden,
              missingWorkspaceProjectPaths: prev.system.missingWorkspaceProjectPaths.filter(
                (item) => workspaceProjectPathKey(item) !== pathKey,
              ),
              archivedWorkspaceProjectPaths: prev.system.archivedWorkspaceProjectPaths.filter(
                (item) => {
                  const itemKey = workspaceProjectPathKey(item);
                  if (itemKey === pathKey) return false;
                  return (
                    hasOtherActiveProjects ||
                    itemKey !== workspaceProjectPathKey(getDefaultWorkspaceProjectPath(prev.system))
                  );
                },
              ),
            },
            getDefaultWorkspaceProjectPath(prev.system),
          ),
        };
        return removeRightDockProjectState(
          resetWorkspaceResourceSettings(nextSettings, pathKey),
          pathKey,
        );
      });
      setProjectRenamingId((current) => (current === project.id ? null : current));
      setProjectRenameDraft("");
    },
    [archivedWorkspaceProjectPathKeys, setSettings, workspaceProjects],
  );

  const handleRemoveWorkspaceProject = useCallback(
    (project: WorkspaceProject, options: WorkspaceProjectRemoveOptions = {}) => {
      if (project.id === DEFAULT_WORKSPACE_PROJECT_ID) return;

      const path = project.path.trim();
      const pathKey = workspaceProjectPathKey(path);
      if (pathKey && sidebarStore.getSnapshot().runningWorkdirPathKeys.has(pathKey)) {
        setErrorMessage(t("chat.workspaceRemoveRunning"));
        return;
      }

      if (options.deleteWorktree !== true) {
        setErrorMessage(null);
        removeWorkspaceProjectFromSettings(project);
        return;
      }

      void (async () => {
        const repositoryPath = project.worktree?.repositoryPath.trim() || "";
        if (!path || !pathKey || !repositoryPath) {
          setErrorMessage(t("chat.workspaceDeleteWorktreeMetadataMissing"));
          return;
        }
        // GitClient 上 removeWorktree 是可选能力；Tauri 端恒有实现，
        // 这里仅为类型收窄并兜底提示。
        const removeWorktree = tauriGitClient.removeWorktree;
        if (!removeWorktree) {
          setErrorMessage(t("chat.workspaceDeleteWorktreeUnavailable"));
          return;
        }

        setErrorMessage(null);

        try {
          const terminalSessions = await tauriTerminalClient.list(pathKey);
          const runningTerminalCount = terminalSessions.filter((session) => session.running).length;
          if (runningTerminalCount > 0) {
            const confirmed = await requestConfirmDialog({
              title: t("chat.workspaceDeleteWorktreeConfirm").replace("{name}", project.name),
              subtitle: t("chat.workspaceDeleteWorktreeDescription"),
              description: (
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300">
                    <Terminal className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-foreground">
                        {t("chat.exitConfirmRunningLabel")}
                      </span>
                      <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500/15 px-1.5 text-[calc(11px*var(--zone-font-scale,1))] font-semibold text-amber-700 dark:text-amber-300">
                        {runningTerminalCount}
                      </span>
                    </div>
                    <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
                      {t("chat.workspaceDeleteWorktreeTerminalDescription")}
                    </p>
                  </div>
                </div>
              ),
              confirmLabel: t("chat.workspaceDeleteWorktree"),
              cancelLabel: t("chat.cancel"),
              closeLabel: t("chat.workspaceDeleteWorktreeConfirmClose"),
              tone: "warning",
            });
            if (!confirmed) return;
            await tauriTerminalClient.closeProject(pathKey);
            setTerminalSessions((current) =>
              current.filter((session) => !terminalSessionBelongsToProject(session, pathKey)),
            );
          }

          const response = await removeWorktree(repositoryPath, path, {
            deleteBranch: options.deleteBranch === true,
          });
          if (!response.worktreeRemoved) {
            setErrorMessage(response.message || response.stderr || t("chat.workspaceDeleteFailed"));
            return;
          }

          if (terminalSessions.length > 0 && runningTerminalCount === 0) {
            await tauriTerminalClient.closeProject(pathKey);
            setTerminalSessions((current) =>
              current.filter((session) => !terminalSessionBelongsToProject(session, pathKey)),
            );
          }
          if (terminalProjectPathKey === pathKey) {
            setRightDockOpen(false);
            setTerminalSessions((current) =>
              current.filter((session) => !terminalSessionBelongsToProject(session, pathKey)),
            );
          }

          const shouldResetVisibleConversation =
            workspaceProjectPathKey(displayedConversationWorkdir) === pathKey;
          removeWorkspaceProjectFromSettings(project);
          if (shouldResetVisibleConversation) {
            startNewConversationActionRef.current({
              workdir: getDefaultWorkspaceProjectPath(settings.system) || undefined,
            });
          }
          if (!response.ok) {
            setErrorMessage(response.message || response.stderr || t("chat.workspaceDeleteFailed"));
          }
        } catch (error) {
          setErrorMessage(asErrorMessage(error, t("chat.workspaceDeleteFailed")));
        }
      })();
    },
    [
      displayedConversationWorkdir,
      removeWorkspaceProjectFromSettings,
      requestConfirmDialog,
      settings.system,
      sidebarStore,
      startNewConversationActionRef,
      t,
      terminalProjectPathKey,
    ],
  );

  const handleArchiveWorkspaceProject = useCallback(
    (project: WorkspaceProject) => {
      const pathKey = workspaceProjectPathKey(project.path);
      if (!pathKey || archivedWorkspaceProjectPathKeys.has(pathKey)) return;
      const fallbackProject = workspaceProjects.find(
        (item) =>
          item.id !== project.id &&
          workspaceProjectPathKey(item.path) !== pathKey &&
          !archivedWorkspaceProjectPathKeys.has(workspaceProjectPathKey(item.path)),
      );
      // Archiving is only offered while another active workspace remains.
      if (!fallbackProject) return;
      if (
        activeWorkspaceProject &&
        (activeWorkspaceProject.id === project.id ||
          workspaceProjectPathKey(activeWorkspaceProject.path) === pathKey)
      ) {
        activateWorkspaceProject(fallbackProject);
      }
      setSettings((prev) =>
        prev.system.archivedWorkspaceProjectPaths.some(
          (path) => workspaceProjectPathKey(path) === pathKey,
        )
          ? prev
          : {
              ...prev,
              system: {
                ...prev.system,
                archivedWorkspaceProjectPaths: [
                  ...prev.system.archivedWorkspaceProjectPaths,
                  project.path.trim(),
                ],
              },
            },
      );
    },
    [
      activateWorkspaceProject,
      activeWorkspaceProject,
      archivedWorkspaceProjectPathKeys,
      setSettings,
      workspaceProjects,
    ],
  );

  const handleUnarchiveWorkspaceProject = useCallback(
    (project: WorkspaceProject) => {
      const pathKey = workspaceProjectPathKey(project.path);
      if (!pathKey) return;
      setSettings((prev) => {
        const next = prev.system.archivedWorkspaceProjectPaths.filter(
          (path) => workspaceProjectPathKey(path) !== pathKey,
        );
        if (next.length === prev.system.archivedWorkspaceProjectPaths.length) {
          return prev;
        }
        return {
          ...prev,
          system: {
            ...prev.system,
            archivedWorkspaceProjectPaths: next,
          },
        };
      });
    },
    [setSettings],
  );

  return {
    removeWorkspaceProjectFromSettings,
    handleRemoveWorkspaceProject,
    handleArchiveWorkspaceProject,
    handleUnarchiveWorkspaceProject,
  };
}
