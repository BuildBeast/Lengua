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
 * Secondary, opt-in utility for the no-caption case: if the user happens to
 * have the Spanish text elsewhere (a description, an article, their own notes)
 * they can paste it and translate it here. This is NOT the main answer for
 * uncaptioned videos — most give you no text to copy — so it lives collapsed
 * beneath the planned audio-transcription feature.
 */
export function ManualTranscript({ onWord }: ManualTranscriptProps) {
  const [draft, setDraft] = useState('');
  const [lines, setLines] = useState<string[]>([]);
  const built = lines.length > 0;

  return (
    <details className="card manual">
      <summary className="manual__summary">Paste Spanish text manually</summary>

      <p className="manual__note">
        A secondary option for when you already have the Spanish text somewhere. Most videos
        without captions won’t let you copy any text, so this won’t help on its own.
      </p>

      {!built ? (
        <>
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
    </details>
  );
}
