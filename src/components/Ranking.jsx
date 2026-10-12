export default function Ranking({ rows, showScores = true, canRemove, onRemoveSong }) {
  if (rows.length === 0) return <p>No songs in this poll yet.</p>;

  return (
    <ol className="ranking">
      {rows.map(({ song, total, breakdown }) => (
        <li key={song.id}>
          <div className="ranking-head">
            <span>
              {song.title}
              {song.artist && <span className="muted"> — {song.artist}</span>}
            </span>
            {showScores && <span className="pts-pill">{total} pts</span>}
            {canRemove && (
              <button
                type="button"
                className="danger"
                aria-label={`Remove ${song.title}`}
                onClick={() => onRemoveSong(song)}
              >
                Remove
              </button>
            )}
          </div>
          {showScores && breakdown.length > 0 && (
            <p className="breakdown muted">
              {breakdown.map((entry) => `${entry.email} ${entry.points}`).join(' · ')}
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}
