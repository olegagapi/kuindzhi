/**
 * @jest-environment @shopify/react-native-skia/jestEnv.js
 */
import '@shopify/react-native-skia/jestSetup.js';
import { Skia } from '@shopify/react-native-skia';

import { ADJUST_SKSL, INVERT_SKSL, MASK_MULTIPLY_SKSL, MASK_SKSL, OVERLAY_SKSL, SKY_SKSL } from '../shaders';

describe('SkSL sources compile', () => {
  it.each([
    ['ADJUST', ADJUST_SKSL],
    ['MASK', MASK_SKSL],
    ['SKY', SKY_SKSL],
    ['INVERT', INVERT_SKSL],
    ['MASK_MULTIPLY', MASK_MULTIPLY_SKSL],
    ['OVERLAY', OVERLAY_SKSL],
  ])('%s', (_name, source) => {
    const effect = Skia.RuntimeEffect.Make(source);
    expect(effect).not.toBeNull();
  });

  it('reports uniform slots in float units', () => {
    const effect = Skia.RuntimeEffect.Make(ADJUST_SKSL)!;
    const names = Array.from({ length: effect.getUniformCount() }, (_, i) => [effect.getUniformName(i), effect.getUniform(i)]);
    expect(names.map(([n]) => n)).toEqual(['op', 'amount', 'size', 'seed']);
    expect(effect.getUniformFloatCount()).toBe(5);
    console.log(JSON.stringify(names));
  });
});
