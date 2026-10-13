import type { Adjustment, Region } from '../../edits/catalog';
import { REGIONS } from '../../edits/catalog';
import type { ImageContext } from '../../edits/schema';
import { EN } from '../lexicon';
import { createLocalPlanner, normalize, parseLocally } from '../localParser';

const parse = (text: string, available?: Region[]) => parseLocally(text, available);
const steps = (text: string) => parse(text).plan.steps;
const amount = (text: string, adjustment: Adjustment, region: Region = 'all', invert = false) =>
  steps(text).find((s) => s.adjustment === adjustment && s.region === region && s.invert === invert)?.amount;
const summary = (text: string) =>
  steps(text)
    .map((s) => `${s.adjustment}@${s.invert ? '!' : ''}${s.region}=${s.amount}`)
    .sort();

describe('single adjustments', () => {
  test.each<[string, Adjustment, Region, number]>([
    ['make my face lighter', 'exposure', 'face', 0.3],
    ['Make my face lighter!', 'exposure', 'face', 0.3],
    ['brighten the photo', 'exposure', 'all', 0.3],
    ['darker', 'exposure', 'all', -0.3],
    ['warmer', 'temperature', 'all', 0.25],
    ['make it cooler', 'temperature', 'all', -0.25],
    ['more contrast', 'contrast', 'all', 0.25],
    ['less contrast', 'contrast', 'all', -0.25],
    ['flatter', 'contrast', 'all', -0.25],
    ['increase saturation', 'saturation', 'all', 0.25],
    ['reduce the saturation', 'saturation', 'all', -0.25],
    ['more vivid', 'vibrance', 'all', 0.35],
    ['make the colors pop', 'vibrance', 'all', 0.35],
    ['muted colors', 'saturation', 'all', -0.25],
    ['enhance the colours', 'vibrance', 'all', 0.35],
    ['black and white', 'monochrome', 'all', 1],
    ['make it B&W', 'monochrome', 'all', 1],
    ['sepia', 'sepia', 'all', 0.6],
    ['sharpen', 'sharpen', 'all', 0.4],
    ['more detail', 'clarity', 'all', 0.35],
    ['blur the background', 'blur', 'background', 0.5],
    ['portrait mode', 'blur', 'background', 0.5],
    ['add bokeh', 'blur', 'background', 0.5],
    ['smooth skin', 'smooth', 'skin', 0.5],
    ['retouch my face', 'smooth', 'face', 0.5],
    ['smooth', 'smooth', 'skin', 0.5],
    ['add a vignette', 'vignette', 'all', 0.4],
    ['remove the vignette', 'vignette', 'all', -0.4],
    ['add film grain', 'grain', 'all', 0.35],
    ['fade it', 'fade', 'all', 0.35],
    ['dehaze', 'dehaze', 'all', 0.35],
    ['add some haze', 'dehaze', 'all', -0.35],
    ['remove the haze', 'dehaze', 'all', 0.35],
    ['make the light warmer', 'temperature', 'all', 0.25],
    ['too pink', 'tint', 'all', -0.2],
    ['denoise', 'smooth', 'all', 0.35],
  ])('%s', (text, adjustment, region, expected) => {
    const result = parse(text);
    expect(result.confidence).toBe('full');
    expect(result.plan.intent).toBe('edit');
    expect(amount(text, adjustment, region)).toBe(expected);
  });

  test('"make the colors pop" is a single vibrance step', () => {
    expect(summary('make the colors pop')).toEqual(['vibrance@all=0.35']);
  });
});

describe('tones, whites and blacks', () => {
  test.each<[string, Adjustment, Region, number]>([
    ['recover the highlights', 'highlights', 'all', -0.35],
    ['lift the shadows', 'shadows', 'all', 0.35],
    ['brighten the shadows', 'shadows', 'all', 0.35],
    ['darken the highlights', 'highlights', 'all', -0.35],
    ['boost the highlights', 'highlights', 'all', 0.35],
    ['deepen the shadows', 'shadows', 'all', -0.35],
    ['more detail in the shadows', 'shadows', 'all', 0.35],
    ['make the shadows cooler', 'temperature', 'shadow-areas', -0.25],
    ['warm the highlights', 'temperature', 'highlight-areas', 0.25],
    ['deeper blacks', 'blacks', 'all', -0.25],
    ['crush the blacks', 'blacks', 'all', -0.25],
    ['brighter whites', 'whites', 'all', 0.25],
    ['the sky is blown out', 'highlights', 'sky', -0.35],
  ])('%s', (text, adjustment, region, expected) => {
    expect(amount(text, adjustment, region)).toBe(expected);
    expect(steps(text)).toHaveLength(1);
  });
});

