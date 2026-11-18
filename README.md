# Cupid Player

A cozy pixel-art music player. It plays local audio and streams YouTube audio, all inside a little interactive room with a spinning turntable, a cat, a clock, and a visualizer on the window.

Built with React and Vite, packaged with Capacitor for Android (tablets and phones) and Electron for desktop.

## Why it exists

Cupid Player is a personal gift and passion project, not a commercial product. It has two users, and one of them is the developer.

- **A player, not a platform.** No algorithms, accounts, social feeds, or library bloat.
- **Every feature has one goal:** make listening to music feel cozy, simple, reliable, and personal.
- **Charm, ease of use, and low maintenance** come before platform-style complexity.

## Features

### The room

- Two full themes, Pink and Blue. Switching updates the room frame, palette, search icon, plant, cat, and clock.
- Animated turntable. The record spins during playback, the tonearm lifts on track changes, and records alternate between two colors with a slide animation.
- Pixel-art window visualizer: a 16-bar equalizer on the window glass, drawn on a canvas with the Web Audio API. It has a smooth wave fallback for sources without frequency data, and can be turned off in Settings.
- Tap the pixel cat to spawn floating hearts.
- Live analog wall clock, window sill plant, and soft ambient lighting.
- Responsive scaling from a single `--u` unit, covering desktop windows, tablets, and tall phone screens.

### Playback

- Play, pause, next, previous (restarts the song if more than 3 seconds have played).
- Normal, shuffle, and repeat modes. Shuffle pre-computes the next track so prefetching matches.
- Smooth touch and mouse scrubbing. The star follows your finger and only seeks on release, so there is no stutter.
- Expandable volume control, saved between sessions.
- Pixel-masked album art, scrolling long titles, elapsed and remaining time.

### Music sources and queue

- **Local audio:** pick files from device storage on Android, or load the local music folder on desktop.
- **YouTube search:** search by song or artist, in pages of 12, skipping videos longer than 40 minutes.
- **Paste a link:** videos, Shorts, `youtu.be` links, and full playlist URLs. `RD...` mix links load as single tracks.
- **Playlist loader** in Settings.
- **Queue panel:** thumbnails, active track marker, tap any song to jump to it, and a "more results" button that appends the next page without interrupting playback.
- **Smart prefetching:** the server downloads the next track in the background so transitions feel instant.

### Android and desktop

- Background playback with a Foreground Service and Wake Lock, so music keeps playing with the screen off.
- Lock-screen and notification controls (title, artist, art, progress, play, pause, next, previous, seek) via `@capgo/capacitor-media-session`.
- Custom frameless Electron window with a draggable top bar, resize handles, and pixel-art window buttons.
- Custom pixel-art app icon.

### Reliability

- Status panel in Settings (YouTube mode) that polls the server every 60 seconds and shows overall status, cookies state, `yt-dlp` version, and time since the last successful download, with a `check now` button for a live extraction test.
- A `fetching track...` bubble when a YouTube track takes longer than 1.5 seconds to start.
- Playback errors are classified (`offline`, `cookies`, `unavailable`, `timeout`, `format`, `unknown`). Unavailable or timed-out tracks are skipped. Unrecoverable errors (server offline, expired cookies, 3 failures in a row) stop playback and explain why.

## Tech stack

| Part | Tools |
|---|---|
| Front end | React, Vite, CSS custom properties |
| Android | Capacitor, `@capgo/capacitor-media-session`, Android Foreground Service |
| Desktop | Electron |
| Audio | HTML5 Audio, Web Audio API (`AnalyserNode`) |
| Server | Node.js, Express, `yt-dlp` (`mweb` client with the `bgutil` PO token provider) |
| Hosting | AWS EC2 (Ubuntu), Caddy reverse proxy, DuckDNS domain with automatic TLS |

## Project structure

```
android/    Capacitor Android project
assets/     Pixel-art images for both themes and the app icon
audio/      Local audio files (desktop)
electron/   Electron main process
font/       Pixel fonts
scripts/    Helper scripts
server/     Node/Express companion server for YouTube streaming
src/        React app (App.jsx, App.css, services/)
```
