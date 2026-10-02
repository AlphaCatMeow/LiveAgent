import { invoke } from "@liveagent/app/shims/tauriCore";
import { normalizeSidebarShortcuts } from "@liveagent/ui/lib/settings/sidebarShortcuts";
import {
  buildGatewaySettingsSyncPayload,
  buildGatewaySettingsSyncUpdatePayload,
} from "@liveagent/ui/lib/settings/sync";
import { type Locale, normalizeLocale } from "../../i18n/config";
import { isKBrainBackendEnabled, isKBrainBrowserHost } from "../host";
import { createKBrainClient } from "../kbrain/client";
import { fromKBrainMcpSettings, toKBrainMcpSettings } from "../kbrain/mcp";
import { createKBrainPromptClient, type KBrainPromptSnapshot } from "../kbrain/prompts";
import {
  appProvidersFromKBrain,
  kBrainSettingsUpdateFromAppSettings,
  kBrainSettingsUpdateFromLegacyProviders,
  loadKBrainProviderSettings,
  saveKBrainProviderSettings,
} from "../kbrain/providerSettings";
import { SettingsStorageError, type SettingsStorageErrorCode } from "./errors";
import {
  type AppSettings,
  type ChatRuntimeControls,
  type CloseWindowBehavior,
  type CustomProvider,
  getDefaultSettings,
  normalizeChatRuntimeControls,
  normalizeChatTranscriptSettings,
  normalizeCloseWindowBehavior,
  normalizeCustomProvider,
  normalizeFontFamily,
  normalizeFontScaleSettings,
  normalizeRightDockSettings,
  normalizeSelectedModel,
  normalizeSettings,
  normalizeSkillsSettings,
  normalizeTheme,
  normalizeUpdateSettings,
  resolveWorkspaceProjects,
  type SelectedModel,
  type SkillsSettings,
  type Theme,
  workspaceProjectPathKey,
} from "./index";

const LOCAL_UI_SETTINGS_STORAGE_KEY = "liveagent.ui-settings.v1";
const BROWSER_SETTINGS_STORAGE_KEY = "liveagent.kbrain-browser-settings.v1";

type PersistedSettingsResponse = {
  providers?: unknown | null;
  system?: unknown | null;
  mcp?: unknown | null;
  agents?: unknown | null;
  ssh?: unknown | null;
  remote?: unknown | null;
  stt?: unknown | null;
  memory?: unknown | null;
  modelFailover?: unknown | null;
  defaultWorkdir?: unknown | null;
};

type LocalUiSettings = {
  skills?: unknown;
  chatRuntimeControls?: unknown;
  customSettings?: unknown;
  updates?: unknown;
  selectedModel?: unknown;
  modelFailover?: unknown;
  retryErrorSettings?: unknown;
  theme?: unknown;
  locale?: unknown;
  closeWindowBehavior?: unknown;
};

export type SettingsSaveState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "saved" }
  | { status: "error"; message: string };

type SshPatchApplyResponse = {
  ssh?: unknown;
  conflict?: "settings_changed" | null;
};

export type PersistSettingsResult = {
  customProviders?: AppSettings["customProviders"];
  ssh?: AppSettings["ssh"];
  stt?: AppSettings["stt"];
  conflict?: "ssh_settings_changed";
};

async function invokeSettingsCommand<T>(
  code: SettingsStorageErrorCode,
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw new SettingsStorageError(code, error);
  }
}

