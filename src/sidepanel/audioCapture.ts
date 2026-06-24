// Side-panel audio capture.
//
// Asks the service worker to capture N ms of the active tab's audio (via the
// offscreen document) and returns the clip as an in-memory data: URL plus
// silence/size metadata. Nothing is sent off-device by this call — capture is
// the foundation the (future, local) transcription step will build on.

import type {
  AudioRecordResult,
  AudioRecordStartRequestMessage,
} from '../shared/messages';

/**
 * Record `durationMs` of the active tab's audio via the service worker +
 * offscreen document. Returns the clip as an in-memory data: URL (plus
 * silence/size metadata) — nothing leaves the device.
 */
export async function recordTabAudio(durationMs: number): Promise<AudioRecordResult> {
  if (!chrome?.runtime?.sendMessage) {
    return {
      ok: false,
      error: 'Extension messaging is unavailable (open the panel as an extension).',
    };
  }
  const message: AudioRecordStartRequestMessage = {
    type: 'AUDIO_RECORD_START_REQUEST',
    target: 'background',
    durationMs,
  };
  const result = (await chrome.runtime.sendMessage(message)) as AudioRecordResult | undefined;
  return result ?? { ok: false, error: 'No response from the audio recorder.' };
}
