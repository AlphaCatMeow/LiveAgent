export type ScheduleFrame = (callback: () => void) => number;
export type CancelFrame = (handle: number) => void;

export function createFramePinController(
  write: () => void,
  scheduleFrame: ScheduleFrame,
  cancelFrame: CancelFrame,
) {
  let pendingFrame: number | null = null;

  const cancel = () => {
    if (pendingFrame === null) return;
    cancelFrame(pendingFrame);
    pendingFrame = null;
  };

  const schedule = () => {
    if (pendingFrame !== null) return;
    pendingFrame = scheduleFrame(() => {
      pendingFrame = null;
      write();
    });
  };

  const flush = () => {
    cancel();
    write();
  };

  return { cancel, flush, schedule };
}
