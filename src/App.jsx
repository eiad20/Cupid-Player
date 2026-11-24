import { useCallback, useRef, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Capacitor } from '@capacitor/core';
import useServerStatus from './services/useServerStatus';
import './App.css';
import useAudioPlayer from './useAudioPlayer';
import { saveLastTrack, loadLastTrack } from './lastTrack';
import { normalizePlaylistUrl, readSavedPlaylists, writeSavedPlaylists } from './savedPlaylists';

import useTheme from './useTheme';
import {
  login as youtubeLogin,
  logout as youtubeLogout,
  isLoggedIn as isYouTubeLoggedIn,
  isConfigured as isYouTubeConfigured,
} from './youtube/auth.js';
import {
  parsePlaylistUrl as parseYouTubePlaylistUrl,
  fetchMyPlaylists as fetchYouTubePlaylists,
  fetchPlaylistTracks as fetchYouTubeTracks,
} from './youtube/api.js';

import {
  fetchYouTubePlaylist,
  getStreamUrlById,
  searchYouTubeMore,
  fetchYouTubeVideo,
  prefetchYouTubeTrack,
  diagnoseStream,
} from './services/youtubeService.js';
import { pickAndScanDeviceAudio } from './services/localMusicService.js';

import progressBarStars from '../assets/progress_bar_stars.png';
import star from '../assets/star.png';
import starSelected from '../assets/star_selected.png';
import searchIconPink from '../assets/pink/search.png';
import searchIconBlue from '../assets/blue/search.png';
import frame1 from '../assets/pink/frame.png';
import frameMobile1 from '../assets/pink/frame_mobile.png';

const pinkDesktopFrames = [frame1];
const pinkMobileFrames = [frameMobile1];

// Static window scenes: fixed original frame with transparent pane cutouts
// on top, swappable scene layer behind (clipped to the window region).
import frameMobileCutout from '../assets/pink/frame_mobile_cutout.png';
import frameTabletCutout from '../assets/pink/frame_tablet_cutout.png';
import frameMobileCutoutBlue from '../assets/blue/frame_mobile_cutout.png';
import frameTabletCutoutBlue from '../assets/blue/frame_tablet_cutout.png';
import sceneGardenPhone from '../assets/scenes/garden_phone.png';
import sceneCoastPhone from '../assets/scenes/coast_phone.png';
import sceneMountainsPhone from '../assets/scenes/mountains_phone.png';
import sceneGardenTablet from '../assets/scenes/garden_tablet.png';
import sceneCoastTablet from '../assets/scenes/coast_tablet.png';
import sceneMountainsTablet from '../assets/scenes/mountains_tablet.png';
import sceneCitySunsetCatPhone from '../assets/scenes/city_sunset_cat_phone.png';
import sceneCitySunsetCatTablet from '../assets/scenes/city_sunset_cat_tablet.png';
import sceneLakeCrescentDuskPhone from '../assets/scenes/lake_crescent_dusk_phone.png';
import sceneLakeCrescentDuskTablet from '../assets/scenes/lake_crescent_dusk_tablet.png';
import sceneMoonlitSeaPhone from '../assets/scenes/moonlit_sea_phone.gif';
import sceneMoonlitSeaTablet from '../assets/scenes/moonlit_sea_tablet.gif';
import sceneCrescentBeachPhone from '../assets/scenes/crescent_beach_phone.png';
import sceneCrescentBeachTablet from '../assets/scenes/crescent_beach_tablet.png';
import sceneCampfireForestPhone from '../assets/scenes/campfire_forest_phone.gif';
import sceneCampfireForestTablet from '../assets/scenes/campfire_forest_tablet.gif';
import sceneMoonBranchesPhone from '../assets/scenes/moon_branches_phone.png';
import sceneMoonBranchesTablet from '../assets/scenes/moon_branches_tablet.png';
import sceneCityMoonTallPhone from '../assets/scenes/city_moon_tall_phone.png';
import sceneCityMoonTallTablet from '../assets/scenes/city_moon_tall_tablet.png';
import sceneLighthouseDuskPhone from '../assets/scenes/lighthouse_dusk_phone.png';
import sceneLighthouseDuskTablet from '../assets/scenes/lighthouse_dusk_tablet.png';
const pinkWindowScenes = {
  phone: [sceneGardenPhone, sceneCoastPhone, sceneMountainsPhone,
    sceneCitySunsetCatPhone, sceneLakeCrescentDuskPhone, sceneMoonlitSeaPhone, sceneCrescentBeachPhone, sceneCampfireForestPhone],
  tablet: [sceneGardenTablet, sceneCoastTablet, sceneMountainsTablet,
    sceneCitySunsetCatTablet, sceneLakeCrescentDuskTablet, sceneMoonlitSeaTablet, sceneCrescentBeachTablet, sceneCampfireForestTablet],
};
const blueWindowScenes = {
  phone: [sceneMoonlitSeaPhone, sceneMoonBranchesPhone, sceneCoastPhone, sceneCityMoonTallPhone, sceneLighthouseDuskPhone, sceneCampfireForestPhone],
  tablet: [sceneMoonlitSeaTablet, sceneCoastTablet, sceneMoonBranchesTablet, sceneCityMoonTallTablet, sceneLighthouseDuskTablet, sceneCampfireForestTablet],
};

function SavedPlaylistButton({ playlist, disabled, onPlay, onRemove }) {
  const gesture = useRef({ timer: null, suppress: false, x: 0, y: 0 });
  const cancelTimer = () => { clearTimeout(gesture.current.timer); gesture.current.timer = null; };
  useEffect(() => () => clearTimeout(gesture.current.timer), []);
  return <button type="button" className="settings-theme-btn saved-playlist-tile"
    disabled={disabled} title={`${playlist.name} (hold to remove)`}
    aria-label={`${playlist.name}. Tap to play; hold or press Delete to remove.`}
    onPointerDown={(e) => {
      if (!e.isPrimary || e.button !== 0) return;
      cancelTimer();
      gesture.current = { timer: null, suppress: false, x: e.clientX, y: e.clientY };
      gesture.current.timer = setTimeout(() => {
        gesture.current.suppress = true;
        gesture.current.timer = null;
        onRemove();
      }, 650);
    }}
    onPointerMove={(e) => {
      if (Math.hypot(e.clientX - gesture.current.x, e.clientY - gesture.current.y) > 10) {
        cancelTimer(); gesture.current.suppress = true;
      }
    }}
    onPointerUp={cancelTimer}
    onPointerLeave={() => { if (gesture.current.timer) { cancelTimer(); gesture.current.suppress = true; } }}
    onPointerCancel={() => { cancelTimer(); gesture.current.suppress = true; }}
    onContextMenu={(e) => e.preventDefault()}
    onKeyDown={(e) => {
      if (e.key === 'Delete') { e.preventDefault(); cancelTimer(); onRemove(); }
    }}
    onClick={(e) => {
      if (gesture.current.suppress && e.detail !== 0) { e.preventDefault(); return; }
      onPlay();
    }}><span dir="auto">{playlist.name}</span></button>;
}

