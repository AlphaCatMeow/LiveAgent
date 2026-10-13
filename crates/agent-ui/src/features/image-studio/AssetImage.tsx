import { useEffect, useState } from "react";
import type { ImageStudioClient } from "../../lib/imaging/types";

export function AssetImage({
  client,
  assetId,
  alt,
  original = false,
  className,
}: {
  client: ImageStudioClient;
  assetId: string;
  alt: string;
  original?: boolean;
  className?: string;
}) {
  const [preview, setPreview] = useState<{ id: string; url: string }>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | undefined;
    setFailed(false);
    setPreview(undefined);
    void client
      .readAsset(assetId, original ? "original" : "thumbnail", controller.signal)
      .then((blob) => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setPreview({ id: assetId, url: objectUrl });
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [assetId, client, original]);
  if (failed)
    return (
      <span className="flex min-h-24 items-center justify-center text-sm text-muted-foreground">
        图片不可用，请刷新或重新导入
      </span>
    );
  if (!preview || preview.id !== assetId)
    return (
      <span
        className="flex min-h-24 items-center justify-center text-sm text-muted-foreground"
        aria-busy="true"
      >
        加载图片…
      </span>
    );
  return <img src={preview.url} alt={alt} className={className} onError={() => setFailed(true)} />;
}
