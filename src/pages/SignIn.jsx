import { useState } from 'react';
import { signIn } from '../hooks/useAuth.js';
import { errorMessage } from '../lib/errors.js';

// Closing the Google popup isn't an error worth showing.
const IGNORED_CODES = new Set(['auth/popup-closed-by-user', 'auth/cancelled-popup-request']);

export default function SignIn() {
  const [error, setError] = useState(null);

  async function handleClick() {
    setError(null);
    try {
      await signIn();
    } catch (err) {
      if (!IGNORED_CODES.has(err?.code)) setError(`Sign-in failed: ${errorMessage(err)}`);
    }
  }

  return (
    <section className="center">
      <h1>Band Song Bids</h1>
      <p>Sign in with the Google account your band admin added.</p>
      <button type="button" onClick={handleClick}>Sign in with Google</button>
      {error && <p role="alert" className="error">{error}</p>}
    </section>
  );
}
