import express from 'express';
import cors from 'cors';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const ytDlpPath = process.env.YTDLP_PATH || '/usr/local/bin/yt-dlp';

const cookiesPath = process.env.YTDLP_COOKIES_PATH || path.join(os.homedir(), 'cookies.txt');
const hasCookies = fs.existsSync(cookiesPath);
console.log(hasCookies
  ? `[startup] Using yt-dlp cookies file at ${cookiesPath}`
  : `[startup] No cookies file at ${cookiesPath}, running unauthenticated (may hit YouTube bot checks)`);

const CACHE_DIR = process.env.AUDIO_CACHE_DIR || path.join(os.homedir(), 'audio-cache');
fs.mkdirSync(CACHE_DIR, { recursive: true });
const MAX_CACHE_BYTES = 1024 * 1024 * 1024; // ~1 GB
const MAX_PARALLEL_DOWNLOADS = 2;
console.log(`[startup] yt-dlp: ${ytDlpPath} | audio cache: ${CACHE_DIR}`);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const YT_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const PLAYLIST_ID_RE = /^[A-Za-z0-9_-]{10,64}$/;

// ── Failure reasons ──────────────────────────────────────
// Turns yt-dlp's error text into a short code the app can show a friendly message for.
function classifyFailure(err) {
  if (err && err.timedOut) return 'timeout';
  const text = `${(err && err.stderr) || ''} ${(err && err.message) || ''}`.toLowerCase();
  if (/private video|video unavailable|this video is not available|has been removed|members-only|join this channel|in your country|copyright|age-restricted|confirm your age|has been terminated/.test(text)) return 'unavailable';
  if (/sign in to confirm|not a bot|cookies are no longer valid|login required|use --cookies/.test(text)) return 'cookies';
  if (/requested format is not available/.test(text)) return 'format';
  return 'unknown';
}

// Remember recent failures for a minute so the app's follow-up check is instant
// instead of triggering another slow yt-dlp run.
const FAILURE_TTL_MS = 60 * 1000;
const recentFailures = new Map(); // videoId -> { reason, message, at }
function recordFailure(id, err) {
  if (recentFailures.size > 200) recentFailures.clear();
  const reason = classifyFailure(err);
  recentFailures.set(id, { reason, message: err.message, at: Date.now() });
  noteFailure(reason);
}

// ── Status (what the app's Status panel shows) ───────────
const status = {
  lastOkAt: null,        // last time yt-dlp successfully got audio from YouTube
  lastCookieFailAt: null,
  lastFailure: null,     // { reason, at }
  ytdlpVersion: null,
  versionAt: 0,
};
const CHECK_VIDEO_ID = process.env.CHECK_VIDEO_ID || 'dQw4w9WgXcQ';
const ago = (t) => (t ? Math.round((Date.now() - t) / 1000) : null);

function noteSuccess() {
  status.lastOkAt = Date.now();
}
function noteFailure(reason) {
  status.lastFailure = { reason, at: Date.now() };
  if (reason === 'cookies') status.lastCookieFailAt = Date.now();
}

