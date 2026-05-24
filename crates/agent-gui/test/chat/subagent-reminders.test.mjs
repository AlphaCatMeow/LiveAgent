import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const { buildExistingSubagentsReminder } = loader.loadModule(
  "src/lib/chat/subagent/subagentReminders.ts",
);

function identity(overrides) {
  const logicalAgentId = overrides.logicalAgentId;
  const displayName = overrides.displayName;
  const role = overrides.role ?? displayName;
  return {
    parentConversationId: "conv-1",
    logicalAgentId,
    displayName,
    role,
    identityPrompt: overrides.identityPrompt ?? `${displayName}: ${role}`,
    agentId: overrides.agentId,
    templateName: overrides.templateName,
    defaultMode: overrides.defaultMode ?? "readonly",
    defaultTaskIntent: overrides.defaultTaskIntent ?? "research",
    defaultApplyPolicy: overrides.defaultApplyPolicy ?? "none",
    createdParentToolCallId: overrides.createdParentToolCallId ?? "call-agent",
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt ?? 2,
  };
}

function run(overrides) {
  return {
    id: overrides.id ?? `run-${overrides.logicalAgentId}`,
    parentConversationId: "conv-1",
    parentToolCallId: "call-agent",
    parentToolName: "Agent",
    agentIndex: 0,
    agentTotal: 1,
    logicalAgentId: overrides.logicalAgentId,
    agentName: overrides.agentName,
    description: overrides.description ?? "Expert",
    mode: overrides.mode ?? "readonly",
    status: overrides.status ?? "completed",
    providerId: "codex",
    model: "gpt-5",
    messageCount: 4,
    roundCount: 1,
    toolCallCount: 0,
    compactionCount: 0,
    summary: overrides.summary,
    startedAt: overrides.startedAt ?? 1,
    endedAt: overrides.endedAt ?? 2,
    updatedAt: overrides.updatedAt ?? 10,
  };
}

test("subagent reminder is empty without stable identities", () => {
  assert.equal(
    buildExistingSubagentsReminder(
      [],
      [
        run({
          logicalAgentId: "legacy-agent",
          agentName: "Legacy Agent",
          description: "Old run without identity",
        }),
      ],
    ),
    "",
  );
});

test("subagent reminder lists stored identities and latest matching run status", () => {
  const reminder = buildExistingSubagentsReminder(
    [
      identity({
        logicalAgentId: "expert-a",
        displayName: "哲学家 - 苏格拉底",
        role: "哲学视角",
      }),
      identity({
        logicalAgentId: "psychologist",
        displayName: "心理学家",
        role: "心理学视角",
      }),
    ],
    [
      run({
        logicalAgentId: "expert-a",
        description: "Earlier version",
        summary: "Old summary",
        updatedAt: 1,
      }),
      run({
        logicalAgentId: "expert-a",
        description: "Existential philosopher follow-up",
        summary: "Meaning is chosen through concrete commitments.",
        updatedAt: 20,
      }),
      run({
        logicalAgentId: "psychologist",
        description: "Psychologist follow-up",
        summary: "Meaning grows from values, relationships, and action.",
        updatedAt: 15,
      }),
    ],
  );

  assert.match(reminder, /Existing delegated agents/);
  assert.match(reminder, /id=expert-a name=哲学家 - 苏格拉底 role=哲学视角 mode=readonly/);
  assert.match(reminder, /last_task=Existential philosopher follow-up/);
  assert.match(reminder, /last_summary=Meaning is chosen through concrete commitments/);
  assert.match(reminder, /id=psychologist name=心理学家 role=心理学视角/);
  assert.doesNotMatch(reminder, /Earlier version/);
  assert.match(reminder, /call Agent again with agent_spec blocks using the same id values/);
  assert.match(reminder, /Do not impersonate those agents/);
  assert.match(reminder, /do not restate name, role, or identity/);
});

test("subagent reminder does not infer identities from phase-specific runs", () => {
  const reminder = buildExistingSubagentsReminder(
    [
      identity({
        logicalAgentId: "player-zhangsan",
        displayName: "张三",
        role: "狼人 - 沉稳老练的中年商人",
        defaultTaskIntent: "communication",
      }),
      identity({
        logicalAgentId: "player-zhaoliu",
        displayName: "赵六",
        role: "狼人 - 活泼开朗的年轻销售",
        defaultTaskIntent: "communication",
      }),
    ],
    [
      run({
        logicalAgentId: "player-zhangsan",
        agentName: "张三",
        description: "狼人 - 沉稳老练的中年商人",
        summary: "初始身份建立",
        updatedAt: 10,
      }),
      run({
        logicalAgentId: "day1-player-zhangsan",
        agentName: "day1-张三",
        description: "张三白天发言-狼人",
        summary: "张三白天继续伪装",
        updatedAt: 20,
      }),
      run({
        logicalAgentId: "werewolves-night1",
        agentName: "狼人会议",
        description: "张三和赵六夜间商议",
        summary: "聚合发言不应成为稳定 Agent",
        updatedAt: 22,
      }),
    ],
  );

  assert.match(reminder, /id=player-zhangsan name=张三/);
  assert.match(reminder, /last_summary=初始身份建立/);
  assert.match(reminder, /id=player-zhaoliu name=赵六/);
  assert.doesNotMatch(reminder, /day1-player-zhangsan/);
  assert.doesNotMatch(reminder, /werewolves-night1/);
  assert.doesNotMatch(reminder, /张三白天继续伪装/);
  assert.doesNotMatch(reminder, /狼人会议/);
});
