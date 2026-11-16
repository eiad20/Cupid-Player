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