describe('region-specific actions', () => {
  test('whiten teeth', () => {
    expect(summary('whiten my teeth')).toEqual(['exposure@mouth=0.15', 'saturation@mouth=-0.5']);
  });
  test('brighten her eyes adds a touch of clarity', () => {
    expect(summary('brighten her eyes')).toEqual(['clarity@eyes=0.2', 'exposure@eyes=0.3']);
  });
  test('make the eyes pop', () => {
    expect(summary('make the eyes pop')).toEqual(['clarity@eyes=0.3', 'exposure@eyes=0.2']);
  });
  test('bluer sky', () => {
    expect(summary('bluer sky')).toEqual(['saturation@sky=0.25', 'temperature@sky=-0.25']);
  });
  test('make the sky more blue', () => {
    expect(summary('make the sky more blue')).toEqual(['saturation@sky=0.25', 'temperature@sky=-0.25']);
  });
  test('bluer without a blue region just cools', () => {
    expect(summary('make it bluer')).toEqual(['temperature@all=-0.25']);
  });
  test('greener grass', () => {
    expect(summary('greener grass')).toEqual(['vibrance@greens=0.35']);
  });
  test('soften the face means skin smoothing', () => {
    expect(summary('soften the face')).toEqual(['smooth@face=0.5']);
  });
  test('softer on its own lowers clarity', () => {
    expect(summary('softer')).toEqual(['clarity@all=-0.35']);
  });
  test('the sunset', () => {
    expect(summary('make the sunset more vivid')).toEqual(['vibrance@oranges=0.35']);
  });
});

describe('intensity', () => {
  test.each<[string, Adjustment, number]>([
    ['a bit brighter', 'exposure', 0.15],
    ['slightly darker', 'exposure', -0.15],
    ['much brighter', 'exposure', 0.6],
    ['extremely warm', 'temperature', 0.75],
    ['very very dark', 'exposure', -0.9],
    ['brighten by 50%', 'exposure', 0.5],
    ['reduce saturation by 20%', 'saturation', -0.2],
    ['contrast +40%', 'contrast', 0.4],
    ['brighten by one stop', 'exposure', 0.5],
    ['darken by 2 stops', 'exposure', -1],
    ['half a stop brighter', 'exposure', 0.25],
    ['max contrast', 'contrast', 0.75],
    ['completely black and white', 'monochrome', 1],
    ['warmer but not too much', 'temperature', 0.13],
  ])('%s', (text, adjustment, expected) => {
    expect(amount(text, adjustment)).toBeCloseTo(expected, 2);
  });

  test('make the face a lot brighter', () => {
    expect(amount('make the face a lot brighter', 'exposure', 'face')).toBe(0.6);
  });

  test('amounts are clamped to the adjustment range', () => {
    expect(amount('brighten by 300%', 'exposure')).toBe(1);
    expect(amount('maximum blur on the background', 'blur', 'background')).toBe(1);
  });

  test('looks scale with intensity', () => {
    expect(amount('slightly vintage', 'sepia')).toBe(0.15);
    expect(amount('a little dramatic', 'contrast')).toBe(0.2);
  });
});

