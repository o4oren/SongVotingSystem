import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import AddSongForm from '../components/AddSongForm.jsx';
import Ballot from '../components/Ballot.jsx';
import Ranking from '../components/Ranking.jsx';
import { usePoll } from '../hooks/usePoll.js';
import { addSong, removeSong, saveVote } from '../lib/db.js';
import { errorMessage } from '../lib/errors.js';
import { computeRanking } from '../lib/ranking.js';

export default function PollPage({ me }) {
  const { pollId } = useParams();
  const { poll, songs, votes, loading, error } = usePoll(pollId);
  const [actionError, setActionError] = useState(null);

  if (loading) return <p className="status">Loading…</p>;
  if (error) return <p role="alert" className="error">{errorMessage(error)}</p>;
  if (!poll) {
    return (
      <p>
        Poll not found. <Link to="/">Back to polls</Link>
      </p>
    );
  }

  const rows = computeRanking(songs, votes);
  const myVote = votes.find((vote) => vote.email === me.email);

  async function handleRemoveSong(song) {
    if (!window.confirm(`Remove "${song.title}"? Points given to it will be dropped.`)) return;
    try {
      await removeSong(pollId, song.id);
      setActionError(null);
    } catch (err) {
      setActionError(`Could not remove song: ${errorMessage(err)}`);
    }
  }

  return (
    <section>
      <p>
        <Link to="/">← All polls</Link>
      </p>
      <h1>{poll.title}</h1>
      {actionError && <p role="alert" className="error">{actionError}</p>}
      <h2>Ranking</h2>
      <Ranking rows={rows} isAdmin={me.isAdmin} onRemoveSong={handleRemoveSong} />
      {me.isAdmin && <AddSongForm onAdd={(song) => addSong(pollId, song, me.email)} />}
      <Ballot songs={songs} savedPoints={myVote?.points} onSave={(points) => saveVote(pollId, me.email, points)} />
    </section>
  );
}
