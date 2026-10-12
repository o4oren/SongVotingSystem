import { describe, expect, it } from 'vitest';
import { cleanPoints, isValidPoints, parsePoints, validateBallot } from './ballot.js';

const SONGS = ['a', 'b', 'c'];
const invalid = (budget) => `Each value must be a whole number from 0 to ${budget}.`;

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
  it('accepts whole numbers from 0 to the budget', () => {
    expect(isValidPoints(0, 100)).toBe(true);
    expect(isValidPoints(100, 100)).toBe(true);
    expect(isValidPoints(150, 150)).toBe(true);
  });

  it('rejects everything else', () => {
    expect(isValidPoints(-1, 100)).toBe(false);
    expect(isValidPoints(101, 100)).toBe(false);
    expect(isValidPoints(151, 150)).toBe(false);
    expect(isValidPoints(10.5, 100)).toBe(false);
    expect(isValidPoints(NaN, 100)).toBe(false);
    expect(isValidPoints('50', 100)).toBe(false);
    expect(isValidPoints(undefined, 100)).toBe(false);
  });
});

describe('validateBallot', () => {
  it('accepts whole numbers that add up to exactly the budget', () => {
    expect(validateBallot({ a: '50', b: '30', c: '20' }, SONGS, 100)).toEqual({
      total: 100,
      remaining: 0,
      invalidSongIds: [],
      errors: [],
      valid: true,
    });
    expect(validateBallot({ a: '100', b: '50' }, SONGS, 150).valid).toBe(true);
  });

  it('works with a budget of 1', () => {
    expect(validateBallot({ b: '1' }, SONGS, 1).valid).toBe(true);
    expect(validateBallot({ a: '1', b: '1' }, SONGS, 1).valid).toBe(false);
  });

  it('accepts number values as well as strings', () => {
    expect(validateBallot({ a: 100 }, SONGS, 100).valid).toBe(true);
  });

  it('treats blank and missing fields as 0', () => {
    const result = validateBallot({ a: '100', b: '', c: '  ' }, SONGS, 100);
    expect(result.valid).toBe(true);
    expect(result.total).toBe(100);
  });

  it('reports unassigned points against the budget', () => {
    const result = validateBallot({ a: '40' }, SONGS, 150);
    expect(result.valid).toBe(false);
    expect(result.remaining).toBe(110);
    expect(result.errors).toEqual(['110 points unassigned — your bid must total exactly 150.']);
  });

  it('says "1 point" in the singular', () => {
    expect(validateBallot({ a: '99' }, SONGS, 100).errors).toEqual(['1 point unassigned — your bid must total exactly 100.']);
    expect(validateBallot({ a: '100', b: '1' }, SONGS, 100).errors).toEqual(['You are 1 point over 100.']);
  });

  it('reports the overage against the budget', () => {
    const result = validateBallot({ a: '140', b: '20' }, SONGS, 150);
    expect(result.valid).toBe(false);
    expect(result.remaining).toBe(-10);
    expect(result.errors).toEqual(['You are 10 points over 150.']);
  });

  it('flags fractional values', () => {
    const result = validateBallot({ a: '10.5', b: '89.5' }, SONGS, 100);
    expect(result.valid).toBe(false);
    expect(result.invalidSongIds).toEqual(['a', 'b']);
    expect(result.errors).toContain(invalid(100));
  });

  it('flags negative values and values over the budget', () => {
    const result = validateBallot({ a: '-10', b: '160' }, SONGS, 150);
    expect(result.invalidSongIds).toEqual(['a', 'b']);
    expect(result.errors).toContain(invalid(150));
    expect(result.valid).toBe(false);
  });

  it('flags non-numeric values and leaves them out of the total', () => {
    const result = validateBallot({ a: 'abc', b: '100' }, SONGS, 100);
    expect(result.invalidSongIds).toEqual(['a']);
    expect(result.total).toBe(100);
    expect(result.errors).toEqual([invalid(100)]);
    expect(result.valid).toBe(false);
  });

  it('ignores points for songs that are no longer in the poll', () => {
    const result = validateBallot({ a: '60', gone: '40' }, SONGS, 100);
    expect(result.total).toBe(60);
    expect(result.remaining).toBe(40);
    expect(result.valid).toBe(false);
  });

  it('rejects a poll with no songs', () => {
    expect(validateBallot({}, [], 150)).toEqual({
      total: 0,
      remaining: 150,
      invalidSongIds: [],
      errors: ['Add songs to this poll before bidding.'],
      valid: false,
    });
  });

  it('handles a missing points object', () => {
    expect(validateBallot(undefined, SONGS, 100).remaining).toBe(100);
  });
});

describe('cleanPoints', () => {
  it('keeps valid non-zero values for current songs, as numbers', () => {
    expect(cleanPoints({ a: '60', b: '0', c: ' 40 ', gone: '10' }, SONGS, 100)).toEqual({ a: 60, c: 40 });
  });

  it('drops blank, invalid and over-budget values', () => {
    expect(cleanPoints({ a: '', b: 'abc', c: '10.5' }, SONGS, 100)).toEqual({});
    expect(cleanPoints({ a: '120' }, SONGS, 100)).toEqual({});
    expect(cleanPoints({ a: '120' }, SONGS, 150)).toEqual({ a: 120 });
  });
});
