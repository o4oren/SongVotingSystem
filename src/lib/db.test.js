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
