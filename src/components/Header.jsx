import { Link, NavLink } from 'react-router-dom';
import { signOutUser } from '../hooks/useAuth.js';

export default function Header({ me }) {
  return (
    <header className="app-header">
      <Link to="/" className="brand">Band Song Bids</Link>
      <nav>
        {me.isAdmin && <NavLink to="/members">Members</NavLink>}
        <span className="muted">{me.email}</span>
        <button type="button" onClick={() => signOutUser()}>Sign out</button>
      </nav>
    </header>
  );
}
