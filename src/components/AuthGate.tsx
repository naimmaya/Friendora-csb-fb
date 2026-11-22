import {useEffect, useState} from 'react';
import type {FormEvent, MouseEvent} from 'react';
import type {ConfirmationResult, User as FirebaseUser} from 'firebase/auth';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Mail,
  MailCheck,
  Moon,
  Phone,
  RefreshCw,
  ShieldCheck,
  Sun,
  X,
} from 'lucide-react';
import {
  listVaultAccounts,
  removeVaultAccount,
  saveAccountToVault,
  type VaultAccountRecord,
} from '../lib/accountVault';
import {PRESET_COVERS} from '../lib/assets';
import {COUNTRY_CODES, validateRealEmail, validateRealPhone} from '../lib/contactValidation';
import {
  checkCurrentUserEmailVerified,
  clearPhoneRecaptcha,
  FIREBASE_CONSOLE_AUTH_URL,
  formatFirestoreErrorMessage,
  registerWithEmailAndSendVerification,
  resendCurrentUserEmailVerification,
  sendFirebasePasswordReset,
  sendFirebasePhoneOtp,
  signInWithEmailFirebase,
  signInWithGooglePopup,
  signOutFirebase,
} from '../lib/firebase';
import {ensureAndLoadUserProfile} from '../lib/firestoreStore';
import type {AuthView, UserProfile} from '../types';
import {Avatar, CoverImage} from './MediaImage';

interface AuthGateProps {
  authView: AuthView;
  resetTokenFromUrl: string;
  pendingVerificationUser?: FirebaseUser | null;
  onPendingVerificationChange?: (user: FirebaseUser | null) => void;
  onNavigateAuth: (view: AuthView, query?: string) => void;
  onAuthenticated: (user: UserProfile, token: string) => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.2-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09c.95-2.85 3.6-4.96 6.73-4.96z"
      />
    </svg>
  );
}

function getFirebaseErrorCode(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err) {
    return String((err as {code?: unknown}).code || '');
  }
  return '';
}

function mapFirebaseAuthError(err: unknown): {message: string; needsProviderEnable?: 'email' | 'phone'} {
  const code = getFirebaseErrorCode(err);
  switch (code) {
    case 'auth/operation-not-allowed':
      return {
        message:
          'Email/Password sign-in is not turned on in your Firebase project yet. Turn it on in Firebase Console (takes 10 seconds), or use Continue with Google below.',
        needsProviderEnable: 'email',
      };
    case 'auth/email-already-in-use':
      return {
        message:
          'An account with this email already exists. Switch to Sign In and log in with your email and password.',
      };
    case 'auth/invalid-email':
      return {message: 'Please enter a valid real email address (e.g. name@gmail.com).'};
    case 'auth/weak-password':
      return {message: 'Password must be at least 6 characters long.'};
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return {message: 'Invalid email or password. Check your credentials or reset your password.'};
    case 'auth/too-many-requests':
      return {message: 'Too many attempts. Please wait a minute and try again.'};
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return {message: 'Google sign-in popup was closed before finishing.'};
    case 'auth/popup-blocked':
      return {message: 'Browser blocked the Google sign-in popup. Please allow popups and try again.'};
    case 'auth/network-request-failed':
      return {message: 'Network error contacting Firebase. Check your internet connection.'};
    default:
      return {message: formatFirestoreErrorMessage(err)};
  }
}

