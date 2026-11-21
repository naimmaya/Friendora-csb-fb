import {useCallback, useEffect, useRef, useState} from 'react';
import {
  Bell,
  Home,
  LogOut,
  Menu,
  MessageSquare,
  Moon,
  Search,
  Settings,
  Sun,
  Users,
} from 'lucide-react';
import {AuthGate} from './components/AuthGate';
import {
  ChatConversationWindow,
  MessagesPage,
  NotificationsPage,
  RightRailPanel,
} from './components/ChatPanel';
import {FriendsView} from './components/FriendsView';
import {
  ActivityLogView,
  BirthdaysView,
  DashboardView,
  EventsView,
  GroupsView,
  MarketplaceView,
  MemoriesView,
  PagesView,
  ReelsView,
  SavedPostsView,
} from './components/HubFeaturesView';
import {Avatar, CoverImage} from './components/MediaImage';
import {MenuView} from './components/MenuView';
import {PostCard} from './components/PostCard';
import {PostComposer} from './components/PostComposer';
import {ProfileView} from './components/ProfileView';
import {SettingsView} from './components/SettingsView';
import {apiRequest, getAuthToken, isUsingLocalFallback, setAuthToken} from './lib/api';
import type {
  AppView,
  AuthView,
  ChatMessage,
  CommentItem,
  ConversationSummary,
  NetworkData,
  NotificationItem,
  PostItem,
  ReactionType,
  SettingsSection,
  UserProfile,
} from './types';

function parseLocation() {
  const path = window.location.pathname.toLowerCase();
  const params = new URLSearchParams(window.location.search);

  let authView: AuthView = 'login';
  if (path === '/register' || path === '/signup') authView = 'register';
  else if (path === '/forgot-password') authView = 'forgot-password';
  else if (path === '/reset-password') authView = 'reset-password';

  let appView: AppView = 'home';
  let profileId: number | null = null;
  if (path === '/friends') appView = 'friends';
  else if (path === '/messages') appView = 'messages';
  else if (path === '/notifications') appView = 'notifications';
  else if (path === '/menu') appView = 'menu';
  else if (path === '/settings') appView = 'settings';
  else if (path === '/dashboard') appView = 'dashboard';
  else if (path === '/groups') appView = 'groups';
  else if (path === '/marketplace') appView = 'marketplace';
  else if (path === '/saved') appView = 'saved';
  else if (path === '/events') appView = 'events';
  else if (path === '/pages') appView = 'pages';
  else if (path === '/memories') appView = 'memories';
  else if (path === '/birthdays') appView = 'birthdays';
  else if (path === '/reels') appView = 'reels';
  else if (path === '/activity') appView = 'activity';
  else if (path === '/profile') appView = 'profile';
  else if (path.startsWith('/profile/')) {
    appView = 'profile';
    const parsed = Number(path.slice('/profile/'.length));
    if (Number.isFinite(parsed) && parsed > 0) profileId = parsed;
  }

  return {
    path,
    authView,
    appView,
    profileId,
    resetToken: params.get('token') || '',
  };
}

