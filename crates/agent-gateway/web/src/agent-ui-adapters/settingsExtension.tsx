import { MonitorSmartphone } from "@liveagent/ui/components/IconSet";
import type { SettingsSectionDefinition, UiExtensionSlots } from "@liveagent/ui/contracts/registry";
import {
  configureResourceHostCapabilities,
  nativeResourceHostCapabilities,
} from "@liveagent/ui/lib/resourceHost";
import type { GatewaySettingsSyncUpdatePayload } from "@liveagent/ui/lib/settings/sync";
import type { KBrainSettingsAdapter } from "@liveagent/ui/pages/settings/kbrainSettingsAdapter";
import { getGatewayWebSocketClient } from "../lib/gatewaySocket";
import { loadToken } from "../lib/storage";
import { DevicesSection } from "../pages/settings/DevicesSection";
import type { SettingsPageProps } from "../pages/settings/types";

export function createSettingsExtension(props: SettingsPageProps): {
  surface: "web";
  iconClassName: string;
  slots: UiExtensionSlots;
  sections: SettingsSectionDefinition<void>[];
} {
  return {
    surface: "web",
    iconClassName: "size-4",
    slots: {},
    sections: [
      {
        id: "devices",
        groupKey: "settings.groupConnectivity",
        groupOrder: 40,
        order: 30,
        labelKey: "settings.navAgentManagement",
        icon: <MonitorSmartphone className="size-4" />,
        showSaveIndicator: false,
        render: () => <DevicesSection onDirectoryChanged={props.onAgentDirectoryChanged} />,
      },
    ],
  };
}

configureResourceHostCapabilities(nativeResourceHostCapabilities);

const computerSettingsAdapter: KBrainSettingsAdapter = {
  isKbrain: true,
  runtimeConnection: () => null,
  getConnection: () => null,
  async getSettings() {
    const document = await getGatewayWebSocketClient(loadToken().trim()).getSettings();
    return {
      mode: "kbrain",
      defaultModel: "",
      defaultProvider: "",
      providers: [],
      models: [],
      computer: document.computer,
    };
  },
  async updateSettings(update) {
    await getGatewayWebSocketClient(loadToken().trim()).updateSettings(
      update as GatewaySettingsSyncUpdatePayload,
    );
    return this.getSettings();
  },
};

export const settingsHostAdapter = { isKbrain: true as const, kbrain: computerSettingsAdapter };
