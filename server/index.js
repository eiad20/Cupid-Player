import express from 'express';
import cors from 'cors';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import https from 'node:https';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ytDlpPath = path.resolve(__dirname, 'yt-dlp.exe');

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
    ], { timeout: 30000, maxBuffer: 50 * 1024 * 1024 });

    const data = JSON.parse(stdout);
    const entries = (data.entries || [])
      .filter((e) => e && e.id && YT_ID_RE.test(e.id))
      .map((e) => ({
        videoId: e.id,
        title: e.title || e.id,
        artist: e.uploader || e.channel || 'Unknown Artist',
        duration: typeof e.duration === 'number' ? e.duration : null,
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
      '-f', 'bestaudio[ext=m4a]/bestaudio',
      '--no-playlist',
      '--no-warnings',
      '-g',
    ], { timeout: 15000 });

    const streamUrl = stdout.trim();
    if (!streamUrl.startsWith('http')) return res.status(502).send('Stream URL not found');

    const client = streamUrl.startsWith('https') ? https : http;
    const proxyReq = client.get(streamUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        Referer: 'https://www.youtube.com/',
      },
    }, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, {
        'Content-Type': 'audio/mp4',
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
      });
      proxyRes.pipe(res);
    });

    proxyReq.on('error', () => res.status(500).end());
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.listen(PORT, () => console.log(`Cupid Audio server listening on port ${PORT}`));