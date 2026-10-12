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
