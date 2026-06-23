// === MAIN-world caption interceptor =======================================
// Runs in the PAGE's JS context (manifest "world": "MAIN", document_start), so
// it can see YouTube's own objects and patch the network primitives the player
// uses. We need this because the signed caption baseUrl now returns an empty
// body unless the request carries a proof-of-origin token that only YouTube's
// player generates. By observing the player's *own* timedtext request we get a
// URL that already carries that token; the isolated content script then
// re-fetches it as clean json3.
//
// This script CANNOT use chrome.* APIs (wrong world) — it talks to the
// isolated content script via window.postMessage. It must stay import-free.
// ==========================================================================

(() => {
  const TAG = '__lengua_cc__';
  const w = window as unknown as {
    fetch: typeof fetch;
    __lenguaHooked?: boolean;
    ytInitialPlayerResponse?: unknown;
  };

  if (w.__lenguaHooked) return;
  w.__lenguaHooked = true;

  const currentVideoId = (): string | null => {
    try {
      return new URL(location.href).searchParams.get('v');
    } catch {
      return null;
    }
  };

  const post = (payload: Record<string, unknown>): void => {
    window.postMessage({ [TAG]: true, videoId: currentVideoId(), ...payload }, '*');
  };

  const isTimedText = (url: string): boolean => url.includes('/api/timedtext');

  // --- Hook fetch (the player's primary transport for captions) ---
  const origFetch = w.fetch?.bind(window);
  if (origFetch) {
    w.fetch = (...args: Parameters<typeof fetch>) => {
      const input = args[0];
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input instanceof Request
              ? input.url
              : '';
      const promise = origFetch(...args);
      if (url && isTimedText(url)) {
        promise
          .then((res) => res.clone().text())
          .then((body) => post({ kind: 'timedtext', url, body }))
          .catch(() => {});
      }
      return promise;
    };
  }

  // --- Hook XHR (belt-and-suspenders; some paths still use it) ---
  const proto = XMLHttpRequest.prototype;
  const origOpen = proto.open;
  proto.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
    (this as unknown as { __lenguaUrl?: string }).__lenguaUrl = String(url);
    // @ts-expect-error pass-through of variadic open signature
    return origOpen.call(this, method, url, ...rest);
  };
  const origSend = proto.send;
  proto.send = function (this: XMLHttpRequest, ...sendArgs: unknown[]) {
    const url = (this as unknown as { __lenguaUrl?: string }).__lenguaUrl;
    if (url && isTimedText(url)) {
      this.addEventListener('load', () => {
        try {
          post({ kind: 'timedtext', url, body: this.responseText });
        } catch {
          /* ignore */
        }
      });
    }
    // @ts-expect-error pass-through of variadic send signature
    return origSend.apply(this, sendArgs);
  };

  // --- Report available tracks (for the "Spanish available?" hint) ---
  interface RawYtTrack {
    languageCode?: string;
    kind?: string;
    name?: { simpleText?: string; runs?: Array<{ text?: string }> };
    baseUrl?: string;
  }

  const readTracksFromPlayerResponse = (): RawYtTrack[] | null => {
    const pr = w.ytInitialPlayerResponse as
      | { captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: RawYtTrack[] } } }
      | undefined;
    const tracks = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    return Array.isArray(tracks) ? tracks : null;
  };

  const readTracksFromPlayer = (): RawYtTrack[] | null => {
    try {
      const player = document.getElementById('movie_player') as
        | (HTMLElement & { getOption?: (m: string, k: string) => unknown })
        | null;
      const list = player?.getOption?.('captions', 'tracklist') as
        | Array<{ languageCode?: string; kind?: string; displayName?: string }>
        | undefined;
      if (!Array.isArray(list)) return null;
      return list.map((t) => ({
        languageCode: t.languageCode,
        kind: t.kind,
        name: { simpleText: t.displayName },
      }));
    } catch {
      return null;
    }
  };

  const postTracks = (): void => {
    const raw = readTracksFromPlayerResponse() ?? readTracksFromPlayer();
    if (!raw) return;
    const tracks = raw.map((t) => ({
      languageCode: t.languageCode,
      name: t.name?.simpleText ?? t.name?.runs?.map((r) => r.text ?? '').join('') ?? t.languageCode,
      kind: t.kind,
    }));
    post({ kind: 'tracks', tracks });
  };

  // Player data populates after document_start, so poll briefly; re-run on SPA
  // navigation (the global may be stale, but the player tracklist updates).
  let attempts = 0;
  const timer = setInterval(() => {
    postTracks();
    if (++attempts >= 12) clearInterval(timer);
  }, 500);
  window.addEventListener('yt-navigate-finish', () => {
    attempts = 0;
    postTracks();
  });
})();
