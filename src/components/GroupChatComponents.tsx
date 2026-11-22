import {useEffect, useMemo, useRef, useState} from 'react';
import type {ChangeEvent, FormEvent} from 'react';
import {
  AlertCircle,
  Camera,
  Check,
  Crown,
  Info,
  Loader2,
  LogOut,
  Phone,
  Search,
  Shield,
  ShieldOff,
  Trash2,
  UserMinus,
  UserPlus,
  Users,
  Video,
  X,
} from 'lucide-react';
import {formatFirestoreErrorMessage} from '../lib/firebase';
import {compressImageForFirestore} from '../lib/firestoreStore';
import {
  addGroupMembersPermanent,
  createGroupPermanent,
  deleteGroupPermanent,
  leaveGroupPermanent,
  removeGroupMemberPermanent,
  sendGroupMessagePermanent,
  subscribeGroupMessagesPermanent,
  toggleGroupAdminPermanent,
  updateGroupDetailsPermanent,
} from '../lib/groupService';
import type {CallType, ChatGroupDoc, GroupChatMessage, UserProfile} from '../types';
import {ChatInputBar, type OutgoingChatPayload} from './ChatInputBar';
import {ChatMessageBubble} from './ChatMessageBubble';
import {Avatar} from './MediaImage';

interface CreateGroupModalProps {
  currentUser: UserProfile;
  candidates: UserProfile[];
  onClose: () => void;
  onCreated: (group: ChatGroupDoc) => void;
}

