import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../hooks/useMembers.js', () => ({ useMembers: vi.fn() }));
vi.mock('../lib/db.js', () => ({ addMember: vi.fn(), setMemberAdmin: vi.fn(), removeMember: vi.fn() }));

import { useMembers } from '../hooks/useMembers.js';
import { addMember, removeMember, setMemberAdmin } from '../lib/db.js';
import Members from './Members.jsx';

const ME = { email: 'admin@gmail.com', isAdmin: true };

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  useMembers.mockReturnValue({
    data: [
      { id: 'bob@gmail.com', admin: false },
      { id: 'admin@gmail.com', admin: true },
    ],
    loading: false,
    error: null,
  });
});

describe('Members', () => {
  it('lists members alphabetically and marks you', () => {
    render(<Members me={ME} />);
    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('admin@gmail.com (you)');
    expect(items[1]).toHaveTextContent('bob@gmail.com');
  });

  it('rejects an invalid email', async () => {
    const user = userEvent.setup();
    render(<Members me={ME} />);
    await user.type(screen.getByLabelText('Email to add'), 'not-an-email');
    await user.click(screen.getByRole('button', { name: 'Add member' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid email address.');
    expect(addMember).not.toHaveBeenCalled();
  });

  it('rejects someone already on the list, ignoring case and spaces', async () => {
    const user = userEvent.setup();
    render(<Members me={ME} />);
    await user.type(screen.getByLabelText('Email to add'), ' Bob@Gmail.com ');
    await user.click(screen.getByRole('button', { name: 'Add member' }));
    expect(screen.getByRole('alert')).toHaveTextContent('bob@gmail.com is already on the list.');
    expect(addMember).not.toHaveBeenCalled();
  });

  it('adds a normalized email, optionally as admin', async () => {
    addMember.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<Members me={ME} />);
    await user.type(screen.getByLabelText('Email to add'), 'New.Person@Gmail.com');
    await user.click(screen.getByLabelText('Make admin'));
    await user.click(screen.getByRole('button', { name: 'Add member' }));
    expect(addMember).toHaveBeenCalledWith('new.person@gmail.com', true, 'admin@gmail.com');
    expect(screen.getByLabelText('Email to add')).toHaveValue('');
  });

  it('shows an error when adding fails', async () => {
    addMember.mockRejectedValue(new Error('new@gmail.com is already on the list.'));
    const user = userEvent.setup();
    render(<Members me={ME} />);
    await user.type(screen.getByLabelText('Email to add'), 'new@gmail.com');
    await user.click(screen.getByRole('button', { name: 'Add member' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Could not add member: new@gmail.com is already on the list.');
  });

  it('does not let you demote or remove yourself', () => {
    render(<Members me={ME} />);
    expect(screen.getByLabelText('Admin: admin@gmail.com')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove admin@gmail.com' })).toBeDisabled();
  });

  it('toggles admin for someone else', async () => {
    setMemberAdmin.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<Members me={ME} />);
    await user.click(screen.getByLabelText('Admin: bob@gmail.com'));
    expect(setMemberAdmin).toHaveBeenCalledWith('bob@gmail.com', true);
  });

  it('removes someone else after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    removeMember.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<Members me={ME} />);
    await user.click(screen.getByRole('button', { name: 'Remove bob@gmail.com' }));
    expect(removeMember).toHaveBeenCalledWith('bob@gmail.com');
  });
});
