# Kuindzhi — product & architecture plan

## The product in one paragraph

Generative "AI photo editors" redraw your photo: the face you get back is a plausible new face, not yours.
Kuindzhi goes the other way. You **say or type** what you want — "make my face lighter", "blur the background",
"the sky is too flat" — and it is translated into the same deterministic operations a retoucher would apply in
Photoshop or Lightroom: exposure, curves, white balance, local contrast, blur, each limited by a precise **mask**
(face skin, hair, person, sky, dark tones, the greens, the top of the frame…). Every edit lands in an editable stack
with a slider, an on/off switch, an "invert selection" toggle and a "show me the area" button. Nothing is
invented; every pixel is a function of the original.

**Product guarantee:** the photo never leaves the device. Even when a cloud model is used to understand a
sentence, it receives only the text of the command, the list of selectable regions and a handful of statistics
(e.g. "face brightness 32%"). It never receives pixels.

## Why React Native + Expo (and not Compose Multiplatform)

The choice was driven by what this app does all day:

| Need | RN + Expo | Compose Multiplatform |
|---|---|---|
| GPU image pipeline with custom shaders | `@shopify/react-native-skia` ships **the same Skia build** on iOS and Android → one SkSL source per algorithm, identical pixels on both platforms, any Android version | Android renders through the platform stack: runtime shaders = AGSL (Android 13+ only); iOS goes through Skiko → two code paths and a min-SDK cut |
| On-device ML (segmentation, face detection) | `react-native-fast-tflite` runs the **same `.tflite` files** on both platforms (TFLite C API, CoreML/GPU delegates available) | per-platform interop with LiteRT / Core ML |
| Apple Foundation Models (Swift-only API) | Expo Modules API is Swift-native — a thin module (`modules/on-device-llm`) | Kotlin/Native cinterop sees Objective-C only → a Swift shim anyway |
| Planner schema shared with the cloud | TypeScript end to end: the zod schema and prompt are imported by the Cloudflare Worker | would need a separate server language or KMP-on-JS |
| Iteration speed on an AI product | the grammar, prompt and shaders are JS → shippable as OTA updates (EAS Update) without store review | binary releases only |
| Testability | the real Skia (CanvasKit) runs in Jest → shaders compiled and pixel-tested in CI | — |

## Architecture

```
 voice ─► OS speech recognizer (on-device when available, free)
                     │ text
 text ───────────────┤
                     ▼
        ┌─ Planning cascade (src/nlp/planner.ts) ─────────────────────────┐
        │ 1. local rule parser      free · offline · <1 ms   (src/nlp/localParser.ts)
        │ 2. on-device LLM          free · private           (modules/on-device-llm)
        │      iOS 26+: Apple Foundation Models, guided generation
        │      Android: Gemini Nano via ML Kit GenAI (supported phones)
        │ 3. cloud LLM              free tier / ~$0.0007     (server/ → Gemini 3.5 Flash-Lite)
        └──────────────────────────┬─────────────────────────────────────┘
                                   │ EditPlan {intent, steps[{adjustment, region, amount, invert}], reply}
                                   ▼
        Edit stack (src/state/editStack.ts) — undo/redo, sliders, toggles
                                   │
                                   ▼
        Render engine (src/engine) — Skia, one SkSL pass per step:
          original ─► [pass: adjustment × mask(region)] ─► … ─► preview (1280 px) / export (full size)
                                   ▲
        Masks (src/engine/masks.ts), computed once per photo:
          semantic   ← MediaPipe selfie-multiclass (person, background, face, skin, hair, clothes)
          face parts ← BlazeFace keypoints (eyes, mouth)
          sky        ← procedural: brighter than average, smooth, upper frame, not a person
          tonal      ← luminosity masks (dark / mid / bright tones)
          colour     ← hue bands (reds … magentas)
          geometric  ← graduated top/bottom/left/right, radial centre/edges
```

### The contract: `EditPlan`

`src/edits/catalog.ts` defines 22 adjustments and 27 regions with ranges and human descriptions;
`src/edits/schema.ts` defines the zod `EditPlanSchema`. Every planner — the parser, the on-device models and
Claude — produces exactly this shape, and `normalizePlan()` clamps amounts and drops regions the photo
doesn't contain. The LLM system prompt (`src/edits/prompt.ts`) is generated from the catalog, so the models'
vocabulary can't drift from what the engine can render; a test checks the Swift/Kotlin copies too.

Amounts are normalized (−1…1 or 0…1) and mapped to physical parameters in the shader (e.g. exposure ±1 = ±2 EV),
so "a bit" / "a lot" mean the same thing to every planner.

### Who edits the pixels: only our code

