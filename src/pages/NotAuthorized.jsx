import { signOutUser } from '../hooks/useAuth.js';

export default function NotAuthorized({ email }) {
  return (
    <section className="center">
      <h1>Not on the band list</h1>
      <p>
        You're signed in as <strong>{email}</strong>.
      </p>
      <p>Ask an admin to add you, then reload this page.</p>
      <button type="button" onClick={() => signOutUser()}>Sign out</button>
    </section>
  );
}
