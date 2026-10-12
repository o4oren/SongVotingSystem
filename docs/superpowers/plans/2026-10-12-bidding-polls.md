# Bidding Polls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn "votes" into "bids", and give admins per-poll budgets, open or sealed visibility, manual or timed closing with a live countdown, and a "Fresh & Bright" visual style. The work also includes migrating existing votes to bids.

**Architecture:**
- **Poll settings:** each poll document gains `budget`, `sealed`, `closed`, `endsAt` and `hasBids`.
- **Rules:** Firestore security rules enforce closing (using `request.time`), sealed reads, the member-only `hasBids` flip, and the budget/visibility lock.
- **Pure logic:** lives in `src/lib/poll.js`, `ballot.js` and `ranking.js`.
- **Live state:** `useNow` ticks once a second. `usePoll` picks a bids listener the user is allowed to read.
- **Migration:** a one-off `firebase-admin` script copies `votes` to `bids`.

**Tech Stack:** React 19, Vite 8, react-router-dom 7, Firebase JS SDK 12 (modular), Firestore rules v2, Vitest 5, React Testing Library, `@firebase/rules-unit-testing`, `firebase-admin` 14 (dev only, for the migration).

**Spec:** `docs/superpowers/specs/2026-10-12-bidding-polls-design.md`

## Global Constraints

- **Hosting and Node:**
  - Free Firebase Spark plan only: no Cloud Functions, no paid services.
  - Node 20+ (`.nvmrc` pins 22).
- **Java for the Firestore emulator** (`npm run test:rules`): needs Java 21+.
  - Use an Intuit-approved OpenJDK distribution, with `JAVA_HOME` set to that JDK's explicit path: `<path-to-intended-jdk>/Contents/Home` on macOS. List installed JDKs with `/usr/libexec/java_home -V`.
  - Never select a JDK with a version-only lookup.
  - Never install or remove a JDK without asking the human.
- **Budget:** a whole number from **1** to **1000**, default **100**.
  - Defined only as `DEFAULT_BUDGET`, `MIN_BUDGET` and `MAX_BUDGET` in `src/lib/poll.js`.
  - Error copy: `Budget must be a whole number from 1 to 1000.`
- **Missing poll fields** read as defaults: `budget` 100, `sealed` false, `closed` false, `endsAt` null, `hasBids` false.
  - Client: always go through `pollSettings(poll)`.
  - Rules: always use `data.get(field, default)`.
- **Bids:** stored at `polls/{pollId}/bids/{email}` as `{ points: { [songId]: int }, updatedAt }`. The doc ID is the normalized (trimmed, lowercased) email.
- **Ballot:**
  - Each value is a whole number from 0 to the poll's budget.
  - The total is exactly the budget.
  - Checked client-side only.
- **Closing freezes bids.** On a closed poll, members can't create, update or delete a bid. Admins can still delete bids.
- **Sealed polls:** while sealed and open, everyone (admins included) can read only their own bid.
- **Terminology:**
  - UI copy says "bid / bids / bidding", never "vote".
  - "Points" is the unit; "budget" is the allowance.
  - App display name: **Band Song Bids**.
- **Shared CSS class names**, used by components and styled in Task 11: `gradient-text`, `panel`, `badge`, `badge-open`, `badge-closed`, `badge-sealed`, `badge-countdown`, `poll-status`, `poll-meta`, `poll-title`, `pts-pill`, `score-bar`, `secondary`, `danger`, `hint`, `settings-form`, `create-poll-form`, `field`.
- **Rules tests** use emulator project ID `demo-songvote`.

## Review Focus

1. **Clock skew at close time on sealed polls.** The browser clock may run ahead of Firestore's `request.time`. If the client switched to the full `bids` listener exactly at `endsAt`, the rules would still deny it and the listener would stay errored.
   - **Expected:** results appear a few seconds after close and no error shows.
   - **Pinned by:** `canSeeAllBids` uses a 5s grace (Task 1 tests). `usePoll` uses it (Task 5 test). PollPage shows "Tallying final results…" in the gap (Task 9 test).
2. **Deleting a sealed, still-open poll.** The admin can't list the other members' bids, so a naive `deletePoll` fails with "You don't have access."
   - **Expected:** deletion works.
   - **Pinned by:** `deletePoll` closes the poll before listing (Task 4 test), and a rules test that an admin can list bids after closing a sealed poll (Task 3).
3. **Admin reopens a poll that closed by its end date.** If `endsAt` stayed in the past, the poll would close again at once. A stale settings form could also re-save the old date.
   - **Expected:** reopening clears a past end date, and the settings form resets to server values.
   - **Pinned by:** `reopenPoll(pollId, true)` (Task 4 test). PollPage passes `clearEndsAt` and keys `PollSettings` on server state (Task 9 test).
4. **Sealed poll while open: the admin still has to manage songs.** Hiding the ranking must not hide the song list or its Remove buttons.
   - **Pinned by:** a PollPage sealed-state test (Task 9).
5. **First bid on a legacy poll without `hasBids`.** The batch must set the flag so the budget and visibility lock kicks in. An admin who also bids must not be blocked by the member-only rule.
   - **Pinned by:** `saveBid` batch tests (Task 4), plus rules tests for the member flip and an admin bidding in a batch (Task 3).

---

### Task 1: Poll settings logic and the `useNow` hook

**Files:**
- Create: `src/lib/poll.js`
- Create: `src/lib/poll.test.js`
- Create: `src/hooks/useNow.js`
- Create: `src/hooks/useNow.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `DEFAULT_BUDGET = 100`, `MIN_BUDGET = 1`, `MAX_BUDGET = 1000`, `CLOCK_GRACE_MS = 5000`, `BUDGET_ERROR` (string)
  - `pollSettings(poll | null) → { budget: number, sealed: boolean, closed: boolean, endsAt: Date | null, hasBids: boolean }`
  - `isPollClosed(poll | null, now: Date) → boolean`
  - `canSeeAllBids(poll | null, now: Date) → boolean`
  - `formatCountdown(ms: number) → string`
  - `parseBudget(raw: string | number) → number` (NaN when blank or non-numeric)
  - `isValidBudget(n) → boolean`
  - `parseDateTimeLocal(value: string) → Date | null`
  - `toDateTimeLocal(date: Date | null) → string` (`"YYYY-MM-DDTHH:mm"`, local time, or `''`)
  - `useNow(enabled = true, intervalMs = 1000) → Date`

- [ ] **Step 1: Write the failing tests**

`src/lib/poll.test.js`:

```js
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
```

`src/hooks/useNow.test.js`:

```js
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useNow } from './useNow.js';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 12, 12, 0, 0));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useNow', () => {
  it('returns the current time and ticks every second', () => {
    const { result } = renderHook(() => useNow());
    expect(result.current).toEqual(new Date(2026, 9, 12, 12, 0, 0));
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current).toEqual(new Date(2026, 9, 12, 12, 0, 1));
  });

  it('does not tick when disabled', () => {
    const { result } = renderHook(() => useNow(false));
    const first = result.current;
    act(() => vi.advanceTimersByTime(5000));
    expect(result.current).toBe(first);
  });

  it('stops ticking on unmount', () => {
    const { unmount } = renderHook(() => useNow());
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/poll.test.js src/hooks/useNow.test.js`
Expected: FAIL. Vite can't resolve `./poll.js` and `./useNow.js`.

- [ ] **Step 3: Implement**

`src/lib/poll.js`:

```js
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
```

`src/hooks/useNow.js`:

```js
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/poll.test.js src/hooks/useNow.test.js`
Expected: PASS, every test green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/poll.js src/lib/poll.test.js src/hooks/useNow.js src/hooks/useNow.test.js
git commit -m "feat: add poll settings, closing and countdown logic"
```

---

### Task 2: Budget-aware ballot validation and ranking over bids

**Files:**
- Modify: `src/lib/ballot.js` (whole file)
- Modify: `src/lib/ballot.test.js` (whole file)
- Modify: `src/lib/ranking.js` (whole file)
- Modify: `src/lib/ranking.test.js` (whole file)

**Interfaces:**
- Consumes: nothing. `ballot.js` stays independent of `poll.js`.
- Produces:
  - `parsePoints(raw) → number` (unchanged)
  - `isValidPoints(n, budget) → boolean`
  - `validateBallot(points, songIds, budget) → { total, remaining, invalidSongIds, errors, valid }`
  - `cleanPoints(points, songIds, budget) → { [songId]: number }`
  - `computeRanking(songs, bids: { email, points }[], budget) → { song, total, breakdown: { email, points }[] }[]`
  - `TOTAL_POINTS` is **removed**.

- [ ] **Step 1: Rewrite the tests**

`src/lib/ballot.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { cleanPoints, isValidPoints, parsePoints, validateBallot } from './ballot.js';

const SONGS = ['a', 'b', 'c'];
const invalid = (budget) => `Each value must be a whole number from 0 to ${budget}.`;

describe('parsePoints', () => {
  it('treats missing and blank values as 0', () => {
    expect(parsePoints(undefined)).toBe(0);
    expect(parsePoints(null)).toBe(0);
    expect(parsePoints('')).toBe(0);
    expect(parsePoints('   ')).toBe(0);
  });

  it('parses numeric strings and passes numbers through', () => {
    expect(parsePoints(' 40 ')).toBe(40);
    expect(parsePoints(25)).toBe(25);
  });

  it('returns NaN for non-numeric strings', () => {
    expect(parsePoints('abc')).toBeNaN();
  });
});

describe('isValidPoints', () => {
  it('accepts whole numbers from 0 to the budget', () => {
    expect(isValidPoints(0, 100)).toBe(true);
    expect(isValidPoints(100, 100)).toBe(true);
    expect(isValidPoints(150, 150)).toBe(true);
  });

  it('rejects everything else', () => {
    expect(isValidPoints(-1, 100)).toBe(false);
    expect(isValidPoints(101, 100)).toBe(false);
    expect(isValidPoints(151, 150)).toBe(false);
    expect(isValidPoints(10.5, 100)).toBe(false);
    expect(isValidPoints(NaN, 100)).toBe(false);
    expect(isValidPoints('50', 100)).toBe(false);
    expect(isValidPoints(undefined, 100)).toBe(false);
  });
});

describe('validateBallot', () => {
  it('accepts whole numbers that add up to exactly the budget', () => {
    expect(validateBallot({ a: '50', b: '30', c: '20' }, SONGS, 100)).toEqual({
      total: 100,
      remaining: 0,
      invalidSongIds: [],
      errors: [],
      valid: true,
    });
    expect(validateBallot({ a: '100', b: '50' }, SONGS, 150).valid).toBe(true);
  });

  it('works with a budget of 1', () => {
    expect(validateBallot({ b: '1' }, SONGS, 1).valid).toBe(true);
    expect(validateBallot({ a: '1', b: '1' }, SONGS, 1).valid).toBe(false);
  });

  it('accepts number values as well as strings', () => {
    expect(validateBallot({ a: 100 }, SONGS, 100).valid).toBe(true);
  });

  it('treats blank and missing fields as 0', () => {
    const result = validateBallot({ a: '100', b: '', c: '  ' }, SONGS, 100);
    expect(result.valid).toBe(true);
    expect(result.total).toBe(100);
  });

  it('reports unassigned points against the budget', () => {
    const result = validateBallot({ a: '40' }, SONGS, 150);
    expect(result.valid).toBe(false);
    expect(result.remaining).toBe(110);
    expect(result.errors).toEqual(['110 points unassigned — your bid must total exactly 150.']);
  });

  it('reports the overage against the budget', () => {
    const result = validateBallot({ a: '140', b: '20' }, SONGS, 150);
    expect(result.valid).toBe(false);
    expect(result.remaining).toBe(-10);
    expect(result.errors).toEqual(['You are 10 points over 150.']);
  });

  it('flags fractional values', () => {
    const result = validateBallot({ a: '10.5', b: '89.5' }, SONGS, 100);
    expect(result.valid).toBe(false);
    expect(result.invalidSongIds).toEqual(['a', 'b']);
    expect(result.errors).toContain(invalid(100));
  });

  it('flags negative values and values over the budget', () => {
    const result = validateBallot({ a: '-10', b: '160' }, SONGS, 150);
    expect(result.invalidSongIds).toEqual(['a', 'b']);
    expect(result.errors).toContain(invalid(150));
    expect(result.valid).toBe(false);
  });

  it('flags non-numeric values and leaves them out of the total', () => {
    const result = validateBallot({ a: 'abc', b: '100' }, SONGS, 100);
    expect(result.invalidSongIds).toEqual(['a']);
    expect(result.total).toBe(100);
    expect(result.errors).toEqual([invalid(100)]);
    expect(result.valid).toBe(false);
  });

  it('ignores points for songs that are no longer in the poll', () => {
    const result = validateBallot({ a: '60', gone: '40' }, SONGS, 100);
    expect(result.total).toBe(60);
    expect(result.remaining).toBe(40);
    expect(result.valid).toBe(false);
  });

  it('rejects a poll with no songs', () => {
    expect(validateBallot({}, [], 150)).toEqual({
      total: 0,
      remaining: 150,
      invalidSongIds: [],
      errors: ['Add songs to this poll before bidding.'],
      valid: false,
    });
  });

  it('handles a missing points object', () => {
    expect(validateBallot(undefined, SONGS, 100).remaining).toBe(100);
  });
});

describe('cleanPoints', () => {
  it('keeps valid non-zero values for current songs, as numbers', () => {
    expect(cleanPoints({ a: '60', b: '0', c: ' 40 ', gone: '10' }, SONGS, 100)).toEqual({ a: 60, c: 40 });
  });

  it('drops blank, invalid and over-budget values', () => {
    expect(cleanPoints({ a: '', b: 'abc', c: '10.5' }, SONGS, 100)).toEqual({});
    expect(cleanPoints({ a: '120' }, SONGS, 100)).toEqual({});
    expect(cleanPoints({ a: '120' }, SONGS, 150)).toEqual({ a: 120 });
  });
});
```

`src/lib/ranking.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { computeRanking } from './ranking.js';

const ZOMBIE = { id: 's1', title: 'Zombie', artist: 'The Cranberries' };
const AFRICA = { id: 's2', title: 'Africa', artist: 'Toto' };
const CREEP = { id: 's3', title: 'Creep', artist: 'Radiohead' };
const SONGS = [ZOMBIE, AFRICA, CREEP];

const titles = (rows) => rows.map((row) => row.song.title);

describe('computeRanking', () => {
  it('sorts songs by total points, highest first', () => {
    const bids = [
      { email: 'a@gmail.com', points: { s1: 70, s2: 30 } },
      { email: 'b@gmail.com', points: { s2: 50, s3: 50 } },
    ];
    const rows = computeRanking(SONGS, bids, 100);
    expect(titles(rows)).toEqual(['Africa', 'Zombie', 'Creep']);
    expect(rows.map((row) => row.total)).toEqual([80, 70, 50]);
  });

  it('lists who bid what, highest first', () => {
    const bids = [
      { email: 'a@gmail.com', points: { s2: 30, s1: 70 } },
      { email: 'b@gmail.com', points: { s2: 50, s3: 50 } },
    ];
    const africa = computeRanking(SONGS, bids, 100).find((row) => row.song.id === 's2');
    expect(africa.breakdown).toEqual([
      { email: 'b@gmail.com', points: 50 },
      { email: 'a@gmail.com', points: 30 },
    ]);
  });

  it('counts values up to a custom budget', () => {
    const rows = computeRanking(SONGS, [{ email: 'a@gmail.com', points: { s1: 150 } }], 150);
    expect(rows[0].total).toBe(150);
  });

  it('breaks ties alphabetically, ignoring case', () => {
    const songs = [{ id: 'x', title: 'beatles medley' }, { id: 'y', title: 'Abba medley' }, ZOMBIE];
    const rows = computeRanking(songs, [{ email: 'a@gmail.com', points: { x: 50, y: 50 } }], 100);
    expect(titles(rows)).toEqual(['Abba medley', 'beatles medley', 'Zombie']);
  });

  it('lists every song at 0 when nobody has bid', () => {
    const rows = computeRanking(SONGS, [], 100);
    expect(titles(rows)).toEqual(['Africa', 'Creep', 'Zombie']);
    expect(rows.every((row) => row.total === 0 && row.breakdown.length === 0)).toBe(true);
  });

  it('ignores points for songs that were removed', () => {
    const rows = computeRanking([ZOMBIE], [{ email: 'a@gmail.com', points: { s1: 60, gone: 40 } }], 100);
    expect(rows).toHaveLength(1);
    expect(rows[0].total).toBe(60);
  });

  it('ignores malformed and over-budget values instead of crashing or concatenating', () => {
    const bids = [
      { email: 'a@gmail.com', points: { s1: '50', s2: -20, s3: NaN } },
      { email: 'b@gmail.com', points: { s1: 10, s2: 500, s3: 2.5 } },
      { email: 'c@gmail.com' },
    ];
    const rows = computeRanking(SONGS, bids, 100);
    expect(rows.find((row) => row.song.id === 's1').total).toBe(10);
    expect(rows.find((row) => row.song.id === 's2').total).toBe(0);
    expect(rows.find((row) => row.song.id === 's3').total).toBe(0);
  });

  it('returns an empty list for a poll with no songs', () => {
    expect(computeRanking([], [{ email: 'a@gmail.com', points: { s1: 100 } }], 100)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/ballot.test.js src/lib/ranking.test.js`
Expected: FAIL. The message copy differs ("total must be exactly 100" against "bid must total exactly 150"), and the custom-budget cases fail.

- [ ] **Step 3: Implement**

`src/lib/ballot.js`:

```js
const NO_SONGS = 'Add songs to this poll before bidding.';

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
  if (remaining > 0) errors.push(`${remaining} points unassigned — your bid must total exactly ${budget}.`);
  if (remaining < 0) errors.push(`You are ${-remaining} points over ${budget}.`);

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
```

`src/lib/ranking.js`:

```js
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/ballot.test.js src/lib/ranking.test.js`
Expected: PASS.

The other suites (`Ballot.test.jsx`, `PollPage.test.jsx`) now fail because they still use the old signatures and copy. Tasks 6 and 9 rewrite them. Don't fix them here.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ballot.js src/lib/ballot.test.js src/lib/ranking.js src/lib/ranking.test.js
git commit -m "feat: validate ballots and rank bids against a per-poll budget"
```

---

### Task 3: Security rules for bids, closing, sealed polls and the settings lock

**Files:**
- Modify: `firestore.rules` (whole file)
- Modify: `tests/rules/firestore.rules.test.js` (whole file)

**Interfaces:**
- Consumes: nothing.
- Produces: the server rules that the data layer (Task 4) and the migration (Task 12) rely on.
  - `bids` replaces `votes`.
  - Bid writes need the poll to be open.
  - On a sealed, open poll, you can read only your own bid.
  - Members may only flip `hasBids` to `true` while the poll is open.
  - Admins can't change `budget` or `sealed` once `hasBids` is set, and can't unset `hasBids`.
  - Poll create requires `budget` to be an int from 1 to 1000, `sealed` to be a bool, and no `hasBids: true`.
  - Legacy `votes` documents are admin read/delete only.

This needs Java 21+ and `JAVA_HOME` set explicitly, as described in Global Constraints. If `npm run test:rules` can't find Java, stop and ask the human. Never pick a JDK yourself.

- [ ] **Step 1: Rewrite the rules tests**

`tests/rules/firestore.rules.test.js`:

```js
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';

const ADMIN = 'admin@gmail.com';
const MEMBER = 'member@gmail.com';
const OTHER = 'other@gmail.com';
const STRANGER = 'stranger@gmail.com';

const HOUR = 60 * 60 * 1000;
const BID = { points: { s1: 100 } };

// Poll IDs describe their state.
const POLLS = {
  open: { title: 'Open', budget: 100, sealed: false, closed: false, endsAt: null, hasBids: true },
  fresh: { title: 'Fresh', budget: 100, sealed: false, closed: false, endsAt: null, hasBids: false },
  closed: { title: 'Closed', budget: 100, sealed: false, closed: true, endsAt: null, hasBids: true },
  sealed: { title: 'Sealed', budget: 100, sealed: true, closed: false, endsAt: null, hasBids: true },
  sealedClosed: { title: 'Sealed closed', budget: 100, sealed: true, closed: true, endsAt: null, hasBids: true },
  legacy: { title: 'Legacy' },
};

let testEnv;

// Host and port come from FIRESTORE_EMULATOR_HOST, which `firebase emulators:exec` sets.
beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-songvote',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'members', ADMIN), { admin: true });
    await setDoc(doc(db, 'members', MEMBER), { admin: false });
    await setDoc(doc(db, 'members', OTHER), { admin: false });
    const polls = {
      ...POLLS,
      expired: { ...POLLS.open, title: 'Expired', endsAt: Timestamp.fromMillis(Date.now() - HOUR) },
      future: { ...POLLS.open, title: 'Future', endsAt: Timestamp.fromMillis(Date.now() + HOUR) },
      sealedExpired: { ...POLLS.sealed, title: 'Sealed expired', endsAt: Timestamp.fromMillis(Date.now() - HOUR) },
    };
    for (const [id, data] of Object.entries(polls)) {
      await setDoc(doc(db, 'polls', id), data);
      await setDoc(doc(db, `polls/${id}/songs/s1`), { title: 'Africa', artist: 'Toto' });
      if (id !== 'fresh') {
        await setDoc(doc(db, `polls/${id}/bids`, MEMBER), BID);
        await setDoc(doc(db, `polls/${id}/bids`, OTHER), BID);
      }
    }
    await setDoc(doc(db, 'polls/legacy/votes', MEMBER), BID);
  });
});

