# Lengua

A YouTube-first Chrome side-panel companion for learning Spanish from real
video content (Andalusian / Canal Sur–style listening practice).

**Sprint 1 = foundation only.** The extension detects the active YouTube video
and mirrors its state into a side panel, with replay controls and placeholder
sections for the features coming next (captions, explanation, saved phrases).

## Stack

Chrome Manifest V3 · React · TypeScript · Vite · Chrome Side Panel API.
No backend, AI, auth, database, payments, or analytics.

## Project structure

```
lengua/
  public/
    manifest.json          # MV3 manifest (copied verbatim into dist/)
  sidepanel.html           # side panel HTML entry
  src/
    background/
      serviceWorker.ts      # opens the side panel from the toolbar icon
    content/
      youtubeDetector.ts    # content-script entry: polling + messaging
      videoState.ts         # reads video state from the YouTube DOM
    sidepanel/
      main.tsx              # React bootstrap
      App.tsx               # panel state + chrome messaging
      VideoStatus.tsx       # video fields + replay controls
      PlaceholderSection.tsx
      styles.css
    shared/
      types.ts              # VideoState (type-only)
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