describe('"too", "less" and "not enough"', () => {
  test.each<[string, Adjustment, Region, number]>([
    ['the face is too dark', 'exposure', 'face', 0.3],
    ["it's too bright", 'exposure', 'all', -0.3],
    ['too warm', 'temperature', 'all', -0.25],
    ['way too saturated', 'saturation', 'all', -0.5],
    ['too much contrast', 'contrast', 'all', -0.25],
    ["it's not bright enough", 'exposure', 'all', 0.3],
    ['a bit too dark', 'exposure', 'all', 0.15],
    ['less warm', 'temperature', 'all', -0.25],
    ['less light', 'exposure', 'all', -0.3],
    ['it is too blurry', 'sharpen', 'all', 0.4],
  ])('%s', (text, adjustment, region, expected) => {
    expect(amount(text, adjustment, region)).toBe(expected);
  });

  test('an unknown state is reported, the known part still applies', () => {
    const result = parse('the background is too busy and too bright');
    expect(result.confidence).toBe('partial');
    expect(summary('the background is too busy and too bright')).toEqual(['exposure@background=-0.3']);
  });

  test('"less" on an add-only effect is left to the next tier', () => {
    const result = parse('less blur');
    expect(result.confidence).toBe('none');
    expect(result.plan.steps).toEqual([]);
    expect(result.unparsed.join(' ')).toMatch(/blur can only be added/);
  });
});

describe('inversion', () => {
  test.each<[string, Adjustment, Region]>([
    ['darken everything except me', 'exposure', 'person'],
    ['blur everything but the person', 'blur', 'person'],
    ['brighten the photo but not the face', 'exposure', 'face'],
    ['make it warmer apart from the sky', 'temperature', 'sky'],
    ['desaturate all but the reds', 'saturation', 'reds'],
  ])('%s', (text, adjustment, region) => {
    const result = parse(text);
    expect(result.confidence).toBe('full');
    expect(result.plan.steps).toHaveLength(1);
    expect(result.plan.steps[0]).toMatchObject({ adjustment, region, invert: true });
  });
});

describe('compound commands', () => {
  test('two clauses with their own regions', () => {
    expect(summary('make my face brighter and blur the background')).toEqual(['blur@background=0.5', 'exposure@face=0.3']);
  });
  test('comma separated list', () => {
    expect(summary('brighten the face, warm the background and add a vignette')).toEqual([
      'exposure@face=0.3',
      'temperature@background=0.25',
      'vignette@all=0.4',
    ]);
  });
  test('"and" carries the region to the next adjustment', () => {
    expect(summary('make the sky darker and more saturated')).toEqual(['exposure@sky=-0.3', 'saturation@sky=0.25']);
  });
  test('a bare region borrows the adjustment', () => {
    expect(summary('make the face and the hair brighter')).toEqual(['exposure@face=0.3', 'exposure@hair=0.3']);
  });
  test('lists of regions borrow the earlier adjustment', () => {
    expect(summary('warm up the face, hair and skin')).toEqual([
      'temperature@face=0.25',
      'temperature@hair=0.25',
      'temperature@skin=0.25',
    ]);
  });
  test('frame effects are not confined to the previous region', () => {
    expect(summary('brighten my face and add a vignette')).toEqual(['exposure@face=0.3', 'vignette@all=0.4']);
  });
  test('"then" starts a new context', () => {
    expect(summary('make the face warmer then sharper')).toEqual(['sharpen@all=0.4', 'temperature@face=0.25']);
  });
  test('two adjustments on the whole photo', () => {
    expect(summary('brighter and warmer')).toEqual(['exposure@all=0.3', 'temperature@all=0.25']);
  });
  test('sentences', () => {
    expect(summary('Brighten my face. Then blur the background a lot.')).toEqual(['blur@background=1', 'exposure@face=0.3']);
  });
  test('repeated adjustments are merged', () => {
    expect(summary('brighter, and a bit brighter')).toEqual(['exposure@all=0.45']);
  });
  test('a region spoken after the adjustment', () => {
    expect(summary('more contrast on the background')).toEqual(['contrast@background=0.25']);
  });
});

