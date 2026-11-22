import {initializeApp} from 'firebase/app';
import {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  getAuth,
  GoogleAuthProvider,
  RecaptchaVerifier,
  sendEmailVerification,
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
import firebaseConfig from '../../firebase-applet-config.json';
import type {UserProfile} from '../types';

export const firebaseApp = initializeApp(firebaseConfig);
export const db = getFirestore(firebaseApp, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(firebaseApp);

// Keep Firebase auth state persisted cleanly across refreshes
setPersistence(auth, browserLocalPersistence).catch(() => {
  // Ignore if browser restricts persistence in private iframe mode
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

/**
 * Persist verified user's public & owner-only private profile into Cloud Firestore
 * following the split-collection blueprint (users/{uid} + users/{uid}/private/info).
 */
export async function syncUserProfileToFirestore(
  user: User,
  profile: Partial<UserProfile> & {name: string},
  authMethod: FirebaseAuthMethod,
): Promise<void> {
  if (!user.uid) return;
  // Security rules strictly mandate verified email or verified phone
  const isVerified = user.emailVerified === true || Boolean(user.phoneNumber);
  if (!isVerified) return;

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
      avatarUrl: clampString(profile.avatar_url || user.photoURL, 2048),
      coverUrl: clampString(profile.cover_url, 2048),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } else {
    batch.update(publicRef, {
      name: validName,
      bio: clampString(profile.bio, 320),
      location: clampString(profile.location, 80),
      work: clampString(profile.work, 100),
      avatarUrl: clampString(profile.avatar_url || user.photoURL, 2048),
      coverUrl: clampString(profile.cover_url, 2048),
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
} | null> {
  if (!user.uid) return null;
  const publicRef = doc(db, 'users', user.uid);
  const privateRef = doc(db, 'users', user.uid, 'private', 'info');
  try {
    const [pubSnap, privSnap] = await Promise.all([getDoc(publicRef), getDoc(privateRef)]);
    if (!pubSnap.exists() && !privSnap.exists()) return null;
    const pub = pubSnap.exists() ? pubSnap.data() : {};
    const priv = privSnap.exists() ? privSnap.data() : {};
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
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `users/${user.uid}`);
  }
}

export async function signInWithGooglePopup(): Promise<{user: User; idToken: string}> {
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

export async function tryFirebaseEmailSignIn(
  email: string,
  password: string,
): Promise<{user: User; idToken: string} | null> {
  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    const idToken = await cred.user.getIdToken(true);
    return {user: cred.user, idToken};
  } catch {
    return null;
  }
}

export async function tryFirebaseEmailRegister(
  email: string,
  password: string,
  displayName: string,
): Promise<{user: User; verificationSent: boolean} | null> {
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    if (displayName) {
      await updateProfile(cred.user, {displayName}).catch(() => {});
    }
    await sendEmailVerification(cred.user);
    return {user: cred.user, verificationSent: true};
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
