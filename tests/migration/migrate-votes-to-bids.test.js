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