export function CreateGroupModal({
  currentUser,
  candidates,
  onClose,
  onCreated,
}: CreateGroupModalProps) {
  const [groupName, setGroupName] = useState('');
  const [groupPhoto, setGroupPhoto] = useState('');
  const [selectedUids, setSelectedUids] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const photoRef = useRef<HTMLInputElement>(null);

  const filteredCandidates = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = candidates.filter((u) => u.uid && u.uid !== currentUser.uid);
    if (!q) return list;
    return list.filter((u) => u.name.toLowerCase().includes(q));
  }, [candidates, currentUser.uid, search]);

  function toggleMember(uid: string) {
    setSelectedUids((prev) =>
      prev.includes(uid) ? prev.filter((id) => id !== uid) : [...prev, uid].slice(0, 49),
    );
  }

  async function handlePhotoPick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadingPhoto(true);
    setError(null);
    try {
      const dataUrl = await compressImageForFirestore(file, 'avatar');
      setGroupPhoto(dataUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to prepare group photo.');
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!groupName.trim()) {
      setError('Enter a group name.');
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const created = await createGroupPermanent({
        creator: currentUser,
        name: groupName.trim(),
        photoUrl: groupPhoto,
        memberUids: selectedUids,
      });
      onCreated(created);
    } catch (err) {
      setError(formatFirestoreErrorMessage(err));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[110] bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <form
        onSubmit={handleCreate}
        className="w-full max-w-md bg-white dark:bg-[#16191F] border border-[#E5E8EE] dark:border-[#252A34] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[88vh]"
      >
        <div className="px-5 py-4 border-b border-[#E5E8EE] dark:border-[#252A34] flex items-center justify-between">
          <div>
            <h2 className="font-display font-bold text-base text-[#0F172A] dark:text-white">
              Create Group Chat
            </h2>
            <p className="text-xs text-[#64748B] dark:text-[#94A3B8]">
              Select friends, set a group name &amp; photo
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#64748B] hover:bg-[#F4F6F9] dark:hover:bg-[#232732] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {error && (
            <div className="flex items-start gap-2 rounded-xl bg-[#FEF2F2] dark:bg-[#3B181A] border border-[#FECACA] dark:border-[#7F1D1D] px-3 py-2 text-xs text-[#B91C1C] dark:text-[#FCA5A5]">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Group Photo + Name */}
          <div className="flex items-center gap-3.5">
            <input
              ref={photoRef}
              type="file"
              accept="image/*"
              onChange={handlePhotoPick}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => photoRef.current?.click()}
              disabled={uploadingPhoto}
              className="relative w-14 h-14 rounded-2xl bg-[#F4F6F9] dark:bg-[#0E1014] border border-dashed border-[#CBD5E1] dark:border-[#334155] flex items-center justify-center overflow-hidden shrink-0 cursor-pointer hover:border-[#1877F2]"
            >
              {groupPhoto ? (
                <img src={groupPhoto} alt="Group photo" className="w-full h-full object-cover" />
              ) : uploadingPhoto ? (
                <Loader2 className="w-5 h-5 animate-spin text-[#1877F2]" />
              ) : (
                <Camera className="w-5 h-5 text-[#64748B]" />
              )}
            </button>

            <div className="flex-1 min-w-0">
              <label className="text-xs font-semibold text-[#334155] dark:text-[#CBD5E1] block mb-1">
                Group Name
              </label>
              <input
                type="text"
                required
                minLength={2}
                maxLength={80}
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="e.g. Weekend Squad, Family, Team..."
                className="w-full h-10 px-3 rounded-xl bg-[#F4F6F9] dark:bg-[#0E1014] border border-transparent focus:border-[#1877F2] text-sm text-[#0F172A] dark:text-white focus:outline-none"
              />
            </div>
          </div>

          {/* Select Friends */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[#334155] dark:text-[#CBD5E1]">
                Select Members ({selectedUids.length} selected)
              </span>
              {selectedUids.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedUids([])}
                  className="text-[11px] font-semibold text-[#1877F2] hover:underline cursor-pointer"
                >
                  Clear
                </button>
              )}
            </div>

            <div className="relative">
              <Search className="w-4 h-4 text-[#64748B] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search friends..."
                className="w-full h-9 pl-9 pr-3 rounded-xl bg-[#F4F6F9] dark:bg-[#0E1014] text-xs text-[#0F172A] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1877F2]/30"
              />
            </div>

            <div className="max-h-56 overflow-y-auto divide-y divide-[#E5E8EE] dark:divide-[#252A34] border border-[#E5E8EE] dark:border-[#252A34] rounded-xl">
              {filteredCandidates.length === 0 ? (
                <div className="p-4 text-center text-xs text-[#64748B] dark:text-[#94A3B8]">
                  No other users found yet. You can still create the group and add people later.
                </div>
              ) : (
                filteredCandidates.map((u) => {
                  const uid = u.uid!;
                  const checked = selectedUids.includes(uid);
                  return (
                    <button
                      key={uid}
                      type="button"
                      onClick={() => toggleMember(uid)}
                      className={`w-full px-3 py-2.5 flex items-center justify-between gap-2.5 text-left transition-colors cursor-pointer ${
                        checked
                          ? 'bg-[#1877F2]/8 dark:bg-[#3B82F6]/15'
                          : 'hover:bg-[#F8FAFC] dark:hover:bg-[#1E222B]'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Avatar src={u.avatar_url} name={u.name} size="xs" />
                        <span className="text-sm font-medium text-[#0F172A] dark:text-white truncate">
                          {u.name}
                        </span>
                      </div>
                      <span
                        className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ${
                          checked
                            ? 'bg-[#1877F2] border-[#1877F2] text-white'
                            : 'border-[#CBD5E1] dark:border-[#475569]'
                        }`}
                      >
                        {checked && <Check className="w-3.5 h-3.5" />}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>

        <div className="px-5 py-3.5 border-t border-[#E5E8EE] dark:border-[#252A34] flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 h-10 rounded-xl text-xs font-semibold text-[#64748B] dark:text-[#94A3B8] hover:bg-[#F4F6F9] dark:hover:bg-[#232732] cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={creating || uploadingPhoto || groupName.trim().length < 2}
            className="inline-flex items-center gap-1.5 px-5 h-10 rounded-xl bg-[#1877F2] hover:bg-[#166FE5] text-white text-xs font-semibold disabled:opacity-50 cursor-pointer"
          >
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />}
            <span>{creating ? 'Creating...' : 'Create Group'}</span>
          </button>
        </div>
      </form>
    </div>
  );
}

interface GroupChatWindowProps {
  group: ChatGroupDoc;
  currentUser: UserProfile;
  allUsers: UserProfile[];
  onStartGroupCall: (group: ChatGroupDoc, type: CallType) => void;
  onGroupLeftOrDeleted: (groupId: string) => void;
}

export function GroupChatWindow({
  group,
  currentUser,
  allUsers,
  onStartGroupCall,
  onGroupLeftOrDeleted,
}: GroupChatWindowProps) {
  const [messages, setMessages] = useState<GroupChatMessage[]>([]);
  const [showInfo, setShowInfo] = useState(false);
  const [showAddMembers, setShowAddMembers] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(group.name);
  const [busyAction, setBusyAction] = useState(false);
  const [infoError, setInfoError] = useState<string | null>(null);

  const photoInputRef = useRef<HTMLInputElement>(null);
  const scrollEndRef = useRef<HTMLDivElement>(null);

  const myUid = currentUser.uid || '';
  const isAdmin = group.adminUids.includes(myUid);
  const isCreator = group.creatorUid === myUid;

  const userByUid = useMemo(() => {
    const map = new Map<string, UserProfile>();
    if (currentUser.uid) map.set(currentUser.uid, currentUser);
    for (const u of allUsers) {
      if (u.uid) map.set(u.uid, u);
    }
    return map;
  }, [allUsers, currentUser]);

  const nonMembers = useMemo(
    () => allUsers.filter((u) => u.uid && !group.memberUids.includes(u.uid)),
    [allUsers, group.memberUids],
  );

  useEffect(() => {
    setNameDraft(group.name);
    setEditingName(false);
    setShowAddMembers(false);
    setInfoError(null);
  }, [group.id, group.name]);

  useEffect(() => {
    const unsub = subscribeGroupMessagesPermanent(group.id, (list) => {
      setMessages(list);
    });
    return () => unsub();
  }, [group.id]);

  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({behavior: 'smooth'});
  }, [messages.length]);

  async function handleSendGroupPayload(payload: OutgoingChatPayload) {
    await sendGroupMessagePermanent({
      groupId: group.id,
      sender: currentUser,
      content: payload.content,
      messageType: payload.messageType,
      mediaUrl: payload.mediaUrl,
      mediaName: payload.mediaName,
      mediaSize: payload.mediaSize,
      voiceDurationSec: payload.voiceDurationSec,
      locationLat: payload.locationLat,
      locationLng: payload.locationLng,
      locationLabel: payload.locationLabel,
    });
  }

  async function handleSaveGroupName(e: FormEvent) {
    e.preventDefault();
    if (!nameDraft.trim() || busyAction) return;
    setBusyAction(true);
    setInfoError(null);
    try {
      await updateGroupDetailsPermanent(group.id, currentUser, {name: nameDraft.trim()});
      setEditingName(false);
    } catch (err) {
      setInfoError(formatFirestoreErrorMessage(err));
    } finally {
      setBusyAction(false);
    }
  }

  async function handleChangeGroupPhoto(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusyAction(true);
    setInfoError(null);
    try {
      const dataUrl = await compressImageForFirestore(file, 'avatar');
      await updateGroupDetailsPermanent(group.id, currentUser, {photoUrl: dataUrl});
    } catch (err) {
      setInfoError(formatFirestoreErrorMessage(err));
    } finally {
      setBusyAction(false);
    }
  }

  async function handleAddSingleMember(member: UserProfile) {
    setBusyAction(true);
    setInfoError(null);
    try {
      await addGroupMembersPermanent(group, currentUser, [member]);
    } catch (err) {
      setInfoError(formatFirestoreErrorMessage(err));
    } finally {
      setBusyAction(false);
    }
  }

  async function handleRemoveMember(targetUid: string, targetName: string) {
    setBusyAction(true);
    setInfoError(null);
    try {
      await removeGroupMemberPermanent(group, currentUser, targetUid, targetName);
    } catch (err) {
      setInfoError(formatFirestoreErrorMessage(err));
    } finally {
      setBusyAction(false);
    }
  }

  async function handleToggleAdmin(targetUid: string, targetName: string) {
    setBusyAction(true);
    setInfoError(null);
    try {
      await toggleGroupAdminPermanent(group, currentUser, targetUid, targetName);
    } catch (err) {
      setInfoError(formatFirestoreErrorMessage(err));
    } finally {
      setBusyAction(false);
    }
  }

  async function handleLeaveOrDelete() {
    setBusyAction(true);
    setInfoError(null);
    try {
      if (isCreator) {
        await deleteGroupPermanent(group.id);
      } else {
        await leaveGroupPermanent(group, currentUser);
      }
      onGroupLeftOrDeleted(group.id);
    } catch (err) {
      setInfoError(formatFirestoreErrorMessage(err));
    } finally {
      setBusyAction(false);
    }
  }

  return (
    <div className="bg-white dark:bg-[#16191F] border border-[#E5E8EE] dark:border-[#252A34] h-[620px] rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] flex flex-col overflow-hidden relative">
      {/* Group Header with Phone + Video + Info */}
      <div className="px-4 py-3 border-b border-[#E5E8EE] dark:border-[#252A34] flex items-center justify-between gap-2 shrink-0">
        <button
          type="button"
          onClick={() => setShowInfo((prev) => !prev)}
          className="flex items-center gap-2.5 min-w-0 text-left cursor-pointer"
        >
          <Avatar src={group.photoUrl} name={group.name} size="sm" />
          <div className="min-w-0">
            <span className="font-display font-semibold text-sm text-[#0F172A] dark:text-white truncate block">
              {group.name}
            </span>
            <span className="text-[11px] text-[#64748B] dark:text-[#94A3B8] tabular-nums block">
              {group.memberUids.length} {group.memberUids.length === 1 ? 'member' : 'members'}
            </span>
          </div>
        </button>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => onStartGroupCall(group, 'audio')}
            title="Start Group Audio Call"
            aria-label="Start group audio call"
            className="w-9 h-9 rounded-full text-[#1877F2] dark:text-[#60A5FA] hover:bg-[#1877F2]/10 flex items-center justify-center transition-colors cursor-pointer"
          >
            <Phone className="w-[18px] h-[18px]" />
          </button>
          <button
            type="button"
            onClick={() => onStartGroupCall(group, 'video')}
            title="Start Group Video Call"
            aria-label="Start group video call"
            className="w-9 h-9 rounded-full text-[#1877F2] dark:text-[#60A5FA] hover:bg-[#1877F2]/10 flex items-center justify-center transition-colors cursor-pointer"
          >
            <Video className="w-[19px] h-[19px]" />
          </button>
          <button
            type="button"
            onClick={() => setShowInfo((prev) => !prev)}
            title="Group Info & Settings"
            aria-label="Group info"
            className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
              showInfo
                ? 'bg-[#1877F2]/15 text-[#1877F2] dark:text-[#60A5FA]'
                : 'text-[#64748B] dark:text-[#94A3B8] hover:bg-[#F4F6F9] dark:hover:bg-[#232732]'
            }`}
          >
            <Info className="w-[18px] h-[18px]" />
          </button>
        </div>
      </div>

      {/* Group Messages Stream OR Group Info Settings Drawer */}
      {showInfo ? (
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-5 bg-[#F8FAFC] dark:bg-[#101318]">
          {infoError && (
            <div className="flex items-start gap-2 rounded-xl bg-[#FEF2F2] dark:bg-[#3B181A] border border-[#FECACA] dark:border-[#7F1D1D] px-3 py-2 text-xs text-[#B91C1C] dark:text-[#FCA5A5]">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{infoError}</span>
            </div>
          )}

          {/* Group Identity Card */}
          <div className="bg-white dark:bg-[#16191F] border border-[#E5E8EE] dark:border-[#252A34] rounded-2xl p-4 flex flex-col items-center text-center space-y-3">
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              onChange={handleChangeGroupPhoto}
              className="hidden"
            />
            <div className="relative">
              <Avatar src={group.photoUrl} name={group.name} size="lg" />
              {isAdmin && (
                <button
                  type="button"
                  disabled={busyAction}
                  onClick={() => photoInputRef.current?.click()}
                  aria-label="Change group photo"
                  className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-[#1877F2] text-white flex items-center justify-center ring-2 ring-white dark:ring-[#16191F] cursor-pointer"
                >
                  <Camera className="w-4 h-4" />
                </button>
              )}
            </div>

            {editingName ? (
              <form onSubmit={handleSaveGroupName} className="w-full flex items-center gap-2">
                <input
                  type="text"
                  minLength={2}
                  maxLength={80}
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  className="flex-1 h-9 px-3 rounded-xl bg-[#F4F6F9] dark:bg-[#0E1014] text-sm text-[#0F172A] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1877F2]"
                />
                <button
                  type="submit"
                  disabled={busyAction}
                  className="px-3 h-9 rounded-xl bg-[#1877F2] text-white text-xs font-semibold cursor-pointer"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditingName(false);
                    setNameDraft(group.name);
                  }}
                  className="px-2.5 h-9 rounded-xl text-xs text-[#64748B] cursor-pointer"
                >
                  Cancel
                </button>
              </form>
            ) : (
              <div>
                <h3 className="font-display font-bold text-base text-[#0F172A] dark:text-white">
                  {group.name}
                </h3>
                <p className="text-xs text-[#64748B] dark:text-[#94A3B8]">
                  {group.memberUids.length} members · {group.adminUids.length} admin
                  {group.adminUids.length === 1 ? '' : 's'}
                </p>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => setEditingName(true)}
                    className="mt-2 text-xs font-semibold text-[#1877F2] dark:text-[#60A5FA] hover:underline cursor-pointer"
                  >
                    Change Group Name
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Members List & Admin Actions */}
          <div className="bg-white dark:bg-[#16191F] border border-[#E5E8EE] dark:border-[#252A34] rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-[#E5E8EE] dark:border-[#252A34] flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wide text-[#64748B] dark:text-[#94A3B8]">
                Members ({group.memberUids.length})
              </span>
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => setShowAddMembers((prev) => !prev)}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-[#1877F2] dark:text-[#60A5FA] hover:underline cursor-pointer"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>{showAddMembers ? 'Done' : 'Add Member'}</span>
                </button>
              )}
            </div>

            {showAddMembers && isAdmin && (
              <div className="p-3 bg-[#F8FAFC] dark:bg-[#101318] border-b border-[#E5E8EE] dark:border-[#252A34] space-y-2">
                <p className="text-[11px] font-semibold text-[#64748B] dark:text-[#94A3B8]">
                  Tap a friend to add to this group:
                </p>
                {nonMembers.length === 0 ? (
                  <p className="text-xs text-[#64748B]">All users are already in this group.</p>
                ) : (
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {nonMembers.map((u) => (
                      <div
                        key={u.uid}
                        className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl bg-white dark:bg-[#16191F]"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <Avatar src={u.avatar_url} name={u.name} size="xs" />
                          <span className="text-xs font-medium text-[#0F172A] dark:text-white truncate">
                            {u.name}
                          </span>
                        </div>
                        <button
                          type="button"
                          disabled={busyAction}
                          onClick={() => handleAddSingleMember(u)}
                          className="px-2.5 py-1 rounded-lg bg-[#1877F2] text-white text-[11px] font-semibold cursor-pointer"
                        >
                          Add
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="divide-y divide-[#E5E8EE] dark:divide-[#252A34]">
              {group.memberUids.map((uid) => {
                const profile = userByUid.get(uid);
                const name = profile?.name || 'Member';
                const memberIsCreator = uid === group.creatorUid;
                const memberIsAdmin = group.adminUids.includes(uid);
                return (
                  <div key={uid} className="px-4 py-2.5 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Avatar src={profile?.avatar_url || ''} name={name} size="xs" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-[#0F172A] dark:text-white truncate">
                          {name} {uid === myUid ? '(You)' : ''}
                        </p>
                        {memberIsCreator ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                            <Crown className="w-3 h-3" />
                            Creator &amp; Admin
                          </span>
                        ) : memberIsAdmin ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#1877F2] dark:text-[#60A5FA]">
                            <Shield className="w-3 h-3" />
                            Admin
                          </span>
                        ) : (
                          <span className="text-[11px] text-[#64748B] dark:text-[#94A3B8]">
                            Member
                          </span>
                        )}
                      </div>
                    </div>

                    {isAdmin && !memberIsCreator && uid !== myUid && (
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          disabled={busyAction}
                          onClick={() => handleToggleAdmin(uid, name)}
                          title={memberIsAdmin ? 'Remove Admin' : 'Make Admin'}
                          className="px-2 py-1 rounded-lg bg-[#F4F6F9] dark:bg-[#232732] hover:bg-[#E5E8EE] dark:hover:bg-[#2D3342] text-[11px] font-semibold text-[#0F172A] dark:text-white inline-flex items-center gap-1 cursor-pointer"
                        >
                          {memberIsAdmin ? (
                            <>
                              <ShieldOff className="w-3 h-3" />
                              <span>Demote</span>
                            </>
                          ) : (
                            <>
                              <Shield className="w-3 h-3 text-[#1877F2]" />
                              <span>Make Admin</span>
                            </>
                          )}
                        </button>
                        <button
                          type="button"
                          disabled={busyAction}
                          onClick={() => handleRemoveMember(uid, name)}
                          title="Remove from group"
                          className="p-1.5 rounded-lg text-[#DC2626] hover:bg-[#FEF2F2] dark:hover:bg-[#3B181A] cursor-pointer"
                        >
                          <UserMinus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Leave / Delete Group Button */}
          <button
            type="button"
            disabled={busyAction}
            onClick={handleLeaveOrDelete}
            className="w-full h-11 rounded-xl bg-[#FEF2F2] dark:bg-[#3B181A] hover:bg-[#FEE2E2] dark:hover:bg-[#4C1D20] text-[#DC2626] dark:text-[#FCA5A5] text-sm font-semibold inline-flex items-center justify-center gap-2 cursor-pointer"
          >
            {isCreator ? <Trash2 className="w-4 h-4" /> : <LogOut className="w-4 h-4" />}
            <span>{isCreator ? 'Delete Group' : 'Leave Group'}</span>
          </button>
        </div>
      ) : (
        <>
          {/* Real-time Messages List */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#F8FAFC] dark:bg-[#101318]">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center px-6">
                <Avatar src={group.photoUrl} name={group.name} size="lg" />
                <p className="font-display font-semibold text-sm text-[#0F172A] dark:text-white mt-3">
                  {group.name}
                </p>
                <p className="text-xs text-[#64748B] dark:text-[#94A3B8] mt-1">
                  Send a message, photo, video, voice note, or start a group call!
                </p>
              </div>
            ) : (
              messages.map((m) => (
                <ChatMessageBubble
                  key={m.id}
                  showSenderIdentity
                  onCallBack={(type) => onStartGroupCall(group, type)}
                  message={{
                    id: m.id,
                    mine: m.senderUid === myUid,
                    senderName: m.senderName,
                    senderAvatar: m.senderAvatar,
                    content: m.content,
                    messageType: m.messageType,
                    mediaUrl: m.mediaUrl,
                    mediaName: m.mediaName,
                    mediaSize: m.mediaSize,
                    voiceDurationSec: m.voiceDurationSec,
                    locationLat: m.locationLat,
                    locationLng: m.locationLng,
                    locationLabel: m.locationLabel,
                    callType: m.callType,
                    createdAt: m.createdAt,
                  }}
                />
              ))
            )}
            <div ref={scrollEndRef} />
          </div>

          {/* Messenger-style Input Bar */}
          <ChatInputBar
            uploadFolder={`group_chats/${group.id}`}
            placeholder={`Message ${group.name}...`}
            onSend={handleSendGroupPayload}
          />
        </>
      )}
    </div>
  );
}
