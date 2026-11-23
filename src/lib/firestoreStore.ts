import type {User as FirebaseUser} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import type {
  ChatMessage,
  ChatMessageType,
  CommentItem,
  ConversationSummary,
  NetworkData,
  NotificationItem,
  PostItem,
  PostReportReason,
  PresenceRecord,
  ReactionType,
  SocialPageDoc,
  UserProfile,
} from '../types';
import {
  db,
  handleFirestoreError,
  isFirebaseUserVerified,
  loadUserProfileFromFirestore,
  OperationType,
  syncUserProfileToFirestore,
  type FirebaseAuthMethod,
} from './firebase';
import {deleteFirebaseStorageUrlIfApplicable} from './mediaUpload';

/**
 * Deterministic positive 31-bit integer ID from any Firebase UID or Firestore document ID.
 * Keeps existing numeric route/UI props 100% compatible with Firestore string UIDs.
 */
export function uidToNumericId(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 2000000000 + 1;
}

function makeDocId(prefix: string): string {
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 14)
      : `${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

export function canonicalPairId(uidA: string, uidB: string): string {
  return uidA < uidB ? `${uidA}_${uidB}` : `${uidB}_${uidA}`;
}

function tsToIso(value: unknown): string {
  if (value && typeof value === 'object' && 'toDate' in value && typeof (value as {toDate: () => Date}).toDate === 'function') {
    return (value as {toDate: () => Date}).toDate().toISOString();
  }
  if (typeof value === 'string' && value) return value;
  return new Date().toISOString();
}

function clamp(str: string | null | undefined, max: number): string {
  return String(str || '').trim().slice(0, max);
}

/**
 * Compress an uploaded photo into a compact JPEG data URL guaranteed well under Firestore's
 * 1MB document limit so profile photos, cover photos, and post images live PERMANENTLY in Firestore
 * and never disappear after server restarts or redeploys.
 */
export async function compressImageForFirestore(
  file: File,
  kind: 'avatar' | 'cover' | 'post',
): Promise<string> {
  const isImage =
    file.type.startsWith('image/') ||
    /\.(jpg|jpeg|png|webp|gif|avif|bmp|heic|heif)$/i.test(file.name);
  if (!isImage) {
    throw new Error('Please choose a photo file (JPG, PNG, WEBP, or GIF).');
  }
  if (file.size > 20 * 1024 * 1024) {
    throw new Error('Photo must be smaller than 20 MB.');
  }

  const maxDim = kind === 'avatar' ? 320 : kind === 'cover' ? 1000 : 1080;
  const maxChars = kind === 'avatar' ? 90000 : kind === 'cover' ? 240000 : 380000;

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Could not read that image file.'));
      el.src = objectUrl;
    });

    let width = img.naturalWidth || img.width;
    let height = img.naturalHeight || img.height;
    if (width > maxDim || height > maxDim) {
      const ratio = Math.min(maxDim / width, maxDim / height);
      width = Math.max(1, Math.round(width * ratio));
      height = Math.max(1, Math.round(height * ratio));
    }

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Image compression is not supported in this browser.');

    let quality = kind === 'avatar' ? 0.82 : 0.8;
    let dataUrl = '';
    for (let attempt = 0; attempt < 5; attempt++) {
      canvas.width = width;
      canvas.height = height;
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      dataUrl = canvas.toDataURL('image/jpeg', quality);
      if (dataUrl.length <= maxChars) return dataUrl;
      quality = Math.max(0.45, quality - 0.12);
      width = Math.max(200, Math.round(width * 0.82));
      height = Math.max(200, Math.round(height * 0.82));
    }

    if (dataUrl.length > maxChars) {
      throw new Error('Image is too large even after compression. Please pick a smaller photo.');
    }
    return dataUrl;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function mapPublicUserDoc(uid: string, data: Record<string, unknown>): UserProfile {
  return {
    id: uidToNumericId(uid),
    uid,
    name: typeof data.name === 'string' && data.name.trim() ? data.name : 'Verve Member',
    email: null,
    phone: null,
    bio: typeof data.bio === 'string' ? data.bio : '',
    location: typeof data.location === 'string' ? data.location : '',
    work: typeof data.work === 'string' ? data.work : '',
    avatar_url: typeof data.avatarUrl === 'string' ? data.avatarUrl : '',
    cover_url: typeof data.coverUrl === 'string' ? data.coverUrl : '',
    created_at: tsToIso(data.createdAt),
  };
}

/**
 * Auto-fetch the signed-in user's permanent profile from Cloud Firestore.
 * If this is a brand-new verified account, writes the initial profile to Firestore FIRST.
 */
export async function ensureAndLoadUserProfile(
  fbUser: FirebaseUser,
  initialOverrides?: Partial<UserProfile> & {authMethod?: FirebaseAuthMethod},
): Promise<UserProfile> {
  if (!isFirebaseUserVerified(fbUser)) {
    throw new Error('Your email address must be verified before entering the app.');
  }

  const existing = await loadUserProfileFromFirestore(fbUser);
  const authMethod: FirebaseAuthMethod =
    initialOverrides?.authMethod ||
    (fbUser.phoneNumber
      ? 'phone_otp'
      : fbUser.providerData?.some((p) => p.providerId === 'google.com')
        ? 'google'
        : 'email_otp');

  if (!existing) {
    const resolvedName =
      clamp(initialOverrides?.name || fbUser.displayName || fbUser.email?.split('@')[0] || 'Verve Member', 60) ||
      'Verve Member';
    const validName = resolvedName.length >= 2 ? resolvedName : 'Verve Member';
    const initialProfile: UserProfile = {
      id: uidToNumericId(fbUser.uid),
      uid: fbUser.uid,
      name: validName,
      email: fbUser.email || initialOverrides?.email || null,
      phone: fbUser.phoneNumber || initialOverrides?.phone || null,
      bio: clamp(initialOverrides?.bio, 320),
      location: clamp(initialOverrides?.location, 80),
      work: clamp(initialOverrides?.work, 100),
      avatar_url: clamp(initialOverrides?.avatar_url || fbUser.photoURL, 450000),
      cover_url: clamp(initialOverrides?.cover_url, 450000),
      date_of_birth: clamp(initialOverrides?.date_of_birth, 20),
      created_at: new Date().toISOString(),
    };
    await syncUserProfileToFirestore(fbUser, initialProfile, authMethod);
    return initialProfile;
  }

  const loaded: UserProfile = {
    id: uidToNumericId(fbUser.uid),
    uid: fbUser.uid,
    name: existing.name || fbUser.displayName || 'Verve Member',
    email: existing.email || fbUser.email || null,
    phone: existing.phone || fbUser.phoneNumber || null,
    bio: existing.bio || '',
    location: existing.location || '',
    work: existing.work || '',
    avatar_url: existing.avatar_url ?? fbUser.photoURL ?? '',
    cover_url: existing.cover_url || '',
    date_of_birth: existing.date_of_birth || '',
    created_at: existing.created_at || new Date().toISOString(),
  };

  // Ensure legacy docs created before `visibility: 'public'` are upgraded silently
  try {
    const pubSnap = await getDoc(doc(db, 'users', fbUser.uid));
    if (pubSnap.exists() && pubSnap.data()?.visibility !== 'public') {
      await syncUserProfileToFirestore(fbUser, loaded, authMethod);
    }
  } catch {
    // Non-fatal
  }

  return loaded;
}

/**
 * Save profile changes (name, bio, work, location, avatar, cover) to Cloud Firestore FIRST.
 * Throws real Firestore error on failure — never fakes success.
 */
export async function saveUserProfilePermanent(
  fbUser: FirebaseUser,
  updates: {
    name: string;
    bio: string;
    work: string;
    location: string;
    avatar_url: string;
    cover_url: string;
    email?: string | null;
    phone?: string | null;
    date_of_birth?: string;
  },
): Promise<UserProfile> {
  const cleanName = clamp(updates.name, 60);
  if (cleanName.length < 2) {
    throw new Error('Display name must be at least 2 characters.');
  }

  const authMethod: FirebaseAuthMethod = fbUser.phoneNumber
    ? 'phone_otp'
    : fbUser.providerData?.some((p) => p.providerId === 'google.com')
      ? 'google'
      : 'email_otp';

  // 1. Write to Cloud Firestore FIRST (throws real error if Firestore rejects!)
  await syncUserProfileToFirestore(
    fbUser,
    {
      name: cleanName,
      bio: clamp(updates.bio, 320),
      work: clamp(updates.work, 100),
      location: clamp(updates.location, 80),
      avatar_url: clamp(updates.avatar_url, 450000),
      cover_url: clamp(updates.cover_url, 450000),
      email: updates.email ?? fbUser.email ?? null,
      phone: updates.phone ?? fbUser.phoneNumber ?? null,
      date_of_birth: updates.date_of_birth,
    },
    authMethod,
  );

  // 2. Also update authorName/authorAvatar/authorWork on the user's own Firestore posts so feed stays in sync
  try {
    const myPostsSnap = await getDocs(
      query(collection(db, 'posts'), where('authorUid', '==', fbUser.uid)),
    );
    if (!myPostsSnap.empty) {
      const batch = writeBatch(db);
      myPostsSnap.docs.forEach((d) => {
        batch.update(d.ref, {
          authorName: cleanName,
          authorAvatar: clamp(updates.avatar_url, 450000),
          authorWork: clamp(updates.work, 100),
          updatedAt: serverTimestamp(),
        });
      });
      await batch.commit();
    }
  } catch {
    // Non-fatal; profile itself is already saved in Firestore
  }

  return {
    id: uidToNumericId(fbUser.uid),
    uid: fbUser.uid,
    name: cleanName,
    email: updates.email ?? fbUser.email ?? null,
    phone: updates.phone ?? fbUser.phoneNumber ?? null,
    bio: clamp(updates.bio, 320),
    work: clamp(updates.work, 100),
    location: clamp(updates.location, 80),
    avatar_url: clamp(updates.avatar_url, 450000),
    cover_url: clamp(updates.cover_url, 450000),
    date_of_birth: updates.date_of_birth || '',
    created_at: fbUser.metadata?.creationTime || new Date().toISOString(),
  };
}

/**
 * Subscribe to all verified public user profiles in Firestore (zero mock/demo data).
 */
export function subscribePublicUsers(
  onUpdate: (users: UserProfile[]) => void,
  onError?: (err: unknown) => void,
): Unsubscribe {
  const q = query(collection(db, 'users'), where('visibility', '==', 'public'));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => mapPublicUserDoc(d.id, d.data() as Record<string, unknown>));
      onUpdate(list);
    },
    (error) => {
      if (onError) onError(error);
      try {
        handleFirestoreError(error, OperationType.LIST, 'users');
      } catch {
        // Logged via handleFirestoreError
      }
    },
  );
}

export interface PostReactionEntry {
  userUid: string;
  userId: number;
  userName: string;
  userAvatar: string;
  reactionType: ReactionType;
  updatedAt: string;
}

const VALID_REACTIONS = new Set<ReactionType>([
  'like',
  'love',
  'care',
  'haha',
  'wow',
  'sad',
  'angry',
]);

function normalizeReactionType(value: unknown): ReactionType | null {
  if (typeof value !== 'string') return null;
  return VALID_REACTIONS.has(value as ReactionType) ? (value as ReactionType) : null;
}

const reactorProfileCache = new Map<string, {name: string; avatar: string}>();

async function hydratePostEngagement(
  postDocId: string,
  postNumericId: number,
  currentUid: string,
): Promise<{
  likes_count: number;
  liked_by_me: boolean;
  my_reaction: ReactionType | null;
  reaction_counts: Partial<Record<ReactionType, number>>;
  comments: CommentItem[];
  comments_count: number;
}> {
  const [likesSnap, legacyReactSnap, commSnap] = await Promise.all([
    getDocs(query(collection(db, 'posts', postDocId, 'likes'), where('postId', '==', postDocId))),
    getDocs(
      query(collection(db, 'posts', postDocId, 'reactions'), where('postId', '==', postDocId)),
    ).catch(() => null),
    getDocs(query(collection(db, 'posts', postDocId, 'comments'), where('postId', '==', postDocId))),
  ]);

  const byUser = new Map<string, ReactionType>();
  if (legacyReactSnap) {
    for (const d of legacyReactSnap.docs) {
      const r = normalizeReactionType(d.data()?.reaction);
      if (r) byUser.set(d.id, r);
    }
  }
  for (const d of likesSnap.docs) {
    const r = normalizeReactionType(d.data()?.reactionType ?? d.data()?.reaction);
    if (r) byUser.set(d.id, r);
  }

  const reaction_counts: Partial<Record<ReactionType, number>> = {};
  let my_reaction: ReactionType | null = null;
  for (const [uid, r] of byUser.entries()) {
    reaction_counts[r] = (reaction_counts[r] || 0) + 1;
    if (uid === currentUid) my_reaction = r;
  }

  const comments: CommentItem[] = commSnap.docs
    .map((d) => {
      const data = d.data();
      const authorUid = String(data.authorUid || '');
      const parentCommentId =
        typeof data.parentCommentId === 'string' && data.parentCommentId.trim()
          ? data.parentCommentId.trim()
          : null;
      const replyToName =
        typeof data.replyToName === 'string' && data.replyToName.trim()
          ? data.replyToName.trim()
          : null;
      return {
        id: uidToNumericId(d.id),
        docId: d.id,
        post_id: postNumericId,
        user_id: uidToNumericId(authorUid),
        author_uid: authorUid,
        content: String(data.content || ''),
        parent_comment_id: parentCommentId,
        reply_to_name: replyToName,
        created_at: tsToIso(data.createdAt),
        author_name: String(data.authorName || 'Member'),
        author_avatar: String(data.authorAvatar || ''),
      };
    })
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  return {
    likes_count: byUser.size,
    liked_by_me: my_reaction !== null,
    my_reaction,
    reaction_counts,
    comments,
    comments_count: comments.length,
  };
}

/**
 * Real-time subscription to all permanent posts in Cloud Firestore (with reactions & comments).
 */
export function subscribePostsPermanent(
  currentUid: string,
  onUpdate: (posts: PostItem[]) => void,
  onError?: (err: unknown) => void,
): Unsubscribe {
  const q = query(collection(db, 'posts'), where('visibility', '==', 'public'));
  return onSnapshot(
    q,
    async (snap) => {
      try {
        const hydrated = await Promise.all(
          snap.docs.map(async (d) => {
            const data = d.data();
            const postNumericId = uidToNumericId(d.id);
            const authorUid = String(data.authorUid || '');
            let engagement = {
              likes_count: 0,
              liked_by_me: false,
              my_reaction: null as ReactionType | null,
              reaction_counts: {} as Partial<Record<ReactionType, number>>,
              comments: [] as CommentItem[],
              comments_count: 0,
            };
            try {
              engagement = await hydratePostEngagement(d.id, postNumericId, currentUid);
            } catch {
              // Keep base post visible even if subcollection read fails transiently
            }

            return {
              id: postNumericId,
              docId: d.id,
              user_id: uidToNumericId(authorUid),
              author_uid: authorUid,
              content: String(data.content || ''),
              image_url: typeof data.imageUrl === 'string' && data.imageUrl ? data.imageUrl : null,
              video_url: typeof data.videoUrl === 'string' && data.videoUrl ? data.videoUrl : null,
              comments_disabled: Boolean(data.commentsDisabled),
              edited: Boolean(data.edited),
              page_id: typeof data.pageId === 'string' && data.pageId ? data.pageId : null,
              page_name: typeof data.pageName === 'string' && data.pageName ? data.pageName : null,
              page_avatar: typeof data.pageAvatar === 'string' && data.pageAvatar ? data.pageAvatar : null,
              page_category: typeof data.pageCategory === 'string' && data.pageCategory ? data.pageCategory : null,
              created_at: tsToIso(data.createdAt),
              author_name: String(data.authorName || 'Member'),
              author_avatar: String(data.authorAvatar || ''),
              author_work: typeof data.authorWork === 'string' ? data.authorWork : '',
              ...engagement,
            } satisfies PostItem;
          }),
        );

        hydrated.sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        );
        onUpdate(hydrated);
      } catch (err) {
        if (onError) onError(err);
      }
    },
    (error) => {
      if (onError) onError(error);
      try {
        handleFirestoreError(error, OperationType.LIST, 'posts');
      } catch {
        // Logged via handleFirestoreError
      }
    },
  );
}

/**
 * Create a new post in Cloud Firestore FIRST. Throws real Firestore error if write fails.
 */
export async function createPostPermanent(
  author: UserProfile,
  payload: {
    content: string;
    imageUrl?: string | null;
    videoUrl?: string | null;
    page?: SocialPageDoc | null;
  },
): Promise<PostItem> {
  if (!author.uid) {
    throw new Error('You must be signed in with a verified account to post.');
  }
  const cleanContent = clamp(payload.content, 2000);
  const cleanImage = clamp(payload.imageUrl, 550000);
  const cleanVideo = clamp(payload.videoUrl, 2048);
  if (!cleanContent && !cleanImage && !cleanVideo) {
    throw new Error('Write something or attach a photo/video before posting.');
  }

  const page = payload.page || null;
  const postId = makeDocId('post');
  const postRef = doc(db, 'posts', postId);
  try {
    await setDoc(postRef, {
      id: postId,
      authorUid: author.uid,
      authorName: clamp(author.name, 60) || 'Verve Member',
      authorAvatar: clamp(author.avatar_url, 450000),
      authorWork: clamp(author.work, 100),
      content: cleanContent,
      imageUrl: cleanImage,
      videoUrl: cleanVideo,
      commentsDisabled: false,
      edited: false,
      pageId: page ? clamp(page.pageId, 128) : '',
      pageName: page ? clamp(page.pageName, 80) : '',
      pageAvatar: page ? clamp(page.pagePhoto, 450000) : '',
      pageCategory: page ? clamp(page.category, 40) : '',
      visibility: 'public',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `posts/${postId}`);
  }

  return {
    id: uidToNumericId(postId),
    docId: postId,
    user_id: author.id,
    author_uid: author.uid,
    content: cleanContent,
    image_url: cleanImage || null,
    video_url: cleanVideo || null,
    comments_disabled: false,
    edited: false,
    page_id: page ? page.pageId : null,
    page_name: page ? page.pageName : null,
    page_avatar: page ? page.pagePhoto : null,
    page_category: page ? page.category : null,
    created_at: new Date().toISOString(),
    author_name: author.name,
    author_avatar: author.avatar_url,
    author_work: author.work,
    likes_count: 0,
    liked_by_me: false,
    my_reaction: null,
    reaction_counts: {},
    comments_count: 0,
    comments: [],
  };
}

export async function updatePostPermanent(
  postDocId: string,
  updates: {
    content: string;
    imageUrl?: string | null;
    videoUrl?: string | null;
  },
): Promise<void> {
  const cleanContent = clamp(updates.content, 2000);
  const cleanImage = clamp(updates.imageUrl, 550000);
  const cleanVideo = clamp(updates.videoUrl, 2048);
  if (!cleanContent && !cleanImage && !cleanVideo) {
    throw new Error('Post cannot be empty.');
  }
  try {
    await updateDoc(doc(db, 'posts', postDocId), {
      content: cleanContent,
      imageUrl: cleanImage,
      videoUrl: cleanVideo,
      edited: true,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `posts/${postDocId}`);
  }
}

export async function setPostCommentsDisabledPermanent(
  postDocId: string,
  commentsDisabled: boolean,
): Promise<void> {
  try {
    await updateDoc(doc(db, 'posts', postDocId), {
      commentsDisabled,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `posts/${postDocId}`);
  }
}

export async function deletePostPermanent(
  postDocId: string,
  mediaUrls?: {imageUrl?: string | null; videoUrl?: string | null},
): Promise<void> {
  try {
    await deleteDoc(doc(db, 'posts', postDocId));
    // Clean up Firebase Storage media if stored there
    if (mediaUrls?.imageUrl) {
      await deleteFirebaseStorageUrlIfApplicable(mediaUrls.imageUrl);
    }
    if (mediaUrls?.videoUrl) {
      await deleteFirebaseStorageUrlIfApplicable(mediaUrls.videoUrl);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `posts/${postDocId}`);
  }
}

/**
 * Subscribe to the signed-in user's saved posts in Cloud Firestore (`saved` collection).
 */
export function subscribeSavedPostsPermanent(
  currentUid: string,
  onUpdate: (savedPostIds: Set<string>) => void,
): Unsubscribe {
  const q = query(collection(db, 'saved'), where('userUid', '==', currentUid));
  return onSnapshot(
    q,
    (snap) => {
      const ids = new Set<string>();
      for (const d of snap.docs) {
        const pid = d.data()?.postId;
        if (typeof pid === 'string' && pid) ids.add(pid);
      }
      onUpdate(ids);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'saved');
      } catch {
        // Logged
      }
    },
  );
}

export async function toggleSavePostPermanent(
  currentUid: string,
  postDocId: string,
): Promise<boolean> {
  const savedId = `${currentUid}_${postDocId}`.slice(0, 128);
  const ref = doc(db, 'saved', savedId);
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      await deleteDoc(ref);
      return false;
    }
    await setDoc(ref, {
      id: savedId,
      userUid: currentUid,
      postId: postDocId,
      createdAt: serverTimestamp(),
    });
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `saved/${savedId}`);
  }
}

/**
 * Subscribe to the signed-in user's hidden posts (`hiddenPosts` collection).
 */
export function subscribeHiddenPostsPermanent(
  currentUid: string,
  onUpdate: (hiddenPostIds: Set<string>) => void,
): Unsubscribe {
  const q = query(collection(db, 'hiddenPosts'), where('userUid', '==', currentUid));
  return onSnapshot(
    q,
    (snap) => {
      const ids = new Set<string>();
      for (const d of snap.docs) {
        const pid = d.data()?.postId;
        if (typeof pid === 'string' && pid) ids.add(pid);
      }
      onUpdate(ids);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'hiddenPosts');
      } catch {
        // Logged
      }
    },
  );
}

export async function hidePostPermanent(currentUid: string, postDocId: string): Promise<void> {
  const hiddenId = `${currentUid}_${postDocId}`.slice(0, 128);
  const ref = doc(db, 'hiddenPosts', hiddenId);
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) return;
    await setDoc(ref, {
      id: hiddenId,
      userUid: currentUid,
      postId: postDocId,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `hiddenPosts/${hiddenId}`);
  }
}

export async function unhidePostPermanent(currentUid: string, postDocId: string): Promise<void> {
  const hiddenId = `${currentUid}_${postDocId}`.slice(0, 128);
  try {
    await deleteDoc(doc(db, 'hiddenPosts', hiddenId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `hiddenPosts/${hiddenId}`);
  }
}

export async function reportPostPermanent(params: {
  reporterUid: string;
  postDocId: string;
  targetAuthorUid: string;
  reason: PostReportReason;
  details?: string;
}): Promise<void> {
  const reportId = makeDocId('rpt');
  try {
    await setDoc(doc(db, 'reports', reportId), {
      id: reportId,
      reporterUid: params.reporterUid,
      postId: params.postDocId,
      targetAuthorUid: params.targetAuthorUid,
      reason: params.reason,
      details: clamp(params.details, 500),
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `reports/${reportId}`);
  }
}

/**
 * Real-time onSnapshot subscription to a post's reactions (posts/{postId}/likes + legacy reactions).
 * Powers instant Like/Wow count updates and the Facebook-style "People who reacted" popup.
 */
export function subscribePostReactionsPermanent(
  postDocId: string,
  currentUid: string,
  onUpdate: (data: {
    items: PostReactionEntry[];
    likes_count: number;
    liked_by_me: boolean;
    my_reaction: ReactionType | null;
    reaction_counts: Partial<Record<ReactionType, number>>;
  }) => void,
  onError?: (err: unknown) => void,
): Unsubscribe {
  let latestLikes = new Map<string, PostReactionEntry>();
  let latestLegacy = new Map<string, PostReactionEntry>();
  let disposed = false;

  async function emitMerged() {
    if (disposed) return;
    const merged = new Map<string, PostReactionEntry>();
    for (const [uid, entry] of latestLegacy.entries()) {
      merged.set(uid, entry);
    }
    for (const [uid, entry] of latestLikes.entries()) {
      merged.set(uid, entry);
    }

    // Hydrate any legacy reaction entries that didn't store userName/userAvatar directly
    const missingUids = Array.from(merged.values())
      .filter((e) => !e.userName || e.userName === 'Member')
      .map((e) => e.userUid)
      .filter((uid) => !reactorProfileCache.has(uid));

    if (missingUids.length > 0) {
      await Promise.all(
        missingUids.slice(0, 30).map(async (uid) => {
          try {
            const snap = await getDoc(doc(db, 'users', uid));
            if (snap.exists()) {
              const d = snap.data();
              reactorProfileCache.set(uid, {
                name: String(d.name || 'Member'),
                avatar: typeof d.avatarUrl === 'string' ? d.avatarUrl : '',
              });
            }
          } catch {
            // Keep default label
          }
        }),
      );
    }

    if (disposed) return;

    const reaction_counts: Partial<Record<ReactionType, number>> = {};
    let my_reaction: ReactionType | null = null;
    const items: PostReactionEntry[] = [];

    for (const entry of merged.values()) {
      const cached = reactorProfileCache.get(entry.userUid);
      const resolved: PostReactionEntry = {
        ...entry,
        userName:
          entry.userName && entry.userName !== 'Member'
            ? entry.userName
            : cached?.name || entry.userName || 'Member',
        userAvatar: entry.userAvatar || cached?.avatar || '',
      };
      items.push(resolved);
      reaction_counts[resolved.reactionType] = (reaction_counts[resolved.reactionType] || 0) + 1;
      if (resolved.userUid === currentUid) {
        my_reaction = resolved.reactionType;
      }
    }

    items.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    onUpdate({
      items,
      likes_count: items.length,
      liked_by_me: my_reaction !== null,
      my_reaction,
      reaction_counts,
    });
  }

  const likesQ = query(collection(db, 'posts', postDocId, 'likes'), where('postId', '==', postDocId));
  const legacyQ = query(
    collection(db, 'posts', postDocId, 'reactions'),
    where('postId', '==', postDocId),
  );

  const unsubLikes = onSnapshot(
    likesQ,
    (snap) => {
      const next = new Map<string, PostReactionEntry>();
      for (const d of snap.docs) {
        const data = d.data();
        const r = normalizeReactionType(data.reactionType ?? data.reaction);
        if (!r) continue;
        const uid = String(data.userUid || d.id);
        const userName = String(data.userName || 'Member');
        const userAvatar = typeof data.userAvatar === 'string' ? data.userAvatar : '';
        if (userName && userName !== 'Member') {
          reactorProfileCache.set(uid, {name: userName, avatar: userAvatar});
        }
        next.set(uid, {
          userUid: uid,
          userId: uidToNumericId(uid),
          userName,
          userAvatar,
          reactionType: r,
          updatedAt: tsToIso(data.updatedAt || data.createdAt),
        });
      }
      latestLikes = next;
      void emitMerged();
    },
    (error) => {
      if (onError) onError(error);
    },
  );

  const unsubLegacy = onSnapshot(
    legacyQ,
    (snap) => {
      const next = new Map<string, PostReactionEntry>();
      for (const d of snap.docs) {
        const data = d.data();
        const r = normalizeReactionType(data.reaction);
        if (!r) continue;
        const uid = String(data.userUid || d.id);
        next.set(uid, {
          userUid: uid,
          userId: uidToNumericId(uid),
          userName: 'Member',
          userAvatar: '',
          reactionType: r,
          updatedAt: tsToIso(data.updatedAt || data.createdAt),
        });
      }
      latestLegacy = next;
      void emitMerged();
    },
    () => {
      // Legacy subcollection optional
    },
  );

  return () => {
    disposed = true;
    unsubLikes();
    unsubLegacy();
  };
}

export async function toggleReactionPermanent(
  postDocId: string,
  actor: UserProfile,
  postAuthorUid: string | undefined,
  reaction: ReactionType = 'like',
): Promise<{
  liked: boolean;
  my_reaction: ReactionType | null;
  likes_count: number;
  reaction_counts: Partial<Record<ReactionType, number>>;
}> {
  if (!actor.uid) throw new Error('Not authenticated.');
  const likePath = `posts/${postDocId}/likes/${actor.uid}`;
  const likeRef = doc(db, 'posts', postDocId, 'likes', actor.uid);
  const legacyRef = doc(db, 'posts', postDocId, 'reactions', actor.uid);
  const safeName = clamp(actor.name, 60) || 'Member';
  const safeAvatar = clamp(actor.avatar_url, 450000);

  try {
    const [existingLike, existingLegacy] = await Promise.all([
      getDoc(likeRef),
      getDoc(legacyRef).catch(() => null),
    ]);

    const currentType = existingLike.exists()
      ? normalizeReactionType(existingLike.data()?.reactionType ?? existingLike.data()?.reaction)
      : existingLegacy?.exists()
        ? normalizeReactionType(existingLegacy.data()?.reaction)
        : null;

    if (currentType === reaction) {
      // Toggle off: remove reaction cleanly from likes (and legacy reactions if present)
      if (existingLike.exists()) await deleteDoc(likeRef);
      if (existingLegacy?.exists()) await deleteDoc(legacyRef).catch(() => {});
    } else if (existingLike.exists()) {
      // Switch reaction type in place (e.g. Like -> Wow)
      await updateDoc(likeRef, {
        reactionType: reaction,
        userName: safeName,
        userAvatar: safeAvatar,
        updatedAt: serverTimestamp(),
      });
      if (existingLegacy?.exists()) await deleteDoc(legacyRef).catch(() => {});
    } else {
      // Create new reaction at posts/{postId}/likes/{userId}
      await setDoc(likeRef, {
        postId: postDocId,
        userUid: actor.uid,
        userName: safeName,
        userAvatar: safeAvatar,
        reactionType: reaction,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      if (existingLegacy?.exists()) await deleteDoc(legacyRef).catch(() => {});
      if (!existingLegacy?.exists() && postAuthorUid && postAuthorUid !== actor.uid) {
        createNotificationPermanent({
          recipientUid: postAuthorUid,
          actor,
          type: 'like',
          message: `${actor.name} reacted (${reaction}) to your post.`,
        }).catch(() => {});
      }
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, likePath);
  }

  const [likesSnap, legacySnap] = await Promise.all([
    getDocs(query(collection(db, 'posts', postDocId, 'likes'), where('postId', '==', postDocId))),
    getDocs(
      query(collection(db, 'posts', postDocId, 'reactions'), where('postId', '==', postDocId)),
    ).catch(() => null),
  ]);

  const byUser = new Map<string, ReactionType>();
  if (legacySnap) {
    for (const d of legacySnap.docs) {
      const r = normalizeReactionType(d.data()?.reaction);
      if (r) byUser.set(d.id, r);
    }
  }
  for (const d of likesSnap.docs) {
    const r = normalizeReactionType(d.data()?.reactionType ?? d.data()?.reaction);
    if (r) byUser.set(d.id, r);
  }

  const reaction_counts: Partial<Record<ReactionType, number>> = {};
  let my_reaction: ReactionType | null = null;
  for (const [uid, r] of byUser.entries()) {
    reaction_counts[r] = (reaction_counts[r] || 0) + 1;
    if (uid === actor.uid) my_reaction = r;
  }

  return {
    liked: my_reaction !== null,
    my_reaction,
    likes_count: byUser.size,
    reaction_counts,
  };
}

export async function addCommentPermanent(
  postDocId: string,
  postNumericId: number,
  actor: UserProfile,
  postAuthorUid: string | undefined,
  content: string,
  replyTarget?: {
    parentCommentId: string;
    replyToName: string;
    replyToAuthorUid?: string;
  },
): Promise<CommentItem> {
  if (!actor.uid) throw new Error('Not authenticated.');
  const clean = clamp(content, 1000);
  if (!clean) throw new Error('Comment cannot be empty.');
  const parentCommentId = replyTarget?.parentCommentId
    ? clamp(replyTarget.parentCommentId, 128)
    : '';
  const replyToName = parentCommentId ? clamp(replyTarget?.replyToName, 60) : '';
  const commentId = makeDocId('cmt');
  const commentPath = `posts/${postDocId}/comments/${commentId}`;
  try {
    await setDoc(doc(db, 'posts', postDocId, 'comments', commentId), {
      id: commentId,
      postId: postDocId,
      authorUid: actor.uid,
      authorName: clamp(actor.name, 60) || 'Member',
      authorAvatar: clamp(actor.avatar_url, 450000),
      content: clean,
      parentCommentId,
      replyToName,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, commentPath);
  }

  // Notify the comment author being replied to
  if (parentCommentId && replyTarget?.replyToAuthorUid && replyTarget.replyToAuthorUid !== actor.uid) {
    createNotificationPermanent({
      recipientUid: replyTarget.replyToAuthorUid,
      actor,
      type: 'comment',
      message: `${actor.name} replied to your comment: "${clean.slice(0, 60)}"`,
    }).catch(() => {});
  }

  // Also notify the post author if they aren't the actor (and weren't already notified as reply target)
  if (
    postAuthorUid &&
    postAuthorUid !== actor.uid &&
    postAuthorUid !== replyTarget?.replyToAuthorUid
  ) {
    createNotificationPermanent({
      recipientUid: postAuthorUid,
      actor,
      type: 'comment',
      message: parentCommentId
        ? `${actor.name} replied to a comment on your post: "${clean.slice(0, 60)}"`
        : `${actor.name} commented on your post: "${clean.slice(0, 60)}"`,
    }).catch(() => {});
  }

  return {
    id: uidToNumericId(commentId),
    docId: commentId,
    post_id: postNumericId,
    user_id: actor.id,
    author_uid: actor.uid,
    content: clean,
    parent_comment_id: parentCommentId || null,
    reply_to_name: replyToName || null,
    created_at: new Date().toISOString(),
    author_name: actor.name,
    author_avatar: actor.avatar_url,
  };
}

export async function deleteCommentPermanent(
  postDocId: string,
  commentDocId: string,
): Promise<void> {
  try {
    await deleteDoc(doc(db, 'posts', postDocId, 'comments', commentDocId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `posts/${postDocId}/comments/${commentDocId}`);
  }
}

/**
 * Subscribe to permanent friendships & follows in Cloud Firestore.
 */
export function subscribeNetworkPermanent(
  currentUid: string,
  allUsers: UserProfile[],
  onUpdate: (network: NetworkData) => void,
  onError?: (err: unknown) => void,
): Unsubscribe {
  let latestFriendDocs: Array<{id: string; data: Record<string, unknown>}> = [];
  let latestFollowDocs: Array<{id: string; data: Record<string, unknown>}> = [];

  const recompute = () => {
    const userByUid = new Map<string, UserProfile>();
    for (const u of allUsers) {
      if (u.uid) userByUid.set(u.uid, u);
    }

    const friends: UserProfile[] = [];
    const incomingRequests: (UserProfile & {request_id: number; requested_at: string})[] = [];
    const outgoingRequests: (UserProfile & {request_id: number; requested_at: string})[] = [];
    const connectedUids = new Set<string>([currentUid]);

    for (const f of latestFriendDocs) {
      const reqUid = String(f.data.requesterUid || '');
      const addrUid = String(f.data.addresseeUid || '');
      const status = String(f.data.status || '');
      const peerUid = reqUid === currentUid ? addrUid : reqUid;
      const peer = userByUid.get(peerUid);
      if (!peer) continue;

      if (status === 'accepted') {
        connectedUids.add(peerUid);
        friends.push({...peer, friendship_status: 'friends'});
      } else if (status === 'pending') {
        connectedUids.add(peerUid);
        const requestedAt = tsToIso(f.data.createdAt);
        if (addrUid === currentUid) {
          incomingRequests.push({
            ...peer,
            friendship_status: 'incoming_pending',
            request_id: uidToNumericId(f.id),
            requested_at: requestedAt,
          });
        } else if (reqUid === currentUid) {
          outgoingRequests.push({
            ...peer,
            friendship_status: 'outgoing_pending',
            request_id: uidToNumericId(f.id),
            requested_at: requestedAt,
          });
        }
      }
    }

    const followingIds: number[] = [];
    for (const fl of latestFollowDocs) {
      if (fl.data.followerUid === currentUid && typeof fl.data.followingUid === 'string') {
        followingIds.push(uidToNumericId(fl.data.followingUid));
      }
    }

    const suggestions = allUsers.filter((u) => u.uid && !connectedUids.has(u.uid));

    onUpdate({
      friends,
      incomingRequests,
      outgoingRequests,
      suggestions,
      followingIds,
    });
  };

  const unsubFriends = onSnapshot(
    query(collection(db, 'friendships'), where('participantUids', 'array-contains', currentUid)),
    (snap) => {
      latestFriendDocs = snap.docs.map((d) => ({id: d.id, data: d.data() as Record<string, unknown>}));
      recompute();
    },
    (error) => {
      if (onError) onError(error);
      try {
        handleFirestoreError(error, OperationType.LIST, 'friendships');
      } catch {
        // Logged
      }
    },
  );

  const unsubFollows = onSnapshot(
    query(collection(db, 'follows'), where('followerUid', '==', currentUid)),
    (snap) => {
      latestFollowDocs = snap.docs.map((d) => ({id: d.id, data: d.data() as Record<string, unknown>}));
      recompute();
    },
    (error) => {
      if (onError) onError(error);
      try {
        handleFirestoreError(error, OperationType.LIST, 'follows');
      } catch {
        // Logged
      }
    },
  );

  recompute();

  return () => {
    unsubFriends();
    unsubFollows();
  };
}

export async function sendFriendRequestPermanent(
  myUser: UserProfile,
  targetUser: UserProfile,
): Promise<void> {
  if (!myUser.uid || !targetUser.uid) throw new Error('Invalid user account.');
  const fid = canonicalPairId(myUser.uid, targetUser.uid);
  const ref = doc(db, 'friendships', fid);
  try {
    const existing = await getDoc(ref);
    if (existing.exists()) {
      if (existing.data()?.status === 'declined') {
        await deleteDoc(ref);
      } else {
        return;
      }
    }
    const pair = [myUser.uid, targetUser.uid].sort();
    await setDoc(ref, {
      id: fid,
      requesterUid: myUser.uid,
      addresseeUid: targetUser.uid,
      participantUids: pair,
      status: 'pending',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `friendships/${fid}`);
  }

  createNotificationPermanent({
    recipientUid: targetUser.uid,
    actor: myUser,
    type: 'friend_request',
    message: `${myUser.name} sent you a friend request.`,
  }).catch(() => {});
}

export async function respondFriendRequestPermanent(
  myUser: UserProfile,
  requesterUser: UserProfile,
  action: 'accept' | 'decline',
): Promise<void> {
  if (!myUser.uid || !requesterUser.uid) throw new Error('Invalid user account.');
  const fid = canonicalPairId(myUser.uid, requesterUser.uid);
  const ref = doc(db, 'friendships', fid);
  try {
    await updateDoc(ref, {
      status: action === 'accept' ? 'accepted' : 'declined',
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `friendships/${fid}`);
  }

  if (action === 'accept') {
    createNotificationPermanent({
      recipientUid: requesterUser.uid,
      actor: myUser,
      type: 'friend_accepted',
      message: `${myUser.name} accepted your friend request.`,
    }).catch(() => {});
  }
}

export async function removeFriendshipPermanent(myUid: string, targetUid: string): Promise<void> {
  const fid = canonicalPairId(myUid, targetUid);
  try {
    await deleteDoc(doc(db, 'friendships', fid));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `friendships/${fid}`);
  }
}

export async function toggleFollowPermanent(
  myUser: UserProfile,
  targetUser: UserProfile,
): Promise<boolean> {
  if (!myUser.uid || !targetUser.uid) throw new Error('Invalid user account.');
  const fid = `${myUser.uid}_${targetUser.uid}`;
  const ref = doc(db, 'follows', fid);
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      await deleteDoc(ref);
      return false;
    }
    await setDoc(ref, {
      id: fid,
      followerUid: myUser.uid,
      followingUid: targetUser.uid,
      createdAt: serverTimestamp(),
    });
    createNotificationPermanent({
      recipientUid: targetUser.uid,
      actor: myUser,
      type: 'follow',
      message: `${myUser.name} started following you.`,
    }).catch(() => {});
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `follows/${fid}`);
  }
}

function formatMessagePreview(msg: ChatMessage): string {
  if (msg.content && msg.content.trim()) return msg.content;
  switch (msg.message_type) {
    case 'image':
      return 'Photo';
    case 'video':
      return 'Video';
    case 'voice':
      return 'Voice message';
    case 'document':
      return msg.media_name ? `Document: ${msg.media_name}` : 'Document';
    case 'location':
      return msg.location_label ? `Location: ${msg.location_label}` : 'Shared location';
    default:
      return msg.content || '';
  }
}

/**
 * Subscribe to real-time messages (text, media, voice, document, location & call logs) in Cloud Firestore.
 */
export function subscribeMessagesPermanent(
  currentUid: string,
  allUsers: UserProfile[],
  onUpdate: (data: {
    messagesByPeer: Record<number, ChatMessage[]>;
    conversations: ConversationSummary[];
  }) => void,
): Unsubscribe {
  const q = query(collection(db, 'messages'), where('participantUids', 'array-contains', currentUid));
  return onSnapshot(
    q,
    (snap) => {
      const userByUid = new Map<string, UserProfile>();
      for (const u of allUsers) {
        if (u.uid && u.uid !== currentUid) userByUid.set(u.uid, u);
      }

      const byPeer: Record<number, ChatMessage[]> = {};
      const unreadByPeer = new Map<number, number>();
      const lastByPeer = new Map<number, ChatMessage>();

      const allowedTypes = new Set<ChatMessageType>([
        'text',
        'call',
        'image',
        'video',
        'voice',
        'document',
        'location',
      ]);

      const allMsgs: ChatMessage[] = snap.docs
        .map((d) => {
          const data = d.data();
          const senderUid = String(data.senderUid || '');
          const receiverUid = String(data.receiverUid || '');
          const rawType = String(data.messageType || 'text') as ChatMessageType;
          const messageType: ChatMessageType = allowedTypes.has(rawType) ? rawType : 'text';
          return {
            id: uidToNumericId(d.id),
            docId: d.id,
            sender_id: uidToNumericId(senderUid),
            receiver_id: uidToNumericId(receiverUid),
            sender_uid: senderUid,
            receiver_uid: receiverUid,
            content: String(data.content || ''),
            message_type: messageType,
            media_url: typeof data.mediaUrl === 'string' ? data.mediaUrl : '',
            media_name: typeof data.mediaName === 'string' ? data.mediaName : '',
            media_size: typeof data.mediaSize === 'number' ? data.mediaSize : 0,
            voice_duration_sec: typeof data.voiceDurationSec === 'number' ? data.voiceDurationSec : 0,
            location_lat: typeof data.locationLat === 'number' ? data.locationLat : 0,
            location_lng: typeof data.locationLng === 'number' ? data.locationLng : 0,
            location_label: typeof data.locationLabel === 'string' ? data.locationLabel : '',
            call_type: (data.callType || '') as '' | 'audio' | 'video',
            call_status: (data.callStatus || '') as '' | 'completed' | 'missed' | 'declined',
            call_duration_sec: typeof data.callDurationSec === 'number' ? data.callDurationSec : 0,
            read: Boolean(data.read),
            created_at: tsToIso(data.createdAt),
          };
        })
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

      for (const msg of allMsgs) {
        const peerUid = msg.sender_uid === currentUid ? msg.receiver_uid! : msg.sender_uid!;
        const peerNumId = uidToNumericId(peerUid);
        if (!byPeer[peerNumId]) byPeer[peerNumId] = [];
        byPeer[peerNumId].push(msg);
        lastByPeer.set(peerNumId, msg);
        if (msg.receiver_uid === currentUid && !msg.read) {
          unreadByPeer.set(peerNumId, (unreadByPeer.get(peerNumId) || 0) + 1);
        }
      }

      const conversations: ConversationSummary[] = Array.from(userByUid.values())
        .map((u) => {
          const last = lastByPeer.get(u.id);
          return {
            user: u,
            last_message: last ? formatMessagePreview(last) : null,
            last_message_at: last?.created_at || null,
            last_sender_id: last?.sender_id || null,
            unread_count: unreadByPeer.get(u.id) || 0,
          };
        })
        .sort((a, b) => {
          const ta = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
          const tb = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
          return tb - ta;
        });

      onUpdate({messagesByPeer: byPeer, conversations});
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'messages');
      } catch {
        // Logged
      }
    },
  );
}

export interface RichMessageAttachment {
  messageType: ChatMessageType;
  mediaUrl?: string;
  mediaName?: string;
  mediaSize?: number;
  voiceDurationSec?: number;
  locationLat?: number;
  locationLng?: number;
  locationLabel?: string;
}

export async function sendMessagePermanent(
  senderUid: string,
  receiverUid: string,
  content: string,
  callMeta?: {
    callType: 'audio' | 'video';
    callStatus: 'completed' | 'missed' | 'declined';
    callDurationSec: number;
  },
  attachment?: RichMessageAttachment,
): Promise<ChatMessage> {
  const clean = clamp(content, 2000);
  const msgType: ChatMessageType = callMeta
    ? 'call'
    : attachment?.messageType || 'text';
  const mediaUrl = clamp(attachment?.mediaUrl, 650000);
  const mediaName = clamp(attachment?.mediaName, 180);
  const mediaSize = Math.max(0, Math.min(104857600, Math.round(attachment?.mediaSize || 0)));
  const voiceDurationSec = Math.max(0, Math.min(3600, Math.round(attachment?.voiceDurationSec || 0)));
  const locationLat = typeof attachment?.locationLat === 'number' ? attachment.locationLat : 0;
  const locationLng = typeof attachment?.locationLng === 'number' ? attachment.locationLng : 0;
  const locationLabel = clamp(attachment?.locationLabel, 200);

  if (!clean && !mediaUrl && msgType !== 'location') {
    throw new Error('Message cannot be empty.');
  }

  const msgId = makeDocId('msg');
  const pair = [senderUid, receiverUid].sort();
  try {
    await setDoc(doc(db, 'messages', msgId), {
      id: msgId,
      senderUid,
      receiverUid,
      participantUids: pair,
      content: clean,
      messageType: msgType,
      mediaUrl,
      mediaName,
      mediaSize,
      voiceDurationSec,
      locationLat,
      locationLng,
      locationLabel,
      callType: callMeta ? callMeta.callType : '',
      callStatus: callMeta ? callMeta.callStatus : '',
      callDurationSec: callMeta ? Math.max(0, Math.round(callMeta.callDurationSec)) : 0,
      read: false,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `messages/${msgId}`);
  }

  return {
    id: uidToNumericId(msgId),
    docId: msgId,
    sender_id: uidToNumericId(senderUid),
    receiver_id: uidToNumericId(receiverUid),
    sender_uid: senderUid,
    receiver_uid: receiverUid,
    content: clean,
    message_type: msgType,
    media_url: mediaUrl,
    media_name: mediaName,
    media_size: mediaSize,
    voice_duration_sec: voiceDurationSec,
    location_lat: locationLat,
    location_lng: locationLng,
    location_label: locationLabel,
    call_type: callMeta?.callType || '',
    call_status: callMeta?.callStatus || '',
    call_duration_sec: callMeta?.callDurationSec || 0,
    read: false,
    created_at: new Date().toISOString(),
  };
}

export async function deleteMessagePermanent(
  messageDocId: string,
  mediaUrl?: string | null,
): Promise<void> {
  if (!messageDocId) return;
  try {
    await deleteDoc(doc(db, 'messages', messageDocId));
    if (mediaUrl) {
      await deleteFirebaseStorageUrlIfApplicable(mediaUrl);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `messages/${messageDocId}`);
  }
}

/**
 * Real-time Online Presence (`presence/{uid}`)
 */
export async function updatePresencePermanent(uid: string, online: boolean): Promise<void> {
  if (!uid) return;
  const ref = doc(db, 'presence', uid);
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      await updateDoc(ref, {
        online,
        lastSeen: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(ref, {
        uid,
        online,
        visibility: 'public',
        lastSeen: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch {
    // Presence heartbeat is best-effort
  }
}

export function subscribePresencePermanent(
  onUpdate: (presenceByUid: Record<string, PresenceRecord>) => void,
): Unsubscribe {
  const q = query(collection(db, 'presence'), where('visibility', '==', 'public'));
  return onSnapshot(
    q,
    (snap) => {
      const map: Record<string, PresenceRecord> = {};
      for (const d of snap.docs) {
        const data = d.data();
        map[d.id] = {
          uid: d.id,
          online: Boolean(data.online),
          lastSeen: tsToIso(data.lastSeen),
        };
      }
      onUpdate(map);
    },
    () => {
      // Non-fatal
    },
  );
}

/**
 * Real-time 1-on-1 Typing Indicators (`typingStates/{pairId}_{userUid}`)
 */
export async function setTypingStatePermanent(
  myUid: string,
  targetUid: string,
  isTyping: boolean,
): Promise<void> {
  if (!myUid || !targetUid || myUid === targetUid) return;
  const pairId = canonicalPairId(myUid, targetUid);
  const stateId = `${pairId}_${myUid}`.slice(0, 128);
  const ref = doc(db, 'typingStates', stateId);
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      await updateDoc(ref, {
        isTyping,
        updatedAt: serverTimestamp(),
      });
    } else {
      const pair = [myUid, targetUid].sort();
      await setDoc(ref, {
        id: stateId,
        pairId,
        userUid: myUid,
        targetUid,
        participantUids: pair,
        isTyping,
        updatedAt: serverTimestamp(),
      });
    }
  } catch {
    // Non-fatal
  }
}

export function subscribeTypingStatesPermanent(
  myUid: string,
  onUpdate: (typingByPeerUid: Record<string, boolean>) => void,
): Unsubscribe {
  const q = query(collection(db, 'typingStates'), where('participantUids', 'array-contains', myUid));
  return onSnapshot(
    q,
    (snap) => {
      const now = Date.now();
      const map: Record<string, boolean> = {};
      for (const d of snap.docs) {
        const data = d.data();
        if (data.targetUid === myUid && data.userUid && data.isTyping) {
          const updatedMs = new Date(tsToIso(data.updatedAt)).getTime();
          if (now - updatedMs < 15000) {
            map[String(data.userUid)] = true;
          }
        }
      }
      onUpdate(map);
    },
    () => {
      // Non-fatal
    },
  );
}

export async function markMessagesReadPermanent(messageDocIds: string[]): Promise<void> {
  if (messageDocIds.length === 0) return;
  try {
    const batch = writeBatch(db);
    messageDocIds.forEach((docId) => {
      batch.update(doc(db, 'messages', docId), {read: true});
    });
    await batch.commit();
  } catch {
    // Non-fatal
  }
}

export async function createNotificationPermanent(params: {
  recipientUid: string;
  actor: UserProfile;
  type: 'like' | 'comment' | 'friend_request' | 'friend_accepted' | 'follow' | 'message' | 'call';
  message: string;
}): Promise<void> {
  if (!params.actor.uid || params.recipientUid === params.actor.uid) return;
  const notifId = makeDocId('ntf');
  try {
    await setDoc(doc(db, 'notifications', notifId), {
      id: notifId,
      recipientUid: params.recipientUid,
      actorUid: params.actor.uid,
      actorName: clamp(params.actor.name, 60),
      actorAvatar: clamp(params.actor.avatar_url, 450000),
      type: params.type,
      message: clamp(params.message, 240),
      read: false,
      createdAt: serverTimestamp(),
    });
  } catch {
    // Notifications are best-effort side-effects
  }
}

export function subscribeNotificationsPermanent(
  currentUid: string,
  onUpdate: (notifications: NotificationItem[]) => void,
): Unsubscribe {
  const q = query(collection(db, 'notifications'), where('recipientUid', '==', currentUid));
  return onSnapshot(
    q,
    (snap) => {
      const list: NotificationItem[] = snap.docs
        .map((d) => {
          const data = d.data();
          const actorUid = typeof data.actorUid === 'string' ? data.actorUid : null;
          return {
            id: uidToNumericId(d.id),
            docId: d.id,
            user_id: uidToNumericId(currentUid),
            actor_id: actorUid ? uidToNumericId(actorUid) : null,
            actor_uid: actorUid,
            actor_name: typeof data.actorName === 'string' ? data.actorName : null,
            actor_avatar: typeof data.actorAvatar === 'string' ? data.actorAvatar : null,
            type: (data.type || 'welcome') as NotificationItem['type'],
            entity_id: null,
            message: String(data.message || ''),
            read: Boolean(data.read),
            created_at: tsToIso(data.createdAt),
          };
        })
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      onUpdate(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'notifications');
      } catch {
        // Logged
      }
    },
  );
}

export async function markNotificationReadPermanent(docId: string): Promise<void> {
  try {
    await updateDoc(doc(db, 'notifications', docId), {read: true});
  } catch {
    // Non-fatal
  }
}

export async function markAllNotificationsReadPermanent(docIds: string[]): Promise<void> {
  if (docIds.length === 0) return;
  try {
    const batch = writeBatch(db);
    docIds.forEach((docId) => {
      batch.update(doc(db, 'notifications', docId), {read: true});
    });
    await batch.commit();
  } catch {
    // Non-fatal
  }
}
