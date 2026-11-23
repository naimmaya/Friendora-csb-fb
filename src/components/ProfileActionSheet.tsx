import {useEffect, useState} from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Ban,
  Check,
  CheckCircle2,
  ChevronRight,
  Copy,
  Link2,
  Loader2,
  MessageCircle,
  MoreHorizontal,
  Send,
  Share2,
  X,
} from 'lucide-react';
import {formatFirestoreErrorMessage} from '../lib/firebase';
import {
  blockUserPermanent,
  hasReportedProfilePermanent,
  PROFILE_SUSPEND_REPORT_THRESHOLD,
  sendMessagePermanent,
  submitProfileReportPermanent,
} from '../lib/firestoreStore';
import type {ProfileReportReason, UserProfile} from '../types';
import {Avatar} from './MediaImage';

const REPORT_REASONS: Array<{
  value: ProfileReportReason;
  description: string;
}> = [
  {value: 'Fake profile', description: 'This account looks fake, automated, or misleading'},
  {value: 'Harassment / Bullying', description: 'Targeted abuse, threats, or intimidation'},
  {value: 'Hate speech', description: 'Attacks based on protected groups or identity'},
  {value: 'Spam / Scam', description: 'Fraudulent links, phishing, or repetitive spam'},
  {value: 'Inappropriate content', description: 'Explicit, violent, or harmful material'},
  {value: 'Impersonation', description: 'Pretending to be someone else or another brand'},
  {value: 'Other', description: 'Something else that violates community standards'},
];

export type ProfileSheetMode = 'menu' | 'share' | 'share-messenger' | 'block-confirm' | 'report';

interface ProfileActionSheetProps {
  open: boolean;
  profile: UserProfile;
  currentUser: UserProfile;
  isOwnProfile: boolean;
  shareFriends: UserProfile[];
  onClose: () => void;
  onToast: (message: string) => void;
  onBlocked: (target: UserProfile) => void;
  onReported?: (result: {reportCount: number; suspended: boolean}) => void;
}

function copyTextFallback(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard
      .writeText(text)
      .then(() => true)
      .catch(() => legacyCopy(text));
  }
  return Promise.resolve(legacyCopy(text));
}

