// Snapshot of the active YouTube video, produced by the content script and
// rendered by the side panel. Kept deliberately flat and JSON-serializable so
// it can travel over chrome runtime messaging unchanged.
export interface VideoState {
  /** True when the active tab is a YouTube /watch page. */
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
