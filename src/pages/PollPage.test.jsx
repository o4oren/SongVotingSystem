import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { canSeeAllBids, isPollClosed, pollSettings } from '../lib/poll.js';

vi.mock('../hooks/usePoll.js', () => ({ usePoll: vi.fn() }));
vi.mock('../lib/db.js', () => ({
  addSong: vi.fn(),
  removeSong: vi.fn(),
  saveBid: vi.fn(),
  updatePollSettings: vi.fn(),
  closePoll: vi.fn(),
  reopenPoll: vi.fn(),
}));

import { usePoll } from '../hooks/usePoll.js';
import { addSong, closePoll, removeSong, reopenPoll, saveBid } from '../lib/db.js';
import PollPage from './PollPage.jsx';

const ADMIN = { email: 'admin@gmail.com', isAdmin: true };
const MEMBER = { email: 'member@gmail.com', isAdmin: false };
const SONGS = [
  { id: 's1', title: 'Africa', artist: 'Toto' },
  { id: 's2', title: 'Creep', artist: 'Radiohead' },
  { id: 's3', title: 'Zombie', artist: 'The Cranberries' },
];
const BIDS = [
  { email: 'member@gmail.com', points: { s1: 30, s3: 70 } },
  { email: 'admin@gmail.com', points: { s2: 100 } },
];

// Mirrors the real hook's derived fields so time-based behavior can be tested through the page.
function mockPoll(poll, { bids = BIDS, songs = SONGS } = {}) {
  usePoll.mockImplementation((pollId, myEmail, now) => {
    const bidsVisible = poll !== null && canSeeAllBids(poll, now);
    const visible = bidsVisible ? bids : bids.filter((bid) => bid.email === myEmail);
    return {
      poll,
      settings: pollSettings(poll),
      closed: poll !== null && isPollClosed(poll, now),
      bidsVisible,
      songs,
      bids: visible,
      myBid: visible.find((bid) => bid.email === myEmail) ?? null,
      loading: false,
      error: null,
    };
  });
}

function renderPage(me) {
  return render(
    <MemoryRouter initialEntries={['/polls/p1']}>
      <Routes>
        <Route path="/polls/:pollId" element={<PollPage me={me} />} />
      </Routes>
    </MemoryRouter>,
  );
}

