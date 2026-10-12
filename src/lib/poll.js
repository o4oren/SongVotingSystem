export const DEFAULT_BUDGET = 100;
export const MIN_BUDGET = 1;
export const MAX_BUDGET = 1000;
export const BUDGET_ERROR = `Budget must be a whole number from ${MIN_BUDGET} to ${MAX_BUDGET}.`;

// The browser clock can run ahead of Firestore's request.time. Sealed bids only
// become readable once the server agrees the poll has closed.
export const CLOCK_GRACE_MS = 5000;

function toDate(value) {
  if (value instanceof Date) return value;
  if (typeof value?.toDate === 'function') return value.toDate();
  return null;
}

// Polls created before budgets and closing existed have none of these fields.
export function pollSettings(poll) {
  return {
    budget: Number.isInteger(poll?.budget) ? poll.budget : DEFAULT_BUDGET,
    sealed: poll?.sealed === true,
    closed: poll?.closed === true,
    endsAt: toDate(poll?.endsAt),
    hasBids: poll?.hasBids === true,
  };
}

export function isPollClosed(poll, now) {
  const { closed, endsAt } = pollSettings(poll);
  return closed || (endsAt !== null && now.getTime() >= endsAt.getTime());
}

export function canSeeAllBids(poll, now) {
  if (!pollSettings(poll).sealed) return true;
  return isPollClosed(poll, new Date(now.getTime() - CLOCK_GRACE_MS));
}

export function formatCountdown(ms) {
  if (!(ms > 0)) return '';
  const totalSeconds = Math.ceil(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

export function parseBudget(raw) {
  const trimmed = String(raw ?? '').trim();
  return trimmed === '' ? NaN : Number(trimmed);
}

export function isValidBudget(n) {
  return Number.isInteger(n) && n >= MIN_BUDGET && n <= MAX_BUDGET;
}

// <input type="datetime-local"> values have no time zone; the browser reads them as local time.
export function parseDateTimeLocal(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function toDateTimeLocal(date) {
  if (!date) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
