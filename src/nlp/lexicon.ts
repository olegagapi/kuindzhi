// Phrase tables for the local (tier-1) command parser.
//
// Everything language-specific lives here; localParser.ts only knows token kinds.
// Phrases are matched on normalized text (lower case, determiners like "the/my"
// stripped, contractions expanded), longest phrase first, on word boundaries.
//
// Next step: a Ukrainian lexicon (`UK`) with the same shape, selected by the
// speech-recognition locale. Ukrainian is inflected, so it will want stem
// matching (e.g. "світл" for світліше/освітли) rather than whole words.
import type { Adjustment, Region } from '../edits/catalog';

export interface Effect {
  adjustment: Adjustment;
  sign: 1 | -1;
  /** Absolute amount instead of ADJUSTMENT_INFO[adjustment].step. */
  fixed?: number;
}

/** A word/phrase that implies one or more adjustments ("warmer", "contrast"). */
export interface Term {
  id: string;
  phrases: string[];
  effects: Effect[];
  /** Region used when the clause names none. */
  defaultRegion?: Region;
  /** defaultRegion wins over region inheritance from a previous clause. */
  forceRegion?: boolean;
  /** Different effects when applied to a particular region ("bluer sky"). */
  regionOverrides?: Partial<Record<Region, Effect[]>>;
  /** Plain lighter/darker words: act as a direction for tonal targets ("brighter whites"). */
  exposureFamily?: boolean;
  /** Whole-frame effects never inherit a region from a previous clause. */
  frameLevel?: boolean;
  /** Generic nouns ("colors", "light") that only count when nothing more specific is said: "muted colors". */
  weak?: boolean;
}

export interface Direction {
  phrases: string[];
  sign: 1 | -1;
  /** Sign used for tonal targets (shadows/blacks/exposure): "deeper shadows" = darker. */
  tonalSign?: 1 | -1;
}

export interface Intensity {
  phrases: string[];
  factor: number;
}

export interface RegionPhrase {
  region: Region;
  phrases: string[];
}

export interface MacroStep {
  adjustment: Adjustment;
  amount: number;
  /** Fixed region; otherwise the clause's region (default: whole photo). */
  region?: Region;
}

export interface Macro {
  id: string;
  /** Used in replies: "Applied a vintage look." */
  label: string;
  phrases: string[];
  steps: MacroStep[];
  regionOverrides?: Partial<Record<Region, MacroStep[]>>;
}

export interface Lexicon {
  regions: RegionPhrase[];
  /** Explicit "whole photo" words. */
  wholePhoto: string[];
  /** "except X", "other than X" → X inverted. */
  except: string[];
  /** "not X" → X inverted, only directly before a region. */
  not: string[];
  /** "don't blur the face", "keep the background dark" — too risky to guess; left to an LLM. */
  negation: string[];
  terms: Term[];
  directions: Direction[];
  intensities: Intensity[];
  /** Inverts the direction: "too dark" → brighter. */
  too: string[];
  macros: Macro[];
  /** "enhance", "fix it" — only when nothing more specific is said. */
  auto: string[];
  /** Verbs that make a request generative when nothing adjustable is found. */
  generativeVerbs: string[];
  /** Always generative: "make me look younger". */
  unsupported: string[];
  /** Whole-command history intents (checked before clause parsing). */
  history: { undo: string[]; redo: string[]; reset: string[] };
  /** Words allowed around a history command ("please undo that"). */
  filler: string[];
  /** Function words that carry no editing meaning (ignored when reporting unknown words). */
  stopwords: string[];
}

const up = (adjustment: Adjustment, fixed?: number): Effect => ({ adjustment, sign: 1, fixed });
const down = (adjustment: Adjustment, fixed?: number): Effect => ({ adjustment, sign: -1, fixed });

