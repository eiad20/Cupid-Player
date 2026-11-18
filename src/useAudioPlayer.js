import { useState, useRef, useEffect, useCallback } from 'react';
import { MediaSession } from '@capgo/capacitor-media-session';

// options (all optional):
//   onError(track, mediaErrorCode)  called when the current track fails to load or play
//   onPlaying()                     called whenever playback actually starts
//   onPrefetch(track)               called once per track with the track that will play next
export default function useAudioPlayer(tracks, playMode = 'normal', getAudioPath, options = {}) {
  const audioRef = useRef(null);
  if (!audioRef.current) {
    audioRef.current = new Audio();
    audioRef.current.preload = 'auto';
  }

  const optionsRef = useRef(options);
  optionsRef.current = options;
  const tracksRef = useRef(tracks);
  tracksRef.current = tracks;
  const playModeRef = useRef(playMode);
  playModeRef.current = playMode;

  const [trackIndex, setTrackIndex] = useState(0);
  const trackIndexRef = useRef(0);
  trackIndexRef.current = trackIndex;

  // Identity of a track's audio, so we can tell "same list with more songs added"
  // from "a different list was loaded".
  const trackKey = (t) => (t ? (t.url || t.file || '') : '');

  const prevTracksRef = useRef(tracks);
  if (prevTracksRef.current !== tracks) {
    const sameQueue = trackKey(prevTracksRef.current[0]) === trackKey(tracks[0]);
    prevTracksRef.current = tracks;
    // A different list starts from its first song; adding results to the same list keeps the position.
    if (trackIndex >= tracks.length || !sameQueue) setTrackIndex(0);
  }

  const [isPlaying, setIsPlaying] = useState(false);
  const isPlayingRef = useRef(false);
  isPlayingRef.current = isPlaying;
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolumeState] = useState(() => {
    const saved = localStorage.getItem('cupid-volume');
    return saved !== null ? parseFloat(saved) : 1;
  });
  const [muted, setMuted] = useState(false);

  const track = tracks[trackIndex] ?? { title: 'No track', artist: '', file: '', art: null };
  const audio = audioRef.current;
  audio.volume = muted ? 0 : volume;

  // The src we assigned most recently. Used to ignore the error the browser raises
  // when we clear src, and stale errors from a track we already moved on from.
  const currentTrackKey = trackKey(tracks[trackIndex]);
  const currentSrcRef = useRef(null);
  const prefetchedSrcRef = useRef(null);

  // Index that plays after `from`. In shuffle mode the pick is remembered so that
  // prefetching and the real "next" agree on the same song.
  const plannedRef = useRef({ from: -1, to: -1 });
  const computeNext = useCallback((from) => {
    const len = tracksRef.current.length;
    if (len === 0) return 0;
    if (playModeRef.current === 'shuffle' && len > 1) {
      if (plannedRef.current.from === from && plannedRef.current.to < len) {
        return plannedRef.current.to;
      }
      let n;
      do { n = Math.floor(Math.random() * len); } while (n === from);
      plannedRef.current = { from, to: n };
      return n;
    }
    return (from + 1) % len;
  }, []);

  const prefetchNext = useCallback(() => {
    const list = tracksRef.current;
    if (list.length < 2 || playModeRef.current === 'repeat') return;
    const upcoming = list[computeNext(trackIndexRef.current)];
    if (upcoming && optionsRef.current.onPrefetch) optionsRef.current.onPrefetch(upcoming);
  }, [computeNext]);

  useEffect(() => {
    const t = tracks[trackIndex];
    // Allow either t.file (Electron) or t.url (Capacitor)
    if (!t || !(t.file || t.url)) return;

    let cancelled = false;
    audio.pause();
    audio.src = '';

    (async () => {
      // Prioritize the pre-converted Capacitor URL if it exists
      let src = t.url || t.file;

      // If it's a web stream, blob, or a native Android file path from Capacitor
      if (
        src.startsWith('http://') ||
        src.startsWith('https://') ||
        src.startsWith('blob:') ||
        src.startsWith('data:') ||
        src.startsWith('content://') ||
        src.includes('_capacitor_file_') ||
        src.startsWith('capacitor://')
      ) {
        // Keep as-is
      } else if (getAudioPath) {
        src = await getAudioPath(t.file);
      } else {
        src = `./${t.file}`;
      }

      if (cancelled || !src) return;

      // Enable CORS for remote streams so Web Audio API AnalyserNode can read frequency data
      if (
        (src.startsWith('http://') || src.startsWith('https://')) &&
        !src.includes('_capacitor_file_')
      ) {
        audio.crossOrigin = 'anonymous';
      } else {
        audio.removeAttribute('crossorigin');
      }

      audio.src = src;
      currentSrcRef.current = audio.getAttribute('src');
      audio.load();
      setLoading(true);
      setProgress(0);
      setCurrentTime(0);
      setDuration(0);
      if (isPlayingRef.current) {
        audio.play().catch(() => {});
      }
    })();

    return () => { cancelled = true; };
    // Depends on the current song, not the whole list, so appending "more results"
    // does not restart what is playing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackIndex, currentTrackKey, getAudioPath]);

  useEffect(() => {
    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
      if (audio.duration) {
        setProgress(audio.currentTime / audio.duration);
        if (isFinite(audio.duration) && audio.duration > 0) {
          MediaSession.setPositionState({
            duration: audio.duration,
            playbackRate: audio.playbackRate || 1,
            position: Math.min(audio.currentTime, audio.duration),
          }).catch(() => {});
        }
      }
    };

    const onLoadedMetadata = () => {
      setDuration(audio.duration);
    };

    const onCanPlay = () => setLoading(false);

    const onPlayingEvent = () => {
      setLoading(false);
      setIsPlaying(true);
      MediaSession.setPlaybackState({ playbackState: 'playing' }).catch(() => {});
      if (optionsRef.current.onPlaying) optionsRef.current.onPlaying();
      // Ask for the next track once this one is actually playing, so the
      // prefetch never competes with the download the listener is waiting on.
      if (prefetchedSrcRef.current !== currentSrcRef.current) {
        prefetchedSrcRef.current = currentSrcRef.current;
        prefetchNext();
      }
    };

    const onPauseEvent = () => {
      // Only mark paused if we didn't just reach the natural end of the track
      if (!audio.ended && currentSrcRef.current) {
        MediaSession.setPlaybackState({ playbackState: 'paused' }).catch(() => {});
      }
    };

    const onErrorEvent = () => {
      const attr = audio.getAttribute('src');
      // Clearing src (audio.src = '') raises an error too; that one is not a failure.
      if (!attr || attr !== currentSrcRef.current) return;
      setLoading(false);
      const failed = tracksRef.current[trackIndexRef.current];
      if (optionsRef.current.onError) {
        optionsRef.current.onError(failed, audio.error ? audio.error.code : 0);
      }
    };

    const onEnded = () => {
      if (playModeRef.current === 'repeat') {
        audio.currentTime = 0;
        audio.play().catch(() => {});
        return;
      }
      setTrackIndex((prev) => computeNext(prev));
    };

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('canplay', onCanPlay);
    audio.addEventListener('playing', onPlayingEvent);
    audio.addEventListener('pause', onPauseEvent);
    audio.addEventListener('error', onErrorEvent);
    audio.addEventListener('ended', onEnded);

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('canplay', onCanPlay);
      audio.removeEventListener('playing', onPlayingEvent);
      audio.removeEventListener('pause', onPauseEvent);
      audio.removeEventListener('error', onErrorEvent);
      audio.removeEventListener('ended', onEnded);
    };
  }, [tracks, computeNext, prefetchNext, audio]);

  const play = useCallback(() => {
    audio.play().catch(() => {});
    setIsPlaying(true);
    MediaSession.setPlaybackState({ playbackState: 'playing' }).catch(() => {});
  }, [audio]);

  const pause = useCallback(() => {
    audio.pause();
    setIsPlaying(false);
    MediaSession.setPlaybackState({ playbackState: 'paused' }).catch(() => {});
  }, [audio]);

  const togglePlay = useCallback(() => {
    if (isPlaying) pause();
    else play();
  }, [isPlaying, play, pause]);

  const next = useCallback(() => {
    isPlayingRef.current = true;
    setIsPlaying(true);
    setTrackIndex((prev) => computeNext(prev));
  }, [computeNext]);

  const prev = useCallback(() => {
    if (audio.currentTime > 3) {
      audio.currentTime = 0;
    } else {
      isPlayingRef.current = true;
      setIsPlaying(true);
      setTrackIndex((p) => {
        if (tracks.length === 0) return 0;
        return (p - 1 + tracks.length) % tracks.length;
      });
    }
  }, [audio, tracks.length]);

  const seek = useCallback((fraction) => {
    if (audio.duration) {
      audio.currentTime = Math.min(fraction, 1) * audio.duration;
    }
  }, [audio]);

  const setVolume = useCallback((v) => {
    const clamped = Math.max(0, Math.min(1, v));
    setVolumeState(clamped);
    audio.volume = clamped;
    localStorage.setItem('cupid-volume', clamped);
    if (clamped > 0) setMuted(false);
  }, [audio]);

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      audio.volume = m ? volume : 0;
      return !m;
    });
  }, [audio, volume]);

  const jumpTo = useCallback((index) => {
    if (index < 0 || index >= tracks.length) return;
    // Tapping a song in the queue always starts it, even if playback was paused.
    isPlayingRef.current = true;
    setIsPlaying(true);
    if (index === trackIndexRef.current) {
      audio.play().catch(() => {});
    } else {
      setTrackIndex(index);
    }
  }, [tracks.length, audio]);

  // Publish track metadata (title, artist, artwork) to lock screen & notification shade
  useEffect(() => {
    if (!track || track.title === 'No track') {
      MediaSession.setPlaybackState({ playbackState: 'none' }).catch(() => {});
      return;
    }
    const artwork = track.art
      ? [{ src: track.art, sizes: '512x512', type: 'image/jpeg' }]
      : [];
    MediaSession.setMetadata({
      title: track.title || 'Unknown Title',
      artist: track.artist || 'Cupid Player',
      album: 'Cupid Player',
      artwork,
    }).catch(() => {});
  }, [track.title, track.artist, track.art]);

  // Register lock-screen / headset media button handlers
  useEffect(() => {
    MediaSession.setActionHandler({ action: 'play' }, () => {
      play();
    }).catch(() => {});

    MediaSession.setActionHandler({ action: 'pause' }, () => {
      pause();
    }).catch(() => {});

    MediaSession.setActionHandler({ action: 'previoustrack' }, () => {
      prev();
    }).catch(() => {});

    MediaSession.setActionHandler({ action: 'nexttrack' }, () => {
      next();
    }).catch(() => {});

    MediaSession.setActionHandler({ action: 'seekto' }, (details) => {
      if (details && typeof details.seekTime === 'number' && audio.duration) {
        audio.currentTime = Math.max(0, Math.min(audio.duration, details.seekTime));
      }
    }).catch(() => {});

    MediaSession.setActionHandler({ action: 'seekbackward' }, (details) => {
      const offset = (details && details.seekOffset) || 10;
      audio.currentTime = Math.max(0, audio.currentTime - offset);
    }).catch(() => {});

    MediaSession.setActionHandler({ action: 'seekforward' }, (details) => {
      const offset = (details && details.seekOffset) || 10;
      if (audio.duration) {
        audio.currentTime = Math.min(audio.duration, audio.currentTime + offset);
      }
    }).catch(() => {});
  }, [play, pause, prev, next, audio]);

  return {
    track,
    trackIndex,
    isPlaying,
    loading,
    progress,
    duration,
    currentTime,
    play,
    pause,
    togglePlay,
    next,
    prev,
    seek,
    volume,
    setVolume,
    muted,
    toggleMute,
    jumpTo,
    audioRef,
  };
}