import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Ballot from './Ballot.jsx';

const SONGS = [
  { id: 's1', title: 'Africa', artist: 'Toto' },
  { id: 's2', title: 'Creep', artist: 'Radiohead' },
];

function renderBallot(props = {}) {
  return render(<Ballot songs={SONGS} budget={100} savedPoints={undefined} onSave={vi.fn()} {...props} />);
}

describe('Ballot', () => {
  it('is headed "My bid"', () => {
    renderBallot();
    expect(screen.getByRole('heading', { name: 'My bid' })).toBeInTheDocument();
  });

  it('pre-fills a saved bid and offers Update bid at exactly the budget', () => {
    renderBallot({ savedPoints: { s1: 60, s2: 40 } });
    expect(screen.getByLabelText('Points for Africa')).toHaveValue(60);
    expect(screen.getByLabelText('Points for Creep')).toHaveValue(40);
    expect(screen.getByText('Budget left: 0 / 100')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Update bid' })).toBeEnabled();
  });

  it('starts empty with the whole budget left and Place bid disabled', () => {
    renderBallot({ budget: 150 });
    expect(screen.getByLabelText('Points for Africa')).toHaveValue(null);
    expect(screen.getByLabelText('Points for Africa')).toHaveAttribute('max', '150');
    expect(screen.getByText('Budget left: 150 / 150')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Place bid' })).toBeDisabled();
  });

  it('updates the counter against the budget as you type', async () => {
    const user = userEvent.setup();
    renderBallot({ budget: 150 });
    await user.type(screen.getByLabelText('Points for Africa'), '30');
    expect(screen.getByText('Budget left: 120 / 150')).toBeInTheDocument();
    expect(screen.getByText('120 points unassigned — your bid must total exactly 150.')).toBeInTheDocument();
  });

  it('flags fractional values', async () => {
    const user = userEvent.setup();
    renderBallot();
    await user.type(screen.getByLabelText('Points for Africa'), '10.5');
    expect(screen.getByLabelText('Points for Africa')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Each value must be a whole number from 0 to 100.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Place bid' })).toBeDisabled();
  });

  it('saves cleaned points and confirms', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderBallot({ budget: 150, onSave });
    await user.type(screen.getByLabelText('Points for Africa'), '150');
    await user.click(screen.getByRole('button', { name: 'Place bid' }));
    expect(onSave).toHaveBeenCalledWith({ s1: 150 });
    expect(screen.getByRole('status')).toHaveTextContent('Bid saved.');
  });

  it('shows unassigned points left behind by a removed song', () => {
    renderBallot({ savedPoints: { s1: 60, gone: 40 } });
    expect(screen.getByText('Budget left: 40 / 100')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Update bid' })).toBeDisabled();
  });

  it('shows an error when saving fails and keeps the input', async () => {
    const onSave = vi.fn().mockRejectedValue({ code: 'unavailable' });
    const user = userEvent.setup();
    renderBallot({ savedPoints: { s1: 60, s2: 40 }, onSave });
    await user.click(screen.getByRole('button', { name: 'Update bid' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Could not save: Network problem — check your connection and try again.',
    );
    expect(screen.getByLabelText('Points for Africa')).toHaveValue(60);
  });

  it('explains a rejected save as bidding having closed', async () => {
    const onSave = vi.fn().mockRejectedValue({ code: 'permission-denied' });
    const user = userEvent.setup();
    renderBallot({ savedPoints: { s1: 60, s2: 40 }, onSave });
    await user.click(screen.getByRole('button', { name: 'Update bid' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Bidding closed for this poll.');
  });

  it('keeps the save error visible after the ballot turns read-only', async () => {
    const onSave = vi.fn().mockRejectedValue({ code: 'permission-denied' });
    const user = userEvent.setup();
    const { rerender } = renderBallot({ savedPoints: { s1: 60, s2: 40 }, onSave });
    await user.click(screen.getByRole('button', { name: 'Update bid' }));
    rerender(<Ballot songs={SONGS} budget={100} savedPoints={{ s1: 60, s2: 40 }} readOnly onSave={onSave} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Bidding closed for this poll.');
  });

  it('is read-only when the poll is closed', () => {
    renderBallot({ savedPoints: { s1: 60, s2: 40 }, readOnly: true });
    expect(screen.getByLabelText('Points for Africa')).toBeDisabled();
    expect(screen.getByLabelText('Points for Africa')).toHaveValue(60);
    expect(screen.getByText('Bidding is closed.')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByText(/Budget left/)).not.toBeInTheDocument();
  });

  it('explains that a poll with no songs cannot be bid on', () => {
    render(<Ballot songs={[]} budget={100} savedPoints={undefined} onSave={vi.fn()} />);
    expect(screen.getByText('Add songs to this poll before bidding.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Place bid' })).toBeDisabled();
  });
});
