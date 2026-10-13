// A short system prompt for on-device models (~4k-token context on Apple
// Foundation Models and Gemini Nano). Names only, generated from the catalog.
import { ADJUSTMENTS, ADJUSTMENT_INFO, REGIONS } from '../edits/catalog';

const HINTS: Partial<Record<(typeof ADJUSTMENTS)[number], string>> = {
  temperature: '+warm',
  tint: '+magenta',
  vignette: '+darker edges',
  smooth: 'skin',
  monochrome: '1 = B&W',
};

function names(list: readonly (typeof ADJUSTMENTS)[number][]): string {
  return list.map((a) => (HINTS[a] ? `${a} (${HINTS[a]})` : a)).join(', ');
}

export function buildCompactSystemPrompt(): string {
  const signed = ADJUSTMENTS.filter((a) => ADJUSTMENT_INFO[a].min < 0);
  const positive = ADJUSTMENTS.filter((a) => ADJUSTMENT_INFO[a].min >= 0);

  return `Turn a photo-editing request into classic adjustments (like Lightroom). Never add, remove or redraw objects.
Adjustments, amount -1..1 (typical ±0.3): ${names(signed)}.
Adjustments, amount 0..1: ${names(positive)}.
Regions: ${REGIONS.join(', ')}.
Rules:
- "a bit" = about half, "a lot" = about double. Negative = less/darker/cooler.
- "too dark" means make it lighter (move away from the complaint).
- invert true = everything except the region.
- Only use regions listed as available.
- intent: edit (with steps), auto-enhance (vague "improve it"), undo, redo, reset, unsupported (adding/removing/replacing objects).
- reply: one short sentence in the user's language.
JSON shape: {"intent":"edit","steps":[{"adjustment":"exposure","region":"face","amount":0.3,"invert":false}],"reply":"Brightened your face."}`;
}