Models give the engine *input*. They never produce pixels, and nothing they return can redraw the photo.

- **Language models** (on-device or cloud) turn a sentence into an `EditPlan`:
  - **Never see the photo.** They get the sentence, the regions this photo has, a few rounded statistics and the
    history. A cloud call is about 1.5k tokens in and 100 out, with no image tokens.
  - **Locked to the catalog.** Every tier is held to the catalog's names. Apple Foundation Models use guided
    generation over the catalog's names. Gemini Nano's answer is parsed, and steps with unknown names are dropped. The
    cloud uses a JSON schema (Gemini) or structured outputs (Claude). Every plan then goes through `normalizePlan`,
    which clamps amounts and drops steps on regions the photo lacks.
  - **"Redraw" can't be expressed.** The prompt's "never redraw" line exists only so the model recognises requests
    like "remove the person" and answers `unsupported`. The schema, not the prompt, is what protects the photo.
- **Vision models** (MediaPipe segmentation and BlazeFace, on the phone) only say *where* things are: per-pixel
  probabilities that become masks, like Photoshop's "Select Subject".
- **The engine does all the editing.** `src/engine/shaders.ts` holds every algorithm, and each output pixel is our
  formula applied to the original pixel, blended by the mask. Auto-enhance is histogram maths, not a model. With
  every model removed, the editor still works through the rule parser and the sliders.

**One nuance:** mask edges come from a neural network, so *where* an edit fades out depends on its judgement (a strand
of hair can be misjudged). A mask can only change how strongly our adjustment applies to a pixel; it can never add
content.

### Engine details worth knowing

- **Non-destructive.** `renderPhoto(source, steps, masks, size)` always starts from the original; the preview and
  the export are the same function at different sizes. Blur radii are relative to the image diagonal so they match.
- **One uber-shader** (`ADJUST_SKSL`) implements all adjustments; `op` is the adjustment's index in `ADJUSTMENTS`.
  Exposure works in linear light with a soft highlight shoulder; temperature/tint are luminance-preserving white
  balance gains; vibrance protects skin hues; smoothing is edge-preserving.
- **Mask-aware blur.** Blur and skin smoothing use normalized convolution (blur(image × mask) ÷ blur(mask)), so a
  blurred background doesn't pick up a halo of the subject and smoothed skin doesn't pull in hair colour.
- **Model facts verified offline** (with LiteRT in Python on test photos) before writing the TypeScript:
  both MediaPipe models take RGB in [−1, 1]; the segmenter outputs logits (softmax needed) in the order
  background, hair, body-skin, face-skin, clothes, others; letterboxing (aspect-preserving) segments full-body and
  back-lit people far better than stretching. The BlazeFace decoder is unit-tested against a real model output.

## Offline and failure behaviour

Everything that touches pixels runs on the phone, so the app is useful with no connection at all.

| Part | Needs a connection? | If it is missing or fails |
|---|---|---|
| Opening, analysing, editing, exporting, Save to Photos | No | Each vision model is independent: if the person segmenter or face detector fails to load, only its regions disappear ("Basic regions only"); every other region still works |
| Local parser | No | — |
| On-device LLM (Apple Foundation Models, Gemini Nano) | No (Gemini Nano downloads its model once) | Skipped for the session after two failures in a row |
| Cloud planner | Yes | Offline or timeout: skipped for a minute. Quota hit: five minutes. Rejected key or broken setup: off for the session. The reply says which ("Offline, so this was handled on the phone") |
| Voice | Only on phones without on-device speech for the language | A plain message suggests typing instead |
| A native module missing from the build (speech, TFLite) | — | Loaded lazily: that feature turns off and the editor still opens |

The circuit breakers live in `src/nlp/resilience.ts`; the tiers are created once per launch (`src/nlp/tiers.ts`) so a
broken tier stays skipped when you open the next photo.

## Saving progress

Edits are saved automatically. The first edit on a photo creates a session in the app's documents folder
(`Documents/sessions/<id>/`: its own copy of the original, a thumbnail, and `session.json` with the steps and undo
history), and every change after that is written about half a second later, and immediately when the app goes to the
background or the editor closes. The home screen lists the 12 most recent sessions under "Continue editing"; long-press
one to delete it. Session files are validated on load, so a step that a newer version no longer understands is dropped
instead of losing the whole session. Finished photos leave the app through Save to Photos or Share, at full resolution.

## AI cost plan

