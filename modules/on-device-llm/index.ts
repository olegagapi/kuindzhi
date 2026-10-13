import { requireOptionalNativeModule } from 'expo';

export type OnDeviceLlmStatus = 'available' | 'downloadable' | 'downloading' | 'unavailable';

export interface OnDeviceLlmStatusResult {
  status: OnDeviceLlmStatus;
  /** Why the model isn't usable, e.g. "deviceNotEligible", "appleIntelligenceNotEnabled". */
  reason: string;
}

export interface OnDeviceLlmNative {
  getStatus(): Promise<OnDeviceLlmStatusResult>;
  /** Android: starts the Gemini Nano download if needed. iOS: the system manages it. */
  prepare(): Promise<OnDeviceLlmStatusResult>;
  /** Returns a JSON string shaped like EditPlan (iOS: schema-guided; Android: best effort). */
  generatePlan(instructions: string, prompt: string): Promise<string>;
}

let cached: OnDeviceLlmNative | null | undefined;

/** The native module, or null when it isn't linked (Expo Go, web, tests). */
export function getOnDeviceLlm(): OnDeviceLlmNative | null {
  if (cached === undefined) {
    try {
      cached = requireOptionalNativeModule<OnDeviceLlmNative>('OnDeviceLlm');
    } catch {
      cached = null;
    }
  }
  return cached;
}
