# Plan — Record & transcribe tab audio (free, on-device)

**Status: capture foundation BUILT; transcription PLANNED (local/free only).**

Lengua is free and local-first: **no external API, no API key, no paid
transcription, no backend.** Transcription must honour that, so the only piece
built so far is the on-device capture foundation:

- `src/background/serviceWorker.ts` — obtains the tab-audio stream id and drives
  recording (carries the `activeTab` invocation).
- `src/offscreen/offscreen.ts` — captures + analyses the clip in an offscreen
  document, keeps the tab audible, returns an in-memory `data:` URL. Nothing
  leaves the device.
- `src/sidepanel/audioCapture.ts` + `src/sidepanel/AudioProbe.tsx` — the side
  panel's "Record test 5s" probe that proves capture works (and flags silent /
  DRM-protected streams).

The next step is to plug a **local, on-device transcription engine** into this
pipeline (see "Free / local transcription options" below). It must add **no key,
no host permission, and no network call.**

## Feature

When a video has no captions, let the user click **Record next 15s**. The
extension captures the current tab's audio for 15 seconds, transcribes the
Spanish, and renders the result in the same transcript surface used today — so
the existing Quick Translation (word / phrase / sentence) works on it unchanged.

## MVP flow

1. User clicks **Record next 15s** in the side panel (no-caption fallback).
2. Side panel → service worker: `START_TAB_RECORDING { tabId, seconds: 15 }`.
3. Service worker resolves the target tab, ensures an **offscreen document**
   exists, and obtains a tab-audio **stream id** via
   `chrome.tabCapture.getMediaStreamId({ targetTabId })`.
4. Service worker → offscreen: the stream id.
5. Offscreen document:
   - `getUserMedia({ audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } } })`
   - Re-routes the stream to an `AudioContext` destination so the user still
     **hears** the tab (tab capture otherwise swallows the audio).
   - `MediaRecorder` records ~15s → `Blob` (`audio/webm;codecs=opus`).
   - Transcribes the blob to Spanish text (see "Transcription engine" below).
6. Offscreen → service worker → side panel: `TRANSCRIPT_READY { text }`.
7. Side panel feeds `text` through the existing `splitIntoLines()` and renders
   it in the transcript surface. Quick Translation already operates on that
   surface — no change needed.

## Required Chrome permissions

Add to `manifest.json`:

- `"tabCapture"` — capture the tab's audio.
- `"offscreen"` — host the capture + transcription in a DOM context (MV3
  service workers have no `navigator.mediaDevices`, `AudioContext`, or
  `MediaRecorder` access to live streams).
- **No host permission for any transcription endpoint** — transcription is
  on-device, so there is no endpoint to reach.

`activeTab` is not strictly required because we already hold broad host
permissions for YouTube/Canal Sur, and `getMediaStreamId` is invoked with an
explicit `targetTabId`. A user gesture (the side-panel button click) is the
trigger; we should confirm the gesture requirement survives the
side-panel → service-worker hop and, if not, fall back to invoking capture from
the action/context that retains the gesture.

## Which capture API

**`chrome.tabCapture` is the right API** — it captures the audio the tab is
playing, which is exactly what we want, and works regardless of whether the
player is in an iframe.

- In MV3 the **old** `chrome.tabCapture.capture()` callback form is **not
  available in the service worker**. Use the split pattern:
  `getMediaStreamId()` in the worker → `getUserMedia()` with
  `chromeMediaSource: 'tab'` in the offscreen document.
- `chrome.tabCapture.capture()` directly in the offscreen document is **not**
  the supported path; the `getMediaStreamId` + `getUserMedia` handoff is.
- `desktopCapture` / `getDisplayMedia` are wrong here — they prompt the user to
  pick a screen/window and capture system or window audio, a worse UX than
  silent tab capture.

## Offscreen document — required

**Yes, an offscreen document is mandatory.** MV3 service workers cannot use
`getUserMedia`, `AudioContext`, or `MediaRecorder` on a live stream. Plan:

- `chrome.offscreen.createDocument({ url, reasons: ['USER_MEDIA'], justification })`
  (`USER_MEDIA` is the reason for `getUserMedia`-based capture).
- Reuse a single offscreen doc across recordings; create lazily, tear down when
  idle to respect the single-offscreen-document limit.
- The offscreen page is a tiny bundled HTML/JS entry (new Vite input, like the
  content scripts). Messaging via `chrome.runtime` with a `target: 'offscreen'`
  discriminator.

