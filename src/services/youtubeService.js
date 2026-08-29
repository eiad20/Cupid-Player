const API_BASE = 'http://192.168.1.34:3000/api'; // Use 10.0.2.2 for emulator, or 192.168.1.34 for tablet

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