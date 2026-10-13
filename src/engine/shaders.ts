// SkSL sources. Skia compiles these at runtime on both iOS and Android (and in
// Jest via CanvasKit), so there is exactly one implementation of every algorithm.
//
// Conventions: children are evaluated in pixel coordinates of the output, colors
// arrive premultiplied in the surface's (sRGB-encoded) space. Photos are opaque,
// but every pass unpremultiplies anyway so masked blurs can reuse the helpers.

const COMMON = `
const float3 LUMA = float3(0.2126, 0.7152, 0.0722);

float luma(float3 c) { return dot(c, LUMA); }
float3 toLin(float3 c) { return pow(max(c, float3(0.0)), float3(2.2)); }
float3 toGam(float3 c) { return pow(max(c, float3(0.0)), float3(1.0 / 2.2)); }

float4 straight(half4 p) {
  float a = max(float(p.a), 0.0001);
  return float4(float3(p.rgb) / a, float(p.a));
}

float3 rgb2hsv(float3 c) {
  float4 K = float4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  float4 p = mix(float4(c.bg, K.wz), float4(c.gb, K.xy), step(c.b, c.g));
  float4 q = mix(float4(p.xyw, c.r), float4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return float3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

float3 hsv2rgb(float3 c) {
  float4 K = float4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  float3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

float hash(float2 p) {
  return fract(sin(dot(p, float2(12.9898, 78.233))) * 43758.5453);
}
`;

/**
 * One pass = one EditStep. `op` is the index of the adjustment in ADJUSTMENTS
 * (src/edits/catalog.ts) — keep the branch order below in sync with it.
 * `mask` is the region selection (r channel, 0..1), `blurred` a blurred copy of
 * `image` for ops that need one (or `image` itself otherwise).
 */
