import { invoke as tauriInvoke, isTauri as tauriIsTauri } from "@tauri-apps/api/core";
import {
  isKBrainBackendEnabled,
  isKBrainBrowserHost,
  isTauriHost,
  kBrainOwnedDesktopCommand,
} from "../lib/host";
import { createKBrainClient } from "../lib/kbrain/client";
import { isKBrainMemoryCommand } from "../lib/kbrain/memory";

export function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (isKBrainBackendEnabled() && isKBrainMemoryCommand(command)) {
    return createKBrainClient().requestMemory<T>(
      command,
      (args?.args as Record<string, unknown>) ?? args ?? {},
    );
  }
  const nativeGatewayCommand = !isKBrainBrowserHost() && command.startsWith("gateway_");
  if (isKBrainBackendEnabled() && !nativeGatewayCommand && kBrainOwnedDesktopCommand(command)) {
    return Promise.reject(
      new Error(
        `Desktop runtime command ${command} is unavailable in K-brain mode; use the K-brain backend capability.`,
      ),
    );
  }
  if (isKBrainBrowserHost()) {
    return Promise.reject(
      new Error(`Tauri command ${command} is unavailable in K-brain browser mode`),
    );
  }
  return tauriInvoke<T>(command, args);
}

export function isTauri(): boolean {
  if (isKBrainBrowserHost()) return false;
  return isTauriHost() || (typeof tauriIsTauri === "function" && tauriIsTauri());
}
