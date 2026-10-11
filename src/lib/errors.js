export function errorMessage(err) {
  if (err?.code === 'permission-denied') return "You don't have access.";
  if (err?.code === 'unavailable') return 'Network problem — check your connection and try again.';
  return err?.message || 'Something went wrong.';
}
