import {useCallback, useEffect, useMemo, useState} from 'react';
import type {FormEvent, MouseEvent} from 'react';
import {
  AlertCircle,
  ArrowUpDown,
  BarChart3,
  Bookmark,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Clock,
  Copy,
  Eye,
  EyeOff,
  Film,
  Flag,
  Gift,
  Globe,
  Heart,
  History,
  Loader2,
  Lock,
  LogIn,
  LogOut,
  MessageCircle,
  Moon,
  Newspaper,
  Search,
  Settings,
  ShieldCheck,
  Store,
  Sun,
  UserPlus,
  Users,
  UsersRound,
  X,
} from 'lucide-react';
import {
  listVaultAccounts,
  removeVaultAccount,
  saveAccountToVault,
  type VaultAccountRecord,
} from '../lib/accountVault';
import {
  formatFirestoreErrorMessage,
  signInWithEmailFirebase,
  signInWithGooglePopup,
} from '../lib/firebase';
import {ensureAndLoadUserProfile} from '../lib/firestoreStore';
import type {AppView, SettingsSection, UserProfile} from '../types';
import {Avatar} from './MediaImage';

interface MenuViewProps {
  currentUser: UserProfile;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onNavigate: (view: AppView, profileId?: number) => void;
  onSwitchedAccount: (user: UserProfile, token: string) => void;
  onAddAccount: (mode: 'login' | 'register') => void;
  onLogout: () => void;
  onOpenSettingsSection: (section: SettingsSection) => void;
}

interface ShortcutItem {
  id: string;
  label: string;
  view: AppView;
  iconBg: string;
  iconColor: string;
  icon: typeof BarChart3;
}

const SHORTCUTS: ShortcutItem[] = [
  {
    id: 'dashboard',
    label: 'Professional dashboard',
    view: 'dashboard',
    iconBg: 'bg-[#EFF6FF] dark:bg-[#1E3A8A]/40',
    iconColor: 'text-[#2563EB] dark:text-[#60A5FA]',
    icon: BarChart3,
  },
  {
    id: 'messages',
    label: 'Messages',
    view: 'messages',
    iconBg: 'bg-[#F5F3FF] dark:bg-[#4C1D95]/40',
    iconColor: 'text-[#7C3AED] dark:text-[#A78BFA]',
    icon: MessageCircle,
  },
  {
    id: 'groups',
    label: 'Groups',
    view: 'groups',
    iconBg: 'bg-[#EFF6FF] dark:bg-[#1E3A8A]/40',
    iconColor: 'text-[#1877F2] dark:text-[#60A5FA]',
    icon: UsersRound,
  },
  {
    id: 'friends',
    label: 'Friends',
    view: 'friends',
    iconBg: 'bg-[#ECFEFF] dark:bg-[#164E63]/40',
    iconColor: 'text-[#0891B2] dark:text-[#22D3EE]',
    icon: Users,
  },
  {
    id: 'reels',
    label: 'Reels',
    view: 'reels',
    iconBg: 'bg-[#FFF1F2] dark:bg-[#881337]/40',
    iconColor: 'text-[#E11D48] dark:text-[#FB7185]',
    icon: Film,
  },
  {
    id: 'marketplace',
    label: 'Marketplace',
    view: 'marketplace',
    iconBg: 'bg-[#ECFDF5] dark:bg-[#064E3B]/40',
    iconColor: 'text-[#0D9488] dark:text-[#2DD4BF]',
    icon: Store,
  },
  {
    id: 'pages',
    label: 'Pages',
    view: 'pages',
    iconBg: 'bg-[#FFF7ED] dark:bg-[#7C2D12]/40',
    iconColor: 'text-[#EA580C] dark:text-[#FB923C]',
    icon: Flag,
  },
  {
    id: 'saved',
    label: 'Saved',
    view: 'saved',
    iconBg: 'bg-[#FAF5FF] dark:bg-[#581C87]/40',
    iconColor: 'text-[#9333EA] dark:text-[#C084FC]',
    icon: Bookmark,
  },
  {
    id: 'memories',
    label: 'Memories',
    view: 'memories',
    iconBg: 'bg-[#EFF6FF] dark:bg-[#1E3A8A]/40',
    iconColor: 'text-[#0284C7] dark:text-[#38BDF8]',
    icon: History,
  },
  {
    id: 'birthdays',
    label: 'Birthdays',
    view: 'birthdays',
    iconBg: 'bg-[#FEF2F2] dark:bg-[#7F1D1D]/40',
    iconColor: 'text-[#E11D48] dark:text-[#FDA4AF]',
    icon: Gift,
  },
  {
    id: 'events',
    label: 'Events',
    view: 'events',
    iconBg: 'bg-[#FEF2F2] dark:bg-[#7F1D1D]/40',
    iconColor: 'text-[#DC2626] dark:text-[#F87171]',
    icon: CalendarDays,
  },
  {
    id: 'feeds',
    label: 'Feeds',
    view: 'home',
    iconBg: 'bg-[#FFF7ED] dark:bg-[#7C2D12]/40',
    iconColor: 'text-[#F97316] dark:text-[#FDBA74]',
    icon: Newspaper,
  },
];

