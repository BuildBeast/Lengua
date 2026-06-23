import type { CaptionCue, CaptionProbe, CaptionState, CaptionTrack } from '../../shared/captions';
import type { PlatformAdapter, PlatformVideoState } from './types';
import { looksLikeCaptions, normalizeCues, parseVtt } from '../vttParser';

// === Canal Sur / CanalSur Más adapter =====================================
// Discovery + probe foundation for Andalusian content. Runs in the ISOLATED
// world on canalsur.es / canalsurmas.es. It reads video state from the page's
// <video> element and probes for captions in the safe, standard places:
// native textTracks, <track> elements, and VTT URLs referenced in the page.
//
// It does NOT bypass DRM/auth, scrape aggressively, or inject overlays. When
// captions live behind access controls or in formats we can't reach, the probe
// reports what it found and the panel shows a clear "no captions" state.
// ==========================================================================

function matchesHost(): boolean {
  const h = location.hostname;
  return /(^|\.)canalsur\.es$/i.test(h) || /(^|\.)canalsurmas\.es$/i.test(h);
}

/** The most likely main <video> element on the page (largest, or first). */
function findVideo(): HTMLVideoElement | null {
  const videos = Array.from(document.querySelectorAll('video'));
  if (videos.length === 0) return null;
  // Prefer the largest rendered video (skips tiny preview/thumbnail players).
  return videos.reduce((best, v) =>
    v.clientWidth * v.clientHeight > best.clientWidth * best.clientHeight ? v : best,
  );
}

function getTitle(): string | null {
  const og = document
    .querySelector('meta[property="og:title"]')
    ?.getAttribute('content')
    ?.trim();
  if (og) return og;
  const h1 = document.querySelector('h1')?.textContent?.trim();
  if (h1) return h1;
  return document.title?.trim() || null;
}

/** Stable-ish id for the current video page, used to clear stale state on nav. */
function getVideoId(): string {
  return (location.pathname + location.search).replace(/\/+$/, '') || location.hostname;
}

function looksLikeVideoUrl(): boolean {
  return /(video|directo|en-directo|playlist|capitulo|programa|noticia)/i.test(location.pathname);
}

function getVideoState(): PlatformVideoState {
  const video = findVideo();
  const title = getTitle();
  const url = location.href;
  const videoId = getVideoId();

  if (!video) {
    return {
      platform: 'canalsur',
      isWatchPage: looksLikeVideoUrl(),
      hasVideo: false,
      videoId,
      url,
      title,
      currentTime: 0,
      duration: 0,
      paused: true,
    };
  }

  return {
    platform: 'canalsur',
    isWatchPage: true,
    hasVideo: true,
    videoId,
    url,
    title,
    currentTime: video.currentTime || 0,
    duration: Number.isFinite(video.duration) ? video.duration : 0,
    paused: video.paused,
  };
}

// --- Caption discovery ------------------------------------------------------

interface CaptionCandidate {
  url: string;
  label: string;
  /** Best-effort language code, for Spanish-first ordering. */
  lang?: string;
}

const SPANISH_HINT = /(^|[^a-z])(es|esp|spa|spanish|espa(?:ñ|n)ol|castellano)([^a-z]|$)/i;

function isSpanishHint(s: string | undefined): boolean {
  return !!s && SPANISH_HINT.test(s);
}

function absolute(url: string): string | null {
  try {
    return new URL(url, location.href).href;
  } catch {
    return null;
  }
}

/** Candidate caption URLs from <track> elements. */
function urlsFromTracks(tracks: HTMLTrackElement[]): CaptionCandidate[] {
  const out: CaptionCandidate[] = [];
  for (const t of tracks) {
    const url = t.src && absolute(t.src);
    if (!url) continue;
    out.push({ url, label: t.label || t.srclang || 'track', lang: t.srclang || undefined });
  }
  return out;
}

