import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AddSongForm from './AddSongForm.jsx';

function renderForm(onAdd = vi.fn().mockResolvedValue(undefined)) {
  render(<AddSongForm onAdd={onAdd} />);
  return onAdd;
}

describe('AddSongForm', () => {
  it.each(['', '   '])('rejects a blank title (%j)', async (title) => {
    const user = userEvent.setup();
    const onAdd = renderForm();
    if (title) await user.type(screen.getByLabelText('Song title'), title);
    await user.click(screen.getByRole('button', { name: 'Add song' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Song title is required.');
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('trims title and artist, adds the song and clears the fields', async () => {
    const user = userEvent.setup();
    const onAdd = renderForm();
    await user.type(screen.getByLabelText('Song title'), '  Africa ');
    await user.type(screen.getByLabelText('Artist'), ' Toto  ');
    await user.click(screen.getByRole('button', { name: 'Add song' }));
    expect(onAdd).toHaveBeenCalledWith({ title: 'Africa', artist: 'Toto' });
    expect(screen.getByLabelText('Song title')).toHaveValue('');
    expect(screen.getByLabelText('Artist')).toHaveValue('');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows a friendly message when adding is not allowed', async () => {
    const user = userEvent.setup();
    renderForm(vi.fn().mockRejectedValue({ code: 'permission-denied' }));
    await user.type(screen.getByLabelText('Song title'), 'Africa');
    await user.click(screen.getByRole('button', { name: 'Add song' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("Could not add song: You don't have access.");
  });
});
