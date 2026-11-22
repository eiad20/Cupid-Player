const KEY = 'cupid-last-track';

export function saveLastTrack(t) {
  try {
    if (!t) return;
    let data = null;
    if (t.videoId) {
      data = { videoId: t.videoId, title: t.title, artist: t.artist, art: t.art };
    } else if (t.file && typeof window !== 'undefined' && window.cupid) {
      data = { file: t.file }; // Electron local files only
    }
    if (data) localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // ignore
  }
}

export function loadLastTrack() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}