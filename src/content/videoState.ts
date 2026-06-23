import type { VideoState } from '../shared/types';

// Pure-ish helpers for reading the current YouTube video state from the DOM.
// Imported only by youtubeDetector.ts, so this gets inlined into the single
// content-script bundle (no shared chunk, no runtime ES imports emitted).

/** A YouTube watch page is `/watch` with a `v` query param. */
export function isWatchPage(): boolean {
  return location.pathname === '/watch' && new URL(location.href).searchParams.has('v');
}

export function getVideoId(): string | null {
  return new URL(location.href).searchParams.get('v');
}

function getCanonicalUrl(id: string | null): string | null {
  return id ? `https://www.youtube.com/watch?v=${id}` : null;
}

/**
 * Best-effort video title. Prefers the on-page metadata element (which matches
 * the real video title) and falls back to the document title with the
 * " - YouTube" suffix stripped. The metadata element can populate late, so
 * callers re-read this on every tick.
 */
function getTitle(): string | null {
  const el = document.querySelector(
    'h1.ytd-watch-metadata yt-formatted-string, h1.title yt-formatted-string',
  );
  const fromMetadata = el?.textContent?.trim();
  if (fromMetadata) return fromMetadata;

  const fromDocument = document.title.replace(/\s*-\s*YouTube\s*$/, '').trim();
  return fromDocument || null;
}

/** Locate the main HTML video element (may be absent during early load/ads). */
export function findVideo(): HTMLVideoElement | null {
  return (
    document.querySelector<HTMLVideoElement>('video.html5-main-video') ??
    document.querySelector<HTMLVideoElement>('video')
  );
}

const INACTIVE: VideoState = {
  platform: 'youtube',
  isWatchPage: false,
  hasVideo: false,
  videoId: null,
  url: null,
  title: null,
  currentTime: 0,
  duration: 0,
  paused: true,
};

/** Read a fresh snapshot of the current video state. */
export function readVideoState(): VideoState {
  if (!isWatchPage()) return INACTIVE;

  const id = getVideoId();
  const url = getCanonicalUrl(id);
  const title = getTitle();
  const video = findVideo();

  if (!video) {
    return { ...INACTIVE, isWatchPage: true, videoId: id, url, title };
  }

  return {
    platform: 'youtube',
    isWatchPage: true,
    hasVideo: true,
    videoId: id,
    url,
    title,
    currentTime: video.currentTime || 0,
    duration: Number.isFinite(video.duration) ? video.duration : 0,
    paused: video.paused,
  };
}
