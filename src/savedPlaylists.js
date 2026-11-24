const STORAGE_KEY = 'cupid-saved-youtube-playlists';

// Keep only YouTube playlist identifiers, never arbitrary remote URLs.
export function normalizePlaylistUrl(input) {
  const text = String(input || '').trim();
  let id = text;
  try {
    const url = new URL(text);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (!['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'].includes(host)
      || !['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    id = url.searchParams.get('list') || '';
  } catch {
    // Bare playlist IDs are also accepted by the existing player.
  }
  if (!/^(PL|LL|FL|RD|UU|UL|OL)[A-Za-z0-9_-]{11,}$/.test(id)) return null;
  return `https://www.youtube.com/playlist?list=${encodeURIComponent(id)}`;
}

export function readSavedPlaylists() {
  // Missing or damaged data must not prevent the player from opening.
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    if (!Array.isArray(value)) return [];
    return value.filter((p) => p && typeof p.id === 'string'
      && typeof p.name === 'string' && p.name.trim()
      && typeof p.url === 'string' && normalizePlaylistUrl(p.url))
      .map((p) => ({ id: p.id, name: p.name.trim().slice(0, 60), url: normalizePlaylistUrl(p.url) }));
  } catch { return []; }
}

export function writeSavedPlaylists(playlists) {
  // Let the UI report a failed write. Never pretend an unsaved tile is saved.
  localStorage.setItem(STORAGE_KEY, JSON.stringify(playlists));
}
