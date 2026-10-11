import { useState } from 'react';
import { Link } from 'react-router-dom';
import { usePolls } from '../hooks/usePolls.js';
import { createPoll, deletePoll } from '../lib/db.js';
import { errorMessage } from '../lib/errors.js';

export default function PollsList({ me }) {
  const { data: polls, loading, error } = usePolls();
  const [title, setTitle] = useState('');
  const [actionError, setActionError] = useState(null);

  async function handleCreate(event) {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) {
      setActionError('Poll title is required.');
      return;
    }
    try {
      await createPoll(trimmed, me.email);
      setTitle('');
      setActionError(null);
    } catch (err) {
      setActionError(`Could not create poll: ${errorMessage(err)}`);
    }
  }

  async function handleDelete(poll) {
    if (!window.confirm(`Delete "${poll.title}" and all its songs and votes?`)) return;
    try {
      await deletePoll(poll.id);
      setActionError(null);
    } catch (err) {
      setActionError(`Could not delete poll: ${errorMessage(err)}`);
    }
  }

  if (loading) return <p className="status">Loading…</p>;
  if (error) return <p role="alert" className="error">{errorMessage(error)}</p>;

  return (
    <section>
      <h1>Polls</h1>
      {me.isAdmin && (
        <form className="inline-form" onSubmit={handleCreate}>
          <input
            aria-label="New poll title"
            placeholder="New poll title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <button type="submit">Create poll</button>
        </form>
      )}
      {actionError && <p role="alert" className="error">{actionError}</p>}
      {polls.length === 0 ? (
        <p>No polls yet.</p>
      ) : (
        <ul className="list">
          {polls.map((poll) => (
            <li key={poll.id}>
              <Link to={`/polls/${poll.id}`}>{poll.title}</Link>
              {me.isAdmin && (
                <button
                  type="button"
                  className="danger"
                  aria-label={`Delete ${poll.title}`}
                  onClick={() => handleDelete(poll)}
                >
                  Delete
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
