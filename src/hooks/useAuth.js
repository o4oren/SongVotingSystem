import { useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { auth, googleProvider } from '../lib/firebase.js';

export function useAuth() {
  const [state, setState] = useState({ user: null, loading: true });
  useEffect(() => onAuthStateChanged(auth, (user) => setState({ user, loading: false })), []);
  return state;
}

export function signIn() {
  return signInWithPopup(auth, googleProvider);
}

export function signOutUser() {
  return signOut(auth);
}
