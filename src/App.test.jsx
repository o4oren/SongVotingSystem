import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('./hooks/useAuth.js', () => ({ useAuth: vi.fn(), signIn: vi.fn(), signOutUser: vi.fn() }));
vi.mock('./hooks/useMember.js', () => ({ useMember: vi.fn() }));
vi.mock('./pages/PollsList.jsx', () => ({ default: () => 'Polls page' }));
vi.mock('./pages/PollPage.jsx', () => ({ default: () => 'Poll page' }));
vi.mock('./pages/Members.jsx', () => ({ default: () => 'Members page' }));

import { signIn, signOutUser, useAuth } from './hooks/useAuth.js';
import { useMember } from './hooks/useMember.js';
import App from './App.jsx';

function signedInAs(email, member) {
  useAuth.mockReturnValue({ user: { email }, loading: false });
  useMember.mockReturnValue({ member, loading: false, error: null });
}

beforeEach(() => {
  vi.clearAllMocks();
  window.history.pushState({}, '', '/');
});

afterEach(() => {
  window.history.pushState({}, '', '/');
});

describe('App', () => {
  it('shows a loading state while auth resolves', () => {
    useAuth.mockReturnValue({ user: null, loading: true });
    useMember.mockReturnValue({ member: null, loading: false, error: null });
    render(<App />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('asks signed-out visitors to sign in with Google', async () => {
    useAuth.mockReturnValue({ user: null, loading: false });
    useMember.mockReturnValue({ member: null, loading: false, error: null });
    signIn.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Sign in with Google' }));
    expect(signIn).toHaveBeenCalled();
  });

  it('ignores a closed sign-in popup but reports other sign-in errors', async () => {
    useAuth.mockReturnValue({ user: null, loading: false });
    useMember.mockReturnValue({ member: null, loading: false, error: null });
    const user = userEvent.setup();
    render(<App />);

    signIn.mockRejectedValueOnce({ code: 'auth/popup-closed-by-user' });
    await user.click(screen.getByRole('button', { name: 'Sign in with Google' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    signIn.mockRejectedValueOnce({ code: 'auth/network-request-failed', message: 'Network down' });
    await user.click(screen.getByRole('button', { name: 'Sign in with Google' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Sign-in failed: Network down');
  });

  it('tells signed-in people who are not on the list to ask an admin', async () => {
    signedInAs('stranger@gmail.com', null);
    const user = userEvent.setup();
    render(<App />);
    expect(screen.getByText('Not on the band list')).toBeInTheDocument();
    expect(screen.getByText('stranger@gmail.com')).toBeInTheDocument();
    expect(screen.getByText(/Ask an admin to add you/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(signOutUser).toHaveBeenCalled();
  });

  it('looks the member up by normalized email', () => {
    signedInAs('Member@Gmail.com', { id: 'member@gmail.com', admin: false });
    render(<App />);
    expect(useMember).toHaveBeenCalledWith('member@gmail.com');
  });

  it('shows polls and the signed-in email to members, without the Members link', () => {
    signedInAs('member@gmail.com', { id: 'member@gmail.com', admin: false });
    render(<App />);
    expect(screen.getByText('Polls page')).toBeInTheDocument();
    expect(screen.getByText('member@gmail.com')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Members' })).not.toBeInTheDocument();
  });

  it('shows the Members link to admins', () => {
    signedInAs('admin@gmail.com', { id: 'admin@gmail.com', admin: true });
    render(<App />);
    expect(screen.getByRole('link', { name: 'Members' })).toHaveAttribute('href', '/members');
  });

  it('lets admins open the Members page', () => {
    window.history.pushState({}, '', '/members');
    signedInAs('admin@gmail.com', { id: 'admin@gmail.com', admin: true });
    render(<App />);
    expect(screen.getByText('Members page')).toBeInTheDocument();
  });

  it('redirects non-admins away from the Members page', () => {
    window.history.pushState({}, '', '/members');
    signedInAs('member@gmail.com', { id: 'member@gmail.com', admin: false });
    render(<App />);
    expect(screen.getByText('Polls page')).toBeInTheDocument();
    expect(screen.queryByText('Members page')).not.toBeInTheDocument();
  });

  it('routes poll links to the poll page', () => {
    window.history.pushState({}, '', '/polls/p1');
    signedInAs('member@gmail.com', { id: 'member@gmail.com', admin: false });
    render(<App />);
    expect(screen.getByText('Poll page')).toBeInTheDocument();
  });

  it('shows an error if the member lookup fails for another reason', () => {
    useAuth.mockReturnValue({ user: { email: 'member@gmail.com' }, loading: false });
    useMember.mockReturnValue({ member: null, loading: false, error: { code: 'unavailable' } });
    render(<App />);
    expect(screen.getByRole('alert')).toHaveTextContent('Network problem');
  });
});
