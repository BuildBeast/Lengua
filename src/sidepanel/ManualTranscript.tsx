import { useState } from 'react';
import { Words } from './Words';

interface ManualTranscriptProps {
  /** Click a word -> translate it (reuses the Quick Translation flow). */
  onWord: (word: string) => void;
}

/**
 * Split pasted Spanish text into transcript-like lines. Explicit line breaks
 * (and blank lines) become boundaries first; long paragraphs are then broken
 * into sentences so each line is a selectable, translatable unit.
 */
export function splitIntoLines(text: string): string[] {
  return text
    .split(/\n+/)
    .flatMap(splitSentences)
    .map((line) => line.trim())
    .filter(Boolean);
}

// Break a paragraph after . ! ? … (keeping the punctuation with its sentence).
function splitSentences(paragraph: string): string[] {
  const trimmed = paragraph.trim();
  if (!trimmed) return [];
  const matches = trimmed.match(/[^.!?…]+[.!?…]+(?=\s|$)|[^.!?…]+$/g);
  return matches ?? [trimmed];
}

/**
 * Fallback for videos with no captions: paste Spanish text, render it as a
 * transcript, and select words / phrases / sentences to translate — the same
 * way captioned videos work.
 */
export function ManualTranscript({ onWord }: ManualTranscriptProps) {
  const [draft, setDraft] = useState('');
  const [lines, setLines] = useState<string[]>([]);
  const built = lines.length > 0;

  return (
    <section className="card">
      <h2 className="card__heading">Manual transcript</h2>

      {!built ? (
        <>
          <p className="empty">
            No captions were found for this video. Paste the Spanish text below to read it
            here, then click a word or select a phrase to translate it.
          </p>
          <textarea
            className="manual-input"
            placeholder="Paste Spanish transcript or any Spanish text…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={6}
          />
          <div className="controls">
            <button
              type="button"
              className="btn"
              disabled={!draft.trim()}
              onClick={() => setLines(splitIntoLines(draft))}
            >
              Build transcript
            </button>
          </div>
        </>
      ) : (
        <>
          <ol className="transcript transcript--manual">
            {lines.map((line, i) => (
              <li key={i} className="transcript__row">
                {/* Words are individually clickable; the row text stays
                    drag-selectable so a phrase or sentence wins over a click. */}
                <span className="transcript__text">
                  <Words text={line} onWord={onWord} />
                </span>
              </li>
            ))}
          </ol>
          <div className="controls">
            <button type="button" className="btn" onClick={() => setLines([])}>
              Edit text
            </button>
          </div>
        </>
      )}

      {/* Placeholder for future audio transcription — intentionally inert. */}
      <div className="controls">
        <button type="button" className="btn" disabled title="Coming soon.">
          Transcribe last 30s
        </button>
      </div>
      <p className="coming-soon">Coming soon.</p>
    </section>
  );
}
