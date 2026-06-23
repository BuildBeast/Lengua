import type { RuntimeMessage, AckResponse, CaptionStateResponse } from '../shared/messages';
import type { CaptionState, CaptionTrack } from '../shared/captions';
import { findVideo, getVideoId, isWatchPage, readVideoState } from './videoState';
import { isSpanishCode, mapTracks, selectSpanishTrack, type RawTrack } from './captionTracks';
import { resolveCapturedCaption } from './youtubeCaptions';

// Content script (ISOLATED world). Runs on every youtube.com page (we gate on
// the URL at runtime so it survives YouTube's SPA navigations). It pairs with
// captionInterceptor.ts (MAIN world), which forwards the player's caption data
// via window.postMessage. Responsibilities:
//   1. Poll the active video once per second and broadcast its state.
//   2. Turn intercepted caption data into Spanish cues + broadcast them.
//   3. Answer on-demand state requests from the side panel.
//   4. Apply replay / seek commands to the <video> element.

const CC_TAG = '__lengua_cc__';

declare global {
  interface Window {
    __lenguaContentLoaded?: boolean;
  }
}

let intervalId: ReturnType<typeof setInterval> | undefined;
let stopped = false;

// --- Lifecycle / messaging safety ------------------------------------------

/**
 * After the extension is reloaded/updated, a content script injected by the
 * previous instance keeps running but its context is dead. Touching
 * chrome.runtime then throws "Extension context invalidated" *synchronously*,
 * which a promise .catch() can't catch. Detect that and go quiet.
 */
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

/** Fire-and-forget send that tolerates a dead context and a closed receiver. */
function safeSend(message: RuntimeMessage): void {
  if (stopped) return;
  if (!extensionAlive()) {
    teardown();
    return;
  }
  try {
    const result = chrome.runtime.sendMessage(message);
    // No-op rejection when the side panel isn't open ("Could not establish
    // connection") — expected, so we swallow it.
    if (result && typeof result.catch === 'function') result.catch(() => {});
  } catch {
    teardown(); // context invalidated between the check and the call
  }
}

// --- Video state -----------------------------------------------------------

function broadcastVideo(): void {
  safeSend({ type: 'VIDEO_STATE', state: readVideoState() });
}

// --- Caption state ----------------------------------------------------------

let captionState: CaptionState = { status: 'idle', tracks: [], cues: [] };
let captionVideoId: string | null = null;
// Bumped whenever the video changes so a slow async resolve for an old video
// can't clobber a newer one — the classic race guard.
let captionToken = 0;

function broadcastCaptions(): void {
  safeSend({ type: 'CAPTION_STATE', videoId: captionVideoId, state: captionState });
}

function setCaptionState(next: CaptionState): void {
  captionState = next;
  broadcastCaptions();
}

/** Reset caption state for a (new) video; cues now arrive via interception. */
function resetCaptionsFor(videoId: string | null): void {
  captionToken++;
  captionVideoId = videoId;
  setCaptionState({ status: videoId ? 'loading' : 'idle', tracks: [], cues: [] });
}

/** Keep caption state aligned with the current video id. Cheap to call often. */
function syncCaptions(): void {
  const id = getVideoId();
  const onWatch = isWatchPage() && !!id;

  if (!onWatch) {
    if (captionVideoId !== null || captionState.status !== 'idle') resetCaptionsFor(null);
    return;
  }
  if (id !== captionVideoId) resetCaptionsFor(id);
}

/** Handle a track list reported by the MAIN-world interceptor. */
function handleTracks(rawTracks: RawTrack[]): void {
  // Don't downgrade a video we already have cues for.
  if (captionState.status === 'ready') return;

  const tracks = mapTracks(rawTracks);
  if (tracks.length === 0) {
    setCaptionState({ status: 'not_found', tracks: [], cues: [], error: 'no_tracks' });
    return;
  }

  const selectedTrack = selectSpanishTrack(tracks);
  if (!selectedTrack) {
    setCaptionState({ status: 'not_found', tracks, cues: [], error: 'no_spanish' });
    return;
  }

  // Spanish exists; we just need the player to fetch it so we can capture it.
  setCaptionState({ status: 'awaiting_captions', tracks, selectedTrack, cues: [] });
}

/** Spanish if the timedtext URL's lang/tlang is es*. */
function capturedLangIsSpanish(url: string): boolean {
  try {
    const params = new URL(url).searchParams;
    return isSpanishCode(params.get('tlang')) || isSpanishCode(params.get('lang'));
  } catch {
    return false;
  }
}

/** Handle a captured timedtext response from the MAIN-world interceptor. */
async function handleCapturedCaption(url: string, body: string): Promise<void> {
  // Only mirror Spanish (the product is Spanish-only); ignore other tracks the
  // user might enable.
  if (!capturedLangIsSpanish(url)) return;

  const token = captionToken;
  const { cues, diagnostics } = await resolveCapturedCaption(url, body);
  if (token !== captionToken) return; // video changed mid-resolve

  const tracks = captionState.tracks;
  const selectedTrack: CaptionTrack | undefined =
    captionState.selectedTrack ?? selectSpanishTrack(tracks);

  if (cues.length === 0) {
    setCaptionState({
      status: 'error',
      tracks,
      selectedTrack,
      cues: [],
      error: `parse_failed | ${diagnostics}`,
    });
    return;
  }

  setCaptionState({ status: 'ready', tracks, selectedTrack, cues });
}

/** Bridge: messages posted by the MAIN-world interceptor (same window only). */
function handlePageMessage(event: MessageEvent): void {
  if (event.source !== window) return;
  const data = event.data as
    | { [CC_TAG]?: boolean; videoId?: string | null; kind?: string; tracks?: RawTrack[]; url?: string; body?: string }
    | null;
  if (!data || data[CC_TAG] !== true) return;

  // Ignore data for a different (e.g. just-navigated-away) video.
  if (data.videoId && data.videoId !== captionVideoId) return;

  if (data.kind === 'tracks' && Array.isArray(data.tracks)) {
    handleTracks(data.tracks);
  } else if (data.kind === 'timedtext' && typeof data.url === 'string') {
    void handleCapturedCaption(data.url, data.body ?? '');
  }
}

// --- Polling + navigation ---------------------------------------------------

function tick(): void {
  if (stopped) return;
  if (!extensionAlive()) {
    teardown();
    return;
  }
  broadcastVideo();
  syncCaptions();
}

/** (Re)start the once-per-second loop. Safe to call repeatedly. */
function startPolling(): void {
  if (stopped) return;
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

  // Caption data forwarded from the MAIN-world interceptor.
  window.addEventListener('message', handlePageMessage);

  // YouTube is a single-page app: route changes fire this event instead of a
  // full page load. Restarting the loop re-snapshots and re-syncs captions for
  // the new video id (clearing the old transcript immediately).
  window.addEventListener('yt-navigate-finish', startPolling);

  startPolling();
}

init();
