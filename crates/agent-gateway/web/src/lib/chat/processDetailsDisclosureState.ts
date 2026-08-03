const MAX_MANUAL_PROCESS_DETAILS_STATES = 1_000;

const manualOpenByDisclosureKey = new Map<string, boolean>();

export function readManualProcessDetailsOpen(disclosureKey: string): boolean | undefined {
  const value = manualOpenByDisclosureKey.get(disclosureKey);
  if (value === undefined) return undefined;
  manualOpenByDisclosureKey.delete(disclosureKey);
  manualOpenByDisclosureKey.set(disclosureKey, value);
  return value;
}

export function writeManualProcessDetailsOpen(disclosureKey: string, open: boolean): void {
  manualOpenByDisclosureKey.delete(disclosureKey);
  manualOpenByDisclosureKey.set(disclosureKey, open);
  while (manualOpenByDisclosureKey.size > MAX_MANUAL_PROCESS_DETAILS_STATES) {
    const oldestKey = manualOpenByDisclosureKey.keys().next().value;
    if (oldestKey === undefined) break;
    manualOpenByDisclosureKey.delete(oldestKey);
  }
}