function as(email, tokenOverrides = {}) {
  return testEnv.authenticatedContext(email, { email, email_verified: true, ...tokenOverrides }).firestore();
}

const validPoll = (overrides = {}) => ({ title: 'New', budget: 100, sealed: false, closed: false, endsAt: null, ...overrides });

describe('people who are not members', () => {
  it('cannot read anything when signed out', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, 'polls', 'open')));
    await assertFails(getDoc(doc(db, 'members', MEMBER)));
  });

  it('cannot read anything when signed in but not whitelisted', async () => {
    const db = as(STRANGER);
    await assertFails(getDoc(doc(db, 'members', STRANGER)));
    await assertFails(getDoc(doc(db, 'polls', 'open')));
    await assertFails(getDoc(doc(db, 'polls/open/songs/s1')));
    await assertFails(getDoc(doc(db, 'polls/open/bids', MEMBER)));
  });

  it('cannot bid', async () => {
    await assertFails(setDoc(doc(as(STRANGER), 'polls/open/bids', STRANGER), BID));
  });

  it('cannot get in with an unverified email', async () => {
    await assertFails(getDoc(doc(as(MEMBER, { email_verified: false }), 'polls', 'open')));
  });
});

describe('members on an open poll', () => {
  it('can read polls, songs, everyone’s bids and the member list', async () => {
    const db = as(MEMBER);
    await assertSucceeds(getDoc(doc(db, 'polls', 'open')));
    await assertSucceeds(getDoc(doc(db, 'polls/open/songs/s1')));
    await assertSucceeds(getDoc(doc(db, 'polls/open/bids', OTHER)));
    await assertSucceeds(getDocs(collection(db, 'polls/open/bids')));
    await assertSucceeds(getDoc(doc(db, 'members', ADMIN)));
  });

  it('are recognized when Google returns their email in different case', async () => {
    const db = as('Member@Gmail.com');
    await assertSucceeds(getDoc(doc(db, 'polls', 'open')));
    await assertSucceeds(setDoc(doc(db, 'polls/open/bids', MEMBER), BID));
  });

  it('cannot create polls, add songs or change members', async () => {
    const db = as(MEMBER);
    await assertFails(setDoc(doc(db, 'polls', 'p2'), validPoll()));
    await assertFails(setDoc(doc(db, 'polls/open/songs/s2'), { title: 'Creep', artist: 'Radiohead' }));
    await assertFails(deleteDoc(doc(db, 'polls/open/songs/s1')));
    await assertFails(setDoc(doc(db, 'members', 'new@gmail.com'), { admin: false }));
    await assertFails(updateDoc(doc(db, 'members', MEMBER), { admin: true }));
  });

  it('can write and delete their own bid', async () => {
    const db = as(MEMBER);
    await assertSucceeds(setDoc(doc(db, 'polls/open/bids', MEMBER), { points: { s1: 60 } }));
    await assertSucceeds(deleteDoc(doc(db, 'polls/open/bids', MEMBER)));
  });

  it('can bid before a future end date', async () => {
    await assertSucceeds(setDoc(doc(as(MEMBER), 'polls/future/bids', MEMBER), BID));
  });

  it("cannot write or delete someone else's bid", async () => {
    const db = as(MEMBER);
    await assertFails(setDoc(doc(db, 'polls/open/bids', OTHER), { points: { s1: 0 } }));
    await assertFails(deleteDoc(doc(db, 'polls/open/bids', OTHER)));
  });

  it('must store points as a map', async () => {
    const db = as(MEMBER);
    await assertFails(setDoc(doc(db, 'polls/open/bids', MEMBER), { points: 100 }));
    await assertFails(setDoc(doc(db, 'polls/open/bids', MEMBER), { other: 'field' }));
  });

  it('cannot read legacy votes', async () => {
    await assertFails(getDoc(doc(as(MEMBER), 'polls/legacy/votes', MEMBER)));
  });
});

describe('closed polls', () => {
  it('reject creating, updating or deleting a bid when closed by hand', async () => {
    const db = as(MEMBER);
    await assertFails(setDoc(doc(db, 'polls/closed/bids', MEMBER), { points: { s1: 50 } }));
    await assertFails(setDoc(doc(as(OTHER), 'polls/closed/bids', 'other@gmail.com'), BID));
    await assertFails(deleteDoc(doc(db, 'polls/closed/bids', MEMBER)));
  });

  it('reject bids after the end date has passed', async () => {
    await assertFails(setDoc(doc(as(MEMBER), 'polls/expired/bids', MEMBER), BID));
  });

  it('still let members read everyone’s bids', async () => {
    await assertSucceeds(getDocs(collection(as(MEMBER), 'polls/closed/bids')));
  });
});

describe('sealed polls', () => {
  it('let you read only your own bid while open', async () => {
    const db = as(MEMBER);
    await assertSucceeds(getDoc(doc(db, 'polls/sealed/bids', MEMBER)));
    await assertFails(getDoc(doc(db, 'polls/sealed/bids', OTHER)));
    await assertFails(getDocs(collection(db, 'polls/sealed/bids')));
  });

  it('apply to admins too', async () => {
    await assertFails(getDoc(doc(as(ADMIN), 'polls/sealed/bids', MEMBER)));
    await assertFails(getDocs(collection(as(ADMIN), 'polls/sealed/bids')));
  });

  it('reveal all bids once closed by hand or by end date', async () => {
    const db = as(MEMBER);
    await assertSucceeds(getDoc(doc(db, 'polls/sealedClosed/bids', OTHER)));
    await assertSucceeds(getDocs(collection(db, 'polls/sealedClosed/bids')));
    await assertSucceeds(getDocs(collection(db, 'polls/sealedExpired/bids')));
  });

  it('accept bids while open', async () => {
    await assertSucceeds(setDoc(doc(as(MEMBER), 'polls/sealed/bids', MEMBER), { points: { s1: 100 } }));
  });
});

describe('the hasBids flag', () => {
  it('can be set to true by a member on an open poll, together with their first bid', async () => {
    const db = as(MEMBER);
    const batch = writeBatch(db);
    batch.set(doc(db, 'polls/fresh/bids', MEMBER), BID);
    batch.update(doc(db, 'polls', 'fresh'), { hasBids: true });
    await assertSucceeds(batch.commit());
  });

  it('can be set to true by a member on a legacy poll without the field', async () => {
    await assertSucceeds(updateDoc(doc(as(MEMBER), 'polls', 'legacy'), { hasBids: true }));
  });

  it('cannot be set by a member on a closed poll', async () => {
    await testEnv.withSecurityRulesDisabled((context) =>
      updateDoc(doc(context.firestore(), 'polls', 'closed'), { hasBids: false }),
    );
    await assertFails(updateDoc(doc(as(MEMBER), 'polls', 'closed'), { hasBids: true }));
  });

  it('cannot be used by a member to change other fields', async () => {
    const db = as(MEMBER);
    await assertFails(updateDoc(doc(db, 'polls', 'fresh'), { hasBids: true, title: 'Hacked' }));
    await assertFails(updateDoc(doc(db, 'polls', 'fresh'), { closed: true }));
    await assertFails(updateDoc(doc(db, 'polls', 'fresh'), { hasBids: false, budget: 5 }));
  });

  it('cannot be set to false by a member', async () => {
    await assertFails(updateDoc(doc(as(MEMBER), 'polls', 'open'), { hasBids: false }));
  });

  it('lets an admin bid in the same batch as the flag', async () => {
    const db = as(ADMIN);
    const batch = writeBatch(db);
    batch.set(doc(db, 'polls/fresh/bids', ADMIN), BID);
    batch.update(doc(db, 'polls', 'fresh'), { hasBids: true });
    await assertSucceeds(batch.commit());
  });
});

