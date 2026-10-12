import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useNow } from './useNow.js';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 12, 12, 0, 0));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useNow', () => {
  it('returns the current time and ticks every second', () => {
    const { result } = renderHook(() => useNow());
    expect(result.current).toEqual(new Date(2026, 9, 12, 12, 0, 0));
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current).toEqual(new Date(2026, 9, 12, 12, 0, 1));
  });

  it('does not tick when disabled', () => {
    const { result } = renderHook(() => useNow(false));
    const first = result.current;
    act(() => vi.advanceTimersByTime(5000));
    expect(result.current).toBe(first);
  });

  it('stops ticking on unmount', () => {
    const { unmount } = renderHook(() => useNow());
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