export const EN: Lexicon = {
  regions: [
    { region: 'face', phrases: ['face', 'faces', 'facial', 'complexion', 'cheeks', 'forehead', 'face skin'] },
    { region: 'skin', phrases: ['skin', 'skin tone', 'skin tones', 'body skin', 'arms', 'legs'] },
    { region: 'hair', phrases: ['hair', 'hairs', 'hairstyle', 'beard'] },
    {
      region: 'clothes',
      phrases: ['clothes', 'clothing', 'outfit', 'shirt', 't shirt', 'dress', 'jacket', 'coat', 'sweater', 'jeans', 'pants', 'suit', 'hoodie'],
    },
    {
      region: 'person',
      phrases: [
        'me', 'myself', 'us', 'person', 'people', 'subject', 'subjects', 'him', 'her', 'them', 'model', 'man', 'woman',
        'girl', 'boy', 'guy', 'kid', 'kids', 'child', 'children', 'baby', 'family', 'couple', 'body', 'figure',
      ],
    },
    {
      region: 'background',
      phrases: [
        'background', 'backgrounds', 'behind me', 'behind him', 'behind her', 'behind them', 'behind us',
        'behind person', 'backdrop', 'surroundings', 'bg',
      ],
    },
    { region: 'eyes', phrases: ['eyes', 'eye', 'irises', 'iris', 'pupils'] },
    { region: 'mouth', phrases: ['teeth', 'tooth', 'smile', 'lips', 'lip', 'mouth'] },
    { region: 'sky', phrases: ['sky', 'skies', 'clouds', 'cloud', 'heavens'] },
    {
      region: 'shadow-areas',
      phrases: ['shadows', 'shadow', 'shadow areas', 'dark areas', 'dark parts', 'darks', 'dark tones', 'darker areas', 'lowlights'],
    },
    { region: 'midtone-areas', phrases: ['midtones', 'mid tones', 'middle tones', 'mids'] },
    {
      region: 'highlight-areas',
      phrases: ['highlights', 'highlight areas', 'bright areas', 'bright parts', 'brights', 'light areas', 'lighter areas', 'bright tones', 'light tones'],
    },
    { region: 'reds', phrases: ['reds', 'red', 'red tones', 'red colors', 'crimson'] },
    { region: 'oranges', phrases: ['oranges', 'orange', 'orange tones', 'sunset', 'sunsets'] },
    { region: 'yellows', phrases: ['yellows', 'yellow', 'yellow tones'] },
    {
      region: 'greens',
      phrases: ['greens', 'green', 'green tones', 'foliage', 'grass', 'trees', 'tree', 'leaves', 'plants', 'greenery', 'forest', 'lawn', 'vegetation'],
    },
    { region: 'aquas', phrases: ['aquas', 'aqua', 'cyan', 'cyans', 'teal', 'turquoise', 'pool', 'lagoon'] },
    { region: 'blues', phrases: ['blues', 'blue', 'blue tones', 'water', 'sea', 'ocean', 'lake', 'river'] },
    { region: 'purples', phrases: ['purples', 'purple', 'violet', 'lavender'] },
    { region: 'magentas', phrases: ['magentas', 'pinks', 'fuchsia'] },
    { region: 'top', phrases: ['top', 'top half', 'top part', 'upper', 'upper part', 'upper half', 'upper area'] },
    { region: 'bottom', phrases: ['bottom', 'bottom half', 'bottom part', 'lower part', 'lower half', 'lower area', 'foreground', 'ground'] },
    { region: 'left', phrases: ['left', 'left side', 'left half', 'left part'] },
    { region: 'right', phrases: ['right', 'right side', 'right half', 'right part'] },
    { region: 'center', phrases: ['center', 'centre', 'middle', 'central part'] },
    { region: 'edges', phrases: ['edges', 'edge', 'corners', 'borders', 'frame edges', 'sides', 'periphery'] },
  ],
  wholePhoto: [
    'everything', 'whole photo', 'whole image', 'whole picture', 'whole thing', 'entire photo', 'entire image',
    'entire picture', 'photo', 'image', 'picture', 'pic', 'shot', 'it', 'overall', 'globally', 'all',
  ],
  except: ['except', 'except for', 'excluding', 'other than', 'apart from', 'aside from', 'besides'],
  not: ['not'],
  negation: [
    'do not', 'dont', 'never', 'does not', 'should not', 'keep', 'keeping', 'leave', 'leaving', 'preserve', 'preserving',
  ],
  terms: [
    {
      id: 'brighten',
      phrases: [
        'lighter', 'brighter', 'lighten', 'lightened', 'lightening', 'brighten', 'brightened', 'brightening',
        'illuminate', 'light up', 'bright', 'underexposed', 'under exposed', 'more exposed',
      ],
      effects: [up('exposure')],
      exposureFamily: true,
      regionOverrides: { eyes: [up('exposure'), up('clarity', 0.2)] },
    },
    {
      id: 'darken',
      phrases: ['darker', 'darken', 'darkened', 'darkening', 'dim', 'dimmer', 'dark', 'overexposed', 'over exposed'],
      effects: [down('exposure')],
      exposureFamily: true,
    },
    { id: 'light', phrases: ['light'], effects: [up('exposure')], exposureFamily: true, weak: true },
    { id: 'exposure', phrases: ['exposure'], effects: [up('exposure')] },
    { id: 'brightness', phrases: ['brightness'], effects: [up('brightness')] },
    { id: 'contrast', phrases: ['contrast', 'contrasty', 'punchier', 'punch', 'high contrast'], effects: [up('contrast')] },
    { id: 'flatter', phrases: ['flatter', 'flat', 'low contrast', 'softer contrast'], effects: [down('contrast')] },
    {
      id: 'warmer',
      phrases: ['warmer', 'warm', 'warm up', 'warmth', 'golden', 'more yellow', 'yellower', 'warmer tones', 'sunnier'],
      effects: [up('temperature')],
    },
    {
      id: 'cooler',
      phrases: ['cooler', 'cool', 'cool down', 'colder', 'cold', 'icy', 'chillier', 'cool tones', 'cooler tones'],
      effects: [down('temperature')],
    },
    {
      id: 'bluer',
      phrases: ['bluer', 'more blue', 'bluer tones'],
      effects: [down('temperature')],
      regionOverrides: {
        sky: [up('saturation'), down('temperature')],
        blues: [up('saturation'), down('temperature')],
        aquas: [up('saturation'), down('temperature')],
      },
    },
    {
      id: 'greener',
      phrases: ['greener', 'more green'],
      effects: [down('tint')],
      regionOverrides: { greens: [up('vibrance')] },
    },
    {
      id: 'magenta',
      phrases: ['more magenta', 'pinker', 'more pink', 'magenta tint', 'pink tint', 'magenta cast', 'pink cast', 'magenta', 'pink'],
      effects: [up('tint')],
    },
    { id: 'green-tint', phrases: ['green tint', 'green cast'], effects: [down('tint')] },
    { id: 'tint', phrases: ['tint'], effects: [up('tint')] },
    { id: 'saturate', phrases: ['saturated', 'saturate', 'saturation'], effects: [up('saturation')] },
    { id: 'oversaturated', phrases: ['oversaturated', 'over saturated'], effects: [down('saturation')] },
    {
      id: 'vivid',
      phrases: [
        'vivid', 'vibrant', 'vibrance', 'colorful', 'colourful', 'more color', 'more colors', 'more colour', 'more colours',
        'colors pop', 'colours pop', 'rich colors', 'richer colors', 'richer', 'rich', 'undersaturated',
        'under saturated', 'add color', 'add colour',
      ],
      effects: [up('vibrance')],
    },
    { id: 'colors', phrases: ['colors', 'colours', 'color', 'colour'], effects: [up('vibrance')], weak: true },
    {
      id: 'mute',
      phrases: [
        'muted', 'mute', 'desaturate', 'desaturated', 'washed out', 'less color', 'less colors', 'less colour',
        'less colours', 'dull', 'duller',
      ],
      effects: [down('saturation')],
    },
    {
      id: 'monochrome',
      phrases: ['monochrome', 'grayscale', 'greyscale', 'gray scale', 'grey scale', 'colorless', 'remove color', 'remove colors', 'remove colour'],
      effects: [up('monochrome')],
      frameLevel: true,
    },
    { id: 'sepia', phrases: ['sepia', 'sepia tone', 'sepia toned'], effects: [up('sepia')], frameLevel: true },
    {
      id: 'sharpen',
      phrases: [
        'sharpen', 'sharper', 'sharp', 'sharpness', 'crisper', 'crisp', 'crispy', 'more defined', 'defined', 'unblur',
        'deblur', 'less blurry', 'too blurry', 'too blurred', 'too soft',
      ],
      effects: [up('sharpen')],
    },
    { id: 'clarity', phrases: ['clarity', 'texture', 'detail', 'details', 'definition'], effects: [up('clarity')] },
    {
      id: 'shadow-detail',
      phrases: [
        'detail in shadows', 'details in shadows', 'shadow detail', 'shadow details', 'open shadows', 'open up shadows',
        'lift shadows', 'bring out shadows',
      ],
      effects: [up('shadows')],
    },
    {
      id: 'recover-highlights',
      phrases: [
        'recover highlights', 'tone down highlights', 'reduce highlights', 'tame highlights', 'blown out', 'blown highlights',
        'less blown out', 'blown out highlights', 'highlight recovery',
      ],
      effects: [down('highlights')],
    },
    { id: 'dehaze', phrases: ['dehaze', 'remove haze', 'clearer', 'less foggy', 'less hazy', 'haze removal'], effects: [up('dehaze')] },
    { id: 'haze', phrases: ['haze', 'hazy', 'foggy', 'fog', 'mist', 'misty', 'atmosphere', 'atmospheric'], effects: [down('dehaze')] },
    { id: 'blur', phrases: ['blur', 'blurry', 'blurred', 'blurrier', 'defocus', 'defocused', 'out of focus', 'soft focus'], effects: [up('blur')] },
    {
      id: 'bokeh',
      phrases: ['bokeh', 'portrait mode', 'portrait effect', 'background blur', 'blurred background', 'blurry background'],
      effects: [up('blur')],
      defaultRegion: 'background',
      forceRegion: true,
    },
    {
      id: 'smooth',
      phrases: [
        'smooth', 'smoother', 'smoothen', 'smooth out', 'smoothing', 'retouch', 'retouched', 'airbrush', 'remove blemishes',
        'remove spots', 'remove acne', 'remove pimples', 'remove wrinkles', 'clear skin', 'clearer skin', 'flawless',
        'skin smoothing', 'soften skin',
      ],
      effects: [up('smooth')],
      defaultRegion: 'skin',
    },
    {
      id: 'soften',
      phrases: ['soft', 'softer', 'soften', 'softened'],
      effects: [down('clarity')],
      regionOverrides: { face: [up('smooth')], skin: [up('smooth')], person: [up('smooth')] },
    },
    {
      id: 'denoise',
      phrases: ['denoise', 'reduce noise', 'remove noise', 'less noise', 'less noisy', 'too noisy', 'noise reduction', 'noisy'],
      effects: [up('smooth', 0.35)],
    },
    { id: 'vignette', phrases: ['vignette', 'vignetting', 'vignetted'], effects: [up('vignette')], frameLevel: true },
    { id: 'grain', phrases: ['grain', 'grainy', 'film grain', 'noise'], effects: [up('grain')], frameLevel: true },
    { id: 'fade', phrases: ['fade', 'faded'], effects: [up('fade')], frameLevel: true },
    { id: 'whites', phrases: ['whites', 'white point'], effects: [up('whites')] },
    { id: 'blacks', phrases: ['blacks', 'black point'], effects: [up('blacks')] },
    { id: 'hue', phrases: ['hue', 'hues', 'hue shift', 'shift hue', 'shift hues'], effects: [up('hue')] },
    {
      id: 'whiten',
      phrases: ['whiten', 'whiter', 'whitening', 'brighter smile', 'whiter smile'],
      effects: [down('saturation', 0.5), up('exposure', 0.15)],
      defaultRegion: 'mouth',
    },
  ],
  directions: [
    {
      sign: 1,
      phrases: [
        'more', 'increase', 'increased', 'boost', 'add', 'raise', 'lift', 'up', 'higher', 'extra', 'stronger', 'bump up',
        'bump', 'push', 'crank up', 'crank', 'turn up', 'emphasize', 'emphasise', 'enhance', 'intensify', 'amplify',
        'strengthen', 'bring out', 'bring up', 'too little', 'not enough',
      ],
    },
    {
      sign: -1,
      phrases: [
        'less', 'reduce', 'reduced', 'decrease', 'lower', 'remove', 'cut', 'tone down', 'tame', 'minimize', 'minimise',
        'weaken', 'drop', 'turn down', 'lessen', 'dial back', 'dial down', 'down', 'bring down', 'fewer', 'recover',
        'crush', 'get rid of', 'eliminate', 'kill', 'not as', 'not so', 'without',
      ],
    },
    { sign: 1, tonalSign: -1, phrases: ['deeper', 'deepen', 'richer blacks'] },
  ],
  intensities: [
    {
      factor: 0.5,
      phrases: [
        'slightly', 'slight', 'a bit', 'a little', 'a little bit', 'little bit', 'just a bit', 'a touch', 'touch', 'subtly',
        'subtle', 'somewhat', 'a tad', 'tad', 'gently', 'gentle', 'lightly', 'a smidge', 'mildly', 'mild', 'barely',
        'a hint', 'hint of',
      ],
    },
    {
      factor: 2,
      phrases: [
        'much', 'a lot', 'lot', 'lots', 'very', 'really', 'way', 'significantly', 'strongly', 'strong', 'heavily', 'heavy',
        'considerably', 'far', 'seriously', 'quite a bit', 'a ton', 'tons', 'noticeably', 'dramatically', 'substantially',
        'greatly',
      ],
    },
    {
      factor: 3,
      phrases: [
        'extremely', 'super', 'massively', 'max', 'maximum', 'maximal', 'hugely', 'insanely', 'intensely',
        'as much as possible', 'all way', 'crazy', 'ultra', 'totally', 'completely', 'fully',
      ],
    },
  ],
  too: ['too', 'overly', 'too much', 'too many'],
  macros: [
    {
      id: 'vintage',
      label: 'a vintage look',
      phrases: ['vintage', 'retro', 'old school', 'old photo', 'nostalgic', 'seventies', '70s'],
      steps: [
        { adjustment: 'fade', amount: 0.35 },
        { adjustment: 'sepia', amount: 0.3 },
        { adjustment: 'temperature', amount: 0.15 },
        { adjustment: 'grain', amount: 0.3 },
        { adjustment: 'vignette', amount: 0.3 },
      ],
    },
    {
      id: 'film',
      label: 'a film look',
      phrases: ['film', 'film look', 'analog', 'analogue', 'kodak', 'polaroid'],
      steps: [
        { adjustment: 'fade', amount: 0.25 },
        { adjustment: 'grain', amount: 0.35 },
        { adjustment: 'contrast', amount: 0.1 },
        { adjustment: 'temperature', amount: 0.1 },
      ],
    },
    {
      id: 'cinematic',
      label: 'a cinematic look',
      phrases: ['cinematic', 'movie', 'movie look', 'cinema', 'hollywood', 'blockbuster'],
      steps: [
        { adjustment: 'contrast', amount: 0.25 },
        { adjustment: 'temperature', amount: 0.25, region: 'highlight-areas' },
        { adjustment: 'temperature', amount: -0.3, region: 'shadow-areas' },
        { adjustment: 'fade', amount: 0.15 },
        { adjustment: 'vignette', amount: 0.2 },
      ],
    },
    {
      id: 'dramatic',
      label: 'a dramatic look',
      phrases: ['dramatic', 'drama', 'epic'],
      steps: [
        { adjustment: 'contrast', amount: 0.4 },
        { adjustment: 'clarity', amount: 0.35 },
        { adjustment: 'highlights', amount: -0.3 },
        { adjustment: 'vignette', amount: 0.3 },
      ],
    },
    {
      id: 'moody',
      label: 'a moody look',
      phrases: ['moody', 'gloomy', 'dark mood', 'somber', 'sombre'],
      steps: [
        { adjustment: 'exposure', amount: -0.2 },
        { adjustment: 'saturation', amount: -0.25 },
        { adjustment: 'temperature', amount: -0.15 },
        { adjustment: 'fade', amount: 0.15 },
        { adjustment: 'vignette', amount: 0.3 },
      ],
    },
    {
      id: 'pop',
      label: 'more pop',
      phrases: ['pop', 'punchy', 'vivid look', 'poppy'],
      steps: [
        { adjustment: 'vibrance', amount: 0.4 },
        { adjustment: 'contrast', amount: 0.2 },
        { adjustment: 'clarity', amount: 0.2 },
      ],
      regionOverrides: {
        eyes: [
          { adjustment: 'exposure', amount: 0.2 },
          { adjustment: 'clarity', amount: 0.3 },
        ],
      },
    },
    {
      id: 'matte',
      label: 'a matte look',
      phrases: ['matte', 'matte look', 'matt'],
      steps: [
        { adjustment: 'fade', amount: 0.4 },
        { adjustment: 'contrast', amount: -0.15 },
        { adjustment: 'saturation', amount: -0.1 },
      ],
    },
    {
      id: 'dreamy',
      label: 'a dreamy look',
      phrases: ['dreamy', 'ethereal', 'soft look', 'dreamlike', 'dream'],
      steps: [
        { adjustment: 'clarity', amount: -0.4 },
        { adjustment: 'exposure', amount: 0.1 },
        { adjustment: 'fade', amount: 0.15 },
        { adjustment: 'highlights', amount: 0.15 },
      ],
    },
    {
      id: 'golden',
      label: 'a golden-hour look',
      phrases: ['golden hour', 'golden look', 'sunset look', 'warm glow', 'golden glow'],
      steps: [
        { adjustment: 'temperature', amount: 0.45 },
        { adjustment: 'tint', amount: 0.1 },
        { adjustment: 'vibrance', amount: 0.2 },
        { adjustment: 'highlights', amount: -0.15 },
      ],
    },
    {
      id: 'cold',
      label: 'a cold look',
      phrases: ['cold look', 'nordic', 'icy look', 'wintry', 'winter look', 'scandinavian'],
      steps: [
        { adjustment: 'temperature', amount: -0.4 },
        { adjustment: 'saturation', amount: -0.2 },
        { adjustment: 'exposure', amount: 0.1 },
      ],
    },
    {
      id: 'noir',
      label: 'a noir look',
      phrases: ['noir', 'film noir'],
      steps: [
        { adjustment: 'monochrome', amount: 1 },
        { adjustment: 'contrast', amount: 0.45 },
        { adjustment: 'blacks', amount: -0.2 },
        { adjustment: 'vignette', amount: 0.4 },
      ],
    },
    {
      id: 'high-key',
      label: 'a bright, airy look',
      phrases: ['high key', 'airy', 'bright airy'],
      steps: [
        { adjustment: 'exposure', amount: 0.4 },
        { adjustment: 'contrast', amount: -0.2 },
        { adjustment: 'shadows', amount: 0.3 },
      ],
    },
    {
      id: 'low-key',
      label: 'a low-key look',
      phrases: ['low key'],
      steps: [
        { adjustment: 'exposure', amount: -0.35 },
        { adjustment: 'contrast', amount: 0.3 },
        { adjustment: 'vignette', amount: 0.3 },
      ],
    },
  ],
  auto: [
    'auto', 'autofix', 'auto fix', 'auto enhance', 'autoenhance', 'auto correct', 'enhance', 'fix', 'fix it', 'improve',
    'better', 'look better', 'nicer', 'look good', 'look nice', 'magic',
  ],
  generativeVerbs: [
    'remove', 'erase', 'delete', 'get rid of', 'add', 'insert', 'put', 'place', 'replace', 'swap', 'move', 'change',
    'draw', 'paint', 'generate', 'create', 'give', 'turn into', 'disappear', 'make disappear',
  ],
  unsupported: [
    'younger', 'older', 'thinner', 'slimmer', 'skinnier', 'fatter', 'taller', 'shorter', 'more muscular', 'muscular',
    'happier', 'open eyes', 'close eyes', 'closed eyes', 'face swap', 'change expression',
  ],
  history: {
    undo: ['undo', 'go back', 'take back', 'take it back', 'revert last', 'revert last one', 'revert', 'step back', 'back', 'oops'],
    redo: ['redo', 'redo it'],
    reset: [
      'reset', 'reset all', 'reset everything', 'start over', 'start again', 'revert everything', 'revert all',
      'remove all edits', 'remove edits', 'clear edits', 'clear all', 'clear everything', 'undo everything', 'undo all',
      'original', 'back to original', 'go back to original', 'show original', 'remove all',
    ],
  },
  filler: [
    'please', 'can', 'could', 'would', 'you', 'i', 'want', 'to', 'just', 'ok', 'okay', 'now', 'it', 'last', 'edit',
    'edits', 'change', 'changes', 'step', 'one', 'again', 'actually', 'hmm', 'oh', 'all', 'a', 'let', 'us', 'lets',
    'that', 'go', 'version', 'show', 'me', 'see', 'photo', 'image', 'picture', 'thanks', 'thank', 'hey', 'kuindzhi',
  ],
  stopwords: [
    'make', 'makes', 'made', 'making', 'give', 'get', 'set', 'turn', 'put', 'apply', 'add', 'use', 'try', 'the', 'this',
    'these', 'those', 'its', 'and', 'but', 'for', 'with', 'from', 'into', 'onto', 'over', 'off', 'out', 'about', 'around',
    'than', 'then', 'also', 'plus', 'some', 'any', 'bit', 'tad', 'little', 'kind', 'sort', 'look', 'looks', 'looking',
    'like', 'feel', 'feels', 'feeling', 'seem', 'seems', 'are', 'was', 'were', 'been', 'being', 'very', 'really', 'quite',
    'pretty', 'too', 'much', 'more', 'less', 'lot', 'lots', 'way', 'our', 'your', 'his', 'their', 'there', 'here', 'what',
    'which', 'how', 'whole', 'entire', 'everything', 'overall', 'shot', 'pic', 'selfie', 'portrait', 'little', 'tiny',
    'should', 'will', 'shall', 'might', 'maybe', 'need', 'needs', 'keep', 'stay', 'same', 'area', 'part', 'parts',
    'side', 'region', 'zone', 'tone', 'tones', 'color', 'colors', 'colour', 'colours', 'light', 'lighting', 'slightly',
  ],
};
