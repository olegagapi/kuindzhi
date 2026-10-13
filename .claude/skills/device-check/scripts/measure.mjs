#!/usr/bin/env node
// Compare an edited capture with its original, region by region. No dependencies:
// decodes through macOS `sips` (JPEG/PNG -> BMP). Boxes are fractions of the frame,
// so the two images may differ in size.
//
//   node measure.mjs <original> <edited> [--preset portrait|sunset] [--box name=x0,y0,x1,y1 ...]
//
// Per box: mean RGB before/after, the mean change in 8-bit levels, and "detail"
// (mean absolute horizontal luma gradient; it drops when a region is blurred).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Boxes on the bundled samples (assets/samples/). Baselines are in SKILL.md.
const PRESETS = {
  portrait: { face: [0.27, 0.38, 0.36, 0.55], background: [0.7, 0.2, 0.95, 0.5] },
  sunset: { sky: [0.05, 0.03, 0.95, 0.3], ground: [0.05, 0.85, 0.95, 0.98] },
};

function decode(path) {
  const dir = mkdtempSync(join(tmpdir(), 'measure-'));
  try {
    const bmp = join(dir, 'x.bmp');
    execFileSync('sips', ['-s', 'format', 'bmp', path, '--out', bmp], { stdio: 'ignore' });
    const b = readFileSync(bmp);
    const offset = b.readUInt32LE(10);
    const width = b.readInt32LE(18);
    const rawHeight = b.readInt32LE(22);
    const bpp = b.readUInt16LE(28);
    if (bpp !== 24 && bpp !== 32) throw new Error(`${path}: unsupported BMP depth ${bpp}`);
    const height = Math.abs(rawHeight);
    const stride = Math.ceil((width * bpp) / 32) * 4;
    const px = bpp / 8;
    const topDown = rawHeight < 0;
    const rgb = (x, y) => {
      const row = topDown ? y : height - 1 - y;
      const i = offset + row * stride + x * px;
      return [b[i + 2], b[i + 1], b[i]];
    };
    return { width, height, rgb };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function stats(img, [x0, y0, x1, y1]) {
  const xa = Math.floor(x0 * img.width);
  const xb = Math.max(xa + 2, Math.floor(x1 * img.width));
  const ya = Math.floor(y0 * img.height);
  const yb = Math.max(ya + 1, Math.floor(y1 * img.height));
  const sum = [0, 0, 0];
  let detail = 0;
  let n = 0;
  for (let y = ya; y < yb; y++) {
    let prev = null;
    for (let x = xa; x < xb; x++) {
      const c = img.rgb(x, y);
      sum[0] += c[0];
      sum[1] += c[1];
      sum[2] += c[2];
      const l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
      if (prev !== null) detail += Math.abs(l - prev);
      prev = l;
      n++;
    }
  }
  return { mean: sum.map((s) => s / n), detail: detail / ((xb - xa - 1) * (yb - ya)) };
}

const args = process.argv.slice(2);
const files = [];
const boxes = { whole: [0, 0, 1, 1] };
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--preset') Object.assign(boxes, PRESETS[args[++i]] ?? {});
  else if (args[i] === '--box') {
    const [name, spec] = args[++i].split('=');
    boxes[name] = spec.split(',').map(Number);
  } else files.push(args[i]);
}
if (files.length !== 2) {
  console.error('usage: measure.mjs <original> <edited> [--preset portrait|sunset] [--box name=x0,y0,x1,y1]');
  process.exit(2);
}

const [a, b] = files.map(decode);
console.log(`original ${a.width}x${a.height}, edited ${b.width}x${b.height}`);
const f = (v) => v.toFixed(1).padStart(6);
for (const [name, box] of Object.entries(boxes)) {
  const s = stats(a, box);
  const t = stats(b, box);
  const delta = (t.mean[0] + t.mean[1] + t.mean[2] - s.mean[0] - s.mean[1] - s.mean[2]) / 3;
  console.log(
    `${name.padEnd(12)} rgb ${s.mean.map(f).join('')} -> ${t.mean.map(f).join('')}   change ${delta >= 0 ? '+' : ''}${delta.toFixed(1)} levels   detail ${s.detail.toFixed(2)} -> ${t.detail.toFixed(2)}`,
  );
}
