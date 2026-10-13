import type { ImageTarget, ParameterSpec } from "../../lib/imaging/types";

export interface FieldError {
  key: string;
  message: string;
}
export function parameterError(spec: ParameterSpec, value: unknown): string | undefined {
  if (value === undefined || value === null || value === "")
    return spec.required ? "此项必填" : undefined;
  if (spec.type === "string" && typeof value !== "string") return "请输入文本";
  if (spec.type === "boolean" && typeof value !== "boolean") return "请选择是或否";
  if (spec.type === "number" || spec.type === "integer") {
    if (typeof value !== "number" || !Number.isFinite(value)) return "请输入有效数字";
    if (spec.type === "integer" && !Number.isInteger(value)) return "请输入整数";
    if (spec.minimum !== undefined && value < spec.minimum) return `不能小于 ${spec.minimum}`;
    if (spec.maximum !== undefined && value > spec.maximum) return `不能大于 ${spec.maximum}`;
  }
  if (!["string", "boolean", "number", "integer"].includes(spec.type)) return "暂不支持此参数类型";
  if (spec.enum && !spec.enum.some((candidate) => candidate === value)) return "请选择支持的值";
}
export function validateParameters(
  target: ImageTarget,
  params: Record<string, unknown>,
): FieldError[] {
  const errors: FieldError[] = [];
  for (const spec of target.parameters) {
    const message = parameterError(spec, params[spec.key]);
    if (message) errors.push({ key: spec.key, message });
  }
  for (const key of Object.keys(params))
    if (!target.parameters.some((spec) => spec.key === key))
      errors.push({ key, message: "目标不支持此参数" });
  return errors;
}
export function defaultParameters(target: ImageTarget): Record<string, unknown> {
  return Object.fromEntries(
    target.parameters
      .filter((spec) => spec.default !== undefined && !parameterError(spec, spec.default))
      .map((spec) => [spec.key, spec.default]),
  );
}
export function migrateParameters(
  from: ImageTarget,
  to: ImageTarget,
  params: Record<string, unknown>,
): { values: Record<string, unknown>; dropped: string[] } {
  const values = defaultParameters(to);
  const dropped: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    const old = from.parameters.find((spec) => spec.key === key);
    const next = to.parameters.find((spec) => spec.key === key);
    if (old && next && old.type === next.type && !parameterError(next, value)) values[key] = value;
    else dropped.push(key);
  }
  return { values, dropped };
}
