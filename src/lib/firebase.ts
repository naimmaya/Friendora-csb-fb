import {initializeApp} from 'firebase/app';
import {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  getAuth,
  GoogleAuthProvider,
  RecaptchaVerifier,
  sendEmailVerification,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPhoneNumber,
  signInWithPopup,
  signOut,
  updateProfile,
  type ConfirmationResult,
  type User,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  getDocFromServer,
  getFirestore,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import {getStorage} from 'firebase/storage';
import firebaseConfig from '../../firebase-applet-config.json';
import type {UserProfile} from '../types';

export const firebaseApp = initializeApp(firebaseConfig);
export const db = getFirestore(firebaseApp, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(firebaseApp);
export const storage = getStorage(firebaseApp);
storage.maxUploadRetryTime = 6000;
storage.maxOperationRetryTime = 6000;

// Enforce browserLocalPersistence so users remain logged in after closing and reopening the app
export const authPersistenceReady: Promise<void> = setPersistence(
  auth,
  browserLocalPersistence,
).catch(() => {
  // Ignore only if browser blocks persistence in private iframe mode
});

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null,
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export function formatFirestoreErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err || 'Database error');
  try {
    const parsed = JSON.parse(raw) as Partial<FirestoreErrorInfo>;
    if (parsed && typeof parsed.error === 'string') {
      if (/permission|insufficient/i.test(parsed.error)) {
        return `Permission denied while saving to Firestore (${parsed.path || 'database'}). Make sure your email is verified and try again.`;
      }
      if (/offline|network/i.test(parsed.error)) {
        return 'Cannot reach Cloud Firestore right now. Check your internet connection and try again.';
      }
      if (/quota/i.test(parsed.error)) {
        return 'Cloud Firestore daily free quota exceeded. Please try again tomorrow or upgrade your plan.';
      }
      return `Firestore error: ${parsed.error}`;
    }
  } catch {
    // Not JSON
  }
  return raw;
}

// Validate Firestore connectivity at startup
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
testConnection();

export const FIREBASE_CONSOLE_AUTH_URL = `https://console.firebase.google.com/project/${firebaseConfig.projectId}/authentication/providers`;

export type FirebaseAuthMethod = 'google' | 'email_otp' | 'phone_otp' | 'password';

function clampString(value: string | null | undefined, maxLength: number): string {
  return String(value || '').trim().slice(0, maxLength);
}

export function isFirebaseUserVerified(user: User | null | undefined): boolean {
  if (!user) return false;
  return user.emailVerified === true || Boolean(user.phoneNumber);
}

/**
 * Persist verified user's public & owner-only private profile into Cloud Firestore
 * following the split-collection blueprint (users/{uid} + users/{uid}/private/info).
 * Throws real Firestore errors via handleFirestoreError — never silently fakes a save!
 */