function readLocalUiSettings(): {
  skills: SkillsSettings;
  chatRuntimeControls: ChatRuntimeControls;
  customSettings: AppSettings["customSettings"];
  updates: AppSettings["updates"];
  selectedModel?: SelectedModel;
  /**
   * Legacy localStorage copy, read only as a migration fallback for installs
   * that saved failover config before it moved to SQLite. Queue entries are
   * validated against customProviders (loaded from the backend), so
   * normalization has to happen inside normalizeSettings — normalizing here
   * with no providers would drop the whole queue.
   */
  modelFailover: unknown;
  /**
   * Retry-error config is a local UI preference (not gateway-synced), so it
   * lives in localStorage like chatRuntimeControls. Read raw; normalizeSettings
   * validates preset codes and de-dupes custom patterns.
   */
  retryErrorSettings: unknown;
  theme: Theme;
  locale: Locale;
  closeWindowBehavior: CloseWindowBehavior;
} {
  const defaults = getDefaultSettings();

  function normalizeLocalCustomSettings(input: unknown): AppSettings["customSettings"] {
    const obj = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
    const chatSidebar = (
      obj.chatSidebar && typeof obj.chatSidebar === "object" ? obj.chatSidebar : {}
    ) as Record<string, unknown>;
    return {
      conversationTitleModel: normalizeSelectedModel(obj.conversationTitleModel),
      commitMessageModel: normalizeSelectedModel(obj.commitMessageModel),
      // 与 normalizeCustomSettings 同口径（供应商校验留给 normalizeSettings，
      // 这里无 providers 上下文）：缺省开启，模型未选即跟随当前对话模型。
      promptClarifyEnabled: obj.promptClarifyEnabled !== false,
      promptClarifyModel: normalizeSelectedModel(obj.promptClarifyModel),
      chatSidebar: {
        projectsCollapsed: chatSidebar.projectsCollapsed === true,
        recentCollapsed: chatSidebar.recentCollapsed === true,
      },
      sidebarShortcuts: normalizeSidebarShortcuts(obj.sidebarShortcuts),
      chatTranscript: normalizeChatTranscriptSettings(obj.chatTranscript),
      rightDock: normalizeRightDockSettings(obj.rightDock),
      // 三档枚举（与 normalizeCustomSettings 同口径）：脏值/缺省落回统计状态栏。
      composerContextDisplay:
        obj.composerContextDisplay === "ring" || obj.composerContextDisplay === "both"
          ? obj.composerContextDisplay
          : "statsBar",
      // fontFamily was the single pre-split preference. Read it only to migrate
      // old local settings into the interface-specific field.
      interfaceFontFamily: normalizeFontFamily(obj.interfaceFontFamily ?? obj.fontFamily),
      chatFontFamily: normalizeFontFamily(obj.chatFontFamily),
      codeFontFamily: normalizeFontFamily(obj.codeFontFamily),
      fontScale: normalizeFontScaleSettings(obj.fontScale),
    };
  }

  try {
    const raw = localStorage.getItem(LOCAL_UI_SETTINGS_STORAGE_KEY);
    if (!raw) {
      return {
        skills: defaults.skills,
        chatRuntimeControls: defaults.chatRuntimeControls,
        customSettings: defaults.customSettings,
        updates: defaults.updates,
        selectedModel: defaults.selectedModel,
        modelFailover: defaults.modelFailover,
        retryErrorSettings: defaults.retryErrorSettings,
        theme: defaults.theme,
        locale: defaults.locale,
        closeWindowBehavior: defaults.closeWindowBehavior,
      };
    }

    const parsed = JSON.parse(raw) as LocalUiSettings | null;
    const hasStoredLocale =
      parsed !== null && typeof parsed === "object" && Object.hasOwn(parsed, "locale");
    return {
      skills: normalizeSkillsSettings(parsed?.skills ?? defaults.skills),
      chatRuntimeControls: normalizeChatRuntimeControls(
        parsed?.chatRuntimeControls ?? defaults.chatRuntimeControls,
      ),
      customSettings: normalizeLocalCustomSettings(
        parsed?.customSettings ?? defaults.customSettings,
      ),
      updates: normalizeUpdateSettings(parsed?.updates ?? defaults.updates),
      selectedModel: normalizeSelectedModel(parsed?.selectedModel),
      modelFailover: parsed?.modelFailover ?? defaults.modelFailover,
      retryErrorSettings: parsed?.retryErrorSettings ?? defaults.retryErrorSettings,
      theme: normalizeTheme(parsed?.theme ?? defaults.theme),
      locale: normalizeLocale(hasStoredLocale ? parsed?.locale : defaults.locale),
      closeWindowBehavior: normalizeCloseWindowBehavior(
        parsed?.closeWindowBehavior ?? defaults.closeWindowBehavior,
      ),
    };
  } catch {
    return {
      skills: defaults.skills,
      chatRuntimeControls: defaults.chatRuntimeControls,
      customSettings: defaults.customSettings,
      updates: defaults.updates,
      selectedModel: defaults.selectedModel,
      modelFailover: defaults.modelFailover,
      retryErrorSettings: defaults.retryErrorSettings,
      theme: defaults.theme,
      locale: defaults.locale,
      closeWindowBehavior: defaults.closeWindowBehavior,
    };
  }
}

