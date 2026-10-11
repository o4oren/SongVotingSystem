# Song Voting System — Design

Date: 2026-10-11
Status: Approved in conversation; awaiting written-spec review

## Purpose

A cover band needs to decide which songs to play. Each poll contains a list of
songs; every band member distributes 100 points across those songs, and songs
are ranked by total points, highest first.

## Requirements

1. Admins can create new polls.
2. Admins can add songs to (and remove songs from) an existing poll.
3. In each poll, every member distributes exactly 100 points across the songs.
4. Songs are ranked top to bottom by total points.
5. Only whitelisted Google (Gmail) accounts can use the app; everyone else is
   denied. Admins manage the whitelist.
6. Deployed to the public web with no domain purchase and no hosting cost.

### Decisions

- **Roles:** admins create/delete polls, add/remove songs, and manage members.
  Non-admin members only vote.
- **Visibility:** results are live, and each member's allocation is visible to
  all members.
- **Lifecycle:** polls never close. Members may change their allocation at any
  time; the ranking always reflects current votes.
- **Scale assumption:** a small band (~3–10 members); free-tier limits are not
  a concern.

### Out of scope

Poll renaming, song editing, comments, notifications, poll deadlines/closing,
CI auto-deploy, server-side enforcement of the 100-point total.

## Architecture

A React + Vite single-page app served from Firebase Hosting at
`https://<project-id>.web.app`. The browser talks directly to Firebase Auth
(Google sign-in) and Cloud Firestore. There is no custom backend; access
control is enforced by Firestore security rules. Everything runs on the free
Spark plan, which requires no credit card.

## Data model

```
members/{email}                 doc ID = lowercased email address
  admin: bool
  addedBy: string (email)
  addedAt: timestamp

polls/{pollId}
  title: string
  createdBy: string (email)
  createdAt: timestamp

polls/{pollId}/songs/{songId}
  title: string
  artist: string
  addedBy: string (email)
  addedAt: timestamp

polls/{pollId}/votes/{email}    doc ID = voter's lowercased email
  points: map<songId, int>      values 0–100, total exactly 100
  updatedAt: timestamp
```

### Ranking

Computed on the client: sum `points[songId]` across all vote docs in the poll,
for songs that currently exist. Sort by total descending; ties are broken
alphabetically by song title. Songs with no points appear at the bottom with 0.
A real-time listener on songs and votes keeps the ranking live.

### Song changes after voting

- **Song added:** existing votes still total 100; the new song starts at 0.
  Members may reallocate.
- **Song removed:** points that member gave to it are ignored in the ranking.
  When that member opens the poll, their ballot shows "N points unassigned"
  and Save is disabled until the total is back to 100. Ballot validation
  counts only keys for songs that currently exist, and saving writes only
  those keys, so orphaned song IDs are dropped from the vote doc.

## Security rules

Helper functions:

- `isMember()` — `request.auth != null`, `request.auth.token.email_verified == true`,
  and `members/{request.auth.token.email.lower()}` exists.
- `isAdmin()` — `isMember()` and that member doc has `admin == true`.

| Path | Read | Create / Update / Delete |
|---|---|---|
| `members/{email}` | member | admin |
| `polls/{pollId}` | member | admin |
| `polls/{pollId}/songs/{songId}` | member | admin |
| `polls/{pollId}/votes/{email}` | member | member whose lowercased auth email equals `{email}`; on create/update, `points` must be a map |

Default: deny everything else.

**Limitation:** Firestore rules cannot iterate over map values, so the
"each value is an integer 0–100 and the total is exactly 100" check is
enforced on the client only. A technically capable member could bypass it;
this is accepted because all members are trusted bandmates. Server-side
enforcement would require Cloud Functions (paid Blaze plan).

**Bootstrapping:** the first admin is created manually in the Firebase console
(`members/<email>` with `admin: true`).