// Bounded scan of inline scripts for caption file URLs. We only look at script
// text (not the whole serialised DOM) and cap how much we scan, to stay light.
const VTT_URL = /https?:\/\/[^"'\s\\)]+\.(?:vtt|srt)(?:\?[^"'\s\\)]*)?/gi;
const REL_VTT_URL = /["'](\/[^"'\s\\)]+\.(?:vtt|srt)(?:\?[^"'\s\\)]*)?)["']/gi;
const MAX_SCRIPT_CHARS = 200_000;

function urlsFromDom(): CaptionCandidate[] {
  const found = new Set<string>();
  const scripts = Array.from(document.querySelectorAll('script:not([src])'));
  for (const s of scripts) {
    const text = s.textContent ?? '';
    if (!text || text.length > MAX_SCRIPT_CHARS) continue;
    for (const m of text.matchAll(VTT_URL)) {
      const abs = absolute(m[0]);
      if (abs) found.add(abs);
    }
    for (const m of text.matchAll(REL_VTT_URL)) {
      const abs = absolute(m[1]);
      if (abs) found.add(abs);
    }
  }
  return Array.from(found).map((url) => ({ url, label: 'page script', lang: undefined }));
}

/** Order Spanish-looking candidates first, then de-duplicate by URL. */
function rankCandidates(cands: CaptionCandidate[]): CaptionCandidate[] {
  const seen = new Set<string>();
  return cands
    .filter((c) => (seen.has(c.url) ? false : (seen.add(c.url), true)))
    .sort((a, b) => {
      const aEs = isSpanishHint(a.lang) || isSpanishHint(a.url) || isSpanishHint(a.label);
      const bEs = isSpanishHint(b.lang) || isSpanishHint(b.url) || isSpanishHint(b.label);
      return aEs === bEs ? 0 : aEs ? -1 : 1;
    });
}

async function fetchAndParse(url: string): Promise<CaptionCue[]> {
  try {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) return [];
    const body = await res.text();
    if (!looksLikeCaptions(body)) return [];
    return parseVtt(body);
  } catch {
    // Cross-origin without permission, network error, etc. — treat as "couldn't
    // reach it" and let the probe report the URL as discovered-but-unreadable.
    return [];
  }
}

/** Read cues already loaded into a native TextTrack (Spanish-first). */
function readNativeCues(video: HTMLVideoElement | null): { cues: CaptionCue[]; label?: string } {
  if (!video?.textTracks?.length) return { cues: [] };
  const tracks = Array.from(video.textTracks).filter(
    (t) => t.kind === 'subtitles' || t.kind === 'captions',
  );
  // Nudge disabled tracks to load their cues for a later pass (hidden renders
  // nothing visible; we never override a track the user has showing).
  for (const t of tracks) {
    if (t.mode === 'disabled') t.mode = 'hidden';
  }
  const ordered = [...tracks].sort((a, b) => {
    const aEs = isSpanishHint(a.language) || isSpanishHint(a.label);
    const bEs = isSpanishHint(b.language) || isSpanishHint(b.label);
    return aEs === bEs ? 0 : aEs ? -1 : 1;
  });
  for (const track of ordered) {
    const list = track.cues;
    if (!list || list.length === 0) continue;
    const raw: Array<Omit<CaptionCue, 'id' | 'duration'>> = [];
    for (let i = 0; i < list.length; i++) {
      const c = list[i] as VTTCue;
      const text = (c.text ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      if (text) raw.push({ start: c.startTime, end: c.endTime, text });
    }
    const cues = normalizeCues(raw);
    if (cues.length) return { cues, label: `native track (${track.label || track.language || track.kind})` };
  }
  return { cues: [] };
}

function makeTrack(label: string, lang?: string): CaptionTrack {
  return { languageCode: lang ?? '', name: label, url: '' };
}

async function loadCaptions(): Promise<CaptionState> {
  const video = findVideo();
  const trackEls = Array.from(
    document.querySelectorAll<HTMLTrackElement>(
      'track[kind="subtitles"], track[kind="captions"], track:not([kind])',
    ),
  );

  const candidates = rankCandidates([...urlsFromTracks(trackEls), ...urlsFromDom()]);

  const probe: CaptionProbe = {
    videoFound: !!video,
    textTracks: video?.textTracks?.length ?? 0,
    trackElements: trackEls.length,
    captionUrls: candidates.length,
  };

  // 1) Fetch + parse discovered VTT/SRT URLs (Spanish-first).
  for (const cand of candidates) {
    const cues = await fetchAndParse(cand.url);
    if (cues.length) {
      const track = makeTrack(cand.label, cand.lang);
      return {
        status: 'ready',
        tracks: [track],
        selectedTrack: track,
        cues,
        probe: { ...probe, selectedSource: `${cand.label} · ${cand.url}` },
      };
    }
  }

  // 2) Fall back to cues already loaded in a native text track.
  const native = readNativeCues(video);
  if (native.cues.length) {
    const track = makeTrack(native.label ?? 'native captions');
    return {
      status: 'ready',
      tracks: [track],
      selectedTrack: track,
      cues: native.cues,
      probe: { ...probe, selectedSource: native.label },
    };
  }

  // Nothing usable yet. If there's no video at all, stay idle (the page may not
  // be a video page); otherwise report a clean "video, but no captions" state.
  if (!video) return { status: 'idle', tracks: [], cues: [], probe };
  return { status: 'not_found', tracks: [], cues: [], error: 'no_captions', probe };
}

export const canalSurAdapter: PlatformAdapter = {
  platform: 'canalsur',
  matchesPage: matchesHost,
  getVideoState,
  replay(seconds: number): boolean {
    const video = findVideo();
    if (!video) return false;
    video.currentTime = Math.max(0, video.currentTime - seconds);
    return true;
  },
  seekTo(seconds: number): boolean {
    const video = findVideo();
    if (!video) return false;
    video.currentTime = Math.max(0, seconds);
    return true;
  },
  loadCaptions,
};
