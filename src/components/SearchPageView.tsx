import {useEffect, useMemo, useRef, useState} from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  Clock,
  ExternalLink,
  Flag,
  Heart,
  Loader2,
  MessageSquare,
  Search,
  UserCheck,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import {formatFirestoreErrorMessage} from '../lib/firebase';
import {
  removeFriendshipPermanent,
  respondFriendRequestPermanent,
  sendFriendRequestPermanent,
} from '../lib/firestoreStore';
import {togglePageFollowPermanent} from '../lib/pageService';
import type {NetworkData, SocialPageDoc, UserProfile} from '../types';
import {Avatar} from './MediaImage';

interface SearchPageViewProps {
  currentUser: UserProfile;
  allUsers: UserProfile[];
  pages: SocialPageDoc[];
  network: NetworkData;
  onlineUserIds: number[];
  onBack: () => void;
  onOpenProfile: (userId: number) => void;
  onOpenChat: (user: UserProfile) => void;
  onOpenPage: (pageId: string) => void;
}

type SearchFilter = 'all' | 'people' | 'pages';

export function SearchPageView({
  currentUser,
  allUsers,
  pages,
  network,
  onlineUserIds,
  onBack,
  onOpenProfile,
  onOpenChat,
  onOpenPage,
}: SearchPageViewProps) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<SearchFilter>('all');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const myUid = currentUser.uid || '';
  const onlineSet = useMemo(() => new Set(onlineUserIds), [onlineUserIds]);
  const friendIds = useMemo(() => new Set(network.friends.map((u) => u.id)), [network.friends]);
  const outgoingIds = useMemo(
    () => new Set(network.outgoingRequests.map((u) => u.id)),
    [network.outgoingRequests],
  );
  const incomingIds = useMemo(
    () => new Set(network.incomingRequests.map((u) => u.id)),
    [network.incomingRequests],
  );

  const normalizedQuery = query.trim().toLowerCase();

  // Real-time Firestore People (users excluding current user)
  const matchingPeople = useMemo(() => {
    const others = allUsers.filter((u) => u.uid !== myUid && u.id !== currentUser.id);
    if (!normalizedQuery) return others;
    return others.filter(
      (u) =>
        u.name.toLowerCase().includes(normalizedQuery) ||
        u.work.toLowerCase().includes(normalizedQuery) ||
        u.location.toLowerCase().includes(normalizedQuery) ||
        u.bio.toLowerCase().includes(normalizedQuery),
    );
  }, [allUsers, myUid, currentUser.id, normalizedQuery]);

  // Real-time Firestore Pages
  const matchingPages = useMemo(() => {
    if (!normalizedQuery) return pages;
    return pages.filter(
      (p) =>
        p.pageName.toLowerCase().includes(normalizedQuery) ||
        p.category.toLowerCase().includes(normalizedQuery) ||
        p.bio.toLowerCase().includes(normalizedQuery),
    );
  }, [pages, normalizedQuery]);

  const showPeople = filter === 'all' || filter === 'people';
  const showPages = filter === 'all' || filter === 'pages';

  async function handleFriendAction(person: UserProfile) {
    if (!myUid || !person.uid) return;
    const key = `user:${person.id}`;
    setBusyKey(key);
    setActionError(null);
    try {
      if (friendIds.has(person.id)) {
        return;
      }
      if (outgoingIds.has(person.id)) {
        await removeFriendshipPermanent(myUid, person.uid);
      } else if (incomingIds.has(person.id)) {
        await respondFriendRequestPermanent(currentUser, person, 'accept');
      } else {
        await sendFriendRequestPermanent(currentUser, person);
      }
    } catch (err) {
      setActionError(formatFirestoreErrorMessage(err));
    } finally {
      setBusyKey(null);
    }
  }

  async function handleToggleFollowPage(page: SocialPageDoc) {
    if (!myUid) return;
    const key = `page:${page.pageId}`;
    setBusyKey(key);
    setActionError(null);
    try {
      await togglePageFollowPermanent(page, myUid);
    } catch (err) {
      setActionError(formatFirestoreErrorMessage(err));
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="space-y-4">
      {/* Top Search Header + Filter Tabs ([All] [People] [Pages]) */}
      <div className="bg-white dark:bg-[#16191F] border border-[#E5E8EE] dark:border-[#252A34] rounded-2xl p-4 space-y-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to Home"
            className="w-10 h-10 rounded-full hover:bg-[#F0F2F5] dark:hover:bg-[#232732] text-[#0F172A] dark:text-white flex items-center justify-center shrink-0 transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>

          <div className="relative flex-1 min-w-0">
            <Search className="w-4 h-4 text-[#64748B] dark:text-[#94A3B8] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search people & pages..."
              className="w-full h-10 pl-10 pr-9 rounded-full bg-[#F0F2F5] dark:bg-[#0E1014] text-sm text-[#0F172A] dark:text-white placeholder:text-[#64748B] dark:placeholder:text-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#1877F2]"
            />
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  inputRef.current?.focus();
                }}
                aria-label="Clear search"
                className="w-6 h-6 rounded-full bg-[#CBD5E1]/70 dark:bg-[#2A2F3A] text-[#334155] dark:text-[#E2E8F0] flex items-center justify-center absolute right-2.5 top-1/2 -translate-y-1/2 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Filter: [All] [People] [Pages] */}
        <div className="flex items-center gap-1.5 p-1 rounded-xl bg-[#F0F2F5] dark:bg-[#0E1014] w-fit max-w-full overflow-x-auto">
          <button
            type="button"
            onClick={() => setFilter('all')}
            className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
              filter === 'all'
                ? 'bg-[#1877F2] text-white shadow-xs'
                : 'text-[#64748B] dark:text-[#94A3B8] hover:text-[#0F172A] dark:hover:text-white'
            }`}
          >
            All ({matchingPeople.length + matchingPages.length})
          </button>
          <button
            type="button"
            onClick={() => setFilter('people')}
            className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
              filter === 'people'
                ? 'bg-[#1877F2] text-white shadow-xs'
                : 'text-[#64748B] dark:text-[#94A3B8] hover:text-[#0F172A] dark:hover:text-white'
            }`}
          >
            People ({matchingPeople.length})
          </button>
          <button
            type="button"
            onClick={() => setFilter('pages')}
            className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
              filter === 'pages'
                ? 'bg-[#1877F2] text-white shadow-xs'
                : 'text-[#64748B] dark:text-[#94A3B8] hover:text-[#0F172A] dark:hover:text-white'
            }`}
          >
            Pages ({matchingPages.length})
          </button>
        </div>

        {actionError && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-xl bg-[#FEF2F2] dark:bg-[#3B181A] border border-[#FECACA] dark:border-[#7F1D1D] px-3.5 py-2.5 text-xs font-medium text-[#B91C1C] dark:text-[#FCA5A5]"
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="flex-1">{actionError}</span>
            <button
              type="button"
              onClick={() => setActionError(null)}
              aria-label="Dismiss error"
              className="p-0.5 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* SECTION 1 — "People" (Firestore users: Photo + Name + [View Profile] [Add Friend] [Message]) */}
      {showPeople && (
        <section className="bg-white dark:bg-[#16191F] border border-[#E5E8EE] dark:border-[#252A34] rounded-2xl overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="px-4 sm:px-5 py-3.5 border-b border-[#E5E8EE] dark:border-[#252A34] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-[#1877F2] dark:text-[#60A5FA]" />
              <h2 className="font-display font-bold text-sm sm:text-base text-[#0F172A] dark:text-white">
                People
              </h2>
            </div>
            <span className="text-xs text-[#64748B] dark:text-[#94A3B8] tabular-nums">
              {matchingPeople.length} {matchingPeople.length === 1 ? 'person' : 'people'}
            </span>
          </div>

          {matchingPeople.length === 0 ? (
            <div className="p-8 text-center text-sm text-[#64748B] dark:text-[#94A3B8]">
              {normalizedQuery
                ? `No people found for "${query.trim()}".`
                : 'No other users on Verve yet.'}
            </div>
          ) : (
            <div className="divide-y divide-[#E5E8EE] dark:divide-[#252A34]">
              {matchingPeople.map((person) => {
                const isFriend = friendIds.has(person.id);
                const isOutgoing = outgoingIds.has(person.id);
                const isIncoming = incomingIds.has(person.id);
                const isBusy = busyKey === `user:${person.id}`;

                return (
                  <div key={person.id} className="p-4 sm:px-5 space-y-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <button
                        type="button"
                        onClick={() => onOpenProfile(person.id)}
                        className="shrink-0 cursor-pointer rounded-full"
                      >
                        <Avatar
                          src={person.avatar_url}
                          name={person.name}
                          size="md"
                          online={onlineSet.has(person.id)}
                        />
                      </button>
                      <div className="min-w-0 flex-1">
                        <button
                          type="button"
                          onClick={() => onOpenProfile(person.id)}
                          className="font-display font-semibold text-sm sm:text-base text-[#0F172A] dark:text-white hover:underline truncate block text-left cursor-pointer"
                        >
                          {person.name}
                        </button>
                        <p className="text-xs text-[#64748B] dark:text-[#94A3B8] truncate">
                          {person.work || person.location || person.bio || 'Verve member'}
                        </p>
                      </div>
                    </div>

                    {/* [View Profile] [Add Friend] [Message] */}
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onOpenProfile(person.id)}
                        className="inline-flex items-center justify-center gap-1.5 px-3.5 h-9 rounded-xl bg-[#F0F2F5] dark:bg-[#232732] hover:bg-[#E4E6EB] dark:hover:bg-[#2E3442] text-xs font-semibold text-[#0F172A] dark:text-white transition-colors cursor-pointer"
                      >
                        <span>View Profile</span>
                      </button>

                      {isFriend ? (
                        <span className="inline-flex items-center justify-center gap-1.5 px-3.5 h-9 rounded-xl bg-emerald-500/12 text-emerald-700 dark:text-emerald-400 text-xs font-semibold">
                          <UserCheck className="w-3.5 h-3.5" />
                          <span>Friends</span>
                        </span>
                      ) : isOutgoing ? (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => void handleFriendAction(person)}
                          className="inline-flex items-center justify-center gap-1.5 px-3.5 h-9 rounded-xl border border-[#CBD5E1] dark:border-[#374151] hover:bg-[#F0F2F5] dark:hover:bg-[#232732] text-xs font-semibold text-[#334155] dark:text-[#CBD5E1] disabled:opacity-50 transition-colors cursor-pointer"
                        >
                          {isBusy ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Clock className="w-3.5 h-3.5" />
                          )}
                          <span>Cancel Request</span>
                        </button>
                      ) : isIncoming ? (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => void handleFriendAction(person)}
                          className="inline-flex items-center justify-center gap-1.5 px-3.5 h-9 rounded-xl bg-[#1877F2] hover:bg-[#166FE5] text-white text-xs font-semibold disabled:opacity-50 transition-colors cursor-pointer"
                        >
                          {isBusy ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Check className="w-3.5 h-3.5" />
                          )}
                          <span>Confirm Friend</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => void handleFriendAction(person)}
                          className="inline-flex items-center justify-center gap-1.5 px-3.5 h-9 rounded-xl bg-[#1877F2] hover:bg-[#166FE5] text-white text-xs font-semibold disabled:opacity-50 transition-colors cursor-pointer"
                        >
                          {isBusy ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <UserPlus className="w-3.5 h-3.5" />
                          )}
                          <span>Add Friend</span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => onOpenChat(person)}
                        className="inline-flex items-center justify-center gap-1.5 px-3.5 h-9 rounded-xl bg-[#1877F2]/12 hover:bg-[#1877F2]/20 text-[#1877F2] dark:text-[#60A5FA] text-xs font-semibold transition-colors cursor-pointer"
                      >
                        <MessageSquare className="w-3.5 h-3.5" />
                        <span>Message</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* SECTION 2 — "Pages" (Firestore pages: Page Photo + Page Name + [View Page] [Like / Follow]) */}
      {showPages && (
        <section className="bg-white dark:bg-[#16191F] border border-[#E5E8EE] dark:border-[#252A34] rounded-2xl overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="px-4 sm:px-5 py-3.5 border-b border-[#E5E8EE] dark:border-[#252A34] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Flag className="w-4 h-4 text-[#1877F2] dark:text-[#60A5FA]" />
              <h2 className="font-display font-bold text-sm sm:text-base text-[#0F172A] dark:text-white">
                Pages
              </h2>
            </div>
            <span className="text-xs text-[#64748B] dark:text-[#94A3B8] tabular-nums">
              {matchingPages.length} {matchingPages.length === 1 ? 'page' : 'pages'}
            </span>
          </div>

          {matchingPages.length === 0 ? (
            <div className="p-8 text-center text-sm text-[#64748B] dark:text-[#94A3B8]">
              {normalizedQuery
                ? `No pages found for "${query.trim()}".`
                : 'No Pages created on Verve yet.'}
            </div>
          ) : (
            <div className="divide-y divide-[#E5E8EE] dark:divide-[#252A34]">
              {matchingPages.map((page) => {
                const isFollowing = Boolean(myUid && page.followers.includes(myUid));
                const isBusy = busyKey === `page:${page.pageId}`;
                return (
                  <div key={page.pageId} className="p-4 sm:px-5 space-y-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <button
                        type="button"
                        onClick={() => onOpenPage(page.pageId)}
                        className="shrink-0 cursor-pointer rounded-full"
                      >
                        <Avatar src={page.pagePhoto} name={page.pageName} size="md" />
                      </button>
                      <div className="min-w-0 flex-1">
                        <button
                          type="button"
                          onClick={() => onOpenPage(page.pageId)}
                          className="font-display font-semibold text-sm sm:text-base text-[#0F172A] dark:text-white hover:underline truncate block text-left cursor-pointer"
                        >
                          {page.pageName}
                        </button>
                        <p className="text-xs text-[#64748B] dark:text-[#94A3B8] truncate tabular-nums">
                          {page.category} · {page.followers.length}{' '}
                          {page.followers.length === 1 ? 'follower' : 'followers'}
                        </p>
                      </div>
                    </div>

                    {/* [View Page] [Like / Follow] */}
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onOpenPage(page.pageId)}
                        className="inline-flex items-center justify-center gap-1.5 px-3.5 h-9 rounded-xl bg-[#F0F2F5] dark:bg-[#232732] hover:bg-[#E4E6EB] dark:hover:bg-[#2E3442] text-xs font-semibold text-[#0F172A] dark:text-white transition-colors cursor-pointer"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>View Page</span>
                      </button>

                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void handleToggleFollowPage(page)}
                        className={`inline-flex items-center justify-center gap-1.5 px-4 h-9 rounded-xl text-xs font-semibold disabled:opacity-50 transition-colors cursor-pointer ${
                          isFollowing
                            ? 'bg-[#1877F2]/12 text-[#1877F2] dark:text-[#60A5FA] hover:bg-[#1877F2]/20'
                            : 'bg-[#1877F2] hover:bg-[#166FE5] text-white'
                        }`}
                      >
                        {isBusy ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : isFollowing ? (
                          <Check className="w-3.5 h-3.5" />
                        ) : (
                          <Heart className="w-3.5 h-3.5" />
                        )}
                        <span>{isFollowing ? 'Following' : 'Like / Follow'}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
