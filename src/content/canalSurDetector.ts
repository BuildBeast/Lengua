import type { RuntimeMessage, AckResponse, CaptionStateResponse } from '../shared/messages';
import type { CaptionState } from '../shared/captions';
import { canalSurAdapter } from './platforms/canalSurAdapter';

// Content script (ISOLATED world) for canalsur.es / canalsurmas.es. It mirrors
// the YouTube detector's lifecycle + messaging safety, but drives the Canal Sur
// adapter instead: poll video state, probe for captions (with a few retries
// while the player loads), and answer state/seek requests from the side panel.
// No MAIN-world interceptor is needed — captions, when present, come from
// standard <track>/textTrack/VTT sources the ISOLATED world can read directly.

declare global {
  interface Window {
    __lenguaCanalSurLoaded?: boolean;
  }
}

let intervalId: ReturnType<typeof setInterval> | undefined;
let stopped = false;

// --- Lifecycle / messaging safety (same approach as youtubeDetector) --------

function extensionAlive(): boolean {
  try {
    return !!chrome.runtime?.id;
  } catch {
    return false;
  }
}

function teardown(): void {
  if (stopped) return;
  stopped = true;
  if (intervalId !== undefined) clearInterval(intervalId);
  intervalId = undefined;
}

function safeSend(message: RuntimeMessage): void {
  if (stopped) return;
  if (!extensionAlive()) {
    teardown();
    return;
  }
  try {
    const result = chrome.runtime.sendMessage(message);
    if (result && typeof result.catch === 'function') result.catch(() => {});
  } catch {
    teardown();
  }
}

// --- Video state ------------------------------------------------------------

function broadcastVideo(): void {
  const state = canalSurAdapter.getVideoState();
  if (state) safeSend({ type: 'VIDEO_STATE', state });
}

// --- Caption state ----------------------------------------------------------

let captionState: CaptionState = { status: 'idle', tracks: [], cues: [] };
let captionVideoId: string | null = null;
// Bumped on navigation so a slow probe for an old page can't clobber a newer one.
let captionToken = 0;
// How many probe passes we've made for the current page (the player/tracks can
// load late, so we retry a bounded number of times before settling).
let probeAttempts = 0;
let probing = false;
const MAX_PROBE_ATTEMPTS = 8;

function broadcastCaptions(): void {
  safeSend({ type: 'CAPTION_STATE', videoId: captionVideoId, state: captionState });
}

function setCaptionState(next: CaptionState): void {
  captionState = next;
  broadcastCaptions();
}

function resetCaptionsFor(videoId: string | null): void {
  captionToken++;
  captionVideoId = videoId;
  probeAttempts = 0;
  probing = false;
  setCaptionState({ status: videoId ? 'loading' : 'idle', tracks: [], cues: [] });
}

/** Run one caption probe pass, retrying on empty until the budget is spent. */
function probeCaptions(): void {
  if (probing || !canalSurAdapter.loadCaptions) return;
  if (captionState.status === 'ready') return;
  if (probeAttempts >= MAX_PROBE_ATTEMPTS) return;

  probing = true;
  probeAttempts++;
  const token = captionToken;

  canalSurAdapter
    .loadCaptions()
    .then((result) => {
      if (token !== captionToken) return; // navigated away mid-probe
      // Keep retrying while we still have budget and nothing was found yet;
      // surface the probe diagnostics so the panel isn't blank meanwhile.
      if (result.status === 'ready' || probeAttempts >= MAX_PROBE_ATTEMPTS) {
        setCaptionState(result);
      } else {
        setCaptionState({ ...result, status: 'loading' });
      }
    })
    .catch(() => {
      if (token === captionToken && probeAttempts >= MAX_PROBE_ATTEMPTS) {
        setCaptionState({ status: 'not_found', tracks: [], cues: [], error: 'no_captions' });
      }
    })
    .finally(() => {
      if (token === captionToken) probing = false;
    });
}

/** Align caption state with the current page; (re)kick probing as needed. */
function syncCaptions(): void {
  const state = canalSurAdapter.getVideoState();
  const id = state && (state.hasVideo || state.isWatchPage) ? state.videoId : null;

  if (!id) {
    if (captionVideoId !== null || captionState.status !== 'idle') resetCaptionsFor(null);
    return;
  }
  if (id !== captionVideoId) {
    resetCaptionsFor(id);
    return;
  }
  // Same page: only probe once a <video> actually exists.
  if (state?.hasVideo) probeCaptions();
}

// --- Polling ----------------------------------------------------------------

function tick(): void {
  if (stopped) return;
  if (!extensionAlive()) {
    teardown();
    return;
  }
  broadcastVideo();
  syncCaptions();
}

function startPolling(): void {
  if (stopped) return;
  if (intervalId !== undefined) clearInterval(intervalId);
  tick();
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
      sendResponse(canalSurAdapter.getVideoState());
      return true;

    case 'GET_CAPTION_STATE':
      sendResponse({ videoId: captionVideoId, state: captionState } satisfies CaptionStateResponse);
      return true;

    case 'REPLAY': {
      const ok = canalSurAdapter.replay(message.seconds);
      if (ok) broadcastVideo();
      sendResponse({ ok } satisfies AckResponse);
      return true;
    }

    case 'SEEK_TO': {
      const ok = canalSurAdapter.seekTo(message.seconds);
      if (ok) broadcastVideo();
      sendResponse({ ok } satisfies AckResponse);
      return true;
    }

    default:
      return false;
  }
}

function init(): void {
  if (!canalSurAdapter.matchesPage()) return;
  if (window.__lenguaCanalSurLoaded) return;
  window.__lenguaCanalSurLoaded = true;

  chrome.runtime.onMessage.addListener(handleMessage);
  startPolling();
}

init();
