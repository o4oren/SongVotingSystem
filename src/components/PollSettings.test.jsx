import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PollSettings from './PollSettings.jsx';

const OPEN = { budget: 100, sealed: false, closed: false, endsAt: null, hasBids: false };

function renderSettings(props = {}) {
  const handlers = {
    onSave: vi.fn().mockResolvedValue(undefined),
    onClose: vi.fn().mockResolvedValue(undefined),
    onReopen: vi.fn().mockResolvedValue(undefined),
  };
  render(<PollSettings settings={OPEN} closed={false} {...handlers} {...props} />);
  return { ...handlers, ...props };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('PollSettings', () => {
  it('shows the current settings', () => {
    renderSettings({ settings: { ...OPEN, budget: 150, sealed: true, endsAt: new Date(2026, 9, 16, 20, 0) } });
    expect(screen.getByRole('heading', { name: 'Poll settings' })).toBeInTheDocument();
    expect(screen.getByLabelText('End date')).toHaveValue('2026-10-16T20:00');
    expect(screen.getByLabelText('Budget')).toHaveValue(150);
    expect(screen.getByRole('radio', { name: 'Sealed' })).toBeChecked();
  });

  it('saves end date, budget and visibility before any bids', async () => {
    const user = userEvent.setup();
    const { onSave } = renderSettings();
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-10-16T20:00' } });
    await user.clear(screen.getByLabelText('Budget'));
    await user.type(screen.getByLabelText('Budget'), '150');
    await user.click(screen.getByRole('radio', { name: 'Sealed' }));
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(onSave).toHaveBeenCalledWith({ endsAt: new Date(2026, 9, 16, 20, 0), budget: 150, sealed: true });
    expect(screen.getByRole('status')).toHaveTextContent('Settings saved.');
  });

  it('clears the end date when the field is emptied', async () => {
    const user = userEvent.setup();
    const { onSave } = renderSettings({ settings: { ...OPEN, endsAt: new Date(2026, 9, 16, 20, 0) } });
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '' } });
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(onSave).toHaveBeenCalledWith({ endsAt: null, budget: 100, sealed: false });
  });

  it('rejects an invalid budget', async () => {
    const user = userEvent.setup();
    const { onSave } = renderSettings();
    await user.clear(screen.getByLabelText('Budget'));
    await user.type(screen.getByLabelText('Budget'), '0');
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Budget must be a whole number from 1 to 1000.');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('locks budget and visibility once bids exist and saves only the end date', async () => {
    const user = userEvent.setup();
    const { onSave } = renderSettings({ settings: { ...OPEN, hasBids: true } });
    expect(screen.getByLabelText('Budget')).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Open' })).toBeDisabled();
    expect(screen.getByText('Locked — bids have been placed.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(onSave).toHaveBeenCalledWith({ endsAt: null });
  });

  it('closes an open poll after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    const { onClose } = renderSettings();
    await user.click(screen.getByRole('button', { name: 'Close now' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('does not close when confirmation is cancelled', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();
    const { onClose } = renderSettings();
    await user.click(screen.getByRole('button', { name: 'Close now' }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('reopens a closed poll after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    const { onReopen } = renderSettings({ closed: true });
    expect(screen.queryByRole('button', { name: 'Close now' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reopen' }));
    expect(onReopen).toHaveBeenCalled();
  });

  it('shows an error when an action fails', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    renderSettings({ onClose: vi.fn().mockRejectedValue({ code: 'permission-denied' }) });
    await user.click(screen.getByRole('button', { name: 'Close now' }));
    expect(screen.getByRole('alert')).toHaveTextContent("Could not update poll: You don't have access.");
  });
});
