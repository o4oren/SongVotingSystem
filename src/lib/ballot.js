export const TOTAL_POINTS = 100;

const NO_SONGS = 'Add songs to this poll before voting.';
const INVALID_VALUE = `Each value must be a whole number from 0 to ${TOTAL_POINTS}.`;

export function parsePoints(raw) {
  if (raw === undefined || raw === null) return 0;
  if (typeof raw === 'number') return raw;
  const trimmed = String(raw).trim();
  return trimmed === '' ? 0 : Number(trimmed);
}

export function isValidPoints(n) {
  return Number.isInteger(n) && n >= 0 && n <= TOTAL_POINTS;
}

export function validateBallot(points = {}, songIds) {
  if (songIds.length === 0) {
    return { total: 0, remaining: TOTAL_POINTS, invalidSongIds: [], errors: [NO_SONGS], valid: false };
  }

  let total = 0;
  const invalidSongIds = [];
  for (const id of songIds) {
    const n = parsePoints(points[id]);
    if (isValidPoints(n)) total += n;
    else invalidSongIds.push(id);
  }

  const remaining = TOTAL_POINTS - total;
  const errors = [];
  if (invalidSongIds.length > 0) errors.push(INVALID_VALUE);
  if (remaining > 0) errors.push(`${remaining} points unassigned — your total must be exactly ${TOTAL_POINTS}.`);
  if (remaining < 0) errors.push(`You are ${-remaining} points over ${TOTAL_POINTS}.`);

  return { total, remaining, invalidSongIds, errors, valid: errors.length === 0 };
}

// Only current songs are kept, which drops points left behind by removed songs.
export function cleanPoints(points, songIds) {
  const clean = {};
  for (const id of songIds) {
    const n = parsePoints(points[id]);
    if (isValidPoints(n) && n > 0) clean[id] = n;
  }
  return clean;
}
