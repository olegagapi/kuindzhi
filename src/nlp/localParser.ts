// Tier-1 planner: a deterministic phrase parser. Free, offline and instant, it
// handles the common commands ("make my face lighter", "blur the background
// a lot", "vintage look") and reports how sure it is so the cascade can hand
// anything it doesn't fully understand to an LLM tier.
import { ADJUSTMENT_INFO, type Adjustment, type Region } from '../edits/catalog';
import { normalizePlan, type EditPlan, type Intent, type PlanStep } from '../edits/schema';
import { EN, type Effect, type Lexicon, type Macro, type Term } from './lexicon';
import type { Planner } from './types';

export type Confidence = 'full' | 'partial' | 'none';

export interface LocalParse {
  plan: EditPlan;
  confidence: Confidence;
  /** Clauses (or reasons) the parser could not turn into steps. */
  unparsed: string[];
  /**
   * Content words no rule consumed ("rainy", "winter"). A `full` parse can still
   * ignore nuance; the cascade uses this to ask a free on-device LLM first.
   */
  unknownWords: string[];
}

const FRAME_LEVEL = new Set<Adjustment>(['vignette', 'grain']);
const TONAL = new Set<Adjustment>(['exposure', 'brightness', 'shadows', 'highlights', 'whites', 'blacks']);
const TONAL_REGION_TO_ADJUSTMENT: Partial<Record<Region, Adjustment>> = {
  'shadow-areas': 'shadows',
  'highlight-areas': 'highlights',
  'midtone-areas': 'brightness',
};

const UNSUPPORTED_REPLY =
  "Kuindzhi only adjusts light, colour and detail — it can't add, remove or change what's in the photo.";
const NONE_REPLY = "Sorry, I didn't get that. Try something like “make my face brighter”.";

// ---------------------------------------------------------------------------
// Normalization & clause splitting

const REGION_NOUNS =
  'face|faces|hair|skin|eyes|eye|teeth|smile|lips|mouth|clothes|outfit|shirt|dress|jacket|body|cheeks|forehead|complexion|beard';

