import type { PlatformAdapter, PlatformVideoState } from './types';
import { findVideo, isWatchPage, readVideoState } from '../videoState';

// YouTube adapter. Thin wrapper over the existing, proven videoState helpers so
// YouTube's video-state and playback-control paths go through the shared
// adapter boundary. Caption discovery on YouTube is intentionally NOT routed
// through `loadCaptions` here — it relies on the MAIN-world interceptor and a
// race-guarded state machine in youtubeDetector.ts, which stays untouched.

export const youtubeAdapter: PlatformAdapter = {
  platform: 'youtube',

  matchesPage(): boolean {
    return isWatchPage();
  },

  getVideoState(): PlatformVideoState {
    return readVideoState();
  },

  replay(seconds: number): boolean {
    const video = findVideo();
    if (!video) return false;
    video.currentTime = Math.max(0, video.currentTime - seconds);
    return true;
  },

  seekTo(seconds: number): boolean {
    const video = findVideo();
    if (!video) return false;
    video.currentTime = Math.max(0, seconds);
    return true;
  },
};
