import { describe, expect, it } from 'vitest';
import { TOTAL_POINTS, cleanPoints, isValidPoints, parsePoints, validateBallot } from './ballot.js';

const SONGS = ['a', 'b', 'c'];
const INVALID = 'Each value must be a whole number from 0 to 100.';

describe('parsePoints', () => {
  it('treats missing and blank values as 0', () => {
    expect(parsePoints(undefined)).toBe(0);
    expect(parsePoints(null)).toBe(0);
    expect(parsePoints('')).toBe(0);
    expect(parsePoints('   ')).toBe(0);
  });

  it('parses numeric strings and passes numbers through', () => {
    expect(parsePoints(' 40 ')).toBe(40);
    expect(parsePoints(25)).toBe(25);
  });

  it('returns NaN for non-numeric strings', () => {
    expect(parsePoints('abc')).toBeNaN();
  });
});

describe('isValidPoints', () => {
  it('accepts whole numbers from 0 to 100', () => {
    expect(isValidPoints(0)).toBe(true);
    expect(isValidPoints(100)).toBe(true);
  });

  it('rejects everything else', () => {
    expect(isValidPoints(-1)).toBe(false);
    expect(isValidPoints(101)).toBe(false);
    expect(isValidPoints(10.5)).toBe(false);
    expect(isValidPoints(NaN)).toBe(false);
    expect(isValidPoints('50')).toBe(false);
    expect(isValidPoints(undefined)).toBe(false);
  });
});

describe('validateBallot', () => {
  it('accepts whole numbers that add up to exactly 100', () => {
    expect(validateBallot({ a: '50', b: '30', c: '20' }, SONGS)).toEqual({
      total: TOTAL_POINTS,
      remaining: 0,
      invalidSongIds: [],
      errors: [],
      valid: true,
    });
  });

  it('accepts number values as well as strings', () => {
    expect(validateBallot({ a: 100 }, SONGS).valid).toBe(true);
  });

  it('treats blank and missing fields as 0', () => {
    const result = validateBallot({ a: '100', b: '', c: '  ' }, SONGS);
    expect(result.valid).toBe(true);
    expect(result.total).toBe(100);
  });

  it('reports unassigned points when under 100', () => {
    const result = validateBallot({ a: '40' }, SONGS);
    expect(result.valid).toBe(false);
    expect(result.remaining).toBe(60);
    expect(result.errors).toEqual(['60 points unassigned — your total must be exactly 100.']);
  });

  it('reports the overage when over 100', () => {
    const result = validateBallot({ a: '80', b: '30' }, SONGS);
    expect(result.valid).toBe(false);
    expect(result.remaining).toBe(-10);
    expect(result.errors).toEqual(['You are 10 points over 100.']);
  });

  it('flags fractional values', () => {
    const result = validateBallot({ a: '10.5', b: '89.5' }, SONGS);
    expect(result.valid).toBe(false);
    expect(result.invalidSongIds).toEqual(['a', 'b']);
    expect(result.errors).toContain(INVALID);
  });

  it('flags negative values and values over 100', () => {
    const result = validateBallot({ a: '-10', b: '110' }, SONGS);
    expect(result.invalidSongIds).toEqual(['a', 'b']);
    expect(result.valid).toBe(false);
  });

  it('flags non-numeric values and leaves them out of the total', () => {
    const result = validateBallot({ a: 'abc', b: '100' }, SONGS);
    expect(result.invalidSongIds).toEqual(['a']);
    expect(result.total).toBe(100);
    expect(result.errors).toEqual([INVALID]);
    expect(result.valid).toBe(false);
  });

  it('ignores points for songs that are no longer in the poll', () => {
    const result = validateBallot({ a: '60', gone: '40' }, SONGS);
    expect(result.total).toBe(60);
    expect(result.remaining).toBe(40);
    expect(result.valid).toBe(false);
  });

  it('rejects a poll with no songs', () => {
    expect(validateBallot({}, [])).toEqual({
      total: 0,
      remaining: 100,
      invalidSongIds: [],
      errors: ['Add songs to this poll before voting.'],
      valid: false,
    });
  });

  it('handles a missing points object', () => {
    expect(validateBallot(undefined, SONGS).remaining).toBe(100);
  });
});

describe('cleanPoints', () => {
  it('keeps valid non-zero values for current songs, as numbers', () => {
    expect(cleanPoints({ a: '60', b: '0', c: ' 40 ', gone: '10' }, SONGS)).toEqual({ a: 60, c: 40 });
  });

  it('drops blank and invalid values', () => {
    expect(cleanPoints({ a: '', b: 'abc', c: '10.5' }, SONGS)).toEqual({});
  });
});