function RemovePlaylistDialog({ playlist, error, onClose, onConfirm }) {
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.querySelector('button')?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  return <div className="saved-playlist-backdrop">
    <div ref={ref} className="saved-playlist-dialog" role="dialog" aria-modal="true"
      aria-labelledby="remove-playlist-heading" onKeyDown={(e) => {
        if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
        if (e.key === 'Tab') {
          const buttons = ref.current.querySelectorAll('button');
          if (e.shiftKey && document.activeElement === buttons[0]) { e.preventDefault(); buttons[1].focus(); }
          else if (!e.shiftKey && document.activeElement === buttons[1]) { e.preventDefault(); buttons[0].focus(); }
        }
      }}>
      <h2 id="remove-playlist-heading">remove saved playlist?</h2>
      <p className="saved-playlist-remove-name" dir="auto">{playlist.name}</p>
      <p className="saved-playlist-hint">only removes this saved shortcut. youtube and current playback stay unchanged.</p>
      {error && <div className="settings-error" role="alert">{error}</div>}
      <div className="settings-theme-row">
        <button type="button" className="settings-theme-btn" onClick={onClose}>cancel</button>
        <button type="button" className="settings-theme-btn active" onClick={onConfirm}>remove</button>
      </div>
    </div>
  </div>;
}

function SavedPlaylistDialog({ onClose, onSave }) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const dialogRef = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    dialogRef.current?.querySelector('input')?.focus();
    return () => previous?.focus?.();
  }, []);
  const save = () => {
    if (!name.trim()) { setError('Give your playlist a name'); return; }
    const normalized = normalizePlaylistUrl(url);
    if (!normalized) { setError('Paste a valid YouTube playlist link'); return; }
    try { onSave(name.trim(), normalized); }
    catch { setError('Could not save on this device. Free some space and try again.'); }
  };
  return (
    <div className="saved-playlist-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="saved-playlist-dialog" ref={dialogRef} role="dialog" aria-modal="true"
        aria-labelledby="saved-playlist-heading" onKeyDown={(e) => {
          if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
          if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); save(); }
          if (e.key === 'Tab') {
            const fields = dialogRef.current.querySelectorAll('input, button');
            const first = fields[0], last = fields[fields.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
          }
        }}>
        <h2 id="saved-playlist-heading">save playlist</h2>
        <label htmlFor="saved-playlist-name">playlist name</label>
        <input id="saved-playlist-name" className="settings-input" value={name} maxLength={60}
          dir="auto" autoComplete="off" onChange={(e) => { setName(e.target.value); setError(''); }} />
        <label htmlFor="saved-playlist-url">youtube playlist link</label>
        <input id="saved-playlist-url" className="settings-input" type="url" value={url}
          placeholder="https://www.youtube.com/playlist?list=..." autoCapitalize="none" autoCorrect="off"
          spellCheck={false} autoComplete="off" dir="ltr"
          onChange={(e) => { setUrl(e.target.value); setError(''); }} />
        <p className="saved-playlist-hint">saved on this device. internet needed to play.</p>
        {error && <div className="settings-error" role="alert">{error}</div>}
        <div className="settings-theme-row">
          <button type="button" className="settings-theme-btn" onClick={onClose}>cancel</button>
          <button type="button" className="settings-theme-btn active" onClick={save}>save</button>
        </div>
      </div>
    </div>
  );
}

function useResize(corner) {
  const onMouseDown = useCallback((e) => {
    e.preventDefault();
    let lastX = e.screenX;
    let lastY = e.screenY;

    const onMouseMove = (e) => {
      const dx = e.screenX - lastX;
      const dy = e.screenY - lastY;
      lastX = e.screenX;
      lastY = e.screenY;
      window.cupid?.resize({ dx, dy, corner });
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [corner]);

  return onMouseDown;
}

function formatTime(seconds) {
  if (!seconds || !isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function SettingsDropdown({ value, options, onChange }) {
  const [open, setOpen] = useState(false);
  const [menuRect, setMenuRect] = useState(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return;

    const updateRect = () => {
      const r = triggerRef.current?.getBoundingClientRect();
      if (r) setMenuRect({ top: r.bottom, left: r.left, width: r.width });
    };
    updateRect();

    const onMouseDown = (e) => {
      if (!triggerRef.current?.contains(e.target) && !menuRef.current?.contains(e.target)) {
        setOpen(false);
      }
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', updateRect);
    window.addEventListener('scroll', () => setOpen(false), true);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', updateRect);
    };
  }, [open]);

  const current = options.find((o) => o.value === value);

  return (
    <div className={`settings-dropdown ${open ? 'open' : ''}`}>
      <button
        ref={triggerRef}
        type="button"
        className="settings-dropdown-trigger"
        onClick={() => setOpen((v) => !v)}
      >
        <span>{current?.label ?? value}</span>
        <span className="settings-dropdown-chevron" aria-hidden="true">▾</span>
      </button>
      {open && menuRect && createPortal(
        <div
          ref={menuRef}
          className="settings-dropdown-menu"
          role="listbox"
          style={{
            position: 'fixed',
            top: `${menuRect.top + 2}px`,
            left: `${menuRect.left}px`,
            width: `${menuRect.width}px`,
          }}
        >
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={o.value === value}
              className={`settings-dropdown-item ${o.value === value ? 'active' : ''}`}
              onClick={() => { onChange(o.value); setOpen(false); }}
            >
              {o.label}
            </button>
          ))}
        </div>,
        document.querySelector('.player') ?? document.body,
      )}
    </div>
  );
}

function PlaylistList({ loading, playlists, loadingPlaylist, onSelect, emptyMessage = 'no playlists found' }) {
  return (
    <div className="settings-playlist-list">
      {loading ? (
        <div className="settings-label">loading...</div>
      ) : playlists.length === 0 ? (
        <div className="settings-label">{emptyMessage}</div>
      ) : (
        playlists.map((p) => (
          <button
            key={p.id}
            className={`settings-playlist-item ${loadingPlaylist ? 'disabled' : ''}`}
            onClick={() => onSelect(p.id)}
            disabled={loadingPlaylist}
          >
            {p.name}
          </button>
        ))
      )}
    </div>
  );
}

function MarqueeText({ className, text }) {
  const outerRef = useRef(null);
  const textRef = useRef(null);
  const [shouldScroll, setShouldScroll] = useState(false);

  useEffect(() => {
    const outer = outerRef.current;
    const textEl = textRef.current;
    if (!outer || !textEl) return;
    setShouldScroll(textEl.offsetWidth > outer.clientWidth);
  }, [text]);

  return (
    <div className={`${className} marquee-container`} ref={outerRef}>
      <span ref={textRef} className="marquee-measure">{text}</span>
      <span className={shouldScroll ? 'marquee-scroll' : ''}>
        {text}
        {shouldScroll && <span className="marquee-gap">{text}</span>}
      </span>
    </div>
  );
}

// Give YouTube tracks a playable url via the companion server (host lives in youtubeService.js)
const withStreamUrl = (t) => ({
  ...t,
  url: t.url || (t.videoId ? getStreamUrlById(t.videoId) : undefined),
});

// Search button icon: a PNG per theme (assets/pink/search.png, assets/blue/search.png)
function SearchIcon({ src }) {
  return (
    <div className="search-icon-layer" aria-hidden="true">
      <img
        src={src}
        alt=""
        draggable={false}
        style={{ width: '100%', height: '100%', display: 'block', objectFit: 'contain', imageRendering: 'auto' }}
      />
    </div>
  );
}

// What the little status bubble says for each kind of playback failure
const FAILURE_MESSAGES = {
  offline: "can't reach the server",
  cookies: 'server needs fresh cookies',
  unavailable: 'track unavailable, skipping',
  timeout: 'download timed out, skipping',
  format: 'no audio for this track, skipping',
  unknown: 'could not play this track, skipping',
};

// Same reasons without the "skipping" part, for the Status panel
const reasonText = (reason) =>
  reason === 'cookies'
    ? 'cookies expired'
    : (FAILURE_MESSAGES[reason] || FAILURE_MESSAGES.unknown).replace(', skipping', '');

