const API_BASE = 'https://cupidplayer.duckdns.org/api';


export async function checkServerHealth(timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_BASE}/health`, {
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!res.ok) return false;
    const text = await res.text();
    return text.trim() === 'ok';
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
export async function fetchYouTubePlaylist(url) {
  const res = await fetch(`${API_BASE}/youtube/playlist`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) throw new Error('Failed to fetch playlist');
  const data = await res.json();
  return data.tracks;
}

export function getStreamUrlById(videoId) {
  return `${API_BASE}/youtube/stream?id=${encodeURIComponent(videoId)}`;
}

// ── Added: search, prefetch and failure diagnosis ─────────

function fetchWithTimeout(url, options = {}, ms = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...options, signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

export async function searchYouTube(query) {
  const res = await fetchWithTimeout(
    `${API_BASE}/youtube/search?q=${encodeURIComponent(query)}`,
    {},
    30000,
  );
  if (!res.ok) throw new Error('Search failed');
  const data = await res.json();
  return data.tracks || [];
}

// Fire and forget: asks the server to download a track before it is needed.
export function prefetchYouTubeTrack(videoId) {
  fetch(`${API_BASE}/youtube/prefetch?id=${encodeURIComponent(videoId)}`).catch(() => {});
}

// Called after a track fails to play. Returns one of:
// 'offline' | 'cookies' | 'unavailable' | 'timeout' | 'format' | 'unknown'
export async function diagnoseStream(videoId) {
  try {
    const health = await fetchWithTimeout(`${API_BASE}/health`, {}, 4000);
    if (!health.ok) return 'offline';
  } catch {
    return 'offline';
  }
  try {
    const res = await fetchWithTimeout(
      getStreamUrlById(videoId),
      { headers: { Range: 'bytes=0-0' } },
      30000,
    );
    if (res.ok) {
      if (res.body && res.body.cancel) res.body.cancel();
      return 'unknown'; // the server is fine, so the problem is on the device
    }
    const body = await res.json().catch(() => ({}));
    return body.reason || 'unknown';
  } catch {
    return 'timeout';
  }
}

// ── Added: status panel, search paging, single video lookup ──

// Status panel: quick info from the server. Returns null if it cannot be reached
// (a timeout, an ISP redirect page or any non-JSON answer all count as unreachable).
export async function fetchServerStatus(timeoutMs = 6000) {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/status`, { cache: 'no-store' }, timeoutMs);
    if (!res.ok) return null;
    const data = await res.json();
    return data && data.ok ? data : null;
  } catch {
    return null;
  }
}

// "Check now": the server runs a quick real yt-dlp test (takes a few seconds).
export async function runServerCheck(timeoutMs = 60000) {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/status/check`, { method: 'POST', cache: 'no-store' }, timeoutMs);
    if (!res.ok) return null;
    const data = await res.json();
    return data && data.ok ? data : null;
  } catch {
    return null;
  }
}

// Search with paging. offset 0 = first page; pass nextOffset back in for "more results".
// Returns { tracks, nextOffset, hasMore }.
export async function searchYouTubeMore(query, offset = 0) {
  let res;
  try {
    res = await fetchWithTimeout(
      `${API_BASE}/youtube/search?q=${encodeURIComponent(query)}&offset=${offset}`,
      {},
      60000,
    );
  } catch (err) {
    throw new Error(err && err.name === 'AbortError' ? 'search timed out' : "can't reach the server");
  }
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  if (!res.ok || !data) throw new Error((data && data.error) || 'search failed');
  return {
    tracks: data.tracks || [],
    nextOffset: typeof data.nextOffset === 'number' ? data.nextOffset : offset + 12,
    hasMore: !!data.hasMore,
  };
}

// A single pasted video link. Returns { videoId, title, artist, duration, art }.
export async function fetchYouTubeVideo(id) {
  let res;
  try {
    res = await fetchWithTimeout(`${API_BASE}/youtube/video?id=${encodeURIComponent(id)}`, {}, 30000);
  } catch (err) {
    throw new Error(err && err.name === 'AbortError' ? 'timed out loading that video' : "can't reach the server");
  }
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  if (!res.ok || !data) throw new Error((data && data.error) || 'could not load that video');
  return data;
}