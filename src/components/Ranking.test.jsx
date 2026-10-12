import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Ranking from './Ranking.jsx';

const AFRICA = { id: 's1', title: 'Africa', artist: 'Toto' };
const CREEP = { id: 's2', title: 'Creep', artist: 'Radiohead' };
const ROWS = [
  { song: AFRICA, total: 80, breakdown: [{ email: 'a@gmail.com', points: 80 }] },
  { song: CREEP, total: 20, breakdown: [{ email: 'b@gmail.com', points: 20 }] },
];

describe('Ranking', () => {
  it('shows totals and breakdowns without score bars', () => {
    const { container } = render(<Ranking rows={ROWS} canRemove={false} onRemoveSong={vi.fn()} />);
    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('80 pts');
    expect(items[0]).toHaveTextContent('a@gmail.com 80');
    expect(items[1]).toHaveTextContent('20 pts');
    expect(container.querySelector('.score-bar')).toBeNull();
  });

  it('can list songs without scores', () => {
    render(<Ranking rows={ROWS} showScores={false} canRemove={false} onRemoveSong={vi.fn()} />);
    expect(screen.getByText('Africa')).toBeInTheDocument();
    expect(screen.queryByText(/pts/)).not.toBeInTheDocument();
    expect(screen.queryByText(/a@gmail.com/)).not.toBeInTheDocument();
  });

  it('shows Remove buttons only when allowed', async () => {
    const onRemoveSong = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<Ranking rows={ROWS} canRemove={false} onRemoveSong={onRemoveSong} />);
    expect(screen.queryByRole('button', { name: 'Remove Africa' })).not.toBeInTheDocument();
    rerender(<Ranking rows={ROWS} showScores={false} canRemove onRemoveSong={onRemoveSong} />);
    await user.click(screen.getByRole('button', { name: 'Remove Africa' }));
    expect(onRemoveSong).toHaveBeenCalledWith(AFRICA);
  });

  it('says when there are no songs', () => {
    render(<Ranking rows={[]} canRemove={false} onRemoveSong={vi.fn()} />);
    expect(screen.getByText('No songs in this poll yet.')).toBeInTheDocument();
  });
});