function writeLocalUiSettings(
  settings: Pick<
    AppSettings,
    | "skills"
    | "chatRuntimeControls"
    | "customSettings"
    | "updates"
    | "selectedModel"
    | "theme"
    | "locale"
    | "closeWindowBehavior"
    | "retryErrorSettings"
  >,
) {
  const payload = {
    skills: settings.skills,
    chatRuntimeControls: settings.chatRuntimeControls,
    customSettings: settings.customSettings,
    updates: settings.updates,
    selectedModel: settings.selectedModel,
    theme: settings.theme,
    locale: settings.locale,
    closeWindowBehavior: settings.closeWindowBehavior,
    retryErrorSettings: settings.retryErrorSettings,
  };
  localStorage.setItem(LOCAL_UI_SETTINGS_STORAGE_KEY, JSON.stringify(payload));
}

function stableStringify(value: unknown) {
  return JSON.stringify(value);
}

function hasChanged(prev: unknown, next: unknown) {
  return stableStringify(prev) !== stableStringify(next);
}

function normalizeDefaultWorkdir(input: unknown): string {
  return typeof input === "string" ? input.trim() : "";
}

function settingsObject(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
}

function readLegacyBrowserSnapshot(): Record<string, unknown> {
  try {
    const browserRaw = localStorage.getItem(BROWSER_SETTINGS_STORAGE_KEY);
    const localRaw = localStorage.getItem(LOCAL_UI_SETTINGS_STORAGE_KEY);
    return {
      ...settingsObject(localRaw ? JSON.parse(localRaw) : undefined),
      ...settingsObject(browserRaw ? JSON.parse(browserRaw) : undefined),
    };
  } catch {
    return {};
  }
}

function normalizeLegacyProviders(input: unknown): AppSettings["customProviders"] {
  if (!Array.isArray(input)) return [];
  return input
    .map((provider) => normalizeCustomProvider(provider))
    .filter((provider) => provider.id.trim().length > 0);
}

function browserUiSettings(input: unknown) {
  const raw = settingsObject(input);
  const system = settingsObject(raw.system);
  const custom = settingsObject(raw.customSettings);
  const dock = settingsObject(custom.rightDock);
  const controls = settingsObject(raw.chatRuntimeControls);
  // Project dock state is an open-ended bag; runtime prompts and proxy settings
  // also belong to the backend, not this browser's presentation preferences.
  const normalized = normalizeSettings({
    customProviders: [],
    system: {
      executionMode: system.executionMode,
      workdir: system.workdir,
    } as AppSettings["system"],
    customSettings: {
      chatSidebar: custom.chatSidebar,
      sidebarShortcuts: custom.sidebarShortcuts,
      chatTranscript: custom.chatTranscript,
      rightDock: { width: dock.width },
      composerContextDisplay: custom.composerContextDisplay,
      interfaceFontFamily: custom.interfaceFontFamily ?? custom.fontFamily,
      chatFontFamily: custom.chatFontFamily,
      codeFontFamily: custom.codeFontFamily,
      fontScale: custom.fontScale,
      promptClarifyEnabled: custom.promptClarifyEnabled,
    } as AppSettings["customSettings"],
    chatRuntimeControls: {
      thinkingEnabled: controls.thinkingEnabled,
      reasoning: controls.reasoning,
      nativeWebSearchEnabled: controls.nativeWebSearchEnabled,
      planModeEnabled: controls.planModeEnabled,
    } as ChatRuntimeControls,
    theme: raw.theme as Theme,
    locale: (raw.locale ?? getDefaultSettings().locale) as Locale,
  });
  return {
    system: {
      executionMode: normalized.system.executionMode,
      workdir: normalized.system.workdir,
    },
    customSettings: normalized.customSettings,
    chatRuntimeControls: normalized.chatRuntimeControls,
    theme: normalized.theme,
    locale: normalized.locale,
  };
}

function readBrowserPersistedSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(BROWSER_SETTINGS_STORAGE_KEY);
    const readObject = (value: string | null) => {
      try {
        return settingsObject(value ? JSON.parse(value) : undefined);
      } catch {
        return {};
      }
    };
    const browser = readObject(raw);
    // Import only presentation fields from the old shared UI key. Never write
    // that key: it may still be used by direct/native settings on this origin.
    const legacyUi = readObject(localStorage.getItem(LOCAL_UI_SETTINGS_STORAGE_KEY));
    const safe = browserUiSettings({ ...legacyUi, ...browser });
    localStorage.setItem(BROWSER_SETTINGS_STORAGE_KEY, JSON.stringify(safe));
    return normalizeSettings({
      ...safe,
      system: { ...getDefaultSettings().system, ...safe.system },
      customProviders: [],
    });
  } catch (error) {
    throw new SettingsStorageError("load_failed", error);
  }
}

function writeBrowserPersistedSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(BROWSER_SETTINGS_STORAGE_KEY, JSON.stringify(browserUiSettings(settings)));
  } catch (error) {
    throw new SettingsStorageError("save_failed", error);
  }
}

function systemForNativePersistence(system: AppSettings["system"]): AppSettings["system"] {
  if (isKBrainBackendEnabled()) {
    const workspaceResourceSettings = Object.fromEntries(
      Object.entries(system.workspaceResourceSettings).map(([path, entry]) => {
        const {
          projectPrompt: _projectPrompt,
          projectPromptStrategy: _projectPromptStrategy,
          ...nativeEntry
        } = entry;
        return [path, nativeEntry];
      }),
    ) as AppSettings["system"]["workspaceResourceSettings"];
    return { ...system, workspaceResourceSettings };
  }
  return system;
}

function promptTemplatesFromKBrain(snapshot: KBrainPromptSnapshot): AppSettings["agents"] {
  return (Array.isArray(snapshot.globalTemplates) ? snapshot.globalTemplates : []).map(
    (template) => ({
      id: template.id,
      name: template.name,
      description: template.description ?? "",
      prompt: template.prompt,
      enabled: template.enabled === true,
    }),
  );
}

async function loadKBrainPromptSettings(
  workdirs: string[],
): Promise<{ agents: AppSettings["agents"]; projects: Record<string, unknown> }> {
  const client = createKBrainPromptClient();
  const global = await client.get();
  const projects: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(global.projectPrompts ?? {})) {
    const project = value ?? {};
    const path =
      typeof project.workdir === "string" && project.workdir.trim() ? project.workdir : key;
    projects[workspaceProjectPathKey(path)] = {
      projectPrompt: typeof project.prompt === "string" ? project.prompt : "",
      projectPromptStrategy: project.strategy === "replace" ? "replace" : "append",
    };
  }
  for (const workdir of [...new Set(workdirs.map((value) => value.trim()).filter(Boolean))]) {
    const key = workspaceProjectPathKey(workdir);
    if (projects[key]) continue;
    try {
      const snapshot = await client.get(workdir);
      projects[key] = {
        projectPrompt: snapshot.projectPrompt,
        projectPromptStrategy: snapshot.projectPromptStrategy,
      };
    } catch (error) {
      if ((error as { status?: number }).status !== 400) throw error;
    }
  }
  return { agents: promptTemplatesFromKBrain(global), projects };
}

function applyKBrainProjectPrompts(
  system: AppSettings["system"],
  projects: Record<string, unknown>,
): AppSettings["system"] {
  const workspaceResourceSettings: AppSettings["system"]["workspaceResourceSettings"] =
    Object.fromEntries(
      Object.entries(system.workspaceResourceSettings).map(([path, entry]) => [
        workspaceProjectPathKey(path),
        { ...entry, projectPrompt: "", projectPromptStrategy: "append" as const },
      ]),
    );
  for (const [path, value] of Object.entries(projects)) {
    const workdir = workspaceProjectPathKey(path);
    const current = workspaceResourceSettings[workdir];
    const prompt =
      value && typeof value === "object"
        ? (value as { projectPrompt?: unknown; projectPromptStrategy?: unknown })
        : {};
    workspaceResourceSettings[workdir] = {
      ...current,
      projectPrompt: typeof prompt.projectPrompt === "string" ? prompt.projectPrompt : "",
      projectPromptStrategy: prompt.projectPromptStrategy === "replace" ? "replace" : "append",
    } as AppSettings["system"]["workspaceResourceSettings"][string];
  }
  return { ...system, workspaceResourceSettings };
}

function applyDefaultWorkdirToSystem(system: unknown, defaultWorkdir: string): unknown {
  if (!defaultWorkdir) return system;
  const obj =
    system && typeof system === "object" && !Array.isArray(system)
      ? { ...(system as Record<string, unknown>) }
      : {};
  const workdir = typeof obj.workdir === "string" ? obj.workdir.trim() : "";
  if (!workdir) {
    obj.workdir = defaultWorkdir;
  }
  return obj;
}

