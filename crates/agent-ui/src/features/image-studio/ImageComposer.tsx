import { useId, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import type { InputAsset, Operation } from "../../lib/imaging/types";
import { AssetImage } from "./AssetImage";
import { ImageTargetSettings } from "./ImageTargetSettings";
import type { ImageStudioController, StudioView } from "./studioController";
import { selectClass, TargetParameterForm } from "./TargetParameterForm";

const operationLabels: Record<Operation, string> = {
  generate: "文字生成",
  reference: "参考图生成",
  edit: "图片编辑",
  mask: "遮罩编辑",
};
const roleLabels = { source: "原始图片", reference: "参考图片", mask: "遮罩图片" };
export function ImageComposer({
  controller,
  view,
}: {
  controller: ImageStudioController;
  view: StudioView;
}) {
  const prefix = useId();
  const file = useRef<HTMLInputElement>(null);
  const [role, setRole] = useState<InputAsset["role"]>("source");
  const [regenerateKey, setRegenerateKey] = useState<string | null>(null);
  const target = controller.target;
  const roles: InputAsset["role"][] =
    view.operation === "reference"
      ? ["reference"]
      : view.operation === "edit"
        ? ["source", "reference"]
        : view.operation === "mask"
          ? ["source", "mask"]
          : [];
  const uploadRole = roles.includes(role) ? role : roles[0];
  const locked = !view.projectId || !view.draftReady;
  const errors = controller.validation();
  const submit = () => {
    void controller.submit();
  };
  return (
    <form
      aria-label="图像创作"
      className="space-y-3 border-t border-border bg-background p-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      onDragOver={(event) => {
        if (roles.length) event.preventDefault();
      }}
      onDrop={(event) => {
        if (!roles.length || locked) return;
        event.preventDefault();
        const dropped = event.dataTransfer.files[0];
        if (dropped && uploadRole) void controller.upload(dropped, dropped.name, uploadRole);
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">创作输入</span>
        <ImageTargetSettings client={controller.client} />
      </div>
      <fieldset disabled={locked} className="space-y-3">
        <legend className="sr-only">创作输入</legend>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_6rem]">
          <div>
            <label htmlFor={`${prefix}-target`} className="text-xs">
              执行目标
            </label>
            <select
              id={`${prefix}-target`}
              className={selectClass}
              value={view.draft.targetId}
              onChange={(event) => controller.setTarget(event.target.value)}
            >
              <option value="">请选择目标</option>
              {view.draft.targetId && !target && (
                <option value={view.draft.targetId}>当前目标已删除，请重新选择</option>
              )}
              {view.targets.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                  {item.enabled ? "" : "（未启用）"}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`${prefix}-operation`} className="text-xs">
              操作
            </label>
            <select
              id={`${prefix}-operation`}
              className={selectClass}
              value={view.operation}
              onChange={(event) => controller.setOperation(event.target.value as Operation)}
            >
              {target?.capabilities.operations.map((operation) => (
                <option key={operation} value={operation}>
                  {operationLabels[operation]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`${prefix}-count`} className="text-xs">
              生成数量
            </label>
            <Input
              id={`${prefix}-count`}
              type="number"
              min={1}
              max={Math.min(16, target?.capabilities.maxCount ?? 1)}
              step={1}
              value={Number.isNaN(view.count) ? "" : view.count}
              onChange={(event) => controller.setCount(event.target.valueAsNumber)}
            />
          </div>
        </div>
        {target && !target.enabled && (
          <p role="status" className="text-sm text-destructive">
            {target.disabledReason || "目标尚未启用，请在图像设置中完成验证。"}
          </p>
        )}
        <div>
          <label htmlFor={`${prefix}-prompt`} className="sr-only">
            提示词
          </label>
          <Textarea
            id={`${prefix}-prompt`}
            name="image-prompt"
            rows={3}
            placeholder="描述你想创作的画面，或说明要修改的部分…"
            value={view.draft.prompt}
            onChange={(event) => controller.updateDraft({ prompt: event.target.value })}
          />
        </div>
        {target && target.parameters.length > 0 && (
          <details>
            <summary className="cursor-pointer text-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">
              图像参数
            </summary>
            <div className="pt-3">
              <TargetParameterForm
                target={target}
                values={view.draft.parameters}
                onChange={(parameters) => controller.updateDraft({ parameters })}
              />
            </div>
          </details>
        )}
        {view.dropped.length > 0 && (
          <div role="alert" className="rounded-md border border-border p-3 text-sm">
            切换目标后需要调整：{view.dropped.join("、")}。
            <Button size="sm" variant="outline" onClick={() => controller.acknowledgeMigration()}>
              确认参数调整
            </Button>
          </div>
        )}
        {view.draft.parentAssetId && (
          <p className="text-xs text-muted-foreground">
            新版本的父图片：{view.draft.parentAssetId}{" "}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => controller.updateDraft({ parentAssetId: undefined })}
            >
              解除版本关联
            </Button>
          </p>
        )}
        {view.draft.inputs.length > 0 && (
          <ul className="flex flex-wrap gap-2" aria-label="已保存的输入素材">
            {view.draft.inputs.map((input, index) => (
              <li
                key={`${input.assetId}-${input.role}`}
                className="w-24 rounded-md border border-border p-1"
              >
                <AssetImage
                  client={controller.client}
                  assetId={input.assetId}
                  alt={roleLabels[input.role]}
                  className="h-16 w-full rounded object-contain"
                />
                <span className="text-xs">{roleLabels[input.role]}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`移除${roleLabels[input.role]} ${index + 1}`}
                  onClick={() =>
                    controller.updateDraft({
                      inputs: view.draft.inputs.filter((_, position) => position !== index),
                    })
                  }
                >
                  移除
                </Button>
              </li>
            ))}
          </ul>
        )}
        {view.unverifiedAssetIds.length > 0 && (
          <div role="status" className="text-sm">
            输入图片暂时无法核验，引用已保留。
            <Button
              type="button"
              variant="outline"
              disabled={view.verifyingInputs}
              onClick={() => void controller.revalidateInputs()}
            >
              {view.verifyingInputs ? "正在核验…" : "重新核验输入图片"}
            </Button>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {roles.length > 0 && (
            <>
              <label htmlFor={`${prefix}-role`} className="sr-only">
                上传图片用途
              </label>
              <select
                id={`${prefix}-role`}
                className={`${selectClass} max-w-32`}
                value={uploadRole}
                onChange={(event) => setRole(event.target.value as InputAsset["role"])}
              >
                {roles.map((value) => (
                  <option key={value} value={value}>
                    {roleLabels[value]}
                  </option>
                ))}
              </select>
              <input
                ref={file}
                type="file"
                className="sr-only"
                tabIndex={-1}
                accept="image/png,image/jpeg,image/webp"
                aria-label="选择输入图片"
                onChange={(event) => {
                  const selected = event.target.files?.[0];
                  if (selected && uploadRole)
                    void controller.upload(selected, selected.name, uploadRole);
                  event.target.value = "";
                }}
              />
              <Button
                variant="outline"
                disabled={view.uploading}
                onClick={() => file.current?.click()}
              >
                导入图片
              </Button>
            </>
          )}
          {view.uploading && (
            <>
              <span role="status" className="text-sm">
                上传中…
              </span>
              <Button variant="outline" onClick={() => controller.cancelUpload()}>
                取消上传
              </Button>
            </>
          )}
          <span className="flex-1" />
          {view.submission?.status === "unknown" ? (
            <Button type="button" variant="outline" onClick={() => void controller.submit()}>
              核对原请求
            </Button>
          ) : view.submission?.status === "accepted" ? (
            <Button
              type="button"
              disabled={errors.length > 0}
              onClick={(event) => {
                if (event.detail > 1) return;
                setRegenerateKey(view.submission?.key ?? null);
              }}
            >
              重新生成…
            </Button>
          ) : (
            <Button
              type="submit"
              disabled={errors.length > 0 || view.submission?.status === "submitting"}
              aria-busy={view.submission?.status === "submitting"}
              onClick={(event) => {
                if (event.detail > 1) event.preventDefault();
              }}
            >
              {view.submission?.status === "submitting" ? "正在提交…" : "生成图片"}
            </Button>
          )}
        </div>
        {view.submission?.status === "accepted" && regenerateKey === view.submission.key && (
          <fieldset
            aria-label="确认新生成请求"
            className="rounded-md border border-border p-3 text-sm"
          >
            <p>将以当前输入创建独立的新任务，可能再次计费。</p>
            <Button
              type="button"
              disabled={errors.length > 0}
              onClick={(event) => {
                if (event.detail > 1 || !regenerateKey) return;
                setRegenerateKey(null);
                void controller.regenerate(regenerateKey);
              }}
            >
              确认重新生成（可能再次计费）
            </Button>
            <Button type="button" variant="ghost" onClick={() => setRegenerateKey(null)}>
              取消
            </Button>
          </fieldset>
        )}
        {errors.length > 0 && (
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {errors[0]}
          </p>
        )}
      </fieldset>
    </form>
  );
}