const STATUS_SHORT = { checking: '...', good: 'good', offline: 'offline', cookies: 'cookies expired', problem: 'problem' };
const COOKIE_TEXT = { ok: 'ok', expired: 'expired', unknown: 'not tested yet', missing: 'no file' };

function statusHeadline(summary, info) {
  switch (summary) {
    case 'good': return 'all good';
    case 'offline': return "can't reach the server";
    case 'cookies': return 'cookies expired. re-export cookies.txt on the server, then tap check now';
    case 'problem': return `last download failed: ${reasonText(info.lastFailure.reason)}`;
    default: return 'checking...';
  }
}

function fmtAgo(seconds) {
  if (seconds === null || seconds === undefined) return 'none yet';
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  return `${Math.floor(seconds / 86400)} d ago`;
}

// Adds the thumbnail and the playable url to a track from the server
const prepareTrack = (t) => withStreamUrl({
  ...t,
  art: t.art || (t.videoId ? `https://i.ytimg.com/vi/${t.videoId}/mqdefault.jpg` : null),
});

// Recognises a pasted YouTube link. Returns { type: 'playlist', url } or { type: 'video', id } or null.
function parseYouTubeLink(input) {
  let u;
  try { u = new URL(input.trim()); } catch { return null; }
  const host = u.hostname.replace(/^(www|m|music)\./, '');
  if (host !== 'youtube.com' && host !== 'youtu.be') return null;

  let id = null;
  if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
  else if (u.pathname === '/watch') id = u.searchParams.get('v');
  else {
    const m = u.pathname.match(/^\/(?:shorts|embed|live)\/([^/?]+)/);
    if (m) id = m[1];
  }
  if (id && !/^[A-Za-z0-9_-]{11}$/.test(id)) id = null;

  const list = u.searchParams.get('list');
  // Real playlists load as a playlist. "Mix" lists (RD...) never end, so a video link wins over those.
  const realList = list && /^(PL|OLAK|UU|FL)[A-Za-z0-9_-]+$/.test(list);
  if (list && (realList || !id) && /^[A-Za-z0-9_-]{10,64}$/.test(list)) {
    return { type: 'playlist', url: `https://www.youtube.com/playlist?list=${list}` };
  }
  if (id) return { type: 'video', id };
  return null;
}

