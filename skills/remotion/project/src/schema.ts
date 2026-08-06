import {z} from 'zod';
import {zColor} from '@remotion/zod-types';

// The storyboard schema IS the contract the `remotion` skill writes to.
// The agent produces a props.json matching this; Remotion renders it. Every
// field except the scene body is optional so a minimal storyboard still renders.

export const sceneSchema = z.object({
  // Visual template for the scene.
  type: z.enum(['title', 'statement', 'bullets', 'stat', 'quote', 'image']),
  // How long the scene holds, in seconds. Defaulted per type if omitted.
  seconds: z.number().min(1).max(20).optional(),
  // Primary large text (title / statement / stat label / image caption).
  heading: z.string().optional(),
  // Smaller supporting line under the heading.
  subheading: z.string().optional(),
  // For type: bullets — the list items (rendered one-by-one).
  bullets: z.array(z.string()).max(6).optional(),
  // For type: stat — the big number/figure and its caption.
  stat: z
    .object({value: z.string(), label: z.string().optional()})
    .optional(),
  // For type: quote — the quotation and who said it.
  quote: z
    .object({text: z.string(), author: z.string().optional()})
    .optional(),
  // For type: image — a public https image URL shown full-bleed with a caption.
  imageUrl: z.string().optional(),
  // Optional per-scene background override (hex). Falls back to the theme.
  bg: zColor().optional(),
});

export const videoSchema = z.object({
  // Title card text shown first.
  title: z.string(),
  subtitle: z.string().optional(),
  // Brand/accent color driving highlights, the progress bar and transitions.
  accent: zColor(),
  // Dark or light base palette.
  theme: z.enum(['dark', 'light']),
  // Aspect ratio -> resolution is derived in calculateMetadata.
  orientation: z.enum(['landscape', 'portrait', 'square']),
  // Small label bottom-left throughout (e.g. a handle or brand).
  brand: z.string().optional(),
  // The body of the video.
  scenes: z.array(sceneSchema).min(1).max(20),
  // Optional closing card.
  outro: z.string().optional(),
  // Optional background music (public https audio URL, loops, ducked low).
  audioUrl: z.string().optional(),
});

export type VideoProps = z.infer<typeof videoSchema>;
export type Scene = z.infer<typeof sceneSchema>;

// Per-type default hold time (seconds) when a scene omits `seconds`.
export const DEFAULT_SECONDS: Record<Scene['type'], number> = {
  title: 2,
  statement: 2.2,
  bullets: 3,
  stat: 2,
  quote: 2.5,
  image: 2.2,
};

// Videos are capped short — a 10s clip is the product. This is a hard ceiling
// (totalFrames clamps to it); the storyboard should already fit without clamping.
export const MAX_TOTAL_SECONDS = 10;
// Intro title card + optional outro card durations (kept short for the 10s budget).
export const INTRO_SECONDS = 1.5;
export const OUTRO_SECONDS = 1.5;

export const FPS = 30;

export const ORIENTATIONS: Record<
  VideoProps['orientation'],
  {width: number; height: number}
> = {
  landscape: {width: 1920, height: 1080},
  portrait: {width: 1080, height: 1920},
  square: {width: 1080, height: 1080},
};

export const sceneFrames = (s: Scene): number =>
  Math.round((s.seconds ?? DEFAULT_SECONDS[s.type]) * FPS);

// Transitions overlap adjacent sequences, so they subtract from the total.
export const TRANSITION_FRAMES = 15;

// Implicit intro (title card) + body scenes + optional outro, minus the overlap
// of the (n-1) transitions between them. Kept here so Root's calculateMetadata
// and the Video component agree on the exact length.
export const totalFrames = (props: VideoProps): number => {
  const intro: Scene = {type: 'title', seconds: INTRO_SECONDS};
  const outro: Scene[] = props.outro
    ? [{type: 'statement', seconds: OUTRO_SECONDS}]
    : [];
  const all = [intro, ...props.scenes, ...outro];
  const sum = all.reduce((acc, s) => acc + sceneFrames(s), 0);
  const overlap = Math.max(0, all.length - 1) * TRANSITION_FRAMES;
  const raw = sum - overlap;
  // Hard 10s ceiling: never render longer than MAX_TOTAL_SECONDS regardless of
  // the storyboard. The skill sizes storyboards to fit, so this rarely bites.
  return Math.min(MAX_TOTAL_SECONDS * FPS, Math.max(FPS, raw));
};
