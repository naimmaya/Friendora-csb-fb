import {useEffect, useState} from 'react';
import type {FormEvent, MouseEvent} from 'react';
import type {ConfirmationResult, User as FirebaseUser} from 'firebase/auth';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Mail,
  Moon,
  Phone,
  ShieldCheck,
  Sun,
  X,
} from 'lucide-react';
import {
  clearVaultSessionToken,
  findVaultAccount,
  listVaultAccounts,
  removeVaultAccount,
  saveAccountToVault,
  updateVaultPasswordByIdentifier,
  verifyCredentialsInVault,
  type VaultAccountRecord,
} from '../lib/accountVault';
import {ApiError, apiRequest, fetchMeWithToken, setAuthToken} from '../lib/api';
import {PRESET_COVERS} from '../lib/assets';
import {COUNTRY_CODES, validateRealEmail, validateRealPhone} from '../lib/contactValidation';
import {
  clearPhoneRecaptcha,
  FIREBASE_CONSOLE_AUTH_URL,
  loadUserProfileFromFirestore,
  sendFirebasePhoneOtp,
  signInWithGooglePopup,
  syncUserProfileToFirestore,
  tryFirebaseEmailSignIn,
} from '../lib/firebase';
import type {AuthView, UserProfile} from '../types';
import {Avatar, CoverImage} from './MediaImage';

interface AuthGateProps {
  authView: AuthView;
  resetTokenFromUrl: string;
  onNavigateAuth: (view: AuthView, query?: string) => void;
  onAuthenticated: (user: UserProfile, token: string) => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}

type OtpStep = 'idle' | 'code_sent' | 'verified';
type OtpProvider = 'firebase' | 'server' | null;

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

