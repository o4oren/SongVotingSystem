# Bidding Polls — Design

Date: 2026-10-12
Status: Approved in conversation; awaiting written-spec review
Builds on: `2026-10-11-song-voting-design.md` (superseded where this spec differs)

## Purpose

Members don't "vote" for songs; they **bid** a budget of points across them.
This change makes that explicit and gives admins control over each poll's
lifecycle and rules: when it closes, how big the budget is, and whether bids
are visible while bidding is open. It also gives the app a real visual style.

## Requirements

1. An admin can close a poll by hand, or give it an end date at which it
   closes automatically. A closed poll shows its results but accepts no bids.
2. Every poll with an end date shows a live countdown to that time.
3. When creating a poll, an admin sets its budget (default 100).
4. When creating a poll, an admin chooses its visibility: **open** (default;
   bids and ranking are visible live, as today) or **sealed** (each member sees
   only their own bid until the poll closes).
5. "Vote" becomes "bid" everywhere: UI, docs, code and the Firestore data.
   Existing votes are migrated to bids.
6. The UI adopts the "Fresh & Bright" visual style.
7. Everything stays on Firebase's free Spark plan (no Cloud Functions).

### Decisions

- **Enforcement:** closing, sealed visibility and the settings lock are
  enforced by Firestore security rules, not only by the UI. The exact-budget
  check stays client-side (rules can't sum map values).
- **Time-based closing** uses `request.time` in rules and the client clock in
  the UI. Nothing on the server flips a flag at the end date.
- **What admins can change after creation:**
  - Close, reopen, and set, change or clear the end date: at any time.
  - Budget and visibility: until the first bid is placed, then locked by the rules.
- **Closing freezes bids.** On a closed poll, members can't create, update or
  withdraw a bid. Admins can still delete bids, so poll deletion keeps working.
- **Budget range:** a whole number from 1 to 1000.
- **Existing polls** read as budget 100, open visibility, not closed, no end
  date. No backfill is needed.

## Data model

### `polls/{pollId}`

| Field | Type | Default | Notes |
|---|---|---|---|
| `title` | string | — | unchanged |
| `createdBy` | string | — | unchanged |
| `createdAt` | timestamp | — | unchanged |
| `budget` | int, 1–1000 | 100 | locked once `hasBids` is true |
| `sealed` | bool | `false` | locked once `hasBids` is true |
| `closed` | bool | `false` | manual close; cleared on reopen |
| `endsAt` | timestamp or null | `null` | optional automatic close time |
| `hasBids` | bool | `false` | set to `true` with a member's first bid; never unset |

A missing field means its default. The client reads every poll through
`pollSettings(poll)` in `src/lib/poll.js`, which returns
`{ budget, sealed, closed, endsAt, hasBids }` with the defaults applied
(`endsAt` as a JS `Date` or `null`). Rules use `data.get(field, default)`.

### `polls/{pollId}/bids/{email}`

`{ points: { [songId]: int }, updatedAt: timestamp }`, the same shape as the old
`votes` documents.

### `polls/{pollId}/votes/{email}` (legacy)

Kept only until a later cleanup. Admins can read and delete these documents, so
the migration can be checked and `deletePoll` can remove leftovers. The app
never reads them otherwise.

## Poll state

`isPollClosed(poll, now)` (pure, in `src/lib/poll.js`) returns true when
`closed` is true, or when `endsAt` is set and `now >= endsAt`.

| State | Ranking area | Ballot |
|---|---|---|
| Open, open visibility | Live ranking with each member's breakdown | Editable |
| Open, sealed | "Bids are sealed until the poll closes." | Editable |
| Closed (either) | **Final results** with full breakdown | Own bid, read-only; "Bidding is closed." |

## Security rules

```
function pollData() {
  return get(/databases/$(database)/documents/polls/$(pollId)).data;
}
function pollOpen(p) {
  return !p.get('closed', false)
    && (p.get('endsAt', null) == null || request.time < p.endsAt);
}

match /polls/{pollId} {
  allow read: if isMember();

  allow create: if isAdmin()
    && request.resource.data.budget is int
    && request.resource.data.budget >= 1 && request.resource.data.budget <= 1000
    && request.resource.data.sealed is bool
    && request.resource.data.get('hasBids', false) == false;

  // Admins: anything, except budget/sealed once bids exist, and hasBids never unset.
  // Members: only flip hasBids to true, only while the poll is open.
  allow update: if (isAdmin()
      && !(resource.data.get('hasBids', false) && !request.resource.data.get('hasBids', false))
      && (!resource.data.get('hasBids', false)
          || (request.resource.data.get('budget', 100) == resource.data.get('budget', 100)
              && request.resource.data.get('sealed', false) == resource.data.get('sealed', false))))
    || (isMember()
      && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['hasBids'])
      && request.resource.data.hasBids == true
      && pollOpen(resource.data));

  allow delete: if isAdmin();

  match /songs/{songId} { /* unchanged: member read, admin write */ }

  // The exact-budget check is client-side only: rules can't sum map values.
  match /bids/{email} {
    allow read: if isMember()
      && (email == myEmail() || !pollData().get('sealed', false) || !pollOpen(pollData()));
    allow create, update: if isMember() && email == myEmail()
      && request.resource.data.points is map && pollOpen(pollData());
    allow delete: if isAdmin()
      || (isMember() && email == myEmail() && pollOpen(pollData()));
  }

  match /votes/{email} {
    allow read, delete: if isAdmin();
  }
}
```

**Sealed-poll querying.** Firestore rejects a whole query if any document it
could return is unreadable. So on a sealed poll that is still open,
`usePoll` listens only to `bids/{myEmail}`. When the poll is open-visibility or
closed, it listens to the whole `bids` collection. `usePoll` picks the
listener from `pollSettings` and `isPollClosed` and switches when the state
changes (including when the countdown reaches zero).

## Client components

### `src/lib/poll.js` (new)
- `DEFAULT_BUDGET = 100`, `MIN_BUDGET = 1`, `MAX_BUDGET = 1000`
- `pollSettings(poll)`: defaults as above
- `isPollClosed(poll, now)`
- `formatCountdown(ms)`:
  - 1 day or more: `"2d 4h 12m"`
  - 1 hour up to 1 day: `"4h 12m"`
  - under 1 hour: `"12m 05s"`
  - 0 or less: `""`

### `src/hooks/useNow.js` (new)
Returns the current `Date`, re-rendering every second. Only mounted where a
countdown or time-based state is needed: the poll page, and the polls list when
any poll has an `endsAt`.

### `src/lib/ballot.js`
`TOTAL_POINTS` is removed. Each of the following takes `budget` as a parameter:
- `validateBallot(points, songIds, budget)`
- `cleanPoints(points, songIds, budget)`
- `isValidPoints(n, budget)`

Messages use "bid" and the poll's budget, for example
`"20 points unassigned — your bid must total exactly 150."` and
`"You are 10 points over 150."`

### `src/lib/ranking.js`
`computeRanking(songs, bids, budget)`. Same output, with entries keyed on
bids instead of votes.

### `src/lib/db.js`
- `createPoll({ title, budget, sealed, endsAt }, byEmail)` writes `closed: false` and `hasBids: false`.
- `updatePollSettings(pollId, changes)` is a partial update used by the admin panel.
- `closePoll(pollId)` sets `closed: true`.
- `reopenPoll(pollId, now)` sets `closed: false`, and also clears `endsAt` if it is already past.
- `saveBid(pollId, email, points, { hasBids })` is a batch that writes the bid
  and, when `hasBids` is false, sets `hasBids: true` on the poll.
- `deletePoll` deletes `songs`, `bids` and legacy `votes`.

### `src/hooks/usePoll.js`
Returns `{ poll, settings, closed, songs, bids, myBid, loading, error }`,
choosing the bids listener as described under *Sealed-poll querying*.

### `src/pages/PollsList.jsx`
- **Create form** (admins only): title, budget (number, default 100), visibility
  (radio: Open / Sealed, each with a one-line explanation) and an optional end
  date (`datetime-local`, admin's local time).
- **Validation:** title required, budget a whole number from 1 to 1000, end
  date (if given) in the future.
- **Each row:** a status badge (**Open**, **Closes in …** live, or **Closed**)
  and a **Sealed** chip when it applies.

### `src/pages/PollPage.jsx`
- **Header:** title, status badge, "Budget: N pts", and the live
  `Countdown` when `endsAt` is set and the poll is open. When the countdown
  reaches zero, the page shows the closed state without a reload.
- **Body:** follows the poll-state table above.
- **Songs:** adding and removing songs (admin) is hidden when the poll is closed.

### `src/components/Countdown.jsx` (new)
Renders "Closes in {formatCountdown(endsAt - now)}" from a `now` prop.

### `src/components/PollSettings.jsx` (new, admins only)
- **Close now** or **Reopen**, each with a confirm step.
- **End date:** set, change or clear.
- **Budget and visibility:** editable while `hasBids` is false. Once it is
  true, they are read-only with "Locked — bids have been placed."
- **Save errors** show inline.

### `src/components/Ballot.jsx`
- **Props:** takes `budget` and `readOnly`.
- **Copy:** heading "My bid"; "Budget left: 20 / 150"; button **Place bid**
  (no saved bid yet) or **Update bid**.
- **Read-only (closed):** inputs are disabled, no button, and the text
  "Bidding is closed."
- **Closed during a save:** a save that fails with `permission-denied` because
  the poll has closed shows "Bidding closed for this poll."

### `src/components/Ranking.jsx`
- **Score bars:** a bar under each song, scaled to the leader's total.
- **Totals:** shown as a points pill.
- **Heading:** "Ranking" while open, "Final results" when closed.

## Visual style: "Fresh & Bright"

The style is CSS-only, in `src/index.css`, with no UI library and no new
runtime dependency.

- **Light tokens:**
  - text `#1c2033`, background `#ffffff`, surface `#f6f7fb`, line `#e6e8f0`
  - primary `#6d4aff`, primary-soft `#efeaff`, highlight `#ff6a3d`
  - open badge `#e8fbef` / `#1d8a4a`; closed badge: neutral gray
  - danger: red
- **Dark tokens** (under `prefers-color-scheme: dark`): deep navy background,
  lighter surface, lighter violet primary, the same highlight and badge colors
  adjusted for contrast.
- **Gradient text** (violet to orange) on the brand name and poll titles.
- **Components:**
  - rounded cards (8px radius) for list rows, ranking rows and panels
  - pill badges for status, sealed and the countdown
  - a filled primary button, a ghost secondary button, and a red outline for danger
- **Layout:** keeps the 720px column. Rows wrap on phones.

## Terminology

- **UI and README:** "vote(s)/voting" becomes "bid(s)/bidding". "Points" stays
  as the unit; "budget" is the allowance.
- **Code:** identifiers are renamed, e.g. `saveVote` becomes `saveBid` and
  `votes` becomes `bids`.
- **Firestore:** the subcollection `votes` becomes `bids`.
- **Unchanged:** the package name, the repo name, and past specs and plans.
  The old spec gets a one-line note pointing here.

## Migration

`scripts/migrate-votes-to-bids.js` is a Node script run once by hand.

- **Access:** it uses `firebase-admin` (a new dev dependency) with a
  service-account key whose path comes from `GOOGLE_APPLICATION_CREDENTIALS`.
  Admin SDK access works on Spark. Key files are git-ignored
  (`*-service-account*.json`).
- **What it does:** for every poll, it copies each `votes/{email}` to
  `bids/{email}` and skips bids that already exist, so it is safe to re-run.
  It sets `hasBids: true` on every poll that has at least one vote.
- **Options:** `--dry-run` prints what it would do and writes nothing. Both
  modes print counts.
- **Old data:** it leaves `votes` in place. A later, separate change deletes
  them and their rule.
- **Docs:** the README gets a short section on how to create the key, run a
  dry run, run it for real, and check the result.

## Error handling

- **Bid save rejected because the poll closed** (for example, the end date
  passed mid-edit): the ballot shows "Bidding closed for this poll." The page
  is already showing the closed state on its own.
- **Settings change on a locked poll:** the UI prevents it. If the rules reject
  it anyway, the panel shows the standard error message.
- **End date in the past:** rejected on create. On edit it is allowed and
  means "closed as of that time".
- **Other failures:** reported with `errorMessage(err)`, as today.

## Testing

- **Unit (Vitest):**
  - `pollSettings` defaults
  - `isPollClosed` (manual close, `endsAt` before, at and after)
  - `formatCountdown` boundaries
  - `validateBallot` and `cleanPoints` with budgets of 1, 100 and 150
  - `computeRanking` with bids and a custom budget
- **Components and pages (Testing Library):**
  - Ballot: budget copy, Place/Update label, read-only mode, closed-save error
  - PollPage: the three states, and the countdown switching to closed at zero (fake timers)
  - PollsList: create form validation and defaults, status badges
  - PollSettings: lock when `hasBids`, close and reopen
- **Rules (emulator):**
  - bid writes blocked when `closed` and when `endsAt` has passed
  - sealed reads (own only while open, everyone's after close)
  - members can only set `hasBids` to true, only while open
  - admins can't change budget or sealed once `hasBids` is set, and can't unset `hasBids`
  - create validation (budget range and type, sealed type)
  - legacy `votes` admin-only
  - poll deletion still removes everything
- **Migration:**
  - a dry run against the emulator makes no writes
  - a real run copies the votes and sets `hasBids`
  - a second run is a no-op

## Out of scope

- Deleting legacy `votes` data and its rule. That is a later cleanup.
- Notifications when a poll closes.
- Server-side validation of bid totals.
