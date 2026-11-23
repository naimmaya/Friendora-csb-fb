import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {onAuthStateChanged, type User as FirebaseUser} from 'firebase/auth';
import {
  AlertCircle,
  Bell,
  Home,
  LogOut,
  Menu,
  MessageSquare,
  Moon,
  RefreshCw,
  Search,
  Settings,
  ShieldAlert,
  Sun,
  Users,
  X,
} from 'lucide-react';
import {AuthGate} from './components/AuthGate';
import {CallOverlay} from './components/CallOverlay';
import type {OutgoingChatPayload} from './components/ChatInputBar';
import {
  ChatConversationWindow,
  MessagesPage,
  NotificationsPage,
  RightRailPanel,
} from './components/ChatPanel';
import {FriendsView} from './components/FriendsView';
import {GroupCallOverlay} from './components/GroupCallOverlay';
import {
  ActivityLogView,
  BirthdaysView,
  DashboardView,
  EventsView,
  MarketplaceView,
  MemoriesView,
  ReelsView,
  SavedPostsView,
} from './components/HubFeaturesView';
import {Avatar, CoverImage} from './components/MediaImage';
import {MenuView} from './components/MenuView';
import {PagesHubView} from './components/PagesHubView';
import {PostCard} from './components/PostCard';
import {PostComposer} from './components/PostComposer';
import {ProfileView} from './components/ProfileView';
import {SearchPageView} from './components/SearchPageView';
import {SettingsView} from './components/SettingsView';
import {saveAccountToVault} from './lib/accountVault';
import {subscribeIncomingCalls} from './lib/callService';
import {
  auth,
  authPersistenceReady,
  formatFirestoreErrorMessage,
  isFirebaseUserVerified,
  signOutFirebase,
} from './lib/firebase';
import {
  deletePostPermanent,
  ensureAndLoadUserProfile,
  hidePostPermanent,
  markAllNotificationsReadPermanent,
  markMessagesReadPermanent,
  markNotificationReadPermanent,
  sendMessagePermanent,
  setTypingStatePermanent,
  subscribeBlockedByOthersPermanent,
  subscribeHiddenPostsPermanent,
  subscribeMessagesPermanent,
  subscribeMyBlocksPermanent,
  subscribeNetworkPermanent,
  subscribeNotificationsPermanent,
  subscribeOwnUserStatusPermanent,
  subscribePostsPermanent,
  subscribePresencePermanent,
  subscribePublicUsers,
  subscribeSavedPostsPermanent,
  subscribeTypingStatesPermanent,
  toggleFollowPermanent,
  toggleReactionPermanent,
  toggleSavePostPermanent,
  uidToNumericId,
  updatePresencePermanent,
} from './lib/firestoreStore';
import {
  startGroupCallPermanent,
  subscribeGroupsPermanent,
  subscribeIncomingGroupCalls,
} from './lib/groupService';
import {subscribePagesPermanent} from './lib/pageService';
import type {
  AppView,
  AuthView,
  BlockedUserItem,
  CallSessionDoc,
  CallType,
  ChatGroupDoc,
  ChatMessage,
  CommentItem,
  ConversationSummary,
  GroupCallDoc,
  NetworkData,
  NotificationItem,
  PostItem,
  PresenceRecord,
  ReactionType,
  SettingsSection,
  SocialPageDoc,
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
  if (path === '/search') appView = 'search';
  else if (path === '/friends') appView = 'friends';
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
    const rawSegment = decodeURIComponent(window.location.pathname.slice('/profile/'.length)).trim();
    if (rawSegment) {
      const parsed = Number(rawSegment);
      if (Number.isFinite(parsed) && parsed > 0 && /^\d+$/.test(rawSegment)) {
        profileId = parsed;
      } else {
        profileId = uidToNumericId(rawSegment);
      }
    }
  }

  const pageIdParam = params.get('page') || null;
  if (pageIdParam && appView === 'home') {
    appView = 'pages';
  }

  return {
    path,
    authView,
    appView,
    profileId,
    pageId: pageIdParam,
    resetToken: params.get('token') || '',
  };
}