export type PersistedSettingsLoadResult = {
  settings: AppSettings;
  defaultWorkdir: string;
};

async function loadAndMaybeImportKBrainProviders(
  legacyProviders: readonly CustomProvider[],
  legacySelectedModel?: AppSettings["selectedModel"],
) {
  const backend = await loadKBrainProviderSettings();
  const backendProviders = appProvidersFromKBrain(backend);
  const backendIds = new Set(backendProviders.map((provider) => provider.id));
  const missingLegacyProviders = legacyProviders.filter((provider) => !backendIds.has(provider.id));
  if (missingLegacyProviders.length === 0) {
    return { document: backend, providers: backendProviders };
  }
  const mergedProviders = [...backendProviders, ...missingLegacyProviders];
  const backendSelectedModel =
    backend.defaultProvider && backend.defaultModel
      ? { customProviderId: backend.defaultProvider, model: backend.defaultModel }
      : legacySelectedModel;
  const imported = await saveKBrainProviderSettings(
    kBrainSettingsUpdateFromLegacyProviders(
      backendProviders,
      mergedProviders,
      backendSelectedModel,
    ),
  );
  return { document: imported, providers: appProvidersFromKBrain(imported) };
}

export async function loadPersistedSettingsWithDefaults(): Promise<PersistedSettingsLoadResult> {
  const defaults = getDefaultSettings();
  let kbrainSettings: Awaited<ReturnType<typeof loadAndMaybeImportKBrainProviders>>;
  try {
    const legacyBrowser = isKBrainBrowserHost() ? readLegacyBrowserSnapshot() : {};
    const legacyNative = isKBrainBrowserHost()
      ? []
      : normalizeLegacyProviders(
          (
            await invokeSettingsCommand<PersistedSettingsResponse>(
              "load_failed",
              "settings_load_all",
            )
          )?.providers,
        );
    const legacyProviders =
      legacyNative.length > 0 ? legacyNative : normalizeLegacyProviders(legacyBrowser.providers);
    const legacySelectedModel = normalizeSelectedModel(
      isKBrainBrowserHost() ? legacyBrowser.selectedModel : undefined,
    );
    kbrainSettings = await loadAndMaybeImportKBrainProviders(legacyProviders, legacySelectedModel);
  } catch (error) {
    throw new SettingsStorageError("load_failed", error);
  }
  const customProviders = kbrainSettings.providers;
  const selectedModel =
    kbrainSettings.document.defaultProvider && kbrainSettings.document.defaultModel
      ? {
          customProviderId: kbrainSettings.document.defaultProvider,
          model: kbrainSettings.document.defaultModel,
        }
      : undefined;
  if (isKBrainBrowserHost()) {
    const local = readBrowserPersistedSettings();
    let promptSettings: { agents: AppSettings["agents"]; projects: Record<string, unknown> };
    try {
      promptSettings = await loadKBrainPromptSettings([local.system.workdir]);
    } catch (error) {
      throw new SettingsStorageError("load_failed", error);
    }
    const browserSettings = normalizeSettings({
      ...local,
      customProviders,
      selectedModel,
      agents: promptSettings.agents,
      system: applyKBrainProjectPrompts(local.system, promptSettings.projects),
    });
    return {
      settings: await loadKBrainMcpSettings(browserSettings),
      defaultWorkdir: "",
    };
  }
  const localUi = readLocalUiSettings();
  const persisted = await invokeSettingsCommand<PersistedSettingsResponse>(
    "load_failed",
    "settings_load_all",
  );
  const defaultWorkdir = normalizeDefaultWorkdir(persisted?.defaultWorkdir);

  let settings = normalizeSettings({
    system: applyDefaultWorkdirToSystem(
      persisted?.system ?? defaults.system,
      defaultWorkdir,
    ) as AppSettings["system"],
    // K-brain is authoritative for provider records on both browser and native hosts.
    customProviders,
    mcp: (persisted?.mcp ?? defaults.mcp) as AppSettings["mcp"],
    agents: (persisted?.agents ?? defaults.agents) as AppSettings["agents"],
    ssh: (persisted?.ssh ?? defaults.ssh) as AppSettings["ssh"],
    remote: (persisted?.remote ?? defaults.remote) as AppSettings["remote"],
    stt: (persisted?.stt ?? defaults.stt) as AppSettings["stt"],
    memory: (persisted?.memory ?? defaults.memory) as AppSettings["memory"],
    skills: localUi.skills,
    chatRuntimeControls: localUi.chatRuntimeControls,
    customSettings: localUi.customSettings,
    updates: localUi.updates,
    selectedModel,
    // SQLite is the source of truth (shared with the WebUI via gateway sync);
    // the localStorage copy only migrates pre-SQLite installs forward.
    modelFailover: (persisted?.modelFailover ??
      localUi.modelFailover) as AppSettings["modelFailover"],
    retryErrorSettings: localUi.retryErrorSettings as AppSettings["retryErrorSettings"],
    theme: localUi.theme,
    locale: localUi.locale,
    closeWindowBehavior: localUi.closeWindowBehavior,
  });

  if (isKBrainBackendEnabled()) {
    try {
      const workdirs = [
        settings.system.workdir,
        ...settings.system.workspaceProjects.map((project) => project.path),
      ];
      const promptSettings = await loadKBrainPromptSettings(workdirs);
      settings = normalizeSettings({
        ...settings,
        agents: promptSettings.agents,
        system: applyKBrainProjectPrompts(settings.system, promptSettings.projects),
      });
    } catch (error) {
      throw new SettingsStorageError("load_failed", error);
    }
  }

  settings = await loadKBrainMcpSettings(settings);
  return {
    settings: {
      ...settings,
      system: resolveWorkspaceProjects(settings.system, defaultWorkdir),
    },
    defaultWorkdir,
  };
}