export function normalize(text: string): string {
  let t = ` ${text.toLowerCase()} `;
  t = t.replace(/[‘’‛`´]/g, "'").replace(/[“”]/g, '"');
  // Contractions.
  t = t.replace(/\bcan't\b/g, 'can not').replace(/\bwon't\b/g, 'will not').replace(/\b(\w+)n't\b/g, '$1 not');
  t = t.replace(/\b(it|that|what|there|here|he|she|who)'s\b/g, '$1 is');
  t = t.replace(/\bi'm\b/g, 'i am').replace(/\blet's\b/g, 'let us');
  t = t.replace(/\b(\w+)'(re|ll|ve|d)\b/g, (_m, w: string, s: string) => `${w} ${{ re: 'are', ll: 'will', ve: 'have', d: 'would' }[s]}`);
  t = t.replace(/'s\b/g, '').replace(/'/g, '');
  // Multi-word names that contain a clause separator.
  t = t.replace(/\bb\s*[&/]\s*w\b/g, ' monochrome ').replace(/\bbw\b/g, ' monochrome ');
  t = t.replace(/\bblack[\s-]*(?:and|&|n)[\s-]*white\b/g, ' monochrome ');
  t = t.replace(/\bteal[\s-]*(?:and|&)[\s-]*orange\b/g, ' cinematic ');
  t = t.replace(/\bbright[\s-]*(?:and|&)[\s-]*airy\b/g, ' bright airy ');
  t = t.replace(/&/g, ' and ');
  // Sentence punctuation acts like a comma; keep decimal points.
  t = t.replace(/[.!?:]+(?!\d)/g, ' , ');
  t = t.replace(/([a-z])-(?=[a-z])/g, '$1 ');
  t = t.replace(/[^a-z0-9%+\-.,;\s]/g, ' ');
  // "warmer but not too much" / "darker but not too dark" → a gentle step.
  t = t.replace(/\b(?:but\s+)?not\s+too\s+(?:much|\w+)\b/g, ' slightly ');
  // "not bright enough" → "more bright".
  t = t.replace(/\bnot\s+(?!enough\b)(\w+)\s+enough\b/g, 'more $1');
  // "everything but me" is an exception, not a clause break.
  t = t.replace(/\b(everything|all|anything|whole photo|whole image|whole picture|entire photo|entire image)\s+but\b/g, '$1 except');
  t = t.replace(/\bbut\s+not\b/g, 'except');
  // Possessives before body parts, then determiners.
  t = t.replace(new RegExp(`\\b(his|her|their|its)\\s+(?=(${REGION_NOUNS})\\b)`, 'g'), '');
  t = t.replace(/\b(the|my|your|our|this|that|these|those|some|its)\b/g, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

type Connector = 'start' | 'and' | 'other';

interface RawClause {
  text: string;
  connector: Connector;
}

const SPLIT_WORDS = new Set(['and', 'then', 'also', 'plus', 'but', 'while', 'afterwards']);

export function splitClauses(norm: string): RawClause[] {
  const words = norm.replace(/([,;])/g, ' $1 ').split(/\s+/).filter(Boolean);
  const clauses: RawClause[] = [];
  let current: string[] = [];
  let boundary: string[] = [];
  const flush = () => {
    if (!current.length) return;
    let connector: Connector = 'start';
    if (clauses.length) {
      const isAnd = boundary.some((w) => w === 'and' || w === 'also' || w === 'plus');
      const isBreak = boundary.some((w) => w === 'then' || w === ';' || w === 'but' || w === 'afterwards');
      connector = isAnd && !isBreak ? 'and' : 'other';
    }
    clauses.push({ text: current.join(' '), connector });
    current = [];
    boundary = [];
  };
  for (const w of words) {
    if (w === ',' || w === ';' || SPLIT_WORDS.has(w)) {
      flush();
      boundary.push(w);
    } else {
      current.push(w);
    }
  }
  flush();
  return clauses;
}

// ---------------------------------------------------------------------------
// Phrase matching

type Token =
  | { kind: 'region'; region: Region; pos: number }
  | { kind: 'whole'; pos: number }
  | { kind: 'except'; pos: number }
  | { kind: 'not'; pos: number }
  | { kind: 'negation'; pos: number }
  | { kind: 'term'; term: Term; pos: number }
  | { kind: 'direction'; sign: 1 | -1; tonalSign: 1 | -1; pos: number }
  | { kind: 'intensity'; factor: number; pos: number }
  | { kind: 'too'; pos: number }
  | { kind: 'macro'; macro: Macro; pos: number }
  | { kind: 'unsupported'; pos: number };

type TokenFactory = (pos: number) => Token;

interface Rule {
  phrase: string;
  re: RegExp;
  make: TokenFactory;
}

function phraseSource(phrase: string): string {
  return phrase
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\s+');
}

/** Whole-word, global regex: group 1 is the leading boundary. */
function phraseRegex(phrase: string, flags = 'g'): RegExp {
  return new RegExp(`(^|[^a-z0-9%])(${phraseSource(phrase)})(?=$|[^a-z0-9%])`, flags);
}

function containsPhrase(text: string, phrases: readonly string[]): boolean {
  return phrases.some((p) => phraseRegex(p, '').test(text));
}

const ruleCache = new WeakMap<Lexicon, Rule[]>();

/** The consuming rules, longest phrase first. */
export function compileRules(lex: Lexicon): Rule[] {
  const cached = ruleCache.get(lex);
  if (cached) return cached;
  const rules: Array<Omit<Rule, 're'>> = [];
  const add = (phrases: readonly string[], make: TokenFactory) => {
    for (const phrase of phrases) rules.push({ phrase, make });
  };
  for (const r of lex.regions) add(r.phrases, (pos) => ({ kind: 'region', region: r.region, pos }));
  add(lex.wholePhoto, (pos) => ({ kind: 'whole', pos }));
  add(lex.except, (pos) => ({ kind: 'except', pos }));
  add(lex.not, (pos) => ({ kind: 'not', pos }));
  add(lex.negation, (pos) => ({ kind: 'negation', pos }));
  for (const term of lex.terms) add(term.phrases, (pos) => ({ kind: 'term', term, pos }));
  for (const d of lex.directions) {
    add(d.phrases, (pos) => ({ kind: 'direction', sign: d.sign, tonalSign: d.tonalSign ?? d.sign, pos }));
  }
  for (const i of lex.intensities) add(i.phrases, (pos) => ({ kind: 'intensity', factor: i.factor, pos }));
  add(lex.too, (pos) => ({ kind: 'too', pos }));
  for (const macro of lex.macros) add(macro.phrases, (pos) => ({ kind: 'macro', macro, pos }));
  add(lex.unsupported, (pos) => ({ kind: 'unsupported', pos }));

  const compiled = rules
    .sort((a, b) => b.phrase.length - a.phrase.length)
    .map((r) => ({ ...r, re: phraseRegex(r.phrase) }));
  ruleCache.set(lex, compiled);
  return compiled;
}

const WORD_NUMBERS: Record<string, number> = { one: 1, two: 2, three: 3, half: 0.5, 'half a': 0.5, 'a half': 0.5, a: 1 };

interface Matched {
  tokens: Token[];
  percent?: number;
  stops?: number;
  leftovers: string[];
}

function matchClause(text: string, lex: Lexicon): Matched {
  let work = ` ${text} `;
  const blank = (start: number, length: number) => {
    work = work.slice(0, start) + ' '.repeat(length) + work.slice(start + length);
  };

  let percent: number | undefined;
  const pct = /([+-]?\d+(?:\.\d+)?)\s*(?:%|percent\b)/.exec(work);
  if (pct) {
    percent = parseFloat(pct[1]);
    blank(pct.index, pct[0].length);
  }
  let stops: number | undefined;
  const st = /(?:^|\s)([+-]?\d+(?:\.\d+)?|one|two|three|half a|a half|half|a)\s+stops?\b/.exec(work);
  if (st) {
    const raw = st[1];
    stops = raw in WORD_NUMBERS ? WORD_NUMBERS[raw] : parseFloat(raw);
    blank(st.index, st[0].length);
  }

  const tokens: Token[] = [];
  for (const rule of compileRules(lex)) {
    rule.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.re.exec(work))) {
      const start = m.index + m[1].length;
      tokens.push(rule.make(start));
      blank(start, m[2].length);
      rule.re.lastIndex = start + m[2].length;
    }
  }
  tokens.sort((a, b) => a.pos - b.pos);
  const ignore = new Set([...lex.filler, ...lex.stopwords, ...lex.auto.flatMap((a) => a.split(' '))]);
  const leftovers = work
    .split(/[^a-z']+/)
    .filter((w) => w.length > 2 && !ignore.has(w) && !/^\d/.test(w));
  return { tokens, percent, stops, leftovers };
}

// ---------------------------------------------------------------------------
// Clause interpretation

interface RegionRef {
  region: Region;
  invert: boolean;
}

interface Clause {
  text: string;
  connector: Connector;
  regions: RegionRef[];
  explicitWhole: boolean;
  terms: Term[];
  macros: Macro[];
  dirSign: 1 | -1;
  tonalSign: 1 | -1;
  tooSign: 1 | -1;
  directionCount: number;
  intensity: number;
  percent?: number;
  stops?: number;
  auto: boolean;
  generative: boolean;
  unsupported: boolean;
  negated: boolean;
  notes: string[];
  leftovers: string[];
  /** Filled by the cross-clause pass. */
  resolved: RegionRef[];
}

function interpretClause(raw: RawClause, lex: Lexicon): Clause {
  const { tokens, percent, stops, leftovers } = matchClause(raw.text, lex);
  const c: Clause = {
    text: raw.text,
    connector: raw.connector,
    regions: [],
    explicitWhole: false,
    terms: [],
    macros: [],
    dirSign: 1,
    tonalSign: 1,
    tooSign: 1,
    directionCount: 0,
    intensity: 1,
    percent,
    stops,
    auto: false,
    generative: false,
    unsupported: false,
    negated: false,
    notes: [],
    leftovers,
    resolved: [],
  };

  let pendingInvert = false;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    switch (t.kind) {
      case 'region':
        c.regions.push({ region: t.region, invert: pendingInvert });
        pendingInvert = false;
        break;
      case 'whole':
        if (!pendingInvert) c.explicitWhole = true;
        break;
      case 'except':
        pendingInvert = true;
        break;
      case 'not':
        // Only "not <region>" means exclusion.
        if (tokens[i + 1]?.kind === 'region') pendingInvert = true;
        break;
      case 'negation':
        c.negated = true;
        break;
      case 'term':
        c.terms.push(t.term);
        break;
      case 'direction':
        c.dirSign = (c.dirSign * t.sign) as 1 | -1;
        c.tonalSign = (c.tonalSign * t.tonalSign) as 1 | -1;
        c.directionCount++;
        break;
      case 'intensity':
        c.intensity *= t.factor;
        break;
      case 'too':
        c.tooSign = -1;
        break;
      case 'macro':
        c.macros.push(t.macro);
        break;
      case 'unsupported':
        c.unsupported = true;
        break;
    }
  }
  c.intensity = Math.min(3, Math.max(0.25, c.intensity));
  if (c.terms.some((t) => !t.weak)) c.terms = c.terms.filter((t) => !t.weak);

  // De-duplicate; "brighten the face except the eyes" can't be expressed (no mask
  // intersection), so keep the positive selection and report the exception.
  const seen = new Set<string>();
  c.regions = c.regions.filter((r) => {
    const key = `${r.region}:${r.invert}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const positive = c.regions.filter((r) => !r.invert);
  if (positive.length && positive.length < c.regions.length) {
    c.notes.push(`"${raw.text}": can't exclude part of a selection`);
    c.regions = positive;
  }

  // "boost the highlights", "deepen the shadows": a direction word applied to a
  // tonal range means the Highlights/Shadows sliders, globally.
  const tonal = c.regions.filter((r) => !r.invert && TONAL_REGION_TO_ADJUSTMENT[r.region]);
  if (!c.terms.length && !c.macros.length && c.directionCount > 0 && tonal.length) {
    c.terms = tonal.map((r) => tonalTerm(r.region, 1));
    c.regions = c.regions.filter((r) => !tonal.includes(r));
    if (!c.regions.length) c.explicitWhole = true;
  }

  const hasEdits = c.terms.length > 0 || c.macros.length > 0;
  if (!hasEdits) {
    c.generative = containsPhrase(raw.text, lex.generativeVerbs);
    c.auto = !c.regions.length && containsPhrase(raw.text, [...lex.auto, 'touch up']);
  }
  return c;
}

function tonalTerm(region: Region, sign: 1 | -1): Term {
  return { id: `tonal-${region}`, phrases: [], effects: [{ adjustment: TONAL_REGION_TO_ADJUSTMENT[region]!, sign }] };
}

function hasEdits(c: Clause): boolean {
  return c.terms.length > 0 || c.macros.length > 0;
}

function isRegionOnly(c: Clause): boolean {
  // "the background is too busy": an unknown state, not a bare region.
  const unknownState = c.tooSign === -1;
  return !hasEdits(c) && c.regions.length > 0 && !c.unsupported && !c.generative && !c.negated && !unknownState;
}

/** Fill `resolved` regions; let region-only clauses borrow the adjustment of a neighbour. */
function resolveClauses(clauses: Clause[]): void {
  // "make the face and the hair brighter": "make the face" borrows "brighter".
  clauses.forEach((c, i) => {
    if (!isRegionOnly(c)) return;
    const donor =
      [...clauses.slice(0, i)].reverse().find(hasEdits) ?? clauses.slice(i + 1).find(hasEdits);
    if (!donor) return;
    c.terms = donor.terms;
    c.macros = donor.macros;
    c.dirSign = donor.dirSign;
    c.tonalSign = donor.tonalSign;
    c.tooSign = donor.tooSign;
    c.intensity = donor.intensity;
    c.percent = donor.percent;
    c.stops = donor.stops;
  });

  clauses.forEach((c, i) => {
    if (c.regions.length) {
      c.resolved = c.regions;
      return;
    }
    const forced = c.terms.find((t) => t.forceRegion && t.defaultRegion);
    if (forced?.defaultRegion) {
      c.resolved = [{ region: forced.defaultRegion, invert: false }];
      return;
    }
    if (c.explicitWhole) {
      c.resolved = [{ region: 'all', invert: false }];
      return;
    }
    const prev = clauses[i - 1];
    const canInherit =
      c.connector === 'and' &&
      prev &&
      c.macros.length === 0 &&
      !c.terms.some((t) => t.frameLevel) &&
      prev.resolved.some((r) => r.region !== 'all');
    if (canInherit) {
      c.resolved = prev.resolved;
      return;
    }
    const withDefault = c.terms.find((t) => t.defaultRegion);
    c.resolved = [{ region: withDefault?.defaultRegion ?? 'all', invert: false }];
  });
}

interface StepDraft extends PlanStep {
  /** For replies. */
  phrase: string;
}

function amountFor(effect: Effect, sign: number, c: Clause): number {
  const info = ADJUSTMENT_INFO[effect.adjustment];
  let base = effect.fixed ?? info.step;
  let s = sign;
  if (c.percent !== undefined && effect.fixed === undefined) {
    base = Math.abs(c.percent) / 100;
    if (c.percent < 0) s = -s;
  } else if (c.stops !== undefined && effect.adjustment === 'exposure' && effect.fixed === undefined) {
    base = Math.abs(c.stops) * 0.5;
    if (c.stops < 0) s = -s;
  } else {
    base *= c.intensity;
  }
  return s * base;
}

/** Turn one resolved clause into step drafts. Adds notes for what it had to drop. */
function clauseSteps(c: Clause): StepDraft[] {
  const drafts: StepDraft[] = [];
  let terms = c.terms;
  let regions = c.resolved;

  // "brighten the shadows" → Shadows +, "darken the highlights" → Highlights -.
  const tonal = regions.filter((r) => !r.invert && TONAL_REGION_TO_ADJUSTMENT[r.region]);
  if (tonal.length && terms.length > 0 && terms.every((t) => t.exposureFamily)) {
    terms = tonal.map((r) => tonalTerm(r.region, terms[0].effects[0].sign));
    const rest = regions.filter((r) => !tonal.includes(r));
    regions = rest.length ? rest : [{ region: 'all', invert: false }];
  }

  // "brighter whites", "darker blacks": lighter/darker words become the direction.
  const pointTerms = terms.filter((t) => t.effects.some((e) => e.adjustment === 'whites' || e.adjustment === 'blacks'));
  const exposureTerms = terms.filter((t) => t.exposureFamily);
  let pointSign: 1 | -1 = 1;
  if (pointTerms.length && exposureTerms.length) {
    pointSign = exposureTerms[0].effects[0].sign;
    terms = terms.filter((t) => !t.exposureFamily);
  }

  for (const { region, invert } of regions) {
    for (const term of terms) {
      const effects = (!invert && term.regionOverrides?.[region]) || term.effects;
      for (const effect of effects) {
        const isPoint = effect.adjustment === 'whites' || effect.adjustment === 'blacks';
        const dir = TONAL.has(effect.adjustment) ? c.tonalSign : c.dirSign;
        const sign = effect.sign * dir * c.tooSign * (isPoint ? pointSign : 1);
        const amount = amountFor(effect, sign, c);
        const info = ADJUSTMENT_INFO[effect.adjustment];
        if (info.min === 0 && amount < 0) {
          c.notes.push(`"${c.text}": ${info.label.toLowerCase()} can only be added, not reduced`);
          continue;
        }
        const step = { adjustment: effect.adjustment, region, amount, invert };
        drafts.push({ ...step, phrase: stepPhrase(step) });
      }
    }
    for (const macro of c.macros) {
      if (c.dirSign * c.tooSign < 0) {
        c.notes.push(`"${c.text}": can't remove a look`);
        continue;
      }
      // Vignette and grain are whole-frame; on a selection they'd just look like dirt.
      const steps = ((!invert && macro.regionOverrides?.[region]) || macro.steps).filter(
        (s) => region === 'all' || s.region || !FRAME_LEVEL.has(s.adjustment),
      );
      steps.forEach((s, idx) => {
        drafts.push({
          adjustment: s.adjustment,
          region: s.region ?? region,
          invert: s.region ? false : invert,
          amount: s.amount * c.intensity,
          // One phrase per macro use.
          phrase: idx === 0 ? `applied ${macro.label}${region === 'all' || s.region ? '' : ` to ${regionPhrase(region, invert)}`}` : '',
        });
      });
    }
  }
  return drafts;
}

// ---------------------------------------------------------------------------
// Replies

const PHRASES: Record<Adjustment, [string, string]> = {
  exposure: ['brightened {r}', 'darkened {r}'],
  brightness: ['raised the brightness of {r}', 'lowered the brightness of {r}'],
  contrast: ['added contrast to {r}', 'softened the contrast of {r}'],
  highlights: ['boosted the highlights in {r}', 'recovered the highlights in {r}'],
  shadows: ['lifted the shadows in {r}', 'deepened the shadows in {r}'],
  whites: ['brightened the whites in {r}', 'dimmed the whites in {r}'],
  blacks: ['lifted the blacks in {r}', 'deepened the blacks in {r}'],
  saturation: ['boosted the colours of {r}', 'muted the colours of {r}'],
  vibrance: ['made {r} more vivid', 'softened the colours of {r}'],
  temperature: ['warmed {r}', 'cooled {r}'],
  tint: ['added a magenta tint to {r}', 'added a green tint to {r}'],
  hue: ['shifted the hues of {r}', 'shifted the hues of {r}'],
  clarity: ['added clarity to {r}', 'softened {r}'],
  dehaze: ['removed haze from {r}', 'added haze to {r}'],
  sharpen: ['sharpened {r}', 'sharpened {r}'],
  blur: ['blurred {r}', 'blurred {r}'],
  smooth: ['smoothed {r}', 'smoothed {r}'],
  vignette: ['added a vignette to {r}', 'lightened the edges of {r}'],
  grain: ['added grain to {r}', 'added grain to {r}'],
  fade: ['gave {r} a faded look', 'gave {r} a faded look'],
  monochrome: ['made {r} black & white', 'made {r} black & white'],
  sepia: ['added sepia toning to {r}', 'added sepia toning to {r}'],
};

const REGION_WORDS: Partial<Record<Region, string>> = {
  all: 'the photo',
  mouth: 'the smile',
  'shadow-areas': 'the dark areas',
  'midtone-areas': 'the midtones',
  'highlight-areas': 'the bright areas',
  center: 'the centre',
};

function regionPhrase(region: Region, invert: boolean): string {
  const base = REGION_WORDS[region] ?? `the ${region}`;
  return invert ? `everything except ${base}` : base;
}

function stepPhrase(step: PlanStep): string {
  const [pos, neg] = PHRASES[step.adjustment];
  const text = (step.amount >= 0 ? pos : neg).replace('{r}', regionPhrase(step.region, step.invert));
  return text.replace(/ (?:in|of|to|from) the photo$/, '');
}

function joinPhrases(phrases: string[]): string {
  const unique = [...new Set(phrases.filter(Boolean))];
  if (!unique.length) return '';
  const shown = unique.slice(0, 3);
  const more = unique.length - shown.length;
  if (more > 0) shown.push(`${more} more adjustment${more > 1 ? 's' : ''}`);
  const sentence = shown.length === 1 ? shown[0] : `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
  return `${sentence[0].toUpperCase()}${sentence.slice(1)}.`;
}

// ---------------------------------------------------------------------------
// Entry points

function plan(intent: Intent, steps: PlanStep[], reply: string): EditPlan {
  return { intent, steps, reply };
}

function detectHistory(norm: string, lex: Lexicon): Intent | null {
  const filler = new Set(lex.filler);
  const order: Array<[Intent, string[]]> = [
    ['reset', lex.history.reset],
    ['redo', lex.history.redo],
    ['undo', lex.history.undo],
  ];
  const text = norm.replace(/[,;]/g, ' ');
  for (const [intent, phrases] of order) {
    for (const phrase of [...phrases].sort((a, b) => b.length - a.length)) {
      const re = phraseRegex(phrase);
      if (!re.test(text)) continue;
      const residual = text.replace(phraseRegex(phrase), ' ').split(/\s+/).filter(Boolean);
      if (residual.every((w) => filler.has(w))) return intent;
    }
  }
  return null;
}

const HISTORY_REPLIES: Partial<Record<Intent, string>> = {
  undo: 'Undid the last edit.',
  redo: 'Redid the edit.',
  reset: 'Back to the original photo.',
  'auto-enhance': 'Auto-enhancing the photo.',
};

export function parseLocally(text: string, available?: readonly Region[], lex: Lexicon = EN): LocalParse {
  const norm = normalize(text);
  if (!norm.replace(/[,;\s]/g, '')) {
    return { plan: plan('edit', [], NONE_REPLY), confidence: 'none', unparsed: [text], unknownWords: [] };
  }

  const history = detectHistory(norm, lex);
  if (history) {
    return { plan: plan(history, [], HISTORY_REPLIES[history]!), confidence: 'full', unparsed: [], unknownWords: [] };
  }

  const clauses = splitClauses(norm).map((raw) => interpretClause(raw, lex));
  resolveClauses(clauses);
  const unknownWords = [...new Set(clauses.flatMap((c) => c.leftovers))];

  const unparsed: string[] = [];
  const drafts: StepDraft[] = [];
  let unsupportedCount = 0;
  let autoCount = 0;
  for (const c of clauses) {
    if (c.unsupported) {
      unsupportedCount++;
      unparsed.push(`"${c.text}": generative edit`);
      continue;
    }
    if (c.negated) {
      unparsed.push(`"${c.text}": negated request`);
      continue;
    }
    if (!hasEdits(c)) {
      if (c.generative) {
        unsupportedCount++;
        unparsed.push(`"${c.text}": generative edit`);
      } else if (c.auto) {
        autoCount++;
      } else {
        unparsed.push(`"${c.text}"`);
      }
      continue;
    }
    drafts.push(...clauseSteps(c));
    unparsed.push(...c.notes);
  }

  if (!drafts.length) {
    if (unsupportedCount && unsupportedCount + autoCount === clauses.length) {
      return { plan: plan('unsupported', [], UNSUPPORTED_REPLY), confidence: 'full', unparsed: [], unknownWords };
    }
    if (autoCount && autoCount === clauses.length) {
      return { plan: plan('auto-enhance', [], HISTORY_REPLIES['auto-enhance']!), confidence: 'full', unparsed: [], unknownWords };
    }
    if (unsupportedCount) {
      return { plan: plan('unsupported', [], UNSUPPORTED_REPLY), confidence: 'partial', unparsed, unknownWords };
    }
    return { plan: plan('edit', [], NONE_REPLY), confidence: 'none', unparsed: unparsed.length ? unparsed : [text], unknownWords };
  }
  if (autoCount) unparsed.push('auto-enhance combined with specific edits');

  // Merge repeated adjustments on the same selection, then clamp/round.
  const merged = new Map<string, PlanStep>();
  for (const d of drafts) {
    const key = `${d.adjustment}|${d.region}|${d.invert}`;
    const prev = merged.get(key);
    merged.set(key, { adjustment: d.adjustment, region: d.region, invert: d.invert, amount: (prev?.amount ?? 0) + d.amount });
  }
  let reply = joinPhrases(drafts.map((d) => d.phrase));
  if (unsupportedCount) reply += ` ${UNSUPPORTED_REPLY}`;
  const normalized = normalizePlan(plan('edit', [...merged.values()], reply));
  if (!normalized.steps.length) {
    return { plan: plan('edit', [], NONE_REPLY), confidence: 'none', unparsed: unparsed.length ? unparsed : [text], unknownWords };
  }

  if (available) {
    const missing = [...new Set(normalized.steps.map((s) => s.region).filter((r) => !available.includes(r)))];
    for (const r of missing) unparsed.push(`region "${r}" is not available in this photo`);
  }

  return { plan: normalized, confidence: unparsed.length ? 'partial' : 'full', unparsed, unknownWords };
}

export function createLocalPlanner(lex: Lexicon = EN): Planner {
  return {
    source: 'local',
    isAvailable: async () => true,
    async plan(command, context) {
      const result = parseLocally(command, context.regions, lex);
      if (result.confidence !== 'full') {
        throw new Error(`Local parser: ${result.unparsed.join('; ') || 'not understood'}`);
      }
      return result.plan;
    },
  };
}
