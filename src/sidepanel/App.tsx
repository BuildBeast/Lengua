import { useCallback, useEffect, useRef, useState } from 'react';
import type { VideoState } from '../shared/types';
import type { GetVideoStateMessage, ReplayMessage, RuntimeMessage } from '../shared/messages';
import { VideoStatus } from './VideoStatus';
import { PlaceholderSection } from './PlaceholderSection';

function isYouTubeUrl(url: string | undefined): boolean {
  return !!url && /^https?:\/\/([\w-]+\.)*youtube\.com\//.test(url);
}

export function App() {
  const [state, setState] = useState<VideoState | null>(null);
  const [tabUrl, setTabUrl] = useState<string | undefined>(undefined);

  // The tab the panel is currently bound to. Kept in a ref so the message
  // listener (registered once) always sees the latest value.
  const tabIdRef = useRef<number | undefined>(undefined);

  /** Ask the content script in `tabId` for a fresh snapshot. */
  const requestState = useCallback((tabId: number) => {
    const message: GetVideoStateMessage = { type: 'GET_VIDEO_STATE' };
    chrome.tabs
      .sendMessage<GetVideoStateMessage, VideoState>(tabId, message)
      .then((reply) => {
        if (tabIdRef.current === tabId) setState(reply ?? null);
      })
      // No content script on this tab (not a YouTube page) — clear state and
      // let the URL drive the empty state.
      .catch(() => {
        if (tabIdRef.current === tabId) setState(null);
      });
  }, []);

  /** Bind the panel to whatever tab is active in the current window. */
  const syncActiveTab = useCallback(() => {
    // Extension APIs are absent when the UI is opened in a plain browser tab
    // (i.e. `npm run dev`) — degrade to the empty state instead of throwing.
    if (!chrome?.tabs?.query) return;
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      tabIdRef.current = tab?.id;
      setTabUrl(tab?.url);
      setState(null);
      if (tab?.id !== undefined) requestState(tab.id);
    });
  }, [requestState]);

  useEffect(() => {
    syncActiveTab();

    // Skip listener wiring when extension APIs are unavailable (dev tab).
    if (!chrome?.runtime?.onMessage || !chrome?.tabs?.onActivated) return;

    // Live snapshots pushed by the content script of the bound tab.
    const onMessage = (message: RuntimeMessage, sender: chrome.runtime.MessageSender) => {
      if (message.type === 'VIDEO_STATE' && sender.tab?.id === tabIdRef.current) {
        setState(message.state);
      }
    };
    chrome.runtime.onMessage.addListener(onMessage);

    // Re-bind when the user switches tabs.
    const onActivated = () => syncActiveTab();
    chrome.tabs.onActivated.addListener(onActivated);

    // Catch full-navigation URL changes on the bound tab (the content script
    // handles in-app SPA navigations on its own).
    const onUpdated = (tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
      if (tabId === tabIdRef.current && changeInfo.url) {
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

  // The active tab is "on YouTube" if either the content script responded or
  // the URL looks like youtube.com.
  const onYouTube = state?.isWatchPage || isYouTubeUrl(tabUrl);

  return (
    <div className="app">
      <header className="header">
        <h1 className="header__title">Lengua</h1>
        <p className="header__subtitle">Spanish video companion</p>
      </header>

      <main className="content">
        <section className="card">
          <h2 className="card__heading">Video</h2>
          {!onYouTube ? (
            <p className="empty">Open a YouTube video to begin.</p>
          ) : !state?.isWatchPage ? (
            <p className="empty">Open a YouTube video to begin.</p>
          ) : !state.hasVideo ? (
            <p className="empty">Looking for video…</p>
          ) : (
            <VideoStatus state={state} onReplay={replay} />
          )}
        </section>

        <PlaceholderSection title="Captions">
          Caption extraction coming next.
        </PlaceholderSection>

        <PlaceholderSection title="Current subtitle">
          Current subtitle will appear here once captions are connected.
        </PlaceholderSection>

        <PlaceholderSection title="Explanation">
          Select a word or phrase from mirrored captions to explain it.
        </PlaceholderSection>

        <PlaceholderSection title="Saved phrases">
          Saved phrases will appear here.
        </PlaceholderSection>
      </main>
    </div>
  );
}
