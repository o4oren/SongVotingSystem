import { describe, expect, it } from 'vitest';
import { computeRanking } from './ranking.js';

const ZOMBIE = { id: 's1', title: 'Zombie', artist: 'The Cranberries' };
const AFRICA = { id: 's2', title: 'Africa', artist: 'Toto' };
const CREEP = { id: 's3', title: 'Creep', artist: 'Radiohead' };
const SONGS = [ZOMBIE, AFRICA, CREEP];

const titles = (rows) => rows.map((row) => row.song.title);

describe('computeRanking', () => {
  it('sorts songs by total points, highest first', () => {
    const votes = [
      { email: 'a@gmail.com', points: { s1: 70, s2: 30 } },
      { email: 'b@gmail.com', points: { s2: 50, s3: 50 } },
    ];
    const rows = computeRanking(SONGS, votes);
    expect(titles(rows)).toEqual(['Africa', 'Zombie', 'Creep']);
    expect(rows.map((row) => row.total)).toEqual([80, 70, 50]);
  });

  it('lists who gave what, highest first', () => {
    const votes = [
      { email: 'a@gmail.com', points: { s2: 30, s1: 70 } },
      { email: 'b@gmail.com', points: { s2: 50, s3: 50 } },
    ];
    const africa = computeRanking(SONGS, votes).find((row) => row.song.id === 's2');
    expect(africa.breakdown).toEqual([
      { email: 'b@gmail.com', points: 50 },
      { email: 'a@gmail.com', points: 30 },
    ]);
  });

  it('breaks ties alphabetically, ignoring case', () => {
    const songs = [{ id: 'x', title: 'beatles medley' }, { id: 'y', title: 'Abba medley' }, ZOMBIE];
    const rows = computeRanking(songs, [{ email: 'a@gmail.com', points: { x: 50, y: 50 } }]);
    expect(titles(rows)).toEqual(['Abba medley', 'beatles medley', 'Zombie']);
  });

  it('lists every song at 0 when nobody has voted', () => {
    const rows = computeRanking(SONGS, []);
    expect(titles(rows)).toEqual(['Africa', 'Creep', 'Zombie']);
    expect(rows.every((row) => row.total === 0 && row.breakdown.length === 0)).toBe(true);
  });

  it('ignores points for songs that were removed', () => {
    const rows = computeRanking([ZOMBIE], [{ email: 'a@gmail.com', points: { s1: 60, gone: 40 } }]);
    expect(rows).toHaveLength(1);
    expect(rows[0].total).toBe(60);
  });

  it('ignores malformed values instead of crashing or concatenating', () => {
    const votes = [
      { email: 'a@gmail.com', points: { s1: '50', s2: -20, s3: NaN } },
      { email: 'b@gmail.com', points: { s1: 10, s2: 500, s3: 2.5 } },
      { email: 'c@gmail.com' },
    ];
    const rows = computeRanking(SONGS, votes);
    expect(rows.find((row) => row.song.id === 's1').total).toBe(10);
    expect(rows.find((row) => row.song.id === 's2').total).toBe(0);
    expect(rows.find((row) => row.song.id === 's3').total).toBe(0);
  });

  it('returns an empty list for a poll with no songs', () => {
    expect(computeRanking([], [{ email: 'a@gmail.com', points: { s1: 100 } }])).toEqual([]);
  });
});
