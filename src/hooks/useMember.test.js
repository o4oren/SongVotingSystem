import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

vi.mock('./useFirestore.js', () => ({ useDocument: vi.fn() }));

import { useDocument } from './useFirestore.js';
import { useMember } from './useMember.js';

beforeEach(() => vi.clearAllMocks());

describe('useMember', () => {
  it('returns the member doc', () => {
    useDocument.mockReturnValue({ data: { id: 'bob@gmail.com', admin: true }, loading: false, error: null });
    const { result } = renderHook(() => useMember('bob@gmail.com'));
    expect(useDocument).toHaveBeenCalledWith(['members', 'bob@gmail.com']);
    expect(result.current).toEqual({ member: { id: 'bob@gmail.com', admin: true }, loading: false, error: null });
  });

  it('treats permission-denied as "not on the list"', () => {
    useDocument.mockReturnValue({ data: null, loading: false, error: { code: 'permission-denied' } });
    const { result } = renderHook(() => useMember('stranger@gmail.com'));
    expect(result.current).toEqual({ member: null, loading: false, error: null });
  });

  it('passes other errors through', () => {
    useDocument.mockReturnValue({ data: null, loading: false, error: { code: 'unavailable' } });
    const { result } = renderHook(() => useMember('bob@gmail.com'));
    expect(result.current.error).toEqual({ code: 'unavailable' });
  });

  it('does not look anything up without an email', () => {
    useDocument.mockReturnValue({ data: null, loading: false, error: null });
    const { result } = renderHook(() => useMember(null));
    expect(useDocument).toHaveBeenCalledWith(null);
    expect(result.current.member).toBeNull();
  });
});