export default function App() {
  const initialLoc = parseLocation();

  // Theme state
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
  });

  // Auth & routing state
  const [booting, setBooting] = useState(true);
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [authView, setAuthView] = useState<AuthView>(initialLoc.authView);
  const [resetTokenFromUrl, setResetTokenFromUrl] = useState(initialLoc.resetToken);
  const [appView, setAppView] = useState<AppView>(initialLoc.appView);
  const [activeProfileId, setActiveProfileId] = useState<number | null>(initialLoc.profileId);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('overview');

  // Feed state
  const [feedFilter, setFeedFilter] = useState<'all' | 'following'>('all');
  const [posts, setPosts] = useState<PostItem[]>([]);
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<UserProfile[]>([]);

  // Network, notifications, chat state
  const [network, setNetwork] = useState<NetworkData>({
    friends: [],
    incomingRequests: [],
    outgoingRequests: [],
    suggestions: [],
    followingIds: [],
  });
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [onlineUserIds, setOnlineUserIds] = useState<number[]>([]);
  const [activeChatPeer, setActiveChatPeer] = useState<UserProfile | null>(null);
  const [floatingChatOpen, setFloatingChatOpen] = useState(false);
  const [messagesByPeer, setMessagesByPeer] = useState<Record<number, ChatMessage[]>>({});
  const [typingUsers, setTypingUsers] = useState<Record<number, boolean>>({});

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const currentUserRef = useRef<UserProfile | null>(null);
  currentUserRef.current = currentUser;

  function toggleTheme() {
    setTheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      if (next === 'dark') {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
      try {
        localStorage.setItem('verve_theme', next);
      } catch {
        // Ignore
      }
      return next;
    });
  }

  // Navigation helpers synced with browser History API
  const navigateAuth = useCallback((view: AuthView, query = '') => {
    const pathMap: Record<AuthView, string> = {
      login: '/login',
      register: '/register',
      'forgot-password': '/forgot-password',
      'reset-password': '/reset-password',
    };
    const url = `${pathMap[view]}${query}`;
    window.history.pushState({}, '', url);
    setAuthView(view);
    if (view === 'reset-password') {
      const params = new URLSearchParams(query);
      setResetTokenFromUrl(params.get('token') || '');
    } else {
      setResetTokenFromUrl('');
    }
  }, []);

  const navigateApp = useCallback((view: AppView, profileId?: number) => {
    let url = '/';
    if (view === 'profile') {
      url = profileId ? `/profile/${profileId}` : '/profile';
    } else if (view !== 'home') {
      url = `/${view}`;
    }
    window.history.pushState({}, '', url);
    setAppView(view);
    if (view === 'profile') {
      setActiveProfileId(profileId ?? currentUserRef.current?.id ?? null);
    }
    window.scrollTo({top: 0, behavior: 'smooth'});
  }, []);

  useEffect(() => {
    function handlePopState() {
      const loc = parseLocation();
      setAuthView(loc.authView);
      setResetTokenFromUrl(loc.resetToken);
      setAppView(loc.appView);
      setActiveProfileId(loc.profileId);
    }
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Data loaders
  const loadPosts = useCallback(async (filter: 'all' | 'following' = feedFilter) => {
    setLoadingPosts(true);
    try {
      const data = await apiRequest<{posts: PostItem[]}>(`/api/posts?filter=${filter}`);
      setPosts(data.posts);
    } catch {
      // Handled gracefully
    } finally {
      setLoadingPosts(false);
    }
  }, [feedFilter]);

  const loadNetwork = useCallback(async () => {
    try {
      const data = await apiRequest<NetworkData>('/api/network');
      setNetwork(data);
    } catch {
      // Ignore
    }
  }, []);

  const loadNotifications = useCallback(async () => {
    try {
      const data = await apiRequest<{notifications: NotificationItem[]}>('/api/notifications');
      setNotifications(data.notifications);
    } catch {
      // Ignore
    }
  }, []);

  const loadConversations = useCallback(async () => {
    try {
      const data = await apiRequest<{
        conversations: ConversationSummary[];
        onlineUserIds: number[];
      }>('/api/messages/conversations');
      setConversations(data.conversations);
      setOnlineUserIds(data.onlineUserIds);
    } catch {
      // Ignore
    }
  }, []);

  const loadMessagesForPeer = useCallback(async (peerId: number) => {
    try {
      const data = await apiRequest<{messages: ChatMessage[]}>(`/api/messages/${peerId}`);
      setMessagesByPeer((prev) => ({...prev, [peerId]: data.messages}));
      setConversations((prev) =>
        prev.map((c) => (c.user.id === peerId ? {...c, unread_count: 0} : c)),
      );
    } catch {
      // Ignore
    }
  }, []);

  // Boot auth check
  useEffect(() => {
    const token = getAuthToken();
    if (!token) {
      setBooting(false);
      return;
    }

    apiRequest<{user: UserProfile}>('/api/auth/me')
      .then((data) => {
        setCurrentUser(data.user);
        const loc = parseLocation();
        if (
          loc.path === '/login' ||
          loc.path === '/register' ||
          loc.path === '/signup' ||
          loc.path === '/forgot-password' ||
          loc.path === '/reset-password'
        ) {
          window.history.replaceState({}, '', '/');
          setAppView('home');
        }
      })
      .catch(() => {
        setAuthToken(null);
        setCurrentUser(null);
      })
      .finally(() => {
        setBooting(false);
      });
  }, []);

  // Load initial app data when authenticated
  useEffect(() => {
    if (!currentUser) return;
    loadPosts(feedFilter);
    loadNetwork();
    loadNotifications();
    loadConversations();
  }, [currentUser?.id]);

  // Reload posts on filter switch
  useEffect(() => {
    if (!currentUser) return;
    loadPosts(feedFilter);
  }, [feedFilter]);

  // People search
  useEffect(() => {
    if (!currentUser) return;
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      setSearchResults([]);
      return;
    }
    const timer = window.setTimeout(() => {
      apiRequest<{users: UserProfile[]}>(`/api/users/search?q=${encodeURIComponent(trimmed)}`)
        .then((data) => setSearchResults(data.users))
        .catch(() => setSearchResults([]));
    }, 200);
    return () => window.clearTimeout(timer);
  }, [searchQuery, currentUser]);

  // Real-time WebSocket connection with automatic reconnect
  useEffect(() => {
    if (!currentUser) {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      return;
    }

    let cancelled = false;

    function connect() {
      const token = getAuthToken();
      if (!token || cancelled || isUsingLocalFallback() || token.startsWith('local_')) return;

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data) as {event: string; payload: any};
          const me = currentUserRef.current;
          if (!me) return;

          switch (parsed.event) {
            case 'presence:update': {
              setOnlineUserIds(parsed.payload.onlineUserIds || []);
              break;
            }
            case 'post:created': {
              const incomingPost = parsed.payload as PostItem;
              setPosts((prev) =>
                prev.some((p) => p.id === incomingPost.id) ? prev : [incomingPost, ...prev],
              );
              break;
            }
            case 'post:deleted': {
              const {postId} = parsed.payload as {postId: number};
              setPosts((prev) => prev.filter((p) => p.id !== postId));
              break;
            }
            case 'post:liked': {
              const {postId, likes_count, actorId, liked, my_reaction, reaction_counts} =
                parsed.payload as {
                  postId: number;
                  likes_count: number;
                  actorId: number;
                  liked: boolean;
                  my_reaction?: ReactionType | null;
                  reaction_counts?: Partial<Record<ReactionType, number>>;
                };
              setPosts((prev) =>
                prev.map((p) =>
                  p.id === postId
                    ? {
                        ...p,
                        likes_count,
                        reaction_counts: reaction_counts ?? p.reaction_counts,
                        liked_by_me: actorId === me.id ? liked : p.liked_by_me,
                        my_reaction:
                          actorId === me.id
                            ? (my_reaction ?? (liked ? 'like' : null))
                            : p.my_reaction,
                      }
                    : p,
                ),
              );
              break;
            }
            case 'post:commented': {
              const {postId, comment} = parsed.payload as {postId: number; comment: CommentItem};
              setPosts((prev) =>
                prev.map((p) => {
                  if (p.id !== postId) return p;
                  if (p.comments.some((c) => c.id === comment.id)) return p;
                  return {
                    ...p,
                    comments: [...p.comments, comment],
                    comments_count: p.comments_count + 1,
                  };
                }),
              );
              break;
            }
            case 'notification:new': {
              const notif = parsed.payload as NotificationItem;
              setNotifications((prev) =>
                prev.some((n) => n.id === notif.id) ? prev : [notif, ...prev],
              );
              break;
            }
            case 'network:updated': {
              loadNetwork();
              loadConversations();
              break;
            }
            case 'profile:updated': {
              const updated = parsed.payload as UserProfile;
              if (updated.id === me.id) {
                setCurrentUser((prev) => (prev ? {...prev, ...updated} : updated));
              }
              setPosts((prev) =>
                prev.map((p) =>
                  p.user_id === updated.id
                    ? {
                        ...p,
                        author_name: updated.name,
                        author_avatar: updated.avatar_url,
                        author_work: updated.work,
                      }
                    : p,
                ),
              );
              loadConversations();
              break;
            }
            case 'chat:message': {
              const msg = parsed.payload as ChatMessage;
              const peerId = msg.sender_id === me.id ? msg.receiver_id : msg.sender_id;
              setMessagesByPeer((prev) => {
                const existing = prev[peerId] || [];
                if (existing.some((m) => m.id === msg.id)) return prev;
                return {...prev, [peerId]: [...existing, msg]};
              });
              loadConversations();
              break;
            }
            case 'chat:typing': {
              const {senderId, isTyping} = parsed.payload as {senderId: number; isTyping: boolean};
              setTypingUsers((prev) => ({...prev, [senderId]: isTyping}));
              break;
            }
          }
        } catch {
          // Ignore malformed payloads
        }
      };

      ws.onclose = () => {
        if (!cancelled) {
          reconnectTimerRef.current = window.setTimeout(connect, 2500);
        }
      };
    }

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [currentUser?.id, loadConversations, loadNetwork]);

  // Handlers
  function handleAuthenticated(user: UserProfile) {
    setCurrentUser(user);
    // Always redirect authenticated users to Home
    window.history.replaceState({}, '', '/');
    setAppView('home');
    setActiveProfileId(user.id);
  }

  async function handleLogout() {
    try {
      await apiRequest('/api/auth/logout', {method: 'POST'});
    } catch {
      // Proceed with local sign out
    }
    setAuthToken(null);
    setCurrentUser(null);
    setFloatingChatOpen(false);
    setActiveChatPeer(null);
    window.history.replaceState({}, '', '/login');
    setAuthView('login');
  }

  async function handleToggleLike(postId: number, reaction?: ReactionType) {
    try {
      const data = await apiRequest<{
        liked: boolean;
        my_reaction: ReactionType | null;
        likes_count: number;
        reaction_counts: Partial<Record<ReactionType, number>>;
      }>(`/api/posts/${postId}/like`, {
        method: 'POST',
        body: JSON.stringify(reaction ? {reaction} : {}),
      });
      setPosts((prev) =>
        prev.map((p) =>
          p.id === postId
            ? {
                ...p,
                liked_by_me: data.liked,
                my_reaction: data.my_reaction,
                likes_count: data.likes_count,
                reaction_counts: data.reaction_counts,
              }
            : p,
        ),
      );
    } catch {
      // Ignore
    }
  }

  async function handleToggleSave(postId: number) {
    try {
      const data = await apiRequest<{saved: boolean}>(`/api/posts/${postId}/save`, {
        method: 'POST',
      });
      setPosts((prev) =>
        prev.map((p) => (p.id === postId ? {...p, saved_by_me: data.saved} : p)),
      );
    } catch {
      // Ignore
    }
  }

  function handleCommentAdded(postId: number, comment: CommentItem) {
    setPosts((prev) =>
      prev.map((p) => {
        if (p.id !== postId) return p;
        if (p.comments.some((c) => c.id === comment.id)) return p;
        return {
          ...p,
          comments: [...p.comments, comment],
          comments_count: p.comments_count + 1,
        };
      }),
    );
  }

  async function handleDeletePost(postId: number) {
    try {
      await apiRequest(`/api/posts/${postId}`, {method: 'DELETE'});
      setPosts((prev) => prev.filter((p) => p.id !== postId));
    } catch {
      // Ignore
    }
  }

  function handleOpenChat(peer: UserProfile) {
    setActiveChatPeer(peer);
    loadMessagesForPeer(peer.id);
    if (window.innerWidth >= 1024 && appView !== 'messages') {
      setFloatingChatOpen(true);
    } else {
      navigateApp('messages');
    }
  }

  async function handleSendMessage(peerId: number, content: string) {
    const data = await apiRequest<{message: ChatMessage}>(`/api/messages/${peerId}`, {
      method: 'POST',
      body: JSON.stringify({content}),
    });
    setMessagesByPeer((prev) => {
      const existing = prev[peerId] || [];
      if (existing.some((m) => m.id === data.message.id)) return prev;
      return {...prev, [peerId]: [...existing, data.message]};
    });
    loadConversations();
  }

  function handleTyping(peerId: number, isTyping: boolean) {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({event: 'chat:typing', payload: {receiverId: peerId, isTyping}}),
      );
    }
  }

  async function handleMarkAllRead() {
    try {
      await apiRequest('/api/notifications/read-all', {method: 'POST'});
      setNotifications((prev) => prev.map((n) => ({...n, read: true})));
    } catch {
      // Ignore
    }
  }

  async function handleNotificationClick(notif: NotificationItem) {
    if (!notif.read) {
      apiRequest(`/api/notifications/${notif.id}/read`, {method: 'POST'}).catch(() => {});
      setNotifications((prev) => prev.map((n) => (n.id === notif.id ? {...n, read: true} : n)));
    }
    if (notif.type === 'friend_request') {
      navigateApp('friends');
    } else if (
      (notif.type === 'friend_accepted' || notif.type === 'follow') &&
      notif.actor_id
    ) {
      navigateApp('profile', notif.actor_id);
    } else if (notif.type === 'like' || notif.type === 'comment') {
      navigateApp('home');
    }
  }

  // Initial auth verification skeleton
  if (booting) {
    return (
      <div className="min-h-screen bg-[#F0F2F5] dark:bg-[#121316] flex items-center justify-center">
        <div className="text-center space-y-2">
          <p className="text-2xl font-display font-extrabold text-[#1877F2] dark:text-[#3B82F6]">
            Verve
          </p>
          <p className="text-xs text-[#65676B] dark:text-[#9CA3AF]">Loading your session...</p>
        </div>
      </div>
    );
  }

  // Mandatory Entry Gate for unauthenticated users
  if (!currentUser) {
    return (
      <AuthGate
        authView={authView}
        resetTokenFromUrl={resetTokenFromUrl}
        onNavigateAuth={navigateAuth}
        onAuthenticated={handleAuthenticated}
        theme={theme}
        onToggleTheme={toggleTheme}
      />
    );
  }

  const unreadNotifications = notifications.filter((n) => !n.read).length;
  const unreadMessages = conversations.reduce((sum, c) => sum + c.unread_count, 0);
  const pendingRequests = network.incomingRequests.length;
  const resolvedProfileId = activeProfileId ?? currentUser.id;
  const onlineSet = new Set(onlineUserIds);

  return (
    <div className="min-h-screen bg-[#F4F6F9] dark:bg-[#0E1014] text-[#0F172A] dark:text-[#F1F5F9] pb-16 md:pb-8">
      {/* Top Bar: Clean 3-zone contract */}
      <header className="sticky top-0 z-30 h-14 sm:h-16 bg-white/90 dark:bg-[#16191F]/90 backdrop-blur-xl border-b border-[#E5E8EE] dark:border-[#252A34]">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 h-full flex items-center justify-between gap-8">
          {/* Zone 1: Brand Wordmark */}
          <button
            type="button"
            onClick={() => navigateApp('home')}
            className="text-2xl font-display font-extrabold tracking-tight text-[#1877F2] dark:text-[#3B82F6] whitespace-nowrap shrink-0 cursor-pointer"
          >
            Verve
          </button>

          {/* Zone 2: 5 concise single-line text nav links */}
          <nav
            aria-label="Primary navigation"
            className="hidden md:flex items-center gap-6 text-sm font-medium text-[#4B5563] dark:text-[#9CA3AF]"
          >
            <button
              type="button"
              onClick={() => navigateApp('home')}
              className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                appView === 'home'
                  ? 'text-[#1877F2] dark:text-[#60A5FA] font-semibold border-b-2 border-[#1877F2] dark:border-[#60A5FA]'
                  : 'hover:text-[#111827] dark:hover:text-white'
              }`}
            >
              Home
            </button>
            <button
              type="button"
              onClick={() => navigateApp('friends')}
              className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                appView === 'friends'
                  ? 'text-[#1877F2] dark:text-[#60A5FA] font-semibold border-b-2 border-[#1877F2] dark:border-[#60A5FA]'
                  : 'hover:text-[#111827] dark:hover:text-white'
              }`}
            >
              Friends{pendingRequests > 0 ? ` (${pendingRequests})` : ''}
            </button>
            <button
              type="button"
              onClick={() => navigateApp('messages')}
              className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                appView === 'messages'
                  ? 'text-[#1877F2] dark:text-[#60A5FA] font-semibold border-b-2 border-[#1877F2] dark:border-[#60A5FA]'
                  : 'hover:text-[#111827] dark:hover:text-white'
              }`}
            >
              Messages{unreadMessages > 0 ? ` (${unreadMessages})` : ''}
            </button>
            <button
              type="button"
              onClick={() => navigateApp('notifications')}
              className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                appView === 'notifications'
                  ? 'text-[#1877F2] dark:text-[#60A5FA] font-semibold border-b-2 border-[#1877F2] dark:border-[#60A5FA]'
                  : 'hover:text-[#111827] dark:hover:text-white'
              }`}
            >
              Notifications{unreadNotifications > 0 ? ` (${unreadNotifications})` : ''}
            </button>
            <button
              type="button"
              onClick={() => navigateApp('menu')}
              className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                appView === 'menu' ||
                appView === 'settings' ||
                appView === 'dashboard' ||
                appView === 'groups' ||
                appView === 'marketplace' ||
                appView === 'saved' ||
                appView === 'events' ||
                appView === 'pages' ||
                appView === 'memories' ||
                appView === 'birthdays' ||
                appView === 'reels' ||
                appView === 'activity'
                  ? 'text-[#1877F2] dark:text-[#60A5FA] font-semibold border-b-2 border-[#1877F2] dark:border-[#60A5FA]'
                  : 'hover:text-[#111827] dark:hover:text-white'
              }`}
            >
              Menu
            </button>
          </nav>

          {/* Zone 3: Single primary profile action */}
          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={() => navigateApp('profile', currentUser.id)}
              className="inline-flex items-center gap-2.5 pl-1.5 pr-3 py-1 rounded-full hover:bg-[#F0F2F5] dark:hover:bg-[#2A2D32] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Avatar src={currentUser.avatar_url} name={currentUser.name} size="xs" />
              <span className="text-sm font-semibold text-[#111827] dark:text-white max-w-[130px] truncate">
                {currentUser.name}
              </span>
            </button>
          </div>
        </div>
      </header>

      {/* Main 3-Column Responsive Workspace */}
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 pt-5 lg:pt-6">
        <div className="flex items-start justify-center gap-6">
          {/* LEFT RAIL (Desktop) */}
          <aside className="hidden lg:flex flex-col gap-4 w-[260px] shrink-0 sticky top-[5.25rem]">
            {/* Account Summary Card with subtle cover accent */}
            <div className="bg-white dark:bg-[#16191F] border border-[#E5E8EE] dark:border-[#252A34] rounded-2xl overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
              <div className="h-14 w-full bg-[#1E293B] relative overflow-hidden">
                {currentUser.cover_url && (
                  <CoverImage
                    src={currentUser.cover_url}
                    alt=""
                    className="w-full h-full object-cover opacity-90"
                  />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/35 to-transparent" />
              </div>
              <div className="px-4 pb-4 -mt-6 relative space-y-3">
                <button
                  type="button"
                  onClick={() => navigateApp('profile', currentUser.id)}
                  className="flex flex-col items-start gap-2 w-full text-left group cursor-pointer"
                >
                  <div className="rounded-full p-0.5 bg-white dark:bg-[#16191F]">
                    <Avatar src={currentUser.avatar_url} name={currentUser.name} size="md" />
                  </div>
                  <div className="min-w-0 w-full">
                    <p className="font-display font-bold text-[15px] text-[#0F172A] dark:text-white truncate group-hover:underline">
                      {currentUser.name}
                    </p>
                    <p className="text-xs text-[#64748B] dark:text-[#94A3B8] truncate">
                      {currentUser.work || 'View & edit profile'}
                    </p>
                  </div>
                </button>

                {currentUser.bio && (
                  <p className="text-xs text-[#475569] dark:text-[#94A3B8] line-clamp-2 leading-relaxed">
                    {currentUser.bio}
                  </p>
                )}

                <div className="pt-2.5 border-t border-[#E5E8EE] dark:border-[#252A34] flex items-center justify-between text-xs text-[#64748B] dark:text-[#94A3B8] tabular-nums">
                  <span>
                    <strong className="text-[#0F172A] dark:text-white font-semibold">
                      {network.friends.length}
                    </strong>{' '}
                    friends
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    <strong className="text-[#0F172A] dark:text-white font-semibold">
                      {network.followingIds.length}
                    </strong>{' '}
                    following
                  </span>
                </div>
              </div>
            </div>

            {/* Search People */}
            <div className="bg-white dark:bg-[#16191F] border border-[#E5E8EE] dark:border-[#252A34] rounded-2xl p-3.5 space-y-2.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
              <div className="relative">
                <Search className="w-4 h-4 text-[#65676B] dark:text-[#9CA3AF] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Find people on Verve..."
                  className="w-full h-9 pl-9 pr-3 rounded-xl bg-[#F0F2F5] dark:bg-[#121316] text-xs text-[#111827] dark:text-white placeholder:text-[#65676B] dark:placeholder:text-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#1877F2]"
                />
              </div>

              {searchQuery.trim() && (
                <div className="divide-y divide-[#E4E6EB] dark:divide-[#2E3035] max-h-52 overflow-y-auto">
                  {searchResults.length === 0 ? (
                    <p className="py-2 text-xs text-[#65676B] dark:text-[#9CA3AF] text-center">
                      No matching people
                    </p>
                  ) : (
                    searchResults.map((u) => (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => {
                          setSearchQuery('');
                          navigateApp('profile', u.id);
                        }}
                        className="w-full py-2 flex items-center gap-2.5 text-left hover:bg-[#F0F2F5] dark:hover:bg-[#24262B] px-1.5 rounded-lg cursor-pointer"
                      >
                        <Avatar src={u.avatar_url} name={u.name} size="xs" />
                        <div className="min-w-0">
                          <span className="text-xs font-semibold text-[#111827] dark:text-white truncate block">
                            {u.name}
                          </span>
                          <span className="text-[11px] text-[#65676B] dark:text-[#9CA3AF] truncate block">
                            {u.work || u.location || 'Member'}
                          </span>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Preferences & Sign Out */}
            <div className="bg-white dark:bg-[#16191F] border border-[#E5E8EE] dark:border-[#252A34] rounded-2xl p-2 space-y-1 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
              <button
                type="button"
                onClick={() => navigateApp('menu')}
                className={`w-full px-3 py-2.5 rounded-xl flex items-center gap-2.5 text-sm font-medium transition-colors cursor-pointer ${
                  appView === 'menu'
                    ? 'bg-[#1877F2]/10 text-[#1877F2] dark:text-[#60A5FA] font-semibold'
                    : 'text-[#374151] dark:text-[#D1D5DB] hover:bg-[#F0F2F5] dark:hover:bg-[#24262B]'
                }`}
              >
                <Menu className="w-4 h-4" />
                <span>Menu &amp; Shortcuts</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setSettingsSection('overview');
                  navigateApp('settings');
                }}
                className={`w-full px-3 py-2.5 rounded-xl flex items-center gap-2.5 text-sm font-medium transition-colors cursor-pointer ${
                  appView === 'settings'
                    ? 'bg-[#1877F2]/10 text-[#1877F2] dark:text-[#60A5FA] font-semibold'
                    : 'text-[#374151] dark:text-[#D1D5DB] hover:bg-[#F0F2F5] dark:hover:bg-[#24262B]'
                }`}
              >
                <Settings className="w-4 h-4" />
                <span>Settings &amp; Privacy</span>
              </button>

              <button
                type="button"
                onClick={toggleTheme}
                className="w-full px-3 py-2.5 rounded-xl flex items-center justify-between text-sm font-medium text-[#374151] dark:text-[#D1D5DB] hover:bg-[#F0F2F5] dark:hover:bg-[#24262B] transition-colors cursor-pointer"
              >
                <span className="inline-flex items-center gap-2.5">
                  {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                  <span>{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
                </span>
              </button>

              <button
                type="button"
                onClick={handleLogout}
                className="w-full px-3 py-2.5 rounded-xl flex items-center gap-2.5 text-sm font-medium text-[#DC2626] dark:text-[#F87171] hover:bg-[#FEF2F2] dark:hover:bg-[#3B181A]/50 transition-colors cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
                <span>Sign Out</span>
              </button>
            </div>
          </aside>

          {/* CENTER VIEWPORT */}
          <main
            className={`flex-1 min-w-0 ${
              appView === 'profile' || appView === 'messages' ? 'max-w-[820px]' : 'max-w-[660px]'
            }`}
          >
            {/* Mobile quick theme & sign-out strip when viewing Profile */}
            {appView === 'profile' && resolvedProfileId === currentUser.id && (
              <div className="lg:hidden flex items-center justify-end gap-2 mb-3">
                <button
                  type="button"
                  onClick={toggleTheme}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white dark:bg-[#1C1E21] border border-[#E4E6EB] dark:border-[#2E3035] text-xs font-medium text-[#374151] dark:text-[#D1D5DB] cursor-pointer"
                >
                  {theme === 'dark' ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
                  <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white dark:bg-[#1C1E21] border border-[#E4E6EB] dark:border-[#2E3035] text-xs font-medium text-[#DC2626] dark:text-[#F87171] cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Sign Out</span>
                </button>
              </div>
            )}

            {/* HOME FEED */}
            {appView === 'home' && (
              <div className="space-y-4">
                <PostComposer
                  currentUser={currentUser}
                  onOpenProfile={(uid) => navigateApp('profile', uid)}
                  onPostCreated={(newPost) => {
                    setPosts((prev) =>
                      prev.some((p) => p.id === newPost.id) ? prev : [newPost, ...prev],
                    );
                  }}
                />

                {/* Feed filter bar */}
                <div className="flex items-center justify-between gap-3">
                  <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-white dark:bg-[#1C1E21] border border-[#E4E6EB] dark:border-[#2E3035]">
                    <button
                      type="button"
                      onClick={() => setFeedFilter('all')}
                      className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                        feedFilter === 'all'
                          ? 'bg-[#1877F2] text-white'
                          : 'text-[#65676B] dark:text-[#9CA3AF] hover:text-[#111827] dark:hover:text-white'
                      }`}
                    >
                      All Updates
                    </button>
                    <button
                      type="button"
                      onClick={() => setFeedFilter('following')}
                      className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                        feedFilter === 'following'
                          ? 'bg-[#1877F2] text-white'
                          : 'text-[#65676B] dark:text-[#9CA3AF] hover:text-[#111827] dark:hover:text-white'
                      }`}
                    >
                      Friends &amp; Following
                    </button>
                  </div>

                  {/* Mobile theme quick toggle */}
                  <button
                    type="button"
                    onClick={toggleTheme}
                    aria-label="Toggle theme"
                    className="lg:hidden inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white dark:bg-[#1C1E21] border border-[#E4E6EB] dark:border-[#2E3035] text-xs font-medium text-[#374151] dark:text-[#D1D5DB] cursor-pointer"
                  >
                    {theme === 'dark' ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
                    <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
                  </button>
                </div>

                {/* Feed list */}
                {loadingPosts ? (
                  <div className="space-y-4">
                    {[1, 2].map((i) => (
                      <div
                        key={i}
                        className="bg-white dark:bg-[#1C1E21] border border-[#E4E6EB] dark:border-[#2E3035] rounded-2xl p-5 animate-pulse space-y-3"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-[#E4E6EB] dark:bg-[#2A2D32]" />
                          <div className="space-y-1.5">
                            <div className="w-32 h-3.5 bg-[#E4E6EB] dark:bg-[#2A2D32] rounded" />
                            <div className="w-20 h-3 bg-[#E4E6EB] dark:bg-[#2A2D32] rounded" />
                          </div>
                        </div>
                        <div className="w-full h-16 bg-[#E4E6EB] dark:bg-[#2A2D32] rounded-xl" />
                      </div>
                    ))}
                  </div>
                ) : posts.length === 0 ? (
                  <div className="bg-white dark:bg-[#1C1E21] border border-[#E4E6EB] dark:border-[#2E3035] rounded-2xl p-10 text-center space-y-2">
                    <p className="text-base font-display font-semibold text-[#111827] dark:text-white">
                      {feedFilter === 'following'
                        ? 'No posts from friends or people you follow yet'
                        : 'Your feed is quiet'}
                    </p>
                    <p className="text-sm text-[#65676B] dark:text-[#9CA3AF]">
                      {feedFilter === 'following'
                        ? 'Connect with people in Friends or switch to All Updates.'
                        : 'Share a status, photo, or video above to start the conversation.'}
                    </p>
                    {feedFilter === 'following' && (
                      <button
                        type="button"
                        onClick={() => navigateApp('friends')}
                        className="mt-2 px-4 py-2 rounded-xl bg-[#1877F2] text-white text-xs font-semibold cursor-pointer"
                      >
                        Find Friends
                      </button>
                    )}
                  </div>
                ) : (
                  posts.map((post) => (
                    <PostCard
                      key={post.id}
                      post={post}
                      currentUser={currentUser}
                      onOpenProfile={(uid) => navigateApp('profile', uid)}
                      onToggleLike={handleToggleLike}
                      onToggleSave={handleToggleSave}
                      onCommentAdded={handleCommentAdded}
                      onDeletePost={handleDeletePost}
                    />
                  ))
                )}
              </div>
            )}

            {/* PROFILE VIEW */}
            {appView === 'profile' && (
              <ProfileView
                profileId={resolvedProfileId}
                currentUser={currentUser}
                onUserUpdated={(updated) => setCurrentUser(updated)}
                onOpenProfile={(uid) => navigateApp('profile', uid)}
                onOpenChat={handleOpenChat}
                onOpenAccountsCentre={() => {
                  setSettingsSection('personal-details');
                  navigateApp('settings');
                }}
                onNetworkChanged={() => {
                  loadNetwork();
                  loadConversations();
                }}
                onPostMutated={() => loadPosts(feedFilter)}
              />
            )}

            {/* FRIENDS VIEW */}
            {appView === 'friends' && (
              <FriendsView
                network={network}
                onlineUserIds={onlineUserIds}
                onRefresh={() => {
                  loadNetwork();
                  loadConversations();
                }}
                onOpenProfile={(uid) => navigateApp('profile', uid)}
                onOpenChat={handleOpenChat}
              />
            )}

            {/* MESSAGES VIEW */}
            {appView === 'messages' && (
              <MessagesPage
                currentUser={currentUser}
                conversations={conversations}
                activePeer={activeChatPeer}
                messagesByPeer={messagesByPeer}
                onlineUserIds={onlineUserIds}
                typingUsers={typingUsers}
                onSelectPeer={(peer) => {
                  setActiveChatPeer(peer);
                  loadMessagesForPeer(peer.id);
                }}
                onSendMessage={handleSendMessage}
                onTyping={handleTyping}
                onOpenProfile={(uid) => navigateApp('profile', uid)}
              />
            )}

            {/* NOTIFICATIONS VIEW */}
            {appView === 'notifications' && (
              <NotificationsPage
                notifications={notifications}
                onMarkAllRead={handleMarkAllRead}
                onNotificationClick={handleNotificationClick}
              />
            )}

            {/* FACEBOOK-STYLE MENU VIEW */}
            {appView === 'menu' && (
              <MenuView
                currentUser={currentUser}
                theme={theme}
                onToggleTheme={toggleTheme}
                onNavigate={navigateApp}
                onSwitchedAccount={(switchedUser) => {
                  setCurrentUser(switchedUser);
                  setFloatingChatOpen(false);
                  setActiveChatPeer(null);
                  navigateApp('home');
                }}
                onLogout={handleLogout}
                onOpenSettingsSection={(section) => {
                  setSettingsSection(section);
                  navigateApp('settings');
                }}
              />
            )}

            {/* SETTINGS & PRIVACY VIEW */}
            {appView === 'settings' && (
              <SettingsView
                currentUser={currentUser}
                initialSection={settingsSection}
                theme={theme}
                onToggleTheme={toggleTheme}
                onBackToMenu={() => navigateApp('menu')}
                onOpenProfile={() => navigateApp('profile', currentUser.id)}
                onOpenPages={() => navigateApp('pages')}
                onUserUpdated={(updated) => setCurrentUser(updated)}
              />
            )}

            {/* MENU SHORTCUT HUB VIEWS */}
            {appView === 'dashboard' && (
              <DashboardView
                onBack={() => navigateApp('menu')}
                onOpenProfile={(uid) => navigateApp('profile', uid)}
              />
            )}

            {appView === 'saved' && (
              <SavedPostsView
                currentUser={currentUser}
                onBack={() => navigateApp('menu')}
                onOpenProfile={(uid) => navigateApp('profile', uid)}
                onToggleLike={handleToggleLike}
                onToggleSave={handleToggleSave}
                onCommentAdded={handleCommentAdded}
                onDeletePost={handleDeletePost}
              />
            )}

            {appView === 'groups' && <GroupsView onBack={() => navigateApp('menu')} />}

            {appView === 'marketplace' && (
              <MarketplaceView
                onBack={() => navigateApp('menu')}
                onMessageSeller={(sellerId, sellerName, sellerAvatar) => {
                  handleOpenChat({
                    id: sellerId,
                    name: sellerName,
                    avatar_url: sellerAvatar,
                    email: null,
                    phone: null,
                    bio: '',
                    location: '',
                    work: '',
                    cover_url: '',
                    created_at: '',
                  });
                }}
              />
            )}

            {appView === 'events' && <EventsView onBack={() => navigateApp('menu')} />}

            {appView === 'pages' && <PagesView onBack={() => navigateApp('menu')} />}

            {appView === 'reels' && (
              <ReelsView
                posts={posts}
                onBack={() => navigateApp('menu')}
                onToggleLike={handleToggleLike}
                onOpenProfile={(uid) => navigateApp('profile', uid)}
              />
            )}

            {appView === 'memories' && (
              <MemoriesView
                currentUser={currentUser}
                posts={posts}
                onBack={() => navigateApp('menu')}
                onOpenProfile={(uid) => navigateApp('profile', uid)}
                onToggleLike={handleToggleLike}
                onToggleSave={handleToggleSave}
                onCommentAdded={handleCommentAdded}
                onDeletePost={handleDeletePost}
              />
            )}

            {appView === 'birthdays' && (
              <BirthdaysView
                network={network}
                onBack={() => navigateApp('menu')}
                onOpenProfile={(uid) => navigateApp('profile', uid)}
                onSendWish={async (user, text) => {
                  await handleSendMessage(user.id, text);
                }}
              />
            )}

            {appView === 'activity' && <ActivityLogView onBack={() => navigateApp('menu')} />}
          </main>

          {/* RIGHT REAL-TIME CHAT & NOTIFICATIONS RAIL (Desktop) */}
          {appView !== 'messages' && (
            <aside className="hidden xl:block w-[300px] shrink-0 sticky top-[5.25rem]">
              <RightRailPanel
                conversations={conversations}
                notifications={notifications}
                onlineUserIds={onlineUserIds}
                onSelectChat={handleOpenChat}
                onMarkAllRead={handleMarkAllRead}
                onNotificationClick={handleNotificationClick}
              />
            </aside>
          )}
        </div>
      </div>

      {/* Desktop Floating Real-Time Chat Drawer */}
      {floatingChatOpen && activeChatPeer && appView !== 'messages' && (
        <div className="hidden lg:block fixed bottom-0 right-6 z-40">
          <ChatConversationWindow
            compact
            peer={activeChatPeer}
            currentUser={currentUser}
            messages={messagesByPeer[activeChatPeer.id] || []}
            isPeerOnline={onlineSet.has(activeChatPeer.id)}
            isPeerTyping={Boolean(typingUsers[activeChatPeer.id])}
            onSendMessage={handleSendMessage}
            onTyping={handleTyping}
            onOpenProfile={(uid) => navigateApp('profile', uid)}
            onClose={() => setFloatingChatOpen(false)}
          />
        </div>
      )}

      {/* Mobile Bottom Navigation Bar */}
      <nav
        aria-label="Mobile navigation"
        className="md:hidden fixed bottom-0 inset-x-0 z-40 h-14 bg-white/90 dark:bg-[#16191F]/90 backdrop-blur-xl border-t border-[#E5E8EE] dark:border-[#252A34] grid grid-cols-5 items-center"
      >
        <button
          type="button"
          onClick={() => navigateApp('home')}
          className={`h-full flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium cursor-pointer ${
            appView === 'home'
              ? 'text-[#1877F2] dark:text-[#60A5FA]'
              : 'text-[#65676B] dark:text-[#9CA3AF]'
          }`}
        >
          <Home className="w-5 h-5" />
          <span>Home</span>
        </button>

        <button
          type="button"
          onClick={() => navigateApp('friends')}
          className={`h-full flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium cursor-pointer ${
            appView === 'friends'
              ? 'text-[#1877F2] dark:text-[#60A5FA]'
              : 'text-[#65676B] dark:text-[#9CA3AF]'
          }`}
        >
          <Users className="w-5 h-5" />
          <span>Friends{pendingRequests > 0 ? ` (${pendingRequests})` : ''}</span>
        </button>

        <button
          type="button"
          onClick={() => navigateApp('messages')}
          className={`h-full flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium cursor-pointer ${
            appView === 'messages'
              ? 'text-[#1877F2] dark:text-[#60A5FA]'
              : 'text-[#65676B] dark:text-[#9CA3AF]'
          }`}
        >
          <MessageSquare className="w-5 h-5" />
          <span>Chat{unreadMessages > 0 ? ` (${unreadMessages})` : ''}</span>
        </button>

        <button
          type="button"
          onClick={() => navigateApp('notifications')}
          className={`h-full flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium cursor-pointer ${
            appView === 'notifications'
              ? 'text-[#1877F2] dark:text-[#60A5FA]'
              : 'text-[#65676B] dark:text-[#9CA3AF]'
          }`}
        >
          <Bell className="w-5 h-5" />
          <span>Alerts{unreadNotifications > 0 ? ` (${unreadNotifications})` : ''}</span>
        </button>

        <button
          type="button"
          onClick={() => navigateApp('menu')}
          className={`h-full flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium cursor-pointer ${
            appView === 'menu' || appView === 'settings'
              ? 'text-[#1877F2] dark:text-[#60A5FA]'
              : 'text-[#65676B] dark:text-[#9CA3AF]'
          }`}
        >
          <Menu className="w-5 h-5" />
          <span>Menu</span>
        </button>
      </nav>
    </div>
  );
}
