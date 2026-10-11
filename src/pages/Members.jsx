import { useState } from 'react';
import { useMembers } from '../hooks/useMembers.js';
import { addMember, removeMember, setMemberAdmin } from '../lib/db.js';
import { isValidEmail, normalizeEmail } from '../lib/email.js';
import { errorMessage } from '../lib/errors.js';

export default function Members({ me }) {
  const { data, loading, error } = useMembers();
  const [email, setEmail] = useState('');
  const [makeAdmin, setMakeAdmin] = useState(false);
  const [actionError, setActionError] = useState(null);

  if (loading) return <p className="status">Loading…</p>;
  if (error) return <p role="alert" className="error">{errorMessage(error)}</p>;

  const members = [...data].sort((a, b) => a.id.localeCompare(b.id));

  async function handleAdd(event) {
    event.preventDefault();
    const normalized = normalizeEmail(email);
    if (!isValidEmail(normalized)) {
      setActionError('Enter a valid email address.');
      return;
    }
    if (members.some((member) => member.id === normalized)) {
      setActionError(`${normalized} is already on the list.`);
      return;
    }
    try {
      await addMember(normalized, makeAdmin, me.email);
      setEmail('');
      setMakeAdmin(false);
      setActionError(null);
    } catch (err) {
      setActionError(`Could not add member: ${errorMessage(err)}`);
    }
  }

  async function handleToggleAdmin(member) {
    try {
      await setMemberAdmin(member.id, !member.admin);
      setActionError(null);
    } catch (err) {
      setActionError(`Could not update ${member.id}: ${errorMessage(err)}`);
    }
  }

  async function handleRemove(member) {
    if (!window.confirm(`Remove ${member.id} from the band list?`)) return;
    try {
      await removeMember(member.id);
      setActionError(null);
    } catch (err) {
      setActionError(`Could not remove ${member.id}: ${errorMessage(err)}`);
    }
  }

  return (
    <section>
      <h1>Members</h1>
      <form className="inline-form" onSubmit={handleAdd}>
        <input
          aria-label="Email to add"
          placeholder="name@gmail.com"
          inputMode="email"
          autoComplete="off"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <label>
          <input
            type="checkbox"
            aria-label="Make admin"
            checked={makeAdmin}
            onChange={(event) => setMakeAdmin(event.target.checked)}
          />{' '}
          Admin
        </label>
        <button type="submit">Add member</button>
      </form>
      {actionError && <p role="alert" className="error">{actionError}</p>}
      <ul className="list">
        {members.map((member) => {
          const isMe = member.id === me.email;
          return (
            <li key={member.id}>
              <span>
                {member.id}
                {isMe && ' (you)'}
              </span>
              <label>
                <input
                  type="checkbox"
                  aria-label={`Admin: ${member.id}`}
                  checked={member.admin === true}
                  disabled={isMe}
                  onChange={() => handleToggleAdmin(member)}
                />{' '}
                Admin
              </label>
              <button
                type="button"
                className="danger"
                aria-label={`Remove ${member.id}`}
                title={isMe ? "You can't remove yourself" : undefined}
                disabled={isMe}
                onClick={() => handleRemove(member)}
              >
                Remove
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
