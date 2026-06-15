import {
  runSilentMemoryExtraction,
  type SilentMemoryExtractionBaseParams,
  type SilentMemoryExtractionModelConfig,
  type SilentMemoryExtractionResult,
} from "./silentMemoryExtraction";

function memoryExtractionModelKey(model: SilentMemoryExtractionModelConfig) {
  if (model.selectedModel) {
    return `${model.selectedModel.customProviderId}:${model.selectedModel.model}`;
  }
  return `${model.providerId}:${model.model}:${model.runtime.baseUrl}`;
}

function isSameMemoryExtractionModel(
  left: SilentMemoryExtractionModelConfig,
  right: SilentMemoryExtractionModelConfig,
) {
  return memoryExtractionModelKey(left) === memoryExtractionModelKey(right);
}

export async function runSilentMemoryExtractionWithFallback(
  params: SilentMemoryExtractionBaseParams & {
    primary: SilentMemoryExtractionModelConfig;
    fallback?: SilentMemoryExtractionModelConfig;
    onPrimaryFailure?: (primary: SilentMemoryExtractionModelConfig) => void;
  },
): Promise<SilentMemoryExtractionResult> {
  const { primary, fallback, onPrimaryFailure, ...baseParams } = params;
  const primaryResult = await runSilentMemoryExtraction({
    ...baseParams,
    ...primary,
  });

  if (primaryResult.ok || primaryResult.aborted || !fallback) {
    return primaryResult;
  }

  onPrimaryFailure?.(primary);
  if (isSameMemoryExtractionModel(primary, fallback)) {
    return primaryResult;
  }

  return runSilentMemoryExtraction({
    ...baseParams,
    ...fallback,
  });
}
