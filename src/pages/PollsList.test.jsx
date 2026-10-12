import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../hooks/usePolls.js', () => ({ usePolls: vi.fn() }));
vi.mock('../lib/db.js', () => ({ createPoll: vi.fn(), deletePoll: vi.fn() }));

import { usePolls } from '../hooks/usePolls.js';
import { createPoll, deletePoll } from '../lib/db.js';
import PollsList from './PollsList.jsx';

const ADMIN = { email: 'admin@gmail.com', isAdmin: true };
const MEMBER = { email: 'member@gmail.com', isAdmin: false };
const POLLS = [
  { id: 'p2', title: 'Winter set' },
  { id: 'p1', title: 'Summer set', closed: true, sealed: true },
];

function renderPage(me) {
  return render(
    <MemoryRouter>
      <PollsList me={me} />
    </MemoryRouter>,
  );
}

const rowFor = (title) => screen.getByRole('link', { name: title }).closest('li');

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  usePolls.mockReturnValue({ data: POLLS, loading: false, error: null });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('PollsList', () => {
  it('links each poll to its page', () => {
    renderPage(MEMBER);
    expect(screen.getByRole('link', { name: 'Winter set' })).toHaveAttribute('href', '/polls/p2');
    expect(screen.getByRole('link', { name: 'Summer set' })).toHaveAttribute('href', '/polls/p1');
  });

  it('shows each poll’s status and a Sealed badge', () => {
    renderPage(MEMBER);
    expect(within(rowFor('Winter set')).getByText('Open')).toBeInTheDocument();
    expect(within(rowFor('Summer set')).getByText('Closed')).toBeInTheDocument();
    expect(within(rowFor('Summer set')).getByText('Sealed')).toBeInTheDocument();
  });

  it('shows a live countdown for polls with an end date', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 12, 12, 0, 0));
    usePolls.mockReturnValue({
      data: [{ id: 'p3', title: 'Fall set', endsAt: new Date(2026, 9, 14, 16, 30, 0) }],
      loading: false,
      error: null,
    });
    renderPage(MEMBER);
    expect(screen.getByText('Closes in 2d 4h 30m')).toBeInTheDocument();
  });

  it('hides admin controls from non-admins', () => {
    renderPage(MEMBER);
    expect(screen.queryByRole('button', { name: 'Create poll' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
  });

  it('shows an empty state', () => {
    usePolls.mockReturnValue({ data: [], loading: false, error: null });
    renderPage(MEMBER);
    expect(screen.getByText('No polls yet.')).toBeInTheDocument();
  });

  it('shows a load error', () => {
    usePolls.mockReturnValue({ data: [], loading: false, error: { code: 'permission-denied' } });
    renderPage(MEMBER);
    expect(screen.getByRole('alert')).toHaveTextContent("You don't have access.");
  });

  it('defaults the create form to budget 100, open visibility and no end date', () => {
    renderPage(ADMIN);
    expect(screen.getByLabelText('Budget')).toHaveValue(100);
    expect(screen.getByRole('radio', { name: /^Open/ })).toBeChecked();
    expect(screen.getByLabelText('End date (optional)')).toHaveValue('');
  });

  it('rejects a blank poll title', async () => {
    const user = userEvent.setup();
    renderPage(ADMIN);
    await user.type(screen.getByLabelText('New poll title'), '   ');
    await user.click(screen.getByRole('button', { name: 'Create poll' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Poll title is required.');
    expect(createPoll).not.toHaveBeenCalled();
  });

  it('rejects an invalid budget', async () => {
    const user = userEvent.setup();
    renderPage(ADMIN);
    await user.type(screen.getByLabelText('New poll title'), 'Fall set');
    await user.clear(screen.getByLabelText('Budget'));
    await user.type(screen.getByLabelText('Budget'), '1001');
    await user.click(screen.getByRole('button', { name: 'Create poll' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Budget must be a whole number from 1 to 1000.');
    expect(createPoll).not.toHaveBeenCalled();
  });

  it('rejects an end date in the past', async () => {
    const user = userEvent.setup();
    renderPage(ADMIN);
    await user.type(screen.getByLabelText('New poll title'), 'Fall set');
    fireEvent.change(screen.getByLabelText('End date (optional)'), { target: { value: '2000-01-01T10:00' } });
    await user.click(screen.getByRole('button', { name: 'Create poll' }));
    expect(screen.getByRole('alert')).toHaveTextContent('End date must be in the future.');
    expect(createPoll).not.toHaveBeenCalled();
  });

  it('creates a poll with defaults and a trimmed title, then resets the form', async () => {
    createPoll.mockResolvedValue({ id: 'p3' });
    const user = userEvent.setup();
    renderPage(ADMIN);
    await user.type(screen.getByLabelText('New poll title'), '  Fall set  ');
    await user.click(screen.getByRole('button', { name: 'Create poll' }));
    expect(createPoll).toHaveBeenCalledWith(
      { title: 'Fall set', budget: 100, sealed: false, endsAt: null },
      'admin@gmail.com',
    );
    expect(screen.getByLabelText('New poll title')).toHaveValue('');
  });

  it('creates a sealed poll with a custom budget and end date', async () => {
    createPoll.mockResolvedValue({ id: 'p3' });
    const user = userEvent.setup();
    renderPage(ADMIN);
    await user.type(screen.getByLabelText('New poll title'), 'Fall set');
    await user.clear(screen.getByLabelText('Budget'));
    await user.type(screen.getByLabelText('Budget'), '150');
    await user.click(screen.getByRole('radio', { name: /^Sealed/ }));
    fireEvent.change(screen.getByLabelText('End date (optional)'), { target: { value: '2999-10-16T20:00' } });
    await user.click(screen.getByRole('button', { name: 'Create poll' }));
    expect(createPoll).toHaveBeenCalledWith(
      { title: 'Fall set', budget: 150, sealed: true, endsAt: new Date(2999, 9, 16, 20, 0) },
      'admin@gmail.com',
    );
    expect(screen.getByLabelText('Budget')).toHaveValue(100);
    expect(screen.getByRole('radio', { name: /^Open/ })).toBeChecked();
  });

  it('shows an error when creating fails', async () => {
    createPoll.mockRejectedValue({ code: 'permission-denied' });
    const user = userEvent.setup();
    renderPage(ADMIN);
    await user.type(screen.getByLabelText('New poll title'), 'Fall set');
    await user.click(screen.getByRole('button', { name: 'Create poll' }));
    expect(screen.getByRole('alert')).toHaveTextContent("Could not create poll: You don't have access.");
  });

  it('deletes a poll after confirmation, mentioning bids', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    deletePoll.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage(ADMIN);
    await user.click(screen.getByRole('button', { name: 'Delete Winter set' }));
    expect(confirm).toHaveBeenCalledWith('Delete "Winter set" and all its songs and bids?');
    expect(deletePoll).toHaveBeenCalledWith('p2');
  });

  it('does not delete when confirmation is cancelled', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();
    renderPage(ADMIN);
    await user.click(screen.getByRole('button', { name: 'Delete Winter set' }));
    expect(deletePoll).not.toHaveBeenCalled();
  });
});
