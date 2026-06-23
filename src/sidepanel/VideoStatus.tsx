import type { VideoState } from '../shared/types';
import { formatTime } from '../shared/time';

interface VideoStatusProps {
  state: VideoState;
  onReplay: (seconds: number) => void;
}

export function VideoStatus({ state, onReplay }: VideoStatusProps) {
  return (
    <div className="video">
      <p className="video__title">{state.title ?? 'Untitled video'}</p>

      <dl className="fields">
        <div className="field">
          <dt>Video ID</dt>
          <dd>{state.videoId ?? '—'}</dd>
        </div>
        <div className="field">
          <dt>URL</dt>
          <dd>
            {state.url ? (
              <a href={state.url} target="_blank" rel="noreferrer">
                {state.url}
              </a>
            ) : (
              '—'
            )}
          </dd>
        </div>
        <div className="field">
          <dt>Time</dt>
          <dd>
            {formatTime(state.currentTime)} / {formatTime(state.duration)}
          </dd>
        </div>
        <div className="field">
          <dt>Status</dt>
          <dd>
            <span className={`badge badge--${state.paused ? 'paused' : 'playing'}`}>
              {state.paused ? 'Paused' : 'Playing'}
            </span>
          </dd>
        </div>
      </dl>

      <div className="controls">
        <button type="button" className="btn" onClick={() => onReplay(5)}>
          ⟲ Replay 5s
        </button>
        <button type="button" className="btn" onClick={() => onReplay(10)}>
          ⟲ Replay 10s
        </button>
      </div>
    </div>
  );
}