describe('admins', () => {
  it('can create polls with valid settings', async () => {
    const db = as(ADMIN);
    await assertSucceeds(setDoc(doc(db, 'polls', 'p2'), validPoll()));
    await assertSucceeds(setDoc(doc(db, 'polls', 'p3'), validPoll({ budget: 1, sealed: true })));
    await assertSucceeds(setDoc(doc(db, 'polls', 'p4'), validPoll({ budget: 1000, hasBids: false })));
    await assertSucceeds(
      setDoc(doc(db, 'polls', 'p5'), validPoll({ endsAt: Timestamp.fromMillis(Date.now() + HOUR) })),
    );
  });

  it('cannot create polls with invalid settings', async () => {
    const db = as(ADMIN);
    await assertFails(setDoc(doc(db, 'polls', 'p2'), validPoll({ budget: 0 })));
    await assertFails(setDoc(doc(db, 'polls', 'p2'), validPoll({ budget: 1001 })));
    await assertFails(setDoc(doc(db, 'polls', 'p2'), validPoll({ budget: '100' })));
    await assertFails(setDoc(doc(db, 'polls', 'p2'), validPoll({ budget: 10.5 })));
    await assertFails(setDoc(doc(db, 'polls', 'p2'), { title: 'No budget', sealed: false }));
    await assertFails(setDoc(doc(db, 'polls', 'p2'), validPoll({ sealed: 'no' })));
    await assertFails(setDoc(doc(db, 'polls', 'p2'), { title: 'No sealed', budget: 100 }));
    await assertFails(setDoc(doc(db, 'polls', 'p2'), validPoll({ hasBids: true })));
  });

  it('can delete polls', async () => {
    await assertSucceeds(deleteDoc(doc(as(ADMIN), 'polls', 'open')));
  });

  it('can change budget and visibility before any bids', async () => {
    const db = as(ADMIN);
    await assertSucceeds(updateDoc(doc(db, 'polls', 'fresh'), { budget: 150, sealed: true }));
    await assertSucceeds(updateDoc(doc(db, 'polls', 'legacy'), { budget: 150 }));
  });

  it('cannot change budget or visibility once bids exist', async () => {
    const db = as(ADMIN);
    await assertFails(updateDoc(doc(db, 'polls', 'open'), { budget: 150 }));
    await assertFails(updateDoc(doc(db, 'polls', 'open'), { sealed: true }));
  });

  it('cannot unset hasBids', async () => {
    await assertFails(updateDoc(doc(as(ADMIN), 'polls', 'open'), { hasBids: false }));
  });

  it('can close, reopen and set or clear the end date even after bids', async () => {
    const db = as(ADMIN);
    await assertSucceeds(updateDoc(doc(db, 'polls', 'open'), { closed: true }));
    await assertSucceeds(updateDoc(doc(db, 'polls', 'open'), { closed: false, endsAt: null }));
    await assertSucceeds(
      updateDoc(doc(db, 'polls', 'open'), { endsAt: Timestamp.fromMillis(Date.now() + HOUR), title: 'Renamed' }),
    );
  });

  it('can list a sealed poll’s bids after closing it (needed to delete it)', async () => {
    const db = as(ADMIN);
    await assertSucceeds(updateDoc(doc(db, 'polls', 'sealed'), { closed: true }));
    await assertSucceeds(getDocs(collection(db, 'polls/sealed/bids')));
  });

  it('can add and remove songs', async () => {
    const db = as(ADMIN);
    await assertSucceeds(setDoc(doc(db, 'polls/open/songs/s2'), { title: 'Creep', artist: 'Radiohead' }));
    await assertSucceeds(deleteDoc(doc(db, 'polls/open/songs/s2')));
  });

  it('can add, update and remove members', async () => {
    const db = as(ADMIN);
    await assertSucceeds(setDoc(doc(db, 'members', 'new@gmail.com'), { admin: false }));
    await assertSucceeds(updateDoc(doc(db, 'members', 'new@gmail.com'), { admin: true }));
    await assertSucceeds(deleteDoc(doc(db, 'members', 'new@gmail.com')));
  });

  it("can delete another member's bid, even on a closed poll (needed to delete a poll)", async () => {
    await assertSucceeds(deleteDoc(doc(as(ADMIN), 'polls/open/bids', MEMBER)));
    await assertSucceeds(deleteDoc(doc(as(ADMIN), 'polls/closed/bids', MEMBER)));
  });

  it("cannot write another member's bid", async () => {
    await assertFails(setDoc(doc(as(ADMIN), 'polls/open/bids', MEMBER), { points: { s1: 0 } }));
  });

  it('can read and delete legacy votes, but not write them', async () => {
    const db = as(ADMIN);
    await assertSucceeds(getDocs(collection(db, 'polls/legacy/votes')));
    await assertFails(setDoc(doc(db, 'polls/legacy/votes', ADMIN), BID));
    await assertSucceeds(deleteDoc(doc(db, 'polls/legacy/votes', MEMBER)));
  });
});
```

- [ ] **Step 2: Run the rules tests to verify they fail**

Run: `npm run test:rules`
Expected: FAIL. Bid reads and writes are denied (there's no `bids` match yet), closed and sealed tests fail, and create validation passes things it shouldn't.

- [ ] **Step 3: Write the rules**

`firestore.rules`:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function myEmail() {
      return request.auth.token.email.lower();
    }

    function isMember() {
      return request.auth != null
        && request.auth.token.email_verified == true
        && exists(/databases/$(database)/documents/members/$(myEmail()));
    }

    function isAdmin() {
      return isMember()
        && get(/databases/$(database)/documents/members/$(myEmail())).data.admin == true;
    }

    // Missing fields mean defaults, so polls created before these settings still work.
    function isOpen(poll) {
      return !poll.get('closed', false)
        && (poll.get('endsAt', null) == null || request.time < poll.endsAt);
    }

    match /members/{email} {
      allow read: if isMember();
      allow write: if isAdmin();
    }

    match /polls/{pollId} {
      function pollData() {
        return get(/databases/$(database)/documents/polls/$(pollId)).data;
      }

      allow read: if isMember();

      allow create: if isAdmin()
        && request.resource.data.budget is int
        && request.resource.data.budget >= 1
        && request.resource.data.budget <= 1000
        && request.resource.data.sealed is bool
        && request.resource.data.get('hasBids', false) == false;

      // Admins can change anything except budget and visibility once bids exist, and can't
      // unset hasBids. Members can only flip hasBids to true, with their first bid.
      allow update: if (isAdmin()
          && !(resource.data.get('hasBids', false) && !request.resource.data.get('hasBids', false))
          && (!resource.data.get('hasBids', false)
            || (request.resource.data.get('budget', 100) == resource.data.get('budget', 100)
              && request.resource.data.get('sealed', false) == resource.data.get('sealed', false))))
        || (isMember()
          && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['hasBids'])
          && request.resource.data.hasBids == true
          && isOpen(resource.data));

      allow delete: if isAdmin();

      match /songs/{songId} {
        allow read: if isMember();
        allow write: if isAdmin();
      }

      // The exact-budget check is client-side only: rules can't sum map values.
      match /bids/{email} {
        allow read: if isMember()
          && (email == myEmail() || !pollData().get('sealed', false) || !isOpen(pollData()));
        allow create, update: if isMember()
          && email == myEmail()
          && request.resource.data.points is map
          && isOpen(pollData());
        allow delete: if isAdmin()
          || (isMember() && email == myEmail() && isOpen(pollData()));
      }

      // Pre-rename data, kept until a later cleanup removes it.
      match /votes/{email} {
        allow read, delete: if isAdmin();
      }
    }
  }
}
```

- [ ] **Step 4: Run the rules tests to verify they pass**

Run: `npm run test:rules`
Expected: PASS, every test green.

- [ ] **Step 5: Commit**

```bash
git add firestore.rules tests/rules/firestore.rules.test.js
git commit -m "feat: enforce closing, sealed bids and settings lock in rules"
```

---

### Task 4: Data layer for poll settings and bids

**Files:**
- Modify: `src/lib/db.js:15-48` (poll functions, `deletePoll`, `saveVote`)
- Modify: `src/lib/db.test.js` (whole file)

**Interfaces:**
- Consumes: the rules from Task 3.
- Produces:
  - `createPoll({ title, budget, sealed, endsAt }: { title: string, budget: number, sealed: boolean, endsAt: Date | null }, byEmail) → Promise<DocumentReference>`
  - `updatePollSettings(pollId, changes: { endsAt?: Date | null, budget?: number, sealed?: boolean }) → Promise<void>`
  - `closePoll(pollId) → Promise<void>`
  - `reopenPoll(pollId, clearEndsAt: boolean) → Promise<void>`. **This differs from the spec's `reopenPoll(pollId, now)`:** the caller already knows whether `endsAt` is past, so `db.js` doesn't need to read the poll.
  - `saveBid(pollId, email, points, { hasBids }: { hasBids: boolean }) → Promise<void>`
  - `deletePoll(pollId)`: closes the poll first, then deletes songs, bids, legacy votes and the poll in one batch.
  - `saveVote` is **removed**.

- [ ] **Step 1: Rewrite the tests**

`src/lib/db.test.js`:

```js
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('firebase/firestore', () => ({
  addDoc: vi.fn(),
  collection: vi.fn((db, ...path) => ({ path: path.join('/') })),
  deleteDoc: vi.fn(),
  doc: vi.fn((db, ...path) => ({ path: path.join('/') })),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  serverTimestamp: vi.fn(() => 'TIMESTAMP'),
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
  writeBatch: vi.fn(),
}));

import { addDoc, getDoc, getDocs, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { addMember, closePoll, createPoll, deletePoll, reopenPoll, saveBid, updatePollSettings } from './db.js';

function fakeBatch() {
  const batch = { set: vi.fn(), update: vi.fn(), delete: vi.fn(), commit: vi.fn().mockResolvedValue(undefined) };
  writeBatch.mockReturnValue(batch);
  return batch;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('addMember', () => {
  it('refuses to overwrite an existing member', async () => {
    getDoc.mockResolvedValue({ exists: () => true });
    await expect(addMember('bob@gmail.com', false, 'admin@gmail.com'))
      .rejects.toThrow('bob@gmail.com is already on the list.');
    expect(setDoc).not.toHaveBeenCalled();
  });

  it('creates a new member doc keyed by email', async () => {
    getDoc.mockResolvedValue({ exists: () => false });
    await addMember('bob@gmail.com', true, 'admin@gmail.com');
    expect(setDoc).toHaveBeenCalledWith(
      { path: 'members/bob@gmail.com' },
      { admin: true, addedBy: 'admin@gmail.com', addedAt: 'TIMESTAMP' },
    );
  });
});

describe('createPoll', () => {
  it('stores the settings, open and with no bids', async () => {
    const endsAt = new Date(2026, 9, 16, 20, 0);
    await createPoll({ title: 'Summer set', budget: 150, sealed: true, endsAt }, 'admin@gmail.com');
    expect(addDoc).toHaveBeenCalledWith(
      { path: 'polls' },
      {
        title: 'Summer set',
        budget: 150,
        sealed: true,
        endsAt,
        closed: false,
        hasBids: false,
        createdBy: 'admin@gmail.com',
        createdAt: 'TIMESTAMP',
      },
    );
  });
});

describe('poll settings', () => {
  it('updates the given fields', async () => {
    await updatePollSettings('p1', { endsAt: null, budget: 120 });
    expect(updateDoc).toHaveBeenCalledWith({ path: 'polls/p1' }, { endsAt: null, budget: 120 });
  });

  it('closes a poll', async () => {
    await closePoll('p1');
    expect(updateDoc).toHaveBeenCalledWith({ path: 'polls/p1' }, { closed: true });
  });

  it('reopens a poll and keeps a future end date', async () => {
    await reopenPoll('p1', false);
    expect(updateDoc).toHaveBeenCalledWith({ path: 'polls/p1' }, { closed: false });
  });

  it('reopens a poll and clears a past end date so it does not close again at once', async () => {
    await reopenPoll('p1', true);
    expect(updateDoc).toHaveBeenCalledWith({ path: 'polls/p1' }, { closed: false, endsAt: null });
  });
});

describe('deletePoll', () => {
  it('closes the poll first, then deletes songs, bids, legacy votes and the poll in one batch', async () => {
    const batch = fakeBatch();
    getDocs
      .mockResolvedValueOnce({ docs: [{ ref: 'song-1' }, { ref: 'song-2' }] })
      .mockResolvedValueOnce({ docs: [{ ref: 'bid-1' }] })
      .mockResolvedValueOnce({ docs: [{ ref: 'vote-1' }] });

    await deletePoll('p1');

    expect(updateDoc).toHaveBeenCalledWith({ path: 'polls/p1' }, { closed: true });
    expect(updateDoc.mock.invocationCallOrder[0]).toBeLessThan(getDocs.mock.invocationCallOrder[0]);
    expect(getDocs.mock.calls.map(([ref]) => ref.path)).toEqual([
      'polls/p1/songs',
      'polls/p1/bids',
      'polls/p1/votes',
    ]);
    expect(batch.delete.mock.calls.map(([ref]) => ref)).toEqual([
      'song-1',
      'song-2',
      'bid-1',
      'vote-1',
      { path: 'polls/p1' },
    ]);
    expect(batch.commit).toHaveBeenCalledTimes(1);
  });
});

describe('saveBid', () => {
  it("replaces the member's bid and flags the poll on the first bid", async () => {
    const batch = fakeBatch();
    await saveBid('p1', 'bob@gmail.com', { s1: 100 }, { hasBids: false });
    expect(batch.set).toHaveBeenCalledWith(
      { path: 'polls/p1/bids/bob@gmail.com' },
      { points: { s1: 100 }, updatedAt: 'TIMESTAMP' },
    );
    expect(batch.update).toHaveBeenCalledWith({ path: 'polls/p1' }, { hasBids: true });
    expect(batch.commit).toHaveBeenCalledTimes(1);
  });

  it('does not touch the poll once it already has bids', async () => {
    const batch = fakeBatch();
    await saveBid('p1', 'bob@gmail.com', { s1: 100 }, { hasBids: true });
    expect(batch.set).toHaveBeenCalledTimes(1);
    expect(batch.update).not.toHaveBeenCalled();
  });

  it('passes on a rejected commit', async () => {
    const batch = fakeBatch();
    batch.commit.mockRejectedValue({ code: 'permission-denied' });
    await expect(saveBid('p1', 'bob@gmail.com', { s1: 100 }, { hasBids: true })).rejects.toEqual({
      code: 'permission-denied',
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/db.test.js`
Expected: FAIL. `closePoll`, `reopenPoll`, `saveBid` and `updatePollSettings` aren't exported, and `createPoll` has the old shape.

- [ ] **Step 3: Implement**

In `src/lib/db.js`, replace `createPoll` through `saveVote` (lines 15–48) with the following. Leave `addMember`, `setMemberAdmin` and `removeMember` as they are.

```js
export function createPoll({ title, budget, sealed, endsAt }, byEmail) {
  return addDoc(collection(db, 'polls'), {
    title,
    budget,
    sealed,
    endsAt,
    closed: false,
    hasBids: false,
    createdBy: byEmail,
    createdAt: serverTimestamp(),
  });
}

export function updatePollSettings(pollId, changes) {
  return updateDoc(doc(db, 'polls', pollId), changes);
}

export function closePoll(pollId) {
  return updateDoc(doc(db, 'polls', pollId), { closed: true });
}

// A past end date would close the poll again straight away, so reopening clears it.
export function reopenPoll(pollId, clearEndsAt) {
  return updateDoc(doc(db, 'polls', pollId), clearEndsAt ? { closed: false, endsAt: null } : { closed: false });
}

// Firestore doesn't cascade-delete subcollections, so songs, bids and legacy votes go first.
// Closing first makes a sealed poll's bids readable, so they can be listed for deletion.
// One batch holds up to 500 writes, far more than a band poll needs.
export async function deletePoll(pollId) {
  const pollRef = doc(db, 'polls', pollId);
  await updateDoc(pollRef, { closed: true });
  const [songs, bids, votes] = await Promise.all([
    getDocs(collection(db, 'polls', pollId, 'songs')),
    getDocs(collection(db, 'polls', pollId, 'bids')),
    getDocs(collection(db, 'polls', pollId, 'votes')),
  ]);
  const batch = writeBatch(db);
  [...songs.docs, ...bids.docs, ...votes.docs].forEach((snapshot) => batch.delete(snapshot.ref));
  batch.delete(pollRef);
  await batch.commit();
}

export function addSong(pollId, { title, artist }, byEmail) {
  return addDoc(collection(db, 'polls', pollId, 'songs'), {
    title,
    artist,
    addedBy: byEmail,
    addedAt: serverTimestamp(),
  });
}

export function removeSong(pollId, songId) {
  return deleteDoc(doc(db, 'polls', pollId, 'songs', songId));
}

// The first bid also sets hasBids, which locks the poll's budget and visibility.
export function saveBid(pollId, email, points, { hasBids }) {
  const batch = writeBatch(db);
  batch.set(doc(db, 'polls', pollId, 'bids', email), { points, updatedAt: serverTimestamp() });
  if (!hasBids) batch.update(doc(db, 'polls', pollId), { hasBids: true });
  return batch.commit();
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/db.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db.js src/lib/db.test.js
git commit -m "feat: add poll settings, closing and bid writes to the data layer"
```

---

### Task 5: `usePoll` with a bids listener that respects sealed polls

**Files:**
- Modify: `src/hooks/usePoll.js` (whole file)
- Create: `src/hooks/usePoll.test.js`

**Interfaces:**
- Consumes:
  - `useCollection(segments | null, order?)` and `useDocument(segments | null)` from `src/hooks/useFirestore.js`. Each returns `{ data, loading, error }`, and passing `null` means "don't subscribe".
  - `pollSettings`, `isPollClosed` and `canSeeAllBids` from Task 1.
- Produces: `usePoll(pollId, myEmail, now: Date)`, which returns:
  ```
  {
    poll,          // raw doc or null
    settings,      // pollSettings(poll)
    closed,        // boolean
    bidsVisible,   // true when every bid can be read
    songs,         // { id, title, artist, ... }[]
    bids,          // { email, points }[]
    myBid,         // { email, points } | null
    loading,
    error,
  }
  ```

