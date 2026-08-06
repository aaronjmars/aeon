import React from 'react';
import {
  AbsoluteFill,
  Audio,
  interpolate,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {TransitionSeries, linearTiming} from '@remotion/transitions';
import {fade} from '@remotion/transitions/fade';
import {slide} from '@remotion/transitions/slide';
import {
  type VideoProps,
  sceneFrames,
  type Scene,
  TRANSITION_FRAMES,
  INTRO_SECONDS,
  OUTRO_SECONDS,
} from './schema';
import {buildPalette, withAlpha, FONT} from './theme';
import {Background} from './Background';
import {
  BulletsScene,
  ImageScene,
  QuoteScene,
  StatementScene,
  StatScene,
  TitleScene,
} from './Scenes';

const renderScene = (scene: Scene, palette: ReturnType<typeof buildPalette>) => {
  switch (scene.type) {
    case 'title':
      return <TitleScene scene={scene} palette={palette} />;
    case 'statement':
      return <StatementScene scene={scene} palette={palette} />;
    case 'bullets':
      return <BulletsScene scene={scene} palette={palette} />;
    case 'stat':
      return <StatScene scene={scene} palette={palette} />;
    case 'quote':
      return <QuoteScene scene={scene} palette={palette} />;
    case 'image':
      return <ImageScene scene={scene} palette={palette} />;
    default:
      return null;
  }
};

export const Video: React.FC<VideoProps> = (props) => {
  const palette = buildPalette(props.theme, props.accent);
  const {durationInFrames} = useVideoConfig();

  // Build the scene list: an implicit title card first, then the body, then an
  // optional outro. The title card reuses the TitleScene template.
  const intro: Scene = {type: 'title', heading: props.title, subheading: props.subtitle, seconds: INTRO_SECONDS};
  const body: Scene[] = props.scenes;
  const outro: Scene[] = props.outro
    ? [{type: 'statement', heading: props.outro, seconds: OUTRO_SECONDS}]
    : [];
  const all = [intro, ...body, ...outro];

  return (
    <AbsoluteFill>
      <Background palette={palette} />
      <TransitionSeries>
        {all.flatMap((scene, i) => {
          const seq = (
            <TransitionSeries.Sequence key={`s${i}`} durationInFrames={sceneFrames(scene)}>
              {scene.bg ? <Background palette={palette} override={scene.bg} /> : null}
              {renderScene(scene, palette)}
            </TransitionSeries.Sequence>
          );
          if (i === all.length - 1) return [seq];
          const transition = (
            <TransitionSeries.Transition
              key={`t${i}`}
              timing={linearTiming({durationInFrames: TRANSITION_FRAMES})}
              presentation={i % 2 === 0 ? fade() : slide({direction: 'from-right'})}
            />
          );
          return [seq, transition];
        })}
      </TransitionSeries>

      {/* Persistent chrome: brand label + progress bar */}
      {props.brand ? (
        <div
          style={{
            position: 'absolute',
            left: '5%',
            bottom: '5%',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            fontFamily: FONT,
            fontSize: 26,
            color: palette.muted,
            fontWeight: 600,
            letterSpacing: 0.5,
          }}
        >
          <span
            style={{
              width: 9,
              height: 9,
              borderRadius: '50%',
              background: palette.accent,
              boxShadow: `0 0 12px ${withAlpha(palette.accent, 0.9)}`,
            }}
          />
          {props.brand}
        </div>
      ) : null}
      <ProgressBar color={palette.accent} total={durationInFrames} />

      {props.audioUrl ? <Audio src={props.audioUrl} volume={0.18} loop /> : null}
    </AbsoluteFill>
  );
};

const ProgressBar: React.FC<{color: string; total: number}> = ({color, total}) => {
  const frame = useCurrentFrame();
  const w = interpolate(frame, [0, total], [0, 100], {extrapolateRight: 'clamp'});
  return (
    <div style={{position: 'absolute', left: 0, right: 0, bottom: 0, height: 6, background: 'rgba(255,255,255,0.06)'}}>
      <div
        style={{
          position: 'relative',
          width: `${w}%`,
          height: '100%',
          background: `linear-gradient(90deg, ${withAlpha(color, 0.35)}, ${color})`,
          boxShadow: `0 0 14px ${withAlpha(color, 0.8)}`,
        }}
      >
        {/* Leading knob rides the front of the bar */}
        <div
          style={{
            position: 'absolute',
            right: -4,
            top: '50%',
            transform: 'translateY(-50%)',
            width: 12,
            height: 12,
            borderRadius: '50%',
            background: color,
            boxShadow: `0 0 16px ${color}`,
          }}
        />
      </div>
    </div>
  );
};
