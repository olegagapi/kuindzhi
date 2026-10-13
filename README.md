# Kuindzhi

**Edit photos by saying what you want — with real photo algorithms, not generative redrawing.**

"Make my face lighter" becomes: find the face (on-device segmentation) → build a feathered mask → apply
exposure in linear light with a soft highlight shoulder, only inside that mask. Every command becomes editable
steps (slider, on/off, invert, show area), every pixel stays a function of your original, and the photo never
leaves the phone. Edits are saved automatically ("Continue editing" on the home screen), and everything except the
optional cloud planner works offline.

iOS + Android, React Native + Expo (SDK 57), Skia for the GPU pipeline, TFLite for on-device vision.
Design docs live in [`docs/`](docs/README.md): architecture, cost plan and roadmap ([`ARCHITECTURE.md`](docs/ARCHITECTURE.md)),
visual and interaction design ([`DESIGN.md`](docs/DESIGN.md)), testing strategy ([`TESTING.md`](docs/TESTING.md)) and
the cloud model choice ([`AI-PROVIDERS.md`](docs/AI-PROVIDERS.md)).
Visual walkthrough of the edit pipeline, with the real output of every stage: [`docs/pipeline.html`](docs/pipeline.html) (open in a browser).

## Run it

Prerequisites: Node 20+, Xcode 26 + CocoaPods (iOS), Android Studio with JDK 17 (Android).
Skia, TFLite and speech recognition are native modules, so this needs a **development build** — Expo Go won't work.

```bash
npm install
npm run ios         # = expo run:ios     (prebuild + build + launch in the simulator)
npm run android     # = expo run:android (JAVA_HOME must point to JDK 17)
npm start           # Metro only, once a dev build is installed
```

Try it without picking a photo: the home screen has two bundled CC0 samples.

**Scripted runs (dev builds only).** Start Metro with `EXPO_PUBLIC_DEV_SCRIPT_URL` pointing at a JSON file you
serve locally; on launch the home screen fetches it, opens the editor and runs the commands:

```bash
echo '{"sample":"portrait","commands":["blur the background a lot","smooth my skin"],"capture":"result"}' > /tmp/kz/demo.json
(cd /tmp/kz && python3 -m http.server 8099 &)
EXPO_PUBLIC_DEV_SCRIPT_URL=http://localhost:8099/demo.json npx expo start --dev-client --clear
xcrun simctl launch booted app.kuindzhi --initialUrl http://localhost:8081   # skips the dev-launcher screen
```

`capture` writes the full-resolution result to the app's `Library/Caches/<name>.jpg`
(`xcrun simctl get_app_container booted app.kuindzhi data`); `"save": true` also runs the real Save to Photos.
Deep links work too (`kuindzhi://editor?sample=portrait&command=…`), but iOS asks for confirmation first.

### Optional: cloud planner

Out of the box Kuindzhi is fully on-device (rule parser + Apple Foundation Models / Gemini Nano where the phone
supports them). For free-form commands those can't handle, deploy the tiny Cloudflare Worker in [`server/`](server/README.md)
with one command, `cd server && npm run setup` (Gemini 3.5 Flash-Lite on the free tier, no card; it writes `.env`
for you). Details and the provider comparison: [`docs/AI-PROVIDERS.md`](docs/AI-PROVIDERS.md).

## Develop

```bash
npm test                  # all Jest suites (parser, planner tiers, engine pixel tests in CanvasKit, ML decoding)
npx jest src/engine       # one folder; add -t "exposure" for one test
npm run typecheck         # tsc --noEmit
cd server && npm test     # worker tests (Gemini and Claude clients mocked)
```

| Path | What lives there |
|---|---|
| `src/edits/` | The contract: adjustment/region catalog, `EditPlan` zod schema, LLM prompt (shared with the worker) |
| `src/nlp/` | Planning cascade: local parser + lexicon, on-device LLM tier, cloud tier |
| `src/engine/` | SkSL shaders, render pipeline, masks, photo stats/auto-enhance, photo I/O |
| `src/ml/` | TFLite runners and pure decoders for MediaPipe selfie-multiclass segmentation and BlazeFace |
| `src/state/` | Undo/redo edit stack reducer |
| `src/app/`, `src/ui/` | Expo Router screens and components |
| `modules/on-device-llm/` | Local Expo module: Apple Foundation Models (Swift) and Gemini Nano (Kotlin) |
| `server/` | Cloudflare Worker → Gemini 3.5 Flash-Lite (or Claude Haiku 4.5) |
| `assets/models/` | `selfie_multiclass_256x256.tflite`, `blaze_face_short_range.tflite` (Google MediaPipe, Apache-2.0) |

Sample photos: see `assets/samples/CREDITS.md`.
