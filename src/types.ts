export interface UserProfile {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  bio: string;
  location: string;
  work: string;
  avatar_url: string;
  cover_url: string;
  date_of_birth?: string;
  created_at: string;
  friends_count?: number;
  followers_count?: number;
  following_count?: number;
  posts_count?: number;
  friendship_status?: 'none' | 'friends' | 'outgoing_pending' | 'incoming_pending';
  is_following?: boolean;
}

export interface CommentItem {
  id: number;
  post_id: number;
  user_id: number;
  content: string;
  created_at: string;
  author_name: string;
  author_avatar: string;
}

export interface PostItem {
  id: number;
  user_id: number;
  content: string;
  image_url: string | null;
  created_at: string;
  author_name: string;
  author_avatar: string;
  author_work?: string;
  likes_count: number;
  liked_by_me: boolean;
  saved_by_me?: boolean;
  comments_count: number;
  comments: CommentItem[];
}

export interface NotificationItem {
  id: number;
  user_id: number;
  actor_id: number | null;
  actor_name: string | null;
  actor_avatar: string | null;
  type: 'like' | 'comment' | 'friend_request' | 'friend_accepted' | 'follow' | 'message' | 'welcome';
  entity_id: number | null;
  message: string;
  read: boolean;
  created_at: string;
}

export interface ChatMessage {
  id: number;
  sender_id: number;
  receiver_id: number;
  content: string;
  read: boolean;
  created_at: string;
}

export interface ConversationSummary {
  user: UserProfile;
  last_message: string | null;
  last_message_at: string | null;
  last_sender_id: number | null;
  unread_count: number;
}

export interface NetworkData {
  friends: UserProfile[];
  incomingRequests: (UserProfile & { request_id: number; requested_at: string })[];
  outgoingRequests: (UserProfile & { request_id: number; requested_at: string })[];
  suggestions: UserProfile[];
  followingIds: number[];
}

export interface UserSettings {
  profile_visibility: 'public' | 'friends';
  friend_request_policy: 'everyone' | 'friends_of_friends';
  show_online_status: boolean;
  email_notifications: boolean;
  push_notifications: boolean;
  language: string;
  updated_at?: string;
}

export interface DashboardStats {
  posts_count: number;
  total_likes: number;
  total_comments: number;
  friends_count: number;
  followers_count: number;
  recent_posts: PostItem[];
}

export interface GroupItem {
  id: number;
  name: string;
  category: string;
  description: string;
  cover_url: string;
  members_count: number;
  joined: boolean;
}

export interface MarketplaceItem {
  id: number;
  seller_id: number;
  seller_name: string;
  seller_avatar: string;
  title: string;
  price: string;
  category: string;
  location: string;
  description: string;
  image_url: string;
  created_at: string;
}

export interface EventItem {
  id: number;
  title: string;
  event_date: string;
  location: string;
  description: string;
  host_name: string | null;
  going_count: number;
  interested_count: number;
  my_rsvp: 'going' | 'interested' | null;
}

export interface PageItem {
  id: number;
  name: string;
  category: string;
  bio: string;
  avatar_url: string;
  followers_count: number;
  following: boolean;
}

export interface ActivityItem {
  id: number;
  kind: 'post' | 'like' | 'comment';
  summary: string;
  created_at: string;
}

export interface LinkedAccountItem {
  id: number;
  user_id: number;
  handle: string;
  platform: string;
  status: 'Active' | 'Deactivated';
  avatar_url: string;
  created_at: string;
}

export interface UserSecurityConfig {
  two_factor_enabled: boolean;
  two_factor_method: 'authenticator' | 'sms';
  two_factor_secret: string;
  backup_codes: string[];
  saved_login_enabled: boolean;
  advanced_protection: boolean;
  login_alerts_inapp: boolean;
  login_alerts_email: boolean;
  e2ee_key_alerts: boolean;
  e2ee_fingerprint: string;
  account_status: 'active' | 'deactivated';
  updated_at?: string;
}

export interface PasskeyItem {
  id: number;
  label: string;
  credential_id: string;
  created_at: string;
}

export interface ActiveSessionItem {
  id: number;
  device_name: string;
  ip_address: string;
  created_at: string;
  is_current: boolean;
}

export interface SecurityEmailItem {
  id: number;
  category: 'security' | 'other';
  subject: string;
  body: string;
  recipient: string;
  created_at: string;
}

export type SettingsSection =
  | 'overview'
  | 'personal-details'
  | 'password-security'
  | 'privacy'
  | 'notifications'
  | 'appearance';

export type AppView =
  | 'home'
  | 'profile'
  | 'friends'
  | 'messages'
  | 'notifications'
  | 'menu'
  | 'settings'
  | 'dashboard'
  | 'groups'
  | 'marketplace'
  | 'saved'
  | 'events'
  | 'pages'
  | 'memories'
  | 'birthdays'
  | 'reels'
  | 'activity';
export type AuthView = 'login' | 'register' | 'forgot-password' | 'reset-password';
