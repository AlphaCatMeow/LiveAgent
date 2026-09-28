import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (name) => path.join(root, "src", name);
const capabilities = { frontendContext: false, gatewayMirror: false, checkpoints: false, trajectory: false };

for (const executionMode of ["agent", "chat"]) {
  test(`shipped useSendChatTurn ${executionMode} does not run a second desktop runtime`, async () => {
    const ipc = [];
    const forbidden = (name) => () => { ipc.push(name); throw new Error(`Forbidden: ${name}`); };
    let sent = false;
    const loader = createTsModuleLoader({ mocks: {
      react: { useCallback: (callback) => callback },
      [source("lib/host.ts")]: {
        liveAgentRuntimeCapabilities: () => capabilities,
        isKBrainBackendEnabled: () => true,
        isKBrainBrowserHost: () => false,
        isTauriHost: () => true,
      },
      "@tauri-apps/api/core": { invoke: forbidden("native invoke") },
      [source("lib/chat/memory/injectionController.ts")]: { memoryTurnInjection: new Proxy({}, { get: (_, name) => forbidden(`memory ${name}`) }) },
      [source("lib/memory/prompts/injection.ts")]: { buildMemoryOverviewSection: forbidden("memory overview") },
      [source("lib/trajectory/recorderRegistry.ts")]: {
        acquireTrajectoryRecorder: forbidden("trajectory recorder"),
        resolveTrajectoryTurnNumber: forbidden("trajectory number"),
      },
      [source("pages/chat/runtime/conversationTitleJob.ts")]: { startConversationTitleJob: () => null },
      [source("lib/providers/llm.ts")]: {
        createProviderRuntimeConfig: () => ({ backend: "kbrain", baseUrl: "", modelConfig: {} }),
        createModelFromConfig: () => ({ id: "model", provider: "openai", api: "openai-completions" }),
      },
    } });
    const { getDefaultSettings } = loader.loadModule("src/lib/settings/index.ts");
    const settings = getDefaultSettings();
    settings.system.executionMode = executionMode;
    settings.system.workdir = "/workspace";
    settings.remote = { ...settings.remote, enabled: true, gatewayUrl: "https://old-gateway.invalid", token: "old-token" };
    settings.skills = { ...settings.skills, enabled: true, selected: ["missing-local-skill"] };
    settings.selectedModel = { customProviderId: "backend", model: "model" };
    settings.customProviders = [{ id: "backend", type: "codex", activeModels: ["model"] }];
    const { createConversationStateFromContext } = loader.loadModule("src/lib/chat/conversation/conversationState.ts");
    const entry = { state: createConversationStateFromContext({ systemPrompt: "LOCAL PROMPT MUST NOT LEAK", messages: [] }), sessionId: "s", createdAt: 1, compactionStatus: { phase: "idle" }, isSending: false };
    const cache = new Map([["conversation", entry]]);
    const transcriptStore = { getSnapshot: () => ({ liveRounds: [], draftAssistantText: "" }) };
    const noop = () => {};
    const { useSendChatTurn } = loader.loadModule("src/pages/chat/runtime/useSendChatTurn.ts");
    const { send } = useSendChatTurn({
      settings, workspaceProjects: [{ id: "p", path: "/workspace" }], setSettings: forbidden("settings mutation"),
      getMcpSettings: forbidden("MCP settings"), getToolPolicies: forbidden("tool policies"), t: (key) => key,
      sidebarStore: { peek: () => undefined, upsertLocal: noop, removeLocal: noop }, titleJobRef: { current: null },
      chatRuntimeHost: { runTurn: async ({ params }) => {
        sent = true;
        assert.equal(params.runtime.backend, "kbrain");
        const context = params.buildPreparedContext(params.getNextConversationState());
        assert.equal(context.systemPrompt, undefined);
        assert.equal(context.tools, undefined);
        assert.equal(typeof context.messages.at(-1).content === "string" ? context.messages.at(-1).content : context.messages.at(-1).content[0].text, "hello");
        assert.equal(params.trajectory, undefined);
        assert.equal(params.memoryExtractionModel, undefined);
        if (executionMode === "agent") assert.equal(params.effectiveSkillsEnabled, false);
      } },
      subagentStoresRef: { current: { get: () => ({}) } }, scrollFollowRef: { current: null }, composerRef: { current: null },
      composerDraftCacheRef: { current: new Map() }, clearCachedComposerDraft: noop, resetVisibleTransientState: noop,
      isImportingPastedTextRef: { current: false }, setIsImportingPastedText: noop, setErrorMessage: forbidden("error message"),
      hydration: { isHydrating: () => false, isFailed: () => false }, currentConversationIdRef: { current: "conversation" },
      conversationRuntimeCacheRef: { current: cache },
      updateConversationRuntimeEntry: (id, update) => cache.set(id, update(cache.get(id))),
      setConversationAbortController: noop, getConversationStopRequestVersion: () => 0, isConversationStopRequested: () => false,
      consumeConversationStop: noop, setConversationStopHandler: noop, clearConversationStopHandler: noop, setConversationSendingState: noop,
      pendingUploadedFiles: [], getPendingUploadsForConversation: () => [], setPendingUploadsForConversation: noop,
      getConversationLiveTranscriptStore: () => transcriptStore,
      getCompactionController: () => ({ bindTurn: forbidden("compaction bind"), setObserver: forbidden("compaction observer") }),
      clearAbortSnapshot: noop, resetLiveTranscript: noop, settleLiveTranscript: noop, updateToolStatus: noop,
      queueGatewayBridgeEventForRequest: forbidden("gateway events"), flushGatewayBridgeEventsForRequest: forbidden("gateway flush"),
      registerGatewayRunMirror: forbidden("gateway register"), finishGatewayRunMirror: forbidden("gateway finish"),
      gatewayBridgeHistorySummaryRef: { current: new Map() }, availableSkills: [], skillsRootDir: "/desktop/skills",
      refreshSkills: forbidden("skills discovery"), persistConversation: async () => ({}),
      pruneIdleConversationCaches: noop, requestQueuedChatTurnProcessing: noop,
    });
    assert.equal(await send({ textOverride: "hello" }), true);
    assert.equal(sent, true);
    assert.deepEqual(ipc, []);
  });
}

