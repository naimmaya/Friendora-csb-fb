import {useCallback, useEffect, useState} from 'react';
import type {FormEvent} from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Bell,
  Check,
  CheckCircle2,
  ChevronRight,
  Copy,
  Fingerprint,
  Globe,
  KeyRound,
  Laptop,
  Loader2,
  Lock,
  Mail,
  Moon,
  Plus,
  RefreshCw,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Sun,
  Trash2,
  UserCheck,
  UserRound,
} from 'lucide-react';
import {apiRequest} from '../lib/api';
import type {
  ActiveSessionItem,
  LinkedAccountItem,
  PasskeyItem,
  SecurityEmailItem,
  SettingsSection,
  UserProfile,
  UserSecurityConfig,
  UserSettings,
} from '../types';
import {Avatar} from './MediaImage';

interface SettingsViewProps {
  currentUser: UserProfile;
  initialSection: SettingsSection;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onBackToMenu: () => void;
  onOpenProfile: () => void;
  onOpenPages: () => void;
  onUserUpdated: (user: UserProfile) => void;
}

type PersonalSubView = 'main' | 'contact' | 'dob' | 'ownership' | 'add-account' | 'manage-linked';
type SecuritySubView =
  | 'main'
  | 'change-password'
  | 'two-factor'
  | 'saved-login'
  | 'passkeys'
  | 'advanced-protection'
  | 'where-logged-in'
  | 'recent-emails'
  | 'security-alerts';

interface ManagedPageAvatar {
  name: string;
  avatar_url: string;
}

