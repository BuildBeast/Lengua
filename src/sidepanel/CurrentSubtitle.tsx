import type { CaptionCue } from '../shared/captions';

interface CurrentSubtitleProps {
  /** -1 when no cue is active at the current playback time. */
  activeIndex: number;
  cues: CaptionCue[];
  hasCaptions: boolean;
  onReplayLine: (cue: CaptionCue) => void;
}

/** Previous / current / next lines, plus a replay-current-line control. */
export function CurrentSubtitle({
  activeIndex,
  cues,
  hasCaptions,
  onReplayLine,
}: CurrentSubtitleProps) {
  const active = activeIndex >= 0 ? cues[activeIndex] : undefined;
  const prev = activeIndex > 0 ? cues[activeIndex - 1] : undefined;
  const next = activeIndex >= 0 && activeIndex < cues.length - 1 ? cues[activeIndex + 1] : undefined;

  return (
    <section className="card">
      <h2 className="card__heading">Current subtitle</h2>

      {!hasCaptions ? (
        <p className="empty">Current subtitle will appear here once captions load.</p>
      ) : (
        <div className="subtitle">
          {prev && <p className="subtitle__line subtitle__line--muted">{prev.text}</p>}

          {active ? (
            <p className="subtitle__line subtitle__line--current">{active.text}</p>
          ) : (
            <p className="subtitle__line subtitle__line--current empty">
              No active subtitle at this moment.
            </p>
          )}

          {next && <p className="subtitle__line subtitle__line--muted">{next.text}</p>}

          <button
            type="button"
            className="btn"
            disabled={!active}
            onClick={() => active && onReplayLine(active)}
          >
            ⟲ Replay current line
          </button>
        </div>
      )}
    </section>
  );
}
