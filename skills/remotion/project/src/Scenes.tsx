import React from 'react';
import {
  AbsoluteFill,
  Img,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import type {Scene} from './schema';
import {FONT, withAlpha, type Palette} from './theme';

// Shared spring-in helper: value 0 -> 1 with a soft settle, delayed by `delay`.
const useReveal = (delay = 0) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  return spring({frame: frame - delay, fps, config: {damping: 200}});
};

const Rise: React.FC<{delay?: number; children: React.ReactNode}> = ({
  delay = 0,
  children,
}) => {
  const p = useReveal(delay);
  return (
    <div
      style={{
        opacity: p,
        transform: `translateY(${interpolate(p, [0, 1], [24, 0])}px)`,
      }}
    >
      {children}
    </div>
  );
};

const wrap = (palette: Palette): React.CSSProperties => ({
  fontFamily: FONT,
  color: palette.fg,
  padding: '8%',
  justifyContent: 'center',
  alignItems: 'flex-start',
  textAlign: 'left',
});

export const TitleScene: React.FC<{scene: Scene; palette: Palette}> = ({
  scene,
  palette,
}) => (
  <AbsoluteFill style={{...wrap(palette), alignItems: 'center', textAlign: 'center'}}>
    <Rise>
      <div
        style={{
          width: 96,
          height: 6,
          borderRadius: 3,
          background: `linear-gradient(90deg, ${withAlpha(palette.accent, 0.2)}, ${palette.accent})`,
          boxShadow: `0 0 24px ${withAlpha(palette.accent, 0.7)}`,
          margin: '0 auto 44px',
        }}
      />
    </Rise>
    <Rise delay={6}>
      <h1
        style={{
          fontSize: 96,
          fontWeight: 800,
          margin: 0,
          lineHeight: 1.05,
          letterSpacing: -2,
          textShadow: '0 8px 44px rgba(0,0,0,0.55)',
        }}
      >
        {scene.heading}
      </h1>
    </Rise>
    {scene.subheading ? (
      <Rise delay={14}>
        <p style={{fontSize: 40, color: palette.muted, marginTop: 28, fontWeight: 400}}>
          {scene.subheading}
        </p>
      </Rise>
    ) : null}
  </AbsoluteFill>
);

export const StatementScene: React.FC<{scene: Scene; palette: Palette}> = ({
  scene,
  palette,
}) => (
  <AbsoluteFill style={wrap(palette)}>
    <Rise>
      <div
        style={{
          width: 64,
          height: 5,
          borderRadius: 3,
          marginBottom: 34,
          background: `linear-gradient(90deg, ${palette.accent}, ${withAlpha(palette.accent, 0.15)})`,
          boxShadow: `0 0 20px ${withAlpha(palette.accent, 0.6)}`,
        }}
      />
    </Rise>
    <Rise delay={4}>
      <h2
        style={{
          fontSize: 76,
          fontWeight: 700,
          margin: 0,
          lineHeight: 1.12,
          maxWidth: '90%',
          textShadow: '0 6px 34px rgba(0,0,0,0.5)',
        }}
      >
        {colorFirstWord(scene.heading ?? '', palette.accent)}
      </h2>
    </Rise>
    {scene.subheading ? (
      <Rise delay={10}>
        <p style={{fontSize: 36, color: palette.muted, marginTop: 32, maxWidth: '80%', lineHeight: 1.4}}>
          {scene.subheading}
        </p>
      </Rise>
    ) : null}
  </AbsoluteFill>
);

export const BulletsScene: React.FC<{scene: Scene; palette: Palette}> = ({
  scene,
  palette,
}) => (
  <AbsoluteFill style={wrap(palette)}>
    {scene.heading ? (
      <Rise>
        <div style={{margin: '0 0 46px'}}>
          <h2 style={{fontSize: 60, fontWeight: 700, margin: 0, textShadow: '0 6px 30px rgba(0,0,0,0.5)'}}>
            {scene.heading}
          </h2>
          <div
            style={{
              width: 72,
              height: 4,
              borderRadius: 2,
              marginTop: 20,
              background: palette.accent,
              boxShadow: `0 0 18px ${withAlpha(palette.accent, 0.6)}`,
            }}
          />
        </div>
      </Rise>
    ) : null}
    <div style={{display: 'flex', flexDirection: 'column', gap: 30}}>
      {(scene.bullets ?? []).map((b, i) => (
        <Rise key={i} delay={12 + i * 8}>
          <div style={{display: 'flex', alignItems: 'center', gap: 26}}>
            <span
              style={{
                flexShrink: 0,
                width: 18,
                height: 18,
                borderRadius: 6,
                background: `linear-gradient(135deg, ${palette.accent}, ${withAlpha(palette.accent, 0.4)})`,
                boxShadow: `0 0 16px ${withAlpha(palette.accent, 0.7)}`,
              }}
            />
            <span style={{fontSize: 42, fontWeight: 500, lineHeight: 1.25}}>{b}</span>
          </div>
        </Rise>
      ))}
    </div>
  </AbsoluteFill>
);

