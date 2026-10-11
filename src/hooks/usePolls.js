import { useCollection } from './useFirestore.js';

export function usePolls() {
  return useCollection(['polls'], { field: 'createdAt', direction: 'desc' });
}
