import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import Database from 'better-sqlite3';
import dotenv from 'dotenv';
import express from 'express';
import type {NextFunction, Request, Response} from 'express';
import nodemailer from 'nodemailer';
import {WebSocket, WebSocketServer} from 'ws';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let FIREBASE_WEB_API_KEY = '';
try {
  const fbCfgPath = path.resolve(__dirname, 'firebase-applet-config.json');
  if (fs.existsSync(fbCfgPath)) {
    const parsed = JSON.parse(fs.readFileSync(fbCfgPath, 'utf8')) as {apiKey?: string};
    FIREBASE_WEB_API_KEY = String(parsed.apiKey || '').trim();
  }
} catch {
  // Ignore if Firebase config file is not present
}

const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

// Ensure persistent directories exist
const dataDir = path.resolve(__dirname, 'data');
const uploadsDir = path.resolve(__dirname, 'uploads');
fs.mkdirSync(dataDir, {recursive: true});
fs.mkdirSync(uploadsDir, {recursive: true});

const dbPath = path.join(dataDir, 'verve.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Generated static assets (served by Vite in dev & copied to dist in prod)
const ASSETS = {
  coverCoast: '/src/assets/images/cover_golden_coast_1795166178146.jpg',
  coverAlpine: '/src/assets/images/cover_alpine_studio_1795166136457.jpg',
  postCoffee: '/src/assets/images/post_artisan_coffee_1795166101485.jpg',
  postBridge: '/src/assets/images/post_city_twilight_1795166101000.jpg',
  avatarMaya: '/src/assets/images/avatar_maya_1795166100977.jpg',
  avatarDevon: '/src/assets/images/avatar_devon_1795166101355.jpg',
  avatarPriya: '/src/assets/images/avatar_priya_1795166136721.jpg',
  avatarLucas: '/src/assets/images/avatar_lucas_1795166101649.jpg',
};

// Initialize relational schema
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE,
    phone TEXT UNIQUE,
    password_hash TEXT NOT NULL,
    bio TEXT NOT NULL DEFAULT '',
    location TEXT NOT NULL DEFAULT '',
    work TEXT NOT NULL DEFAULT '',
    avatar_url TEXT NOT NULL DEFAULT '',
    cover_url TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS password_resets (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    expires_at TEXT NOT NULL,
    used INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    image_url TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS post_likes (
    post_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (post_id, user_id),
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS friendships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    requester_id INTEGER NOT NULL,
    addressee_id INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'accepted')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (requester_id, addressee_id),
    FOREIGN KEY (requester_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (addressee_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS follows (
    follower_id INTEGER NOT NULL,
    following_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (follower_id, following_id),
    FOREIGN KEY (follower_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (following_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id INTEGER NOT NULL,
    receiver_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    actor_id INTEGER,
    type TEXT NOT NULL,
    entity_id INTEGER,
    message TEXT NOT NULL,
    read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS saved_posts (
    user_id INTEGER NOT NULL,
    post_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, post_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS user_settings (
    user_id INTEGER PRIMARY KEY,
    profile_visibility TEXT NOT NULL DEFAULT 'public',
    friend_request_policy TEXT NOT NULL DEFAULT 'everyone',
    show_online_status INTEGER NOT NULL DEFAULT 1,
    email_notifications INTEGER NOT NULL DEFAULT 1,
    push_notifications INTEGER NOT NULL DEFAULT 1,
    language TEXT NOT NULL DEFAULT 'English',
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS groups_table (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    cover_url TEXT NOT NULL DEFAULT '',
    created_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS group_members (
    group_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    joined_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (group_id, user_id),
    FOREIGN KEY (group_id) REFERENCES groups_table(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS marketplace_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    seller_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    price TEXT NOT NULL,
    category TEXT NOT NULL,
    location TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    image_url TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS events_table (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    event_date TEXT NOT NULL,
    location TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    host_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (host_id) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS event_rsvps (
    event_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('going', 'interested')),
    PRIMARY KEY (event_id, user_id),
    FOREIGN KEY (event_id) REFERENCES events_table(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS pages_table (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    bio TEXT NOT NULL DEFAULT '',
    avatar_url TEXT NOT NULL DEFAULT '',
    created_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS page_follows (
    page_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    PRIMARY KEY (page_id, user_id),
    FOREIGN KEY (page_id) REFERENCES pages_table(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS user_security (
    user_id INTEGER PRIMARY KEY,
    two_factor_enabled INTEGER NOT NULL DEFAULT 0,
    two_factor_method TEXT NOT NULL DEFAULT 'authenticator',
    two_factor_secret TEXT NOT NULL DEFAULT '',
    backup_codes TEXT NOT NULL DEFAULT '[]',
    saved_login_enabled INTEGER NOT NULL DEFAULT 1,
    advanced_protection INTEGER NOT NULL DEFAULT 0,
    login_alerts_inapp INTEGER NOT NULL DEFAULT 1,
    login_alerts_email INTEGER NOT NULL DEFAULT 1,
    e2ee_key_alerts INTEGER NOT NULL DEFAULT 1,
    e2ee_fingerprint TEXT NOT NULL DEFAULT '',
    account_status TEXT NOT NULL DEFAULT 'active',
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS user_passkeys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    label TEXT NOT NULL,
    credential_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS linked_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    handle TEXT NOT NULL,
    platform TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Active',
    avatar_url TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS security_emails (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    category TEXT NOT NULL DEFAULT 'security',
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    recipient TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS otp_challenges (
    id TEXT PRIMARY KEY,
    channel TEXT NOT NULL,
    destination TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    verified INTEGER NOT NULL DEFAULT 0,
    verification_token TEXT,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Safe idempotent column migrations for existing databases
function ensureColumn(table: string, column: string, definition: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{name: string}>;
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
ensureColumn('users', 'date_of_birth', "TEXT NOT NULL DEFAULT ''");
ensureColumn('users', 'firebase_uid', 'TEXT');
ensureColumn('users', 'contact_verified', 'INTEGER NOT NULL DEFAULT 1');
ensureColumn('sessions', 'device_name', "TEXT NOT NULL DEFAULT 'Web Browser'");
ensureColumn('sessions', 'ip_address', "TEXT NOT NULL DEFAULT 'Local session'");
ensureColumn('posts', 'video_url', 'TEXT');
ensureColumn('post_likes', 'reaction', "TEXT NOT NULL DEFAULT 'like'");

// Security helpers
function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  const derived = crypto.scryptSync(password, salt, 64);
  const keyBuf = Buffer.from(keyHex, 'hex');
  if (derived.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derived, keyBuf);
}

const BLOCKED_EMAIL_DOMAINS = new Set([
  'example.com',
  'example.org',
  'example.net',
  'test.com',
  'fake.com',
  'invalid.com',
  'localhost',
  'asdf.com',
  'abc.com',
  'xyz.com',
  'mailinator.com',
  'tempmail.com',
  'temp-mail.org',
  '10minutemail.com',
  'guerrillamail.com',
  'guerrillamail.net',
  'yopmail.com',
  'yopmail.fr',
  'sharklasers.com',
  'trashmail.com',
  'maildrop.cc',
  'dispostable.com',
  'getnada.com',
  'mohmal.com',
  'throwawaymail.com',
  'fakeinbox.com',
  'mintemail.com',
  'mytemp.email',
  'burnermail.io',
]);

function normalizeEmail(input: string): string | null {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed || trimmed.length > 120) return null;
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(trimmed)) return null;
  const [local] = trimmed.split('@');
  if (!local || local.length < 2 || local.startsWith('.') || local.endsWith('.') || local.includes('..')) {
    return null;
  }
  return trimmed;
}

async function validateRealEmailServer(
  input: string,
): Promise<{valid: true; email: string} | {valid: false; error: string}> {
  const email = normalizeEmail(input);
  if (!email) {
    return {valid: false, error: 'Please enter a valid Gmail or email address.'};
  }
  const domain = email.split('@')[1];
  if (BLOCKED_EMAIL_DOMAINS.has(domain)) {
    return {
      valid: false,
      error: 'Temporary or fake email domains are not allowed. Use a real Gmail or email address.',
    };
  }
  try {
    const mx = await dns.resolveMx(domain);
    if (!mx || mx.length === 0) {
      return {
        valid: false,
        error: 'This email domain cannot receive mail. Please enter a real Gmail or email address.',
      };
    }
  } catch {
    return {
      valid: false,
      error: 'This email domain does not exist or cannot receive mail. Please enter a real Gmail or email address.',
    };
  }
  return {valid: true, email};
}

function normalizePhone(input: string): string | null {
  const trimmed = input.trim();
  const digits = trimmed.replace(/[^\d]/g, '');
  if (!digits) return null;

  let fullDigits = digits;
  if (trimmed.startsWith('+')) {
    if (fullDigits.startsWith('88001') && fullDigits.length === 14) {
      fullDigits = '880' + fullDigits.slice(4);
    }
  } else if (fullDigits.startsWith('00')) {
    fullDigits = fullDigits.slice(2);
  } else if (/^01[3-9]\d{8}$/.test(fullDigits)) {
    fullDigits = '880' + fullDigits.slice(1);
  }

  if (fullDigits.length < 8 || fullDigits.length > 15) return null;
  return `+${fullDigits}`;
}

function validateRealPhoneServer(
  input: string,
): {valid: true; phone: string} | {valid: false; error: string} {
  const phone = normalizePhone(input);
  if (!phone) {
    return {
      valid: false,
      error: 'Please enter a valid real phone number with country code (e.g., +8801618859938).',
    };
  }
  const digits = phone.slice(1);
  if (/^(\d)\1+$/.test(digits)) {
    return {valid: false, error: 'Fake or repeated phone numbers are not allowed.'};
  }
  const seq = '01234567890123456789';
  const rev = '98765432109876543210';
  const tail = digits.slice(-8);
  if (tail.length >= 8 && (seq.includes(tail) || rev.includes(tail))) {
    return {valid: false, error: 'Fake sequential phone numbers are not allowed.'};
  }
  if (digits.startsWith('880') && !/^8801[3-9]\d{8}$/.test(digits)) {
    return {
      valid: false,
      error: 'Enter a valid 11-digit Bangladesh mobile number (e.g., 01618859938 or +8801618859938).',
    };
  }
  return {valid: true, phone};
}

function buildPhoneCandidates(input: string): string[] {
  const digits = input.trim().replace(/[^\d]/g, '');
  if (digits.length < 6 || digits.length > 16) return [];
  const set = new Set<string>();
  const canonical = normalizePhone(input);
  if (canonical) set.add(canonical);
  set.add(`+${digits}`);
  if (/^01[3-9]\d{8}$/.test(digits)) {
    set.add(`+880${digits.slice(1)}`);
  }
  if (/^8801[3-9]\d{8}$/.test(digits)) {
    set.add(`+0${digits.slice(3)}`);
    set.add(`+${digits.slice(3)}`);
  }
  if (/^1[3-9]\d{8}$/.test(digits)) {
    set.add(`+880${digits}`);
    set.add(`+0${digits}`);
  }
  return Array.from(set);
}

function findUserByPhone(rawPhone: string): UserRow | undefined {
  const candidates = buildPhoneCandidates(rawPhone);
  if (candidates.length === 0) return undefined;
  const placeholders = candidates.map(() => '?').join(',');
  return db
    .prepare(`SELECT * FROM users WHERE phone IN (${placeholders}) LIMIT 1`)
    .get(...candidates) as UserRow | undefined;
}

function findUserByIdentifier(raw: string): UserRow | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (trimmed.includes('@')) {
    const email = normalizeEmail(trimmed);
    if (!email) return undefined;
    return db
      .prepare('SELECT * FROM users WHERE lower(email) = ? LIMIT 1')
      .get(email) as UserRow | undefined;
  }
  return findUserByPhone(trimmed);
}

interface VerifiedFirebaseIdentity {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  phoneNumber: string | null;
  displayName: string;
  photoUrl: string;
}

async function verifyFirebaseIdToken(idToken: string): Promise<VerifiedFirebaseIdentity | null> {
  if (!idToken || !FIREBASE_WEB_API_KEY) return null;
  try {
    const resp = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(FIREBASE_WEB_API_KEY)}`,
      {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({idToken}),
      },
    );
    if (!resp.ok) return null;
    const data = (await resp.json()) as {
      users?: Array<{
        localId?: string;
        email?: string;
        emailVerified?: boolean;
        phoneNumber?: string;
        displayName?: string;
        photoUrl?: string;
      }>;
    };
    const u = data.users?.[0];
    if (!u || !u.localId) return null;
    return {
      uid: u.localId,
      email: u.email ? u.email.trim().toLowerCase() : null,
      emailVerified: Boolean(u.emailVerified),
      phoneNumber: u.phoneNumber ? normalizePhone(u.phoneNumber) : null,
      displayName: String(u.displayName || '').trim(),
      photoUrl: String(u.photoUrl || '').trim(),
    };
  } catch {
    return null;
  }
}

async function deliverEmailOtp(toEmail: string, code: string): Promise<boolean> {
  const smtpUser = (process.env.SMTP_USER || '').trim();
  const smtpPass = (process.env.SMTP_PASS || '').trim();
  if (!smtpUser || !smtpPass) return false;

  const smtpHost = (process.env.SMTP_HOST || 'smtp.gmail.com').trim();
  const smtpPort = Number(process.env.SMTP_PORT) || 465;
  const smtpFrom = (process.env.SMTP_FROM || `Verve Verification <${smtpUser}>`).trim();

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,
    auth: {
      user: smtpUser,
      pass: smtpPass,
    },
  });

  await transporter.sendMail({
    from: smtpFrom,
    to: toEmail,
    subject: `${code} is your Verve verification code`,
    text: `Your Verve signup verification code is: ${code}\n\nThis code expires in 10 minutes. If you did not request this code, you can safely ignore this email.`,
    html: `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:460px;margin:0 auto;padding:24px;border:1px solid #e5e8ee;border-radius:16px">
      <h2 style="margin:0 0 8px;color:#1877F2;font-size:22px">Verve</h2>
      <p style="margin:0 0 16px;color:#334155;font-size:14px">Enter this 6-digit code to verify your email address and finish creating your account:</p>
      <div style="font-size:32px;font-weight:700;letter-spacing:8px;color:#0f172a;background:#f4f6f9;padding:16px;text-align:center;border-radius:12px">${code}</div>
      <p style="margin:16px 0 0;color:#64748b;font-size:12px">This code expires in 10 minutes. Do not share it with anyone.</p>
    </div>`,
  });
  return true;
}

async function deliverTwilioSmsOtp(toPhone: string, code: string): Promise<boolean> {
  const sid = (process.env.TWILIO_ACCOUNT_SID || '').trim();
  const authToken = (process.env.TWILIO_AUTH_TOKEN || '').trim();
  const from = (process.env.TWILIO_FROM_NUMBER || '').trim();
  if (!sid || !authToken || !from) return false;

  const body = new URLSearchParams({
    To: toPhone,
    From: from,
    Body: `Your Verve verification code is ${code}. It expires in 10 minutes.`,
  });
  const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${authToken}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(errText || 'Twilio SMS delivery failed.');
  }
  return true;
}

const VALID_REACTIONS = new Set(['like', 'love', 'care', 'haha', 'wow', 'sad', 'angry']);
type ReactionKind = 'like' | 'love' | 'care' | 'haha' | 'wow' | 'sad' | 'angry';

function parseReaction(raw: unknown): ReactionKind | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.trim().toLowerCase();
  return VALID_REACTIONS.has(cleaned) ? (cleaned as ReactionKind) : null;
}

function reactionVerb(reaction: ReactionKind): string {
  switch (reaction) {
    case 'love':
      return 'loved';
    case 'care':
      return 'sent Care to';
    case 'haha':
      return 'laughed at';
    case 'wow':
      return 'was amazed by';
    case 'sad':
      return 'reacted Sad to';
    case 'angry':
      return 'reacted Angry to';
    default:
      return 'liked';
  }
}

function maskDestination(email: string | null, phone: string | null): string {
  if (email) {
    const [local, domain] = email.split('@');
    const prefix = local.slice(0, Math.min(2, local.length));
    return `${prefix}***@${domain}`;
  }
  if (phone) {
    return `${phone.slice(0, 3)}••••${phone.slice(-3)}`;
  }
  return 'your account';
}

interface UserRow {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  password_hash: string;
  bio: string;
  location: string;
  work: string;
  avatar_url: string;
  cover_url: string;
  date_of_birth?: string;
  created_at: string;
}

function sanitizeUser(row: UserRow) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    bio: row.bio,
    location: row.location,
    work: row.work,
    avatar_url: row.avatar_url,
    cover_url: row.cover_url,
    date_of_birth: row.date_of_birth || '',
    created_at: row.created_at,
  };
}

function parseDeviceName(req?: Request): string {
  const ua = String(req?.headers['user-agent'] || '');
  if (!ua) return 'Web Browser';
  let os = 'Desktop';
  if (/Android/i.test(ua)) os = 'Android';
  else if (/iPhone|iPad/i.test(ua)) os = 'iOS';
  else if (/Mac OS X/i.test(ua)) os = 'macOS';
  else if (/Windows/i.test(ua)) os = 'Windows';
  else if (/Linux/i.test(ua)) os = 'Linux';

  let browser = 'Browser';
  if (/Edg\//i.test(ua)) browser = 'Edge';
  else if (/Chrome\//i.test(ua)) browser = 'Chrome';
  else if (/Firefox\//i.test(ua)) browser = 'Firefox';
  else if (/Safari\//i.test(ua)) browser = 'Safari';

  return `${browser} on ${os}`;
}

function logSecurityEmail(
  userId: number,
  subject: string,
  body: string,
  category: 'security' | 'other' = 'security',
) {
  const user = db.prepare('SELECT email, phone FROM users WHERE id = ?').get(userId) as
    | {email: string | null; phone: string | null}
    | undefined;
  const recipient = user?.email || user?.phone || 'Account holder';
  db.prepare(
    'INSERT INTO security_emails (user_id, category, subject, body, recipient) VALUES (?, ?, ?, ?, ?)',
  ).run(userId, category, subject, body, recipient);
}

function createSession(userId: number, req?: Request): string {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const deviceName = parseDeviceName(req);
  const ip =
    String(req?.headers['x-forwarded-for'] || req?.socket?.remoteAddress || 'Active session')
      .split(',')[0]
      .trim() || 'Active session';
  db.prepare(
    'INSERT INTO sessions (token, user_id, expires_at, device_name, ip_address) VALUES (?, ?, ?, ?, ?)',
  ).run(token, userId, expiresAt, deviceName, ip);
  return token;
}

// Remove legacy pre-seeded demo accounts & auto-posts while preserving all real user accounts
function cleanupLegacySeededDemoData() {
  const demoEmails = [
    'maya@verve.social',
    'devon@verve.social',
    'priya@verve.social',
    'lucas@verve.social',
  ];
  const placeholders = demoEmails.map(() => '?').join(',');
  const demoUsers = db
    .prepare(`SELECT id FROM users WHERE email IN (${placeholders})`)
    .all(...demoEmails) as Array<{id: number}>;

  if (demoUsers.length > 0) {
    const ids = demoUsers.map((u) => u.id);
    const idPlaceholders = ids.map(() => '?').join(',');
    db.prepare(`DELETE FROM groups_table WHERE created_by IN (${idPlaceholders})`).run(...ids);
    db.prepare(`DELETE FROM events_table WHERE host_id IN (${idPlaceholders})`).run(...ids);
    db.prepare(`DELETE FROM pages_table WHERE created_by IN (${idPlaceholders})`).run(...ids);
    db.prepare(`DELETE FROM users WHERE id IN (${idPlaceholders})`).run(...ids);
  }
}

cleanupLegacySeededDemoData();

// Express setup
const app = express();
app.use(express.json({limit: '35mb'}));
app.use('/uploads', express.static(uploadsDir));

// WebSocket hub
const server = http.createServer(app);
const wss = new WebSocketServer({server, path: '/ws'});
const userSockets = new Map<number, Set<WebSocket>>();

function getOnlineUserIds(): number[] {
  return Array.from(userSockets.keys());
}

function sendToUser(userId: number, event: string, payload: unknown) {
  const sockets = userSockets.get(userId);
  if (!sockets) return;
  const serialized = JSON.stringify({event, payload});
  for (const ws of sockets) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(serialized);
    }
  }
}

function broadcastAll(event: string, payload: unknown) {
  const serialized = JSON.stringify({event, payload});
  for (const sockets of userSockets.values()) {
    for (const ws of sockets) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(serialized);
      }
    }
  }
}

function getUserByToken(token: string | null | undefined): UserRow | null {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.* FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > datetime('now')`,
    )
    .get(token) as UserRow | undefined;
  return row ?? null;
}

wss.on('connection', (ws, req) => {
  try {
    const url = new URL(req.url || '', `http://localhost:${PORT}`);
    const token = url.searchParams.get('token');
    const user = getUserByToken(token);
    if (!user) {
      ws.close(4001, 'Unauthorized');
      return;
    }

    if (!userSockets.has(user.id)) {
      userSockets.set(user.id, new Set());
    }
    userSockets.get(user.id)!.add(ws);

    broadcastAll('presence:update', {onlineUserIds: getOnlineUserIds()});

    ws.on('message', (raw) => {
      try {
        const parsed = JSON.parse(raw.toString()) as {event?: string; payload?: Record<string, unknown>};
        if (parsed.event === 'chat:typing' && parsed.payload) {
          const receiverId = Number(parsed.payload.receiverId);
          const isTyping = Boolean(parsed.payload.isTyping);
          if (receiverId > 0) {
            sendToUser(receiverId, 'chat:typing', {senderId: user.id, isTyping});
          }
        }
      } catch {
        // Ignore malformed client frames
      }
    });

    ws.on('close', () => {
      const set = userSockets.get(user.id);
      if (set) {
        set.delete(ws);
        if (set.size === 0) {
          userSockets.delete(user.id);
        }
      }
      broadcastAll('presence:update', {onlineUserIds: getOnlineUserIds()});
    });
  } catch {
    ws.close();
  }
});

// Auth middleware
interface AuthedRequest extends Request {
  user?: UserRow;
  token?: string;
}

function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const user = getUserByToken(token);
  if (!user) {
    res.status(401).json({error: 'Authentication required. Please sign in.'});
    return;
  }
  req.user = user;
  req.token = token;
  next();
}

function createNotification(
  userId: number,
  actorId: number | null,
  type: string,
  entityId: number | null,
  message: string,
) {
  const result = db
    .prepare(
      'INSERT INTO notifications (user_id, actor_id, type, entity_id, message) VALUES (?, ?, ?, ?, ?)',
    )
    .run(userId, actorId, type, entityId, message);
  const notifId = Number(result.lastInsertRowid);
  const fullNotif = db
    .prepare(
      `SELECT n.*, u.name as actor_name, u.avatar_url as actor_avatar
       FROM notifications n
       LEFT JOIN users u ON u.id = n.actor_id
       WHERE n.id = ?`,
    )
    .get(notifId) as Record<string, unknown>;
  const formatted = {
    ...fullNotif,
    read: Boolean(fullNotif.read),
  };
  sendToUser(userId, 'notification:new', formatted);
  return formatted;
}

function hydratePosts(postRows: Array<Record<string, unknown>>, viewerId: number) {
  if (postRows.length === 0) return [];
  const postIds = postRows.map((p) => Number(p.id));
  const placeholders = postIds.map(() => '?').join(',');

  const commentsRows = db
    .prepare(
      `SELECT c.*, u.name as author_name, u.avatar_url as author_avatar
       FROM comments c
       JOIN users u ON u.id = c.user_id
       WHERE c.post_id IN (${placeholders})
       ORDER BY c.created_at ASC`,
    )
    .all(...postIds) as Array<Record<string, unknown>>;

  const commentsByPost = new Map<number, Array<Record<string, unknown>>>();
  for (const c of commentsRows) {
    const pid = Number(c.post_id);
    if (!commentsByPost.has(pid)) commentsByPost.set(pid, []);
    commentsByPost.get(pid)!.push(c);
  }

  const likesRows = db
    .prepare(
      `SELECT post_id, user_id, COALESCE(reaction, 'like') as reaction
       FROM post_likes
       WHERE post_id IN (${placeholders})`,
    )
    .all(...postIds) as Array<{post_id: number; user_id: number; reaction: string}>;

  const likesMap = new Map<
    number,
    {
      count: number;
      likedByMe: boolean;
      myReaction: ReactionKind | null;
      reactionCounts: Partial<Record<ReactionKind, number>>;
    }
  >();
  for (const row of likesRows) {
    const rType: ReactionKind = parseReaction(row.reaction) || 'like';
    let entry = likesMap.get(row.post_id);
    if (!entry) {
      entry = {count: 0, likedByMe: false, myReaction: null, reactionCounts: {}};
      likesMap.set(row.post_id, entry);
    }
    entry.count += 1;
    entry.reactionCounts[rType] = (entry.reactionCounts[rType] || 0) + 1;
    if (row.user_id === viewerId) {
      entry.likedByMe = true;
      entry.myReaction = rType;
    }
  }

  const savedRows = db
    .prepare(
      `SELECT post_id FROM saved_posts WHERE user_id = ? AND post_id IN (${placeholders})`,
    )
    .all(viewerId, ...postIds) as Array<{post_id: number}>;
  const savedSet = new Set(savedRows.map((r) => r.post_id));

  return postRows.map((p) => {
    const pid = Number(p.id);
    const comments = commentsByPost.get(pid) || [];
    const likeInfo = likesMap.get(pid) || {
      count: 0,
      likedByMe: false,
      myReaction: null,
      reactionCounts: {},
    };
    return {
      id: pid,
      user_id: Number(p.user_id),
      content: String(p.content || ''),
      image_url: p.image_url ? String(p.image_url) : null,
      video_url: p.video_url ? String(p.video_url) : null,
      created_at: String(p.created_at),
      author_name: String(p.author_name),
      author_avatar: String(p.author_avatar || ''),
      author_work: String(p.author_work || ''),
      likes_count: likeInfo.count,
      liked_by_me: likeInfo.likedByMe,
      my_reaction: likeInfo.myReaction,
      reaction_counts: likeInfo.reactionCounts,
      saved_by_me: savedSet.has(pid),
      comments_count: comments.length,
      comments,
    };
  });
}

function getProfileSummary(targetUser: UserRow, viewerId: number) {
  const friendsCount = (
    db
      .prepare(
        `SELECT COUNT(*) as count FROM friendships
         WHERE status = 'accepted' AND (requester_id = ? OR addressee_id = ?)`,
      )
      .get(targetUser.id, targetUser.id) as {count: number}
  ).count;

  const followersCount = (
    db
      .prepare('SELECT COUNT(*) as count FROM follows WHERE following_id = ?')
      .get(targetUser.id) as {count: number}
  ).count;

  const followingCount = (
    db
      .prepare('SELECT COUNT(*) as count FROM follows WHERE follower_id = ?')
      .get(targetUser.id) as {count: number}
  ).count;

  const postsCount = (
    db
      .prepare('SELECT COUNT(*) as count FROM posts WHERE user_id = ?')
      .get(targetUser.id) as {count: number}
  ).count;

  let friendshipStatus: 'none' | 'friends' | 'outgoing_pending' | 'incoming_pending' = 'none';
  if (targetUser.id !== viewerId) {
    const rel = db
      .prepare(
        `SELECT * FROM friendships
         WHERE (requester_id = ? AND addressee_id = ?)
            OR (requester_id = ? AND addressee_id = ?)`,
      )
      .get(viewerId, targetUser.id, targetUser.id, viewerId) as
      | {requester_id: number; addressee_id: number; status: string}
      | undefined;

    if (rel) {
      if (rel.status === 'accepted') {
        friendshipStatus = 'friends';
      } else if (rel.requester_id === viewerId) {
        friendshipStatus = 'outgoing_pending';
      } else {
        friendshipStatus = 'incoming_pending';
      }
    }
  }

  const isFollowing = Boolean(
    db
      .prepare('SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?')
      .get(viewerId, targetUser.id),
  );

  return {
    ...sanitizeUser(targetUser),
    friends_count: friendsCount,
    followers_count: followersCount,
    following_count: followingCount,
    posts_count: postsCount,
    friendship_status: friendshipStatus,
    is_following: isFollowing,
  };
}

// =======================
// AUTH & REAL VERIFICATION ROUTES
// =======================

app.get('/api/auth/capabilities', (_req: Request, res: Response) => {
  const emailOtpReady = Boolean((process.env.SMTP_USER || '').trim() && (process.env.SMTP_PASS || '').trim());
  const smsTwilioReady = Boolean(
    (process.env.TWILIO_ACCOUNT_SID || '').trim() &&
      (process.env.TWILIO_AUTH_TOKEN || '').trim() &&
      (process.env.TWILIO_FROM_NUMBER || '').trim(),
  );
  res.json({
    emailOtpReady,
    smsTwilioReady,
    googleReady: Boolean(FIREBASE_WEB_API_KEY),
  });
});

app.post('/api/auth/check-contact', async (req: Request, res: Response) => {
  const {channel, contact} = req.body as {channel?: 'email' | 'phone'; contact?: string};
  if (channel === 'email') {
    const check = await validateRealEmailServer(contact || '');
    if (!check.valid) {
      res.status(400).json({error: check.error});
      return;
    }
    const existing = db
      .prepare('SELECT id FROM users WHERE lower(email) = ?')
      .get(check.email);
    if (existing) {
      res.status(409).json({error: 'An account with this email already exists. Please sign in.'});
      return;
    }
    res.json({valid: true, normalized: check.email});
    return;
  }

  const phoneCheck = validateRealPhoneServer(contact || '');
  if (!phoneCheck.valid) {
    res.status(400).json({error: phoneCheck.error});
    return;
  }
  const existingPhone = findUserByPhone(phoneCheck.phone);
  if (existingPhone) {
    res.status(409).json({error: 'An account with this phone number already exists. Please sign in.'});
    return;
  }
  res.json({valid: true, normalized: phoneCheck.phone});
});

app.post('/api/auth/otp/send', async (req: Request, res: Response) => {
  const {channel, contact} = req.body as {channel?: 'email' | 'phone'; contact?: string};
  if (channel !== 'email' && channel !== 'phone') {
    res.status(400).json({error: 'Choose email or phone verification.'});
    return;
  }

  let destination = '';
  if (channel === 'email') {
    const check = await validateRealEmailServer(contact || '');
    if (!check.valid) {
      res.status(400).json({error: check.error});
      return;
    }
    const existing = db.prepare('SELECT id FROM users WHERE lower(email) = ?').get(check.email);
    if (existing) {
      res.status(409).json({error: 'An account with this email already exists. Please sign in.'});
      return;
    }
    destination = check.email;
  } else {
    const check = validateRealPhoneServer(contact || '');
    if (!check.valid) {
      res.status(400).json({error: check.error});
      return;
    }
    const existing = findUserByPhone(check.phone);
    if (existing) {
      res.status(409).json({error: 'An account with this phone number already exists. Please sign in.'});
      return;
    }
    destination = check.phone;
  }

  // Cooldown: 25 seconds per destination
  const recent = db
    .prepare(
      `SELECT created_at FROM otp_challenges
       WHERE destination = ? AND datetime(created_at, '+25 seconds') > datetime('now')
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(destination) as {created_at: string} | undefined;
  if (recent) {
    res.status(429).json({error: 'Please wait a few seconds before requesting another code.'});
    return;
  }

  const code = String(crypto.randomInt(100000, 1000000));
  const challengeId = crypto.randomBytes(16).toString('hex');
  const codeHash = hashPassword(code);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  db.prepare(
    `INSERT INTO otp_challenges (id, channel, destination, code_hash, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(challengeId, channel, destination, codeHash, expiresAt);

  try {
    if (channel === 'email') {
      const delivered = await deliverEmailOtp(destination, code);
      if (!delivered) {
        db.prepare('DELETE FROM otp_challenges WHERE id = ?').run(challengeId);
        res.status(503).json({
          code: 'SMTP_NOT_CONFIGURED',
          error:
            'Real email OTP delivery needs SMTP_USER and SMTP_PASS (Gmail App Password) configured in Secrets. Or click "Verify Real Gmail with Google" below to verify instantly.',
        });
        return;
      }
      res.json({
        sent: true,
        challengeId,
        channel: 'email',
        destination,
        maskedDestination: maskDestination(destination, null),
        expiresInSeconds: 600,
        message: `A 6-digit verification code was sent to ${maskDestination(destination, null)}.`,
      });
      return;
    }

    const smsSent = await deliverTwilioSmsOtp(destination, code);
    if (!smsSent) {
      db.prepare('DELETE FROM otp_challenges WHERE id = ?').run(challengeId);
      res.status(503).json({
        code: 'SMS_NOT_CONFIGURED',
        error:
          'Real SMS OTP requires enabling Phone Sign-In in Firebase Console or configuring Twilio Secrets.',
      });
      return;
    }

    res.json({
      sent: true,
      challengeId,
      channel: 'phone',
      destination,
      maskedDestination: maskDestination(null, destination),
      expiresInSeconds: 600,
      message: `A 6-digit SMS verification code was sent to ${maskDestination(null, destination)}.`,
    });
  } catch (err) {
    db.prepare('DELETE FROM otp_challenges WHERE id = ?').run(challengeId);
    console.error('OTP delivery failed:', err);
    res.status(502).json({
      error:
        channel === 'email'
          ? 'Could not send email verification code. Check your SMTP credentials or use Google verification.'
          : 'Could not send SMS verification code. Check your phone number and SMS provider settings.',
    });
  }
});

app.post('/api/auth/otp/verify', (req: Request, res: Response) => {
  const {challengeId, code} = req.body as {challengeId?: string; code?: string};
  const cleanCode = String(code || '').replace(/\s+/g, '');
  if (!challengeId || !/^\d{6}$/.test(cleanCode)) {
    res.status(400).json({error: 'Enter the 6-digit verification code.'});
    return;
  }

  const challenge = db
    .prepare('SELECT * FROM otp_challenges WHERE id = ?')
    .get(challengeId) as
    | {
        id: string;
        channel: string;
        destination: string;
        code_hash: string;
        attempts: number;
        verified: number;
        verification_token: string | null;
        expires_at: string;
      }
    | undefined;

  if (!challenge) {
    res.status(400).json({error: 'Verification session not found. Please tap Send Code again.'});
    return;
  }

  if (new Date(challenge.expires_at).getTime() < Date.now()) {
    res.status(400).json({error: 'Verification code has expired. Please request a new code.'});
    return;
  }

  if (challenge.attempts >= 5) {
    res.status(429).json({error: 'Too many wrong attempts. Please tap Send Code to get a new code.'});
    return;
  }

  if (!verifyPassword(cleanCode, challenge.code_hash)) {
    db.prepare('UPDATE otp_challenges SET attempts = attempts + 1 WHERE id = ?').run(challenge.id);
    const left = Math.max(0, 4 - challenge.attempts);
    res.status(400).json({
      error:
        left > 0
          ? `Incorrect verification code. ${left} ${left === 1 ? 'attempt' : 'attempts'} remaining.`
          : 'Too many incorrect attempts. Please request a new code.',
    });
    return;
  }

  const verificationToken = crypto.randomBytes(24).toString('hex');
  const tokenExpiry = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  db.prepare(
    'UPDATE otp_challenges SET verified = 1, verification_token = ?, expires_at = ? WHERE id = ?',
  ).run(verificationToken, tokenExpiry, challenge.id);

  res.json({
    verified: true,
    verificationToken,
    destination: challenge.destination,
    channel: challenge.channel,
  });
});

app.post('/api/auth/register', async (req: Request, res: Response) => {
  const {
    name,
    identifier,
    email: rawEmail,
    phone: rawPhone,
    password,
    verificationToken,
    firebaseIdToken,
  } = req.body as {
    name?: string;
    identifier?: string;
    email?: string;
    phone?: string;
    password?: string;
    verificationToken?: string;
    firebaseIdToken?: string;
  };

  const trimmedName = (name || '').trim();
  if (trimmedName.length < 2 || trimmedName.length > 60) {
    res.status(400).json({error: 'Please enter your full name (2–60 characters).'});
    return;
  }

  if (!password || password.length < 6) {
    res.status(400).json({error: 'Password must be at least 6 characters long.'});
    return;
  }

  let email: string | null = null;
  let phone: string | null = null;
  let firebaseUid: string | null = null;
  let avatarUrl = ASSETS.avatarMaya;

  if (rawEmail && rawEmail.trim()) {
    const check = await validateRealEmailServer(rawEmail);
    if (!check.valid) {
      res.status(400).json({error: check.error});
      return;
    }
    email = check.email;
  }

  if (rawPhone && rawPhone.trim()) {
    const check = validateRealPhoneServer(rawPhone);
    if (!check.valid) {
      res.status(400).json({error: check.error});
      return;
    }
    phone = check.phone;
  }

  if (!email && !phone && identifier && identifier.trim()) {
    const idVal = identifier.trim();
    if (idVal.includes('@')) {
      const check = await validateRealEmailServer(idVal);
      if (!check.valid) {
        res.status(400).json({error: check.error});
        return;
      }
      email = check.email;
    } else {
      const check = validateRealPhoneServer(idVal);
      if (!check.valid) {
        res.status(400).json({error: check.error});
        return;
      }
      phone = check.phone;
    }
  }

  if (!email && !phone) {
    res.status(400).json({error: 'Provide a real Gmail/email address or a real phone number.'});
    return;
  }

  // MANDATORY REAL VERIFICATION GATE: require either verified OTP token OR verified Firebase ID token
  let verifiedOk = false;
  let consumedChallengeId: string | null = null;

  if (firebaseIdToken && firebaseIdToken.trim()) {
    const fb = await verifyFirebaseIdToken(firebaseIdToken.trim());
    if (!fb) {
      res.status(401).json({error: 'Firebase verification expired or invalid. Please verify again.'});
      return;
    }
    if (email && fb.email && fb.email === email && fb.emailVerified) {
      verifiedOk = true;
      firebaseUid = fb.uid;
      if (fb.photoUrl) avatarUrl = fb.photoUrl;
    } else if (phone && fb.phoneNumber) {
      const targetSet = new Set(buildPhoneCandidates(phone));
      const fbCandidates = buildPhoneCandidates(fb.phoneNumber);
      if (fbCandidates.some((c) => targetSet.has(c))) {
        verifiedOk = true;
        firebaseUid = fb.uid;
        phone = fb.phoneNumber;
      }
    }
  }

  if (!verifiedOk && verificationToken && verificationToken.trim()) {
    const challenge = db
      .prepare('SELECT * FROM otp_challenges WHERE verification_token = ? AND verified = 1')
      .get(verificationToken.trim()) as
      | {id: string; channel: string; destination: string; expires_at: string}
      | undefined;

    if (challenge && new Date(challenge.expires_at).getTime() >= Date.now()) {
      if (challenge.channel === 'email' && email && challenge.destination === email) {
        verifiedOk = true;
        consumedChallengeId = challenge.id;
      } else if (challenge.channel === 'phone' && phone) {
        const targetSet = new Set(buildPhoneCandidates(phone));
        if (buildPhoneCandidates(challenge.destination).some((c) => targetSet.has(c))) {
          verifiedOk = true;
          consumedChallengeId = challenge.id;
          phone = challenge.destination;
        }
      }
    }
  }

  if (!verifiedOk) {
    res.status(403).json({
      error:
        'Verification required. Please click "Send Code" and enter the real verification code sent to your Gmail or phone number before creating an account.',
    });
    return;
  }

  if (email) {
    const existing = db.prepare('SELECT id FROM users WHERE lower(email) = ?').get(email);
    if (existing) {
      res.status(409).json({error: 'An account with this email already exists. Try signing in.'});
      return;
    }
  }

  if (phone) {
    const existing = findUserByPhone(phone);
    if (existing) {
      res.status(409).json({error: 'An account with this phone number already exists. Try signing in.'});
      return;
    }
  }

  const passwordHash = hashPassword(password);
  const result = db
    .prepare(
      `INSERT INTO users (name, email, phone, password_hash, bio, location, work, avatar_url, cover_url, firebase_uid, contact_verified)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    )
    .run(
      trimmedName,
      email,
      phone,
      passwordHash,
      'New on Verve — sharing ideas, moments, and updates.',
      '',
      '',
      avatarUrl,
      ASSETS.coverCoast,
      firebaseUid,
    );

  if (consumedChallengeId) {
    db.prepare('DELETE FROM otp_challenges WHERE id = ?').run(consumedChallengeId);
  }

  const newUserId = Number(result.lastInsertRowid);
  const newUser = db.prepare('SELECT * FROM users WHERE id = ?').get(newUserId) as UserRow;

  createNotification(
    newUserId,
    null,
    'welcome',
    null,
    'Welcome to Verve! Your account is verified and saved permanently.',
  );

  const token = createSession(newUserId, req);
  res.status(201).json({
    token,
    user: getProfileSummary(newUser, newUserId),
  });
});

// Firebase Auth sign-in / sync (Google verified Gmail or Firebase Phone Auth)
app.post('/api/auth/firebase-auth', async (req: Request, res: Response) => {
  const {
    firebaseIdToken,
    name,
    password,
    bio,
    location,
    work,
    avatar_url,
    cover_url,
    date_of_birth,
  } = req.body as {
    firebaseIdToken?: string;
    name?: string;
    password?: string;
    bio?: string;
    location?: string;
    work?: string;
    avatar_url?: string;
    cover_url?: string;
    date_of_birth?: string;
  };

  if (!firebaseIdToken) {
    res.status(400).json({error: 'Firebase authentication token is required.'});
    return;
  }

  const fb = await verifyFirebaseIdToken(firebaseIdToken);
  if (!fb) {
    res.status(401).json({error: 'Invalid or expired Firebase authentication. Please try again.'});
    return;
  }

  const isVerified = (fb.email && fb.emailVerified) || Boolean(fb.phoneNumber);
  if (!isVerified) {
    res.status(403).json({error: 'Your Google/Firebase email or phone number must be verified first.'});
    return;
  }

  let user: UserRow | undefined = db
    .prepare('SELECT * FROM users WHERE firebase_uid = ? LIMIT 1')
    .get(fb.uid) as UserRow | undefined;

  if (!user && fb.email) {
    user = db
      .prepare('SELECT * FROM users WHERE lower(email) = ? LIMIT 1')
      .get(fb.email) as UserRow | undefined;
  }
  if (!user && fb.phoneNumber) {
    user = findUserByPhone(fb.phoneNumber);
  }

  if (user) {
    // Link firebase_uid & optional password update if newly provided during verified registration
    if (password && password.length >= 6) {
      db.prepare('UPDATE users SET firebase_uid = ?, password_hash = ?, contact_verified = 1 WHERE id = ?').run(
        fb.uid,
        hashPassword(password),
        user.id,
      );
    } else {
      db.prepare('UPDATE users SET firebase_uid = ?, contact_verified = 1 WHERE id = ?').run(
        fb.uid,
        user.id,
      );
    }
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) as UserRow;
  } else {
    const finalName = (name || fb.displayName || 'Verve Member').trim().slice(0, 60);
    const pwHash = hashPassword(
      password && password.length >= 6 ? password : crypto.randomBytes(24).toString('hex'),
    );
    const result = db
      .prepare(
        `INSERT INTO users (name, email, phone, password_hash, bio, location, work, avatar_url, cover_url, date_of_birth, firebase_uid, contact_verified)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      )
      .run(
        finalName.length >= 2 ? finalName : 'Verve Member',
        fb.email,
        fb.phoneNumber,
        pwHash,
        (bio || 'New on Verve — sharing ideas, moments, and updates.').slice(0, 320),
        (location || '').slice(0, 80),
        (work || '').slice(0, 100),
        (avatar_url || fb.photoUrl || ASSETS.avatarMaya).slice(0, 2048),
        (cover_url || ASSETS.coverCoast).slice(0, 2048),
        (date_of_birth || '').slice(0, 20),
        fb.uid,
      );
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(result.lastInsertRowid)) as UserRow;
  }

  const token = createSession(user.id, req);
  res.json({
    token,
    user: getProfileSummary(user, user.id),
  });
});

// Seamless re-hydration if a server container restarted/redeployed and wiped SQLite,
// while the user already has a PBKDF2-verified account saved in their permanent browser vault.
app.post('/api/auth/restore', async (req: Request, res: Response) => {
  const {
    name,
    email: rawEmail,
    phone: rawPhone,
    password,
    bio,
    location,
    work,
    avatar_url,
    cover_url,
    date_of_birth,
    firebaseUid,
  } = req.body as {
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
    firebaseUid?: string | null;
  };

  if (!password || password.length < 6) {
    res.status(400).json({error: 'Invalid email/phone or password. Please try again.'});
    return;
  }

  const email = rawEmail ? normalizeEmail(rawEmail) : null;
  const phone = rawPhone ? normalizePhone(rawPhone) : null;
  if (!email && !phone) {
    res.status(400).json({error: 'Invalid account credentials.'});
    return;
  }

  // SECURITY: If the account ALREADY exists in SQLite, NEVER overwrite it — strictly verify password!
  const existing = email
    ? (db.prepare('SELECT * FROM users WHERE lower(email) = ? LIMIT 1').get(email) as UserRow | undefined)
    : phone
      ? findUserByPhone(phone)
      : undefined;

  if (existing) {
    if (!verifyPassword(password, existing.password_hash)) {
      res.status(401).json({error: 'Invalid email/phone or password. Please try again.'});
      return;
    }
    const token = createSession(existing.id, req);
    res.json({token, user: getProfileSummary(existing, existing.id)});
    return;
  }

  // Account was lost from ephemeral SQLite (e.g., container redeploy) — validate real contact before restoring
  if (email) {
    const check = await validateRealEmailServer(email);
    if (!check.valid) {
      res.status(400).json({error: check.error});
      return;
    }
  }
  if (phone) {
    const check = validateRealPhoneServer(phone);
    if (!check.valid) {
      res.status(400).json({error: check.error});
      return;
    }
  }

  const safeName = (name || 'Verve Member').trim().slice(0, 60);
  const result = db
    .prepare(
      `INSERT INTO users (name, email, phone, password_hash, bio, location, work, avatar_url, cover_url, date_of_birth, firebase_uid, contact_verified)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    )
    .run(
      safeName.length >= 2 ? safeName : 'Verve Member',
      email,
      phone,
      hashPassword(password),
      (bio || '').slice(0, 320),
      (location || '').slice(0, 80),
      (work || '').slice(0, 100),
      (avatar_url || ASSETS.avatarMaya).slice(0, 2048),
      (cover_url || ASSETS.coverCoast).slice(0, 2048),
      (date_of_birth || '').slice(0, 20),
      firebaseUid || null,
    );

  const restored = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(result.lastInsertRowid)) as UserRow;
  const token = createSession(restored.id, req);
  res.json({
    token,
    user: getProfileSummary(restored, restored.id),
  });
});

app.post('/api/auth/login', (req: Request, res: Response) => {
  const {identifier, password} = req.body as {identifier?: string; password?: string};
  if (!identifier || !identifier.trim() || !password) {
    res.status(400).json({error: 'Enter your email or phone number and password.'});
    return;
  }

  const user = findUserByIdentifier(identifier);
  if (!user || !verifyPassword(password, user.password_hash)) {
    res.status(401).json({error: 'Invalid email/phone or password. Please try again.'});
    return;
  }

  const token = createSession(user.id, req);
  logSecurityEmail(
    user.id,
    'New login to Verve',
    `New sign-in detected from ${parseDeviceName(req)}. If this was you, no further action is required.`,
    'security',
  );
  res.json({
    token,
    user: getProfileSummary(user, user.id),
  });
});

app.post('/api/auth/logout', requireAuth, (req: AuthedRequest, res: Response) => {
  // ONLY delete the active session token — NEVER delete the user account!
  if (req.token) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(req.token);
  }
  res.json({ok: true});
});

app.get('/api/auth/me', requireAuth, (req: AuthedRequest, res: Response) => {
  res.json({user: getProfileSummary(req.user!, req.user!.id)});
});

app.post('/api/auth/forgot-password', (req: Request, res: Response) => {
  const {identifier} = req.body as {identifier?: string};
  if (!identifier || !identifier.trim()) {
    res.status(400).json({error: 'Enter your registered Gmail/email address or phone number.'});
    return;
  }

  const user = findUserByIdentifier(identifier);
  if (!user) {
    res.status(404).json({error: 'No account found matching that email address or phone number.'});
    return;
  }

  // Invalidate previous unused tokens for this user
  db.prepare('UPDATE password_resets SET used = 1 WHERE user_id = ? AND used = 0').run(user.id);

  const resetToken = crypto.randomBytes(20).toString('hex');
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO password_resets (token, user_id, expires_at) VALUES (?, ?, ?)').run(
    resetToken,
    user.id,
    expiresAt,
  );

  res.json({
    message: `Password reset link generated for ${maskDestination(user.email, user.phone)}. It expires in 30 minutes.`,
    resetToken,
    resetPath: `/reset-password?token=${resetToken}`,
    maskedDestination: maskDestination(user.email, user.phone),
  });
});

app.post('/api/auth/reset-password', (req: Request, res: Response) => {
  const {token, newPassword} = req.body as {token?: string; newPassword?: string};
  if (!token || !token.trim()) {
    res.status(400).json({error: 'Reset token is required.'});
    return;
  }
  if (!newPassword || newPassword.length < 6) {
    res.status(400).json({error: 'New password must be at least 6 characters long.'});
    return;
  }

  const row = db
    .prepare(
      `SELECT * FROM password_resets
       WHERE token = ? AND used = 0 AND expires_at > datetime('now')`,
    )
    .get(token.trim()) as {token: string; user_id: number; expires_at: string; used: number} | undefined;

  if (!row) {
    res.status(400).json({error: 'This reset link or code is invalid or has expired. Request a new one.'});
    return;
  }

  const newHash = hashPassword(newPassword);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, row.user_id);
  db.prepare('UPDATE password_resets SET used = 1 WHERE token = ?').run(row.token);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.user_id);

  res.json({
    message: 'Your password has been reset successfully. You can now sign in with your new password.',
  });
});

// =======================
// UPLOAD ROUTES (IMAGES & VIDEOS)
// =======================

const MIME_EXT_MAP: Record<string, {ext: string; mediaType: 'image' | 'video'}> = {
  'image/png': {ext: 'png', mediaType: 'image'},
  'image/jpeg': {ext: 'jpg', mediaType: 'image'},
  'image/jpg': {ext: 'jpg', mediaType: 'image'},
  'image/webp': {ext: 'webp', mediaType: 'image'},
  'image/gif': {ext: 'gif', mediaType: 'image'},
  'image/avif': {ext: 'avif', mediaType: 'image'},
  'image/bmp': {ext: 'bmp', mediaType: 'image'},
  'video/mp4': {ext: 'mp4', mediaType: 'video'},
  'video/webm': {ext: 'webm', mediaType: 'video'},
  'video/quicktime': {ext: 'mov', mediaType: 'video'},
  'video/ogg': {ext: 'ogv', mediaType: 'video'},
  'video/x-m4v': {ext: 'm4v', mediaType: 'video'},
  'video/3gpp': {ext: '3gp', mediaType: 'video'},
};

// Raw binary upload for large photos and videos (up to 60 MB, no base64 overhead)
app.post(
  '/api/upload/media',
  requireAuth,
  express.raw({type: ['image/*', 'video/*', 'application/octet-stream'], limit: '60mb'}),
  (req: AuthedRequest, res: Response) => {
    const contentType = String(req.headers['content-type'] || '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    const fallbackMime = String(req.headers['x-file-mime'] || '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    const mime = MIME_EXT_MAP[contentType] ? contentType : fallbackMime;
    const mapped = MIME_EXT_MAP[mime];

    if (!mapped) {
      res.status(400).json({
        error: 'Unsupported media format. Please upload JPG, PNG, WEBP, GIF, MP4, WEBM, or MOV.',
      });
      return;
    }

    const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (buffer.length === 0) {
      res.status(400).json({error: 'Uploaded file is empty.'});
      return;
    }
    if (buffer.length > 60 * 1024 * 1024) {
      res.status(413).json({error: 'File is too large (max 60 MB).'});
      return;
    }

    const prefix = mapped.mediaType === 'video' ? 'vid' : 'img';
    const filename = `${prefix}_${req.user!.id}_${Date.now()}_${crypto.randomBytes(6).toString('hex')}.${mapped.ext}`;
    fs.writeFileSync(path.join(uploadsDir, filename), buffer);

    res.status(201).json({
      url: `/uploads/${filename}`,
      mediaType: mapped.mediaType,
    });
  },
);

app.post('/api/upload', requireAuth, (req: AuthedRequest, res: Response) => {
  const {dataUrl} = req.body as {dataUrl?: string};
  if (!dataUrl || typeof dataUrl !== 'string') {
    res.status(400).json({error: 'Media data is required.'});
    return;
  }

  const match = dataUrl.match(/^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,(.+)$/i);
  if (!match) {
    res.status(400).json({error: 'Invalid media payload. Please select a valid photo or video.'});
    return;
  }

  const mime = match[1].toLowerCase();
  const mapped = MIME_EXT_MAP[mime];
  if (!mapped) {
    res.status(400).json({
      error: 'Unsupported format. Please upload PNG, JPG, WEBP, GIF, MP4, WEBM, or MOV.',
    });
    return;
  }

  const buffer = Buffer.from(match[2], 'base64');
  const maxBytes = mapped.mediaType === 'video' ? 30 * 1024 * 1024 : 15 * 1024 * 1024;
  if (buffer.length > maxBytes) {
    res.status(413).json({
      error:
        mapped.mediaType === 'video'
          ? 'Video file is too large (max 30 MB via base64).'
          : 'Image file is too large (max 15 MB).',
    });
    return;
  }

  const prefix = mapped.mediaType === 'video' ? 'vid' : 'img';
  const filename = `${prefix}_${req.user!.id}_${Date.now()}_${crypto.randomBytes(6).toString('hex')}.${mapped.ext}`;
  fs.writeFileSync(path.join(uploadsDir, filename), buffer);

  res.status(201).json({url: `/uploads/${filename}`, mediaType: mapped.mediaType});
});

// =======================
// PROFILE & USERS ROUTES
// =======================

app.get('/api/users/search', requireAuth, (req: AuthedRequest, res: Response) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  const rows = q
    ? (db
        .prepare(
          `SELECT * FROM users
           WHERE lower(name) LIKE ? OR lower(bio) LIKE ? OR lower(work) LIKE ?
           ORDER BY name ASC LIMIT 20`,
        )
        .all(`%${q}%`, `%${q}%`, `%${q}%`) as UserRow[])
    : (db.prepare('SELECT * FROM users ORDER BY created_at DESC LIMIT 20').all() as UserRow[]);

  res.json({
    users: rows.map((u) => getProfileSummary(u, req.user!.id)),
  });
});

app.get('/api/users/:id', requireAuth, (req: AuthedRequest, res: Response) => {
  const targetId = Number(req.params.id);
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId) as UserRow | undefined;
  if (!target) {
    res.status(404).json({error: 'User not found.'});
    return;
  }

  const postRows = db
    .prepare(
      `SELECT p.*, u.name as author_name, u.avatar_url as author_avatar, u.work as author_work
       FROM posts p
       JOIN users u ON u.id = p.user_id
       WHERE p.user_id = ?
       ORDER BY p.created_at DESC`,
    )
    .all(targetId) as Array<Record<string, unknown>>;

  res.json({
    profile: getProfileSummary(target, req.user!.id),
    posts: hydratePosts(postRows, req.user!.id),
  });
});

app.put('/api/profile', requireAuth, (req: AuthedRequest, res: Response) => {
  const {name, bio, location, work, avatar_url, cover_url} = req.body as {
    name?: string;
    bio?: string;
    location?: string;
    work?: string;
    avatar_url?: string;
    cover_url?: string;
  };

  const current = req.user!;
  const nextName = typeof name === 'string' && name.trim().length >= 2 ? name.trim().slice(0, 60) : current.name;
  const nextBio = typeof bio === 'string' ? bio.trim().slice(0, 320) : current.bio;
  const nextLocation = typeof location === 'string' ? location.trim().slice(0, 80) : current.location;
  const nextWork = typeof work === 'string' ? work.trim().slice(0, 100) : current.work;
  const nextAvatar = typeof avatar_url === 'string' ? avatar_url.trim() : current.avatar_url;
  const nextCover = typeof cover_url === 'string' ? cover_url.trim() : current.cover_url;

  db.prepare(
    `UPDATE users
     SET name = ?, bio = ?, location = ?, work = ?, avatar_url = ?, cover_url = ?
     WHERE id = ?`,
  ).run(nextName, nextBio, nextLocation, nextWork, nextAvatar, nextCover, current.id);

  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(current.id) as UserRow;
  const summary = getProfileSummary(updated, current.id);

  broadcastAll('profile:updated', summary);

  res.json({
    user: summary,
    message: 'Profile saved successfully.',
  });
});

// =======================
// POSTS, LIKES & COMMENTS
// =======================

app.get('/api/posts', requireAuth, (req: AuthedRequest, res: Response) => {
  const filter = String(req.query.filter || 'all');
  let postRows: Array<Record<string, unknown>>;

  if (filter === 'following') {
    postRows = db
      .prepare(
        `SELECT p.*, u.name as author_name, u.avatar_url as author_avatar, u.work as author_work
         FROM posts p
         JOIN users u ON u.id = p.user_id
         WHERE p.user_id = ?
            OR p.user_id IN (SELECT following_id FROM follows WHERE follower_id = ?)
            OR p.user_id IN (
              SELECT CASE WHEN requester_id = ? THEN addressee_id ELSE requester_id END
              FROM friendships WHERE status = 'accepted' AND (requester_id = ? OR addressee_id = ?)
            )
         ORDER BY p.created_at DESC
         LIMIT 50`,
      )
      .all(req.user!.id, req.user!.id, req.user!.id, req.user!.id, req.user!.id) as Array<
      Record<string, unknown>
    >;
  } else {
    postRows = db
      .prepare(
        `SELECT p.*, u.name as author_name, u.avatar_url as author_avatar, u.work as author_work
         FROM posts p
         JOIN users u ON u.id = p.user_id
         ORDER BY p.created_at DESC
         LIMIT 50`,
      )
      .all() as Array<Record<string, unknown>>;
  }

  res.json({posts: hydratePosts(postRows, req.user!.id)});
});

app.post('/api/posts', requireAuth, (req: AuthedRequest, res: Response) => {
  const {content, image_url, video_url} = req.body as {
    content?: string;
    image_url?: string | null;
    video_url?: string | null;
  };
  const trimmed = (content || '').trim();
  const cleanImage = image_url && image_url.trim() ? image_url.trim() : null;
  const cleanVideo = video_url && video_url.trim() ? video_url.trim() : null;

  if (!trimmed && !cleanImage && !cleanVideo) {
    res.status(400).json({error: 'Write something or attach a photo or video before posting.'});
    return;
  }

  const now = new Date().toISOString();
  const result = db
    .prepare(
      'INSERT INTO posts (user_id, content, image_url, video_url, created_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(req.user!.id, trimmed.slice(0, 2000), cleanImage, cleanVideo, now);

  const postId = Number(result.lastInsertRowid);
  const row = db
    .prepare(
      `SELECT p.*, u.name as author_name, u.avatar_url as author_avatar, u.work as author_work
       FROM posts p
       JOIN users u ON u.id = p.user_id
       WHERE p.id = ?`,
    )
    .get(postId) as Record<string, unknown>;

  const hydrated = hydratePosts([row], req.user!.id)[0];
  broadcastAll('post:created', {...hydrated, liked_by_me: false, my_reaction: null});

  res.status(201).json({post: hydrated});
});

app.delete('/api/posts/:id', requireAuth, (req: AuthedRequest, res: Response) => {
  const postId = Number(req.params.id);
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(postId) as
    | {id: number; user_id: number}
    | undefined;
  if (!post) {
    res.status(404).json({error: 'Post not found.'});
    return;
  }
  if (post.user_id !== req.user!.id) {
    res.status(403).json({error: 'You can only delete your own posts.'});
    return;
  }
  db.prepare('DELETE FROM posts WHERE id = ?').run(postId);
  broadcastAll('post:deleted', {postId});
  res.json({ok: true});
});

app.post('/api/posts/:id/like', requireAuth, (req: AuthedRequest, res: Response) => {
  const postId = Number(req.params.id);
  const post = db.prepare('SELECT id, user_id FROM posts WHERE id = ?').get(postId) as
    | {id: number; user_id: number}
    | undefined;
  if (!post) {
    res.status(404).json({error: 'Post not found.'});
    return;
  }

  const requestedReaction = parseReaction((req.body as {reaction?: string} | undefined)?.reaction);
  const existing = db
    .prepare("SELECT COALESCE(reaction, 'like') as reaction FROM post_likes WHERE post_id = ? AND user_id = ?")
    .get(postId, req.user!.id) as {reaction: string} | undefined;

  let liked = false;
  let myReaction: ReactionKind | null = null;

  if (existing) {
    const existingKind = parseReaction(existing.reaction) || 'like';
    if (!requestedReaction || existingKind === requestedReaction) {
      // Clicking the same reaction again removes it
      db.prepare('DELETE FROM post_likes WHERE post_id = ? AND user_id = ?').run(
        postId,
        req.user!.id,
      );
      liked = false;
      myReaction = null;
    } else {
      // Switch to the newly chosen reaction (e.g. Like -> Love / Wow / Sad)
      db.prepare('UPDATE post_likes SET reaction = ? WHERE post_id = ? AND user_id = ?').run(
        requestedReaction,
        postId,
        req.user!.id,
      );
      liked = true;
      myReaction = requestedReaction;
    }
  } else {
    const chosen: ReactionKind = requestedReaction || 'like';
    db.prepare('INSERT INTO post_likes (post_id, user_id, reaction) VALUES (?, ?, ?)').run(
      postId,
      req.user!.id,
      chosen,
    );
    liked = true;
    myReaction = chosen;
    if (post.user_id !== req.user!.id) {
      createNotification(
        post.user_id,
        req.user!.id,
        'like',
        postId,
        `${req.user!.name} ${reactionVerb(chosen)} your post.`,
      );
    }
  }

  const reactionRows = db
    .prepare(
      `SELECT COALESCE(reaction, 'like') as reaction, COUNT(*) as count
       FROM post_likes
       WHERE post_id = ?
       GROUP BY COALESCE(reaction, 'like')`,
    )
    .all(postId) as Array<{reaction: string; count: number}>;

  const reactionCounts: Partial<Record<ReactionKind, number>> = {};
  let totalCount = 0;
  for (const r of reactionRows) {
    const kind = parseReaction(r.reaction) || 'like';
    reactionCounts[kind] = (reactionCounts[kind] || 0) + r.count;
    totalCount += r.count;
  }

  broadcastAll('post:liked', {
    postId,
    likes_count: totalCount,
    reaction_counts: reactionCounts,
    actorId: req.user!.id,
    liked,
    my_reaction: myReaction,
  });

  res.json({
    liked,
    my_reaction: myReaction,
    likes_count: totalCount,
    reaction_counts: reactionCounts,
  });
});

app.post('/api/posts/:id/comments', requireAuth, (req: AuthedRequest, res: Response) => {
  const postId = Number(req.params.id);
  const {content} = req.body as {content?: string};
  const trimmed = (content || '').trim();
  if (!trimmed) {
    res.status(400).json({error: 'Comment cannot be empty.'});
    return;
  }

  const post = db.prepare('SELECT id, user_id FROM posts WHERE id = ?').get(postId) as
    | {id: number; user_id: number}
    | undefined;
  if (!post) {
    res.status(404).json({error: 'Post not found.'});
    return;
  }

  const now = new Date().toISOString();
  const result = db
    .prepare('INSERT INTO comments (post_id, user_id, content, created_at) VALUES (?, ?, ?, ?)')
    .run(postId, req.user!.id, trimmed.slice(0, 600), now);

  const comment = {
    id: Number(result.lastInsertRowid),
    post_id: postId,
    user_id: req.user!.id,
    content: trimmed.slice(0, 600),
    created_at: now,
    author_name: req.user!.name,
    author_avatar: req.user!.avatar_url,
  };

  if (post.user_id !== req.user!.id) {
    createNotification(
      post.user_id,
      req.user!.id,
      'comment',
      postId,
      `${req.user!.name} commented on your post.`,
    );
  }

  broadcastAll('post:commented', {postId, comment});
  res.status(201).json({comment});
});

// =======================
// FRIENDS & FOLLOWS
// =======================

app.get('/api/network', requireAuth, (req: AuthedRequest, res: Response) => {
  const me = req.user!.id;

  const friendRows = db
    .prepare(
      `SELECT u.* FROM friendships f
       JOIN users u ON u.id = CASE WHEN f.requester_id = ? THEN f.addressee_id ELSE f.requester_id END
       WHERE f.status = 'accepted' AND (f.requester_id = ? OR f.addressee_id = ?)
       ORDER BY u.name ASC`,
    )
    .all(me, me, me) as UserRow[];

  const incomingRows = db
    .prepare(
      `SELECT u.*, f.id as request_id, f.created_at as requested_at
       FROM friendships f
       JOIN users u ON u.id = f.requester_id
       WHERE f.addressee_id = ? AND f.status = 'pending'
       ORDER BY f.created_at DESC`,
    )
    .all(me) as Array<UserRow & {request_id: number; requested_at: string}>;

  const outgoingRows = db
    .prepare(
      `SELECT u.*, f.id as request_id, f.created_at as requested_at
       FROM friendships f
       JOIN users u ON u.id = f.addressee_id
       WHERE f.requester_id = ? AND f.status = 'pending'
       ORDER BY f.created_at DESC`,
    )
    .all(me) as Array<UserRow & {request_id: number; requested_at: string}>;

  const connectedIds = new Set<number>([
    me,
    ...friendRows.map((u) => u.id),
    ...incomingRows.map((u) => u.id),
    ...outgoingRows.map((u) => u.id),
  ]);

  const allOthers = db
    .prepare('SELECT * FROM users WHERE id != ? ORDER BY created_at DESC LIMIT 30')
    .all(me) as UserRow[];

  const suggestions = allOthers
    .filter((u) => !connectedIds.has(u.id))
    .map((u) => getProfileSummary(u, me));

  const followingRows = db
    .prepare('SELECT following_id FROM follows WHERE follower_id = ?')
    .all(me) as Array<{following_id: number}>;

  res.json({
    friends: friendRows.map((u) => getProfileSummary(u, me)),
    incomingRequests: incomingRows.map((u) => ({
      ...getProfileSummary(u, me),
      request_id: u.request_id,
      requested_at: u.requested_at,
    })),
    outgoingRequests: outgoingRows.map((u) => ({
      ...getProfileSummary(u, me),
      request_id: u.request_id,
      requested_at: u.requested_at,
    })),
    suggestions,
    followingIds: followingRows.map((r) => r.following_id),
  });
});

app.post('/api/friends/request', requireAuth, (req: AuthedRequest, res: Response) => {
  const targetId = Number((req.body as {userId?: number}).userId);
  const me = req.user!.id;
  if (!targetId || targetId === me) {
    res.status(400).json({error: 'Invalid user.'});
    return;
  }

  const target = db.prepare('SELECT id, name FROM users WHERE id = ?').get(targetId) as
    | {id: number; name: string}
    | undefined;
  if (!target) {
    res.status(404).json({error: 'User not found.'});
    return;
  }

  const existing = db
    .prepare(
      `SELECT * FROM friendships
       WHERE (requester_id = ? AND addressee_id = ?)
          OR (requester_id = ? AND addressee_id = ?)`,
    )
    .get(me, targetId, targetId, me) as {id: number; status: string} | undefined;

  if (existing) {
    res.status(409).json({
      error: existing.status === 'accepted' ? 'Already friends.' : 'Friend request already pending.',
    });
    return;
  }

  db.prepare(
    'INSERT INTO friendships (requester_id, addressee_id, status) VALUES (?, ?, ?)',
  ).run(me, targetId, 'pending');

  createNotification(
    targetId,
    me,
    'friend_request',
    me,
    `${req.user!.name} sent you a friend request.`,
  );

  sendToUser(targetId, 'network:updated', {});
  sendToUser(me, 'network:updated', {});

  res.status(201).json({status: 'outgoing_pending'});
});

app.post('/api/friends/respond', requireAuth, (req: AuthedRequest, res: Response) => {
  const {requesterId, action} = req.body as {requesterId?: number; action?: 'accept' | 'decline'};
  const me = req.user!.id;

  const rel = db
    .prepare(
      `SELECT * FROM friendships
       WHERE requester_id = ? AND addressee_id = ? AND status = 'pending'`,
    )
    .get(Number(requesterId), me) as {id: number; requester_id: number} | undefined;

  if (!rel) {
    res.status(404).json({error: 'Friend request not found.'});
    return;
  }

  if (action === 'accept') {
    db.prepare("UPDATE friendships SET status = 'accepted' WHERE id = ?").run(rel.id);
    // Automatically follow each other on accept
    db.prepare('INSERT OR IGNORE INTO follows (follower_id, following_id) VALUES (?, ?)').run(
      me,
      rel.requester_id,
    );
    db.prepare('INSERT OR IGNORE INTO follows (follower_id, following_id) VALUES (?, ?)').run(
      rel.requester_id,
      me,
    );

    createNotification(
      rel.requester_id,
      me,
      'friend_accepted',
      me,
      `${req.user!.name} accepted your friend request.`,
    );
  } else {
    db.prepare('DELETE FROM friendships WHERE id = ?').run(rel.id);
  }

  sendToUser(rel.requester_id, 'network:updated', {});
  sendToUser(me, 'network:updated', {});

  res.json({ok: true, action});
});

app.delete('/api/friends/:userId', requireAuth, (req: AuthedRequest, res: Response) => {
  const targetId = Number(req.params.userId);
  const me = req.user!.id;

  db.prepare(
    `DELETE FROM friendships
     WHERE (requester_id = ? AND addressee_id = ?)
        OR (requester_id = ? AND addressee_id = ?)`,
  ).run(me, targetId, targetId, me);

  sendToUser(targetId, 'network:updated', {});
  sendToUser(me, 'network:updated', {});

  res.json({ok: true});
});

app.post('/api/follows/toggle', requireAuth, (req: AuthedRequest, res: Response) => {
  const targetId = Number((req.body as {userId?: number}).userId);
  const me = req.user!.id;
  if (!targetId || targetId === me) {
    res.status(400).json({error: 'Invalid user.'});
    return;
  }

  const existing = db
    .prepare('SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?')
    .get(me, targetId);

  let following = false;
  if (existing) {
    db.prepare('DELETE FROM follows WHERE follower_id = ? AND following_id = ?').run(me, targetId);
  } else {
    db.prepare('INSERT INTO follows (follower_id, following_id) VALUES (?, ?)').run(me, targetId);
    following = true;
    createNotification(
      targetId,
      me,
      'follow',
      me,
      `${req.user!.name} started following you.`,
    );
  }

  res.json({following});
});

// =======================
// NOTIFICATIONS
// =======================

app.get('/api/notifications', requireAuth, (req: AuthedRequest, res: Response) => {
  const rows = db
    .prepare(
      `SELECT n.*, u.name as actor_name, u.avatar_url as actor_avatar
       FROM notifications n
       LEFT JOIN users u ON u.id = n.actor_id
       WHERE n.user_id = ?
       ORDER BY n.created_at DESC
       LIMIT 40`,
    )
    .all(req.user!.id) as Array<Record<string, unknown>>;

  res.json({
    notifications: rows.map((r) => ({...r, read: Boolean(r.read)})),
  });
});

app.post('/api/notifications/read-all', requireAuth, (req: AuthedRequest, res: Response) => {
  db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').run(req.user!.id);
  res.json({ok: true});
});

app.post('/api/notifications/:id/read', requireAuth, (req: AuthedRequest, res: Response) => {
  db.prepare('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?').run(
    Number(req.params.id),
    req.user!.id,
  );
  res.json({ok: true});
});

// =======================
// REAL-TIME CHAT & MESSAGES
// =======================

app.get('/api/messages/conversations', requireAuth, (req: AuthedRequest, res: Response) => {
  const me = req.user!.id;
  // Include friends + anyone with existing message history
  const contacts = db
    .prepare(
      `SELECT DISTINCT u.*
       FROM users u
       WHERE u.id != ? AND (
         u.id IN (
           SELECT CASE WHEN requester_id = ? THEN addressee_id ELSE requester_id END
           FROM friendships WHERE status = 'accepted' AND (requester_id = ? OR addressee_id = ?)
         )
         OR u.id IN (SELECT sender_id FROM messages WHERE receiver_id = ?)
         OR u.id IN (SELECT receiver_id FROM messages WHERE sender_id = ?)
       )
       ORDER BY u.name ASC`,
    )
    .all(me, me, me, me, me, me) as UserRow[];

  // If user has no friends or chats yet, include community contacts so messaging is immediately usable
  const finalContacts =
    contacts.length > 0
      ? contacts
      : (db.prepare('SELECT * FROM users WHERE id != ? ORDER BY id ASC LIMIT 6').all(me) as UserRow[]);

  const conversations = finalContacts.map((contact) => {
    const lastMsg = db
      .prepare(
        `SELECT * FROM messages
         WHERE (sender_id = ? AND receiver_id = ?)
            OR (sender_id = ? AND receiver_id = ?)
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(me, contact.id, contact.id, me) as
      | {content: string; created_at: string; sender_id: number}
      | undefined;

    const unreadRow = db
      .prepare(
        'SELECT COUNT(*) as count FROM messages WHERE sender_id = ? AND receiver_id = ? AND read = 0',
      )
      .get(contact.id, me) as {count: number};

    return {
      user: sanitizeUser(contact),
      last_message: lastMsg?.content ?? null,
      last_message_at: lastMsg?.created_at ?? null,
      last_sender_id: lastMsg?.sender_id ?? null,
      unread_count: unreadRow.count,
    };
  });

  conversations.sort((a, b) => {
    if (a.last_message_at && b.last_message_at) {
      return b.last_message_at.localeCompare(a.last_message_at);
    }
    if (a.last_message_at) return -1;
    if (b.last_message_at) return 1;
    return a.user.name.localeCompare(b.user.name);
  });

  res.json({conversations, onlineUserIds: getOnlineUserIds()});
});

app.get('/api/messages/:userId', requireAuth, (req: AuthedRequest, res: Response) => {
  const me = req.user!.id;
  const peerId = Number(req.params.userId);

  db.prepare('UPDATE messages SET read = 1 WHERE sender_id = ? AND receiver_id = ? AND read = 0').run(
    peerId,
    me,
  );

  const rows = db
    .prepare(
      `SELECT * FROM messages
       WHERE (sender_id = ? AND receiver_id = ?)
          OR (sender_id = ? AND receiver_id = ?)
       ORDER BY created_at ASC
       LIMIT 200`,
    )
    .all(me, peerId, peerId, me) as Array<Record<string, unknown>>;

  res.json({
    messages: rows.map((r) => ({...r, read: Boolean(r.read)})),
  });
});

app.post('/api/messages/:userId', requireAuth, (req: AuthedRequest, res: Response) => {
  const me = req.user!.id;
  const peerId = Number(req.params.userId);
  const {content} = req.body as {content?: string};
  const trimmed = (content || '').trim();

  if (!trimmed) {
    res.status(400).json({error: 'Message cannot be empty.'});
    return;
  }

  const peer = db.prepare('SELECT id FROM users WHERE id = ?').get(peerId);
  if (!peer) {
    res.status(404).json({error: 'Recipient not found.'});
    return;
  }

  const now = new Date().toISOString();
  const result = db
    .prepare('INSERT INTO messages (sender_id, receiver_id, content, read, created_at) VALUES (?, ?, ?, 0, ?)')
    .run(me, peerId, trimmed.slice(0, 1500), now);

  const msg = {
    id: Number(result.lastInsertRowid),
    sender_id: me,
    receiver_id: peerId,
    content: trimmed.slice(0, 1500),
    read: false,
    created_at: now,
  };

  sendToUser(peerId, 'chat:message', msg);
  sendToUser(me, 'chat:message', msg);

  res.status(201).json({message: msg});
});

// =======================
// MENU, SETTINGS & COMMUNITY HUBS
// =======================

function getOrCreateUserSettings(userId: number) {
  db.prepare('INSERT OR IGNORE INTO user_settings (user_id) VALUES (?)').run(userId);
  const row = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(userId) as {
    user_id: number;
    profile_visibility: string;
    friend_request_policy: string;
    show_online_status: number;
    email_notifications: number;
    push_notifications: number;
    language: string;
    updated_at: string;
  };
  return {
    profile_visibility: row.profile_visibility as 'public' | 'friends',
    friend_request_policy: row.friend_request_policy as 'everyone' | 'friends_of_friends',
    show_online_status: Boolean(row.show_online_status),
    email_notifications: Boolean(row.email_notifications),
    push_notifications: Boolean(row.push_notifications),
    language: row.language,
    updated_at: row.updated_at,
  };
}

app.get('/api/settings', requireAuth, (req: AuthedRequest, res: Response) => {
  res.json({settings: getOrCreateUserSettings(req.user!.id)});
});

app.put('/api/settings', requireAuth, (req: AuthedRequest, res: Response) => {
  const current = getOrCreateUserSettings(req.user!.id);
  const body = req.body as Partial<typeof current>;

  const profileVisibility =
    body.profile_visibility === 'friends' || body.profile_visibility === 'public'
      ? body.profile_visibility
      : current.profile_visibility;
  const friendPolicy =
    body.friend_request_policy === 'friends_of_friends' ||
    body.friend_request_policy === 'everyone'
      ? body.friend_request_policy
      : current.friend_request_policy;
  const showOnline =
    typeof body.show_online_status === 'boolean'
      ? body.show_online_status
      : current.show_online_status;
  const emailNotifs =
    typeof body.email_notifications === 'boolean'
      ? body.email_notifications
      : current.email_notifications;
  const pushNotifs =
    typeof body.push_notifications === 'boolean'
      ? body.push_notifications
      : current.push_notifications;
  const language =
    typeof body.language === 'string' && body.language.trim()
      ? body.language.trim().slice(0, 32)
      : current.language;

  db.prepare(
    `UPDATE user_settings
     SET profile_visibility = ?,
         friend_request_policy = ?,
         show_online_status = ?,
         email_notifications = ?,
         push_notifications = ?,
         language = ?,
         updated_at = datetime('now')
     WHERE user_id = ?`,
  ).run(
    profileVisibility,
    friendPolicy,
    showOnline ? 1 : 0,
    emailNotifs ? 1 : 0,
    pushNotifs ? 1 : 0,
    language,
    req.user!.id,
  );

  res.json({
    settings: getOrCreateUserSettings(req.user!.id),
    message: 'Settings saved to your account.',
  });
});

app.post('/api/settings/change-password', requireAuth, (req: AuthedRequest, res: Response) => {
  const {currentPassword, newPassword} = req.body as {
    currentPassword?: string;
    newPassword?: string;
  };
  if (!currentPassword || !newPassword) {
    res.status(400).json({error: 'Enter both your current password and a new password.'});
    return;
  }
  if (newPassword.length < 6) {
    res.status(400).json({error: 'New password must be at least 6 characters long.'});
    return;
  }
  if (!verifyPassword(currentPassword, req.user!.password_hash)) {
    res.status(401).json({error: 'Current password is incorrect.'});
    return;
  }
  const newHash = hashPassword(newPassword);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, req.user!.id);
  logSecurityEmail(
    req.user!.id,
    'Your Verve password was changed',
    'Your password was updated from Accounts Centre → Password and security. If this was not you, reset your password immediately.',
    'security',
  );
  res.json({message: 'Password updated successfully.'});
});

app.get('/api/auth/switchable-accounts', requireAuth, (_req: AuthedRequest, res: Response) => {
  res.json({accounts: []});
});

app.post('/api/auth/quick-switch', requireAuth, (_req: AuthedRequest, res: Response) => {
  res.status(403).json({error: 'Use password login to switch accounts.'});
});

app.post('/api/posts/:id/save', requireAuth, (req: AuthedRequest, res: Response) => {
  const postId = Number(req.params.id);
  const exists = db.prepare('SELECT id FROM posts WHERE id = ?').get(postId);
  if (!exists) {
    res.status(404).json({error: 'Post not found.'});
    return;
  }
  const saved = db
    .prepare('SELECT 1 FROM saved_posts WHERE user_id = ? AND post_id = ?')
    .get(req.user!.id, postId);
  if (saved) {
    db.prepare('DELETE FROM saved_posts WHERE user_id = ? AND post_id = ?').run(
      req.user!.id,
      postId,
    );
    res.json({saved: false});
  } else {
    db.prepare('INSERT INTO saved_posts (user_id, post_id) VALUES (?, ?)').run(
      req.user!.id,
      postId,
    );
    res.json({saved: true});
  }
});

app.get('/api/saved', requireAuth, (req: AuthedRequest, res: Response) => {
  const postRows = db
    .prepare(
      `SELECT p.*, u.name as author_name, u.avatar_url as author_avatar, u.work as author_work
       FROM saved_posts sp
       JOIN posts p ON p.id = sp.post_id
       JOIN users u ON u.id = p.user_id
       WHERE sp.user_id = ?
       ORDER BY sp.created_at DESC`,
    )
    .all(req.user!.id) as Array<Record<string, unknown>>;

  res.json({posts: hydratePosts(postRows, req.user!.id)});
});

app.get('/api/dashboard', requireAuth, (req: AuthedRequest, res: Response) => {
  const me = req.user!.id;
  const postsCount = (
    db.prepare('SELECT COUNT(*) as count FROM posts WHERE user_id = ?').get(me) as {count: number}
  ).count;
  const totalLikes = (
    db
      .prepare(
        `SELECT COUNT(*) as count FROM post_likes pl
         JOIN posts p ON p.id = pl.post_id
         WHERE p.user_id = ?`,
      )
      .get(me) as {count: number}
  ).count;
  const totalComments = (
    db
      .prepare(
        `SELECT COUNT(*) as count FROM comments c
         JOIN posts p ON p.id = c.post_id
         WHERE p.user_id = ?`,
      )
      .get(me) as {count: number}
  ).count;
  const friendsCount = (
    db
      .prepare(
        `SELECT COUNT(*) as count FROM friendships
         WHERE status = 'accepted' AND (requester_id = ? OR addressee_id = ?)`,
      )
      .get(me, me) as {count: number}
  ).count;
  const followersCount = (
    db.prepare('SELECT COUNT(*) as count FROM follows WHERE following_id = ?').get(me) as {
      count: number;
    }
  ).count;

  const recentPostRows = db
    .prepare(
      `SELECT p.*, u.name as author_name, u.avatar_url as author_avatar, u.work as author_work
       FROM posts p
       JOIN users u ON u.id = p.user_id
       WHERE p.user_id = ?
       ORDER BY p.created_at DESC
       LIMIT 5`,
    )
    .all(me) as Array<Record<string, unknown>>;

  res.json({
    stats: {
      posts_count: postsCount,
      total_likes: totalLikes,
      total_comments: totalComments,
      friends_count: friendsCount,
      followers_count: followersCount,
      recent_posts: hydratePosts(recentPostRows, me),
    },
  });
});

app.get('/api/activity', requireAuth, (req: AuthedRequest, res: Response) => {
  const me = req.user!.id;
  const myPosts = db
    .prepare(
      `SELECT id, 'post' as kind, substr(content, 1, 90) as summary, created_at
       FROM posts WHERE user_id = ? ORDER BY created_at DESC LIMIT 15`,
    )
    .all(me) as Array<{id: number; kind: string; summary: string; created_at: string}>;

  const myLikes = db
    .prepare(
      `SELECT pl.post_id as id, 'like' as kind,
              'Liked a post by ' || u.name as summary, pl.created_at
       FROM post_likes pl
       JOIN posts p ON p.id = pl.post_id
       JOIN users u ON u.id = p.user_id
       WHERE pl.user_id = ?
       ORDER BY pl.created_at DESC LIMIT 15`,
    )
    .all(me) as Array<{id: number; kind: string; summary: string; created_at: string}>;

  const myComments = db
    .prepare(
      `SELECT c.id, 'comment' as kind,
              'Commented: "' || substr(c.content, 1, 70) || '"' as summary, c.created_at
       FROM comments c
       WHERE c.user_id = ?
       ORDER BY c.created_at DESC LIMIT 15`,
    )
    .all(me) as Array<{id: number; kind: string; summary: string; created_at: string}>;

  const combined = [...myPosts, ...myLikes, ...myComments].sort((a, b) =>
    b.created_at.localeCompare(a.created_at),
  );
  res.json({activities: combined.slice(0, 30)});
});

app.get('/api/groups', requireAuth, (req: AuthedRequest, res: Response) => {
  const me = req.user!.id;
  const rows = db
    .prepare(
      `SELECT g.*,
              (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id = g.id) as members_count,
              EXISTS(SELECT 1 FROM group_members gm WHERE gm.group_id = g.id AND gm.user_id = ?) as joined
       FROM groups_table g
       ORDER BY g.created_at DESC`,
    )
    .all(me) as Array<Record<string, unknown>>;

  res.json({
    groups: rows.map((r) => ({...r, joined: Boolean(r.joined)})),
  });
});

app.post('/api/groups', requireAuth, (req: AuthedRequest, res: Response) => {
  const {name, category, description} = req.body as {
    name?: string;
    category?: string;
    description?: string;
  };
  if (!name || name.trim().length < 2) {
    res.status(400).json({error: 'Group name is required.'});
    return;
  }
  const result = db
    .prepare(
      'INSERT INTO groups_table (name, category, description, cover_url, created_by) VALUES (?, ?, ?, ?, ?)',
    )
    .run(
      name.trim().slice(0, 80),
      (category || 'Community').trim().slice(0, 40),
      (description || '').trim().slice(0, 300),
      ASSETS.coverCoast,
      req.user!.id,
    );
  const groupId = Number(result.lastInsertRowid);
  db.prepare('INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)').run(
    groupId,
    req.user!.id,
  );
  res.status(201).json({ok: true, id: groupId});
});

app.post('/api/groups/:id/toggle', requireAuth, (req: AuthedRequest, res: Response) => {
  const groupId = Number(req.params.id);
  const existing = db
    .prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?')
    .get(groupId, req.user!.id);
  if (existing) {
    db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').run(
      groupId,
      req.user!.id,
    );
    res.json({joined: false});
  } else {
    db.prepare('INSERT INTO group_members (group_id, user_id) VALUES (?, ?)').run(
      groupId,
      req.user!.id,
    );
    res.json({joined: true});
  }
});

app.get('/api/marketplace', requireAuth, (_req: AuthedRequest, res: Response) => {
  const rows = db
    .prepare(
      `SELECT m.*, u.name as seller_name, u.avatar_url as seller_avatar
       FROM marketplace_items m
       JOIN users u ON u.id = m.seller_id
       ORDER BY m.created_at DESC`,
    )
    .all();
  res.json({items: rows});
});

app.post('/api/marketplace', requireAuth, (req: AuthedRequest, res: Response) => {
  const {title, price, category, location, description, image_url} = req.body as {
    title?: string;
    price?: string;
    category?: string;
    location?: string;
    description?: string;
    image_url?: string;
  };
  if (!title || !title.trim() || !price || !price.trim()) {
    res.status(400).json({error: 'Item title and price are required.'});
    return;
  }
  const result = db
    .prepare(
      `INSERT INTO marketplace_items (seller_id, title, price, category, location, description, image_url)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      req.user!.id,
      title.trim().slice(0, 80),
      price.trim().slice(0, 24),
      (category || 'General').trim().slice(0, 40),
      (location || req.user!.location || 'Local').trim().slice(0, 60),
      (description || '').trim().slice(0, 400),
      (image_url && image_url.trim()) || ASSETS.postCoffee,
    );
  res.status(201).json({ok: true, id: Number(result.lastInsertRowid)});
});

app.get('/api/events', requireAuth, (req: AuthedRequest, res: Response) => {
  const me = req.user!.id;
  const rows = db
    .prepare(
      `SELECT e.*,
              u.name as host_name,
              (SELECT COUNT(*) FROM event_rsvps r WHERE r.event_id = e.id AND r.status = 'going') as going_count,
              (SELECT COUNT(*) FROM event_rsvps r WHERE r.event_id = e.id AND r.status = 'interested') as interested_count,
              (SELECT status FROM event_rsvps r WHERE r.event_id = e.id AND r.user_id = ?) as my_rsvp
       FROM events_table e
       LEFT JOIN users u ON u.id = e.host_id
       ORDER BY e.created_at DESC`,
    )
    .all(me);
  res.json({events: rows});
});

app.post('/api/events', requireAuth, (req: AuthedRequest, res: Response) => {
  const {title, event_date, location, description} = req.body as {
    title?: string;
    event_date?: string;
    location?: string;
    description?: string;
  };
  if (!title || !title.trim() || !event_date || !location) {
    res.status(400).json({error: 'Title, date, and location are required.'});
    return;
  }
  const result = db
    .prepare(
      'INSERT INTO events_table (title, event_date, location, description, host_id) VALUES (?, ?, ?, ?, ?)',
    )
    .run(
      title.trim().slice(0, 90),
      event_date.trim().slice(0, 60),
      location.trim().slice(0, 80),
      (description || '').trim().slice(0, 400),
      req.user!.id,
    );
  const eventId = Number(result.lastInsertRowid);
  db.prepare('INSERT OR REPLACE INTO event_rsvps (event_id, user_id, status) VALUES (?, ?, ?)').run(
    eventId,
    req.user!.id,
    'going',
  );
  res.status(201).json({ok: true, id: eventId});
});

app.post('/api/events/:id/rsvp', requireAuth, (req: AuthedRequest, res: Response) => {
  const eventId = Number(req.params.id);
  const {status} = req.body as {status?: 'going' | 'interested' | 'none'};
  if (status === 'none') {
    db.prepare('DELETE FROM event_rsvps WHERE event_id = ? AND user_id = ?').run(
      eventId,
      req.user!.id,
    );
    res.json({my_rsvp: null});
    return;
  }
  const nextStatus = status === 'interested' ? 'interested' : 'going';
  db.prepare('INSERT OR REPLACE INTO event_rsvps (event_id, user_id, status) VALUES (?, ?, ?)').run(
    eventId,
    req.user!.id,
    nextStatus,
  );
  res.json({my_rsvp: nextStatus});
});

app.get('/api/pages', requireAuth, (req: AuthedRequest, res: Response) => {
  const me = req.user!.id;
  const rows = db
    .prepare(
      `SELECT p.*,
              (SELECT COUNT(*) FROM page_follows pf WHERE pf.page_id = p.id) as followers_count,
              EXISTS(SELECT 1 FROM page_follows pf WHERE pf.page_id = p.id AND pf.user_id = ?) as following
       FROM pages_table p
       ORDER BY p.created_at DESC`,
    )
    .all(me) as Array<Record<string, unknown>>;

  res.json({
    pages: rows.map((r) => ({...r, following: Boolean(r.following)})),
  });
});

app.post('/api/pages', requireAuth, (req: AuthedRequest, res: Response) => {
  const {name, category, bio} = req.body as {name?: string; category?: string; bio?: string};
  if (!name || name.trim().length < 2) {
    res.status(400).json({error: 'Page name is required.'});
    return;
  }
  const result = db
    .prepare(
      'INSERT INTO pages_table (name, category, bio, avatar_url, created_by) VALUES (?, ?, ?, ?, ?)',
    )
    .run(
      name.trim().slice(0, 80),
      (category || 'Creator').trim().slice(0, 40),
      (bio || '').trim().slice(0, 300),
      req.user!.avatar_url || ASSETS.avatarMaya,
      req.user!.id,
    );
  const pageId = Number(result.lastInsertRowid);
  db.prepare('INSERT OR IGNORE INTO page_follows (page_id, user_id) VALUES (?, ?)').run(
    pageId,
    req.user!.id,
  );
  res.status(201).json({ok: true, id: pageId});
});

app.post('/api/pages/:id/toggle', requireAuth, (req: AuthedRequest, res: Response) => {
  const pageId = Number(req.params.id);
  const existing = db
    .prepare('SELECT 1 FROM page_follows WHERE page_id = ? AND user_id = ?')
    .get(pageId, req.user!.id);
  if (existing) {
    db.prepare('DELETE FROM page_follows WHERE page_id = ? AND user_id = ?').run(
      pageId,
      req.user!.id,
    );
    res.json({following: false});
  } else {
    db.prepare('INSERT INTO page_follows (page_id, user_id) VALUES (?, ?)').run(
      pageId,
      req.user!.id,
    );
    res.json({following: true});
  }
});

// =======================
// ACCOUNTS CENTRE: PERSONAL DETAILS & PASSWORD/SECURITY
// =======================

function generateBackupCodes(): string[] {
  const codes: string[] = [];
  for (let i = 0; i < 6; i++) {
    const raw = crypto.randomBytes(4).toString('hex').toUpperCase();
    codes.push(`${raw.slice(0, 4)}-${raw.slice(4, 8)}`);
  }
  return codes;
}

function generateTotpSecret(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bytes = crypto.randomBytes(16);
  let out = '';
  for (const b of bytes) {
    out += alphabet[b % alphabet.length];
  }
  return out.match(/.{1,4}/g)?.join(' ') || out;
}

function generateFingerprint(): string {
  const hex = crypto.randomBytes(12).toString('hex').toUpperCase();
  return hex.match(/.{1,4}/g)?.join(' ') || hex;
}

function getOrCreateUserSecurity(userId: number) {
  const existing = db.prepare('SELECT * FROM user_security WHERE user_id = ?').get(userId) as
    | Record<string, unknown>
    | undefined;
  if (!existing) {
    db.prepare(
      `INSERT INTO user_security (user_id, two_factor_secret, backup_codes, e2ee_fingerprint)
       VALUES (?, ?, ?, ?)`,
    ).run(userId, generateTotpSecret(), JSON.stringify(generateBackupCodes()), generateFingerprint());
  }
  const row = db.prepare('SELECT * FROM user_security WHERE user_id = ?').get(userId) as {
    user_id: number;
    two_factor_enabled: number;
    two_factor_method: string;
    two_factor_secret: string;
    backup_codes: string;
    saved_login_enabled: number;
    advanced_protection: number;
    login_alerts_inapp: number;
    login_alerts_email: number;
    e2ee_key_alerts: number;
    e2ee_fingerprint: string;
    account_status: string;
    updated_at: string;
  };
  let parsedCodes: string[] = [];
  try {
    parsedCodes = JSON.parse(row.backup_codes || '[]');
  } catch {
    parsedCodes = [];
  }
  return {
    two_factor_enabled: Boolean(row.two_factor_enabled),
    two_factor_method: row.two_factor_method as 'authenticator' | 'sms',
    two_factor_secret: row.two_factor_secret,
    backup_codes: parsedCodes,
    saved_login_enabled: Boolean(row.saved_login_enabled),
    advanced_protection: Boolean(row.advanced_protection),
    login_alerts_inapp: Boolean(row.login_alerts_inapp),
    login_alerts_email: Boolean(row.login_alerts_email),
    e2ee_key_alerts: Boolean(row.e2ee_key_alerts),
    e2ee_fingerprint: row.e2ee_fingerprint || generateFingerprint(),
    account_status: row.account_status as 'active' | 'deactivated',
    updated_at: row.updated_at,
  };
}

app.get('/api/accounts-centre', requireAuth, (req: AuthedRequest, res: Response) => {
  const me = req.user!.id;
  const freshUser = db.prepare('SELECT * FROM users WHERE id = ?').get(me) as UserRow;
  const linked = db
    .prepare('SELECT * FROM linked_accounts WHERE user_id = ? ORDER BY created_at DESC')
    .all(me);
  const managedPages = db
    .prepare(
      `SELECT id, name, avatar_url FROM pages_table
       WHERE created_by = ? OR id IN (SELECT page_id FROM page_follows WHERE user_id = ?)
       ORDER BY created_at DESC`,
    )
    .all(me, me) as Array<{id: number; name: string; avatar_url: string}>;
  const security = getOrCreateUserSecurity(me);

  res.json({
    user: getProfileSummary(freshUser, me),
    linked_accounts: linked,
    managed_pages_count: managedPages.length,
    managed_pages_avatars: managedPages.slice(0, 2).map((p) => ({name: p.name, avatar_url: p.avatar_url})),
    security,
  });
});

app.put('/api/personal-details/contact', requireAuth, (req: AuthedRequest, res: Response) => {
  const {email: rawEmail, phone: rawPhone} = req.body as {email?: string; phone?: string};
  const me = req.user!.id;

  let nextEmail: string | null = null;
  let nextPhone: string | null = null;

  if (rawEmail && rawEmail.trim()) {
    nextEmail = normalizeEmail(rawEmail);
    if (!nextEmail) {
      res.status(400).json({error: 'Please enter a valid email address (e.g. name@gmail.com).'});
      return;
    }
    const conflict = db
      .prepare('SELECT id FROM users WHERE email = ? AND id != ?')
      .get(nextEmail, me);
    if (conflict) {
      res.status(409).json({error: 'This email address is already linked to another account.'});
      return;
    }
  }

  if (rawPhone && rawPhone.trim()) {
    nextPhone = normalizePhone(rawPhone);
    if (!nextPhone) {
      res.status(400).json({error: 'Please enter a valid phone number (7–15 digits).'});
      return;
    }
    const conflict = db
      .prepare('SELECT id FROM users WHERE phone = ? AND id != ?')
      .get(nextPhone, me);
    if (conflict) {
      res.status(409).json({error: 'This phone number is already linked to another account.'});
      return;
    }
  }

  if (!nextEmail && !nextPhone) {
    res.status(400).json({error: 'Keep at least one email address or phone number on your account.'});
    return;
  }

  db.prepare('UPDATE users SET email = ?, phone = ? WHERE id = ?').run(nextEmail, nextPhone, me);
  logSecurityEmail(
    me,
    'Contact information updated',
    `Your contact info was updated to ${[nextEmail, nextPhone].filter(Boolean).join(', ')}.`,
    'security',
  );

  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(me) as UserRow;
  res.json({
    user: getProfileSummary(updated, me),
    message: 'Contact info saved successfully.',
  });
});

app.put('/api/personal-details/dob', requireAuth, (req: AuthedRequest, res: Response) => {
  const {date_of_birth} = req.body as {date_of_birth?: string};
  const cleanDob = (date_of_birth || '').trim().slice(0, 32);
  if (!cleanDob) {
    res.status(400).json({error: 'Please select a valid date of birth.'});
    return;
  }
  db.prepare('UPDATE users SET date_of_birth = ? WHERE id = ?').run(cleanDob, req.user!.id);
  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.id) as UserRow;
  res.json({
    user: getProfileSummary(updated, req.user!.id),
    message: 'Date of birth updated and saved.',
  });
});

app.post('/api/accounts-centre/linked', requireAuth, (req: AuthedRequest, res: Response) => {
  const {handle, platform} = req.body as {handle?: string; platform?: string};
  const cleanHandle = (handle || '').trim().slice(0, 60);
  const cleanPlatform = (platform || 'Verve').trim().slice(0, 30);
  if (cleanHandle.length < 2) {
    res.status(400).json({error: 'Enter a profile name or handle (at least 2 characters).'});
    return;
  }
  const result = db
    .prepare(
      'INSERT INTO linked_accounts (user_id, handle, platform, status, avatar_url) VALUES (?, ?, ?, ?, ?)',
    )
    .run(req.user!.id, cleanHandle, cleanPlatform, 'Active', req.user!.avatar_url || ASSETS.avatarMaya);

  const account = db
    .prepare('SELECT * FROM linked_accounts WHERE id = ?')
    .get(Number(result.lastInsertRowid));
  res.status(201).json({account, message: `${cleanHandle} added to Accounts Centre.`});
});

app.patch('/api/accounts-centre/linked/:id', requireAuth, (req: AuthedRequest, res: Response) => {
  const id = Number(req.params.id);
  const {status} = req.body as {status?: 'Active' | 'Deactivated'};
  const nextStatus = status === 'Deactivated' ? 'Deactivated' : 'Active';
  db.prepare('UPDATE linked_accounts SET status = ? WHERE id = ? AND user_id = ?').run(
    nextStatus,
    id,
    req.user!.id,
  );
  res.json({ok: true, status: nextStatus});
});

app.delete('/api/accounts-centre/linked/:id', requireAuth, (req: AuthedRequest, res: Response) => {
  db.prepare('DELETE FROM linked_accounts WHERE id = ? AND user_id = ?').run(
    Number(req.params.id),
    req.user!.id,
  );
  res.json({ok: true});
});

app.get('/api/security', requireAuth, (req: AuthedRequest, res: Response) => {
  const me = req.user!.id;
  const security = getOrCreateUserSecurity(me);

  // Seed one initial welcome security email if none exist yet for this user
  const emailCount = (
    db.prepare('SELECT COUNT(*) as count FROM security_emails WHERE user_id = ?').get(me) as {
      count: number;
    }
  ).count;
  if (emailCount === 0) {
    logSecurityEmail(
      me,
      'New login to Verve',
      `We noticed a sign-in from ${parseDeviceName(req)}. If this was you, no action is needed.`,
      'security',
    );
    logSecurityEmail(
      me,
      'Welcome to Verve Accounts Centre',
      'Manage your personal details, connected profiles, and password security in one place.',
      'other',
    );
  }

  const passkeys = db
    .prepare('SELECT * FROM user_passkeys WHERE user_id = ? ORDER BY created_at DESC')
    .all(me);

  const sessionRows = db
    .prepare(
      `SELECT rowid as id, token, device_name, ip_address, created_at, expires_at
       FROM sessions
       WHERE user_id = ? AND expires_at > datetime('now')
       ORDER BY created_at DESC`,
    )
    .all(me) as Array<{
    id: number;
    token: string;
    device_name: string;
    ip_address: string;
    created_at: string;
    expires_at: string;
  }>;

  const sessions = sessionRows.map((s) => ({
    id: s.id,
    device_name: s.device_name || 'Web Browser',
    ip_address: s.ip_address || 'Active session',
    created_at: s.created_at,
    is_current: s.token === req.token,
  }));

  const emails = db
    .prepare('SELECT * FROM security_emails WHERE user_id = ? ORDER BY created_at DESC LIMIT 30')
    .all(me);

  res.json({security, passkeys, sessions, emails});
});

app.put('/api/security', requireAuth, (req: AuthedRequest, res: Response) => {
  const me = req.user!.id;
  const current = getOrCreateUserSecurity(me);
  const body = req.body as Partial<typeof current>;

  const next2fa =
    typeof body.two_factor_enabled === 'boolean'
      ? body.two_factor_enabled
      : current.two_factor_enabled;
  const nextMethod =
    body.two_factor_method === 'sms' || body.two_factor_method === 'authenticator'
      ? body.two_factor_method
      : current.two_factor_method;
  const nextSavedLogin =
    typeof body.saved_login_enabled === 'boolean'
      ? body.saved_login_enabled
      : current.saved_login_enabled;
  const nextAdv =
    typeof body.advanced_protection === 'boolean'
      ? body.advanced_protection
      : current.advanced_protection;
  const nextInApp =
    typeof body.login_alerts_inapp === 'boolean'
      ? body.login_alerts_inapp
      : current.login_alerts_inapp;
  const nextEmailAlerts =
    typeof body.login_alerts_email === 'boolean'
      ? body.login_alerts_email
      : current.login_alerts_email;
  const nextE2ee =
    typeof body.e2ee_key_alerts === 'boolean' ? body.e2ee_key_alerts : current.e2ee_key_alerts;
  const nextStatus =
    body.account_status === 'deactivated' || body.account_status === 'active'
      ? body.account_status
      : current.account_status;

  // Turning on Advanced Protection automatically enforces 2FA & login alerts
  const effective2fa = nextAdv ? true : next2fa;
  const effectiveAlerts = nextAdv ? true : nextInApp;

  db.prepare(
    `UPDATE user_security
     SET two_factor_enabled = ?,
         two_factor_method = ?,
         saved_login_enabled = ?,
         advanced_protection = ?,
         login_alerts_inapp = ?,
         login_alerts_email = ?,
         e2ee_key_alerts = ?,
         account_status = ?,
         updated_at = datetime('now')
     WHERE user_id = ?`,
  ).run(
    effective2fa ? 1 : 0,
    nextMethod,
    nextSavedLogin ? 1 : 0,
    nextAdv ? 1 : 0,
    effectiveAlerts ? 1 : 0,
    nextEmailAlerts ? 1 : 0,
    nextE2ee ? 1 : 0,
    nextStatus,
    me,
  );

  if (effective2fa !== current.two_factor_enabled) {
    logSecurityEmail(
      me,
      effective2fa
        ? 'Two-factor authentication turned on'
        : 'Two-factor authentication turned off',
      effective2fa
        ? `Two-factor authentication (${nextMethod}) is now protecting your Verve account.`
        : 'Two-factor authentication was disabled in Password and security.',
      'security',
    );
  } else if (nextAdv !== current.advanced_protection) {
    logSecurityEmail(
      me,
      nextAdv ? 'Advanced Protection enabled' : 'Advanced Protection disabled',
      nextAdv
        ? 'Advanced Protection is active with two-factor authentication and real-time login alerts.'
        : 'Advanced Protection was turned off.',
      'security',
    );
  }

  res.json({
    security: getOrCreateUserSecurity(me),
    message: 'Security settings updated and saved.',
  });
});

app.post('/api/security/regenerate-codes', requireAuth, (req: AuthedRequest, res: Response) => {
  const codes = generateBackupCodes();
  getOrCreateUserSecurity(req.user!.id);
  db.prepare(
    "UPDATE user_security SET backup_codes = ?, updated_at = datetime('now') WHERE user_id = ?",
  ).run(JSON.stringify(codes), req.user!.id);
  res.json({backup_codes: codes, message: 'New recovery backup codes generated.'});
});

app.post('/api/security/passkeys', requireAuth, (req: AuthedRequest, res: Response) => {
  const {label} = req.body as {label?: string};
  const cleanLabel = (label || parseDeviceName(req)).trim().slice(0, 60);
  const credentialId = `pk_${crypto.randomBytes(12).toString('hex')}`;
  const result = db
    .prepare('INSERT INTO user_passkeys (user_id, label, credential_id) VALUES (?, ?, ?)')
    .run(req.user!.id, cleanLabel, credentialId);
  logSecurityEmail(
    req.user!.id,
    'New passkey added to your account',
    `Passkey "${cleanLabel}" was registered for passwordless sign-in.`,
    'security',
  );
  const passkey = db
    .prepare('SELECT * FROM user_passkeys WHERE id = ?')
    .get(Number(result.lastInsertRowid));
  res.status(201).json({passkey, message: `Passkey "${cleanLabel}" created.`});
});

app.delete('/api/security/passkeys/:id', requireAuth, (req: AuthedRequest, res: Response) => {
  db.prepare('DELETE FROM user_passkeys WHERE id = ? AND user_id = ?').run(
    Number(req.params.id),
    req.user!.id,
  );
  res.json({ok: true});
});

app.delete('/api/security/sessions/:id', requireAuth, (req: AuthedRequest, res: Response) => {
  const rowId = Number(req.params.id);
  db.prepare('DELETE FROM sessions WHERE rowid = ? AND user_id = ? AND token != ?').run(
    rowId,
    req.user!.id,
    req.token || '',
  );
  res.json({ok: true, message: 'Device logged out successfully.'});
});

app.post('/api/security/sessions/revoke-others', requireAuth, (req: AuthedRequest, res: Response) => {
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(
    req.user!.id,
    req.token || '',
  );
  logSecurityEmail(
    req.user!.id,
    'Logged out of all other sessions',
    'All other active devices were signed out from Password and security.',
    'security',
  );
  res.json({ok: true, message: 'Signed out of all other devices.'});
});

// JSON error handler for oversized uploads or malformed bodies on /api routes
app.use('/api', (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const e = err as {type?: string; status?: number; message?: string};
  if (e?.type === 'entity.too.large' || e?.status === 413) {
    res.status(413).json({error: 'File is too large. Please upload a smaller photo or video.'});
    return;
  }
  res.status(e?.status || 500).json({
    error: e?.message || 'Server error while processing your request.',
  });
});

// =======================
// VITE / STATIC SERVING
// =======================

async function startServer() {
  if (!IS_PROD) {
    const {createServer: createViteServer} = await import('vite');
    const vite = await createViteServer({
      server: {middlewareMode: true},
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Verve server running at http://localhost:${PORT}`);
  });
}

startServer();
