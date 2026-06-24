import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { VideoState, VideoPlatform } from '../shared/types';
import type { CaptionCue, CaptionState } from '../shared/captions';
import { EMPTY_CAPTION_STATE, findActiveCueIndex } from '../shared/captions';
import type {
  CaptionStateResponse,
  GetCaptionStateMessage,
  GetVideoStateMessage,
  ReplayMessage,
  RuntimeMessage,
  SeekToMessage,
} from '../shared/messages';
import { VideoStatus } from './VideoStatus';
import { CaptionsPanel } from './CaptionsPanel';
import { CurrentSubtitle } from './CurrentSubtitle';
import { TranscriptList } from './TranscriptList';
import { ExplanationPanel, type Selection } from './ExplanationPanel';
import { NoCaptionFallback } from './NoCaptionFallback';
import { PlaceholderSection } from './PlaceholderSection';

/** Best-effort platform from a tab URL, before any content script replies. */
function platformFromUrl(url: string | undefined): VideoPlatform {
  if (!url) return 'unknown';
  if (/^https?:\/\/([\w-]+\.)*youtube\.com\//.test(url)) return 'youtube';
  if (/^https?:\/\/([\w-]+\.)*canalsur(?:mas)?\.es\//.test(url)) return 'canalsur';
  return 'unknown';
}

const PLATFORM_LABEL: Record<VideoPlatform, string> = {
  youtube: 'YouTube',
  canalsur: 'Canal Sur',
  unknown: 'Unsupported page',
};

export function App() {
  const [state, setState] = useState<VideoState | null>(null);
  const [caption, setCaption] = useState<CaptionState>(EMPTY_CAPTION_STATE);
  const [tabUrl, setTabUrl] = useState<string | undefined>(undefined);
  const [tabId, setTabId] = useState<number | undefined>(undefined);
  const [selection, setSelection] = useState<Selection | null>(null);

  // The tab the panel is bound to + the video id we currently hold captions
  // for. Both live in refs so the (once-registered) message listener always
  // sees the latest values.
  const tabIdRef = useRef<number | undefined>(undefined);
  const captionVideoIdRef = useRef<string | null>(null);
  // Latest bound tab URL, in a ref so the once-registered listeners can compare
  // platforms across a navigation without going stale.
  const tabUrlRef = useRef<string | undefined>(undefined);

  /** Ask the content script in `tabId` for current video + caption state. */
  const requestState = useCallback((tabId: number) => {
    const getVideo: GetVideoStateMessage = { type: 'GET_VIDEO_STATE' };
    chrome.tabs
      .sendMessage<GetVideoStateMessage, VideoState>(tabId, getVideo)
      .then((reply) => {
        if (tabIdRef.current === tabId) setState(reply ?? null);
      })
      // No content script on this tab (not a YouTube page) — clear and let the
      // URL drive the empty state.
      .catch(() => {
        if (tabIdRef.current === tabId) setState(null);
      });

    const getCaptions: GetCaptionStateMessage = { type: 'GET_CAPTION_STATE' };
    chrome.tabs
      .sendMessage<GetCaptionStateMessage, CaptionStateResponse>(tabId, getCaptions)
      .then((reply) => {
        if (tabIdRef.current !== tabId || !reply) return;
        captionVideoIdRef.current = reply.videoId;
        setCaption(reply.state);
      })
      .catch(() => {
        if (tabIdRef.current === tabId) setCaption(EMPTY_CAPTION_STATE);
      });
  }, []);

  /** Bind the panel to whatever tab is active in the current window. */
  const syncActiveTab = useCallback(() => {
    // Extension APIs are absent when the UI is opened in a plain browser tab
    // (i.e. `npm run dev`) — degrade to the empty state instead of throwing.
    if (!chrome?.tabs?.query) return;
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      tabIdRef.current = tab?.id;
      setTabId(tab?.id);
      captionVideoIdRef.current = null;
      tabUrlRef.current = tab?.url;
      setTabUrl(tab?.url);
      setState(null);
      setCaption(EMPTY_CAPTION_STATE);
      if (tab?.id !== undefined) requestState(tab.id);
    });
  }, [requestState]);

  useEffect(() => {
    syncActiveTab();

    // Skip listener wiring when extension APIs are unavailable (dev tab).
    if (!chrome?.runtime?.onMessage || !chrome?.tabs?.onActivated) return;

    const onMessage = (message: RuntimeMessage, sender: chrome.runtime.MessageSender) => {
      if (sender.tab?.id !== tabIdRef.current) return;

      if (message.type === 'VIDEO_STATE') {
        setState(message.state);
        // Defensive: if the video changed but the matching CAPTION_STATE hasn't
        // arrived yet, drop stale cues so we never show the wrong transcript.
        if (
          message.state.videoId &&
          captionVideoIdRef.current &&
          message.state.videoId !== captionVideoIdRef.current
        ) {
          captionVideoIdRef.current = message.state.videoId;
          setCaption(EMPTY_CAPTION_STATE);
        }
      } else if (message.type === 'CAPTION_STATE') {
        captionVideoIdRef.current = message.videoId;
        setCaption(message.state);
      }
    };
    chrome.runtime.onMessage.addListener(onMessage);

    const onActivated = () => syncActiveTab();
    chrome.tabs.onActivated.addListener(onActivated);

    const onUpdated = (tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
      if (tabId === tabIdRef.current && changeInfo.url) {
        // Crossing platforms (e.g. YouTube -> Canal Sur in the same tab) must
        // not leave the previous platform's video/captions on screen. Clearing
        // only on a platform change avoids flicker on YouTube SPA navigations.
        if (platformFromUrl(changeInfo.url) !== platformFromUrl(tabUrlRef.current)) {
          captionVideoIdRef.current = null;
          setState(null);
          setCaption(EMPTY_CAPTION_STATE);
        }
        tabUrlRef.current = changeInfo.url;
        setTabUrl(changeInfo.url);
        requestState(tabId);
      }
    };
    chrome.tabs.onUpdated.addListener(onUpdated);

    return () => {
      chrome.runtime.onMessage.removeListener(onMessage);
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }, [syncActiveTab, requestState]);

  const replay = useCallback((seconds: number) => {
    const tabId = tabIdRef.current;
    if (tabId === undefined) return;
    const message: ReplayMessage = { type: 'REPLAY', seconds };
    chrome.tabs.sendMessage(tabId, message).catch(() => {});
  }, []);

  const seekTo = useCallback((seconds: number) => {
    const tabId = tabIdRef.current;
    if (tabId === undefined) return;
    const message: SeekToMessage = { type: 'SEEK_TO', seconds };
    chrome.tabs.sendMessage(tabId, message).catch(() => {});
  }, []);

  const seekToCue = useCallback((cue: CaptionCue) => seekTo(cue.start), [seekTo]);

  // Click a word in the current subtitle -> translate that word.
  const selectWord = useCallback((word: string, cue: CaptionCue) => {
    if (word.trim()) setSelection({ text: word.trim(), atTime: cue.start });
  }, []);

  // Drag-select any text in the captions region (current subtitle or
  // transcript) -> translate the selected phrase or sentence as-is.
  const selectPhrase = useCallback(() => {
    const text = window.getSelection?.()?.toString().trim();
    if (text) setSelection({ text });
  }, []);

  // Translate the whole active subtitle line without manual selection.
  const translateLine = useCallback((cue: CaptionCue) => {
    const text = cue.text.trim();
    if (text) setSelection({ text, atTime: cue.start });
  }, []);

  // Active cue is derived from the latest playback time + loaded cues, so it
  // tracks both natural playback and manual seeking.
  const activeIndex = useMemo(
    () => findActiveCueIndex(caption.cues, state?.currentTime ?? 0),
    [caption.cues, state?.currentTime],
  );

  const hasCaptions = caption.status === 'ready' && caption.cues.length > 0;
  // Trust the content script's reported platform once it replies; fall back to
  // the tab URL so we can label the panel before the first message arrives.
  const platform = state?.platform ?? platformFromUrl(tabUrl);
  const isSupported = platform === 'youtube' || platform === 'canalsur';

  // A video is on screen but caption discovery came up empty (or failed):
  // offer the manual paste fallback instead of the timed-cue transcript.
  // `awaiting_captions` is excluded — there captions exist, the user just
  // needs to switch CC on.
  const manualMode =
    isSupported &&
    !!state?.hasVideo &&
    (caption.status === 'not_found' || caption.status === 'error');

  return (
    <div className="app">
      <header className="header">
        <h1 className="header__title">Lengua</h1>
        <p className="header__subtitle">Spanish video companion</p>
      </header>

      <main className="content">
        <section className="card">
          <h2 className="card__heading">Video · {PLATFORM_LABEL[platform]}</h2>
          {!isSupported ? (
            <p className="empty">Open a YouTube or Canal Sur video to begin.</p>
          ) : !state ? (
            <p className="empty">Looking for video…</p>
          ) : platform === 'youtube' && !state.isWatchPage ? (
            <p className="empty">Open a YouTube video to begin.</p>
          ) : !state.hasVideo ? (
            <p className="empty">Looking for video…</p>
          ) : (
            <VideoStatus state={state} onReplay={replay} />
          )}
        </section>

        <CaptionsPanel caption={caption} platform={platform} />

        {/* Selecting text anywhere in here offers a translation. */}
        <div className="captions-region" onMouseUp={selectPhrase}>
          {manualMode ? (
            <NoCaptionFallback
              tabId={tabId}
              onWord={(word) => {
                const text = word.trim();
                if (text) setSelection({ text });
              }}
            />
          ) : (
            <>
              <CurrentSubtitle
                activeIndex={activeIndex}
                cues={caption.cues}
                hasCaptions={hasCaptions}
                onReplayLine={seekToCue}
                onTranslateLine={translateLine}
                onWord={selectWord}
              />

              <TranscriptList cues={caption.cues} activeIndex={activeIndex} onSeek={seekToCue} />
            </>
          )}
        </div>

        <ExplanationPanel selection={selection} />

        <PlaceholderSection title="Saved phrases">
          Saved phrases will appear here.
        </PlaceholderSection>
      </main>
    </div>
  );
}
