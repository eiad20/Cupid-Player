import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchServerStatus, runServerCheck } from './youtubeService';

// One word for the "Status:" row in settings:
// checking | good | offline | cookies | problem
function summarize(info) {
  if (!info) return 'checking';
  if (info.unreachable) return 'offline';
  if (info.cookies === 'expired') return 'cookies';
  const f = info.lastFailure;
  // A recent failure that is not about one specific video, and is newer than the last success.
  if (
    f &&
    f.reason !== 'unavailable' &&
    f.reason !== 'cookies' &&
    f.ago < 30 * 60 &&
    (info.lastOkAgo === null || f.ago < info.lastOkAgo)
  ) {
    return 'problem';
  }
  return 'good';
}

export default function useServerStatus(intervalMs = 60000) {
  const [info, setInfo] = useState(null);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState(null); // { ok, ms, reason? } from "check now"
  const busyRef = useRef(false);

  const refresh = useCallback(async () => {
    const data = await fetchServerStatus();
    setInfo(data || { unreachable: true });
  }, []);

  const check = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setChecking(true);
    try {
      const data = await runServerCheck();
      if (data) {
        setInfo(data);
        setCheckResult(data.check || null);
      } else {
        setInfo({ unreachable: true });
        setCheckResult(null);
      }
    } finally {
      busyRef.current = false;
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, intervalMs);
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh, intervalMs]);

  return { info, summary: summarize(info), refresh, check, checking, checkResult };
}