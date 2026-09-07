import { useState, useRef, useEffect, useCallback } from 'react';

export default function useAudioPlayer(tracks, playMode = 'normal', getAudioPath) {
  const audioRef = useRef(new Audio());
  const playModeRef = useRef(playMode);
  playModeRef.current = playMode;
  const [trackIndex, setTrackIndex] = useState(0);

  const prevTracksRef = useRef(tracks);
  if (prevTracksRef.current !== tracks) {
    prevTracksRef.current = tracks;
    if (trackIndex >= tracks.length) setTrackIndex(0);
  }

  const [isPlaying, setIsPlaying] = useState(false);
  const isPlayingRef = useRef(false);
  isPlayingRef.current = isPlaying;
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
      audio.src = src;
      audio.load();
      setProgress(0);
      setCurrentTime(0);
      setDuration(0);
      if (isPlayingRef.current) {
        audio.play().catch(() => {});
      }
    })();

    return () => { cancelled = true; };
  }, [trackIndex, tracks, getAudioPath]);

  useEffect(() => {
    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
      if (audio.duration) {
        setProgress(audio.currentTime / audio.duration);
      }
    };

    const onLoadedMetadata = () => {
      setDuration(audio.duration);
    };

    const onEnded = () => {
      if (playModeRef.current === 'repeat') {
        audio.currentTime = 0;
        audio.play().catch(() => {});
        return;
      }
      setTrackIndex((prev) => {
        if (tracks.length === 0) return 0;
        if (playModeRef.current === 'shuffle') {
          let next;
          do { next = Math.floor(Math.random() * tracks.length); } while (next === prev && tracks.length > 1);
          return next;
        }
        return (prev + 1) % tracks.length;
      });
    };

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('ended', onEnded);

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('ended', onEnded);
    };
  }, [tracks]);

  const play = useCallback(() => {
    audio.play().catch(() => {});
    setIsPlaying(true);
  }, [audio]);

  const pause = useCallback(() => {
    audio.pause();
    setIsPlaying(false);
  }, [audio]);

  const togglePlay = useCallback(() => {
    if (isPlaying) pause();
    else play();
  }, [isPlaying, play, pause]);

  const next = useCallback(() => {
    setTrackIndex((prev) => {
      if (tracks.length === 0) return 0;
      if (playModeRef.current === 'shuffle' && tracks.length > 1) {
        let n;
        do { n = Math.floor(Math.random() * tracks.length); } while (n === prev);
        return n;
      }
      return (prev + 1) % tracks.length;
    });
  }, [tracks]);

  const prev = useCallback(() => {
    if (audio.currentTime > 3) {
      audio.currentTime = 0;
    } else {
      setTrackIndex((p) => {
        if (tracks.length === 0) return 0;
        return (p - 1 + tracks.length) % tracks.length;
      });
    }
  }, [audio, tracks]);

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
    setTrackIndex(index);
  }, [tracks.length]);

  return {
    track,
    trackIndex,
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
  };
}