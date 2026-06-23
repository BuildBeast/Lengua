import { useEffect, useRef } from 'react';
import type { CaptionCue } from '../shared/captions';
import { formatTime } from '../shared/time';

interface TranscriptListProps {
  cues: CaptionCue[];
  activeIndex: number;
  onSeek: (cue: CaptionCue) => void;
}

/** Scrollable transcript; the active cue is highlighted and auto-scrolled into view. */
export function TranscriptList({ cues, activeIndex, onSeek }: TranscriptListProps) {
  const activeRef = useRef<HTMLLIElement | null>(null);

  // Keep the active cue visible as playback advances. `nearest` avoids yanking
  // the list around when the active row is already on screen.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  return (
    <section className="card">
      <h2 className="card__heading">Transcript</h2>

      {cues.length === 0 ? (
        <p className="empty">Transcript will appear here once captions load.</p>
      ) : (
        <ol className="transcript">
          {cues.map((cue, i) => {
            const isActive = i === activeIndex;
            return (
              <li
                key={cue.id}
                ref={isActive ? activeRef : undefined}
                className={`transcript__row${isActive ? ' transcript__row--active' : ''}`}
              >
                {/* Only the timestamp seeks — the text stays plain selectable
                    so dragging across it doesn't trigger a jump. */}
                <button
                  type="button"
                  className="transcript__time"
                  onClick={() => onSeek(cue)}
                  title="Jump to this line"
                >
                  {formatTime(cue.start)}
                </button>
                <span className="transcript__text">{cue.text}</span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
