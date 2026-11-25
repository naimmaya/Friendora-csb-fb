import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import type {
  CallType,
  ChatGroupDoc,
  ChatMessageType,
  GroupCallDoc,
  GroupChatMessage,
  UserProfile,
} from '../types';
import {db, handleFirestoreError, OperationType} from './firebase';
import {deleteFirebaseStorageUrlIfApplicable} from './mediaUpload';

export const MAX_GROUP_MEMBERS = 12;
export const MAX_GROUP_CALL_PARTICIPANTS = 12;
export const GROUP_FULL_ERROR_MSG = 'Group is full - Max 12 members';

export function formatCallParticipantsSummary(
  activeUids: string[],
  userByUid: Map<string, UserProfile>,
  fallbackHostName?: string,
): string {
  const uniqueUids = Array.from(new Set(activeUids.filter(Boolean)));
  if (uniqueUids.length === 0) {
    return fallbackHostName ? `${fallbackHostName} call e ache` : 'Group Call choltese';
  }
  const names = uniqueUids.map((uid) => {
    const prof = userByUid.get(uid);
    const full = prof?.name?.trim();
    if (!full) return 'Member';
    return full.split(/\s+/)[0] || full;
  });
  if (names.length === 1) {
    return `${names[0]} call e ache`;
  }
  if (names.length === 2) {
    return `${names[0]}, ${names[1]} call e ache`;
  }
  return `${names[0]}, ${names[1]} + ${names.length - 2} jon call e ache`;
}

