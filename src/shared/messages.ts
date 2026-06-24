import type { VideoState } from './types';
import type { CaptionState } from './captions';

// Message protocol between the side panel, the background worker, and the
// content script. This module is TYPE-ONLY on purpose: it exports no runtime
// values, so every file can `import type` it and the imports vanish at build
// time. That keeps the content script free of cross-chunk imports (a classic
// content script cannot use ES `import`).

/** Side panel -> content script: please reply with the current VideoState. */
export interface GetVideoStateMessage {
  type: 'GET_VIDEO_STATE';
}

/** Content script -> everyone: a fresh VideoState snapshot. */
export interface VideoStateMessage {
  type: 'VIDEO_STATE';
  state: VideoState;
}

/** Side panel -> content script: rewind the video by `seconds`. */
export interface ReplayMessage {
  type: 'REPLAY';
  seconds: number;
}

/** Side panel -> content script: seek to an absolute time in seconds. */
export interface SeekToMessage {
  type: 'SEEK_TO';
  seconds: number;
}

/** Side panel -> content script: please reply with the current CaptionState. */
export interface GetCaptionStateMessage {
  type: 'GET_CAPTION_STATE';
}

/** Content script -> everyone: caption state for `videoId` changed. */
export interface CaptionStateMessage {
  type: 'CAPTION_STATE';
  videoId: string | null;
  state: CaptionState;
}

// --- Tab-audio recording for transcription (no-caption fallback) -----------
//
// Capture a short window of the current tab's audio so the side panel can send
// it for Spanish transcription. Flow:
//   side panel  --AUDIO_RECORD_START_REQUEST-->  service worker
//   service worker  --AUDIO_RECORD (target:'offscreen')-->  offscreen doc
//   offscreen doc  --AudioRecordResult-->  service worker  -->  side panel
// The service worker obtains the tab-audio stream id via
// chrome.tabCapture.getMediaStreamId against the active tab. Doing it in the
// worker is what carries the extension's activeTab invocation (granted when the
// user clicks the toolbar icon) — the side panel context does not.
//
// The recorded clip travels back as an in-memory data: URL and never leaves the
// device. Transcription is planned to run fully on-device (no API, no key, no
// backend) — see docs/audio-transcription-plan.md.

/** Side panel -> service worker: record the active tab's audio. */
export interface AudioRecordStartRequestMessage {
  type: 'AUDIO_RECORD_START_REQUEST';
  /** Routing discriminator so only the worker handles this. */
  target: 'background';
  /** How long to record, milliseconds. */
  durationMs: number;
}

/** Service worker -> offscreen document: record + analyse this stream. */
export interface AudioRecordMessage {
  type: 'AUDIO_RECORD';
  /** Routing discriminator so only the offscreen doc handles this. */
  target: 'offscreen';
  streamId: string;
  durationMs: number;
}

/**
 * Result of one recording, returned offscreen -> worker -> side panel. The
 * audio lives only in memory (a data: URL) for the panel's lifetime; nothing is
 * written to disk and nothing is sent off-device.
 */
export interface AudioRecordResult {
  /** True when capture + recording completed (regardless of silence). */
  ok: boolean;
  /** Human-readable failure reason when `ok` is false. */
  error?: string;
  /** The recorded clip as an in-memory data: URL (e.g. audio/webm;codecs=opus). */
  audioDataUrl?: string;
  /** MIME type the clip was recorded as. */
  mimeType?: string;
  /** Size of the recorded clip in bytes. */
  blobSize?: number;
  /** Decoded audio duration in seconds (authoritative). */
  durationSec?: number;
  /** Wall-clock recording time in milliseconds. */
  wallMs?: number;
  /** True when the clip is judged non-silent (see offscreen analysis). */
  nonSilent?: boolean;
  /** Peak absolute sample amplitude, 0..1. */
  peak?: number;
  /** Root-mean-square amplitude across the clip, 0..1. */
  rms?: number;
}

export type RuntimeMessage =
  | GetVideoStateMessage
  | VideoStateMessage
  | ReplayMessage
  | SeekToMessage
  | GetCaptionStateMessage
  | CaptionStateMessage;

/** Reply to REPLAY / SEEK_TO. */
export interface AckResponse {
  ok: boolean;
}

/** Reply to GET_CAPTION_STATE. */
export interface CaptionStateResponse {
  videoId: string | null;
  state: CaptionState;
}