export const ADJUST_SKSL = `
uniform shader image;
uniform shader mask;
uniform shader blurred;
uniform float op;
uniform float amount;
uniform float2 size;
uniform float seed;
${COMMON}
half4 main(float2 xy) {
  float4 src = straight(image.eval(xy));
  float m = clamp(float(mask.eval(xy).r), 0.0, 1.0);
  if (m <= 0.0005) {
    return half4(half3(src.rgb * src.a), half(src.a));
  }
  float3 c = clamp(src.rgb, 0.0, 1.0);
  float a = amount;
  float L = luma(c);
  float3 r = c;
  int o = int(op + 0.5);

  if (o == 0) {
    // exposure: linear-light gain, soft shoulder so highlights don't clip
    float3 lin = toLin(c) * exp2(a * 2.0);
    if (a > 0.0) {
      float knee = 0.8;
      float3 over = max(lin - knee, 0.0);
      float3 soft = min(lin, float3(knee)) + (1.0 - knee) * (1.0 - exp(-over / (1.0 - knee)));
      lin = mix(min(lin, float3(1.0)), soft, smoothstep(0.0, 0.25, a));
    }
    r = toGam(lin);
  } else if (o == 1) {
    // brightness: midtone gamma, black and white points fixed
    r = pow(c, float3(exp2(-a * 0.9)));
  } else if (o == 2) {
    // contrast: symmetric power S-curve pivoting on mid grey
    float g = exp2(a * 1.3);
    float3 lo = 0.5 * pow(2.0 * c, float3(g));
    float3 hi = 1.0 - 0.5 * pow(2.0 * (1.0 - c), float3(g));
    r = mix(lo, hi, step(0.5, c));
  } else if (o == 3) {
    // highlights
    float w = smoothstep(0.45, 1.0, L);
    if (a < 0.0) {
      r = c * (1.0 + a * 0.45 * w);
    } else {
      r = c + (1.0 - c) * a * 0.5 * w;
    }
  } else if (o == 4) {
    // shadows: weighted gamma on dark tones
    float w = 1.0 - smoothstep(0.0, 0.6, L);
    r = pow(c, float3(exp2(-a * 1.2 * w)));
  } else if (o == 5) {
    // whites
    r = c * (1.0 + a * 0.25 * smoothstep(0.35, 1.0, L));
  } else if (o == 6) {
    // blacks
    r = c + a * 0.12 * (1.0 - smoothstep(0.0, 0.5, L));
  } else if (o == 7) {
    // saturation
    r = mix(float3(L), c, 1.0 + a);
  } else if (o == 8) {
    // vibrance: favours muted colours, protects skin hues (~0-50 degrees)
    float sat = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
    float h = rgb2hsv(c).x;
    float skin = 1.0 - 0.6 * smoothstep(0.0, 0.03, h) * (1.0 - smoothstep(0.1, 0.15, h));
    float k = a > 0.0 ? a * (1.0 - sat) * skin * 1.2 : a;
    r = mix(float3(L), c, 1.0 + k);
  } else if (o == 9) {
    // temperature: white-balance gains in linear light, luminance preserving
    float3 gains = float3(1.0 + 0.32 * a, 1.0 + 0.04 * a, 1.0 - 0.32 * a);
    gains /= dot(gains, LUMA);
    r = toGam(toLin(c) * gains);
  } else if (o == 10) {
    // tint: + magenta, - green
    float3 gains = float3(1.0 + 0.12 * a, 1.0 - 0.2 * a, 1.0 + 0.12 * a);
    gains /= dot(gains, LUMA);
    r = toGam(toLin(c) * gains);
  } else if (o == 11) {
    // hue rotation
    float3 hsv = rgb2hsv(c);
    hsv.x = fract(hsv.x + a * 0.5);
    r = hsv2rgb(hsv);
  } else if (o == 12) {
    // clarity: large-radius luminance detail, midtone weighted
    float3 b = straight(blurred.eval(xy)).rgb;
    float w = 1.0 - pow(abs(2.0 * L - 1.0), 2.0);
    r = c + (L - luma(b)) * a * 1.6 * w;
  } else if (o == 13) {
    // dehaze: subtract the local dark channel (haze estimate), restore saturation
    float3 b = straight(blurred.eval(xy)).rgb;
    if (a > 0.0) {
      float dark = min(b.r, min(b.g, b.b));
      float t = clamp(a * 0.75 * dark, 0.0, 0.85);
      r = (c - t) / (1.0 - t);
      r = mix(float3(luma(r)), r, 1.0 + 0.25 * a);
    } else {
      r = mix(c, float3(0.82, 0.84, 0.86), -a * 0.45);
    }
  } else if (o == 14) {
    // sharpen: unsharp mask
    float3 b = straight(blurred.eval(xy)).rgb;
    r = c + (c - b) * a * 2.0;
  } else if (o == 15) {
    // blur: strength lives in the blur radius
    r = straight(blurred.eval(xy)).rgb;
  } else if (o == 16) {
    // smooth: edge-preserving (only flatten pixels close to their local mean)
    float3 b = straight(blurred.eval(xy)).rgb;
    float3 d = c - b;
    float w = exp(-dot(d, d) / 0.006);
    r = mix(c, b, clamp(a * 0.9 * w, 0.0, 1.0));
  } else if (o == 17) {
    // vignette: elliptical, follows the frame
    float2 d = (xy / size - 0.5) * 2.0;
    float v = smoothstep(0.45, 1.3, length(d));
    if (a > 0.0) {
      r = c * (1.0 - a * 0.75 * v);
    } else {
      r = c + (1.0 - c) * (-a) * 0.6 * v;
    }
  } else if (o == 18) {
    // grain: resolution-relative cells, strongest in midtones
    float cellSize = max(1.0, max(size.x, size.y) / 1400.0);
    float2 cell = floor(xy / cellSize);
    float n = hash(cell + seed) + hash(cell * 1.37 + seed + 11.0) - 1.0;
    float w = 1.0 - 0.6 * pow(abs(2.0 * L - 1.0), 2.0);
    r = c + n * a * 0.12 * w;
  } else if (o == 19) {
    // fade: lifted blacks, softened whites, slight desaturation
    r = c * (1.0 - 0.18 * a) + 0.11 * a;
    r = mix(float3(luma(r)), r, 1.0 - 0.15 * a);
  } else if (o == 20) {
    // monochrome
    r = mix(c, float3(dot(c, float3(0.30, 0.59, 0.11))), a);
  } else if (o == 21) {
    // sepia
    float3 s = float3(
      dot(c, float3(0.393, 0.769, 0.189)),
      dot(c, float3(0.349, 0.686, 0.168)),
      dot(c, float3(0.272, 0.534, 0.131)));
    r = mix(c, s, a);
  }

  r = clamp(r, 0.0, 1.0);
  float3 outc = mix(c, r, m);
  return half4(half3(outc * src.a), half(src.a));
}
`;

