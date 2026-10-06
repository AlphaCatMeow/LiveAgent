export type TimeZoneNotice = {
  kind: "invalid" | "unsupported" | "mismatch";
  preference?: string;
  effective?: string;
};

const notices = new Map<string, TimeZoneNotice>();
const dismissed = new Map<string, string>();
const listeners = new Set<() => void>();
const storageKey = (scope: string) => `liveagent.timezone-notice.dismissed:${scope}`;
const fingerprint = (notice: TimeZoneNotice) => JSON.stringify(notice);

export function subscribeTimeZoneNotice(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emit() {
  for (const listener of listeners) listener();
}

export function getTimeZoneNotice(scope: string): TimeZoneNotice | null {
  const notice = notices.get(scope);
  if (!notice) return null;
  let hidden = dismissed.get(scope);
  try {
    hidden ??= globalThis.sessionStorage?.getItem(storageKey(scope)) ?? undefined;
  } catch {
    /* Storage is optional. */
  }
  return hidden === fingerprint(notice) ? null : notice;
}

export function dismissTimeZoneNotice(scope: string) {
  const notice = notices.get(scope);
  if (!notice) return;
  const key = fingerprint(notice);
  dismissed.set(scope, key);
  try {
    globalThis.sessionStorage?.setItem(storageKey(scope), key);
  } catch {
    /* Storage is optional. */
  }
  emit();
}

function update(scope: string, notice: TimeZoneNotice | null) {
  if (JSON.stringify(notices.get(scope) ?? null) === JSON.stringify(notice)) return;
  if (notice) notices.set(scope, notice);
  else {
    notices.delete(scope);
    dismissed.delete(scope);
    try {
      globalThis.sessionStorage?.removeItem(storageKey(scope));
    } catch {
      /* Storage is optional. */
    }
  }
  emit();
}

function canonicalZone(zone: string) {
  try {
    return new Intl.DateTimeFormat("en", { timeZone: zone }).resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

export function reportTimeZoneFailure(scope: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/^E:timezone_invalid(?::|$)/.test(message.trim())) update(scope, { kind: "invalid" });
}

export function observeTimeZoneResponse(scope: string, action: string, result: unknown) {
  if (!result || typeof result !== "object") return;
  const value = result as { preference?: unknown; timeZone?: unknown };
  if (typeof value.timeZone !== "string" || !value.timeZone) return;
  const effective = canonicalZone(value.timeZone);
  if (!effective) {
    update(scope, { kind: "unsupported", effective: value.timeZone });
    return;
  }
  if (action === "timezone.get" || action === "timezone") {
    if (typeof value.preference !== "string") return;
    const preferred = value.preference ? canonicalZone(value.preference) : effective;
    if (preferred !== effective) {
      update(scope, { kind: "mismatch", preference: value.preference, effective: value.timeZone });
      return;
    }
    update(scope, null);
  } else if (notices.get(scope)?.kind !== "mismatch") {
    update(scope, null);
  }
}
