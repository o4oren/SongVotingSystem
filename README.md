# Band Song Vote

A free web app for our cover band: each member gets 100 points per poll to spread across songs, and songs are ranked by total points. Only Google accounts on the band list can sign in.

Built with React + Vite on Firebase (Hosting, Auth, Firestore), all on the free Spark plan.

## How it works

- **Admins** create and delete polls, add and remove songs, and manage the member list.
- **Members** spread exactly 100 whole points across a poll's songs and can change them at any time.
- Rankings update live, and everyone can see who gave what.

## Prerequisites

- Node 20+ (`.nvmrc` pins 22; run `nvm use`)
- A Java runtime, version 21+, for the Firestore emulator (only needed for `npm run test:rules`; firebase-tools refuses older Java). Use an Intuit-approved OpenJDK distribution and point `JAVA_HOME` at it explicitly, e.g. on macOS `export JAVA_HOME=<path-to-intended-jdk>/Contents/Home` (list installed JDKs with `/usr/libexec/java_home -V`).

## Development

```bash
npm install
cp .env.example .env      # then fill in your Firebase web config
npm run dev               # http://localhost:5173
npm test                  # unit and component tests
npm run test:rules        # Firestore security rules tests (starts the emulator)
```

`package.json` has `overrides` that pin a few transitive packages:

- `protobufjs@^7` is pinned to `7.5.5`, because the Intuit npm mirror is missing `@protobufjs/*@1.1.1`, which newer versions need.
- `@firebase/app` and `@firebase/app-compat` are pinned to the versions `firebase` itself pins, so the rules-test library sees a single Firebase app registry.

Revisit these pins when upgrading `firebase`.

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
