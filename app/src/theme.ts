// The kitchen table, by day and at night. Why each value: .interface-design/system.md
import { useColorScheme } from 'react-native';

const light = {
  linen: '#F5F0E7',
  paper: '#FFFCF6',
  raised: '#FFFCF6',
  inset: '#ECE5D8',
  ink: '#1F1B16',
  inkSoft: '#5C5348',
  inkFaint: '#8A7F72',
  inkGhost: '#B5AB9E',
  walnut: '#2B2520',
  walnutText: '#F5EEE3',
  walnutMeta: 'rgba(245,238,227,0.62)',
  terracotta: '#B4532A',
  onTerracotta: '#FBF5EC',
  hairline: 'rgba(60,40,20,0.12)',
  hairlineSoft: 'rgba(60,40,20,0.07)',
  danger: '#A33A2B',
  porch: '#E3A547',
  sealText: '#FBF5EC',
};

const dark: typeof light = {
  linen: '#15130F',
  paper: '#1F1C17',
  raised: '#27231D',
  inset: '#0E0D0A',
  ink: '#F2EADF',
  inkSoft: '#BDB2A4',
  inkFaint: '#8C8275',
  inkGhost: '#5F574C',
  walnut: '#4A3527',
  walnutText: '#F6EBDC',
  walnutMeta: 'rgba(246,235,220,0.6)',
  terracotta: '#D27A4E',
  onTerracotta: '#1A120C',
  hairline: 'rgba(255,240,220,0.10)',
  hairlineSoft: 'rgba(255,240,220,0.06)',
  danger: '#D0614F',
  porch: '#E8B25A',
  sealText: '#FBF5EC',
};

export type Palette = typeof light;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { chip: 6, control: 8, field: 10, bubble: 12, tail: 4, sheet: 16 } as const;

// ratio 1.25 from a 16 px body
export const type = {
  caption: 12,
  meta: 13,
  secondary: 14,
  body: 16,
  title: 20,
  heading: 25,
  display: 34,
  wordmark: 44,
} as const;

export const serif = {
  medium: 'Fraunces_500Medium',
  semibold: 'Fraunces_600SemiBold',
} as const;

export function useTheme() {
  const scheme = useColorScheme();
  const dark_ = scheme === 'dark';
  return { c: dark_ ? dark : light, dark: dark_ };
}
