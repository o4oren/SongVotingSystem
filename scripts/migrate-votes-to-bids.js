// One-off: copies polls/*/votes/* to polls/*/bids/* and sets hasBids on polls that have votes.
// Safe to re-run: existing bids are never overwritten. Old votes are left in place.
//
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json npm run migrate:bids -- --dry-run
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json npm run migrate:bids
import { pathToFileURL } from 'node:url';
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

export async function migrateVotesToBids(db, { dryRun = false } = {}) {
  const counts = { polls: 0, copied: 0, skipped: 0, flagged: 0 };
  const polls = await db.collection('polls').get();

  for (const poll of polls.docs) {
    counts.polls += 1;
    const votes = await poll.ref.collection('votes').get();
    if (votes.empty) continue;

    for (const vote of votes.docs) {
      const bidRef = poll.ref.collection('bids').doc(vote.id);
      if ((await bidRef.get()).exists) {
        counts.skipped += 1;
        continue;
      }
      counts.copied += 1;
      if (!dryRun) await bidRef.set(vote.data());
    }

    if (poll.get('hasBids') !== true) {
      counts.flagged += 1;
      if (!dryRun) await poll.ref.update({ hasBids: true });
    }
  }

  return counts;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dryRun = process.argv.includes('--dry-run');
  const app = initializeApp({ credential: applicationDefault() });
  const counts = await migrateVotesToBids(getFirestore(app), { dryRun });
  console.log(`${dryRun ? '[dry run] ' : ''}Polls checked: ${counts.polls}`);
  console.log(`${dryRun ? '[dry run] ' : ''}Bids copied: ${counts.copied}, already there: ${counts.skipped}`);
  console.log(`${dryRun ? '[dry run] ' : ''}Polls flagged hasBids: ${counts.flagged}`);
}