- [ ] **Step 1: Write the failing test**

`src/hooks/usePoll.test.js`:

```js
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

vi.mock('./useFirestore.js', () => ({ useCollection: vi.fn(), useDocument: vi.fn() }));

import { useCollection, useDocument } from './useFirestore.js';
import { usePoll } from './usePoll.js';

const NOW = new Date(2026, 9, 12, 12, 0, 0);
const ME = 'me@gmail.com';
const SONGS = [{ id: 's1', title: 'Africa' }];
const ALL_BIDS = [
  { id: ME, points: { s1: 100 } },
  { id: 'other@gmail.com', points: { s1: 100 } },
];

const ready = (data) => ({ data, loading: false, error: null });
const idle = (empty) => ({ data: empty, loading: false, error: null });

function setup(poll) {
  useDocument.mockImplementation((segments) => {
    if (segments === null) return idle(null);
    if (segments.length === 2) return ready(poll);
    return ready({ id: ME, points: { s1: 100 } });
  });
  useCollection.mockImplementation((segments) => {
    if (segments === null) return idle([]);
    if (segments[2] === 'songs') return ready(SONGS);
    return ready(ALL_BIDS);
  });
}

const bidsCollectionArgs = () => useCollection.mock.calls.map(([segments]) => segments).filter((s) => s?.[2] !== 'songs');
const ownBidArgs = () => useDocument.mock.calls.map(([segments]) => segments).filter((s) => s?.length !== 2);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('usePoll', () => {
  it('listens to every bid on an open-visibility poll', () => {
    setup({ id: 'p1', title: 'Summer set', budget: 150 });
    const { result } = renderHook(() => usePoll('p1', ME, NOW));
    expect(bidsCollectionArgs()).toContainEqual(['polls', 'p1', 'bids']);
    expect(ownBidArgs().every((s) => s === null)).toBe(true);
    expect(result.current.bidsVisible).toBe(true);
    expect(result.current.closed).toBe(false);
    expect(result.current.settings.budget).toBe(150);
    expect(result.current.bids).toEqual([
      { email: ME, points: { s1: 100 } },
      { email: 'other@gmail.com', points: { s1: 100 } },
    ]);
    expect(result.current.myBid).toEqual({ email: ME, points: { s1: 100 } });
    expect(result.current.songs).toBe(SONGS);
  });

  it('listens only to your own bid on a sealed poll that is still open', () => {
    setup({ id: 'p1', title: 'Summer set', sealed: true });
    const { result } = renderHook(() => usePoll('p1', ME, NOW));
    expect(ownBidArgs()).toContainEqual(['polls', 'p1', 'bids', ME]);
    expect(bidsCollectionArgs().every((s) => s === null)).toBe(true);
    expect(result.current.bidsVisible).toBe(false);
    expect(result.current.bids).toEqual([{ email: ME, points: { s1: 100 } }]);
    expect(result.current.myBid).toEqual({ email: ME, points: { s1: 100 } });
  });

  it('switches to every bid once a sealed poll is closed', () => {
    setup({ id: 'p1', title: 'Summer set', sealed: true, closed: true });
    const { result } = renderHook(() => usePoll('p1', ME, NOW));
    expect(bidsCollectionArgs()).toContainEqual(['polls', 'p1', 'bids']);
    expect(result.current.closed).toBe(true);
    expect(result.current.bidsVisible).toBe(true);
  });

  it('reports closed at the end date but keeps sealed bids hidden during the clock grace', () => {
    setup({ id: 'p1', title: 'Summer set', sealed: true, endsAt: new Date(NOW.getTime() - 1000) });
    const { result } = renderHook(() => usePoll('p1', ME, NOW));
    expect(result.current.closed).toBe(true);
    expect(result.current.bidsVisible).toBe(false);
    expect(ownBidArgs()).toContainEqual(['polls', 'p1', 'bids', ME]);
  });

  it('has no bid when you have not bid on a sealed poll', () => {
    setup({ id: 'p1', title: 'Summer set', sealed: true });
    useDocument.mockImplementation((segments) =>
      segments?.length === 2 ? ready({ id: 'p1', sealed: true }) : idle(null),
    );
    const { result } = renderHook(() => usePoll('p1', ME, NOW));
    expect(result.current.bids).toEqual([]);
    expect(result.current.myBid).toBeNull();
  });

  it('does not subscribe to bids until the poll has loaded, or when it does not exist', () => {
    setup(null);
    const { result } = renderHook(() => usePoll('p1', ME, NOW));
    expect(bidsCollectionArgs().every((s) => s === null)).toBe(true);
    expect(ownBidArgs().every((s) => s === null)).toBe(true);
    expect(result.current.poll).toBeNull();
    expect(result.current.settings.budget).toBe(100);
  });

  it('combines loading and errors', () => {
    setup({ id: 'p1', title: 'Summer set' });
    useCollection.mockImplementation((segments) => {
      if (segments?.[2] === 'bids') return { data: [], loading: false, error: { code: 'permission-denied' } };
      return { data: [], loading: true, error: null };
    });
    const { result } = renderHook(() => usePoll('p1', ME, NOW));
    expect(result.current.loading).toBe(true);
    expect(result.current.error).toEqual({ code: 'permission-denied' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/hooks/usePoll.test.js`
Expected: FAIL. The current hook returns `votes`, has no `settings`/`bids`/`myBid`, and listens to `votes`.

- [ ] **Step 3: Implement**

`src/hooks/usePoll.js`:

```js
import { canSeeAllBids, isPollClosed, pollSettings } from '../lib/poll.js';
import { useCollection, useDocument } from './useFirestore.js';

// Firestore rejects a whole query if any doc it could return is unreadable, so on a
// sealed poll that's still open we may only listen to our own bid.
export function usePoll(pollId, myEmail, now) {
  const poll = useDocument(['polls', pollId]);
  const songs = useCollection(['polls', pollId, 'songs'], { field: 'addedAt', direction: 'asc' });

  const loaded = poll.data !== null;
  const bidsVisible = loaded && canSeeAllBids(poll.data, now);
  const allBids = useCollection(loaded && bidsVisible ? ['polls', pollId, 'bids'] : null);
  const ownBid = useDocument(loaded && !bidsVisible ? ['polls', pollId, 'bids', myEmail] : null);

  const rawBids = bidsVisible ? allBids.data : ownBid.data ? [ownBid.data] : [];
  const bids = rawBids.map((bid) => ({ email: bid.id, points: bid.points ?? {} }));

  return {
    poll: poll.data,
    settings: pollSettings(poll.data),
    closed: loaded && isPollClosed(poll.data, now),
    bidsVisible,
    songs: songs.data,
    bids,
    myBid: bids.find((bid) => bid.email === myEmail) ?? null,
    loading: poll.loading || songs.loading || allBids.loading || ownBid.loading,
    error: poll.error || songs.error || allBids.error || ownBid.error,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/hooks/usePoll.test.js src/hooks/useFirestore.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/usePoll.js src/hooks/usePoll.test.js
git commit -m "feat: load bids in usePoll, own bid only while a sealed poll is open"
```

---

### Task 6: The Ballot becomes "My bid"

**Files:**
- Modify: `src/components/Ballot.jsx` (whole file)
- Modify: `src/components/Ballot.test.jsx` (whole file)

**Interfaces:**
- Consumes: `validateBallot(points, songIds, budget)` and `cleanPoints(points, songIds, budget)` from Task 2. `errorMessage` from `src/lib/errors.js`.
- Produces: `<Ballot songs budget savedPoints readOnly onSave />`.
  - `savedPoints`: `{ [songId]: number } | undefined`.
  - `readOnly`: boolean, default `false`.
  - `onSave(points) → Promise`.

- [ ] **Step 1: Rewrite the tests**

`src/components/Ballot.test.jsx`:

```jsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Ballot from './Ballot.jsx';

const SONGS = [
  { id: 's1', title: 'Africa', artist: 'Toto' },
  { id: 's2', title: 'Creep', artist: 'Radiohead' },
];

function renderBallot(props = {}) {
  return render(<Ballot songs={SONGS} budget={100} savedPoints={undefined} onSave={vi.fn()} {...props} />);
}

describe('Ballot', () => {
  it('is headed "My bid"', () => {
    renderBallot();
    expect(screen.getByRole('heading', { name: 'My bid' })).toBeInTheDocument();
  });

  it('pre-fills a saved bid and offers Update bid at exactly the budget', () => {
    renderBallot({ savedPoints: { s1: 60, s2: 40 } });
    expect(screen.getByLabelText('Points for Africa')).toHaveValue(60);
    expect(screen.getByLabelText('Points for Creep')).toHaveValue(40);
    expect(screen.getByText('Budget left: 0 / 100')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Update bid' })).toBeEnabled();
  });

  it('starts empty with the whole budget left and Place bid disabled', () => {
    renderBallot({ budget: 150 });
    expect(screen.getByLabelText('Points for Africa')).toHaveValue(null);
    expect(screen.getByLabelText('Points for Africa')).toHaveAttribute('max', '150');
    expect(screen.getByText('Budget left: 150 / 150')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Place bid' })).toBeDisabled();
  });

  it('updates the counter against the budget as you type', async () => {
    const user = userEvent.setup();
    renderBallot({ budget: 150 });
    await user.type(screen.getByLabelText('Points for Africa'), '30');
    expect(screen.getByText('Budget left: 120 / 150')).toBeInTheDocument();
    expect(screen.getByText('120 points unassigned — your bid must total exactly 150.')).toBeInTheDocument();
  });

  it('flags fractional values', async () => {
    const user = userEvent.setup();
    renderBallot();
    await user.type(screen.getByLabelText('Points for Africa'), '10.5');
    expect(screen.getByLabelText('Points for Africa')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Each value must be a whole number from 0 to 100.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Place bid' })).toBeDisabled();
  });

  it('saves cleaned points and confirms', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderBallot({ budget: 150, onSave });
    await user.type(screen.getByLabelText('Points for Africa'), '150');
    await user.click(screen.getByRole('button', { name: 'Place bid' }));
    expect(onSave).toHaveBeenCalledWith({ s1: 150 });
    expect(screen.getByRole('status')).toHaveTextContent('Bid saved.');
  });

  it('shows unassigned points left behind by a removed song', () => {
    renderBallot({ savedPoints: { s1: 60, gone: 40 } });
    expect(screen.getByText('Budget left: 40 / 100')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Update bid' })).toBeDisabled();
  });

  it('shows an error when saving fails and keeps the input', async () => {
    const onSave = vi.fn().mockRejectedValue({ code: 'unavailable' });
    const user = userEvent.setup();
    renderBallot({ savedPoints: { s1: 60, s2: 40 }, onSave });
    await user.click(screen.getByRole('button', { name: 'Update bid' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Could not save: Network problem — check your connection and try again.',
    );
    expect(screen.getByLabelText('Points for Africa')).toHaveValue(60);
  });

  it('explains a rejected save as bidding having closed', async () => {
    const onSave = vi.fn().mockRejectedValue({ code: 'permission-denied' });
    const user = userEvent.setup();
    renderBallot({ savedPoints: { s1: 60, s2: 40 }, onSave });
    await user.click(screen.getByRole('button', { name: 'Update bid' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Bidding closed for this poll.');
  });

  it('keeps the save error visible after the ballot turns read-only', async () => {
    const onSave = vi.fn().mockRejectedValue({ code: 'permission-denied' });
    const user = userEvent.setup();
    const { rerender } = renderBallot({ savedPoints: { s1: 60, s2: 40 }, onSave });
    await user.click(screen.getByRole('button', { name: 'Update bid' }));
    rerender(<Ballot songs={SONGS} budget={100} savedPoints={{ s1: 60, s2: 40 }} readOnly onSave={onSave} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Bidding closed for this poll.');
  });

  it('is read-only when the poll is closed', () => {
    renderBallot({ savedPoints: { s1: 60, s2: 40 }, readOnly: true });
    expect(screen.getByLabelText('Points for Africa')).toBeDisabled();
    expect(screen.getByLabelText('Points for Africa')).toHaveValue(60);
    expect(screen.getByText('Bidding is closed.')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByText(/Budget left/)).not.toBeInTheDocument();
  });

  it('explains that a poll with no songs cannot be bid on', () => {
    render(<Ballot songs={[]} budget={100} savedPoints={undefined} onSave={vi.fn()} />);
    expect(screen.getByText('Add songs to this poll before bidding.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Place bid' })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/Ballot.test.jsx`
Expected: FAIL. The heading is still "My ballot", the button is "Save", and the copy is "Points left".

- [ ] **Step 3: Implement**

`src/components/Ballot.jsx`:

```jsx
import { useState } from 'react';
import { cleanPoints, validateBallot } from '../lib/ballot.js';
import { errorMessage } from '../lib/errors.js';

function initialDraft(songs, savedPoints) {
  return Object.fromEntries(
    songs.map((song) => [song.id, savedPoints?.[song.id] != null ? String(savedPoints[song.id]) : '']),
  );
}

// Members can always write their own bid on an open poll, so a rejection means it just closed.
function saveError(err) {
  return err?.code === 'permission-denied' ? 'Bidding closed for this poll.' : `Could not save: ${errorMessage(err)}`;
}

export default function Ballot({ songs, budget, savedPoints, readOnly = false, onSave }) {
  const [draft, setDraft] = useState(() => initialDraft(songs, savedPoints));
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);

  const songIds = songs.map((song) => song.id);
  const result = validateBallot(draft, songIds, budget);
  const invalid = new Set(result.invalidSongIds);

  function handleChange(songId, value) {
    setDraft((current) => ({ ...current, [songId]: value }));
    setStatus(null);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (readOnly || !result.valid) return;
    setSaving(true);
    try {
      await onSave(cleanPoints(draft, songIds, budget));
      setStatus({ ok: true, text: 'Bid saved.' });
    } catch (err) {
      setStatus({ ok: false, text: saveError(err) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="ballot panel" onSubmit={handleSubmit}>
      <h2>My bid</h2>
      {songs.map((song) => (
        <label key={song.id} className="ballot-row">
          <span>
            {song.title}
            {song.artist && <span className="muted"> — {song.artist}</span>}
          </span>
          <input
            type="number"
            min="0"
            max={budget}
            step="1"
            inputMode="numeric"
            aria-label={`Points for ${song.title}`}
            aria-invalid={!readOnly && invalid.has(song.id)}
            disabled={readOnly}
            value={draft[song.id] ?? ''}
            onChange={(event) => handleChange(song.id, event.target.value)}
          />
        </label>
      ))}
      {readOnly ? (
        <p className="hint">Bidding is closed.</p>
      ) : (
        <>
          <p className="points-left">
            Budget left: {result.remaining} / {budget}
          </p>
          {result.errors.map((text) => (
            <p key={text} className="hint">{text}</p>
          ))}
          <button type="submit" disabled={!result.valid || saving}>
            {saving ? 'Saving…' : savedPoints ? 'Update bid' : 'Place bid'}
          </button>
        </>
      )}
      {status && (
        <p role={status.ok ? 'status' : 'alert'} className={status.ok ? 'ok' : 'error'}>
          {status.text}
        </p>
      )}
    </form>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/Ballot.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/Ballot.jsx src/components/Ballot.test.jsx
git commit -m "feat: turn the ballot into a budget-aware bid form"
```

---

### Task 7: Ranking score bars, Countdown and PollStatus badges

**Files:**
- Modify: `src/components/Ranking.jsx` (whole file)
- Create: `src/components/Ranking.test.jsx`
- Create: `src/components/Countdown.jsx`
- Create: `src/components/PollStatus.jsx`
- Create: `src/components/PollStatus.test.jsx`

