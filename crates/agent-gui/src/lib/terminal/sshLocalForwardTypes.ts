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

export function validateSshLocalForwardTarget(
  remoteHostInput: string,
  remotePortInput: string,
): SshLocalForwardTarget | null {
  const remoteHost = remoteHostInput.trim();
  const hasControlCharacter = [...remoteHost].some((char) => {
    const code = char.charCodeAt(0);
    return code < 32 || code === 127;
  });
  if (!remoteHost || remoteHost.length > 255 || hasControlCharacter) return null;

  const portText = remotePortInput.trim();
  if (!/^\d+$/.test(portText)) return null;
  const remotePort = Number(portText);
  if (!Number.isInteger(remotePort) || remotePort < 1 || remotePort > 65535) return null;
  return { remoteHost, remotePort };
}
