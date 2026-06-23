import type { CaptionCue, CaptionTrack } from '../shared/captions';

// === YouTube-internals isolation boundary (cue fetching/parsing) ==========
// Caption responses come in a few formats. We prefer YouTube's default srv1
// XML (clean phrase-level cues for both manual and auto-generated tracks) and
// fall back to json3 if the XML yields nothing. All DOM-based parsing/entity-
// decoding works here because the content script has a real `document`.
// ==========================================================================

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

/** Parse YouTube's default srv1 XML: <transcript><text start dur>…</text>. */
function parseSrv1Xml(raw: string): CaptionCue[] {
  const doc = new DOMParser().parseFromString(raw, 'text/xml');
  if (doc.querySelector('parsererror')) return [];

  const out: Array<Omit<CaptionCue, 'id' | 'duration'>> = [];
  for (const node of Array.from(doc.querySelectorAll('text'))) {
    const start = parseFloat(node.getAttribute('start') ?? '');
    const dur = parseFloat(node.getAttribute('dur') ?? '');
    const text = cleanText(node.textContent ?? '');
    if (!Number.isFinite(start) || !text) continue;
    const end = Number.isFinite(dur) ? start + dur : start;
    out.push({ start, end, text });
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

function withFormat(url: string, fmt: string): string {
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}fmt=${fmt}`;
}

/**
 * Fetch and parse the cues for a track. Tries srv1 XML first, then json3.
 * Throws on network failure; returns [] when the response can't be parsed
 * into any cues (caller treats that as a parse error).
 */
export async function fetchCaptionCues(track: CaptionTrack): Promise<CaptionCue[]> {
  // Default (srv1) XML.
  const xmlRes = await fetch(track.url, { credentials: 'include' });
  if (xmlRes.ok) {
    const xml = await xmlRes.text();
    const cues = parseSrv1Xml(xml);
    if (cues.length > 0) return cues;
  }

  // Fallback: json3.
  const jsonRes = await fetch(withFormat(track.url, 'json3'), { credentials: 'include' });
  if (jsonRes.ok) {
    const json = await jsonRes.text();
    const cues = parseJson3(json);
    if (cues.length > 0) return cues;
  }

  return [];
}
