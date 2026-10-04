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
  mode: "kbrain";
  defaultModel: string;
  defaultProvider: string;
  providers: KBrainSettingsProvider[];
  models: KBrainSettingsModel[];
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
};

export type SettingsHostAdapter = {
  isKbrain: boolean;
  runtimeConnection?: () => KBrainRuntimeConnection | null;
  kbrain?: KBrainSettingsAdapter;
};
