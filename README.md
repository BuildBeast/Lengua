# Lengua

A Chrome side-panel companion for learning Spanish from real video content
(Andalusian / Canal Sur–style listening practice). It detects the active video,
mirrors its state and Spanish captions into the side panel, syncs the current
subtitle + transcript, and offers local quick-translation of selected text.

Supported platforms today: **YouTube** and **Canal Sur / CanalSur Más**, behind
a small platform-adapter boundary so new sources can be added without rewriting
the core.

## Platform support

- **YouTube** — Spanish caption tracks are mirrored into the panel (turn on
  Spanish CC on the video; cues are captured from the player).
- **CanalSur Más** — native text tracks (`<track>` / `video.textTracks`,
  including ESP subtitles) are supported when the page exposes them. Verified on
  a real native-track video (1888 cues: current-subtitle sync, transcript
  highlight, and replay-current-line all work).
- **No-caption fallback.** Many Canal Sur videos have no accessible captions
  (e.g. behind HLS/DRM or a separate media CDN). For those, you can **paste a
  transcript** and get the same Quick Translation flow (word click,
  phrase/sentence drag) as captions. **Local, on-device audio transcription is
  coming next** — it will be free, with no API key, no account, and nothing
  sent off your device. The **audio capture probe** (Record test 5s) is the
  foundation already in place: it verifies the extension can capture audible
  audio from the player (DRM streams often capture as silence).

## Known limitations

- **On-device translation is best for words/phrases, not full sentences.**
  Chrome on-device translation is useful for quick word/phrase lookup but can be
  literal on full subtitle lines, especially idioms such as "lo mismo" meaning
  "maybe". For full-sentence quality, use the DeepL/Google fallback buttons.
  Selections of 6+ words (or that span a full sentence) are labelled "Rough
  Local Translation" and surface those fallbacks more prominently.
- **Audio transcription is not built yet.** The tab-audio capture foundation is
  in place (the Record test 5s probe), but transcription itself is still to
  come. When it lands it will run **fully on-device** — free, no API key, no
  account, no backend, nothing sent off your computer. DRM-protected streams
  often capture as silence (the probe detects and reports this), which may make
  audio transcription unavailable on exactly the videos we care about.

## Stack

Chrome Manifest V3 · React · TypeScript · Vite · Chrome Side Panel API.
No backend, auth, database, payments, analytics, API keys, or paid services.
Translation is on-device, and audio transcription is planned to be on-device
too — Lengua stays free and local-first.

## Project structure

```
lengua/
  public/
    manifest.json          # MV3 manifest (copied verbatim into dist/)
  sidepanel.html           # side panel HTML entry
  offscreen.html           # headless offscreen doc entry (tab-audio capture)
  src/
    background/
      serviceWorker.ts      # opens side panel; runs tab-audio recording
    offscreen/
      offscreen.ts          # captures + analyses tab audio, returns the clip
    content/
      youtubeDetector.ts    # YouTube content-script entry: polling + messaging
      captionInterceptor.ts # MAIN-world hook capturing YouTube caption requests
      videoState.ts         # reads video state from the YouTube DOM
      captionTracks.ts      # YouTube track shaping + Spanish selection
      youtubeCaptions.ts    # YouTube caption fetch/parse (srv1/srv3/json3)
      canalSurDetector.ts   # Canal Sur content-script entry: polling + probe
      vttParser.ts          # self-contained WebVTT/SRT parser
      platforms/
        types.ts            # PlatformAdapter boundary (type-only)
        youtubeAdapter.ts   # YouTube video-state + controls adapter
        canalSurAdapter.ts  # Canal Sur detection, controls, caption probe
    sidepanel/
      main.tsx              # React bootstrap
      App.tsx               # panel state + chrome messaging + platform routing
      VideoStatus.tsx       # video fields + replay controls
      CaptionsPanel.tsx     # caption status + collapsed probe report
      CurrentSubtitle.tsx   # prev/current/next lines, word + line translate
      TranscriptList.tsx    # scrollable transcript, seek by timestamp
      ExplanationPanel.tsx  # Quick Translation (local) + DeepL/Google links
      Words.tsx             # per-word clickable subtitle text
      translate.ts          # on-device Translator API + fallback links
      NoCaptionFallback.tsx # no-caption surface: capture probe + manual paste
      AudioProbe.tsx        # capture test + "local transcription coming next"
      audioCapture.ts       # record-tab-audio request (side panel only)
      ManualTranscript.tsx  # paste-your-own-text fallback (today's working path)
      PlaceholderSection.tsx
      styles.css
    shared/
      types.ts              # VideoState + VideoPlatform (type-only)
      captions.ts           # CaptionState / CaptionCue / CaptionProbe
      messages.ts           # message protocol (type-only)
      time.ts               # formatTime helper
  vite.config.ts
  tsconfig.json
  package.json
```

## Run locally (dev)

```bash
npm install
npm run dev
```

`npm run dev` serves the side-panel UI in a normal browser tab for fast UI
iteration. **Chrome messaging APIs are unavailable there**, so the panel will
show the "Open a YouTube video to begin." empty state — that's expected. To
test the real extension behaviour, use the build + load flow below.

## Build

```bash
npm run build      # outputs a Chrome-loadable extension into dist/
npm run typecheck  # optional: strict TypeScript check (no emit)
```

## Load in Chrome

1. Run `npm run build`.
2. Open `chrome://extensions`.
3. Toggle **Developer mode** (top right) on.
4. Click **Load unpacked** and select the **`dist/`** folder.
5. Pin "Lengua" from the extensions menu, then click its toolbar icon to open
   the side panel.

> Load the **`dist/`** folder, not the project root — `dist/` is where the
> built manifest and bundles live.

## Manual QA

1. `npm install`
2. `npm run build`
3. Load `dist/` via `chrome://extensions` (Developer mode → Load unpacked).
4. Open a YouTube video, e.g. `https://www.youtube.com/watch?v=...`.
5. Click the Lengua toolbar icon to open the side panel.
6. Confirm the **Video** section shows the title, video ID, canonical URL,
   `current / duration` time, and a Playing/Paused badge.
7. Press **Replay 5s** — playback jumps back ~5s and the time updates.
8. Press **Replay 10s** — playback jumps back ~10s.
9. Click a recommended video to navigate to a new watch page.
10. Confirm the panel updates (new title/ID/time) without a full refresh.

Extra checks:

- Visit the YouTube homepage (a non-watch page) → panel shows
  "Open a YouTube video to begin."
- During the brief load before the `<video>` exists → "Looking for video…".
- Open a CanalSur Más video → panel shows **Video · Canal Sur**, video state,
  and (for native-track videos) the synced subtitle + transcript. Videos with
  no accessible captions show the "no accessible captions found" state and a
  collapsed **Caption probe** report.
