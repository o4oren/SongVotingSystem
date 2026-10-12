import { describe, expect, it } from 'vitest';
import {
  BUDGET_ERROR,
  CLOCK_GRACE_MS,
  DEFAULT_BUDGET,
  canSeeAllBids,
  formatCountdown,
  isPollClosed,
  isValidBudget,
  parseBudget,
  parseDateTimeLocal,
  pollSettings,
  toDateTimeLocal,
} from './poll.js';

const NOW = new Date(2026, 9, 12, 12, 0, 0);
const at = (ms) => new Date(NOW.getTime() + ms);
// Firestore returns Timestamps; the client only relies on toDate().
const timestamp = (date) => ({ toDate: () => date });

describe('pollSettings', () => {
  it('applies defaults to a legacy poll with no settings fields', () => {
    expect(pollSettings({ title: 'Summer set' })).toEqual({
      budget: DEFAULT_BUDGET,
      sealed: false,
      closed: false,
      endsAt: null,
      hasBids: false,
    });
  });

  it('applies defaults to a missing poll', () => {
    expect(pollSettings(null).budget).toBe(100);
  });

  it('reads stored values and converts endsAt Timestamps to Dates', () => {
    const endsAt = at(60_000);
    expect(
      pollSettings({ budget: 150, sealed: true, closed: true, endsAt: timestamp(endsAt), hasBids: true }),
    ).toEqual({ budget: 150, sealed: true, closed: true, endsAt, hasBids: true });
  });

  it('accepts a plain Date for endsAt', () => {
    const endsAt = at(60_000);
    expect(pollSettings({ endsAt }).endsAt).toBe(endsAt);
  });

  it('falls back to the default budget when the stored one is not an integer', () => {
    expect(pollSettings({ budget: '150' }).budget).toBe(100);
    expect(pollSettings({ budget: 2.5 }).budget).toBe(100);
  });
});

describe('isPollClosed', () => {
  it('is open with no close flag and no end date', () => {
    expect(isPollClosed({}, NOW)).toBe(false);
  });

  it('is closed when closed by hand', () => {
    expect(isPollClosed({ closed: true }, NOW)).toBe(true);
    expect(isPollClosed({ closed: true, endsAt: timestamp(at(60_000)) }, NOW)).toBe(true);
  });

  it('is open before the end date, closed at and after it', () => {
    expect(isPollClosed({ endsAt: timestamp(at(1)) }, NOW)).toBe(false);
    expect(isPollClosed({ endsAt: timestamp(at(0)) }, NOW)).toBe(true);
    expect(isPollClosed({ endsAt: timestamp(at(-1)) }, NOW)).toBe(true);
  });

  it('treats a missing poll as open', () => {
    expect(isPollClosed(null, NOW)).toBe(false);
  });
});

describe('canSeeAllBids', () => {
  it('is always true for open-visibility polls', () => {
    expect(canSeeAllBids({ sealed: false }, NOW)).toBe(true);
  });

  it('is false for a sealed poll that is still open', () => {
    expect(canSeeAllBids({ sealed: true, endsAt: timestamp(at(60_000)) }, NOW)).toBe(false);
  });

  it('is true for a sealed poll closed by hand, immediately', () => {
    expect(canSeeAllBids({ sealed: true, closed: true }, NOW)).toBe(true);
  });

  it('waits CLOCK_GRACE_MS after a sealed poll reaches its end date', () => {
    const poll = { sealed: true, endsAt: timestamp(NOW) };
    expect(canSeeAllBids(poll, at(CLOCK_GRACE_MS - 1))).toBe(false);
    expect(canSeeAllBids(poll, at(CLOCK_GRACE_MS))).toBe(true);
  });
});

describe('formatCountdown', () => {
  const S = 1000;
  const M = 60 * S;
  const H = 60 * M;
  const D = 24 * H;

  it('shows days, hours and minutes from one day up', () => {
    expect(formatCountdown(2 * D + 4 * H + 12 * M + 30 * S)).toBe('2d 4h 12m');
    expect(formatCountdown(D)).toBe('1d 0h 0m');
  });

  it('shows hours and minutes from one hour up', () => {
    expect(formatCountdown(4 * H + 12 * M)).toBe('4h 12m');
    expect(formatCountdown(H)).toBe('1h 0m');
  });

  it('shows minutes and padded seconds under an hour', () => {
    expect(formatCountdown(12 * M + 5 * S)).toBe('12m 05s');
    expect(formatCountdown(59 * S)).toBe('0m 59s');
  });

  it('rounds partial seconds up so it never shows zero while still open', () => {
    expect(formatCountdown(500)).toBe('0m 01s');
  });

  it('is empty at or past zero', () => {
    expect(formatCountdown(0)).toBe('');
    expect(formatCountdown(-5000)).toBe('');
    expect(formatCountdown(NaN)).toBe('');
  });
});

describe('budget parsing', () => {
  it('parses trimmed whole numbers', () => {
    expect(parseBudget(' 150 ')).toBe(150);
    expect(parseBudget(150)).toBe(150);
  });

  it('returns NaN for blank and non-numeric input', () => {
    expect(parseBudget('')).toBeNaN();
    expect(parseBudget('  ')).toBeNaN();
    expect(parseBudget('abc')).toBeNaN();
  });

  it('accepts whole numbers from 1 to 1000 only', () => {
    expect(isValidBudget(1)).toBe(true);
    expect(isValidBudget(1000)).toBe(true);
    expect(isValidBudget(0)).toBe(false);
    expect(isValidBudget(1001)).toBe(false);
    expect(isValidBudget(10.5)).toBe(false);
    expect(isValidBudget(NaN)).toBe(false);
  });

  it('has the agreed error copy', () => {
    expect(BUDGET_ERROR).toBe('Budget must be a whole number from 1 to 1000.');
  });
});

describe('datetime-local conversion', () => {
  it('parses a datetime-local value as local time', () => {
    expect(parseDateTimeLocal('2026-10-16T20:00')).toEqual(new Date(2026, 9, 16, 20, 0));
  });

  it('returns null for blank or invalid values', () => {
    expect(parseDateTimeLocal('')).toBeNull();
    expect(parseDateTimeLocal('not a date')).toBeNull();
  });

  it('formats a Date for a datetime-local input, and round-trips', () => {
    const date = new Date(2026, 0, 5, 9, 7);
    expect(toDateTimeLocal(date)).toBe('2026-01-05T09:07');
    expect(parseDateTimeLocal(toDateTimeLocal(date))).toEqual(date);
  });

  it('formats null as an empty string', () => {
    expect(toDateTimeLocal(null)).toBe('');
  });
});