// Runs yt-dlp without execFile's pipe-close wait. stdin is closed, the promise
// settles when the process exits, and the whole process group is killed on
// timeout so a stuck helper process can never keep a request hanging.
function runYtDlp(args, timeoutMs, maxBytes = 50 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const child = spawn(ytDlpPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
      env: {
        ...process.env,
        HOME: os.homedir(),
        PATH: `${os.homedir()}/.deno/bin:${process.env.PATH || '/usr/local/bin:/usr/bin:/bin'}`,
      },
    });

    let stdout = '';
    let stderr = '';
    let exited = false;
    let exitCode = null;
    let settled = false;

    const killGroup = () => {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
    };

    const settle = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      killGroup();
      if (err) {
        err.stderr = stderr;
        reject(err);
      } else {
        resolve(value);
      }
    };

    const timer = setTimeout(() => {
      settle(Object.assign(new Error(`yt-dlp timed out after ${timeoutMs}ms`), { timedOut: true }));
    }, timeoutMs);

    const finishIfDone = () => {
      if (exitCode === 0) settle(null, { stdout, stderr });
      else settle(new Error(`yt-dlp exited with code ${exitCode}: ${stderr.trim().split('\n').slice(-3).join(' | ')}`));
    };

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    child.stdout.on('data', (d) => {
      stdout += d;
      if (stdout.length > maxBytes) settle(new Error('yt-dlp output too large'));
    });
    child.stderr.on('data', (d) => { stderr += d; });

    child.stdout.on('end', () => { if (exited) finishIfDone(); });

    child.on('error', (e) => settle(e));
    child.on('exit', (code, signal) => {
      exited = true;
      exitCode = code === null ? `signal ${signal}` : code;
      setTimeout(finishIfDone, 1500);
      if (child.stdout.readableEnded) finishIfDone();
    });
  });
}

// ── Audio cache ──────────────────────────────────────────

let activeDownloads = 0;
const waitingDownloads = [];
function limitDownloads(fn) {
  return new Promise((resolve, reject) => {
    const run = async () => {
      activeDownloads++;
      try { resolve(await fn()); } catch (e) { reject(e); }
      finally {
        activeDownloads--;
        const next = waitingDownloads.shift();
        if (next) next();
      }
    };
    if (activeDownloads < MAX_PARALLEL_DOWNLOADS) run();
    else waitingDownloads.push(run);
  });
}

const cachedPath = (id) => path.join(CACHE_DIR, `${id}.m4a`);
const inflight = new Map(); // videoId -> Promise<filePath>

// Resolves to the path of a fully downloaded m4a for this video.
// Concurrent callers for the same id share one download.
function ensureAudio(id) {
  const file = cachedPath(id);
  try {
    if (fs.statSync(file).size > 0) return Promise.resolve(file);
  } catch { /* not cached yet */ }

  if (inflight.has(id)) return inflight.get(id);

  const p = limitDownloads(async () => {
    const started = Date.now();
    await runYtDlp([
      `https://www.youtube.com/watch?v=${id}`,
      '--force-ipv4',
      '--no-playlist',
      '--no-warnings',
      '-q',
      '--extractor-args', 'youtube:player_client=mweb',
      ...(hasCookies ? ['--cookies', cookiesPath] : []),
      '-f', 'bestaudio[ext=m4a]',
      '-o', path.join(CACHE_DIR, `${id}.%(ext)s`),
    ], 90000);

    const size = fs.statSync(file).size; // throws if the file is missing
    console.log(`[cache] ${id} downloaded: ${(size / 1048576).toFixed(1)} MB in ${Date.now() - started}ms`);
    recentFailures.delete(id);
    noteSuccess();
    return file;
  }).catch((err) => { recordFailure(id, err); throw err; }).finally(() => inflight.delete(id));

  inflight.set(id, p);
  return p;
}

// Removes stale partial downloads and keeps the cache under MAX_CACHE_BYTES.
function cleanCache() {
  try {
    const now = Date.now();
    let files = fs.readdirSync(CACHE_DIR).map((name) => {
      const p = path.join(CACHE_DIR, name);
      const st = fs.statSync(p);
      return { p, name, size: st.size, mtime: st.mtimeMs };
    });

    for (const f of files) {
      if (!f.name.endsWith('.m4a') && now - f.mtime > 60 * 60 * 1000) {
        fs.unlinkSync(f.p);
      }
    }
    files = files.filter((f) => fs.existsSync(f.p)).sort((a, b) => a.mtime - b.mtime);

    let total = files.reduce((n, f) => n + f.size, 0);
    for (const f of files) {
      if (total <= MAX_CACHE_BYTES) break;
      if (!f.name.endsWith('.m4a')) continue;
      fs.unlinkSync(f.p);
      total -= f.size;
      console.log(`[cache] evicted ${f.name}`);
    }
  } catch (e) {
    console.error('[cache] cleanup error:', e.message);
  }
}
cleanCache();
setInterval(cleanCache, 60 * 60 * 1000).unref();

