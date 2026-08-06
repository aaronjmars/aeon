import {Config} from '@remotion/cli/config';

// H.264 MP4 is the most broadly playable output (Telegram, browsers, phones).
Config.setVideoImageFormat('jpeg');
Config.setCodec('h264');
Config.setPixelFormat('yuv420p'); // required for QuickTime / most players
Config.setOverwriteOutput(true);

// CI headless-shell hardening: the runner has no GPU and a bare sandbox.
Config.setChromiumOpenGlRenderer('swangle');
