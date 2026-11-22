import {useMemo, useState} from 'react';
import {
  AlertCircle,
  Check,
  MessageSquare,
  Phone,
  Search,
  UserCheck,
  UserMinus,
  UserPlus,
  Video,
  X,
} from 'lucide-react';
import {formatRelativeTime} from '../lib/api';
import {formatFirestoreErrorMessage} from '../lib/firebase';
import {
  removeFriendshipPermanent,
  respondFriendRequestPermanent,
  sendFriendRequestPermanent,
  toggleFollowPermanent,
} from '../lib/firestoreStore';
import type {CallType, NetworkData, UserProfile} from '../types';
import {Avatar} from './MediaImage';

interface FriendsViewProps {
  currentUser: UserProfile;
  network: NetworkData;
  onlineUserIds: number[];
  onRefresh: () => void;
  onOpenProfile: (userId: number) => void;
  onOpenChat: (user: UserProfile) => void;
  onStartCall?: (peer: UserProfile, type: CallType) => void;
}

export function FriendsView({
  currentUser,
  network,
  onlineUserIds,
  onRefresh,
  onOpenProfile,
  onOpenChat,
  onStartCall,
}: FriendsViewProps) {
  const [tab, setTab] = useState<'requests' | 'friends' | 'discover'>(
    network.incomingRequests.length > 0 ? 'requests' : 'discover',
  );
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const followingSet = useMemo(() => new Set(network.followingIds), [network.followingIds]);
  const onlineSet = useMemo(() => new Set(onlineUserIds), [onlineUserIds]);

  const query = search.trim().toLowerCase();

  const filteredFriends = network.friends.filter(
    (u) =>
      !query ||
      u.name.toLowerCase().includes(query) ||
      u.work.toLowerCase().includes(query) ||
      u.bio.toLowerCase().includes(query),
  );

  const filteredSuggestions = network.suggestions.filter(
    (u) =>
      !query ||
      u.name.toLowerCase().includes(query) ||
      u.work.toLowerCase().includes(query) ||
      u.bio.toLowerCase().includes(query),
  );

  async function handleRespond(requester: UserProfile, action: 'accept' | 'decline') {
    setBusyId(requester.id);
    setActionError(null);
    try {
      await respondFriendRequestPermanent(currentUser, requester, action);
      onRefresh();
    } catch (err) {
      setActionError(formatFirestoreErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function handleSendRequest(target: UserProfile) {
    setBusyId(target.id);
    setActionError(null);
    try {
      await sendFriendRequestPermanent(currentUser, target);
      onRefresh();
    } catch (err) {
      setActionError(formatFirestoreErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function handleRemoveOrCancel(target: UserProfile) {
    if (!currentUser.uid || !target.uid) return;
    setBusyId(target.id);
    setActionError(null);
    try {
      await removeFriendshipPermanent(currentUser.uid, target.uid);
      onRefresh();
    } catch (err) {
      setActionError(formatFirestoreErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function handleToggleFollow(target: UserProfile) {
    setBusyId(target.id);
    setActionError(null);
    try {
      await toggleFollowPermanent(currentUser, target);
      onRefresh();
    } catch (err) {
      setActionError(formatFirestoreErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-5">
      {/* Header & Controls */}
      <div className="bg-white dark:bg-[#1C1E21] border border-[#E4E6EB] dark:border-[#2E3035] rounded-2xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-display font-bold text-[#111827] dark:text-white">
              Friends &amp; People
            </h1>
            <p className="text-xs text-[#65676B] dark:text-[#9CA3AF] mt-0.5 tabular-nums">
              {network.friends.length} friends · {network.incomingRequests.length} incoming requests ·{' '}
              {network.followingIds.length} following
            </p>
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 text-[#65676B] dark:text-[#9CA3AF] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search people..."
              className="w-full h-10 pl-9 pr-3 rounded-xl bg-[#F0F2F5] dark:bg-[#121316] text-sm text-[#111827] dark:text-white placeholder:text-[#65676B] dark:placeholder:text-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#1877F2]"
            />
          </div>
        </div>

        {actionError && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-xl bg-[#FEF2F2] dark:bg-[#3B181A] border border-[#FECACA] dark:border-[#7F1D1D] px-3.5 py-2.5 text-xs font-medium text-[#B91C1C] dark:text-[#FCA5A5]"
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{actionError}</span>
          </div>
        )}

        <div className="flex items-center gap-1 p-1 rounded-xl bg-[#F0F2F5] dark:bg-[#121316] w-fit max-w-full overflow-x-auto">
          <button
            type="button"
            onClick={() => setTab('requests')}
            className={`px-3.5 py-2 rounded-lg text-sm font-semibold transition-colors whitespace-nowrap cursor-pointer ${
              tab === 'requests'
                ? 'bg-white dark:bg-[#2A2D32] text-[#111827] dark:text-white shadow-xs'
                : 'text-[#65676B] dark:text-[#9CA3AF] hover:text-[#111827] dark:hover:text-white'
            }`}
          >
            Requests ({network.incomingRequests.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('friends')}
            className={`px-3.5 py-2 rounded-lg text-sm font-semibold transition-colors whitespace-nowrap cursor-pointer ${
              tab === 'friends'
                ? 'bg-white dark:bg-[#2A2D32] text-[#111827] dark:text-white shadow-xs'
                : 'text-[#65676B] dark:text-[#9CA3AF] hover:text-[#111827] dark:hover:text-white'
            }`}
          >
            Your Friends ({network.friends.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('discover')}
            className={`px-3.5 py-2 rounded-lg text-sm font-semibold transition-colors whitespace-nowrap cursor-pointer ${
              tab === 'discover'
                ? 'bg-white dark:bg-[#2A2D32] text-[#111827] dark:text-white shadow-xs'
                : 'text-[#65676B] dark:text-[#9CA3AF] hover:text-[#111827] dark:hover:text-white'
            }`}
          >
            Discover ({network.suggestions.length})
          </button>
        </div>
      </div>

      {/* TAB 1: REQUESTS */}
      {tab === 'requests' && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-[#1C1E21] border border-[#E4E6EB] dark:border-[#2E3035] rounded-2xl divide-y divide-[#E4E6EB] dark:divide-[#2E3035]">
            <div className="px-5 py-3.5">
              <h2 className="text-sm font-display font-bold text-[#111827] dark:text-white">
                Incoming Friend Requests
              </h2>
            </div>

            {network.incomingRequests.length === 0 ? (
              <div className="p-8 text-center text-sm text-[#65676B] dark:text-[#9CA3AF]">
                No pending friend requests right now.
              </div>
            ) : (
              network.incomingRequests.map((reqUser) => (
                <div
                  key={reqUser.id}
                  className="p-4 sm:px-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <button
                      type="button"
                      onClick={() => onOpenProfile(reqUser.id)}
                      className="shrink-0 cursor-pointer rounded-full"
                    >
                      <Avatar
                        src={reqUser.avatar_url}
                        name={reqUser.name}
                        size="lg"
                        online={onlineSet.has(reqUser.id)}
                      />
                    </button>
                    <div className="min-w-0">
                      <button
                        type="button"
                        onClick={() => onOpenProfile(reqUser.id)}
                        className="font-display font-semibold text-base text-[#111827] dark:text-white hover:underline truncate block cursor-pointer"
                      >
                        {reqUser.name}
                      </button>
                      <p className="text-xs text-[#65676B] dark:text-[#9CA3AF] truncate">
                        {reqUser.work || reqUser.bio || 'Verve member'} ·{' '}
                        {formatRelativeTime(reqUser.requested_at)}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={busyId === reqUser.id}
                      onClick={() => handleRespond(reqUser, 'accept')}
                      className="inline-flex items-center gap-1.5 px-4 h-10 rounded-xl bg-[#1877F2] hover:bg-[#166FE5] text-white text-sm font-semibold transition-colors cursor-pointer"
                    >
                      <Check className="w-4 h-4" />
                      <span>Confirm</span>
                    </button>
                    <button
                      type="button"
                      disabled={busyId === reqUser.id}
                      onClick={() => handleRespond(reqUser, 'decline')}
                      className="inline-flex items-center gap-1.5 px-4 h-10 rounded-xl bg-[#F0F2F5] dark:bg-[#2A2D32] hover:bg-[#E4E6EB] dark:hover:bg-[#35383E] text-[#111827] dark:text-white text-sm font-semibold transition-colors cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                      <span>Decline</span>
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {network.outgoingRequests.length > 0 && (
            <div className="bg-white dark:bg-[#1C1E21] border border-[#E4E6EB] dark:border-[#2E3035] rounded-2xl divide-y divide-[#E4E6EB] dark:divide-[#2E3035]">
              <div className="px-5 py-3.5">
                <h2 className="text-sm font-display font-bold text-[#111827] dark:text-white">
                  Sent Requests
                </h2>
              </div>
              {network.outgoingRequests.map((u) => (
                <div key={u.id} className="p-4 sm:px-5 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <button
                      type="button"
                      onClick={() => onOpenProfile(u.id)}
                      className="shrink-0 cursor-pointer"
                    >
                      <Avatar src={u.avatar_url} name={u.name} size="md" />
                    </button>
                    <div className="min-w-0">
                      <button
                        type="button"
                        onClick={() => onOpenProfile(u.id)}
                        className="font-display font-semibold text-sm text-[#111827] dark:text-white hover:underline truncate block cursor-pointer"
                      >
                        {u.name}
                      </button>
                      <p className="text-xs text-[#65676B] dark:text-[#9CA3AF]">
                        Sent {formatRelativeTime(u.requested_at)}
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={busyId === u.id}
                    onClick={() => handleRemoveOrCancel(u)}
                    className="px-3.5 h-9 rounded-xl border border-[#D1D5DB] dark:border-[#374151] text-xs font-semibold text-[#374151] dark:text-[#D1D5DB] hover:bg-[#F0F2F5] dark:hover:bg-[#2A2D32] cursor-pointer"
                  >
                    Cancel Request
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: YOUR FRIENDS */}
      {tab === 'friends' && (
        <div className="bg-white dark:bg-[#1C1E21] border border-[#E4E6EB] dark:border-[#2E3035] rounded-2xl divide-y divide-[#E4E6EB] dark:divide-[#2E3035]">
          {filteredFriends.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm font-medium text-[#111827] dark:text-white">
                {search ? 'No friends match your search' : 'No friends added yet'}
              </p>
              <button
                type="button"
                onClick={() => setTab('discover')}
                className="mt-3 px-4 py-2 rounded-xl bg-[#1877F2] text-white text-xs font-semibold cursor-pointer"
              >
                Discover People
              </button>
            </div>
          ) : (
            filteredFriends.map((friend) => (
              <div
                key={friend.id}
                className="p-4 sm:px-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <button
                    type="button"
                    onClick={() => onOpenProfile(friend.id)}
                    className="shrink-0 cursor-pointer"
                  >
                    <Avatar
                      src={friend.avatar_url}
                      name={friend.name}
                      size="lg"
                      online={onlineSet.has(friend.id)}
                    />
                  </button>
                  <div className="min-w-0">
                    <button
                      type="button"
                      onClick={() => onOpenProfile(friend.id)}
                      className="font-display font-semibold text-base text-[#111827] dark:text-white hover:underline truncate block cursor-pointer"
                    >
                      {friend.name}
                    </button>
                    <p className="text-xs text-[#65676B] dark:text-[#9CA3AF] truncate">
                      {friend.work || friend.location || friend.bio || 'Connected on Verve'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0 flex-wrap">
                  {onStartCall && friend.uid && (
                    <>
                      <button
                        type="button"
                        onClick={() => onStartCall(friend, 'audio')}
                        title="Audio Call"
                        aria-label={`Audio call ${friend.name}`}
                        className="w-9 h-9 rounded-xl bg-[#1877F2]/10 hover:bg-[#1877F2]/20 text-[#1877F2] dark:text-[#60A5FA] flex items-center justify-center transition-colors cursor-pointer"
                      >
                        <Phone className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onStartCall(friend, 'video')}
                        title="Video Call"
                        aria-label={`Video call ${friend.name}`}
                        className="w-9 h-9 rounded-xl bg-[#1877F2]/10 hover:bg-[#1877F2]/20 text-[#1877F2] dark:text-[#60A5FA] flex items-center justify-center transition-colors cursor-pointer"
                      >
                        <Video className="w-4 h-4" />
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => onOpenChat(friend)}
                    className="inline-flex items-center gap-1.5 px-3.5 h-9 rounded-xl bg-[#1877F2] hover:bg-[#166FE5] text-white text-xs font-semibold cursor-pointer"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    <span>Message</span>
                  </button>
                  <button
                    type="button"
                    disabled={busyId === friend.id}
                    onClick={() => handleRemoveOrCancel(friend)}
                    className="inline-flex items-center gap-1.5 px-3 h-9 rounded-xl border border-[#D1D5DB] dark:border-[#374151] text-xs font-semibold text-[#374151] dark:text-[#D1D5DB] hover:bg-[#F0F2F5] dark:hover:bg-[#2A2D32] cursor-pointer"
                  >
                    <UserMinus className="w-3.5 h-3.5" />
                    <span>Unfriend</span>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* TAB 3: DISCOVER */}
      {tab === 'discover' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {filteredSuggestions.length === 0 ? (
            <div className="sm:col-span-2 bg-white dark:bg-[#1C1E21] border border-[#E4E6EB] dark:border-[#2E3035] rounded-2xl p-8 text-center text-sm text-[#65676B] dark:text-[#9CA3AF]">
              You are connected with everyone in the directory right now.
            </div>
          ) : (
            filteredSuggestions.map((person) => {
              const isFollowing = followingSet.has(person.id);
              return (
                <div
                  key={person.id}
                  className="bg-white dark:bg-[#1C1E21] border border-[#E4E6EB] dark:border-[#2E3035] rounded-2xl p-5 flex flex-col justify-between gap-4"
                >
                  <div className="flex items-start gap-3">
                    <button
                      type="button"
                      onClick={() => onOpenProfile(person.id)}
                      className="shrink-0 cursor-pointer"
                    >
                      <Avatar
                        src={person.avatar_url}
                        name={person.name}
                        size="lg"
                        online={onlineSet.has(person.id)}
                      />
                    </button>
                    <div className="min-w-0">
                      <button
                        type="button"
                        onClick={() => onOpenProfile(person.id)}
                        className="font-display font-semibold text-base text-[#111827] dark:text-white hover:underline truncate block cursor-pointer"
                      >
                        {person.name}
                      </button>
                      {person.work && (
                        <p className="text-xs text-[#65676B] dark:text-[#9CA3AF] truncate mt-0.5">
                          {person.work}
                        </p>
                      )}
                      {person.bio && (
                        <p className="text-xs text-[#4B5563] dark:text-[#9CA3AF] line-clamp-2 mt-1.5 leading-relaxed">
                          {person.bio}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-2 border-t border-[#E4E6EB] dark:border-[#2E3035]">
                    <button
                      type="button"
                      disabled={busyId === person.id}
                      onClick={() => handleSendRequest(person)}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 h-9 rounded-xl bg-[#1877F2] hover:bg-[#166FE5] text-white text-xs font-semibold transition-colors cursor-pointer"
                    >
                      <UserPlus className="w-3.5 h-3.5" />
                      <span>Add Friend</span>
                    </button>
                    <button
                      type="button"
                      disabled={busyId === person.id}
                      onClick={() => handleToggleFollow(person)}
                      className={`inline-flex items-center justify-center gap-1.5 px-3.5 h-9 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
                        isFollowing
                          ? 'border border-[#1877F2] text-[#1877F2] dark:border-[#60A5FA] dark:text-[#60A5FA]'
                          : 'border border-[#D1D5DB] dark:border-[#374151] text-[#374151] dark:text-[#D1D5DB] hover:bg-[#F0F2F5] dark:hover:bg-[#2A2D32]'
                      }`}
                    >
                      <UserCheck className="w-3.5 h-3.5" />
                      <span>{isFollowing ? 'Following' : 'Follow'}</span>
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