export async function syncUserProfileToFirestore(
  user: User,
  profile: Partial<UserProfile> & {name: string},
  authMethod: FirebaseAuthMethod,
): Promise<void> {
  if (!user.uid) {
    throw new Error('Not signed in with Firebase Auth.');
  }
  if (!isFirebaseUserVerified(user)) {
    throw new Error('Please verify your email address before saving profile changes.');
  }

  const publicPath = `users/${user.uid}`;
  const privatePath = `users/${user.uid}/private/info`;
  const publicRef = doc(db, 'users', user.uid);
  const privateRef = doc(db, 'users', user.uid, 'private', 'info');

  let existingPublic = false;
  let existingPrivate = false;
  try {
    const [pubSnap, privSnap] = await Promise.all([getDoc(publicRef), getDoc(privateRef)]);
    existingPublic = pubSnap.exists();
    existingPrivate = privSnap.exists();
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, publicPath);
  }

  const safeName = clampString(profile.name || user.displayName || 'Verve Member', 60);
  const validName = safeName.length >= 2 ? safeName : 'Verve Member';

  const batch = writeBatch(db);
  if (!existingPublic) {
    batch.set(publicRef, {
      uid: user.uid,
      name: validName,
      bio: clampString(profile.bio, 320),
      location: clampString(profile.location, 80),
      work: clampString(profile.work, 100),
      avatarUrl: clampString(profile.avatar_url ?? user.photoURL ?? '', 450000),
      coverUrl: clampString(profile.cover_url ?? '', 450000),
      visibility: 'public',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } else {
    batch.update(publicRef, {
      name: validName,
      bio: clampString(profile.bio, 320),
      location: clampString(profile.location, 80),
      work: clampString(profile.work, 100),
      avatarUrl: clampString(profile.avatar_url ?? user.photoURL ?? '', 450000),
      coverUrl: clampString(profile.cover_url ?? '', 450000),
      visibility: 'public',
      updatedAt: serverTimestamp(),
    });
  }

  if (!existingPrivate) {
    batch.set(privateRef, {
      uid: user.uid,
      email: clampString(profile.email || user.email, 120),
      phone: clampString(profile.phone || user.phoneNumber, 24),
      authMethod,
      verified: true,
      dateOfBirth: clampString(profile.date_of_birth, 20),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } else {
    batch.update(privateRef, {
      email: clampString(profile.email || user.email, 120),
      phone: clampString(profile.phone || user.phoneNumber, 24),
      dateOfBirth: clampString(profile.date_of_birth, 20),
      updatedAt: serverTimestamp(),
    });
  }

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, privatePath);
  }
}

export async function loadUserProfileFromFirestore(user: User): Promise<{
  name?: string;
  bio?: string;
  location?: string;
  work?: string;
  avatar_url?: string;
  cover_url?: string;
  email?: string;
  phone?: string;
  date_of_birth?: string;
  created_at?: string;
} | null> {
  if (!user.uid) return null;
  const publicRef = doc(db, 'users', user.uid);
  const privateRef = doc(db, 'users', user.uid, 'private', 'info');
  try {
    const [pubSnap, privSnap] = await Promise.all([getDoc(publicRef), getDoc(privateRef)]);
    if (!pubSnap.exists() && !privSnap.exists()) return null;
    const pub = pubSnap.exists() ? pubSnap.data() : {};
    const priv = privSnap.exists() ? privSnap.data() : {};
    const createdAtTs = pub.createdAt || priv.createdAt;
    const createdAtIso =
      createdAtTs && typeof createdAtTs.toDate === 'function'
        ? createdAtTs.toDate().toISOString()
        : new Date().toISOString();
    return {
      name: typeof pub.name === 'string' ? pub.name : undefined,
      bio: typeof pub.bio === 'string' ? pub.bio : undefined,
      location: typeof pub.location === 'string' ? pub.location : undefined,
      work: typeof pub.work === 'string' ? pub.work : undefined,
      avatar_url: typeof pub.avatarUrl === 'string' ? pub.avatarUrl : undefined,
      cover_url: typeof pub.coverUrl === 'string' ? pub.coverUrl : undefined,
      email: typeof priv.email === 'string' && priv.email ? priv.email : undefined,
      phone: typeof priv.phone === 'string' && priv.phone ? priv.phone : undefined,
      date_of_birth: typeof priv.dateOfBirth === 'string' ? priv.dateOfBirth : undefined,
      created_at: createdAtIso,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `users/${user.uid}`);
  }
}

export async function signInWithGooglePopup(): Promise<{user: User; idToken: string}> {
  await authPersistenceReady;
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({prompt: 'select_account'});
  const cred = await signInWithPopup(auth, provider);
  const idToken = await cred.user.getIdToken(true);
  return {user: cred.user, idToken};
}

let activeRecaptcha: RecaptchaVerifier | null = null;

export function clearPhoneRecaptcha() {
  if (activeRecaptcha) {
    try {
      activeRecaptcha.clear();
    } catch {
      // Ignore cleanup error
    }
    activeRecaptcha = null;
  }
}

export async function sendFirebasePhoneOtp(
  e164Phone: string,
  containerId: string,
): Promise<ConfirmationResult> {
  await authPersistenceReady;
  clearPhoneRecaptcha();
  const container = document.getElementById(containerId);
  if (!container) {
    throw new Error('Verification container is not ready. Please try again.');
  }
  container.innerHTML = '';
  activeRecaptcha = new RecaptchaVerifier(auth, containerId, {
    size: 'invisible',
  });
  try {
    return await signInWithPhoneNumber(auth, e164Phone, activeRecaptcha);
  } catch (err) {
    clearPhoneRecaptcha();
    throw err;
  }
}

/**
 * Create a new Firebase Email + Password account and immediately send Firebase email verification.
 * Caller MUST block app entry until user.emailVerified === true.
 */
export async function registerWithEmailAndSendVerification(
  email: string,
  password: string,
  displayName: string,
): Promise<{user: User}> {
  await authPersistenceReady;
  const cred = await createUserWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
  if (displayName.trim()) {
    await updateProfile(cred.user, {displayName: displayName.trim()}).catch(() => {});
  }
  await sendEmailVerification(cred.user);
  return {user: cred.user};
}

/**
 * Sign in via Firebase Email + Password and refresh emailVerified status.
 */
export async function signInWithEmailFirebase(
  email: string,
  password: string,
): Promise<{user: User; emailVerified: boolean; idToken: string}> {
  await authPersistenceReady;
  const cred = await signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
  await cred.user.reload();
  const freshUser = auth.currentUser || cred.user;
  const idToken = await freshUser.getIdToken(true);
  return {
    user: freshUser,
    emailVerified: freshUser.emailVerified === true,
    idToken,
  };
}

export async function resendCurrentUserEmailVerification(): Promise<void> {
  if (!auth.currentUser) {
    throw new Error('No pending account found. Please sign in or create an account again.');
  }
  await sendEmailVerification(auth.currentUser);
}

export async function checkCurrentUserEmailVerified(): Promise<{
  verified: boolean;
  user: User;
  idToken: string;
}> {
  const current = auth.currentUser;
  if (!current) {
    throw new Error('Session expired. Please sign in again.');
  }
  await current.reload();
  const refreshed = auth.currentUser || current;
  const idToken = await refreshed.getIdToken(true);
  return {
    verified: refreshed.emailVerified === true,
    user: refreshed,
    idToken,
  };
}

export async function sendFirebasePasswordReset(email: string): Promise<void> {
  await authPersistenceReady;
  await sendPasswordResetEmail(auth, email.trim().toLowerCase());
}

export async function tryFirebaseEmailSignIn(
  email: string,
  password: string,
): Promise<{user: User; idToken: string} | null> {
  try {
    await authPersistenceReady;
    const cred = await signInWithEmailAndPassword(auth, email, password);
    await cred.user.reload();
    const fresh = auth.currentUser || cred.user;
    const idToken = await fresh.getIdToken(true);
    return {user: fresh, idToken};
  } catch {
    return null;
  }
}

export async function signOutFirebase(): Promise<void> {
  try {
    await signOut(auth);
  } catch {
    // Ignore
  }
}
