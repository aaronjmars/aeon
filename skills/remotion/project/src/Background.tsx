import React from 'react';
import {AbsoluteFill, useCurrentFrame, interpolate} from 'remotion';
import {withAlpha, type Palette} from './theme';

// Deterministic film grain — an inline SVG turbulence tile (no network fetch),
// blended low so it reads as texture, not noise. Kills the "flat CSS" look.
const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

// A slow, living gradient wash. Two radial blobs drift + breathe so static
// scenes never feel dead, over a faint dot-grid, grain and a vignette for depth.
// Fully frame-driven, so every render is byte-identical.
export const Background: React.FC<{palette: Palette; override?: string}> = ({
  palette,
  override,
}) => {
  const frame = useCurrentFrame();
  const base = override ?? palette.bg;

  // Drift the two glows on a slow loop.
  const drift = interpolate(frame % 300, [0, 150, 300], [0, 1, 0]);
  const x1 = interpolate(drift, [0, 1], [24, 46]);
  const y1 = interpolate(drift, [0, 1], [30, 42]);
  const x2 = interpolate(drift, [0, 1], [78, 62]);
  const y2 = interpolate(drift, [0, 1], [72, 60]);
  // Breathe the accent glow's intensity (a slow sine, ~5s period).
  const breathe = 0.18 + 0.08 * Math.sin((frame / 150) * Math.PI * 2);

  return (
    <AbsoluteFill style={{backgroundColor: base}}>
      {/* Drifting accent + cool secondary glows */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(46% 52% at ${x1}% ${y1}%, ${withAlpha(
            palette.accent,
            breathe,
          )} 0%, transparent 62%), radial-gradient(50% 50% at ${x2}% ${y2}%, ${withAlpha(
            palette.bgAlt,
            0.95,
          )} 0%, transparent 72%)`,
        }}
      />
      {/* Faint dot grid — technical texture, masked to fade at the edges */}
      <AbsoluteFill
        style={{
          backgroundImage: `radial-gradient(${withAlpha(
            palette.fg,
            0.05,
          )} 1px, transparent 1px)`,
          backgroundSize: '40px 40px',
          WebkitMaskImage:
            'radial-gradient(80% 80% at 50% 45%, black 20%, transparent 80%)',
          maskImage:
            'radial-gradient(80% 80% at 50% 45%, black 20%, transparent 80%)',
          opacity: 0.6,
        }}
      />
      {/* Top accent hairline glow */}
      <AbsoluteFill
        style={{
          background: `linear-gradient(to bottom, ${withAlpha(
            palette.accent,
            0.12,
          )} 0%, transparent 12%)`,
        }}
      />
      {/* Film grain */}
      <AbsoluteFill
        style={{
          backgroundImage: GRAIN,
          backgroundSize: '140px 140px',
          opacity: 0.05,
          mixBlendMode: 'overlay',
        }}
      />
      {/* Vignette for depth */}
      <AbsoluteFill
        style={{
          background:
            'radial-gradient(125% 125% at 50% 45%, transparent 52%, rgba(0,0,0,0.45) 100%)',
        }}
      />
    </AbsoluteFill>
  );
};
