import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  SshLocalForward,
  SshLocalForwardAction,
  SshLocalForwardEvent,
  SshLocalForwardSnapshot,
} from "./sshLocalForwardTypes";

type RawSshLocalForward = Partial<SshLocalForward> & {
  session_id?: string;
  project_path_key?: string;
  local_host?: string;
  local_port?: number;
  remote_host?: string;
  remote_port?: number;
  created_at?: number;
  updated_at?: number;
};

type RawSshLocalForwardSnapshot = {
  forwards?: RawSshLocalForward[];
  revision?: number;
};

type RawSshLocalForwardAction = {
  forward?: RawSshLocalForward;
  revision?: number;
};

type RawSshLocalForwardEvent = RawSshLocalForwardAction & {
  kind?: string;
};

function normalizeForward(input: RawSshLocalForward): SshLocalForward {
  return {
    id: input.id ?? "",
    sessionId: input.sessionId ?? input.session_id ?? "",
    projectPathKey: input.projectPathKey ?? input.project_path_key ?? "",
    localHost: input.localHost ?? input.local_host ?? "127.0.0.1",
    localPort: Number(input.localPort ?? input.local_port ?? 0),
    address: input.address ?? "",
    remoteHost: input.remoteHost ?? input.remote_host ?? "",
    remotePort: Number(input.remotePort ?? input.remote_port ?? 0),
    status: input.status ?? "active",
    createdAt: Number(input.createdAt ?? input.created_at ?? 0),
    updatedAt: Number(input.updatedAt ?? input.updated_at ?? 0),
    error: input.error || undefined,
  };
}

export function normalizeSshLocalForwardSnapshot(
  input: RawSshLocalForwardSnapshot,
): SshLocalForwardSnapshot {
  return {
    forwards: (input.forwards ?? []).map(normalizeForward),
    revision: Number(input.revision ?? 0),
  };
}

export function normalizeSshLocalForwardAction(
  input: RawSshLocalForwardAction,
): SshLocalForwardAction {
  return {
    forward: normalizeForward(input.forward ?? {}),
    revision: Number(input.revision ?? 0),
  };
}

function normalizeEvent(input: RawSshLocalForwardEvent): SshLocalForwardEvent {
  return {
    ...normalizeSshLocalForwardAction(input),
    kind: input.kind ?? "",
  };
}

export const tauriSshLocalForwardClient = {
  async list(params?: { sessionId?: string; projectPathKey?: string }) {
    return normalizeSshLocalForwardSnapshot(
      await invoke<RawSshLocalForwardSnapshot>("terminal_ssh_local_forward_list", {
        session_id: params?.sessionId,
        project_path_key: params?.projectPathKey,
      }),
    );
  },
  async start(params: {
    sessionId: string;
    projectPathKey?: string;
    remoteHost: string;
    remotePort: number;
    localPort?: number;
  }) {
    return normalizeSshLocalForwardAction(
      await invoke<RawSshLocalForwardAction>("terminal_ssh_local_forward_start", {
        session_id: params.sessionId,
        project_path_key: params.projectPathKey,
        remote_host: params.remoteHost,
        remote_port: params.remotePort,
        local_port: params.localPort ?? 0,
      }),
    );
  },
  async stop(params: { forwardId: string; sessionId?: string }) {
    return normalizeSshLocalForwardAction(
      await invoke<RawSshLocalForwardAction>("terminal_ssh_local_forward_stop", {
        forward_id: params.forwardId,
        session_id: params.sessionId,
      }),
    );
  },
  async subscribe(listener: (event: SshLocalForwardEvent) => void) {
    return listen<RawSshLocalForwardEvent>("terminal:ssh-local-forward", (event) => {
      listener(normalizeEvent(event.payload));
    });
  },
};
