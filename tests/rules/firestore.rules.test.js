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