/** Mask kinds for MASK_SKSL (index = `kind` uniform). */
export const MASK_KIND = {
  shadowAreas: 0,
  midtoneAreas: 1,
  highlightAreas: 2,
  colorBand: 3,
  top: 4,
  bottom: 5,
  left: 6,
  right: 7,
  center: 8,
  edges: 9,
} as const;

/** Tonal, colour and geometric masks computed from the original photo. */
export const MASK_SKSL = `
uniform shader image;
uniform float kind;
uniform float hueCenter;
uniform float hueWidth;
uniform float2 size;
${COMMON}
half4 main(float2 xy) {
  float3 c = clamp(straight(image.eval(xy)).rgb, 0.0, 1.0);
  float L = luma(c);
  float2 uv = xy / size;
  int k = int(kind + 0.5);
  float v = 0.0;
  if (k == 0) {
    v = 1.0 - smoothstep(0.12, 0.5, L);
  } else if (k == 1) {
    v = 1.0 - smoothstep(0.05, 0.35, abs(L - 0.5));
  } else if (k == 2) {
    v = smoothstep(0.5, 0.88, L);
  } else if (k == 3) {
    float3 hsv = rgb2hsv(c);
    float dh = abs(hsv.x - hueCenter);
    dh = min(dh, 1.0 - dh);
    v = (1.0 - smoothstep(hueWidth * 0.4, hueWidth, dh))
      * smoothstep(0.08, 0.25, hsv.y)
      * smoothstep(0.04, 0.15, hsv.z);
  } else if (k == 4) {
    v = 1.0 - smoothstep(0.0, 0.6, uv.y);
  } else if (k == 5) {
    v = smoothstep(0.4, 1.0, uv.y);
  } else if (k == 6) {
    v = 1.0 - smoothstep(0.0, 0.6, uv.x);
  } else if (k == 7) {
    v = smoothstep(0.4, 1.0, uv.x);
  } else if (k == 8) {
    v = 1.0 - smoothstep(0.15, 0.85, length((uv - 0.5) * 2.0));
  } else if (k == 9) {
    v = smoothstep(0.5, 1.3, length((uv - 0.5) * 2.0));
  }
  return half4(half3(v), 1.0);
}
`;

/**
 * Sky: brighter than the photo average (or clearly blue), smooth (low local
 * detail), in the upper part of the frame, and not a person. Works for blue,
 * overcast and sunset skies — no colour assumption on its own.
 */
export const SKY_SKSL = `
uniform shader image;
uniform shader blurred;
uniform shader person;
uniform float meanLuma;
uniform float2 size;
${COMMON}
half4 main(float2 xy) {
  float3 c = clamp(straight(image.eval(xy)).rgb, 0.0, 1.0);
  float3 b = clamp(straight(blurred.eval(xy)).rgb, 0.0, 1.0);
  float L = luma(c);
  float3 hsv = rgb2hsv(c);
  float blue = (1.0 - smoothstep(0.06, 0.16, abs(hsv.x - 0.58))) * smoothstep(0.1, 0.3, hsv.y) * smoothstep(0.2, 0.45, L);
  float bright = smoothstep(meanLuma * 0.85, meanLuma * 1.25, L) * smoothstep(0.12, 0.3, L);
  float smoothness = 1.0 - smoothstep(0.03, 0.11, length(c - b));
  float pos = 1.0 - smoothstep(0.35, 0.8, xy.y / size.y);
  float notPerson = 1.0 - float(person.eval(xy).r);
  float v = clamp(max(blue, bright) * smoothness * pos * notPerson * 1.5, 0.0, 1.0);
  return half4(half3(v), 1.0);
}
`;

/** 1 - mask. */
export const INVERT_SKSL = `
uniform shader mask;
half4 main(float2 xy) {
  half v = 1.0 - mask.eval(xy).r;
  return half4(v, v, v, 1.0);
}
`;

/** Image premultiplied by a mask — input to a normalized (mask-aware) blur. */
export const MASK_MULTIPLY_SKSL = `
uniform shader image;
uniform shader mask;
half4 main(float2 xy) {
  return image.eval(xy) * mask.eval(xy).r;
}
`;

/** Translucent selection overlay ("what Kuindzhi selected"), tinted with the palette accent. */
export const OVERLAY_SKSL = `
uniform shader mask;
uniform float3 tint;
half4 main(float2 xy) {
  half v = mask.eval(xy).r * 0.55;
  return half4(half3(tint) * v, v);
}
`;
