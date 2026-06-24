import { useCallback, useRef, useState } from 'react';
import type { AudioRecordResult } from '../shared/messages';
import { recordTabAudio } from './audioCapture';

/** How long the probe records, in milliseconds. */
const PROBE_MS = 5000;

type ProbeStatus = 'idle' | 'recording' | 'success' | 'error';

const STATUS_LABEL: Record<ProbeStatus, string> = {
  idle: 'Idle',
  recording: 'Recording 5s…',
  success: 'Done',
  error: 'Error',
};

interface AudioProbeProps {
  /** The tab the panel is bound to — the capture target. */
  tabId: number | undefined;
}

/**
 * Audio capture probe — the foundation for local, no-cost transcription.
 *
 * Records 5s of the current tab's audio, keeps it audible, and reports whether
 * anything non-silent was actually captured (DRM-protected streams typically
 * capture as silence). No transcription, no API key, no network, no
 * persistence: the clip lives only in this component's state as an in-memory
 * data: URL. Transcription will run fully on-device once it lands — see
 * docs/audio-transcription-plan.md.
 *
 * The capture itself runs in the service worker + offscreen document: tab audio
 * can only be captured on a tab the extension was *invoked* on (clicking the
 * toolbar icon), and that invocation lives in the worker, not here.
 */
export function AudioProbe({ tabId }: AudioProbeProps) {
  const [status, setStatus] = useState<ProbeStatus>('idle');
  const [result, setResult] = useState<AudioRecordResult | null>(null);
  // Hold the live audio element so repeated "Play sample" clicks don't stack.
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const busy = status === 'recording';

  const runProbe = useCallback(async () => {
    if (tabId === undefined) {
      setStatus('error');
      setResult({ ok: false, error: 'No active tab to capture.' });
      return;
    }

    setResult(null);
    setStatus('recording');
    try {
      // The worker resolves the active tab, obtains the stream id (where the
      // activeTab invocation lives), records, and analyses.
      const probe = await recordTabAudio(PROBE_MS);
      setResult(probe);
      setStatus(probe.ok ? 'success' : 'error');
    } catch (err) {
      setStatus('error');
      setResult({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }, [tabId]);

  const playSample = useCallback(() => {
    if (!result?.audioDataUrl) return;
    audioRef.current?.pause();
    const audio = new Audio(result.audioDataUrl);
    audioRef.current = audio;
    audio.play().catch(() => {});
  }, [result]);

  return (
    <div className="planned">
      <p className="planned__title">Local transcription coming next</p>
      <p className="coming-soon">
        Transcription will run fully on-device — free, no API key, no account, nothing leaves
        your computer. While it's being built, this probe checks that Lengua can capture audible
        audio from this video. Click the Lengua toolbar icon while this video tab is active to
        open the panel, make sure the video is playing, then record.
      </p>

      <div className="controls">
        <button type="button" className="btn btn--record" onClick={runProbe} disabled={busy}>
          <span className="rec-dot" aria-hidden="true" /> {busy ? 'Recording…' : 'Record test 5s'}
        </button>
        {result?.audioDataUrl && (
          <button type="button" className="btn" onClick={playSample} disabled={busy}>
            Play sample
          </button>
        )}
      </div>

      <p className="planned__status">Status: {STATUS_LABEL[status]}</p>

      {result && (
        <dl className="fields probe-result">
          <div className="field">
            <dt>Capture</dt>
            <dd>{result.ok ? 'succeeded' : 'failed'}</dd>
          </div>
          {result.ok && (
            <>
              <div className="field">
                <dt>Non-silent</dt>
                <dd>{result.nonSilent ? 'yes' : 'no'}</dd>
              </div>
              <div className="field">
                <dt>Clip size</dt>
                <dd>{formatBytes(result.blobSize ?? 0)}</dd>
              </div>
              <div className="field">
                <dt>Duration</dt>
                <dd>
                  {(result.durationSec ?? 0).toFixed(2)}s
                  {result.wallMs != null && ` (wall ${(result.wallMs / 1000).toFixed(2)}s)`}
                </dd>
              </div>
              <div className="field">
                <dt>Peak / RMS</dt>
                <dd>
                  {(result.peak ?? 0).toFixed(4)} / {(result.rms ?? 0).toFixed(4)}
                </dd>
              </div>
              {result.mimeType && (
                <div className="field">
                  <dt>Format</dt>
                  <dd>{result.mimeType}</dd>
                </div>
              )}
            </>
          )}
          {result.error && (
            <div className="field">
              <dt>Error</dt>
              <dd>{result.error}</dd>
            </div>
          )}
        </dl>
      )}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
