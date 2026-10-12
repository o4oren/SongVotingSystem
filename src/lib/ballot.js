const NO_SONGS = 'Add songs to this poll before bidding.';

const pluralPoints = (n) => `${n} ${n === 1 ? 'point' : 'points'}`;

export function parsePoints(raw) {
  if (raw === undefined || raw === null) return 0;
  if (typeof raw === 'number') return raw;
  const trimmed = String(raw).trim();
  return trimmed === '' ? 0 : Number(trimmed);
}

export function isValidPoints(n, budget) {
  return Number.isInteger(n) && n >= 0 && n <= budget;
}

export function validateBallot(points = {}, songIds, budget) {
  if (songIds.length === 0) {
    return { total: 0, remaining: budget, invalidSongIds: [], errors: [NO_SONGS], valid: false };
  }

  let total = 0;
  const invalidSongIds = [];
  for (const id of songIds) {
    const n = parsePoints(points[id]);
    if (isValidPoints(n, budget)) total += n;
    else invalidSongIds.push(id);
  }

  const remaining = budget - total;
  const errors = [];
  if (invalidSongIds.length > 0) errors.push(`Each value must be a whole number from 0 to ${budget}.`);
  if (remaining > 0) errors.push(`${pluralPoints(remaining)} unassigned — your bid must total exactly ${budget}.`);
  if (remaining < 0) errors.push(`You are ${pluralPoints(-remaining)} over ${budget}.`);

  return { total, remaining, invalidSongIds, errors, valid: errors.length === 0 };
}

// Only current songs are kept, which drops points left behind by removed songs.
export function cleanPoints(points, songIds, budget) {
  const clean = {};
  for (const id of songIds) {
    const n = parsePoints(points[id]);
    if (isValidPoints(n, budget) && n > 0) clean[id] = n;
  }
  return clean;
}
