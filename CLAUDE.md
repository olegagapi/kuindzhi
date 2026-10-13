# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Kuindzhi is a voice/text-driven photo editor (Expo SDK 57, React Native 0.86, TypeScript). Commands are turned into
deterministic adjustments with masks — never generative redrawing — and the photo never leaves the device.
Product/architecture rationale: `docs/ARCHITECTURE.md`. Generic Expo rules (Expo Router in `src/app/`, `npx expo install`
for deps, never hand-edit `ios/`/`android/`): `AGENTS.md`.

## Commands

```bash
npm test                              # all Jest suites
npx jest src/engine/__tests__/render.test.ts -t "exposure"   # single file / single test
npm run typecheck                     # tsc --noEmit (server/ is excluded; it has its own tsconfig)
npm run ios | npm run android         # expo run:* — dev build required (Skia, TFLite, speech are native)
npm start                             # Metro for an installed dev build
npx expo prebuild                     # regenerate ios/ and android/ after native dep or app.json changes
cd server && npm test && npm run typecheck && npm run build   # Cloudflare Worker (build = wrangler dry-run)
cd server && npm run setup -- --dry-run                       # one-command deploy + .env, previewed (docs/AI-PROVIDERS.md)
```

- Android builds need `JAVA_HOME` = JDK 17 and `ANDROID_HOME=~/Library/Android/sdk`; the first build auto-installs the
  NDK version React Native pins. Faster local build: `cd android && ./gradlew assembleDebug -PreactNativeArchitectures=arm64-v8a`.
- Android dev-script runs: `adb reverse tcp:8081 tcp:8081 && adb reverse tcp:8099 tcp:8099`, then
  `adb shell am start -a android.intent.action.VIEW -d "kuindzhi://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081"`
  (no confirmation prompt on Android); captures land in `run-as app.kuindzhi cat cache/<name>.jpg`.
