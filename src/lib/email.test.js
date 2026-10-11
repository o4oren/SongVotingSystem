import { describe, expect, it } from 'vitest';
import { isValidEmail, normalizeEmail } from './email.js';

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Bob@Gmail.COM ')).toBe('bob@gmail.com');
  });

  it('turns null and undefined into an empty string', () => {
    expect(normalizeEmail(null)).toBe('');
    expect(normalizeEmail(undefined)).toBe('');
  });
});

describe('isValidEmail', () => {
  it('accepts a normal address, including surrounding whitespace and capitals', () => {
    expect(isValidEmail('bob@gmail.com')).toBe(true);
    expect(isValidEmail(' Bob.Smith@Gmail.com ')).toBe(true);
  });

  it('rejects things that are not email addresses', () => {
    expect(isValidEmail('')).toBe(false);
    expect(isValidEmail('bob')).toBe(false);
    expect(isValidEmail('bob@gmail')).toBe(false);
    expect(isValidEmail('bob smith@gmail.com')).toBe(false);
    expect(isValidEmail('@gmail.com')).toBe(false);
  });
});
