export type KBrainSettingsProvider = {
  id: string;
  name: string;
  api: string;
  baseUrl: string;
  apiKeyConfigured: boolean;
  activeModels: string[];
  models: KBrainSettingsModel[];
};

export type KBrainSettingsModel = {
  provider: string;
  id: string;
  name?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  vision?: boolean;
};

export type KBrainSettingsDocument = {
  computer?: KBrainComputerConfig;
  mode: "kbrain";
  defaultModel: string;
  defaultProvider: string;
  providers: KBrainSettingsProvider[];
  models: KBrainSettingsModel[];
};

export type KBrainComputerConfig = {
  enabled?: boolean;
  backend?: string;
  command?: string[];
  approvalPolicy?: "ask" | "allow" | "deny";
  allow?: string[];
  deny?: string[];
  defaultDeny?: boolean;
};

export type KBrainComputerStatus = {
  executionOwner: "kbrain";
  backend: string;
  enabled: boolean;
  installed: boolean;
  platform: string;
  driverVersion?: string;
  message?: string;
  permissionsVerified?: boolean;
};

export type KBrainRuntimeConnection = {
  baseUrl: string;
  token: string;
};

export type KBrainSettingsAdapter = {
  isKbrain: true;
  runtimeConnection: () => KBrainRuntimeConnection | null;
  getConnection: () => KBrainRuntimeConnection | null;
  getSettings: () => Promise<KBrainSettingsDocument>;
  updateSettings: (update: unknown) => Promise<KBrainSettingsDocument>;
  getComputerStatus?: () => Promise<KBrainComputerStatus>;
};

export type SettingsHostAdapter = {
  isKbrain: boolean;
  runtimeConnection?: () => KBrainRuntimeConnection | null;
  kbrain?: KBrainSettingsAdapter;
};