function formatDateOfBirth(isoDate?: string): string {
  if (!isoDate || !isoDate.trim()) return 'Not set';
  const parts = isoDate.trim().split('-');
  if (parts.length !== 3) return isoDate;
  const year = Number(parts[0]);
  const month = Number(parts[1]) - 1;
  const day = Number(parts[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return isoDate;
  const d = new Date(year, month, day);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString('en-GB', {day: 'numeric', month: 'long', year: 'numeric'});
}

function formatDateTime(iso: string): string {
  const normalized = iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z';
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function PlatformBadge({platform}: {platform: string}) {
  const key = platform.toLowerCase();
  if (key.includes('instagram')) {
    return (
      <span
        aria-hidden="true"
        className="w-5 h-5 rounded-full bg-gradient-to-tr from-[#F59E0B] via-[#EC4899] to-[#8B5CF6] text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-white dark:ring-[#1C1E21]"
      >
        IG
      </span>
    );
  }
  if (key.includes('threads')) {
    return (
      <span
        aria-hidden="true"
        className="w-5 h-5 rounded-full bg-[#111827] dark:bg-white text-white dark:text-[#111827] text-[10px] font-bold flex items-center justify-center ring-2 ring-white dark:ring-[#1C1E21]"
      >
        @
      </span>
    );
  }
  if (key.includes('messenger')) {
    return (
      <span
        aria-hidden="true"
        className="w-5 h-5 rounded-full bg-[#0084FF] text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-white dark:ring-[#1C1E21]"
      >
        M
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className="w-5 h-5 rounded-full bg-[#1877F2] text-white text-[10px] font-extrabold flex items-center justify-center ring-2 ring-white dark:ring-[#1C1E21]"
    >
      V
    </span>
  );
}

function ToggleSwitch({
  checked,
  disabled,
  onChange,
  label,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors cursor-pointer disabled:opacity-50 ${
        checked ? 'bg-[#1877F2]' : 'bg-[#D1D5DB] dark:bg-[#374151]'
      }`}
    >
      <span
        className={`inline-block h-4.5 w-4.5 transform rounded-full bg-white transition-transform ${
          checked ? 'translate-x-5.5' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

export function SettingsView({
  currentUser,
  initialSection,
  theme,
  onToggleTheme,
  onBackToMenu,
  onOpenProfile,
  onOpenPages,
  onUserUpdated,
}: SettingsViewProps) {
  const [section, setSection] = useState<SettingsSection>(initialSection);
  const [personalSub, setPersonalSub] = useState<PersonalSubView>('main');
  const [securitySub, setSecuritySub] = useState<SecuritySubView>('main');
  const [selectedLinked, setSelectedLinked] = useState<LinkedAccountItem | null>(null);

  // Core settings (/api/settings)
  const [settings, setSettings] = useState<UserSettings>({
    profile_visibility: 'public',
    friend_request_policy: 'everyone',
    show_online_status: true,
    email_notifications: true,
    push_notifications: true,
    language: 'English',
  });

  // Accounts Centre & Security state
  const [linkedAccounts, setLinkedAccounts] = useState<LinkedAccountItem[]>([]);
  const [managedPagesCount, setManagedPagesCount] = useState(0);
  const [managedPagesAvatars, setManagedPagesAvatars] = useState<ManagedPageAvatar[]>([]);
  const [security, setSecurity] = useState<UserSecurityConfig>({
    two_factor_enabled: false,
    two_factor_method: 'authenticator',
    two_factor_secret: '',
    backup_codes: [],
    saved_login_enabled: true,
    advanced_protection: false,
    login_alerts_inapp: true,
    login_alerts_email: true,
    e2ee_key_alerts: true,
    e2ee_fingerprint: '',
    account_status: 'active',
  });
  const [passkeys, setPasskeys] = useState<PasskeyItem[]>([]);
  const [sessions, setSessions] = useState<ActiveSessionItem[]>([]);
  const [emails, setEmails] = useState<SecurityEmailItem[]>([]);

  // Form states
  const [contactEmail, setContactEmail] = useState(currentUser.email || '');
  const [contactPhone, setContactPhone] = useState(currentUser.phone || '');
  const [dobInput, setDobInput] = useState(currentUser.date_of_birth || '');
  const [newLinkedHandle, setNewLinkedHandle] = useState('');
  const [newLinkedPlatform, setNewLinkedPlatform] = useState('Instagram');

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [newPasskeyLabel, setNewPasskeyLabel] = useState('');
  const [emailTab, setEmailTab] = useState<'security' | 'other'>('security');
  const [copiedSecret, setCopiedSecret] = useState(false);

  // UI feedback states
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    setSection(initialSection);
    setPersonalSub('main');
    setSecuritySub('main');
    setSaveMessage(null);
    setErrorMessage(null);
  }, [initialSection]);

  useEffect(() => {
    setContactEmail(currentUser.email || '');
    setContactPhone(currentUser.phone || '');
    setDobInput(currentUser.date_of_birth || '');
  }, [currentUser.email, currentUser.phone, currentUser.date_of_birth]);

  const loadAllData = useCallback(async () => {
    setLoading(true);
    try {
      const [settingsRes, acRes, secRes] = await Promise.all([
        apiRequest<{settings: UserSettings}>('/api/settings'),
        apiRequest<{
          user: UserProfile;
          linked_accounts: LinkedAccountItem[];
          managed_pages_count: number;
          managed_pages_avatars?: ManagedPageAvatar[];
          security: UserSecurityConfig;
        }>('/api/accounts-centre'),
        apiRequest<{
          security: UserSecurityConfig;
          passkeys: PasskeyItem[];
          sessions: ActiveSessionItem[];
          emails: SecurityEmailItem[];
        }>('/api/security'),
      ]);
      setSettings(settingsRes.settings);
      setLinkedAccounts(acRes.linked_accounts);
      setManagedPagesCount(acRes.managed_pages_count);
      setManagedPagesAvatars(acRes.managed_pages_avatars || []);
      setSecurity(secRes.security);
      setPasskeys(secRes.passkeys);
      setSessions(secRes.sessions);
      setEmails(secRes.emails);
      if (acRes.user) {
        setContactEmail(acRes.user.email || '');
        setContactPhone(acRes.user.phone || '');
        setDobInput(acRes.user.date_of_birth || '');
      }
    } catch {
      // Allow partial fallback gracefully
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAllData();
  }, [loadAllData]);

  async function refreshSecurityBundle() {
    try {
      const secRes = await apiRequest<{
        security: UserSecurityConfig;
        passkeys: PasskeyItem[];
        sessions: ActiveSessionItem[];
        emails: SecurityEmailItem[];
      }>('/api/security');
      setSecurity(secRes.security);
      setPasskeys(secRes.passkeys);
      setSessions(secRes.sessions);
      setEmails(secRes.emails);
    } catch {
      // Ignore
    }
  }

  function clearFeedback() {
    setSaveMessage(null);
    setErrorMessage(null);
  }

  function handleNavigateSection(next: SettingsSection) {
    clearFeedback();
    setPersonalSub('main');
    setSecuritySub('main');
    setSection(next);
  }

  function handleBack() {
    clearFeedback();
    if (section === 'personal-details' && personalSub !== 'main') {
      setPersonalSub('main');
      setSelectedLinked(null);
      return;
    }
    if (section === 'password-security' && securitySub !== 'main') {
      setSecuritySub('main');
      return;
    }
    if (section !== 'overview') {
      setSection('overview');
      return;
    }
    onBackToMenu();
  }

  // ---- MUTATION HANDLERS ----

  async function handleSaveSettings(nextSettings: UserSettings) {
    setBusy(true);
    clearFeedback();
    try {
      const data = await apiRequest<{settings: UserSettings; message: string}>('/api/settings', {
        method: 'PUT',
        body: JSON.stringify(nextSettings),
      });
      setSettings(data.settings);
      setSaveMessage(data.message || 'Settings saved successfully.');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Unable to save settings.');
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveContact(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    clearFeedback();
    try {
      const data = await apiRequest<{user: UserProfile; message: string}>(
        '/api/personal-details/contact',
        {
          method: 'PUT',
          body: JSON.stringify({email: contactEmail, phone: contactPhone}),
        },
      );
      onUserUpdated(data.user);
      setSaveMessage(data.message);
      await refreshSecurityBundle();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Could not update contact info.');
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveDob(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    clearFeedback();
    try {
      const data = await apiRequest<{user: UserProfile; message: string}>(
        '/api/personal-details/dob',
        {
          method: 'PUT',
          body: JSON.stringify({date_of_birth: dobInput}),
        },
      );
      onUserUpdated(data.user);
      setSaveMessage(data.message);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Could not update date of birth.');
    } finally {
      setBusy(false);
    }
  }

  async function handleAddLinkedAccount(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    clearFeedback();
    try {
      const data = await apiRequest<{account: LinkedAccountItem; message: string}>(
        '/api/accounts-centre/linked',
        {
          method: 'POST',
          body: JSON.stringify({handle: newLinkedHandle, platform: newLinkedPlatform}),
        },
      );
      setLinkedAccounts((prev) => [data.account, ...prev]);
      setNewLinkedHandle('');
      setSaveMessage(data.message);
      setPersonalSub('main');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Could not add account.');
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleLinkedStatus(acc: LinkedAccountItem) {
    setBusy(true);
    clearFeedback();
    const nextStatus = acc.status === 'Active' ? 'Deactivated' : 'Active';
    try {
      await apiRequest(`/api/accounts-centre/linked/${acc.id}`, {
        method: 'PATCH',
        body: JSON.stringify({status: nextStatus}),
      });
      setLinkedAccounts((prev) =>
        prev.map((item) => (item.id === acc.id ? {...item, status: nextStatus} : item)),
      );
      setSelectedLinked((prev) => (prev && prev.id === acc.id ? {...prev, status: nextStatus} : prev));
      setSaveMessage(
        `${acc.handle} is now ${nextStatus === 'Active' ? 'active' : 'deactivated'}.`,
      );
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Could not update linked account.');
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveLinkedAccount(acc: LinkedAccountItem) {
    setBusy(true);
    clearFeedback();
    try {
      await apiRequest(`/api/accounts-centre/linked/${acc.id}`, {method: 'DELETE'});
      setLinkedAccounts((prev) => prev.filter((item) => item.id !== acc.id));
      setSelectedLinked(null);
      setPersonalSub('main');
      setSaveMessage(`${acc.handle} removed from Accounts Centre.`);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Could not remove linked account.');
    } finally {
      setBusy(false);
    }
  }

  async function handleUpdateSecurity(patch: Partial<UserSecurityConfig>, customMsg?: string) {
    setBusy(true);
    clearFeedback();
    try {
      const data = await apiRequest<{security: UserSecurityConfig; message: string}>(
        '/api/security',
        {
          method: 'PUT',
          body: JSON.stringify(patch),
        },
      );
      setSecurity(data.security);
      setSaveMessage(customMsg || data.message);
      await refreshSecurityBundle();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Could not save security settings.');
    } finally {
      setBusy(false);
    }
  }

  async function handlePasswordSubmit(e: FormEvent) {
    e.preventDefault();
    clearFeedback();
    if (newPassword.length < 6) {
      setErrorMessage('New password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setErrorMessage('New passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      const data = await apiRequest<{message: string}>('/api/settings/change-password', {
        method: 'POST',
        body: JSON.stringify({currentPassword, newPassword}),
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
      setSaveMessage(data.message);
      await refreshSecurityBundle();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Could not update password.');
    } finally {
      setBusy(false);
    }
  }

  async function handleRegenerateCodes() {
    setBusy(true);
    clearFeedback();
    try {
      const data = await apiRequest<{backup_codes: string[]; message: string}>(
        '/api/security/regenerate-codes',
        {method: 'POST'},
      );
      setSecurity((prev) => ({...prev, backup_codes: data.backup_codes}));
      setSaveMessage(data.message);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Could not regenerate recovery codes.');
    } finally {
      setBusy(false);
    }
  }

  async function handleCreatePasskey(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    clearFeedback();
    try {
      const data = await apiRequest<{passkey: PasskeyItem; message: string}>(
        '/api/security/passkeys',
        {
          method: 'POST',
          body: JSON.stringify({label: newPasskeyLabel.trim() || undefined}),
        },
      );
      setPasskeys((prev) => [data.passkey, ...prev]);
      setNewPasskeyLabel('');
      setSaveMessage(data.message);
      await refreshSecurityBundle();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Could not create passkey.');
    } finally {
      setBusy(false);
    }
  }

  async function handleDeletePasskey(pk: PasskeyItem) {
    setBusy(true);
    clearFeedback();
    try {
      await apiRequest(`/api/security/passkeys/${pk.id}`, {method: 'DELETE'});
      setPasskeys((prev) => prev.filter((item) => item.id !== pk.id));
      setSaveMessage(`Passkey "${pk.label}" removed.`);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Could not delete passkey.');
    } finally {
      setBusy(false);
    }
  }

  async function handleRevokeSession(session: ActiveSessionItem) {
    setBusy(true);
    clearFeedback();
    try {
      const data = await apiRequest<{message: string}>(`/api/security/sessions/${session.id}`, {
        method: 'DELETE',
      });
      setSessions((prev) => prev.filter((s) => s.id !== session.id));
      setSaveMessage(data.message);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Could not log out device.');
    } finally {
      setBusy(false);
    }
  }

  async function handleRevokeAllOtherSessions() {
    setBusy(true);
    clearFeedback();
    try {
      const data = await apiRequest<{message: string}>('/api/security/sessions/revoke-others', {
        method: 'POST',
      });
      setSessions((prev) => prev.filter((s) => s.is_current));
      setSaveMessage(data.message);
      await refreshSecurityBundle();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Could not sign out other devices.');
    } finally {
      setBusy(false);
    }
  }

  function handleCopySecret() {
    if (!security.two_factor_secret) return;
    navigator.clipboard?.writeText(security.two_factor_secret).then(() => {
      setCopiedSecret(true);
      setTimeout(() => setCopiedSecret(false), 2000);
    });
  }

  const contactSummary =
    [currentUser.email, currentUser.phone].filter(Boolean).join(', ') || 'Add email or phone';
  const filteredEmails = emails.filter((em) => em.category === emailTab);
  const otherSessionsCount = sessions.filter((s) => !s.is_current).length;

  return (
    <div className="space-y-4 pb-6">
      {/* Top Bar with crisp Back Arrow matching attached screenshots */}
      <div className="flex items-center justify-between gap-2 px-1">
        <button
          type="button"
          onClick={handleBack}
          aria-label="Go back"
          className="w-10 h-10 rounded-full flex items-center justify-center text-[#111827] dark:text-white hover:bg-[#E4E6EB] dark:hover:bg-[#2A2D32] transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>

        {section !== 'overview' && (
          <button
            type="button"
            onClick={() => handleNavigateSection('overview')}
            className="text-xs font-semibold text-[#1877F2] dark:text-[#60A5FA] hover:underline px-2 py-1 cursor-pointer"
          >
            All Settings
          </button>
        )}
      </div>

      {/* Confirmation & Error Banners */}
      {saveMessage && (
        <div
          role="status"
          className="p-3.5 rounded-2xl bg-[#ECFDF5] dark:bg-[#0F2E22] border border-[#A7F3D0] dark:border-[#166534] text-[#065F46] dark:text-[#A7F3D0] text-sm font-medium flex items-center gap-2.5"
        >
          <CheckCircle2 className="w-4 h-4 shrink-0 text-[#16A34A] dark:text-[#4ADE80]" />
          <span>{saveMessage}</span>
        </div>
      )}

      {errorMessage && (
        <div
          role="alert"
          className="p-3.5 rounded-2xl bg-[#FEF2F2] dark:bg-[#3B181A] border border-[#FECACA] dark:border-[#7F1D1D] text-[#B91C1C] dark:text-[#FCA5A5] text-sm flex items-center gap-2.5"
        >
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {loading ? (
        <div className="bg-white dark:bg-[#1C1E21] border border-[#E4E6EB] dark:border-[#2E3035] rounded-2xl p-8 text-center text-sm text-[#65676B] dark:text-[#9CA3AF]">
          Loading Accounts Centre...
        </div>
      ) : (
        <>
          {/* ===================================================== */}
          {/* VIEW 0: SETTINGS OVERVIEW (ACCOUNTS CENTRE + PRIVACY) */}
          {/* ===================================================== */}
          {section === 'overview' && (
            <div className="space-y-5">
              <div className="px-1">
                <h1 className="text-2xl font-display font-bold tracking-tight text-[#111827] dark:text-white">
                  Settings &amp; privacy
                </h1>
              </div>

              {/* Accounts Centre Hero Card (Facebook style) */}
              <div className="bg-white dark:bg-[#1C1E21] border border-[#E4E6EB] dark:border-[#2E3035] rounded-2xl overflow-hidden">
                <div className="p-5 pb-3 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-[#1877F2] text-white text-xs font-extrabold flex items-center justify-center">
                      V
                    </span>
                    <span className="text-sm font-display font-bold text-[#111827] dark:text-white">
                      Accounts Centre
                    </span>
                  </div>
                  <p className="text-xs text-[#65676B] dark:text-[#9CA3AF] leading-relaxed">
                    Manage your connected profiles, personal details, password, two-factor
                    authentication, and login security across Verve.
                  </p>
                </div>

                <div className="divide-y divide-[#E4E6EB] dark:divide-[#2E3035] border-t border-[#E4E6EB] dark:border-[#2E3035]">
                  <button
                    type="button"
                    onClick={() => handleNavigateSection('personal-details')}
                    className="w-full px-5 py-4 flex items-center justify-between gap-3 hover:bg-[#F8F9FA] dark:hover:bg-[#24262B] transition-colors text-left cursor-pointer"
                  >
                    <div className="flex items-center gap-3.5 min-w-0">
                      <UserRound className="w-5 h-5 text-[#4B5563] dark:text-[#9CA3AF] shrink-0" />
                      <div className="min-w-0">
                        <p className="text-[15px] font-semibold text-[#111827] dark:text-white">
                          Personal details
                        </p>
                        <p className="text-xs text-[#65676B] dark:text-[#9CA3AF] truncate">
                          Profiles, Pages, contact info, date of birth
                        </p>
                      </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-[#65676B] dark:text-[#9CA3AF] shrink-0" />
                  </button>

                  <button
                    type="button"
                    onClick={() => handleNavigateSection('password-security')}
                    className="w-full px-5 py-4 flex items-center justify-between gap-3 hover:bg-[#F8F9FA] dark:hover:bg-[#24262B] transition-colors text-left cursor-pointer"
                  >
                    <div className="flex items-center gap-3.5 min-w-0">
                      <ShieldCheck className="w-5 h-5 text-[#4B5563] dark:text-[#9CA3AF] shrink-0" />
                      <div className="min-w-0">
                        <p className="text-[15px] font-semibold text-[#111827] dark:text-white">
                          Password and security
                        </p>
                        <p className="text-xs text-[#65676B] dark:text-[#9CA3AF] truncate">
                          Password, 2FA, passkeys, active logins, alerts
                        </p>
                      </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-[#65676B] dark:text-[#9CA3AF] shrink-0" />
                  </button>
                </div>
              </div>

              {/* Preferences Section */}
              <div className="space-y-2">
                <div className="px-1">
                  <h2 className="text-base font-display font-bold text-[#111827] dark:text-white">
                    Preferences
                  </h2>
                  <p className="text-xs text-[#65676B] dark:text-[#9CA3AF]">
                    Customize privacy rules, notifications, and display mode.
                  </p>
                </div>

                <div className="bg-white dark:bg-[#1C1E21] border border-[#E4E6EB] dark:border-[#2E3035] rounded-2xl divide-y divide-[#E4E6EB] dark:divide-[#2E3035] overflow-hidden">
                  <button
                    type="button"
                    onClick={() => handleNavigateSection('privacy')}
                    className="w-full px-5 py-3.5 flex items-center justify-between gap-3 hover:bg-[#F8F9FA] dark:hover:bg-[#24262B] transition-colors text-left cursor-pointer"
                  >
                    <div className="flex items-center gap-3.5">
                      <Shield className="w-5 h-5 text-[#4B5563] dark:text-[#9CA3AF]" />
                      <div>
                        <p className="text-[15px] font-medium text-[#111827] dark:text-white">
                          Privacy Checkup
                        </p>
                        <p className="text-xs text-[#65676B] dark:text-[#9CA3AF]">
                          Profile visibility, friend requests, active status
                        </p>
                      </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-[#65676B] dark:text-[#9CA3AF]" />
                  </button>

                  <button
                    type="button"
                    onClick={() => handleNavigateSection('notifications')}
                    className="w-full px-5 py-3.5 flex items-center justify-between gap-3 hover:bg-[#F8F9FA] dark:hover:bg-[#24262B] transition-colors text-left cursor-pointer"
                  >
                    <div className="flex items-center gap-3.5">
                      <Bell className="w-5 h-5 text-[#4B5563] dark:text-[#9CA3AF]" />
                      <div>
                        <p className="text-[15px] font-medium text-[#111827] dark:text-white">
                          Notifications
                        </p>
                        <p className="text-xs text-[#65676B] dark:text-[#9CA3AF]">
                          In-app alerts and email summaries
                        </p>
                      </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-[#65676B] dark:text-[#9CA3AF]" />
                  </button>

                  <button
                    type="button"
                    onClick={() => handleNavigateSection('appearance')}
                    className="w-full px-5 py-3.5 flex items-center justify-between gap-3 hover:bg-[#F8F9FA] dark:hover:bg-[#24262B] transition-colors text-left cursor-pointer"
                  >
                    <div className="flex items-center gap-3.5">
                      <Globe className="w-5 h-5 text-[#4B5563] dark:text-[#9CA3AF]" />
                      <div>
                        <p className="text-[15px] font-medium text-[#111827] dark:text-white">
                          Language &amp; Display
                        </p>
                        <p className="text-xs text-[#65676B] dark:text-[#9CA3AF]">
                          {settings.language} · {theme === 'dark' ? 'Dark Mode' : 'Light Mode'}
                        </p>
                      </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-[#65676B] dark:text-[#9CA3AF]" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ===================================================== */}
          {/* VIEW 1: PERSONAL DETAILS (MATCHES SCREENSHOT 1)       */}
          {/* ===================================================== */}
          {section === 'personal-details' && personalSub === 'main' && (
            <div className="space-y-6">
              {/* SECTION A: PROFILES */}
              <section className="space-y-2.5">
                <h2 className="px-1 text-lg font-display font-bold text-[#111827] dark:text-white">
                  Profiles
                </h2>
                <div className="bg-white dark:bg-[#1C1E21] border border-[#E4E6EB] dark:border-[#2E3035] rounded-2xl divide-y divide-[#E4E6EB] dark:divide-[#2E3035] overflow-hidden">
                  {/* Primary Profile Row */}
                  <button
                    type="button"
                    onClick={onOpenProfile}
                    className="w-full px-4 py-3.5 flex items-center justify-between gap-3 hover:bg-[#F8F9FA] dark:hover:bg-[#24262B] transition-colors text-left cursor-pointer"
                  >
                    <div className="flex items-center gap-3.5 min-w-0">
                      <div className="relative shrink-0">
                        <Avatar src={currentUser.avatar_url} name={currentUser.name} size="md" />
                        <span className="absolute -bottom-0.5 -right-0.5">
                          <PlatformBadge platform="Verve" />
                        </span>
                      </div>
                      <div className="min-w-0">
                        <p className="text-[15px] font-medium text-[#111827] dark:text-white truncate">
                          {currentUser.name}
                        </p>
                        <p className="text-sm text-[#65676B] dark:text-[#9CA3AF]">Verve</p>
                        {security.account_status === 'deactivated' && (
                          <p className="text-xs text-[#65676B] dark:text-[#9CA3AF]">Deactivated</p>
                        )}
                      </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-[#65676B] dark:text-[#9CA3AF] shrink-0" />
                  </button>

                  {/* Connected / Linked Accounts */}
                  {linkedAccounts.map((acc) => (
                    <button
                      key={acc.id}
                      type="button"
                      onClick={() => {
                        clearFeedback();
                        setSelectedLinked(acc);
                        setPersonalSub('manage-linked');
                      }}
                      className="w-full px-4 py-3.5 flex items-center justify-between gap-3 hover:bg-[#F8F9FA] dark:hover:bg-[#24262B] transition-colors text-left cursor-pointer"
                    >
                      <div className="flex items-center gap-3.5 min-w-0">
                        <div className="relative shrink-0">
                          <Avatar src={acc.avatar_url} name={acc.handle} size="md" />
                          <span className="absolute -bottom-0.5 -right-0.5">
                            <PlatformBadge platform={acc.platform} />
                          </span>
                        </div>
                        <div className="min-w-0">
                          <p className="text-[15px] font-medium text-[#111827] dark:text-white truncate">
                            {acc.handle}
                          </p>
                          <p className="text-sm text-[#65676B] dark:text-[#9CA3AF]">
                            {acc.platform}
                          </p>
                          {acc.status === 'Deactivated' && (
                            <p className="text-xs text-[#65676B] dark:text-[#9CA3AF]">Deactivated</p>
                          )}
                        </div>
                      </div>
                      <ChevronRight className="w-5 h-5 text-[#65676B] dark:text-[#9CA3AF] shrink-0" />
                    </button>
                  ))}

                  {/* Blue "Add accounts" Row */}
                  <button
                    type="button"
                    onClick={() => {
                      clearFeedback();
                      setPersonalSub('add-account');
                    }}
                    className="w-full px-4 py-3.5 text-left text-[15px] font-medium text-[#1877F2] dark:text-[#60A5FA] hover:bg-[#F8F9FA] dark:hover:bg-[#24262B] transition-colors cursor-pointer"
                  >
                    Add accounts
                  </button>
                </div>
              </section>

              {/* SECTION B: PAGES YOU MANAGE */}
              <section className="space-y-2.5">
                <h2 className="px-1 text-lg font-display font-bold text-[#111827] dark:text-white">
                  Pages you manage
                </h2>
                <button
                  type="button"
                  onClick={onOpenPages}
                  className="w-full bg-white dark:bg-[#1C1E21] border border-[#E4E6EB] dark:border-[#2E3035] hover:border-[#CBD5E1] dark:hover:border-[#4B5563] rounded-2xl px-4 py-3.5 flex items-center justify-between gap-3 transition-colors text-left cursor-pointer"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="flex items-center -space-x-3 shrink-0">
                      {managedPagesAvatars.length > 0 ? (
                        managedPagesAvatars.map((pg, idx) => (
                          <div
                            key={idx}
                            className="rounded-full ring-2 ring-white dark:ring-[#1C1E21]"
                          >
                            <Avatar src={pg.avatar_url} name={pg.name} size="sm" />
                          </div>
                        ))
                      ) : (
                        <Avatar src={currentUser.avatar_url} name={currentUser.name} size="sm" />
                      )}
                    </div>
                    <span className="text-[15px] font-medium text-[#111827] dark:text-white">
                      See all Pages
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-[#65676B] dark:text-[#9CA3AF] tabular-nums shrink-0">
                    <span>{managedPagesCount}</span>
                    <ChevronRight className="w-5 h-5" />
                  </div>
                </button>
                <p className="px-1 text-xs text-[#65676B] dark:text-[#9CA3AF] leading-relaxed">
                  You can now see your Verve Pages in this Accounts Centre.{' '}
                  <button
                    type="button"
                    onClick={onOpenPages}
                    className="font-semibold text-[#1877F2] dark:text-[#60A5FA] hover:underline cursor-pointer"
                  >
                    Open Pages
                  </button>
                </p>
              </section>

              {/* SECTION C: PERSONAL DETAILS */}
              <section className="space-y-2.5">
                <h2 className="px-1 text-lg font-display font-bold text-[#111827] dark:text-white">
                  Personal details
                </h2>
                <div className="bg-white dark:bg-[#1C1E21] border border-[#E4E6EB] dark:border-[#2E3035] rounded-2xl divide-y divide-[#E4E6EB] dark:divide-[#2E3035] overflow-hidden">
                  {/* Contact info */}
                  <button
                    type="button"
                    onClick={() => {
                      clearFeedback();
                      setPersonalSub('contact');
                    }}
                    className="w-full px-4 py-3.5 flex items-center justify-between gap-3 hover:bg-[#F8F9FA] dark:hover:bg-[#24262B] transition-colors text-left cursor-pointer"
                  >
                    <div className="min-w-0">
                      <p className="text-[15px] font-medium text-[#111827] dark:text-white">
                        Contact info
                      </p>
                      <p className="text-sm text-[#65676B] dark:text-[#9CA3AF] truncate mt-0.5">
                        {contactSummary}
                      </p>
                    </div>
                    <ChevronRight className="w-5 h-5 text-[#65676B] dark:text-[#9CA3AF] shrink-0" />
                  </button>

                  {/* Date of birth */}
                  <button
                    type="button"
                    onClick={() => {
                      clearFeedback();
                      setPersonalSub('dob');
                    }}
                    className="w-full px-4 py-3.5 flex items-center justify-between gap-3 hover:bg-[#F8F9FA] dark:hover:bg-[#24262B] transition-colors text-left cursor-pointer"
                  >
                    <div className="min-w-0">
                      <p className="text-[15px] font-medium text-[#111827] dark:text-white">
                        Date of birth
                      </p>
                      <p className="text-sm text-[#65676B] dark:text-[#9CA3AF] mt-0.5">
                        {formatDateOfBirth(currentUser.date_of_birth)}
                      </p>
                    </div>
                    <ChevronRight className="w-5 h-5 text-[#65676B] dark:text-[#9CA3AF] shrink-0" />
                  </button>

                  {/* Account ownership and control */}
                  <button
                    type="button"
                    onClick={() => {
                      clearFeedback();
                      setPersonalSub('ownership');
                    }}
                    className="w-full px-4 py-3.5 flex items-center justify-between gap-3 hover:bg-[#F8F9FA] dark:hover:bg-[#24262B] transition-colors text-left cursor-pointer"
                  >
                    <div className="min-w-0">
                      <p className="text-[15px] font-medium text-[#111827] dark:text-white">
                        Account ownership and control
                      </p>
                      <p className="text-sm text-[#65676B] dark:text-[#9CA3AF] mt-0.5">
                        {security.account_status === 'deactivated'
                          ? 'Temporarily deactivated'
                          : 'Manage deactivation or account status'}
                      </p>
                    </div>
                    <ChevronRight className="w-5 h-5 text-[#65676B] dark:text-[#9CA3AF] shrink-0" />
                  </button>
                </div>
              </section>
            </div>
          )}

          {/* PERSONAL DETAILS SUB-VIEW: CONTACT INFO */}
          {section === 'personal-details' && personalSub === 'contact' && (
            <form
              onSubmit={handleSaveContact}
              className="bg-white dark:bg-[#1C1E21] border border-[#E4E6EB] dark:border-[#2E3035] rounded-2xl p-5 space-y-4"
            >
              <div>
                <h1 className="text-xl font-display font-bold text-[#111827] dark:text-white">
                  Contact info
                </h1>
                <p className="text-xs text-[#65676B] dark:text-[#9CA3AF] mt-1">
                  Manage your email addresses and mobile phone number used for sign-in and account
                  recovery.
                </p>
              </div>

              <div className="space-y-3">
                <div>
                  <label
                    htmlFor="ac-contact-email"
                    className="block text-xs font-medium text-[#374151] dark:text-[#D1D5DB] mb-1"
                  >
                    Email / Gmail Address
                  </label>
                  <input
                    id="ac-contact-email"
                    type="email"
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                    placeholder="name@gmail.com"
                    className="w-full h-11 px-3.5 rounded-xl bg-[#F8F9FA] dark:bg-[#121316] border border-[#D1D5DB] dark:border-[#374151] text-sm text-[#111827] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1877F2]"
                  />
                </div>

                <div>
                  <label
                    htmlFor="ac-contact-phone"
                    className="block text-xs font-medium text-[#374151] dark:text-[#D1D5DB] mb-1"
                  >
                    Phone Number
                  </label>
                  <input
                    id="ac-contact-phone"
                    type="tel"
                    value={contactPhone}
                    onChange={(e) => setContactPhone(e.target.value)}
                    placeholder="+1 555 010 4200"
                    className="w-full h-11 px-3.5 rounded-xl bg-[#F8F9FA] dark:bg-[#121316] border border-[#D1D5DB] dark:border-[#374151] text-sm text-[#111827] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1877F2]"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-[#E4E6EB] dark:border-[#2E3035]">
                <button
                  type="button"
                  onClick={() => setPersonalSub('main')}
                  className="px-4 h-10 rounded-xl bg-[#F0F2F5] dark:bg-[#2A2D32] text-sm font-semibold text-[#111827] dark:text-white cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="inline-flex items-center gap-2 px-5 h-10 rounded-xl bg-[#1877F2] hover:bg-[#166FE5] text-white text-sm font-semibold disabled:opacity-60 cursor-pointer"
                >
                  {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                  <span>{busy ? 'Saving...' : 'Save contact info'}</span>
                </button>
              </div>
            </form>
          )}

          {/* PERSONAL DETAILS SUB-VIEW: DATE OF BIRTH */}
          {section === 'personal-details' && personalSub === 'dob' && (
            <form
              onSubmit={handleSaveDob}
              className="bg-white dark:bg-[#1C1E21] border border-[#E4E6EB] dark:border-[#2E3035] rounded-2xl p-5 space-y-4"
            >
              <div>
                <h1 className="text-xl font-display font-bold text-[#111827] dark:text-white">
                  Date of birth
                </h1>
                <p className="text-xs text-[#65676B] dark:text-[#9CA3AF] mt-1">
                  Your birthday helps keep your account secure and powers Birthday reminders for
                  friends.
                </p>
              </div>

              <div>
                <label
                  htmlFor="ac-dob"
                  className="block text-xs font-medium text-[#374151] dark:text-[#D1D5DB] mb-1"
                >
                  Birthday
                </label>
                <input
                  id="ac-dob"
                  type="date"
                  required
                  value={dobInput}
                  onChange={(e) => setDobInput(e.target.value)}
                  className="w-full h-11 px-3.5 rounded-xl bg-[#F8F9FA] dark:bg-[#121316] border border-[#D1D5DB] dark:border-[#374151] text-sm text-[#111827] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1877F2]"
                />
                {dobInput && (
                  <p className="text-xs text-[#65676B] dark:text-[#9CA3AF] mt-1.5">
                    Displayed as: <strong className="text-[#111827] dark:text-white">{formatDateOfBirth(dobInput)}</strong>
                  </p>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-[#E4E6EB] dark:border-[#2E3035]">
                <button
                  type="button"
                  onClick={() => setPersonalSub('main')}
                  className="px-4 h-10 rounded-xl bg-[#F0F2F5] dark:bg-[#2A2D32] text-sm font-semibold text-[#111827] dark:text-white cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="inline-flex items-center gap-2 px-5 h-10 rounded-xl bg-[#1877F2] hover:bg-[#166FE5] text-white text-sm font-semibold disabled:opacity-60 cursor-pointer"
                >
                  {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                  <span>{busy ? 'Saving...' : 'Save birthday'}</span>
                </button>
              </div>
            </form>
          )}

          {/* PERSONAL DETAILS SUB-VIEW: ADD LINKED ACCOUNT */}
          {section === 'personal-details' && personalSub === 'add-account' && (
            <form
              onSubmit={handleAddLinkedAccount}
              className="bg-white dark:bg-[#1C1E21] border border-[#E4E6EB] dark:border-[#2E3035] rounded-2xl p-5 space-y-4"
            >
              <div>
                <h1 className="text-xl font-display font-bold text-[#111827] dark:text-white">
                  Add accounts
                </h1>
                <p className="text-xs text-[#65676B] dark:text-[#9CA3AF] mt-1">
                  Connect another profile to manage personal details and login preferences together.
                </p>
              </div>

              <div className="space-y-3">
                <div>
                  <label
                    htmlFor="linked-platform"
                    className="block text-xs font-medium text-[#374151] dark:text-[#D1D5DB] mb-1"
                  >
                    Platform
                  </label>
                  <select
                    id="linked-platform"
                    value={newLinkedPlatform}
                    onChange={(e) => setNewLinkedPlatform(e.target.value)}
                    className="w-full h-11 px-3.5 rounded-xl bg-[#F8F9FA] dark:bg-[#121316] border border-[#D1D5DB] dark:border-[#374151] text-sm text-[#111827] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1877F2]"
                  >
                    <option value="Instagram">Instagram</option>
                    <option value="Threads">Threads</option>
                    <option value="Verve">Verve</option>
                    <option value="Messenger">Messenger</option>
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="linked-handle"
                    className="block text-xs font-medium text-[#374151] dark:text-[#D1D5DB] mb-1"
                  >
                    Username or Profile Name
                  </label>
                  <input
                    id="linked-handle"
                    type="text"
                    required
                    minLength={2}
                    value={newLinkedHandle}
                    onChange={(e) => setNewLinkedHandle(e.target.value)}
                    placeholder="e.g. maya_studio"
                    className="w-full h-11 px-3.5 rounded-xl bg-[#F8F9FA] dark:bg-[#121316] border border-[#D1D5DB] dark:border-[#374151] text-sm text-[#111827] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1877F2]"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-[#E4E6EB] dark:border-[#2E3035]">
                <button
                  type="button"
                  onClick={() => setPersonalSub('main')}
                  className="px-4 h-10 rounded-xl bg-[#F0F2F5] dark:bg-[#2A2D32] text-sm font-semibold text-[#111827] dark:text-white cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="inline-flex items-center gap-2 px-5 h-10 rounded-xl bg-[#1877F2] hover:bg-[#166FE5] text-white text-sm font-semibold disabled:opacity-60 cursor-pointer"
                >
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  <span>{busy ? 'Adding...' : 'Add account'}</span>
                </button>
              </div>
            </form>
          )}

          {/* PERSONAL DETAILS SUB-VIEW: MANAGE LINKED ACCOUNT */}
          {section === 'personal-details' && personalSub === 'manage-linked' && selectedLinked && (
            <div className="bg-white dark:bg-[#1C1E21] border border-[#E4E6EB] dark:border-[#2E3035] rounded-2xl p-5 space-y-5">
              <div className="flex items-center gap-3.5">
                <div className="relative shrink-0">
                  <Avatar src={selectedLinked.avatar_url} name={selectedLinked.handle} size="lg" />
                  <span className="absolute -bottom-0.5 -right-0.5">
                    <PlatformBadge platform={selectedLinked.platform} />
                  </span>
                </div>
                <div className="min-w-0">
                  <h1 className="text-lg font-display font-bold text-[#111827] dark:text-white truncate">
                    {selectedLinked.handle}
                  </h1>
                  <p className="text-sm text-[#65676B] dark:text-[#9CA3AF]">
                    {selectedLinked.platform} · {selectedLinked.status}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2.5 pt-3 border-t border-[#E4E6EB] dark:border-[#2E3035]">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => handleToggleLinkedStatus(selectedLinked)}
                  className="px-4 h-10 rounded-xl bg-[#F0F2F5] dark:bg-[#2A2D32] hover:bg-[#E4E6EB] dark:hover:bg-[#35383E] text-sm font-semibold text-[#111827] dark:text-white cursor-pointer"
                >
                  {selectedLinked.status === 'Active' ? 'Deactivate profile' : 'Reactivate profile'}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => handleRemoveLinkedAccount(selectedLinked)}
                  className="inline-flex items-center gap-1.5 px-4 h-10 rounded-xl bg-[#FEF2F2] dark:bg-[#3B181A] text-sm font-semibold text-[#DC2626] dark:text-[#FCA5A5] cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>Remove from Accounts Centre</span>
                </button>
              </div>
            </div>
          )}

          {/* PERSONAL DETAILS SUB-VIEW: ACCOUNT OWNERSHIP & CONTROL */}
          {section === 'personal-details' && personalSub === 'ownership' && (
            <div className="bg-white dark:bg-[#1C1E21] border border-[#E4E6EB] dark:border-[#2E3035] rounded-2xl p-5 space-y-4">
              <div>
                <h1 className="text-xl font-display font-bold text-[#111827] dark:text-white">
                  Account ownership and control
                </h1>
                <p className="text-xs text-[#65676B] dark:text-[#9CA3AF] mt-1">
                  Control whether your profile is active or temporarily deactivated. Deactivating
                  hides your profile status until you reactivate it.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-[#F8F9FA] dark:bg-[#121316] border border-[#E4E6EB] dark:border-[#2E3035] flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-[#111827] dark:text-white">
                    Current Account Status:{' '}
                    {security.account_status === 'active' ? 'Active' : 'Temporarily Deactivated'}
                  </p>
                  <p className="text-xs text-[#65676B] dark:text-[#9CA3AF] mt-0.5">
                    {security.account_status === 'active'
                      ? 'Your profile and posts are visible according to your privacy rules.'
                      : 'Your account is marked as deactivated in Accounts Centre.'}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    handleUpdateSecurity(
                      {
                        account_status:
                          security.account_status === 'active' ? 'deactivated' : 'active',
                      },
                      security.account_status === 'active'
                        ? 'Account marked as temporarily deactivated.'
                        : 'Account reactivated successfully.',
                    )
                  }
                  className={`px-4 h-10 rounded-xl text-xs font-semibold whitespace-nowrap cursor-pointer ${
                    security.account_status === 'active'
                      ? 'bg-[#FEF2F2] dark:bg-[#3B181A] text-[#DC2626] dark:text-[#FCA5A5]'
                      : 'bg-[#1877F2] text-white'
                  }`}
                >
                  {security.account_status === 'active' ? 'Deactivate' : 'Reactivate'}
                </button>
              </div>
            </div>
          )}

          {/* ===================================================== */}
          {/* VIEW 2: PASSWORD AND SECURITY (MATCHES SCREENSHOT 2)  */}
          {/* ===================================================== */}
          {section === 'password-security' && securitySub === 'main' && (
            <div className="space-y-6">
              <h1 className="px-1 text-2xl font-display font-bold tracking-tight text-[#111827] dark:text-white">
                Password and security
              </h1>

              {/* SECTION 1: LOGIN & RECOVERY */}
              <section className="space-y-2.5">
                <div className="px-1 space-y-0.5">
                  <h2 className="text-base font-display font-bold text-[#111827] dark:text-white">
                    Login &amp; recovery
                  </h2>
                  <p className="text-sm text-[#65676B] dark:text-[#9CA3AF]">
                    Manage your passwords, login preferences and recovery methods.
                  </p>
                </div>

                <div className="bg-white dark:bg-[#1C1E21] border border-[#E4E6EB] dark:border-[#2E3035] rounded-2xl divide-y divide-[#E4E6EB] dark:divide-[#2E3035] overflow-hidden">
                  <button
                    type="button"
                    onClick={() => {
                      clearFeedback();
                      setSecuritySub('change-password');
                    }}
                    className="w-full px-4 py-4 flex items-center justify-between gap-3 hover:bg-[#F8F9FA] dark:hover:bg-[#24262B] transition-colors text-left cursor-pointer"
                  >
                    <span className="text-[15px] font-medium text-[#111827] dark:text-white">
                      Change password
                    </span>
                    <ChevronRight className="w-5 h-5 text-[#65676B] dark:text-[#9CA3AF]" />
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      clearFeedback();
                      setSecuritySub('two-factor');
                    }}
                    className="w-full px-4 py-4 flex items-center justify-between gap-3 hover:bg-[#F8F9FA] dark:hover:bg-[#24262B] transition-colors text-left cursor-pointer"
                  >
                    <span className="text-[15px] font-medium text-[#111827] dark:text-white">
                      Two-factor authentication
                    </span>
                    <div className="flex items-center gap-2 text-xs text-[#65676B] dark:text-[#9CA3AF]">
                      <span>{security.two_factor_enabled ? 'On' : 'Off'}</span>
                      <ChevronRight className="w-5 h-5" />
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      clearFeedback();
                      setSecuritySub('saved-login');
                    }}
                    className="w-full px-4 py-4 flex items-center justify-between gap-3 hover:bg-[#F8F9FA] dark:hover:bg-[#24262B] transition-colors text-left cursor-pointer"
                  >
                    <span className="text-[15px] font-medium text-[#111827] dark:text-white">
                      Saved login
                    </span>
                    <div className="flex items-center gap-2 text-xs text-[#65676B] dark:text-[#9CA3AF]">
                      <span>{security.saved_login_enabled ? 'On' : 'Off'}</span>
                      <ChevronRight className="w-5 h-5" />
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      clearFeedback();
                      setSecuritySub('passkeys');
                    }}
                    className="w-full px-4 py-4 flex items-center justify-between gap-3 hover:bg-[#F8F9FA] dark:hover:bg-[#24262B] transition-colors text-left cursor-pointer"
                  >
                    <span className="text-[15px] font-medium text-[#111827] dark:text-white">
                      Passkey
                    </span>
                    <div className="flex items-center gap-2 text-xs text-[#65676B] dark:text-[#9CA3AF] tabular-nums">
                      {passkeys.length > 0 && <span>{passkeys.length} saved</span>}
                      <ChevronRight className="w-5 h-5" />
                    </div>
                  </button>
                </div>
              </section>

              {/* SECTION 2: ADVANCED PROTECTION */}
              <section className="space-y-2.5">
                <div className="px-1 space-y-0.5">
                  <h2 className="text-base font-display font-bold text-[#111827] dark:text-white">
                    Advanced Protection
                  </h2>
                  <p className="text-sm text-[#65676B] dark:text-[#9CA3AF]">
                    This advanced security programme helps defend your account from unauthorised
                    access.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    clearFeedback();
                    setSecuritySub('advanced-protection');
                  }}
                  className="w-full bg-white dark:bg-[#1C1E21] border border-[#E4E6EB] dark:border-[#2E3035] hover:border-[#CBD5E1] dark:hover:border-[#4B5563] rounded-2xl px-4 py-4 flex items-center justify-between gap-3 transition-colors text-left cursor-pointer"
                >
                  <span className="text-[15px] font-medium text-[#111827] dark:text-white">
                    Advanced Protection
                  </span>
                  <div className="flex items-center gap-2 text-xs text-[#65676B] dark:text-[#9CA3AF]">
                    <span>{security.advanced_protection ? 'Active' : 'Off'}</span>
                    <ChevronRight className="w-5 h-5" />
                  </div>
                </button>
              </section>

              {/* SECTION 3: SECURITY CHECKS */}
              <section className="space-y-2.5">
                <div className="px-1 space-y-0.5">
                  <h2 className="text-base font-display font-bold text-[#111827] dark:text-white">
                    Security checks
                  </h2>
                  <p className="text-sm text-[#65676B] dark:text-[#9CA3AF]">
                    Review security issues by running checks across apps, devices and emails sent.
                  </p>
                </div>

                <div className="bg-white dark:bg-[#1C1E21] border border-[#E4E6EB] dark:border-[#2E3035] rounded-2xl divide-y divide-[#E4E6EB] dark:divide-[#2E3035] overflow-hidden">
                  <button
                    type="button"
                    onClick={() => {
                      clearFeedback();
                      refreshSecurityBundle();
                      setSecuritySub('where-logged-in');
                    }}
                    className="w-full px-4 py-4 flex items-center justify-between gap-3 hover:bg-[#F8F9FA] dark:hover:bg-[#24262B] transition-colors text-left cursor-pointer"
                  >
                    <span className="text-[15px] font-medium text-[#111827] dark:text-white">
                      Where you&apos;re logged in
                    </span>
                    <div className="flex items-center gap-2 text-xs text-[#65676B] dark:text-[#9CA3AF] tabular-nums">
                      <span>{sessions.length}</span>
                      <ChevronRight className="w-5 h-5" />
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      clearFeedback();
                      refreshSecurityBundle();
                      setSecuritySub('recent-emails');
                    }}
                    className="w-full px-4 py-4 flex items-center justify-between gap-3 hover:bg-[#F8F9FA] dark:hover:bg-[#24262B] transition-colors text-left cursor-pointer"
                  >
                    <span className="text-[15px] font-medium text-[#111827] dark:text-white">
                      Recent emails
                    </span>
                    <ChevronRight className="w-5 h-5 text-[#65676B] dark:text-[#9CA3AF]" />
                  </button>
                </div>
              </section>

              {/* SECTION 4: END-TO-END ENCRYPTED CHATS */}
              <section className="space-y-2.5">
                <div className="px-1 space-y-0.5">
                  <h2 className="text-base font-display font-bold text-[#111827] dark:text-white">
                    End-to-end encrypted chats
                  </h2>
                  <p className="text-sm text-[#65676B] dark:text-[#9CA3AF]">
                    Manage your end-to-end encrypted chat settings.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    clearFeedback();
                    setSecuritySub('security-alerts');
                  }}
                  className="w-full bg-white dark:bg-[#1C1E21] border border-[#E4E6EB] dark:border-[#2E3035] hover:border-[#CBD5E1] dark:hover:border-[#4B5563] rounded-2xl px-4 py-4 flex items-center justify-between gap-3 transition-colors text-left cursor-pointer"
                >
                  <span className="text-[15px] font-medium text-[#111827] dark:text-white">
                    Security alerts
                  </span>
                  <div className="flex items-center gap-2.5 shrink-0">
                    <span
                      aria-hidden="true"
                      className="w-6 h-6 rounded-full bg-[#65676B] dark:bg-[#9CA3AF] text-white dark:text-[#111827] text-xs font-extrabold flex items-center justify-center"
                    >
                      V
                    </span>
                    <ChevronRight className="w-5 h-5 text-[#65676B] dark:text-[#9CA3AF]" />
                  </div>
                </button>
              </section>
            </div>
          )}

          {/* PASSWORD & SECURITY SUB-VIEW 1: CHANGE PASSWORD */}
          {section === 'password-security' && securitySub === 'change-password' && (
            <form
              onSubmit={handlePasswordSubmit}
              className="bg-white dark:bg-[#1C1E21] border border-[#E4E6EB] dark:border-[#2E3035] rounded-2xl p-5 space-y-4"
            >
              <div className="flex items-center gap-2.5">
                <KeyRound className="w-5 h-5 text-[#1877F2] dark:text-[#60A5FA]" />
                <div>
                  <h1 className="text-lg font-display font-bold text-[#111827] dark:text-white">
                    Change password
                  </h1>
                  <p className="text-xs text-[#65676B] dark:text-[#9CA3AF]">
                    Your password must be at least 6 characters and kept unique to Verve.
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <label
                    htmlFor="sec-cur-pass"
                    className="block text-xs font-medium text-[#374151] dark:text-[#D1D5DB] mb-1"
                  >
                    Current password
                  </label>
                  <input
                    id="sec-cur-pass"
                    type="password"
                    required
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    className="w-full h-11 px-3.5 rounded-xl bg-[#F8F9FA] dark:bg-[#121316] border border-[#D1D5DB] dark:border-[#374151] text-sm text-[#111827] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1877F2]"
                  />
                </div>
                <div>
                  <label
                    htmlFor="sec-new-pass"
                    className="block text-xs font-medium text-[#374151] dark:text-[#D1D5DB] mb-1"
                  >
                    New password
                  </label>
                  <input
                    id="sec-new-pass"
                    type="password"
                    required
                    minLength={6}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full h-11 px-3.5 rounded-xl bg-[#F8F9FA] dark:bg-[#121316] border border-[#D1D5DB] dark:border-[#374151] text-sm text-[#111827] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1877F2]"
                  />
                </div>
                <div>
                  <label
                    htmlFor="sec-conf-pass"
                    className="block text-xs font-medium text-[#374151] dark:text-[#D1D5DB] mb-1"
                  >
                    Re-type new password
                  </label>
                  <input
                    id="sec-conf-pass"
                    type="password"
                    required
                    minLength={6}
                    value={confirmNewPassword}
                    onChange={(e) => setConfirmNewPassword(e.target.value)}
                    className="w-full h-11 px-3.5 rounded-xl bg-[#F8F9FA] dark:bg-[#121316] border border-[#D1D5DB] dark:border-[#374151] text-sm text-[#111827] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1877F2]"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-[#E4E6EB] dark:border-[#2E3035]">
                <button
                  type="button"
                  onClick={() => setSecuritySub('main')}
                  className="px-4 h-10 rounded-xl bg-[#F0F2F5] dark:bg-[#2A2D32] text-sm font-semibold text-[#111827] dark:text-white cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="inline-flex items-center gap-2 px-5 h-10 rounded-xl bg-[#1877F2] hover:bg-[#166FE5] text-white text-sm font-semibold disabled:opacity-60 cursor-pointer"
                >
                  {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                  <span>{busy ? 'Updating...' : 'Change password'}</span>
                </button>
              </div>
            </form>
          )}

          {/* PASSWORD & SECURITY SUB-VIEW 2: TWO-FACTOR AUTHENTICATION */}
          {section === 'password-security' && securitySub === 'two-factor' && (
            <div className="space-y-4">
              <div className="bg-white dark:bg-[#1C1E21] border border-[#E4E6EB] dark:border-[#2E3035] rounded-2xl p-5 space-y-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h1 className="text-lg font-display font-bold text-[#111827] dark:text-white">
                      Two-factor authentication
                    </h1>
                    <p className="text-xs text-[#65676B] dark:text-[#9CA3AF] mt-1">
                      Add an extra layer of security by requiring a verification code when signing
                      in from an unrecognised device.
                    </p>
                  </div>
                  <ToggleSwitch
                    checked={security.two_factor_enabled}
                    disabled={busy}
                    label="Toggle two-factor authentication"
                    onChange={(next) =>
                      handleUpdateSecurity(
                        {
                          two_factor_enabled: next,
                          advanced_protection: next ? security.advanced_protection : false,
                        },
                        next
                          ? 'Two-factor authentication turned on.'
                          : 'Two-factor authentication turned off.',
                      )
                    }
                  />
                </div>

                {/* Method Selector */}
                <div className="space-y-2 pt-3 border-t border-[#E4E6EB] dark:border-[#2E3035]">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[#65676B] dark:text-[#9CA3AF]">
                    Verification Method
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        handleUpdateSecurity(
                          {two_factor_method: 'authenticator', two_factor_enabled: true},
                          'Authenticator app selected for 2FA.',
                        )
                      }
                      className={`p-3.5 rounded-xl border text-left transition-colors cursor-pointer ${
                        security.two_factor_method === 'authenticator'
                          ? 'border-[#1877F2] bg-[#1877F2]/8'
                          : 'border-[#E4E6EB] dark:border-[#2E3035] hover:bg-[#F8F9FA] dark:hover:bg-[#24262B]'
                      }`}
                    >
                      <p className="text-sm font-semibold text-[#111827] dark:text-white">
                        Authenticator app
                      </p>
                      <p className="text-xs text-[#65676B] dark:text-[#9CA3AF] mt-0.5">
                        Use Google Authenticator or Authy
                      </p>
                    </button>

                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        handleUpdateSecurity(
                          {two_factor_method: 'sms', two_factor_enabled: true},
                          'SMS text message selected for 2FA.',
                        )
                      }
                      className={`p-3.5 rounded-xl border text-left transition-colors cursor-pointer ${
                        security.two_factor_method === 'sms'
                          ? 'border-[#1877F2] bg-[#1877F2]/8'
                          : 'border-[#E4E6EB] dark:border-[#2E3035] hover:bg-[#F8F9FA] dark:hover:bg-[#24262B]'
                      }`}
                    >
                      <p className="text-sm font-semibold text-[#111827] dark:text-white">
                        SMS text message
                      </p>
                      <p className="text-xs text-[#65676B] dark:text-[#9CA3AF] mt-0.5">
                        {currentUser.phone || 'Send code to your phone number'}
                      </p>
                    </button>
                  </div>
                </div>

                {/* Setup Secret Key */}
                <div className="space-y-2 pt-3 border-t border-[#E4E6EB] dark:border-[#2E3035]">
                  <p className="text-xs font-semibold text-[#374151] dark:text-[#D1D5DB]">
                    Authenticator Setup Key
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 px-3.5 py-2.5 rounded-xl bg-[#F0F2F5] dark:bg-[#121316] font-mono text-xs tracking-wider text-[#111827] dark:text-[#E5E7EB]">
                      {security.two_factor_secret || '—'}
                    </code>
                    <button
                      type="button"
                      onClick={handleCopySecret}
                      className="inline-flex items-center gap-1.5 px-3.5 h-10 rounded-xl bg-[#F0F2F5] dark:bg-[#2A2D32] hover:bg-[#E4E6EB] dark:hover:bg-[#35383E] text-xs font-semibold text-[#111827] dark:text-white cursor-pointer"
                    >
                      {copiedSecret ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedSecret ? 'Copied' : 'Copy'}</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Backup Recovery Codes */}
              <div className="bg-white dark:bg-[#1C1E21] border border-[#E4E6EB] dark:border-[#2E3035] rounded-2xl p-5 space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-display font-bold text-[#111827] dark:text-white">
                      Recovery backup codes
                    </h2>
                    <p className="text-xs text-[#65676B] dark:text-[#9CA3AF]">
                      Save these one-time codes in case you lose access to your device.
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleRegenerateCodes}
                    className="inline-flex items-center gap-1.5 px-3 h-9 rounded-xl bg-[#F0F2F5] dark:bg-[#2A2D32] hover:bg-[#E4E6EB] dark:hover:bg-[#35383E] text-xs font-semibold text-[#111827] dark:text-white whitespace-nowrap cursor-pointer"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
                    <span>Regenerate</span>
                  </button>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {security.backup_codes.map((code) => (
                    <div
                      key={code}
                      className="px-3 py-2 rounded-xl bg-[#F8F9FA] dark:bg-[#121316] border border-[#E4E6EB] dark:border-[#2E3035] font-mono text-xs text-center text-[#111827] dark:text-[#E5E7EB]"
                    >
                      {code}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* PASSWORD & SECURITY SUB-VIEW 3: SAVED LOGIN */}
          {section === 'password-security' && securitySub === 'saved-login' && (
            <div className="bg-white dark:bg-[#1C1E21] border border-[#E4E6EB] dark:border-[#2E3035] rounded-2xl p-5 space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h1 className="text-lg font-display font-bold text-[#111827] dark:text-white">
                    Saved login
                  </h1>
                  <p className="text-xs text-[#65676B] dark:text-[#9CA3AF] mt-1">
                    Remember your login details on this browser so you won&apos;t have to re-enter
                    your credentials every time you return.
                  </p>
                </div>
                <ToggleSwitch
                  checked={security.saved_login_enabled}
                  disabled={busy}
                  label="Toggle saved login"
                  onChange={(next) =>
                    handleUpdateSecurity(
                      {saved_login_enabled: next},
                      next ? 'Saved login enabled for your account.' : 'Saved login disabled.',
                    )
                  }
                />
              </div>
            </div>
          )}

          {/* PASSWORD & SECURITY SUB-VIEW 4: PASSKEY */}
          {section === 'password-security' && securitySub === 'passkeys' && (
            <div className="space-y-4">
              <form
                onSubmit={handleCreatePasskey}
                className="bg-white dark:bg-[#1C1E21] border border-[#E4E6EB] dark:border-[#2E3035] rounded-2xl p-5 space-y-4"
              >
                <div className="flex items-center gap-2.5">
                  <Fingerprint className="w-5 h-5 text-[#1877F2] dark:text-[#60A5FA]" />
                  <div>
                    <h1 className="text-lg font-display font-bold text-[#111827] dark:text-white">
                      Passkey
                    </h1>
                    <p className="text-xs text-[#65676B] dark:text-[#9CA3AF]">
                      Sign in securely using your device biometrics or screen lock instead of a
                      password.
                    </p>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={newPasskeyLabel}
                    onChange={(e) => setNewPasskeyLabel(e.target.value)}
                    placeholder="Device label (e.g. Pixel 9 Pro, MacBook Air)"
                    className="flex-1 h-11 px-3.5 rounded-xl bg-[#F8F9FA] dark:bg-[#121316] border border-[#D1D5DB] dark:border-[#374151] text-sm text-[#111827] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1877F2]"
                  />
                  <button
                    type="submit"
                    disabled={busy}
                    className="inline-flex items-center justify-center gap-1.5 px-5 h-11 rounded-xl bg-[#1877F2] hover:bg-[#166FE5] text-white text-sm font-semibold whitespace-nowrap disabled:opacity-60 cursor-pointer"
                  >
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    <span>Create passkey</span>
                  </button>
                </div>
              </form>

              <div className="bg-white dark:bg-[#1C1E21] border border-[#E4E6EB] dark:border-[#2E3035] rounded-2xl divide-y divide-[#E4E6EB] dark:divide-[#2E3035] overflow-hidden">
                {passkeys.length === 0 ? (
                  <p className="p-6 text-center text-sm text-[#65676B] dark:text-[#9CA3AF]">
                    No passkeys registered yet. Create your first passkey above.
                  </p>
                ) : (
                  passkeys.map((pk) => (
                    <div
                      key={pk.id}
                      className="px-4 py-3.5 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-[#111827] dark:text-white truncate">
                          {pk.label}
                        </p>
                        <p className="text-xs text-[#65676B] dark:text-[#9CA3AF] font-mono truncate">
                          {pk.credential_id} · Added {formatDateTime(pk.created_at)}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleDeletePasskey(pk)}
                        aria-label={`Remove passkey ${pk.label}`}
                        className="p-2 rounded-lg text-[#DC2626] dark:text-[#F87171] hover:bg-[#FEF2F2] dark:hover:bg-[#3B181A] cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* PASSWORD & SECURITY SUB-VIEW 5: ADVANCED PROTECTION */}
          {section === 'password-security' && securitySub === 'advanced-protection' && (
            <div className="bg-white dark:bg-[#1C1E21] border border-[#E4E6EB] dark:border-[#2E3035] rounded-2xl p-5 space-y-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <ShieldAlert className="w-6 h-6 text-[#1877F2] dark:text-[#60A5FA] shrink-0 mt-0.5" />
                  <div>
                    <h1 className="text-lg font-display font-bold text-[#111827] dark:text-white">
                      Advanced Protection
                    </h1>
                    <p className="text-xs text-[#65676B] dark:text-[#9CA3AF] mt-1 leading-relaxed">
                      Enables Verve&apos;s strongest defences against account takeover. Turning this
                      on automatically enforces two-factor authentication and real-time login
                      alerts.
                    </p>
                  </div>
                </div>
                <ToggleSwitch
                  checked={security.advanced_protection}
                  disabled={busy}
                  label="Toggle Advanced Protection"
                  onChange={(next) =>
                    handleUpdateSecurity(
                      {advanced_protection: next},
                      next
                        ? 'Advanced Protection enabled with 2FA and login alerts.'
                        : 'Advanced Protection turned off.',
                    )
                  }
                />
              </div>

              <div className="pt-3 border-t border-[#E4E6EB] dark:border-[#2E3035] space-y-2.5 text-sm">
                <div className="flex items-center gap-2.5 text-[#111827] dark:text-[#E5E7EB]">
                  <UserCheck
                    className={`w-4 h-4 shrink-0 ${
                      security.two_factor_enabled
                        ? 'text-[#16A34A] dark:text-[#4ADE80]'
                        : 'text-[#9CA3AF]'
                    }`}
                  />
                  <span>
                    Two-factor authentication:{' '}
                    <strong>{security.two_factor_enabled ? 'Protected' : 'Not enabled'}</strong>
                  </span>
                </div>
                <div className="flex items-center gap-2.5 text-[#111827] dark:text-[#E5E7EB]">
                  <Bell
                    className={`w-4 h-4 shrink-0 ${
                      security.login_alerts_inapp
                        ? 'text-[#16A34A] dark:text-[#4ADE80]'
                        : 'text-[#9CA3AF]'
                    }`}
                  />
                  <span>
                    Unrecognised login monitoring:{' '}
                    <strong>{security.login_alerts_inapp ? 'Active' : 'Off'}</strong>
                  </span>
                </div>
                <div className="flex items-center gap-2.5 text-[#111827] dark:text-[#E5E7EB]">
                  <Lock
                    className={`w-4 h-4 shrink-0 ${
                      security.e2ee_key_alerts
                        ? 'text-[#16A34A] dark:text-[#4ADE80]'
                        : 'text-[#9CA3AF]'
                    }`}
                  />
                  <span>
                    End-to-end chat key verification:{' '}
                    <strong>{security.e2ee_key_alerts ? 'Active' : 'Off'}</strong>
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* PASSWORD & SECURITY SUB-VIEW 6: WHERE YOU'RE LOGGED IN */}
          {section === 'password-security' && securitySub === 'where-logged-in' && (
            <div className="space-y-4">
              <div className="bg-white dark:bg-[#1C1E21] border border-[#E4E6EB] dark:border-[#2E3035] rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h1 className="text-lg font-display font-bold text-[#111827] dark:text-white">
                    Where you&apos;re logged in
                  </h1>
                  <p className="text-xs text-[#65676B] dark:text-[#9CA3AF] mt-0.5">
                    Review active sessions on your Verve account and sign out devices you don&apos;t
                    recognise.
                  </p>
                </div>

                {otherSessionsCount > 0 && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleRevokeAllOtherSessions}
                    className="px-3.5 h-9 rounded-xl bg-[#FEF2F2] dark:bg-[#3B181A] text-xs font-semibold text-[#DC2626] dark:text-[#FCA5A5] whitespace-nowrap cursor-pointer"
                  >
                    Log out of all other sessions ({otherSessionsCount})
                  </button>
                )}
              </div>

              <div className="bg-white dark:bg-[#1C1E21] border border-[#E4E6EB] dark:border-[#2E3035] rounded-2xl divide-y divide-[#E4E6EB] dark:divide-[#2E3035] overflow-hidden">
                {sessions.map((s) => {
                  const isMobile = /android|iphone|ios|mobile/i.test(s.device_name);
                  return (
                    <div
                      key={s.id}
                      className="px-4 py-3.5 flex items-center justify-between gap-3"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="w-10 h-10 rounded-xl bg-[#F0F2F5] dark:bg-[#2A2D32] flex items-center justify-center text-[#4B5563] dark:text-[#D1D5DB] shrink-0">
                          {isMobile ? (
                            <Smartphone className="w-5 h-5" />
                          ) : (
                            <Laptop className="w-5 h-5" />
                          )}
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-[#111827] dark:text-white truncate">
                            {s.device_name}
                          </p>
                          <p className="text-xs text-[#65676B] dark:text-[#9CA3AF]">
                            {s.is_current ? (
                              <span className="font-semibold text-[#16A34A] dark:text-[#4ADE80]">
                                This device
                              </span>
                            ) : (
                              <span>{s.ip_address}</span>
                            )}{' '}
                            · {formatDateTime(s.created_at)}
                          </p>
                        </div>
                      </div>

                      {!s.is_current && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => handleRevokeSession(s)}
                          className="px-3 h-8 rounded-lg bg-[#F0F2F5] dark:bg-[#2A2D32] hover:bg-[#E4E6EB] dark:hover:bg-[#35383E] text-xs font-semibold text-[#111827] dark:text-white shrink-0 cursor-pointer"
                        >
                          Log out
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* PASSWORD & SECURITY SUB-VIEW 7: RECENT EMAILS */}
          {section === 'password-security' && securitySub === 'recent-emails' && (
            <div className="space-y-4">
              <div className="bg-white dark:bg-[#1C1E21] border border-[#E4E6EB] dark:border-[#2E3035] rounded-2xl p-5 space-y-4">
                <div>
                  <h1 className="text-lg font-display font-bold text-[#111827] dark:text-white">
                    Recent emails
                  </h1>
                  <p className="text-xs text-[#65676B] dark:text-[#9CA3AF] mt-0.5">
                    Verify official security and login emails sent by Verve to your account.
                  </p>
                </div>

                <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-[#F0F2F5] dark:bg-[#121316]">
                  <button
                    type="button"
                    onClick={() => setEmailTab('security')}
                    className={`px-4 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
                      emailTab === 'security'
                        ? 'bg-white dark:bg-[#2A2D32] text-[#111827] dark:text-white'
                        : 'text-[#65676B] dark:text-[#9CA3AF]'
                    }`}
                  >
                    Security
                  </button>
                  <button
                    type="button"
                    onClick={() => setEmailTab('other')}
                    className={`px-4 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
                      emailTab === 'other'
                        ? 'bg-white dark:bg-[#2A2D32] text-[#111827] dark:text-white'
                        : 'text-[#65676B] dark:text-[#9CA3AF]'
                    }`}
                  >
                    Other emails
                  </button>
                </div>
              </div>

              <div className="bg-white dark:bg-[#1C1E21] border border-[#E4E6EB] dark:border-[#2E3035] rounded-2xl divide-y divide-[#E4E6EB] dark:divide-[#2E3035] overflow-hidden">
                {filteredEmails.length === 0 ? (
                  <p className="p-6 text-center text-sm text-[#65676B] dark:text-[#9CA3AF]">
                    No emails in this category yet.
                  </p>
                ) : (
                  filteredEmails.map((em) => (
                    <div key={em.id} className="p-4 flex items-start gap-3">
                      <span className="w-9 h-9 rounded-xl bg-[#F0F2F5] dark:bg-[#2A2D32] flex items-center justify-center text-[#1877F2] dark:text-[#60A5FA] shrink-0">
                        <Mail className="w-4 h-4" />
                      </span>
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-semibold text-[#111827] dark:text-white">
                            {em.subject}
                          </p>
                          <span className="text-[11px] text-[#65676B] dark:text-[#9CA3AF] whitespace-nowrap">
                            {formatDateTime(em.created_at)}
                          </span>
                        </div>
                        <p className="text-xs text-[#4B5563] dark:text-[#D1D5DB] leading-relaxed">
                          {em.body}
                        </p>
                        <p className="text-[11px] text-[#65676B] dark:text-[#9CA3AF]">
                          Sent to {em.recipient}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* PASSWORD & SECURITY SUB-VIEW 8: SECURITY ALERTS & E2EE */}
          {section === 'password-security' && securitySub === 'security-alerts' && (
            <div className="space-y-4">
              <div className="bg-white dark:bg-[#1C1E21] border border-[#E4E6EB] dark:border-[#2E3035] rounded-2xl p-5 space-y-4">
                <div>
                  <h1 className="text-lg font-display font-bold text-[#111827] dark:text-white">
                    Security alerts
                  </h1>
                  <p className="text-xs text-[#65676B] dark:text-[#9CA3AF] mt-1">
                    Get notified about new logins and when an encryption key changes in your
                    end-to-end encrypted chats.
                  </p>
                </div>

                <div className="divide-y divide-[#E4E6EB] dark:divide-[#2E3035]">
                  <div className="py-3.5 flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold text-[#111827] dark:text-white">
                        In-app login alerts
                      </p>
                      <p className="text-xs text-[#65676B] dark:text-[#9CA3AF]">
                        Receive a Verve notification when a new browser signs in
                      </p>
                    </div>
                    <ToggleSwitch
                      checked={security.login_alerts_inapp}
                      disabled={busy}
                      label="Toggle in-app login alerts"
                      onChange={(next) => handleUpdateSecurity({login_alerts_inapp: next})}
                    />
                  </div>

                  <div className="py-3.5 flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold text-[#111827] dark:text-white">
                        Email login alerts
                      </p>
                      <p className="text-xs text-[#65676B] dark:text-[#9CA3AF]">
                        Send security notices to {currentUser.email || 'your account email'}
                      </p>
                    </div>
                    <ToggleSwitch
                      checked={security.login_alerts_email}
                      disabled={busy}
                      label="Toggle email login alerts"
                      onChange={(next) => handleUpdateSecurity({login_alerts_email: next})}
                    />
                  </div>

                  <div className="py-3.5 flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold text-[#111827] dark:text-white">
                        Encrypted chat key-change alerts
                      </p>
                      <p className="text-xs text-[#65676B] dark:text-[#9CA3AF]">
                        Show an alert if a contact&apos;s encryption key updates
                      </p>
                    </div>
                    <ToggleSwitch
                      checked={security.e2ee_key_alerts}
                      disabled={busy}
                      label="Toggle encrypted chat key-change alerts"
                      onChange={(next) => handleUpdateSecurity({e2ee_key_alerts: next})}
                    />
                  </div>
                </div>
              </div>

              <div className="bg-white dark:bg-[#1C1E21] border border-[#E4E6EB] dark:border-[#2E3035] rounded-2xl p-5 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-[#65676B] dark:text-[#9CA3AF]">
                  Your Chat Safety Fingerprint
                </p>
                <p className="font-mono text-sm tracking-widest text-[#111827] dark:text-white bg-[#F8F9FA] dark:bg-[#121316] border border-[#E4E6EB] dark:border-[#2E3035] rounded-xl px-4 py-3">
                  {security.e2ee_fingerprint || '—'}
                </p>
              </div>
            </div>
          )}

          {/* ===================================================== */}
          {/* VIEW 3: PRIVACY                                       */}
          {/* ===================================================== */}
          {section === 'privacy' && (
            <div className="bg-white dark:bg-[#1C1E21] border border-[#E4E6EB] dark:border-[#2E3035] rounded-2xl p-5 space-y-5">
              <div>
                <h1 className="text-xl font-display font-bold text-[#111827] dark:text-white">
                  Privacy Checkup
                </h1>
                <p className="text-xs text-[#65676B] dark:text-[#9CA3AF] mt-0.5">
                  Choose who can view your profile activity and connect with you.
                </p>
              </div>

              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-[#E4E6EB] dark:border-[#2E3035]">
                  <div>
                    <p className="text-sm font-semibold text-[#111827] dark:text-white">
                      Profile &amp; Posts Visibility
                    </p>
                    <p className="text-xs text-[#65676B] dark:text-[#9CA3AF]">
                      Who can view your future posts and profile details
                    </p>
                  </div>
                  <select
                    value={settings.profile_visibility}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        profile_visibility: e.target.value as 'public' | 'friends',
                      }))
                    }
                    className="h-10 px-3 rounded-xl bg-[#F0F2F5] dark:bg-[#121316] border border-[#D1D5DB] dark:border-[#374151] text-sm text-[#111827] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1877F2]"
                  >
                    <option value="public">Public (Everyone)</option>
                    <option value="friends">Friends Only</option>
                  </select>
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-[#E4E6EB] dark:border-[#2E3035]">
                  <div>
                    <p className="text-sm font-semibold text-[#111827] dark:text-white">
                      Who can send you friend requests
                    </p>
                    <p className="text-xs text-[#65676B] dark:text-[#9CA3AF]">
                      Control incoming connection requests
                    </p>
                  </div>
                  <select
                    value={settings.friend_request_policy}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        friend_request_policy: e.target.value as 'everyone' | 'friends_of_friends',
                      }))
                    }
                    className="h-10 px-3 rounded-xl bg-[#F0F2F5] dark:bg-[#121316] border border-[#D1D5DB] dark:border-[#374151] text-sm text-[#111827] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1877F2]"
                  >
                    <option value="everyone">Everyone</option>
                    <option value="friends_of_friends">Friends of Friends</option>
                  </select>
                </div>

                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-[#111827] dark:text-white">
                      Active Status
                    </p>
                    <p className="text-xs text-[#65676B] dark:text-[#9CA3AF]">
                      Show friends when you are online in real-time chat
                    </p>
                  </div>
                  <ToggleSwitch
                    checked={settings.show_online_status}
                    label="Toggle Active Status"
                    onChange={(next) =>
                      setSettings((prev) => ({...prev, show_online_status: next}))
                    }
                  />
                </div>
              </div>

              <div className="flex justify-end pt-2 border-t border-[#E4E6EB] dark:border-[#2E3035]">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => handleSaveSettings(settings)}
                  className="inline-flex items-center gap-2 px-5 h-10 rounded-xl bg-[#1877F2] hover:bg-[#166FE5] text-white text-sm font-semibold disabled:opacity-60 cursor-pointer"
                >
                  {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                  <span>{busy ? 'Saving...' : 'Save Privacy Settings'}</span>
                </button>
              </div>
            </div>
          )}

          {/* ===================================================== */}
          {/* VIEW 4: NOTIFICATIONS                                 */}
          {/* ===================================================== */}
          {section === 'notifications' && (
            <div className="bg-white dark:bg-[#1C1E21] border border-[#E4E6EB] dark:border-[#2E3035] rounded-2xl p-5 space-y-5">
              <div>
                <h1 className="text-xl font-display font-bold text-[#111827] dark:text-white">
                  Notification Preferences
                </h1>
                <p className="text-xs text-[#65676B] dark:text-[#9CA3AF] mt-0.5">
                  Manage how you receive alerts for likes, comments, and friend requests.
                </p>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between gap-4 pb-4 border-b border-[#E4E6EB] dark:border-[#2E3035]">
                  <div>
                    <p className="text-sm font-semibold text-[#111827] dark:text-white">
                      Real-time In-App Alerts
                    </p>
                    <p className="text-xs text-[#65676B] dark:text-[#9CA3AF]">
                      Instant alerts when someone comments, likes, or messages you
                    </p>
                  </div>
                  <ToggleSwitch
                    checked={settings.push_notifications}
                    label="Toggle Real-time In-App Alerts"
                    onChange={(next) =>
                      setSettings((prev) => ({...prev, push_notifications: next}))
                    }
                  />
                </div>

                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-[#111827] dark:text-white">
                      Email &amp; Account Summaries
                    </p>
                    <p className="text-xs text-[#65676B] dark:text-[#9CA3AF]">
                      Security alerts and missed friend request digests
                    </p>
                  </div>
                  <ToggleSwitch
                    checked={settings.email_notifications}
                    label="Toggle Email Summaries"
                    onChange={(next) =>
                      setSettings((prev) => ({...prev, email_notifications: next}))
                    }
                  />
                </div>
              </div>

              <div className="flex justify-end pt-2 border-t border-[#E4E6EB] dark:border-[#2E3035]">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => handleSaveSettings(settings)}
                  className="inline-flex items-center gap-2 px-5 h-10 rounded-xl bg-[#1877F2] hover:bg-[#166FE5] text-white text-sm font-semibold disabled:opacity-60 cursor-pointer"
                >
                  {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                  <span>{busy ? 'Saving...' : 'Save Preferences'}</span>
                </button>
              </div>
            </div>
          )}

          {/* ===================================================== */}
          {/* VIEW 5: APPEARANCE & LANGUAGE                         */}
          {/* ===================================================== */}
          {section === 'appearance' && (
            <div className="bg-white dark:bg-[#1C1E21] border border-[#E4E6EB] dark:border-[#2E3035] rounded-2xl p-5 space-y-5">
              <div>
                <h1 className="text-xl font-display font-bold text-[#111827] dark:text-white">
                  Display &amp; Language
                </h1>
                <p className="text-xs text-[#65676B] dark:text-[#9CA3AF] mt-0.5">
                  Personalize theme contrast and preferred language.
                </p>
              </div>

              <div className="flex items-center justify-between gap-4 pb-4 border-b border-[#E4E6EB] dark:border-[#2E3035]">
                <div>
                  <p className="text-sm font-semibold text-[#111827] dark:text-white">Theme Mode</p>
                  <p className="text-xs text-[#65676B] dark:text-[#9CA3AF]">
                    Switch between clean Light Mode and Dark Mode
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onToggleTheme}
                  className="inline-flex items-center gap-2 px-4 h-10 rounded-xl bg-[#F0F2F5] dark:bg-[#2A2D32] hover:bg-[#E4E6EB] dark:hover:bg-[#35383E] text-sm font-semibold text-[#111827] dark:text-white cursor-pointer"
                >
                  {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                  <span>{theme === 'dark' ? 'Dark Mode' : 'Light Mode'}</span>
                </button>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-[#111827] dark:text-white">
                    Preferred Language
                  </p>
                  <p className="text-xs text-[#65676B] dark:text-[#9CA3AF]">
                    Saved to your account profile
                  </p>
                </div>
                <select
                  value={settings.language}
                  onChange={(e) => setSettings((prev) => ({...prev, language: e.target.value}))}
                  className="h-10 px-3 rounded-xl bg-[#F0F2F5] dark:bg-[#121316] border border-[#D1D5DB] dark:border-[#374151] text-sm text-[#111827] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1877F2]"
                >
                  <option value="English">English (US)</option>
                  <option value="বাংলা (Bengali)">বাংলা (Bengali)</option>
                  <option value="Español">Español</option>
                  <option value="Français">Français</option>
                  <option value="Deutsch">Deutsch</option>
                </select>
              </div>

              <div className="flex justify-end pt-2 border-t border-[#E4E6EB] dark:border-[#2E3035]">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => handleSaveSettings(settings)}
                  className="inline-flex items-center gap-2 px-5 h-10 rounded-xl bg-[#1877F2] hover:bg-[#166FE5] text-white text-sm font-semibold disabled:opacity-60 cursor-pointer"
                >
                  {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                  <span>{busy ? 'Saving...' : 'Save Display Settings'}</span>
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
