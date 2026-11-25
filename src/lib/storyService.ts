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
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import type {
  StoryItem,
  StoryMediaType,
  StoryReactionItem,
  StoryReactionType,
  StoryViewerItem,
  UserProfile,
} from '../types';
import {db, handleFirestoreError, OperationType} from './firebase';
import {createNotificationPermanent, sendMessagePermanent} from './firestoreStore';
import {deleteFirebaseStorageUrlIfApplicable} from './mediaUpload';

export const STORY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface StoryReactionMeta {
  type: StoryReactionType;
  label: string;
  emoji: string;
  accentBg: string;
}

export const STORY_REACTIONS: StoryReactionMeta[] = [
  {type: 'like', label: 'Like', emoji: '👍', accentBg: 'bg-[#1877F2]/15 text-[#1877F2]'},
  {type: 'love', label: 'Love', emoji: '❤️', accentBg: 'bg-[#F33E58]/15 text-[#F33E58]'},
  {type: 'haha', label: 'Haha', emoji: '😆', accentBg: 'bg-[#F7B125]/15 text-[#D97706]'},
  {type: 'wow', label: 'Wow', emoji: '😮', accentBg: 'bg-[#F7B125]/15 text-[#D97706]'},
  {type: 'sad', label: 'Sad', emoji: '😢', accentBg: 'bg-[#3B82F6]/15 text-[#2563EB]'},
  {type: 'angry', label: 'Angry', emoji: '😡', accentBg: 'bg-[#E9710F]/15 text-[#DC2626]'},
];

export const STORY_REACTION_MAP: Record<StoryReactionType, StoryReactionMeta> =
  STORY_REACTIONS.reduce(
    (acc, item) => {
      acc[item.type] = item;
      return acc;
    },
    {} as Record<StoryReactionType, StoryReactionMeta>,
  );

export interface StoryGradientPreset {
  id: string;
  label: string;
  className: string;
}

export const STORY_GRADIENTS: StoryGradientPreset[] = [
  {
    id: 'ocean-blue',
    label: 'Facebook Blue',
    className: 'bg-gradient-to-br from-[#1877F2] via-[#2563EB] to-[#0EA5E9]',
  },
  {
    id: 'sunset-coral',
    label: 'Sunset',
    className: 'bg-gradient-to-br from-[#F43F5E] via-[#EC4899] to-[#F59E0B]',
  },
  {
    id: 'emerald-teal',
    label: 'Emerald',
    className: 'bg-gradient-to-br from-[#059669] via-[#10B981] to-[#0D9488]',
  },
  {
    id: 'royal-violet',
    label: 'Violet',
    className: 'bg-gradient-to-br from-[#7C3AED] via-[#6366F1] to-[#3B82F6]',
  },
  {
    id: 'midnight-ink',
    label: 'Midnight',
    className: 'bg-gradient-to-br from-[#0F172A] via-[#1E293B] to-[#334155]',
  },
  {
    id: 'warm-amber',
    label: 'Amber',
    className: 'bg-gradient-to-br from-[#EA580C] via-[#F97316] to-[#EAB308]',
  },
];

export function getStoryGradientClass(gradientId?: string | null): string {
  const found = STORY_GRADIENTS.find((g) => g.id === gradientId);
  return found ? found.className : STORY_GRADIENTS[0].className;
}

