import type { RuntimeMessage, AckResponse, CaptionStateResponse } from '../shared/messages';
import type { CaptionState } from '../shared/captions';
import { findVideo, getVideoId, isWatchPage, readVideoState } from './videoState';
import { fetchCaptionTracks, selectSpanishTrack } from './captionTracks';
import { fetchCaptionCues } from './youtubeCaptions';

// Content script. Runs on every youtube.com page (we gate on the URL at
// runtime so it survives YouTube's single-page navigations). Responsibilities:
//   1. Poll the active video once per second and broadcast its state.
//   2. Discover + fetch Spanish caption cues for the current video.
//   3. Answer on-demand state requests from the side panel.
//   4. Apply replay / seek commands to the <video> element.

declare global {
  interface Window {
    __lenguaContentLoaded?: boolean;
  }
}

let intervalId: ReturnType<typeof setInterval> | undefined;

// --- Video state -----------------------------------------------------------

/** Read the current state and push it to any listening extension contexts. */
function broadcastVideo(): void {
  const message: RuntimeMessage = { type: 'VIDEO_STATE', state: readVideoState() };
  // No-op rejection when the side panel isn't open ("Could not establish
  // connection") — expected, so we swallow it.
  chrome.runtime.sendMessage(message).catch(() => {});
}

// --- Caption state ----------------------------------------------------------

let captionState: CaptionState = { status: 'idle', tracks: [], cues: [] };
let captionVideoId: string | null = null;
// Bumped on every (re)load so a slow fetch for an old video can't clobber a
// newer one — the classic async race guard.
let captionToken = 0;

function broadcastCaptions(): void {
  const message: RuntimeMessage = {
    type: 'CAPTION_STATE',
    videoId: captionVideoId,
    state: captionState,
  };
  chrome.runtime.sendMessage(message).catch(() => {});
}

function setCaptionState(next: CaptionState): void {
  captionState = next;
  broadcastCaptions();
}

async function loadCaptionsForVideo(videoId: string): Promise<void> {
  const token = ++captionToken;
  captionVideoId = videoId;
  setCaptionState({ status: 'loading', tracks: [], cues: [] }); // clears stale cues

  try {
    const tracks = await fetchCaptionTracks(videoId);
    if (token !== captionToken) return; // superseded by a newer video

    if (tracks.length === 0) {
      setCaptionState({ status: 'not_found', tracks: [], cues: [], error: 'no_tracks' });
      return;
    }

    const selectedTrack = selectSpanishTrack(tracks);
    if (!selectedTrack) {
      setCaptionState({ status: 'not_found', tracks, cues: [], error: 'no_spanish' });
      return;
    }

    const cues = await fetchCaptionCues(selectedTrack);
    if (token !== captionToken) return;

    if (cues.length === 0) {
      setCaptionState({ status: 'error', tracks, selectedTrack, cues: [], error: 'parse_failed' });
      return;
    }

    setCaptionState({ status: 'ready', tracks, selectedTrack, cues });
  } catch (err) {
    if (token !== captionToken) return;
    setCaptionState({ status: 'error', tracks: [], cues: [], error: String(err) });
  }
}

/** Keep caption state in sync with the current video id. Cheap to call often. */
function syncCaptions(): void {
  const id = getVideoId();

  if (!isWatchPage() || !id) {
    if (captionVideoId !== null || captionState.status !== 'idle') {
      captionToken++; // cancel any in-flight load
      captionVideoId = null;
      setCaptionState({ status: 'idle', tracks: [], cues: [] });
    }
    return;
  }

  // Already handling this video (loaded, loading, or terminal) — don't refetch.
  if (id === captionVideoId) return;

  void loadCaptionsForVideo(id);
}

// --- Polling + navigation ---------------------------------------------------

function tick(): void {
  broadcastVideo();
  syncCaptions();
}

/** (Re)start the once-per-second loop. Safe to call repeatedly. */
function startPolling(): void {
  if (intervalId !== undefined) clearInterval(intervalId);
  tick(); // immediate snapshot + caption sync on (re)start
  intervalId = setInterval(tick, 1000);
}

// --- Messaging --------------------------------------------------------------

function handleMessage(
  message: RuntimeMessage,
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
): boolean {
  switch (message.type) {
    case 'GET_VIDEO_STATE':
      sendResponse(readVideoState());
      return true;

    case 'GET_CAPTION_STATE':
      sendResponse({ videoId: captionVideoId, state: captionState } satisfies CaptionStateResponse);
      return true;

    case 'REPLAY': {
      const video = findVideo();
      if (video) {
        video.currentTime = Math.max(0, video.currentTime - message.seconds);
        broadcastVideo();
      }
      sendResponse({ ok: !!video } satisfies AckResponse);
      return true;
    }

    case 'SEEK_TO': {
      const video = findVideo();
      if (video) {
        video.currentTime = Math.max(0, message.seconds);
        broadcastVideo();
      }
      sendResponse({ ok: !!video } satisfies AckResponse);
      return true;
    }

    // VIDEO_STATE / CAPTION_STATE originate here / from sibling tabs — ignore.
    default:
      return false;
  }
}

function init(): void {
  // Guard against double-injection creating duplicate intervals.
  if (window.__lenguaContentLoaded) return;
  window.__lenguaContentLoaded = true;

  chrome.runtime.onMessage.addListener(handleMessage);

  // YouTube is a single-page app: route changes fire this event instead of a
  // full page load. Restarting the loop re-snapshots and re-syncs captions for
  // the new video id (clearing the old transcript immediately).
  window.addEventListener('yt-navigate-finish', startPolling);

  startPolling();
}

init();
