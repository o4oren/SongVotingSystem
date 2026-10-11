# Song Voting System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A free, web-hosted app where whitelisted band members distribute 100 points across the songs in a poll and see a live ranking.

**Architecture:** React + Vite single-page app on Firebase Hosting. The browser talks directly to Firebase Auth (Google sign-in) and Cloud Firestore; Firestore security rules enforce the whitelist and admin role. Pure logic (ballot validation, ranking, email normalization) lives in `src/lib/` and is unit-tested; Firestore access is isolated in `src/lib/db.js` and `src/hooks/`.

**Tech Stack:** React, Vite, react-router-dom, Firebase JS SDK (modular API: `firebase/app`, `firebase/auth`, `firebase/firestore`), Vitest, React Testing Library, `@firebase/rules-unit-testing`, Firebase CLI (`firebase-tools`, as a dev dependency).

**Spec:** `docs/superpowers/specs/2026-10-11-song-voting-design.md`

## Global Constraints

- Free Firebase Spark plan only: no Cloud Functions, no paid services, no custom domain.
- Node 20+.
- Firestore emulator (rules tests) requires a Java runtime, version 11+. Use an Intuit-approved OpenJDK distribution; set `JAVA_HOME` to that JDK's explicit path (macOS: `<path-to-intended-jdk>/Contents/Home`; list installed JDKs with `/usr/libexec/java_home -V`). Do not select a JDK with a version-only lookup. Do not install a JDK without asking the human.
- Member doc IDs and vote doc IDs are the **trimmed, lowercased** email address. Every email is passed through `normalizeEmail` before use as an ID.
- Ballot: each value is a whole number from 0 to 100; a member's total is exactly `100`. Enforced client-side only (rules can't iterate map values).
- Roles: admins create/delete polls, add/remove songs, manage members. Non-admins only vote.
- Results are live and per-member allocations are visible to all members. Polls never close.
- An admin cannot remove or demote themselves from the UI.
- App display name: `Band Song Vote`.
- Use the Firestore emulator project ID `demo-songvote` for rules tests (the `demo-` prefix needs no real project).

## Review Focus

1. **Email case/whitespace** — an admin adds `" Bob@Gmail.com "` and Google returns `bob@gmail.com` (or vice versa): Bob must still be recognized. Pinned by Task 1 (`normalizeEmail`), Task 4 (mixed-case token rules test), Task 8 (case-insensitive duplicate check), Task 9 (App normalizes before lookup).
2. **Re-adding an existing member** — must be rejected with "already on the list", never silently overwrite (and so demote) an admin. Pinned by Task 5 (`addMember` guard) and Task 8.
3. **Blank fields and empty polls on the ballot** — blank inputs count as 0; a poll with no songs shows "Add songs to this poll before voting." and Save stays disabled. Pinned by Tasks 2 and 7.
4. **Malformed points written by a client bypassing validation** (strings, negatives, >100, `NaN`, missing `points`) — the ranking ignores them instead of crashing or string-concatenating. Pinned by Task 3.
5. **A non-member signs in** — the member-doc read fails with `permission-denied`; the app must show "Not on the band list", not spin forever or crash. Pinned by Task 5 (`useMember`) and Task 9 (App).

---

## File Structure

```
package.json, index.html, vite.config.js, vitest.rules.config.js
.gitignore, .env.example, README.md
firebase.json, firestore.rules
tests/rules/firestore.rules.test.js     rules tests (emulator)
src/
  main.jsx, App.jsx, App.test.jsx, index.css
  test/setup.js                          RTL + jest-dom setup, global firebase.js mock
  lib/email.js        normalizeEmail, isValidEmail
  lib/errors.js       errorMessage(err) -> user-facing string
  lib/ballot.js       TOTAL_POINTS, parsePoints, isValidPoints, validateBallot, cleanPoints
  lib/ranking.js      computeRanking(songs, votes)
  lib/firebase.js     initialized auth, db, googleProvider
  lib/db.js           all Firestore writes
  hooks/useFirestore.js   useCollection, useDocument (live listeners)
  hooks/useAuth.js        useAuth, signIn, signOutUser
  hooks/useMember.js      useMember(email)
  hooks/usePolls.js, hooks/usePoll.js, hooks/useMembers.js
  components/Header.jsx, components/Ranking.jsx, components/Ballot.jsx, components/AddSongForm.jsx
  pages/SignIn.jsx, pages/NotAuthorized.jsx, pages/PollsList.jsx, pages/PollPage.jsx, pages/Members.jsx
```

Unit/component tests sit next to the file they test (`*.test.js` / `*.test.jsx`).

---

### Task 1: Project scaffold and small utilities

**Files:**
- Create: `package.json`, `index.html`, `vite.config.js`, `.gitignore`, `.env.example`, `src/main.jsx`, `src/App.jsx`, `src/index.css`, `src/test/setup.js`
- Create: `src/lib/email.js`, `src/lib/errors.js`
- Test: `src/lib/email.test.js`, `src/lib/errors.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `normalizeEmail(raw: any): string` — `String(raw ?? '').trim().toLowerCase()`
  - `isValidEmail(raw: any): boolean` — normalized value matches `local@domain.tld`
  - `errorMessage(err: any): string` — `permission-denied` → `"You don't have access."`; `unavailable` → `"Network problem — check your connection and try again."`; otherwise `err.message`, else `"Something went wrong."`
  - npm scripts `dev`, `build`, `preview`, `test`, `test:watch` (and `test:rules`, `deploy` used later)

- [ ] **Step 1: Check Node**

Run: `node --version`
Expected: `v20.x` or higher. If lower or missing, stop and ask the human to install Node 20+.

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "song-voting-system",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:rules": "firebase emulators:exec --only firestore --project demo-songvote \"vitest run --config vitest.rules.config.js\"",
    "deploy": "npm run build && firebase deploy --only hosting,firestore:rules"
  }
}
```

- [ ] **Step 3: Install dependencies**

```bash
npm install react react-dom react-router-dom firebase
npm install -D vite @vitejs/plugin-react vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event @firebase/rules-unit-testing firebase-tools
```

If npm reports a peer-dependency conflict between `firebase` and `@firebase/rules-unit-testing`, reinstall `firebase` at the major version that `@firebase/rules-unit-testing`'s peer range names (`npm view @firebase/rules-unit-testing peerDependencies`).

- [ ] **Step 4: Write config and entry files**

`vite.config.js`:

```js
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
    include: ['src/**/*.test.{js,jsx}'],
  },
});
```

`index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Band Song Vote</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

`src/main.jsx`:

```jsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './index.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

`src/App.jsx` (replaced in Task 9):

```jsx
export default function App() {
  return <h1>Band Song Vote</h1>;
}
```

`src/test/setup.js`:

```js
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => cleanup());
```

`.gitignore`:

```
node_modules/
dist/
.env
.env.local
.firebase/
firebase-debug.log
firestore-debug.log
ui-debug.log
```

`.env.example`:

```
# Copy to .env and fill in from Firebase console → Project settings → Your apps → Web app.
# These are public identifiers, not secrets; Firestore rules protect the data.
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
```

`src/index.css`:

```css
:root {
  --bg: #fafafa;
  --fg: #1d1d1f;
  --muted: #6b6b70;
  --line: #dcdce0;
  --accent: #2f6fde;
  --danger: #c4314b;
  --ok: #1f8a4c;
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
  color: var(--fg);
  background: var(--bg);
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #161618; --fg: #f2f2f4; --muted: #a0a0a8; --line: #34343a; --accent: #6c9cff; --danger: #ff6b81; --ok: #4cc785; }
}
body { margin: 0; background: var(--bg); }
main, .center { max-width: 720px; margin: 0 auto; padding: 16px; }
.center { text-align: center; padding-top: 15vh; }
.app-header { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid var(--line); }
.app-header nav { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
.brand { font-weight: 700; color: var(--fg); text-decoration: none; }
a { color: var(--accent); }
button { font: inherit; padding: 6px 12px; border-radius: 6px; border: 1px solid var(--line); background: transparent; color: var(--fg); cursor: pointer; }
button[type='submit'] { background: var(--accent); border-color: var(--accent); color: #fff; }
button:disabled { opacity: 0.5; cursor: not-allowed; }
button.danger { color: var(--danger); border-color: var(--danger); background: transparent; }
input { font: inherit; padding: 6px 8px; border-radius: 6px; border: 1px solid var(--line); background: transparent; color: var(--fg); }
input[aria-invalid='true'] { border-color: var(--danger); }
.inline-form { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0; }
.list { list-style: none; padding: 0; }
.list li, .ranking li { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid var(--line); }
.ranking { padding-left: 20px; }
.ranking li { display: list-item; }
.ranking-head { display: flex; gap: 12px; align-items: center; justify-content: space-between; }
.total { font-weight: 700; margin-left: auto; }
.breakdown { margin: 4px 0 0; font-size: 0.9em; }
.ballot { margin-top: 24px; }
.ballot-row { display: flex; gap: 12px; align-items: center; justify-content: space-between; padding: 6px 0; }
.ballot-row input { width: 5em; }
.points-left { font-weight: 700; }
.muted { color: var(--muted); }
.hint { color: var(--muted); margin: 4px 0; }
.error { color: var(--danger); }
.ok { color: var(--ok); }
.status { color: var(--muted); text-align: center; padding: 32px; }
```

- [ ] **Step 5: Write the failing tests**

`src/lib/email.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { isValidEmail, normalizeEmail } from './email.js';

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Bob@Gmail.COM ')).toBe('bob@gmail.com');
  });

  it('turns null and undefined into an empty string', () => {
    expect(normalizeEmail(null)).toBe('');
    expect(normalizeEmail(undefined)).toBe('');
  });
});

describe('isValidEmail', () => {
  it('accepts a normal address, including surrounding whitespace and capitals', () => {
    expect(isValidEmail('bob@gmail.com')).toBe(true);
    expect(isValidEmail(' Bob.Smith@Gmail.com ')).toBe(true);
  });

  it('rejects things that are not email addresses', () => {
    expect(isValidEmail('')).toBe(false);
    expect(isValidEmail('bob')).toBe(false);
    expect(isValidEmail('bob@gmail')).toBe(false);
    expect(isValidEmail('bob smith@gmail.com')).toBe(false);
    expect(isValidEmail('@gmail.com')).toBe(false);
  });
});
```

