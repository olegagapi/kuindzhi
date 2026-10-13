# Kuindzhi — visual and interaction design

## The look

**A dark photo studio.** The walls are graphite, the type is warm white, and one loud colour is used, **film-box
yellow**, for whatever you can act on and for the selection overlay.
- **Why dark:** the photo is the brightest thing on screen, and you judge its tones against neutral surroundings.
  Bright chrome makes photos look darker than they are.
- **Why warm graphite:** the dark greys lean slightly yellow, so they sit with the accent instead of looking
  blue-grey next to it.
- **The moon:** a pale, cool "moon" tone is the one nod to Kuindzhi's *Moonlit Night on the Dnieper*. It's the glowing
  disc on the home screen, and it's also used for suggestions, the live transcript and the "analysis ready" dot.

The app is dark only (`userInterfaceStyle: 'dark'` in `app.config.ts`); there is no light theme.

## Colours: one source, used by role

`src/ui/palette.json` is the only place colour values exist. `src/ui/palette.ts` types it and documents each role,
`src/ui/theme.ts` exposes it to components as `colors`, `app.config.ts` reads it for native colours (these take effect
after `npx expo prebuild`), and the render engine passes the accent to the selection-overlay shader as a uniform.
Components and shaders never contain colour literals. The only exception is mask values (black/white) in the engine.

| Role | Used for |
|---|---|
| `bg` | Screen background, the native window background, Android adaptive-icon background |
| `surface` | Cards and fields: command input, chips, step panel, reply line, secondary buttons, thumbnails while loading |
| `surfaceHigh` | The mic button |
| `border` | Hairline borders, the unfilled part of the slider |
| `text` | Primary text and icons |
| `textMuted` | Secondary text: status, placeholders, amounts on unselected chips, where a reply came from |
| `accent` | Things you act on or have selected: primary button, selected chip, slider fill and value, send button, spinner, mic while listening, input border while listening, **selection overlay**; also the home tagline, its one decorative use |
| `accentInk` | Text and icons drawn on the accent |
| `moon` | Moon disc, suggestion pills, live transcript, "analysis ready" dot |
| `danger` | Remove, errors, the "Basic regions only" dot |
| `scrim` | Translucent backdrop for badges over the photo ("Original") |

**Contrast** (WCAG ratio with the current values): text on background 17.6, muted text 6.9, accent on background
13.0, ink on accent 12.2, danger 7.0. Every text pairing passes AA (4.5:1); keep it that way when changing the
palette.

**Changing a colour:** edit `palette.json` and nothing else. Run `npx expo prebuild` if `bg` changed.

## Type and shape

- **Type:** the system sans everywhere, plus a serif (Georgia on iOS, the system serif on Android) for the wordmark
  and tagline on the home screen only. Numbers that change while you drag (step amounts) use tabular figures so
  they don't jitter.
- **Radii** (`radius` in `theme.ts`):
  - `sm` 10: thumbnails, panel actions, reply line;
  - `md` 16: step panel;
  - `lg` 24: big buttons and the command field;
  - `pill`: chips, suggestions, badges.
- **Depth:** hairline borders instead of shadows. The moon's glow is the only shadow.

## Screens

**Home** (`src/app/index.tsx`), top to bottom:
1. Moon, wordmark, tagline ("Say how the light should fall."), one paragraph on what the app does.
2. **Continue editing**: thumbnails of autosaved sessions with "N edits · 5 min ago". Long-press one to remove it.
3. "Choose a photo" (the one primary button), then "Try a portrait" / "Try a sunset".
4. A footnote about the painter.

**Editor** (`src/app/editor.tsx`), top to bottom:
1. **Top bar:**
   - back;
   - analysis status: a dot and "Found 1 face, person, hair", or "Basic regions only" when a vision model failed;
   - undo, redo, Save to Photos, Share.
2. **Photo** (`PhotoView`): fills the free space. Hold it to see the original, with an "Original" badge.
3. **Reply line:** what was done and where it ran ("on this phone", "on-device AI", "cloud AI"), plus a plain note
   when a tier was skipped ("Offline, so this was handled on the phone."). Tap to dismiss.
4. **Step chips** (`StepChips`): one per step, e.g. "Face · Exposure +30". Tap to select. Steps that are off are
   dimmed.
5. **Step panel** (`StepPanel`, when a chip is selected):
   - title, plus the command that created the step and where it ran;
   - a slider;
   - On/Off, Invert, Hold: area, Remove.
6. **Command bar** (`CommandBar`): suggestion pills, the text field, and the hold-to-talk mic.

## Interaction principles

1. **Nothing is a black box.** Every command becomes ordinary steps you can see, adjust, switch off, invert or
   delete. A planner never applies anything you can't undo or fine-tune.
2. **Show the selection.** After a masked edit, the area flashes in the accent for 1.4 s. Invert flashes the new
   area. "Hold: area" shows it for as long as you hold.
3. **Compare by holding** the photo; let go to return.
4. **Hold to talk.** Pressing the mic starts listening, releasing stops it. The transcript appears live in the field
   (in the moon colour).
5. **One drag, one undo step.** Slider drags update the preview live but add to history once, on release.
6. **Say where the work happened.** Every reply carries its source, and fallbacks are explained in plain words.
7. **Nothing to save by hand.** Edits autosave, and the home screen offers to continue. Save to Photos and Share
   export at full resolution.
8. **Suggestions fit the photo.** Face, background, skin and eye suggestions appear only when those regions were
   found. "Undo" is offered once there is something to undo.
9. **Degrade, don't block.** If a build has no speech recognizer, the mic is dimmed and explains itself. If a vision
   model fails, the editor opens with "Basic regions only". If the cloud is unavailable, the reply says the command
   was handled on the phone.

## Accessibility

- Every icon button has an accessibility label, and chips report their selected state.
- The photo and mic labels describe their hold gestures.
- Contrast is covered above.

## Open items

- **App icon** is still the Expo template's (`assets/icon.png`, `assets/android-icon-*.png`), and no splash screen is
  configured (`assets/splash-icon.png` is an unused template file). Kuindzhi needs its own; the moon and the accent
  are the obvious material.
- **Hold gestures have no tap alternative** (compare, talk, show area). This is worth adding for accessibility.
- **Ukrainian UI and commands** are on the roadmap (`ARCHITECTURE.md`).
