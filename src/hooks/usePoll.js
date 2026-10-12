import { useEffect, useState } from 'react';
import { canSeeAllBids, isPollClosed, pollSettings } from '../lib/poll.js';
import { useCollection, useDocument } from './useFirestore.js';

const RETRY_DELAY_MS = 3000;

// Firestore rejects a whole query if any doc it could return is unreadable, so on a
// sealed poll that's still open we may only listen to our own bid.
export function usePoll(pollId, myEmail, now) {
  const poll = useDocument(['polls', pollId]);
  const songs = useCollection(['polls', pollId, 'songs'], { field: 'addedAt', direction: 'asc' });

  // A device clock running ahead of the server can open a sealed poll's bids here before the
  // rules do. Fall back to our own bid, then retry the collection after a short delay.
  const [retry, setRetry] = useState({ pollId: null, attempt: 0 });
  const [deniedFor, setDeniedFor] = useState(null);

  const loaded = poll.data !== null;
  const clockSaysVisible = loaded && canSeeAllBids(poll.data, now);
  const denied = deniedFor === pollId;
  const bidsVisible = clockSaysVisible && !denied;
  const attempt = retry.pollId === pollId ? retry.attempt : 0;
  const allBids = useCollection(bidsVisible ? ['polls', pollId, 'bids'] : null, undefined, attempt);
  const sealedDenied = Boolean(poll.data?.sealed) && allBids.error?.code === 'permission-denied';

  useEffect(() => {
    if (sealedDenied) setDeniedFor(pollId);
  }, [sealedDenied, pollId]);

  useEffect(() => {
    if (!denied) return undefined;
    const timer = setTimeout(() => {
      setDeniedFor(null);
      setRetry((prev) => ({ pollId, attempt: (prev.pollId === pollId ? prev.attempt : 0) + 1 }));
    }, RETRY_DELAY_MS);
    return () => clearTimeout(timer);
  }, [denied, pollId]);

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
    error: poll.error || songs.error || (sealedDenied ? null : allBids.error) || ownBid.error,
  };
}
