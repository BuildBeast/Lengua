// Which content platform a video state came from. `unknown` is used by the
// side panel for pages we don't have an adapter for.
export type VideoPlatform = 'youtube' | 'canalsur' | 'unknown';

// Snapshot of the active video, produced by a platform content script and
// rendered by the side panel. Kept deliberately flat and JSON-serializable so
// it can travel over chrome runtime messaging unchanged. The shape is shared
// across platforms (YouTube, Canal Sur, …); `platform` says which adapter
// produced it.
export interface VideoState {
  /** The platform whose content script produced this snapshot. */
  platform: VideoPlatform;
  /**
   * True when the active tab is a recognised video page for the platform
   * (YouTube: a `/watch?v=` page; Canal Sur: a page that looks like it hosts a
   * video).
   */
  isWatchPage: boolean;
  /** True when an HTML <video> element was found on the page. */
  hasVideo: boolean;
  /** The `v` query param of the watch URL, e.g. "dQw4w9WgXcQ". */
  videoId: string | null;
  /** Canonical watch URL rebuilt from the video id. */
  url: string | null;
  /** Best-effort human title (video metadata, falling back to document title). */
  title: string | null;
  /** Playback position in seconds. */
  currentTime: number;
  /** Total duration in seconds (0 when unknown, e.g. during ads/loading). */
  duration: number;
  /** True when playback is paused. */
  paused: boolean;
}