// ── Routes ───────────────────────────────────────────────

// Keep only the playlist ID from whatever URL the tablet sends.
function cleanPlaylistUrl(raw) {
  try {
    const u = new URL(raw);
    const list = u.searchParams.get('list');
    if (list && PLAYLIST_ID_RE.test(list)) {
      return `https://www.youtube.com/playlist?list=${list}`;
    }
  } catch { /* fall through */ }
  return null;
}

// 1. Fetch Playlist Tracks
app.post('/api/youtube/playlist', async (req, res) => {
  const raw = req.body && req.body.url;
  console.log('Tablet is requesting playlist:', raw);
  if (!raw) return res.status(400).json({ error: 'URL is required' });

  const url = cleanPlaylistUrl(raw);
  if (!url) return res.status(400).json({ error: 'Could not find a playlist ID in that URL' });

  const started = Date.now();
  try {
    const { stdout, stderr } = await runYtDlp([
      url,
      '--force-ipv4',
      '--flat-playlist',
      '--dump-single-json',
      '--no-warnings',
      '--extractor-args', 'youtube:player_client=android,web',
      ...(hasCookies ? ['--cookies', cookiesPath] : []),
    ], 30000);

    console.log(`yt-dlp playlist finished in ${Date.now() - started}ms`);
    if (stderr.trim()) console.log('yt-dlp stderr:', stderr.trim().slice(0, 500));

    const data = JSON.parse(stdout);
    const entries = (data.entries || [])
      .filter((e) => e && e.id && YT_ID_RE.test(e.id))
      .map((e) => ({
        videoId: e.id,
        title: e.title || e.id,
        artist: e.uploader || e.channel || 'Unknown Artist',
        duration: typeof e.duration === 'number' ? e.duration : null,
        art: `https://i.ytimg.com/vi/${e.id}/hqdefault.jpg`,
      }));

    res.json({ tracks: entries });

    // Warm the cache for the first two songs so the first tap is quick.
    entries.slice(0, 2).forEach((e) => ensureAudio(e.videoId).catch(() => {}));
  } catch (err) {
    console.error(`=== YOUTUBE FETCH ERROR after ${Date.now() - started}ms ===`,
      err.timedOut ? 'TIMEOUT' : '', err.message, '\nSTDERR:', (err.stderr || '').slice(0, 1000));
    noteFailure(classifyFailure(err));
    res.status(500).json({ error: err.message });
  }
});

// 2. Stream Audio via Video ID (downloads once, then serves the cached file with Range support)
app.get('/api/youtube/stream', async (req, res) => {
  const { id } = req.query;
  if (!id || !YT_ID_RE.test(id)) return res.status(400).send('Invalid video ID');

  const recent = recentFailures.get(id);
  if (recent && Date.now() - recent.at < FAILURE_TTL_MS) {
    return res.status(502).json({ reason: recent.reason, message: recent.message });
  }

  const started = Date.now();
  try {
    const file = await ensureAudio(id);
    const now = new Date();
    fs.utimes(file, now, now, () => {}); // mark as recently used for cache eviction

    console.log(`[stream] ${id} ready after ${Date.now() - started}ms, range: ${req.headers.range || 'none'}`);
    res.sendFile(file, {
      headers: {
        'Content-Type': 'audio/mp4',
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
      },
    }, (err) => {
      if (err && !res.headersSent) res.status(500).end();
    });
  } catch (err) {
    console.error(`=== YOUTUBE STREAM ERROR for ${id} ===`, err.timedOut ? 'TIMEOUT' : '', err.message,
      '\nSTDERR:', (err.stderr || '').slice(0, 1000));
    if (!res.headersSent) res.status(502).json({ reason: classifyFailure(err), message: err.message });
  }
});

