import {PRESET_AVATARS, PRESET_COVERS, PRESET_POST_PHOTOS} from './assets';
import {
  buildPhoneLookupCandidates,
  normalizeToE164,
  validateRealEmail,
  validateRealPhone,
} from './contactValidation';
import type {
  ActiveSessionItem,
  ChatMessage,
  CommentItem,
  EventItem,
  GroupItem,
  LinkedAccountItem,
  MarketplaceItem,
  NotificationItem,
  PageItem,
  PasskeyItem,
  PostItem,
  ReactionType,
  SecurityEmailItem,
  UserProfile,
  UserSecurityConfig,
  UserSettings,
} from '../types';

const STORAGE_KEY = 'verve_local_store_v1';
const VALID_REACTIONS = new Set<ReactionType>([
  'like',
  'love',
  'care',
  'haha',
  'wow',
  'sad',
  'angry',
]);

interface StoredUser extends UserProfile {
  password: string;
}

interface StoredPost {
  id: number;
  user_id: number;
  content: string;
  image_url: string | null;
  video_url: string | null;
  created_at: string;
  reactions: Record<string, ReactionType>; // userId -> reaction
  comments: CommentItem[];
}

interface StoredFriendship {
  id: number;
  requester_id: number;
  addressee_id: number;
  status: 'pending' | 'accepted';
  created_at: string;
}

interface LocalStore {
  nextId: number;
  users: StoredUser[];
  sessions: Record<string, {userId: number; device_name: string; created_at: string}>;
  resets: Record<string, {userId: number; expires_at: string; used: boolean}>;
  posts: StoredPost[];
  savedPosts: Record<string, number[]>;
  friendships: StoredFriendship[];
  follows: Array<{follower_id: number; following_id: number}>;
  messages: ChatMessage[];
  notifications: NotificationItem[];
  settingsByUser: Record<string, UserSettings>;
  securityByUser: Record<string, UserSecurityConfig>;
  passkeysByUser: Record<string, PasskeyItem[]>;
  linkedByUser: Record<string, LinkedAccountItem[]>;
  emailsByUser: Record<string, SecurityEmailItem[]>;
  groups: Array<GroupItem & {memberIds: number[]}>;
  marketplace: MarketplaceItem[];
  events: Array<EventItem & {rsvps: Record<string, 'going' | 'interested'>}>;
  pages: Array<PageItem & {followerIds: number[]; created_by: number}>;
}

function normalizeEmail(input: string): string | null {
  const trimmed = input.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ? trimmed : null;
}

function normalizePhone(input: string): string | null {
  return normalizeToE164(input, '+880');
}

function findUserByPhone(users: StoredUser[], rawPhone: string): StoredUser | undefined {
  const candidates = new Set(buildPhoneLookupCandidates(rawPhone));
  if (candidates.size === 0) return undefined;
  return users.find((u) => {
    if (!u.phone) return false;
    return buildPhoneLookupCandidates(u.phone).some((c) => candidates.has(c));
  });
}

function findUserByIdentifier(users: StoredUser[], raw: string): StoredUser | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (trimmed.includes('@')) {
    const email = normalizeEmail(trimmed);
    if (!email) return undefined;
    return users.find((u) => u.email && u.email.toLowerCase() === email);
  }
  return findUserByPhone(users, trimmed);
}

function decodeFirebaseJwtPayload(token: string): {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  phoneNumber: string | null;
  name: string;
  picture: string;
} | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    const json = JSON.parse(atob(padded)) as Record<string, unknown>;
    const uid = String(json.user_id || json.sub || '');
    if (!uid) return null;
    const email = typeof json.email === 'string' ? json.email.trim().toLowerCase() : null;
    const emailVerified = Boolean(json.email_verified);
    const phoneNumber =
      typeof json.phone_number === 'string' ? normalizeToE164(json.phone_number, '+880') : null;
    const name = typeof json.name === 'string' ? json.name.trim() : '';
    const picture = typeof json.picture === 'string' ? json.picture.trim() : '';
    return {uid, email, emailVerified, phoneNumber, name, picture};
  } catch {
    return null;
  }
}

const LEGACY_DEMO_EMAILS = new Set([
  'maya@verve.social',
  'devon@verve.social',
  'priya@verve.social',
  'lucas@verve.social',
]);

function createInitialStore(): LocalStore {
  return {
    nextId: 500,
    users: [],
    sessions: {},
    resets: {},
    posts: [],
    savedPosts: {},
    friendships: [],
    follows: [],
    messages: [],
    notifications: [],
    settingsByUser: {},
    securityByUser: {},
    passkeysByUser: {},
    linkedByUser: {},
    emailsByUser: {},
    groups: [],
    marketplace: [],
    events: [],
    pages: [],
  };
}

function purgeLegacyDemoData(store: LocalStore): boolean {
  const demoIds = new Set(
    store.users
      .filter((u) => u.email && LEGACY_DEMO_EMAILS.has(u.email.toLowerCase()))
      .map((u) => u.id),
  );
  if (demoIds.size === 0) return false;

  store.users = store.users.filter((u) => !demoIds.has(u.id));
  store.posts = store.posts
    .filter((p) => !demoIds.has(p.user_id))
    .map((p) => ({
      ...p,
      comments: p.comments.filter((c) => !demoIds.has(c.user_id)),
    }));
  store.friendships = store.friendships.filter(
    (f) => !demoIds.has(f.requester_id) && !demoIds.has(f.addressee_id),
  );
  store.follows = store.follows.filter(
    (f) => !demoIds.has(f.follower_id) && !demoIds.has(f.following_id),
  );
  store.messages = store.messages.filter(
    (m) => !demoIds.has(m.sender_id) && !demoIds.has(m.receiver_id),
  );
  store.notifications = store.notifications.filter(
    (n) => !demoIds.has(n.user_id) && (!n.actor_id || !demoIds.has(n.actor_id)),
  );
  store.marketplace = store.marketplace.filter((item) => !demoIds.has(item.seller_id));
  store.pages = store.pages.filter((page) => !demoIds.has(page.created_by));
  store.groups = store.groups.filter((g) => !(g.id === 1 && g.name === '35mm Street & Architecture'));
  store.events = store.events.filter((e) => !(e.id === 1 && e.title === 'Blue Hour Riverfront Photo Walk'));
  for (const [token, sess] of Object.entries(store.sessions)) {
    if (demoIds.has(sess.userId)) delete store.sessions[token];
  }
  return true;
}

