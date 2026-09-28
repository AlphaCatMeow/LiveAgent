export const KBRAIN_PROTOCOL_VERSION = "kbrain.agent.v1" as const;

export type KBrainModelRef = {
  provider: string;
  model: string;
};

export type KBrainContentBlock = {
  type: "text" | "thinking" | "image";
  text?: string;
  image_url?: string;
  mime_type?: string;
};

export type KBrainMessage = {
  id?: string;
  role: "system" | "developer" | "user" | "assistant" | "tool";
  content?: KBrainContentBlock[];
  tool_calls?: KBrainToolCall[];
  tool_call_id?: string;
  name?: string;
  model?: string;
  provider?: string;
  usage?: KBrainUsage;
  stop_reason?: string;
  created_at?: string;
};

export type KBrainToolCall = {
  id: string;
  name: string;
  arguments: unknown;
};

export type KBrainToolResult = {
  id: string;
  name?: string;
  output: string;
  failed?: boolean;
  cancelled?: boolean;
};

export type KBrainUsage = {
  input_tokens?: number;
  output_tokens?: number;
  cached_tokens?: number;
  cache_write_tokens?: number;
};

export type KBrainEvent = {
  version: typeof KBRAIN_PROTOCOL_VERSION;
  seq: number;
  id?: string;
  conversation_id: string;
  run_id: string;
  parent_run_id?: string;
  type: string;
  created_at: string;
  payload?: unknown;
};

export type KBrainSession = {
  id: string;
  title?: string;
  cwd?: string;
  model: KBrainModelRef;
  created_at: string;
  updated_at: string;
  message_count: number;
  pinned?: boolean;
  archived?: boolean;
  shared?: boolean;
  messages?: KBrainMessage[];
  active_messages?: KBrainMessage[];
  tasks?: KBrainSubagent[];
  last_seq: number;
  revision?: string;
  oldest_offset?: number;
  has_more_before?: boolean;
  total_message_count?: number;
};

export type KBrainSessionPage = {
  sessions: KBrainSession[];
  total_count: number;
  version?: string;
};

export type KBrainHistoryResponse = {
  session: KBrainSession;
  message_offsets?: number[];
  revision: string;
  oldest_offset: number;
  has_more_before: boolean;
  total_message_count: number;
  active_messages?: KBrainMessage[];
};

export type KBrainMessageRef = {
  segment_index: number;
  message_index: number;
  segment_id: string;
  message_id: string;
  role: string;
  content_hash: string;
};

export type KBrainBranchRequest = {
  message_ref: KBrainMessageRef;
  expected_revision?: string;
  title?: string;
};

export type KBrainEditRequest = {
  message_ref: KBrainMessageRef;
  replacement: KBrainMessage;
  expected_revision: string;
};

export type KBrainSharedProjection = {
  conversation_id: string;
  title: string;
  messages: KBrainMessage[];
};

export type KBrainShareStatus = {
  conversation_id: string;
  enabled: boolean;
  token?: string;
  created_at?: string;
  updated_at?: string;
  redact_tool_content?: boolean;
};

export type KBrainSubagent = {
  id: string;
  parent_id?: string;
  description: string;
  status: string;
  model: KBrainModelRef;
  attempt?: number;
  report?: string;
  error?: string;
  started_at?: string;
  updated_at?: string;
  ended_at?: string;
};

export type KBrainSubagentEvent = {
  subagent: KBrainSubagent;
};

export type KBrainCreateSessionRequest = {
  cwd?: string;
  model: KBrainModelRef;
  title?: string;
  messages?: KBrainMessage[];
};

export type KBrainUpdateSessionRequest = {
  title?: string;
  pinned?: boolean;
  model?: KBrainModelRef;
};

export type KBrainPromptRequest = {
  conversation_id: string;
  client_request_id: string;
  prompt: string;
  content?: KBrainContentBlock[];
  model?: KBrainModelRef;
  resume_message_id?: string;
};

export type KBrainRunAccepted = {
  version: typeof KBRAIN_PROTOCOL_VERSION;
  conversation_id: string;
  run_id: string;
  accepted_seq: number;
};

export type KBrainTextGenerateRequest = {
  model: KBrainModelRef;
  messages: KBrainMessage[];
  output?: "text" | "json";
};

export type KBrainTextGenerateResponse = {
  version: typeof KBRAIN_PROTOCOL_VERSION;
  text: string;
  model: KBrainModelRef;
  usage?: KBrainUsage;
};

export type KBrainClientOptions = {
  baseUrl?: string;
  token?: string;
  fetch?: typeof globalThis.fetch;
};
