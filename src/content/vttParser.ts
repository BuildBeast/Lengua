import type { CaptionCue } from '../shared/captions';

// WebVTT (and lenient SRT) parser. Self-contained on purpose: it shares no
// runtime module with the YouTube content script, so the Canal Sur bundle's
// dependency graph stays disjoint and Rollup keeps emitting each content script
// as a single classic file (no cross-chunk `import`).

/** Decode HTML entities and strip inline cue tags (e.g. <c>, <00:00:01.000>). */
function cleanText(raw: string): string {
  const el = document.createElement('textarea');
  el.innerHTML = raw.replace(/<[^>]*>/g, '');
  return el.value.replace(/\s+/g, ' ').trim();
}

/** Parse `HH:MM:SS.mmm` / `MM:SS.mmm` (also tolerates a comma, SRT-style). */
function parseTimestamp(stamp: string): number {
  const m = stamp.trim().replace(',', '.').match(/(?:(\d+):)?(\d{1,2}):(\d{2}(?:\.\d+)?)/);
  if (!m) return NaN;
  const hours = m[1] ? parseInt(m[1], 10) : 0;
  const minutes = parseInt(m[2], 10);
  const seconds = parseFloat(m[3]);
  return hours * 3600 + minutes * 60 + seconds;
}

/**
 * Sort by start, drop empties, clamp overlaps to the next cue's start (so
 * active-cue lookup is unambiguous) and assign stable ids. Mirrors the YouTube
 * normaliser's guarantees; duplicated here to keep this module dependency-free.
 */
export function normalizeCues(input: Array<Omit<CaptionCue, 'id' | 'duration'>>): CaptionCue[] {
  const sorted = input
    .filter((c) => c.text.length > 0 && Number.isFinite(c.start))
    .sort((a, b) => a.start - b.start);

  return sorted.map((cue, i) => {
    const next = sorted[i + 1];
    let end = Number.isFinite(cue.end) ? cue.end : cue.start;
    if (next && end > next.start) end = next.start;
    if (end <= cue.start) end = cue.start + 2;
    return { id: String(i), start: cue.start, end, duration: end - cue.start, text: cue.text };
  });
}

const CUE_TIMING = /(\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d+)?\s*-->\s*(\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d+)?/;

/**
 * Parse a WebVTT or SRT document into normalised cues. Returns [] when the body
 * isn't a recognisable caption file, so callers can treat it as "not captions".
 */
export function parseVtt(body: string): CaptionCue[] {
  if (!body) return [];
  // Normalise newlines and split into blocks separated by blank lines.
  const blocks = body.replace(/\r\n?/g, '\n').split(/\n{2,}/);
  const out: Array<Omit<CaptionCue, 'id' | 'duration'>> = [];

  for (const block of blocks) {
    const lines = block.split('\n');
    const timingIdx = lines.findIndex((l) => CUE_TIMING.test(l));
    if (timingIdx === -1) continue; // header, NOTE, or stray block

    const timingLine = lines[timingIdx];
    const [startRaw, endRaw] = timingLine.split('-->');
    const start = parseTimestamp(startRaw);
    // The end side may carry cue settings after the timestamp ("... align:start").
    const end = parseTimestamp((endRaw ?? '').split(/\s+/).filter(Boolean)[0] ?? '');
    if (!Number.isFinite(start)) continue;

    const text = cleanText(lines.slice(timingIdx + 1).join('\n'));
    if (!text) continue;
    out.push({ start, end, text });
  }

  return normalizeCues(out);
}

/** Quick check: does this body look like a WebVTT/SRT caption file? */
export function looksLikeCaptions(body: string): boolean {
  return /^﻿?WEBVTT/.test(body.trimStart()) || CUE_TIMING.test(body);
}
