import type {VideoProps} from './schema';

export type Palette = {
  bg: string;
  bgAlt: string;
  fg: string;
  muted: string;
  accent: string;
};

export const buildPalette = (
  theme: VideoProps['theme'],
  accent: string,
): Palette =>
  theme === 'dark'
    ? {
        bg: '#08080d',
        bgAlt: '#16161f',
        fg: '#f6f6f9',
        muted: '#9a9aa8',
        accent,
      }
    : {
        bg: '#fbfbfd',
        bgAlt: '#e9ebf0',
        fg: '#111114',
        muted: '#585866',
        accent,
      };

// System font stack — no network fetch at render time, ships on the CI runner.
export const FONT =
  '"Helvetica Neue", Helvetica, Arial, "Segoe UI", Roboto, system-ui, sans-serif';

// #rrggbb -> rgba() with the given alpha. Passes non-hex inputs (named colors,
// rgb()) straight through. Shared by Background + Scenes for accent glows.
export const withAlpha = (hex: string, alpha: number): string => {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
  if (!m) return hex;
  const r = parseInt(m[1], 16);
  const g = parseInt(m[2], 16);
  const b = parseInt(m[3], 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};