**Lockout prevention:** the UI does not let an admin remove or demote
themselves. Recovery from any lockout is done manually in the console.

## Screens

1. **Sign in** — "Sign in with Google" button.
2. **Not authorized** — shown to signed-in users without a member doc.
   Displays their email, "Ask an admin to add you", and a sign-out button.
3. **Polls list** — all polls, newest first, each linking to its poll page.
   Admins see a "New poll" form (title only) and a delete button per poll.
4. **Poll page**
   - **Ranking:** songs sorted by total; each row shows the total and a
     per-member breakdown. Live.
   - **My ballot:** a number input per song, a "Points left: N" counter, and a
     Save button enabled only when values are integers 0–100 summing to
     exactly 100. Pre-filled from the member's saved vote.
   - **Admin only:** "Add song" form (title, artist) and a remove button per
     song.
5. **Members (admin only)** — list of whitelisted emails with admin flags.
   Add an email (trimmed, lowercased, basic email-format check), toggle admin,
   remove. An admin cannot remove or demote themselves.

A header shows the signed-in email, a sign-out button, and (for admins) a link
to Members.

### Poll deletion

Firestore does not cascade-delete subcollections, so deleting a poll first
deletes all its `songs` and `votes` docs in a batched write, then deletes the
poll doc.

### Error handling

- Firestore permission errors show "You don't have access" rather than a crash.
- Failed writes (network, permissions) show an inline error message and keep
  the user's input.
- The ballot shows validation messages (non-integer, out of range, total ≠ 100)
  inline.

## Code layout

```
src/
  lib/firebase.js      Firebase app/auth/firestore initialization from env
  lib/ranking.js       computeRanking(songs, votes) -> sorted rows (pure)
  lib/ballot.js        validateBallot(points, songIds) -> {total, remaining, errors} (pure)
  hooks/useAuth.js     current Firebase user, sign in / sign out
  hooks/useMember.js   member doc for the current user (null = not authorized)
  hooks/usePolls.js    live list of polls
  hooks/usePoll.js     live poll, songs, and votes
  pages/SignIn.jsx
  pages/NotAuthorized.jsx
  pages/PollsList.jsx
  pages/PollPage.jsx
  pages/Members.jsx
  App.jsx              routing (react-router) and auth/member gating
firestore.rules
firebase.json          Hosting (dist, SPA rewrite), Firestore, Emulators
```

## Deployment

1. Create a Firebase project; enable Authentication → Google; create a
   Firestore database in production mode.
2. `firebase init`: Hosting (public dir `dist`, rewrite all URLs to
   `/index.html`), Firestore rules, Emulators (Auth, Firestore).
3. Put the Firebase web config in `.env` as `VITE_FIREBASE_*`. These are public
   identifiers, not secrets; security comes from the rules.
4. Seed the first admin in the console.
5. `npm run build && firebase deploy`. The `*.web.app` domain is already an
   authorized sign-in domain.

## Testing

- **Unit (Vitest), test-first:** `ranking.js` (sorting, ties, points for
  deleted songs, empty polls); `ballot.js` (exactly 100, non-integers,
  negatives, values over 100, unassigned points after song removal).
- **Security rules:** `@firebase/rules-unit-testing` against the Firestore
  emulator. Non-member denied everything; member can read but not write
  polls/songs/members; member can write only their own vote; admin can manage
  polls, songs, and members.
- **Components (React Testing Library):** ballot counter and Save button
  enable/disable behavior.

### Prerequisites

- Node 20+ and the Firebase CLI (`npm i -g firebase-tools`).
- The Firestore emulator requires a Java runtime, version 11 or later. Prefer
  an Intuit-approved OpenJDK distribution (check internal guidance for which
  are approved). Set `JAVA_HOME` to that JDK's explicit path, e.g.
  `<path-to-intended-jdk>/Contents/Home` on macOS, rather than a version-only
  lookup; `/usr/libexec/java_home -V` lists installed JDKs.
