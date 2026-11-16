import { useEffect, useState } from 'react';
import { checkServerHealth } from './youtubeService';

export default function useServerStatus(intervalMs = 30000) {
  const [status, setStatus] = useState('checking'); // checking | online | offline

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const ok = await checkServerHealth();
      if (!cancelled) setStatus(ok ? 'online' : 'offline');
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') run();
    };

    run();
    const id = setInterval(run, intervalMs);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [intervalMs]);

  return status;
}