test("native K-brain host rejects desktop runtime commands but retains window/file dialogs", async () => {
  const native = [];
  const host = createTsModuleLoader().loadModule("src/lib/host.ts");
  const loader = createTsModuleLoader({ mocks: {
    [source("lib/host.ts")]: { ...host, isKBrainBackendEnabled: () => true, isKBrainBrowserHost: () => false },
    "@tauri-apps/api/core": { invoke: async (command) => { native.push(command); return "native-result"; } },
  } });
  const { invoke } = loader.loadModule("src/shims/tauriCore.ts");
  for (const command of ["memory_index_overview", "system_ensure_builtin_skills", "system_manage_skill", "checkpoint_begin_turn", "checkpoint_rewind_code", "gateway_chat_mark_local_started", "hook_run_script", "chat_history_save", "subagent_upsert", "trajectory_append"]) {
    await assert.rejects(invoke(command), /unavailable in K-brain mode/);
  }
  assert.equal(await invoke("system_pick_folder"), "native-result");
  assert.equal(await invoke("window_show"), "native-result");
  assert.deepEqual(native, ["system_pick_folder", "window_show"]);
});

test("checkpoint provider exposes unsupported reason and disables backend reads", () => {
  const loader = createTsModuleLoader({ mocks: {
    react: { useCallback: (callback) => callback },
    "@liveagent/ui/i18n/index": { useLocale: () => ({ locale: "zh-CN" }) },
    [source("lib/host.ts")]: { liveAgentRuntimeCapabilities: () => capabilities },
    "@liveagent/ui/lib/chat/checkpointRewind": { CheckpointRewindProvider: "checkpoint-provider" },
  } });
  const { DesktopCheckpointRewindProvider } = loader.loadModule("src/pages/chat/components/DesktopCheckpointRewindProvider.tsx");
  const element = DesktopCheckpointRewindProvider({ conversationId: "c", children: "transcript", disabled: false });
  assert.equal(element.props.disabled, true);
  assert.match(element.props.disabledReason, /K-brain.*不支持.*检查点/);
});


test("K-brain hooks report ownership instead of executing desktop hooks, including cancellation", async () => {
  const warnings = [];
  const loader = createTsModuleLoader({ mocks: {
    [source("lib/host.ts")]: { isKBrainBackendEnabled: () => true },
    "@liveagent/app/shims/tauriCore": { invoke: () => assert.fail("desktop hook executed") },
  } });
  const { createHookRunScope } = loader.loadModule("src/lib/automation/hookRunner.ts");
  const scope = createHookRunScope({
    conversationId: "c", hooks: [{ name: "local hook", enabled: true, event: "AgentStart", type: "command", script: "false" }],
    onWarning: (warning) => warnings.push(warning),
  });
  scope.dispatch("AgentStart");
  scope.cancel();
  await Promise.resolve();
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].message, /K-brain owns hook execution/);
});

test("checkpoint action carries an explicit disabled reason to the rendered user action", () => {
  const contexts = [];
  const effects = [];
  const react = {
    createContext: (value) => { const context = { current: value, Provider: "provider" }; contexts.push(context); return context; },
    useContext: (context) => context.current,
    useCallback: (fn) => fn,
    useMemo: (fn) => fn(),
    useRef: (value) => ({ current: value }),
    useState: (value) => [value, () => {}],
    useEffect: (fn) => effects.push(fn),
  };
  const loader = createTsModuleLoader({ mocks: {
    react,
    "@liveagent/ui/components/ui/confirm-dialog": { useConfirmDialog: () => ({ confirm: assert.fail, dialog: null }) },
    "@liveagent/ui/i18n/index": { useLocale: () => ({ locale: "en", t: (key) => key }) },
  } });
  const { CheckpointRewindProvider, useCheckpointRewindAction } = loader.loadModule("@liveagent/ui/lib/chat/checkpointRewind");
  const reason = "Checkpoint rewind is not supported in K-brain mode.";
  const element = CheckpointRewindProvider({ conversationId: "c", disabledReason: reason, children: null,
    client: { list: () => assert.fail("unsupported checkpoint read") }, resolveAuthorizedRoots: assert.fail });
  effects.forEach((effect) => effect());
  contexts[0].current = element.props.value;
  const action = useCheckpointRewindAction("turn");
  assert.equal(action.disabled, true);
  assert.equal(action.disabledReason, reason);
  assert.equal(action.onRewind, undefined);
});


test("frontend builtin tool registry fails closed in K-brain mode", async () => {
  const loader = createTsModuleLoader({ mocks: {
    [source("lib/host.ts")]: { isKBrainBackendEnabled: () => true },
  } });
  const { buildBuiltinToolRegistry } = loader.loadModule("src/lib/tools/builtinRegistry.ts");
  await assert.rejects(buildBuiltinToolRegistry({}), /tools are owned by the backend/);
});
