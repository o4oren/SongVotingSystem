import { isPollClosed, pollSettings } from '../lib/poll.js';
import Countdown from './Countdown.jsx';

export default function PollStatus({ poll, now }) {
  const { sealed, endsAt } = pollSettings(poll);
  const closed = isPollClosed(poll, now);

  let status;
  if (closed) status = <span className="badge badge-closed">Closed</span>;
  else if (endsAt) status = <Countdown endsAt={endsAt} now={now} />;
  else status = <span className="badge badge-open">Open</span>;

  return (
    <span className="poll-status">
      {status}
      {sealed && <span className="badge badge-sealed">Sealed</span>}
    </span>
  );
}
