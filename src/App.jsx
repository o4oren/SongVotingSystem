import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import Header from './components/Header.jsx';
import { useAuth } from './hooks/useAuth.js';
import { useMember } from './hooks/useMember.js';
import { normalizeEmail } from './lib/email.js';
import { errorMessage } from './lib/errors.js';
import Members from './pages/Members.jsx';
import NotAuthorized from './pages/NotAuthorized.jsx';
import PollPage from './pages/PollPage.jsx';
import PollsList from './pages/PollsList.jsx';
import SignIn from './pages/SignIn.jsx';

export default function App() {
  const { user, loading } = useAuth();
  const email = user ? normalizeEmail(user.email) : null;
  const { member, loading: memberLoading, error } = useMember(email || null);

  if (loading || memberLoading) return <p className="status">Loading…</p>;
  if (!user) return <SignIn />;
  if (error) return <p role="alert" className="error">{errorMessage(error)}</p>;
  if (!member) return <NotAuthorized email={email} />;

  const me = { email, isAdmin: member.admin === true };

  return (
    <BrowserRouter>
      <Header me={me} />
      <main>
        <Routes>
          <Route path="/" element={<PollsList me={me} />} />
          <Route path="/polls/:pollId" element={<PollPage me={me} />} />
          <Route path="/members" element={me.isAdmin ? <Members me={me} /> : <Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </BrowserRouter>
  );
}
