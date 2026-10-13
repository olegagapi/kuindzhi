---
name: engine-change
description: Add or change an adjustment, region or SkSL shader in Kuindzhi's render engine. Covers the lockstep across catalog, shader, masks, on-device vocabulary and lexicon, a curve probe that renders any adjustment through the real shader, pixel-test patterns and the docs to update. Use for any edit to src/edits/catalog.ts, src/engine/shaders.ts or src/engine/masks.ts.
---

# Engine change

## 1. Keep the contract in lockstep

The checklist is in `CLAUDE.md` ("The contract is `src/edits/`"). The trap is the `op` uniform: it is the **index in
`ADJUSTMENTS`**. Inserting an adjustment anywhere but the end shifts every later branch in `ADJUST_SKSL`.
`onDeviceVocabulary.test.ts` guards the Swift/Kotlin lists, but nothing guards branch order. `render.test.ts`
only checks that every adjustment changes pixels, which a shifted branch still passes. After inserting, run
`curve.sh` on the new adjustment and its neighbours.

**Also update in the same change:**
- `docs/ARCHITECTURE.md` (it states the counts: 22 adjustments, 27 regions) and `docs/TESTING.md`;
- `docs/pipeline.html` if the stage descriptions change.

The LLM prompt is generated from the catalog, so every new entry makes each cloud call slightly longer
(`docs/AI-PROVIDERS.md`).

**Engine rules that hold today:**
- amounts are normalized (−1…1 or 0…1) and mapped to physical units only in the shader;
- the mask blend happens once, at the end of `ADJUST_SKSL` (`mix(c, r, m)`);
- blur radii scale with the image diagonal;
- no colour literals (accent and overlay colours come from `src/ui/palette.json`).

## 2. Measure the curve before and after

```bash
.claude/skills/engine-change/scripts/curve.sh <adjustment> [amount ...]   # e.g. curve.sh highlights -1 -0.35
```

This renders a 256-step grey ramp and a 12-hue sweep through the real `ADJUST_SKSL` (CanvasKit in Jest) and prints:
- grey in → out;
- whether **tone order** is kept (a darker input never ends up brighter);
- the largest colour cast on greys;
- the luma change per hue.

Without amounts, it uses min, min/2, ∓step, max/2 and max from `ADJUSTMENT_INFO`. It isn't part of `npm test`.

**Sanity case:** `curve.sh highlights -1` currently reports `TONE ORDER BROKEN ... peak 144 at input 168` (the open
finding in `docs/TESTING.md`). A highlights fix should turn that into "tone order kept" while leaving −0.35 nearly
unchanged.

Blur-type ops (`needsBlur`) depend on neighbouring pixels, so a 1-px strip only shows their tonal part. Test their
spatial behaviour with synthetic scenes (below).

## 3. Pin the behaviour in a pixel test

Add the test to `src/engine/__tests__/render.test.ts` (it already has a byte-built test image and a `render(steps)`
helper) or a new file with the same header:

```ts
/**
 * @jest-environment @shopify/react-native-skia/jestEnv.js
 */
import '@shopify/react-native-skia/jestSetup.js';
// Build inputs from bytes (Skia.Image.MakeImage, RGBA_8888, Unpremul): CanvasKit's gradient mocks fail.
// Render with { cpu: true } and read pixels with readRGBA(); compare in 8-bit levels with a tolerance.
```

Prefer properties and physics over snapshots, per the plan in `docs/TESTING.md`:
- amount 0 is the identity;
- where the mask is 0, pixels are untouched;
- known formulas hold (e.g. exposure +0.5 doubles linear light below the shoulder).

**SkSL compile errors:** `Skia.RuntimeEffect.Make` returns `null` with no message. To read the error, call
`global.CanvasKit.RuntimeEffect.Make(src, (e) => console.log(e))` in a test. SkSL has built-ins that collide with
helper names (`unpremul` is why the helper is called `straight`).

## 4. Confirm on a GPU

Run the `device-check` skill for anything that changes pixels. Phone GPUs may compute at half precision, so a level
or two of difference from Jest is normal; more is worth explaining.

## 5. Finish

Run `npm run typecheck && npm test` (and `cd server && npm test` if the catalog or prompt changed; the worker imports
them). Then branch → merge → push, per the project's git flow.