function makeId(prefix: string): string {
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 14)
      : `${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
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

function mapGroupDoc(id: string, data: Record<string, unknown>): ChatGroupDoc {
  return {
    id,
    name: String(data.name || 'Group Chat'),
    photoUrl: typeof data.photoUrl === 'string' ? data.photoUrl : '',
    creatorUid: String(data.creatorUid || ''),
    memberUids: Array.isArray(data.memberUids) ? data.memberUids.map(String) : [],
    adminUids: Array.isArray(data.adminUids) ? data.adminUids.map(String) : [],
    lastMessage: typeof data.lastMessage === 'string' ? data.lastMessage : '',
    lastSenderName: typeof data.lastSenderName === 'string' ? data.lastSenderName : '',
    lastMessageAt: tsToIso(data.lastMessageAt),
    createdAt: tsToIso(data.createdAt),
    updatedAt: tsToIso(data.updatedAt),
  };
}

function mapGroupCallDoc(id: string, data: Record<string, unknown>): GroupCallDoc {
  const rawActive = Array.isArray(data.activeUids) ? data.activeUids.map(String) : [];
  const rawParticipants = Array.isArray(data.participants)
    ? data.participants.map(String)
    : rawActive;
  const syncedActive = rawActive.length > 0 ? rawActive : rawParticipants;
  const rawStatus = String(data.status || 'ongoing');
  const status: GroupCallDoc['status'] =
    rawStatus === 'ended'
      ? 'ended'
      : rawStatus === 'ongoing'
        ? 'ongoing'
        : rawStatus === 'active'
          ? 'active'
          : 'ringing';

  return {
    id,
    groupId: String(data.groupId || ''),
    groupName: String(data.groupName || 'Group Call'),
    groupPhoto: typeof data.groupPhoto === 'string' ? data.groupPhoto : '',
    hostUid: String(data.hostUid || ''),
    hostName: String(data.hostName || 'Member'),
    type: (data.type === 'video' ? 'video' : 'audio') as CallType,
    status,
    memberUids: Array.isArray(data.memberUids) ? data.memberUids.map(String) : [],
    activeUids: syncedActive,
    participants: rawParticipants,
    joinedUids: Array.isArray(data.joinedUids) ? data.joinedUids.map(String) : [],
    durationSec: typeof data.durationSec === 'number' ? data.durationSec : 0,
    startedAt: tsToIso(data.startedAt),
    updatedAt: tsToIso(data.updatedAt),
  };
}

export function subscribeGroupsPermanent(
  currentUid: string,
  onUpdate: (groups: ChatGroupDoc[]) => void,
): Unsubscribe {
  const q = query(collection(db, 'groups'), where('memberUids', 'array-contains', currentUid));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs
        .map((d) => mapGroupDoc(d.id, d.data() as Record<string, unknown>))
        .sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());
      onUpdate(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'groups');
      } catch {
        // Logged
      }
    },
  );
}

export async function createGroupPermanent(params: {
  creator: UserProfile;
  name: string;
  photoUrl?: string;
  memberUids: string[];
}): Promise<ChatGroupDoc> {
  if (!params.creator.uid) throw new Error('You must be signed in to create a group.');
  const cleanName = clamp(params.name, 80);
  if (cleanName.length < 2) throw new Error('Group name must be at least 2 characters.');

  const uniqueMembers = Array.from(
    new Set([params.creator.uid, ...params.memberUids.filter(Boolean)]),
  );
  if (uniqueMembers.length > MAX_GROUP_MEMBERS) {
    throw new Error(GROUP_FULL_ERROR_MSG);
  }

  const groupId = makeId('grp');
  const creatorName = clamp(params.creator.name, 60) || 'Member';
  const lastMessage = `${creatorName} created the group "${cleanName}"`;

  try {
    await setDoc(doc(db, 'groups', groupId), {
      id: groupId,
      name: cleanName,
      photoUrl: clamp(params.photoUrl, 450000),
      creatorUid: params.creator.uid,
      memberUids: uniqueMembers,
      adminUids: [params.creator.uid],
      lastMessage: clamp(lastMessage, 240),
      lastSenderName: creatorName,
      lastMessageAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `groups/${groupId}`);
  }

  // Write initial system message
  await sendGroupMessagePermanent({
    groupId,
    sender: params.creator,
    content: lastMessage,
    messageType: 'system',
  }).catch(() => {});

  const now = new Date().toISOString();
  return {
    id: groupId,
    name: cleanName,
    photoUrl: clamp(params.photoUrl, 450000),
    creatorUid: params.creator.uid,
    memberUids: uniqueMembers,
    adminUids: [params.creator.uid],
    lastMessage,
    lastSenderName: creatorName,
    lastMessageAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

export function subscribeGroupMessagesPermanent(
  groupId: string,
  onUpdate: (messages: GroupChatMessage[]) => void,
): Unsubscribe {
  const q = query(
    collection(db, 'groups', groupId, 'messages'),
    where('groupId', '==', groupId),
  );
  return onSnapshot(
    q,
    (snap) => {
      const list: GroupChatMessage[] = snap.docs
        .map((d) => {
          const data = d.data();
          return {
            id: d.id,
            groupId: String(data.groupId || groupId),
            senderUid: String(data.senderUid || ''),
            senderName: String(data.senderName || 'Member'),
            senderAvatar: typeof data.senderAvatar === 'string' ? data.senderAvatar : '',
            content: String(data.content || ''),
            messageType: String(data.messageType || 'text') as GroupChatMessage['messageType'],
            mediaUrl: typeof data.mediaUrl === 'string' ? data.mediaUrl : '',
            mediaName: typeof data.mediaName === 'string' ? data.mediaName : '',
            mediaSize: typeof data.mediaSize === 'number' ? data.mediaSize : 0,
            voiceDurationSec: typeof data.voiceDurationSec === 'number' ? data.voiceDurationSec : 0,
            locationLat: typeof data.locationLat === 'number' ? data.locationLat : 0,
            locationLng: typeof data.locationLng === 'number' ? data.locationLng : 0,
            locationLabel: typeof data.locationLabel === 'string' ? data.locationLabel : '',
            callType: (data.callType || '') as '' | 'audio' | 'video',
            callDurationSec: typeof data.callDurationSec === 'number' ? data.callDurationSec : 0,
            callJoinedCount: typeof data.callJoinedCount === 'number' ? data.callJoinedCount : 0,
            createdAt: tsToIso(data.createdAt),
          };
        })
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      onUpdate(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, `groups/${groupId}/messages`);
      } catch {
        // Logged
      }
    },
  );
}

export async function deleteGroupMessagePermanent(
  groupId: string,
  messageDocId: string,
  mediaUrl?: string | null,
): Promise<void> {
  if (!groupId || !messageDocId) return;
  try {
    await deleteDoc(doc(db, 'groups', groupId, 'messages', messageDocId));
    if (mediaUrl) {
      await deleteFirebaseStorageUrlIfApplicable(mediaUrl);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `groups/${groupId}/messages/${messageDocId}`);
  }
}

function summarizeGroupPreview(params: {
  content: string;
  messageType: ChatMessageType | 'system';
  mediaName?: string;
  locationLabel?: string;
}): string {
  if (params.content.trim()) return clamp(params.content, 240);
  switch (params.messageType) {
    case 'image':
      return 'Sent a photo';
    case 'video':
      return 'Sent a video';
    case 'voice':
      return 'Sent a voice message';
    case 'document':
      return params.mediaName ? `Sent file: ${params.mediaName}` : 'Sent a document';
    case 'location':
      return params.locationLabel ? `Shared location: ${params.locationLabel}` : 'Shared location';
    default:
      return 'Sent a message';
  }
}

export async function sendGroupMessagePermanent(params: {
  groupId: string;
  sender: UserProfile;
  content: string;
  messageType?: ChatMessageType | 'system';
  mediaUrl?: string;
  mediaName?: string;
  mediaSize?: number;
  voiceDurationSec?: number;
  locationLat?: number;
  locationLng?: number;
  locationLabel?: string;
  callType?: '' | 'audio' | 'video';
  callDurationSec?: number;
  callJoinedCount?: number;
}): Promise<GroupChatMessage> {
  if (!params.sender.uid) throw new Error('Not authenticated.');
  const messageType = params.messageType || 'text';
  const cleanContent = clamp(params.content, 2000);
  const mediaUrl = clamp(params.mediaUrl, 650000);
  if (!cleanContent && !mediaUrl && messageType !== 'location') {
    throw new Error('Message cannot be empty.');
  }

  const msgId = makeId('gmsg');
  const senderName = clamp(params.sender.name, 60) || 'Member';
  const senderAvatar = clamp(params.sender.avatar_url, 450000);
  const mediaName = clamp(params.mediaName, 180);
  const mediaSize = Math.max(0, Math.min(104857600, Math.round(params.mediaSize || 0)));
  const voiceDurationSec = Math.max(0, Math.min(3600, Math.round(params.voiceDurationSec || 0)));
  const locationLat = typeof params.locationLat === 'number' ? params.locationLat : 0;
  const locationLng = typeof params.locationLng === 'number' ? params.locationLng : 0;
  const locationLabel = clamp(params.locationLabel, 200);
  const callType = params.callType || '';
  const callDurationSec = Math.max(0, Math.min(86400, Math.round(params.callDurationSec || 0)));
  const callJoinedCount = Math.max(
    0,
    Math.min(MAX_GROUP_CALL_PARTICIPANTS, Math.round(params.callJoinedCount || 0)),
  );

  try {
    await setDoc(doc(db, 'groups', params.groupId, 'messages', msgId), {
      id: msgId,
      groupId: params.groupId,
      senderUid: params.sender.uid,
      senderName,
      senderAvatar,
      content: cleanContent,
      messageType,
      mediaUrl,
      mediaName,
      mediaSize,
      voiceDurationSec,
      locationLat,
      locationLng,
      locationLabel,
      callType,
      callDurationSec,
      callJoinedCount,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `groups/${params.groupId}/messages/${msgId}`);
  }

  // Update group lastMessage preview (Action 2 in rules)
  const preview = summarizeGroupPreview({
    content: cleanContent,
    messageType,
    mediaName,
    locationLabel,
  });
  try {
    await updateDoc(doc(db, 'groups', params.groupId), {
      lastMessage: clamp(preview, 240),
      lastSenderName: senderName,
      lastMessageAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch {
    // Message already saved
  }

  return {
    id: msgId,
    groupId: params.groupId,
    senderUid: params.sender.uid,
    senderName,
    senderAvatar,
    content: cleanContent,
    messageType,
    mediaUrl,
    mediaName,
    mediaSize,
    voiceDurationSec,
    locationLat,
    locationLng,
    locationLabel,
    callType,
    callDurationSec,
    callJoinedCount,
    createdAt: new Date().toISOString(),
  };
}

export async function updateGroupDetailsPermanent(
  groupId: string,
  actor: UserProfile,
  updates: {name?: string; photoUrl?: string},
): Promise<void> {
  const patch: Record<string, unknown> = {updatedAt: serverTimestamp()};
  let note = '';
  if (typeof updates.name === 'string') {
    const clean = clamp(updates.name, 80);
    if (clean.length < 2) throw new Error('Group name must be at least 2 characters.');
    patch.name = clean;
    note = `${actor.name} changed the group name to "${clean}"`;
  }
  if (typeof updates.photoUrl === 'string') {
    patch.photoUrl = clamp(updates.photoUrl, 450000);
    if (!note) note = `${actor.name} updated the group photo`;
  }
  if (note) {
    patch.lastMessage = clamp(note, 240);
    patch.lastSenderName = clamp(actor.name, 60) || 'Member';
    patch.lastMessageAt = serverTimestamp();
  }
  try {
    await updateDoc(doc(db, 'groups', groupId), patch);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `groups/${groupId}`);
  }
  if (note) {
    await sendGroupMessagePermanent({
      groupId,
      sender: actor,
      content: note,
      messageType: 'system',
    }).catch(() => {});
  }
}

export async function addGroupMembersPermanent(
  group: ChatGroupDoc,
  actor: UserProfile,
  newMembers: UserProfile[],
): Promise<void> {
  if (group.memberUids.length >= MAX_GROUP_MEMBERS) {
    throw new Error(GROUP_FULL_ERROR_MSG);
  }
  const addUids = newMembers
    .map((m) => m.uid)
    .filter((u): u is string => Boolean(u && !group.memberUids.includes(u)));
  if (addUids.length === 0) return;

  if (group.memberUids.length + addUids.length > MAX_GROUP_MEMBERS) {
    throw new Error(GROUP_FULL_ERROR_MSG);
  }

  const updatedMembers = Array.from(new Set([...group.memberUids, ...addUids])).slice(
    0,
    MAX_GROUP_MEMBERS,
  );
  const names = newMembers
    .filter((m) => m.uid && addUids.includes(m.uid))
    .map((m) => m.name)
    .join(', ');
  const note = `${actor.name} added ${names} to the group`;

  try {
    await updateDoc(doc(db, 'groups', group.id), {
      memberUids: updatedMembers,
      lastMessage: clamp(note, 240),
      lastSenderName: clamp(actor.name, 60) || 'Member',
      lastMessageAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `groups/${group.id}`);
  }

  await sendGroupMessagePermanent({
    groupId: group.id,
    sender: actor,
    content: note,
    messageType: 'system',
  }).catch(() => {});
}

export async function removeGroupMemberPermanent(
  group: ChatGroupDoc,
  actor: UserProfile,
  targetUid: string,
  targetName: string,
): Promise<void> {
  if (targetUid === group.creatorUid) {
    throw new Error('The group creator cannot be removed.');
  }
  const updatedMembers = group.memberUids.filter((u) => u !== targetUid);
  const updatedAdmins = group.adminUids.filter((u) => u !== targetUid);
  const note = `${actor.name} removed ${targetName} from the group`;

  try {
    await updateDoc(doc(db, 'groups', group.id), {
      memberUids: updatedMembers,
      adminUids: updatedAdmins,
      lastMessage: clamp(note, 240),
      lastSenderName: clamp(actor.name, 60) || 'Member',
      lastMessageAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `groups/${group.id}`);
  }

  await sendGroupMessagePermanent({
    groupId: group.id,
    sender: actor,
    content: note,
    messageType: 'system',
  }).catch(() => {});
}

export async function toggleGroupAdminPermanent(
  group: ChatGroupDoc,
  actor: UserProfile,
  targetUid: string,
  targetName: string,
): Promise<boolean> {
  if (targetUid === group.creatorUid) {
    throw new Error('The group creator is always an admin.');
  }
  const isCurrentlyAdmin = group.adminUids.includes(targetUid);
  const updatedAdmins = isCurrentlyAdmin
    ? group.adminUids.filter((u) => u !== targetUid)
    : Array.from(new Set([...group.adminUids, targetUid])).slice(0, MAX_GROUP_MEMBERS);
  const note = isCurrentlyAdmin
    ? `${actor.name} removed ${targetName} as admin`
    : `${actor.name} made ${targetName} an admin`;

  try {
    await updateDoc(doc(db, 'groups', group.id), {
      adminUids: updatedAdmins,
      lastMessage: clamp(note, 240),
      lastSenderName: clamp(actor.name, 60) || 'Member',
      lastMessageAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `groups/${group.id}`);
  }

  await sendGroupMessagePermanent({
    groupId: group.id,
    sender: actor,
    content: note,
    messageType: 'system',
  }).catch(() => {});

  return !isCurrentlyAdmin;
}

export async function leaveGroupPermanent(
  group: ChatGroupDoc,
  actor: UserProfile,
): Promise<void> {
  if (!actor.uid) throw new Error('Not authenticated.');
  if (actor.uid === group.creatorUid) {
    throw new Error(
      'As the group creator, you can delete the group instead of leaving.',
    );
  }
  const updatedMembers = group.memberUids.filter((u) => u !== actor.uid);
  const updatedAdmins = group.adminUids.filter((u) => u !== actor.uid);
  const note = `${actor.name} left the group`;

  // Send system message BEFORE removing self from memberUids
  await sendGroupMessagePermanent({
    groupId: group.id,
    sender: actor,
    content: note,
    messageType: 'system',
  }).catch(() => {});

  try {
    await updateDoc(doc(db, 'groups', group.id), {
      memberUids: updatedMembers,
      adminUids: updatedAdmins,
      lastMessage: clamp(note, 240),
      lastSenderName: clamp(actor.name, 60) || 'Member',
      lastMessageAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `groups/${group.id}`);
  }
}

export async function deleteGroupPermanent(groupId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'groups', groupId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `groups/${groupId}`);
  }
}

// ==========================================
// MULTI-PARTY GROUP CALLS (WEBRTC MESH + FIRESTORE)
// ==========================================

export function formatGroupCallLogMessage(
  type: CallType,
  durationSec: number,
  joinedCount: number,
): string {
  if (joinedCount <= 1) {
    return 'Missed Group Call';
  }
  const label = type === 'video' ? 'Group Video Call' : 'Group Audio Call';
  const joinedText = `${joinedCount} joined`;
  if (durationSec < 60) {
    const s = Math.max(1, Math.round(durationSec));
    return `${label} - ${s} sec, ${joinedText}`;
  }
  const mins = Math.max(1, Math.round(durationSec / 60));
  return `${label} - ${mins} min, ${joinedText}`;
}

export interface GroupCallParticipantDoc {
  uid: string;
  callId: string;
  name: string;
  avatarUrl: string;
  status: 'joined' | 'left';
  isMuted: boolean;
  isVideoOff: boolean;
  joinedAt: string;
  updatedAt: string;
}

function mapGroupCallParticipantDoc(
  uid: string,
  callId: string,
  data: Record<string, unknown>,
): GroupCallParticipantDoc {
  return {
    uid: String(data.uid || uid),
    callId: String(data.callId || callId),
    name: String(data.name || 'Member'),
    avatarUrl: String(data.avatarUrl || ''),
    status: data.status === 'left' ? 'left' : 'joined',
    isMuted: Boolean(data.isMuted),
    isVideoOff: Boolean(data.isVideoOff),
    joinedAt: tsToIso(data.joinedAt),
    updatedAt: tsToIso(data.updatedAt),
  };
}

export async function upsertGroupCallParticipant(
  callId: string,
  user: UserProfile,
  opts: {status: 'joined' | 'left'; isMuted: boolean; isVideoOff: boolean},
): Promise<void> {
  if (!user.uid) return;
  const partRef = doc(db, 'groupCalls', callId, 'participants', user.uid);
  const name = clamp(user.name, 60) || 'Member';
  const avatarUrl = clamp(user.avatar_url, 450000);
  try {
    const existing = await getDoc(partRef);
    if (existing.exists()) {
      await updateDoc(partRef, {
        name,
        avatarUrl,
        status: opts.status,
        isMuted: opts.isMuted,
        isVideoOff: opts.isVideoOff,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(partRef, {
        uid: user.uid,
        callId,
        name,
        avatarUrl,
        status: opts.status,
        isMuted: opts.isMuted,
        isVideoOff: opts.isVideoOff,
        joinedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch {
    // Non-fatal if call already ended
  }
}

export function subscribeGroupCallParticipants(
  callId: string,
  onParticipants: (participants: GroupCallParticipantDoc[]) => void,
): Unsubscribe {
  const q = query(
    collection(db, 'groupCalls', callId, 'participants'),
    where('callId', '==', callId),
  );
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs
        .map((d) => mapGroupCallParticipantDoc(d.id, callId, d.data() as Record<string, unknown>))
        .sort((a, b) => new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime());
      onParticipants(list);
    },
    () => {
      // Ignore transient snapshot error
    },
  );
}

export async function startGroupCallPermanent(
  group: ChatGroupDoc,
  host: UserProfile,
  type: CallType,
): Promise<GroupCallDoc> {
  if (!host.uid) throw new Error('Not authenticated.');
  const callId = makeId('gcall');
  const hostName = clamp(host.name, 60) || 'Member';
  const safeMembers = group.memberUids.slice(0, MAX_GROUP_MEMBERS);
  try {
    await setDoc(doc(db, 'groupCalls', callId), {
      id: callId,
      groupId: group.id,
      groupName: clamp(group.name, 80) || 'Group Call',
      groupPhoto: clamp(group.photoUrl, 450000),
      hostUid: host.uid,
      hostName,
      type,
      status: 'ongoing',
      memberUids: safeMembers,
      activeUids: [host.uid],
      participants: [host.uid],
      joinedUids: [host.uid],
      durationSec: 0,
      startedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `groupCalls/${callId}`);
  }

  // Register host in groupCalls/{callId}/participants/{hostUid}
  await upsertGroupCallParticipant(callId, host, {
    status: 'joined',
    isMuted: false,
    isVideoOff: type === 'audio',
  });

  // Notify everyone in the Group Chat in real time
  await sendGroupMessagePermanent({
    groupId: group.id,
    sender: host,
    content: `${hostName} Group Call e join korse`,
    messageType: 'system',
  }).catch(() => {});

  const now = new Date().toISOString();
  return {
    id: callId,
    groupId: group.id,
    groupName: group.name,
    groupPhoto: group.photoUrl,
    hostUid: host.uid,
    hostName,
    type,
    status: 'ongoing',
    memberUids: safeMembers,
    activeUids: [host.uid],
    participants: [host.uid],
    joinedUids: [host.uid],
    durationSec: 0,
    startedAt: now,
    updatedAt: now,
  };
}

export async function joinGroupCallPermanent(
  callId: string,
  user: UserProfile,
  isVideoOff: boolean,
): Promise<GroupCallDoc | null> {
  if (!user.uid) return null;
  const ref = doc(db, 'groupCalls', callId);
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    const current = mapGroupCallDoc(snap.id, snap.data() as Record<string, unknown>);
    if (current.status === 'ended') return current;

    const alreadyInCall = current.activeUids.includes(user.uid);
    if (!alreadyInCall && current.activeUids.length >= MAX_GROUP_CALL_PARTICIPANTS) {
      throw new Error(`Group call is full (Max ${MAX_GROUP_CALL_PARTICIPANTS} participants).`);
    }

    const activeUids = Array.from(new Set([...current.activeUids, user.uid])).slice(
      0,
      MAX_GROUP_CALL_PARTICIPANTS,
    );
    const joinedUids = Array.from(new Set([...current.joinedUids, user.uid])).slice(
      0,
      MAX_GROUP_CALL_PARTICIPANTS,
    );

    await updateDoc(ref, {
      status: 'ongoing',
      activeUids,
      participants: activeUids,
      joinedUids,
      updatedAt: serverTimestamp(),
    });

    await upsertGroupCallParticipant(callId, user, {
      status: 'joined',
      isMuted: false,
      isVideoOff,
    });

    // Post real-time system message in Group Chat when a member newly joins the call
    if (!alreadyInCall) {
      const joinerName = clamp(user.name, 60) || 'Member';
      await sendGroupMessagePermanent({
        groupId: current.groupId,
        sender: user,
        content: `${joinerName} Group Call e join korse`,
        messageType: 'system',
      }).catch(() => {});
    }

    return {
      ...current,
      status: 'ongoing',
      activeUids,
      participants: activeUids,
      joinedUids,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `groupCalls/${callId}`);
  }
}

export async function leaveGroupCallPermanent(
  callId: string,
  user: UserProfile,
  elapsedSec: number,
): Promise<{ended: boolean; callDoc: GroupCallDoc | null}> {
  if (!user.uid) return {ended: false, callDoc: null};

  // Mark participant as left in groupCalls/{callId}/participants/{userId}
  await upsertGroupCallParticipant(callId, user, {
    status: 'left',
    isMuted: true,
    isVideoOff: true,
  });

  const ref = doc(db, 'groupCalls', callId);
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) return {ended: true, callDoc: null};
    const current = mapGroupCallDoc(snap.id, snap.data() as Record<string, unknown>);
    if (current.status === 'ended') return {ended: true, callDoc: current};

    // Creator leaving does NOT end the call if other members are still active;
    // Call ends ONLY when everyone has left (nextActive.length === 0).
    const nextActive = current.activeUids.filter((uid) => uid !== user.uid);
    const shouldEnd = nextActive.length === 0;
    const finalDur = Math.max(current.durationSec, Math.round(elapsedSec));

    await updateDoc(ref, {
      status: shouldEnd ? 'ended' : 'ongoing',
      activeUids: nextActive,
      participants: nextActive,
      durationSec: finalDur,
      updatedAt: serverTimestamp(),
    });

    const leaverName = clamp(user.name, 60) || 'Member';
    await sendGroupMessagePermanent({
      groupId: current.groupId,
      sender: user,
      content: `${leaverName} call theke chole gese`,
      messageType: 'system',
    }).catch(() => {});

    if (shouldEnd) {
      const logContent = formatGroupCallLogMessage(
        current.type,
        finalDur,
        current.joinedUids.length,
      );
      await sendGroupMessagePermanent({
        groupId: current.groupId,
        sender: user,
        content: logContent,
        messageType: 'call',
        callType: current.type,
        callDurationSec: finalDur,
        callJoinedCount: current.joinedUids.length,
      }).catch(() => {});
    }

    return {
      ended: shouldEnd,
      callDoc: {
        ...current,
        status: shouldEnd ? 'ended' : 'ongoing',
        activeUids: nextActive,
        participants: nextActive,
        durationSec: finalDur,
      },
    };
  } catch {
    return {ended: false, callDoc: null};
  }
}

export function subscribeIncomingGroupCalls(
  currentUid: string,
  onCalls: (calls: GroupCallDoc[]) => void,
): Unsubscribe {
  const q = query(
    collection(db, 'groupCalls'),
    where('memberUids', 'array-contains', currentUid),
  );
  return onSnapshot(
    q,
    (snap) => {
      const now = Date.now();
      const active = snap.docs
        .map((d) => mapGroupCallDoc(d.id, d.data() as Record<string, unknown>))
        .filter((c) => {
          if (c.status === 'ended' || c.activeUids.length === 0) return false;
          const ageMs = now - new Date(c.startedAt).getTime();
          // Ignore stale calls older than 4 hours
          return ageMs < 4 * 60 * 60 * 1000;
        })
        .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
      onCalls(active);
    },
    () => {
      // Non-fatal
    },
  );
}

export function subscribeGroupCallDoc(
  callId: string,
  onUpdate: (call: GroupCallDoc | null) => void,
): Unsubscribe {
  return onSnapshot(
    doc(db, 'groupCalls', callId),
    (snap) => {
      if (!snap.exists()) {
        onUpdate(null);
        return;
      }
      onUpdate(mapGroupCallDoc(snap.id, snap.data() as Record<string, unknown>));
    },
    () => {},
  );
}

export interface GroupCallSignalDoc {
  id: string;
  callId: string;
  fromUid: string;
  toUid: string;
  kind: 'offer' | 'answer' | 'ice';
  sdp: string;
  candidate: string;
  sdpMid: string;
  sdpMLineIndex: number;
}

export async function sendGroupCallSignal(params: {
  callId: string;
  fromUid: string;
  toUid: string;
  kind: 'offer' | 'answer' | 'ice';
  sdp?: string;
  candidate?: string;
  sdpMid?: string;
  sdpMLineIndex?: number;
}): Promise<void> {
  if (!params.fromUid || !params.toUid || params.fromUid === params.toUid) return;
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  // Per-pair signal doc ID prefixed with {from}_{to} inside groupCalls/{callId}/signals/
  const sigId = `${params.fromUid.slice(0, 28)}_${params.toUid.slice(0, 28)}_${params.kind}_${Date.now().toString(36)}_${rand}`;
  const pair = [params.fromUid, params.toUid].sort();
  try {
    await setDoc(doc(db, 'groupCalls', params.callId, 'signals', sigId), {
      id: sigId,
      callId: params.callId,
      fromUid: params.fromUid,
      toUid: params.toUid,
      participantUids: pair,
      kind: params.kind,
      sdp: (params.sdp || '').slice(0, 65536),
      candidate: (params.candidate || '').slice(0, 4096),
      sdpMid: (params.sdpMid || '').slice(0, 64),
      sdpMLineIndex: typeof params.sdpMLineIndex === 'number' ? params.sdpMLineIndex : -1,
      createdAt: serverTimestamp(),
    });
  } catch {
    // Best-effort signaling
  }
}

export function subscribeGroupCallSignals(
  callId: string,
  myUid: string,
  onSignal: (sig: GroupCallSignalDoc) => void,
): Unsubscribe {
  const seen = new Set<string>();
  const q = query(
    collection(db, 'groupCalls', callId, 'signals'),
    where('participantUids', 'array-contains', myUid),
  );
  return onSnapshot(
    q,
    (snap) => {
      snap.docChanges().forEach((change) => {
        if (change.type !== 'added') return;
        const d = change.doc;
        if (seen.has(d.id)) return;
        seen.add(d.id);
        const data = d.data();
        if (data.toUid !== myUid) return;
        onSignal({
          id: d.id,
          callId,
          fromUid: String(data.fromUid || ''),
          toUid: String(data.toUid || ''),
          kind: data.kind as 'offer' | 'answer' | 'ice',
          sdp: String(data.sdp || ''),
          candidate: String(data.candidate || ''),
          sdpMid: String(data.sdpMid || ''),
          sdpMLineIndex: typeof data.sdpMLineIndex === 'number' ? data.sdpMLineIndex : -1,
        });
      });
    },
    () => {},
  );
}
