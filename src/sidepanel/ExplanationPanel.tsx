import { useEffect, useState } from 'react';
import { formatTime } from '../shared/time';
import {
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

  return (
    <section className="card">
      <h2 className="card__heading">Quick Translation</h2>

      {!selection ? (
        <p className="empty">Click a word, or select a phrase, in the transcript to translate it.</p>
      ) : (
        <div className="explain">
          <p className="explain__source">
            “{selection.text}”
            {selection.atTime !== undefined && (
              <span className="explain__time"> · {formatTime(selection.atTime)}</span>
            )}
          </p>

          <Result state={state} />

          <div className="explain__fallback">
            <span className="explain__fallback-label">Open in</span>
            <button type="button" className="link-btn" onClick={() => openInTab(deeplUrl(selection.text))}>
              DeepL
            </button>
            <button
              type="button"
              className="link-btn"
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
