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
