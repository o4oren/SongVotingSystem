import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('../hooks/usePoll.js', () => ({ usePoll: vi.fn() }));
vi.mock('../lib/db.js', () => ({ addSong: vi.fn(), removeSong: vi.fn(), saveVote: vi.fn() }));

import { usePoll } from '../hooks/usePoll.js';
import { addSong, removeSong, saveVote } from '../lib/db.js';
import PollPage from './PollPage.jsx';

const ADMIN = { email: 'admin@gmail.com', isAdmin: true };
const MEMBER = { email: 'member@gmail.com', isAdmin: false };
const SONGS = [
  { id: 's1', title: 'Africa', artist: 'Toto' },
  { id: 's2', title: 'Creep', artist: 'Radiohead' },
  { id: 's3', title: 'Zombie', artist: 'The Cranberries' },
];
const VOTES = [
  { email: 'member@gmail.com', points: { s1: 30, s3: 70 } },
  { email: 'admin@gmail.com', points: { s2: 100 } },
];

function renderPage(me) {
  return render(
    <MemoryRouter initialEntries={['/polls/p1']}>
      <Routes>
        <Route path="/polls/:pollId" element={<PollPage me={me} />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  usePoll.mockReturnValue({
    poll: { id: 'p1', title: 'Summer set' },
    songs: SONGS,
    votes: VOTES,
    loading: false,
    error: null,
  });
});

describe('PollPage', () => {
  it('ranks songs by total points with a per-member breakdown', () => {
    renderPage(MEMBER);
    expect(usePoll).toHaveBeenCalledWith('p1');
    expect(screen.getByRole('heading', { name: 'Summer set' })).toBeInTheDocument();
    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Creep');
    expect(items[0]).toHaveTextContent('100 pts');
    expect(items[1]).toHaveTextContent('Zombie');
    expect(items[1]).toHaveTextContent('member@gmail.com 70');
    expect(items[2]).toHaveTextContent('Africa');
  });

  it("pre-fills the member's own ballot", () => {
    renderPage(MEMBER);
    expect(screen.getByLabelText('Points for Africa')).toHaveValue(30);
    expect(screen.getByLabelText('Points for Zombie')).toHaveValue(70);
  });

  it('saves the member vote', async () => {
    saveVote.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage(MEMBER);
    await user.clear(screen.getByLabelText('Points for Africa'));
    await user.type(screen.getByLabelText('Points for Africa'), '20');
    await user.type(screen.getByLabelText('Points for Creep'), '10');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(saveVote).toHaveBeenCalledWith('p1', 'member@gmail.com', { s1: 20, s2: 10, s3: 70 });
  });

  it('hides song management from non-admins', () => {
    renderPage(MEMBER);
    expect(screen.queryByRole('button', { name: 'Add song' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove Africa' })).not.toBeInTheDocument();
  });

  it('lets an admin add a song with trimmed fields', async () => {
    addSong.mockResolvedValue({ id: 's4' });
    const user = userEvent.setup();
    renderPage(ADMIN);
    await user.type(screen.getByLabelText('Song title'), ' Toxic ');
    await user.type(screen.getByLabelText('Artist'), ' Britney Spears ');
    await user.click(screen.getByRole('button', { name: 'Add song' }));
    expect(addSong).toHaveBeenCalledWith('p1', { title: 'Toxic', artist: 'Britney Spears' }, 'admin@gmail.com');
    expect(screen.getByLabelText('Song title')).toHaveValue('');
  });

  it('rejects a blank song title', async () => {
    const user = userEvent.setup();
    renderPage(ADMIN);
    await user.type(screen.getByLabelText('Artist'), 'Toto');
    await user.click(screen.getByRole('button', { name: 'Add song' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Song title is required.');
    expect(addSong).not.toHaveBeenCalled();
  });

  it('lets an admin remove a song after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    removeSong.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage(ADMIN);
    await user.click(screen.getByRole('button', { name: 'Remove Africa' }));
    expect(removeSong).toHaveBeenCalledWith('p1', 's1');
  });

  it('says when the poll does not exist', () => {
    usePoll.mockReturnValue({ poll: null, songs: [], votes: [], loading: false, error: null });
    renderPage(MEMBER);
    expect(screen.getByText(/Poll not found/)).toBeInTheDocument();
  });

  it('shows a load error', () => {
    usePoll.mockReturnValue({ poll: null, songs: [], votes: [], loading: false, error: { code: 'permission-denied' } });
    renderPage(MEMBER);
    expect(screen.getByRole('alert')).toHaveTextContent("You don't have access.");
  });
});
