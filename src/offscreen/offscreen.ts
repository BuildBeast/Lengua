// Offscreen document — tab-audio capture for transcription.
//
// MV3 service workers have no getUserMedia / AudioContext / MediaRecorder, so
// the actual capture runs here. Given a tab-audio stream id (obtained by the
// service worker after the user's toolbar-icon invocation), this:
//   1. opens the stream with getUserMedia(chromeMediaSource: 'tab'),
//   2. re-routes it through an AudioContext to the speakers so the user keeps
//      *hearing* the tab (raw tab capture otherwise swallows playback),
//   3. records the requested window with MediaRecorder,
//   4. decodes the clip to measure peak / RMS (used to flag silent captures),
//   5. returns the clip as an in-memory data: URL plus that metadata.
//
// Nothing is persisted and nothing is sent off-device: the clip lives only as
// an in-memory Blob, returned as a data: URL for the side panel to use.
// Transcription is planned to run fully on-device (no API, no key, no backend).

import type { AudioRecordMessage, AudioRecordResult } from '../shared/messages';

/** Above this peak (0..1) we consider the clip to contain real audio. */
const NON_SILENT_PEAK_THRESHOLD = 0.01;

/** Pick a MediaRecorder MIME type the browser actually supports. */
function pickMimeType(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
  for (const mime of candidates) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return '';
}

/** Record `durationMs` of `stream` and resolve with the captured blob. */
function recordFor(stream: MediaStream, durationMs: number, mimeType: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const recorder = mimeType
      ? new MediaRecorder(stream, { mimeType })
      : new MediaRecorder(stream);
    const chunks: Blob[] = [];

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.onerror = () => reject(new Error('MediaRecorder error'));
    recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType || mimeType }));

    recorder.start();
    setTimeout(() => {
      if (recorder.state !== 'inactive') recorder.stop();
    }, durationMs);
  });
}

/** Max abs sample (peak) and RMS across all channels of a decoded buffer. */
function analyse(buffer: AudioBuffer): { peak: number; rms: number } {
  let peak = 0;
  let sumSquares = 0;
  let count = 0;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i++) {
      const v = Math.abs(data[i]);
      if (v > peak) peak = v;
      sumSquares += data[i] * data[i];
      count++;
    }
  }
  const rms = count > 0 ? Math.sqrt(sumSquares / count) : 0;
  return { peak, rms };
}

/** Convert a blob to a data: URL the side panel can reconstruct into a Blob. */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read clip'));
    reader.readAsDataURL(blob);
  });
}

async function runRecording(msg: AudioRecordMessage): Promise<AudioRecordResult> {
  let stream: MediaStream | null = null;
  let audioContext: AudioContext | null = null;
  try {
    // Open the captured tab-audio stream. The constraint shape uses the legacy
    // `mandatory` form, which is what chromeMediaSource: 'tab' requires.
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        // @ts-expect-error -- non-standard Chrome tab-capture constraints.
        mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: msg.streamId },
      },
      video: false,
    });

    // Keep the tab audible: route the captured stream to the speakers. Without
    // this, tab capture removes the audio from normal output.
    audioContext = new AudioContext();
    audioContext.createMediaStreamSource(stream).connect(audioContext.destination);

    const mimeType = pickMimeType();
    const startedAt = performance.now();
    const blob = await recordFor(stream, msg.durationMs, mimeType);
    const wallMs = Math.round(performance.now() - startedAt);

    // Decode the recorded clip to inspect the actual samples we captured, so the
    // side panel can warn before sending an empty/silent clip for transcription.
    const arrayBuffer = await blob.arrayBuffer();
    let peak = 0;
    let rms = 0;
    let durationSec = 0;
    try {
      // decodeAudioData needs a fresh copy; slice() guards against the buffer
      // being detached by the recorder's last chunk.
      const decoded = await audioContext.decodeAudioData(arrayBuffer.slice(0));
      durationSec = decoded.duration;
      ({ peak, rms } = analyse(decoded));
    } catch {
      // Decode failed (e.g. zero-length clip) — leave metrics at 0; capture
      // itself still "succeeded" so the panel can report the blob size.
    }

    const result: AudioRecordResult = {
      ok: true,
      mimeType: blob.type || mimeType,
      blobSize: blob.size,
      durationSec,
      wallMs,
      nonSilent: peak >= NON_SILENT_PEAK_THRESHOLD,
      peak,
      rms,
    };

    // Hand the whole clip back as a data: URL so the side panel can rebuild the
    // Blob and POST it to the transcription provider. In-memory only.
    if (blob.size > 0) {
      result.audioDataUrl = await blobToDataUrl(blob);
    }

    return result;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    // Tear everything down so nothing keeps capturing or lingers in memory.
    stream?.getTracks().forEach((t) => t.stop());
    audioContext?.close().catch(() => {});
  }
}

chrome.runtime.onMessage.addListener((message: AudioRecordMessage, _sender, sendResponse) => {
  if (message?.target !== 'offscreen' || message.type !== 'AUDIO_RECORD') return;
  runRecording(message).then(sendResponse);
  return true; // async sendResponse
});