**Interfaces:**
- Consumes: `formatCountdown`, `pollSettings` and `isPollClosed` from Task 1.
- Produces:
  - `<Ranking rows showScores canRemove onRemoveSong />`
    - `rows` comes from `computeRanking`.
    - `showScores` defaults to `true`. When `false`, it renders a plain song list with no points, bars or breakdown.
    - `canRemove` shows the Remove buttons.
  - `<Countdown endsAt: Date now: Date />` renders `<span class="badge badge-countdown">Closes in …</span>`, or nothing at or past zero.
  - `<PollStatus poll now />` renders one status badge (**Open**, the Countdown, or **Closed**) plus a **Sealed** badge when it applies, all inside `<span class="poll-status">`.

- [ ] **Step 1: Write the failing tests**

`src/components/Ranking.test.jsx`:

```jsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Ranking from './Ranking.jsx';

const AFRICA = { id: 's1', title: 'Africa', artist: 'Toto' };
const CREEP = { id: 's2', title: 'Creep', artist: 'Radiohead' };
const ROWS = [
  { song: AFRICA, total: 80, breakdown: [{ email: 'a@gmail.com', points: 80 }] },
  { song: CREEP, total: 20, breakdown: [{ email: 'b@gmail.com', points: 20 }] },
];

describe('Ranking', () => {
  it('shows totals, breakdowns and bars scaled to the leader', () => {
    const { container } = render(<Ranking rows={ROWS} canRemove={false} onRemoveSong={vi.fn()} />);
    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('80 pts');
    expect(items[0]).toHaveTextContent('a@gmail.com 80');
    const bars = container.querySelectorAll('.score-bar > span');
    expect(bars[0]).toHaveStyle({ width: '100%' });
    expect(bars[1]).toHaveStyle({ width: '25%' });
  });

  it('draws empty bars when nobody has bid', () => {
    const rows = ROWS.map((row) => ({ ...row, total: 0, breakdown: [] }));
    const { container } = render(<Ranking rows={rows} canRemove={false} onRemoveSong={vi.fn()} />);
    expect(container.querySelector('.score-bar > span')).toHaveStyle({ width: '0%' });
  });

  it('can list songs without scores', () => {
    const { container } = render(<Ranking rows={ROWS} showScores={false} canRemove={false} onRemoveSong={vi.fn()} />);
    expect(screen.getByText('Africa')).toBeInTheDocument();
    expect(screen.queryByText(/pts/)).not.toBeInTheDocument();
    expect(screen.queryByText(/a@gmail.com/)).not.toBeInTheDocument();
    expect(container.querySelector('.score-bar')).toBeNull();
  });

  it('shows Remove buttons only when allowed', async () => {
    const onRemoveSong = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<Ranking rows={ROWS} canRemove={false} onRemoveSong={onRemoveSong} />);
    expect(screen.queryByRole('button', { name: 'Remove Africa' })).not.toBeInTheDocument();
    rerender(<Ranking rows={ROWS} showScores={false} canRemove onRemoveSong={onRemoveSong} />);
    await user.click(screen.getByRole('button', { name: 'Remove Africa' }));
    expect(onRemoveSong).toHaveBeenCalledWith(AFRICA);
  });

  it('says when there are no songs', () => {
    render(<Ranking rows={[]} canRemove={false} onRemoveSong={vi.fn()} />);
    expect(screen.getByText('No songs in this poll yet.')).toBeInTheDocument();
  });
});
```

`src/components/PollStatus.test.jsx`:

```jsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import Countdown from './Countdown.jsx';
import PollStatus from './PollStatus.jsx';

const NOW = new Date(2026, 9, 12, 12, 0, 0);
const at = (ms) => new Date(NOW.getTime() + ms);

describe('Countdown', () => {
  it('shows the time left', () => {
    render(<Countdown endsAt={at(12 * 60_000 + 5000)} now={NOW} />);
    expect(screen.getByText('Closes in 12m 05s')).toHaveClass('badge', 'badge-countdown');
  });

  it('renders nothing at or past the end', () => {
    const { container } = render(<Countdown endsAt={NOW} now={NOW} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('PollStatus', () => {
  it('shows Open for a poll with no end date', () => {
    render(<PollStatus poll={{}} now={NOW} />);
    expect(screen.getByText('Open')).toHaveClass('badge-open');
    expect(screen.queryByText('Sealed')).not.toBeInTheDocument();
  });

  it('shows a live countdown instead of Open when an end date is set', () => {
    render(<PollStatus poll={{ endsAt: at(2 * 3_600_000) }} now={NOW} />);
    expect(screen.getByText('Closes in 2h 0m')).toBeInTheDocument();
    expect(screen.queryByText('Open')).not.toBeInTheDocument();
  });

  it('shows Closed when closed by hand or past the end date', () => {
    const { rerender } = render(<PollStatus poll={{ closed: true, endsAt: at(60_000) }} now={NOW} />);
    expect(screen.getByText('Closed')).toHaveClass('badge-closed');
    expect(screen.queryByText(/Closes in/)).not.toBeInTheDocument();
    rerender(<PollStatus poll={{ endsAt: at(-1) }} now={NOW} />);
    expect(screen.getByText('Closed')).toBeInTheDocument();
  });

  it('adds a Sealed badge to sealed polls', () => {
    render(<PollStatus poll={{ sealed: true }} now={NOW} />);
    expect(screen.getByText('Sealed')).toHaveClass('badge-sealed');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/Ranking.test.jsx src/components/PollStatus.test.jsx`
Expected: FAIL. `Countdown.jsx` and `PollStatus.jsx` don't exist, and Ranking has no `.score-bar`.

- [ ] **Step 3: Implement**

`src/components/Ranking.jsx`:

```jsx
export default function Ranking({ rows, showScores = true, canRemove, onRemoveSong }) {
  if (rows.length === 0) return <p>No songs in this poll yet.</p>;

  const leader = rows[0].total;

  return (
    <ol className="ranking">
      {rows.map(({ song, total, breakdown }) => (
        <li key={song.id}>
          <div className="ranking-head">
            <span>
              {song.title}
              {song.artist && <span className="muted"> — {song.artist}</span>}
            </span>
            {showScores && <span className="pts-pill">{total} pts</span>}
            {canRemove && (
              <button
                type="button"
                className="danger"
                aria-label={`Remove ${song.title}`}
                onClick={() => onRemoveSong(song)}
              >
                Remove
              </button>
            )}
          </div>
          {showScores && (
            <div className="score-bar" aria-hidden="true">
              <span style={{ width: `${leader > 0 ? Math.round((total / leader) * 100) : 0}%` }} />
            </div>
          )}
          {showScores && breakdown.length > 0 && (
            <p className="breakdown muted">
              {breakdown.map((entry) => `${entry.email} ${entry.points}`).join(' · ')}
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}
```

`src/components/Countdown.jsx`:

```jsx
import { formatCountdown } from '../lib/poll.js';

export default function Countdown({ endsAt, now }) {
  const text = formatCountdown(endsAt.getTime() - now.getTime());
  if (!text) return null;
  return <span className="badge badge-countdown">Closes in {text}</span>;
}
```

`src/components/PollStatus.jsx`:

```jsx
import { isPollClosed, pollSettings } from '../lib/poll.js';
import Countdown from './Countdown.jsx';

export default function PollStatus({ poll, now }) {
  const { sealed, endsAt } = pollSettings(poll);
  const closed = isPollClosed(poll, now);

  let status;
  if (closed) status = <span className="badge badge-closed">Closed</span>;
  else if (endsAt) status = <Countdown endsAt={endsAt} now={now} />;
  else status = <span className="badge badge-open">Open</span>;

  return (
    <span className="poll-status">
      {status}
      {sealed && <span className="badge badge-sealed">Sealed</span>}
    </span>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/Ranking.test.jsx src/components/PollStatus.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/Ranking.jsx src/components/Ranking.test.jsx src/components/Countdown.jsx src/components/PollStatus.jsx src/components/PollStatus.test.jsx
git commit -m "feat: add score bars, countdown and poll status badges"
```

---

### Task 8: Admin poll settings panel

**Files:**
- Create: `src/components/PollSettings.jsx`
- Create: `src/components/PollSettings.test.jsx`

**Interfaces:**
- Consumes: `parseBudget`, `isValidBudget`, `BUDGET_ERROR`, `parseDateTimeLocal`, `toDateTimeLocal` (Task 1), and `errorMessage`.
- Produces: `<PollSettings settings closed onSave onClose onReopen />`.
  - `settings` is a `pollSettings(...)` result.
  - `onSave(changes: { endsAt: Date | null, budget?: number, sealed?: boolean }) → Promise`. `budget` and `sealed` are omitted when locked.
  - `onClose() → Promise` and `onReopen() → Promise`.
  - The parent must give it a `key` derived from server state (Task 9), so local form state resets when the poll changes.

- [ ] **Step 1: Write the failing test**

`src/components/PollSettings.test.jsx`:

```jsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PollSettings from './PollSettings.jsx';

const OPEN = { budget: 100, sealed: false, closed: false, endsAt: null, hasBids: false };

function renderSettings(props = {}) {
  const handlers = {
    onSave: vi.fn().mockResolvedValue(undefined),
    onClose: vi.fn().mockResolvedValue(undefined),
    onReopen: vi.fn().mockResolvedValue(undefined),
  };
  render(<PollSettings settings={OPEN} closed={false} {...handlers} {...props} />);
  return { ...handlers, ...props };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('PollSettings', () => {
  it('shows the current settings', () => {
    renderSettings({ settings: { ...OPEN, budget: 150, sealed: true, endsAt: new Date(2026, 9, 16, 20, 0) } });
    expect(screen.getByRole('heading', { name: 'Poll settings' })).toBeInTheDocument();
    expect(screen.getByLabelText('End date')).toHaveValue('2026-10-16T20:00');
    expect(screen.getByLabelText('Budget')).toHaveValue(150);
    expect(screen.getByRole('radio', { name: 'Sealed' })).toBeChecked();
  });

  it('saves end date, budget and visibility before any bids', async () => {
    const user = userEvent.setup();
    const { onSave } = renderSettings();
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-10-16T20:00' } });
    await user.clear(screen.getByLabelText('Budget'));
    await user.type(screen.getByLabelText('Budget'), '150');
    await user.click(screen.getByRole('radio', { name: 'Sealed' }));
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(onSave).toHaveBeenCalledWith({ endsAt: new Date(2026, 9, 16, 20, 0), budget: 150, sealed: true });
    expect(screen.getByRole('status')).toHaveTextContent('Settings saved.');
  });

  it('clears the end date when the field is emptied', async () => {
    const user = userEvent.setup();
    const { onSave } = renderSettings({ settings: { ...OPEN, endsAt: new Date(2026, 9, 16, 20, 0) } });
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '' } });
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(onSave).toHaveBeenCalledWith({ endsAt: null, budget: 100, sealed: false });
  });

  it('rejects an invalid budget', async () => {
    const user = userEvent.setup();
    const { onSave } = renderSettings();
    await user.clear(screen.getByLabelText('Budget'));
    await user.type(screen.getByLabelText('Budget'), '0');
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Budget must be a whole number from 1 to 1000.');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('locks budget and visibility once bids exist and saves only the end date', async () => {
    const user = userEvent.setup();
    const { onSave } = renderSettings({ settings: { ...OPEN, hasBids: true } });
    expect(screen.getByLabelText('Budget')).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Open' })).toBeDisabled();
    expect(screen.getByText('Locked — bids have been placed.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(onSave).toHaveBeenCalledWith({ endsAt: null });
  });

  it('closes an open poll after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    const { onClose } = renderSettings();
    await user.click(screen.getByRole('button', { name: 'Close now' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('does not close when confirmation is cancelled', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();
    const { onClose } = renderSettings();
    await user.click(screen.getByRole('button', { name: 'Close now' }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('reopens a closed poll after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    const { onReopen } = renderSettings({ closed: true });
    expect(screen.queryByRole('button', { name: 'Close now' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reopen' }));
    expect(onReopen).toHaveBeenCalled();
  });

  it('shows an error when an action fails', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    renderSettings({ onClose: vi.fn().mockRejectedValue({ code: 'permission-denied' }) });
    await user.click(screen.getByRole('button', { name: 'Close now' }));
    expect(screen.getByRole('alert')).toHaveTextContent("Could not update poll: You don't have access.");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/PollSettings.test.jsx`
Expected: FAIL. Vite can't resolve `./PollSettings.jsx`.

- [ ] **Step 3: Implement**

`src/components/PollSettings.jsx`:

```jsx
import { useState } from 'react';
import { errorMessage } from '../lib/errors.js';
import {
  BUDGET_ERROR,
  MAX_BUDGET,
  MIN_BUDGET,
  isValidBudget,
  parseBudget,
  parseDateTimeLocal,
  toDateTimeLocal,
} from '../lib/poll.js';

export default function PollSettings({ settings, closed, onSave, onClose, onReopen }) {
  const [endsAt, setEndsAt] = useState(() => toDateTimeLocal(settings.endsAt));
  const [budget, setBudget] = useState(() => String(settings.budget));
  const [sealed, setSealed] = useState(settings.sealed);
  const [status, setStatus] = useState(null);
  const locked = settings.hasBids;

  async function run(action, okText) {
    try {
      await action();
      setStatus({ ok: true, text: okText });
    } catch (err) {
      setStatus({ ok: false, text: `Could not update poll: ${errorMessage(err)}` });
    }
  }

  function handleSave(event) {
    event.preventDefault();
    const changes = { endsAt: parseDateTimeLocal(endsAt) };
    if (!locked) {
      const n = parseBudget(budget);
      if (!isValidBudget(n)) {
        setStatus({ ok: false, text: BUDGET_ERROR });
        return;
      }
      changes.budget = n;
      changes.sealed = sealed;
    }
    run(() => onSave(changes), 'Settings saved.');
  }

  function handleToggle() {
    if (closed) {
      if (window.confirm('Reopen this poll for bidding?')) run(onReopen, 'Poll reopened.');
    } else if (window.confirm('Close this poll now? Members will no longer be able to bid.')) {
      run(onClose, 'Poll closed.');
    }
  }

  return (
    <section className="panel poll-settings" aria-labelledby="poll-settings-heading">
      <h2 id="poll-settings-heading">Poll settings</h2>
      <button type="button" className={closed ? 'secondary' : 'danger'} onClick={handleToggle}>
        {closed ? 'Reopen' : 'Close now'}
      </button>
      <form className="settings-form" onSubmit={handleSave}>
        <label className="field">
          End date
          <input type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} />
        </label>
        <label className="field">
          Budget
          <input
            type="number"
            min={MIN_BUDGET}
            max={MAX_BUDGET}
            step="1"
            inputMode="numeric"
            disabled={locked}
            value={budget}
            onChange={(event) => setBudget(event.target.value)}
          />
        </label>
        <fieldset className="field" disabled={locked}>
          <legend>Visibility</legend>
          <label>
            <input type="radio" name="settings-visibility" checked={!sealed} onChange={() => setSealed(false)} />
            Open
          </label>
          <label>
            <input type="radio" name="settings-visibility" checked={sealed} onChange={() => setSealed(true)} />
            Sealed
          </label>
        </fieldset>
        {locked && <p className="hint">Locked — bids have been placed.</p>}
        <button type="submit">Save settings</button>
      </form>
      {status && (
        <p role={status.ok ? 'status' : 'alert'} className={status.ok ? 'ok' : 'error'}>
          {status.text}
        </p>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/PollSettings.test.jsx`
Expected: PASS.

Date inputs are driven with `fireEvent.change`, because `user.type` doesn't fill `datetime-local` inputs reliably in jsdom.

- [ ] **Step 5: Commit**

```bash
git add src/components/PollSettings.jsx src/components/PollSettings.test.jsx
git commit -m "feat: add admin poll settings panel"
```

---

