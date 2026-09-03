const API_BASE = 'http://13.63.196.240:3000/api';

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