`src/lib/errors.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { errorMessage } from './errors.js';

describe('errorMessage', () => {
  it('explains permission errors', () => {
    expect(errorMessage({ code: 'permission-denied', message: 'Missing or insufficient permissions.' }))
      .toBe("You don't have access.");
  });

  it('explains network errors', () => {
    expect(errorMessage({ code: 'unavailable' }))
      .toBe('Network problem — check your connection and try again.');
  });

  it('falls back to the error message', () => {
    expect(errorMessage(new Error('Boom'))).toBe('Boom');
  });

  it('has a generic fallback', () => {
    expect(errorMessage(undefined)).toBe('Something went wrong.');
    expect(errorMessage({})).toBe('Something went wrong.');
  });
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — cannot resolve `./email.js` and `./errors.js`.

- [ ] **Step 7: Implement**

`src/lib/email.js`:

```js
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(raw) {
  return String(raw ?? '').trim().toLowerCase();
}

export function isValidEmail(raw) {
  return EMAIL_PATTERN.test(normalizeEmail(raw));
}
```

`src/lib/errors.js`:

```js
export function errorMessage(err) {
  if (err?.code === 'permission-denied') return "You don't have access.";
  if (err?.code === 'unavailable') return 'Network problem — check your connection and try again.';
  return err?.message || 'Something went wrong.';
}
```

- [ ] **Step 8: Run tests and build**

Run: `npm test && npm run build`
Expected: all tests PASS; build writes `dist/`.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json index.html vite.config.js .gitignore .env.example src
git commit -m "chore: scaffold Vite React app with email and error helpers"
```

---

### Task 2: Ballot validation

**Files:**
- Create: `src/lib/ballot.js`
- Test: `src/lib/ballot.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `TOTAL_POINTS = 100`
  - `parsePoints(raw: string | number | undefined | null): number` — `undefined`/`null`/blank/whitespace → `0`; numbers returned as-is; other strings → `Number(trimmed)` (may be `NaN`)
  - `isValidPoints(n: any): boolean` — integer, `0 <= n <= 100`
  - `validateBallot(points: object = {}, songIds: string[]): { total: number, remaining: number, invalidSongIds: string[], errors: string[], valid: boolean }` — only keys in `songIds` count; `total` sums valid values only; `remaining = 100 - total`
  - `cleanPoints(points: object, songIds: string[]): Record<string, number>` — valid, non-zero values for current songs only, as numbers
  - Error strings (exact): `'Add songs to this poll before voting.'`, `'Each value must be a whole number from 0 to 100.'`, `` `${remaining} points unassigned — your total must be exactly 100.` ``, `` `You are ${over} points over 100.` ``

- [ ] **Step 1: Write the failing tests**

`src/lib/ballot.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { TOTAL_POINTS, cleanPoints, isValidPoints, parsePoints, validateBallot } from './ballot.js';

const SONGS = ['a', 'b', 'c'];
const INVALID = 'Each value must be a whole number from 0 to 100.';

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
  it('accepts whole numbers from 0 to 100', () => {
    expect(isValidPoints(0)).toBe(true);
    expect(isValidPoints(100)).toBe(true);
  });

  it('rejects everything else', () => {
    expect(isValidPoints(-1)).toBe(false);
    expect(isValidPoints(101)).toBe(false);
    expect(isValidPoints(10.5)).toBe(false);
    expect(isValidPoints(NaN)).toBe(false);
    expect(isValidPoints('50')).toBe(false);
    expect(isValidPoints(undefined)).toBe(false);
  });
});

describe('validateBallot', () => {
  it('accepts whole numbers that add up to exactly 100', () => {
    expect(validateBallot({ a: '50', b: '30', c: '20' }, SONGS)).toEqual({
      total: TOTAL_POINTS,
      remaining: 0,
      invalidSongIds: [],
      errors: [],
      valid: true,
    });
  });

  it('accepts number values as well as strings', () => {
    expect(validateBallot({ a: 100 }, SONGS).valid).toBe(true);
  });

  it('treats blank and missing fields as 0', () => {
    const result = validateBallot({ a: '100', b: '', c: '  ' }, SONGS);
    expect(result.valid).toBe(true);
    expect(result.total).toBe(100);
  });

  it('reports unassigned points when under 100', () => {
    const result = validateBallot({ a: '40' }, SONGS);
    expect(result.valid).toBe(false);
    expect(result.remaining).toBe(60);
    expect(result.errors).toEqual(['60 points unassigned — your total must be exactly 100.']);
  });

  it('reports the overage when over 100', () => {
    const result = validateBallot({ a: '80', b: '30' }, SONGS);
    expect(result.valid).toBe(false);
    expect(result.remaining).toBe(-10);
    expect(result.errors).toEqual(['You are 10 points over 100.']);
  });

  it('flags fractional values', () => {
    const result = validateBallot({ a: '10.5', b: '89.5' }, SONGS);
    expect(result.valid).toBe(false);
    expect(result.invalidSongIds).toEqual(['a', 'b']);
    expect(result.errors).toContain(INVALID);
  });

  it('flags negative values and values over 100', () => {
    const result = validateBallot({ a: '-10', b: '110' }, SONGS);
    expect(result.invalidSongIds).toEqual(['a', 'b']);
    expect(result.valid).toBe(false);
  });

  it('flags non-numeric values and leaves them out of the total', () => {
    const result = validateBallot({ a: 'abc', b: '100' }, SONGS);
    expect(result.invalidSongIds).toEqual(['a']);
    expect(result.total).toBe(100);
    expect(result.errors).toEqual([INVALID]);
    expect(result.valid).toBe(false);
  });

  it('ignores points for songs that are no longer in the poll', () => {
    const result = validateBallot({ a: '60', gone: '40' }, SONGS);
    expect(result.total).toBe(60);
    expect(result.remaining).toBe(40);
    expect(result.valid).toBe(false);
  });

  it('rejects a poll with no songs', () => {
    expect(validateBallot({}, [])).toEqual({
      total: 0,
      remaining: 100,
      invalidSongIds: [],
      errors: ['Add songs to this poll before voting.'],
      valid: false,
    });
  });

  it('handles a missing points object', () => {
    expect(validateBallot(undefined, SONGS).remaining).toBe(100);
  });
});