describe('looks', () => {
  test('vintage', () => {
    const s = steps('give it a vintage look');
    expect(s.map((x) => x.adjustment).sort()).toEqual(['fade', 'grain', 'sepia', 'temperature', 'vignette']);
    expect(amount('vintage', 'sepia')).toBe(0.3);
  });
  test('cinematic splits tones', () => {
    expect(amount('make it cinematic', 'temperature', 'highlight-areas')).toBe(0.25);
    expect(amount('make it cinematic', 'temperature', 'shadow-areas')).toBe(-0.3);
  });
  test('teal and orange stays one clause', () => {
    const result = parse('teal and orange look');
    expect(result.confidence).toBe('full');
    expect(amount('teal and orange look', 'temperature', 'shadow-areas')).toBe(-0.3);
  });
  test('film noir', () => {
    expect(amount('film noir', 'monochrome')).toBe(1);
    expect(amount('film noir', 'contrast')).toBe(0.45);
  });
  test('looks apply to a named region, without whole-frame effects', () => {
    expect(amount('make the background moody', 'exposure', 'background')).toBe(-0.2);
    expect(steps('make the sky dramatic').map((s) => s.adjustment).sort()).toEqual(['clarity', 'contrast', 'highlights']);
  });
  test('golden hour', () => {
    expect(amount('golden hour', 'temperature')).toBe(0.45);
  });
  test('bright and airy', () => {
    expect(amount('bright and airy', 'exposure')).toBe(0.4);
    expect(parse('bright and airy').confidence).toBe('full');
  });
  test('make it pop', () => {
    expect(summary('make it pop')).toEqual(['clarity@all=0.2', 'contrast@all=0.2', 'vibrance@all=0.4']);
  });
  test('film grain is grain, not the film look', () => {
    expect(summary('film grain')).toEqual(['grain@all=0.35']);
  });
});

describe('history and auto', () => {
  test.each<[string, string]>([
    ['undo', 'undo'],
    ['please undo that', 'undo'],
    ['go back', 'undo'],
    ['Undo the last edit.', 'undo'],
    ['redo', 'redo'],
    ['start over', 'reset'],
    ['revert everything', 'reset'],
    ['show me the original', 'reset'],
    ['remove all edits', 'reset'],
    ['auto enhance', 'auto-enhance'],
    ['fix it', 'auto-enhance'],
    ['make it better', 'auto-enhance'],
    ['improve this photo please', 'auto-enhance'],
  ])('%s → %s', (text, intent) => {
    const result = parse(text);
    expect(result.plan.intent).toBe(intent);
    expect(result.plan.steps).toEqual([]);
    expect(result.confidence).toBe('full');
  });

  test('"go back" is not triggered by "background"', () => {
    expect(parse('darken the background').plan.intent).toBe('edit');
  });

  test('fixing a specific region needs an LLM', () => {
    expect(parse('fix the lighting on my face').confidence).toBe('none');
  });
});

describe('generative requests', () => {
  test.each(['remove the person', 'add a sun', 'replace the sky', 'change my smile', 'make me look younger', 'erase the car'])(
    '%s',
    (text) => {
      const result = parse(text);
      expect(result.plan.intent).toBe('unsupported');
      expect(result.confidence).toBe('full');
      expect(result.plan.reply).toMatch(/only adjusts light/);
    },
  );

  test('mixed with a real edit', () => {
    const result = parse('remove the person and brighten the face');
    expect(result.plan.intent).toBe('edit');
    expect(result.confidence).toBe('partial');
    expect(summary('remove the person and brighten the face')).toEqual(['exposure@face=0.3']);
    expect(result.plan.reply).toMatch(/only adjusts light/);
  });

  test('"remove blemishes" is retouching, not generative', () => {
    expect(summary('remove blemishes')).toEqual(['smooth@skin=0.5']);
    expect(parse('remove blemishes').confidence).toBe('full');
  });
});

describe('things it does not understand', () => {
  test.each(['asdfgh', 'make it more like a Tuesday', '', '   ', 'hello there'])('%p', (text) => {
    const result = parse(text);
    expect(result.confidence).toBe('none');
    expect(result.plan.steps).toEqual([]);
  });

  test('partially understood', () => {
    const result = parse('brighten the face and asdf');
    expect(result.confidence).toBe('partial');
    expect(summary('brighten the face and asdf')).toEqual(['exposure@face=0.3']);
    expect(result.unparsed).toEqual(['"asdf"']);
  });

  test("negations are not guessed: don't blur the face", () => {
    expect(parse("don't blur the face").confidence).toBe('none');
  });

  test('"keep" clauses are left alone', () => {
    const result = parse('brighten the face while keeping the background dark');
    expect(result.confidence).toBe('partial');
    expect(summary('brighten the face while keeping the background dark')).toEqual(['exposure@face=0.3']);
  });
});

