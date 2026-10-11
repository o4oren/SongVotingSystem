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
