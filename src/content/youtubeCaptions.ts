import type { CaptionCue } from '../shared/captions';

// === YouTube-internals isolation boundary (cue fetching/parsing) ==========
// The track's baseUrl is a *signed* URL. We must preserve it byte-for-byte and
// only APPEND an fmt param — reserializing it (e.g. via URL.searchParams) can
// re-encode the signature/sparams and make YouTube return an empty body.
//
// We try the URL as-is (its default format) first, then explicitly request
// json3 and srv1. Parsing handles srv1 (<text>), srv3 (<p>/<s>) and json3.
// A human-readable diagnostics string is returned alongside the cues so the
// failure mode is visible without digging through hidden console levels.
// ==========================================================================

export interface CaptionFetchResult {
  cues: CaptionCue[];
  /** Per-attempt summary, e.g. `default:s=200,len=0 | json3:s=200,len=0`. */
  diagnostics: string;
}

/** Decode HTML entities (e.g. &#39; -> '). YouTube often double-encodes. */
function decodeHtmlEntities(input: string): string {
  const el = document.createElement('textarea');
  el.innerHTML = input;
  return el.value;
}

/** Make raw caption text readable: decode entities, strip markup, collapse ws. */
function cleanText(raw: string): string {
  let text = decodeHtmlEntities(raw);
  text = decodeHtmlEntities(text); // handle double-encoded entities
  text = text.replace(/<[^>]*>/g, ' '); // strip any residual markup tags
  text = text.replace(/\s+/g, ' ').trim();
  return text;
}

/**
 * Sort by start, drop empties, fix overlaps (clamp a cue's end to the next
 * cue's start so active-cue lookup is unambiguous), and assign stable ids.
 * Real silence gaps between cues are preserved.
 */
function normalizeCues(input: Array<Omit<CaptionCue, 'id' | 'duration'>>): CaptionCue[] {
  const sorted = input
    .filter((c) => c.text.length > 0 && Number.isFinite(c.start))
    .sort((a, b) => a.start - b.start);

  return sorted.map((cue, i) => {
    const next = sorted[i + 1];
    let end = Number.isFinite(cue.end) ? cue.end : cue.start;
    if (next && end > next.start) end = next.start; // remove overlap, keep gaps
    if (end <= cue.start) end = cue.start + 2; // guarantee a positive window
    return { id: String(i), start: cue.start, end, duration: end - cue.start, text: cue.text };
  });
}

/**
 * Parse timedtext XML. Handles both srv1 (`<text start dur>`) and srv3
 * (`<p t d>` with optional `<s>` segments). Times: srv1 in seconds, srv3 in ms.
 */
function parseXml(raw: string): CaptionCue[] {
  const doc = new DOMParser().parseFromString(raw, 'text/xml');
  if (doc.querySelector('parsererror')) return [];

  const out: Array<Omit<CaptionCue, 'id' | 'duration'>> = [];

  // srv1: <text start="1.2" dur="3.4">line</text>
  for (const node of Array.from(doc.querySelectorAll('text'))) {
    const start = parseFloat(node.getAttribute('start') ?? '');
    const dur = parseFloat(node.getAttribute('dur') ?? '');
    const text = cleanText(node.textContent ?? '');
    if (!Number.isFinite(start) || !text) continue;
    out.push({ start, end: Number.isFinite(dur) ? start + dur : start, text });
  }

  // srv3: <p t="1200" d="3400"><s>Hola</s><s> mundo</s></p>
  if (out.length === 0) {
    for (const node of Array.from(doc.querySelectorAll('p'))) {
      const tMs = parseFloat(node.getAttribute('t') ?? '');
      const dMs = parseFloat(node.getAttribute('d') ?? '');
      const text = cleanText(node.textContent ?? '');
      if (!Number.isFinite(tMs) || !text) continue;
      const start = tMs / 1000;
      out.push({ start, end: Number.isFinite(dMs) ? start + dMs / 1000 : start, text });
    }
  }

  return normalizeCues(out);
}

interface Json3Event {
  tStartMs?: number;
  dDurationMs?: number;
  segs?: Array<{ utf8?: string }>;
}

/** Parse the json3 format: { events: [{ tStartMs, dDurationMs, segs }] }. */
function parseJson3(raw: string): CaptionCue[] {
  let data: { events?: Json3Event[] };
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data.events)) return [];

  const out: Array<Omit<CaptionCue, 'id' | 'duration'>> = [];
  for (const ev of data.events) {
    if (typeof ev.tStartMs !== 'number' || !Array.isArray(ev.segs)) continue;
    const text = cleanText(ev.segs.map((s) => s.utf8 ?? '').join(''));
    if (!text) continue;
    const start = ev.tStartMs / 1000;
    const end = typeof ev.dDurationMs === 'number' ? start + ev.dDurationMs / 1000 : start;
    out.push({ start, end, text });
  }
  return normalizeCues(out);
}

/** Parse a caption body of unknown format (json3 vs XML) by sniffing it. */
function parseBody(body: string): CaptionCue[] {
  return body.trim().startsWith('{') ? parseJson3(body) : parseXml(body);
}

/** Set fmt on a signed URL by string replace/append (never reserialize it). */
function setFmt(url: string, fmt: string): string {
  if (/[?&]fmt=/.test(url)) return url.replace(/([?&])fmt=[^&]*/, `$1fmt=${fmt}`);
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}fmt=${fmt}`;
}

/**
 * Resolve cues from a timedtext request the player already made. The captured
 * `url` carries a valid proof-of-origin token, so we CAN fetch it — we re-fetch
 * it as json3 (cleanest to parse) and fall back to the captured body as-is.
 */
export async function resolveCapturedCaption(
  url: string,
  body: string,
): Promise<CaptionFetchResult> {
  const diags: string[] = [];

  // 1) Re-fetch as json3, preserving the captured URL's token/signature.
  try {
    const res = await fetch(setFmt(url, 'json3'), { credentials: 'include' });
    const text = res.ok ? await res.text() : '';
    const cues = res.ok ? parseBody(text) : [];
    diags.push(`json3:s=${res.status},len=${text.length},cues=${cues.length}`);
    if (cues.length > 0) {
      console.info('[Lengua] captions parsed', diags.join(' | '));
      return { cues, diagnostics: diags.join(' | ') };
    }
  } catch (err) {
    diags.push(`json3:err=${String(err).slice(0, 50)}`);
  }

  // 2) Fall back to whatever the player actually received.
  const cues = parseBody(body);
  diags.push(`captured:len=${body.length},cues=${cues.length}`);
  const diagnostics = diags.join(' | ');
  if (cues.length > 0) console.info('[Lengua] captions parsed', diagnostics);
  else console.warn('[Lengua] caption parse failed —', diagnostics);
  return { cues, diagnostics };
}