// 3. Optional: ask the server to download a track ahead of time
app.get('/api/youtube/prefetch', (req, res) => {
  const { id } = req.query;
  if (!id || !YT_ID_RE.test(id)) return res.status(400).send('Invalid video ID');
  ensureAudio(id).catch(() => {});
  res.status(202).send('prefetching');
});

// 4. Health check (the app uses this to tell "server down" from "track failed")
app.get('/api/health', (req, res) => {
  res.type('text').send('ok');
});

// ── Status panel data ────────────────────────────────────

async function getYtDlpVersion() {
  if (status.ytdlpVersion && Date.now() - status.versionAt < 60 * 60 * 1000) return status.ytdlpVersion;
  try {
    const { stdout } = await runYtDlp(['--version'], 10000);
    status.ytdlpVersion = stdout.trim();
    status.versionAt = Date.now();
  } catch { /* keep the old value */ }
  return status.ytdlpVersion;
}

// ok = a download worked after the last cookie failure; expired = the last cookie failure is newer.
function cookieState() {
  if (!hasCookies) return 'missing';
  if (status.lastCookieFailAt && (!status.lastOkAt || status.lastCookieFailAt > status.lastOkAt)) return 'expired';
  return status.lastOkAt ? 'ok' : 'unknown';
}

function cacheSummary() {
  try {
    const files = fs.readdirSync(CACHE_DIR).filter((n) => n.endsWith('.m4a'));
    const bytes = files.reduce((n, f) => n + fs.statSync(path.join(CACHE_DIR, f)).size, 0);
    return { files: files.length, mb: Math.round(bytes / 1048576) };
  } catch {
    return { files: 0, mb: 0 };
  }
}

async function buildStatus() {
  return {
    ok: true,
    cookies: cookieState(),
    ytdlp: await getYtDlpVersion(),
    lastOkAgo: ago(status.lastOkAt),
    lastFailure: status.lastFailure ? { reason: status.lastFailure.reason, ago: ago(status.lastFailure.at) } : null,
    cache: cacheSummary(),
    uptime: Math.round(process.uptime()),
  };
}

// 4b. Status for the app's Status panel (cheap: no YouTube request)
app.get('/api/status', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await buildStatus());
});

// 4c. "Check now": a quick real yt-dlp run (extraction only, no download) so cookie
// problems show up immediately instead of on the next song.
let checkRunning = null;
let lastCheck = { at: 0, result: null };
app.post('/api/status/check', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  // Reuse a result from the last few seconds so repeated taps cannot hammer YouTube.
  if (lastCheck.result && Date.now() - lastCheck.at < 10 * 1000) {
    return res.json({ ...(await buildStatus()), check: lastCheck.result });
  }
  if (!checkRunning) {
    checkRunning = (async () => {
      const started = Date.now();
      try {
        await runYtDlp([
          `https://www.youtube.com/watch?v=${CHECK_VIDEO_ID}`,
          '--force-ipv4',
          '--no-playlist',
          '--no-warnings',
          '-q',
          '--simulate',
          '--extractor-args', 'youtube:player_client=mweb',
          ...(hasCookies ? ['--cookies', cookiesPath] : []),
          '-f', 'bestaudio[ext=m4a]',
        ], 45000);
        noteSuccess();
        console.log(`[check] passed in ${Date.now() - started}ms`);
        return { ok: true, ms: Date.now() - started };
      } catch (err) {
        const reason = classifyFailure(err);
        noteFailure(reason);
        console.error('[check] failed:', reason, err.message);
        return { ok: false, reason, ms: Date.now() - started };
      }
    })()
      .then((r) => { lastCheck = { at: Date.now(), result: r }; return r; })
      .finally(() => { checkRunning = null; });
  }
  const result = await checkRunning;
  res.json({ ...(await buildStatus()), check: result });
});