## Free / local transcription options — the key decision

Lengua's standing constraint (see `src/sidepanel/translate.ts` and the
project's local-first principle) is **no external API, no keys, no backend, no
paid services**. Transcription strains this because Chrome has **no stable
built-in on-device speech-to-text API** (the built-in AI APIs cover
translation/summarization, not ASR). The options below are all free; they are
ranked by how well they fit on-device tab-audio capture.

### Option A (chosen) — Local WASM Whisper in the offscreen doc

Run Whisper via `transformers.js` (ONNX Runtime Web) or a `whisper.cpp` WASM
build **inside the offscreen document**, on the clip the probe already captures.
Fully on-device: no key, no backend, no host permission, private, and offline
after a one-time model download — consistent with how translation already works.

- **Pros:** matches the project's free / local-first principle exactly; nothing
  to store; no per-use cost.
- **Cons:** one-time model download (`tiny`/`base` ≈ 40–75 MB; quantized
  `tiny`/`base` is smaller and runs acceptably on a short clip); slower than a
  cloud API; quality on noisy / multi-speaker / accented audio is lower than
  large cloud models. WebGPU (when available) speeds inference up a lot;
  WASM/CPU is the fallback.
- **Decisions to make before building:**
  1. **Model + size.** Start with quantized `whisper-tiny` (or `base`) for
     Spanish; measure accuracy on real Canal Sur clips.
  2. **Ship vs. fetch the model.** Bundling inflates the extension; fetching on
     first use needs a `connect-src` CSP entry to the model host (e.g. the
     Hugging Face CDN) and `web_accessible_resources` for the WASM. Prefer
     fetch-on-first-use with an explicit "downloading model…" UI state, cached
     thereafter (Cache Storage / IndexedDB).
  3. **CSP / WASM.** MV3 needs `wasm-unsafe-eval` in the extension CSP to run
     the WASM runtime; verify against the offscreen document's CSP.
  4. **Threading.** Use the multi-threaded WASM build only if we can satisfy
     cross-origin isolation; otherwise single-thread is fine for short clips.

### Option B — Web Speech API (`SpeechRecognition`)

- **Rejected.** It transcribes microphone input, not an arbitrary captured tab
  stream, and Chrome's implementation routes audio to a Google server anyway —
  so it is neither local nor a fit for tab-audio capture.

### Option C — External transcription API (cloud STT)

- **Rejected — out of scope for this project.** POSTing the clip to a cloud STT
  endpoint would mean an API key (or backend), a host permission, a per-use
  cost, and user audio leaving the device. This is exactly the dependency we
  removed; it is not on the roadmap.

## Cost & keys

There are **none.** Transcription will be on-device (Option A): no API key to
store, no host permission, no backend, no metering. Bundling or proxying any
provider key is explicitly off the table.

## Expected limitations on Canal Sur Más

- **DRM / EME (Widevine):** if Canal Sur Más serves protected audio, tab
  capture typically yields **silence** for protected streams. This is the
  biggest risk and may make audio transcription unavailable on exactly the
  videos we care about. Must be validated early against real Canal Sur Más
  content before committing to the sprint.
- **Audio routing:** captured audio is removed from normal output unless we
  re-inject it via `AudioContext`; handled in the offscreen doc.
- **Playback state:** we capture the *next* 15s, so the video must be playing;
  if paused we should prompt the user or auto-handle.
- **Latency/quality (Option A):** background music, multiple speakers, and
  regional Andalusian accents reduce ASR accuracy on short clips.

## Preserving existing behaviour

- The feature surfaces **only** in `manualMode` (video detected +
  `not_found` / `error`). Captioned YouTube and captioned Canal Sur Más stay on
  the timed-cue transcript path, untouched.
- No changes to caption discovery, the content scripts, or the message types
  used by caption mode.
- New code is additive: new manifest permissions, a new offscreen entry, new
  message types (`START_TAB_RECORDING`, `TRANSCRIPT_READY`, offscreen-targeted),
  and service-worker handlers — none of which run in the captioned paths.

## Open questions for approval

1. Local WASM (Option A) vs. opt-in external API (Option B) for the MVP?
2. Is DRM on Canal Sur Más a blocker? (Needs a real-content capture test first.)
3. Ship the Whisper model with the extension or fetch on first use?
4. Keep the 15s fixed, or make the window configurable later?
