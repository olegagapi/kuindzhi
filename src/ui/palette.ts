// Kuindzhi's colours are defined in one place, palette.json, so app.config.ts
// (native background, Android icon), the UI theme and the render engine
// (selection overlay) all read the same values. This module types them.
//
// The look: a dark studio — graphite walls, warm-white type, and film-box
// yellow for whatever you can act on.
//   bg / surface / surfaceHigh / border  graphite layers, darkest to lightest
//   text / textMuted                     warm white and its quiet variant
//   accent                               film-box yellow: primary actions, selected step, selection overlay
//   accentInk                            text and icons drawn on the accent
//   moon                                 secondary cool tone (suggestions, the home-screen moon)
//   danger                               destructive actions
//   scrim                                translucent backdrop for badges over the photo
import colors from './palette.json';

export const palette: Readonly<typeof colors> = colors;

export type PaletteColor = keyof typeof colors;

/** "#RRGGBB" → [r, g, b] in 0..1, for shader uniforms. */
export function hexToRgb01(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`Not a #RRGGBB colour: ${hex}`);
  return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255];
}
