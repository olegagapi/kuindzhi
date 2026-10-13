// System prompt + user message builder for LLM planners (cloud and on-device).
// Generated from the catalog so the model's vocabulary can't drift from the engine.
import { ADJUSTMENTS, ADJUSTMENT_INFO, REGIONS, REGION_INFO } from './catalog';
import type { ImageContext } from './schema';

export function buildSystemPrompt(): string {
  const adjustments = ADJUSTMENTS.map((a) => {
    const i = ADJUSTMENT_INFO[a];
    return `- ${a} [${i.min}..${i.max}, typical ${i.step}]: ${i.describe}`;
  }).join('\n');
  const regions = REGIONS.map((r) => `- ${r}: ${REGION_INFO[r].describe}`).join('\n');

  return `You turn a photo-editing request into a list of classic photo adjustments, like Lightroom or Photoshop adjustment layers with masks. You never generate, add, remove or redraw content.

Adjustments (amount range, typical step):
${adjustments}

Regions (masks):
${regions}

Rules:
- intent "edit": one step per adjustment+region. Use several steps for compound or stylistic requests (e.g. "cinematic" = contrast, cooler shadows, warmer highlights, fade).
- Sizes: "a bit/slightly" = about half the typical step, plain request = typical step, "a lot/much/very" = about double. Never exceed the range.
- "too X" means move away from X (e.g. "face is too dark" = exposure + on face).
- "invert": true selects everything EXCEPT the region (e.g. "darken everything but me" = region person, invert true).
- Only use regions listed as available for this photo. If the request needs a missing region, pick the closest available one and say so in reply.
- intent "auto-enhance" for vague requests to improve/fix/enhance the whole photo (no steps needed).
- intent "undo" / "redo" / "reset" for history commands (no steps).
- intent "unsupported" (no steps) when the request needs generative editing: adding, removing, replacing or moving objects, changing expressions, etc. Explain briefly in reply.
- reply: one short friendly sentence describing what you did, in the user's language.`;
}

export function buildUserMessage(command: string, context: ImageContext): string {
  const s = context.stats;
  const pct = (v: number | undefined) => (v === undefined ? 'n/a' : `${Math.round(v * 100)}%`);
  const lines = [
    `Available regions: ${context.regions.join(', ')}`,
    `Faces: ${context.faces}`,
    `Photo stats: brightness ${pct(s.brightness)}, contrast ${pct(s.contrast)}, saturation ${pct(s.saturation)}, warmth ${s.warmth.toFixed(2)}` +
      (s.faceBrightness !== undefined ? `, face brightness ${pct(s.faceBrightness)}` : '') +
      (s.backgroundBrightness !== undefined ? `, background brightness ${pct(s.backgroundBrightness)}` : ''),
    `Already applied: ${context.history.length ? context.history.join('; ') : 'nothing'}`,
    '',
    `Request: ${command}`,
  ];
  return lines.join('\n');
}