- Verifying UI changes without tapping: the dev-script hook (`src/dev/devScript.ts`, README "Scripted runs") opens the
  editor, runs commands, and can `capture` the full-res render to the app cache for pixel inspection, `save` it to Photos, or `resume` the latest saved session. Launch with
  `xcrun simctl launch booted app.kuindzhi --initialUrl http://localhost:8081` (`simctl openurl` triggers a
  confirmation alert that can't be dismissed from the CLI).
- Apple Foundation Models in the simulator may report "available" yet fail with `GenerationError -1` when the host
  Mac lacks the model assets — check `xcrun simctl spawn booted log show` for "not found in Model Catalog".
- Skia's postinstall is gated by npm `allowScripts` in package.json; if `node_modules/@shopify/react-native-skia/libs`
  is missing, run `npm rebuild @shopify/react-native-skia`.

## Architecture (the parts that span files)

**The contract is `src/edits/`.** `catalog.ts` lists `ADJUSTMENTS` and `REGIONS` with ranges/descriptions;
`schema.ts` is the zod `EditPlanSchema` (`{intent, steps[{adjustment, region, amount, invert}], reply}`) plus
`normalizePlan()`; `prompt.ts` generates the LLM prompt from the catalog. The Worker imports these by relative path.
Adding or renaming an adjustment/region touches, in lockstep:
1. `catalog.ts`;
2. `ADJUST_SKSL` in `src/engine/shaders.ts` — the `op` uniform is the **index in `ADJUSTMENTS`**, so branch order must match;
3. `src/engine/masks.ts` for regions;
4. the Swift/Kotlin vocab lists in `modules/on-device-llm` (guarded by `onDeviceVocabulary.test.ts`);
5. the lexicon in `src/nlp/lexicon.ts` if users should be able to say it.

**Planning cascade** (`src/nlp/planner.ts`): `parseLocally` (rule parser, returns `full`/`partial`/`none`) →
`onDevicePlanner` (Apple Foundation Models with guided generation / Gemini Nano via ML Kit GenAI) →
`createCloudPlanner` (Worker → Gemini 3.5 Flash-Lite by default, Claude Haiku 4.5 via `PROVIDER=anthropic`). A tier is only tried if the previous one didn't fully understand the
command; every tier's output goes through `normalizePlan(plan, availableRegions)`. Planners receive `ImageContext`
(regions, face count, rounded stats, history strings) — never pixels; keep it that way.

**Rendering** (`src/engine/`): `PhotoSession` (session.ts) owns the decoded original, a ≤512 px analysis copy, ML
results and a `MaskStore`. `renderPhoto` (render.ts) is non-destructive: it resamples the original to the target size
and runs one `ADJUST_SKSL` pass per enabled step, with the step's mask as a child shader and, for blur-type ops, a
blurred copy (mask-aware normalized convolution for `blur`/`smooth`). Preview (1280 px) and export (full size) are
the same call; blur radii scale with the image diagonal. Masks are small grayscale images stretched with bilinear
sampling. Rendering happens on the JS thread with offscreen surfaces; images shown in the `<Canvas>` must go through
`toRaster()` (`makeNonTextureImage`). Dispose intermediates with `disposeAll` — full-res exports are large.

**ML** (`src/ml/`): `models.ts` runs the two MediaPipe `.tflite` models with react-native-fast-tflite (Nitro, CPU
delegate). Inputs are **letterboxed** and scaled to **[-1, 1]**; the segmenter outputs **logits** (softmax in
`segmentationMath.ts`) in class order background, hair, body-skin, face-skin, clothes, others. These facts were
verified against the real models — don't "fix" them to [0, 1] or stretching. Decoders are pure TS; the BlazeFace
decoder is tested against a real model output in `src/ml/__fixtures__`.

**Colours**: `src/ui/palette.json` is the single source. `src/ui/palette.ts` types it, `src/ui/theme.ts` exposes it as
`colors`, `app.config.ts` reads it for native colours (there is no `app.json`; native colours need `npx expo prebuild`),
and the render engine passes the accent to the selection-overlay shader as a uniform. Never write colour literals in
components or shaders; the only literals left are mask values (black/white) in the engine.

**Failure handling**: LLM tiers are module-level singletons (`src/nlp/tiers.ts`) wrapped by `withCircuitBreaker`
(`src/nlp/resilience.ts`); `Planner.issue()` reports why a tier was skipped and the cascade appends a short note to the
reply. `expo-speech-recognition` and `react-native-fast-tflite` are `require`d lazily so a missing native module only
disables its feature; keep new native imports lazy where a feature is optional.

**Sessions (autosave)**: `src/state/sessionStore.ts` is pure (behind a `Storage` interface, tested with
`createMemoryStorage`); `src/state/sessions.ts` binds it to expo-file-system under `Documents/sessions/<id>/`;
`useAutosave` creates a session on the first edit and saves debounced, plus on background/unmount. The editor accepts
`session=<id>` to resume.

**State**: `src/state/editStack.ts` is a pure reducer (apply/update/remove/undo/redo/reset/restore). Slider drags dispatch
`update` with `commit: false` and commit once on release, so history isn't flooded.

## Testing notes

- Tests that touch Skia need the CanvasKit environment — first lines of the file:
  `/** @jest-environment @shopify/react-native-skia/jestEnv.js */` and `import '@shopify/react-native-skia/jestSetup.js'`.
  Use `cpu: true` options so surfaces are raster. `Skia.RuntimeEffect.Make` returning `null` means an SkSL compile
  error; read the message with `global.CanvasKit.RuntimeEffect.Make(src, err => console.log(err))`.
  SkSL has built-ins that collide with helper names (e.g. `unpremul`).
- `package.json#jest.transformIgnorePatterns` must include any new ESM native package used in tests.
- Native modules (`expo-speech-recognition`, `react-native-fast-tflite`, `OnDeviceLlm`) aren't available in Jest;
  test their pure logic or mock them (see `onDevicePlanner.test.ts`).