// 5. Search YouTube (returns the same track shape as a playlist)
app.get('/api/youtube/search', async (req, res) => {
  const q = String(req.query.q || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 100);
  if (!q) return res.status(400).json({ error: 'Query is required' });

  const PAGE = 12;
  const offset = Math.max(0, Math.min(48, parseInt(req.query.offset, 10) || 0));

  const started = Date.now();
  try {
    const { stdout } = await runYtDlp([
      `ytsearch${offset + PAGE}:${q}`,
      '--force-ipv4',
      '--flat-playlist',
      '--dump-single-json',
      '--no-warnings',
      '--extractor-args', 'youtube:player_client=android,web',
      ...(hasCookies ? ['--cookies', cookiesPath] : []),
    ], 25000 + offset * 500);

    const data = JSON.parse(stdout);
    // "more results" asks for a later page: fetch everything up to it and drop what the app already has
    const raw = (data.entries || []).slice(offset);
    const tracks = raw
      .filter((e) => e && e.id && YT_ID_RE.test(e.id))
      // skip hour-long mixes and live streams: they are huge downloads
      .filter((e) => typeof e.duration !== 'number' || e.duration <= 2400)
      .map((e) => ({
        videoId: e.id,
        title: e.title || e.id,
        artist: e.uploader || e.channel || 'Unknown Artist',
        duration: typeof e.duration === 'number' ? e.duration : null,
        art: `https://i.ytimg.com/vi/${e.id}/hqdefault.jpg`,
      }));

    const nextOffset = offset + PAGE;
    const hasMore = raw.length >= PAGE && nextOffset < 60;
    console.log(`[search] "${q}" offset ${offset} -> ${tracks.length} results in ${Date.now() - started}ms`);
    res.json({ tracks, nextOffset, hasMore });

    // Warm the cache for the top result so the first tap is quick.
    if (offset === 0 && tracks[0]) ensureAudio(tracks[0].videoId).catch(() => {});
  } catch (err) {
    noteFailure(classifyFailure(err));
    console.error(`=== YOUTUBE SEARCH ERROR for "${q}" ===`, err.timedOut ? 'TIMEOUT' : '', err.message,
      '\nSTDERR:', (err.stderr || '').slice(0, 1000));
    res.status(502).json({ error: err.message });
  }
});

// 6. Title and uploader for a single pasted video link
async function lookupVideo(id) {
  const watchUrl = `https://www.youtube.com/watch?v=${id}`;
  // oEmbed is quick and needs no cookies; some videos refuse it, so fall back to yt-dlp.
  if (typeof fetch === 'function') {
    try {
      const r = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`,
        { signal: AbortSignal.timeout(8000) });
      if (r.ok) {
        const j = await r.json();
        if (j && j.title) return { title: j.title, artist: j.author_name || 'Unknown Artist', duration: null };
      }
    } catch { /* fall through to yt-dlp */ }
  }
  const { stdout } = await runYtDlp([
    watchUrl,
    '--force-ipv4',
    '--no-playlist',
    '--dump-single-json',
    '--no-warnings',
    '--extractor-args', 'youtube:player_client=android,web',
    ...(hasCookies ? ['--cookies', cookiesPath] : []),
  ], 25000);
  const d = JSON.parse(stdout);
  return {
    title: d.title || id,
    artist: d.uploader || d.channel || 'Unknown Artist',
    duration: typeof d.duration === 'number' ? d.duration : null,
  };
}

app.get('/api/youtube/video', async (req, res) => {
  const { id } = req.query;
  if (!id || !YT_ID_RE.test(id)) return res.status(400).json({ error: 'invalid video link' });
  try {
    const info = await lookupVideo(id);
    res.json({ videoId: id, ...info, art: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` });
    ensureAudio(id).catch(() => {}); // warm the cache: the listener will tap play next
  } catch (err) {
    console.error(`=== YOUTUBE VIDEO LOOKUP ERROR for ${id} ===`, err.message);
    res.status(502).json({ error: 'could not load that video' });
  }
});

app.listen(PORT, () => console.log(`Cupid Audio server listening on port ${PORT}`));