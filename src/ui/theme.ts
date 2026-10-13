import { Platform } from 'react-native';

// "Moonlit Night on the Dnieper": deep warm dark, moonlight text, lamplight accent.
export const colors = {
  bg: '#0E0D0B',
  surface: '#1A1815',
  surfaceHigh: '#24211D',
  border: '#2E2A24',
  text: '#F2EDE4',
  textMuted: '#9A9286',
  accent: '#F2B33D',
  accentInk: '#1A1206',
  danger: '#E5735C',
  moon: '#CFE3D6',
} as const;

export const serif = Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' });

export const radius = { sm: 10, md: 16, lg: 24, pill: 999 } as const;