function isSameAccount(acc: VaultAccountRecord, user: UserProfile): boolean {
  if (user.email && acc.email && user.email.trim().toLowerCase() === acc.email.trim().toLowerCase()) {
    return true;
  }
  if (user.phone && acc.phone) {
    const a = user.phone.replace(/\D/g, '');
    const b = acc.phone.replace(/\D/g, '');
    if (a && b && (a === b || a.endsWith(b.slice(-10)) || b.endsWith(a.slice(-10)))) {
      return true;
    }
  }
  if (acc.userId && acc.userId === user.id) return true;
  return false;
}

export function MenuView({
  currentUser,
  theme,
  onToggleTheme,
  onNavigate,
  onSwitchedAccount,
  onAddAccount,
  onLogout,
  onOpenSettingsSection,
}: MenuViewProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortAlpha, setSortAlpha] = useState(false);

  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [switchOpen, setSwitchOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [copiedInvite, setCopiedInvite] = useState(false);

  const [vaultAccounts, setVaultAccounts] = useState<VaultAccountRecord[]>([]);
  const [switchingVaultId, setSwitchingVaultId] = useState<string | null>(null);
  const [unlockTarget, setUnlockTarget] = useState<VaultAccountRecord | null>(null);
  const [unlockPassword, setUnlockPassword] = useState('');
  const [showUnlockPassword, setShowUnlockPassword] = useState(false);
  const [unlockBusy, setUnlockBusy] = useState(false);
  const [googleSwitchBusy, setGoogleSwitchBusy] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);

  const refreshSavedAccounts = useCallback(async () => {
    await saveAccountToVault({
      user: currentUser,
      firebaseUid: currentUser.uid || null,
    }).catch(() => {});
    const list = await listVaultAccounts().catch(() => []);
    setVaultAccounts(list);
  }, [currentUser]);

  useEffect(() => {
    refreshSavedAccounts();
  }, [refreshSavedAccounts]);

  const otherSavedAccounts = useMemo(
    () => vaultAccounts.filter((acc) => !isSameAccount(acc, currentUser)),
    [vaultAccounts, currentUser],
  );

  const totalAccountsCount = 1 + otherSavedAccounts.length;

  const visibleShortcuts = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    const list = q
      ? SHORTCUTS.filter((item) => item.label.toLowerCase().includes(q))
      : [...SHORTCUTS];
    if (sortAlpha) {
      list.sort((a, b) => a.label.localeCompare(b.label));
    }
    return list;
  }, [searchTerm, sortAlpha]);

  async function handleTapSavedAccount(acc: VaultAccountRecord) {
    setSwitchError(null);
    if (acc.authMethod === 'google') {
      await handleUnlockWithGoogle();
      return;
    }
    setUnlockTarget(acc);
    setUnlockPassword('');
    setShowUnlockPassword(false);
  }

  async function handleUnlockWithPassword(e: FormEvent) {
    e.preventDefault();
    if (!unlockTarget) return;
    setSwitchError(null);

    const identifier = unlockTarget.email || '';
    if (!identifier || !unlockPassword) {
      setSwitchError('Enter your password to switch into this account.');
      return;
    }

    setUnlockBusy(true);
    setSwitchingVaultId(unlockTarget.id);
    try {
      const {user: fbUser, emailVerified, idToken} = await signInWithEmailFirebase(
        identifier,
        unlockPassword,
      );
      if (!emailVerified) {
        setSwitchError('Please verify this Gmail address before switching into it.');
        return;
      }
      const profile = await ensureAndLoadUserProfile(fbUser, {authMethod: 'email_otp'});
      await saveAccountToVault({
        user: profile,
        authMethod: 'email_otp',
        firebaseUid: fbUser.uid,
        sessionToken: idToken,
      }).catch(() => {});
      setUnlockTarget(null);
      setUnlockPassword('');
      onSwitchedAccount(profile, idToken);
    } catch (err) {
      setSwitchError(formatFirestoreErrorMessage(err));
    } finally {
      setUnlockBusy(false);
      setSwitchingVaultId(null);
    }
  }

  async function handleUnlockWithGoogle() {
    setSwitchError(null);
    setGoogleSwitchBusy(true);
    try {
      const {user: fbUser, idToken} = await signInWithGooglePopup();
      const profile = await ensureAndLoadUserProfile(fbUser, {authMethod: 'google'});
      await saveAccountToVault({
        user: profile,
        authMethod: 'google',
        firebaseUid: fbUser.uid,
        sessionToken: idToken,
      }).catch(() => {});
      setUnlockTarget(null);
      onSwitchedAccount(profile, idToken);
    } catch (err) {
      setSwitchError(formatFirestoreErrorMessage(err));
    } finally {
      setGoogleSwitchBusy(false);
    }
  }

  async function handleRemoveFromDevice(e: MouseEvent, vaultId: string) {
    e.stopPropagation();
    await removeVaultAccount(vaultId).catch(() => {});
    setVaultAccounts((prev) => prev.filter((item) => item.id !== vaultId));
    if (unlockTarget?.id === vaultId) {
      setUnlockTarget(null);
      setUnlockPassword('');
      setSwitchError(null);
    }
  }

  function handleCopyInvite() {
    const inviteUrl = `${window.location.origin}/register?ref=${currentUser.id}`;
    navigator.clipboard?.writeText(inviteUrl).then(() => {
      setCopiedInvite(true);
      setTimeout(() => setCopiedInvite(false), 2200);
    });
  }

  return (
    <div className="space-y-3.5 pb-4">
      {/* Facebook-style Menu Header */}
      <div className="flex items-center justify-between gap-3 px-1">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onNavigate('home')}
            aria-label="Back to Home"
            className="w-10 h-10 rounded-full flex items-center justify-center text-[#0F172A] dark:text-white hover:bg-[#E5E8EE] dark:hover:bg-[#232732] transition-colors cursor-pointer"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
          <h1 className="text-2xl font-display font-extrabold tracking-tight text-[#0F172A] dark:text-white">
            Menu
          </h1>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setSortAlpha((prev) => !prev)}
            title={sortAlpha ? 'Restore default order' : 'Sort shortcuts A–Z'}
            aria-label="Sort menu shortcuts"
            className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
              sortAlpha
                ? 'bg-[#1877F2]/12 text-[#1877F2] dark:text-[#60A5FA]'
                : 'text-[#0F172A] dark:text-white hover:bg-[#E5E8EE] dark:hover:bg-[#232732]'
            }`}
          >
            <ArrowUpDown className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={() => {
              setSearchOpen((prev) => !prev);
              setSearchTerm('');
            }}
            aria-label="Search menu"
            className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
              searchOpen
                ? 'bg-[#1877F2]/12 text-[#1877F2] dark:text-[#60A5FA]'
                : 'text-[#0F172A] dark:text-white hover:bg-[#E5E8EE] dark:hover:bg-[#232732]'
            }`}
          >
            <Search className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Optional inline search input */}
      {searchOpen && (
        <div className="relative">
          <Search className="w-4 h-4 text-[#64748B] dark:text-[#94A3B8] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            autoFocus
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search shortcuts & settings..."
            className="w-full h-11 pl-10 pr-4 rounded-2xl bg-white dark:bg-[#16191F] border border-[#E5E8EE] dark:border-[#252A34] shadow-[0_1px_2px_rgba(15,23,42,0.04)] text-sm text-[#0F172A] dark:text-white placeholder:text-[#64748B] dark:placeholder:text-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#1877F2]/30 focus:border-[#1877F2]"
          />
        </div>
      )}

      {/* Card 1: Profile Card ("View your profile") */}
      <div className="bg-white dark:bg-[#16191F] border border-[#E5E8EE] dark:border-[#252A34] shadow-[0_1px_2px_rgba(15,23,42,0.04)] rounded-2xl overflow-hidden">
        <div className="px-4 py-3.5 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => onNavigate('profile', currentUser.id)}
            className="flex items-center gap-3.5 min-w-0 flex-1 text-left cursor-pointer"
          >
            <Avatar src={currentUser.avatar_url} name={currentUser.name} size="md" />
            <div className="min-w-0">
              <p className="font-display font-semibold text-base text-[#0F172A] dark:text-white truncate">
                {currentUser.name}
              </p>
              <p className="text-xs text-[#64748B] dark:text-[#94A3B8]">View your profile</p>
            </div>
          </button>

          <div className="flex items-center gap-2 shrink-0">
            {otherSavedAccounts[0] && (
              <button
                type="button"
                onClick={() => handleTapSavedAccount(otherSavedAccounts[0])}
                title={`Switch to ${otherSavedAccounts[0].name}`}
                className="rounded-full ring-2 ring-[#E5E8EE] dark:ring-[#2D3342] p-0.5 hover:ring-[#1877F2] transition-colors cursor-pointer"
              >
                <Avatar
                  src={otherSavedAccounts[0].avatar_url}
                  name={otherSavedAccounts[0].name}
                  size="xs"
                />
              </button>
            )}
            <button
              type="button"
              onClick={() => setProfileMenuOpen((prev) => !prev)}
              aria-label="Toggle profile options"
              className="w-9 h-9 rounded-full bg-[#F4F6F9] dark:bg-[#232732] hover:bg-[#E5E8EE] dark:hover:bg-[#2D3342] flex items-center justify-center text-[#0F172A] dark:text-white transition-colors cursor-pointer"
            >
              {profileMenuOpen ? (
                <ChevronUp className="w-5 h-5" />
              ) : (
                <ChevronDown className="w-5 h-5" />
              )}
            </button>
          </div>
        </div>

        {profileMenuOpen && (
          <div className="px-4 pb-3 pt-2 border-t border-[#E5E8EE] dark:border-[#252A34] flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onNavigate('profile', currentUser.id)}
              className="px-3.5 py-2 rounded-xl bg-[#F4F6F9] dark:bg-[#232732] hover:bg-[#E5E8EE] dark:hover:bg-[#2D3342] text-xs font-semibold text-[#0F172A] dark:text-white transition-colors cursor-pointer"
            >
              Edit Profile &amp; Bio
            </button>
            <button
              type="button"
              onClick={() => onNavigate('dashboard')}
              className="px-3.5 py-2 rounded-xl bg-[#F4F6F9] dark:bg-[#232732] hover:bg-[#E5E8EE] dark:hover:bg-[#2D3342] text-xs font-semibold text-[#0F172A] dark:text-white transition-colors cursor-pointer"
            >
              View Insights
            </button>
            <button
              type="button"
              onClick={() => onNavigate('activity')}
              className="px-3.5 py-2 rounded-xl bg-[#F4F6F9] dark:bg-[#232732] hover:bg-[#E5E8EE] dark:hover:bg-[#2D3342] text-xs font-semibold text-[#0F172A] dark:text-white transition-colors cursor-pointer"
            >
              Activity Log
            </button>
          </div>
        )}
      </div>

      {/* Card 2: Facebook-style Switch Account */}
      <div className="bg-white dark:bg-[#16191F] border border-[#E5E8EE] dark:border-[#252A34] shadow-[0_1px_2px_rgba(15,23,42,0.04)] rounded-2xl overflow-hidden">
        <button
          type="button"
          onClick={() => {
            setSwitchOpen((prev) => !prev);
            setSwitchError(null);
          }}
          className="w-full px-4 py-3.5 flex items-center justify-between gap-3 hover:bg-[#F8FAFC] dark:hover:bg-[#1E222B] transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex items-center -space-x-2 shrink-0">
              <div className="rounded-full ring-2 ring-white dark:ring-[#16191F]">
                <Avatar src={currentUser.avatar_url} name={currentUser.name} size="xs" />
              </div>
              {otherSavedAccounts.slice(0, 2).map((acc) => (
                <div
                  key={acc.id}
                  className="rounded-full ring-2 ring-white dark:ring-[#16191F]"
                >
                  <Avatar src={acc.avatar_url} name={acc.name} size="xs" />
                </div>
              ))}
            </div>
            <div className="text-left min-w-0">
              <p className="font-display font-semibold text-[15px] text-[#0F172A] dark:text-[#F1F5F9]">
                Switch account
              </p>
              <p className="text-xs text-[#64748B] dark:text-[#94A3B8]">
                {totalAccountsCount === 1
                  ? '1 saved account · Add or create another'
                  : `${totalAccountsCount} saved accounts on this device`}
              </p>
            </div>
          </div>

          <span className="w-9 h-9 rounded-full bg-[#F4F6F9] dark:bg-[#232732] flex items-center justify-center text-[#0F172A] dark:text-white shrink-0">
            {switchOpen ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
          </span>
        </button>

        {switchOpen && (
          <div className="px-3 pb-3.5 pt-2 border-t border-[#E5E8EE] dark:border-[#252A34] space-y-1.5">
            {/* Active Current Account Row */}
            <div className="w-full px-3 py-2.5 rounded-xl bg-[#EFF6FF] dark:bg-[#1E3A8A]/20 border border-[#BFDBFE] dark:border-[#1E3A8A]/50 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <Avatar src={currentUser.avatar_url} name={currentUser.name} size="sm" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[#0F172A] dark:text-white truncate">
                    {currentUser.name}
                  </p>
                  <p className="text-xs text-[#64748B] dark:text-[#94A3B8] truncate">
                    {currentUser.email || currentUser.phone || 'Active now'}
                  </p>
                </div>
              </div>
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#1877F2] dark:text-[#60A5FA] shrink-0">
                <CheckCircle2 className="w-4 h-4" />
                <span>Active</span>
              </span>
            </div>

            {/* All Other Saved Accounts Created / Logged In on This Device */}
            {otherSavedAccounts.map((acc) => {
              const isSwitching = switchingVaultId === acc.id;
              const isUnlocking = unlockTarget?.id === acc.id;
              const contactLabel = acc.email || acc.phone || 'Saved account';

              return (
                <div
                  key={acc.id}
                  className="rounded-xl border border-transparent hover:border-[#E5E8EE] dark:hover:border-[#252A34] bg-transparent"
                >
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => !isSwitching && handleTapSavedAccount(acc)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        if (!isSwitching) handleTapSavedAccount(acc);
                      }
                    }}
                    className="w-full px-3 py-2.5 rounded-xl flex items-center justify-between gap-3 hover:bg-[#F4F6F9] dark:hover:bg-[#232732] transition-colors text-left cursor-pointer"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Avatar src={acc.avatar_url} name={acc.name} size="sm" />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-[#0F172A] dark:text-white truncate">
                          {acc.name}
                        </p>
                        <p className="text-xs text-[#64748B] dark:text-[#94A3B8] truncate">
                          {contactLabel}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#1877F2] dark:text-[#60A5FA] whitespace-nowrap">
                        {isSwitching && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                        <span>
                          {isSwitching
                            ? 'Switching...'
                            : acc.sessionToken
                              ? 'Switch'
                              : 'Log in'}
                        </span>
                      </span>
                      <button
                        type="button"
                        title="Remove account from this device"
                        aria-label={`Remove ${acc.name} from Switch account`}
                        onClick={(e) => handleRemoveFromDevice(e, acc.id)}
                        className="p-1.5 rounded-full text-[#94A3B8] hover:text-[#DC2626] hover:bg-[#FEE2E2] dark:hover:bg-[#3B181A] transition-colors cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Inline Quick Unlock form if this account's session was logged out or expired */}
                  {isUnlocking && (
                    <form
                      onSubmit={handleUnlockWithPassword}
                      className="mx-2 mb-2 p-3 rounded-xl bg-[#F8FAFC] dark:bg-[#0E1014] border border-[#E5E8EE] dark:border-[#252A34] space-y-2.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-[#0F172A] dark:text-white">
                          Log in as {acc.name}
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            setUnlockTarget(null);
                            setUnlockPassword('');
                            setSwitchError(null);
                          }}
                          className="text-xs text-[#64748B] hover:text-[#0F172A] dark:hover:text-white cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>

                      {switchError && (
                        <div className="flex items-start gap-2 p-2.5 rounded-lg bg-[#FEF2F2] dark:bg-[#3B181A] border border-[#FECACA] dark:border-[#7F1D1D] text-xs text-[#B91C1C] dark:text-[#FCA5A5]">
                          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                          <span>{switchError}</span>
                        </div>
                      )}

                      <div className="relative">
                        <input
                          type={showUnlockPassword ? 'text' : 'password'}
                          autoFocus
                          value={unlockPassword}
                          onChange={(e) => setUnlockPassword(e.target.value)}
                          placeholder="Enter password to switch"
                          className="w-full h-10 pl-3 pr-10 rounded-xl bg-white dark:bg-[#16191F] border border-[#CBD5E1] dark:border-[#334155] text-sm text-[#0F172A] dark:text-white placeholder:text-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#1877F2]"
                        />
                        <button
                          type="button"
                          onClick={() => setShowUnlockPassword((prev) => !prev)}
                          aria-label={showUnlockPassword ? 'Hide password' : 'Show password'}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-[#64748B] dark:text-[#94A3B8] cursor-pointer"
                        >
                          {showUnlockPassword ? (
                            <EyeOff className="w-4 h-4" />
                          ) : (
                            <Eye className="w-4 h-4" />
                          )}
                        </button>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="submit"
                          disabled={unlockBusy || googleSwitchBusy}
                          className="flex-1 h-9 px-3 rounded-xl bg-[#1877F2] hover:bg-[#166FE5] text-white text-xs font-semibold flex items-center justify-center gap-1.5 disabled:opacity-60 cursor-pointer"
                        >
                          {unlockBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                          <span>{unlockBusy ? 'Switching...' : 'Log In & Switch'}</span>
                        </button>

                        {acc.email && (
                          <button
                            type="button"
                            disabled={unlockBusy || googleSwitchBusy}
                            onClick={handleUnlockWithGoogle}
                            className="h-9 px-3 rounded-xl bg-white dark:bg-[#1E222A] hover:bg-[#F1F5F9] dark:hover:bg-[#262B35] border border-[#CBD5E1] dark:border-[#334155] text-xs font-semibold text-[#0F172A] dark:text-white flex items-center gap-1.5 disabled:opacity-60 cursor-pointer"
                          >
                            {googleSwitchBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                            <span>Continue with Google</span>
                          </button>
                        )}
                      </div>
                    </form>
                  )}
                </div>
              );
            })}

            {switchError && !unlockTarget && (
              <div className="mx-1 flex items-start gap-2 p-2.5 rounded-xl bg-[#FEF2F2] dark:bg-[#3B181A] border border-[#FECACA] dark:border-[#7F1D1D] text-xs text-[#B91C1C] dark:text-[#FCA5A5]">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>{switchError}</span>
              </div>
            )}

            {/* Facebook-style Add / Create Account Actions (keeps current session alive!) */}
            <div className="pt-1.5 mt-1 border-t border-[#E5E8EE] dark:border-[#252A34] space-y-1">
              <button
                type="button"
                onClick={() => onAddAccount('login')}
                className="w-full px-3 py-2.5 rounded-xl flex items-center gap-3 text-sm font-semibold text-[#0F172A] dark:text-white hover:bg-[#F4F6F9] dark:hover:bg-[#232732] transition-colors cursor-pointer"
              >
                <span className="w-8 h-8 rounded-full bg-[#EFF6FF] dark:bg-[#1E3A8A]/40 text-[#1877F2] dark:text-[#60A5FA] flex items-center justify-center shrink-0">
                  <LogIn className="w-4 h-4" />
                </span>
                <span>Log into another account</span>
              </button>

              <button
                type="button"
                onClick={() => onAddAccount('register')}
                className="w-full px-3 py-2.5 rounded-xl flex items-center gap-3 text-sm font-semibold text-[#1877F2] dark:text-[#60A5FA] hover:bg-[#F4F6F9] dark:hover:bg-[#232732] transition-colors cursor-pointer"
              >
                <span className="w-8 h-8 rounded-full bg-[#EFF6FF] dark:bg-[#1E3A8A]/40 text-[#1877F2] dark:text-[#60A5FA] flex items-center justify-center shrink-0">
                  <UserPlus className="w-4 h-4" />
                </span>
                <span>Create new account</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Card 3: Invite Friends */}
      <div className="bg-white dark:bg-[#16191F] border border-[#E5E8EE] dark:border-[#252A34] shadow-[0_1px_2px_rgba(15,23,42,0.04)] rounded-2xl overflow-hidden">
        <button
          type="button"
          onClick={() => setInviteOpen((prev) => !prev)}
          className="w-full px-4 py-3.5 flex items-center justify-between gap-3 hover:bg-[#F8FAFC] dark:hover:bg-[#1E222B] transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-3">
            <span className="w-8 h-8 rounded-full bg-[#FFF1F2] dark:bg-[#881337]/40 flex items-center justify-center text-[#E11D48] dark:text-[#FB7185] shrink-0">
              <Heart className="w-4 h-4 fill-current" />
            </span>
            <span className="font-display font-semibold text-[15px] text-[#0F172A] dark:text-white">
              Invite friends
            </span>
          </div>
          <span className="text-xs font-medium text-[#64748B] dark:text-[#94A3B8]">
            {inviteOpen ? 'Hide' : 'Share link'}
          </span>
        </button>

        {inviteOpen && (
          <div className="px-4 pb-4 pt-2 border-t border-[#E5E8EE] dark:border-[#252A34] space-y-2.5">
            <p className="text-xs text-[#64748B] dark:text-[#94A3B8]">
              Share your personal invite link so friends can join Verve with email or phone.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 px-3 py-2 rounded-xl bg-[#F4F6F9] dark:bg-[#0E1014] border border-[#E5E8EE] dark:border-[#252A34] font-mono text-xs text-[#0F172A] dark:text-[#E2E8F0] truncate">
                {`${window.location.origin}/register?ref=${currentUser.id}`}
              </code>
              <button
                type="button"
                onClick={handleCopyInvite}
                className="inline-flex items-center gap-1.5 px-3.5 h-9 rounded-xl bg-[#1877F2] hover:bg-[#166FE5] text-white text-xs font-semibold whitespace-nowrap active:scale-[0.98] transition-all cursor-pointer"
              >
                {copiedInvite ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedInvite ? 'Copied' : 'Copy Link'}</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 2-Column Facebook Shortcut Grid */}
      <div className="grid grid-cols-2 gap-2.5">
        {visibleShortcuts.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate(item.view)}
              className="bg-white dark:bg-[#16191F] border border-[#E5E8EE] dark:border-[#252A34] shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:border-[#CBD5E1] dark:hover:border-[#374151] hover:bg-[#F8FAFC] dark:hover:bg-[#1B1F27] rounded-2xl p-3.5 sm:p-4 flex flex-col items-start gap-2.5 text-left transition-all active:scale-[0.99] cursor-pointer"
            >
              <span
                className={`w-9 h-9 rounded-xl ${item.iconBg} ${item.iconColor} flex items-center justify-center shrink-0`}
              >
                <Icon className="w-5 h-5" />
              </span>
              <span className="font-display font-semibold text-[15px] text-[#0F172A] dark:text-[#F1F5F9] truncate w-full">
                {item.label}
              </span>
            </button>
          );
        })}
      </div>

      {visibleShortcuts.length === 0 && (
        <div className="bg-white dark:bg-[#16191F] border border-[#E5E8EE] dark:border-[#252A34] shadow-[0_1px_2px_rgba(15,23,42,0.04)] rounded-2xl p-6 text-center text-sm text-[#64748B] dark:text-[#94A3B8]">
          No shortcuts match &ldquo;{searchTerm}&rdquo;.
        </div>
      )}

      {/* Expandable "Settings & privacy" Section (matching bottom of screenshot) */}
      <div className="pt-2 border-t border-[#E5E8EE] dark:border-[#252A34] space-y-2">
        <button
          type="button"
          onClick={() => setSettingsOpen((prev) => !prev)}
          className="w-full px-3 py-3 rounded-2xl hover:bg-white/80 dark:hover:bg-[#16191F] flex items-center justify-between gap-3 transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-3">
            <span className="w-9 h-9 rounded-full bg-[#E5E8EE] dark:bg-[#232732] text-[#475569] dark:text-[#CBD5E1] flex items-center justify-center shrink-0">
              <Settings className="w-5 h-5" />
            </span>
            <span className="font-display font-bold text-base text-[#0F172A] dark:text-white">
              Settings &amp; privacy
            </span>
          </div>
          {settingsOpen ? (
            <ChevronUp className="w-5 h-5 text-[#64748B] dark:text-[#94A3B8]" />
          ) : (
            <ChevronDown className="w-5 h-5 text-[#64748B] dark:text-[#94A3B8]" />
          )}
        </button>

        {settingsOpen && (
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => onOpenSettingsSection('overview')}
              className="w-full bg-white dark:bg-[#16191F] border border-[#E5E8EE] dark:border-[#252A34] shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:border-[#CBD5E1] dark:hover:border-[#374151] hover:bg-[#F8FAFC] dark:hover:bg-[#1B1F27] rounded-2xl px-4 py-3.5 flex items-center gap-3 text-left transition-all cursor-pointer"
            >
              <Settings className="w-5 h-5 text-[#475569] dark:text-[#94A3B8] shrink-0" />
              <div>
                <p className="font-display font-semibold text-sm text-[#0F172A] dark:text-white">
                  Settings
                </p>
                <p className="text-xs text-[#64748B] dark:text-[#94A3B8]">
                  Accounts Centre, personal details, password, and privacy
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => onOpenSettingsSection('personal-details')}
              className="w-full bg-white dark:bg-[#16191F] border border-[#E5E8EE] dark:border-[#252A34] shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:border-[#CBD5E1] dark:hover:border-[#374151] hover:bg-[#F8FAFC] dark:hover:bg-[#1B1F27] rounded-2xl px-4 py-3.5 flex items-center gap-3 text-left transition-all cursor-pointer"
            >
              <Users className="w-5 h-5 text-[#1877F2] dark:text-[#60A5FA] shrink-0" />
              <div>
                <p className="font-display font-semibold text-sm text-[#0F172A] dark:text-white">
                  Personal details
                </p>
                <p className="text-xs text-[#64748B] dark:text-[#94A3B8]">
                  Connected profiles, Pages, contact info, and date of birth
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => onOpenSettingsSection('password-security')}
              className="w-full bg-white dark:bg-[#16191F] border border-[#E5E8EE] dark:border-[#252A34] shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:border-[#CBD5E1] dark:hover:border-[#374151] hover:bg-[#F8FAFC] dark:hover:bg-[#1B1F27] rounded-2xl px-4 py-3.5 flex items-center gap-3 text-left transition-all cursor-pointer"
            >
              <Lock className="w-5 h-5 text-[#475569] dark:text-[#94A3B8] shrink-0" />
              <div>
                <p className="font-display font-semibold text-sm text-[#0F172A] dark:text-white">
                  Password and security
                </p>
                <p className="text-xs text-[#64748B] dark:text-[#94A3B8]">
                  Change password, 2FA, passkeys, active logins, and alerts
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => onOpenSettingsSection('privacy')}
              className="w-full bg-white dark:bg-[#16191F] border border-[#E5E8EE] dark:border-[#252A34] shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:border-[#CBD5E1] dark:hover:border-[#374151] hover:bg-[#F8FAFC] dark:hover:bg-[#1B1F27] rounded-2xl px-4 py-3.5 flex items-center gap-3 text-left transition-all cursor-pointer"
            >
              <ShieldCheck className="w-5 h-5 text-[#1877F2] dark:text-[#60A5FA] shrink-0" />
              <div>
                <p className="font-display font-semibold text-sm text-[#0F172A] dark:text-white">
                  Privacy Checkup
                </p>
                <p className="text-xs text-[#64748B] dark:text-[#94A3B8]">
                  Control who sees your profile, posts, and active status
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={onToggleTheme}
              className="w-full bg-white dark:bg-[#16191F] border border-[#E5E8EE] dark:border-[#252A34] shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:border-[#CBD5E1] dark:hover:border-[#374151] hover:bg-[#F8FAFC] dark:hover:bg-[#1B1F27] rounded-2xl px-4 py-3.5 flex items-center justify-between gap-3 text-left transition-all cursor-pointer"
            >
              <div className="flex items-center gap-3">
                {theme === 'dark' ? (
                  <Sun className="w-5 h-5 text-[#F59E0B] shrink-0" />
                ) : (
                  <Moon className="w-5 h-5 text-[#475569] shrink-0" />
                )}
                <div>
                  <p className="font-display font-semibold text-sm text-[#0F172A] dark:text-white">
                    Dark Mode
                  </p>
                  <p className="text-xs text-[#64748B] dark:text-[#94A3B8]">
                    Currently {theme === 'dark' ? 'On' : 'Off'} — tap to switch
                  </p>
                </div>
              </div>
              <span className="text-xs font-semibold text-[#1877F2] dark:text-[#60A5FA]">
                {theme === 'dark' ? 'Switch to Light' : 'Switch to Dark'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => onNavigate('activity')}
              className="w-full bg-white dark:bg-[#16191F] border border-[#E5E8EE] dark:border-[#252A34] shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:border-[#CBD5E1] dark:hover:border-[#374151] hover:bg-[#F8FAFC] dark:hover:bg-[#1B1F27] rounded-2xl px-4 py-3.5 flex items-center gap-3 text-left transition-all cursor-pointer"
            >
              <Clock className="w-5 h-5 text-[#475569] dark:text-[#94A3B8] shrink-0" />
              <div>
                <p className="font-display font-semibold text-sm text-[#0F172A] dark:text-white">
                  Activity Log
                </p>
                <p className="text-xs text-[#64748B] dark:text-[#94A3B8]">
                  Review your recent posts, likes, and comments
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => onOpenSettingsSection('appearance')}
              className="w-full bg-white dark:bg-[#16191F] border border-[#E5E8EE] dark:border-[#252A34] shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:border-[#CBD5E1] dark:hover:border-[#374151] hover:bg-[#F8FAFC] dark:hover:bg-[#1B1F27] rounded-2xl px-4 py-3.5 flex items-center gap-3 text-left transition-all cursor-pointer"
            >
              <Globe className="w-5 h-5 text-[#475569] dark:text-[#94A3B8] shrink-0" />
              <div>
                <p className="font-display font-semibold text-sm text-[#0F172A] dark:text-white">
                  Language &amp; Display
                </p>
                <p className="text-xs text-[#64748B] dark:text-[#94A3B8]">
                  Choose preferred language and display settings
                </p>
              </div>
            </button>
          </div>
        )}
      </div>

      {/* Log Out Button */}
      <button
        type="button"
        onClick={onLogout}
        className="w-full h-11 rounded-2xl bg-[#E5E8EE] hover:bg-[#DCE1EA] dark:bg-[#232732] dark:hover:bg-[#2D3342] text-[#0F172A] dark:text-white font-display font-semibold text-sm flex items-center justify-center gap-2 active:scale-[0.99] transition-all cursor-pointer"
      >
        <LogOut className="w-4 h-4" />
        <span>Log out</span>
      </button>
    </div>
  );
}
