import { useState } from 'react';
import { cleanPoints, validateBallot } from '../lib/ballot.js';
import { errorMessage } from '../lib/errors.js';

function initialDraft(songs, savedPoints) {
  return Object.fromEntries(
    songs.map((song) => [song.id, savedPoints?.[song.id] != null ? String(savedPoints[song.id]) : '']),
  );
}

export default function Ballot({ songs, savedPoints, onSave }) {
  const [draft, setDraft] = useState(() => initialDraft(songs, savedPoints));
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);

  const songIds = songs.map((song) => song.id);
  const result = validateBallot(draft, songIds);
  const invalid = new Set(result.invalidSongIds);

  function handleChange(songId, value) {
    setDraft((current) => ({ ...current, [songId]: value }));
    setStatus(null);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!result.valid) return;
    setSaving(true);
    try {
      await onSave(cleanPoints(draft, songIds));
      setStatus({ ok: true, text: 'Saved.' });
    } catch (err) {
      setStatus({ ok: false, text: `Could not save: ${errorMessage(err)}` });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="ballot" onSubmit={handleSubmit}>
      <h2>My ballot</h2>
      {songs.map((song) => (
        <label key={song.id} className="ballot-row">
          <span>
            {song.title}
            {song.artist && <span className="muted"> — {song.artist}</span>}
          </span>
          <input
            type="number"
            min="0"
            max="100"
            step="1"
            inputMode="numeric"
            aria-label={`Points for ${song.title}`}
            aria-invalid={invalid.has(song.id)}
            value={draft[song.id] ?? ''}
            onChange={(event) => handleChange(song.id, event.target.value)}
          />
        </label>
      ))}
      <p className="points-left">Points left: {result.remaining}</p>
      {result.errors.map((text) => (
        <p key={text} className="hint">{text}</p>
      ))}
      <button type="submit" disabled={!result.valid || saving}>
        {saving ? 'Saving…' : 'Save'}
      </button>
      {status && (
        <p role={status.ok ? 'status' : 'alert'} className={status.ok ? 'ok' : 'error'}>
          {status.text}
        </p>
      )}
    </form>
  );
}
