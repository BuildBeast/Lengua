import type { VideoState, VideoPlatform } from '../../shared/types';
import type { CaptionState } from '../../shared/captions';

// === Platform adapter boundary ============================================
// A small seam so platform-specific page logic (reading video state, applying
// playback controls, discovering captions) lives behind one shape instead of
// being hardcoded into a single detector. Each content script owns exactly one
// adapter and wires it to the shared messaging protocol.
//
// This module is TYPE-ONLY — it exports no runtime values, so importing it from
// a content script erases at build time and never pulls a shared runtime chunk
// across the (deliberately disjoint) YouTube and Canal Sur bundles.
// ==========================================================================

export type { VideoPlatform };

/**
 * The wire `VideoState` already carries everything the spec's hypothetical
 * `PlatformVideoState` would (platform, url, title, currentTime, duration,
 * paused, optional id). We deliberately reuse it rather than fork a parallel
 * type — fewer shapes to keep in sync, and no migration of the existing UI.
 */
export type PlatformVideoState = VideoState;

export interface PlatformAdapter {
  /** Stable identifier for this platform. */
  platform: VideoPlatform;

  /** True when this adapter is responsible for the current page. */
  matchesPage(): boolean;

  /** Snapshot the current video, or null when nothing is detectable yet. */
  getVideoState(): PlatformVideoState | null;

  /** Rewind by `seconds`. Returns false when no controllable video exists. */
  replay(seconds: number): boolean;

  /** Seek to an absolute time in seconds. Returns false when not controllable. */
  seekTo(seconds: number): boolean;

  /**
   * Discover and parse captions for the current video. Optional: a platform
   * may not support caption discovery. One pass — the caller orchestrates any
   * retries while the page's player finishes loading.
   */
  loadCaptions?(): Promise<CaptionState>;
}