describe('cleanPoints', () => {
  it('keeps valid non-zero values for current songs, as numbers', () => {
    expect(cleanPoints({ a: '60', b: '0', c: ' 40 ', gone: '10' }, SONGS)).toEqual({ a: 60, c: 40 });
  });

  it('drops blank and invalid values', () => {
    expect(cleanPoints({ a: '', b: 'abc', c: '10.5' }, SONGS)).toEqual({});
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/lib/ballot.test.js`
Expected: FAIL — cannot resolve `./ballot.js`.

- [ ] **Step 3: Implement**

`src/lib/ballot.js`:

```js
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/lib/ballot.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ballot.js src/lib/ballot.test.js
git commit -m "feat: add ballot validation"
```

---

### Task 3: Ranking

**Files:**
- Create: `src/lib/ranking.js`
- Test: `src/lib/ranking.test.js`

**Interfaces:**
- Consumes: `isValidPoints` from `src/lib/ballot.js` (Task 2).
- Produces: `computeRanking(songs: {id, title, artist}[], votes: {email: string, points?: object}[]): { song, total: number, breakdown: {email, points}[] }[]`
  - Sorted by `total` descending, ties by `song.title` case-insensitively.
  - `breakdown` lists only members who gave the song > 0 valid points, highest first, ties by email.
  - Values failing `isValidPoints` are ignored; points for song IDs not in `songs` are ignored.

- [ ] **Step 1: Write the failing tests**

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
    const votes = [
      { email: 'a@gmail.com', points: { s1: 70, s2: 30 } },
      { email: 'b@gmail.com', points: { s2: 50, s3: 50 } },
    ];
    const rows = computeRanking(SONGS, votes);
    expect(titles(rows)).toEqual(['Africa', 'Zombie', 'Creep']);
    expect(rows.map((row) => row.total)).toEqual([80, 70, 50]);
  });

  it('lists who gave what, highest first', () => {
    const votes = [
      { email: 'a@gmail.com', points: { s2: 30, s1: 70 } },
      { email: 'b@gmail.com', points: { s2: 50, s3: 50 } },
    ];
    const africa = computeRanking(SONGS, votes).find((row) => row.song.id === 's2');
    expect(africa.breakdown).toEqual([
      { email: 'b@gmail.com', points: 50 },
      { email: 'a@gmail.com', points: 30 },
    ]);
  });

  it('breaks ties alphabetically, ignoring case', () => {
    const songs = [{ id: 'x', title: 'beatles medley' }, { id: 'y', title: 'Abba medley' }, ZOMBIE];
    const rows = computeRanking(songs, [{ email: 'a@gmail.com', points: { x: 50, y: 50 } }]);
    expect(titles(rows)).toEqual(['Abba medley', 'beatles medley', 'Zombie']);
  });

  it('lists every song at 0 when nobody has voted', () => {
    const rows = computeRanking(SONGS, []);
    expect(titles(rows)).toEqual(['Africa', 'Creep', 'Zombie']);
    expect(rows.every((row) => row.total === 0 && row.breakdown.length === 0)).toBe(true);
  });

  it('ignores points for songs that were removed', () => {
    const rows = computeRanking([ZOMBIE], [{ email: 'a@gmail.com', points: { s1: 60, gone: 40 } }]);
    expect(rows).toHaveLength(1);
    expect(rows[0].total).toBe(60);
  });

  it('ignores malformed values instead of crashing or concatenating', () => {
    const votes = [
      { email: 'a@gmail.com', points: { s1: '50', s2: -20, s3: NaN } },
      { email: 'b@gmail.com', points: { s1: 10, s2: 500, s3: 2.5 } },
      { email: 'c@gmail.com' },
    ];
    const rows = computeRanking(SONGS, votes);
    expect(rows.find((row) => row.song.id === 's1').total).toBe(10);
    expect(rows.find((row) => row.song.id === 's2').total).toBe(0);
    expect(rows.find((row) => row.song.id === 's3').total).toBe(0);
  });

  it('returns an empty list for a poll with no songs', () => {
    expect(computeRanking([], [{ email: 'a@gmail.com', points: { s1: 100 } }])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/lib/ranking.test.js`
Expected: FAIL — cannot resolve `./ranking.js`.

- [ ] **Step 3: Implement**

`src/lib/ranking.js`:

```js
import { isValidPoints } from './ballot.js';

export function computeRanking(songs, votes) {
  const rows = songs.map((song) => {
    const breakdown = votes
      .map((vote) => ({ email: vote.email, points: vote.points?.[song.id] }))
      .filter((entry) => isValidPoints(entry.points) && entry.points > 0)
      .sort((a, b) => b.points - a.points || a.email.localeCompare(b.email));
    const total = breakdown.reduce((sum, entry) => sum + entry.points, 0);
    return { song, total, breakdown };
  });

  return rows.sort(
    (a, b) => b.total - a.total || a.song.title.localeCompare(b.song.title, undefined, { sensitivity: 'base' }),
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/lib/ranking.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ranking.js src/lib/ranking.test.js
git commit -m "feat: compute song ranking from votes"
```

---

### Task 4: Firestore security rules

**Files:**
- Create: `firebase.json`, `firestore.rules`, `vitest.rules.config.js`
- Test: `tests/rules/firestore.rules.test.js`

**Interfaces:**
- Consumes: data model from the spec (`members/{email}`, `polls/{pollId}`, `polls/{pollId}/songs/{songId}`, `polls/{pollId}/votes/{email}`).
- Produces: deployed rules file `firestore.rules`; `firebase.json` with Hosting (`dist`, SPA rewrite), Firestore rules, and emulator ports (Firestore 8080, Auth 9099); `npm run test:rules`.

- [ ] **Step 1: Check Java**

Run: `java -version`
Expected: version 11 or higher. If Java is missing or older, **stop and ask the human** to install a JDK 11+ from an Intuit-approved OpenJDK distribution and set `JAVA_HOME` to that JDK's explicit path (macOS: run `/usr/libexec/java_home -V` to list installed JDKs, then `export JAVA_HOME=<path-to-intended-jdk>/Contents/Home`). Do not install a JDK yourself, and do not set `JAVA_HOME` with a version-only lookup such as `java_home -v 21`.

- [ ] **Step 2: Write `firebase.json`, a deny-all `firestore.rules`, and the rules test config**

`firebase.json`:

```json
{
  "hosting": {
    "public": "dist",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
    "rewrites": [{ "source": "**", "destination": "/index.html" }]
  },
  "firestore": {
    "rules": "firestore.rules"
  },
  "emulators": {
    "firestore": { "port": 8080 },
    "auth": { "port": 9099 },
    "ui": { "enabled": false },
    "singleProjectMode": true
  }
}
```

`firestore.rules` (temporary, deny everything):

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

`vitest.rules.config.js`:

```js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/rules/**/*.test.js'],
    testTimeout: 20000,
    hookTimeout: 20000,
    fileParallelism: false,
  },
});
```

- [ ] **Step 3: Write the failing rules tests**

`tests/rules/firestore.rules.test.js`:

```js
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';

const ADMIN = 'admin@gmail.com';
const MEMBER = 'member@gmail.com';
const STRANGER = 'stranger@gmail.com';

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
    await setDoc(doc(db, 'polls', 'p1'), { title: 'Summer set' });
    await setDoc(doc(db, 'polls/p1/songs/s1'), { title: 'Africa', artist: 'Toto' });
    await setDoc(doc(db, 'polls/p1/votes', MEMBER), { points: { s1: 100 } });
    await setDoc(doc(db, 'polls/p1/votes', ADMIN), { points: { s1: 100 } });
  });
});

function as(email, tokenOverrides = {}) {
  return testEnv.authenticatedContext(email, { email, email_verified: true, ...tokenOverrides }).firestore();
}

describe('people who are not members', () => {
  it('cannot read anything when signed out', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, 'polls', 'p1')));
    await assertFails(getDoc(doc(db, 'members', MEMBER)));
  });

  it('cannot read anything when signed in but not whitelisted', async () => {
    const db = as(STRANGER);
    await assertFails(getDoc(doc(db, 'members', STRANGER)));
    await assertFails(getDoc(doc(db, 'polls', 'p1')));
    await assertFails(getDoc(doc(db, 'polls/p1/songs/s1')));
    await assertFails(getDoc(doc(db, 'polls/p1/votes', MEMBER)));
  });

  it('cannot vote', async () => {
    await assertFails(setDoc(doc(as(STRANGER), 'polls/p1/votes', STRANGER), { points: { s1: 100 } }));
  });

  it('cannot get in with an unverified email', async () => {
    await assertFails(getDoc(doc(as(MEMBER, { email_verified: false }), 'polls', 'p1')));
  });
});

describe('members', () => {
  it('can read polls, songs, votes and the member list', async () => {
    const db = as(MEMBER);
    await assertSucceeds(getDoc(doc(db, 'polls', 'p1')));
    await assertSucceeds(getDoc(doc(db, 'polls/p1/songs/s1')));
    await assertSucceeds(getDoc(doc(db, 'polls/p1/votes', ADMIN)));
    await assertSucceeds(getDoc(doc(db, 'members', ADMIN)));
  });

  it('are recognized when Google returns their email in different case', async () => {
    const db = as('Member@Gmail.com');
    await assertSucceeds(getDoc(doc(db, 'polls', 'p1')));
    await assertSucceeds(setDoc(doc(db, 'polls/p1/votes', MEMBER), { points: { s1: 100 } }));
  });

  it('cannot create polls, add songs or change members', async () => {
    const db = as(MEMBER);
    await assertFails(setDoc(doc(db, 'polls', 'p2'), { title: 'Winter set' }));
    await assertFails(setDoc(doc(db, 'polls/p1/songs/s2'), { title: 'Creep', artist: 'Radiohead' }));
    await assertFails(deleteDoc(doc(db, 'polls/p1/songs/s1')));
    await assertFails(setDoc(doc(db, 'members', 'new@gmail.com'), { admin: false }));
    await assertFails(updateDoc(doc(db, 'members', MEMBER), { admin: true }));
  });

  it('can write and delete their own vote', async () => {
    const db = as(MEMBER);
    await assertSucceeds(setDoc(doc(db, 'polls/p1/votes', MEMBER), { points: { s1: 60 } }));
    await assertSucceeds(deleteDoc(doc(db, 'polls/p1/votes', MEMBER)));
  });

  it("cannot write or delete someone else's vote", async () => {
    const db = as(MEMBER);
    await assertFails(setDoc(doc(db, 'polls/p1/votes', ADMIN), { points: { s1: 0 } }));
    await assertFails(deleteDoc(doc(db, 'polls/p1/votes', ADMIN)));
  });

  it('must store points as a map', async () => {
    const db = as(MEMBER);
    await assertFails(setDoc(doc(db, 'polls/p1/votes', MEMBER), { points: 100 }));
    await assertFails(setDoc(doc(db, 'polls/p1/votes', MEMBER), { other: 'field' }));
  });
});

describe('admins', () => {
  it('can create and delete polls', async () => {
    const db = as(ADMIN);
    await assertSucceeds(setDoc(doc(db, 'polls', 'p2'), { title: 'Winter set' }));
    await assertSucceeds(deleteDoc(doc(db, 'polls', 'p2')));
  });

  it('can add and remove songs', async () => {
    const db = as(ADMIN);
    await assertSucceeds(setDoc(doc(db, 'polls/p1/songs/s2'), { title: 'Creep', artist: 'Radiohead' }));
    await assertSucceeds(deleteDoc(doc(db, 'polls/p1/songs/s2')));
  });

  it('can add, update and remove members', async () => {
    const db = as(ADMIN);
    await assertSucceeds(setDoc(doc(db, 'members', 'new@gmail.com'), { admin: false }));
    await assertSucceeds(updateDoc(doc(db, 'members', 'new@gmail.com'), { admin: true }));
    await assertSucceeds(deleteDoc(doc(db, 'members', 'new@gmail.com')));
  });

  it("can delete another member's vote (needed to delete a poll)", async () => {
    await assertSucceeds(deleteDoc(doc(as(ADMIN), 'polls/p1/votes', MEMBER)));
  });

  it("cannot write another member's vote", async () => {
    await assertFails(setDoc(doc(as(ADMIN), 'polls/p1/votes', MEMBER), { points: { s1: 0 } }));
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npm run test:rules`
Expected: the emulator starts; every `assertSucceeds` test FAILS (deny-all rules); the "cannot" tests pass.

- [ ] **Step 5: Write the real rules**

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

    match /members/{email} {
      allow read: if isMember();
      allow write: if isAdmin();
    }

    match /polls/{pollId} {
      allow read: if isMember();
      allow write: if isAdmin();

      match /songs/{songId} {
        allow read: if isMember();
        allow write: if isAdmin();
      }

      // The 0–100 / sums-to-100 check is client-side only: rules can't iterate map values.
      match /votes/{email} {
        allow read: if isMember();
        allow create, update: if isMember()
          && email == myEmail()
          && request.resource.data.points is map;
        allow delete: if isMember() && (email == myEmail() || isAdmin());
      }
    }
  }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test:rules`
Expected: all rules tests PASS.

- [ ] **Step 7: Commit**

```bash
git add firebase.json firestore.rules vitest.rules.config.js tests/rules
git commit -m "feat: add Firestore security rules with emulator tests"
```

---

### Task 5: Firebase client, data layer, and live hooks

**Files:**
- Create: `src/lib/firebase.js`, `src/lib/db.js`
- Create: `src/hooks/useFirestore.js`, `src/hooks/useAuth.js`, `src/hooks/useMember.js`, `src/hooks/usePolls.js`, `src/hooks/usePoll.js`, `src/hooks/useMembers.js`
- Modify: `src/test/setup.js` (mock `src/lib/firebase.js` for every test)
- Test: `src/lib/db.test.js`, `src/hooks/useFirestore.test.js`, `src/hooks/useMember.test.js`

**Interfaces:**
- Consumes: env vars `VITE_FIREBASE_*` (Task 1 `.env.example`).
- Produces:
  - `src/lib/firebase.js`: `auth`, `db`, `googleProvider`
  - `src/lib/db.js` (all return Promises):
    - `createPoll(title: string, byEmail: string)`
    - `deletePoll(pollId: string)` — batch-deletes songs, votes, then the poll
    - `addSong(pollId: string, { title: string, artist: string }, byEmail: string)`
    - `removeSong(pollId: string, songId: string)`
    - `saveVote(pollId: string, email: string, points: Record<string, number>)`
    - `addMember(email: string, admin: boolean, byEmail: string)` — rejects with `Error('<email> is already on the list.')` if the doc exists
    - `setMemberAdmin(email: string, admin: boolean)`
    - `removeMember(email: string)`
    - Callers pass already-trimmed titles and already-normalized emails.
  - `useCollection(segments: string[] | null, order?: { field, direction }): { data: object[], loading, error }` — each doc is `{ id, ...data }`
  - `useDocument(segments: string[] | null): { data: object | null, loading, error }`
  - `useAuth(): { user, loading }`, `signIn(): Promise`, `signOutUser(): Promise`
  - `useMember(email: string | null): { member: { id, admin } | null, loading, error }` — `permission-denied` → `{ member: null, loading: false, error: null }`
  - `usePolls(): { data: {id, title, createdBy, createdAt}[], loading, error }` — newest first
  - `usePoll(pollId): { poll: object | null, songs: {id, title, artist}[], votes: {email, points}[], loading, error }`
  - `useMembers(): { data: {id, admin}[], loading, error }`

- [ ] **Step 1: Add the global firebase mock to test setup**

Replace `src/test/setup.js` with:

```js
import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// Tests never talk to a real Firebase project.
vi.mock('../lib/firebase.js', () => ({ auth: {}, db: {}, googleProvider: {} }));

afterEach(() => cleanup());
```

- [ ] **Step 2: Write `src/lib/firebase.js`**

```js
import { initializeApp } from 'firebase/app';
import { GoogleAuthProvider, getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const app = initializeApp({
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
});

export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();
// Always show the account picker so people with several Google accounts can choose.
googleProvider.setCustomParameters({ prompt: 'select_account' });
```

- [ ] **Step 3: Write the failing tests**

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

import { getDoc, getDocs, setDoc, writeBatch } from 'firebase/firestore';
import { addMember, deletePoll, saveVote } from './db.js';

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

describe('deletePoll', () => {
  it('deletes all songs and votes, then the poll, in one batch', async () => {
    const batch = { delete: vi.fn(), commit: vi.fn().mockResolvedValue(undefined) };
    writeBatch.mockReturnValue(batch);
    getDocs
      .mockResolvedValueOnce({ docs: [{ ref: 'song-1' }, { ref: 'song-2' }] })
      .mockResolvedValueOnce({ docs: [{ ref: 'vote-1' }] });

    await deletePoll('p1');

    expect(batch.delete.mock.calls.map(([ref]) => ref)).toEqual([
      'song-1',
      'song-2',
      'vote-1',
      { path: 'polls/p1' },
    ]);
    expect(batch.commit).toHaveBeenCalledTimes(1);
  });
});

describe('saveVote', () => {
  it("replaces the member's vote doc", async () => {
    await saveVote('p1', 'bob@gmail.com', { s1: 100 });
    expect(setDoc).toHaveBeenCalledWith(
      { path: 'polls/p1/votes/bob@gmail.com' },
      { points: { s1: 100 }, updatedAt: 'TIMESTAMP' },
    );
  });
});
```

`src/hooks/useFirestore.test.js`:

```js
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((db, ...path) => ({ path: path.join('/') })),
  doc: vi.fn((db, ...path) => ({ path: path.join('/') })),
  onSnapshot: vi.fn(),
  orderBy: vi.fn((field, direction) => ({ field, direction })),
  query: vi.fn((ref) => ref),
}));

import { onSnapshot } from 'firebase/firestore';
import { useCollection, useDocument } from './useFirestore.js';

let listener;

beforeEach(() => {
  vi.clearAllMocks();
  listener = {};
  onSnapshot.mockImplementation((ref, onNext, onError) => {
    listener.ref = ref;
    listener.onNext = onNext;
    listener.onError = onError;
    listener.unsubscribe = vi.fn();
    return listener.unsubscribe;
  });
});

describe('useCollection', () => {
  it('starts loading, then maps docs to { id, ...data }', () => {
    const { result } = renderHook(() => useCollection(['polls']));
    expect(result.current).toEqual({ data: [], loading: true, error: null });

    act(() => listener.onNext({ docs: [{ id: 'p1', data: () => ({ title: 'Summer set' }) }] }));

    expect(result.current).toEqual({ data: [{ id: 'p1', title: 'Summer set' }], loading: false, error: null });
  });

  it('reports listener errors', () => {
    const { result } = renderHook(() => useCollection(['polls']));
    act(() => listener.onError({ code: 'permission-denied' }));
    expect(result.current).toEqual({ data: [], loading: false, error: { code: 'permission-denied' } });
  });

  it('does not subscribe when the path is null', () => {
    const { result } = renderHook(() => useCollection(null));
    expect(onSnapshot).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
  });

  it('unsubscribes on unmount', () => {
    const { unmount } = renderHook(() => useCollection(['polls']));
    unmount();
    expect(listener.unsubscribe).toHaveBeenCalled();
  });
});

describe('useDocument', () => {
  it('returns { id, ...data } for an existing doc', () => {
    const { result } = renderHook(() => useDocument(['members', 'bob@gmail.com']));
    act(() => listener.onNext({ id: 'bob@gmail.com', exists: () => true, data: () => ({ admin: false }) }));
    expect(result.current.data).toEqual({ id: 'bob@gmail.com', admin: false });
  });

  it('returns null for a missing doc', () => {
    const { result } = renderHook(() => useDocument(['polls', 'nope']));
    act(() => listener.onNext({ id: 'nope', exists: () => false, data: () => undefined }));
    expect(result.current).toEqual({ data: null, loading: false, error: null });
  });
});
```

`src/hooks/useMember.test.js`:

```js
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

vi.mock('./useFirestore.js', () => ({ useDocument: vi.fn() }));

import { useDocument } from './useFirestore.js';
import { useMember } from './useMember.js';

beforeEach(() => vi.clearAllMocks());

describe('useMember', () => {
  it('returns the member doc', () => {
    useDocument.mockReturnValue({ data: { id: 'bob@gmail.com', admin: true }, loading: false, error: null });
    const { result } = renderHook(() => useMember('bob@gmail.com'));
    expect(useDocument).toHaveBeenCalledWith(['members', 'bob@gmail.com']);
    expect(result.current).toEqual({ member: { id: 'bob@gmail.com', admin: true }, loading: false, error: null });
  });

  it('treats permission-denied as "not on the list"', () => {
    useDocument.mockReturnValue({ data: null, loading: false, error: { code: 'permission-denied' } });
    const { result } = renderHook(() => useMember('stranger@gmail.com'));
    expect(result.current).toEqual({ member: null, loading: false, error: null });
  });

  it('passes other errors through', () => {
    useDocument.mockReturnValue({ data: null, loading: false, error: { code: 'unavailable' } });
    const { result } = renderHook(() => useMember('bob@gmail.com'));
    expect(result.current.error).toEqual({ code: 'unavailable' });
  });

  it('does not look anything up without an email', () => {
    useDocument.mockReturnValue({ data: null, loading: false, error: null });
    const { result } = renderHook(() => useMember(null));
    expect(useDocument).toHaveBeenCalledWith(null);
    expect(result.current.member).toBeNull();
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npm test -- src/lib/db.test.js src/hooks`
Expected: FAIL — cannot resolve `./db.js`, `./useFirestore.js`, `./useMember.js`.

- [ ] **Step 5: Implement the data layer**

`src/lib/db.js`:

```js
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { db } from './firebase.js';

export function createPoll(title, byEmail) {
  return addDoc(collection(db, 'polls'), { title, createdBy: byEmail, createdAt: serverTimestamp() });
}

// Firestore doesn't cascade-delete subcollections, so songs and votes go first.
// One batch holds up to 500 writes, far more than a band poll needs.
export async function deletePoll(pollId) {
  const [songs, votes] = await Promise.all([
    getDocs(collection(db, 'polls', pollId, 'songs')),
    getDocs(collection(db, 'polls', pollId, 'votes')),
  ]);
  const batch = writeBatch(db);
  songs.docs.forEach((song) => batch.delete(song.ref));
  votes.docs.forEach((vote) => batch.delete(vote.ref));
  batch.delete(doc(db, 'polls', pollId));
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

export function saveVote(pollId, email, points) {
  return setDoc(doc(db, 'polls', pollId, 'votes', email), { points, updatedAt: serverTimestamp() });
}

// setDoc would silently overwrite (and could demote) an existing member, so check first.
export async function addMember(email, admin, byEmail) {
  const ref = doc(db, 'members', email);
  if ((await getDoc(ref)).exists()) throw new Error(`${email} is already on the list.`);
  await setDoc(ref, { admin, addedBy: byEmail, addedAt: serverTimestamp() });
}

export function setMemberAdmin(email, admin) {
  return updateDoc(doc(db, 'members', email), { admin });
}

export function removeMember(email) {
  return deleteDoc(doc(db, 'members', email));
}
```

- [ ] **Step 6: Implement the hooks**

`src/hooks/useFirestore.js`:

```js
import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../lib/firebase.js';

const NO_DOCS = [];

// State is tagged with the key it was loaded for, so a path change never shows stale data.
function useSnapshot(key, emptyValue, subscribe) {
  const [state, setState] = useState({ key: null, data: emptyValue, error: null });

  useEffect(() => {
    if (key === null) return undefined;
    return subscribe(
      (data) => setState({ key, data, error: null }),
      (error) => setState({ key, data: emptyValue, error }),
    );
    // `key` encodes everything `subscribe` depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (key === null) return { data: emptyValue, loading: false, error: null };
  if (state.key !== key) return { data: emptyValue, loading: true, error: null };
  return { data: state.data, loading: false, error: state.error };
}

export function useCollection(segments, order) {
  const key = segments ? `${segments.join('/')}|${order ? `${order.field}:${order.direction}` : ''}` : null;
  return useSnapshot(key, NO_DOCS, (onData, onError) => {
    const ref = collection(db, ...segments);
    const source = order ? query(ref, orderBy(order.field, order.direction)) : ref;
    return onSnapshot(
      source,
      (snapshot) => onData(snapshot.docs.map((d) => ({ id: d.id, ...d.data() }))),
      onError,
    );
  });
}

export function useDocument(segments) {
  const key = segments ? segments.join('/') : null;
  return useSnapshot(key, null, (onData, onError) =>
    onSnapshot(
      doc(db, ...segments),
      (snapshot) => onData(snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null),
      onError,
    ),
  );
}
```

`src/hooks/useAuth.js`:

```js
import { useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { auth, googleProvider } from '../lib/firebase.js';

export function useAuth() {
  const [state, setState] = useState({ user: null, loading: true });
  useEffect(() => onAuthStateChanged(auth, (user) => setState({ user, loading: false })), []);
  return state;
}

export function signIn() {
  return signInWithPopup(auth, googleProvider);
}

export function signOutUser() {
  return signOut(auth);
}
```

`src/hooks/useMember.js`:

```js
import { useDocument } from './useFirestore.js';

export function useMember(email) {
  const { data, loading, error } = useDocument(email ? ['members', email] : null);
  // Non-members can't read the whitelist, so permission-denied means "not on the list".
  if (error?.code === 'permission-denied') return { member: null, loading: false, error: null };
  return { member: data, loading, error };
}
```

`src/hooks/usePolls.js`:

```js
import { useCollection } from './useFirestore.js';

export function usePolls() {
  return useCollection(['polls'], { field: 'createdAt', direction: 'desc' });
}
```

`src/hooks/usePoll.js`:

```js
import { useCollection, useDocument } from './useFirestore.js';

export function usePoll(pollId) {
  const poll = useDocument(['polls', pollId]);
  const songs = useCollection(['polls', pollId, 'songs'], { field: 'addedAt', direction: 'asc' });
  const votes = useCollection(['polls', pollId, 'votes']);

  return {
    poll: poll.data,
    songs: songs.data,
    votes: votes.data.map((vote) => ({ email: vote.id, points: vote.points ?? {} })),
    loading: poll.loading || songs.loading || votes.loading,
    error: poll.error || songs.error || votes.error,
  };
}
```

`src/hooks/useMembers.js`:

```js
import { useCollection } from './useFirestore.js';

export function useMembers() {
  return useCollection(['members']);
}
```

- [ ] **Step 7: Run tests and build**

Run: `npm test && npm run build`
Expected: all tests PASS; build succeeds.

- [ ] **Step 8: Commit**

```bash
git add src/lib/firebase.js src/lib/db.js src/lib/db.test.js src/hooks src/test/setup.js
git commit -m "feat: add Firebase client, data layer and live Firestore hooks"
```

---

### Task 6: Polls list page

**Files:**
- Create: `src/pages/PollsList.jsx`
- Test: `src/pages/PollsList.test.jsx`

**Interfaces:**
- Consumes: `usePolls()` (Task 5), `createPoll`, `deletePoll` (Task 5), `errorMessage` (Task 1).
- Produces: `<PollsList me={{ email: string, isAdmin: boolean }} />` (default export). Links each poll to `/polls/:pollId`.

- [ ] **Step 1: Write the failing tests**

`src/pages/PollsList.test.jsx`:

```jsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
  { id: 'p1', title: 'Summer set' },
];

function renderPage(me) {
  return render(
    <MemoryRouter>
      <PollsList me={me} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  usePolls.mockReturnValue({ data: POLLS, loading: false, error: null });
});

describe('PollsList', () => {
  it('links each poll to its page', () => {
    renderPage(MEMBER);
    expect(screen.getByRole('link', { name: 'Winter set' })).toHaveAttribute('href', '/polls/p2');
    expect(screen.getByRole('link', { name: 'Summer set' })).toHaveAttribute('href', '/polls/p1');
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

  it('rejects a blank poll title', async () => {
    const user = userEvent.setup();
    renderPage(ADMIN);
    await user.type(screen.getByLabelText('New poll title'), '   ');
    await user.click(screen.getByRole('button', { name: 'Create poll' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Poll title is required.');
    expect(createPoll).not.toHaveBeenCalled();
  });

  it('creates a poll with a trimmed title and clears the field', async () => {
    createPoll.mockResolvedValue({ id: 'p3' });
    const user = userEvent.setup();
    renderPage(ADMIN);
    await user.type(screen.getByLabelText('New poll title'), '  Fall set  ');
    await user.click(screen.getByRole('button', { name: 'Create poll' }));
    expect(createPoll).toHaveBeenCalledWith('Fall set', 'admin@gmail.com');
    expect(screen.getByLabelText('New poll title')).toHaveValue('');
  });

  it('shows an error when creating fails', async () => {
    createPoll.mockRejectedValue({ code: 'permission-denied' });
    const user = userEvent.setup();
    renderPage(ADMIN);
    await user.type(screen.getByLabelText('New poll title'), 'Fall set');
    await user.click(screen.getByRole('button', { name: 'Create poll' }));
    expect(screen.getByRole('alert')).toHaveTextContent("Could not create poll: You don't have access.");
  });

  it('deletes a poll after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    deletePoll.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage(ADMIN);
    await user.click(screen.getByRole('button', { name: 'Delete Winter set' }));
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

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/pages/PollsList.test.jsx`
Expected: FAIL — cannot resolve `./PollsList.jsx`.

- [ ] **Step 3: Implement**

`src/pages/PollsList.jsx`:

```jsx
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { usePolls } from '../hooks/usePolls.js';
import { createPoll, deletePoll } from '../lib/db.js';
import { errorMessage } from '../lib/errors.js';

export default function PollsList({ me }) {
  const { data: polls, loading, error } = usePolls();
  const [title, setTitle] = useState('');
  const [actionError, setActionError] = useState(null);

  async function handleCreate(event) {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) {
      setActionError('Poll title is required.');
      return;
    }
    try {
      await createPoll(trimmed, me.email);
      setTitle('');
      setActionError(null);
    } catch (err) {
      setActionError(`Could not create poll: ${errorMessage(err)}`);
    }
  }

  async function handleDelete(poll) {
    if (!window.confirm(`Delete "${poll.title}" and all its songs and votes?`)) return;
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
        <form className="inline-form" onSubmit={handleCreate}>
          <input
            aria-label="New poll title"
            placeholder="New poll title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/pages/PollsList.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pages/PollsList.jsx src/pages/PollsList.test.jsx
git commit -m "feat: add polls list page"
```

---

### Task 7: Poll page — ranking, ballot, and song management

**Files:**
- Create: `src/components/Ranking.jsx`, `src/components/Ballot.jsx`, `src/components/AddSongForm.jsx`, `src/pages/PollPage.jsx`
- Test: `src/components/Ballot.test.jsx`, `src/pages/PollPage.test.jsx`

**Interfaces:**
- Consumes: `usePoll(pollId)` (Task 5); `addSong`, `removeSong`, `saveVote` (Task 5); `computeRanking` (Task 3); `validateBallot`, `cleanPoints` (Task 2); `errorMessage` (Task 1).
- Produces:
  - `<Ranking rows={computeRanking(...)} isAdmin={bool} onRemoveSong={(song) => void} />`
  - `<Ballot songs={[{id,title,artist}]} savedPoints={object | undefined} onSave={(points) => Promise} />` — draft initialized once at mount
  - `<AddSongForm onAdd={({ title, artist }) => Promise} />`
  - `<PollPage me={{ email, isAdmin }} />` (default export), rendered at route `/polls/:pollId`

- [ ] **Step 1: Write the failing Ballot tests**

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

describe('Ballot', () => {
  it('pre-fills saved points and enables Save at exactly 100', () => {
    render(<Ballot songs={SONGS} savedPoints={{ s1: 60, s2: 40 }} onSave={vi.fn()} />);
    expect(screen.getByLabelText('Points for Africa')).toHaveValue(60);
    expect(screen.getByLabelText('Points for Creep')).toHaveValue(40);
    expect(screen.getByText('Points left: 0')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('starts empty with 100 points left and Save disabled', () => {
    render(<Ballot songs={SONGS} savedPoints={undefined} onSave={vi.fn()} />);
    expect(screen.getByLabelText('Points for Africa')).toHaveValue(null);
    expect(screen.getByText('Points left: 100')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('updates the counter as you type', async () => {
    const user = userEvent.setup();
    render(<Ballot songs={SONGS} savedPoints={undefined} onSave={vi.fn()} />);
    await user.type(screen.getByLabelText('Points for Africa'), '30');
    expect(screen.getByText('Points left: 70')).toBeInTheDocument();
    expect(screen.getByText('70 points unassigned — your total must be exactly 100.')).toBeInTheDocument();
  });

  it('flags fractional values', async () => {
    const user = userEvent.setup();
    render(<Ballot songs={SONGS} savedPoints={undefined} onSave={vi.fn()} />);
    await user.type(screen.getByLabelText('Points for Africa'), '10.5');
    expect(screen.getByLabelText('Points for Africa')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Each value must be a whole number from 0 to 100.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('saves cleaned points and confirms', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<Ballot songs={SONGS} savedPoints={undefined} onSave={onSave} />);
    await user.type(screen.getByLabelText('Points for Africa'), '100');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith({ s1: 100 });
    expect(screen.getByRole('status')).toHaveTextContent('Saved.');
  });

  it('shows unassigned points left behind by a removed song', () => {
    render(<Ballot songs={SONGS} savedPoints={{ s1: 60, gone: 40 }} onSave={vi.fn()} />);
    expect(screen.getByText('Points left: 40')).toBeInTheDocument();
    expect(screen.getByText('40 points unassigned — your total must be exactly 100.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('shows an error when saving fails and keeps the input', async () => {
    const onSave = vi.fn().mockRejectedValue({ code: 'unavailable' });
    const user = userEvent.setup();
    render(<Ballot songs={SONGS} savedPoints={{ s1: 60, s2: 40 }} onSave={onSave} />);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Could not save: Network problem — check your connection and try again.',
    );
    expect(screen.getByLabelText('Points for Africa')).toHaveValue(60);
  });

  it('explains that a poll with no songs cannot be voted on', () => {
    render(<Ballot songs={[]} savedPoints={undefined} onSave={vi.fn()} />);
    expect(screen.getByText('Add songs to this poll before voting.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Write the failing PollPage tests**

`src/pages/PollPage.test.jsx`:

```jsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('../hooks/usePoll.js', () => ({ usePoll: vi.fn() }));
vi.mock('../lib/db.js', () => ({ addSong: vi.fn(), removeSong: vi.fn(), saveVote: vi.fn() }));

import { usePoll } from '../hooks/usePoll.js';
import { addSong, removeSong, saveVote } from '../lib/db.js';
import PollPage from './PollPage.jsx';

const ADMIN = { email: 'admin@gmail.com', isAdmin: true };
const MEMBER = { email: 'member@gmail.com', isAdmin: false };
const SONGS = [
  { id: 's1', title: 'Africa', artist: 'Toto' },
  { id: 's2', title: 'Creep', artist: 'Radiohead' },
  { id: 's3', title: 'Zombie', artist: 'The Cranberries' },
];
const VOTES = [
  { email: 'member@gmail.com', points: { s1: 30, s3: 70 } },
  { email: 'admin@gmail.com', points: { s2: 100 } },
];

function renderPage(me) {
  return render(
    <MemoryRouter initialEntries={['/polls/p1']}>
      <Routes>
        <Route path="/polls/:pollId" element={<PollPage me={me} />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  usePoll.mockReturnValue({
    poll: { id: 'p1', title: 'Summer set' },
    songs: SONGS,
    votes: VOTES,
    loading: false,
    error: null,
  });
});

describe('PollPage', () => {
  it('ranks songs by total points with a per-member breakdown', () => {
    renderPage(MEMBER);
    expect(usePoll).toHaveBeenCalledWith('p1');
    expect(screen.getByRole('heading', { name: 'Summer set' })).toBeInTheDocument();
    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Creep');
    expect(items[0]).toHaveTextContent('100 pts');
    expect(items[1]).toHaveTextContent('Zombie');
    expect(items[1]).toHaveTextContent('member@gmail.com 70');
    expect(items[2]).toHaveTextContent('Africa');
  });

  it("pre-fills the member's own ballot", () => {
    renderPage(MEMBER);
    expect(screen.getByLabelText('Points for Africa')).toHaveValue(30);
    expect(screen.getByLabelText('Points for Zombie')).toHaveValue(70);
  });

  it('saves the member vote', async () => {
    saveVote.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage(MEMBER);
    await user.clear(screen.getByLabelText('Points for Africa'));
    await user.type(screen.getByLabelText('Points for Africa'), '20');
    await user.type(screen.getByLabelText('Points for Creep'), '10');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(saveVote).toHaveBeenCalledWith('p1', 'member@gmail.com', { s1: 20, s2: 10, s3: 70 });
  });

  it('hides song management from non-admins', () => {
    renderPage(MEMBER);
    expect(screen.queryByRole('button', { name: 'Add song' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove Africa' })).not.toBeInTheDocument();
  });

  it('lets an admin add a song with trimmed fields', async () => {
    addSong.mockResolvedValue({ id: 's4' });
    const user = userEvent.setup();
    renderPage(ADMIN);
    await user.type(screen.getByLabelText('Song title'), ' Toxic ');
    await user.type(screen.getByLabelText('Artist'), ' Britney Spears ');
    await user.click(screen.getByRole('button', { name: 'Add song' }));
    expect(addSong).toHaveBeenCalledWith('p1', { title: 'Toxic', artist: 'Britney Spears' }, 'admin@gmail.com');
    expect(screen.getByLabelText('Song title')).toHaveValue('');
  });

  it('rejects a blank song title', async () => {
    const user = userEvent.setup();
    renderPage(ADMIN);
    await user.type(screen.getByLabelText('Artist'), 'Toto');
    await user.click(screen.getByRole('button', { name: 'Add song' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Song title is required.');
    expect(addSong).not.toHaveBeenCalled();
  });

  it('lets an admin remove a song after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    removeSong.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage(ADMIN);
    await user.click(screen.getByRole('button', { name: 'Remove Africa' }));
    expect(removeSong).toHaveBeenCalledWith('p1', 's1');
  });

  it('says when the poll does not exist', () => {
    usePoll.mockReturnValue({ poll: null, songs: [], votes: [], loading: false, error: null });
    renderPage(MEMBER);
    expect(screen.getByText(/Poll not found/)).toBeInTheDocument();
  });

  it('shows a load error', () => {
    usePoll.mockReturnValue({ poll: null, songs: [], votes: [], loading: false, error: { code: 'permission-denied' } });
    renderPage(MEMBER);
    expect(screen.getByRole('alert')).toHaveTextContent("You don't have access.");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- src/components src/pages/PollPage.test.jsx`
Expected: FAIL — cannot resolve `./Ballot.jsx` and `./PollPage.jsx`.

- [ ] **Step 4: Implement the components**

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

export default function Ballot({ songs, savedPoints, onSave }) {
  const [draft, setDraft] = useState(() => initialDraft(songs, savedPoints));
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);

  const songIds = songs.map((song) => song.id);
  const result = validateBallot(draft, songIds);
  const invalid = new Set(result.invalidSongIds);

  function handleChange(songId, value) {
    setDraft((current) => ({ ...current, [songId]: value }));
    setStatus(null);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!result.valid) return;
    setSaving(true);
    try {
      await onSave(cleanPoints(draft, songIds));
      setStatus({ ok: true, text: 'Saved.' });
    } catch (err) {
      setStatus({ ok: false, text: `Could not save: ${errorMessage(err)}` });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="ballot" onSubmit={handleSubmit}>
      <h2>My ballot</h2>
      {songs.map((song) => (
        <label key={song.id} className="ballot-row">
          <span>
            {song.title}
            {song.artist && <span className="muted"> — {song.artist}</span>}
          </span>
          <input
            type="number"
            min="0"
            max="100"
            step="1"
            inputMode="numeric"
            aria-label={`Points for ${song.title}`}
            aria-invalid={invalid.has(song.id)}
            value={draft[song.id] ?? ''}
            onChange={(event) => handleChange(song.id, event.target.value)}
          />
        </label>
      ))}
      <p className="points-left">Points left: {result.remaining}</p>
      {result.errors.map((text) => (
        <p key={text} className="hint">{text}</p>
      ))}
      <button type="submit" disabled={!result.valid || saving}>
        {saving ? 'Saving…' : 'Save'}
      </button>
      {status && (
        <p role={status.ok ? 'status' : 'alert'} className={status.ok ? 'ok' : 'error'}>
          {status.text}
        </p>
      )}
    </form>
  );
}
```

`src/components/Ranking.jsx`:

```jsx
export default function Ranking({ rows, isAdmin, onRemoveSong }) {
  if (rows.length === 0) return <p>No songs in this poll yet.</p>;

  return (
    <ol className="ranking">
      {rows.map(({ song, total, breakdown }) => (
        <li key={song.id}>
          <div className="ranking-head">
            <span>
              {song.title}
              {song.artist && <span className="muted"> — {song.artist}</span>}
            </span>
            <span className="total">{total} pts</span>
            {isAdmin && (
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
          {breakdown.length > 0 && (
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

`src/components/AddSongForm.jsx`:

```jsx
import { useState } from 'react';
import { errorMessage } from '../lib/errors.js';

export default function AddSongForm({ onAdd }) {
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [error, setError] = useState(null);

  async function handleSubmit(event) {
    event.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError('Song title is required.');
      return;
    }
    try {
      await onAdd({ title: trimmedTitle, artist: artist.trim() });
      setTitle('');
      setArtist('');
      setError(null);
    } catch (err) {
      setError(`Could not add song: ${errorMessage(err)}`);
    }
  }

  return (
    <form className="inline-form" onSubmit={handleSubmit}>
      <input aria-label="Song title" placeholder="Song title" value={title} onChange={(event) => setTitle(event.target.value)} />
      <input aria-label="Artist" placeholder="Artist" value={artist} onChange={(event) => setArtist(event.target.value)} />
      <button type="submit">Add song</button>
      {error && <p role="alert" className="error">{error}</p>}
    </form>
  );
}
```

`src/pages/PollPage.jsx`:

```jsx
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import AddSongForm from '../components/AddSongForm.jsx';
import Ballot from '../components/Ballot.jsx';
import Ranking from '../components/Ranking.jsx';
import { usePoll } from '../hooks/usePoll.js';
import { addSong, removeSong, saveVote } from '../lib/db.js';
import { errorMessage } from '../lib/errors.js';
import { computeRanking } from '../lib/ranking.js';

export default function PollPage({ me }) {
  const { pollId } = useParams();
  const { poll, songs, votes, loading, error } = usePoll(pollId);
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

  const rows = computeRanking(songs, votes);
  const myVote = votes.find((vote) => vote.email === me.email);

  async function handleRemoveSong(song) {
    if (!window.confirm(`Remove "${song.title}"? Points given to it will be dropped.`)) return;
    try {
      await removeSong(pollId, song.id);
      setActionError(null);
    } catch (err) {
      setActionError(`Could not remove song: ${errorMessage(err)}`);
    }
  }

  return (
    <section>
      <p>
        <Link to="/">← All polls</Link>
      </p>
      <h1>{poll.title}</h1>
      {actionError && <p role="alert" className="error">{actionError}</p>}
      <h2>Ranking</h2>
      <Ranking rows={rows} isAdmin={me.isAdmin} onRemoveSong={handleRemoveSong} />
      {me.isAdmin && <AddSongForm onAdd={(song) => addSong(pollId, song, me.email)} />}
      <Ballot songs={songs} savedPoints={myVote?.points} onSave={(points) => saveVote(pollId, me.email, points)} />
    </section>
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- src/components src/pages/PollPage.test.jsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components src/pages/PollPage.jsx src/pages/PollPage.test.jsx
git commit -m "feat: add poll page with live ranking, ballot and song management"
```

---

### Task 8: Members page

**Files:**
- Create: `src/pages/Members.jsx`
- Test: `src/pages/Members.test.jsx`

**Interfaces:**
- Consumes: `useMembers()` (Task 5); `addMember`, `setMemberAdmin`, `removeMember` (Task 5); `normalizeEmail`, `isValidEmail` (Task 1); `errorMessage` (Task 1).
- Produces: `<Members me={{ email, isAdmin }} />` (default export), rendered at `/members` for admins only.

- [ ] **Step 1: Write the failing tests**

`src/pages/Members.test.jsx`:

```jsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../hooks/useMembers.js', () => ({ useMembers: vi.fn() }));
vi.mock('../lib/db.js', () => ({ addMember: vi.fn(), setMemberAdmin: vi.fn(), removeMember: vi.fn() }));

import { useMembers } from '../hooks/useMembers.js';
import { addMember, removeMember, setMemberAdmin } from '../lib/db.js';
import Members from './Members.jsx';

const ME = { email: 'admin@gmail.com', isAdmin: true };

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  useMembers.mockReturnValue({
    data: [
      { id: 'bob@gmail.com', admin: false },
      { id: 'admin@gmail.com', admin: true },
    ],
    loading: false,
    error: null,
  });
});

describe('Members', () => {
  it('lists members alphabetically and marks you', () => {
    render(<Members me={ME} />);
    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('admin@gmail.com (you)');
    expect(items[1]).toHaveTextContent('bob@gmail.com');
  });

  it('rejects an invalid email', async () => {
    const user = userEvent.setup();
    render(<Members me={ME} />);
    await user.type(screen.getByLabelText('Email to add'), 'not-an-email');
    await user.click(screen.getByRole('button', { name: 'Add member' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid email address.');
    expect(addMember).not.toHaveBeenCalled();
  });

  it('rejects someone already on the list, ignoring case and spaces', async () => {
    const user = userEvent.setup();
    render(<Members me={ME} />);
    await user.type(screen.getByLabelText('Email to add'), ' Bob@Gmail.com ');
    await user.click(screen.getByRole('button', { name: 'Add member' }));
    expect(screen.getByRole('alert')).toHaveTextContent('bob@gmail.com is already on the list.');
    expect(addMember).not.toHaveBeenCalled();
  });

  it('adds a normalized email, optionally as admin', async () => {
    addMember.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<Members me={ME} />);
    await user.type(screen.getByLabelText('Email to add'), 'New.Person@Gmail.com');
    await user.click(screen.getByLabelText('Make admin'));
    await user.click(screen.getByRole('button', { name: 'Add member' }));
    expect(addMember).toHaveBeenCalledWith('new.person@gmail.com', true, 'admin@gmail.com');
    expect(screen.getByLabelText('Email to add')).toHaveValue('');
  });

  it('shows an error when adding fails', async () => {
    addMember.mockRejectedValue(new Error('new@gmail.com is already on the list.'));
    const user = userEvent.setup();
    render(<Members me={ME} />);
    await user.type(screen.getByLabelText('Email to add'), 'new@gmail.com');
    await user.click(screen.getByRole('button', { name: 'Add member' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Could not add member: new@gmail.com is already on the list.');
  });

  it('does not let you demote or remove yourself', () => {
    render(<Members me={ME} />);
    expect(screen.getByLabelText('Admin: admin@gmail.com')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove admin@gmail.com' })).toBeDisabled();
  });

  it('toggles admin for someone else', async () => {
    setMemberAdmin.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<Members me={ME} />);
    await user.click(screen.getByLabelText('Admin: bob@gmail.com'));
    expect(setMemberAdmin).toHaveBeenCalledWith('bob@gmail.com', true);
  });

  it('removes someone else after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    removeMember.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<Members me={ME} />);
    await user.click(screen.getByRole('button', { name: 'Remove bob@gmail.com' }));
    expect(removeMember).toHaveBeenCalledWith('bob@gmail.com');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/pages/Members.test.jsx`
Expected: FAIL — cannot resolve `./Members.jsx`.

- [ ] **Step 3: Implement**

`src/pages/Members.jsx`:

```jsx
import { useState } from 'react';
import { useMembers } from '../hooks/useMembers.js';
import { addMember, removeMember, setMemberAdmin } from '../lib/db.js';
import { isValidEmail, normalizeEmail } from '../lib/email.js';
import { errorMessage } from '../lib/errors.js';

export default function Members({ me }) {
  const { data, loading, error } = useMembers();
  const [email, setEmail] = useState('');
  const [makeAdmin, setMakeAdmin] = useState(false);
  const [actionError, setActionError] = useState(null);

  if (loading) return <p className="status">Loading…</p>;
  if (error) return <p role="alert" className="error">{errorMessage(error)}</p>;

  const members = [...data].sort((a, b) => a.id.localeCompare(b.id));

  async function handleAdd(event) {
    event.preventDefault();
    const normalized = normalizeEmail(email);
    if (!isValidEmail(normalized)) {
      setActionError('Enter a valid email address.');
      return;
    }
    if (members.some((member) => member.id === normalized)) {
      setActionError(`${normalized} is already on the list.`);
      return;
    }
    try {
      await addMember(normalized, makeAdmin, me.email);
      setEmail('');
      setMakeAdmin(false);
      setActionError(null);
    } catch (err) {
      setActionError(`Could not add member: ${errorMessage(err)}`);
    }
  }

  async function handleToggleAdmin(member) {
    try {
      await setMemberAdmin(member.id, !member.admin);
      setActionError(null);
    } catch (err) {
      setActionError(`Could not update ${member.id}: ${errorMessage(err)}`);
    }
  }

  async function handleRemove(member) {
    if (!window.confirm(`Remove ${member.id} from the band list?`)) return;
    try {
      await removeMember(member.id);
      setActionError(null);
    } catch (err) {
      setActionError(`Could not remove ${member.id}: ${errorMessage(err)}`);
    }
  }

  return (
    <section>
      <h1>Members</h1>
      <form className="inline-form" onSubmit={handleAdd}>
        <input
          aria-label="Email to add"
          placeholder="name@gmail.com"
          inputMode="email"
          autoComplete="off"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <label>
          <input
            type="checkbox"
            aria-label="Make admin"
            checked={makeAdmin}
            onChange={(event) => setMakeAdmin(event.target.checked)}
          />{' '}
          Admin
        </label>
        <button type="submit">Add member</button>
      </form>
      {actionError && <p role="alert" className="error">{actionError}</p>}
      <ul className="list">
        {members.map((member) => {
          const isMe = member.id === me.email;
          return (
            <li key={member.id}>
              <span>
                {member.id}
                {isMe && ' (you)'}
              </span>
              <label>
                <input
                  type="checkbox"
                  aria-label={`Admin: ${member.id}`}
                  checked={member.admin === true}
                  disabled={isMe}
                  onChange={() => handleToggleAdmin(member)}
                />{' '}
                Admin
              </label>
              <button
                type="button"
                className="danger"
                aria-label={`Remove ${member.id}`}
                title={isMe ? "You can't remove yourself" : undefined}
                disabled={isMe}
                onClick={() => handleRemove(member)}
              >
                Remove
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/pages/Members.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Members.jsx src/pages/Members.test.jsx
git commit -m "feat: add members whitelist page"
```

---

### Task 9: App shell — sign-in gating, header, and routing

**Files:**
- Create: `src/pages/SignIn.jsx`, `src/pages/NotAuthorized.jsx`, `src/components/Header.jsx`
- Modify: `src/App.jsx` (replace the Task 1 placeholder heading entirely)
- Test: `src/App.test.jsx`

**Interfaces:**
- Consumes: `useAuth`, `signIn`, `signOutUser` (Task 5); `useMember` (Task 5); `normalizeEmail` (Task 1); `errorMessage` (Task 1); `PollsList` (Task 6), `PollPage` (Task 7), `Members` (Task 8).
- Produces: routes `/` → PollsList, `/polls/:pollId` → PollPage, `/members` → Members (admins; others redirect to `/`), anything else → `/`. Every page receives `me = { email: normalizedEmail, isAdmin: member.admin === true }`.

- [ ] **Step 1: Write the failing tests**

`src/App.test.jsx`:

```jsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('./hooks/useAuth.js', () => ({ useAuth: vi.fn(), signIn: vi.fn(), signOutUser: vi.fn() }));
vi.mock('./hooks/useMember.js', () => ({ useMember: vi.fn() }));
vi.mock('./pages/PollsList.jsx', () => ({ default: () => 'Polls page' }));
vi.mock('./pages/PollPage.jsx', () => ({ default: () => 'Poll page' }));
vi.mock('./pages/Members.jsx', () => ({ default: () => 'Members page' }));

import { signIn, signOutUser, useAuth } from './hooks/useAuth.js';
import { useMember } from './hooks/useMember.js';
import App from './App.jsx';

function signedInAs(email, member) {
  useAuth.mockReturnValue({ user: { email }, loading: false });
  useMember.mockReturnValue({ member, loading: false, error: null });
}

beforeEach(() => {
  vi.clearAllMocks();
  window.history.pushState({}, '', '/');
});

afterEach(() => {
  window.history.pushState({}, '', '/');
});

describe('App', () => {
  it('shows a loading state while auth resolves', () => {
    useAuth.mockReturnValue({ user: null, loading: true });
    useMember.mockReturnValue({ member: null, loading: false, error: null });
    render(<App />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('asks signed-out visitors to sign in with Google', async () => {
    useAuth.mockReturnValue({ user: null, loading: false });
    useMember.mockReturnValue({ member: null, loading: false, error: null });
    signIn.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Sign in with Google' }));
    expect(signIn).toHaveBeenCalled();
  });

  it('ignores a closed sign-in popup but reports other sign-in errors', async () => {
    useAuth.mockReturnValue({ user: null, loading: false });
    useMember.mockReturnValue({ member: null, loading: false, error: null });
    const user = userEvent.setup();
    render(<App />);

    signIn.mockRejectedValueOnce({ code: 'auth/popup-closed-by-user' });
    await user.click(screen.getByRole('button', { name: 'Sign in with Google' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    signIn.mockRejectedValueOnce({ code: 'auth/network-request-failed', message: 'Network down' });
    await user.click(screen.getByRole('button', { name: 'Sign in with Google' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Sign-in failed: Network down');
  });

  it('tells signed-in people who are not on the list to ask an admin', async () => {
    signedInAs('stranger@gmail.com', null);
    const user = userEvent.setup();
    render(<App />);
    expect(screen.getByText('Not on the band list')).toBeInTheDocument();
    expect(screen.getByText('stranger@gmail.com')).toBeInTheDocument();
    expect(screen.getByText(/Ask an admin to add you/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(signOutUser).toHaveBeenCalled();
  });

  it('looks the member up by normalized email', () => {
    signedInAs('Member@Gmail.com', { id: 'member@gmail.com', admin: false });
    render(<App />);
    expect(useMember).toHaveBeenCalledWith('member@gmail.com');
  });

  it('shows polls and the signed-in email to members, without the Members link', () => {
    signedInAs('member@gmail.com', { id: 'member@gmail.com', admin: false });
    render(<App />);
    expect(screen.getByText('Polls page')).toBeInTheDocument();
    expect(screen.getByText('member@gmail.com')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Members' })).not.toBeInTheDocument();
  });

  it('shows the Members link to admins', () => {
    signedInAs('admin@gmail.com', { id: 'admin@gmail.com', admin: true });
    render(<App />);
    expect(screen.getByRole('link', { name: 'Members' })).toHaveAttribute('href', '/members');
  });

  it('lets admins open the Members page', () => {
    window.history.pushState({}, '', '/members');
    signedInAs('admin@gmail.com', { id: 'admin@gmail.com', admin: true });
    render(<App />);
    expect(screen.getByText('Members page')).toBeInTheDocument();
  });

  it('redirects non-admins away from the Members page', () => {
    window.history.pushState({}, '', '/members');
    signedInAs('member@gmail.com', { id: 'member@gmail.com', admin: false });
    render(<App />);
    expect(screen.getByText('Polls page')).toBeInTheDocument();
    expect(screen.queryByText('Members page')).not.toBeInTheDocument();
  });

  it('routes poll links to the poll page', () => {
    window.history.pushState({}, '', '/polls/p1');
    signedInAs('member@gmail.com', { id: 'member@gmail.com', admin: false });
    render(<App />);
    expect(screen.getByText('Poll page')).toBeInTheDocument();
  });

  it('shows an error if the member lookup fails for another reason', () => {
    useAuth.mockReturnValue({ user: { email: 'member@gmail.com' }, loading: false });
    useMember.mockReturnValue({ member: null, loading: false, error: { code: 'unavailable' } });
    render(<App />);
    expect(screen.getByRole('alert')).toHaveTextContent('Network problem');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/App.test.jsx`
Expected: FAIL — the placeholder `App` renders only a heading.

- [ ] **Step 3: Implement**

`src/pages/SignIn.jsx`:

```jsx
import { useState } from 'react';
import { signIn } from '../hooks/useAuth.js';
import { errorMessage } from '../lib/errors.js';

// Closing the Google popup isn't an error worth showing.
const IGNORED_CODES = new Set(['auth/popup-closed-by-user', 'auth/cancelled-popup-request']);

export default function SignIn() {
  const [error, setError] = useState(null);

  async function handleClick() {
    setError(null);
    try {
      await signIn();
    } catch (err) {
      if (!IGNORED_CODES.has(err?.code)) setError(`Sign-in failed: ${errorMessage(err)}`);
    }
  }

  return (
    <section className="center">
      <h1>Band Song Vote</h1>
      <p>Sign in with the Google account your band admin added.</p>
      <button type="button" onClick={handleClick}>Sign in with Google</button>
      {error && <p role="alert" className="error">{error}</p>}
    </section>
  );
}
```

`src/pages/NotAuthorized.jsx`:

```jsx
import { signOutUser } from '../hooks/useAuth.js';

export default function NotAuthorized({ email }) {
  return (
    <section className="center">
      <h1>Not on the band list</h1>
      <p>
        You're signed in as <strong>{email}</strong>.
      </p>
      <p>Ask an admin to add you, then reload this page.</p>
      <button type="button" onClick={() => signOutUser()}>Sign out</button>
    </section>
  );
}
```

`src/components/Header.jsx`:

```jsx
import { Link, NavLink } from 'react-router-dom';
import { signOutUser } from '../hooks/useAuth.js';

export default function Header({ me }) {
  return (
    <header className="app-header">
      <Link to="/" className="brand">Band Song Vote</Link>
      <nav>
        {me.isAdmin && <NavLink to="/members">Members</NavLink>}
        <span className="muted">{me.email}</span>
        <button type="button" onClick={() => signOutUser()}>Sign out</button>
      </nav>
    </header>
  );
}
```

`src/App.jsx` (replace the whole file):

```jsx
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import Header from './components/Header.jsx';
import { useAuth } from './hooks/useAuth.js';
import { useMember } from './hooks/useMember.js';
import { normalizeEmail } from './lib/email.js';
import { errorMessage } from './lib/errors.js';
import Members from './pages/Members.jsx';
import NotAuthorized from './pages/NotAuthorized.jsx';
import PollPage from './pages/PollPage.jsx';
import PollsList from './pages/PollsList.jsx';
import SignIn from './pages/SignIn.jsx';

export default function App() {
  const { user, loading } = useAuth();
  const email = user ? normalizeEmail(user.email) : null;
  const { member, loading: memberLoading, error } = useMember(email || null);

  if (loading || memberLoading) return <p className="status">Loading…</p>;
  if (!user) return <SignIn />;
  if (error) return <p role="alert" className="error">{errorMessage(error)}</p>;
  if (!member) return <NotAuthorized email={email} />;

  const me = { email, isAdmin: member.admin === true };

  return (
    <BrowserRouter>
      <Header me={me} />
      <main>
        <Routes>
          <Route path="/" element={<PollsList me={me} />} />
          <Route path="/polls/:pollId" element={<PollPage me={me} />} />
          <Route path="/members" element={me.isAdmin ? <Members me={me} /> : <Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </BrowserRouter>
  );
}
```

- [ ] **Step 4: Run all tests and build**

Run: `npm test && npm run build`
Expected: all tests PASS; build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/App.jsx src/App.test.jsx src/pages/SignIn.jsx src/pages/NotAuthorized.jsx src/components/Header.jsx
git commit -m "feat: add sign-in gating, header and routing"
```

---

### Task 10: README, deployment, and end-to-end check

**Files:**
- Modify: `README.md` (replace entirely)

**Interfaces:**
- Consumes: npm scripts `test`, `test:rules`, `build`, `deploy` (Tasks 1, 4); `firebase.json` (Task 4); `.env.example` (Task 1).
- Produces: a deployed app at `https://<project-id>.web.app`.

Steps 1–3 are for the implementer. Steps 4–6 need the human's Google account; the implementer prints them and waits.

- [ ] **Step 1: Write `README.md`**

````markdown
# Band Song Vote

A free web app for our cover band: each member gets 100 points per poll to spread across songs, and songs are ranked by total points. Only Google accounts on the band list can sign in.

Built with React + Vite on Firebase (Hosting, Auth, Firestore), all on the free Spark plan.

## How it works

- **Admins** create and delete polls, add and remove songs, and manage the member list.
- **Members** spread exactly 100 whole points across a poll's songs and can change them at any time.
- Rankings update live, and everyone can see who gave what.

## Prerequisites

- Node 20+
- A Java runtime, version 11+, for the Firestore emulator (only needed for `npm run test:rules`). Use an Intuit-approved OpenJDK distribution and point `JAVA_HOME` at it explicitly, e.g. on macOS `export JAVA_HOME=<path-to-intended-jdk>/Contents/Home` (list installed JDKs with `/usr/libexec/java_home -V`).

## Development

```bash
npm install
cp .env.example .env      # then fill in your Firebase web config
npm run dev               # http://localhost:5173
npm test                  # unit and component tests
npm run test:rules        # Firestore security rules tests (starts the emulator)
```

## First-time Firebase setup

1. In the [Firebase console](https://console.firebase.google.com), create a project. Don't add billing; the free Spark plan is enough.
2. **Build → Authentication → Get started → Sign-in method → Google → Enable.**
3. **Build → Firestore Database → Create database** in production mode, in a location near the band.
4. **Project settings → General → Your apps → Web (`</>`)** to register a web app, then copy its config values into `.env`.
5. **Firestore → Data:** create collection `members` with a document whose **ID is your Gmail address in lowercase** and one field `admin` (boolean) = `true`. You are now the first admin; add everyone else from the app's Members page.
6. Link this folder to the project:

   ```bash
   npx firebase login
   npx firebase use --add      # pick the project, alias "default"
   ```

## Deploy

```bash
npm run deploy
```

This builds the app and deploys Hosting plus the Firestore rules. The app is live at `https://<project-id>.web.app`, a domain that Firebase Auth already authorizes for Google sign-in.

## Known limitation

The "whole numbers that add up to exactly 100" check runs in the browser. Firestore rules can't add up a map of values, and enforcing it on the server would need Cloud Functions, which require the paid Blaze plan. That's fine for trusted bandmates.
````

- [ ] **Step 2: Run the full verification**

Run: `npm test && npm run test:rules && npm run build`
Expected: all unit, component and rules tests PASS; build succeeds.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add setup, development and deployment guide"
```

- [ ] **Step 4 (human): Firebase setup**

Ask the human to complete "First-time Firebase setup" steps 1–6 from the README, including filling in `.env` and seeding their own admin member doc. Wait for confirmation.

- [ ] **Step 5 (human): Deploy**

Ask the human to run `npm run deploy` (it needs their Firebase login). Expected: output ends with `Hosting URL: https://<project-id>.web.app`.

- [ ] **Step 6 (human): Smoke test on the live URL**

Ask the human to check, in order:
1. Sign in with the admin Gmail → Polls page loads, and the header shows the email and a Members link.
2. Members → add a second Gmail (try mixed case, e.g. `Friend@Gmail.com`) → it's listed as `friend@gmail.com`.
3. Create poll "Test" → open it → add 3 songs.
4. Allocate 50/30/20 → Save → "Saved." appears and the ranking shows the order with your email in the breakdown.
5. In a private window, sign in with the second account → it votes → the first window's ranking updates without a reload.
6. Sign in with a Gmail **not** on the list → "Not on the band list" appears with that email.
7. As admin, remove a song you gave points to → your ballot shows "N points unassigned" and Save is disabled until you reassign.
8. Delete the "Test" poll → it disappears from the list.

Record any failure as a bug to fix before calling the work done.