export default function App() {
  const isNative = Capacitor.isNativePlatform();
  const {
    info: statusInfo,
    summary: statusSummary,
    refresh: refreshStatus,
    check: runStatusCheck,
    checking: statusChecking,
    checkResult,
  } = useServerStatus();
// Determine if the screen is a tall phone ratio (taller than ~16:10 / 5:3)
const [isPhoneScreen, setIsPhoneScreen] = useState(() => {
  if (typeof window === 'undefined') return false;
  const ratio = window.innerHeight / window.innerWidth;
  // Phones in portrait typically have an aspect ratio > 1.75 (18:9, 19.5:9, 20:9)
  // Tablets in portrait are usually wider (4:3 is 1.33, 16:10 is 1.6)
  return ratio > 1.7;
});

useEffect(() => {
  const checkRatio = () => {
    const ratio = window.innerHeight / window.innerWidth;
    setIsPhoneScreen(ratio > 1.7);
  };
  window.addEventListener('resize', checkRatio);
  return () => window.removeEventListener('resize', checkRatio);
}, []);

// Only activate the tall layout on phones, not tablets
const isMobile = isNative && isPhoneScreen;
// Native tablet: desktop-style layout, but we may still swap its window scene
const isTablet = isNative && !isPhoneScreen;
// Select a random frame index (0 to 3) once when the app first loads
const [frameIndex] = useState(() => Math.floor(Math.random() * pinkDesktopFrames.length));

  // ── Window scene (pink theme, native phone/tablet) ──────
  // Tap the window to cycle through the active device scene list.
  const [sceneIndex, setSceneIndex] = useState(() => {
    try {
      const saved = Number(localStorage.getItem('cupid-window-scene') || '0');
      return Number.isSafeInteger(saved) && saved >= 0 ? saved : 0;
    } catch { return 0; }
  });
  const cycleWindowScene = () => {
    setSceneIndex((i) => {
      const next = (i + 1) % activeWindowScenes.length;
      try { localStorage.setItem('cupid-window-scene', String(next)); } catch {}
      return next;
    });
  };

  // ── Source state ─────────────────────────────────────────
  const [source, setSource] = useState('local'); // 'local' | 'streaming'
  const [youtubeConnected, setYoutubeConnected] = useState(isYouTubeLoggedIn());
  const [youtubeLoggingIn, setYoutubeLoggingIn] = useState(false);
  const [youtubeUrlInput, setYoutubeUrlInput] = useState('');
  const [savedPlaylists, setSavedPlaylists] = useState(readSavedPlaylists);
  const [showSavePlaylist, setShowSavePlaylist] = useState(false);
  const [playlistToDelete, setPlaylistToDelete] = useState(null);
  const [deleteError, setDeleteError] = useState('');
  const [playlistToPlay, setPlaylistToPlay] = useState(null);
  const playlistLoadingRef = useRef(false);
  const [streamTracks, setStreamTracks] = useState([]);
  const [youtubePlaylists, setYoutubePlaylists] = useState([]);
  const [loadingPlaylists, setLoadingPlaylists] = useState(false);
  const [loadingPlaylist, setLoadingPlaylist] = useState(false);
  const [settingsError, setSettingsError] = useState(null);
  const [showTracklist, setShowTracklist] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [searching, setSearching] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const [searchMore, setSearchMore] = useState(null); // { q, offset } while "more results" is available
  const [loadingMore, setLoadingMore] = useState(false);
  const [showStatus, setShowStatus] = useState(false);
  const [toast, setToast] = useState(null);
  const toastTimerRef = useRef(null);
  const failStreakRef = useRef(0);
  const restoredRef = useRef(null);       // videoId restored at launch, until something plays
  const localRestoredRef = useRef(false); // local restore runs once
  const playerApiRef = useRef({});
  const [musicService, setMusicService] = useState(() => {
  try {
    const stored = localStorage.getItem('cupid-player-music-service');
    if (stored === 'youtube' || stored === 'local') return stored;
  } catch {
    // ignore
  }
  return 'local';
});
  const [playMode, setPlayMode] = useState('normal'); // 'normal' | 'shuffle' | 'repeat'
  const [volumeHovered, setVolumeHovered] = useState(false);
  const [volumeDragging, setVolumeDragging] = useState(false);
  const volumeBarRef = useRef(null);
  const [showDebug] = useState(false);
  const [localTracks, setLocalTracks] = useState([]);
  // --- Add the hearts state and click handler here ---
  const [hearts, setHearts] = useState([]);

const handleCatClick = (e) => {
    const id = Date.now();
    
    const catLeft = e.target.offsetLeft;
    const catTop = e.target.offsetTop;
    const catWidth = e.target.offsetWidth;
    const catHeight = e.target.offsetHeight; // Grab the height

    const offsetX = Math.floor(Math.random() * 20) - 10;
    
    const x = catLeft + (catWidth / 2) + offsetX;
    
    // If on mobile, push the start position down by 30% of the cat's height
    const y = isMobile ? catTop + (catHeight * 0.3) : catTop;

    setHearts((prev) => [...prev, { id, x, y }]);

    setTimeout(() => {
      setHearts((prev) => prev.filter((heart) => heart.id !== id));
    }, 1000);
  };

  const loadLocalPlaylist = useCallback(async () => {
    if (window.cupid?.getLocalPlaylist) {
      try {
        const tracks = await window.cupid.getLocalPlaylist();
        setLocalTracks(Array.isArray(tracks) ? tracks : []);
      } catch (err) {
        console.error('Failed to load local playlist:', err);
      }
    }
  }, []);

  const handlePickDeviceMusic = async () => {
    try {
      setSettingsError(null);
      const picked = await pickAndScanDeviceAudio();
      if (picked.length > 0) {
        setLocalTracks(picked);
        setSource('local');
        setShowSettings(false);
      }
    } catch (err) {
      setSettingsError(err.message || 'Failed to access device files');
    }
  };

  useEffect(() => { loadLocalPlaylist(); }, [loadLocalPlaylist]);

// Wrap the resolver in useCallback to prevent infinite re-renders
  const resolveLocalPath = useCallback((t) => {
    if (window.cupid?.getLocalAudioPath) {
      return window.cupid.getLocalAudioPath(t.file);
    }
    return t.url;
  }, []);

  // One player, always fed the list that is currently active (local or streaming)
  const activeTracks = source === 'streaming' ? streamTracks : localTracks;

  // ── Status bubble + failure handling ───────────────────
  const showToast = useCallback((text, ms = 3500) => {
    clearTimeout(toastTimerRef.current);
    setToast(text);
    if (ms) toastTimerRef.current = setTimeout(() => setToast(null), ms);
  }, []);

  const handleTrackError = useCallback(async (failedTrack) => {
    // The remembered song could not load at launch (offline, removed...). Drop it quietly.
    if (restoredRef.current && failedTrack && failedTrack.videoId === restoredRef.current) {
      restoredRef.current = null;
      setStreamTracks([]);
      setSource('local');
      return;
    }
    const { next: skipNext, pause: stopPlayback } = playerApiRef.current;
    failStreakRef.current += 1;

    const reason = failedTrack && failedTrack.videoId
      ? await diagnoseStream(failedTrack.videoId)
      : 'unknown';

    // Skipping cannot fix these, so stop and say why.
    if (reason === 'offline' || reason === 'cookies') {
      showToast(FAILURE_MESSAGES[reason], 6000);
      failStreakRef.current = 0;
      if (stopPlayback) stopPlayback();
      return;
    }
    // Three bad tracks in a row: stop instead of hammering the server.
    if (failStreakRef.current >= 3) {
      showToast('several tracks failed in a row, stopping', 6000);
      failStreakRef.current = 0;
      if (stopPlayback) stopPlayback();
      return;
    }
    showToast(FAILURE_MESSAGES[reason] || FAILURE_MESSAGES.unknown, 2500);
    setTimeout(() => { if (skipNext) skipNext(); }, 1800);
  }, [showToast]);

  const player = useAudioPlayer(activeTracks, playMode, resolveLocalPath, {
    onError: handleTrackError,
    onPlaying: () => {
      failStreakRef.current = 0;
      restoredRef.current = null;
      saveLastTrack(playerApiRef.current.track);
    },
    onPrefetch: (t) => { if (t && t.videoId) prefetchYouTubeTrack(t.videoId); },
  });

  const {
    track,
    isPlaying,
    progress,
    duration,
    currentTime,
    togglePlay,
    next,
    prev,
    seek,
    volume,
    setVolume,
    muted,
    toggleMute,
    jumpTo,
    loading,
    pause,
    audioRef,
    selectTrack,
  } = player;
  playerApiRef.current = { next, pause, track, selectTrack };

  // ── Restore the last song (paused, from 0:00) ──────────
  useEffect(() => {
    const saved = loadLastTrack();
    if (!saved || !saved.videoId) return;
    restoredRef.current = saved.videoId;
    setStreamTracks([prepareTrack(saved)]);
    setSource('streaming');
    setMusicService('youtube');
  }, []);

  // Electron: pick the saved local file once the playlist has loaded
  useEffect(() => {
    if (localRestoredRef.current || localTracks.length === 0) return;
    localRestoredRef.current = true;
    const saved = loadLastTrack();
    if (!saved || !saved.file || source !== 'local') return;
    const idx = localTracks.findIndex((t) => t.file === saved.file);
    if (idx >= 0) selectTrack(idx);
  }, [localTracks, source, selectTrack]);

  // "fetching track..." bubble while the server downloads a track for the first time
  useEffect(() => {
    if (!loading || source !== 'streaming') return undefined;
    // Restored at launch and still paused: load quietly, no bubble
    if (!isPlaying && restoredRef.current && track.videoId === restoredRef.current) return undefined;
    const timer = setTimeout(() => showToast('fetching track...', 0), 1500);
    return () => {
      clearTimeout(timer);
      setToast((cur) => (cur === 'fetching track...' ? null : cur));
    };
  }, [loading, source, track.title, isPlaying, showToast]);

  // ── Search YouTube (or open a pasted YouTube link) ─────
  const searchYoutubeTracks = useCallback(async (query) => {
    const q = query.trim();
    if (!q) return;
    setSearchError(null);
    setSearching(true);
    try {
      const link = parseYouTubeLink(q);
      let rawTracks;
      let more = null;
      if (link && link.type === 'playlist') {
        rawTracks = await fetchYouTubePlaylist(link.url);
        if (!Array.isArray(rawTracks) || rawTracks.length === 0) {
          setSearchError('playlist is empty or private');
          return;
        }
      } else if (link) {
        rawTracks = [await fetchYouTubeVideo(link.id)];
      } else {
        const page = await searchYouTubeMore(q, 0);
        if (page.tracks.length === 0) {
          setSearchError('no results');
          return;
        }
        rawTracks = page.tracks;
        if (page.hasMore) more = { q, offset: page.nextOffset };
      }
      setStreamTracks(rawTracks.map(prepareTrack));
      setSearchMore(more);
      setSource('streaming');
      setSearchInput('');
      setShowSearch(false);
      setShowTracklist(true);
      setMusicService('youtube');
      try { localStorage.setItem('cupid-player-music-service', 'youtube'); } catch { /* ignore */ }
    } catch (err) {
      setSearchError(err.message || 'search failed');
    } finally {
      setSearching(false);
    }
  }, []);

  // "more results" button at the bottom of the queue
  const loadMoreResults = useCallback(async () => {
    if (!searchMore || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await searchYouTubeMore(searchMore.q, searchMore.offset);
      setStreamTracks((cur) => {
        const seen = new Set(cur.map((t) => t.videoId));
        return [...cur, ...page.tracks.filter((t) => !seen.has(t.videoId)).map(prepareTrack)];
      });
      setSearchMore(page.hasMore ? { q: searchMore.q, offset: page.nextOffset } : null);
    } catch (err) {
      showToast(err.message || 'could not load more', 3000);
    } finally {
      setLoadingMore(false);
    }
  }, [searchMore, loadingMore, showToast]);

  const cyclePlayMode = useCallback(() => {
    setPlayMode((m) => m === 'normal' ? 'shuffle' : m === 'shuffle' ? 'repeat' : 'normal');
  }, []);

  // ── Fetch YouTube playlists ────────────────────────────
  const loadYoutubePlaylists = useCallback((silent = false) => {
    setLoadingPlaylists(true);
    if (!silent) setSettingsError(null);
    fetchYouTubePlaylists()
      .then((p) => { setYoutubePlaylists(p); setSettingsError(null); })
      .catch((err) => { if (!silent) setSettingsError(err.message); })
      .finally(() => setLoadingPlaylists(false));
  }, []);

  // Saving is local and does not need the server. Selecting a saved tile fetches
  // the current playlist contents, then starts its first track after React commits.
  useEffect(() => {
    if (playlistToPlay && activeTracks === playlistToPlay) {
      restoredRef.current = null;
      jumpTo(0);
      setPlaylistToPlay(null);
    }
  }, [playlistToPlay, activeTracks, jumpTo]);

  const savePlaylist = (name, url) => {
    const next = [...savedPlaylists, {
      id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name, url,
    }];
    writeSavedPlaylists(next);
    setSavedPlaylists(next);
    setShowSavePlaylist(false);
  };

  const deleteSavedPlaylist = () => {
    if (!playlistToDelete) return;
    const next = savedPlaylists.filter((p) => p.id !== playlistToDelete.id);
    try {
      writeSavedPlaylists(next);
      setSavedPlaylists(next);
      setPlaylistToDelete(null);
      setDeleteError('');
    } catch { setDeleteError('Could not remove on this device. Try again.'); }
    // Removing a shortcut never changes the current queue or playback.
  };

  // ── Load a playlist from a YouTube URL ─────────────────
  const loadYoutubePlaylistFromUrl = useCallback(async (rawInput, startPlayback = false) => {
    if (playlistLoadingRef.current) return;
    setSettingsError(null);
    const parsed = parseYouTubePlaylistUrl(rawInput);
    if (!parsed) {
      setSettingsError('Not a recognised YouTube playlist URL');
      return;
    }
    playlistLoadingRef.current = true;
    setLoadingPlaylist(true);
    try {
      const rawTracks = await fetchYouTubePlaylist(rawInput);
      if (!Array.isArray(rawTracks) || rawTracks.length === 0) {
        setSettingsError('Playlist is empty or private');
        return;
      }
      // The companion server only returns { videoId, title, artist, duration } —
      // no art field — so derive the thumbnail client-side when it's missing.
      const tracks = rawTracks.map((t) => withStreamUrl({
        ...t,
        art: t.art || (t.videoId ? `https://i.ytimg.com/vi/${t.videoId}/mqdefault.jpg` : null),
      }));
      setStreamTracks(tracks);
      setSource('streaming');
      setYoutubeUrlInput('');
      setSearchMore(null);
      if (startPlayback) {
        setMusicService('youtube');
        try { localStorage.setItem('cupid-player-music-service', 'youtube'); } catch { /* ignore */ }
        setPlaylistToPlay(tracks);
        setShowSettings(false);
      }
    } catch (err) {
      setSettingsError(err.message || 'Could not load playlist. Try again.');
    } finally {
      playlistLoadingRef.current = false;
      setLoadingPlaylist(false);
    }
  }, []);

 useEffect(() => {
  if (isYouTubeLoggedIn()) {
    loadYoutubePlaylists(true);
  }
}, [loadYoutubePlaylists]);

  // ── Load a playlist by ID ──────────────────────────────
  const loadPlaylist = useCallback(async (id) => {
    setLoadingPlaylist(true);
    setSettingsError(null);
    try {
      const tracks = await fetchYouTubeTracks(id);
      if (tracks.length === 0) {
        setSettingsError('Playlist is empty');
        return;
      }
      setStreamTracks(tracks.map(withStreamUrl));
      setSearchMore(null);
      setSource('streaming');
    } catch (err) {
      setSettingsError(err.message);
    } finally {
      setLoadingPlaylist(false);
    }
  }, []);

  const { theme, toggleTheme, assets } = useTheme();
  // Window scenes: each theme has its own list (pink: original 8, blue: 5 new).
  const themeWindowScenes = theme === 'blue' ? blueWindowScenes : pinkWindowScenes;
  const activeWindowScenes = isMobile
    ? themeWindowScenes.phone
    : themeWindowScenes.tablet;

  const [recordFrame, setRecordFrame] = useState(0);
  const [needleFrame, setNeedleFrame] = useState(0);
  const [isPink, setIsPink] = useState(theme === 'pink');
  const [swapping, setSwapping] = useState(false);
  const [needleLifted, setNeedleLifted] = useState(false);
  const [starHovered, setStarHovered] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [hoverProgress, setHoverProgress] = useState(null);
  const seekRef = useRef(null);
  const dragPctRef = useRef(null);

  useEffect(() => {
    if (!dragging) return;

    const onMove = (e) => {
      if (!seekRef.current) return;
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const rect = seekRef.current.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      setHoverProgress(pct);
      dragPctRef.current = pct;
    };

    const onEnd = () => {
      setDragging(false);
      setStarHovered(false);
      if (dragPctRef.current !== null) {
        seek(dragPctRef.current);
      }
      setHoverProgress(null);
      dragPctRef.current = null;
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('mouseup', onEnd);
    window.addEventListener('touchend', onEnd);
    window.addEventListener('touchcancel', onEnd);

    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('mouseup', onEnd);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onEnd);
    };
  }, [dragging, seek]);

  useEffect(() => {
    if (!volumeDragging) return;

    const onMove = (e) => {
      if (!volumeBarRef.current) return;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      const rect = volumeBarRef.current.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, 1 - (clientY - rect.top) / rect.height));
      setVolume(pct);
    };

    const onEnd = () => {
      setVolumeDragging(false);
      setVolumeHovered(false);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('mouseup', onEnd);
    window.addEventListener('touchend', onEnd);
    window.addEventListener('touchcancel', onEnd);

    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('mouseup', onEnd);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onEnd);
    };
  }, [volumeDragging, setVolume]);

  const [needleChangeFrame, setNeedleChangeFrame] = useState(0);
  const prevTrackRef = useRef(null);

  const currentFrames = isPink ? assets.recordFramesA : assets.recordFramesB;
  const incomingFrames = isPink ? assets.recordFramesB : assets.recordFramesA;

  // Spin animation while playing
  useEffect(() => {
    if (!isPlaying || swapping) return;
    const interval = setInterval(() => {
      setRecordFrame((f) => (f + 1) % currentFrames.length);
      setNeedleFrame((f) => (f + 1) % assets.needlePlayFrames.length);
    }, 400);
    return () => clearInterval(interval);
  }, [isPlaying, swapping, currentFrames.length, assets.needlePlayFrames.length]);

  // Detect song change and trigger record swap animation
  useEffect(() => {
    if (prevTrackRef.current === track.title) return;
    const wasInitialOrPlaceholder = prevTrackRef.current === null || prevTrackRef.current === 'No track';
    prevTrackRef.current = track.title;
    if (track.title === 'No track' || wasInitialOrPlaceholder || needleLifted) return;

    setNeedleLifted(true);
    setNeedleChangeFrame(0);

    setTimeout(() => setNeedleChangeFrame(1), 200);
    setTimeout(() => setSwapping(true), 400);

    setTimeout(() => {
      setIsPink((p) => !p);
      setRecordFrame(0);
      setSwapping(false);
    }, 1000);

    setTimeout(() => {
      setNeedleChangeFrame(0);
      setNeedleLifted(false);
      setNeedleFrame(0);
    }, 1100);
  }, [track.title, needleLifted]);

  const resizeTL = useResize('top-left');
  const resizeTR = useResize('top-right');
  const resizeBL = useResize('bottom-left');
  const resizeBR = useResize('bottom-right');
  // ── Analog Clock Angles ──────────────────────────────────
  const [clockAngles, setClockAngles] = useState(() => {
    const d = new Date();
    const s = d.getSeconds();
    const m = d.getMinutes() + s / 60;
    const h = (d.getHours() % 12) + m / 60;
    return {
      hour: h * 30,    
      minute: m * 6,   
      second: s * 6,   // 360 / 60 = 6 deg/second
    };
  });

  useEffect(() => {
    const updateHands = () => {
      const d = new Date();
      const s = d.getSeconds();
      const m = d.getMinutes() + s / 60;
      const h = (d.getHours() % 12) + m / 60;
      setClockAngles({
        hour: h * 30,
        minute: m * 6,
        second: s * 6,
      });
    };

    const timer = setInterval(updateHands, 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="player-viewport">
      <div className={`player ${theme === 'blue' ? 'theme-blue' : ''} ${isMobile ? 'mobile-layout' : ''}`}>
        
        {/* Static window scene behind the pane cutouts (pink and blue, native only) */}
        {(theme === 'pink' || theme === 'blue') && (isMobile || isTablet) && (
          <img
            src={activeWindowScenes[sceneIndex % activeWindowScenes.length]}
            className={`window-scene ${isMobile ? 'window-scene-phone' : 'window-scene-tablet'} ${theme === 'blue' ? 'window-scene-blue' : ''}`}
            alt=""
            draggable={false}
            onClick={cycleWindowScene}
            title="tap to change the view"
          />
        )}

        {/* Base frame */}
        <img
          src={theme === 'pink'
            ? (isMobile ? frameMobileCutout : (isTablet ? frameTabletCutout : pinkDesktopFrames[frameIndex]))
            : (isMobile
                ? frameMobileCutoutBlue
                : (isTablet ? frameTabletCutoutBlue : assets.frame))
          }
          className="layer mobile-frame"
          alt=""
          draggable={false}
        />

        {/* Ambient Lighting Overlay (Tints the room & turntable based on the window) */}
        {theme === 'pink' && (
          <div className={`layer lighting-overlay light-effect-${frameIndex + 1}`} />
        )}

       {/* Window title (hidden on native mobile/tablet devices) */}
       {!isNative && <div className="window-title">cupid player</div>}

        {/* Record player centered in frame */}
        <img src={assets.recordPlayer} className="record-player" alt="" draggable={false} />
        <img
          src={currentFrames[recordFrame]}
          className={`record-player ${swapping ? 'record-slide-out' : ''}`}
          alt=""
          draggable={false}
        />
        {swapping && (
          <img
            src={incomingFrames[0]}
            className="record-player record-slide-in"
            alt=""
            draggable={false}
          />
        )}
        <img
          src={needleLifted ? assets.needleChangeFrames[needleChangeFrame] : assets.needlePlayFrames[needleFrame]}
          className="record-player"
          alt=""
          draggable={false}
        />

        {/* Frame overlay - only render if not on pink theme */}
        {theme !== 'pink' && (
        <img 
          src={isMobile ? (assets.frameNoBgMobile || assets.frameNoBg) : assets.frameNoBg} 
          className="layer frame-overlay mobile-frame" 
          alt="" 
          draggable={false} 
        />
        )}

        {/* Decorative (Stays at the top) */}
        <img src={assets.plant} className="layer layer-ui plant-image" alt="" draggable={false} />
        {/* Analog Wall Clock */}
        {assets.clockFace && (
          <div className="wall-clock">
            {/* Clock Face / Body */}
            <img 
              src={assets.clockFace} 
              className="clock-face" 
              alt="Wall Clock" 
              draggable={false} 
            />
            {/* Hour Hand */}
            {assets.hourHand && (
              <img
                src={assets.hourHand}
                className="clock-hand clock-hour-hand"
                alt=""
                draggable={false}
                style={theme === 'blue' ? {
                  /* Blue hour hand: points RIGHT, pivot is the circular ring */
                  transformOrigin: '23.8% 50%',
                  transform: `translate(-23.8%, -50%) rotate(${clockAngles.hour - 90}deg)`
                } : {
                  /* Pink hour hand */
                  transformOrigin: '17.39% 45%',
                  transform: `translate(-17.39%, -45%) rotate(${clockAngles.hour - 90}deg)`
                }}
              />
            )}
            
            {/* Minute Hand */}
            {assets.minuteHand && (
              <img
                src={assets.minuteHand}
                className="clock-hand clock-minute-hand"
                alt=""
                draggable={false}
                style={theme === 'blue' ? {
                  /* Nudged slightly left (48%) and slightly up (66%) */
                  transformOrigin: '48% 66%',
                  transform: `translate(-48%, -66%) rotate(${clockAngles.minute}deg)`
                } : {
                  /* Pink minute hand */
                  transformOrigin: '17.39% 41.12%',
                  transform: `translate(-17.39%, -41.12%) rotate(${clockAngles.minute - 90}deg)`
                }}
              />
            )}

            {/* Second Hand (Pink only) */}
            {assets.secondHand && (
              <img
                src={assets.secondHand}
                className="clock-hand clock-second-hand"
                alt=""
                draggable={false}
                style={{
                  transformOrigin: '17.17% 50%',
                  transform: `translate(-17.17%, -50%) rotate(${clockAngles.second - 90}deg)`
                }}
              />
            )}
          </div>
        )}

        {/* The Cat & Floating Hearts */}
        {assets.cat && (
          <div 
            className="cat-container" 
            style={{ 
              position: 'absolute', 
              zIndex: theme === 'blue' ? 5 : 25 
            }}
          >
            <img 
              src={assets.cat} 
              className="cat-image" 
              alt="Cat" 
              draggable={false} 
              onClick={handleCatClick}
            />
            {/* Render the floating hearts */}
            {hearts.map((heart) => (
              <div 
                key={heart.id} 
                className="floating-heart"
                style={{
                  left: `${heart.x}px`,
                  top: `${heart.y}px`,
                  transform: 'translate(-50%, -50%)',
                  /* Behind turntable (z-index 10) in blue theme, high in pink */
                  zIndex: theme === 'blue' ? 8 : 9999,
                }}
              >
                ♥
              </div>
            ))}
          </div>
        )}

        {/* Progress bar layers */}
        <img src={assets.progressBar} className="layer layer-ui shift-down" alt="" draggable={false} />
        <img
          src={progressBarStars}
          className="layer layer-ui shift-down"
          alt=""
          draggable={false}
          style={{
            clipPath: `inset(0 ${(1 - (131 + (hoverProgress ?? progress) * 226 + 10) / 512) * 100}% 0 0)`,
          }}
        />
        <img
          src={starHovered ? starSelected : star}
          className={`layer layer-ui star-indicator shift-down ${starHovered ? 'star-hovered' : ''}`}
          alt=""
          draggable={false}
          style={{
            transform: `translate(calc(-3 / 306 * 100vw + ${(hoverProgress ?? progress) * (226 / 512) * 171.9}vw), calc(166 * var(--u)))`,
          }}
        />

        {/* Playback control visual layers */}
        <img src={assets.backwardsButton} className="layer layer-ui shift-down" alt="" draggable={false} />
        <img src={isPlaying ? assets.pauseButton : assets.playButton} className="layer layer-ui shift-down" alt="" draggable={false} />
        <img src={assets.forwardsButton} className="layer layer-ui shift-down" alt="" draggable={false} />

        {/* Volume/mute button layer */}
        <img
          src={muted ? assets.muteButton : assets.volumeButton}
          className="layer layer-ui shift-down"
          alt=""
          draggable={false}
          style={{ opacity: 0.8 }}
        />

        {/* Shuffle/repeat button layer */}
        <img
          src={playMode === 'repeat' ? assets.repeatButton : assets.shuffleButton}
          className="layer layer-ui shift-down"
          alt=""
          draggable={false}
          style={{ opacity: playMode === 'normal' ? 0.4 : 0.8 }}
        />

        {/* Window control layers (Desktop only) */}
        {!isNative && (
          <>
            <img src={assets.minimizerButton} className="layer layer-ui" alt="" draggable={false} />
            <img src={assets.windowButton} className="layer layer-ui" alt="" draggable={false} />
            <img src={assets.exitButton} className="layer layer-ui" alt="" draggable={false} />
          </>
        )}
        {/* Settings button layer */}
        <img src={assets.settings} className="layer layer-ui settings-layer" alt="" draggable={false} />

        {/* SVG clip-path for pixel-art album mask */}
        <svg width="0" height="0" style={{ position: 'absolute' }}>
          <defs>
            <clipPath id="album-mask" clipPathUnits="objectBoundingBox">
              <rect x="0.07317" y="0" width="0.85366" height="1" />
              <rect x="0.04878" y="0.02439" width="0.90244" height="0.95122" />
              <rect x="0.02439" y="0.04878" width="0.95122" height="0.90244" />
              <rect x="0" y="0.07317" width="1" height="0.85366" />
            </clipPath>
          </defs>
        </svg>

        {/* Album art */}
        {track.art && (
          <div className="album-mask">
            <img src={track.art} className="album-art" alt="" draggable={false} />
          </div>
        )}

        {/* Album frame overlay */}
        <img src={assets.albumFrame} className="layer album-frame-layer shift-down" alt="" draggable={false} />

        {/* Now playing section */}
        <div className="now-playing">
          <div className="track-info">
            <div className="now-playing-label">now playing...</div>
            <MarqueeText className="track-title" text={track.title} />
            <div className="track-artist">by {track.artist}</div>
          </div>
        </div>

        {/* Time display */}
        <div className="time-display">
          <span className="time-current">{formatTime(currentTime)}</span>
          <span className="time-remaining">{formatTime(duration - currentTime)}</span>
        </div>

        {/* Drag & Resize (Desktop only) */}
        {!isNative && (
          <>
            <div className="drag-region" />
            <div className="resize-handle top-left" onMouseDown={resizeTL} />
            <div className="resize-handle top-right" onMouseDown={resizeTR} />
            <div className="resize-handle bottom-left" onMouseDown={resizeBL} />
            <div className="resize-handle bottom-right" onMouseDown={resizeBR} />
          </>
        )}

        {/* Progress bar seek target */}
        <div
          className="progress-seek"
          ref={seekRef}
          onMouseEnter={() => setStarHovered(true)}
          onMouseLeave={() => { if (!dragging) { setStarHovered(false); } }}
          onMouseDown={(e) => {
            e.preventDefault();
            setDragging(true);
            const rect = e.currentTarget.getBoundingClientRect();
            const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            setHoverProgress(pct);
            dragPctRef.current = pct;
          }}
          onTouchStart={(e) => {
            setDragging(true);
            setStarHovered(true);
            const rect = e.currentTarget.getBoundingClientRect();
            const pct = Math.max(0, Math.min(1, (e.touches[0].clientX - rect.left) / rect.width));
            setHoverProgress(pct);
            dragPctRef.current = pct;
          }}
        />

        {/* Playback control click targets */}
        <div className="btn btn-prev" onClick={prev} />
        <div className="btn btn-play" onClick={togglePlay} />
        <div className="btn btn-next" onClick={next} />

        {/* Volume bar layers */}
        {(volumeHovered || volumeDragging) && (
          <>
            <img src={assets.volumeBarLow} className="layer layer-ui volume-bar-layer shift-down" alt="" draggable={false} />
            <img
              src={assets.volumeBarHigh}
              className="layer layer-ui volume-bar-layer shift-down"
              alt=""
              draggable={false}
              style={{
                clipPath: `inset(${((1 - (muted ? 0 : volume)) * (420 - 338) / 512 + 338 / 512) * 100}% 0 0 0)`,
              }}
            />
          </>
        )}

        {/* Volume icon */}
        <div
          className={`volume-hover-zone shift-down ${(volumeHovered || volumeDragging) ? 'expanded' : ''}`}
          onMouseLeave={() => { if (!volumeDragging) setVolumeHovered(false); }}
        >
          <div
            className="btn-volume-icon"
            onClick={toggleMute}
            onMouseEnter={() => setVolumeHovered(true)}
            onTouchStart={() => setVolumeHovered(true)}
          />
          {(volumeHovered || volumeDragging) && (
            <div
              className="volume-bar-area"
              ref={volumeBarRef}
              onMouseDown={(e) => {
                e.preventDefault();
                setVolumeDragging(true);
                const rect = e.currentTarget.getBoundingClientRect();
                const pct = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height));
                setVolume(pct);
              }}
              onTouchStart={(e) => {
                setVolumeDragging(true);
                const rect = e.currentTarget.getBoundingClientRect();
                const pct = Math.max(0, Math.min(1, 1 - (e.touches[0].clientY - rect.top) / rect.height));
                setVolume(pct);
              }}
            />
          )}
        </div>

        {/* Shuffle/repeat click target */}
        <div className="btn btn-playmode" onClick={cyclePlayMode} title={playMode} />

        {/* Window control click targets (Desktop only) */}
        {!isNative && (
          <>
            <div className="btn btn-minimize" onClick={() => window.cupid?.minimize()} />
            <div className="btn btn-window" onClick={() => window.cupid?.maximize()} />
            <div className="btn btn-exit" onClick={() => window.cupid?.close()} />
          </>
        )}

        {/* Settings button */}
        <div className="btn btn-settings" onClick={() => { setShowSettings((v) => !v); setShowSearch(false); setShowStatus(false); if (!showSettings) refreshStatus(); }} />

        {/* Search button, right of settings (tablet/phone only: desktop has the window controls there) */}
        {isNative && (
          <>
            <div
              className="btn btn-search"
              title="search"
              onClick={() => { setShowSearch((v) => !v); setShowSettings(false); setShowStatus(false); }}
            />
            <SearchIcon src={theme === 'blue' ? searchIconBlue : searchIconPink} />
          </>
        )}

        {/* Tracklist button */}
        <img
          src={assets.tracklistButton}
          className="layer layer-ui tracklist-button-layer"
          alt=""
          draggable={false}
        />
        <div className="btn btn-tracklist" onClick={() => setShowTracklist((v) => !v)} />

       {toast && <div className="cupid-toast">{toast}</div>}

        {/* Tracklist Panel */}
        {showTracklist && (
          <div className="tracklist-panel">
            <div className="tracklist-header">
              <span className="tracklist-title">queue</span>
              <button className="tracklist-close" onClick={() => setShowTracklist(false)}>✕</button>
            </div>
            <div className="tracklist-scroll">
              {activeTracks.length === 0 ? (
                <div className="tracklist-empty">playlist is empty...</div>
              ) : (
                activeTracks.map((t, index) => {
                  const isActive = track.title === t.title && track.artist === t.artist;
                  return (
                    <button
                      key={index}
                      className={`tracklist-item ${isActive ? 'active' : ''}`}
                      onClick={() => {
                        if (jumpTo) jumpTo(index);
                        setShowTracklist(false);
                      }}
                    >
                      <span className="tracklist-index">{index + 1}</span>
                      {t.art && <img src={t.art} className="tracklist-art" alt="" />}
                      <div className="tracklist-info">
                        <span className="tracklist-item-title">{t.title}</span>
                        {t.artist && <span className="tracklist-item-artist">{t.artist}</span>}
                      </div>
                      {isActive && <span className="tracklist-playing">♪</span>}
                    </button>
                  );
                })
              )}
              {source === 'streaming' && searchMore && activeTracks.length > 0 && (
                <button className="tracklist-more" onClick={loadMoreResults} disabled={loadingMore}>
                  {loadingMore ? 'loading...' : 'more results'}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Search Panel */}
        {showSearch && (
          <div className="settings-panel">
            <div className="settings-panel-inner">
              <div className="settings-label">search youtube</div>
              <input
                className="settings-input"
                type="text"
                placeholder="song, artist or link"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && searchInput.trim()) searchYoutubeTracks(searchInput);
                }}
                disabled={searching}
                autoFocus
              />
              <button
                className={`settings-theme-btn ${searching || !searchInput.trim() ? 'disabled' : ''}`}
                onClick={() => searchYoutubeTracks(searchInput)}
                disabled={searching || !searchInput.trim()}
              >
                {searching ? 'searching...' : 'search'}
              </button>
              {searchError && <div className="settings-error">{searchError}</div>}
            </div>
          </div>
        )}

        {/* Status Panel */}
        {showStatus && (
          <div className="settings-panel">
            <div className="settings-panel-inner">
              <div className="settings-label">status</div>
              <div className={`status-headline ${statusSummary}`}>{statusHeadline(statusSummary, statusInfo)}</div>
              {statusInfo && !statusInfo.unreachable && (
                <>
                  <div className="status-row"><span>cookies</span><span>{COOKIE_TEXT[statusInfo.cookies] || '?'}</span></div>
                  <div className="status-row"><span>yt-dlp</span><span>{statusInfo.ytdlp || '?'}</span></div>
                  <div className="status-row"><span>last download</span><span>{fmtAgo(statusInfo.lastOkAgo)}</span></div>
                </>
              )}
              {checkResult && (
                <div className={`status-note ${checkResult.ok ? 'good' : 'bad'}`}>
                  {checkResult.ok
                    ? `check passed (${(checkResult.ms / 1000).toFixed(1)}s)`
                    : `check failed: ${reasonText(checkResult.reason)}`}
                </div>
              )}
              <div className="settings-theme-row">
                <button
                  className={`settings-theme-btn ${statusChecking ? 'disabled' : ''}`}
                  disabled={statusChecking}
                  onClick={runStatusCheck}
                >
                  {statusChecking ? 'checking...' : 'check now'}
                </button>
                <button className="settings-theme-btn" onClick={() => setShowStatus(false)}>
                  close
                </button>
              </div>
            </div>
          </div>
        )}

        {showSavePlaylist && (
          <SavedPlaylistDialog onClose={() => setShowSavePlaylist(false)} onSave={savePlaylist} />
        )}

        {playlistToDelete && (
          <RemovePlaylistDialog playlist={playlistToDelete} error={deleteError}
            onClose={() => { setPlaylistToDelete(null); setDeleteError(''); }} onConfirm={deleteSavedPlaylist} />
        )}

        {/* Settings Panel */}
        {showSettings && (
          <div className="settings-panel">
            <div className="settings-panel-inner">
              <div className="settings-label">theme</div>
              <div className="settings-theme-row">
                <button
                  className={`settings-theme-btn ${theme === 'pink' ? 'active' : ''}`}
                  onClick={() => { if (theme !== 'pink') toggleTheme(); }}
                >
                  pink
                </button>
                <button
                  className={`settings-theme-btn ${theme === 'blue' ? 'active' : ''}`}
                  onClick={() => { if (theme !== 'blue') toggleTheme(); }}
                >
                  blue
                </button>
              </div>

              <div className="settings-label">saved playlists</div>
              <div className="saved-playlist-grid" aria-label="saved playlists">
                {savedPlaylists.map((playlist) => (
                  <SavedPlaylistButton key={playlist.id} playlist={playlist} disabled={loadingPlaylist}
                    onPlay={() => loadYoutubePlaylistFromUrl(playlist.url, true)}
                    onRemove={() => { setDeleteError(''); setPlaylistToDelete(playlist); }} />
                ))}
                <button type="button" className="settings-theme-btn saved-playlist-tile saved-playlist-add"
                  aria-label="add saved playlist" disabled={loadingPlaylist}
                  onClick={() => setShowSavePlaylist(true)}>
                  <span aria-hidden="true">+</span>
                </button>
              </div>
              {loadingPlaylist && <div className="settings-label" role="status">loading playlist...</div>}

              <div className="settings-label">music</div>
              <SettingsDropdown
                value={musicService}
                options={[
                  { value: 'local', label: 'local' },
                  { value: 'youtube', label: 'youtube' },
                ]}
                onChange={(next) => {
                  setMusicService(next);
                  try { localStorage.setItem('cupid-player-music-service', next); } catch { /* ignore */ }
                  if (next === 'local') setSource('local');
                }}
              />

              {musicService === 'local' && (
                <div className="settings-theme-row">
                  {isMobile ? (
                    <button className="settings-theme-btn" onClick={handlePickDeviceMusic}>
                      import device audio
                    </button>
                  ) : (
                    <button className="settings-theme-btn" onClick={loadLocalPlaylist}>
                      reload
                    </button>
                  )}
                </div>
              )}

              {musicService === 'youtube' && (
                isYouTubeConfigured() ? (
                  !youtubeConnected ? (
                    <button
                      className={`settings-theme-btn ${youtubeLoggingIn ? 'disabled' : ''}`}
                      disabled={youtubeLoggingIn}
                      onClick={async () => {
                        setYoutubeLoggingIn(true);
                        setSettingsError(null);
                        try {
                          await youtubeLogin();
                          setYoutubeConnected(true);
                          loadYoutubePlaylists();
                        } catch (err) {
                          setSettingsError(err.message);
                        } finally {
                          setYoutubeLoggingIn(false);
                        }
                      }}
                    >
                      {youtubeLoggingIn ? 'waiting for browser...' : 'log in with google'}
                    </button>
                  ) : (
                    <>
                      <PlaylistList
                        loading={loadingPlaylists}
                        playlists={youtubePlaylists}
                        loadingPlaylist={loadingPlaylist}
                        onSelect={(id) => loadPlaylist(id)}
                      />
                      <div className="settings-theme-row">
                        <button
                          className={`settings-theme-btn ${loadingPlaylists ? 'disabled' : ''}`}
                          disabled={loadingPlaylists}
                          onClick={() => loadYoutubePlaylists()}
                        >
                          refresh
                        </button>
                        <button className="settings-theme-btn" onClick={() => {
                          youtubeLogout();
                          setYoutubeConnected(false);
                          setYoutubePlaylists([]);
                          if (source === 'streaming') setSource('local');
                        }}>
                          logout
                        </button>
                      </div>
                    </>
                  )
                ) : (
                  <>
                    <input
                      className="settings-input"
                      type="text"
                      placeholder="paste a youtube playlist link"
                      value={youtubeUrlInput}
                      onChange={(e) => setYoutubeUrlInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && youtubeUrlInput.trim()) {
                          loadYoutubePlaylistFromUrl(youtubeUrlInput.trim());
                        }
                      }}
                      disabled={loadingPlaylist}
                    />
                    <button
                      className={`settings-theme-btn ${loadingPlaylist || !youtubeUrlInput.trim() ? 'disabled' : ''}`}
                      onClick={() => loadYoutubePlaylistFromUrl(youtubeUrlInput.trim())}
                      disabled={loadingPlaylist || !youtubeUrlInput.trim()}
                    >
                      {loadingPlaylist ? 'loading...' : 'load playlist'}
                    </button>
                  </>
                )
              )}

              {musicService === 'youtube' && (
                <button
                  className="settings-status-row"
                  onClick={() => { setShowSettings(false); setShowStatus(true); refreshStatus(); }}
                >
                  <span>status:</span>
                  <span className={`settings-status-value ${statusSummary}`}>{STATUS_SHORT[statusSummary]}</span>
                </button>
              )}

              {settingsError && <div className="settings-error">{settingsError}</div>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}