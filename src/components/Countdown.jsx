import { formatCountdown } from '../lib/poll.js';

export default function Countdown({ endsAt, now }) {
  const text = formatCountdown(endsAt.getTime() - now.getTime());
  if (!text) return null;
  return <span className="badge badge-countdown">Closes in {text}</span>;
}
