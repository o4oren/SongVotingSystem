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

## 1. Prerequisites

| Tool | Version | Needed for |
|---|---|---|
| [Node.js](https://nodejs.org) | 20+ (`.nvmrc` pins 22) | everything |
| A Google account | — | Firebase console and signing in |
| Java runtime | 21+ | only `npm run test:rules` (the Firestore emulator) |

The Firebase CLI (`firebase-tools`) is installed as a dev dependency, so you run it with `npx firebase`. There's no global install.

For Java, use an Intuit-approved OpenJDK distribution, and point `JAVA_HOME` at it explicitly rather than with a version-only lookup. On macOS:

```bash
/usr/libexec/java_home -V                                   # list installed JDKs
export JAVA_HOME=<path-to-intended-jdk>/Contents/Home        # pick one explicitly
java -version                                               # confirm vendor and version 21+
```

## 2. Get the code

```bash
git clone https://github.com/o4oren/SongVotingSystem.git
cd SongVotingSystem
nvm use            # or otherwise make sure `node --version` is 20+
npm install
```

## 3. Create the Firebase project (one time)

You do this once for the band. The app can't run until it's done, because local development talks to the real project too.

### 3.1 Create the project
1. Open the [Firebase console](https://console.firebase.google.com) and click **Create a project**.
2. Pick a name. The **project ID** shown under it becomes your URL (`https://<project-id>.web.app`) and can't be changed later, so choose it carefully.
3. Google Analytics isn't needed, so you can turn it off.
4. Stay on the free **Spark** plan. Don't add billing.

### 3.2 Turn on Google sign-in
1. **Build → Authentication → Get started**.
2. **Sign-in method → Google → Enable**, choose a support email, and click **Save**.
3. Under **Authentication → Settings → Authorized domains**, check that `localhost`, `<project-id>.firebaseapp.com` and `<project-id>.web.app` are listed. They are by default.

### 3.3 Create the Firestore database
1. **Build → Firestore Database → Create database**.
2. Keep the default database ID, `(default)`, and pick a location near the band. The location can't be changed later.
3. Choose **Start in production mode**. Our own rules replace the default rules when you deploy (step 6).

### 3.4 Register the web app and copy its config
1. **Project settings** (the gear icon) **→ General → Your apps → Web (`</>`)**.
2. Give it a nickname. You can skip "Firebase Hosting setup" here, because the CLI handles it.
3. Firebase shows a `firebaseConfig` object. Copy its values into a local `.env` file:

   ```bash
   cp .env.example .env
   ```

   ```
   VITE_FIREBASE_API_KEY=...            # apiKey
   VITE_FIREBASE_AUTH_DOMAIN=...        # authDomain, e.g. <project-id>.firebaseapp.com
   VITE_FIREBASE_PROJECT_ID=...         # projectId
   VITE_FIREBASE_STORAGE_BUCKET=...     # storageBucket
   VITE_FIREBASE_MESSAGING_SENDER_ID=...  # messagingSenderId
   VITE_FIREBASE_APP_ID=...             # appId
   ```

   These values are public identifiers, not secrets: the security rules protect the data. `.env` is git-ignored anyway, so each developer keeps their own copy.

### 3.5 Make yourself the first admin
1. **Firestore Database → Data → Start collection**, with collection ID `members`.
2. **Document ID:** your Gmail address in **lowercase**, e.g. `you@gmail.com`.
3. Add one field, `admin`, of type **boolean**, value `true`. Save.

From now on, you add everyone else from inside the app (step 7).

### 3.6 Link this folder to the project
```bash
npx firebase login
npx firebase use --add        # pick your project, give it the alias "default"
```
This creates `.firebaserc`, which is safe to commit.

## 4. Run it locally

```bash
npm run dev                   # http://localhost:5173
```

Sign in with the Google account from step 3.5. You should see the Polls page with a **Members** link in the header.

The local app reads and writes the **real** Firestore database, so polls you create while testing are real. Delete them afterwards.

## 5. Run the tests

```bash
npm test                      # unit and component tests (no Firebase needed)
npm run test:rules            # security rules + migration tests; starts the Firestore emulator, needs Java 21+
```

`test:rules` runs against a local emulator project, `demo-songvote`. It never touches your real database. The migration tests run here too, and they refuse to run outside the emulator.

## 6. Deploy

```bash
npm run deploy
```

This builds the app and deploys both Hosting and the Firestore rules. When it finishes, the output shows:

```
Hosting URL: https://<project-id>.web.app
```

Run it again after every change you want to publish.

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

## Troubleshooting

| Problem | Fix |
|---|---|
| "Not on the band list" for someone who should be on it | The member document ID must be exactly the address Google signs them in with, in lowercase. Check **Members** (or the `members` collection). After adding someone, they need to reload the page. |
| You're the admin but see "Not on the band list" | Check step 3.5: document ID in lowercase, field `admin` of type boolean (not the string `"true"`), in collection `members`. |
| The sign-in popup doesn't open | Allow popups for the site. If the link was opened inside a chat app's built-in browser, open it in Safari or Chrome instead. |
| "You don't have access." errors | Make sure the rules were deployed (`npm run deploy`), and that you're signed in with a whitelisted account. |
| "Bidding closed for this poll." when saving | The poll closed (by an admin or its end date) while you were editing. Your last saved bid still counts. |
| Old polls show no bids after upgrading | Run the migration in section 8. |
| "Tallying final results…" keeps showing after a sealed poll closes | Your device clock is probably ahead of the server's. The app keeps retrying; fixing the device's date and time settings (or reloading) clears it. |
| A blank page, or Firebase "invalid-api-key" errors locally | `.env` is missing or incomplete. Compare it with step 3.4, then restart `npm run dev`. |
| `test:rules` fails with "firebase-tools no longer supports Java version before 21" | Point `JAVA_HOME` at a JDK 21+ (see Prerequisites). |
| `npm install` fails with `ETARGET` for `@protobufjs/...` | See "Pinned packages" below. |

## Pinned packages

`package.json` has `overrides` that pin a few indirect dependencies:

- `protobufjs@^7` is pinned to `7.5.5`, because the Intuit npm mirror is missing `@protobufjs/*@1.1.1`, which newer versions need.
- `@firebase/app` and `@firebase/app-compat` are pinned to the exact versions `firebase` itself pins, so the rules-test library sees a single Firebase app registry.

Revisit these pins when upgrading `firebase`.

## Project layout

```
src/lib/        pure logic (poll settings and countdown, ballot validation, ranking, email) + Firebase client and writes (db.js)
src/hooks/      live Firestore listeners, auth, and the useNow clock
src/components/ Ballot, Ranking, PollStatus, Countdown, PollSettings, AddSongForm, Header
src/pages/      SignIn, NotAuthorized, PollsList, PollPage, Members
firestore.rules security rules; tests in tests/rules/
scripts/        one-off admin scripts (votes → bids migration); tests in tests/migration/
docs/superpowers/ design specs and implementation plans
```

## Known limitations

- **The exact-budget check runs in the browser.** The "whole numbers that add up to exactly the budget" check is client-side only. Firestore rules can't add up a map of values, and enforcing it on the server would need Cloud Functions, which require the paid Blaze plan. That's fine for trusted bandmates. Closing, sealed visibility and the settings lock *are* enforced by the rules.
- **Removed members' bids still count** in polls they already bid in.
- **Sealed results appear a few seconds after the end date.** The app waits briefly so the server's clock agrees the poll has closed.
- **Admins are bidders too.** A sealed poll hides other members' bids from admins as well, until it closes.
- **Admins can lift a seal early.** Closing and then reopening a sealed poll (or moving its end date) reveals everyone's bids to whoever is watching while it's closed. Admins are trusted; treat Reopen on a sealed poll as a last resort.
