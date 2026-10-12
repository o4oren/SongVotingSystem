import { useState } from 'react';
import { cleanPoints, validateBallot } from '../lib/ballot.js';
import { errorMessage } from '../lib/errors.js';

function initialDraft(songs, savedPoints) {
  return Object.fromEntries(
    songs.map((song) => [song.id, savedPoints?.[song.id] != null ? String(savedPoints[song.id]) : '']),
  );
}

// Members can always write their own bid on an open poll, so a rejection means it just closed.
function saveError(err) {
  return err?.code === 'permission-denied' ? 'Bidding closed for this poll.' : `Could not save: ${errorMessage(err)}`;
}

export default function Ballot({ songs, budget, savedPoints, readOnly = false, onSave }) {
  const [draft, setDraft] = useState(() => initialDraft(songs, savedPoints));
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);

  const songIds = songs.map((song) => song.id);
  const result = validateBallot(draft, songIds, budget);
  const invalid = new Set(result.invalidSongIds);

  function handleChange(songId, value) {
    setDraft((current) => ({ ...current, [songId]: value }));
    setStatus(null);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (readOnly || !result.valid) return;
    setSaving(true);
    try {
      await onSave(cleanPoints(draft, songIds, budget));
      setStatus({ ok: true, text: 'Bid saved.' });
    } catch (err) {
      setStatus({ ok: false, text: saveError(err) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="ballot panel" onSubmit={handleSubmit}>
      <h2>My bid</h2>
      {songs.map((song) => (
        <label key={song.id} className="ballot-row">
          <span>
            {song.title}
            {song.artist && <span className="muted"> — {song.artist}</span>}
          </span>
          <input
            type="number"
            min="0"
            max={budget}
            step="1"
            inputMode="numeric"
            aria-label={`Points for ${song.title}`}
            aria-invalid={!readOnly && invalid.has(song.id)}
            disabled={readOnly}
            value={draft[song.id] ?? ''}
            onChange={(event) => handleChange(song.id, event.target.value)}
          />
        </label>
      ))}
      {readOnly ? (
        <p className="hint">Bidding is closed.</p>
      ) : (
        <>
          <p className="points-left">
            Budget left: {result.remaining} / {budget}
          </p>
          {result.errors.map((text) => (
            <p key={text} className="hint">{text}</p>
          ))}
          <button type="submit" disabled={!result.valid || saving}>
            {saving ? 'Saving…' : savedPoints ? 'Update bid' : 'Place bid'}
          </button>
        </>
      )}
      {status && (
        <p role={status.ok ? 'status' : 'alert'} className={status.ok ? 'ok' : 'error'}>
          {status.text}
        </p>
      )}
    </form>
  );
}
