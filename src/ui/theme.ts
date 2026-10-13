import { Platform } from 'react-native';

import { palette } from './palette';

// Colours live in palette.json (see palette.ts); never write a colour literal in a component.
export const colors = palette;

export const serif = Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' });

export const radius = { sm: 10, md: 16, lg: 24, pill: 999 } as const;