function legacyCopy(text: string): boolean {
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

export function ProfileActionSheet({
  open,
  profile,
  currentUser,
  isOwnProfile,
  shareFriends,
  onClose,
  onToast,
  onBlocked,
  onReported,
}: ProfileActionSheetProps) {
  const [mode, setMode] = useState<ProfileSheetMode>('menu');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Report state
  const [selectedReason, setSelectedReason] = useState<ProfileReportReason | null>(null);
  const [reportDetails, setReportDetails] = useState('');
  const [reportSubmitted, setReportSubmitted] = useState(false);
  const [autoSuspendedNow, setAutoSuspendedNow] = useState(false);
  const [alreadyReported, setAlreadyReported] = useState(false);
  const [checkingReported, setCheckingReported] = useState(false);

  // In-app Messenger share state
  const [sentToUids, setSentToUids] = useState<Set<string>>(() => new Set());
  const [sendingUid, setSendingUid] = useState<string | null>(null);

  const profileSlug = profile.uid || String(profile.id);
  const profileLink = `${window.location.origin}/profile/${encodeURIComponent(profileSlug)}`;
  const shareText = `Check out ${profile.name}'s profile on Verve: ${profileLink}`;

  useEffect(() => {
    if (!open) return;
    setMode('menu');
    setError(null);
    setBusy(false);
    setSelectedReason(null);
    setReportDetails('');
    setReportSubmitted(false);
    setAutoSuspendedNow(false);
    setAlreadyReported(false);
    setSentToUids(new Set());
    setSendingUid(null);
  }, [open, profile.uid, profile.id]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || mode !== 'report' || isOwnProfile || !currentUser.uid || !profile.uid) return;
    let cancelled = false;
    setCheckingReported(true);
    hasReportedProfilePermanent(profile.uid, currentUser.uid)
      .then((exists) => {
        if (!cancelled) setAlreadyReported(exists);
      })
      .finally(() => {
        if (!cancelled) setCheckingReported(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, mode, isOwnProfile, currentUser.uid, profile.uid]);

  if (!open) return null;

  async function handleCopyLink() {
    const ok = await copyTextFallback(profileLink);
    onToast(ok ? 'Link copied' : 'Could not copy link automatically');
    onClose();
  }

  async function handleNativeMoreShare() {
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: `${profile.name} on Verve`,
          text: `View ${profile.name}'s profile`,
          url: profileLink,
        });
        onClose();
        return;
      } catch {
        // Fall through to copy if cancelled/unsupported
      }
    }
    await handleCopyLink();
  }

  async function handleSendViaMessenger(friend: UserProfile) {
    if (!currentUser.uid || !friend.uid || sendingUid) return;
    setSendingUid(friend.uid);
    setError(null);
    try {
      await sendMessagePermanent(currentUser.uid, friend.uid, shareText);
      setSentToUids((prev) => {
        const next = new Set(prev);
        next.add(friend.uid!);
        return next;
      });
      onToast(`Profile link sent to ${friend.name}`);
    } catch (err) {
      setError(formatFirestoreErrorMessage(err));
    } finally {
      setSendingUid(null);
    }
  }

  async function handleConfirmBlock() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await blockUserPermanent(currentUser, profile);
      onToast(`${profile.name} has been blocked`);
      onBlocked(profile);
      onClose();
    } catch (err) {
      setError(formatFirestoreErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmitReport() {
    if (!selectedReason || !currentUser.uid || !profile.uid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await submitProfileReportPermanent({
        reportedUserId: profile.uid,
        reporterUserId: currentUser.uid,
        reason: selectedReason,
        details: reportDetails.trim(),
      });
      setReportSubmitted(true);
      setAutoSuspendedNow(res.suspended);
      onReported?.(res);
    } catch (err) {
      setError(formatFirestoreErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/55 backdrop-blur-[2px] p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Profile options"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-md bg-white dark:bg-[#1C1E21] border-t sm:border border-[#E5E8EE] dark:border-[#2E3035] rounded-t-3xl sm:rounded-2xl shadow-2xl overflow-hidden max-h-[88vh] flex flex-col animate-in fade-in slide-in-from-bottom-4 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drag Handle (Mobile) */}
        <div className="sm:hidden flex justify-center pt-2.5 pb-1">
          <span className="w-10 h-1 rounded-full bg-[#CBD5E1] dark:bg-[#3A3D42]" />
        </div>

        {/* Modal / Bottom Sheet Header */}
        <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-[#E5E8EE] dark:border-[#2E3035]">
          <div className="flex items-center gap-2.5 min-w-0">
            <Avatar src={profile.avatar_url} name={profile.name} size="xs" />
            <div className="min-w-0">
              <h2 className="text-[15px] font-display font-bold text-[#0F172A] dark:text-white truncate">
                {mode === 'menu' && 'Profile Settings & Options'}
                {mode === 'share' && 'Share Profile'}
                {mode === 'share-messenger' && 'Send in Messenger'}
                {mode === 'block-confirm' && `Block ${profile.name}?`}
                {mode === 'report' && 'Report Profile'}
              </h2>
              <p className="text-xs text-[#64748B] dark:text-[#94A3B8] truncate">{profile.name}</p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="w-8 h-8 rounded-full bg-[#F1F5F9] dark:bg-[#2A2D32] hover:bg-[#E2E8F0] dark:hover:bg-[#35383E] text-[#475569] dark:text-[#CBD5E1] flex items-center justify-center shrink-0 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Error Banner */}
        {error && (
          <div
            role="alert"
            className="mx-4 mt-3 p-3 rounded-xl bg-[#FEF2F2] dark:bg-[#3B181A] border border-[#FECACA] dark:border-[#7F1D1D] text-xs text-[#B91C1C] dark:text-[#FCA5A5] flex items-start gap-2"
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* CONTENT BY MODE */}
        <div className="overflow-y-auto flex-1">
          {/* 1. MAIN BOTTOM SHEET MENU */}
          {mode === 'menu' && (
            <div className="p-2.5 space-y-1">
              <button
                type="button"
                onClick={handleCopyLink}
                className="w-full px-3.5 py-3 rounded-xl hover:bg-[#F4F6F9] dark:hover:bg-[#26292E] flex items-center justify-between gap-3 text-left transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="w-10 h-10 rounded-full bg-[#EFF6FF] dark:bg-[#1E3A8A]/35 text-[#1877F2] dark:text-[#60A5FA] flex items-center justify-center shrink-0">
                    <Link2 className="w-5 h-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[#0F172A] dark:text-white">
                      Copy link to profile
                    </p>
                    <p className="text-xs text-[#64748B] dark:text-[#94A3B8] truncate">
                      {profileLink}
                    </p>
                  </div>
                </div>
                <Copy className="w-4 h-4 text-[#94A3B8] shrink-0" />
              </button>

              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setMode('share');
                }}
                className="w-full px-3.5 py-3 rounded-xl hover:bg-[#F4F6F9] dark:hover:bg-[#26292E] flex items-center justify-between gap-3 text-left transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="w-10 h-10 rounded-full bg-[#F0FDF4] dark:bg-[#14532D]/35 text-[#16A34A] dark:text-[#4ADE80] flex items-center justify-center shrink-0">
                    <Share2 className="w-5 h-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[#0F172A] dark:text-white">
                      Share profile
                    </p>
                    <p className="text-xs text-[#64748B] dark:text-[#94A3B8]">
                      WhatsApp, Messenger, Facebook &amp; more sharing options
                    </p>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-[#94A3B8] shrink-0" />
              </button>

              {!isOwnProfile && (
                <>
                  <div className="my-1.5 border-t border-[#E5E8EE] dark:border-[#2E3035]" />

                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      setMode('block-confirm');
                    }}
                    className="w-full px-3.5 py-3 rounded-xl hover:bg-[#FEF2F2] dark:hover:bg-[#3B181A]/40 flex items-center justify-between gap-3 text-left transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="w-10 h-10 rounded-full bg-[#FEF2F2] dark:bg-[#7F1D1D]/35 text-[#DC2626] dark:text-[#F87171] flex items-center justify-center shrink-0">
                        <Ban className="w-5 h-5" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-[#DC2626] dark:text-[#F87171]">
                          Block
                        </p>
                        <p className="text-xs text-[#64748B] dark:text-[#94A3B8]">
                          Hide {profile.name}&apos;s profile and posts from your account
                        </p>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-[#94A3B8] shrink-0" />
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      setMode('report');
                    }}
                    className="w-full px-3.5 py-3 rounded-xl hover:bg-[#FFFBEB] dark:hover:bg-[#451A03]/35 flex items-center justify-between gap-3 text-left transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="w-10 h-10 rounded-full bg-[#FFFBEB] dark:bg-[#78350F]/40 text-[#D97706] dark:text-[#FBBF24] flex items-center justify-center shrink-0">
                        <AlertTriangle className="w-5 h-5" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-[#0F172A] dark:text-white">
                          Report profile
                        </p>
                        <p className="text-xs text-[#64748B] dark:text-[#94A3B8]">
                          Report fake account, harassment, spam, or abuse
                        </p>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-[#94A3B8] shrink-0" />
                  </button>
                </>
              )}
            </div>
          )}

          {/* 2. SHARE PROFILE SHEET */}
          {mode === 'share' && (
            <div className="p-4 space-y-4">
              {/* Link Box */}
              <div className="p-3 rounded-xl bg-[#F8FAFC] dark:bg-[#121417] border border-[#E5E8EE] dark:border-[#2E3035] flex items-center justify-between gap-2.5">
                <span className="text-xs text-[#475569] dark:text-[#94A3B8] truncate font-mono">
                  {profileLink}
                </span>
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="px-3 py-1.5 rounded-lg bg-[#1877F2] hover:bg-[#166FE5] text-white text-xs font-semibold shrink-0 cursor-pointer"
                >
                  Copy
                </button>
              </div>

              {/* Share Destinations Grid */}
              <div className="grid grid-cols-5 gap-2">
                <a
                  href={`https://wa.me/?text=${encodeURIComponent(shareText)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => onToast('Opening WhatsApp share...')}
                  className="flex flex-col items-center gap-1.5 p-2 rounded-xl hover:bg-[#F4F6F9] dark:hover:bg-[#26292E] transition-colors"
                >
                  <span className="w-11 h-11 rounded-full bg-[#25D366] text-white flex items-center justify-center font-bold text-sm shadow-xs">
                    WA
                  </span>
                  <span className="text-[11px] font-medium text-[#334155] dark:text-[#CBD5E1]">
                    WhatsApp
                  </span>
                </a>

                <button
                  type="button"
                  onClick={() => setMode('share-messenger')}
                  className="flex flex-col items-center gap-1.5 p-2 rounded-xl hover:bg-[#F4F6F9] dark:hover:bg-[#26292E] transition-colors cursor-pointer"
                >
                  <span className="w-11 h-11 rounded-full bg-[#0084FF] text-white flex items-center justify-center shadow-xs">
                    <MessageCircle className="w-5 h-5" />
                  </span>
                  <span className="text-[11px] font-medium text-[#334155] dark:text-[#CBD5E1]">
                    Messenger
                  </span>
                </button>

                <a
                  href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(profileLink)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => onToast('Opening Facebook share...')}
                  className="flex flex-col items-center gap-1.5 p-2 rounded-xl hover:bg-[#F4F6F9] dark:hover:bg-[#26292E] transition-colors"
                >
                  <span className="w-11 h-11 rounded-full bg-[#1877F2] text-white flex items-center justify-center font-extrabold text-lg shadow-xs">
                    f
                  </span>
                  <span className="text-[11px] font-medium text-[#334155] dark:text-[#CBD5E1]">
                    Facebook
                  </span>
                </a>

                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="flex flex-col items-center gap-1.5 p-2 rounded-xl hover:bg-[#F4F6F9] dark:hover:bg-[#26292E] transition-colors cursor-pointer"
                >
                  <span className="w-11 h-11 rounded-full bg-[#E2E8F0] dark:bg-[#2A2D32] text-[#0F172A] dark:text-white flex items-center justify-center shadow-xs">
                    <Link2 className="w-5 h-5" />
                  </span>
                  <span className="text-[11px] font-medium text-[#334155] dark:text-[#CBD5E1]">
                    Copy Link
                  </span>
                </button>

                <button
                  type="button"
                  onClick={handleNativeMoreShare}
                  className="flex flex-col items-center gap-1.5 p-2 rounded-xl hover:bg-[#F4F6F9] dark:hover:bg-[#26292E] transition-colors cursor-pointer"
                >
                  <span className="w-11 h-11 rounded-full bg-[#F1F5F9] dark:bg-[#2A2D32] text-[#0F172A] dark:text-white flex items-center justify-center shadow-xs">
                    <MoreHorizontal className="w-5 h-5" />
                  </span>
                  <span className="text-[11px] font-medium text-[#334155] dark:text-[#CBD5E1]">
                    More...
                  </span>
                </button>
              </div>

              <button
                type="button"
                onClick={() => setMode('menu')}
                className="w-full h-10 rounded-xl bg-[#F1F5F9] dark:bg-[#2A2D32] hover:bg-[#E2E8F0] dark:hover:bg-[#35383E] text-sm font-semibold text-[#0F172A] dark:text-white cursor-pointer"
              >
                Back
              </button>
            </div>
          )}

          {/* 2B. SEND PROFILE LINK VIA IN-APP MESSENGER */}
          {mode === 'share-messenger' && (
            <div className="p-4 space-y-3">
              <p className="text-xs text-[#64748B] dark:text-[#94A3B8]">
                Send {profile.name}&apos;s profile link directly in Messenger chat:
              </p>

              {shareFriends.length === 0 ? (
                <div className="py-6 text-center text-xs text-[#64748B] dark:text-[#94A3B8]">
                  No contacts available yet. You can copy the profile link instead.
                </div>
              ) : (
                <div className="space-y-1.5 max-h-60 overflow-y-auto">
                  {shareFriends
                    .filter((u) => u.uid && u.uid !== currentUser.uid)
                    .map((friend) => {
                      const alreadySent = Boolean(friend.uid && sentToUids.has(friend.uid));
                      const isSending = sendingUid === friend.uid;
                      return (
                        <div
                          key={friend.uid || friend.id}
                          className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-[#F8FAFC] dark:bg-[#121417] border border-[#E5E8EE] dark:border-[#2E3035]"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <Avatar src={friend.avatar_url} name={friend.name} size="xs" />
                            <span className="text-sm font-medium text-[#0F172A] dark:text-white truncate">
                              {friend.name}
                            </span>
                          </div>
                          <button
                            type="button"
                            disabled={alreadySent || Boolean(sendingUid)}
                            onClick={() => handleSendViaMessenger(friend)}
                            className={`inline-flex items-center gap-1.5 px-3 h-8 rounded-lg text-xs font-semibold shrink-0 cursor-pointer disabled:opacity-60 ${
                              alreadySent
                                ? 'bg-[#ECFDF5] dark:bg-[#0F2E22] text-[#16A34A] dark:text-[#4ADE80]'
                                : 'bg-[#1877F2] hover:bg-[#166FE5] text-white'
                            }`}
                          >
                            {isSending ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : alreadySent ? (
                              <Check className="w-3.5 h-3.5" />
                            ) : (
                              <Send className="w-3.5 h-3.5" />
                            )}
                            <span>{alreadySent ? 'Sent' : 'Send'}</span>
                          </button>
                        </div>
                      );
                    })}
                </div>
              )}

              <button
                type="button"
                onClick={() => setMode('share')}
                className="w-full h-10 rounded-xl bg-[#F1F5F9] dark:bg-[#2A2D32] hover:bg-[#E2E8F0] dark:hover:bg-[#35383E] text-sm font-semibold text-[#0F172A] dark:text-white cursor-pointer"
              >
                Back to Share
              </button>
            </div>
          )}

          {/* 3. BLOCK CONFIRMATION POPUP */}
          {mode === 'block-confirm' && (
            <div className="p-5 space-y-4">
              <div className="flex items-start gap-3">
                <span className="w-11 h-11 rounded-full bg-[#FEF2F2] dark:bg-[#7F1D1D]/40 text-[#DC2626] dark:text-[#F87171] flex items-center justify-center shrink-0">
                  <Ban className="w-5 h-5" />
                </span>
                <div className="space-y-1">
                  <h3 className="text-base font-display font-bold text-[#0F172A] dark:text-white">
                    Block {profile.name}?
                  </h3>
                  <p className="text-xs text-[#64748B] dark:text-[#94A3B8] leading-relaxed">
                    {profile.name} will be added to your blocked list. You will no longer see their
                    profile or posts, and any existing friendship or follow will be removed. You can
                    unblock them anytime in <strong>Settings &gt; Blocked People</strong>.
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setMode('menu')}
                  className="px-4 h-10 rounded-xl bg-[#F1F5F9] dark:bg-[#2A2D32] hover:bg-[#E2E8F0] dark:hover:bg-[#35383E] text-sm font-semibold text-[#0F172A] dark:text-white cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleConfirmBlock}
                  className="inline-flex items-center gap-2 px-5 h-10 rounded-xl bg-[#DC2626] hover:bg-[#B91C1C] text-white text-sm font-semibold disabled:opacity-60 cursor-pointer"
                >
                  {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                  <span>{busy ? 'Blocking...' : 'Block'}</span>
                </button>
              </div>
            </div>
          )}

          {/* 4. REPORT PROFILE PAGE / MODAL */}
          {mode === 'report' && (
            <div className="p-5 space-y-4">
              {reportSubmitted ? (
                <div className="py-4 text-center space-y-3">
                  <span className="w-14 h-14 mx-auto rounded-full bg-[#ECFDF5] dark:bg-[#0F2E22] text-[#16A34A] dark:text-[#4ADE80] flex items-center justify-center">
                    <CheckCircle2 className="w-7 h-7" />
                  </span>
                  <div className="space-y-1">
                    <h3 className="text-lg font-display font-bold text-[#0F172A] dark:text-white">
                      Thanks, we received your report
                    </h3>
                    <p className="text-xs text-[#64748B] dark:text-[#94A3B8] leading-relaxed max-w-xs mx-auto">
                      {autoSuspendedNow
                        ? `This profile has reached ${PROFILE_SUSPEND_REPORT_THRESHOLD} unique user reports and has been automatically suspended.`
                        : 'Your report has been saved for review. Accounts that receive 10 reports from distinct users are automatically suspended.'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={onClose}
                    className="w-full h-10 rounded-xl bg-[#1877F2] hover:bg-[#166FE5] text-white text-sm font-semibold cursor-pointer"
                  >
                    Done
                  </button>
                </div>
              ) : checkingReported ? (
                <div className="py-8 flex items-center justify-center gap-2 text-sm text-[#64748B] dark:text-[#94A3B8]">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Checking report status...</span>
                </div>
              ) : alreadyReported ? (
                <div className="py-4 text-center space-y-3">
                  <span className="w-12 h-12 mx-auto rounded-full bg-[#FFFBEB] dark:bg-[#78350F]/40 text-[#D97706] dark:text-[#FBBF24] flex items-center justify-center">
                    <CheckCircle2 className="w-6 h-6" />
                  </span>
                  <div className="space-y-1">
                    <h3 className="text-base font-display font-bold text-[#0F172A] dark:text-white">
                      You already reported this profile
                    </h3>
                    <p className="text-xs text-[#64748B] dark:text-[#94A3B8]">
                      Each account can submit one report per profile. You can also block{' '}
                      {profile.name} if you don&apos;t want to see their content.
                    </p>
                  </div>
                  <div className="flex items-center justify-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setMode('block-confirm')}
                      className="px-4 h-9 rounded-xl bg-[#FEF2F2] dark:bg-[#3B181A] text-[#DC2626] dark:text-[#FCA5A5] text-xs font-semibold cursor-pointer"
                    >
                      Block {profile.name}
                    </button>
                    <button
                      type="button"
                      onClick={onClose}
                      className="px-4 h-9 rounded-xl bg-[#1877F2] text-white text-xs font-semibold cursor-pointer"
                    >
                      Close
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="space-y-1">
                    <h3 className="text-base font-display font-bold text-[#0F172A] dark:text-white">
                      Why are you reporting {profile.name}?
                    </h3>
                    <p className="text-xs text-[#64748B] dark:text-[#94A3B8]">
                      Select the reason that best describes the issue. Your report is confidential.
                    </p>
                  </div>

                  <div className="space-y-2">
                    {REPORT_REASONS.map((item) => {
                      const active = selectedReason === item.value;
                      return (
                        <button
                          key={item.value}
                          type="button"
                          onClick={() => setSelectedReason(item.value)}
                          className={`w-full px-3.5 py-2.5 rounded-xl border text-left transition-colors flex items-center justify-between gap-3 cursor-pointer ${
                            active
                              ? 'border-[#1877F2] bg-[#EFF6FF] dark:bg-[#1E3A8A]/30'
                              : 'border-[#E5E8EE] dark:border-[#2E3035] hover:bg-[#F8FAFC] dark:hover:bg-[#25282E]'
                          }`}
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-[#0F172A] dark:text-white">
                              {item.value}
                            </p>
                            <p className="text-[11px] text-[#64748B] dark:text-[#94A3B8]">
                              {item.description}
                            </p>
                          </div>
                          <span
                            className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                              active
                                ? 'border-[#1877F2] bg-[#1877F2] text-white'
                                : 'border-[#CBD5E1] dark:border-[#4B5563]'
                            }`}
                          >
                            {active && <Check className="w-3 h-3" />}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  <div>
                    <label
                      htmlFor="profile-report-details"
                      className="block text-xs font-medium text-[#475569] dark:text-[#94A3B8] mb-1"
                    >
                      Additional details (optional)
                    </label>
                    <textarea
                      id="profile-report-details"
                      rows={2}
                      maxLength={500}
                      value={reportDetails}
                      onChange={(e) => setReportDetails(e.target.value)}
                      placeholder="Add context to help review this report..."
                      className="w-full px-3 py-2 rounded-xl bg-[#F8FAFC] dark:bg-[#121417] border border-[#D1D5DB] dark:border-[#374151] text-xs text-[#0F172A] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1877F2]"
                    />
                  </div>

                  <div className="flex items-center justify-end gap-2.5 pt-1">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setMode('menu')}
                      className="px-4 h-10 rounded-xl bg-[#F1F5F9] dark:bg-[#2A2D32] hover:bg-[#E2E8F0] dark:hover:bg-[#35383E] text-sm font-semibold text-[#0F172A] dark:text-white cursor-pointer"
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      disabled={!selectedReason || busy}
                      onClick={handleSubmitReport}
                      className="inline-flex items-center gap-2 px-5 h-10 rounded-xl bg-[#1877F2] hover:bg-[#166FE5] text-white text-sm font-semibold disabled:opacity-50 cursor-pointer"
                    >
                      {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                      <span>{busy ? 'Submitting...' : 'Submit Report'}</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
