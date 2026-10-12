import { useState } from 'react';
import { Link } from 'react-router-dom';
import PollStatus from '../components/PollStatus.jsx';
import { useNow } from '../hooks/useNow.js';
import { usePolls } from '../hooks/usePolls.js';
import { createPoll, deletePoll } from '../lib/db.js';
import { errorMessage } from '../lib/errors.js';
import {
  BUDGET_ERROR,
  DEFAULT_BUDGET,
  MAX_BUDGET,
  MIN_BUDGET,
  isValidBudget,
  parseBudget,
  parseDateTimeLocal,
  pollSettings,
} from '../lib/poll.js';

const EMPTY_FORM = { title: '', budget: String(DEFAULT_BUDGET), sealed: false, endsAt: '' };

export default function PollsList({ me }) {
  const { data: polls, loading, error } = usePolls();
  const [form, setForm] = useState(EMPTY_FORM);
  const [actionError, setActionError] = useState(null);
  // Only tick when there's a countdown to show.
  const now = useNow(polls.some((poll) => pollSettings(poll).endsAt !== null));

  const update = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }));

  async function handleCreate(event) {
    event.preventDefault();
    const title = form.title.trim();
    const budget = parseBudget(form.budget);
    const endsAt = parseDateTimeLocal(form.endsAt);
    if (!title) {
      setActionError('Poll title is required.');
      return;
    }
    if (!isValidBudget(budget)) {
      setActionError(BUDGET_ERROR);
      return;
    }
    if (endsAt && endsAt <= new Date()) {
      setActionError('End date must be in the future.');
      return;
    }
    try {
      await createPoll({ title, budget, sealed: form.sealed, endsAt }, me.email);
      setForm(EMPTY_FORM);
      setActionError(null);
    } catch (err) {
      setActionError(`Could not create poll: ${errorMessage(err)}`);
    }
  }

  async function handleDelete(poll) {
    if (!window.confirm(`Delete "${poll.title}" and all its songs and bids?`)) return;
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
        <form className="create-poll-form panel" onSubmit={handleCreate} noValidate>
          <input
            aria-label="New poll title"
            placeholder="New poll title"
            value={form.title}
            onChange={update('title')}
          />
          <label className="field">
            Budget
            <input
              type="number"
              min={MIN_BUDGET}
              max={MAX_BUDGET}
              step="1"
              inputMode="numeric"
              value={form.budget}
              onChange={update('budget')}
            />
          </label>
          <label className="field">
            End date (optional)
            <input type="datetime-local" value={form.endsAt} onChange={update('endsAt')} />
          </label>
          <fieldset className="field">
            <legend>Visibility</legend>
            <label>
              <input
                type="radio"
                name="create-visibility"
                checked={!form.sealed}
                onChange={() => setForm((current) => ({ ...current, sealed: false }))}
              />
              Open <span className="muted">— everyone sees bids and the ranking live</span>
            </label>
            <label>
              <input
                type="radio"
                name="create-visibility"
                checked={form.sealed}
                onChange={() => setForm((current) => ({ ...current, sealed: true }))}
              />
              Sealed <span className="muted">— bids stay hidden until the poll closes</span>
            </label>
          </fieldset>
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
              <PollStatus poll={poll} now={now} />
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