function loadStore(): LocalStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as LocalStore;
      if (purgeLegacyDemoData(parsed)) {
        saveStore(parsed);
      }
      return parsed;
    }
  } catch {
    // Corrupted or unavailable storage
  }
  const initial = createInitialStore();
  saveStore(initial);
  return initial;
}

function saveStore(store: LocalStore) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Quota exceeded — trim old large inline data URLs if needed
  }
}

// IndexedDB helper for storing large uploaded videos/images in local fallback mode
const MEDIA_DB_NAME = 'verve_media_blobs_v1';
const MEDIA_STORE = 'blobs';
const blobUrlCache = new Map<string, string>();

function openMediaDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(MEDIA_DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(MEDIA_STORE)) {
        req.result.createObjectStore(MEDIA_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveLocalMediaBlob(file: Blob): Promise<string> {
  try {
    const id = `localmedia_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const db = await openMediaDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(MEDIA_STORE, 'readwrite');
      tx.objectStore(MEDIA_STORE).put(file, id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    const objectUrl = URL.createObjectURL(file);
    blobUrlCache.set(id, objectUrl);
    return `idb://${id}`;
  } catch {
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('Could not read selected file.'));
      reader.readAsDataURL(file);
    });
  }
}

export async function resolveMediaUrl(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  if (!url.startsWith('idb://')) return url;
  const id = url.slice('idb://'.length);
  if (blobUrlCache.has(id)) return blobUrlCache.get(id)!;
  try {
    const db = await openMediaDb();
    const blob = await new Promise<Blob | undefined>((resolve, reject) => {
      const tx = db.transaction(MEDIA_STORE, 'readonly');
      const req = tx.objectStore(MEDIA_STORE).get(id);
      req.onsuccess = () => resolve(req.result as Blob | undefined);
      req.onerror = () => reject(req.error);
    });
    if (!blob) return null;
    const objectUrl = URL.createObjectURL(blob);
    blobUrlCache.set(id, objectUrl);
    return objectUrl;
  } catch {
    return null;
  }
}

function sanitizeUser(store: LocalStore, user: StoredUser, viewerId: number): UserProfile {
  const {password: _pw, ...rest} = user;
  const friendsCount = store.friendships.filter(
    (f) => f.status === 'accepted' && (f.requester_id === user.id || f.addressee_id === user.id),
  ).length;
  const followersCount = store.follows.filter((f) => f.following_id === user.id).length;
  const followingCount = store.follows.filter((f) => f.follower_id === user.id).length;
  const postsCount = store.posts.filter((p) => p.user_id === user.id).length;
  let friendshipStatus: UserProfile['friendship_status'] = 'none';
  if (user.id !== viewerId) {
    const rel = store.friendships.find(
      (f) =>
        (f.requester_id === viewerId && f.addressee_id === user.id) ||
        (f.requester_id === user.id && f.addressee_id === viewerId),
    );
    if (rel) {
      friendshipStatus =
        rel.status === 'accepted'
          ? 'friends'
          : rel.requester_id === viewerId
            ? 'outgoing_pending'
            : 'incoming_pending';
    }
  }
  const isFollowing = store.follows.some(
    (f) => f.follower_id === viewerId && f.following_id === user.id,
  );
  return {
    ...rest,
    friends_count: friendsCount,
    followers_count: followersCount,
    following_count: followingCount,
    posts_count: postsCount,
    friendship_status: friendshipStatus,
    is_following: isFollowing,
  };
}

function hydratePost(store: LocalStore, post: StoredPost, viewerId: number): PostItem {
  const author = store.users.find((u) => u.id === post.user_id) || store.users[0];
  const counts: Partial<Record<ReactionType, number>> = {};
  let total = 0;
  for (const r of Object.values(post.reactions || {})) {
    counts[r] = (counts[r] || 0) + 1;
    total += 1;
  }
  const myReaction = post.reactions?.[String(viewerId)] || null;
  const savedIds = store.savedPosts[String(viewerId)] || [];
  return {
    id: post.id,
    user_id: post.user_id,
    content: post.content,
    image_url: post.image_url,
    video_url: post.video_url,
    created_at: post.created_at,
    author_name: author?.name || 'Member',
    author_avatar: author?.avatar_url || '',
    author_work: author?.work || '',
    likes_count: total,
    liked_by_me: Boolean(myReaction),
    my_reaction: myReaction,
    reaction_counts: counts,
    saved_by_me: savedIds.includes(post.id),
    comments_count: post.comments.length,
    comments: post.comments,
  };
}

function getDefaultSettings(): UserSettings {
  return {
    profile_visibility: 'public',
    friend_request_policy: 'everyone',
    show_online_status: true,
    email_notifications: true,
    push_notifications: true,
    language: 'English',
  };
}

function getDefaultSecurity(): UserSecurityConfig {
  return {
    two_factor_enabled: false,
    two_factor_method: 'authenticator',
    two_factor_secret: 'VERV E2FA 8K4M 9Q2P',
    backup_codes: ['4A8F-91C2', '7D3B-50E1', '2C6A-88F4', '9E1D-33A7', '6B4C-72D9', '1F5E-64B8'],
    saved_login_enabled: true,
    advanced_protection: false,
    login_alerts_inapp: true,
    login_alerts_email: true,
    e2ee_key_alerts: true,
    e2ee_fingerprint: 'A4F9 8C21 7B3E 91D0 5E6A 42C8',
    account_status: 'active',
  };
}

function makeToken(): string {
  return `local_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`;
}

