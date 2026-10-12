import { useEffect, useState } from 'react';

// Re-renders every intervalMs so countdowns and time-based closing stay live.
export function useNow(enabled = true, intervalMs = 1000) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!enabled) return undefined;
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [enabled, intervalMs]);

  return now;
}
