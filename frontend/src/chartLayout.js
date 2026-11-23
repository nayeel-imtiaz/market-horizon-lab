import { useEffect, useState } from 'react';

const COMPACT_VIEWPORT = '(max-width: 480px)';
const shortDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

export function useCompactChart() {
  const [compact, setCompact] = useState(() => window.matchMedia(COMPACT_VIEWPORT).matches);

  useEffect(() => {
    const query = window.matchMedia(COMPACT_VIEWPORT);
    const update = (event) => setCompact(event.matches);
    update(query);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  return compact;
}

export function categoryTicks(compact, dates = false) {
  const ticks = { maxTicksLimit: compact ? 4 : 8, maxRotation: 0 };
  if (compact && dates) {
    ticks.callback = function (index) {
      return shortDate.format(new Date(this.getLabelForValue(index)));
    };
  }
  return ticks;
}

export function legendOptions(compact) {
  return compact ? { labels: { boxWidth: 14, boxHeight: 8, padding: 8, font: { size: 11 } } } : undefined;
}
