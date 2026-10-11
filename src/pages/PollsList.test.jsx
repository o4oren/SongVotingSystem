import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
  { id: 'p1', title: 'Summer set' },
];

function renderPage(me) {
  return render(
    <MemoryRouter>
      <PollsList me={me} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  usePolls.mockReturnValue({ data: POLLS, loading: false, error: null });
});

describe('PollsList', () => {
  it('links each poll to its page', () => {
    renderPage(MEMBER);
    expect(screen.getByRole('link', { name: 'Winter set' })).toHaveAttribute('href', '/polls/p2');
    expect(screen.getByRole('link', { name: 'Summer set' })).toHaveAttribute('href', '/polls/p1');
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

  it('rejects a blank poll title', async () => {
    const user = userEvent.setup();
    renderPage(ADMIN);
    await user.type(screen.getByLabelText('New poll title'), '   ');
    await user.click(screen.getByRole('button', { name: 'Create poll' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Poll title is required.');
    expect(createPoll).not.toHaveBeenCalled();
  });

  it('creates a poll with a trimmed title and clears the field', async () => {
    createPoll.mockResolvedValue({ id: 'p3' });
    const user = userEvent.setup();
    renderPage(ADMIN);
    await user.type(screen.getByLabelText('New poll title'), '  Fall set  ');
    await user.click(screen.getByRole('button', { name: 'Create poll' }));
    expect(createPoll).toHaveBeenCalledWith('Fall set', 'admin@gmail.com');
    expect(screen.getByLabelText('New poll title')).toHaveValue('');
  });

  it('shows an error when creating fails', async () => {
    createPoll.mockRejectedValue({ code: 'permission-denied' });
    const user = userEvent.setup();
    renderPage(ADMIN);
    await user.type(screen.getByLabelText('New poll title'), 'Fall set');
    await user.click(screen.getByRole('button', { name: 'Create poll' }));
    expect(screen.getByRole('alert')).toHaveTextContent("Could not create poll: You don't have access.");
  });

  it('deletes a poll after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    deletePoll.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage(ADMIN);
    await user.click(screen.getByRole('button', { name: 'Delete Winter set' }));
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
