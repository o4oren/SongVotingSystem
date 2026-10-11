import { useCollection, useDocument } from './useFirestore.js';

export function usePoll(pollId) {
  const poll = useDocument(['polls', pollId]);
  const songs = useCollection(['polls', pollId, 'songs'], { field: 'addedAt', direction: 'asc' });
  const votes = useCollection(['polls', pollId, 'votes']);

  return {
    poll: poll.data,
    songs: songs.data,
    votes: votes.data.map((vote) => ({ email: vote.id, points: vote.points ?? {} })),
    loading: poll.loading || songs.loading || votes.loading,
    error: poll.error || songs.error || votes.error,
  };
}