export function AuthGate({
  authView,
  resetTokenFromUrl,
  onNavigateAuth,
  onAuthenticated,
  theme,
  onToggleTheme,
}: AuthGateProps) {
  // Login state
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [savedAccounts, setSavedAccounts] = useState<VaultAccountRecord[]>([]);
  const [quickEnteringId, setQuickEnteringId] = useState<string | null>(null);

  // Register state
  const [regMode, setRegMode] = useState<'email' | 'phone'>('email');
  const [regCountryCode, setRegCountryCode] = useState('+880');
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [showRegPassword, setShowRegPassword] = useState(false);

  // Real OTP verification state
  const [otpStep, setOtpStep] = useState<OtpStep>('idle');
  const [otpProvider, setOtpProvider] = useState<OtpProvider>(null);
  const [otpCode, setOtpCode] = useState('');
  const [otpChallengeId, setOtpChallengeId] = useState<string | null>(null);
  const [otpSentTo, setOtpSentTo] = useState<string>('');
  const [otpInfo, setOtpInfo] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [firebasePhoneConfirm, setFirebasePhoneConfirm] = useState<ConfirmationResult | null>(null);
  const [verifiedServerToken, setVerifiedServerToken] = useState<string | null>(null);
  const [verifiedFirebaseToken, setVerifiedFirebaseToken] = useState<string | null>(null);
  const [verifiedFirebaseUser, setVerifiedFirebaseUser] = useState<FirebaseUser | null>(null);
  const [verifiedContact, setVerifiedContact] = useState<string | null>(null);
  const [verifiedMethod, setVerifiedMethod] = useState<'google' | 'email_otp' | 'phone_otp'>(
    'email_otp',
  );
  const [setupNotice, setSetupNotice] = useState<'email' | 'phone' | null>(null);
  const [sendingCode, setSendingCode] = useState(false);
  const [verifyingCode, setVerifyingCode] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [emailOtpReady, setEmailOtpReady] = useState(false);

  // Forgot password state
  const [forgotIdentifier, setForgotIdentifier] = useState('');
  const [lastForgotIdentifier, setLastForgotIdentifier] = useState('');
  const [forgotResult, setForgotResult] = useState<{
    message: string;
    resetToken: string;
    resetPath: string;
    maskedDestination: string;
  } | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  // Reset password state
  const [resetToken, setResetToken] = useState(resetTokenFromUrl);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [resetSuccess, setResetSuccess] = useState<string | null>(null);

  // Shared request state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiRequest<{emailOtpReady: boolean; smsTwilioReady: boolean; googleReady: boolean}>(
      '/api/auth/capabilities',
    )
      .then((caps) => {
        setEmailOtpReady(Boolean(caps.emailOtpReady));
      })
      .catch(() => {
        setEmailOtpReady(false);
      });
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
    setSetupNotice(null);
    if (authView === 'reset-password' && resetTokenFromUrl) {
      setResetToken(resetTokenFromUrl);
    }
    if (authView !== 'forgot-password') {
      setForgotResult(null);
    }
    if (authView !== 'reset-password') {
      setResetSuccess(null);
    }
  }, [authView, resetTokenFromUrl]);

  function resetVerificationState() {
    setOtpStep('idle');
    setOtpProvider(null);
    setOtpCode('');
    setOtpChallengeId(null);
    setOtpSentTo('');
    setOtpInfo(null);
    setFirebasePhoneConfirm(null);
    setVerifiedServerToken(null);
    setVerifiedFirebaseToken(null);
    setVerifiedFirebaseUser(null);
    setVerifiedContact(null);
    setSetupNotice(null);
  }

  function handleChangeRegMode(nextMode: 'email' | 'phone') {
    if (nextMode === regMode) return;
    setRegMode(nextMode);
    setError(null);
    resetVerificationState();
  }

  // ---- PERMANENT RESILIENT LOGIN ----
  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = loginIdentifier.trim();
    if (!trimmed || !loginPassword) {
      setError('Enter your email or phone number and password.');
      return;
    }

    setLoading(true);
    try {
      // Layer 1: Primary Express + SQLite backend login
      const data = await apiRequest<{token: string; user: UserProfile}>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          identifier: trimmed,
          password: loginPassword,
        }),
      });
      await saveAccountToVault({
        user: data.user,
        password: loginPassword,
        sessionToken: data.token,
      });
      setAuthToken(data.token);
      onAuthenticated(data.user, data.token);
      return;
    } catch (primaryErr) {
      // Layer 2: Permanent Browser Vault (IndexedDB + localStorage PBKDF2 hash)
      // Re-hydrates account automatically if server container restarted/redeployed!
      try {
        const vaultAccount = await verifyCredentialsInVault(trimmed, loginPassword);
        if (vaultAccount) {
          const restored = await apiRequest<{token: string; user: UserProfile}>('/api/auth/restore', {
            method: 'POST',
            body: JSON.stringify({
              name: vaultAccount.name,
              email: vaultAccount.email,
              phone: vaultAccount.phone,
              password: loginPassword,
              bio: vaultAccount.bio,
              location: vaultAccount.location,
              work: vaultAccount.work,
              avatar_url: vaultAccount.avatar_url,
              cover_url: vaultAccount.cover_url,
              date_of_birth: vaultAccount.date_of_birth,
              firebaseUid: vaultAccount.firebaseUid,
            }),
          });
          await saveAccountToVault({
            user: restored.user,
            password: loginPassword,
            authMethod: vaultAccount.authMethod,
            firebaseUid: vaultAccount.firebaseUid,
            sessionToken: restored.token,
          });
          setAuthToken(restored.token);
          onAuthenticated(restored.user, restored.token);
          return;
        }
      } catch {
        // Vault matched but server rejected password (e.g. password changed elsewhere)
      }

      // Layer 3: Firebase Auth email/password fallback (if enabled in Firebase Console)
      if (trimmed.includes('@')) {
        try {
          const fb = await tryFirebaseEmailSignIn(trimmed.toLowerCase(), loginPassword);
          if (fb && fb.user.emailVerified) {
            const fsProfile = await loadUserProfileFromFirestore(fb.user).catch(() => null);
            const synced = await apiRequest<{token: string; user: UserProfile}>(
              '/api/auth/firebase-auth',
              {
                method: 'POST',
                body: JSON.stringify({
                  firebaseIdToken: fb.idToken,
                  password: loginPassword,
                  ...(fsProfile || {}),
                }),
              },
            );
            await saveAccountToVault({
              user: synced.user,
              password: loginPassword,
              authMethod: 'email_otp',
              firebaseUid: fb.user.uid,
              sessionToken: synced.token,
            });
            setAuthToken(synced.token);
            onAuthenticated(synced.user, synced.token);
            return;
          }
        } catch {
          // Proceed to original error
        }
      }

      // Helpful guidance if this Gmail was created via Google Sign-In without setting a password yet
      const knownVault = await findVaultAccount(trimmed).catch(() => null);
      if (knownVault && knownVault.authMethod === 'google' && !knownVault.passwordHash) {
        setError(
          'This Gmail account uses Google Sign-In. Click "Continue with Google" below, or use "Forgot password?" to set a password.',
        );
      } else {
        setError(primaryErr instanceof Error ? primaryErr.message : 'Unable to sign in.');
      }
    } finally {
      setLoading(false);
    }
  }

  // ---- GOOGLE LOGIN (FIREBASE AUTH) ----
  async function handleGoogleLogin() {
    setError(null);
    setGoogleBusy(true);
    try {
      const {user: fbUser, idToken} = await signInWithGooglePopup();
      const fsProfile = await loadUserProfileFromFirestore(fbUser).catch(() => null);
      const data = await apiRequest<{token: string; user: UserProfile}>('/api/auth/firebase-auth', {
        method: 'POST',
        body: JSON.stringify({
          firebaseIdToken: idToken,
          ...(fsProfile || {}),
        }),
      });
      await syncUserProfileToFirestore(fbUser, data.user, 'google').catch(() => {});
      await saveAccountToVault({
        user: data.user,
        authMethod: 'google',
        firebaseUid: fbUser.uid,
        sessionToken: data.token,
      });
      setAuthToken(data.token);
      onAuthenticated(data.user, data.token);
    } catch (err) {
      const code = getFirebaseErrorCode(err);
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        setError('Google sign-in popup was closed before completing.');
      } else if (code === 'auth/popup-blocked') {
        setError('Please allow popups for this site to sign in with Google.');
      } else {
        setError(err instanceof Error ? err.message : 'Could not sign in with Google.');
      }
    } finally {
      setGoogleBusy(false);
    }
  }

  // ---- VERIFY REAL GMAIL WITH GOOGLE (ON CREATE ACCOUNT) ----
  async function handleVerifyGmailWithGoogle() {
    setError(null);
    setSetupNotice(null);
    setGoogleBusy(true);
    try {
      const {user: fbUser, idToken} = await signInWithGooglePopup();
      const email = (fbUser.email || '').trim().toLowerCase();
      if (!email || !fbUser.emailVerified) {
        setError('Your Google account must have a verified Gmail/email address.');
        return;
      }

      // Check if this Gmail already belongs to an existing account
      try {
        await apiRequest<{valid: boolean; normalized: string}>('/api/auth/check-contact', {
          method: 'POST',
          body: JSON.stringify({channel: 'email', contact: email}),
        });
      } catch (checkErr) {
        const isConflict =
          (checkErr instanceof ApiError && checkErr.status === 409) ||
          (checkErr instanceof Error && /already exists/i.test(checkErr.message));
        if (isConflict) {
          // Account already exists — sign them right in (and bind chosen password if typed!)
          const fsProfile = await loadUserProfileFromFirestore(fbUser).catch(() => null);
          const chosenPassword = regPassword.length >= 6 ? regPassword : undefined;
          const data = await apiRequest<{token: string; user: UserProfile}>(
            '/api/auth/firebase-auth',
            {
              method: 'POST',
              body: JSON.stringify({
                firebaseIdToken: idToken,
                password: chosenPassword,
                ...(fsProfile || {}),
              }),
            },
          );
          await syncUserProfileToFirestore(fbUser, data.user, 'google').catch(() => {});
          await saveAccountToVault({
            user: data.user,
            password: chosenPassword,
            authMethod: 'google',
            firebaseUid: fbUser.uid,
            sessionToken: data.token,
          });
          setAuthToken(data.token);
          onAuthenticated(data.user, data.token);
          return;
        }
        throw checkErr;
      }

      const resolvedName = regName.trim() || fbUser.displayName || '';
      setRegMode('email');
      setRegEmail(email);
      if (!regName.trim() && fbUser.displayName) {
        setRegName(fbUser.displayName);
      }
      setVerifiedFirebaseToken(idToken);
      setVerifiedFirebaseUser(fbUser);
      setVerifiedServerToken(null);
      setVerifiedContact(email);
      setVerifiedMethod('google');
      setOtpStep('verified');
      setOtpInfo(`Verified real Gmail: ${email}.`);

      // If user already entered Name + Password, finish creating their account right away!
      if (resolvedName.length >= 2 && regPassword.length >= 6) {
        await completeVerifiedRegistration({
          contact: email,
          mode: 'email',
          firebaseIdToken: idToken,
          firebaseUser: fbUser,
          authMethod: 'google',
          nameOverride: resolvedName,
        });
      } else {
        setOtpInfo(`Verified real Gmail: ${email}. Enter your password below and click Create Account.`);
      }
    } catch (err) {
      const code = getFirebaseErrorCode(err);
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        setError('Google verification popup was closed.');
      } else if (code === 'auth/popup-blocked') {
        setError('Please allow popups for this site to verify your Gmail with Google.');
      } else {
        setError(err instanceof Error ? err.message : 'Could not verify Gmail with Google.');
      }
    } finally {
      setGoogleBusy(false);
    }
  }

  // ---- STEP 1: SEND REAL OTP VERIFICATION CODE ----
  async function handleSendCode() {
    setError(null);
    setSetupNotice(null);
    setOtpInfo(null);

    let normalizedContact = '';
    if (regMode === 'email') {
      const check = validateRealEmail(regEmail);
      if (!check.valid) {
        setError(check.error);
        return;
      }
      normalizedContact = check.email;
    } else {
      const check = validateRealPhone(regPhone, regCountryCode);
      if (!check.valid) {
        setError(check.error);
        return;
      }
      normalizedContact = check.phone;
    }

    setSendingCode(true);
    try {
      // Pre-validate real contact (DNS MX check for email + duplicate check)
      const precheck = await apiRequest<{valid: boolean; normalized: string}>(
        '/api/auth/check-contact',
        {
          method: 'POST',
          body: JSON.stringify({channel: regMode, contact: normalizedContact}),
        },
      );
      normalizedContact = precheck.normalized || normalizedContact;

      if (regMode === 'phone') {
        // Primary path for Phone OTP: Firebase Phone Auth (real SMS OTP)
        try {
          const confirmation = await sendFirebasePhoneOtp(
            normalizedContact,
            'firebase-recaptcha-container',
          );
          setFirebasePhoneConfirm(confirmation);
          setOtpProvider('firebase');
          setOtpChallengeId(null);
          setOtpSentTo(normalizedContact);
          setOtpCode('');
          setOtpStep('code_sent');
          setResendCooldown(25);
          setOtpInfo(`A 6-digit SMS code was sent to ${normalizedContact}. Enter it below.`);
          return;
        } catch (fbErr) {
          const fbCode = getFirebaseErrorCode(fbErr);
          const providerUnavailable =
            fbCode === 'auth/operation-not-allowed' ||
            fbCode === 'auth/billing-not-enabled' ||
            fbCode === 'auth/configuration-not-found' ||
            fbCode === 'auth/invalid-app-credential' ||
            fbCode === 'auth/unauthorized-domain';

          if (!providerUnavailable) {
            if (fbCode === 'auth/too-many-requests') {
              setError('Too many SMS requests. Please wait a few minutes before trying again.');
            } else if (fbCode === 'auth/invalid-phone-number') {
              setError('Enter a valid real mobile number with country code.');
            } else {
              setError(
                fbErr instanceof Error
                  ? fbErr.message
                  : 'Could not send SMS verification code. Please check your phone number.',
              );
            }
            return;
          }

          // Fallback to server Twilio SMS OTP if configured in Secrets
          try {
            const smsRes = await apiRequest<{
              sent: boolean;
              challengeId: string;
              destination: string;
              message: string;
            }>('/api/auth/otp/send', {
              method: 'POST',
              body: JSON.stringify({channel: 'phone', contact: normalizedContact}),
            });
            setOtpChallengeId(smsRes.challengeId);
            setOtpProvider('server');
            setFirebasePhoneConfirm(null);
            setOtpSentTo(smsRes.destination);
            setOtpCode('');
            setOtpStep('code_sent');
            setResendCooldown(25);
            setOtpInfo(smsRes.message);
            return;
          } catch (smsErr) {
            const smsCode = (smsErr as {code?: string})?.code;
            if (smsCode === 'SMS_NOT_CONFIGURED') {
              setSetupNotice('phone');
              return;
            }
            throw smsErr;
          }
        }
      } else {
        // Real Email OTP via server SMTP (Nodemailer)
        try {
          const emailRes = await apiRequest<{
            sent: boolean;
            challengeId: string;
            destination: string;
            message: string;
          }>('/api/auth/otp/send', {
            method: 'POST',
            body: JSON.stringify({channel: 'email', contact: normalizedContact}),
          });
          setOtpChallengeId(emailRes.challengeId);
          setOtpProvider('server');
          setFirebasePhoneConfirm(null);
          setOtpSentTo(emailRes.destination);
          setOtpCode('');
          setOtpStep('code_sent');
          setResendCooldown(25);
          setOtpInfo(emailRes.message);
        } catch (emailErr) {
          const emailCode = (emailErr as {code?: string})?.code;
          if (emailCode === 'SMTP_NOT_CONFIGURED') {
            setSetupNotice('email');
            return;
          }
          throw emailErr;
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send verification code.');
    } finally {
      setSendingCode(false);
    }
  }

  // ---- FINALIZE ACCOUNT CREATION (ONLY AFTER REAL VERIFICATION) ----
  async function completeVerifiedRegistration(params: {
    contact: string;
    mode: 'email' | 'phone';
    verificationToken?: string | null;
    firebaseIdToken?: string | null;
    firebaseUser?: FirebaseUser | null;
    authMethod: 'google' | 'email_otp' | 'phone_otp';
    nameOverride?: string;
  }) {
    const trimmedName = (params.nameOverride ?? regName).trim();
    if (trimmedName.length < 2) {
      setError('Please enter your full name (at least 2 characters), then click Create Account.');
      return;
    }
    if (regPassword.length < 6) {
      setError('Please choose a password (at least 6 characters), then click Create Account.');
      return;
    }

    setLoading(true);
    try {
      const payload =
        params.mode === 'email'
          ? {
              name: trimmedName,
              email: params.contact,
              password: regPassword,
              verificationToken: params.verificationToken || undefined,
              firebaseIdToken: params.firebaseIdToken || undefined,
            }
          : {
              name: trimmedName,
              phone: params.contact,
              password: regPassword,
              verificationToken: params.verificationToken || undefined,
              firebaseIdToken: params.firebaseIdToken || undefined,
            };

      const data = await apiRequest<{token: string; user: UserProfile}>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      // Permanently mirror account in IndexedDB + localStorage vault (PBKDF2 hashed)
      await saveAccountToVault({
        user: data.user,
        password: regPassword,
        authMethod: params.authMethod,
        firebaseUid: params.firebaseUser?.uid || null,
        sessionToken: data.token,
      });

      // Mirror verified account into Cloud Firestore when Firebase user is authenticated
      if (params.firebaseUser) {
        await syncUserProfileToFirestore(params.firebaseUser, data.user, params.authMethod).catch(
          () => {},
        );
      }

      setAuthToken(data.token);
      onAuthenticated(data.user, data.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create account.');
    } finally {
      setLoading(false);
    }
  }

  // ---- STEP 2: VERIFY ENTERED 6-DIGIT OTP CODE ----
  async function handleVerifyOtp() {
    setError(null);
    const cleanCode = otpCode.replace(/\s+/g, '');
    if (!/^\d{6}$/.test(cleanCode)) {
      setError('Enter the 6-digit verification code sent to your Gmail or phone.');
      return;
    }

    setVerifyingCode(true);
    try {
      if (otpProvider === 'firebase' && firebasePhoneConfirm) {
        const cred = await firebasePhoneConfirm.confirm(cleanCode);
        const idToken = await cred.user.getIdToken(true);
        const verifiedPhone = cred.user.phoneNumber || otpSentTo;
        setVerifiedFirebaseToken(idToken);
        setVerifiedFirebaseUser(cred.user);
        setVerifiedServerToken(null);
        setVerifiedContact(verifiedPhone);
        setVerifiedMethod('phone_otp');
        setOtpStep('verified');
        setOtpInfo(`Phone number ${verifiedPhone} verified!`);

        if (regName.trim().length >= 2 && regPassword.length >= 6) {
          await completeVerifiedRegistration({
            contact: verifiedPhone,
            mode: 'phone',
            firebaseIdToken: idToken,
            firebaseUser: cred.user,
            authMethod: 'phone_otp',
          });
        }
        return;
      }

      if (otpProvider === 'server' && otpChallengeId) {
        const res = await apiRequest<{
          verified: boolean;
          verificationToken: string;
          destination: string;
          channel: 'email' | 'phone';
        }>('/api/auth/otp/verify', {
          method: 'POST',
          body: JSON.stringify({
            challengeId: otpChallengeId,
            code: cleanCode,
          }),
        });
        const method = res.channel === 'email' ? 'email_otp' : 'phone_otp';
        setVerifiedServerToken(res.verificationToken);
        setVerifiedFirebaseToken(null);
        setVerifiedFirebaseUser(null);
        setVerifiedContact(res.destination);
        setVerifiedMethod(method);
        setOtpStep('verified');
        setOtpInfo(
          `${res.channel === 'email' ? 'Email' : 'Phone number'} ${res.destination} verified!`,
        );

        if (regName.trim().length >= 2 && regPassword.length >= 6) {
          await completeVerifiedRegistration({
            contact: res.destination,
            mode: res.channel,
            verificationToken: res.verificationToken,
            authMethod: method,
          });
        }
        return;
      }

      setError('Verification session expired. Please click "Send Code" again.');
    } catch (err) {
      const code = getFirebaseErrorCode(err);
      if (code === 'auth/invalid-verification-code') {
        setError('Incorrect 6-digit SMS code. Please check the code and try again.');
      } else if (code === 'auth/code-expired') {
        setError('Verification code expired. Please click "Send Code" for a new code.');
      } else {
        setError(err instanceof Error ? err.message : 'Verification failed. Check your code.');
      }
    } finally {
      setVerifyingCode(false);
    }
  }

  async function handleRegister(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (otpStep !== 'verified' || !verifiedContact) {
      setError(
        regMode === 'email'
          ? 'Please verify your real Gmail/email first using "Send Code" or "Verify Real Gmail with Google".'
          : 'Please click "Send Code", enter the 6-digit SMS code, and click "Verify" first.',
      );
      return;
    }

    await completeVerifiedRegistration({
      contact: verifiedContact,
      mode: regMode,
      verificationToken: verifiedServerToken,
      firebaseIdToken: verifiedFirebaseToken,
      firebaseUser: verifiedFirebaseUser,
      authMethod: verifiedMethod,
    });
  }

  async function handleForgotSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setForgotResult(null);
    setLoading(true);
    try {
      const trimmed = forgotIdentifier.trim();
      const data = await apiRequest<{
        message: string;
        resetToken: string;
        resetPath: string;
        maskedDestination: string;
      }>('/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({identifier: trimmed}),
      });
      setLastForgotIdentifier(trimmed);
      setForgotResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not find that account.');
    } finally {
      setLoading(false);
    }
  }

  async function handleResetSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters long.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      const data = await apiRequest<{message: string}>('/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({
          token: resetToken.trim(),
          newPassword,
        }),
      });
      if (lastForgotIdentifier) {
        await updateVaultPasswordByIdentifier(lastForgotIdentifier, newPassword).catch(() => {});
      }
      setResetSuccess(data.message);
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to reset password.');
    } finally {
      setLoading(false);
    }
  }

  function handleCopyResetLink() {
    if (!forgotResult) return;
    const fullUrl = `${window.location.origin}${forgotResult.resetPath}`;
    navigator.clipboard?.writeText(fullUrl).then(() => {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    });
  }

  async function handleSelectSavedAccount(acc: VaultAccountRecord) {
    setError(null);
    const contact = acc.email || acc.phone || '';

    // 1-tap instant sign-in if this account still has an active session token on this device
    if (acc.sessionToken) {
      setQuickEnteringId(acc.id);
      try {
        const res = await fetchMeWithToken<{user: UserProfile}>(acc.sessionToken);
        await saveAccountToVault({
          user: res.user,
          authMethod: acc.authMethod,
          firebaseUid: acc.firebaseUid,
          sessionToken: acc.sessionToken,
        });
        setAuthToken(acc.sessionToken);
        onAuthenticated(res.user, acc.sessionToken);
        return;
      } catch {
        await clearVaultSessionToken(acc.id).catch(() => {});
        setSavedAccounts((prev) =>
          prev.map((item) => (item.id === acc.id ? {...item, sessionToken: null} : item)),
        );
      } finally {
        setQuickEnteringId(null);
      }
    }

    // Session was logged out or expired — prefill identifier and focus password (or offer Google)
    setLoginIdentifier(contact);
    setLoginPassword('');
    if (acc.authMethod === 'google' && !acc.passwordHash) {
      setError(`Click "Continue with Google" below to sign into ${acc.name}.`);
    } else {
      window.setTimeout(() => {
        document.getElementById('login-password')?.focus();
      }, 30);
    }
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
      {/* Hidden container for Firebase invisible Phone reCAPTCHA */}
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
                authView === 'forgot-password' || authView === 'reset-password'
                  ? 'text-[#1877F2] dark:text-[#3B82F6] font-semibold'
                  : ''
              }`}
            >
              Password Recovery
            </button>
          </nav>

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
                Verified accounts saved permanently across devices. Share photos, videos, and real-time messages with friends.
              </p>
            </div>

            <div className="relative w-full aspect-[16/9] rounded-2xl overflow-hidden border border-[#E4E6EB] dark:border-[#2E3035] bg-[#1E293B]">
              <CoverImage
                src={PRESET_COVERS[0].url}
                alt="Pacific coastline overlooking minimalist architecture"
              />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-5 sm:p-6">
                <p className="text-white text-sm sm:text-base font-medium">
                  Real-time messaging, curated profiles, and verified permanent accounts.
                </p>
                <p className="text-white/75 text-xs sm:text-sm mt-1">
                  Sign in with your verified Gmail, email, or phone number anytime.
                </p>
              </div>
            </div>
          </section>

          {/* Right auth card */}
          <section className="lg:col-span-5 flex items-center">
            <div className="w-full bg-white dark:bg-[#16191F] border border-[#E5E8EE] dark:border-[#252A34] rounded-2xl p-6 sm:p-8 shadow-[0_8px_28px_rgba(15,23,42,0.06)] dark:shadow-[0_12px_32px_rgba(0,0,0,0.35)]">
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
                  <span>{error}</span>
                </div>
              )}

              {/* VIEW 1: LOGIN */}
              {authView === 'login' && (
                <form onSubmit={handleLogin} className="space-y-4">
                  <div>
                    <h2 className="text-xl font-display font-bold text-[#111827] dark:text-white">
                      Welcome back
                    </h2>
                    <p className="text-sm text-[#65676B] dark:text-[#9CA3AF] mt-1">
                      Sign in with your Gmail/email or phone number and password.
                    </p>
                  </div>

                  {/* Facebook-style Saved Accounts on this device */}
                  {savedAccounts.length > 0 && (
                    <div className="space-y-2 pb-1">
                      <p className="text-xs font-semibold uppercase tracking-wider text-[#65676B] dark:text-[#9CA3AF]">
                        Saved accounts ({savedAccounts.length})
                      </p>
                      <div className="space-y-1.5 max-h-48 overflow-y-auto pr-0.5">
                        {savedAccounts.map((acc) => {
                          const contact = acc.email || acc.phone || '';
                          const isBusy = quickEnteringId === acc.id;
                          return (
                            <div
                              key={acc.id}
                              onClick={() => !isBusy && handleSelectSavedAccount(acc)}
                              role="button"
                              tabIndex={0}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  if (!isBusy) handleSelectSavedAccount(acc);
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
                                    {contact}
                                  </p>
                                </div>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                {isBusy ? (
                                  <Loader2 className="w-4 h-4 animate-spin text-[#1877F2]" />
                                ) : (
                                  <span className="text-xs font-semibold text-[#1877F2] dark:text-[#60A5FA] whitespace-nowrap">
                                    {acc.sessionToken ? 'Log in' : 'Select'}
                                  </span>
                                )}
                                <button
                                  type="button"
                                  title="Remove from this device"
                                  aria-label={`Remove ${acc.name} from saved accounts`}
                                  onClick={(e) => handleRemoveSavedAccount(e, acc.id)}
                                  className="p-1 rounded-full text-[#94A3B8] hover:text-[#DC2626] hover:bg-[#FEE2E2] dark:hover:bg-[#3B181A] transition-colors cursor-pointer"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div>
                    <label
                      htmlFor="login-identifier"
                      className="block text-sm font-medium text-[#374151] dark:text-[#D1D5DB] mb-1.5"
                    >
                      Email / Gmail or Phone Number
                    </label>
                    <input
                      id="login-identifier"
                      type="text"
                      required
                      autoComplete="username"
                      value={loginIdentifier}
                      onChange={(e) => setLoginIdentifier(e.target.value)}
                      placeholder="name@gmail.com or 01618859938"
                      className="w-full h-11 px-3.5 rounded-xl bg-[#F8F9FA] dark:bg-[#121316] border border-[#D1D5DB] dark:border-[#374151] text-sm text-[#111827] dark:text-white placeholder:text-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#1877F2] dark:focus:ring-[#3B82F6] focus:border-transparent"
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
                        className="text-xs font-medium text-[#1877F2] dark:text-[#60A5FA] hover:underline cursor-pointer"
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
                        className="w-full h-11 pl-3.5 pr-11 rounded-xl bg-[#F8F9FA] dark:bg-[#121316] border border-[#D1D5DB] dark:border-[#374151] text-sm text-[#111827] dark:text-white placeholder:text-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#1877F2] dark:focus:ring-[#3B82F6] focus:border-transparent"
                      />
                      <button
                        type="button"
                        onClick={() => setShowLoginPassword((prev) => !prev)}
                        aria-label={showLoginPassword ? 'Hide password' : 'Show password'}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 text-[#65676B] dark:text-[#9CA3AF] hover:text-[#111827] dark:hover:text-white cursor-pointer"
                      >
                        {showLoginPassword ? (
                          <EyeOff className="w-4 h-4" />
                        ) : (
                          <Eye className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading || googleBusy}
                    className="w-full h-11 rounded-xl bg-[#1877F2] hover:bg-[#166FE5] dark:bg-[#2563EB] dark:hover:bg-[#1D4ED8] text-white font-semibold text-sm transition-colors disabled:opacity-60 flex items-center justify-center gap-2 cursor-pointer"
                  >
                    {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                    <span>{loading ? 'Signing in...' : 'Sign In'}</span>
                    {!loading && <ArrowRight className="w-4 h-4" />}
                  </button>

                  <div className="relative flex items-center py-1">
                    <div className="flex-1 border-t border-[#E4E6EB] dark:border-[#2E3035]" />
                    <span className="px-3 text-xs text-[#65676B] dark:text-[#9CA3AF]">or</span>
                    <div className="flex-1 border-t border-[#E4E6EB] dark:border-[#2E3035]" />
                  </div>

                  <button
                    type="button"
                    disabled={googleBusy || loading}
                    onClick={handleGoogleLogin}
                    className="w-full h-11 rounded-xl bg-white dark:bg-[#1E222A] hover:bg-[#F8F9FA] dark:hover:bg-[#262B35] border border-[#D1D5DB] dark:border-[#374151] text-[#111827] dark:text-white font-semibold text-sm transition-colors disabled:opacity-60 flex items-center justify-center gap-2.5 cursor-pointer"
                  >
                    {googleBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <GoogleMark />}
                    <span>{googleBusy ? 'Connecting Google...' : 'Continue with Google'}</span>
                  </button>

                  <div className="pt-2 border-t border-[#E4E6EB] dark:border-[#2E3035]">
                    <p className="text-center text-xs text-[#65676B] dark:text-[#9CA3AF]">
                      New to Verve?{' '}
                      <button
                        type="button"
                        onClick={() => onNavigateAuth('register')}
                        className="font-semibold text-[#1877F2] dark:text-[#60A5FA] hover:underline cursor-pointer"
                      >
                        Create a verified account
                      </button>
                    </p>
                  </div>
                </form>
              )}

              {/* VIEW 2: REGISTER WITH REAL VERIFICATION */}
              {authView === 'register' && (
                <form onSubmit={handleRegister} className="space-y-4">
                  <div>
                    <h2 className="text-xl font-display font-bold text-[#111827] dark:text-white">
                      Create verified account
                    </h2>
                    <p className="text-sm text-[#65676B] dark:text-[#9CA3AF] mt-1">
                      Verify your real Gmail or phone number before your account is created.
                    </p>
                  </div>

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
                      value={regName}
                      onChange={(e) => setRegName(e.target.value)}
                      placeholder="Alex Rivera"
                      className="w-full h-11 px-3.5 rounded-xl bg-[#F8F9FA] dark:bg-[#121316] border border-[#D1D5DB] dark:border-[#374151] text-sm text-[#111827] dark:text-white placeholder:text-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#1877F2] dark:focus:ring-[#3B82F6] focus:border-transparent"
                    />
                  </div>

                  {/* Contact method switch: Email/Gmail vs Phone */}
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-[#374151] dark:text-[#D1D5DB]">
                        {regMode === 'email' ? 'Real Gmail / Email' : 'Real Phone Number'}
                      </span>
                      <div className="inline-flex items-center gap-1 p-0.5 rounded-lg bg-[#F0F2F5] dark:bg-[#121316]">
                        <button
                          type="button"
                          onClick={() => handleChangeRegMode('email')}
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                            regMode === 'email'
                              ? 'bg-white dark:bg-[#2A2D32] text-[#111827] dark:text-white shadow-xs'
                              : 'text-[#65676B] dark:text-[#9CA3AF]'
                          }`}
                        >
                          <Mail className="w-3.5 h-3.5" />
                          <span>Email</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleChangeRegMode('phone')}
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                            regMode === 'phone'
                              ? 'bg-white dark:bg-[#2A2D32] text-[#111827] dark:text-white shadow-xs'
                              : 'text-[#65676B] dark:text-[#9CA3AF]'
                          }`}
                        >
                          <Phone className="w-3.5 h-3.5" />
                          <span>Phone</span>
                        </button>
                      </div>
                    </div>

                    {regMode === 'email' ? (
                      <div className="flex gap-2">
                        <input
                          id="reg-email"
                          type="email"
                          required
                          autoComplete="email"
                          value={regEmail}
                          onChange={(e) => {
                            setRegEmail(e.target.value);
                            if (otpStep !== 'idle') resetVerificationState();
                          }}
                          placeholder="yourname@gmail.com"
                          className="flex-1 min-w-0 h-11 px-3.5 rounded-xl bg-[#F8F9FA] dark:bg-[#121316] border border-[#D1D5DB] dark:border-[#374151] text-sm text-[#111827] dark:text-white placeholder:text-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#1877F2] dark:focus:ring-[#3B82F6] focus:border-transparent"
                        />
                        <button
                          type="button"
                          disabled={sendingCode || resendCooldown > 0 || otpStep === 'verified'}
                          onClick={handleSendCode}
                          className="h-11 px-3.5 rounded-xl bg-[#0F172A] hover:bg-[#1E293B] dark:bg-[#2A2F3A] dark:hover:bg-[#353C4A] text-white text-xs font-semibold whitespace-nowrap shrink-0 disabled:opacity-55 transition-colors flex items-center gap-1.5 cursor-pointer"
                        >
                          {sendingCode && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                          <span>
                            {otpStep === 'verified'
                              ? 'Verified'
                              : sendingCode
                                ? 'Sending...'
                                : resendCooldown > 0
                                  ? `Resend (${resendCooldown}s)`
                                  : 'Send Code'}
                          </span>
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <div className="flex gap-2">
                          <select
                            aria-label="Country code"
                            value={regCountryCode}
                            onChange={(e) => {
                              setRegCountryCode(e.target.value);
                              if (otpStep !== 'idle') resetVerificationState();
                            }}
                            className="h-11 px-2.5 rounded-xl bg-[#F8F9FA] dark:bg-[#121316] border border-[#D1D5DB] dark:border-[#374151] text-xs font-medium text-[#111827] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1877F2] shrink-0"
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
                            required
                            autoComplete="tel"
                            value={regPhone}
                            onChange={(e) => {
                              setRegPhone(e.target.value);
                              if (otpStep !== 'idle') resetVerificationState();
                            }}
                            placeholder={selectedCountry.placeholder}
                            className="flex-1 min-w-0 h-11 px-3.5 rounded-xl bg-[#F8F9FA] dark:bg-[#121316] border border-[#D1D5DB] dark:border-[#374151] text-sm text-[#111827] dark:text-white placeholder:text-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#1877F2] dark:focus:ring-[#3B82F6] focus:border-transparent"
                          />
                        </div>
                        <button
                          type="button"
                          disabled={sendingCode || resendCooldown > 0 || otpStep === 'verified'}
                          onClick={handleSendCode}
                          className="w-full h-10 rounded-xl bg-[#0F172A] hover:bg-[#1E293B] dark:bg-[#2A2F3A] dark:hover:bg-[#353C4A] text-white text-xs font-semibold disabled:opacity-55 transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          {sendingCode && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                          <span>
                            {otpStep === 'verified'
                              ? 'Phone Number Verified'
                              : sendingCode
                                ? 'Sending SMS Code...'
                                : resendCooldown > 0
                                  ? `Resend Code in ${resendCooldown}s`
                                  : 'Send Code'}
                          </span>
                        </button>
                      </div>
                    )}

                    {/* Instant Google verification option for real Gmail */}
                    {regMode === 'email' && otpStep !== 'verified' && (
                      <button
                        type="button"
                        disabled={googleBusy || loading}
                        onClick={handleVerifyGmailWithGoogle}
                        className={`w-full h-11 rounded-xl font-semibold text-sm transition-colors disabled:opacity-60 flex items-center justify-center gap-2 cursor-pointer ${
                          emailOtpReady
                            ? 'bg-white dark:bg-[#1E222A] hover:bg-[#F8F9FA] dark:hover:bg-[#262B35] border border-[#D1D5DB] dark:border-[#374151] text-[#111827] dark:text-white'
                            : 'bg-[#1877F2]/10 hover:bg-[#1877F2]/15 dark:bg-[#2563EB]/20 dark:hover:bg-[#2563EB]/30 border border-[#1877F2]/35 dark:border-[#3B82F6]/50 text-[#1877F2] dark:text-[#93C5FD]'
                        }`}
                      >
                        {googleBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <GoogleMark />}
                        <span>
                          {googleBusy
                            ? 'Verifying with Google...'
                            : 'Verify Real Gmail with Google (Recommended)'}
                        </span>
                      </button>
                    )}

                    {/* Helpful setup helper if SMTP or Firebase Phone Provider is not yet turned on */}
                    {setupNotice === 'phone' && (
                      <div className="p-3.5 rounded-xl bg-[#EFF6FF] dark:bg-[#172554]/50 border border-[#BFDBFE] dark:border-[#1E40AF] text-xs text-[#1E3A8A] dark:text-[#BFDBFE] space-y-2.5">
                        <div className="space-y-1">
                          <p className="font-semibold">Phone SMS needs to be turned on in Firebase:</p>
                          <p className="opacity-90 leading-relaxed">
                            Open Firebase Console &rarr; Authentication &rarr; Sign-in method &rarr;
                            enable <strong>Phone</strong>, then tap <strong>Send Code</strong> again.
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <a
                            href={FIREBASE_CONSOLE_AUTH_URL}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#1877F2] text-white font-semibold"
                          >
                            <span>Enable Phone in Firebase</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                          <button
                            type="button"
                            onClick={() => handleChangeRegMode('email')}
                            className="px-3 py-1.5 rounded-lg bg-white/80 dark:bg-[#1E293B] text-[#1E3A8A] dark:text-[#BFDBFE] font-semibold cursor-pointer"
                          >
                            Use Gmail Instead
                          </button>
                        </div>
                      </div>
                    )}

                    {setupNotice === 'email' && (
                      <div className="p-3.5 rounded-xl bg-[#EFF6FF] dark:bg-[#172554]/50 border border-[#BFDBFE] dark:border-[#1E40AF] text-xs text-[#1E3A8A] dark:text-[#BFDBFE] space-y-2.5">
                        <div className="space-y-1">
                          <p className="font-semibold">
                            Verify your Gmail instantly with Google — no setup needed
                          </p>
                          <p className="opacity-90 leading-relaxed">
                            Tap the button below to verify your real Gmail immediately. (To send
                            6-digit email inbox codes directly, add{' '}
                            <code className="font-mono">SMTP_USER</code> and{' '}
                            <code className="font-mono">SMTP_PASS</code> in AI Studio Secrets.)
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={googleBusy || loading}
                          onClick={handleVerifyGmailWithGoogle}
                          className="w-full h-10 rounded-lg bg-[#1877F2] hover:bg-[#166FE5] text-white font-semibold flex items-center justify-center gap-2 cursor-pointer"
                        >
                          {googleBusy ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <GoogleMark />
                          )}
                          <span>Verify Gmail with Google Now</span>
                        </button>
                      </div>
                    )}

                    {/* STEP 2: ENTER CODE BOX + VERIFY BUTTON */}
                    {otpStep === 'code_sent' && (
                      <div className="p-3.5 rounded-xl bg-[#F8FAFC] dark:bg-[#12141A] border border-[#CBD5E1] dark:border-[#334155] space-y-2.5">
                        <div className="flex items-start gap-2 text-xs text-[#334155] dark:text-[#CBD5E1]">
                          <ShieldCheck className="w-4 h-4 text-[#1877F2] dark:text-[#60A5FA] shrink-0 mt-0.5" />
                          <span>
                            {otpInfo || `Enter the 6-digit verification code sent to ${otpSentTo}.`}
                          </span>
                        </div>
                        <label
                          htmlFor="reg-otp-code"
                          className="block text-xs font-semibold text-[#111827] dark:text-white"
                        >
                          Enter Code
                        </label>
                        <div className="flex gap-2">
                          <input
                            id="reg-otp-code"
                            type="text"
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            maxLength={6}
                            value={otpCode}
                            onChange={(e) => setOtpCode(e.target.value.replace(/[^\d]/g, '').slice(0, 6))}
                            placeholder="6-digit code"
                            className="flex-1 min-w-0 h-11 px-3.5 rounded-xl bg-white dark:bg-[#16191F] border border-[#D1D5DB] dark:border-[#374151] text-base font-mono tracking-[0.28em] text-center text-[#111827] dark:text-white placeholder:tracking-normal placeholder:text-xs placeholder:text-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#1877F2]"
                          />
                          <button
                            type="button"
                            disabled={verifyingCode || otpCode.length !== 6}
                            onClick={handleVerifyOtp}
                            className="h-11 px-5 rounded-xl bg-[#16A34A] hover:bg-[#15803D] text-white text-sm font-semibold whitespace-nowrap shrink-0 disabled:opacity-55 transition-colors flex items-center gap-1.5 cursor-pointer"
                          >
                            {verifyingCode && <Loader2 className="w-4 h-4 animate-spin" />}
                            <span>{verifyingCode ? 'Verifying...' : 'Verify'}</span>
                          </button>
                        </div>
                      </div>
                    )}

                    {/* VERIFIED CONFIRMATION BANNER */}
                    {otpStep === 'verified' && verifiedContact && (
                      <div
                        role="status"
                        className="p-3 rounded-xl bg-[#ECFDF5] dark:bg-[#0F2E22] border border-[#A7F3D0] dark:border-[#166534] text-[#065F46] dark:text-[#A7F3D0] text-xs font-medium flex items-start gap-2"
                      >
                        <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-[#16A34A] dark:text-[#4ADE80]" />
                        <span>{otpInfo || `Verified: ${verifiedContact}`}</span>
                      </div>
                    )}
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
                        placeholder="At least 6 characters"
                        className="w-full h-11 pl-3.5 pr-11 rounded-xl bg-[#F8F9FA] dark:bg-[#121316] border border-[#D1D5DB] dark:border-[#374151] text-sm text-[#111827] dark:text-white placeholder:text-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#1877F2] dark:focus:ring-[#3B82F6] focus:border-transparent"
                      />
                      <button
                        type="button"
                        onClick={() => setShowRegPassword((prev) => !prev)}
                        aria-label={showRegPassword ? 'Hide password' : 'Show password'}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 text-[#64748B] dark:text-[#94A3B8] hover:text-[#0F172A] dark:hover:text-white cursor-pointer"
                      >
                        {showRegPassword ? (
                          <EyeOff className="w-4 h-4" />
                        ) : (
                          <Eye className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                    {regStrength > 0 && (
                      <div className="mt-2 grid grid-cols-4 gap-1.5">
                        {[1, 2, 3, 4].map((step) => (
                          <div
                            key={step}
                            className={`h-1 rounded-full transition-colors ${
                              step <= regStrength
                                ? regStrength >= 4
                                  ? 'bg-[#16A34A]'
                                  : regStrength === 3
                                    ? 'bg-[#1877F2]'
                                    : regStrength === 2
                                      ? 'bg-[#D97706]'
                                      : 'bg-[#DC2626]'
                                : 'bg-[#E2E8F0] dark:bg-[#252A34]'
                            }`}
                          />
                        ))}
                      </div>
                    )}
                  </div>

                  <button
                    type="submit"
                    disabled={loading || otpStep !== 'verified'}
                    className="w-full h-11 rounded-xl bg-[#1877F2] hover:bg-[#166FE5] dark:bg-[#2563EB] dark:hover:bg-[#1D4ED8] text-white font-semibold text-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
                  >
                    {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                    <span>
                      {loading
                        ? 'Creating account...'
                        : otpStep === 'verified'
                          ? 'Create Account'
                          : 'Verify Gmail or Phone to Create Account'}
                    </span>
                    {!loading && otpStep === 'verified' && <ArrowRight className="w-4 h-4" />}
                  </button>

                  <p className="text-center text-xs text-[#65676B] dark:text-[#9CA3AF] pt-1">
                    Already have an account?{' '}
                    <button
                      type="button"
                      onClick={() => onNavigateAuth('login')}
                      className="font-semibold text-[#1877F2] dark:text-[#60A5FA] hover:underline cursor-pointer"
                    >
                      Sign In
                    </button>
                  </p>
                </form>
              )}

              {/* VIEW 3: FORGOT PASSWORD */}
              {authView === 'forgot-password' && (
                <div className="space-y-5">
                  <button
                    type="button"
                    onClick={() => onNavigateAuth('login')}
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-[#65676B] dark:text-[#9CA3AF] hover:text-[#111827] dark:hover:text-white cursor-pointer"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    <span>Back to Sign In</span>
                  </button>

                  <div>
                    <h2 className="text-xl font-display font-bold text-[#111827] dark:text-white">
                      Forgot your password?
                    </h2>
                    <p className="text-sm text-[#65676B] dark:text-[#9CA3AF] mt-1">
                      Enter your Gmail/email address or phone number and we will create a secure password reset link.
                    </p>
                  </div>

                  {!forgotResult ? (
                    <form onSubmit={handleForgotSubmit} className="space-y-4">
                      <div>
                        <label
                          htmlFor="forgot-identifier"
                          className="block text-sm font-medium text-[#374151] dark:text-[#D1D5DB] mb-1.5"
                        >
                          Email / Gmail or Phone Number
                        </label>
                        <input
                          id="forgot-identifier"
                          type="text"
                          required
                          value={forgotIdentifier}
                          onChange={(e) => setForgotIdentifier(e.target.value)}
                          placeholder="name@gmail.com or 01618859938"
                          className="w-full h-11 px-3.5 rounded-xl bg-[#F8F9FA] dark:bg-[#121316] border border-[#D1D5DB] dark:border-[#374151] text-sm text-[#111827] dark:text-white placeholder:text-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#1877F2] dark:focus:ring-[#3B82F6] focus:border-transparent"
                        />
                      </div>

                      <button
                        type="submit"
                        disabled={loading}
                        className="w-full h-11 rounded-xl bg-[#1877F2] hover:bg-[#166FE5] dark:bg-[#2563EB] dark:hover:bg-[#1D4ED8] text-white font-semibold text-sm transition-colors disabled:opacity-60 cursor-pointer"
                      >
                        {loading ? 'Generating reset link...' : 'Send Reset Link'}
                      </button>

                      <div className="text-center pt-1">
                        <button
                          type="button"
                          onClick={() => onNavigateAuth('reset-password')}
                          className="text-xs font-medium text-[#65676B] dark:text-[#9CA3AF] hover:text-[#1877F2] dark:hover:text-[#60A5FA] cursor-pointer"
                        >
                          Already have a reset code? Enter it on Reset Password
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="space-y-4">
                      <div className="p-4 rounded-xl bg-[#ECFDF5] dark:bg-[#0F2E22] border border-[#A7F3D0] dark:border-[#166534] text-[#065F46] dark:text-[#A7F3D0] text-sm space-y-2">
                        <div className="flex items-start gap-2.5">
                          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                          <p className="font-medium">{forgotResult.message}</p>
                        </div>
                        <div className="pt-1">
                          <p className="text-xs opacity-80 mb-1">Reset code:</p>
                          <code className="block px-2.5 py-1.5 rounded-lg bg-white/80 dark:bg-black/30 font-mono text-xs break-all text-[#111827] dark:text-[#E5E7EB]">
                            {forgotResult.resetToken}
                          </code>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() =>
                          onNavigateAuth(
                            'reset-password',
                            `?token=${encodeURIComponent(forgotResult.resetToken)}`,
                          )
                        }
                        className="w-full h-11 rounded-xl bg-[#1877F2] hover:bg-[#166FE5] dark:bg-[#2563EB] dark:hover:bg-[#1D4ED8] text-white font-semibold text-sm transition-colors flex items-center justify-center gap-2 cursor-pointer"
                      >
                        <KeyRound className="w-4 h-4" />
                        <span>Continue to Reset Password</span>
                      </button>

                      <button
                        type="button"
                        onClick={handleCopyResetLink}
                        className="w-full h-10 rounded-xl border border-[#D1D5DB] dark:border-[#374151] text-sm font-medium text-[#374151] dark:text-[#D1D5DB] hover:bg-[#F0F2F5] dark:hover:bg-[#2A2D32] flex items-center justify-center gap-2 cursor-pointer"
                      >
                        <Copy className="w-4 h-4" />
                        <span>{copiedLink ? 'Reset link copied' : 'Copy Reset Password Link'}</span>
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* VIEW 4: RESET PASSWORD */}
              {authView === 'reset-password' && (
                <div className="space-y-5">
                  <button
                    type="button"
                    onClick={() => onNavigateAuth('login')}
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-[#65676B] dark:text-[#9CA3AF] hover:text-[#111827] dark:hover:text-white cursor-pointer"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    <span>Back to Sign In</span>
                  </button>

                  <div>
                    <h2 className="text-xl font-display font-bold text-[#111827] dark:text-white">
                      Set a new password
                    </h2>
                    <p className="text-sm text-[#65676B] dark:text-[#9CA3AF] mt-1">
                      Enter your reset code and choose a strong new password.
                    </p>
                  </div>

                  {resetSuccess ? (
                    <div className="space-y-4">
                      <div className="p-4 rounded-xl bg-[#ECFDF5] dark:bg-[#0F2E22] border border-[#A7F3D0] dark:border-[#166534] text-[#065F46] dark:text-[#A7F3D0] text-sm flex items-start gap-2.5">
                        <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                        <span>{resetSuccess}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => onNavigateAuth('login')}
                        className="w-full h-11 rounded-xl bg-[#1877F2] hover:bg-[#166FE5] dark:bg-[#2563EB] dark:hover:bg-[#1D4ED8] text-white font-semibold text-sm transition-colors cursor-pointer"
                      >
                        Proceed to Sign In
                      </button>
                    </div>
                  ) : (
                    <form onSubmit={handleResetSubmit} className="space-y-4">
                      <div>
                        <label
                          htmlFor="reset-token"
                          className="block text-sm font-medium text-[#374151] dark:text-[#D1D5DB] mb-1.5"
                        >
                          Reset Token
                        </label>
                        <input
                          id="reset-token"
                          type="text"
                          required
                          value={resetToken}
                          onChange={(e) => setResetToken(e.target.value)}
                          placeholder="Paste your reset code"
                          className="w-full h-11 px-3.5 rounded-xl bg-[#F8F9FA] dark:bg-[#121316] border border-[#D1D5DB] dark:border-[#374151] font-mono text-xs text-[#111827] dark:text-white placeholder:text-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#1877F2] dark:focus:ring-[#3B82F6] focus:border-transparent"
                        />
                      </div>

                      <div>
                        <label
                          htmlFor="reset-new-password"
                          className="block text-sm font-medium text-[#374151] dark:text-[#D1D5DB] mb-1.5"
                        >
                          New Password
                        </label>
                        <div className="relative">
                          <input
                            id="reset-new-password"
                            type={showNewPassword ? 'text' : 'password'}
                            required
                            minLength={6}
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            placeholder="At least 6 characters"
                            className="w-full h-11 pl-3.5 pr-11 rounded-xl bg-[#F8F9FA] dark:bg-[#121316] border border-[#D1D5DB] dark:border-[#374151] text-sm text-[#111827] dark:text-white placeholder:text-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#1877F2] dark:focus:ring-[#3B82F6] focus:border-transparent"
                          />
                          <button
                            type="button"
                            onClick={() => setShowNewPassword((prev) => !prev)}
                            aria-label={showNewPassword ? 'Hide password' : 'Show password'}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 text-[#65676B] dark:text-[#9CA3AF] hover:text-[#111827] dark:hover:text-white cursor-pointer"
                          >
                            {showNewPassword ? (
                              <EyeOff className="w-4 h-4" />
                            ) : (
                              <Eye className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                      </div>

                      <div>
                        <label
                          htmlFor="reset-confirm-password"
                          className="block text-sm font-medium text-[#374151] dark:text-[#D1D5DB] mb-1.5"
                        >
                          Confirm New Password
                        </label>
                        <input
                          id="reset-confirm-password"
                          type={showNewPassword ? 'text' : 'password'}
                          required
                          minLength={6}
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          placeholder="Re-enter your new password"
                          className="w-full h-11 px-3.5 rounded-xl bg-[#F8F9FA] dark:bg-[#121316] border border-[#D1D5DB] dark:border-[#374151] text-sm text-[#111827] dark:text-white placeholder:text-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#1877F2] dark:focus:ring-[#3B82F6] focus:border-transparent"
                        />
                      </div>

                      <button
                        type="submit"
                        disabled={loading}
                        className="w-full h-11 rounded-xl bg-[#1877F2] hover:bg-[#166FE5] dark:bg-[#2563EB] dark:hover:bg-[#1D4ED8] text-white font-semibold text-sm transition-colors disabled:opacity-60 cursor-pointer"
                      >
                        {loading ? 'Updating password...' : 'Update Password'}
                      </button>

                      <div className="text-center">
                        <button
                          type="button"
                          onClick={() => onNavigateAuth('forgot-password')}
                          className="text-xs font-medium text-[#65676B] dark:text-[#9CA3AF] hover:text-[#1877F2] dark:hover:text-[#60A5FA] cursor-pointer"
                        >
                          Need a new reset token? Go to Forgot Password
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              )}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
