import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { ImageStudioClient } from "../../lib/imaging/types";
import type { DraftStorage } from "./drafts";
import { ImageStudioController } from "./studioController";

export function useImageStudio(
  client: ImageStudioClient,
  ownerId: string,
  backendId: string,
  storage?: DraftStorage,
) {
  const controller = useMemo(
    () => new ImageStudioController(client, ownerId, backendId, storage),
    [client, ownerId, backendId, storage],
  );
  const view = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  useEffect(() => {
    void controller.start();
    return () => controller.dispose();
  }, [controller]);
  return { controller, view };
}