export async function handleLocalFallbackRequest<T>(
  path: string,
  options: RequestInit,
  token: string | null,
): Promise<T> {
  const store = loadStore();
  const method = (options.method || 'GET').toUpperCase();
  const url = new URL(path, 'http://local.verve');
  const pathname = url.pathname;

  let body: Record<string, any> = {};
  if (typeof options.body === 'string' && options.body.trim()) {
    try {
      body = JSON.parse(options.body);
    } catch {
      body = {};
    }
  }

  const getAuthedUser = (): StoredUser => {
    const sess = token ? store.sessions[token] : undefined;
    const user = sess ? store.users.find((u) => u.id === sess.userId) : undefined;
    if (!user) {
      throw new Error('Authentication required. Please sign in.');
    }
    return user;
  };

  // --- AUTH ---
  if (pathname === '/api/auth/capabilities' && method === 'GET') {
    return {emailOtpReady: false, smsTwilioReady: false, googleReady: true} as T;
  }

  if (pathname === '/api/auth/check-contact' && method === 'POST') {
    const channel = body.channel === 'phone' ? 'phone' : 'email';
    const contact = String(body.contact || '');
    if (channel === 'email') {
      const check = validateRealEmail(contact);
      if (!check.valid) throw new Error(check.error);
      if (store.users.some((u) => u.email && u.email.toLowerCase() === check.email)) {
        throw new Error('An account with this email already exists. Please sign in.');
      }
      return {valid: true, normalized: check.email} as T;
    }
    const check = validateRealPhone(contact);
    if (!check.valid) throw new Error(check.error);
    if (findUserByPhone(store.users, check.phone)) {
      throw new Error('An account with this phone number already exists. Please sign in.');
    }
    return {valid: true, normalized: check.phone} as T;
  }

  if (pathname === '/api/auth/otp/send' && method === 'POST') {
    const channel = body.channel === 'phone' ? 'phone' : 'email';
    if (channel === 'email') {
      const check = validateRealEmail(String(body.contact || ''));
      if (!check.valid) throw new Error(check.error);
      const err = new Error(
        'Real email OTP requires SMTP credentials on the backend server. Use "Verify Real Gmail with Google" below to verify instantly.',
      ) as Error & {code?: string};
      err.code = 'SMTP_NOT_CONFIGURED';
      throw err;
    }
    const check = validateRealPhone(String(body.contact || ''));
    if (!check.valid) throw new Error(check.error);
    const err = new Error(
      'Real SMS OTP requires Firebase Phone Auth enabled in Firebase Console or Twilio credentials on the backend server.',
    ) as Error & {code?: string};
    err.code = 'SMS_NOT_CONFIGURED';
    throw err;
  }

  if (pathname === '/api/auth/otp/verify' && method === 'POST') {
    throw new Error('OTP verification requires an active verification session. Please verify via Firebase.');
  }

  if (pathname === '/api/auth/register' && method === 'POST') {
    const name = String(body.name || '').trim();
    const password = String(body.password || '');
    if (name.length < 2 || name.length > 60) {
      throw new Error('Please enter your full name (2–60 characters).');
    }
    if (password.length < 6) {
      throw new Error('Password must be at least 6 characters long.');
    }

    let email: string | null = null;
    let phone: string | null = null;
    if (body.email && String(body.email).trim()) {
      const check = validateRealEmail(String(body.email));
      if (!check.valid) throw new Error(check.error);
      email = check.email;
    }
    if (body.phone && String(body.phone).trim()) {
      const check = validateRealPhone(String(body.phone));
      if (!check.valid) throw new Error(check.error);
      phone = check.phone;
    }
    if (!email && !phone) {
      throw new Error('Provide a real Gmail/email address or a real phone number.');
    }

    const fbToken = typeof body.firebaseIdToken === 'string' ? body.firebaseIdToken.trim() : '';
    const fb = fbToken ? decodeFirebaseJwtPayload(fbToken) : null;
    let verifiedOk = false;
    if (fb) {
      if (email && fb.email === email && fb.emailVerified) {
        verifiedOk = true;
      } else if (phone && fb.phoneNumber) {
        const targetSet = new Set(buildPhoneLookupCandidates(phone));
        if (buildPhoneLookupCandidates(fb.phoneNumber).some((c) => targetSet.has(c))) {
          verifiedOk = true;
          phone = fb.phoneNumber;
        }
      }
    }
    if (!verifiedOk) {
      throw new Error(
        'Verification required. Please click "Send Code" and verify your real Gmail or phone number before creating an account.',
      );
    }

    if (email && store.users.some((u) => u.email && u.email.toLowerCase() === email)) {
      throw new Error('An account with this email already exists. Try signing in.');
    }
    if (phone && findUserByPhone(store.users, phone)) {
      throw new Error('An account with this phone number already exists. Try signing in.');
    }

    const newId = ++store.nextId;
    const newUser: StoredUser = {
      id: newId,
      name,
      email,
      phone,
      password,
      bio: 'New on Verve — sharing ideas, photos, videos, and updates.',
      location: '',
      work: '',
      avatar_url: fb?.picture || PRESET_AVATARS[0].url,
      cover_url: PRESET_COVERS[0].url,
      date_of_birth: '',
      created_at: new Date().toISOString(),
    };
    store.users.push(newUser);
    store.notifications.unshift({
      id: ++store.nextId,
      user_id: newId,
      actor_id: null,
      actor_name: null,
      actor_avatar: null,
      type: 'welcome',
      entity_id: null,
      message: 'Welcome to Verve! Your account is verified and saved permanently.',
      read: false,
      created_at: new Date().toISOString(),
    });
    const newToken = makeToken();
    store.sessions[newToken] = {
      userId: newId,
      device_name: 'This Device',
      created_at: new Date().toISOString(),
    };
    saveStore(store);
    return {token: newToken, user: sanitizeUser(store, newUser, newId)} as T;
  }

  if (pathname === '/api/auth/firebase-auth' && method === 'POST') {
    const fbToken = typeof body.firebaseIdToken === 'string' ? body.firebaseIdToken.trim() : '';
    const fb = fbToken ? decodeFirebaseJwtPayload(fbToken) : null;
    if (!fb || !((fb.email && fb.emailVerified) || fb.phoneNumber)) {
      throw new Error('Invalid or unverified Firebase authentication token.');
    }

    let user =
      (fb.email ? store.users.find((u) => u.email && u.email.toLowerCase() === fb.email) : undefined) ||
      (fb.phoneNumber ? findUserByPhone(store.users, fb.phoneNumber) : undefined);

    if (user) {
      if (typeof body.password === 'string' && body.password.length >= 6) {
        user.password = body.password;
      }
    } else {
      const newId = ++store.nextId;
      user = {
        id: newId,
        name: String(body.name || fb.name || 'Verve Member').trim().slice(0, 60) || 'Verve Member',
        email: fb.email,
        phone: fb.phoneNumber,
        password:
          typeof body.password === 'string' && body.password.length >= 6
            ? body.password
            : makeToken(),
        bio: String(body.bio || 'New on Verve — sharing ideas, moments, and updates.').slice(0, 320),
        location: String(body.location || '').slice(0, 80),
        work: String(body.work || '').slice(0, 100),
        avatar_url: String(body.avatar_url || fb.picture || PRESET_AVATARS[0].url),
        cover_url: String(body.cover_url || PRESET_COVERS[0].url),
        date_of_birth: String(body.date_of_birth || '').slice(0, 20),
        created_at: new Date().toISOString(),
      };
      store.users.push(user);
    }

    const newToken = makeToken();
    store.sessions[newToken] = {
      userId: user.id,
      device_name: 'This Device',
      created_at: new Date().toISOString(),
    };
    saveStore(store);
    return {token: newToken, user: sanitizeUser(store, user, user.id)} as T;
  }

  if (pathname === '/api/auth/restore' && method === 'POST') {
    const password = String(body.password || '');
    if (password.length < 6) {
      throw new Error('Invalid email/phone or password. Please try again.');
    }
    const email = body.email ? normalizeEmail(String(body.email)) : null;
    const phone = body.phone ? normalizePhone(String(body.phone)) : null;
    if (!email && !phone) throw new Error('Invalid account credentials.');

    let user =
      (email ? store.users.find((u) => u.email && u.email.toLowerCase() === email) : undefined) ||
      (phone ? findUserByPhone(store.users, phone) : undefined);

    if (user) {
      if (user.password !== password) {
        throw new Error('Invalid email/phone or password. Please try again.');
      }
    } else {
      const newId = ++store.nextId;
      user = {
        id: newId,
        name: String(body.name || 'Verve Member').trim().slice(0, 60) || 'Verve Member',
        email,
        phone,
        password,
        bio: String(body.bio || '').slice(0, 320),
        location: String(body.location || '').slice(0, 80),
        work: String(body.work || '').slice(0, 100),
        avatar_url: String(body.avatar_url || PRESET_AVATARS[0].url),
        cover_url: String(body.cover_url || PRESET_COVERS[0].url),
        date_of_birth: String(body.date_of_birth || '').slice(0, 20),
        created_at: new Date().toISOString(),
      };
      store.users.push(user);
    }

    const newToken = makeToken();
    store.sessions[newToken] = {
      userId: user.id,
      device_name: 'This Device',
      created_at: new Date().toISOString(),
    };
    saveStore(store);
    return {token: newToken, user: sanitizeUser(store, user, user.id)} as T;
  }

  if (pathname === '/api/auth/login' && method === 'POST') {
    const raw = String(body.identifier || '').trim();
    const password = String(body.password || '');
    if (!raw || !password) throw new Error('Enter your email or phone number and password.');
    const user = findUserByIdentifier(store.users, raw);
    if (!user || user.password !== password) {
      throw new Error('Invalid email/phone or password. Please try again.');
    }
    const newToken = makeToken();
    store.sessions[newToken] = {
      userId: user.id,
      device_name: 'This Device',
      created_at: new Date().toISOString(),
    };
    saveStore(store);
    return {token: newToken, user: sanitizeUser(store, user, user.id)} as T;
  }

  if (pathname === '/api/auth/logout' && method === 'POST') {
    if (token) delete store.sessions[token];
    saveStore(store);
    return {ok: true} as T;
  }

  if (pathname === '/api/auth/me' && method === 'GET') {
    const user = getAuthedUser();
    return {user: sanitizeUser(store, user, user.id)} as T;
  }

  if (pathname === '/api/auth/forgot-password' && method === 'POST') {
    const raw = String(body.identifier || '').trim();
    const user = findUserByIdentifier(store.users, raw);
    if (!user) throw new Error('No account found matching that email address or phone number.');
    const resetToken = makeToken().replace('local_', 'rst_');
    store.resets[resetToken] = {
      userId: user.id,
      expires_at: new Date(Date.now() + 30 * 60000).toISOString(),
      used: false,
    };
    saveStore(store);
    return {
      message: `Password reset link generated for ${user.email || user.phone}. It expires in 30 minutes.`,
      resetToken,
      resetPath: `/reset-password?token=${resetToken}`,
      maskedDestination: user.email || user.phone || 'your account',
    } as T;
  }

  if (pathname === '/api/auth/reset-password' && method === 'POST') {
    const resetToken = String(body.token || '').trim();
    const newPassword = String(body.newPassword || '');
    if (newPassword.length < 6) throw new Error('New password must be at least 6 characters long.');
    const entry = store.resets[resetToken];
    if (!entry || entry.used || new Date(entry.expires_at).getTime() < Date.now()) {
      throw new Error('This reset link or code is invalid or has expired. Request a new one.');
    }
    const user = store.users.find((u) => u.id === entry.userId);
    if (user) user.password = newPassword;
    entry.used = true;
    saveStore(store);
    return {message: 'Your password has been reset successfully. You can now sign in.'} as T;
  }

  if (pathname === '/api/auth/switchable-accounts' && method === 'GET') {
    getAuthedUser();
    return {accounts: []} as T;
  }

  if (pathname === '/api/auth/quick-switch' && method === 'POST') {
    getAuthedUser();
    throw new Error('Use password login to switch accounts.');
  }

  // --- UPLOAD ---
  if (pathname === '/api/upload' && method === 'POST') {
    getAuthedUser();
    const dataUrl = String(body.dataUrl || '');
    if (!dataUrl) throw new Error('Media data is required.');
    const isVideo = dataUrl.startsWith('data:video/');
    return {url: dataUrl, mediaType: isVideo ? 'video' : 'image'} as T;
  }

  // --- PROFILE & USERS ---
  if (pathname === '/api/users/search' && method === 'GET') {
    const me = getAuthedUser();
    const q = (url.searchParams.get('q') || '').trim().toLowerCase();
    const matched = store.users
      .filter(
        (u) =>
          !q ||
          u.name.toLowerCase().includes(q) ||
          u.bio.toLowerCase().includes(q) ||
          u.work.toLowerCase().includes(q),
      )
      .map((u) => sanitizeUser(store, u, me.id));
    return {users: matched} as T;
  }

  const userMatch = pathname.match(/^\/api\/users\/(\d+)$/);
  if (userMatch && method === 'GET') {
    const me = getAuthedUser();
    const targetId = Number(userMatch[1]);
    const target = store.users.find((u) => u.id === targetId);
    if (!target) throw new Error('User not found.');
    const userPosts = store.posts
      .filter((p) => p.user_id === targetId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((p) => hydratePost(store, p, me.id));
    return {profile: sanitizeUser(store, target, me.id), posts: userPosts} as T;
  }

  if (pathname === '/api/profile' && method === 'PUT') {
    const me = getAuthedUser();
    if (typeof body.name === 'string' && body.name.trim().length >= 2) me.name = body.name.trim().slice(0, 60);
    if (typeof body.bio === 'string') me.bio = body.bio.trim().slice(0, 320);
    if (typeof body.location === 'string') me.location = body.location.trim().slice(0, 80);
    if (typeof body.work === 'string') me.work = body.work.trim().slice(0, 100);
    if (typeof body.avatar_url === 'string') me.avatar_url = body.avatar_url.trim();
    if (typeof body.cover_url === 'string') me.cover_url = body.cover_url.trim();
    saveStore(store);
    return {user: sanitizeUser(store, me, me.id), message: 'Profile saved successfully.'} as T;
  }

  // --- POSTS, REACTIONS & COMMENTS ---
  if (pathname === '/api/posts' && method === 'GET') {
    const me = getAuthedUser();
    const filter = url.searchParams.get('filter') || 'all';
    let list = [...store.posts];
    if (filter === 'following') {
      const allowed = new Set<number>([me.id]);
      store.follows.filter((f) => f.follower_id === me.id).forEach((f) => allowed.add(f.following_id));
      store.friendships
        .filter((f) => f.status === 'accepted' && (f.requester_id === me.id || f.addressee_id === me.id))
        .forEach((f) => allowed.add(f.requester_id === me.id ? f.addressee_id : f.requester_id));
      list = list.filter((p) => allowed.has(p.user_id));
    }
    list.sort((a, b) => b.created_at.localeCompare(a.created_at));
    return {posts: list.map((p) => hydratePost(store, p, me.id))} as T;
  }

  if (pathname === '/api/posts' && method === 'POST') {
    const me = getAuthedUser();
    const content = String(body.content || '').trim();
    const image_url = body.image_url ? String(body.image_url).trim() : null;
    const video_url = body.video_url ? String(body.video_url).trim() : null;
    if (!content && !image_url && !video_url) {
      throw new Error('Write something or attach a photo or video before posting.');
    }
    const newPost: StoredPost = {
      id: ++store.nextId,
      user_id: me.id,
      content: content.slice(0, 2000),
      image_url,
      video_url,
      created_at: new Date().toISOString(),
      reactions: {},
      comments: [],
    };
    store.posts.unshift(newPost);
    saveStore(store);
    return {post: hydratePost(store, newPost, me.id)} as T;
  }

  const postDeleteMatch = pathname.match(/^\/api\/posts\/(\d+)$/);
  if (postDeleteMatch && method === 'DELETE') {
    const me = getAuthedUser();
    const postId = Number(postDeleteMatch[1]);
    store.posts = store.posts.filter((p) => !(p.id === postId && p.user_id === me.id));
    saveStore(store);
    return {ok: true} as T;
  }

  const postLikeMatch = pathname.match(/^\/api\/posts\/(\d+)\/like$/);
  if (postLikeMatch && method === 'POST') {
    const me = getAuthedUser();
    const postId = Number(postLikeMatch[1]);
    const post = store.posts.find((p) => p.id === postId);
    if (!post) throw new Error('Post not found.');
    const rawReq = typeof body.reaction === 'string' ? body.reaction.toLowerCase() : '';
    const requested = VALID_REACTIONS.has(rawReq as ReactionType) ? (rawReq as ReactionType) : null;
    const existing = post.reactions[String(me.id)] || null;

    let liked = false;
    let myReaction: ReactionType | null = null;
    if (existing) {
      if (!requested || existing === requested) {
        delete post.reactions[String(me.id)];
      } else {
        post.reactions[String(me.id)] = requested;
        liked = true;
        myReaction = requested;
      }
    } else {
      const chosen = requested || 'like';
      post.reactions[String(me.id)] = chosen;
      liked = true;
      myReaction = chosen;
    }

    const reactionCounts: Partial<Record<ReactionType, number>> = {};
    let totalCount = 0;
    for (const r of Object.values(post.reactions)) {
      reactionCounts[r] = (reactionCounts[r] || 0) + 1;
      totalCount += 1;
    }
    saveStore(store);
    return {
      liked,
      my_reaction: myReaction,
      likes_count: totalCount,
      reaction_counts: reactionCounts,
    } as T;
  }

  const postSaveMatch = pathname.match(/^\/api\/posts\/(\d+)\/save$/);
  if (postSaveMatch && method === 'POST') {
    const me = getAuthedUser();
    const postId = Number(postSaveMatch[1]);
    const list = store.savedPosts[String(me.id)] || [];
    let saved = false;
    if (list.includes(postId)) {
      store.savedPosts[String(me.id)] = list.filter((id) => id !== postId);
    } else {
      store.savedPosts[String(me.id)] = [postId, ...list];
      saved = true;
    }
    saveStore(store);
    return {saved} as T;
  }

  const postCommentMatch = pathname.match(/^\/api\/posts\/(\d+)\/comments$/);
  if (postCommentMatch && method === 'POST') {
    const me = getAuthedUser();
    const postId = Number(postCommentMatch[1]);
    const post = store.posts.find((p) => p.id === postId);
    if (!post) throw new Error('Post not found.');
    const content = String(body.content || '').trim();
    if (!content) throw new Error('Comment cannot be empty.');
    const comment: CommentItem = {
      id: ++store.nextId,
      post_id: postId,
      user_id: me.id,
      content: content.slice(0, 600),
      created_at: new Date().toISOString(),
      author_name: me.name,
      author_avatar: me.avatar_url,
    };
    post.comments.push(comment);
    saveStore(store);
    return {comment} as T;
  }

  // --- NETWORK & MESSAGES & NOTIFICATIONS ---
  if (pathname === '/api/network' && method === 'GET') {
    const me = getAuthedUser();
    const friendIds = new Set<number>();
    const incomingRequests: Array<UserProfile & {request_id: number; requested_at: string}> = [];
    const outgoingRequests: Array<UserProfile & {request_id: number; requested_at: string}> = [];
    const connected = new Set<number>([me.id]);

    for (const f of store.friendships) {
      if (f.status === 'accepted' && (f.requester_id === me.id || f.addressee_id === me.id)) {
        const other = f.requester_id === me.id ? f.addressee_id : f.requester_id;
        friendIds.add(other);
        connected.add(other);
      } else if (f.status === 'pending' && f.addressee_id === me.id) {
        const u = store.users.find((x) => x.id === f.requester_id);
        if (u) {
          incomingRequests.push({
            ...sanitizeUser(store, u, me.id),
            request_id: f.id,
            requested_at: f.created_at,
          });
          connected.add(u.id);
        }
      } else if (f.status === 'pending' && f.requester_id === me.id) {
        const u = store.users.find((x) => x.id === f.addressee_id);
        if (u) {
          outgoingRequests.push({
            ...sanitizeUser(store, u, me.id),
            request_id: f.id,
            requested_at: f.created_at,
          });
          connected.add(u.id);
        }
      }
    }

    const friends = store.users
      .filter((u) => friendIds.has(u.id))
      .map((u) => sanitizeUser(store, u, me.id));
    const suggestions = store.users
      .filter((u) => !connected.has(u.id))
      .map((u) => sanitizeUser(store, u, me.id));
    const followingIds = store.follows.filter((f) => f.follower_id === me.id).map((f) => f.following_id);
    return {friends, incomingRequests, outgoingRequests, suggestions, followingIds} as T;
  }

  if (pathname === '/api/friends/request' && method === 'POST') {
    const me = getAuthedUser();
    const targetId = Number(body.userId);
    store.friendships.push({
      id: ++store.nextId,
      requester_id: me.id,
      addressee_id: targetId,
      status: 'pending',
      created_at: new Date().toISOString(),
    });
    saveStore(store);
    return {status: 'outgoing_pending'} as T;
  }

  if (pathname === '/api/friends/respond' && method === 'POST') {
    const me = getAuthedUser();
    const reqId = Number(body.requesterId);
    const action = body.action === 'accept' ? 'accept' : 'decline';
    const rel = store.friendships.find(
      (f) => f.requester_id === reqId && f.addressee_id === me.id && f.status === 'pending',
    );
    if (rel) {
      if (action === 'accept') rel.status = 'accepted';
      else store.friendships = store.friendships.filter((f) => f.id !== rel.id);
      saveStore(store);
    }
    return {ok: true, action} as T;
  }

  const friendDelMatch = pathname.match(/^\/api\/friends\/(\d+)$/);
  if (friendDelMatch && method === 'DELETE') {
    const me = getAuthedUser();
    const tid = Number(friendDelMatch[1]);
    store.friendships = store.friendships.filter(
      (f) =>
        !(
          (f.requester_id === me.id && f.addressee_id === tid) ||
          (f.requester_id === tid && f.addressee_id === me.id)
        ),
    );
    saveStore(store);
    return {ok: true} as T;
  }

  if (pathname === '/api/follows/toggle' && method === 'POST') {
    const me = getAuthedUser();
    const tid = Number(body.userId);
    const idx = store.follows.findIndex((f) => f.follower_id === me.id && f.following_id === tid);
    let following = false;
    if (idx >= 0) store.follows.splice(idx, 1);
    else {
      store.follows.push({follower_id: me.id, following_id: tid});
      following = true;
    }
    saveStore(store);
    return {following} as T;
  }

  if (pathname === '/api/notifications' && method === 'GET') {
    const me = getAuthedUser();
    return {
      notifications: store.notifications.filter((n) => n.user_id === me.id),
    } as T;
  }

  if (pathname === '/api/notifications/read-all' && method === 'POST') {
    const me = getAuthedUser();
    store.notifications.forEach((n) => {
      if (n.user_id === me.id) n.read = true;
    });
    saveStore(store);
    return {ok: true} as T;
  }

  const notifReadMatch = pathname.match(/^\/api\/notifications\/(\d+)\/read$/);
  if (notifReadMatch && method === 'POST') {
    const me = getAuthedUser();
    const nid = Number(notifReadMatch[1]);
    store.notifications.forEach((n) => {
      if (n.id === nid && n.user_id === me.id) n.read = true;
    });
    saveStore(store);
    return {ok: true} as T;
  }

  if (pathname === '/api/messages/conversations' && method === 'GET') {
    const me = getAuthedUser();
    const others = store.users.filter((u) => u.id !== me.id);
    const conversations = others.map((u) => {
      const thread = store.messages.filter(
        (m) =>
          (m.sender_id === me.id && m.receiver_id === u.id) ||
          (m.sender_id === u.id && m.receiver_id === me.id),
      );
      const last = thread[thread.length - 1];
      const unread = thread.filter((m) => m.sender_id === u.id && !m.read).length;
      return {
        user: sanitizeUser(store, u, me.id),
        last_message: last?.content || null,
        last_message_at: last?.created_at || null,
        last_sender_id: last?.sender_id || null,
        unread_count: unread,
      };
    });
    return {conversations, onlineUserIds: [me.id, 1, 2]} as T;
  }

  const msgMatch = pathname.match(/^\/api\/messages\/(\d+)$/);
  if (msgMatch && method === 'GET') {
    const me = getAuthedUser();
    const peerId = Number(msgMatch[1]);
    const thread = store.messages.filter(
      (m) =>
        (m.sender_id === me.id && m.receiver_id === peerId) ||
        (m.sender_id === peerId && m.receiver_id === me.id),
    );
    thread.forEach((m) => {
      if (m.sender_id === peerId) m.read = true;
    });
    saveStore(store);
    return {messages: thread} as T;
  }

  if (msgMatch && method === 'POST') {
    const me = getAuthedUser();
    const peerId = Number(msgMatch[1]);
    const content = String(body.content || '').trim();
    if (!content) throw new Error('Message cannot be empty.');
    const msg: ChatMessage = {
      id: ++store.nextId,
      sender_id: me.id,
      receiver_id: peerId,
      content: content.slice(0, 1500),
      read: false,
      created_at: new Date().toISOString(),
    };
    store.messages.push(msg);
    saveStore(store);
    return {message: msg} as T;
  }

  // --- SAVED, DASHBOARD, ACTIVITY, HUBS ---
  if (pathname === '/api/saved' && method === 'GET') {
    const me = getAuthedUser();
    const ids = new Set(store.savedPosts[String(me.id)] || []);
    return {
      posts: store.posts.filter((p) => ids.has(p.id)).map((p) => hydratePost(store, p, me.id)),
    } as T;
  }

  if (pathname === '/api/dashboard' && method === 'GET') {
    const me = getAuthedUser();
    const myPosts = store.posts.filter((p) => p.user_id === me.id);
    const totalLikes = myPosts.reduce((s, p) => s + Object.keys(p.reactions || {}).length, 0);
    const totalComments = myPosts.reduce((s, p) => s + p.comments.length, 0);
    const summary = sanitizeUser(store, me, me.id);
    return {
      stats: {
        posts_count: myPosts.length,
        total_likes: totalLikes,
        total_comments: totalComments,
        friends_count: summary.friends_count || 0,
        followers_count: summary.followers_count || 0,
        recent_posts: myPosts.slice(0, 5).map((p) => hydratePost(store, p, me.id)),
      },
    } as T;
  }

  if (pathname === '/api/activity' && method === 'GET') {
    const me = getAuthedUser();
    const activities = store.posts
      .filter((p) => p.user_id === me.id)
      .map((p) => ({
        id: p.id,
        kind: 'post' as const,
        summary: p.content.slice(0, 90) || (p.video_url ? 'Video post' : 'Photo post'),
        created_at: p.created_at,
      }));
    return {activities} as T;
  }

  if (pathname === '/api/groups' && method === 'GET') {
    const me = getAuthedUser();
    return {
      groups: store.groups.map((g) => ({
        ...g,
        members_count: g.memberIds.length,
        joined: g.memberIds.includes(me.id),
      })),
    } as T;
  }

  if (pathname === '/api/groups' && method === 'POST') {
    const me = getAuthedUser();
    const id = ++store.nextId;
    store.groups.unshift({
      id,
      name: String(body.name || 'New Group').trim(),
      category: String(body.category || 'Community').trim(),
      description: String(body.description || '').trim(),
      cover_url: PRESET_COVERS[0].url,
      members_count: 1,
      joined: true,
      memberIds: [me.id],
    });
    saveStore(store);
    return {ok: true, id} as T;
  }

  const groupToggle = pathname.match(/^\/api\/groups\/(\d+)\/toggle$/);
  if (groupToggle && method === 'POST') {
    const me = getAuthedUser();
    const g = store.groups.find((x) => x.id === Number(groupToggle[1]));
    let joined = false;
    if (g) {
      if (g.memberIds.includes(me.id)) g.memberIds = g.memberIds.filter((id) => id !== me.id);
      else {
        g.memberIds.push(me.id);
        joined = true;
      }
      saveStore(store);
    }
    return {joined} as T;
  }

  if (pathname === '/api/marketplace' && method === 'GET') {
    getAuthedUser();
    return {items: store.marketplace} as T;
  }

  if (pathname === '/api/marketplace' && method === 'POST') {
    const me = getAuthedUser();
    const id = ++store.nextId;
    store.marketplace.unshift({
      id,
      seller_id: me.id,
      seller_name: me.name,
      seller_avatar: me.avatar_url,
      title: String(body.title || '').trim(),
      price: String(body.price || '').trim(),
      category: String(body.category || 'General').trim(),
      location: String(body.location || me.location || 'Local').trim(),
      description: String(body.description || '').trim(),
      image_url: String(body.image_url || PRESET_POST_PHOTOS[0].url),
      created_at: new Date().toISOString(),
    });
    saveStore(store);
    return {ok: true, id} as T;
  }

  if (pathname === '/api/events' && method === 'GET') {
    const me = getAuthedUser();
    return {
      events: store.events.map((e) => ({
        ...e,
        going_count: Object.values(e.rsvps).filter((v) => v === 'going').length,
        interested_count: Object.values(e.rsvps).filter((v) => v === 'interested').length,
        my_rsvp: e.rsvps[String(me.id)] || null,
      })),
    } as T;
  }

  if (pathname === '/api/events' && method === 'POST') {
    const me = getAuthedUser();
    const id = ++store.nextId;
    store.events.unshift({
      id,
      title: String(body.title || '').trim(),
      event_date: String(body.event_date || '').trim(),
      location: String(body.location || '').trim(),
      description: String(body.description || '').trim(),
      host_name: me.name,
      going_count: 1,
      interested_count: 0,
      my_rsvp: 'going',
      rsvps: {[String(me.id)]: 'going'},
    });
    saveStore(store);
    return {ok: true, id} as T;
  }

  const eventRsvp = pathname.match(/^\/api\/events\/(\d+)\/rsvp$/);
  if (eventRsvp && method === 'POST') {
    const me = getAuthedUser();
    const ev = store.events.find((e) => e.id === Number(eventRsvp[1]));
    let my_rsvp: 'going' | 'interested' | null = null;
    if (ev) {
      if (body.status === 'none') delete ev.rsvps[String(me.id)];
      else {
        my_rsvp = body.status === 'interested' ? 'interested' : 'going';
        ev.rsvps[String(me.id)] = my_rsvp;
      }
      saveStore(store);
    }
    return {my_rsvp} as T;
  }

  if (pathname === '/api/pages' && method === 'GET') {
    const me = getAuthedUser();
    return {
      pages: store.pages.map((p) => ({
        ...p,
        followers_count: p.followerIds.length,
        following: p.followerIds.includes(me.id),
      })),
    } as T;
  }

  if (pathname === '/api/pages' && method === 'POST') {
    const me = getAuthedUser();
    const id = ++store.nextId;
    store.pages.unshift({
      id,
      name: String(body.name || '').trim(),
      category: String(body.category || 'Creator').trim(),
      bio: String(body.bio || '').trim(),
      avatar_url: me.avatar_url || PRESET_AVATARS[0].url,
      followers_count: 1,
      following: true,
      followerIds: [me.id],
      created_by: me.id,
    });
    saveStore(store);
    return {ok: true, id} as T;
  }

  const pageToggle = pathname.match(/^\/api\/pages\/(\d+)\/toggle$/);
  if (pageToggle && method === 'POST') {
    const me = getAuthedUser();
    const pg = store.pages.find((p) => p.id === Number(pageToggle[1]));
    let following = false;
    if (pg) {
      if (pg.followerIds.includes(me.id)) pg.followerIds = pg.followerIds.filter((id) => id !== me.id);
      else {
        pg.followerIds.push(me.id);
        following = true;
      }
      saveStore(store);
    }
    return {following} as T;
  }

  // --- SETTINGS, ACCOUNTS CENTRE & SECURITY ---
  if (pathname === '/api/settings' && method === 'GET') {
    const me = getAuthedUser();
    const settings = store.settingsByUser[String(me.id)] || getDefaultSettings();
    return {settings} as T;
  }

  if (pathname === '/api/settings' && method === 'PUT') {
    const me = getAuthedUser();
    const current = store.settingsByUser[String(me.id)] || getDefaultSettings();
    const next = {...current, ...body, updated_at: new Date().toISOString()};
    store.settingsByUser[String(me.id)] = next;
    saveStore(store);
    return {settings: next, message: 'Settings saved to your account.'} as T;
  }

  if (pathname === '/api/settings/change-password' && method === 'POST') {
    const me = getAuthedUser();
    if (String(body.currentPassword || '') !== me.password) {
      throw new Error('Current password is incorrect.');
    }
    const nextPw = String(body.newPassword || '');
    if (nextPw.length < 6) throw new Error('New password must be at least 6 characters long.');
    me.password = nextPw;
    saveStore(store);
    return {message: 'Password updated successfully.'} as T;
  }

  if (pathname === '/api/accounts-centre' && method === 'GET') {
    const me = getAuthedUser();
    const security = store.securityByUser[String(me.id)] || getDefaultSecurity();
    const linked = store.linkedByUser[String(me.id)] || [];
    const managed = store.pages.filter(
      (p) => p.created_by === me.id || p.followerIds.includes(me.id),
    );
    return {
      user: sanitizeUser(store, me, me.id),
      linked_accounts: linked,
      managed_pages_count: managed.length,
      managed_pages_avatars: managed.slice(0, 2).map((p) => ({name: p.name, avatar_url: p.avatar_url})),
      security,
    } as T;
  }

  if (pathname === '/api/personal-details/contact' && method === 'PUT') {
    const me = getAuthedUser();
    const nextEmail = body.email ? normalizeEmail(String(body.email)) : null;
    const nextPhone = body.phone ? normalizePhone(String(body.phone)) : null;
    if (!nextEmail && !nextPhone) {
      throw new Error('Keep at least one email address or phone number on your account.');
    }
    me.email = nextEmail;
    me.phone = nextPhone;
    saveStore(store);
    return {user: sanitizeUser(store, me, me.id), message: 'Contact info saved successfully.'} as T;
  }

  if (pathname === '/api/personal-details/dob' && method === 'PUT') {
    const me = getAuthedUser();
    me.date_of_birth = String(body.date_of_birth || '').trim();
    saveStore(store);
    return {user: sanitizeUser(store, me, me.id), message: 'Date of birth updated and saved.'} as T;
  }

  if (pathname === '/api/accounts-centre/linked' && method === 'POST') {
    const me = getAuthedUser();
    const list = store.linkedByUser[String(me.id)] || [];
    const account: LinkedAccountItem = {
      id: ++store.nextId,
      user_id: me.id,
      handle: String(body.handle || '').trim(),
      platform: String(body.platform || 'Verve').trim(),
      status: 'Active',
      avatar_url: me.avatar_url,
      created_at: new Date().toISOString(),
    };
    store.linkedByUser[String(me.id)] = [account, ...list];
    saveStore(store);
    return {account, message: `${account.handle} added to Accounts Centre.`} as T;
  }

  const linkedMatch = pathname.match(/^\/api\/accounts-centre\/linked\/(\d+)$/);
  if (linkedMatch && method === 'PATCH') {
    const me = getAuthedUser();
    const id = Number(linkedMatch[1]);
    const list = store.linkedByUser[String(me.id)] || [];
    const nextStatus = body.status === 'Deactivated' ? 'Deactivated' : 'Active';
    list.forEach((a) => {
      if (a.id === id) a.status = nextStatus;
    });
    saveStore(store);
    return {ok: true, status: nextStatus} as T;
  }

  if (linkedMatch && method === 'DELETE') {
    const me = getAuthedUser();
    const id = Number(linkedMatch[1]);
    store.linkedByUser[String(me.id)] = (store.linkedByUser[String(me.id)] || []).filter(
      (a) => a.id !== id,
    );
    saveStore(store);
    return {ok: true} as T;
  }

  if (pathname === '/api/security' && method === 'GET') {
    const me = getAuthedUser();
    const security = store.securityByUser[String(me.id)] || getDefaultSecurity();
    const passkeys = store.passkeysByUser[String(me.id)] || [];
    const sessions: ActiveSessionItem[] = Object.entries(store.sessions)
      .filter(([, s]) => s.userId === me.id)
      .map(([tok, s], idx) => ({
        id: idx + 1,
        device_name: s.device_name,
        ip_address: 'Active session',
        created_at: s.created_at,
        is_current: tok === token,
      }));
    const emails = store.emailsByUser[String(me.id)] || [
      {
        id: 1,
        category: 'security' as const,
        subject: 'New login to Verve',
        body: 'We noticed a sign-in on this device.',
        recipient: me.email || me.phone || 'Account holder',
        created_at: new Date().toISOString(),
      },
    ];
    return {security, passkeys, sessions, emails} as T;
  }

  if (pathname === '/api/security' && method === 'PUT') {
    const me = getAuthedUser();
    const current = store.securityByUser[String(me.id)] || getDefaultSecurity();
    const next: UserSecurityConfig = {...current, ...body};
    if (next.advanced_protection) {
      next.two_factor_enabled = true;
      next.login_alerts_inapp = true;
    }
    store.securityByUser[String(me.id)] = next;
    saveStore(store);
    return {security: next, message: 'Security settings updated and saved.'} as T;
  }

  if (pathname === '/api/security/regenerate-codes' && method === 'POST') {
    const me = getAuthedUser();
    const sec = store.securityByUser[String(me.id)] || getDefaultSecurity();
    sec.backup_codes = Array.from({length: 6}, () => {
      const part = () => Math.random().toString(16).slice(2, 6).toUpperCase().padEnd(4, 'A');
      return `${part()}-${part()}`;
    });
    store.securityByUser[String(me.id)] = sec;
    saveStore(store);
    return {backup_codes: sec.backup_codes, message: 'New recovery backup codes generated.'} as T;
  }

  if (pathname === '/api/security/passkeys' && method === 'POST') {
    const me = getAuthedUser();
    const passkey: PasskeyItem = {
      id: ++store.nextId,
      label: String(body.label || 'This Device').trim(),
      credential_id: `pk_${Math.random().toString(36).slice(2, 12)}`,
      created_at: new Date().toISOString(),
    };
    store.passkeysByUser[String(me.id)] = [passkey, ...(store.passkeysByUser[String(me.id)] || [])];
    saveStore(store);
    return {passkey, message: `Passkey "${passkey.label}" created.`} as T;
  }

  const pkDel = pathname.match(/^\/api\/security\/passkeys\/(\d+)$/);
  if (pkDel && method === 'DELETE') {
    const me = getAuthedUser();
    const id = Number(pkDel[1]);
    store.passkeysByUser[String(me.id)] = (store.passkeysByUser[String(me.id)] || []).filter(
      (p) => p.id !== id,
    );
    saveStore(store);
    return {ok: true} as T;
  }

  if (pathname === '/api/security/sessions/revoke-others' && method === 'POST') {
    const me = getAuthedUser();
    for (const [tok, s] of Object.entries(store.sessions)) {
      if (s.userId === me.id && tok !== token) delete store.sessions[tok];
    }
    saveStore(store);
    return {ok: true, message: 'Signed out of all other devices.'} as T;
  }

  const sessDel = pathname.match(/^\/api\/security\/sessions\/(\d+)$/);
  if (sessDel && method === 'DELETE') {
    return {ok: true, message: 'Device logged out successfully.'} as T;
  }

  throw new Error('Request failed. Please try again.');
}
