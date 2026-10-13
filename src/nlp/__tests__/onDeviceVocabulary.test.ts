// Guards against drift between the TS catalog and vocabulary hard-coded in the
// native on-device LLM sources (Swift guided-generation guides need literals).
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

import { ADJUSTMENTS, REGIONS } from '../../edits/catalog';
import { INTENTS } from '../../edits/schema';

const MODULE_DIR = join(__dirname, '../../../modules/on-device-llm');
const EXPECTED: Record<string, readonly string[]> = {
  intents: INTENTS,
  adjustments: ADJUSTMENTS,
  regions: REGIONS,
};

function sourceFiles(dir: string, ext: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path, ext);
    return path.endsWith(ext) ? [path] : [];
  });
}

/** Lists that follow a `// vocabulary:<name>` marker, e.g. `static let regions = ["all", ...]`. */
function vocabularyLists(source: string): Record<string, string[]> {
  const lists: Record<string, string[]> = {};
  const marker = /\/\/ vocabulary:(\w+)\s*\n[^\n=]*=\s*(?:\[|listOf\()([\s\S]*?)(?:\]|\))/g;
  for (const match of source.matchAll(marker)) {
    lists[match[1]] = [...match[2].matchAll(/"([^"]*)"/g)].map((m) => m[1]);
  }
  return lists;
}

describe('on-device LLM vocabulary', () => {
  const swiftFiles = sourceFiles(join(MODULE_DIR, 'ios'), '.swift');
  const kotlinFiles = sourceFiles(join(MODULE_DIR, 'android'), '.kt');

  it('finds the native sources', () => {
    expect(swiftFiles.length).toBeGreaterThan(0);
    expect(kotlinFiles.length).toBeGreaterThan(0);
  });

  it('Swift guided-generation lists match the TS catalog exactly', () => {
    const lists = Object.assign({}, ...swiftFiles.map((f) => vocabularyLists(readFileSync(f, 'utf8'))));
    for (const [name, expected] of Object.entries(EXPECTED)) {
      expect({ name, values: lists[name] }).toEqual({ name, values: [...expected] });
    }
  });

  it('any vocabulary embedded in Kotlin matches the TS catalog', () => {
    // Android has no guided generation and takes its vocabulary from the JS prompt;
    // if a list is ever hard-coded there, it must stay in sync too.
    for (const file of kotlinFiles) {
      for (const [name, values] of Object.entries(vocabularyLists(readFileSync(file, 'utf8')))) {
        expect({ file, name, values }).toEqual({ file, name, values: [...EXPECTED[name]] });
      }
    }
  });
});