function makeStoryId(): string {
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 14)
      : `${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
  return `story_${Date.now().toString(36)}_${rand}`;
}

function clamp(value: string | null | undefined, max: number): string {
  return String(value ?? '').trim().slice(0, max);
}

function tsToMs(val: unknown): number {
  if (!val) return Date.now();
  if (val instanceof Timestamp) return val.toMillis();
  if (typeof val === 'object' && val !== null && 'toMillis' in val && typeof (val as {toMillis: () => number}).toMillis === 'function') {
    return (val as {toMillis: () => number}).toMillis();
  }
  if (typeof val === 'string') {
    const parsed = Date.parse(val);
    return Number.isFinite(parsed) ? parsed : Date.now();
  }
  return Date.now();
}

export function formatStoryTimeAgo(isoOrMs: string | number): string {
  const ms = typeof isoOrMs === 'number' ? isoOrMs : Date.parse(isoOrMs);
  if (!Number.isFinite(ms)) return 'Just now';
  const diffSec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (diffSec < 60) return 'Just now';
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// Local seen-story cache (synced with Firestore stories/{storyId}/viewers/{uid})
const seenStorageKey = (uid: string) => `verve_seen_stories_v1_${uid}`;

export function getLocalSeenStoryIds(uid: string): Set<string> {
  if (!uid || typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(seenStorageKey(uid));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return new Set(parsed.filter((item): item is string => typeof item === 'string'));
    }
  } catch {
    // Ignore storage read issues
  }
  return new Set();
}

export function markStorySeenLocal(uid: string, storyId: string): void {
  if (!uid || !storyId || typeof window === 'undefined') return;
  try {
    const existing = getLocalSeenStoryIds(uid);
    existing.add(storyId);
    // Keep cache bounded to recent 300 story IDs
    const trimmed = Array.from(existing).slice(-300);
    window.localStorage.setItem(seenStorageKey(uid), JSON.stringify(trimmed));
  } catch {
    // Ignore storage write issues
  }
}

/**
 * Check Firestore `stories/{storyId}/viewers/{viewerUid}` for any active stories not yet marked
 * in localStorage so the Blue Ring accurately reflects viewed status across devices.
 */
export async function syncSeenStoryIdsFromFirestore(
  storyIds: string[],
  viewerUid: string,
): Promise<string[]> {
  if (!viewerUid || storyIds.length === 0) return [];
  const found: string[] = [];
  await Promise.all(
    storyIds.map(async (storyId) => {
      try {
        const snap = await getDoc(doc(db, 'stories', storyId, 'viewers', viewerUid));
        if (snap.exists()) {
          found.push(storyId);
          markStorySeenLocal(viewerUid, storyId);
        }
      } catch {
        // Non-fatal check
      }
    }),
  );
  return found;
}

const expiredCleanupInFlight = new Set<string>();

/**
 * Subscribe in real time to all active (non-expired, <24h) stories in Firestore.
 * Automatically deletes any expired stories owned by the signed-in user so 24h auto-delete is real.
 */
export function subscribeActiveStoriesPermanent(
  currentUid: string,
  onUpdate: (stories: StoryItem[]) => void,
): Unsubscribe {
  const q = query(collection(db, 'stories'), where('visibility', '==', 'public'));
  return onSnapshot(
    q,
    (snap) => {
      const now = Date.now();
      const active: StoryItem[] = [];

      for (const d of snap.docs) {
        const data = d.data();
        const createdAtMs = tsToMs(data.createdAt);
        const expiresAtMs = data.expiresAt ? tsToMs(data.expiresAt) : createdAtMs + STORY_TTL_MS;
        const story: StoryItem = {
          id: d.id,
          userId: String(data.userId || ''),
          userName: String(data.userName || 'Member'),
          userPhoto: String(data.userPhoto || ''),
          mediaType: (data.mediaType === 'video' || data.mediaType === 'text' ? data.mediaType : 'image') as StoryMediaType,
          storyImage: String(data.storyImage || ''),
          storyVideo: String(data.storyVideo || ''),
          textContent: String(data.textContent || ''),
          bgGradient: String(data.bgGradient || 'ocean-blue'),
          caption: String(data.caption || ''),
          durationSec: typeof data.durationSec === 'number' ? data.durationSec : 0,
          createdAt: new Date(createdAtMs).toISOString(),
          expiresAt: new Date(expiresAtMs).toISOString(),
          createdAtMs,
          expiresAtMs,
        };

        if (expiresAtMs <= now) {
          // 24h expired: auto-delete from Firestore if owned by current user
          if (story.userId === currentUid && !expiredCleanupInFlight.has(story.id)) {
            expiredCleanupInFlight.add(story.id);
            void deleteStoryPermanent(story, currentUid).finally(() => {
              expiredCleanupInFlight.delete(story.id);
            });
          }
          continue;
        }

        if (story.userId) {
          active.push(story);
        }
      }

      // Oldest first within a user's sequence so stories play in chronological order
      active.sort((a, b) => a.createdAtMs - b.createdAtMs);
      onUpdate(active);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'stories');
      } catch {
        // Non-fatal in listener callback
      }
    },
  );
}

/**
 * Create a new Photo, Video, or Text story in Firestore (`stories/{storyId}`)
 * with `expiresAt = createdAt + 24 hours`.
 */
export async function createStoryPermanent(
  author: UserProfile,
  params: {
    storyId?: string;
    mediaType: StoryMediaType;
    storyImage?: string;
    storyVideo?: string;
    textContent?: string;
    bgGradient?: string;
    caption?: string;
    durationSec?: number;
  },
): Promise<StoryItem> {
  if (!author.uid) {
    throw new Error('Please sign in to share a story.');
  }

  const storyId = params.storyId && /^[a-zA-Z0-9_-]{1,128}$/.test(params.storyId)
    ? params.storyId
    : makeStoryId();
  const storyImage = clamp(params.storyImage, 550000);
  const storyVideo = clamp(params.storyVideo, 2048);
  const textContent = clamp(params.textContent, 500);
  const bgGradient = clamp(params.bgGradient || 'ocean-blue', 120);
  const caption = clamp(params.caption, 300);
  const durationSec = Math.max(0, Math.min(60, Math.round(params.durationSec || 0)));

  if (params.mediaType === 'image' && !storyImage) {
    throw new Error('Please select a photo for your story.');
  }
  if (params.mediaType === 'video' && !storyVideo) {
    throw new Error('Please wait for your story video to finish uploading.');
  }
  if (params.mediaType === 'text' && !textContent) {
    throw new Error('Please write something for your text story.');
  }

  const nowMs = Date.now();
  const expiresAtMs = nowMs + STORY_TTL_MS;
  const userName = clamp(author.name, 60) || 'Member';
  const userPhoto = clamp(author.avatar_url, 450000);

  try {
    await setDoc(doc(db, 'stories', storyId), {
      id: storyId,
      userId: author.uid,
      userName,
      userPhoto,
      mediaType: params.mediaType,
      storyImage,
      storyVideo,
      textContent,
      bgGradient,
      caption,
      durationSec,
      visibility: 'public',
      createdAt: serverTimestamp(),
      expiresAt: Timestamp.fromMillis(expiresAtMs),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `stories/${storyId}`);
  }

  return {
    id: storyId,
    userId: author.uid,
    userName,
    userPhoto,
    mediaType: params.mediaType,
    storyImage,
    storyVideo,
    textContent,
    bgGradient,
    caption,
    durationSec,
    createdAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(expiresAtMs).toISOString(),
    createdAtMs: nowMs,
    expiresAtMs,
  };
}

/**
 * Record a real viewer in `stories/{storyId}/viewers/{viewerUid}` as soon as they open the story.
 * Never adds the story owner as a fake viewer of their own story.
 */
export async function recordStoryViewPermanent(
  story: StoryItem,
  viewer: UserProfile,
): Promise<void> {
  if (!viewer.uid || !story.id) return;
  // Always mark seen locally so Blue Ring disappears immediately
  markStorySeenLocal(viewer.uid, story.id);

  // Do not record self-views as external viewers
  if (story.userId === viewer.uid) return;

  const viewerRef = doc(db, 'stories', story.id, 'viewers', viewer.uid);
  const viewerName = clamp(viewer.name, 60) || 'Member';
  const viewerPhoto = clamp(viewer.avatar_url, 450000);

  try {
    const snap = await getDoc(viewerRef);
    if (snap.exists()) {
      await updateDoc(viewerRef, {
        viewerName,
        viewerPhoto,
        viewedAt: serverTimestamp(),
      });
    } else {
      await setDoc(viewerRef, {
        storyId: story.id,
        storyOwnerId: story.userId,
        viewerId: viewer.uid,
        viewerName,
        viewerPhoto,
        viewedAt: serverTimestamp(),
      });
    }
  } catch {
    // Non-fatal: story may have just been deleted by owner
  }
}

/**
 * Real-time `onSnapshot` listener for `stories/{storyId}/viewers` (used by story owner).
 */
export function subscribeStoryViewersPermanent(
  storyId: string,
  storyOwnerId: string,
  onUpdate: (viewers: StoryViewerItem[]) => void,
): Unsubscribe {
  const q = query(
    collection(db, 'stories', storyId, 'viewers'),
    where('storyOwnerId', '==', storyOwnerId),
  );
  return onSnapshot(
    q,
    (snap) => {
      const list: StoryViewerItem[] = snap.docs
        .map((d) => {
          const data = d.data();
          const viewedAtMs = tsToMs(data.viewedAt);
          return {
            storyId: String(data.storyId || storyId),
            storyOwnerId: String(data.storyOwnerId || storyOwnerId),
            viewerId: String(data.viewerId || d.id),
            viewerName: String(data.viewerName || 'Member'),
            viewerPhoto: String(data.viewerPhoto || ''),
            viewedAt: new Date(viewedAtMs).toISOString(),
            viewedAtMs,
          };
        })
        // Never include owner in viewers list
        .filter((v) => v.viewerId !== storyOwnerId)
        .sort((a, b) => b.viewedAtMs - a.viewedAtMs);
      onUpdate(list);
    },
    () => {
      // Non-fatal if story deleted while open
    },
  );
}

/**
 * Real-time `onSnapshot` listener for `stories/{storyId}/reactions` (used by story owner).
 */
export function subscribeStoryReactionsPermanent(
  storyId: string,
  storyOwnerId: string,
  onUpdate: (reactions: StoryReactionItem[]) => void,
): Unsubscribe {
  const q = query(
    collection(db, 'stories', storyId, 'reactions'),
    where('storyOwnerId', '==', storyOwnerId),
  );
  return onSnapshot(
    q,
    (snap) => {
      const list: StoryReactionItem[] = snap.docs
        .map((d) => {
          const data = d.data();
          const reactedAtMs = tsToMs(data.reactedAt);
          const updatedAtMs = tsToMs(data.updatedAt || data.reactedAt);
          const reaction = (
            ['like', 'love', 'haha', 'wow', 'sad', 'angry'].includes(String(data.reaction))
              ? data.reaction
              : 'like'
          ) as StoryReactionType;
          return {
            storyId: String(data.storyId || storyId),
            storyOwnerId: String(data.storyOwnerId || storyOwnerId),
            userId: String(data.userId || d.id),
            userName: String(data.userName || 'Member'),
            userPhoto: String(data.userPhoto || ''),
            reaction,
            reactedAt: new Date(reactedAtMs).toISOString(),
            updatedAt: new Date(updatedAtMs).toISOString(),
            updatedAtMs,
          };
        })
        .sort((a, b) => b.updatedAtMs - a.updatedAtMs);
      onUpdate(list);
    },
    () => {
      // Non-fatal if story deleted while open
    },
  );
}

/**
 * Fetch the signed-in user's own reaction on a given story (if any).
 */
export async function getMyStoryReaction(
  storyId: string,
  myUid: string,
): Promise<StoryReactionType | null> {
  if (!storyId || !myUid) return null;
  try {
    const snap = await getDoc(doc(db, 'stories', storyId, 'reactions', myUid));
    if (!snap.exists()) return null;
    const r = String(snap.data().reaction || '');
    if (['like', 'love', 'haha', 'wow', 'sad', 'angry'].includes(r)) {
      return r as StoryReactionType;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Save or update a real reaction in `stories/{storyId}/reactions/{actor.uid}` and notify the story owner.
 */
export async function reactToStoryPermanent(
  story: StoryItem,
  actor: UserProfile,
  reaction: StoryReactionType,
): Promise<void> {
  if (!actor.uid || !story.id) return;
  const reactRef = doc(db, 'stories', story.id, 'reactions', actor.uid);
  const userName = clamp(actor.name, 60) || 'Member';
  const userPhoto = clamp(actor.avatar_url, 450000);

  try {
    const existingSnap = await getDoc(reactRef);
    if (existingSnap.exists()) {
      await updateDoc(reactRef, {
        userName,
        userPhoto,
        reaction,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(reactRef, {
        storyId: story.id,
        storyOwnerId: story.userId,
        userId: actor.uid,
        userName,
        userPhoto,
        reaction,
        reactedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `stories/${story.id}/reactions/${actor.uid}`);
  }

  // Send real notification to the story owner
  if (story.userId !== actor.uid) {
    const meta = STORY_REACTION_MAP[reaction];
    await createNotificationPermanent({
      recipientUid: story.userId,
      actor,
      type: 'like',
      message: `reacted ${meta.emoji} ${meta.label} to your story`,
    });
  }
}

/**
 * Reply to someone's story -> delivers a real message directly into the story owner's Inbox
 * ("Replied to your story: ..." + story photo when available) and notifies the owner.
 */
export async function replyToStoryPermanent(
  story: StoryItem,
  actor: UserProfile,
  replyText: string,
): Promise<void> {
  if (!actor.uid || !story.userId || story.userId === actor.uid) return;
  const cleanReply = clamp(replyText, 1000);
  if (!cleanReply) return;

  const hasPhoto = Boolean(story.storyImage && story.storyImage.trim().length > 0);
  const messageText = hasPhoto
    ? `Replied to your story: ${cleanReply}`
    : story.textContent
      ? `Replied to your story ("${story.textContent.slice(0, 60)}${story.textContent.length > 60 ? '…' : ''}"): ${cleanReply}`
      : `Replied to your story: ${cleanReply}`;

  await sendMessagePermanent(
    actor.uid,
    story.userId,
    messageText,
    undefined,
    hasPhoto
      ? {
          messageType: 'image',
          mediaUrl: story.storyImage,
          mediaName: 'Story reply',
        }
      : undefined,
  );

  await createNotificationPermanent({
    recipientUid: story.userId,
    actor,
    type: 'message',
    message: `replied to your story: "${cleanReply.slice(0, 120)}"`,
  });
}

/**
 * Permanently delete a story owned by `currentUid` along with its viewers, reactions, and video media.
 */
export async function deleteStoryPermanent(
  story: StoryItem,
  currentUid: string,
): Promise<void> {
  if (!story.id || !currentUid || story.userId !== currentUid) return;

  try {
    // Clean up viewers & reactions subcollections in batches
    const [viewersSnap, reactionsSnap] = await Promise.all([
      getDocs(
        query(
          collection(db, 'stories', story.id, 'viewers'),
          where('storyOwnerId', '==', currentUid),
        ),
      ),
      getDocs(
        query(
          collection(db, 'stories', story.id, 'reactions'),
          where('storyOwnerId', '==', currentUid),
        ),
      ),
    ]);

    const subDocs = [...viewersSnap.docs, ...reactionsSnap.docs];
    for (let i = 0; i < subDocs.length; i += 400) {
      const batch = writeBatch(db);
      subDocs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }

    await deleteDoc(doc(db, 'stories', story.id));

    if (story.storyVideo) {
      await deleteFirebaseStorageUrlIfApplicable(story.storyVideo);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `stories/${story.id}`);
  }
}
