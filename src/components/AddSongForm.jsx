import { useState } from 'react';
import { errorMessage } from '../lib/errors.js';

export default function AddSongForm({ onAdd }) {
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [error, setError] = useState(null);

  async function handleSubmit(event) {
    event.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError('Song title is required.');
      return;
    }
    try {
      await onAdd({ title: trimmedTitle, artist: artist.trim() });
      setTitle('');
      setArtist('');
      setError(null);
    } catch (err) {
      setError(`Could not add song: ${errorMessage(err)}`);
    }
  }

  return (
    <form className="inline-form" onSubmit={handleSubmit}>
      <input aria-label="Song title" placeholder="Song title" value={title} onChange={(event) => setTitle(event.target.value)} />
      <input aria-label="Artist" placeholder="Artist" value={artist} onChange={(event) => setArtist(event.target.value)} />
      <button type="submit">Add song</button>
      {error && <p role="alert" className="error">{error}</p>}
    </form>
  );
}