### Task 9: Poll page brings it together

**Files:**
- Modify: `src/pages/PollPage.jsx` (whole file)
- Modify: `src/pages/PollPage.test.jsx` (whole file)

**Interfaces:**
- Consumes:
  - `usePoll(pollId, myEmail, now)` (Task 5) and `useNow()` (Task 1)
  - `computeRanking(songs, bids, budget)` (Task 2)
  - `addSong`, `removeSong`, `saveBid`, `updatePollSettings`, `closePoll` and `reopenPoll` (Task 4)
  - `Ballot` (Task 6), `Ranking` and `PollStatus` (Task 7), `PollSettings` (Task 8), `AddSongForm` (unchanged)
- Produces: the finished poll page.

- [ ] **Step 1: Rewrite the tests**

`src/pages/PollPage.test.jsx`:

```jsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { canSeeAllBids, isPollClosed, pollSettings } from '../lib/poll.js';

vi.mock('../hooks/usePoll.js', () => ({ usePoll: vi.fn() }));
vi.mock('../lib/db.js', () => ({
  addSong: vi.fn(),
  removeSong: vi.fn(),
  saveBid: vi.fn(),
  updatePollSettings: vi.fn(),
  closePoll: vi.fn(),
  reopenPoll: vi.fn(),
}));

import { usePoll } from '../hooks/usePoll.js';
import { addSong, closePoll, removeSong, reopenPoll, saveBid } from '../lib/db.js';
import PollPage from './PollPage.jsx';

const ADMIN = { email: 'admin@gmail.com', isAdmin: true };
const MEMBER = { email: 'member@gmail.com', isAdmin: false };
const SONGS = [
  { id: 's1', title: 'Africa', artist: 'Toto' },
  { id: 's2', title: 'Creep', artist: 'Radiohead' },
  { id: 's3', title: 'Zombie', artist: 'The Cranberries' },
];
const BIDS = [
  { email: 'member@gmail.com', points: { s1: 30, s3: 70 } },
  { email: 'admin@gmail.com', points: { s2: 100 } },
];

// Mirrors the real hook's derived fields so time-based behavior can be tested through the page.
function mockPoll(poll, { bids = BIDS, songs = SONGS } = {}) {
  usePoll.mockImplementation((pollId, myEmail, now) => {
    const bidsVisible = poll !== null && canSeeAllBids(poll, now);
    const visible = bidsVisible ? bids : bids.filter((bid) => bid.email === myEmail);
    return {
      poll,
      settings: pollSettings(poll),
      closed: poll !== null && isPollClosed(poll, now),
      bidsVisible,
      songs,
      bids: visible,
      myBid: visible.find((bid) => bid.email === myEmail) ?? null,
      loading: false,
      error: null,
    };
  });
}

function renderPage(me) {
  return render(
    <MemoryRouter initialEntries={['/polls/p1']}>
      <Routes>
        <Route path="/polls/:pollId" element={<PollPage me={me} />} />
      </Routes>
    </MemoryRouter>,
  );
}

const rankingItems = () => within(screen.getByRole('list')).getAllByRole('listitem');

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  mockPoll({ id: 'p1', title: 'Summer set', hasBids: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('PollPage — open poll', () => {
  it('shows the title, status, budget and a live ranking with breakdowns', () => {
    renderPage(MEMBER);
    expect(usePoll).toHaveBeenCalledWith('p1', 'member@gmail.com', expect.any(Date));
    expect(screen.getByRole('heading', { name: 'Summer set' })).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByText('Budget: 100 pts')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ranking' })).toBeInTheDocument();
    const items = rankingItems();
    expect(items[0]).toHaveTextContent('Creep');
    expect(items[0]).toHaveTextContent('100 pts');
    expect(items[1]).toHaveTextContent('member@gmail.com 70');
  });

  it("pre-fills the member's own bid", () => {
    renderPage(MEMBER);
    expect(screen.getByLabelText('Points for Africa')).toHaveValue(30);
    expect(screen.getByLabelText('Points for Zombie')).toHaveValue(70);
  });

  it('saves the bid, passing whether the poll already has bids', async () => {
    saveBid.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage(MEMBER);
    await user.clear(screen.getByLabelText('Points for Africa'));
    await user.type(screen.getByLabelText('Points for Africa'), '20');
    await user.type(screen.getByLabelText('Points for Creep'), '10');
    await user.click(screen.getByRole('button', { name: 'Update bid' }));
    expect(saveBid).toHaveBeenCalledWith('p1', 'member@gmail.com', { s1: 20, s2: 10, s3: 70 }, { hasBids: true });
  });

  it('uses the poll budget', () => {
    mockPoll({ id: 'p1', title: 'Summer set', budget: 150 }, { bids: [] });
    renderPage(MEMBER);
    expect(screen.getByText('Budget: 150 pts')).toBeInTheDocument();
    expect(screen.getByText('Budget left: 150 / 150')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Place bid' })).toBeDisabled();
  });

  it('hides song management and settings from non-admins', () => {
    renderPage(MEMBER);
    expect(screen.queryByRole('button', { name: 'Add song' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove Africa' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Poll settings' })).not.toBeInTheDocument();
  });

  it('lets an admin add a song with trimmed fields', async () => {
    addSong.mockResolvedValue({ id: 's4' });
    const user = userEvent.setup();
    renderPage(ADMIN);
    await user.type(screen.getByLabelText('Song title'), ' Toxic ');
    await user.type(screen.getByLabelText('Artist'), ' Britney Spears ');
    await user.click(screen.getByRole('button', { name: 'Add song' }));
    expect(addSong).toHaveBeenCalledWith('p1', { title: 'Toxic', artist: 'Britney Spears' }, 'admin@gmail.com');
  });

  it('lets an admin remove a song after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    removeSong.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage(ADMIN);
    await user.click(screen.getByRole('button', { name: 'Remove Africa' }));
    expect(removeSong).toHaveBeenCalledWith('p1', 's1');
  });

  it('lets an admin close the poll', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    closePoll.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage(ADMIN);
    await user.click(screen.getByRole('button', { name: 'Close now' }));
    expect(closePoll).toHaveBeenCalledWith('p1');
  });
});

describe('PollPage — sealed poll while open', () => {
  beforeEach(() => {
    mockPoll({ id: 'p1', title: 'Summer set', sealed: true, hasBids: true });
  });

  it('hides scores and other bids but keeps your own bid editable', () => {
    renderPage(MEMBER);
    expect(screen.getByText('Bids are sealed until the poll closes.')).toBeInTheDocument();
    expect(screen.getByText('Sealed')).toBeInTheDocument();
    expect(document.querySelector('.pts-pill')).toBeNull();
    expect(screen.queryByText(/admin@gmail.com/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Points for Africa')).toHaveValue(30);
    expect(screen.getByRole('button', { name: 'Update bid' })).toBeEnabled();
  });

  it('still lists the songs so an admin can remove them', () => {
    renderPage(ADMIN);
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Remove Africa' })).toBeInTheDocument();
  });
});

describe('PollPage — closed poll', () => {
  beforeEach(() => {
    mockPoll({ id: 'p1', title: 'Summer set', closed: true, hasBids: true });
  });

  it('shows final results and a read-only bid', () => {
    renderPage(MEMBER);
    expect(screen.getByText('Closed')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Final results' })).toBeInTheDocument();
    expect(rankingItems()[0]).toHaveTextContent('100 pts');
    expect(screen.getByLabelText('Points for Africa')).toBeDisabled();
    expect(screen.getByText('Bidding is closed.')).toBeInTheDocument();
  });

  it('hides song management from admins and offers Reopen', () => {
    renderPage(ADMIN);
    expect(screen.queryByRole('button', { name: 'Add song' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove Africa' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reopen' })).toBeInTheDocument();
  });

  it('reveals a sealed poll’s bids once closed', () => {
    mockPoll({ id: 'p1', title: 'Summer set', sealed: true, closed: true, hasBids: true });
    renderPage(MEMBER);
    expect(screen.getByText('admin@gmail.com 100')).toBeInTheDocument();
  });

  it('keeps a future end date when reopening a poll closed by hand', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    reopenPoll.mockResolvedValue(undefined);
    mockPoll({ id: 'p1', title: 'Summer set', closed: true, endsAt: new Date(Date.now() + 3_600_000) });
    const user = userEvent.setup();
    renderPage(ADMIN);
    await user.click(screen.getByRole('button', { name: 'Reopen' }));
    expect(reopenPoll).toHaveBeenCalledWith('p1', false);
  });

  it('clears a past end date when reopening', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    reopenPoll.mockResolvedValue(undefined);
    mockPoll({ id: 'p1', title: 'Summer set', endsAt: new Date(Date.now() - 60_000) });
    const user = userEvent.setup();
    renderPage(ADMIN);
    await user.click(screen.getByRole('button', { name: 'Reopen' }));
    expect(reopenPoll).toHaveBeenCalledWith('p1', true);
  });
});

describe('PollPage — countdown', () => {
  it('counts down and switches to the closed view at the end date without a reload', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 12, 12, 0, 0));
    mockPoll({ id: 'p1', title: 'Summer set', endsAt: new Date(2026, 9, 12, 12, 0, 3), hasBids: true });
    renderPage(MEMBER);
    expect(screen.getByText('Closes in 0m 03s')).toBeInTheDocument();
    expect(screen.getByLabelText('Points for Africa')).toBeEnabled();

    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByText('Closes in 0m 02s')).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(2000));
    expect(screen.getByText('Closed')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Final results' })).toBeInTheDocument();
    expect(screen.getByLabelText('Points for Africa')).toBeDisabled();
  });

  it('shows "Tallying final results…" while a sealed poll waits for the server clock', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 12, 12, 0, 0));
    mockPoll({ id: 'p1', title: 'Summer set', sealed: true, endsAt: new Date(2026, 9, 12, 11, 59, 58) });
    renderPage(MEMBER);
    expect(screen.getByText('Tallying final results…')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(3000));
    expect(screen.queryByText('Tallying final results…')).not.toBeInTheDocument();
    expect(screen.getByText('admin@gmail.com 100')).toBeInTheDocument();
  });
});

describe('PollPage — loading states', () => {
  it('says when the poll does not exist', () => {
    mockPoll(null, { bids: [], songs: [] });
    renderPage(MEMBER);
    expect(screen.getByText(/Poll not found/)).toBeInTheDocument();
  });

  it('shows a load error', () => {
    usePoll.mockReturnValue({
      poll: null,
      settings: pollSettings(null),
      closed: false,
      bidsVisible: false,
      songs: [],
      bids: [],
      myBid: null,
      loading: false,
      error: { code: 'permission-denied' },
    });
    renderPage(MEMBER);
    expect(screen.getByRole('alert')).toHaveTextContent("You don't have access.");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/pages/PollPage.test.jsx`
Expected: FAIL. The page still imports `saveVote`, calls `usePoll(pollId)` and has no status or settings.

- [ ] **Step 3: Implement**

`src/pages/PollPage.jsx`:

```jsx
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import AddSongForm from '../components/AddSongForm.jsx';
import Ballot from '../components/Ballot.jsx';
import PollSettings from '../components/PollSettings.jsx';
import PollStatus from '../components/PollStatus.jsx';
import Ranking from '../components/Ranking.jsx';
import { useNow } from '../hooks/useNow.js';
import { usePoll } from '../hooks/usePoll.js';
import { addSong, closePoll, removeSong, reopenPoll, saveBid, updatePollSettings } from '../lib/db.js';
import { errorMessage } from '../lib/errors.js';
import { computeRanking } from '../lib/ranking.js';

export default function PollPage({ me }) {
  const { pollId } = useParams();
  const now = useNow();
  const { poll, settings, closed, bidsVisible, songs, bids, myBid, loading, error } = usePoll(pollId, me.email, now);
  const [actionError, setActionError] = useState(null);

  if (loading) return <p className="status">Loading…</p>;
  if (error) return <p role="alert" className="error">{errorMessage(error)}</p>;
  if (!poll) {
    return (
      <p>
        Poll not found. <Link to="/">Back to polls</Link>
      </p>
    );
  }

  const rows = computeRanking(songs, bidsVisible ? bids : [], settings.budget);
  const endsAtPassed = settings.endsAt !== null && settings.endsAt <= now;
  // Remount the settings form whenever the server-side settings change, so it never re-saves stale values.
  const settingsKey = [settings.closed, settings.endsAt?.getTime(), settings.budget, settings.sealed, settings.hasBids].join('|');

  async function handleRemoveSong(song) {
    if (!window.confirm(`Remove "${song.title}"? Points bid on it will be dropped.`)) return;
    try {
      await removeSong(pollId, song.id);
      setActionError(null);
    } catch (err) {
      setActionError(`Could not remove song: ${errorMessage(err)}`);
    }
  }

  let sealedNote = null;
  if (!bidsVisible) sealedNote = closed ? 'Tallying final results…' : 'Bids are sealed until the poll closes.';

  return (
    <section>
      <p>
        <Link to="/">← All polls</Link>
      </p>
      <h1 className="poll-title gradient-text">{poll.title}</h1>
      <div className="poll-meta">
        <PollStatus poll={poll} now={now} />
        <span className="muted">Budget: {settings.budget} pts</span>
      </div>
      {actionError && <p role="alert" className="error">{actionError}</p>}
      {me.isAdmin && (
        <PollSettings
          key={settingsKey}
          settings={settings}
          closed={closed}
          onSave={(changes) => updatePollSettings(pollId, changes)}
          onClose={() => closePoll(pollId)}
          onReopen={() => reopenPoll(pollId, endsAtPassed)}
        />
      )}
      <h2>{closed ? 'Final results' : 'Ranking'}</h2>
      {sealedNote && <p className="hint">{sealedNote}</p>}
      <Ranking
        rows={rows}
        showScores={bidsVisible}
        canRemove={me.isAdmin && !closed}
        onRemoveSong={handleRemoveSong}
      />
      {me.isAdmin && !closed && <AddSongForm onAdd={(song) => addSong(pollId, song, me.email)} />}
      <Ballot
        songs={songs}
        budget={settings.budget}
        savedPoints={myBid?.points}
        readOnly={closed}
        onSave={(points) => saveBid(pollId, me.email, points, { hasBids: settings.hasBids })}
      />
    </section>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/pages/PollPage.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pages/PollPage.jsx src/pages/PollPage.test.jsx
git commit -m "feat: show poll status, countdown, settings and sealed/closed states"
```

---

### Task 10: Create polls with settings and show their status in the list

**Files:**
- Modify: `src/pages/PollsList.jsx` (whole file)
- Modify: `src/pages/PollsList.test.jsx` (whole file)

**Interfaces:**
- Consumes:
  - `createPoll({ title, budget, sealed, endsAt }, byEmail)` and `deletePoll(pollId)` (Task 4)
  - `useNow(enabled)`, `DEFAULT_BUDGET`, `MIN_BUDGET`, `MAX_BUDGET`, `BUDGET_ERROR`, `parseBudget`, `isValidBudget`, `parseDateTimeLocal`, `pollSettings` (Task 1)
  - `PollStatus` (Task 7)
- Produces: the finished polls list.

- [ ] **Step 1: Rewrite the tests**

`src/pages/PollsList.test.jsx`:

```jsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../hooks/usePolls.js', () => ({ usePolls: vi.fn() }));
vi.mock('../lib/db.js', () => ({ createPoll: vi.fn(), deletePoll: vi.fn() }));

import { usePolls } from '../hooks/usePolls.js';
import { createPoll, deletePoll } from '../lib/db.js';
import PollsList from './PollsList.jsx';

const ADMIN = { email: 'admin@gmail.com', isAdmin: true };
const MEMBER = { email: 'member@gmail.com', isAdmin: false };
const POLLS = [
  { id: 'p2', title: 'Winter set' },
  { id: 'p1', title: 'Summer set', closed: true, sealed: true },
];

function renderPage(me) {
  return render(
    <MemoryRouter>
      <PollsList me={me} />
    </MemoryRouter>,
  );
}

const rowFor = (title) => screen.getByRole('link', { name: title }).closest('li');

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  usePolls.mockReturnValue({ data: POLLS, loading: false, error: null });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('PollsList', () => {
  it('links each poll to its page', () => {
    renderPage(MEMBER);
    expect(screen.getByRole('link', { name: 'Winter set' })).toHaveAttribute('href', '/polls/p2');
    expect(screen.getByRole('link', { name: 'Summer set' })).toHaveAttribute('href', '/polls/p1');
  });

  it('shows each poll’s status and a Sealed badge', () => {
    renderPage(MEMBER);
    expect(within(rowFor('Winter set')).getByText('Open')).toBeInTheDocument();
    expect(within(rowFor('Summer set')).getByText('Closed')).toBeInTheDocument();
    expect(within(rowFor('Summer set')).getByText('Sealed')).toBeInTheDocument();
  });

  it('shows a live countdown for polls with an end date', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 12, 12, 0, 0));
    usePolls.mockReturnValue({
      data: [{ id: 'p3', title: 'Fall set', endsAt: new Date(2026, 9, 14, 16, 30, 0) }],
      loading: false,
      error: null,
    });
    renderPage(MEMBER);
    expect(screen.getByText('Closes in 2d 4h 30m')).toBeInTheDocument();
  });

  it('hides admin controls from non-admins', () => {
    renderPage(MEMBER);
    expect(screen.queryByRole('button', { name: 'Create poll' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
  });

  it('shows an empty state', () => {
    usePolls.mockReturnValue({ data: [], loading: false, error: null });
    renderPage(MEMBER);
    expect(screen.getByText('No polls yet.')).toBeInTheDocument();
  });

  it('shows a load error', () => {
    usePolls.mockReturnValue({ data: [], loading: false, error: { code: 'permission-denied' } });
    renderPage(MEMBER);
    expect(screen.getByRole('alert')).toHaveTextContent("You don't have access.");
  });

  it('defaults the create form to budget 100, open visibility and no end date', () => {
    renderPage(ADMIN);
    expect(screen.getByLabelText('Budget')).toHaveValue(100);
    expect(screen.getByRole('radio', { name: /^Open/ })).toBeChecked();
    expect(screen.getByLabelText('End date (optional)')).toHaveValue('');
  });

  it('rejects a blank poll title', async () => {
    const user = userEvent.setup();
    renderPage(ADMIN);
    await user.type(screen.getByLabelText('New poll title'), '   ');
    await user.click(screen.getByRole('button', { name: 'Create poll' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Poll title is required.');
    expect(createPoll).not.toHaveBeenCalled();
  });

  it('rejects an invalid budget', async () => {
    const user = userEvent.setup();
    renderPage(ADMIN);
    await user.type(screen.getByLabelText('New poll title'), 'Fall set');
    await user.clear(screen.getByLabelText('Budget'));
    await user.type(screen.getByLabelText('Budget'), '1001');
    await user.click(screen.getByRole('button', { name: 'Create poll' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Budget must be a whole number from 1 to 1000.');
    expect(createPoll).not.toHaveBeenCalled();
  });

  it('rejects an end date in the past', async () => {
    const user = userEvent.setup();
    renderPage(ADMIN);
    await user.type(screen.getByLabelText('New poll title'), 'Fall set');
    fireEvent.change(screen.getByLabelText('End date (optional)'), { target: { value: '2000-01-01T10:00' } });
    await user.click(screen.getByRole('button', { name: 'Create poll' }));
    expect(screen.getByRole('alert')).toHaveTextContent('End date must be in the future.');
    expect(createPoll).not.toHaveBeenCalled();
  });

  it('creates a poll with defaults and a trimmed title, then resets the form', async () => {
    createPoll.mockResolvedValue({ id: 'p3' });
    const user = userEvent.setup();
    renderPage(ADMIN);
    await user.type(screen.getByLabelText('New poll title'), '  Fall set  ');
    await user.click(screen.getByRole('button', { name: 'Create poll' }));
    expect(createPoll).toHaveBeenCalledWith(
      { title: 'Fall set', budget: 100, sealed: false, endsAt: null },
      'admin@gmail.com',
    );
    expect(screen.getByLabelText('New poll title')).toHaveValue('');
  });

  it('creates a sealed poll with a custom budget and end date', async () => {
    createPoll.mockResolvedValue({ id: 'p3' });
    const user = userEvent.setup();
    renderPage(ADMIN);
    await user.type(screen.getByLabelText('New poll title'), 'Fall set');
    await user.clear(screen.getByLabelText('Budget'));
    await user.type(screen.getByLabelText('Budget'), '150');
    await user.click(screen.getByRole('radio', { name: /^Sealed/ }));
    fireEvent.change(screen.getByLabelText('End date (optional)'), { target: { value: '2999-10-16T20:00' } });
    await user.click(screen.getByRole('button', { name: 'Create poll' }));
    expect(createPoll).toHaveBeenCalledWith(
      { title: 'Fall set', budget: 150, sealed: true, endsAt: new Date(2999, 9, 16, 20, 0) },
      'admin@gmail.com',
    );
    expect(screen.getByLabelText('Budget')).toHaveValue(100);
    expect(screen.getByRole('radio', { name: /^Open/ })).toBeChecked();
  });

  it('shows an error when creating fails', async () => {
    createPoll.mockRejectedValue({ code: 'permission-denied' });
    const user = userEvent.setup();
    renderPage(ADMIN);
    await user.type(screen.getByLabelText('New poll title'), 'Fall set');
    await user.click(screen.getByRole('button', { name: 'Create poll' }));
    expect(screen.getByRole('alert')).toHaveTextContent("Could not create poll: You don't have access.");
  });

  it('deletes a poll after confirmation, mentioning bids', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    deletePoll.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage(ADMIN);
    await user.click(screen.getByRole('button', { name: 'Delete Winter set' }));
    expect(confirm).toHaveBeenCalledWith('Delete "Winter set" and all its songs and bids?');
    expect(deletePoll).toHaveBeenCalledWith('p2');
  });

  it('does not delete when confirmation is cancelled', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();
    renderPage(ADMIN);
    await user.click(screen.getByRole('button', { name: 'Delete Winter set' }));
    expect(deletePoll).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/pages/PollsList.test.jsx`
Expected: FAIL. There's no Budget field and no status badges, and `createPoll` is called with `(title, email)`.

- [ ] **Step 3: Implement**

`src/pages/PollsList.jsx`:

```jsx
import { useState } from 'react';
import { Link } from 'react-router-dom';
import PollStatus from '../components/PollStatus.jsx';
import { useNow } from '../hooks/useNow.js';
import { usePolls } from '../hooks/usePolls.js';
import { createPoll, deletePoll } from '../lib/db.js';
import { errorMessage } from '../lib/errors.js';
import {
  BUDGET_ERROR,
  DEFAULT_BUDGET,
  MAX_BUDGET,
  MIN_BUDGET,
  isValidBudget,
  parseBudget,
  parseDateTimeLocal,
  pollSettings,
} from '../lib/poll.js';

const EMPTY_FORM = { title: '', budget: String(DEFAULT_BUDGET), sealed: false, endsAt: '' };

export default function PollsList({ me }) {
  const { data: polls, loading, error } = usePolls();
  const [form, setForm] = useState(EMPTY_FORM);
  const [actionError, setActionError] = useState(null);
  // Only tick when there's a countdown to show.
  const now = useNow(polls.some((poll) => pollSettings(poll).endsAt !== null));

  const update = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }));

  async function handleCreate(event) {
    event.preventDefault();
    const title = form.title.trim();
    const budget = parseBudget(form.budget);
    const endsAt = parseDateTimeLocal(form.endsAt);
    if (!title) {
      setActionError('Poll title is required.');
      return;
    }
    if (!isValidBudget(budget)) {
      setActionError(BUDGET_ERROR);
      return;
    }
    if (endsAt && endsAt <= new Date()) {
      setActionError('End date must be in the future.');
      return;
    }
    try {
      await createPoll({ title, budget, sealed: form.sealed, endsAt }, me.email);
      setForm(EMPTY_FORM);
      setActionError(null);
    } catch (err) {
      setActionError(`Could not create poll: ${errorMessage(err)}`);
    }
  }

  async function handleDelete(poll) {
    if (!window.confirm(`Delete "${poll.title}" and all its songs and bids?`)) return;
    try {
      await deletePoll(poll.id);
      setActionError(null);
    } catch (err) {
      setActionError(`Could not delete poll: ${errorMessage(err)}`);
    }
  }

  if (loading) return <p className="status">Loading…</p>;
  if (error) return <p role="alert" className="error">{errorMessage(error)}</p>;

  return (
    <section>
      <h1>Polls</h1>
      {me.isAdmin && (
        <form className="create-poll-form panel" onSubmit={handleCreate}>
          <input
            aria-label="New poll title"
            placeholder="New poll title"
            value={form.title}
            onChange={update('title')}
          />
          <label className="field">
            Budget
            <input
              type="number"
              min={MIN_BUDGET}
              max={MAX_BUDGET}
              step="1"
              inputMode="numeric"
              value={form.budget}
              onChange={update('budget')}
            />
          </label>
          <label className="field">
            End date (optional)
            <input type="datetime-local" value={form.endsAt} onChange={update('endsAt')} />
          </label>
          <fieldset className="field">
            <legend>Visibility</legend>
            <label>
              <input
                type="radio"
                name="create-visibility"
                checked={!form.sealed}
                onChange={() => setForm((current) => ({ ...current, sealed: false }))}
              />
              Open <span className="muted">— everyone sees bids and the ranking live</span>
            </label>
            <label>
              <input
                type="radio"
                name="create-visibility"
                checked={form.sealed}
                onChange={() => setForm((current) => ({ ...current, sealed: true }))}
              />
              Sealed <span className="muted">— bids stay hidden until the poll closes</span>
            </label>
          </fieldset>
          <button type="submit">Create poll</button>
        </form>
      )}
      {actionError && <p role="alert" className="error">{actionError}</p>}
      {polls.length === 0 ? (
        <p>No polls yet.</p>
      ) : (
        <ul className="list">
          {polls.map((poll) => (
            <li key={poll.id}>
              <Link to={`/polls/${poll.id}`}>{poll.title}</Link>
              <PollStatus poll={poll} now={now} />
              {me.isAdmin && (
                <button
                  type="button"
                  className="danger"
                  aria-label={`Delete ${poll.title}`}
                  onClick={() => handleDelete(poll)}
                >
                  Delete
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run the full unit suite**

Run: `npm test`
Expected: PASS for every file. With Tasks 1–10 done, nothing should still reference `saveVote`, `votes` or `TOTAL_POINTS`. Check with: `grep -rn "saveVote\|TOTAL_POINTS\|'votes'" src` should only print the `'votes'` line in `src/lib/db.js` (`deletePoll`'s legacy cleanup).

- [ ] **Step 5: Commit**

```bash
git add src/pages/PollsList.jsx src/pages/PollsList.test.jsx
git commit -m "feat: create polls with budget, visibility and end date; show status in list"
```

---

### Task 11: "Fresh & Bright" styling and the app name

**Files:**
- Modify: `src/index.css` (whole file)
- Modify: `src/components/Header.jsx:7`
- Modify: `src/pages/SignIn.jsx:22`
- Modify: `index.html:6`

**Interfaces:**
- Consumes: the class names listed in Global Constraints. Tasks 6–10 already apply them.
- Produces: the visual style. There's no behavior change.

- [ ] **Step 1: Rename the app**

- `src/components/Header.jsx` line 7 becomes:
  ```jsx
        <Link to="/" className="brand gradient-text">Band Song Bids</Link>
  ```
- `src/pages/SignIn.jsx` line 22 becomes:
  ```jsx
        <h1 className="gradient-text">Band Song Bids</h1>
  ```
- `index.html` line 6 becomes:
  ```html
      <title>Band Song Bids</title>
  ```

- [ ] **Step 2: Replace the stylesheet**

`src/index.css`:

```css
:root {
  --bg: #ffffff;
  --surface: #f6f7fb;
  --fg: #1c2033;
  --muted: #646a82;
  --line: #e6e8f0;
  --primary: #6d4aff;
  --primary-soft: #efeaff;
  --primary-ink: #5236d6;
  --spark: #ff6a3d;
  --open-bg: #e8fbef;
  --open-fg: #1d8a4a;
  --closed-bg: #eceef3;
  --closed-fg: #5b6075;
  --sealed-bg: #fff1eb;
  --sealed-fg: #c2461b;
  --danger: #d6334f;
  --ok: #1d8a4a;
  --radius: 8px;
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
  color: var(--fg);
  background: var(--bg);
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #12142a;
    --surface: #1c1f3a;
    --fg: #eef0fa;
    --muted: #a3a8c3;
    --line: #2c3054;
    --primary: #9a82ff;
    --primary-soft: #2a2552;
    --primary-ink: #c8bbff;
    --spark: #ff8a63;
    --open-bg: #143524;
    --open-fg: #5fdc93;
    --closed-bg: #262a45;
    --closed-fg: #b4b9d4;
    --sealed-bg: #3a2218;
    --sealed-fg: #ffa47f;
    --danger: #ff6b81;
    --ok: #5fdc93;
  }
}

body { margin: 0; background: var(--bg); }
main, .center { max-width: 720px; margin: 0 auto; padding: 16px; }
.center { text-align: center; padding-top: 15vh; }
h1, h2 { line-height: 1.2; }
h2 { font-size: 1.15rem; margin: 24px 0 8px; }
a { color: var(--primary); }

