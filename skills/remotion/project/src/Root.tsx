import React from 'react';
import {Composition} from 'remotion';
import {Video} from './Video';
import {
  videoSchema,
  ORIENTATIONS,
  FPS,
  totalFrames,
  type VideoProps,
} from './schema';

const defaultProps: VideoProps = {
  title: 'Aeon Remotion Studio',
  subtitle: 'Turn any topic into a video',
  accent: '#7c5cff',
  theme: 'dark',
  orientation: 'landscape',
  brand: '@aeonframework',
  scenes: [
    {
      type: 'statement',
      heading: 'Programmatic video, rendered from JSON.',
      subheading: 'The agent writes a storyboard. Remotion renders it deterministically.',
    },
    {
      type: 'bullets',
      heading: 'What it does',
      bullets: [
        'Any subject, ~10s',
        'React, no editor',
        'One MP4 out',
      ],
    },
    {type: 'stat', stat: {value: '10s', label: 'short by design'}, subheading: 'landscape · portrait · square'},
  ],
  outro: 'Made with Remotion.',
};

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="Video"
      component={Video}
      schema={videoSchema}
      defaultProps={defaultProps}
      fps={FPS}
      // Dimensions + duration are derived from the props so any storyboard fits.
      durationInFrames={totalFrames(defaultProps)}
      width={ORIENTATIONS[defaultProps.orientation].width}
      height={ORIENTATIONS[defaultProps.orientation].height}
      calculateMetadata={({props}) => {
        const dims = ORIENTATIONS[props.orientation];
        return {
          durationInFrames: totalFrames(props),
          width: dims.width,
          height: dims.height,
          fps: FPS,
        };
      }}
    />
  );
};
