import {useEffect, useState} from 'react';
import type {FormEvent} from 'react';
import {
  Bookmark,
  CalendarDays,
  Check,
  ChevronLeft,
  Clock,
  Film,
  Flag,
  Gift,
  Heart,
  MapPin,
  MessageCircle,
  Plus,
  Send,
  Store,
  UsersRound,
} from 'lucide-react';
import {apiRequest, formatRelativeTime} from '../lib/api';
import type {
  ActivityItem,
  CommentItem,
  DashboardStats,
  EventItem,
  GroupItem,
  MarketplaceItem,
  NetworkData,
  PageItem,
  PostItem,
  ReactionType,
  UserProfile,
} from '../types';
import {Avatar, CoverImage, PostVideo, useResolvedMediaUrl} from './MediaImage';
import {PostCard} from './PostCard';
import {ReactionActionButton} from './ReactionPicker';

function SectionHeader({
  title,
  subtitle,
  onBack,
  action,
}: {
  title: string;
  subtitle: string;
  onBack: () => void;
  action?: React.ReactNode;
}) {
  return (
    <div className="bg-white dark:bg-[#1C1E21] border border-[#E4E6EB] dark:border-[#2E3035] rounded-2xl p-4 sm:p-5 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2.5 min-w-0">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to Menu"
          className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-[#F0F2F5] dark:hover:bg-[#2A2D32] text-[#111827] dark:text-white shrink-0 cursor-pointer"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="min-w-0">
          <h1 className="text-xl font-display font-bold text-[#111827] dark:text-white truncate">
            {title}
          </h1>
          <p className="text-xs text-[#65676B] dark:text-[#9CA3AF] truncate">{subtitle}</p>
        </div>
      </div>
      {action}
    </div>
  );
}

// 1. PROFESSIONAL DASHBOARD (100% live Cloud Firestore stats)
export function DashboardView({
  currentUser,
  posts,
  network,
  onBack,
  onOpenProfile,
}: {
  currentUser: UserProfile;
  posts: PostItem[];
  network: NetworkData;
  onBack: () => void;
  onOpenProfile: (id: number) => void;
}) {
  const myPosts = posts.filter((p) => p.user_id === currentUser.id);
  const stats: DashboardStats = {
    posts_count: myPosts.length,
    total_likes: myPosts.reduce((sum, p) => sum + p.likes_count, 0),
    total_comments: myPosts.reduce((sum, p) => sum + p.comments_count, 0),
    friends_count: network.friends.length,
    followers_count: network.followingIds.length,
    recent_posts: myPosts.slice(0, 10),
  };

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Professional Dashboard"
        subtitle="Live summary of your Cloud Firestore posts, audience, and engagement"
        onBack={onBack}
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          {label: 'Total Posts', value: stats.posts_count},
          {label: 'Reactions Received', value: stats.total_likes},
          {label: 'Comments', value: stats.total_comments},
          {label: 'Friends', value: stats.friends_count},
        ].map((m) => (
          <div
            key={m.label}
            className="bg-white dark:bg-[#1C1E21] border border-[#E4E6EB] dark:border-[#2E3035] rounded-2xl p-4"
          >
            <p className="text-xs text-[#65676B] dark:text-[#9CA3AF]">{m.label}</p>
            <p className="text-2xl font-display font-bold text-[#111827] dark:text-white mt-1 tabular-nums">
              {m.value}
            </p>
          </div>
        ))}
      </div>

      <div className="bg-white dark:bg-[#1C1E21] border border-[#E4E6EB] dark:border-[#2E3035] rounded-2xl divide-y divide-[#E4E6EB] dark:divide-[#2E3035]">
        <div className="px-5 py-3.5">
          <h2 className="text-sm font-display font-bold text-[#111827] dark:text-white">
            Recent Post Performance
          </h2>
        </div>
        {stats.recent_posts.length === 0 ? (
          <div className="p-6 text-center text-xs text-[#65676B] dark:text-[#9CA3AF]">
            Publish posts from Home or Profile to track engagement here.
          </div>
        ) : (
          stats.recent_posts.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onOpenProfile(p.user_id)}
              className="w-full px-5 py-3.5 flex items-center justify-between gap-4 text-left hover:bg-[#F8F9FA] dark:hover:bg-[#24262B] cursor-pointer"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-[#111827] dark:text-white truncate">
                  {p.content || (p.video_url ? 'Video post' : 'Photo post')}
                </p>
                <p className="text-xs text-[#65676B] dark:text-[#9CA3AF] tabular-nums mt-0.5">
                  {formatRelativeTime(p.created_at)}
                </p>
              </div>
              <div className="text-xs text-[#65676B] dark:text-[#9CA3AF] tabular-nums whitespace-nowrap">
                {p.likes_count} reactions · {p.comments_count} comments
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

// 2. SAVED POSTS (from live Cloud Firestore posts)
export function SavedPostsView({
  currentUser,
  posts,
  followingIds = [],
  onBack,
  onOpenProfile,
  onOpenPage,
  onToggleLike,
  onToggleSave,
  onHidePost,
  onToggleFollowAuthor,
  onCommentAdded,
  onCommentDeleted,
  onDeletePost,
}: {
  currentUser: UserProfile;
  posts: PostItem[];
  followingIds?: number[];
  onBack: () => void;
  onOpenProfile: (id: number) => void;
  onOpenPage?: (pageId: string) => void;
  onToggleLike: (id: number, reaction?: ReactionType) => void;
  onToggleSave: (id: number) => void;
  onHidePost?: (post: PostItem) => Promise<void> | void;
  onToggleFollowAuthor?: (authorUid: string) => Promise<void> | void;
  onCommentAdded: (postId: number, comment: CommentItem) => void;
  onCommentDeleted?: (postId: number, commentId: number) => void;
  onDeletePost: (id: number) => Promise<void> | void;
}) {
  const savedPosts = posts.filter((p) => p.saved_by_me);

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Saved"
        subtitle="Posts you bookmarked permanently in Cloud Firestore"
        onBack={onBack}
      />

      {savedPosts.length === 0 ? (
        <div className="bg-white dark:bg-[#1C1E21] border border-[#E4E6EB] dark:border-[#2E3035] rounded-2xl p-10 text-center space-y-2">
          <Bookmark className="w-7 h-7 mx-auto text-[#65676B] dark:text-[#9CA3AF]" />
          <p className="text-sm font-semibold text-[#111827] dark:text-white">No saved posts yet</p>
          <p className="text-xs text-[#65676B] dark:text-[#9CA3AF]">
            Tap Save or use the 3-dot menu on any post to keep it here permanently.
          </p>
        </div>
      ) : (
        savedPosts.map((post) => (
          <PostCard
            key={post.id}
            post={post}
            currentUser={currentUser}
            isFollowingAuthor={followingIds.includes(post.user_id)}
            onOpenProfile={onOpenProfile}
            onOpenPage={onOpenPage}
            onToggleLike={onToggleLike}
            onToggleSave={onToggleSave}
            onHidePost={onHidePost}
            onToggleFollowAuthor={onToggleFollowAuthor}
            onCommentAdded={onCommentAdded}
            onCommentDeleted={onCommentDeleted}
            onDeletePost={onDeletePost}
          />
        ))
      )}
    </div>
  );
}

// 3. GROUPS
export function GroupsView({onBack}: {onBack: () => void}) {
  const [groups, setGroups] = useState<GroupItem[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('Community');
  const [description, setDescription] = useState('');

  function load() {
    apiRequest<{groups: GroupItem[]}>('/api/groups')
      .then((d) => setGroups(d.groups))
      .catch(() => {});
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await apiRequest('/api/groups', {
      method: 'POST',
      body: JSON.stringify({name, category, description}),
    });
    setName('');
    setDescription('');
    setShowForm(false);
    load();
  }

  async function handleToggle(groupId: number) {
    await apiRequest(`/api/groups/${groupId}/toggle`, {method: 'POST'});
    load();
  }

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Groups"
        subtitle="Join interest-based communities or start your own"
        onBack={onBack}
        action={
          <button
            type="button"
            onClick={() => setShowForm((prev) => !prev)}
            className="inline-flex items-center gap-1.5 px-3.5 h-9 rounded-xl bg-[#1877F2] hover:bg-[#166FE5] text-white text-xs font-semibold whitespace-nowrap cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Create Group</span>
          </button>
        }
      />

      {showForm && (
        <form
          onSubmit={handleCreate}
          className="bg-white dark:bg-[#1C1E21] border border-[#E4E6EB] dark:border-[#2E3035] rounded-2xl p-4 space-y-3"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Group name"
              className="h-10 px-3 rounded-xl bg-[#F0F2F5] dark:bg-[#121316] text-sm text-[#111827] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1877F2]"
            />
            <input
              type="text"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="Category (e.g. Photography)"
              className="h-10 px-3 rounded-xl bg-[#F0F2F5] dark:bg-[#121316] text-sm text-[#111827] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1877F2]"
            />
          </div>
          <textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What is this group about?"
            className="w-full p-3 rounded-xl bg-[#F0F2F5] dark:bg-[#121316] text-sm text-[#111827] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1877F2]"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-3.5 h-9 rounded-xl text-xs font-semibold text-[#65676B] dark:text-[#9CA3AF] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 h-9 rounded-xl bg-[#1877F2] text-white text-xs font-semibold cursor-pointer"
            >
              Create
            </button>
          </div>
        </form>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {groups.map((g) => (
          <div
            key={g.id}
            className="bg-white dark:bg-[#1C1E21] border border-[#E4E6EB] dark:border-[#2E3035] rounded-2xl overflow-hidden flex flex-col justify-between"
          >
            <div>
              <div className="h-28 bg-[#1E293B]">
                <CoverImage src={g.cover_url} alt={g.name} />
              </div>
              <div className="p-4 space-y-1.5">
                <h2 className="font-display font-bold text-base text-[#111827] dark:text-white">
                  {g.name}
                </h2>
                <p className="text-xs text-[#65676B] dark:text-[#9CA3AF] tabular-nums">
                  {g.category} · {g.members_count} {g.members_count === 1 ? 'member' : 'members'}
                </p>
                {g.description && (
                  <p className="text-xs text-[#4B5563] dark:text-[#D1D5DB] pt-1 leading-relaxed">
                    {g.description}
                  </p>
                )}
              </div>
            </div>
            <div className="px-4 pb-4">
              <button
                type="button"
                onClick={() => handleToggle(g.id)}
                className={`w-full h-9 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
                  g.joined
                    ? 'bg-[#F0F2F5] dark:bg-[#2A2D32] text-[#111827] dark:text-white'
                    : 'bg-[#1877F2] hover:bg-[#166FE5] text-white'
                }`}
              >
                {g.joined ? 'Joined' : 'Join Group'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// 4. MARKETPLACE
export function MarketplaceView({
  onBack,
  onMessageSeller,
}: {
  onBack: () => void;
  onMessageSeller: (sellerId: number, sellerName: string, sellerAvatar: string) => void;
}) {
  const [items, setItems] = useState<MarketplaceItem[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [price, setPrice] = useState('');
  const [category, setCategory] = useState('Electronics');
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');

  function load() {
    apiRequest<{items: MarketplaceItem[]}>('/api/marketplace')
      .then((d) => setItems(d.items))
      .catch(() => {});
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || !price.trim()) return;
    await apiRequest('/api/marketplace', {
      method: 'POST',
      body: JSON.stringify({title, price, category, location, description}),
    });
    setTitle('');
    setPrice('');
    setLocation('');
    setDescription('');
    setShowForm(false);
    load();
  }

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Marketplace"
        subtitle="Discover local listings or post an item for sale"
        onBack={onBack}
        action={
          <button
            type="button"
            onClick={() => setShowForm((prev) => !prev)}
            className="inline-flex items-center gap-1.5 px-3.5 h-9 rounded-xl bg-[#1877F2] hover:bg-[#166FE5] text-white text-xs font-semibold whitespace-nowrap cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Sell Item</span>
          </button>
        }
      />

      {showForm && (
        <form
          onSubmit={handleCreate}
          className="bg-white dark:bg-[#1C1E21] border border-[#E4E6EB] dark:border-[#2E3035] rounded-2xl p-4 space-y-3"
        >
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Item title"
              className="sm:col-span-2 h-10 px-3 rounded-xl bg-[#F0F2F5] dark:bg-[#121316] text-sm text-[#111827] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1877F2]"
            />
            <input
              type="text"
              required
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="$120"
              className="h-10 px-3 rounded-xl bg-[#F0F2F5] dark:bg-[#121316] text-sm text-[#111827] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1877F2]"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              type="text"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="Category"
              className="h-10 px-3 rounded-xl bg-[#F0F2F5] dark:bg-[#121316] text-sm text-[#111827] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1877F2]"
            />
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="City / Location"
              className="h-10 px-3 rounded-xl bg-[#F0F2F5] dark:bg-[#121316] text-sm text-[#111827] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1877F2]"
            />
          </div>
          <textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Condition and details..."
            className="w-full p-3 rounded-xl bg-[#F0F2F5] dark:bg-[#121316] text-sm text-[#111827] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1877F2]"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-3.5 h-9 rounded-xl text-xs font-semibold text-[#65676B] dark:text-[#9CA3AF] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 h-9 rounded-xl bg-[#1877F2] text-white text-xs font-semibold cursor-pointer"
            >
              Publish Listing
            </button>
          </div>
        </form>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {items.map((item) => (
          <div
            key={item.id}
            className="bg-white dark:bg-[#1C1E21] border border-[#E4E6EB] dark:border-[#2E3035] rounded-2xl overflow-hidden flex flex-col justify-between"
          >
            <div>
              <div className="aspect-[4/3] bg-[#1E293B]">
                <CoverImage src={item.image_url} alt={item.title} />
              </div>
              <div className="p-4 space-y-1">
                <p className="text-lg font-display font-bold text-[#111827] dark:text-white tabular-nums">
                  {item.price}
                </p>
                <h2 className="font-semibold text-sm text-[#111827] dark:text-[#F3F4F6]">
                  {item.title}
                </h2>
                <p className="text-xs text-[#65676B] dark:text-[#9CA3AF]">
                  {item.category} · {item.location}
                </p>
                {item.description && (
                  <p className="text-xs text-[#4B5563] dark:text-[#D1D5DB] pt-1 line-clamp-2">
                    {item.description}
                  </p>
                )}
              </div>
            </div>
            <div className="px-4 pb-4 flex items-center justify-between gap-2 pt-2 border-t border-[#E4E6EB] dark:border-[#2E3035]">
              <span className="text-xs text-[#65676B] dark:text-[#9CA3AF] truncate">
                Listed by {item.seller_name}
              </span>
              <button
                type="button"
                onClick={() => onMessageSeller(item.seller_id, item.seller_name, item.seller_avatar)}
                className="px-3 h-8 rounded-lg bg-[#F0F2F5] dark:bg-[#2A2D32] hover:bg-[#E4E6EB] dark:hover:bg-[#35383E] text-xs font-semibold text-[#111827] dark:text-white whitespace-nowrap cursor-pointer"
              >
                Message Seller
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// 5. EVENTS
export function EventsView({onBack}: {onBack: () => void}) {
  const [events, setEvents] = useState<EventItem[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');

  function load() {
    apiRequest<{events: EventItem[]}>('/api/events')
      .then((d) => setEvents(d.events))
      .catch(() => {});
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || !eventDate.trim() || !location.trim()) return;
    await apiRequest('/api/events', {
      method: 'POST',
      body: JSON.stringify({title, event_date: eventDate, location, description}),
    });
    setTitle('');
    setEventDate('');
    setLocation('');
    setDescription('');
    setShowForm(false);
    load();
  }

  async function handleRsvp(eventId: number, status: 'going' | 'interested' | 'none') {
    await apiRequest(`/api/events/${eventId}/rsvp`, {
      method: 'POST',
      body: JSON.stringify({status}),
    });
    load();
  }

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Events"
        subtitle="Upcoming meetups, photo walks, and local sessions"
        onBack={onBack}
        action={
          <button
            type="button"
            onClick={() => setShowForm((prev) => !prev)}
            className="inline-flex items-center gap-1.5 px-3.5 h-9 rounded-xl bg-[#1877F2] hover:bg-[#166FE5] text-white text-xs font-semibold whitespace-nowrap cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Create Event</span>
          </button>
        }
      />

      {showForm && (
        <form
          onSubmit={handleCreate}
          className="bg-white dark:bg-[#1C1E21] border border-[#E4E6EB] dark:border-[#2E3035] rounded-2xl p-4 space-y-3"
        >
          <input
            type="text"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Event title"
            className="w-full h-10 px-3 rounded-xl bg-[#F0F2F5] dark:bg-[#121316] text-sm text-[#111827] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1877F2]"
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              type="text"
              required
              value={eventDate}
              onChange={(e) => setEventDate(e.target.value)}
              placeholder="Sat, Dec 12 · 4:00 PM"
              className="h-10 px-3 rounded-xl bg-[#F0F2F5] dark:bg-[#121316] text-sm text-[#111827] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1877F2]"
            />
            <input
              type="text"
              required
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Location"
              className="h-10 px-3 rounded-xl bg-[#F0F2F5] dark:bg-[#121316] text-sm text-[#111827] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1877F2]"
            />
          </div>
          <textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Details..."
            className="w-full p-3 rounded-xl bg-[#F0F2F5] dark:bg-[#121316] text-sm text-[#111827] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1877F2]"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-3.5 h-9 rounded-xl text-xs font-semibold text-[#65676B] dark:text-[#9CA3AF] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 h-9 rounded-xl bg-[#1877F2] text-white text-xs font-semibold cursor-pointer"
            >
              Create
            </button>
          </div>
        </form>
      )}

      <div className="space-y-3">
        {events.map((ev) => (
          <div
            key={ev.id}
            className="bg-white dark:bg-[#1C1E21] border border-[#E4E6EB] dark:border-[#2E3035] rounded-2xl p-5 space-y-3"
          >
            <div>
              <p className="text-xs font-semibold text-[#DC2626] dark:text-[#F87171]">
                {ev.event_date}
              </p>
              <h2 className="text-lg font-display font-bold text-[#111827] dark:text-white mt-0.5">
                {ev.title}
              </h2>
              <p className="text-xs text-[#65676B] dark:text-[#9CA3AF] flex items-center gap-1.5 mt-1">
                <MapPin className="w-3.5 h-3.5" />
                <span>{ev.location}</span>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums">
                  {ev.going_count} going · {ev.interested_count} interested
                </span>
              </p>
              {ev.description && (
                <p className="text-sm text-[#374151] dark:text-[#D1D5DB] mt-2">{ev.description}</p>
              )}
            </div>

            <div className="flex items-center gap-2 pt-2 border-t border-[#E4E6EB] dark:border-[#2E3035]">
              <button
                type="button"
                onClick={() => handleRsvp(ev.id, ev.my_rsvp === 'going' ? 'none' : 'going')}
                className={`inline-flex items-center gap-1.5 px-4 h-9 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
                  ev.my_rsvp === 'going'
                    ? 'bg-[#1877F2] text-white'
                    : 'bg-[#F0F2F5] dark:bg-[#2A2D32] text-[#111827] dark:text-white'
                }`}
              >
                <Check className="w-3.5 h-3.5" />
                <span>Going</span>
              </button>
              <button
                type="button"
                onClick={() =>
                  handleRsvp(ev.id, ev.my_rsvp === 'interested' ? 'none' : 'interested')
                }
                className={`inline-flex items-center gap-1.5 px-4 h-9 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
                  ev.my_rsvp === 'interested'
                    ? 'bg-[#1877F2] text-white'
                    : 'bg-[#F0F2F5] dark:bg-[#2A2D32] text-[#111827] dark:text-white'
                }`}
              >
                <CalendarDays className="w-3.5 h-3.5" />
                <span>Interested</span>
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// 6. PAGES
export function PagesView({onBack}: {onBack: () => void}) {
  const [pages, setPages] = useState<PageItem[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('Creator');
  const [bio, setBio] = useState('');

  function load() {
    apiRequest<{pages: PageItem[]}>('/api/pages')
      .then((d) => setPages(d.pages))
      .catch(() => {});
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await apiRequest('/api/pages', {
      method: 'POST',
      body: JSON.stringify({name, category, bio}),
    });
    setName('');
    setBio('');
    setShowForm(false);
    load();
  }

  async function handleToggle(pageId: number) {
    await apiRequest(`/api/pages/${pageId}/toggle`, {method: 'POST'});
    load();
  }

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Pages"
        subtitle="Follow studios, creators, and publications"
        onBack={onBack}
        action={
          <button
            type="button"
            onClick={() => setShowForm((prev) => !prev)}
            className="inline-flex items-center gap-1.5 px-3.5 h-9 rounded-xl bg-[#1877F2] hover:bg-[#166FE5] text-white text-xs font-semibold whitespace-nowrap cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Create Page</span>
          </button>
        }
      />

      {showForm && (
        <form
          onSubmit={handleCreate}
          className="bg-white dark:bg-[#1C1E21] border border-[#E4E6EB] dark:border-[#2E3035] rounded-2xl p-4 space-y-3"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Page name"
              className="h-10 px-3 rounded-xl bg-[#F0F2F5] dark:bg-[#121316] text-sm text-[#111827] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1877F2]"
            />
            <input
              type="text"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="Category"
              className="h-10 px-3 rounded-xl bg-[#F0F2F5] dark:bg-[#121316] text-sm text-[#111827] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1877F2]"
            />
          </div>
          <textarea
            rows={2}
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder="Page description..."
            className="w-full p-3 rounded-xl bg-[#F0F2F5] dark:bg-[#121316] text-sm text-[#111827] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1877F2]"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-3.5 h-9 rounded-xl text-xs font-semibold text-[#65676B] dark:text-[#9CA3AF] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 h-9 rounded-xl bg-[#1877F2] text-white text-xs font-semibold cursor-pointer"
            >
              Create
            </button>
          </div>
        </form>
      )}

      <div className="bg-white dark:bg-[#1C1E21] border border-[#E4E6EB] dark:border-[#2E3035] rounded-2xl divide-y divide-[#E4E6EB] dark:divide-[#2E3035]">
        {pages.map((p) => (
          <div
            key={p.id}
            className="p-4 sm:px-5 flex items-center justify-between gap-4"
          >
            <div className="flex items-center gap-3 min-w-0">
              <Avatar src={p.avatar_url} name={p.name} size="md" />
              <div className="min-w-0">
                <p className="font-display font-semibold text-sm text-[#111827] dark:text-white truncate">
                  {p.name}
                </p>
                <p className="text-xs text-[#65676B] dark:text-[#9CA3AF] tabular-nums">
                  {p.category} · {p.followers_count} followers
                </p>
                {p.bio && (
                  <p className="text-xs text-[#4B5563] dark:text-[#D1D5DB] truncate mt-0.5">
                    {p.bio}
                  </p>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => handleToggle(p.id)}
              className={`px-3.5 h-9 rounded-xl text-xs font-semibold whitespace-nowrap cursor-pointer ${
                p.following
                  ? 'bg-[#F0F2F5] dark:bg-[#2A2D32] text-[#111827] dark:text-white'
                  : 'bg-[#1877F2] hover:bg-[#166FE5] text-white'
              }`}
            >
              {p.following ? 'Following' : 'Follow Page'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// 7. REELS (Video & Photo Visual Highlights Stream)
function ReelCard({
  post,
  onToggleLike,
  onOpenProfile,
}: {
  post: PostItem;
  onToggleLike: (postId: number, reaction?: ReactionType) => void;
  onOpenProfile: (id: number) => void;
}) {
  const isVideoPost = post.media_type === 'video' || Boolean(post.video_url);
  const resolvedImage = useResolvedMediaUrl(post.image_url);

  return (
    <div className="relative aspect-[3/4] rounded-2xl border border-[#E4E6EB] dark:border-[#2E3035] bg-[#0F1115]">
      <div className="absolute inset-0 rounded-2xl overflow-hidden">
        {isVideoPost ? (
          <PostVideo
            src={post.video_url || ''}
            poster={post.video_thumbnail || post.image_url}
            postId={post.docId}
            className="h-full border-y-0"
          />
        ) : resolvedImage ? (
          <img
            src={resolvedImage}
            alt={post.content || post.author_name}
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full bg-[#1E293B]" />
        )}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-44 bg-gradient-to-t from-black/85 via-black/45 to-transparent" />
      </div>

      <div className="absolute inset-x-0 bottom-0 p-4 text-white space-y-2 z-10 pointer-events-none">
        <button
          type="button"
          onClick={() => onOpenProfile(post.user_id)}
          className="flex items-center gap-2 cursor-pointer pointer-events-auto"
        >
          <Avatar src={post.author_avatar} name={post.author_name} size="xs" />
          <span className="text-sm font-semibold hover:underline">{post.author_name}</span>
        </button>
        {post.content && (
          <p className="text-xs text-white/90 line-clamp-2 leading-relaxed">{post.content}</p>
        )}
        <div className="flex items-center gap-4 pt-1 text-xs pointer-events-auto">
          <div className="inline-flex items-center gap-1.5">
            <ReactionActionButton
              compact
              myReaction={post.my_reaction ?? (post.liked_by_me ? 'like' : null)}
              likedByMe={post.liked_by_me}
              onReact={(reaction) => onToggleLike(post.id, reaction)}
            />
            <span className="tabular-nums text-white/90">{post.likes_count}</span>
          </div>
          <span className="inline-flex items-center gap-1.5 tabular-nums text-white/80">
            <MessageCircle className="w-4 h-4" />
            <span>{post.comments_count}</span>
          </span>
        </div>
      </div>
    </div>
  );
}

export function ReelsView({
  posts,
  onBack,
  onToggleLike,
  onOpenProfile,
}: {
  posts: PostItem[];
  onBack: () => void;
  onToggleLike: (postId: number, reaction?: ReactionType) => void;
  onOpenProfile: (id: number) => void;
}) {
  const mediaPosts = posts.filter((p) => Boolean(p.video_url || p.image_url));

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Reels & Visual Highlights"
        subtitle="Full-frame video and photo stories shared across Verve"
        onBack={onBack}
      />

      {mediaPosts.length === 0 ? (
        <div className="bg-white dark:bg-[#1C1E21] border border-[#E4E6EB] dark:border-[#2E3035] rounded-2xl p-10 text-center space-y-2">
          <Film className="w-7 h-7 mx-auto text-[#65676B] dark:text-[#9CA3AF]" />
          <p className="text-sm font-semibold text-[#111827] dark:text-white">No visual stories yet</p>
          <p className="text-xs text-[#65676B] dark:text-[#9CA3AF]">
            Share a photo or video post on Home and it will appear in Reels.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {mediaPosts.map((post) => (
            <ReelCard
              key={post.id}
              post={post}
              onToggleLike={onToggleLike}
              onOpenProfile={onOpenProfile}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// 8. MEMORIES
export function MemoriesView({
  currentUser,
  posts,
  onBack,
  onOpenProfile,
  onOpenPage,
  onToggleLike,
  onToggleSave,
  onHidePost,
  onCommentAdded,
  onCommentDeleted,
  onDeletePost,
}: {
  currentUser: UserProfile;
  posts: PostItem[];
  onBack: () => void;
  onOpenProfile: (id: number) => void;
  onOpenPage?: (pageId: string) => void;
  onToggleLike: (id: number, reaction?: ReactionType) => void;
  onToggleSave: (id: number) => void;
  onHidePost?: (post: PostItem) => Promise<void> | void;
  onCommentAdded: (postId: number, comment: CommentItem) => void;
  onCommentDeleted?: (postId: number, commentId: number) => void;
  onDeletePost: (id: number) => Promise<void> | void;
}) {
  const myPosts = posts.filter((p) => p.user_id === currentUser.id);
  return (
    <div className="space-y-4">
      <SectionHeader
        title="Memories"
        subtitle="Look back at your own posts and shared milestones"
        onBack={onBack}
      />
      {myPosts.length === 0 ? (
        <div className="bg-white dark:bg-[#1C1E21] border border-[#E4E6EB] dark:border-[#2E3035] rounded-2xl p-10 text-center space-y-2">
          <Clock className="w-7 h-7 mx-auto text-[#65676B] dark:text-[#9CA3AF]" />
          <p className="text-sm font-semibold text-[#111827] dark:text-white">
            No memories recorded yet
          </p>
          <p className="text-xs text-[#65676B] dark:text-[#9CA3AF]">
            Your posts and photos will be collected here over time.
          </p>
        </div>
      ) : (
        myPosts.map((post) => (
          <PostCard
            key={post.id}
            post={post}
            currentUser={currentUser}
            onOpenProfile={onOpenProfile}
            onOpenPage={onOpenPage}
            onToggleLike={onToggleLike}
            onToggleSave={onToggleSave}
            onHidePost={onHidePost}
            onCommentAdded={onCommentAdded}
            onCommentDeleted={onCommentDeleted}
            onDeletePost={onDeletePost}
          />
        ))
      )}
    </div>
  );
}

// 9. BIRTHDAYS
export function BirthdaysView({
  network,
  onBack,
  onSendWish,
  onOpenProfile,
}: {
  network: NetworkData;
  onBack: () => void;
  onSendWish: (user: UserProfile, text: string) => Promise<void>;
  onOpenProfile: (id: number) => void;
}) {
  const [sentIds, setSentIds] = useState<number[]>([]);
  const people = [...network.friends, ...network.suggestions].slice(0, 6);

  async function handleWish(u: UserProfile) {
    await onSendWish(u, `Happy Birthday, ${u.name.split(' ')[0]}! Wishing you a wonderful year ahead.`);
    setSentIds((prev) => [...prev, u.id]);
  }

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Birthdays"
        subtitle="Send a quick birthday message to friends in real time"
        onBack={onBack}
      />

      <div className="bg-white dark:bg-[#1C1E21] border border-[#E4E6EB] dark:border-[#2E3035] rounded-2xl divide-y divide-[#E4E6EB] dark:divide-[#2E3035]">
        {people.length === 0 ? (
          <div className="p-8 text-center text-sm text-[#65676B] dark:text-[#9CA3AF]">
            Add friends to see upcoming birthdays here.
          </div>
        ) : (
          people.map((person, idx) => {
            const wished = sentIds.includes(person.id);
            const label = idx === 0 ? 'Today' : idx === 1 ? 'In 3 days' : `In ${idx * 4 + 2} days`;
            return (
              <div
                key={person.id}
                className="p-4 sm:px-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <button
                  type="button"
                  onClick={() => onOpenProfile(person.id)}
                  className="flex items-center gap-3 text-left cursor-pointer"
                >
                  <Avatar src={person.avatar_url} name={person.name} size="md" />
                  <div>
                    <p className="font-display font-semibold text-sm text-[#111827] dark:text-white hover:underline">
                      {person.name}
                    </p>
                    <p className="text-xs text-[#65676B] dark:text-[#9CA3AF] flex items-center gap-1">
                      <Gift className="w-3.5 h-3.5 text-[#E11D48]" />
                      <span>{label}</span>
                    </p>
                  </div>
                </button>

                <button
                  type="button"
                  disabled={wished}
                  onClick={() => handleWish(person)}
                  className={`inline-flex items-center gap-1.5 px-3.5 h-9 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                    wished
                      ? 'bg-[#ECFDF5] dark:bg-[#0F2E22] text-[#065F46] dark:text-[#4ADE80]'
                      : 'bg-[#1877F2] hover:bg-[#166FE5] text-white'
                  }`}
                >
                  {wished ? <Check className="w-3.5 h-3.5" /> : <Send className="w-3.5 h-3.5" />}
                  <span>{wished ? 'Wish Sent' : 'Send Birthday Wish'}</span>
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// 10. ACTIVITY LOG
export function ActivityLogView({onBack}: {onBack: () => void}) {
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiRequest<{activities: ActivityItem[]}>('/api/activity')
      .then((d) => setActivities(d.activities))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Activity Log"
        subtitle="Your chronological record of posts, likes, and comments"
        onBack={onBack}
      />

      <div className="bg-white dark:bg-[#1C1E21] border border-[#E4E6EB] dark:border-[#2E3035] rounded-2xl divide-y divide-[#E4E6EB] dark:divide-[#2E3035]">
        {loading ? (
          <div className="p-8 text-center text-sm text-[#65676B] dark:text-[#9CA3AF]">
            Loading activity...
          </div>
        ) : activities.length === 0 ? (
          <div className="p-8 text-center text-sm text-[#65676B] dark:text-[#9CA3AF]">
            No activity recorded yet.
          </div>
        ) : (
          activities.map((a, index) => (
            <div key={`${a.kind}-${a.id}-${index}`} className="px-5 py-3.5 flex items-start gap-3">
              <span className="w-8 h-8 rounded-full bg-[#F0F2F5] dark:bg-[#2A2D32] flex items-center justify-center shrink-0 mt-0.5">
                {a.kind === 'like' ? (
                  <Heart className="w-4 h-4 text-[#E11D48]" />
                ) : a.kind === 'comment' ? (
                  <MessageCircle className="w-4 h-4 text-[#1877F2]" />
                ) : (
                  <UsersRound className="w-4 h-4 text-[#16A34A]" />
                )}
              </span>
              <div className="min-w-0">
                <p className="text-sm text-[#111827] dark:text-[#F3F4F6] break-words">
                  {a.kind === 'post' ? `Posted: "${a.summary || 'Photo or video update'}"` : a.summary}
                </p>
                <p className="text-xs text-[#65676B] dark:text-[#9CA3AF] mt-0.5 tabular-nums">
                  {formatRelativeTime(a.created_at)}
                </p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// Re-export icons cleanly unused warnings avoided
export const _hubIcons = {Flag, Store};
