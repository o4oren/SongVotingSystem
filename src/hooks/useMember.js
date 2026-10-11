import { useDocument } from './useFirestore.js';

export function useMember(email) {
  const { data, loading, error } = useDocument(email ? ['members', email] : null);
  // Non-members can't read the whitelist, so permission-denied means "not on the list".
  if (error?.code === 'permission-denied') return { member: null, loading: false, error: null };
  return { member: data, loading, error };
}
