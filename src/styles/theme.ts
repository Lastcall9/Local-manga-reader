import type { ThemeMode } from '../types/library';

export type ResolvedTheme = 'light' | 'dark';

export type ColorScheme = typeof lightColors;

const lightColors = {
  background: '#F5F6F7',
  header: '#111827',
  surface: '#FFFFFF',
  surfaceMuted: '#EEF1F4',
  coverPlaceholder: '#D8DEE6',
  text: '#151A21',
  textMuted: '#4D5967',
  textSubtle: '#7A8491',
  primary: '#2563EB',
  primarySoft: '#DBEAFE',
  accent: '#14B8A6',
  dangerSurface: '#FEE2E2',
  dangerText: '#991B1B',
  readerBackground: '#070807',
  readerSurface: '#242824',
  readerBorder: '#3A403B',
  readerText: '#FFFFFF',
  readerMuted: '#B7BFB8',
};

const darkColors: ColorScheme = {
  background: '#0B1120',
  header: '#020617',
  surface: '#111827',
  surfaceMuted: '#1F2937',
  coverPlaceholder: '#334155',
  text: '#E5E7EB',
  textMuted: '#CBD5E1',
  textSubtle: '#94A3B8',
  primary: '#60A5FA',
  primarySoft: '#1E3A8A',
  accent: '#2DD4BF',
  dangerSurface: '#450A0A',
  dangerText: '#FCA5A5',
  readerBackground: '#020617',
  readerSurface: '#111827',
  readerBorder: '#334155',
  readerText: '#F8FAFC',
  readerMuted: '#CBD5E1',
};

export const colors = lightColors;

export const getColors = (theme: ResolvedTheme) => (theme === 'dark' ? darkColors : lightColors);

export const resolveThemeMode = (mode: ThemeMode, systemTheme: ResolvedTheme | null | undefined): ResolvedTheme => {
  if (mode === 'system') {
    return systemTheme === 'dark' ? 'dark' : 'light';
  }

  return mode;
};

export const radii = {
  sm: 6,
  md: 8,
};

export const hitSlop = {
  top: 8,
  right: 8,
  bottom: 8,
  left: 8,
};