const rankingItems = () => within(screen.getByRole('list')).getAllByRole('listitem');

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  mockPoll({ id: 'p1', title: 'Summer set', hasBids: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('PollPage — open poll', () => {
  it('shows the title, status, budget and a live ranking with breakdowns', () => {
    renderPage(MEMBER);
    expect(usePoll).toHaveBeenCalledWith('p1', 'member@gmail.com', expect.any(Date));
    expect(screen.getByRole('heading', { name: 'Summer set' })).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByText('Budget: 100 pts')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ranking' })).toBeInTheDocument();
    const items = rankingItems();
    expect(items[0]).toHaveTextContent('Creep');
    expect(items[0]).toHaveTextContent('100 pts');
    expect(items[1]).toHaveTextContent('member@gmail.com 70');
  });

  it("pre-fills the member's own bid", () => {
    renderPage(MEMBER);
    expect(screen.getByLabelText('Points for Africa')).toHaveValue(30);
    expect(screen.getByLabelText('Points for Zombie')).toHaveValue(70);
  });

  it('saves the bid, passing whether the poll already has bids', async () => {
    saveBid.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage(MEMBER);
    await user.clear(screen.getByLabelText('Points for Africa'));
    await user.type(screen.getByLabelText('Points for Africa'), '20');
    await user.type(screen.getByLabelText('Points for Creep'), '10');
    await user.click(screen.getByRole('button', { name: 'Update bid' }));
    expect(saveBid).toHaveBeenCalledWith('p1', 'member@gmail.com', { s1: 20, s2: 10, s3: 70 }, { hasBids: true });
  });

  it('uses the poll budget', () => {
    mockPoll({ id: 'p1', title: 'Summer set', budget: 150 }, { bids: [] });
    renderPage(MEMBER);
    expect(screen.getByText('Budget: 150 pts')).toBeInTheDocument();
    expect(screen.getByText('Budget left: 150 / 150')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Place bid' })).toBeDisabled();
  });

  it('hides song management and settings from non-admins', () => {
    renderPage(MEMBER);
    expect(screen.queryByRole('button', { name: 'Add song' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove Africa' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Poll settings' })).not.toBeInTheDocument();
  });

  it('lets an admin add a song with trimmed fields', async () => {
    addSong.mockResolvedValue({ id: 's4' });
    const user = userEvent.setup();
    renderPage(ADMIN);
    await user.type(screen.getByLabelText('Song title'), ' Toxic ');
    await user.type(screen.getByLabelText('Artist'), ' Britney Spears ');
    await user.click(screen.getByRole('button', { name: 'Add song' }));
    expect(addSong).toHaveBeenCalledWith('p1', { title: 'Toxic', artist: 'Britney Spears' }, 'admin@gmail.com');
  });

  it('lets an admin remove a song after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    removeSong.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage(ADMIN);
    await user.click(screen.getByRole('button', { name: 'Remove Africa' }));
    expect(removeSong).toHaveBeenCalledWith('p1', 's1');
  });

  it('lets an admin close the poll', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    closePoll.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage(ADMIN);
    await user.click(screen.getByRole('button', { name: 'Close now' }));
    expect(closePoll).toHaveBeenCalledWith('p1');
  });
});

describe('PollPage — sealed poll while open', () => {
  beforeEach(() => {
    mockPoll({ id: 'p1', title: 'Summer set', sealed: true, hasBids: true });
  });

  it('hides scores and other bids but keeps your own bid editable', () => {
    renderPage(MEMBER);
    expect(screen.getByText('Bids are sealed until the poll closes.')).toBeInTheDocument();
    expect(screen.getByText('Sealed')).toBeInTheDocument();
    expect(document.querySelector('.pts-pill')).toBeNull();
    expect(screen.queryByText(/admin@gmail.com/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Points for Africa')).toHaveValue(30);
    expect(screen.getByRole('button', { name: 'Update bid' })).toBeEnabled();
  });

  it('still lists the songs so an admin can remove them', () => {
    renderPage(ADMIN);
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Remove Africa' })).toBeInTheDocument();
  });
});

describe('PollPage — closed poll', () => {
  beforeEach(() => {
    mockPoll({ id: 'p1', title: 'Summer set', closed: true, hasBids: true });
  });

  it('shows final results and a read-only bid', () => {
    renderPage(MEMBER);
    expect(screen.getByText('Closed')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Final results' })).toBeInTheDocument();
    expect(rankingItems()[0]).toHaveTextContent('100 pts');
    expect(screen.getByLabelText('Points for Africa')).toBeDisabled();
    expect(screen.getByText('Bidding is closed.')).toBeInTheDocument();
  });

  it('hides song management from admins and offers Reopen', () => {
    renderPage(ADMIN);
    expect(screen.queryByRole('button', { name: 'Add song' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove Africa' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reopen' })).toBeInTheDocument();
  });

  it('reveals a sealed poll’s bids once closed', () => {
    mockPoll({ id: 'p1', title: 'Summer set', sealed: true, closed: true, hasBids: true });
    renderPage(MEMBER);
    expect(screen.getByText('admin@gmail.com 100')).toBeInTheDocument();
  });

  it('keeps a future end date when reopening a poll closed by hand', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    reopenPoll.mockResolvedValue(undefined);
    mockPoll({ id: 'p1', title: 'Summer set', closed: true, endsAt: new Date(Date.now() + 3_600_000) });
    const user = userEvent.setup();
    renderPage(ADMIN);
    await user.click(screen.getByRole('button', { name: 'Reopen' }));
    expect(reopenPoll).toHaveBeenCalledWith('p1', false);
  });

  it('clears a past end date when reopening', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    reopenPoll.mockResolvedValue(undefined);
    mockPoll({ id: 'p1', title: 'Summer set', endsAt: new Date(Date.now() - 60_000) });
    const user = userEvent.setup();
    renderPage(ADMIN);
    await user.click(screen.getByRole('button', { name: 'Reopen' }));
    expect(reopenPoll).toHaveBeenCalledWith('p1', true);
  });
});

describe('PollPage — countdown', () => {
  it('counts down and switches to the closed view at the end date without a reload', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 12, 12, 0, 0));
    mockPoll({ id: 'p1', title: 'Summer set', endsAt: new Date(2026, 9, 12, 12, 0, 3), hasBids: true });
    renderPage(MEMBER);
    expect(screen.getByText('Closes in 0m 03s')).toBeInTheDocument();
    expect(screen.getByLabelText('Points for Africa')).toBeEnabled();

    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByText('Closes in 0m 02s')).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(2000));
    expect(screen.getByText('Closed')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Final results' })).toBeInTheDocument();
    expect(screen.getByLabelText('Points for Africa')).toBeDisabled();
  });

  it('shows "Tallying final results…" while a sealed poll waits for the server clock', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 12, 12, 0, 0));
    mockPoll({ id: 'p1', title: 'Summer set', sealed: true, endsAt: new Date(2026, 9, 12, 11, 59, 58) });
    renderPage(MEMBER);
    expect(screen.getByText('Tallying final results…')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(3000));
    expect(screen.queryByText('Tallying final results…')).not.toBeInTheDocument();
    expect(screen.getByText('admin@gmail.com 100')).toBeInTheDocument();
  });
});

describe('PollPage — loading states', () => {
  it('says when the poll does not exist', () => {
    mockPoll(null, { bids: [], songs: [] });
    renderPage(MEMBER);
    expect(screen.getByText(/Poll not found/)).toBeInTheDocument();
  });

  it('shows a load error', () => {
    usePoll.mockReturnValue({
      poll: null,
      settings: pollSettings(null),
      closed: false,
      bidsVisible: false,
      songs: [],
      bids: [],
      myBid: null,
      loading: false,
      error: { code: 'permission-denied' },
    });
    renderPage(MEMBER);
    expect(screen.getByRole('alert')).toHaveTextContent("You don't have access.");
  });
});
