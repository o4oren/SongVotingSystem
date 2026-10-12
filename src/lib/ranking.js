import { isValidPoints } from './ballot.js';

export function computeRanking(songs, bids, budget) {
  const rows = songs.map((song) => {
    const breakdown = bids
      .map((bid) => ({ email: bid.email, points: bid.points?.[song.id] }))
      .filter((entry) => isValidPoints(entry.points, budget) && entry.points > 0)
      .sort((a, b) => b.points - a.points || a.email.localeCompare(b.email));
    const total = breakdown.reduce((sum, entry) => sum + entry.points, 0);
    return { song, total, breakdown };
  });

  return rows.sort(
    (a, b) => b.total - a.total || a.song.title.localeCompare(b.song.title, undefined, { sensitivity: 'base' }),
  );
}
