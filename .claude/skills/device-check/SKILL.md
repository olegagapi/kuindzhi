---
name: device-check
description: Run Kuindzhi on the iOS simulator and/or Android emulator with scripted commands, pull the full-resolution render plus a screenshot, and measure per-region changes against baselines. Use after changing shaders, masks, ML, the planner or the editor UI, before merging such a change, or to compare iOS and Android pixels.
---

# Device check

Jest runs the shaders on the CPU at full precision. This skill checks the real app on a real GPU path: the dev-script
hook (`src/dev/devScript.ts`) opens the editor, runs commands, and writes the full-resolution render to the app
cache. The runner pulls that render back to the Mac, where it can be measured.

## Prerequisites

- **A dev build installed:** run `npm run ios` / `npm run android` once, and again after native or `app.config.ts`
  changes. JS-only changes don't need a rebuild.
- **A booted simulator or emulator:**
  - iOS: `xcrun simctl list devices`, then `xcrun simctl boot <udid>`.
  - Android: `$ANDROID_HOME/emulator/emulator -avd <avd> -no-window -no-audio &`.
  - Android builds need JDK 17 (see `CLAUDE.md`).

## Run

```bash
S=.claude/skills/device-check/scripts
$S/run.sh ios '{"sample":"portrait","commands":["make my face brighter"]}' --name face   # or android | both
node $S/measure.mjs assets/samples/portrait.jpg "$DEVCHECK_DIR/face-ios.jpg" --preset portrait
$S/run.sh stop   # when done: stops the Metro and script server the runner started
```

**Script JSON keys:**
- `sample` (`portrait` | `sunset`), or `uri` (a `file://` path the app can read);
- `commands` (run in order);
- `save` (also runs the real Save to Photos), `resume` (opens the latest saved session).

`capture` is filled in from `--name`.

**Output:** in `$DEVCHECK_DIR` (default `$TMPDIR/kuindzhi-device-check`): `NAME-<platform>.jpg` (the full-res render),
`NAME-<platform>-screen.png` (look at it with Read to check the UI), and `metro.log`.

**Measuring:** `measure.mjs` prints, per box, the mean RGB before and after, the change in 8-bit levels, and "detail"
(which drops when a region is blurred). Presets: `portrait` (face, background) and `sunset` (a rough sky box and
ground box). For your own boxes, add `--box name=x0,y0,x1,y1` in frame fractions.

## Baselines (portrait sample, 2026-10-13)

| Command | iOS simulator | Android emulator |
|---|---|---|
| "make my face brighter" | face +17.0, background +0.6 | face +16.9, background +0.6 |
| "blur the background a lot" | background detail 2.27 → 0.13, face ±0.1 | (not recorded) |

**Treat as a regression to explain:**
- the face number moving more than about 1 level for the same command;
- iOS and Android differing by more than about 1 level.

When a change is meant to move a baseline, update this table in the same commit.

## What the runner handles (don't redo by hand)

- **Metro:** started with `EXPO_PUBLIC_DEV_SCRIPT_URL` (inlined at bundle time, hence `--clear`) and never in CI
  mode, because CI mode doesn't watch files.
  - If Metro was already running without that variable, the app ignores the script: `run.sh stop`, or stop the other
    Metro, then rerun.
  - Extra `EXPO_PUBLIC_*` variables (e.g. `EXPO_PUBLIC_PLANNER_URL` pointing at a fake planner to test failure
    handling) take effect only when the runner starts Metro, so stop it first.
- **iOS:** launches with `--initialUrl` (`simctl openurl` shows a confirmation alert the CLI can't dismiss).
  Pre-dismisses the dev menu's onboarding; the first time, that reboots the simulator once.
- **Android:** `adb reverse` for ports 8081 and 8099, launches via the `kuindzhi://expo-development-client` deep
  link, and reads the capture with `run-as`.
- **Waiting:** stale captures are deleted first, and the runner waits for the new file to reach a stable size.

## Limits

- **Expected in this simulator:** Apple Foundation Models report "available" but fail (this Mac lacks the model
  assets), and the cascade falls back. Test the on-device LLM on a real phone.
- **No touch:** voice and touch gestures (hold to compare, slider drags, hold-to-talk, hold to show the area) can't be
  scripted here. Verify them by hand or with screenshots.
