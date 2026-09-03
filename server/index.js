import express from 'express';
import cors from 'cors';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import https from 'node:https';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ytDlpPath = 'yt-dlp';

const cookiesPath = process.env.YTDLP_COOKIES_PATH || path.join(os.homedir(), 'cookies.txt');
const hasCookies = fs.existsSync(cookiesPath);
console.log(hasCookies
  ? `[startup] Using yt-dlp cookies file at ${cookiesPath}`
  : `[startup] No cookies file at ${cookiesPath} — running unauthenticated (may hit YouTube bot checks)`);

const execFileAsync = promisify(execFile);
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const YT_ID_RE = /^[A-Za-z0-9_-]{11}$/;

// 1. Fetch Playlist Tracks
app.post('/api/youtube/playlist', async (req, res) => {
  const { url } = req.body;
  console.log('Tablet is requesting playlist:', url);
  if (!url) return res.status(400).json({ error: 'URL is required' });

  try {
    const { stdout } = await execFileAsync(ytDlpPath, [
      url,
      '--flat-playlist',
      '--dump-single-json',
      '--no-warnings',
      '--extractor-args', 'youtube:player_client=android,web',
      ...(hasCookies ? ['--cookies', cookiesPath] : []),
    ], { timeout: 30000, maxBuffer: 50 * 1024 * 1024 });

    const data = JSON.parse(stdout);
    const entries = (data.entries || [])
      .filter((e) => e && e.id && YT_ID_RE.test(e.id))
      .map((e) => ({
        videoId: e.id,
        title: e.title || e.id,
        artist: e.uploader || e.channel || 'Unknown Artist',
        duration: typeof e.duration === 'number' ? e.duration : null,
        art: `https://i.ytimg.com/vi/${e.id}/hqdefault.jpg`
      }));

    res.json({ tracks: entries });
  } catch (err) {
    console.error("=== YOUTUBE FETCH ERROR ===", err);
    res.status(500).json({ error: err.message });
  }
});

// 2. Stream Audio via Video ID
app.get('/api/youtube/stream', async (req, res) => {
  const { id } = req.query;
  if (!id || !YT_ID_RE.test(id)) return res.status(400).send('Invalid video ID');

  try {
    const { stdout } = await execFileAsync(ytDlpPath, [
      `https://www.youtube.com/watch?v=${id}`,
      '-f', 'bestaudio/best', // Loosened format filter
      '--no-playlist',
      '--no-warnings',
      '--extractor-args', 'youtube:player_client=android,web',
      ...(hasCookies ? ['--cookies', cookiesPath] : []),
      '--print', '%(url)s', // Fetch URL
      '--print', '%(ext)s', // Fetch Extension
    ], { timeout: 15000 });

    // Parse the output to get both the URL and the file extension
    const outputParts = stdout.trim().split(/\r?\n/);
    const streamUrl = outputParts[0];
    const ext = outputParts[1] || 'mp4';

    if (!streamUrl || !streamUrl.startsWith('http')) return res.status(502).send('Stream URL not found');

    // Dynamically assign Content-Type
    const mimeType = ext === 'webm' ? 'audio/webm' : ext === 'ogg' ? 'audio/ogg' : 'audio/mp4';

    const upstreamHeaders = {
      'User-Agent': 'Mozilla/5.0',
      Referer: 'https://www.youtube.com/',
    };

    if (req.headers.range) {
      upstreamHeaders.Range = req.headers.range;
    }

    // Follow redirects ourselves (googlevideo sometimes 302s to a
    // different edge server) so the client always sees a plain 200/206
    // with real audio bytes, never a bare redirect it has to handle itself.
    function fetchAndPipe(url, redirectsLeft) {
      const client = url.startsWith('https') ? https : http;
      const proxyReq = client.get(url, { headers: upstreamHeaders }, (proxyRes) => {
        const isRedirect = [301, 302, 303, 307, 308].includes(proxyRes.statusCode);
        if (isRedirect && proxyRes.headers.location && redirectsLeft > 0) {
          proxyRes.resume(); // discard the (empty) redirect body
          return fetchAndPipe(proxyRes.headers.location, redirectsLeft - 1);
        }

        const responseHeaders = {
          'Content-Type': mimeType,
          'Accept-Ranges': 'bytes',
          'Access-Control-Allow-Origin': '*',
        };
        if (proxyRes.headers['content-length']) {
          responseHeaders['Content-Length'] = proxyRes.headers['content-length'];
        }
        if (proxyRes.headers['content-range']) {
          responseHeaders['Content-Range'] = proxyRes.headers['content-range'];
        }

        res.writeHead(proxyRes.statusCode, responseHeaders);
        proxyRes.pipe(res);
      });

      proxyReq.on('error', () => res.status(500).end());
    }

    fetchAndPipe(streamUrl, 5);
  } catch (err) {
    console.error("=== YOUTUBE STREAM ERROR ===", err.stderr || err.message);
    res.status(500).send(err.message);
  }
});

app.listen(PORT, () => console.log(`Cupid Audio server listening on port ${PORT}`));