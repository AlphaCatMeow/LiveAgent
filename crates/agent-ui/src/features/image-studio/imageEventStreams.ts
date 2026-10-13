import type { ImageJob, ImageStudioClient } from "../../lib/imaging/types";
import {
  applyImageEvent,
  applyJobSnapshot,
  type StudioState,
  snapshotSequence,
  terminalJob,
} from "./studioModel";

/** Owns exactly one stream per job. A gap always refreshes the authoritative snapshot first. */
export class ImageEventStreams {
  private streams = new Map<string, AbortController>();
  private closed = false;
  constructor(
    private client: ImageStudioClient,
    private read: () => StudioState,
    private write: (state: StudioState) => void,
    private notice: (message: string) => void,
  ) {}
  close() {
    this.closed = true;
    for (const stream of this.streams.values()) stream.abort();
    this.streams.clear();
  }
  watch(job: ImageJob) {
    if (this.closed) return;
    if (terminalJob(job)) {
      // Snapshots already include all events through lastEventSeq. The backend closes
      // an up-to-date terminal stream without replaying job.finished.
      this.streams.get(job.id)?.abort();
      this.streams.delete(job.id);
      if (job.status === "cancelled")
        this.notice("任务已取消；上游仍可能返回图片，可稍后点击任务的“刷新状态”读取迟到结果。");
      return;
    }
    if (this.streams.has(job.id)) return;
    const controller = new AbortController();
    this.streams.set(job.id, controller);
    let recovering = false;
    const recover = async () => {
      if (recovering || this.closed) return;
      recovering = true;
      controller.abort();
      try {
        const snapshot = await this.client.getJob(job.id);
        if (this.closed) return;
        this.write(applyJobSnapshot(this.read(), snapshot));
        this.streams.delete(job.id);
        if (terminalJob(snapshot)) {
          this.watch(snapshot);
          return;
        }
        if (snapshotSequence(snapshot) === undefined) {
          this.notice("已更新任务快照；此后端缺少事件恢复游标，请升级后端。当前可手动刷新任务。");
          return;
        }
        this.watch(snapshot);
      } catch {
        if (!this.closed) {
          this.streams.delete(job.id);
          this.notice("任务快照读取失败，请刷新核对状态。");
        }
      }
    };
    void this.client
      .subscribe(
        job.id,
        this.read().lastSeqByJob[job.id] ?? 0,
        (event) => {
          if (this.closed || controller.signal.aborted) return;
          const state = applyImageEvent(this.read(), event);
          this.write(state);
          if (state.snapshotNeeded[job.id]) void recover();
          else if (event.type === "job.finished") {
            controller.abort();
            this.streams.delete(job.id);
            // Event payload intentionally omits usage, cancelEffect and complete item output lists.
            void this.client
              .getJob(job.id)
              .then((snapshot) => {
                if (this.closed) return;
                this.write(applyJobSnapshot(this.read(), snapshot));
                this.watch(snapshot);
              })
              .catch(() => {
                if (!this.closed) this.notice("任务已结束，详情尚未刷新，请手动核对。");
              });
          }
        },
        controller.signal,
      )
      .catch((error) => {
        if (this.closed || controller.signal.aborted) return;
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "IMAGE_EVENT_GAP"
        )
          void recover();
        else {
          this.streams.delete(job.id);
          this.notice("任务事件连接中断，请刷新核对任务。");
        }
      })
      .then(() => {
        if (!recovering && this.streams.get(job.id) === controller) {
          this.streams.delete(job.id);
          if (
            !this.closed &&
            !controller.signal.aborted &&
            !terminalJob(this.read().jobs[job.id] ?? job)
          )
            this.notice("任务事件连接已结束，请刷新核对任务。");
        }
      });
  }
}
