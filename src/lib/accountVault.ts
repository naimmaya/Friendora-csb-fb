import type {UserProfile} from '../types';
import {buildPhoneLookupCandidates} from './contactValidation';

/**
 * Permanent Client-Side Account Vault (IndexedDB + localStorage dual mirror).
 *
 * Guarantees that every verified user account persists across page refreshes,
 * logouts, and backend container redeploys. Passwords are NEVER stored in plaintext —
 * only a salted PBKDF2-SHA256 verifier is saved. Logout NEVER touches this vault.
 */

const LS_VAULT_KEY = 'verve_permanent_accounts_v1';
const IDB_NAME = 'verve_permanent_vault_db';
const IDB_STORE = 'accounts';
const PBKDF2_ITERATIONS = 100000;

export interface VaultAccountRecord {
  id: string; // canonical key: email or E.164 phone
  userId?: number | null;
  name: string;
  email: string | null;
  phone: string | null;
  passwordSalt: string;
  passwordHash: string;
  bio: string;
  location: string;
  work: string;
  avatar_url: string;
  cover_url: string;
  date_of_birth: string;
  verified: boolean;
  authMethod: 'google' | 'email_otp' | 'phone_otp' | 'password';
  firebaseUid?: string | null;
  sessionToken?: string | null;
  created_at: string;
  updated_at: string;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const buf = new ArrayBuffer(hex.length / 2);
  const arr = new Uint8Array(buf);
  for (let i = 0; i < arr.length; i++) {
    arr[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return arr;
}

async function derivePasswordHash(password: string, saltHex: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      enc.encode(password),
      'PBKDF2',
      false,
      ['deriveBits'],
    );
    const bits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: hexToBytes(saltHex),
        iterations: PBKDF2_ITERATIONS,
        hash: 'SHA-256',
      },
      keyMaterial,
      256,
    );
    return bytesToHex(new Uint8Array(bits));
  }
  // Fallback deterministic SHA-like mixer only if SubtleCrypto is unavailable in non-secure context
  let h1 = 0xdeadbeef ^ saltHex.length;
  let h2 = 0x41c6ce57 ^ password.length;
  const input = `${saltHex}:${password}`;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  return `${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`;
}

function generateSaltHex(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytesToHex(bytes);
}

function openVaultIdb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    try {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE, {keyPath: 'id'});
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function readLocalStorageVault(): VaultAccountRecord[] {
  try {
    const raw = localStorage.getItem(LS_VAULT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as VaultAccountRecord[]) : [];
  } catch {
    return [];
  }
}

function writeLocalStorageVault(records: VaultAccountRecord[]) {
  try {
    localStorage.setItem(LS_VAULT_KEY, JSON.stringify(records));
  } catch {
    // Ignore quota issues; IndexedDB still holds the copy
  }
}

async function readIdbVault(): Promise<VaultAccountRecord[]> {
  const db = await openVaultIdb();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).getAll();
      req.onsuccess = () => resolve((req.result as VaultAccountRecord[]) || []);
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

