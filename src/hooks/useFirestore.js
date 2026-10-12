import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../lib/firebase.js';

const NO_DOCS = [];

// State is tagged with the key it was loaded for, so a path change never shows stale data.
function useSnapshot(key, emptyValue, subscribe) {
  const [state, setState] = useState({ key: null, data: emptyValue, error: null });

  useEffect(() => {
    if (key === null) return undefined;
    return subscribe(
      (data) => setState({ key, data, error: null }),
      (error) => setState({ key, data: emptyValue, error }),
    );
    // `key` encodes everything `subscribe` depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (key === null) return { data: emptyValue, loading: false, error: null };
  if (state.key !== key) return { data: emptyValue, loading: true, error: null };
  return { data: state.data, loading: false, error: state.error };
}

// `attempt` is an optional cache-buster: changing it re-subscribes and clears a stuck error.
export function useCollection(segments, order, attempt) {
  const orderKey = order ? `${order.field}:${order.direction}` : '';
  const key = segments ? `${segments.join('/')}|${orderKey}${attempt ? `|${attempt}` : ''}` : null;
  return useSnapshot(key, NO_DOCS, (onData, onError) => {
    const ref = collection(db, ...segments);
    const source = order ? query(ref, orderBy(order.field, order.direction)) : ref;
    return onSnapshot(
      source,
      (snapshot) => onData(snapshot.docs.map((d) => ({ id: d.id, ...d.data() }))),
      onError,
    );
  });
}

export function useDocument(segments) {
  const key = segments ? segments.join('/') : null;
  return useSnapshot(key, null, (onData, onError) =>
    onSnapshot(
      doc(db, ...segments),
      (snapshot) => onData(snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null),
      onError,
    ),
  );
}
