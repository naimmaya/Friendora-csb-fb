import {
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import type {SocialPageDoc} from '../types';
import {db, handleFirestoreError, OperationType} from './firebase';

export const PAGE_CATEGORIES = [
  'Business',
  'Community',
  'Public Figure',
  'Entertainment',
  'Shop',
  'Brand',
  'Education',
  'Local Business',
  'Creator',
  'Media & News',
] as const;

function makePageId(): string {
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 14)
      : `${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
  return `page_${Date.now().toString(36)}_${rand}`;
}

function tsToIso(value: unknown): string {
  if (
    value &&
    typeof value === 'object' &&
    'toDate' in value &&
    typeof (value as {toDate: () => Date}).toDate === 'function'
  ) {
    return (value as {toDate: () => Date}).toDate().toISOString();
  }
  if (typeof value === 'string' && value) return value;
  return new Date().toISOString();
}

function clamp(str: string | null | undefined, max: number): string {
  return String(str || '').trim().slice(0, max);
}

function mapPageDoc(pageId: string, data: Record<string, unknown>): SocialPageDoc {
  return {
    pageId,
    pageName: String(data.pageName || 'Untitled Page'),
    category: String(data.category || 'Community'),
    pagePhoto: typeof data.pagePhoto === 'string' ? data.pagePhoto : '',
    coverPhoto: typeof data.coverPhoto === 'string' ? data.coverPhoto : '',
    bio: typeof data.bio === 'string' ? data.bio : '',
    website: typeof data.website === 'string' ? data.website : '',
    whatsapp: typeof data.whatsapp === 'string' ? data.whatsapp : '',
    ownerId: String(data.ownerId || ''),
    adminIds: Array.isArray(data.adminIds) ? data.adminIds.map(String) : [],
    followers: Array.isArray(data.followers) ? data.followers.map(String) : [],
    createdAt: tsToIso(data.createdAt),
    updatedAt: tsToIso(data.updatedAt),
  };
}

/**
 * Real-time subscription to all public Facebook-style Pages in Firestore.
 */
export function subscribePagesPermanent(
  onUpdate: (pages: SocialPageDoc[]) => void,
  onError?: (err: unknown) => void,
): Unsubscribe {
  const q = query(collection(db, 'pages'), where('visibility', '==', 'public'));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs
        .map((d) => mapPageDoc(d.id, d.data() as Record<string, unknown>))
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      onUpdate(list);
    },
    (error) => {
      if (onError) onError(error);
      try {
        handleFirestoreError(error, OperationType.LIST, 'pages');
      } catch {
        // Logged
      }
    },
  );
}

export async function createPagePermanent(params: {
  ownerUid: string;
  pageName: string;
  category: string;
  pagePhoto?: string;
  coverPhoto?: string;
  bio?: string;
  website?: string;
  whatsapp?: string;
}): Promise<SocialPageDoc> {
  if (!params.ownerUid) throw new Error('You must be signed in to create a Page.');
  const cleanName = clamp(params.pageName, 80);
  if (cleanName.length < 2) throw new Error('Page name must be at least 2 characters.');
  const cleanCategory = clamp(params.category, 40) || 'Community';
  const pageId = makePageId();

  const payload = {
    pageId,
    pageName: cleanName,
    category: cleanCategory,
    pagePhoto: clamp(params.pagePhoto, 450000),
    coverPhoto: clamp(params.coverPhoto, 450000),
    bio: clamp(params.bio, 500),
    website: clamp(params.website, 200),
    whatsapp: clamp(params.whatsapp, 40),
    ownerId: params.ownerUid,
    adminIds: [params.ownerUid],
    followers: [] as string[],
    visibility: 'public',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'pages', pageId), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `pages/${pageId}`);
  }

  const now = new Date().toISOString();
  return {
    pageId,
    pageName: cleanName,
    category: cleanCategory,
    pagePhoto: payload.pagePhoto,
    coverPhoto: payload.coverPhoto,
    bio: payload.bio,
    website: payload.website,
    whatsapp: payload.whatsapp,
    ownerId: params.ownerUid,
    adminIds: [params.ownerUid],
    followers: [],
    createdAt: now,
    updatedAt: now,
  };
}

export async function updatePagePermanent(
  pageId: string,
  updates: {
    pageName: string;
    category: string;
    pagePhoto: string;
    coverPhoto: string;
    bio: string;
    website: string;
    whatsapp: string;
  },
): Promise<void> {
  const cleanName = clamp(updates.pageName, 80);
  if (cleanName.length < 2) throw new Error('Page name must be at least 2 characters.');
  const cleanCategory = clamp(updates.category, 40) || 'Community';
  try {
    await updateDoc(doc(db, 'pages', pageId), {
      pageName: cleanName,
      category: cleanCategory,
      pagePhoto: clamp(updates.pagePhoto, 450000),
      coverPhoto: clamp(updates.coverPhoto, 450000),
      bio: clamp(updates.bio, 500),
      website: clamp(updates.website, 200),
      whatsapp: clamp(updates.whatsapp, 40),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `pages/${pageId}`);
  }
}

export async function togglePageFollowPermanent(
  page: SocialPageDoc,
  myUid: string,
): Promise<boolean> {
  if (!myUid) throw new Error('Sign in to follow this Page.');
  const alreadyFollowing = page.followers.includes(myUid);
  try {
    await updateDoc(doc(db, 'pages', page.pageId), {
      followers: alreadyFollowing ? arrayRemove(myUid) : arrayUnion(myUid),
      updatedAt: serverTimestamp(),
    });
    return !alreadyFollowing;
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `pages/${page.pageId}`);
  }
}

export async function addPageAdminPermanent(
  page: SocialPageDoc,
  newAdminUid: string,
): Promise<void> {
  if (!newAdminUid || page.adminIds.includes(newAdminUid)) return;
  const nextAdmins = Array.from(new Set([...page.adminIds, newAdminUid])).slice(0, 20);
  try {
    await updateDoc(doc(db, 'pages', page.pageId), {
      adminIds: nextAdmins,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `pages/${page.pageId}`);
  }
}

export async function removePageAdminPermanent(
  page: SocialPageDoc,
  targetAdminUid: string,
): Promise<void> {
  if (targetAdminUid === page.ownerId) {
    throw new Error('The Page owner cannot be removed from admins.');
  }
  const nextAdmins = page.adminIds.filter((uid) => uid !== targetAdminUid);
  try {
    await updateDoc(doc(db, 'pages', page.pageId), {
      adminIds: nextAdmins,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `pages/${page.pageId}`);
  }
}

export async function deletePagePermanent(pageId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'pages', pageId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `pages/${pageId}`);
  }
}
