import { useId, useState } from "react";
import { Button } from "../../components/ui/button";
import type { ImageStudioClient } from "../../lib/imaging/types";
import { AssetImage } from "./AssetImage";

export function ImageCompareView({
  client,
  left,
  right,
  onClose,
}: {
  client: ImageStudioClient;
  left: string;
  right: string;
  onClose: () => void;
}) {
  const [zoom, setZoom] = useState(100);
  const id = useId();
  return (
    <section aria-label="图片版本比较" className="flex min-h-0 flex-1 flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-medium">版本比较</h2>
        <label htmlFor={id} className="text-sm">
          缩放 {zoom}%
        </label>
        <input
          id={id}
          type="range"
          min={50}
          max={200}
          step={10}
          value={zoom}
          onChange={(event) => setZoom(Number(event.target.value))}
        />
        <Button variant="outline" className="ml-auto" onClick={onClose}>
          返回画廊
        </Button>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-auto sm:grid-cols-2">
        {[
          { id: left, title: "对照版本" },
          { id: right, title: "当前版本" },
        ].map((item) => (
          <figure
            key={item.title}
            className="min-w-0 overflow-auto rounded-lg border border-border bg-muted/20 p-3"
          >
            <figcaption className="mb-2 text-sm text-muted-foreground">{item.title}</figcaption>
            <div style={{ width: `${zoom}%` }}>
              <AssetImage
                client={client}
                assetId={item.id}
                original
                alt={item.title}
                className="h-auto w-full object-contain"
              />
            </div>
          </figure>
        ))}
      </div>
    </section>
  );
}