export default function App() {
  const initialLoc = parseLocation();

  // Theme state
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
  });

  // Firebase Auth & routing state
  const [booting, setBooting] = useState(true);
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [pendingVerificationUser, setPendingVerificationUser] = useState<FirebaseUser | null>(null);
  const [authView, setAuthView] = useState<AuthView>(initialLoc.authView);
  const [resetTokenFromUrl, setResetTokenFromUrl] = useState(initialLoc.resetToken);
  const [appView, setAppView] = useState<AppView>(initialLoc.appView);
  const [activeProfileId, setActiveProfileId] = useState<number | null>(initialLoc.profileId);
  const [activePageId, setActivePageId] = useState<string | null>(initialLoc.pageId);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('overview');
  const [globalError, setGlobalError] = useState<string | null>(null);

  // Permanent Cloud Firestore live state (ZERO mock/demo data)
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const [feedFilter, setFeedFilter] = useState<'all' | 'following'>('all');
  const [posts, setPosts] = useState<PostItem[]>([]);
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [savedPostDocIds, setSavedPostDocIds] = useState<Set<string>>(() => new Set());
  const [hiddenPostDocIds, setHiddenPostDocIds] = useState<Set<string>>(() => new Set());
  const [myBlockedUsers, setMyBlockedUsers] = useState<BlockedUserItem[]>([]);
  const [blockedByOthersUids, setBlockedByOthersUids] = useState<Set<string>>(() => new Set());
  const [checkingSuspension, setCheckingSuspension] = useState(false);

  // Network, notifications, chat, presence, typing, groups & pages state (all synced from Cloud Firestore)
  const [network, setNetwork] = useState<NetworkData>({
    friends: [],
    incomingRequests: [],
    outgoingRequests: [],
    suggestions: [],
    followingIds: [],
  });
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeChatPeer, setActiveChatPeer] = useState<UserProfile | null>(null);
  const [floatingChatOpen, setFloatingChatOpen] = useState(false);
  const [messagesByPeer, setMessagesByPeer] = useState<Record<number, ChatMessage[]>>({});
  const [presenceByUid, setPresenceByUid] = useState<Record<string, PresenceRecord>>({});
  const [typingByPeerUid, setTypingByPeerUid] = useState<Record<string, boolean>>({});
  const [groups, setGroups] = useState<ChatGroupDoc[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [pages, setPages] = useState<SocialPageDoc[]>([]);

  // Real-time WebRTC + Firestore 1-on-1 & Group Audio/Video Call state
  const [outgoingCallTarget, setOutgoingCallTarget] = useState<{
    peer: UserProfile;
    type: CallType;
  } | null>(null);
  const [incomingCall, setIncomingCall] = useState<CallSessionDoc | null>(null);
  const [acceptedCall, setAcceptedCall] = useState<CallSessionDoc | null>(null);
  const [activeGroupCallsList, setActiveGroupCallsList] = useState<GroupCallDoc[]>([]);
  const [activeGroupCall, setActiveGroupCall] = useState<GroupCallDoc | null>(null);
  const [declinedGroupCallIds, setDeclinedGroupCallIds] = useState<Set<string>>(() => new Set());

  const hasActiveCallRef = useRef(false);
  hasActiveCallRef.current = Boolean(outgoingCallTarget || acceptedCall);

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

  const handleOpenPage = useCallback((pageId: string) => {
    setActivePageId(pageId);
    window.history.pushState({}, '', `/pages?page=${encodeURIComponent(pageId)}`);
    setAppView('pages');
    window.scrollTo({top: 0, behavior: 'smooth'});
  }, []);

  useEffect(() => {
    function handlePopState() {
      const loc = parseLocation();
      setAuthView(loc.authView);
      setResetTokenFromUrl(loc.resetToken);
      setAppView(loc.appView);
      setActiveProfileId(loc.profileId);
      setActivePageId(loc.pageId);
    }
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // 1. PERSISTENT FIREBASE AUTH LISTENER (browserLocalPersistence — survives close & reopen!)
  useEffect(() => {
    let mounted = true;
    let unsubAuth: (() => void) | null = null;

    authPersistenceReady.finally(() => {
      if (!mounted) return;
      unsubAuth = onAuthStateChanged(auth, async (fbUser) => {
        if (!mounted) return;

        if (!fbUser) {
          setPendingVerificationUser(null);
          setCurrentUser(null);
          setBooting(false);
          return;
        }

        try {
          await fbUser.reload().catch(() => {});
          const refreshed = auth.currentUser || fbUser;

          // STRICT VERIFICATION GATE: block unverified Email+Password accounts
          if (!isFirebaseUserVerified(refreshed)) {
            setPendingVerificationUser(refreshed);
            setCurrentUser(null);
            setBooting(false);
            return;
          }

          // CRITICAL: Force-refresh JWT so request.auth.token.email_verified == true in Firestore rules!
          await refreshed.getIdToken(true);

          // Auto-fetch profile, photo, cover, bio permanently from Cloud Firestore by UID
          const profile = await ensureAndLoadUserProfile(refreshed);
          if (!mounted) return;
          setPendingVerificationUser(null);
          setCurrentUser(profile);
          saveAccountToVault({
            user: profile,
            firebaseUid: refreshed.uid,
          }).catch(() => {});

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
        } catch (err) {
          if (!mounted) return;
          setGlobalError(formatFirestoreErrorMessage(err));
        } finally {
          if (mounted) setBooting(false);
        }
      });
    });

    return () => {
      mounted = false;
      unsubAuth?.();
    };
  }, []);

  // Ask for Microphone permission silently once on app open (never shows a red error bar if denied!)
  useEffect(() => {
    if (!currentUser?.uid) return;
    if (!navigator.mediaDevices?.getUserMedia) return;
    try {
      if (sessionStorage.getItem('verve_mic_prompted') === '1') return;
    } catch {
      // Ignore storage errors
    }

    let cancelled = false;
    (async () => {
      try {
        if (navigator.permissions?.query) {
          const status = await navigator.permissions.query({
            name: 'microphone' as PermissionName,
          });
          if (cancelled || status.state !== 'prompt') {
            try {
              sessionStorage.setItem('verve_mic_prompted', '1');
            } catch {
              // Ignore
            }
            return;
          }
        }
        try {
          sessionStorage.setItem('verve_mic_prompted', '1');
        } catch {
          // Ignore
        }
        const stream = await navigator.mediaDevices.getUserMedia({audio: true});
        stream.getTracks().forEach((t) => t.stop());
      } catch {
        // User denied or dismissed — stay completely silent (no red error bar)
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [currentUser?.uid]);

  // 2. REAL-TIME FIRESTORE SUBSCRIPTIONS: Users, Posts, Saved, Hidden, Notifications, Calls, Presence, Typing, Groups, Group Calls, Pages
  useEffect(() => {
    const myUid = currentUser?.uid;
    if (!myUid) {
      setAllUsers([]);
      setPosts([]);
      setSavedPostDocIds(new Set());
      setHiddenPostDocIds(new Set());
      setMyBlockedUsers([]);
      setBlockedByOthersUids(new Set());
      setNotifications([]);
      setIncomingCall(null);
      setPresenceByUid({});
      setTypingByPeerUid({});
      setGroups([]);
      setActiveGroupId(null);
      setActiveGroupCallsList([]);
      setActiveGroupCall(null);
      setPages([]);
      return;
    }

    setLoadingPosts(true);

    // Presence heartbeat: mark online immediately, refresh every 45s, mark offline on unload
    void updatePresencePermanent(myUid, true);
    const heartbeat = window.setInterval(() => {
      if (!document.hidden) {
        void updatePresencePermanent(myUid, true);
      }
    }, 45000);
    const handleVisibility = () => {
      void updatePresencePermanent(myUid, !document.hidden);
    };
    const handleBeforeUnload = () => {
      void updatePresencePermanent(myUid, false);
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('beforeunload', handleBeforeUnload);

    const unsubUsers = subscribePublicUsers(
      (users) => {
        setAllUsers(users);
        const mine = users.find((u) => u.uid === myUid);
        if (mine) {
          setCurrentUser((prev) => {
            if (!prev || prev.uid !== myUid) return prev;
            if (
              prev.name === mine.name &&
              prev.bio === mine.bio &&
              prev.work === mine.work &&
              prev.location === mine.location &&
              prev.avatar_url === mine.avatar_url &&
              prev.cover_url === mine.cover_url
            ) {
              return prev;
            }
            return {
              ...prev,
              name: mine.name,
              bio: mine.bio,
              work: mine.work,
              location: mine.location,
              avatar_url: mine.avatar_url,
              cover_url: mine.cover_url,
            };
          });
        }
      },
      (err) => {
        setGlobalError(formatFirestoreErrorMessage(err));
      },
    );

    const unsubPosts = subscribePostsPermanent(
      myUid,
      (loadedPosts) => {
        setPosts(loadedPosts);
        setLoadingPosts(false);
      },
      (err) => {
        setLoadingPosts(false);
        setGlobalError(formatFirestoreErrorMessage(err));
      },
    );

    const unsubOwnStatus = subscribeOwnUserStatusPermanent(myUid, (patch) => {
      setCurrentUser((prev) => {
        if (!prev || prev.uid !== myUid) return prev;
        if (
          prev.status === patch.status &&
          prev.is_suspended === patch.is_suspended &&
          prev.report_count === patch.report_count
        ) {
          return prev;
        }
        return {
          ...prev,
          status: patch.status,
          is_suspended: patch.is_suspended,
          report_count: patch.report_count,
        };
      });
    });

    const unsubMyBlocks = subscribeMyBlocksPermanent(myUid, setMyBlockedUsers);
    const unsubBlockedByOthers = subscribeBlockedByOthersPermanent(myUid, setBlockedByOthersUids);
    const unsubSaved = subscribeSavedPostsPermanent(myUid, setSavedPostDocIds);
    const unsubHidden = subscribeHiddenPostsPermanent(myUid, setHiddenPostDocIds);
    const unsubPresence = subscribePresencePermanent(setPresenceByUid);
    const unsubTyping = subscribeTypingStatesPermanent(myUid, setTypingByPeerUid);

    const unsubNotifs = subscribeNotificationsPermanent(myUid, (list) => {
      setNotifications(list);
    });

    const unsubCalls = subscribeIncomingCalls(myUid, (call) => {
      // Never clear or override while user is already in an active outgoing or accepted call
      if (hasActiveCallRef.current) {
        setIncomingCall(null);
        return;
      }
      setIncomingCall(call);
    });

    const unsubGroups = subscribeGroupsPermanent(myUid, (loadedGroups) => {
      setGroups(loadedGroups);
    });

    const unsubGroupCalls = subscribeIncomingGroupCalls(myUid, (callsList) => {
      setActiveGroupCallsList(callsList);
    });

    const unsubPages = subscribePagesPermanent(
      (loadedPages) => {
        setPages(loadedPages);
      },
      (err) => {
        setGlobalError(formatFirestoreErrorMessage(err));
      },
    );

    return () => {
      window.clearInterval(heartbeat);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      unsubUsers();
      unsubOwnStatus();
      unsubMyBlocks();
      unsubBlockedByOthers();
      unsubPosts();
      unsubSaved();
      unsubHidden();
      unsubPresence();
      unsubTyping();
      unsubNotifs();
      unsubCalls();
      unsubGroups();
      unsubGroupCalls();
      unsubPages();
    };
  }, [currentUser?.uid]);

  // 3. REAL-TIME FIRESTORE SUBSCRIPTIONS: Friends/Follows & Direct Messages + Call History
  useEffect(() => {
    const myUid = currentUser?.uid;
    if (!myUid) {
      setNetwork({
        friends: [],
        incomingRequests: [],
        outgoingRequests: [],
        suggestions: [],
        followingIds: [],
      });
      setMessagesByPeer({});
      setConversations([]);
      return;
    }

    const unsubNetwork = subscribeNetworkPermanent(
      myUid,
      allUsers,
      (net) => {
        setNetwork(net);
      },
      (err) => {
        setGlobalError(formatFirestoreErrorMessage(err));
      },
    );

    const unsubMessages = subscribeMessagesPermanent(myUid, allUsers, (data) => {
      setMessagesByPeer(data.messagesByPeer);
      setConversations(data.conversations);
    });

    return () => {
      unsubNetwork();
      unsubMessages();
    };
  }, [currentUser?.uid, allUsers]);

  // Keep activeChatPeer synced with fresh Firestore profile updates
  useEffect(() => {
    if (!activeChatPeer) return;
    const fresh = allUsers.find((u) => u.id === activeChatPeer.id);
    if (fresh && (fresh.name !== activeChatPeer.name || fresh.avatar_url !== activeChatPeer.avatar_url)) {
      setActiveChatPeer(fresh);
    }
  }, [allUsers, activeChatPeer]);

  // Real-time blocked & suspended UID sets (hides blocked/suspended people & posts instantly)
  const myBlockedUids = useMemo(
    () => new Set(myBlockedUsers.map((b) => b.blockedUid)),
    [myBlockedUsers],
  );

  const hiddenUserUids = useMemo(() => {
    const set = new Set<string>();
    for (const uid of myBlockedUids) set.add(uid);
    for (const uid of blockedByOthersUids) set.add(uid);
    for (const u of allUsers) {
      if (u.uid && u.uid !== currentUser?.uid && (u.is_suspended || u.status === 'suspended')) {
        set.add(u.uid);
      }
    }
    return set;
  }, [myBlockedUids, blockedByOthersUids, allUsers, currentUser?.uid]);

  const visibleUsers = useMemo(
    () => allUsers.filter((u) => !u.uid || !hiddenUserUids.has(u.uid)),
    [allUsers, hiddenUserUids],
  );

  const filteredNetwork = useMemo<NetworkData>(() => {
    const allow = (u: UserProfile) => !u.uid || !hiddenUserUids.has(u.uid);
    return {
      friends: network.friends.filter(allow),
      incomingRequests: network.incomingRequests.filter(allow),
      outgoingRequests: network.outgoingRequests.filter(allow),
      suggestions: network.suggestions.filter(allow),
      followingIds: network.followingIds,
    };
  }, [network, hiddenUserUids]);

  const filteredConversations = useMemo(
    () => conversations.filter((c) => !c.user.uid || !hiddenUserUids.has(c.user.uid)),
    [conversations, hiddenUserUids],
  );

  useEffect(() => {
    if (activeChatPeer?.uid && hiddenUserUids.has(activeChatPeer.uid)) {
      setActiveChatPeer(null);
      setFloatingChatOpen(false);
    }
  }, [activeChatPeer, hiddenUserUids]);

  // Decorated posts with real Firestore saved_by_me status (excludes blocked/suspended authors)
  const decoratedPosts = useMemo(() => {
    return posts
      .filter((p) => !p.author_uid || !hiddenUserUids.has(p.author_uid))
      .map((p) => ({
        ...p,
        saved_by_me: Boolean(p.docId && savedPostDocIds.has(p.docId)),
      }));
  }, [posts, savedPostDocIds, hiddenUserUids]);

  // Filtered feed posts (excludes posts the user explicitly hid in Firestore)
  const visiblePosts = useMemo(() => {
    const notHidden = decoratedPosts.filter((p) => !p.docId || !hiddenPostDocIds.has(p.docId));
    if (feedFilter === 'all' || !currentUser) return notHidden;
    const allowedIds = new Set<number>([
      currentUser.id,
      ...filteredNetwork.friends.map((f) => f.id),
      ...filteredNetwork.followingIds,
    ]);
    const followedPageIds = new Set<string>(
      pages
        .filter((pg) => currentUser.uid && pg.followers.includes(currentUser.uid))
        .map((pg) => pg.pageId),
    );
    return notHidden.filter(
      (p) =>
        allowedIds.has(p.user_id) || (p.page_id ? followedPageIds.has(p.page_id) : false),
    );
  }, [
    decoratedPosts,
    hiddenPostDocIds,
    feedFilter,
    currentUser,
    filteredNetwork.friends,
    filteredNetwork.followingIds,
    pages,
  ]);

  // Real-time online users from Cloud Firestore presence collection
  const onlineUserIds = useMemo(() => {
    const now = Date.now();
    const ids = new Set<number>();
    if (currentUser) ids.add(currentUser.id);
    for (const [uid, rec] of Object.entries(presenceByUid)) {
      if (!rec.online) continue;
      const lastMs = rec.lastSeen ? new Date(rec.lastSeen).getTime() : 0;
      if (now - lastMs < 120000) {
        ids.add(uidToNumericId(uid));
      }
    }
    return Array.from(ids);
  }, [presenceByUid, currentUser]);

  // Convert real-time Firestore typingByPeerUid to numeric peerId map for ChatPanel
  const typingUsers = useMemo(() => {
    const map: Record<number, boolean> = {};
    for (const [uid, isTyping] of Object.entries(typingByPeerUid)) {
      if (isTyping) map[uidToNumericId(uid)] = true;
    }
    return map;
  }, [typingByPeerUid]);

  // Incoming Group Call popup (any ringing/active group call I haven't joined or declined)
  const incomingGroupCall = useMemo(() => {
    const myUid = currentUser?.uid;
    if (!myUid || activeGroupCall) return null;
    return (
      activeGroupCallsList.find(
        (c) =>
          c.hostUid !== myUid &&
          !c.activeUids.includes(myUid) &&
          !declinedGroupCallIds.has(c.id),
      ) || null
    );
  }, [activeGroupCallsList, activeGroupCall, currentUser?.uid, declinedGroupCallIds]);

  // Handlers
  function handleUserUpdated(updated: UserProfile) {
    setCurrentUser(updated);
    saveAccountToVault({user: updated, firebaseUid: updated.uid || null}).catch(() => {});
  }

  function handleAuthenticated(user: UserProfile, token: string) {
    saveAccountToVault({user, firebaseUid: user.uid || null, sessionToken: token}).catch(() => {});
    setPendingVerificationUser(null);
    setCurrentUser(user);
    setGlobalError(null);
    setMessagesByPeer({});
    setFloatingChatOpen(false);
    setActiveChatPeer(null);
    window.history.replaceState({}, '', '/');
    setAppView('home');
    setActiveProfileId(user.id);
  }

  async function handleAddAccount(mode: 'login' | 'register') {
    await signOutFirebase();
    setCurrentUser(null);
    setPendingVerificationUser(null);
    setFloatingChatOpen(false);
    setActiveChatPeer(null);
    setMessagesByPeer({});
    const targetPath = mode === 'register' ? '/register' : '/login';
    window.history.replaceState({}, '', targetPath);
    setAuthView(mode);
  }

  async function handleLogout() {
    if (currentUser?.uid) {
      await updatePresencePermanent(currentUser.uid, false).catch(() => {});
    }
    await signOutFirebase();
    setCurrentUser(null);
    setPendingVerificationUser(null);
    setFloatingChatOpen(false);
    setActiveChatPeer(null);
    setOutgoingCallTarget(null);
    setIncomingCall(null);
    setAcceptedCall(null);
    setActiveGroupCall(null);
    setMessagesByPeer({});
    window.history.replaceState({}, '', '/login');
    setAuthView('login');
  }

  async function handleToggleLike(postId: number, reaction?: ReactionType) {
    if (!currentUser) return;
    const target = posts.find((p) => p.id === postId);
    if (!target?.docId) return;
    try {
      const data = await toggleReactionPermanent(
        target.docId,
        currentUser,
        target.author_uid,
        reaction || 'like',
      );
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
    } catch (err) {
      setGlobalError(formatFirestoreErrorMessage(err));
    }
  }

  async function handleToggleSave(postId: number) {
    if (!currentUser?.uid) return;
    const target = posts.find((p) => p.id === postId);
    if (!target?.docId) return;
    try {
      await toggleSavePostPermanent(currentUser.uid, target.docId);
    } catch (err) {
      setGlobalError(formatFirestoreErrorMessage(err));
    }
  }

  async function handleHidePost(post: PostItem) {
    if (!currentUser?.uid || !post.docId) return;
    try {
      await hidePostPermanent(currentUser.uid, post.docId);
    } catch (err) {
      setGlobalError(formatFirestoreErrorMessage(err));
    }
  }

  async function handleToggleFollowAuthor(authorUid: string) {
    if (!currentUser?.uid || !authorUid || authorUid === currentUser.uid) return;
    const target = allUsers.find((u) => u.uid === authorUid);
    if (!target) return;
    try {
      await toggleFollowPermanent(currentUser, target);
    } catch (err) {
      setGlobalError(formatFirestoreErrorMessage(err));
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

  function handleCommentDeleted(postId: number, commentId: number) {
    setPosts((prev) =>
      prev.map((p) => {
        if (p.id !== postId) return p;
        const nextComments = p.comments.filter((c) => c.id !== commentId);
        return {
          ...p,
          comments: nextComments,
          comments_count: nextComments.length,
        };
      }),
    );
  }

  async function handleDeletePost(postId: number) {
    const target = posts.find((p) => p.id === postId);
    if (!target?.docId) return;
    try {
      await deletePostPermanent(target.docId, {
        imageUrl: target.image_url,
        videoUrl: target.video_url,
      });
      setPosts((prev) => prev.filter((p) => p.id !== postId));
    } catch (err) {
      setGlobalError(formatFirestoreErrorMessage(err));
    }
  }

  function markPeerMessagesRead(peerId: number) {
    if (!currentUser?.uid) return;
    const list = messagesByPeer[peerId] || [];
    const unreadDocIds = list
      .filter((m) => m.receiver_uid === currentUser.uid && !m.read && m.docId)
      .map((m) => m.docId!);
    if (unreadDocIds.length > 0) {
      void markMessagesReadPermanent(unreadDocIds);
    }
  }

  function handleOpenChat(peer: UserProfile) {
    setActiveChatPeer(peer);
    markPeerMessagesRead(peer.id);
    if (window.innerWidth >= 1024 && appView !== 'messages') {
      setFloatingChatOpen(true);
    } else {
      navigateApp('messages');
    }
  }

  async function handleSendMessage(peerId: number, payload: OutgoingChatPayload) {
    if (!currentUser?.uid) return;
    const peer =
      activeChatPeer?.id === peerId
        ? activeChatPeer
        : allUsers.find((u) => u.id === peerId) ||
          conversations.find((c) => c.user.id === peerId)?.user;
    if (!peer?.uid) {
      setGlobalError('Recipient account is not available in Cloud Firestore yet.');
      return;
    }
    try {
      await sendMessagePermanent(currentUser.uid, peer.uid, payload.content, undefined, {
        messageType: payload.messageType,
        mediaUrl: payload.mediaUrl,
        mediaName: payload.mediaName,
        mediaSize: payload.mediaSize,
        voiceDurationSec: payload.voiceDurationSec,
        locationLat: payload.locationLat,
        locationLng: payload.locationLng,
        locationLabel: payload.locationLabel,
      });
    } catch (err) {
      setGlobalError(formatFirestoreErrorMessage(err));
      throw err;
    }
  }

  function handleStartCall(peer: UserProfile, type: CallType) {
    if (!currentUser?.uid || !peer.uid) {
      setGlobalError('Both accounts must be verified to place a live Audio or Video call.');
      return;
    }
    setIncomingCall(null);
    setAcceptedCall(null);
    setOutgoingCallTarget({peer, type});
  }

  async function handleStartGroupCall(group: ChatGroupDoc, type: CallType) {
    if (!currentUser?.uid) return;
    try {
      const created = await startGroupCallPermanent(group, currentUser, type);
      setActiveGroupCall(created);
    } catch (err) {
      setGlobalError(formatFirestoreErrorMessage(err));
    }
  }

  function handleTyping(peerId: number, isTyping: boolean) {
    if (!currentUser?.uid) return;
    const peer =
      activeChatPeer?.id === peerId
        ? activeChatPeer
        : allUsers.find((u) => u.id === peerId) ||
          conversations.find((c) => c.user.id === peerId)?.user;
    if (!peer?.uid) return;
    void setTypingStatePermanent(currentUser.uid, peer.uid, isTyping);
  }

  async function handleMarkAllRead() {
    const unreadIds = notifications.filter((n) => !n.read && n.docId).map((n) => n.docId!);
    if (unreadIds.length === 0) return;
    await markAllNotificationsReadPermanent(unreadIds);
  }

  async function handleNotificationClick(notif: NotificationItem) {
    if (!notif.read && notif.docId) {
      void markNotificationReadPermanent(notif.docId);
    }
    if (notif.type === 'friend_request') {
      navigateApp('friends');
    } else if (notif.type === 'call' || notif.type === 'message') {
      navigateApp('messages');
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
          <p className="text-xs text-[#65676B] dark:text-[#9CA3AF]">
            Loading your Cloud Firestore profile...
          </p>
        </div>
      </div>
    );
  }

  // Mandatory Entry Gate for unauthenticated OR unverified-email users
  if (!currentUser) {
    return (
      <AuthGate
        authView={authView}
        resetTokenFromUrl={resetTokenFromUrl}
        pendingVerificationUser={pendingVerificationUser}
        onPendingVerificationChange={setPendingVerificationUser}
        onNavigateAuth={navigateAuth}
        onAuthenticated={handleAuthenticated}
        theme={theme}
        onToggleTheme={toggleTheme}
      />
    );
  }

  // Mandatory Suspended Account Gate (auto-triggered after 10 unique reports; Admin can un-suspend in Firebase)
  if (currentUser.is_suspended || currentUser.status === 'suspended') {
    return (
      <div className="min-h-screen bg-[#F4F6F9] dark:bg-[#0E1014] flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white dark:bg-[#16191F] border border-[#E5E8EE] dark:border-[#252A34] rounded-3xl p-7 sm:p-8 text-center space-y-5 shadow-xl">
          <span className="w-16 h-16 mx-auto rounded-full bg-[#FEF2F2] dark:bg-[#3B181A] text-[#DC2626] dark:text-[#F87171] flex items-center justify-center">
            <ShieldAlert className="w-8 h-8" />
          </span>

          <div className="space-y-2">
            <h1 className="text-xl sm:text-2xl font-display font-bold text-[#0F172A] dark:text-white">
              Account Suspended
            </h1>
            <p className="text-sm font-medium text-[#DC2626] dark:text-[#FCA5A5]">
              Your account is suspended due to multiple reports
            </p>
            <p className="text-xs text-[#64748B] dark:text-[#94A3B8] leading-relaxed">
              Your profile and posts are currently hidden from other members. If an administrator
              reviews and restores your account, click Refresh Status below to continue.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-2.5 pt-2">
            <button
              type="button"
              disabled={checkingSuspension}
              onClick={async () => {
                const fbUser = auth.currentUser;
                if (!fbUser) return;
                setCheckingSuspension(true);
                try {
                  const fresh = await ensureAndLoadUserProfile(fbUser);
                  setCurrentUser(fresh);
                } catch {
                  // Ignore
                } finally {
                  setCheckingSuspension(false);
                }
              }}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 h-10 rounded-xl bg-[#1877F2] hover:bg-[#166FE5] text-white text-sm font-semibold disabled:opacity-60 cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 ${checkingSuspension ? 'animate-spin' : ''}`} />
              <span>{checkingSuspension ? 'Checking...' : 'Refresh Status'}</span>
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 h-10 rounded-xl bg-[#F1F5F9] dark:bg-[#232732] hover:bg-[#E2E8F0] dark:hover:bg-[#2E3442] text-[#0F172A] dark:text-white text-sm font-semibold cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  const unreadNotifications = notifications.filter((n) => !n.read).length;
  const unreadMessages = conversations.reduce((sum, c) => sum + c.unread_count, 0);
  const pendingRequests = network.incomingRequests.length;
  const resolvedProfileId = activeProfileId ?? currentUser.id;
  const onlineSet = new Set(onlineUserIds);
  const activeIncomingOrAcceptedCall = acceptedCall || incomingCall;
  const callOverlayVisible = Boolean(outgoingCallTarget || activeIncomingOrAcceptedCall);
  const callOverlayKey = outgoingCallTarget
    ? `out_${outgoingCallTarget.peer.uid || outgoingCallTarget.peer.id}_${outgoingCallTarget.type}`
    : activeIncomingOrAcceptedCall
      ? `in_${activeIncomingOrAcceptedCall.id}`
      : 'idle';

  return (
    <div className="min-h-screen bg-[#F4F6F9] dark:bg-[#0E1014] text-[#0F172A] dark:text-[#F1F5F9] pb-16 md:pb-8">
      {/* Real-time Facebook Messenger-style 1-on-1 Audio & Video Call Overlay */}
      {callOverlayVisible && (
        <CallOverlay
          key={callOverlayKey}
          currentUser={currentUser}
          outgoingTarget={outgoingCallTarget}
          incomingCall={activeIncomingOrAcceptedCall}
          onAcceptCall={(call) => {
            setAcceptedCall(call);
            setIncomingCall(null);
          }}
          inviteCandidates={network.friends.length > 0 ? network.friends : allUsers}
          onCloseCall={() => {
            setOutgoingCallTarget(null);
            setAcceptedCall(null);
            setIncomingCall(null);
          }}
        />
      )}

      {/* Real-time Multi-Member Group Audio & Video Call Overlay */}
      {(activeGroupCall || incomingGroupCall) && (
        <GroupCallOverlay
          key={(activeGroupCall || incomingGroupCall)!.id}
          call={(activeGroupCall || incomingGroupCall)!}
          mode={activeGroupCall ? 'active' : 'incoming'}
          currentUser={currentUser}
          allUsers={allUsers}
          onAcceptIncoming={(accepted) => {
            setActiveGroupCall(accepted);
          }}
          onDeclineIncoming={(callId) => {
            setDeclinedGroupCallIds((prev) => {
              const next = new Set(prev);
              next.add(callId);
              return next;
            });
          }}
          onCallEnded={(endedCallId) => {
            setActiveGroupCall(null);
            setDeclinedGroupCallIds((prev) => {
              const next = new Set(prev);
              next.add(endedCallId);
              return next;
            });
          }}
        />
      )}

      {/* Real Firestore error banner (never hides failures!) */}
      {globalError && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 w-[92%] max-w-lg rounded-2xl bg-[#FEF2F2] dark:bg-[#3B181A] border border-[#FECACA] dark:border-[#7F1D1D] px-4 py-3 text-xs sm:text-sm text-[#B91C1C] dark:text-[#FCA5A5] shadow-xl flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="flex-1">{globalError}</span>
          <button
            type="button"
            onClick={() => setGlobalError(null)}
            aria-label="Dismiss error"
            className="p-0.5 rounded hover:bg-black/10 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

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
            {/* Account Summary Card */}
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
              appView === 'profile' ||
              appView === 'messages' ||
              appView === 'groups' ||
              appView === 'pages'
                ? 'max-w-[820px]'
                : 'max-w-[660px]'
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
                {/* Single Facebook-style Home Top Search Bar: [Profile Photo] [Search...] [Bell] [Messenger] */}
                <div className="bg-white dark:bg-[#16191F] border border-[#E5E8EE] dark:border-[#252A34] rounded-2xl px-3 py-2.5 flex items-center gap-2.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
                  <button
                    type="button"
                    onClick={() => navigateApp('profile', currentUser.id)}
                    aria-label="Open my profile"
                    className="shrink-0 rounded-full cursor-pointer"
                  >
                    <Avatar src={currentUser.avatar_url} name={currentUser.name} size="sm" />
                  </button>

                  <button
                    type="button"
                    onClick={() => navigateApp('search')}
                    aria-label="Search people and pages"
                    className="flex-1 min-w-0 h-10 px-3.5 rounded-full bg-[#F0F2F5] dark:bg-[#0E1014] hover:bg-[#E4E6EB] dark:hover:bg-[#1E222B] flex items-center gap-2 text-left text-sm text-[#64748B] dark:text-[#94A3B8] transition-colors cursor-pointer"
                  >
                    <Search className="w-4 h-4 shrink-0" />
                    <span className="truncate">Search...</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => navigateApp('notifications')}
                    aria-label="Open notifications"
                    className="relative w-10 h-10 rounded-full bg-[#F0F2F5] dark:bg-[#232732] hover:bg-[#E4E6EB] dark:hover:bg-[#2E3442] text-[#0F172A] dark:text-white flex items-center justify-center shrink-0 transition-colors cursor-pointer"
                  >
                    <Bell className="w-[18px] h-[18px]" />
                    {unreadNotifications > 0 && (
                      <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[#EF4444] text-white text-[10px] font-bold flex items-center justify-center tabular-nums">
                        {unreadNotifications > 99 ? '99+' : unreadNotifications}
                      </span>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => navigateApp('messages')}
                    aria-label="Open Messenger"
                    className="relative w-10 h-10 rounded-full bg-[#F0F2F5] dark:bg-[#232732] hover:bg-[#E4E6EB] dark:hover:bg-[#2E3442] text-[#0F172A] dark:text-white flex items-center justify-center shrink-0 transition-colors cursor-pointer"
                  >
                    <MessageSquare className="w-[18px] h-[18px]" />
                    {unreadMessages > 0 && (
                      <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[#1877F2] text-white text-[10px] font-bold flex items-center justify-center tabular-nums">
                        {unreadMessages > 99 ? '99+' : unreadMessages}
                      </span>
                    )}
                  </button>
                </div>

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
                ) : visiblePosts.length === 0 ? (
                  <div className="bg-white dark:bg-[#1C1E21] border border-[#E4E6EB] dark:border-[#2E3035] rounded-2xl p-10 text-center space-y-2">
                    <p className="text-base font-display font-semibold text-[#111827] dark:text-white">
                      {feedFilter === 'following'
                        ? 'No posts from friends or people you follow yet'
                        : 'No posts yet'}
                    </p>
                    <p className="text-sm text-[#65676B] dark:text-[#9CA3AF]">
                      {feedFilter === 'following'
                        ? 'Connect with people in Friends or switch to All Updates.'
                        : 'Share your first text, photo, or video above — it saves permanently to Cloud Firestore.'}
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
                  visiblePosts.map((post) => (
                    <PostCard
                      key={post.id}
                      post={post}
                      currentUser={currentUser}
                      isFollowingAuthor={network.followingIds.includes(post.user_id)}
                      onOpenProfile={(uid) => navigateApp('profile', uid)}
                      onOpenPage={handleOpenPage}
                      onToggleLike={handleToggleLike}
                      onToggleSave={handleToggleSave}
                      onHidePost={handleHidePost}
                      onToggleFollowAuthor={handleToggleFollowAuthor}
                      onCommentAdded={handleCommentAdded}
                      onCommentDeleted={handleCommentDeleted}
                      onDeletePost={handleDeletePost}
                    />
                  ))
                )}
              </div>
            )}

            {/* UNIFIED REAL-TIME FIRESTORE SEARCH PAGE (People + Pages) */}
            {appView === 'search' && (
              <SearchPageView
                currentUser={currentUser}
                allUsers={visibleUsers}
                pages={pages}
                network={filteredNetwork}
                onlineUserIds={onlineUserIds}
                onBack={() => navigateApp('home')}
                onOpenProfile={(uid) => navigateApp('profile', uid)}
                onOpenChat={handleOpenChat}
                onOpenPage={handleOpenPage}
              />
            )}

            {/* PROFILE VIEW */}
            {appView === 'profile' && (
              <ProfileView
                profileId={resolvedProfileId}
                currentUser={currentUser}
                allUsers={allUsers}
                allPosts={decoratedPosts}
                pages={pages}
                network={filteredNetwork}
                myBlockedUids={myBlockedUids}
                blockedByOthersUids={blockedByOthersUids}
                onOpenBlockedSettings={() => {
                  setSettingsSection('blocked-people');
                  navigateApp('settings');
                }}
                onGoHome={() => navigateApp('home')}
                onUserUpdated={handleUserUpdated}
                onOpenProfile={(uid) => navigateApp('profile', uid)}
                onOpenPage={handleOpenPage}
                onOpenPagesHub={() => {
                  setActivePageId(null);
                  navigateApp('pages');
                }}
                onOpenChat={handleOpenChat}
                onStartCall={handleStartCall}
                onOpenAccountsCentre={() => {
                  setSettingsSection('personal-details');
                  navigateApp('settings');
                }}
                onNetworkChanged={() => {}}
                onPostMutated={() => {}}
                onPostCreated={(newPost) => {
                  setPosts((prev) =>
                    prev.some((p) => p.id === newPost.id) ? prev : [newPost, ...prev],
                  );
                }}
                onToggleLikePost={handleToggleLike}
                onToggleSavePost={handleToggleSave}
                onHidePost={handleHidePost}
                onToggleFollowAuthor={handleToggleFollowAuthor}
                onCommentAddedPost={handleCommentAdded}
                onCommentDeletedPost={handleCommentDeleted}
                onDeletePostItem={handleDeletePost}
              />
            )}

            {/* FRIENDS VIEW */}
            {appView === 'friends' && (
              <FriendsView
                currentUser={currentUser}
                network={filteredNetwork}
                onlineUserIds={onlineUserIds}
                onRefresh={() => {}}
                onOpenProfile={(uid) => navigateApp('profile', uid)}
                onOpenChat={handleOpenChat}
                onStartCall={handleStartCall}
              />
            )}

            {/* MESSAGES & REAL-TIME GROUP CHATS VIEW */}
            {(appView === 'messages' || appView === 'groups') && (
              <MessagesPage
                currentUser={currentUser}
                allUsers={visibleUsers}
                friends={filteredNetwork.friends}
                conversations={filteredConversations}
                groups={groups}
                activePeer={activeChatPeer}
                activeGroupId={activeGroupId}
                messagesByPeer={messagesByPeer}
                onlineUserIds={onlineUserIds}
                presenceByUid={presenceByUid}
                typingUsers={typingUsers}
                initialListMode={appView === 'groups' ? 'groups' : undefined}
                onSelectPeer={(peer) => {
                  setActiveChatPeer(peer);
                  markPeerMessagesRead(peer.id);
                }}
                onSelectGroup={(gid) => setActiveGroupId(gid)}
                onSendMessage={handleSendMessage}
                onTyping={handleTyping}
                onOpenProfile={(uid) => navigateApp('profile', uid)}
                onStartCall={handleStartCall}
                onStartGroupCall={handleStartGroupCall}
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
                  setMessagesByPeer({});
                  navigateApp('home');
                }}
                onAddAccount={handleAddAccount}
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
                onOpenPages={() => {
                  setActivePageId(null);
                  navigateApp('pages');
                }}
                onUserUpdated={handleUserUpdated}
                blockedUsers={myBlockedUsers}
              />
            )}

            {/* MENU SHORTCUT HUB VIEWS */}
            {appView === 'dashboard' && (
              <DashboardView
                currentUser={currentUser}
                posts={decoratedPosts}
                network={network}
                onBack={() => navigateApp('menu')}
                onOpenProfile={(uid) => navigateApp('profile', uid)}
              />
            )}

            {appView === 'saved' && (
              <SavedPostsView
                currentUser={currentUser}
                posts={decoratedPosts}
                followingIds={network.followingIds}
                onBack={() => navigateApp('menu')}
                onOpenProfile={(uid) => navigateApp('profile', uid)}
                onOpenPage={handleOpenPage}
                onToggleLike={handleToggleLike}
                onToggleSave={handleToggleSave}
                onHidePost={handleHidePost}
                onToggleFollowAuthor={handleToggleFollowAuthor}
                onCommentAdded={handleCommentAdded}
                onCommentDeleted={handleCommentDeleted}
                onDeletePost={handleDeletePost}
              />
            )}

            {appView === 'marketplace' && (
              <MarketplaceView
                onBack={() => navigateApp('menu')}
                onMessageSeller={(sellerId, sellerName, sellerAvatar) => {
                  const found = allUsers.find((u) => u.id === sellerId);
                  handleOpenChat(
                    found || {
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
                    },
                  );
                }}
              />
            )}

            {appView === 'events' && <EventsView onBack={() => navigateApp('menu')} />}

            {/* FACEBOOK-STYLE PAGES HUB & PAGE PROFILES */}
            {appView === 'pages' && (
              <PagesHubView
                currentUser={currentUser}
                allUsers={allUsers}
                pages={pages}
                allPosts={decoratedPosts}
                activePageId={activePageId}
                followingIds={network.followingIds}
                onSelectPage={(pid) => {
                  setActivePageId(pid);
                  const url = pid ? `/pages?page=${encodeURIComponent(pid)}` : '/pages';
                  window.history.pushState({}, '', url);
                }}
                onBack={() => {
                  setActivePageId(null);
                  navigateApp('menu');
                }}
                onOpenProfile={(uid) => navigateApp('profile', uid)}
                onPostCreated={(newPost) => {
                  setPosts((prev) =>
                    prev.some((p) => p.id === newPost.id) ? prev : [newPost, ...prev],
                  );
                }}
                onToggleLike={handleToggleLike}
                onToggleSave={handleToggleSave}
                onHidePost={handleHidePost}
                onToggleFollowAuthor={handleToggleFollowAuthor}
                onCommentAdded={handleCommentAdded}
                onCommentDeleted={handleCommentDeleted}
                onDeletePost={handleDeletePost}
              />
            )}

            {appView === 'reels' && (
              <ReelsView
                posts={decoratedPosts}
                onBack={() => navigateApp('menu')}
                onToggleLike={handleToggleLike}
                onOpenProfile={(uid) => navigateApp('profile', uid)}
              />
            )}

            {appView === 'memories' && (
              <MemoriesView
                currentUser={currentUser}
                posts={decoratedPosts}
                onBack={() => navigateApp('menu')}
                onOpenProfile={(uid) => navigateApp('profile', uid)}
                onOpenPage={handleOpenPage}
                onToggleLike={handleToggleLike}
                onToggleSave={handleToggleSave}
                onHidePost={handleHidePost}
                onCommentAdded={handleCommentAdded}
                onCommentDeleted={handleCommentDeleted}
                onDeletePost={handleDeletePost}
              />
            )}

            {appView === 'birthdays' && (
              <BirthdaysView
                network={network}
                onBack={() => navigateApp('menu')}
                onOpenProfile={(uid) => navigateApp('profile', uid)}
                onSendWish={async (user, text) => {
                  await handleSendMessage(user.id, {content: text, messageType: 'text'});
                }}
              />
            )}

            {appView === 'activity' && <ActivityLogView onBack={() => navigateApp('menu')} />}
          </main>

          {/* RIGHT REAL-TIME CHAT & NOTIFICATIONS RAIL (Desktop) */}
          {appView !== 'messages' && appView !== 'groups' && (
            <aside className="hidden xl:block w-[300px] shrink-0 sticky top-[5.25rem]">
              <RightRailPanel
                conversations={filteredConversations}
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

      {/* Desktop Floating Real-Time Chat Drawer (with Rich Messenger Input + Audio & Video Call buttons) */}
      {floatingChatOpen && activeChatPeer && appView !== 'messages' && appView !== 'groups' && (
        <div className="hidden lg:block fixed bottom-0 right-6 z-40">
          <ChatConversationWindow
            compact
            peer={activeChatPeer}
            currentUser={currentUser}
            messages={messagesByPeer[activeChatPeer.id] || []}
            isPeerOnline={onlineSet.has(activeChatPeer.id)}
            peerLastSeen={activeChatPeer.uid ? presenceByUid[activeChatPeer.uid]?.lastSeen : undefined}
            isPeerTyping={Boolean(typingUsers[activeChatPeer.id])}
            onSendMessage={handleSendMessage}
            onTyping={handleTyping}
            onOpenProfile={(uid) => navigateApp('profile', uid)}
            onStartCall={handleStartCall}
            onClose={() => setFloatingChatOpen(false)}
            forwardUsers={visibleUsers}
            forwardGroups={groups}
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
