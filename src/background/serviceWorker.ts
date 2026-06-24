// Background service worker (MV3).
//
// Two jobs:
//  1. Open the Lengua side panel when the toolbar icon is clicked, and remember
//     which tab the icon was invoked on. That click is what grants the
//     extension its `activeTab` invocation for the tab — the prerequisite for
//     capturing the tab's audio.
//  2. Record tab audio for transcription: the side panel asks us to record, we
//     resolve the active tab, obtain a tab-audio stream id via
//     chrome.tabCapture.getMediaStreamId (this MUST run here, where the
//     activeTab invocation lives — not in the side panel), ensure the offscreen
//     document exists, forward the stream id to it, and pass the clip back.
//
// Caption/video state still flows directly between the content script and the
// side panel, so no relaying is needed for that.

import type {
  AudioRecordStartRequestMessage,
  AudioRecordMessage,
  AudioRecordResult,
} from '../shared/messages';

const OFFSCREEN_URL = 'offscreen.html';

/**
 * The tab the toolbar icon was last invoked on. tabCapture only works on a tab
 * the extension has been *invoked* on (activeTab), and that invocation happens
 * when the user clicks the action icon — so we capture the id here and use it
 * (after confirming it is still the active tab) as the capture target.
 */
let invokedTabId: number | undefined;

// Open the panel ourselves on icon click (rather than openPanelOnActionClick),
// so action.onClicked fires and we can record the invoked tab. Setting the
// behavior to false ensures the event is dispatched.
function configureActionBehavior(): void {
  chrome.sidePanel
    ?.setPanelBehavior({ openPanelOnActionClick: false })
    .catch((err) => console.warn('[Lengua] setPanelBehavior failed', err));
}

chrome.runtime.onInstalled.addListener(configureActionBehavior);
chrome.runtime.onStartup.addListener(configureActionBehavior);

chrome.action.onClicked.addListener((tab) => {
  if (tab.id === undefined) return;
  // Remember the invoked tab (carries the activeTab grant), then open the panel
  // for it. open() must be called synchronously within the click gesture.
  invokedTabId = tab.id;
  chrome.sidePanel.open({ tabId: tab.id }).catch((err) => {
    console.warn('[Lengua] sidePanel.open failed', err);
  });
});

/** Promise wrapper around the callback-only getMediaStreamId. */
function getTabStreamId(targetTabId: number): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId }, (streamId) => {
      const err = chrome.runtime.lastError;
      if (err || !streamId) reject(new Error(err?.message ?? 'No stream id returned'));
      else resolve(streamId);
    });
  });
}

/** Ensure the single offscreen document exists (for tab-audio capture). */
async function ensureOffscreenDocument(): Promise<void> {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: [chrome.offscreen.Reason.USER_MEDIA],
    justification: 'Record a short window of tab audio for Spanish transcription.',
  });
}

/** Hint appended to capture errors that look like a missing activeTab grant. */
const INVOKE_HINT = 'Click the Lengua toolbar icon while this video tab is active, then try again.';

/**
 * Resolve the active tab, grab its audio stream id, record + analyse it in the
 * offscreen document, and return the clip.
 */
async function runAudioRecording(msg: AudioRecordStartRequestMessage): Promise<AudioRecordResult> {
  try {
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!active?.id) return { ok: false, error: 'No active tab to capture.' };

    // The activeTab grant is tied to the tab the icon was invoked on. If the
    // user has since switched tabs, capturing would target the wrong tab (or be
    // rejected) — steer them to re-invoke on the video tab.
    if (invokedTabId !== undefined && invokedTabId !== active.id) {
      return {
        ok: false,
        error: `The active tab changed since Lengua was opened. ${INVOKE_HINT}`,
      };
    }

    let streamId: string;
    try {
      streamId = await getTabStreamId(active.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `${message} — ${INVOKE_HINT}` };
    }

    await ensureOffscreenDocument();
    const record: AudioRecordMessage = {
      type: 'AUDIO_RECORD',
      target: 'offscreen',
      streamId,
      durationMs: msg.durationMs,
    };
    const result = (await chrome.runtime.sendMessage(record)) as AudioRecordResult;
    return result ?? { ok: false, error: 'No response from offscreen document' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    // Tear the offscreen doc down so nothing keeps capturing between recordings.
    if (await chrome.offscreen.hasDocument().catch(() => false)) {
      await chrome.offscreen.closeDocument().catch(() => {});
    }
  }
}

chrome.runtime.onMessage.addListener(
  (message: AudioRecordStartRequestMessage, _sender, sendResponse) => {
    // Only handle the record-start request; everything else (video/caption
    // state) is handled directly by the content script and side panel.
    if (message?.target !== 'background' || message.type !== 'AUDIO_RECORD_START_REQUEST') return;
    runAudioRecording(message).then(sendResponse);
    return true; // async sendResponse
  },
);
