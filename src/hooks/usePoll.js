import { canSeeAllBids, isPollClosed, pollSettings } from '../lib/poll.js';
import { useCollection, useDocument } from './useFirestore.js';

// Firestore rejects a whole query if any doc it could return is unreadable, so on a
// sealed poll that's still open we may only listen to our own bid.
export function usePoll(pollId, myEmail, now) {
  const poll = useDocument(['polls', pollId]);
  const songs = useCollection(['polls', pollId, 'songs'], { field: 'addedAt', direction: 'asc' });

  const loaded = poll.data !== null;
  const bidsVisible = loaded && canSeeAllBids(poll.data, now);
  const allBids = useCollection(loaded && bidsVisible ? ['polls', pollId, 'bids'] : null);
  const ownBid = useDocument(loaded && !bidsVisible ? ['polls', pollId, 'bids', myEmail] : null);

  const rawBids = bidsVisible ? allBids.data : ownBid.data ? [ownBid.data] : [];
  const bids = rawBids.map((bid) => ({ email: bid.id, points: bid.points ?? {} }));

  return {
    poll: poll.data,
    settings: pollSettings(poll.data),
    closed: loaded && isPollClosed(poll.data, now),
    bidsVisible,
    songs: songs.data,
    bids,
    myBid: bids.find((bid) => bid.email === myEmail) ?? null,
    loading: poll.loading || songs.loading || allBids.loading || ownBid.loading,
    error: poll.error || songs.error || allBids.error || ownBid.error,
  };
}
