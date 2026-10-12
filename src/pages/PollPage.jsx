import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import AddSongForm from '../components/AddSongForm.jsx';
import Ballot from '../components/Ballot.jsx';
import PollSettings from '../components/PollSettings.jsx';
import PollStatus from '../components/PollStatus.jsx';
import Ranking from '../components/Ranking.jsx';
import { useNow } from '../hooks/useNow.js';
import { usePoll } from '../hooks/usePoll.js';
import { addSong, closePoll, removeSong, reopenPoll, saveBid, updatePollSettings } from '../lib/db.js';
import { errorMessage } from '../lib/errors.js';
import { computeRanking } from '../lib/ranking.js';

export default function PollPage({ me }) {
  const { pollId } = useParams();
  const now = useNow();
  const { poll, settings, closed, bidsVisible, songs, bids, myBid, loading, error } = usePoll(pollId, me.email, now);
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

  const rows = computeRanking(songs, bidsVisible ? bids : [], settings.budget);
  const endsAtPassed = settings.endsAt !== null && settings.endsAt <= now;
  // Remount the settings form whenever the server-side settings change, so it never re-saves stale values.
  const settingsKey = [settings.closed, settings.endsAt?.getTime(), settings.budget, settings.sealed, settings.hasBids].join('|');

  async function handleRemoveSong(song) {
    if (!window.confirm(`Remove "${song.title}"? Points bid on it will be dropped.`)) return;
    try {
      await removeSong(pollId, song.id);
      setActionError(null);
    } catch (err) {
      setActionError(`Could not remove song: ${errorMessage(err)}`);
    }
  }

  let sealedNote = null;
  if (!bidsVisible) sealedNote = closed ? 'Tallying final results…' : 'Bids are sealed until the poll closes.';

  return (
    <section>
      <p>
        <Link to="/">← All polls</Link>
      </p>
      <h1 className="poll-title gradient-text">{poll.title}</h1>
      <div className="poll-meta">
        <PollStatus poll={poll} now={now} />
        <span className="muted">Budget: {settings.budget} pts</span>
      </div>
      {actionError && <p role="alert" className="error">{actionError}</p>}
      {me.isAdmin && (
        <PollSettings
          key={settingsKey}
          settings={settings}
          closed={closed}
          onSave={(changes) => updatePollSettings(pollId, changes)}
          onClose={() => closePoll(pollId)}
          onReopen={() => reopenPoll(pollId, endsAtPassed)}
        />
      )}
      <h2>{closed ? 'Final results' : 'Ranking'}</h2>
      {sealedNote && <p className="hint">{sealedNote}</p>}
      <Ranking
        rows={rows}
        showScores={bidsVisible}
        canRemove={me.isAdmin && !closed}
        onRemoveSong={handleRemoveSong}
      />
      {me.isAdmin && !closed && <AddSongForm onAdd={(song) => addSong(pollId, song, me.email)} />}
      <Ballot
        songs={songs}
        budget={settings.budget}
        savedPoints={myBid?.points}
        readOnly={closed}
        onSave={(points) => saveBid(pollId, me.email, points, { hasBids: settings.hasBids })}
      />
    </section>
  );
}