describe('available regions', () => {
  test('steps on missing regions are kept but flagged', () => {
    const result = parse('brighten my face', ['all', 'background']);
    expect(result.confidence).toBe('partial');
    expect(result.plan.steps).toEqual([{ adjustment: 'exposure', region: 'face', amount: 0.3, invert: false }]);
    expect(result.unparsed[0]).toMatch(/face/);
  });
  test('available region', () => {
    expect(parse('brighten my face', ['all', 'face']).confidence).toBe('full');
  });
});

describe('replies', () => {
  test.each([
    ['make my face brighter and blur the background', 'Brightened the face and blurred the background.'],
    ['warmer', 'Warmed the photo.'],
    ['more contrast', 'Added contrast.'],
    ['vintage', 'Applied a vintage look.'],
    ['darken everything except me', 'Darkened everything except the person.'],
    ['make the background moody', 'Applied a moody look to the background.'],
  ])('%s', (text, reply) => {
    expect(parse(text).plan.reply).toBe(reply);
  });
});

describe('createLocalPlanner', () => {
  const context: ImageContext = {
    regions: [...REGIONS],
    faces: 1,
    stats: { brightness: 0.5, contrast: 0.5, saturation: 0.5, warmth: 0 },
    history: [],
  };
  const planner = createLocalPlanner();

  test('resolves fully understood commands', async () => {
    expect(planner.source).toBe('local');
    await expect(planner.isAvailable()).resolves.toBe(true);
    await expect(planner.plan('warmer', context)).resolves.toMatchObject({ intent: 'edit', steps: [{ adjustment: 'temperature' }] });
  });

  test('throws so the cascade can try the next tier', async () => {
    await expect(planner.plan('make it look like a Monet', context)).rejects.toThrow(/Local parser/);
    await expect(planner.plan('brighten the face and asdf', context)).rejects.toThrow();
  });
});

describe('lexicon integrity', () => {
  const consuming = (): Array<[string, string]> => {
    const out: Array<[string, string]> = [];
    EN.regions.forEach((r) => r.phrases.forEach((p) => out.push([p, `region:${r.region}`])));
    EN.wholePhoto.forEach((p) => out.push([p, 'whole']));
    EN.except.forEach((p) => out.push([p, 'except']));
    EN.negation.forEach((p) => out.push([p, 'negation']));
    EN.terms.forEach((t) => t.phrases.forEach((p) => out.push([p, `term:${t.id}`])));
    EN.directions.forEach((d, i) => d.phrases.forEach((p) => out.push([p, `direction:${i}`])));
    EN.intensities.forEach((d) => d.phrases.forEach((p) => out.push([p, `intensity:${d.factor}`])));
    EN.too.forEach((p) => out.push([p, 'too']));
    EN.macros.forEach((m) => m.phrases.forEach((p) => out.push([p, `macro:${m.id}`])));
    EN.unsupported.forEach((p) => out.push([p, 'unsupported']));
    return out;
  };

  test('no phrase belongs to two token kinds', () => {
    const owners = new Map<string, string>();
    const clashes: string[] = [];
    for (const [phrase, owner] of consuming()) {
      const prev = owners.get(phrase);
      if (prev && prev !== owner) clashes.push(`${phrase}: ${prev} vs ${owner}`);
      owners.set(phrase, owner);
    }
    expect(clashes).toEqual([]);
  });

  test('every phrase survives normalization (otherwise it could never match)', () => {
    const broken = consuming()
      .map(([p]) => p)
      .filter((p) => normalize(p) !== p);
    expect(broken).toEqual([]);
  });

  test('every region in the lexicon exists in the catalog', () => {
    for (const r of EN.regions) expect(REGIONS).toContain(r.region);
  });
});

describe('unknown words', () => {
  it('reports content words no rule consumed', () => {
    const r = parseLocally('make it feel like a cold winter morning');
    expect(r.unknownWords).toEqual(expect.arrayContaining(['winter', 'morning']));
  });

  it('reports nothing for fully covered commands', () => {
    expect(parseLocally('please make my face a bit brighter').unknownWords).toEqual([]);
    expect(parseLocally('blur the background and warm up the photo').unknownWords).toEqual([]);
  });
});