.gradient-text {
  background: linear-gradient(90deg, var(--primary), var(--spark));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

/* Header */
.app-header { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid var(--line); background: var(--bg); }
.app-header nav { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
.brand { font-weight: 800; font-size: 1.1rem; text-decoration: none; }

/* Controls */
button { font: inherit; padding: 7px 14px; border-radius: var(--radius); border: 1px solid var(--line); background: var(--bg); color: var(--fg); cursor: pointer; }
button:hover:not(:disabled) { border-color: var(--primary); }
button[type='submit'] { background: var(--primary); border-color: var(--primary); color: #fff; font-weight: 600; }
button.secondary { background: var(--primary-soft); border-color: transparent; color: var(--primary-ink); font-weight: 600; }
button.danger { color: var(--danger); border-color: var(--danger); background: transparent; }
button:disabled { opacity: 0.5; cursor: not-allowed; }
input { font: inherit; padding: 7px 9px; border-radius: var(--radius); border: 1px solid var(--line); background: var(--bg); color: var(--fg); }
input:focus-visible, button:focus-visible { outline: 2px solid var(--primary); outline-offset: 1px; }
input:disabled { opacity: 0.6; }
input[aria-invalid='true'] { border-color: var(--danger); }
fieldset { border: 0; padding: 0; margin: 0; }
legend { padding: 0; margin-bottom: 4px; }

/* Panels and forms */
.panel { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 16px; margin: 16px 0; }
.panel h2 { margin-top: 0; }
.inline-form { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0; }
.create-poll-form, .settings-form { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; }
.create-poll-form > input[aria-label='New poll title'] { flex: 1 1 100%; }
.field { display: flex; flex-direction: column; gap: 4px; font-size: 0.9rem; color: var(--muted); }
.field input[type='number'] { width: 6em; }
.field label { display: block; color: var(--fg); padding: 2px 0; }
.settings-form { margin-top: 12px; }

/* Badges */
.poll-status { display: inline-flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.badge { display: inline-block; font-size: 0.72rem; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; padding: 3px 9px; border-radius: 999px; }
.badge-open { background: var(--open-bg); color: var(--open-fg); }
.badge-closed { background: var(--closed-bg); color: var(--closed-fg); }
.badge-sealed { background: var(--sealed-bg); color: var(--sealed-fg); }
.badge-countdown { background: var(--primary-soft); color: var(--primary-ink); font-variant-numeric: tabular-nums; }
.poll-meta { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin-bottom: 8px; }
.poll-title { margin-bottom: 8px; }

/* Lists */
.list { list-style: none; padding: 0; }
.list li { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; padding: 12px 14px; margin-bottom: 8px; background: var(--surface); border-radius: var(--radius); }
.list li > a { font-weight: 600; margin-right: auto; }

/* Ranking */
.ranking { padding-left: 0; list-style-position: inside; }
.ranking li { padding: 10px 14px; margin-bottom: 8px; background: var(--surface); border-radius: var(--radius); }
.ranking li::marker { font-weight: 700; color: var(--primary); }
.ranking-head { display: inline-flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; width: calc(100% - 2em); }
.pts-pill { margin-left: auto; background: var(--primary-soft); color: var(--primary-ink); font-weight: 700; padding: 2px 10px; border-radius: 999px; font-variant-numeric: tabular-nums; }
.score-bar { height: 6px; border-radius: 3px; background: var(--line); margin-top: 8px; overflow: hidden; }
.score-bar > span { display: block; height: 100%; border-radius: 3px; background: linear-gradient(90deg, var(--primary), var(--spark)); }
.breakdown { margin: 6px 0 0; font-size: 0.85em; }

/* Ballot */
.ballot-row { display: flex; gap: 12px; align-items: center; justify-content: space-between; padding: 6px 0; }
.ballot-row input { width: 5em; }
.points-left { font-weight: 700; color: var(--spark); }

/* Text */
.muted { color: var(--muted); }
.hint { color: var(--muted); margin: 4px 0; }
.error { color: var(--danger); }
.ok { color: var(--ok); }
.status { color: var(--muted); text-align: center; padding: 32px; }
```

- [ ] **Step 3: Verify that tests and the build still pass**

Run: `npm test && npm run build`
Expected: all unit tests PASS, and `vite build` finishes with no errors.

- [ ] **Step 4: Check it in the browser**

Run `npm run dev` and open `http://localhost:5173`. Using the `run` skill or the Chrome tools, check these in both light and dark color schemes and at about 375px width:
- the polls list
- an open poll
- a sealed poll
- a closed poll

Each should look like mockup C, with no horizontal scroll. This step needs a configured `.env` and a signed-in admin. If neither is available, say so in the task report rather than skipping silently.

- [ ] **Step 5: Commit**

```bash
git add src/index.css src/components/Header.jsx src/pages/SignIn.jsx index.html
git commit -m "style: apply Fresh & Bright theme and rename app to Band Song Bids"
```

---

### Task 12: Migrate existing votes to bids

**Files:**
- Create: `scripts/migrate-votes-to-bids.js`
- Create: `tests/migration/migrate-votes-to-bids.test.js`
- Modify: `vitest.rules.config.js` (`include`)
- Modify: `package.json` (add the `migrate:bids` script and the `firebase-admin` dev dependency; `test:rules` keeps its name and now also runs the migration tests)
- Modify: `.gitignore` (service-account keys)

**Interfaces:**
- Consumes: the Firestore layout from Tasks 3–4.
- Produces:
  - `migrateVotesToBids(db: admin Firestore, { dryRun?: boolean }) → Promise<{ polls: number, copied: number, skipped: number, flagged: number }>`
  - CLI: `npm run migrate:bids -- [--dry-run]`

- [ ] **Step 1: Add the dependency and config**

Run: `npm install --save-dev firebase-admin@^14`
Expected: it installs. If it fails with `ETARGET` from the Intuit mirror, stop and report the exact error. Don't add overrides without asking.

In `package.json` `scripts`, add after `"test:rules"`:

```json
    "migrate:bids": "node scripts/migrate-votes-to-bids.js",
```

`vitest.rules.config.js`:

```js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/rules/**/*.test.js', 'tests/migration/**/*.test.js'],
    testTimeout: 20000,
    hookTimeout: 20000,
    fileParallelism: false,
  },
});
```

Append to `.gitignore`:

```
# Service-account keys for one-off admin scripts (never commit)
*service-account*.json
*-firebase-adminsdk-*.json
```

- [ ] **Step 2: Write the failing test**

`tests/migration/migrate-votes-to-bids.test.js`:

```js
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { migrateVotesToBids } from '../../scripts/migrate-votes-to-bids.js';

// firebase-admin talks to the emulator because `firebase emulators:exec` sets FIRESTORE_EMULATOR_HOST.
let app;
let db;

async function clear() {
  for (const poll of (await db.collection('polls').get()).docs) await db.recursiveDelete(poll.ref);
}

beforeAll(() => {
  app = initializeApp({ projectId: 'demo-songvote' }, 'migration-test');
  db = getFirestore(app);
});

afterAll(async () => {
  await clear();
  await deleteApp(app);
});

beforeEach(async () => {
  await clear();
  await db.doc('polls/p1').set({ title: 'Summer set' });
  await db.doc('polls/p1/votes/a@gmail.com').set({ points: { s1: 100 }, updatedAt: new Date(2026, 0, 1) });
  await db.doc('polls/p1/votes/b@gmail.com').set({ points: { s1: 40, s2: 60 } });
  await db.doc('polls/p2').set({ title: 'No votes' });
});

describe('migrateVotesToBids', () => {
  it('reports what it would do on a dry run and writes nothing', async () => {
    const counts = await migrateVotesToBids(db, { dryRun: true });
    expect(counts).toEqual({ polls: 2, copied: 2, skipped: 0, flagged: 1 });
    expect((await db.collection('polls/p1/bids').get()).size).toBe(0);
    expect((await db.doc('polls/p1').get()).get('hasBids')).toBeUndefined();
  });

  it('copies votes to bids, keeps the votes, and flags polls that have them', async () => {
    const counts = await migrateVotesToBids(db);
    expect(counts).toEqual({ polls: 2, copied: 2, skipped: 0, flagged: 1 });
    expect((await db.doc('polls/p1/bids/a@gmail.com').get()).get('points')).toEqual({ s1: 100 });
    expect((await db.doc('polls/p1/bids/b@gmail.com').get()).get('points')).toEqual({ s1: 40, s2: 60 });
    expect((await db.collection('polls/p1/votes').get()).size).toBe(2);
    expect((await db.doc('polls/p1').get()).get('hasBids')).toBe(true);
    expect((await db.doc('polls/p2').get()).get('hasBids')).toBeUndefined();
  });

  it('is a no-op the second time and never overwrites a newer bid', async () => {
    await migrateVotesToBids(db);
    await db.doc('polls/p1/bids/a@gmail.com').set({ points: { s2: 100 } });
    const counts = await migrateVotesToBids(db);
    expect(counts).toEqual({ polls: 2, copied: 0, skipped: 2, flagged: 0 });
    expect((await db.doc('polls/p1/bids/a@gmail.com').get()).get('points')).toEqual({ s2: 100 });
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm run test:rules`
Expected: the migration test FAILS because the script doesn't exist yet. The rules tests still PASS.

- [ ] **Step 4: Implement**

`scripts/migrate-votes-to-bids.js`:

```js
// One-off: copies polls/*/votes/* to polls/*/bids/* and sets hasBids on polls that have votes.
// Safe to re-run: existing bids are never overwritten. Old votes are left in place.
//
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json npm run migrate:bids -- --dry-run
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json npm run migrate:bids
import { pathToFileURL } from 'node:url';
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

export async function migrateVotesToBids(db, { dryRun = false } = {}) {
  const counts = { polls: 0, copied: 0, skipped: 0, flagged: 0 };
  const polls = await db.collection('polls').get();

  for (const poll of polls.docs) {
    counts.polls += 1;
    const votes = await poll.ref.collection('votes').get();
    if (votes.empty) continue;

    for (const vote of votes.docs) {
      const bidRef = poll.ref.collection('bids').doc(vote.id);
      if ((await bidRef.get()).exists) {
        counts.skipped += 1;
        continue;
      }
      counts.copied += 1;
      if (!dryRun) await bidRef.set(vote.data());
    }

    if (poll.get('hasBids') !== true) {
      counts.flagged += 1;
      if (!dryRun) await poll.ref.update({ hasBids: true });
    }
  }

  return counts;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dryRun = process.argv.includes('--dry-run');
  const app = initializeApp({ credential: applicationDefault() });
  const counts = await migrateVotesToBids(getFirestore(app), { dryRun });
  console.log(`${dryRun ? '[dry run] ' : ''}Polls checked: ${counts.polls}`);
  console.log(`${dryRun ? '[dry run] ' : ''}Bids copied: ${counts.copied}, already there: ${counts.skipped}`);
  console.log(`${dryRun ? '[dry run] ' : ''}Polls flagged hasBids: ${counts.flagged}`);
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `npm run test:rules`
Expected: the rules tests and the migration tests all PASS.

Then check that the CLI fails clearly without credentials:

Run: `env -u GOOGLE_APPLICATION_CREDENTIALS npm run migrate:bids -- --dry-run`
Expected: a non-zero exit with a firebase-admin credentials or project-ID error, possibly after a few seconds while it looks for default credentials. If it hasn't exited after 60s, stop it and say so in the task report.

- [ ] **Step 6: Commit**

```bash
git add scripts/migrate-votes-to-bids.js tests/migration/migrate-votes-to-bids.test.js vitest.rules.config.js package.json package-lock.json .gitignore
git commit -m "feat: add one-off migration from votes to bids"
```

---

### Task 13: README and docs say "bid"

**Files:**
- Modify: `README.md` (title, intro, "How it works", sections 5 and 7, Troubleshooting, Project layout, Known limitations; add a section for upgrading an existing deployment)

**Interfaces:**
- Consumes: everything above.
- Produces: user-facing docs.

- [ ] **Step 1: Replace the opening and "How it works"**

Replace everything from the first line through the `---` after "How it works" with:

````markdown
# Band Song Bids

A free web app that helps our cover band pick songs. Each poll has a list of songs and a points budget (100 unless an admin picks another). Every member **bids** their budget across the songs, and the songs are ranked by total points. Only Google accounts on the band list can sign in.

Built with React + Vite on Firebase (Hosting, Authentication, Firestore). Everything runs on Firebase's free **Spark** plan: no credit card and no domain to buy.

## How it works

- **Admins** create and delete polls, add and remove songs, and manage the member list. When creating a poll they choose:
  - **Budget:** the points each member bids, a whole number from 1 to 1000 (default 100).
  - **Visibility:** **Open** (default) shows everyone's bids and the ranking live. **Sealed** shows each member only their own bid until the poll closes.
  - **End date** (optional): the poll closes at that time on its own, with a live countdown until then.
- **Closing:** an admin can also **Close now**, change or clear the end date, or **Reopen** a poll. A closed poll shows its final results, and nobody can place, change or withdraw a bid.
- **Locking:** budget and visibility can be changed until the first bid comes in, then they're locked.
- **Members** bid exactly their whole budget, in whole points, and can change their bid any time until the poll closes.
- **Access** is enforced by Firestore security rules (`firestore.rules`). Closing, sealed visibility and the settings lock are enforced there too. Someone who isn't on the list can sign in with Google but can't read or write anything.

---
````

- [ ] **Step 2: Update section 5 (tests)**

Replace the code block and the paragraph under `## 5. Run the tests` with:

````markdown
```bash
npm test                      # unit and component tests (no Firebase needed)
npm run test:rules            # security rules + migration tests; starts the Firestore emulator, needs Java 21+
```

`test:rules` runs against a local emulator project, `demo-songvote`. It never touches your real database.
````

- [ ] **Step 3: Replace section 7 and add a section 8**

Replace `## 7. Add the band and start voting` and its list with:

````markdown
## 7. Add the band and start bidding

1. Open `https://<project-id>.web.app` and sign in as the admin.
2. **Members** → add each bandmate's Gmail address. Tick **Admin** for anyone who should manage polls too.
3. **Polls** → enter a title, pick a budget, visibility and optional end date → **Create poll** → open it → add songs.
4. Send the link to the band. Each member signs in, bids their whole budget across the songs, and clicks **Place bid**. They can come back and **Update bid** until the poll closes.

## 8. Upgrading from the "votes" version

Earlier versions stored ballots in `polls/{pollId}/votes`. This version reads `polls/{pollId}/bids`, so existing votes have to be copied over once. You only need this if the band already voted with the old version.

1. **Get a service-account key.** In the Firebase console: **Project settings → Service accounts → Generate new private key**. Save the JSON file **outside** this folder. Keys matching `*service-account*.json` or `*-firebase-adminsdk-*.json` are git-ignored as a safety net, but don't rely on that.
2. **Deploy the new version first** (`npm run deploy`), so the new rules are live.
3. **Dry run:**
   ```bash
   GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json npm run migrate:bids -- --dry-run
   ```
   It prints how many polls it checked, how many bids it would copy, and how many polls it would flag as having bids.
4. **Run it for real:**
   ```bash
   GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json npm run migrate:bids
   ```
5. **Check the result:** open a poll in the app and confirm the ranking matches what it was before. Running the script again is safe: it reports `Bids copied: 0`.
6. **Delete the key file** when you're done.

The old `votes` documents are left in place. Only admins can read them. Deleting a poll removes them too.
````

- [ ] **Step 4: Update the Troubleshooting, Project layout and Known limitations sections**

Add these rows to the Troubleshooting table, after the "You don't have access." row:

```markdown
| "Bidding closed for this poll." when saving | The poll closed (by an admin or its end date) while you were editing. Your last saved bid still counts. |
| Old polls show no bids after upgrading | Run the migration in section 8. |
| "Tallying final results…" stays for more than a few seconds | Your device clock is probably ahead. Reload the page; check the device's date and time settings. |
```

Replace the `## Project layout` code block with:

````markdown
```
src/lib/        pure logic (poll settings and countdown, ballot validation, ranking, email) + Firebase client and writes (db.js)
src/hooks/      live Firestore listeners, auth, and the useNow clock
src/components/ Ballot, Ranking, PollStatus, Countdown, PollSettings, AddSongForm, Header
src/pages/      SignIn, NotAuthorized, PollsList, PollPage, Members
firestore.rules security rules; tests in tests/rules/
scripts/        one-off admin scripts (votes → bids migration); tests in tests/migration/
docs/superpowers/ design specs and implementation plans
```
````

Replace the `## Known limitations` list with:

```markdown
- **The exact-budget check runs in the browser.** The "whole numbers that add up to exactly the budget" check is client-side only. Firestore rules can't add up a map of values, and enforcing it on the server would need Cloud Functions, which require the paid Blaze plan. That's fine for trusted bandmates. Closing, sealed visibility and the settings lock *are* enforced by the rules.
- **Removed members' bids still count** in polls they already bid in.
- **Sealed results appear a few seconds after the end date.** The app waits briefly so the server's clock agrees the poll has closed.
- **Admins are bidders too.** A sealed poll hides other members' bids from admins as well, until it closes.
```

- [ ] **Step 5: Check for leftover "vote" wording**

Run: `grep -niI "vot" README.md src index.html | grep -v "\.test\."`
Expected: matches only in README section 8 (which describes the old `votes` data), the `'votes'` legacy cleanup in `src/lib/db.js` and its comment. There should be none in UI copy.

- [ ] **Step 6: Commit**

```bash
git add README.md
git commit -m "docs: describe bidding, budgets, closing, sealed polls and the migration"
```

---

## Final verification

- [ ] Run `npm test`. Expected: all unit and component tests PASS.
- [ ] Run `npm run test:rules` (with `JAVA_HOME` set explicitly, as in Global Constraints). Expected: all rules and migration tests PASS.
- [ ] Run `npm run build`. Expected: the build succeeds.
- [ ] Run `git status`. Expected: a clean working tree on `design/bidding-polls`.
