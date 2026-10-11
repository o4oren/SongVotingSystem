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

export function createPoll(title, byEmail) {
  return addDoc(collection(db, 'polls'), { title, createdBy: byEmail, createdAt: serverTimestamp() });
}

// Firestore doesn't cascade-delete subcollections, so songs and votes go first.
// One batch holds up to 500 writes, far more than a band poll needs.
export async function deletePoll(pollId) {
  const [songs, votes] = await Promise.all([
    getDocs(collection(db, 'polls', pollId, 'songs')),
    getDocs(collection(db, 'polls', pollId, 'votes')),
  ]);
  const batch = writeBatch(db);
  songs.docs.forEach((song) => batch.delete(song.ref));
  votes.docs.forEach((vote) => batch.delete(vote.ref));
  batch.delete(doc(db, 'polls', pollId));
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

export function saveVote(pollId, email, points) {
  return setDoc(doc(db, 'polls', pollId, 'votes', email), { points, updatedAt: serverTimestamp() });
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
