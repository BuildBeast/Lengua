import { ManualTranscript } from './ManualTranscript';
import { AudioProbe } from './AudioProbe';

interface NoCaptionFallbackProps {
  /** Click a word in the transcript -> translate it. */
  onWord: (word: string) => void;
  /** The tab the panel is bound to — the audio-capture target. */
  tabId: number | undefined;
}

/**
 * Shown when a video is detected but caption discovery resolved to
 * not_found / error. Today the working path is manual paste. Audio
 * transcription is coming and will be fully local/free; the capture probe is
 * the foundation for it. Both are no-cost — nothing is sent to any paid API.
 */
export function NoCaptionFallback({ onWord, tabId }: NoCaptionFallbackProps) {
  return (
    <>
      <section className="card">
        <h2 className="card__heading">Transcribe audio</h2>
        <p className="empty">
          This video has no captions, and subtitles usually can’t be copied out of the player.
          Audio transcription is on the way and will run fully on your device — free, with no
          API key and no account. For now, paste a transcript below.
        </p>

        <AudioProbe tabId={tabId} />
      </section>

      <ManualTranscript onWord={onWord} />
    </>
  );
}
