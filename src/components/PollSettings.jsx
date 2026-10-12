import { useState } from 'react';
import { errorMessage } from '../lib/errors.js';
import {
  BUDGET_ERROR,
  MAX_BUDGET,
  MIN_BUDGET,
  isValidBudget,
  parseBudget,
  parseDateTimeLocal,
  toDateTimeLocal,
} from '../lib/poll.js';

export default function PollSettings({ settings, closed, onSave, onClose, onReopen }) {
  const [endsAt, setEndsAt] = useState(() => toDateTimeLocal(settings.endsAt));
  const [budget, setBudget] = useState(() => String(settings.budget));
  const [sealed, setSealed] = useState(settings.sealed);
  const [status, setStatus] = useState(null);
  const locked = settings.hasBids;

  async function run(action, okText) {
    try {
      await action();
      setStatus({ ok: true, text: okText });
    } catch (err) {
      setStatus({ ok: false, text: `Could not update poll: ${errorMessage(err)}` });
    }
  }

  function handleSave(event) {
    event.preventDefault();
    const changes = { endsAt: parseDateTimeLocal(endsAt) };
    if (!locked) {
      const n = parseBudget(budget);
      if (!isValidBudget(n)) {
        setStatus({ ok: false, text: BUDGET_ERROR });
        return;
      }
      changes.budget = n;
      changes.sealed = sealed;
    }
    run(() => onSave(changes), 'Settings saved.');
  }

  function handleToggle() {
    if (closed) {
      if (window.confirm('Reopen this poll for bidding?')) run(onReopen, 'Poll reopened.');
    } else if (window.confirm('Close this poll now? Members will no longer be able to bid.')) {
      run(onClose, 'Poll closed.');
    }
  }

  return (
    <section className="panel poll-settings" aria-labelledby="poll-settings-heading">
      <h2 id="poll-settings-heading">Poll settings</h2>
      <button type="button" className={closed ? 'secondary' : 'danger'} onClick={handleToggle}>
        {closed ? 'Reopen' : 'Close now'}
      </button>
      <form className="settings-form" onSubmit={handleSave} noValidate>
        <label className="field">
          End date
          <input type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} />
        </label>
        <label className="field">
          Budget
          <input
            type="number"
            min={MIN_BUDGET}
            max={MAX_BUDGET}
            step="1"
            inputMode="numeric"
            disabled={locked}
            value={budget}
            onChange={(event) => setBudget(event.target.value)}
          />
        </label>
        <fieldset className="field" disabled={locked}>
          <legend>Visibility</legend>
          <label>
            <input type="radio" name="settings-visibility" checked={!sealed} onChange={() => setSealed(false)} />
            Open
          </label>
          <label>
            <input type="radio" name="settings-visibility" checked={sealed} onChange={() => setSealed(true)} />
            Sealed
          </label>
        </fieldset>
        {locked && <p className="hint">Locked — bids have been placed.</p>}
        <button type="submit">Save settings</button>
      </form>
      {status && (
        <p role={status.ok ? 'status' : 'alert'} className={status.ok ? 'ok' : 'error'}>
          {status.text}
        </p>
      )}
    </section>
  );
}