export const StatScene: React.FC<{scene: Scene; palette: Palette}> = ({
  scene,
  palette,
}) => {
  const p = useReveal(4);
  return (
    <AbsoluteFill style={{...wrap(palette), alignItems: 'center', textAlign: 'center'}}>
      <div
        style={{
          fontSize: 200,
          fontWeight: 800,
          letterSpacing: -4,
          background: `linear-gradient(160deg, ${palette.fg} 10%, ${palette.accent} 90%)`,
          WebkitBackgroundClip: 'text',
          backgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          filter: `drop-shadow(0 0 46px ${withAlpha(palette.accent, 0.45)})`,
          transform: `scale(${interpolate(p, [0, 1], [0.85, 1])})`,
          opacity: p,
        }}
      >
        {scene.stat?.value}
      </div>
      {scene.stat?.label ? (
        <Rise delay={16}>
          <p style={{fontSize: 44, color: palette.fg, marginTop: 8, fontWeight: 500}}>
            {scene.stat.label}
          </p>
        </Rise>
      ) : null}
      {scene.subheading ? (
        <Rise delay={24}>
          <p style={{fontSize: 30, color: palette.muted, marginTop: 20}}>{scene.subheading}</p>
        </Rise>
      ) : null}
    </AbsoluteFill>
  );
};

export const QuoteScene: React.FC<{scene: Scene; palette: Palette}> = ({
  scene,
  palette,
}) => (
  <AbsoluteFill style={{...wrap(palette), justifyContent: 'center'}}>
    <Rise>
      <div
        style={{
          fontSize: 120,
          color: palette.accent,
          lineHeight: 0.4,
          fontWeight: 800,
          textShadow: `0 0 40px ${withAlpha(palette.accent, 0.5)}`,
        }}
      >
        “
      </div>
    </Rise>
    <Rise delay={8}>
      <p
        style={{
          fontSize: 58,
          fontWeight: 600,
          lineHeight: 1.25,
          margin: '10px 0 0',
          maxWidth: '88%',
          textShadow: '0 6px 30px rgba(0,0,0,0.5)',
        }}
      >
        {scene.quote?.text}
      </p>
    </Rise>
    {scene.quote?.author ? (
      <Rise delay={18}>
        <p style={{fontSize: 34, color: palette.muted, marginTop: 36}}>— {scene.quote.author}</p>
      </Rise>
    ) : null}
  </AbsoluteFill>
);

export const ImageScene: React.FC<{scene: Scene; palette: Palette}> = ({
  scene,
  palette,
}) => {
  const frame = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();
  // Slow Ken Burns zoom for life.
  const scale = interpolate(frame, [0, durationInFrames], [1.06, 1.16]);
  return (
    <AbsoluteFill style={{backgroundColor: palette.bg}}>
      {scene.imageUrl ? (
        <Img
          src={scene.imageUrl}
          style={{width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${scale})`}}
        />
      ) : null}
      {scene.heading ? (
        <AbsoluteFill
          style={{
            justifyContent: 'flex-end',
            padding: '7%',
            background: 'linear-gradient(to top, rgba(0,0,0,0.75) 0%, transparent 55%)',
          }}
        >
          <Rise>
            <h2 style={{fontFamily: FONT, color: '#fff', fontSize: 60, fontWeight: 700, margin: 0}}>
              {scene.heading}
            </h2>
          </Rise>
        </AbsoluteFill>
      ) : null}
    </AbsoluteFill>
  );
};

// Tint the first word of a statement with the accent for a designed feel.
const colorFirstWord = (text: string, accent: string) => {
  const [first, ...rest] = text.split(' ');
  return (
    <>
      <span style={{color: accent, textShadow: `0 0 30px ${withAlpha(accent, 0.55)}`}}>{first}</span>
      {rest.length ? ' ' + rest.join(' ') : ''}
    </>
  );
};
