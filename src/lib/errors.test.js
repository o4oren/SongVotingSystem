import { describe, expect, it } from 'vitest';
import { errorMessage } from './errors.js';

describe('errorMessage', () => {
  it('explains permission errors', () => {
    expect(errorMessage({ code: 'permission-denied', message: 'Missing or insufficient permissions.' }))
      .toBe("You don't have access.");
  });

  it('explains network errors', () => {
    expect(errorMessage({ code: 'unavailable' }))
      .toBe('Network problem — check your connection and try again.');
  });

  it('falls back to the error message', () => {
    expect(errorMessage(new Error('Boom'))).toBe('Boom');
  });

  it('has a generic fallback', () => {
    expect(errorMessage(undefined)).toBe('Something went wrong.');
    expect(errorMessage({})).toBe('Something went wrong.');
  });
});
