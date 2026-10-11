import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((db, ...path) => ({ path: path.join('/') })),
  doc: vi.fn((db, ...path) => ({ path: path.join('/') })),
  onSnapshot: vi.fn(),
  orderBy: vi.fn((field, direction) => ({ field, direction })),
  query: vi.fn((ref) => ref),
}));

import { onSnapshot } from 'firebase/firestore';
import { useCollection, useDocument } from './useFirestore.js';

let listener;

beforeEach(() => {
  vi.clearAllMocks();
  listener = {};
  onSnapshot.mockImplementation((ref, onNext, onError) => {
    listener.ref = ref;
    listener.onNext = onNext;
    listener.onError = onError;
    listener.unsubscribe = vi.fn();
    return listener.unsubscribe;
  });
});

describe('useCollection', () => {
  it('starts loading, then maps docs to { id, ...data }', () => {
    const { result } = renderHook(() => useCollection(['polls']));
    expect(result.current).toEqual({ data: [], loading: true, error: null });

    act(() => listener.onNext({ docs: [{ id: 'p1', data: () => ({ title: 'Summer set' }) }] }));

    expect(result.current).toEqual({ data: [{ id: 'p1', title: 'Summer set' }], loading: false, error: null });
  });

  it('reports listener errors', () => {
    const { result } = renderHook(() => useCollection(['polls']));
    act(() => listener.onError({ code: 'permission-denied' }));
    expect(result.current).toEqual({ data: [], loading: false, error: { code: 'permission-denied' } });
  });

  it('does not subscribe when the path is null', () => {
    const { result } = renderHook(() => useCollection(null));
    expect(onSnapshot).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
  });

  it('unsubscribes on unmount', () => {
    const { unmount } = renderHook(() => useCollection(['polls']));
    unmount();
    expect(listener.unsubscribe).toHaveBeenCalled();
  });
});

describe('useDocument', () => {
  it('returns { id, ...data } for an existing doc', () => {
    const { result } = renderHook(() => useDocument(['members', 'bob@gmail.com']));
    act(() => listener.onNext({ id: 'bob@gmail.com', exists: () => true, data: () => ({ admin: false }) }));
    expect(result.current.data).toEqual({ id: 'bob@gmail.com', admin: false });
  });

  it('returns null for a missing doc', () => {
    const { result } = renderHook(() => useDocument(['polls', 'nope']));
    act(() => listener.onNext({ id: 'nope', exists: () => false, data: () => undefined }));
    expect(result.current).toEqual({ data: null, loading: false, error: null });
  });
});