async function writeIdbAccount(record: VaultAccountRecord): Promise<void> {
  const db = await openVaultIdb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

async function deleteIdbAccount(id: string): Promise<void> {
  const db = await openVaultIdb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

async function migrateLegacyLocalStoreUsers(
  byId: Map<string, VaultAccountRecord>,
): Promise<boolean> {
  try {
    const raw = localStorage.getItem('verve_local_store_v1');
    if (!raw) return false;
    const parsed = JSON.parse(raw) as {
      users?: Array<{
        name?: string;
        email?: string | null;
        phone?: string | null;
        password?: string;
        bio?: string;
        location?: string;
        work?: string;
        avatar_url?: string;
        cover_url?: string;
        date_of_birth?: string;
        created_at?: string;
      }>;
    };
    if (!Array.isArray(parsed?.users) || parsed.users.length === 0) return false;

    let changed = false;
    for (const u of parsed.users) {
      const email = u.email ? String(u.email).trim().toLowerCase() : null;
      const phone = u.phone ? String(u.phone).trim() : null;
      if (!email && !phone) continue;

      // Skip if already present in permanent vault
      const alreadyExists = Array.from(byId.values()).some((existing) => {
        if (email && existing.email && existing.email.toLowerCase() === email) return true;
        if (phone && existing.phone) {
          const a = new Set(buildPhoneLookupCandidates(phone));
          return buildPhoneLookupCandidates(existing.phone).some((c) => a.has(c));
        }
        return false;
      });
      if (alreadyExists) continue;

      let passwordSalt = '';
      let passwordHash = '';
      if (typeof u.password === 'string' && u.password.length >= 6) {
        passwordSalt = generateSaltHex();
        passwordHash = await derivePasswordHash(u.password, passwordSalt);
      }

      const nowIso = new Date().toISOString();
      const id = canonicalVaultId(email, phone);
      const migrated: VaultAccountRecord = {
        id,
        name: String(u.name || 'Verve Member').trim() || 'Verve Member',
        email,
        phone,
        passwordSalt,
        passwordHash,
        bio: String(u.bio || ''),
        location: String(u.location || ''),
        work: String(u.work || ''),
        avatar_url: String(u.avatar_url || ''),
        cover_url: String(u.cover_url || ''),
        date_of_birth: String(u.date_of_birth || ''),
        verified: true,
        authMethod: 'password',
        firebaseUid: null,
        created_at: u.created_at || nowIso,
        updated_at: nowIso,
      };
      byId.set(id, migrated);
      await writeIdbAccount(migrated);
      changed = true;
    }
    return changed;
  } catch {
    return false;
  }
}

async function loadMergedVault(): Promise<VaultAccountRecord[]> {
  const lsRecords = readLocalStorageVault();
  const idbRecords = await readIdbVault();
  const byId = new Map<string, VaultAccountRecord>();

  for (const r of lsRecords) byId.set(r.id, r);
  for (const r of idbRecords) {
    const existing = byId.get(r.id);
    if (!existing || new Date(r.updated_at).getTime() >= new Date(existing.updated_at).getTime()) {
      byId.set(r.id, r);
    }
  }

  const migratedLegacy = await migrateLegacyLocalStoreUsers(byId);
  const merged = Array.from(byId.values());
  // Self-heal both mirrors if one was cleared or legacy accounts were migrated
  if (migratedLegacy || merged.length > lsRecords.length) {
    writeLocalStorageVault(merged);
  }
  return merged;
}

function canonicalVaultId(email: string | null | undefined, phone: string | null | undefined): string {
  if (email && email.trim()) return `email:${email.trim().toLowerCase()}`;
  if (phone && phone.trim()) {
    const candidates = buildPhoneLookupCandidates(phone);
    return `phone:${candidates[0] || phone.trim()}`;
  }
  return `acct:${Date.now()}`;
}

export function matchAccountByIdentifier(
  records: VaultAccountRecord[],
  identifier: string,
): VaultAccountRecord | undefined {
  const raw = identifier.trim();
  if (!raw) return undefined;

  if (raw.includes('@')) {
    const target = raw.toLowerCase();
    return records.find((r) => r.email && r.email.toLowerCase() === target);
  }

  const candidates = new Set(buildPhoneLookupCandidates(raw));
  if (candidates.size === 0) return undefined;

  return records.find((r) => {
    if (!r.phone) return false;
    const storedCandidates = buildPhoneLookupCandidates(r.phone);
    return storedCandidates.some((c) => candidates.has(c));
  });
}

/**
 * Permanently save or update a verified user's account in both IndexedDB and localStorage.
 * If password is provided, updates the salted PBKDF2 hash; otherwise preserves the existing hash.
 */
export async function saveAccountToVault(params: {
  user: UserProfile;
  password?: string;
  authMethod?: 'google' | 'email_otp' | 'phone_otp' | 'password';
  firebaseUid?: string | null;
  sessionToken?: string | null;
}): Promise<void> {
  const records = await loadMergedVault();
  const normalizedEmail = params.user.email ? params.user.email.trim().toLowerCase() : null;
  const normalizedPhone = params.user.phone ? params.user.phone.trim() : null;

  const existing = records.find((r) => {
    if (normalizedEmail && r.email && r.email.toLowerCase() === normalizedEmail) return true;
    if (normalizedPhone && r.phone) {
      const a = new Set(buildPhoneLookupCandidates(normalizedPhone));
      return buildPhoneLookupCandidates(r.phone).some((c) => a.has(c));
    }
    if (params.firebaseUid && r.firebaseUid && r.firebaseUid === params.firebaseUid) return true;
    if (params.user.id && r.userId && r.userId === params.user.id) return true;
    return false;
  });

  let passwordSalt = existing?.passwordSalt || '';
  let passwordHash = existing?.passwordHash || '';
  if (params.password) {
    passwordSalt = generateSaltHex();
    passwordHash = await derivePasswordHash(params.password, passwordSalt);
  }

  const nowIso = new Date().toISOString();
  const record: VaultAccountRecord = {
    id: existing?.id || canonicalVaultId(normalizedEmail, normalizedPhone),
    userId: params.user.id ?? existing?.userId ?? null,
    name: params.user.name,
    email: normalizedEmail,
    phone: normalizedPhone,
    passwordSalt,
    passwordHash,
    bio: params.user.bio || existing?.bio || '',
    location: params.user.location || existing?.location || '',
    work: params.user.work || existing?.work || '',
    avatar_url: params.user.avatar_url || existing?.avatar_url || '',
    cover_url: params.user.cover_url || existing?.cover_url || '',
    date_of_birth: params.user.date_of_birth || existing?.date_of_birth || '',
    verified: true,
    authMethod: params.authMethod || existing?.authMethod || 'password',
    firebaseUid: params.firebaseUid ?? existing?.firebaseUid ?? null,
    sessionToken:
      params.sessionToken !== undefined ? params.sessionToken : (existing?.sessionToken ?? null),
    created_at: existing?.created_at || params.user.created_at || nowIso,
    updated_at: nowIso,
  };

  const nextRecords = records.filter((r) => r.id !== record.id);
  nextRecords.push(record);
  writeLocalStorageVault(nextRecords);
  await writeIdbAccount(record);
}

/**
 * Verify identifier + password against the permanent vault.
 * Returns the saved account record ONLY if the PBKDF2 password hash matches.
 */
export async function verifyCredentialsInVault(
  identifier: string,
  password: string,
): Promise<VaultAccountRecord | null> {
  const records = await loadMergedVault();
  const match = matchAccountByIdentifier(records, identifier);
  if (!match || !match.passwordSalt || !match.passwordHash) return null;

  const candidateHash = await derivePasswordHash(password, match.passwordSalt);
  if (candidateHash !== match.passwordHash) return null;
  return match;
}

export async function updateVaultPasswordByIdentifier(
  identifier: string,
  newPassword: string,
): Promise<void> {
  const records = await loadMergedVault();
  const match = matchAccountByIdentifier(records, identifier);
  if (!match) return;
  const passwordSalt = generateSaltHex();
  const passwordHash = await derivePasswordHash(newPassword, passwordSalt);
  const updated: VaultAccountRecord = {
    ...match,
    passwordSalt,
    passwordHash,
    updated_at: new Date().toISOString(),
  };
  const next = records.filter((r) => r.id !== updated.id);
  next.push(updated);
  writeLocalStorageVault(next);
  await writeIdbAccount(updated);
}

export async function findVaultAccount(identifier: string): Promise<VaultAccountRecord | null> {
  const records = await loadMergedVault();
  return matchAccountByIdentifier(records, identifier) || null;
}

/**
 * List all accounts created or signed into on this device, ordered by most recently used.
 */
export async function listVaultAccounts(): Promise<VaultAccountRecord[]> {
  const records = await loadMergedVault();
  return records.sort(
    (a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime(),
  );
}

/**
 * Clear ONLY the cached session token for an account (e.g. on explicit logout or 401 expiry).
 * The account itself and its PBKDF2 verifier remain permanently saved in the vault.
 */
export async function clearVaultSessionToken(identifierOrVaultId: string): Promise<void> {
  const trimmed = identifierOrVaultId.trim();
  if (!trimmed) return;
  const records = await loadMergedVault();
  const match =
    records.find((r) => r.id === trimmed) || matchAccountByIdentifier(records, trimmed);
  if (!match || !match.sessionToken) return;
  const updated: VaultAccountRecord = {
    ...match,
    sessionToken: null,
  };
  const next = records.filter((r) => r.id !== updated.id);
  next.push(updated);
  writeLocalStorageVault(next);
  await writeIdbAccount(updated);
}

/**
 * Explicitly remove an account from this device's Switch Account list (only when user taps Remove).
 */
export async function removeVaultAccount(vaultId: string): Promise<void> {
  const records = await loadMergedVault();
  const next = records.filter((r) => r.id !== vaultId);
  writeLocalStorageVault(next);
  await deleteIdbAccount(vaultId);
}
