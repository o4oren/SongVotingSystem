import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { db } from './firebase.js';

export function createPoll({ title, budget, sealed, endsAt }, byEmail) {
  return addDoc(collection(db, 'polls'), {
    title,
    budget,
    sealed,
    endsAt,
    closed: false,
    hasBids: false,
    createdBy: byEmail,
    createdAt: serverTimestamp(),
  });
}

export function updatePollSettings(pollId, changes) {
  return updateDoc(doc(db, 'polls', pollId), changes);
}

export function closePoll(pollId) {
  return updateDoc(doc(db, 'polls', pollId), { closed: true });
}

// A past end date would close the poll again straight away, so reopening clears it.
export function reopenPoll(pollId, clearEndsAt) {
  return updateDoc(doc(db, 'polls', pollId), clearEndsAt ? { closed: false, endsAt: null } : { closed: false });
}

// Firestore doesn't cascade-delete subcollections, so songs, bids and legacy votes go first.
// Closing first makes a sealed poll's bids readable, so they can be listed for deletion.
// One batch holds up to 500 writes, far more than a band poll needs.
export async function deletePoll(pollId) {
  const pollRef = doc(db, 'polls', pollId);
  await updateDoc(pollRef, { closed: true });
  const [songs, bids, votes] = await Promise.all([
    getDocs(collection(db, 'polls', pollId, 'songs')),
    getDocs(collection(db, 'polls', pollId, 'bids')),
    getDocs(collection(db, 'polls', pollId, 'votes')),
  ]);
  const batch = writeBatch(db);
  [...songs.docs, ...bids.docs, ...votes.docs].forEach((snapshot) => batch.delete(snapshot.ref));
  batch.delete(pollRef);
  await batch.commit();
}

export function addSong(pollId, { title, artist }, byEmail) {
  return addDoc(collection(db, 'polls', pollId, 'songs'), {
    title,
    artist,
    addedBy: byEmail,
    addedAt: serverTimestamp(),
  });
}

export function removeSong(pollId, songId) {
  return deleteDoc(doc(db, 'polls', pollId, 'songs', songId));
}

// The first bid also sets hasBids, which locks the poll's budget and visibility.
export function saveBid(pollId, email, points, { hasBids }) {
  const batch = writeBatch(db);
  batch.set(doc(db, 'polls', pollId, 'bids', email), { points, updatedAt: serverTimestamp() });
  if (!hasBids) batch.update(doc(db, 'polls', pollId), { hasBids: true });
  return batch.commit();
}

// setDoc would silently overwrite (and could demote) an existing member, so check first.
export async function addMember(email, admin, byEmail) {
  const ref = doc(db, 'members', email);
  if ((await getDoc(ref)).exists()) throw new Error(`${email} is already on the list.`);
  await setDoc(ref, { admin, addedBy: byEmail, addedAt: serverTimestamp() });
}

export function setMemberAdmin(email, admin) {
  return updateDoc(doc(db, 'members', email), { admin });
}

export function removeMember(email) {
  return deleteDoc(doc(db, 'members', email));
}
