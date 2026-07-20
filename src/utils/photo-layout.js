export function buildOrientationRows(photos) {
  const queues = {
    portrait: photos.filter((photo) => photo.orientation === 'portrait'),
    landscape: photos.filter((photo) => photo.orientation !== 'portrait'),
  };
  const rows = [];
  let next = queues.portrait.length ? 'portrait' : 'landscape';

  while (queues.portrait.length || queues.landscape.length) {
    if (!queues[next].length) next = next === 'portrait' ? 'landscape' : 'portrait';
    const defaultSize = next === 'portrait' ? 3 : 2;
    const maxSize = 4;
    const savedSize = Number(queues[next][0]?.categoryRowSize);
    const size = Number.isFinite(savedSize) ? Math.min(maxSize, Math.max(1, Math.round(savedSize))) : defaultSize;
    rows.push({ orientation: next, items: queues[next].splice(0, size) });
    const alternate = next === 'portrait' ? 'landscape' : 'portrait';
    next = queues[alternate].length ? alternate : next;
  }

  return rows;
}
