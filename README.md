# InstaStream.io

A web-based video streaming application that lets you instantly stream large video files from direct URLs — no downloads required. Paste a video URL, hit **Stream**, and watch it play in a custom KMPlayer-inspired interface with keyboard shortcuts, subtitle support, and automatic format transcoding.


## Features

- **Direct URL Streaming** — Paste any direct video URL (MP4, MKV, etc., Definitely not pirated ones - iykyk😅) and start watching immediately.
- **Smart Playback Pipeline** — Automatically tries Direct Play → Proxy → Server-side Transcoding, falling back gracefully when needed.
- **Custom Video Player** — A KMPlayer-inspired UI with no default browser controls.
- **Keyboard Shortcuts** — Desktop-style controls: Space (play/pause), Arrow keys (seek), Shift+/- (speed), M (mute), F (fullscreen).
- **Server-side Transcoding** — Unsupported formats (e.g. MKV with non-browser codecs) are transcoded on-the-fly to fragmented MP4 via FFmpeg.
- **Subtitle Support** — Search and load subtitles via the OpenSubtitles API, with SRT-to-VTT conversion built in.
- **URL Normalization** — Auto-unwraps known wrapper URLs (e.g. `video-seed.dev/?url=...`) and rejects non-media sources with clear error messages.
- **Concurrency Control** — Configurable limit on simultaneous FFmpeg transcoding sessions (`MAX_ACTIVE_TRANSCODES`).

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | [Next.js 16](https://nextjs.org) (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS v4 |
| Transcoding | FFmpeg via `fluent-ffmpeg` |
| Icons | Lucide React |
| Player | Native HTML5 `<video>` + Media Source Extensions (MSE) |
| Subtitles | OpenSubtitles REST API v1 |

## Prerequisites

Before running the project locally, make sure you have:

- **Node.js** v18 or later — [Download](https://nodejs.org/)
- **FFmpeg** installed and available on your system `PATH` — [Download](https://ffmpeg.org/download.html)
  - Verify with: `ffmpeg -version`
- **Git** — [Download](https://git-scm.com/)

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/Snyder9999/instastream.io.git
cd instastream.io
```

### 2. Install dependencies

```bash
npm install
```

### 3. Run the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### 4. Use the app

1. Paste a direct video URL into the input field on the landing page.
2. Click **Stream**.
3. The player will attempt direct playback first, then fall back to the proxy or transcoding pipeline as needed.
4. Use keyboard shortcuts to control playback.

## Project Structure

```
├── app/
│   ├── page.tsx                    # Landing page with URL input
│   ├── layout.tsx                  # Root layout
│   ├── globals.css                 # Global styles
│   └── api/
│       ├── stream/route.ts         # HTTP Range proxy for direct streaming
│       ├── transcode/route.ts      # FFmpeg transcoding pipeline
│       ├── media-info/route.ts     # Media metadata probe endpoint
│       └── subtitles/route.ts      # OpenSubtitles API proxy
├── components/
│   ├── KMPlayer.tsx                # Core video player + fallback logic
│   ├── Controls.tsx                # Play, pause, volume, seek UI
│   └── PlayerLayout.tsx            # Player wrapper layout
├── hooks/
│   └── usePlayerShortcuts.ts       # Keyboard shortcut engine
├── utils/
│   ├── mediaUrl.ts                 # URL normalization & media validation
│   ├── mediaProbe.ts               # FFprobe media info utility
│   ├── mseBufferLogic.ts           # MSE chunk buffering & back-buffer cleanup
│   ├── upstreamFetch.ts            # Upstream fetch with header forwarding
│   └── srtToVtt.ts                 # SRT → WebVTT subtitle converter
└── public/                         # Static assets
```

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start the development server |
| `npm run build` | Create a production build |
| `npm start` | Run the production server |
| `npm run lint` | Run ESLint |

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` | Play / Pause |
| `←` / `→` | Seek backward / forward 5s |
| `↑` / `↓` | Volume up / down |
| `Shift` + `+` / `-` | Increase / decrease playback speed |
| `M` | Toggle mute |
| `F` | Toggle fullscreen |

## Environment Variables (Optional)

| Variable | Default | Description |
|----------|---------|-------------|
| `MAX_ACTIVE_TRANSCODES` | `4` | Maximum concurrent FFmpeg transcoding sessions |

## Production Notes

> ⚠️ Long-lived FFmpeg transcoding streams are **not** a good fit for Vercel Serverless/Edge function limits. For production, run transcoding on dedicated compute (container, VM, or worker service) and keep Next.js API routes as control/proxy endpoints.

## License

This project is private and not currently licensed for public distribution.