export async function loadPersistedSettings(): Promise<AppSettings> {
  return (await loadPersistedSettingsWithDefaults()).settings;
}

let failedProviderSave: AppSettings | undefined;

function projectPromptFields(settings: AppSettings, path: string) {
  const entry = settings.system.workspaceResourceSettings[path];
  return {
    prompt: entry?.projectPrompt ?? "",
    strategy: entry?.projectPromptStrategy ?? "append",
  } as const;
}

async function loadKBrainMcpSettings(settings: AppSettings): Promise<AppSettings> {
  if (!isKBrainBackendEnabled()) return settings;
  try {
    const document = await createKBrainClient().getMcpSettings();
    return normalizeSettings({
      ...settings,
      mcp: fromKBrainMcpSettings(document, settings.mcp),
    });
  } catch (error) {
    throw new SettingsStorageError("load_failed", error);
  }
}

async function persistKBrainPrompts(prev: AppSettings, next: AppSettings): Promise<void> {
  const client = createKBrainPromptClient();
  if (hasChanged(prev.agents, next.agents)) {
    await client.replaceTemplates(next.agents);
  }
  const paths = new Set([
    ...Object.keys(prev.system.workspaceResourceSettings),
    ...Object.keys(next.system.workspaceResourceSettings),
  ]);
  for (const path of paths) {
    const before = projectPromptFields(prev, path);
    const after = projectPromptFields(next, path);
    if (!hasChanged(before, after)) continue;
    await client.setProject(path, after.prompt, after.strategy);
  }
}

