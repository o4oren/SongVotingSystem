import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Ballot from './Ballot.jsx';

const SONGS = [
  { id: 's1', title: 'Africa', artist: 'Toto' },
  { id: 's2', title: 'Creep', artist: 'Radiohead' },
];

describe('Ballot', () => {
  it('pre-fills saved points and enables Save at exactly 100', () => {
    render(<Ballot songs={SONGS} savedPoints={{ s1: 60, s2: 40 }} onSave={vi.fn()} />);
    expect(screen.getByLabelText('Points for Africa')).toHaveValue(60);
    expect(screen.getByLabelText('Points for Creep')).toHaveValue(40);
    expect(screen.getByText('Points left: 0')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('starts empty with 100 points left and Save disabled', () => {
    render(<Ballot songs={SONGS} savedPoints={undefined} onSave={vi.fn()} />);
    expect(screen.getByLabelText('Points for Africa')).toHaveValue(null);
    expect(screen.getByText('Points left: 100')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('updates the counter as you type', async () => {
    const user = userEvent.setup();
    render(<Ballot songs={SONGS} savedPoints={undefined} onSave={vi.fn()} />);
    await user.type(screen.getByLabelText('Points for Africa'), '30');
    expect(screen.getByText('Points left: 70')).toBeInTheDocument();
    expect(screen.getByText('70 points unassigned — your total must be exactly 100.')).toBeInTheDocument();
  });

  it('flags fractional values', async () => {
    const user = userEvent.setup();
    render(<Ballot songs={SONGS} savedPoints={undefined} onSave={vi.fn()} />);
    await user.type(screen.getByLabelText('Points for Africa'), '10.5');
    expect(screen.getByLabelText('Points for Africa')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Each value must be a whole number from 0 to 100.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('saves cleaned points and confirms', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<Ballot songs={SONGS} savedPoints={undefined} onSave={onSave} />);
    await user.type(screen.getByLabelText('Points for Africa'), '100');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith({ s1: 100 });
    expect(screen.getByRole('status')).toHaveTextContent('Saved.');
  });

  it('shows unassigned points left behind by a removed song', () => {
    render(<Ballot songs={SONGS} savedPoints={{ s1: 60, gone: 40 }} onSave={vi.fn()} />);
    expect(screen.getByText('Points left: 40')).toBeInTheDocument();
    expect(screen.getByText('40 points unassigned — your total must be exactly 100.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('shows an error when saving fails and keeps the input', async () => {
    const onSave = vi.fn().mockRejectedValue({ code: 'unavailable' });
    const user = userEvent.setup();
    render(<Ballot songs={SONGS} savedPoints={{ s1: 60, s2: 40 }} onSave={onSave} />);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Could not save: Network problem — check your connection and try again.',
    );
    expect(screen.getByLabelText('Points for Africa')).toHaveValue(60);
  });

  it('explains that a poll with no songs cannot be voted on', () => {
    render(<Ballot songs={[]} savedPoints={undefined} onSave={vi.fn()} />);
    expect(screen.getByText('Add songs to this poll before voting.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});
