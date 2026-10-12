import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

vi.mock('./useFirestore.js', () => ({ useCollection: vi.fn(), useDocument: vi.fn() }));

import { useCollection, useDocument } from './useFirestore.js';
import { usePoll } from './usePoll.js';

const NOW = new Date(2026, 9, 12, 12, 0, 0);
const ME = 'me@gmail.com';
const SONGS = [{ id: 's1', title: 'Africa' }];
const ALL_BIDS = [
  { id: ME, points: { s1: 100 } },
  { id: 'other@gmail.com', points: { s1: 100 } },
];

const ready = (data) => ({ data, loading: false, error: null });
const idle = (empty) => ({ data: empty, loading: false, error: null });

function setup(poll) {
  useDocument.mockImplementation((segments) => {
    if (segments === null) return idle(null);
    if (segments.length === 2) return ready(poll);
    return ready({ id: ME, points: { s1: 100 } });
  });
  useCollection.mockImplementation((segments) => {
    if (segments === null) return idle([]);
    if (segments[2] === 'songs') return ready(SONGS);
    return ready(ALL_BIDS);
  });
}

const bidsCollectionArgs = () => useCollection.mock.calls.map(([segments]) => segments).filter((s) => s?.[2] !== 'songs');
const ownBidArgs = () => useDocument.mock.calls.map(([segments]) => segments).filter((s) => s?.length !== 2);

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('usePoll', () => {
  it('listens to every bid on an open-visibility poll', () => {
    setup({ id: 'p1', title: 'Summer set', budget: 150 });
    const { result } = renderHook(() => usePoll('p1', ME, NOW));
    expect(bidsCollectionArgs()).toContainEqual(['polls', 'p1', 'bids']);
    expect(ownBidArgs().every((s) => s === null)).toBe(true);
    expect(result.current.bidsVisible).toBe(true);
    expect(result.current.closed).toBe(false);
    expect(result.current.settings.budget).toBe(150);
    expect(result.current.bids).toEqual([
      { email: ME, points: { s1: 100 } },
      { email: 'other@gmail.com', points: { s1: 100 } },
    ]);
    expect(result.current.myBid).toEqual({ email: ME, points: { s1: 100 } });
    expect(result.current.songs).toBe(SONGS);
  });

  it('listens only to your own bid on a sealed poll that is still open', () => {
    setup({ id: 'p1', title: 'Summer set', sealed: true });
    const { result } = renderHook(() => usePoll('p1', ME, NOW));
    expect(ownBidArgs()).toContainEqual(['polls', 'p1', 'bids', ME]);
    expect(bidsCollectionArgs().every((s) => s === null)).toBe(true);
    expect(result.current.bidsVisible).toBe(false);
    expect(result.current.bids).toEqual([{ email: ME, points: { s1: 100 } }]);
    expect(result.current.myBid).toEqual({ email: ME, points: { s1: 100 } });
  });

  it('switches to every bid once a sealed poll is closed', () => {
    setup({ id: 'p1', title: 'Summer set', sealed: true, closed: true });
    const { result } = renderHook(() => usePoll('p1', ME, NOW));
    expect(bidsCollectionArgs()).toContainEqual(['polls', 'p1', 'bids']);
    expect(result.current.closed).toBe(true);
    expect(result.current.bidsVisible).toBe(true);
  });

  it('reports closed at the end date but keeps sealed bids hidden during the clock grace', () => {
    setup({ id: 'p1', title: 'Summer set', sealed: true, endsAt: new Date(NOW.getTime() - 1000) });
    const { result } = renderHook(() => usePoll('p1', ME, NOW));
    expect(result.current.closed).toBe(true);
    expect(result.current.bidsVisible).toBe(false);
    expect(ownBidArgs()).toContainEqual(['polls', 'p1', 'bids', ME]);
  });

  it('has no bid when you have not bid on a sealed poll', () => {
    setup({ id: 'p1', title: 'Summer set', sealed: true });
    useDocument.mockImplementation((segments) =>
      segments?.length === 2 ? ready({ id: 'p1', sealed: true }) : idle(null),
    );
    const { result } = renderHook(() => usePoll('p1', ME, NOW));
    expect(result.current.bids).toEqual([]);
    expect(result.current.myBid).toBeNull();
  });

  it('does not subscribe to bids until the poll has loaded, or when it does not exist', () => {
    setup(null);
    const { result } = renderHook(() => usePoll('p1', ME, NOW));
    expect(bidsCollectionArgs().every((s) => s === null)).toBe(true);
    expect(ownBidArgs().every((s) => s === null)).toBe(true);
    expect(result.current.poll).toBeNull();
    expect(result.current.settings.budget).toBe(100);
  });

  it('combines loading and errors', () => {
    setup({ id: 'p1', title: 'Summer set' });
    useCollection.mockImplementation((segments) => {
      if (segments?.[2] === 'bids') return { data: [], loading: false, error: { code: 'permission-denied' } };
      return { data: [], loading: true, error: null };
    });
    const { result } = renderHook(() => usePoll('p1', ME, NOW));
    expect(result.current.loading).toBe(true);
    expect(result.current.error).toEqual({ code: 'permission-denied' });
  });

  describe('permission-denied on the bids collection', () => {
    const denyBids = () =>
      useCollection.mockImplementation((segments) => {
        if (segments === null) return idle([]);
        if (segments[2] === 'songs') return ready(SONGS);
        return { data: [], loading: false, error: { code: 'permission-denied' } };
      });

    it('recovers on a sealed closed poll: hides the error, shows own bid, retries later', () => {
      vi.useFakeTimers();
      setup({ id: 'p1', title: 'Summer set', sealed: true, closed: true });
      denyBids();
      const { result } = renderHook(() => usePoll('p1', ME, NOW));
      expect(result.current.error).toBeNull();
      expect(result.current.bidsVisible).toBe(false);
      expect(ownBidArgs()).toContainEqual(['polls', 'p1', 'bids', ME]);
      expect(result.current.myBid).toEqual({ email: ME, points: { s1: 100 } });

      useCollection.mockClear();
      act(() => {
        vi.advanceTimersByTime(3000);
      });
      const retried = useCollection.mock.calls.filter(([segments]) => segments?.[2] === 'bids');
      expect(retried.length).toBeGreaterThan(0);
      expect(retried.every(([, , attempt]) => attempt === 1)).toBe(true);
    });

    it('clears the retry timer on unmount', () => {
      vi.useFakeTimers();
      setup({ id: 'p1', title: 'Summer set', sealed: true, closed: true });
      denyBids();
      const { unmount } = renderHook(() => usePoll('p1', ME, NOW));
      expect(vi.getTimerCount()).toBe(1);
      unmount();
      expect(vi.getTimerCount()).toBe(0);
    });

    it('still surfaces the error on a poll that is not sealed', () => {
      setup({ id: 'p1', title: 'Summer set' });
      denyBids();
      const { result } = renderHook(() => usePoll('p1', ME, NOW));
      expect(result.current.error).toEqual({ code: 'permission-denied' });
      expect(result.current.bidsVisible).toBe(true);
    });
  });
});
