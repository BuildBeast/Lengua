import { useEffect, useMemo, useState } from 'react';
import { formatTime } from '../shared/time';
import {
  classifySelection,
  deeplUrl,
  googleTranslateUrl,
  isOnDeviceSupported,
  openInTab,
  translateOnDevice,
} from './translate';

export interface Selection {
  text: string;
  /** Playback time the selection came from, for context (optional). */
  atTime?: number;
}

interface ExplanationPanelProps {
  selection: Selection | null;
}

type TranslationState =
  | { kind: 'idle' }
  | { kind: 'translating'; downloading: boolean }
  | { kind: 'done'; english: string }
  | { kind: 'error' }
  | { kind: 'unsupported' };

/** Shows the selected Spanish, its on-device English translation, + fallbacks. */
export function ExplanationPanel({ selection }: ExplanationPanelProps) {
  const [state, setState] = useState<TranslationState>({ kind: 'idle' });

  useEffect(() => {
    if (!selection) {
      setState({ kind: 'idle' });
      return;
    }
    if (!isOnDeviceSupported()) {
      setState({ kind: 'unsupported' });
      return;
    }

    let cancelled = false;
    setState({ kind: 'translating', downloading: false });
    translateOnDevice(selection.text, (p) => {
      if (!cancelled && p.downloading) setState({ kind: 'translating', downloading: true });
    })
      .then((english) => {
        if (!cancelled) setState({ kind: 'done', english });
      })
      .catch(() => {
        if (!cancelled) setState({ kind: 'error' });
      });

    return () => {
      cancelled = true;
    };
  }, [selection]);

  // Length heuristic drives the heading + how we present the local result.
  const cls = useMemo(
    () => (selection ? classifySelection(selection.text) : null),
    [selection],
  );
  const isLong = cls?.isLong ?? false;
  const heading = isLong ? 'Rough Local Translation' : 'Quick Translation';

  return (
    <section className="card">
      <h2 className="card__heading">{heading}</h2>

      {!selection || !cls ? (
        <p className="empty">Click a word, or select a phrase, in the transcript to translate it.</p>
      ) : (
        <div className="explain">
          <p className="explain__source">
            “{selection.text}”
            <span className="explain__time">
              {' · '}
              {cls.wordCount} {cls.wordCount === 1 ? 'word' : 'words'}
              {selection.atTime !== undefined && ` · ${formatTime(selection.atTime)}`}
            </span>
          </p>

          {isLong && state.kind === 'done' && (
            <p className="explain__label">Rough local translation</p>
          )}

          <Result state={state} />

          {isLong && (
            <p className="explain__caveat">
              Local translation can be literal for full sentences. Open in DeepL or Google
              Translate for a stronger translation.
            </p>
          )}

          <div className={`explain__fallback${isLong ? ' explain__fallback--prominent' : ''}`}>
            <span className="explain__fallback-label">Open in</span>
            <button
              type="button"
              className={`link-btn${isLong ? ' link-btn--prominent' : ''}`}
              onClick={() => openInTab(deeplUrl(selection.text))}
            >
              DeepL
            </button>
            <button
              type="button"
              className={`link-btn${isLong ? ' link-btn--prominent' : ''}`}
              onClick={() => openInTab(googleTranslateUrl(selection.text))}
            >
              Google Translate
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function Result({ state }: { state: TranslationState }) {
  switch (state.kind) {
    case 'translating':
      return (
        <p className="explain__english explain__english--muted">
          {state.downloading ? 'Downloading on-device model (one-time)…' : 'Translating…'}
        </p>
      );
    case 'done':
      return <p className="explain__english">{state.english}</p>;
    case 'unsupported':
      return (
        <p className="explain__english explain__english--muted">
          On-device translation isn’t available in this browser — use a link below.
        </p>
      );
    case 'error':
      return (
        <p className="explain__english explain__english--muted">
          Couldn’t translate on-device — use a link below.
        </p>
      );
    case 'idle':
      return null;
  }
}