| Tier | Handles | Cost | Latency | Privacy |
|---|---|---|---|---|
| Speech → text | voice | free (OS) | real-time | on-device when the OS supports it |
| Local parser | most everyday commands: single and compound edits, intensities, "too X", "everything but me", 13 looks, undo/redo/reset/auto | free | <1 ms | on-device |
| Apple Foundation Models / Gemini Nano | free-form requests on capable phones | free | ~1 s | on-device |
| Gemini 3.5 Flash-Lite via Cloudflare Worker (Claude Haiku 4.5 optional) | everything else | $0 on the free tier; ≈ $0.0007 per request paid (~1.5k in / ~0.1k out tokens) | ~1–2 s | text + stats only |

The cloud model is Gemini 3.5 Flash-Lite on the free tier: no card, minimal thinking (no hidden reasoning spend),
about 3× cheaper than Claude Haiku 4.5 if billing is ever enabled. Claude stays one flag away. The comparison with
today's prices, the free-tier privacy terms, setup, and a procedure for measuring each model's token use are in
[`AI-PROVIDERS.md`](AI-PROVIDERS.md). Because the app↔worker contract is provider-neutral, switching model or provider
is a worker-only change.

Hosting and abuse: the worker holds the API key; the app authenticates with a shared key plus a per-device rate
limit. Before a public launch, replace the shared key with App Attest / Play Integrity verification.

## Name

**Kuindzhi** — after Arkhyp Kuindzhi (Архип Куїнджі, 1842–1910), born in Mariupol, the "painter of light". His
*Moonlit Night on the Dnieper* (1880) glowed so convincingly that visitors looked behind the canvas for a lamp, yet the
effect came from technique — composition, contrast and pigment — not trickery. That's this app's whole idea: make
light with real technique, not by repainting.

Alternatives considered: **Malevich** (born in Kyiv; most famous internationally), **Pryma** (from Maria
Prymachenko), **Exter** (Alexandra Exter, whose Kyiv studio trained a generation of avant-garde artists).
Kandinsky, the working name, also has a Ukrainian link: he grew up in Odesa.

## Status and roadmap

Built and verified:
- Engine, masks and ML decoding: compiled and pixel-tested in real Skia (CanvasKit) under Jest; BlazeFace decoding
  matches the reference on real model output. What each suite covers, and the planned functional suite, are in
  [`TESTING.md`](TESTING.md).
- Local parser, cascade policy, cloud worker (handler tests with the Gemini and Claude clients mocked, bundle dry-run).
- iOS simulator, end to end, on the bundled samples (scripted with the dev script, see below):
  - "make my face brighter" raised the face region by ~17 levels (within ~2 levels of an exact +0.6 EV linear gain)
    while the background moved < 1 level;
  - "blur the background a lot, smooth my skin, brighten my eyes" produced a clean portrait-mode result with no halo;
  - on the back-lit sunset, the procedural sky mask found a purple sky and the letterboxed segmenter found the
    silhouette; "remove the person" is refused as generative;
  - vintage look + auto-enhance (auto added a face-only exposure step for the under-lit face); Save to Photos at full
    resolution.
- Android (API 36 emulator): Gradle build including the Gemini Nano bridge, and the same scripted run — the face
  rose +16.6 levels (iOS: +16.8) and the background blur matched, confirming one Skia pipeline gives the same pixels on
  both platforms. EXIF-rotated input (orientation 6) loads upright.
- Apple Foundation Models: the module builds, reports availability and issues the guided-generation request; on this
  development Mac the simulator reports "available" but the host lacks the model assets
  (`instruct_300m … not found in Model Catalog`), so generation fails and the cascade falls back as designed.

- Graceful failure in the simulator: a planner that rejects its key is tried once and then switched off for the
  session; an unreachable planner is skipped for a minute; both replies explain what happened.
- Saved sessions: edits made, app killed, session resumed: the re-rendered photo is bit-identical to the one before.

Not yet verified:
- Foundation Models / Gemini Nano generation quality on real hardware (needs an Apple Intelligence iPhone or a
  Gemini Nano-capable Android phone).
- The cloud worker against the live API (needs a free Gemini key: `cd server && npm run setup`, see `AI-PROVIDERS.md`).
- Voice input (needs a microphone; the simulator can't be scripted to speak) and performance on low-end Android.

Next steps, in order of value:
1. **Edge-aware mask refinement** (guided filter against the full-res photo) for hair-level precision.
2. **Mask arithmetic** in the schema (face ∩ reds → "reduce redness on my face"; face − eyes).
3. **Ukrainian** lexicon for the local parser + `uk-UA` speech recognition.
4. **More selectors**: a general subject/object segmenter (iOS `VNGenerateForegroundInstanceMaskRequest`,
   ML Kit Subject Segmentation on Android) and face-mesh landmarks for lips/teeth/brows.
5. Tone-curve and HSL-per-band adjustments; RAW/HEIF export; Display-P3 output.
6. App Attest / Play Integrity on the worker; EAS Update channel for the grammar.
