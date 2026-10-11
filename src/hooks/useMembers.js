import { useCollection } from './useFirestore.js';

export function useMembers() {
  return useCollection(['members']);
}