export function AuthGate({
  authView,
  pendingVerificationUser,
  onPendingVerificationChange,
  onNavigateAuth,
  onAuthenticated,
  theme,
  onToggleTheme,
}: AuthGateProps) {
  // Login state
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [savedAccounts, setSavedAccounts] = useState<VaultAccountRecord[]>([]);

  // Signup state
  const [regMode, setRegMode] = useState<'email' | 'phone'>('email');
  const [regCountryCode, setRegCountryCode] = useState('+880');
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [showRegPassword, setShowRegPassword] = useState(false);

  // Email verification gate state ("Check Gmail, code/link sent")
  const [verifyingEmailUser, setVerifyingEmailUser] = useState<FirebaseUser | null>(
    pendingVerificationUser || null,
  );
  const [pendingName, setPendingName] = useState('');
  const [checkingVerified, setCheckingVerified] = useState(false);
  const [resendingEmail, setResendingEmail] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [verifyInfo, setVerifyInfo] = useState<string | null>(null);

  // Phone OTP state
  const [phoneOtpSentTo, setPhoneOtpSentTo] = useState('');
  const [phoneConfirm, setPhoneConfirm] = useState<ConfirmationResult | null>(null);
  const [phoneCode, setPhoneCode] = useState('');
  const [sendingPhoneCode, setSendingPhoneCode] = useState(false);
  const [verifyingPhoneCode, setVerifyingPhoneCode] = useState(false);

  // Forgot password state
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotSentMsg, setForgotSentMsg] = useState<string | null>(null);

  // Shared UI state
  const [loading, setLoading] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [providerHelp, setProviderHelp] = useState<'email' | 'phone' | null>(null);

  useEffect(() => {
    setVerifyingEmailUser(pendingVerificationUser || null);
  }, [pendingVerificationUser]);

  // Automatically re-check verification when user returns from Gmail tab/app
  useEffect(() => {
    if (!verifyingEmailUser) return;
    let active = true;
    const handleReturn = async () => {
      if (!active || document.visibilityState === 'hidden') return;
      try {
        const {verified, user, idToken} = await checkCurrentUserEmailVerified();
        if (active && verified) {
          await finalizeVerifiedUser(
            user,
            idToken,
            'email_otp',
            pendingName || user.displayName || undefined,
          );
        }
      } catch {
        // User can always click "I Verified" manually
      }
    };
    window.addEventListener('focus', handleReturn);
    document.addEventListener('visibilitychange', handleReturn);
    return () => {
      active = false;
      window.removeEventListener('focus', handleReturn);
      document.removeEventListener('visibilitychange', handleReturn);
    };
  }, [verifyingEmailUser, pendingName]);

  useEffect(() => {
    listVaultAccounts()
      .then((accounts) => setSavedAccounts(accounts))
      .catch(() => setSavedAccounts([]));
    return () => {
      clearPhoneRecaptcha();
    };
  }, []);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = window.setInterval(() => {
      setResendCooldown((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [resendCooldown]);

  useEffect(() => {
    setError(null);
    setProviderHelp(null);
    setForgotSentMsg(null);
  }, [authView]);

  async function finalizeVerifiedUser(
    fbUser: FirebaseUser,
    idToken: string,
    authMethod: 'google' | 'email_otp' | 'phone_otp',
    nameOverride?: string,
  ) {
    // Load existing profile or write initial profile to Cloud Firestore FIRST!
    const profile = await ensureAndLoadUserProfile(fbUser, {
      name: nameOverride || fbUser.displayName || undefined,
      authMethod,
    });
    await saveAccountToVault({
      user: profile,
      authMethod,
      firebaseUid: fbUser.uid,
      sessionToken: idToken,
    }).catch(() => {});
    setVerifyingEmailUser(null);
    onPendingVerificationChange?.(null);
    onAuthenticated(profile, idToken);
  }

  // ---- EMAIL + PASSWORD SIGN IN (FIREBASE AUTH + VERIFIED GATE) ----
  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setProviderHelp(null);

    const emailCheck = validateRealEmail(loginEmail);
    if (!emailCheck.valid) {
      setError(emailCheck.error);
      return;
    }
    if (!loginPassword) {
      setError('Enter your password.');
      return;
    }

    setLoading(true);
    try {
      const {user, emailVerified, idToken} = await signInWithEmailFirebase(
        emailCheck.email,
        loginPassword,
      );

      // STRICT GATE: Block app entry until emailVerified === true
      if (!emailVerified) {
        setVerifyingEmailUser(user);
        onPendingVerificationChange?.(user);
        setVerifyInfo(
          `Your Gmail (${user.email}) is not verified yet. Open the verification link in Gmail, or click "Resend Code" below.`,
        );
        return;
      }

      await finalizeVerifiedUser(user, idToken, 'email_otp');
    } catch (err) {
      const mapped = mapFirebaseAuthError(err);
      setError(mapped.message);
      if (mapped.needsProviderEnable) setProviderHelp(mapped.needsProviderEnable);
    } finally {
      setLoading(false);
    }
  }

  // ---- CREATE ACCOUNT WITH EMAIL + PASSWORD -> SEND FIREBASE EMAIL VERIFICATION ----
  async function handleEmailRegister(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setProviderHelp(null);

    const trimmedName = regName.trim();
    if (trimmedName.length < 2) {
      setError('Please enter your full name (at least 2 characters).');
      return;
    }

    const emailCheck = validateRealEmail(regEmail);
    if (!emailCheck.valid) {
      setError(emailCheck.error);
      return;
    }

    if (regPassword.length < 6) {
      setError('Password must be at least 6 characters long.');
      return;
    }

    setLoading(true);
    try {
      const {user} = await registerWithEmailAndSendVerification(
        emailCheck.email,
        regPassword,
        trimmedName,
      );
      setPendingName(trimmedName);
      setVerifyingEmailUser(user);
      onPendingVerificationChange?.(user);
      setResendCooldown(30);
      setVerifyInfo(
        `Verification link sent to ${emailCheck.email}. Open your Gmail Inbox (or Spam folder), click the link, then tap "I Verified" below.`,
      );
    } catch (err) {
      const mapped = mapFirebaseAuthError(err);
      setError(mapped.message);
      if (mapped.needsProviderEnable) setProviderHelp(mapped.needsProviderEnable);
    } finally {
      setLoading(false);
    }
  }

  // ---- "I VERIFIED" BUTTON ON CHECK GMAIL SCREEN ----
  async function handleConfirmEmailVerified() {
    setError(null);
    setCheckingVerified(true);
    try {
      const {verified, user, idToken} = await checkCurrentUserEmailVerified();
      if (!verified) {
        setError(
          'Email is not verified yet. Please open the verification email in your Gmail Inbox/Spam, click the verification link, and then tap "I Verified" again.',
        );
        return;
      }

      await finalizeVerifiedUser(
        user,
        idToken,
        'email_otp',
        pendingName || user.displayName || undefined,
      );
    } catch (err) {
      setError(formatFirestoreErrorMessage(err));
    } finally {
      setCheckingVerified(false);
    }
  }

  // ---- "RESEND CODE" BUTTON ON CHECK GMAIL SCREEN ----
  async function handleResendEmailVerification() {
    if (resendCooldown > 0 || resendingEmail) return;
    setError(null);
    setResendingEmail(true);
    try {
      await resendCurrentUserEmailVerification();
      setResendCooldown(30);
      setVerifyInfo(
        `Fresh verification link resent to ${verifyingEmailUser?.email || 'your Gmail'}. Check Inbox and Spam.`,
      );
    } catch (err) {
      const mapped = mapFirebaseAuthError(err);
      setError(mapped.message);
    } finally {
      setResendingEmail(false);
    }
  }

  async function handleCancelPendingVerification() {
    await signOutFirebase();
    setVerifyingEmailUser(null);
    onPendingVerificationChange?.(null);
    setVerifyInfo(null);
    setError(null);
  }

  // ---- GOOGLE SIGN-IN / VERIFIED SIGN-UP (INSTANT) ----
  async function handleGoogleAuth() {
    setError(null);
    setProviderHelp(null);
    setGoogleBusy(true);
    try {
      const {user, idToken} = await signInWithGooglePopup();
      if (!user.emailVerified) {
        setError('Your Google account must have a verified email address.');
        return;
      }
      await finalizeVerifiedUser(user, idToken, 'google', regName.trim() || undefined);
    } catch (err) {
      const mapped = mapFirebaseAuthError(err);
      setError(mapped.message);
    } finally {
      setGoogleBusy(false);
    }
  }

  // ---- PHONE OTP (FIREBASE PHONE AUTH) ----
  async function handleSendPhoneCode() {
    setError(null);
    setProviderHelp(null);
    const phoneCheck = validateRealPhone(regPhone, regCountryCode);
    if (!phoneCheck.valid) {
      setError(phoneCheck.error);
      return;
    }

    setSendingPhoneCode(true);
    try {
      const confirmation = await sendFirebasePhoneOtp(
        phoneCheck.phone,
        'firebase-recaptcha-container',
      );
      setPhoneConfirm(confirmation);
      setPhoneOtpSentTo(phoneCheck.phone);
      setPhoneCode('');
      setResendCooldown(30);
    } catch (err) {
      const code = getFirebaseErrorCode(err);
      if (
        code === 'auth/operation-not-allowed' ||
        code === 'auth/billing-not-enabled' ||
        code === 'auth/configuration-not-found'
      ) {
        setProviderHelp('phone');
        setError(
          'Firebase Phone SMS Auth is not enabled yet. Enable Phone provider in Firebase Console, or create your account with Gmail instead.',
        );
      } else {
        setError(mapFirebaseAuthError(err).message);
      }
    } finally {
      setSendingPhoneCode(false);
    }
  }

  async function handleVerifyPhoneCode(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!phoneConfirm) {
      setError('Click "Send Code" first to receive your SMS verification code.');
      return;
    }
    const clean = phoneCode.replace(/\s+/g, '');
    if (!/^\d{6}$/.test(clean)) {
      setError('Enter the 6-digit SMS code sent to your phone.');
      return;
    }
    setVerifyingPhoneCode(true);
    try {
      const cred = await phoneConfirm.confirm(clean);
      const idToken = await cred.user.getIdToken(true);
      await finalizeVerifiedUser(cred.user, idToken, 'phone_otp', regName.trim() || undefined);
    } catch (err) {
      const code = getFirebaseErrorCode(err);
      if (code === 'auth/invalid-verification-code') {
        setError('Incorrect 6-digit SMS code. Check your message and try again.');
      } else if (code === 'auth/code-expired') {
        setError('Code expired. Click "Send Code" to request a fresh SMS code.');
      } else {
        setError(formatFirestoreErrorMessage(err));
      }
    } finally {
      setVerifyingPhoneCode(false);
    }
  }

  // ---- FORGOT PASSWORD (REAL FIREBASE EMAIL RESET) ----
  async function handleForgotSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setForgotSentMsg(null);
    const check = validateRealEmail(forgotEmail);
    if (!check.valid) {
      setError(check.error);
      return;
    }
    setLoading(true);
    try {
      await sendFirebasePasswordReset(check.email);
      setForgotSentMsg(
        `Password reset email sent to ${check.email}. Check your Gmail Inbox or Spam folder to set a new password.`,
      );
    } catch (err) {
      setError(mapFirebaseAuthError(err).message);
    } finally {
      setLoading(false);
    }
  }

  function handleSelectSavedAccount(acc: VaultAccountRecord) {
    setError(null);
    if (acc.email) {
      setLoginEmail(acc.email);
    }
    if (acc.authMethod === 'google') {
      void handleGoogleAuth();
      return;
    }
    window.setTimeout(() => {
      document.getElementById('login-password')?.focus();
    }, 40);
  }

  async function handleRemoveSavedAccount(e: MouseEvent, vaultId: string) {
    e.stopPropagation();
    await removeVaultAccount(vaultId).catch(() => {});
    setSavedAccounts((prev) => prev.filter((item) => item.id !== vaultId));
  }

  const regStrength = (() => {
    if (!regPassword) return 0;
    let s = 0;
    if (regPassword.length >= 6) s++;
    if (regPassword.length >= 10) s++;
    if (/[A-Z]/.test(regPassword) && /[a-z]/.test(regPassword)) s++;
    if (/\d/.test(regPassword) && /[^A-Za-z0-9]/.test(regPassword)) s++;
    return Math.min(4, Math.max(1, s));
  })();

  const selectedCountry =
    COUNTRY_CODES.find((c) => c.code === regCountryCode) || COUNTRY_CODES[0];

  return (
    <div className="min-h-screen bg-[#F4F6F9] dark:bg-[#0E1014] text-[#0F172A] dark:text-[#F1F5F9] flex flex-col">
      <div id="firebase-recaptcha-container" className="hidden" />

      {/* Minimal clean entry top bar */}
      <header className="w-full border-b border-[#E5E8EE] dark:border-[#252A34] bg-white/90 dark:bg-[#16191F]/90 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-8">
          <button
            type="button"
            onClick={() => onNavigateAuth('login')}
            className="text-2xl font-display font-extrabold tracking-tight text-[#1877F2] dark:text-[#3B82F6] whitespace-nowrap shrink-0 cursor-pointer"
          >
            Verve
          </button>

          {!verifyingEmailUser && (
            <nav className="hidden sm:flex items-center gap-6 text-sm font-medium text-[#4B5563] dark:text-[#9CA3AF]">
              <button
                type="button"
                onClick={() => onNavigateAuth('login')}
                className={`hover:text-[#111827] dark:hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  authView === 'login' ? 'text-[#1877F2] dark:text-[#3B82F6] font-semibold' : ''
                }`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => onNavigateAuth('register')}
                className={`hover:text-[#111827] dark:hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  authView === 'register' ? 'text-[#1877F2] dark:text-[#3B82F6] font-semibold' : ''
                }`}
              >
                Create Account
              </button>
              <button
                type="button"
                onClick={() => onNavigateAuth('forgot-password')}
                className={`hover:text-[#111827] dark:hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  authView === 'forgot-password'
                    ? 'text-[#1877F2] dark:text-[#3B82F6] font-semibold'
                    : ''
                }`}
              >
                Password Recovery
              </button>
            </nav>
          )}

          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium text-[#374151] dark:text-[#D1D5DB] hover:bg-[#F0F2F5] dark:hover:bg-[#2E3035] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
          </button>
        </div>
      </header>

      {/* Main 2-column entry stage */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 lg:py-14 flex items-center">
        <div className="w-full grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-stretch">
          {/* Left brand showcase */}
          <section className="lg:col-span-7 flex flex-col justify-between gap-6">
            <div className="space-y-4 max-w-xl">
              <h1
                className="text-3xl sm:text-4xl lg:text-5xl font-display font-bold tracking-tight text-[#111827] dark:text-white leading-[1.12]"
                style={{textWrap: 'balance'}}
              >
                Stay close to the people and moments that matter.
              </h1>
              <p className="text-base sm:text-lg text-[#4B5563] dark:text-[#9CA3AF] leading-relaxed">
                Verified accounts saved permanently in Cloud Firestore. Share photos, videos, real-time messages, and Messenger-style audio &amp; video calls.
              </p>
            </div>

            <div className="relative w-full aspect-[16/9] rounded-2xl overflow-hidden border border-[#E4E6EB] dark:border-[#2E3035] bg-[#1E293B]">
              <CoverImage
                src={PRESET_COVERS[0].url}
                alt="Pacific coastline overlooking minimalist architecture"
              />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-5 sm:p-6">
                <p className="text-white text-sm sm:text-base font-medium">
                  Permanent profiles, posts, friends, real-time chat, and live audio &amp; video calling.
                </p>
                <p className="text-white/75 text-xs sm:text-sm mt-1">
                  Your account stays signed in across refreshes and never loses your data.
                </p>
              </div>
            </div>
          </section>

          {/* Right auth card */}
          <section className="lg:col-span-5 flex items-center">
            <div className="w-full bg-white dark:bg-[#16191F] border border-[#E5E8EE] dark:border-[#252A34] rounded-2xl p-6 sm:p-8 shadow-[0_8px_28px_rgba(15,23,42,0.06)] dark:shadow-[0_12px_32px_rgba(0,0,0,0.35)]">
              {/* MANDATORY BLOCKING SCREEN: CHECK GMAIL, CODE/LINK SENT */}
              {verifyingEmailUser ? (
                <div className="space-y-5">
                  <div className="w-14 h-14 rounded-2xl bg-[#EFF6FF] dark:bg-[#1E3A8A]/30 text-[#1877F2] dark:text-[#60A5FA] flex items-center justify-center">
                    <MailCheck className="w-7 h-7" />
                  </div>

                  <div>
                    <h2 className="text-xl font-display font-bold text-[#111827] dark:text-white">
                      Check Gmail, code/link sent
                    </h2>
                    <p className="text-sm text-[#4B5563] dark:text-[#9CA3AF] mt-1.5 leading-relaxed">
                      We sent a Firebase verification email to{' '}
                      <strong className="text-[#111827] dark:text-white">
                        {verifyingEmailUser.email}
                      </strong>
                      . Open Gmail (check Spam/Promotions too), click the verification link, and then press{' '}
                      <strong className="text-[#111827] dark:text-white">I Verified</strong> below to enter the app.
                    </p>
                  </div>

                  {verifyInfo && (
                    <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-[#ECFDF5] dark:bg-[#0F2E22] border border-[#A7F3D0] dark:border-[#166534] text-[#065F46] dark:text-[#A7F3D0] text-xs leading-relaxed">
                      <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-[#16A34A] dark:text-[#4ADE80]" />
                      <span>{verifyInfo}</span>
                    </div>
                  )}

                  {error && (
                    <div
                      role="alert"
                      className="flex items-start gap-2.5 p-3.5 rounded-xl bg-[#FEF2F2] dark:bg-[#3B181A] border border-[#FECACA] dark:border-[#7F1D1D] text-[#B91C1C] dark:text-[#FCA5A5] text-sm"
                    >
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{error}</span>
                    </div>
                  )}

                  <div className="space-y-2.5 pt-1">
                    <button
                      type="button"
                      disabled={checkingVerified}
                      onClick={handleConfirmEmailVerified}
                      className="w-full h-11 rounded-xl bg-[#1877F2] hover:bg-[#166FE5] dark:bg-[#2563EB] dark:hover:bg-[#1D4ED8] text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60 transition-colors cursor-pointer"
                    >
                      {checkingVerified ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <ShieldCheck className="w-4 h-4" />
                      )}
                      <span>{checkingVerified ? 'Checking Gmail Verification...' : 'I Verified'}</span>
                    </button>

                    <button
                      type="button"
                      disabled={resendCooldown > 0 || resendingEmail}
                      onClick={handleResendEmailVerification}
                      className="w-full h-11 rounded-xl bg-[#F4F6F9] dark:bg-[#232732] hover:bg-[#E5E8EE] dark:hover:bg-[#2D3342] text-[#0F172A] dark:text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50 transition-colors cursor-pointer"
                    >
                      {resendingEmail ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <RefreshCw className="w-4 h-4" />
                      )}
                      <span>
                        {resendCooldown > 0
                          ? `Resend Code (${resendCooldown}s)`
                          : 'Resend Code'}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={handleCancelPendingVerification}
                      className="w-full py-2 text-xs font-medium text-[#64748B] dark:text-[#94A3B8] hover:text-[#0F172A] dark:hover:text-white transition-colors cursor-pointer"
                    >
                      Sign out and use a different email
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {/* Switcher between Sign In and Create Account */}
                  {(authView === 'login' || authView === 'register') && (
                    <div
                      role="tablist"
                      aria-label="Authentication mode"
                      className="grid grid-cols-2 gap-1 p-1 mb-6 rounded-xl bg-[#F0F2F5] dark:bg-[#121316]"
                    >
                      <button
                        type="button"
                        role="tab"
                        aria-selected={authView === 'login'}
                        onClick={() => onNavigateAuth('login')}
                        className={`py-2.5 px-4 text-sm font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                          authView === 'login'
                            ? 'bg-white dark:bg-[#2A2D32] text-[#111827] dark:text-white shadow-xs'
                            : 'text-[#65676B] dark:text-[#9CA3AF] hover:text-[#111827] dark:hover:text-white'
                        }`}
                      >
                        Sign In
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={authView === 'register'}
                        onClick={() => onNavigateAuth('register')}
                        className={`py-2.5 px-4 text-sm font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                          authView === 'register'
                            ? 'bg-white dark:bg-[#2A2D32] text-[#111827] dark:text-white shadow-xs'
                            : 'text-[#65676B] dark:text-[#9CA3AF] hover:text-[#111827] dark:hover:text-white'
                        }`}
                      >
                        Create Account
                      </button>
                    </div>
                  )}

                  {/* Error banner */}
                  {error && (
                    <div
                      role="alert"
                      className="mb-4 flex items-start gap-2.5 p-3.5 rounded-xl bg-[#FEF2F2] dark:bg-[#3B181A] border border-[#FECACA] dark:border-[#7F1D1D] text-[#B91C1C] dark:text-[#FCA5A5] text-sm"
                    >
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <div className="space-y-2 flex-1">
                        <p>{error}</p>
                        {providerHelp && (
                          <a
                            href={FIREBASE_CONSOLE_AUTH_URL}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 text-xs font-semibold underline text-[#B91C1C] dark:text-[#FCA5A5]"
                          >
                            <span>
                              Open Firebase Sign-in Providers ({providerHelp === 'email' ? 'Email/Password' : 'Phone'})
                            </span>
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        )}
                      </div>
                    </div>
                  )}

                  {/* VIEW 1: SIGN IN */}
                  {authView === 'login' && (
                    <form onSubmit={handleLogin} className="space-y-4">
                      <div>
                        <h2 className="text-xl font-display font-bold text-[#111827] dark:text-white">
                          Welcome back
                        </h2>
                        <p className="text-sm text-[#65676B] dark:text-[#9CA3AF] mt-1">
                          Sign in with your verified Gmail and password, or Continue with Google.
                        </p>
                      </div>

                      {savedAccounts.length > 0 && (
                        <div className="space-y-2 pb-1">
                          <p className="text-xs font-semibold uppercase tracking-wider text-[#65676B] dark:text-[#9CA3AF]">
                            Recent accounts ({savedAccounts.length})
                          </p>
                          <div className="space-y-1.5 max-h-40 overflow-y-auto pr-0.5">
                            {savedAccounts.map((acc) => (
                              <div
                                key={acc.id}
                                onClick={() => handleSelectSavedAccount(acc)}
                                role="button"
                                tabIndex={0}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    handleSelectSavedAccount(acc);
                                  }
                                }}
                                className="w-full px-3 py-2 rounded-xl bg-[#F8F9FA] dark:bg-[#121316] hover:bg-[#EFF6FF] dark:hover:bg-[#1E2430] border border-[#E5E8EE] dark:border-[#252A34] flex items-center justify-between gap-2.5 transition-colors cursor-pointer"
                              >
                                <div className="flex items-center gap-2.5 min-w-0">
                                  <Avatar src={acc.avatar_url} name={acc.name} size="sm" />
                                  <div className="min-w-0">
                                    <p className="text-sm font-semibold text-[#111827] dark:text-white truncate">
                                      {acc.name}
                                    </p>
                                    <p className="text-xs text-[#65676B] dark:text-[#9CA3AF] truncate">
                                      {acc.email || acc.phone || 'Verified account'}
                                    </p>
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  title="Remove from list"
                                  aria-label={`Remove ${acc.name}`}
                                  onClick={(e) => handleRemoveSavedAccount(e, acc.id)}
                                  className="p-1 rounded-full text-[#94A3B8] hover:text-[#DC2626] hover:bg-[#FEE2E2] dark:hover:bg-[#3B181A] transition-colors cursor-pointer"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div>
                        <label
                          htmlFor="login-email"
                          className="block text-sm font-medium text-[#374151] dark:text-[#D1D5DB] mb-1.5"
                        >
                          Real Gmail / Email
                        </label>
                        <input
                          id="login-email"
                          type="email"
                          required
                          autoComplete="email"
                          value={loginEmail}
                          onChange={(e) => setLoginEmail(e.target.value)}
                          placeholder="name@gmail.com"
                          className="w-full h-11 px-3.5 rounded-xl bg-[#F8FAFC] dark:bg-[#0E1014] border border-[#CBD5E1] dark:border-[#2D3342] text-sm text-[#0F172A] dark:text-white placeholder:text-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#1877F2]"
                        />
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <label
                            htmlFor="login-password"
                            className="block text-sm font-medium text-[#374151] dark:text-[#D1D5DB]"
                          >
                            Password
                          </label>
                          <button
                            type="button"
                            onClick={() => onNavigateAuth('forgot-password')}
                            className="text-xs font-semibold text-[#1877F2] dark:text-[#60A5FA] hover:underline cursor-pointer"
                          >
                            Forgot password?
                          </button>
                        </div>
                        <div className="relative">
                          <input
                            id="login-password"
                            type={showLoginPassword ? 'text' : 'password'}
                            required
                            autoComplete="current-password"
                            value={loginPassword}
                            onChange={(e) => setLoginPassword(e.target.value)}
                            placeholder="Enter your password"
                            className="w-full h-11 pl-3.5 pr-11 rounded-xl bg-[#F8FAFC] dark:bg-[#0E1014] border border-[#CBD5E1] dark:border-[#2D3342] text-sm text-[#0F172A] dark:text-white placeholder:text-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#1877F2]"
                          />
                          <button
                            type="button"
                            onClick={() => setShowLoginPassword((v) => !v)}
                            aria-label={showLoginPassword ? 'Hide password' : 'Show password'}
                            className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-[#64748B] dark:text-[#94A3B8] cursor-pointer"
                          >
                            {showLoginPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>

                      <button
                        type="submit"
                        disabled={loading || googleBusy}
                        className="w-full h-11 rounded-xl bg-[#1877F2] hover:bg-[#166FE5] dark:bg-[#2563EB] dark:hover:bg-[#1D4ED8] text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60 transition-colors cursor-pointer"
                      >
                        {loading ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <ArrowRight className="w-4 h-4" />
                        )}
                        <span>{loading ? 'Signing in...' : 'Sign In'}</span>
                      </button>

                      <div className="relative py-1">
                        <div className="absolute inset-0 flex items-center">
                          <div className="w-full border-t border-[#E5E8EE] dark:border-[#252A34]" />
                        </div>
                        <div className="relative flex justify-center text-xs">
                          <span className="px-2.5 bg-white dark:bg-[#16191F] text-[#64748B] dark:text-[#94A3B8]">
                            or
                          </span>
                        </div>
                      </div>

                      <button
                        type="button"
                        disabled={loading || googleBusy}
                        onClick={handleGoogleAuth}
                        className="w-full h-11 rounded-xl bg-white dark:bg-[#1E222A] hover:bg-[#F8FAFC] dark:hover:bg-[#262B35] border border-[#CBD5E1] dark:border-[#334155] text-sm font-semibold text-[#0F172A] dark:text-white flex items-center justify-center gap-2.5 disabled:opacity-60 transition-colors cursor-pointer"
                      >
                        {googleBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <GoogleMark />}
                        <span>{googleBusy ? 'Connecting Google...' : 'Continue with Google'}</span>
                      </button>

                      <p className="text-center text-xs text-[#64748B] dark:text-[#94A3B8] pt-1">
                        New to Verve?{' '}
                        <button
                          type="button"
                          onClick={() => onNavigateAuth('register')}
                          className="font-semibold text-[#1877F2] dark:text-[#60A5FA] hover:underline cursor-pointer"
                        >
                          Create a verified account
                        </button>
                      </p>
                    </form>
                  )}

                  {/* VIEW 2: CREATE VERIFIED ACCOUNT */}
                  {authView === 'register' && (
                    <div className="space-y-4">
                      <div>
                        <h2 className="text-xl font-display font-bold text-[#111827] dark:text-white">
                          Create verified account
                        </h2>
                        <p className="text-sm text-[#65676B] dark:text-[#9CA3AF] mt-1">
                          Sign up with your real Gmail (Firebase sends a verification link) or Phone OTP.
                        </p>
                      </div>

                      {/* Email vs Phone mode toggle */}
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-[#4B5563] dark:text-[#9CA3AF]">
                          Verify with:
                        </span>
                        <div className="inline-flex rounded-lg bg-[#F0F2F5] dark:bg-[#121316] p-0.5">
                          <button
                            type="button"
                            onClick={() => {
                              setRegMode('email');
                              setError(null);
                              setProviderHelp(null);
                            }}
                            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                              regMode === 'email'
                                ? 'bg-white dark:bg-[#2A2D32] text-[#0F172A] dark:text-white shadow-xs'
                                : 'text-[#64748B] dark:text-[#94A3B8]'
                            }`}
                          >
                            <Mail className="w-3.5 h-3.5" />
                            <span>Gmail / Email</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setRegMode('phone');
                              setError(null);
                              setProviderHelp(null);
                            }}
                            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                              regMode === 'phone'
                                ? 'bg-white dark:bg-[#2A2D32] text-[#0F172A] dark:text-white shadow-xs'
                                : 'text-[#64748B] dark:text-[#94A3B8]'
                            }`}
                          >
                            <Phone className="w-3.5 h-3.5" />
                            <span>Phone SMS</span>
                          </button>
                        </div>
                      </div>

                      {regMode === 'email' ? (
                        <form onSubmit={handleEmailRegister} className="space-y-3.5">
                          <div>
                            <label
                              htmlFor="reg-name"
                              className="block text-sm font-medium text-[#374151] dark:text-[#D1D5DB] mb-1.5"
                            >
                              Full Name
                            </label>
                            <input
                              id="reg-name"
                              type="text"
                              required
                              minLength={2}
                              maxLength={60}
                              value={regName}
                              onChange={(e) => setRegName(e.target.value)}
                              placeholder="Your full name"
                              className="w-full h-11 px-3.5 rounded-xl bg-[#F8FAFC] dark:bg-[#0E1014] border border-[#CBD5E1] dark:border-[#2D3342] text-sm text-[#0F172A] dark:text-white placeholder:text-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#1877F2]"
                            />
                          </div>

                          <div>
                            <label
                              htmlFor="reg-email"
                              className="block text-sm font-medium text-[#374151] dark:text-[#D1D5DB] mb-1.5"
                            >
                              Real Gmail / Email
                            </label>
                            <input
                              id="reg-email"
                              type="email"
                              required
                              autoComplete="email"
                              value={regEmail}
                              onChange={(e) => setRegEmail(e.target.value)}
                              placeholder="name@gmail.com"
                              className="w-full h-11 px-3.5 rounded-xl bg-[#F8FAFC] dark:bg-[#0E1014] border border-[#CBD5E1] dark:border-[#2D3342] text-sm text-[#0F172A] dark:text-white placeholder:text-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#1877F2]"
                            />
                          </div>

                          <div>
                            <label
                              htmlFor="reg-password"
                              className="block text-sm font-medium text-[#374151] dark:text-[#D1D5DB] mb-1.5"
                            >
                              Password
                            </label>
                            <div className="relative">
                              <input
                                id="reg-password"
                                type={showRegPassword ? 'text' : 'password'}
                                required
                                minLength={6}
                                autoComplete="new-password"
                                value={regPassword}
                                onChange={(e) => setRegPassword(e.target.value)}
                                placeholder="Create a password (min 6 chars)"
                                className="w-full h-11 pl-3.5 pr-11 rounded-xl bg-[#F8FAFC] dark:bg-[#0E1014] border border-[#CBD5E1] dark:border-[#2D3342] text-sm text-[#0F172A] dark:text-white placeholder:text-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#1877F2]"
                              />
                              <button
                                type="button"
                                onClick={() => setShowRegPassword((v) => !v)}
                                aria-label={showRegPassword ? 'Hide password' : 'Show password'}
                                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-[#64748B] dark:text-[#94A3B8] cursor-pointer"
                              >
                                {showRegPassword ? (
                                  <EyeOff className="w-4 h-4" />
                                ) : (
                                  <Eye className="w-4 h-4" />
                                )}
                              </button>
                            </div>
                            {regPassword && (
                              <div className="grid grid-cols-4 gap-1.5 mt-2">
                                {[1, 2, 3, 4].map((step) => (
                                  <div
                                    key={step}
                                    className={`h-1 rounded-full transition-colors ${
                                      regStrength >= step
                                        ? regStrength <= 1
                                          ? 'bg-red-500'
                                          : regStrength === 2
                                            ? 'bg-amber-500'
                                            : 'bg-emerald-500'
                                        : 'bg-[#E5E8EE] dark:bg-[#252A34]'
                                    }`}
                                  />
                                ))}
                              </div>
                            )}
                          </div>

                          <button
                            type="submit"
                            disabled={loading || googleBusy}
                            className="w-full h-11 rounded-xl bg-[#1877F2] hover:bg-[#166FE5] dark:bg-[#2563EB] dark:hover:bg-[#1D4ED8] text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60 transition-colors cursor-pointer"
                          >
                            {loading ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <MailCheck className="w-4 h-4" />
                            )}
                            <span>
                              {loading
                                ? 'Creating & Sending Verification...'
                                : 'Create Account & Send Gmail Verification'}
                            </span>
                          </button>
                        </form>
                      ) : (
                        <form onSubmit={handleVerifyPhoneCode} className="space-y-3.5">
                          <div>
                            <label
                              htmlFor="reg-phone-name"
                              className="block text-sm font-medium text-[#374151] dark:text-[#D1D5DB] mb-1.5"
                            >
                              Full Name
                            </label>
                            <input
                              id="reg-phone-name"
                              type="text"
                              required
                              minLength={2}
                              maxLength={60}
                              value={regName}
                              onChange={(e) => setRegName(e.target.value)}
                              placeholder="Your full name"
                              className="w-full h-11 px-3.5 rounded-xl bg-[#F8FAFC] dark:bg-[#0E1014] border border-[#CBD5E1] dark:border-[#2D3342] text-sm text-[#0F172A] dark:text-white placeholder:text-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#1877F2]"
                            />
                          </div>

                          <div>
                            <label
                              htmlFor="reg-phone"
                              className="block text-sm font-medium text-[#374151] dark:text-[#D1D5DB] mb-1.5"
                            >
                              Real Phone Number
                            </label>
                            <div className="flex items-center gap-2">
                              <select
                                value={regCountryCode}
                                onChange={(e) => setRegCountryCode(e.target.value)}
                                className="h-11 px-2.5 rounded-xl bg-[#F8FAFC] dark:bg-[#0E1014] border border-[#CBD5E1] dark:border-[#2D3342] text-xs font-semibold text-[#0F172A] dark:text-white"
                              >
                                {COUNTRY_CODES.map((c) => (
                                  <option key={c.code} value={c.code}>
                                    {c.label}
                                  </option>
                                ))}
                              </select>
                              <input
                                id="reg-phone"
                                type="tel"
                                value={regPhone}
                                onChange={(e) => setRegPhone(e.target.value)}
                                placeholder={selectedCountry.placeholder}
                                className="flex-1 min-w-0 h-11 px-3 rounded-xl bg-[#F8FAFC] dark:bg-[#0E1014] border border-[#CBD5E1] dark:border-[#2D3342] text-sm text-[#0F172A] dark:text-white placeholder:text-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#1877F2]"
                              />
                              <button
                                type="button"
                                disabled={sendingPhoneCode || resendCooldown > 0}
                                onClick={handleSendPhoneCode}
                                className="h-11 px-3.5 rounded-xl bg-[#1877F2] hover:bg-[#166FE5] text-white text-xs font-semibold whitespace-nowrap disabled:opacity-50 cursor-pointer"
                              >
                                {sendingPhoneCode
                                  ? 'Sending...'
                                  : resendCooldown > 0
                                    ? `${resendCooldown}s`
                                    : 'Send Code'}
                              </button>
                            </div>
                          </div>

                          {phoneConfirm && (
                            <div className="space-y-2.5 p-3.5 rounded-xl bg-[#F8FAFC] dark:bg-[#0E1014] border border-[#E5E8EE] dark:border-[#252A34]">
                              <p className="text-xs text-[#065F46] dark:text-[#6EE7B7] font-medium">
                                SMS code sent to {phoneOtpSentTo}. Enter it below:
                              </p>
                              <div className="flex items-center gap-2">
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  maxLength={6}
                                  value={phoneCode}
                                  onChange={(e) => setPhoneCode(e.target.value)}
                                  placeholder="Enter 6-digit code"
                                  className="flex-1 h-10 px-3 rounded-xl bg-white dark:bg-[#16191F] border border-[#CBD5E1] dark:border-[#334155] text-sm tracking-widest font-mono text-[#0F172A] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1877F2]"
                                />
                                <button
                                  type="submit"
                                  disabled={verifyingPhoneCode}
                                  className="h-10 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold disabled:opacity-50 cursor-pointer"
                                >
                                  {verifyingPhoneCode ? 'Verifying...' : 'Verify'}
                                </button>
                              </div>
                            </div>
                          )}
                        </form>
                      )}

                      <div className="relative py-1">
                        <div className="absolute inset-0 flex items-center">
                          <div className="w-full border-t border-[#E5E8EE] dark:border-[#252A34]" />
                        </div>
                        <div className="relative flex justify-center text-xs">
                          <span className="px-2.5 bg-white dark:bg-[#16191F] text-[#64748B] dark:text-[#94A3B8]">
                            or verify instantly
                          </span>
                        </div>
                      </div>

                      <button
                        type="button"
                        disabled={loading || googleBusy}
                        onClick={handleGoogleAuth}
                        className="w-full h-11 rounded-xl bg-white dark:bg-[#1E222A] hover:bg-[#F8FAFC] dark:hover:bg-[#262B35] border border-[#CBD5E1] dark:border-[#334155] text-sm font-semibold text-[#0F172A] dark:text-white flex items-center justify-center gap-2.5 disabled:opacity-60 transition-colors cursor-pointer"
                      >
                        {googleBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <GoogleMark />}
                        <span>
                          {googleBusy ? 'Verifying with Google...' : 'Continue with Google (Instant Verified)'}
                        </span>
                      </button>

                      <p className="text-center text-xs text-[#64748B] dark:text-[#94A3B8]">
                        Already have an account?{' '}
                        <button
                          type="button"
                          onClick={() => onNavigateAuth('login')}
                          className="font-semibold text-[#1877F2] dark:text-[#60A5FA] hover:underline cursor-pointer"
                        >
                          Sign In
                        </button>
                      </p>
                    </div>
                  )}

                  {/* VIEW 3: FORGOT PASSWORD */}
                  {(authView === 'forgot-password' || authView === 'reset-password') && (
                    <form onSubmit={handleForgotSubmit} className="space-y-4">
                      <button
                        type="button"
                        onClick={() => onNavigateAuth('login')}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#64748B] dark:text-[#94A3B8] hover:text-[#0F172A] dark:hover:text-white cursor-pointer"
                      >
                        <ArrowLeft className="w-3.5 h-3.5" />
                        <span>Back to Sign In</span>
                      </button>

                      <div>
                        <div className="w-11 h-11 rounded-xl bg-[#EFF6FF] dark:bg-[#1E3A8A]/30 text-[#1877F2] dark:text-[#60A5FA] flex items-center justify-center mb-3">
                          <KeyRound className="w-5 h-5" />
                        </div>
                        <h2 className="text-xl font-display font-bold text-[#111827] dark:text-white">
                          Reset your password
                        </h2>
                        <p className="text-sm text-[#65676B] dark:text-[#9CA3AF] mt-1">
                          Enter your registered Gmail address and Firebase will send a real password reset link.
                        </p>
                      </div>

                      {forgotSentMsg && (
                        <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-[#ECFDF5] dark:bg-[#0F2E22] border border-[#A7F3D0] dark:border-[#166534] text-[#065F46] dark:text-[#A7F3D0] text-xs leading-relaxed">
                          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-[#16A34A] dark:text-[#4ADE80]" />
                          <span>{forgotSentMsg}</span>
                        </div>
                      )}

                      <div>
                        <label
                          htmlFor="forgot-email"
                          className="block text-sm font-medium text-[#374151] dark:text-[#D1D5DB] mb-1.5"
                        >
                          Registered Gmail / Email
                        </label>
                        <input
                          id="forgot-email"
                          type="email"
                          required
                          value={forgotEmail}
                          onChange={(e) => setForgotEmail(e.target.value)}
                          placeholder="name@gmail.com"
                          className="w-full h-11 px-3.5 rounded-xl bg-[#F8FAFC] dark:bg-[#0E1014] border border-[#CBD5E1] dark:border-[#2D3342] text-sm text-[#0F172A] dark:text-white placeholder:text-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#1877F2]"
                        />
                      </div>

                      <button
                        type="submit"
                        disabled={loading}
                        className="w-full h-11 rounded-xl bg-[#1877F2] hover:bg-[#166FE5] text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60 transition-colors cursor-pointer"
                      >
                        {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                        <span>{loading ? 'Sending Reset Link...' : 'Send Reset Email'}</span>
                      </button>
                    </form>
                  )}
                </>
              )}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
