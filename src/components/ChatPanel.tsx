import {useEffect, useRef, useState} from 'react';
import type {FormEvent} from 'react';
import {
  Bell,
  Check,
  CheckCheck,
  Heart,
  MessageCircle,
  MessageSquare,
  Send,
  UserPlus,
  X,
} from 'lucide-react';
import {formatRelativeTime} from '../lib/api';
import type {ChatMessage, ConversationSummary, NotificationItem, UserProfile} from '../types';
import {Avatar} from './MediaImage';

interface RightRailProps {
  conversations: ConversationSummary[];
  notifications: NotificationItem[];
  onlineUserIds: number[];
  onSelectChat: (user: UserProfile) => void;
  onMarkAllRead: () => void;
  onNotificationClick: (notif: NotificationItem) => void;
}

export function RightRailPanel({
  conversations,
  notifications,
  onlineUserIds,
  onSelectChat,
  onMarkAllRead,
  onNotificationClick,
}: RightRailProps) {
  const [panelTab, setPanelTab] = useState<'chats' | 'notifications'>('chats');
  const onlineSet = new Set(onlineUserIds);
  const unreadNotifCount = notifications.filter((n) => !n.read).length;

  return (
    <div className="bg-white dark:bg-[#16191F] border border-[#E5E8EE] dark:border-[#252A34] shadow-[0_1px_2px_rgba(15,23,42,0.04)] rounded-2xl overflow-hidden flex flex-col max-h-[calc(100vh-6rem)]">
      {/* Switcher */}
      <div className="p-3 border-b border-[#E5E8EE] dark:border-[#252A34]">
        <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-[#F4F6F9] dark:bg-[#0E1014]">
          <button
            type="button"
            onClick={() => setPanelTab('chats')}
            className={`py-2 px-3 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
              panelTab === 'chats'
                ? 'bg-white dark:bg-[#232732] text-[#0F172A] dark:text-white shadow-xs'
                : 'text-[#64748B] dark:text-[#94A3B8] hover:text-[#0F172A] dark:hover:text-white'
            }`}
          >
            Chats
          </button>
          <button
            type="button"
            onClick={() => setPanelTab('notifications')}
            className={`py-2 px-3 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
              panelTab === 'notifications'
                ? 'bg-white dark:bg-[#232732] text-[#0F172A] dark:text-white shadow-xs'
                : 'text-[#64748B] dark:text-[#94A3B8] hover:text-[#0F172A] dark:hover:text-white'
            }`}
          >
            Alerts{unreadNotifCount > 0 ? ` (${unreadNotifCount})` : ''}
          </button>
        </div>
      </div>

      {/* Chats list */}
      {panelTab === 'chats' && (
        <div className="overflow-y-auto divide-y divide-[#E5E8EE] dark:divide-[#252A34]">
          {conversations.length === 0 ? (
            <div className="p-6 text-center text-xs text-[#64748B] dark:text-[#94A3B8]">
              No contacts available yet.
            </div>
          ) : (
            conversations.map((conv) => (
              <button
                key={conv.user.id}
                type="button"
                onClick={() => onSelectChat(conv.user)}
                className="w-full px-3.5 py-3 flex items-center gap-3 hover:bg-[#F8FAFC] dark:hover:bg-[#1E222B] transition-colors text-left cursor-pointer"
              >
                <Avatar
                  src={conv.user.avatar_url}
                  name={conv.user.name}
                  size="sm"
                  online={onlineSet.has(conv.user.id)}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-[#0F172A] dark:text-[#F1F5F9] truncate">
                      {conv.user.name}
                    </span>
                    {conv.last_message_at && (
                      <span className="text-[11px] text-[#64748B] dark:text-[#94A3B8] tabular-nums shrink-0">
                        {formatRelativeTime(conv.last_message_at)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-0.5">
                    <p className="text-xs text-[#64748B] dark:text-[#94A3B8] truncate">
                      {conv.last_message || 'Start a conversation'}
                    </p>
                    {conv.unread_count > 0 && (
                      <span className="text-[11px] font-bold text-[#1877F2] dark:text-[#60A5FA] tabular-nums shrink-0">
                        {conv.unread_count} new
                      </span>
                    )}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      )}

      {/* Notifications list */}
      {panelTab === 'notifications' && (
        <div className="flex flex-col min-h-0 flex-1">
          {unreadNotifCount > 0 && (
            <div className="px-3.5 py-2 border-b border-[#E5E8EE] dark:border-[#252A34] flex items-center justify-between">
              <span className="text-xs text-[#64748B] dark:text-[#94A3B8] tabular-nums">
                {unreadNotifCount} unread
              </span>
              <button
                type="button"
                onClick={onMarkAllRead}
                className="inline-flex items-center gap-1 text-xs font-semibold text-[#1877F2] dark:text-[#60A5FA] hover:underline cursor-pointer"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                <span>Mark all read</span>
              </button>
            </div>
          )}

          <div className="overflow-y-auto divide-y divide-[#E5E8EE] dark:divide-[#252A34]">
            {notifications.length === 0 ? (
              <div className="p-6 text-center text-xs text-[#64748B] dark:text-[#94A3B8]">
                You are all caught up.
              </div>
            ) : (
              notifications.map((notif) => (
                <button
                  key={notif.id}
                  type="button"
                  onClick={() => onNotificationClick(notif)}
                  className={`w-full px-3.5 py-3 flex items-start gap-2.5 text-left hover:bg-[#F8FAFC] dark:hover:bg-[#1E222B] transition-colors cursor-pointer ${
                    !notif.read ? 'bg-[#1877F2]/5 dark:bg-[#3B82F6]/10' : ''
                  }`}
                >
                  {notif.actor_name ? (
                    <Avatar src={notif.actor_avatar} name={notif.actor_name} size="sm" />
                  ) : (
                    <div className="w-9 h-9 rounded-full bg-[#1877F2]/12 text-[#1877F2] dark:text-[#60A5FA] flex items-center justify-center shrink-0">
                      <Bell className="w-4 h-4" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-[#0F172A] dark:text-[#E2E8F0] leading-snug">
                      {notif.message}
                    </p>
                    <span className="text-[11px] text-[#64748B] dark:text-[#94A3B8] mt-1 block tabular-nums">
                      {formatRelativeTime(notif.created_at)}
                    </span>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface ChatWindowProps {
  peer: UserProfile;
  currentUser: UserProfile;
  messages: ChatMessage[];
  isPeerOnline: boolean;
  isPeerTyping: boolean;
  onSendMessage: (peerId: number, content: string) => Promise<void>;
  onTyping: (peerId: number, isTyping: boolean) => void;
  onOpenProfile: (userId: number) => void;
  onClose?: () => void;
  compact?: boolean;
}

export function ChatConversationWindow({
  peer,
  currentUser,
  messages,
  isPeerOnline,
  isPeerTyping,
  onSendMessage,
  onTyping,
  onOpenProfile,
  onClose,
  compact = false,
}: ChatWindowProps) {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const scrollEndRef = useRef<HTMLDivElement>(null);
  const typingTimerRef = useRef<number | null>(null);

  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({behavior: 'smooth'});
  }, [messages.length, isPeerTyping]);

  function handleDraftChange(value: string) {
    setDraft(value);
    onTyping(peer.id, value.trim().length > 0);
    if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current);
    typingTimerRef.current = window.setTimeout(() => {
      onTyping(peer.id, false);
    }, 1800);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed || sending) return;
    setSending(true);
    try {
      await onSendMessage(peer.id, trimmed);
      setDraft('');
      onTyping(peer.id, false);
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      className={`bg-white dark:bg-[#16191F] border border-[#E5E8EE] dark:border-[#252A34] flex flex-col overflow-hidden ${
        compact
          ? 'w-[340px] h-[440px] rounded-t-2xl shadow-xl shadow-slate-900/10 dark:shadow-black/40'
          : 'h-[620px] rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.04)]'
      }`}
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-[#E5E8EE] dark:border-[#252A34] flex items-center justify-between gap-2 shrink-0">
        <button
          type="button"
          onClick={() => onOpenProfile(peer.id)}
          className="flex items-center gap-2.5 min-w-0 text-left cursor-pointer"
        >
          <Avatar src={peer.avatar_url} name={peer.name} size="sm" online={isPeerOnline} />
          <div className="min-w-0">
            <span className="font-display font-semibold text-sm text-[#0F172A] dark:text-white truncate block hover:underline">
              {peer.name}
            </span>
            <span className="text-[11px] text-[#64748B] dark:text-[#94A3B8] block">
              {isPeerTyping ? 'Typing...' : isPeerOnline ? 'Active now' : 'Offline'}
            </span>
          </div>
        </button>

        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close chat"
            className="p-1.5 rounded-lg text-[#64748B] dark:text-[#94A3B8] hover:bg-[#F4F6F9] dark:hover:bg-[#232732] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Messages body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2.5 bg-[#F8FAFC] dark:bg-[#101318]">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-6">
            <Avatar src={peer.avatar_url} name={peer.name} size="lg" />
            <p className="font-display font-semibold text-sm text-[#0F172A] dark:text-white mt-3">
              {peer.name}
            </p>
            <p className="text-xs text-[#64748B] dark:text-[#94A3B8] mt-1">
              Say hello to start a real-time conversation.
            </p>
          </div>
        ) : (
          messages.map((m) => {
            const mine = m.sender_id === currentUser.id;
            return (
              <div key={m.id} className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
                <div
                  className={`max-w-[80%] px-3.5 py-2 rounded-2xl text-sm leading-relaxed break-words ${
                    mine
                      ? 'bg-[#1877F2] dark:bg-[#2563EB] text-white rounded-br-sm'
                      : 'bg-white dark:bg-[#1E222B] border border-[#E5E8EE] dark:border-[#252A34] text-[#0F172A] dark:text-[#F1F5F9] rounded-bl-sm'
                  }`}
                >
                  {m.content}
                </div>
                <span className="text-[10px] text-[#64748B] dark:text-[#94A3B8] mt-1 px-1 tabular-nums">
                  {formatRelativeTime(m.created_at)}
                </span>
              </div>
            );
          })
        )}

        {isPeerTyping && (
          <div className="flex items-start">
            <div className="px-3.5 py-2 rounded-2xl bg-white dark:bg-[#1E222B] border border-[#E5E8EE] dark:border-[#252A34] text-xs text-[#64748B] dark:text-[#94A3B8]">
              {peer.name.split(' ')[0]} is typing...
            </div>
          </div>
        )}
        <div ref={scrollEndRef} />
      </div>

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        className="p-3 border-t border-[#E5E8EE] dark:border-[#252A34] bg-white dark:bg-[#16191F] flex items-center gap-2 shrink-0"
      >
        <input
          type="text"
          value={draft}
          onChange={(e) => handleDraftChange(e.target.value)}
          placeholder="Type a message..."
          className="flex-1 h-10 px-3.5 rounded-xl bg-[#F4F6F9] dark:bg-[#0E1014] border border-transparent focus:border-[#1877F2]/40 text-sm text-[#0F172A] dark:text-white placeholder:text-[#64748B] dark:placeholder:text-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#1877F2]/30"
        />
        <button
          type="submit"
          disabled={!draft.trim() || sending}
          aria-label="Send message"
          className="w-10 h-10 rounded-xl bg-[#1877F2] hover:bg-[#166FE5] dark:bg-[#2563EB] text-white flex items-center justify-center disabled:opacity-45 active:scale-[0.97] transition-all shrink-0 cursor-pointer"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
}

interface MessagesPageProps {
  currentUser: UserProfile;
  conversations: ConversationSummary[];
  activePeer: UserProfile | null;
  messagesByPeer: Record<number, ChatMessage[]>;
  onlineUserIds: number[];
  typingUsers: Record<number, boolean>;
  onSelectPeer: (peer: UserProfile) => void;
  onSendMessage: (peerId: number, content: string) => Promise<void>;
  onTyping: (peerId: number, isTyping: boolean) => void;
  onOpenProfile: (userId: number) => void;
}

export function MessagesPage({
  currentUser,
  conversations,
  activePeer,
  messagesByPeer,
  onlineUserIds,
  typingUsers,
  onSelectPeer,
  onSendMessage,
  onTyping,
  onOpenProfile,
}: MessagesPageProps) {
  const onlineSet = new Set(onlineUserIds);
  const selectedPeer = activePeer || conversations[0]?.user || null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-start">
      {/* Contacts Column */}
      <div className="md:col-span-5 bg-white dark:bg-[#16191F] border border-[#E5E8EE] dark:border-[#252A34] shadow-[0_1px_2px_rgba(15,23,42,0.04)] rounded-2xl overflow-hidden">
        <div className="px-4 py-3.5 border-b border-[#E5E8EE] dark:border-[#252A34]">
          <h1 className="text-lg font-display font-bold text-[#0F172A] dark:text-white">
            Messages
          </h1>
          <p className="text-xs text-[#64748B] dark:text-[#94A3B8]">
            Real-time conversations with friends and community members
          </p>
        </div>

        <div className="divide-y divide-[#E5E8EE] dark:divide-[#252A34] max-h-[540px] overflow-y-auto">
          {conversations.length === 0 ? (
            <div className="p-6 text-center text-sm text-[#64748B] dark:text-[#94A3B8]">
              No conversations yet.
            </div>
          ) : (
            conversations.map((conv) => {
              const isActive = selectedPeer?.id === conv.user.id;
              return (
                <button
                  key={conv.user.id}
                  type="button"
                  onClick={() => onSelectPeer(conv.user)}
                  className={`w-full px-4 py-3.5 flex items-center gap-3 text-left transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-[#1877F2]/8 dark:bg-[#3B82F6]/15'
                      : 'hover:bg-[#F8FAFC] dark:hover:bg-[#1E222B]'
                  }`}
                >
                  <Avatar
                    src={conv.user.avatar_url}
                    name={conv.user.name}
                    size="md"
                    online={onlineSet.has(conv.user.id)}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-[#0F172A] dark:text-white truncate">
                        {conv.user.name}
                      </span>
                      {conv.last_message_at && (
                        <span className="text-[11px] text-[#64748B] dark:text-[#94A3B8] tabular-nums">
                          {formatRelativeTime(conv.last_message_at)}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[#64748B] dark:text-[#94A3B8] truncate mt-0.5">
                      {conv.last_message || 'Start chatting'}
                    </p>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Active Conversation */}
      <div className="md:col-span-7">
        {selectedPeer ? (
          <ChatConversationWindow
            peer={selectedPeer}
            currentUser={currentUser}
            messages={messagesByPeer[selectedPeer.id] || []}
            isPeerOnline={onlineSet.has(selectedPeer.id)}
            isPeerTyping={Boolean(typingUsers[selectedPeer.id])}
            onSendMessage={onSendMessage}
            onTyping={onTyping}
            onOpenProfile={onOpenProfile}
          />
        ) : (
          <div className="bg-white dark:bg-[#16191F] border border-[#E5E8EE] dark:border-[#252A34] shadow-[0_1px_2px_rgba(15,23,42,0.04)] rounded-2xl p-10 text-center">
            <MessageSquare className="w-8 h-8 mx-auto text-[#64748B] dark:text-[#94A3B8]" />
            <p className="text-sm font-medium text-[#0F172A] dark:text-white mt-3">
              Select a conversation
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

interface NotificationsPageProps {
  notifications: NotificationItem[];
  onMarkAllRead: () => void;
  onNotificationClick: (notif: NotificationItem) => void;
}

export function NotificationsPage({
  notifications,
  onMarkAllRead,
  onNotificationClick,
}: NotificationsPageProps) {
  const unreadCount = notifications.filter((n) => !n.read).length;

  function renderTypeIcon(type: NotificationItem['type']) {
    switch (type) {
      case 'like':
        return <Heart className="w-4 h-4 text-[#E11D48]" />;
      case 'comment':
        return <MessageCircle className="w-4 h-4 text-[#1877F2]" />;
      case 'friend_request':
      case 'friend_accepted':
      case 'follow':
        return <UserPlus className="w-4 h-4 text-[#16A34A]" />;
      default:
        return <Bell className="w-4 h-4 text-[#1877F2]" />;
    }
  }

  return (
    <div className="bg-white dark:bg-[#16191F] border border-[#E5E8EE] dark:border-[#252A34] shadow-[0_1px_2px_rgba(15,23,42,0.04)] rounded-2xl overflow-hidden">
      <div className="px-5 py-4 border-b border-[#E5E8EE] dark:border-[#252A34] flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-display font-bold text-[#0F172A] dark:text-white">
            Notifications
          </h1>
          <p className="text-xs text-[#64748B] dark:text-[#94A3B8] mt-0.5 tabular-nums">
            {unreadCount === 0 ? 'All caught up' : `${unreadCount} unread updates`}
          </p>
        </div>

        {unreadCount > 0 && (
          <button
            type="button"
            onClick={onMarkAllRead}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#F4F6F9] dark:bg-[#232732] hover:bg-[#E5E8EE] dark:hover:bg-[#2D3342] text-xs font-semibold text-[#0F172A] dark:text-white transition-colors cursor-pointer"
          >
            <Check className="w-3.5 h-3.5" />
            <span>Mark all read</span>
          </button>
        )}
      </div>

      <div className="divide-y divide-[#E5E8EE] dark:divide-[#252A34]">
        {notifications.length === 0 ? (
          <div className="p-10 text-center text-sm text-[#64748B] dark:text-[#94A3B8]">
            No notifications yet. Activity from friends and posts will appear here in real time.
          </div>
        ) : (
          notifications.map((notif) => (
            <button
              key={notif.id}
              type="button"
              onClick={() => onNotificationClick(notif)}
              className={`w-full px-5 py-4 flex items-start gap-3.5 text-left hover:bg-[#F8FAFC] dark:hover:bg-[#1E222B] transition-colors cursor-pointer ${
                !notif.read ? 'bg-[#1877F2]/5 dark:bg-[#3B82F6]/10' : ''
              }`}
            >
              {notif.actor_name ? (
                <Avatar src={notif.actor_avatar} name={notif.actor_name} size="md" />
              ) : (
                <div className="w-10 h-10 rounded-full bg-[#F4F6F9] dark:bg-[#232732] flex items-center justify-center shrink-0">
                  {renderTypeIcon(notif.type)}
                </div>
              )}

              <div className="flex-1 min-w-0">
                <p className="text-sm text-[#0F172A] dark:text-[#F1F5F9] leading-snug">
                  {notif.message}
                </p>
                <div className="flex items-center gap-2 mt-1 text-xs text-[#64748B] dark:text-[#94A3B8]">
                  <span className="tabular-nums">{formatRelativeTime(notif.created_at)}</span>
                  {!notif.read && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="font-semibold text-[#1877F2] dark:text-[#60A5FA]">Unread</span>
                    </>
                  )}
                </div>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
