# Testing strategy

## Why the algorithms are easy to test

Every editing algorithm is a pure function. Original pixels plus a few numbers (the amount and the mask) go in, and
pixels come out. The only randomness is grain, which is seeded. Planning is pure as well: a sentence plus an
`ImageContext` goes in and an `EditPlan` comes out.

Skia runs inside Jest through CanvasKit, so the engine tests run **the real SkSL shaders** that ship to phones, not a
TypeScript copy of them. How to set up such a test file is in `CLAUDE.md` under "Testing notes".

## What exists today

Run everything with `npm test` in the app and `cd server && npm test` for the worker.

| Suite | What it checks |
|---|---|
| `src/engine/__tests__/shaders.test.ts` | Every SkSL source compiles. Uniform slots are packed in float units. |
| `src/engine/__tests__/render.test.ts` | **Rendering:**<ul><li>no steps gives the exact original; disabled and zero steps are ignored;</li><li>exposure brightens and darkens and rolls highlights off instead of clipping;</li><li>temperature warms and cools; monochrome removes colour; contrast widens and narrows the spread of tones.</li></ul>**Masks:**<ul><li>a geometric region changes only its side of the frame, and invert flips that;</li><li>regions the photo lacks are skipped; semantic regions follow the segmentation planes;</li><li>every region builds a mask; the selection overlay renders.</li></ul>**Analysis:** auto-enhance brightens a dark photo, and adds a face-only exposure step when the face is darker than the background. |
| `src/ml/__tests__/ml.test.ts` | Letterbox geometry and the [−1, 1] input scaling. BlazeFace decoding against a **real model output** (`src/ml/__fixtures__`): 896 anchors, one face after NMS, the box matches the reference decoder, eyes sit above the mouth. NMS and IoU. Segmentation softmax and letterbox crop. |
| `src/nlp/__tests__/localParser.test.ts` | Table-driven, sentence → expected steps:<ul><li>single adjustments, tones, region-specific actions, intensity words, "too / less / not enough", inversion;</li><li>compound commands, looks, history and auto;</li><li>generative requests are refused, and nonsense isn't understood;</li><li>available regions, replies, lexicon integrity, unknown words.</li></ul> |
| `src/nlp/__tests__/planner.test.ts` | The cascade policy:<ul><li>local first; the free on-device tier for leftover words, never the paid one;</li><li>cloud for the rest;</li><li>empty plans and missing regions are rejected;</li><li>the fallback reply, and keeping the understood part of a partial command.</li></ul> |
| `src/nlp/__tests__/onDevicePlanner.test.ts`, `cloudPlanner.test.ts` | The LLM tiers, with the native module and `fetch` mocked:<ul><li>availability, validation, clamping, code-fenced JSON;</li><li>timeouts, worker errors, network failures.</li></ul> |
| `src/nlp/__tests__/resilience.test.ts` | Circuit breakers:<ul><li>offline skips the tier for a minute; a rejected key switches it off for the session;</li><li>transient failures recover; an on-device model is given up after two failures in a row.</li></ul> |
| `src/nlp/__tests__/onDeviceVocabulary.test.ts` | The Swift and Kotlin vocabulary lists match `catalog.ts` exactly. |
| `src/state/__tests__/editStack.test.ts`, `sessionStore.test.ts` | Undo/redo, one history entry per slider drag, restore. Sessions round-trip with their history, corrupt files are skipped, old sessions are pruned with their files, steps that no longer validate are dropped. |
| `server/test/*.test.ts` (vitest) | The worker for both providers, with the SDK clients mocked:<ul><li>auth, body validation, plan normalization, token usage including thinking tokens;</li><li>refusals and safety blocks become `unsupported`; truncated or off-schema output returns 502;</li><li>SDK errors map to HTTP statuses; per-device rate limit;</li><li>the setup script's `.env` and URL helpers.</li></ul> |

This covers directions ("warmer is warmer") and locality ("the edit stays inside the mask"). It doesn't yet cover
exact maths or every adjustment. That's the next section.

## Planned: a functional suite for every algorithm (not built yet)

Build these in order; the first two are cheap and catch most real bugs.

1. **Properties that hold for every adjustment**, checked on random small images (e.g. with `fast-check`):
   - amount 0 changes nothing;
   - output stays within 0–1 and is never NaN;
   - where the mask is 0, pixels are bit-identical to the input, and a half mask gives exactly half the blend;
   - tone adjustments keep tones in order (a darker pixel never ends up brighter than a lighter one).
2. **Physics checks against the formulas** in `ADJUST_SKSL`:
   - exposure +0.5 (= +1 stop) doubles linear light below the highlight shoulder;
   - temperature and tint keep a neutral grey's luminance;
   - saturation −1 gives R = G = B;
   - hue +1 (180°) applied twice returns the original within rounding;
   - contrast leaves black, mid grey and white fixed;
   - brightness keeps the black and white points.
3. **Spatial algorithms on synthetic scenes:**
   - blur keeps the average brightness;
   - **no halo:** a bright subject on a dark background with the background blurred keeps the background dark next
     to the edge (this proves the mask-aware normalized convolution);
   - sharpen leaves flat areas untouched;
   - smoothing lowers noise variance but keeps a hard edge sharp.
4. **Masks:**
   - a mask plus its inverse is 1 everywhere;
   - graduated masks only increase in their direction;
   - on a synthetic colour wheel, each hue band selects its hue and nothing opposite it.
5. **Preview matches export:** render the same stack at preview and full size, scale the large one down, and compare.
   This guards the rule that blur radii scale with the image diagonal.
6. **Golden images:** fixed edit stacks on the bundled samples, compared with stored reference renders. This is the
   safety net for tuning: a change to "contrast" can't silently alter every look that uses it. Add these once the
   looks are tuned.

**Tolerances.** Jest runs Skia on the CPU at full float precision, while phone GPUs sometimes compute at half
precision. Results can differ by a level or two out of 255, so pixel comparisons, especially golden images, use a
tolerance measured in 8-bit levels rather than exact equality. The properties in item 1 that say "bit-identical" are
about masked-out pixels, which the shader returns untouched.

## On real devices

The dev-script hook (`src/dev/devScript.ts`; README, "Scripted runs") opens the editor, runs commands, and writes the
full-resolution render to the app cache. You can pull that JPEG off the iOS simulator or Android emulator and measure
it. That's how the cross-platform check was done: "make my face brighter" raised the face by 16.8 levels on iOS and
16.6 on Android. The same mechanism verified autosave and resume (bit-identical re-render) and the selection
overlay. It can run in CI on both platforms if that's ever needed.

## Cloud model token use

How much each cloud model spends per command (input, output and hidden thinking tokens) is measured with a manual
procedure in [`AI-PROVIDERS.md`](AI-PROVIDERS.md#measuring-how-hungry-a-model-is-planned-not-built). It's documented
but not automated yet.
