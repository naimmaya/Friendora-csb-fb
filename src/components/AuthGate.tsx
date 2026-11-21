import {useEffect, useState} from 'react';
import type {FormEvent} from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Mail,
  Moon,
  Phone,
  Sun,
} from 'lucide-react';
import {apiRequest, setAuthToken} from '../lib/api';
import {PRESET_COVERS} from '../lib/assets';
import type {AuthView, UserProfile} from '../types';
import {CoverImage} from './MediaImage';

interface AuthGateProps {
  authView: AuthView;
  resetTokenFromUrl: string;
  onNavigateAuth: (view: AuthView, query?: string) => void;
  onAuthenticated: (user: UserProfile, token: string) => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
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

  // Register state
  const [regMode, setRegMode] = useState<'email' | 'phone'>('email');
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [showRegPassword, setShowRegPassword] = useState(false);

  // Forgot password state
  const [forgotIdentifier, setForgotIdentifier] = useState('');
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
    setError(null);
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

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const data = await apiRequest<{token: string; user: UserProfile}>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          identifier: loginIdentifier.trim(),
          password: loginPassword,
        }),
      });
      setAuthToken(data.token);
      onAuthenticated(data.user, data.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in.');
    } finally {
      setLoading(false);
    }
  }

  async function handleDemoLogin() {
    setError(null);
    setLoading(true);
    try {
      const data = await apiRequest<{token: string; user: UserProfile}>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          identifier: 'maya@verve.social',
          password: 'Password123!',
        }),
      });
      setAuthToken(data.token);
      onAuthenticated(data.user, data.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in with demo account.');
    } finally {
      setLoading(false);
    }
  }

  async function handleRegister(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const payload =
        regMode === 'email'
          ? {name: regName.trim(), email: regEmail.trim(), password: regPassword}
          : {name: regName.trim(), phone: regPhone.trim(), password: regPassword};

      const data = await apiRequest<{token: string; user: UserProfile}>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setAuthToken(data.token);
      onAuthenticated(data.user, data.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create account.');
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setForgotResult(null);
    setLoading(true);
    try {
      const data = await apiRequest<{
        message: string;
        resetToken: string;
        resetPath: string;
        maskedDestination: string;
      }>('/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({identifier: forgotIdentifier.trim()}),
      });
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

  return (
    <div className="min-h-screen bg-[#F0F2F5] dark:bg-[#121316] text-[#111827] dark:text-[#F3F4F6] flex flex-col">
      {/* Minimal clean entry top bar */}
      <header className="w-full border-b border-[#E4E6EB] dark:border-[#2E3035] bg-white dark:bg-[#1C1E21]">
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
                Share photos and updates with friends, customize your personal profile, and message in real time across every device.
              </p>
            </div>

            <div className="relative w-full aspect-[16/9] rounded-2xl overflow-hidden border border-[#E4E6EB] dark:border-[#2E3035] bg-[#1E293B]">
              <CoverImage
                src={PRESET_COVERS[0].url}
                alt="Pacific coastline overlooking minimalist architecture"
              />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-5 sm:p-6">
                <p className="text-white text-sm sm:text-base font-medium">
                  Real-time messaging, curated profiles, and distraction-free feeds.
                </p>
                <p className="text-white/75 text-xs sm:text-sm mt-1">
                  Sign in with your Gmail, email, or phone number to enter Home.
                </p>
              </div>
            </div>
          </section>

          {/* Right auth card */}
          <section className="lg:col-span-5 flex items-center">
            <div className="w-full bg-white dark:bg-[#1C1E21] border border-[#E4E6EB] dark:border-[#2E3035] rounded-2xl p-6 sm:p-8 shadow-sm">
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
                  className="mb-5 flex items-start gap-2.5 p-3.5 rounded-xl bg-[#FEF2F2] dark:bg-[#3B181A] border border-[#FECACA] dark:border-[#7F1D1D] text-[#B91C1C] dark:text-[#FCA5A5] text-sm"
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
                      Sign in using your Gmail/email address or phone number.
                    </p>
                  </div>

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
                      placeholder="name@gmail.com or +1 555 010 4200"
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
                        {showLoginPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full h-11 rounded-xl bg-[#1877F2] hover:bg-[#166FE5] dark:bg-[#2563EB] dark:hover:bg-[#1D4ED8] text-white font-semibold text-sm transition-colors disabled:opacity-60 flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <span>{loading ? 'Signing in...' : 'Sign In'}</span>
                    {!loading && <ArrowRight className="w-4 h-4" />}
                  </button>

                  <div className="pt-3 border-t border-[#E4E6EB] dark:border-[#2E3035] space-y-3">
                    <button
                      type="button"
                      onClick={handleDemoLogin}
                      disabled={loading}
                      className="w-full h-10 rounded-xl border border-[#D1D5DB] dark:border-[#374151] text-[#111827] dark:text-[#E5E7EB] hover:bg-[#F0F2F5] dark:hover:bg-[#2A2D32] font-medium text-sm transition-colors cursor-pointer"
                    >
                      Quick Demo Sign In (Maya Lin)
                    </button>
                    <p className="text-center text-xs text-[#65676B] dark:text-[#9CA3AF]">
                      New to Verve?{' '}
                      <button
                        type="button"
                        onClick={() => onNavigateAuth('register')}
                        className="font-semibold text-[#1877F2] dark:text-[#60A5FA] hover:underline cursor-pointer"
                      >
                        Create an account
                      </button>
                    </p>
                  </div>
                </form>
              )}

              {/* VIEW 2: REGISTER */}
              {authView === 'register' && (
                <form onSubmit={handleRegister} className="space-y-4">
                  <div>
                    <h2 className="text-xl font-display font-bold text-[#111827] dark:text-white">
                      Create your account
                    </h2>
                    <p className="text-sm text-[#65676B] dark:text-[#9CA3AF] mt-1">
                      Sign up with your Gmail/email or phone number in seconds.
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
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-sm font-medium text-[#374151] dark:text-[#D1D5DB]">
                        {regMode === 'email' ? 'Gmail / Email Address' : 'Phone Number'}
                      </span>
                      <div className="inline-flex items-center gap-1 p-0.5 rounded-lg bg-[#F0F2F5] dark:bg-[#121316]">
                        <button
                          type="button"
                          onClick={() => setRegMode('email')}
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
                          onClick={() => setRegMode('phone')}
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
                      <input
                        id="reg-email"
                        type="email"
                        required
                        autoComplete="email"
                        value={regEmail}
                        onChange={(e) => setRegEmail(e.target.value)}
                        placeholder="alex.rivera@gmail.com"
                        className="w-full h-11 px-3.5 rounded-xl bg-[#F8F9FA] dark:bg-[#121316] border border-[#D1D5DB] dark:border-[#374151] text-sm text-[#111827] dark:text-white placeholder:text-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#1877F2] dark:focus:ring-[#3B82F6] focus:border-transparent"
                      />
                    ) : (
                      <input
                        id="reg-phone"
                        type="tel"
                        required
                        autoComplete="tel"
                        value={regPhone}
                        onChange={(e) => setRegPhone(e.target.value)}
                        placeholder="+1 555 234 5678"
                        className="w-full h-11 px-3.5 rounded-xl bg-[#F8F9FA] dark:bg-[#121316] border border-[#D1D5DB] dark:border-[#374151] text-sm text-[#111827] dark:text-white placeholder:text-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#1877F2] dark:focus:ring-[#3B82F6] focus:border-transparent"
                      />
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
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 text-[#65676B] dark:text-[#9CA3AF] hover:text-[#111827] dark:hover:text-white cursor-pointer"
                      >
                        {showRegPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full h-11 rounded-xl bg-[#1877F2] hover:bg-[#166FE5] dark:bg-[#2563EB] dark:hover:bg-[#1D4ED8] text-white font-semibold text-sm transition-colors disabled:opacity-60 flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <span>{loading ? 'Creating account...' : 'Create Account'}</span>
                    {!loading && <ArrowRight className="w-4 h-4" />}
                  </button>

                  <p className="text-center text-xs text-[#65676B] dark:text-[#9CA3AF] pt-2">
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
                          placeholder="maya@verve.social or +15550104200"
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
                            {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
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
