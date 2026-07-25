export type SshLocalForward = {
  id: string;
  sessionId: string;
  projectPathKey: string;
  localHost: string;
  localPort: number;
  address: string;
  remoteHost: string;
  remotePort: number;
  status: string;
  createdAt: number;
  updatedAt: number;
  error?: string;
};

export type SshLocalForwardSnapshot = {
  forwards: SshLocalForward[];
  revision: number;
};

export type SshLocalForwardAction = {
  forward: SshLocalForward;
  revision: number;
};

export type SshLocalForwardEvent = SshLocalForwardAction & {
  kind: string;
};

export type SshLocalForwardTarget = {
  remoteHost: string;
  remotePort: number;
  // 0 means the OS auto-assigns the loopback listening port.
  localPort: number;
};

export type SshLocalForwardState = {
  forwards: SshLocalForward[];
  revision: number;
};

export type SshLocalForwardUpdate =
  | SshLocalForwardSnapshot
  | SshLocalForwardEvent
  | SshLocalForwardAction;

export function reduceSshLocalForwardState(
  current: SshLocalForwardState,
  update: SshLocalForwardUpdate,
): SshLocalForwardState {
  if (update.revision < current.revision) return current;
  if ("forwards" in update) {
    return update.revision === current.revision && current.forwards === update.forwards
      ? current
      : { forwards: update.forwards, revision: update.revision };
  }
  if (update.revision === current.revision) return current;
  const withoutForward = current.forwards.filter((forward) => forward.id !== update.forward.id);
  const forwards =
    update.forward.status === "active" ? [...withoutForward, update.forward] : withoutForward;
  forwards.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  return { forwards, revision: update.revision };
}

// Port drafts stay as user-typed strings so controlled inputs can be cleared
// and edited digit by digit; only submit-time validation coerces them.
export function isSshLocalForwardPortDraft(value: string): boolean {
  return /^\d{0,5}$/.test(value);
}

function parsePort(input: string, allowAuto: boolean): number | null {
  const text = input.trim();
  if (allowAuto && text === "") return 0;
  if (!/^\d+$/.test(text)) return null;
  const port = Number(text);
  if (!Number.isInteger(port) || port > 65535) return null;
  if (allowAuto ? port < 0 : port < 1) return null;
  return port;
}

export function validateSshLocalForwardTarget(
  remoteHostInput: string,
  remotePortInput: string,
  localPortInput = "",
): SshLocalForwardTarget | null {
  const remoteHost = remoteHostInput.trim() || "127.0.0.1";
  const hasControlCharacter = [...remoteHost].some((char) => {
    const code = char.charCodeAt(0);
    return code < 32 || code === 127;
  });
  if (!remoteHost || remoteHost.length > 255 || hasControlCharacter) return null;

  const remotePort = parsePort(remotePortInput, false);
  if (remotePort === null) return null;
  const localPort = parsePort(localPortInput, true);
  if (localPort === null) return null;
  return { remoteHost, remotePort, localPort };
}