export async function persistSettings(
  prev: AppSettings,
  next: AppSettings,
): Promise<PersistSettingsResult> {
  const tasks: Promise<unknown>[] = [];
  const result: PersistSettingsResult = {};
  const providersChanged =
    hasChanged(prev.customProviders, next.customProviders) ||
    hasChanged(prev.selectedModel ?? null, next.selectedModel ?? null);
  if (providersChanged || failedProviderSave) {
    const baseline = failedProviderSave ?? prev;
    try {
      const document = await saveKBrainProviderSettings(
        kBrainSettingsUpdateFromAppSettings(baseline, next),
      );
      result.customProviders = appProvidersFromKBrain(document);
      failedProviderSave = undefined;
    } catch (error) {
      failedProviderSave = baseline;
      throw new SettingsStorageError("save_failed", error);
    }
  }

  if (
    isKBrainBackendEnabled() &&
    (hasChanged(prev.agents, next.agents) ||
      hasChanged(prev.system.workspaceResourceSettings, next.system.workspaceResourceSettings))
  ) {
    tasks.push(
      persistKBrainPrompts(prev, next).catch((error) => {
        throw new SettingsStorageError("save_failed", error);
      }),
    );
  }

  if (isKBrainBackendEnabled() && hasChanged(prev.mcp, next.mcp)) {
    tasks.push(
      createKBrainClient()
        .updateMcpSettings(toKBrainMcpSettings(next.mcp))
        .catch((error) => {
          throw new SettingsStorageError("save_failed", error);
        }),
    );
  }

  if (isKBrainBrowserHost()) {
    writeBrowserPersistedSettings(next);
    await Promise.all(tasks);
    return result;
  }

  if (
    hasChanged(systemForNativePersistence(prev.system), systemForNativePersistence(next.system))
  ) {
    tasks.push(
      invokeSettingsCommand("save_failed", "settings_save_system", {
        payload: systemForNativePersistence(next.system),
      }),
    );
  }

  if (!isKBrainBackendEnabled() && hasChanged(prev.mcp, next.mcp)) {
    tasks.push(
      invokeSettingsCommand("save_failed", "settings_save_mcp", {
        payload: next.mcp,
      }),
    );
  }

  if (!isKBrainBackendEnabled() && hasChanged(prev.agents, next.agents)) {
    tasks.push(
      invokeSettingsCommand("save_failed", "settings_save_agents", {
        payload: next.agents,
      }),
    );
  }

  if (hasChanged(prev.ssh, next.ssh)) {
    const update = buildGatewaySettingsSyncUpdatePayload(prev, next, {
      includeProviderApiKeyUpdates: true,
    });
    tasks.push(
      invokeSettingsCommand<SshPatchApplyResponse>("save_failed", "settings_apply_ssh_patch", {
        payload: {
          sshPatch: update.sshPatch ?? {},
          sshSecretUpdates: update.sshSecretUpdates,
        },
      }).then((response) => {
        if (response?.ssh) {
          result.ssh = normalizeSettings({ ssh: response.ssh as AppSettings["ssh"] }).ssh;
        }
        if (response?.conflict) {
          result.conflict = "ssh_settings_changed";
        }
      }),
    );
  }

  if (hasChanged(prev.remote, next.remote)) {
    tasks.push(
      invokeSettingsCommand("save_failed", "settings_save_remote", {
        payload: next.remote,
      }),
    );
  }

  if (hasChanged(prev.memory, next.memory)) {
    tasks.push(
      invokeSettingsCommand("save_failed", "settings_save_memory", {
        payload: next.memory,
      }),
    );
  }

  if (hasChanged(prev.modelFailover, next.modelFailover)) {
    tasks.push(
      invokeSettingsCommand("save_failed", "settings_save_model_failover", {
        payload: next.modelFailover,
      }),
    );
  }

  if (hasChanged(prev.stt, next.stt)) {
    tasks.push(
      invoke<unknown>("settings_save_stt", { payload: next.stt }).then((response) => {
        if (response) {
          result.stt = normalizeSettings({ stt: response as AppSettings["stt"] }).stt;
        }
      }),
    );
  }

  if (
    hasChanged(prev.skills, next.skills) ||
    hasChanged(prev.chatRuntimeControls, next.chatRuntimeControls) ||
    hasChanged(prev.customSettings, next.customSettings) ||
    hasChanged(prev.updates, next.updates) ||
    hasChanged(prev.selectedModel ?? null, next.selectedModel ?? null) ||
    hasChanged(prev.theme, next.theme) ||
    hasChanged(prev.locale, next.locale) ||
    hasChanged(prev.closeWindowBehavior, next.closeWindowBehavior) ||
    hasChanged(prev.retryErrorSettings, next.retryErrorSettings)
  ) {
    writeLocalUiSettings({
      skills: next.skills,
      chatRuntimeControls: next.chatRuntimeControls,
      customSettings: next.customSettings,
      updates: next.updates,
      selectedModel: next.selectedModel,
      theme: next.theme,
      locale: next.locale,
      closeWindowBehavior: next.closeWindowBehavior,
      retryErrorSettings: next.retryErrorSettings,
    });
  }

  // 自动同步的标脏完全由后端完成：快照六域全部落 SQLite，各域的 save_*
  // 在 tx.commit() 之后自行标脏，前端无需（也不应）参与。
  await Promise.all(tasks);

  return result;
}

export async function publishGatewaySettingsSync(settings: AppSettings): Promise<void> {
  if (isKBrainBrowserHost()) return;
  await invokeSettingsCommand("gateway_sync_failed", "gateway_publish_settings_sync", {
    payload: buildGatewaySettingsSyncPayload(settings),
  });
}
