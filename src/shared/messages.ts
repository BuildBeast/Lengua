import type { VideoState } from './types';

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

export type RuntimeMessage = GetVideoStateMessage | VideoStateMessage | ReplayMessage;

/** Reply to a REPLAY message. */
export interface ReplayResponse {
  ok: boolean;
}
