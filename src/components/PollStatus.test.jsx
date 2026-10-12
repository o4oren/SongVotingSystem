import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import Countdown from './Countdown.jsx';
import PollStatus from './PollStatus.jsx';

const NOW = new Date(2026, 9, 12, 12, 0, 0);
const at = (ms) => new Date(NOW.getTime() + ms);

describe('Countdown', () => {
  it('shows the time left', () => {
    render(<Countdown endsAt={at(12 * 60_000 + 5000)} now={NOW} />);
    expect(screen.getByText('Closes in 12m 05s')).toHaveClass('badge', 'badge-countdown');
  });

  it('renders nothing at or past the end', () => {
    const { container } = render(<Countdown endsAt={NOW} now={NOW} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('PollStatus', () => {
  it('shows Open for a poll with no end date', () => {
    render(<PollStatus poll={{}} now={NOW} />);
    expect(screen.getByText('Open')).toHaveClass('badge-open');
    expect(screen.queryByText('Sealed')).not.toBeInTheDocument();
  });

  it('shows a live countdown instead of Open when an end date is set', () => {
    render(<PollStatus poll={{ endsAt: at(2 * 3_600_000) }} now={NOW} />);
    expect(screen.getByText('Closes in 2h 0m')).toBeInTheDocument();
    expect(screen.queryByText('Open')).not.toBeInTheDocument();
  });

  it('shows Closed when closed by hand or past the end date', () => {
    const { rerender } = render(<PollStatus poll={{ closed: true, endsAt: at(60_000) }} now={NOW} />);
    expect(screen.getByText('Closed')).toHaveClass('badge-closed');
    expect(screen.queryByText(/Closes in/)).not.toBeInTheDocument();
    rerender(<PollStatus poll={{ endsAt: at(-1) }} now={NOW} />);
    expect(screen.getByText('Closed')).toBeInTheDocument();
  });

  it('adds a Sealed badge to sealed polls', () => {
    render(<PollStatus poll={{ sealed: true }} now={NOW} />);
    expect(screen.getByText('Sealed')).toHaveClass('badge-sealed');
  });
});
