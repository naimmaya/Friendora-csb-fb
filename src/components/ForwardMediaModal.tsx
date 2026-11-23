import {useMemo, useState} from 'react';
import {AlertCircle, Check, Forward, Loader2, Search, Send, Users, X} from 'lucide-react';
import {formatFirestoreErrorMessage} from '../lib/firebase';
import {sendMessagePermanent} from '../lib/firestoreStore';
import {sendGroupMessagePermanent} from '../lib/groupService';
import type {ChatGroupDoc, UserProfile} from '../types';
import type {UnifiedBubbleMessage} from './ChatMessageBubble';
import {Avatar, useResolvedMediaUrl} from './MediaImage';

interface ForwardMediaModalProps {
  message: UnifiedBubbleMessage;
  currentUser: UserProfile;
  users: UserProfile[];
  groups: ChatGroupDoc[];
  onClose: () => void;
}

export function ForwardMediaModal({
  message,
  currentUser,
  users,
  groups,
  onClose,
}: ForwardMediaModalProps) {
  const [search, setSearch] = useState('');
  const [sendingKeys, setSendingKeys] = useState<Record<string, boolean>>({});
  const [sentKeys, setSentKeys] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const resolvedPreview = useResolvedMediaUrl(message.mediaUrl || null);

  const myUid = currentUser.uid || '';

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (!u.uid || u.uid === myUid) return false;
      if (!q) return true;
      return u.name.toLowerCase().includes(q);
    });
  }, [users, myUid, search]);

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    return groups.filter((g) => {
      if (!q) return true;
      return g.name.toLowerCase().includes(q);
    });
  }, [groups, search]);

  const forwardMessageType =
    message.messageType === 'system' || message.messageType === 'call'
      ? 'text'
      : message.messageType;

  async function forwardToUser(target: UserProfile) {
    if (!myUid || !target.uid) return;
    const key = `user:${target.uid}`;
    if (sendingKeys[key] || sentKeys[key]) return;
    setError(null);
    setSendingKeys((prev) => ({...prev, [key]: true}));
    try {
      await sendMessagePermanent(myUid, target.uid, message.content || '', undefined, {
        messageType: forwardMessageType,
        mediaUrl: message.mediaUrl,
        mediaName: message.mediaName,
        mediaSize: message.mediaSize,
        voiceDurationSec: message.voiceDurationSec,
        locationLat: message.locationLat,
        locationLng: message.locationLng,
        locationLabel: message.locationLabel,
      });
      setSentKeys((prev) => ({...prev, [key]: true}));
    } catch (err) {
      setError(formatFirestoreErrorMessage(err));
    } finally {
      setSendingKeys((prev) => ({...prev, [key]: false}));
    }
  }

  async function forwardToGroup(group: ChatGroupDoc) {
    if (!myUid) return;
    const key = `group:${group.id}`;
    if (sendingKeys[key] || sentKeys[key]) return;
    setError(null);
    setSendingKeys((prev) => ({...prev, [key]: true}));
    try {
      await sendGroupMessagePermanent({
        groupId: group.id,
        sender: currentUser,
        content: message.content || '',
        messageType: forwardMessageType,
        mediaUrl: message.mediaUrl,
        mediaName: message.mediaName,
        mediaSize: message.mediaSize,
        voiceDurationSec: message.voiceDurationSec,
        locationLat: message.locationLat,
        locationLng: message.locationLng,
        locationLabel: message.locationLabel,
      });
      setSentKeys((prev) => ({...prev, [key]: true}));
    } catch (err) {
      setError(formatFirestoreErrorMessage(err));
    } finally {
      setSendingKeys((prev) => ({...prev, [key]: false}));
    }
  }

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[140] bg-black/65 backdrop-blur-xs flex items-end sm:items-center justify-center p-3 sm:p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-white dark:bg-[#16191F] border border-[#E5E8EE] dark:border-[#252A34] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
      >
        {/* Header */}
        <div className="px-4 py-3.5 border-b border-[#E5E8EE] dark:border-[#252A34] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Forward className="w-4 h-4 text-[#1877F2] dark:text-[#60A5FA]" />
            <h3 className="font-display font-bold text-sm text-[#0F172A] dark:text-white">
              Forward Photo
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close forward modal"
            className="w-8 h-8 rounded-full hover:bg-[#F4F6F9] dark:hover:bg-[#232732] text-[#64748B] flex items-center justify-center cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Media preview + Search */}
        <div className="p-3.5 border-b border-[#E5E8EE] dark:border-[#252A34] space-y-3">
          {resolvedPreview && message.messageType === 'image' && (
            <div className="flex items-center gap-3 p-2 rounded-xl bg-[#F8FAFC] dark:bg-[#0E1014] border border-[#E5E8EE] dark:border-[#252A34]">
              <img
                src={resolvedPreview}
                alt="Photo to forward"
                className="w-12 h-12 rounded-lg object-cover shrink-0 bg-black"
              />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-[#0F172A] dark:text-white truncate">
                  {message.content || 'Photo'}
                </p>
                <p className="text-[11px] text-[#64748B] dark:text-[#94A3B8] truncate">
                  Select a friend or group to send
                </p>
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-xl bg-[#FEF2F2] dark:bg-[#3B181A] border border-[#FECACA] dark:border-[#7F1D1D] px-3 py-2 text-xs text-[#B91C1C] dark:text-[#FCA5A5]">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="relative">
            <Search className="w-4 h-4 text-[#64748B] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search people or groups..."
              className="w-full h-9 pl-9 pr-3 rounded-xl bg-[#F4F6F9] dark:bg-[#0E1014] text-xs text-[#0F172A] dark:text-white placeholder:text-[#64748B] focus:outline-none focus:ring-2 focus:ring-[#1877F2]/30"
            />
          </div>
        </div>

        {/* Recipients List */}
        <div className="overflow-y-auto flex-1 divide-y divide-[#E5E8EE] dark:divide-[#252A34]">
          {filteredUsers.length === 0 && filteredGroups.length === 0 ? (
            <div className="p-8 text-center text-xs text-[#64748B] dark:text-[#94A3B8]">
              No matching people or groups found.
            </div>
          ) : (
            <>
              {filteredUsers.map((u) => {
                const key = `user:${u.uid}`;
                const isSending = Boolean(sendingKeys[key]);
                const isSent = Boolean(sentKeys[key]);
                return (
                  <div
                    key={key}
                    className="px-4 py-2.5 flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Avatar src={u.avatar_url} name={u.name} size="sm" />
                      <span className="text-sm font-medium text-[#0F172A] dark:text-white truncate">
                        {u.name}
                      </span>
                    </div>
                    <button
                      type="button"
                      disabled={isSending || isSent}
                      onClick={() => void forwardToUser(u)}
                      className={`h-8 px-3.5 rounded-full text-xs font-semibold inline-flex items-center gap-1 shrink-0 transition-colors cursor-pointer ${
                        isSent
                          ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 cursor-default'
                          : 'bg-[#1877F2] hover:bg-[#166FE5] text-white disabled:opacity-60'
                      }`}
                    >
                      {isSending ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : isSent ? (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          <span>Sent</span>
                        </>
                      ) : (
                        <>
                          <Send className="w-3 h-3" />
                          <span>Send</span>
                        </>
                      )}
                    </button>
                  </div>
                );
              })}

              {filteredGroups.map((g) => {
                const key = `group:${g.id}`;
                const isSending = Boolean(sendingKeys[key]);
                const isSent = Boolean(sentKeys[key]);
                return (
                  <div
                    key={key}
                    className="px-4 py-2.5 flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Avatar src={g.photoUrl} name={g.name} size="sm" />
                      <div className="min-w-0">
                        <span className="text-sm font-medium text-[#0F172A] dark:text-white truncate block">
                          {g.name}
                        </span>
                        <span className="text-[11px] text-[#64748B] dark:text-[#94A3B8] inline-flex items-center gap-1">
                          <Users className="w-3 h-3" />
                          Group · {g.memberUids.length} members
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={isSending || isSent}
                      onClick={() => void forwardToGroup(g)}
                      className={`h-8 px-3.5 rounded-full text-xs font-semibold inline-flex items-center gap-1 shrink-0 transition-colors cursor-pointer ${
                        isSent
                          ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 cursor-default'
                          : 'bg-[#1877F2] hover:bg-[#166FE5] text-white disabled:opacity-60'
                      }`}
                    >
                      {isSending ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : isSent ? (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          <span>Sent</span>
                        </>
                      ) : (
                        <>
                          <Send className="w-3 h-3" />
                          <span>Send</span>
                        </>
                      )}
                    </button>
                  </div>
                );
              })}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-[#E5E8EE] dark:border-[#252A34] flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 h-9 rounded-xl bg-[#F4F6F9] dark:bg-[#232732] hover:bg-[#E5E8EE] dark:hover:bg-[#2D3342] text-xs font-semibold text-[#0F172A] dark:text-white cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
