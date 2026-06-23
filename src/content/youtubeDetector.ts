import type { RuntimeMessage, ReplayResponse } from '../shared/messages';
import { findVideo, readVideoState } from './videoState';

// Content script. Runs on every youtube.com page (we gate on the URL at
// runtime so it survives YouTube's single-page navigations). Responsibilities:
//   1. Poll the active video once per second and broadcast its state.
//   2. Answer on-demand state requests from the side panel.
//   3. Apply replay commands by rewinding the <video> element.

declare global {
  interface Window {
    __lenguaContentLoaded?: boolean;
  }
}

let intervalId: ReturnType<typeof setInterval> | undefined;

/** Read the current state and push it to any listening extension contexts. */
function broadcast(): void {
  const message: RuntimeMessage = { type: 'VIDEO_STATE', state: readVideoState() };
  // No-op rejection when the side panel isn't open ("Could not establish
  // connection") — expected, so we swallow it.
  chrome.runtime.sendMessage(message).catch(() => {});
}

/** (Re)start the once-per-second polling loop. Safe to call repeatedly. */
function startPolling(): void {
  if (intervalId !== undefined) clearInterval(intervalId);
  broadcast(); // push an immediate snapshot on (re)start
  intervalId = setInterval(broadcast, 1000);
}

function handleMessage(
  message: RuntimeMessage,
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
): boolean {
  switch (message.type) {
    case 'GET_VIDEO_STATE':
      sendResponse(readVideoState());
      return true;

    case 'REPLAY': {
      const video = findVideo();
      if (video) {
        video.currentTime = Math.max(0, video.currentTime - message.seconds);
        broadcast(); // reflect the new position immediately
      }
      sendResponse({ ok: !!video } satisfies ReplayResponse);
      return true;
    }

    // VIDEO_STATE messages originate here / from sibling tabs — ignore them.
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
  // full page load, so we re-snapshot whenever navigation finishes.
  window.addEventListener('yt-navigate-finish', startPolling);

  startPolling();
}

init();
