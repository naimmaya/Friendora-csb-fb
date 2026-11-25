import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import {
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytesResumable,
  type UploadTask,
} from 'firebase/storage';
import {getAuthToken} from './api';
import {auth, db, storage} from './firebase';
import {compressImageForFirestore} from './firestoreStore';

export const MAX_VIDEO_BYTES = 100 * 1024 * 1024; // 100 MB
export const MAX_VIDEO_DURATION_SEC = 60; // 60 seconds

// Temporarily back off Firebase Storage if bucket is unconfigured/unreachable
// so uploads fail over quickly without permanently locking out retries.
let firebaseStorageBackoffUntil = 0;

function sanitizeFileName(name: string): string {
  return (name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read file data.'));
    reader.readAsDataURL(blob);
  });
}

function inferMimeType(fileOrBlob: File | Blob, kind: 'image' | 'video' | 'voice' | 'document'): string {
  const rawType = (fileOrBlob.type || '').split(';')[0].trim().toLowerCase();
  if (rawType && rawType !== 'application/octet-stream') return rawType;

  const lowerName = (fileOrBlob instanceof File ? fileOrBlob.name : '').toLowerCase();
  if (kind === 'image') {
    if (lowerName.endsWith('.png')) return 'image/png';
    if (lowerName.endsWith('.webp')) return 'image/webp';
    if (lowerName.endsWith('.gif')) return 'image/gif';
    return 'image/jpeg';
  }
  if (kind === 'video') {
    if (lowerName.endsWith('.webm')) return 'video/webm';
    if (lowerName.endsWith('.mov')) return 'video/quicktime';
    if (lowerName.endsWith('.ogv') || lowerName.endsWith('.ogg')) return 'video/ogg';
    if (lowerName.endsWith('.3gp')) return 'video/3gpp';
    if (lowerName.endsWith('.m4v')) return 'video/x-m4v';
    return 'video/mp4';
  }
  if (kind === 'voice') {
    if (lowerName.endsWith('.m4a') || lowerName.endsWith('.mp4')) return 'audio/mp4';
    if (lowerName.endsWith('.mp3')) return 'audio/mpeg';
    if (lowerName.endsWith('.ogg')) return 'audio/ogg';
    if (lowerName.endsWith('.wav')) return 'audio/wav';
    return 'audio/webm';
  }
  if (lowerName.endsWith('.pdf')) return 'application/pdf';
  if (lowerName.endsWith('.txt')) return 'text/plain';
  if (lowerName.endsWith('.csv')) return 'text/csv';
  if (lowerName.endsWith('.zip')) return 'application/zip';
  return 'application/octet-stream';
}

/**
 * Compress image to max 1080px on the longest side at 80% JPEG quality
 * so chat photos & post photos upload rapidly on mobile without ever hanging.
 */
export async function compressImageToJpeg(
  fileOrBlob: File | Blob,
  maxDimension = 1080,
  quality = 0.8,
): Promise<Blob> {
  const mime = (fileOrBlob.type || '').toLowerCase();
  if (mime === 'image/gif') {
    return fileOrBlob;
  }

  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(fileOrBlob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const origW = img.naturalWidth || img.width || 1;
      const origH = img.naturalHeight || img.height || 1;
      const scale = Math.min(1, maxDimension / Math.max(origW, origH));
      const targetW = Math.max(1, Math.round(origW * scale));
      const targetH = Math.max(1, Math.round(origH * scale));

      const canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(fileOrBlob);
        return;
      }
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, targetW, targetH);
      ctx.drawImage(img, 0, 0, targetW, targetH);
      canvas.toBlob(
        (blob) => {
          resolve(blob && blob.size > 0 ? blob : fileOrBlob);
        },
        'image/jpeg',
        quality,
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(fileOrBlob);
    };
    img.src = objectUrl;
  });
}

export interface VideoMetadataResult {
  durationSec: number;
  width: number;
  height: number;
  thumbnailDataUrl: string | null;
}

/**
 * Read real video duration, dimensions, and generate a crisp JPEG thumbnail frame
 * right after the user picks a video file.
 */
export async function extractVideoMetadata(file: File | Blob): Promise<VideoMetadataResult> {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = 'anonymous';

    let settled = false;
    const finish = (result: VideoMetadataResult) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      URL.revokeObjectURL(objectUrl);
      video.removeAttribute('src');
      video.load();
      resolve(result);
    };

    const timeoutId = window.setTimeout(() => {
      finish({
        durationSec: Number.isFinite(video.duration) ? Math.round(video.duration) : 0,
        width: video.videoWidth || 0,
        height: video.videoHeight || 0,
        thumbnailDataUrl: null,
      });
    }, 6000);

    let frameCaptured = false;
    const captureFrame = () => {
      if (frameCaptured) return;
      frameCaptured = true;
      const durationSec = Number.isFinite(video.duration) ? Math.round(video.duration) : 0;
      const w = video.videoWidth || 640;
      const h = video.videoHeight || 360;
      let thumbnailDataUrl: string | null = null;
      try {
        const scale = Math.min(1, 640 / Math.max(w, h));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(w * scale));
        canvas.height = Math.max(1, Math.round(h * scale));
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          let candidate = canvas.toDataURL('image/jpeg', 0.72);
          if (candidate.length > 160000) {
            candidate = canvas.toDataURL('image/jpeg', 0.52);
          }
          if (candidate.length <= 240000) {
            thumbnailDataUrl = candidate;
          }
        }
      } catch {
        thumbnailDataUrl = null;
      }
      finish({durationSec, width: w, height: h, thumbnailDataUrl});
    };

    video.onloadedmetadata = () => {
      // Capture the 1-second frame (or midpoint for sub-1s clips)
      const targetTime =
        Number.isFinite(video.duration) && video.duration >= 1.1
          ? 1.0
          : Number.isFinite(video.duration) && video.duration > 0.2
            ? Math.min(0.5, video.duration * 0.5)
            : 0;
      if (targetTime <= 0) {
        if (video.readyState >= 2) {
          captureFrame();
        }
        return;
      }
      try {
        video.currentTime = targetTime;
      } catch {
        captureFrame();
      }
    };

    video.onseeked = () => {
      captureFrame();
    };

    video.onloadeddata = () => {
      if (video.currentTime === 0 && (!Number.isFinite(video.duration) || video.duration <= 0.2)) {
        captureFrame();
      }
    };

    video.onerror = () => {
      finish({durationSec: 0, width: 0, height: 0, thumbnailDataUrl: null});
    };

    video.src = objectUrl;
  });
}

function uploadToFirebaseStorageWithStallGuard(
  blob: Blob,
  storagePath: string,
  contentType: string,
  onProgress?: (percent: number) => void,
  stallTimeoutMs = 6000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const storageRef = ref(storage, storagePath);
    let task: UploadTask;
    try {
      task = uploadBytesResumable(storageRef, blob, {contentType});
    } catch (err) {
      reject(err);
      return;
    }

    let settled = false;
    let lastBytes = 0;

    // Stall guard: if 0 bytes transfer within stallTimeoutMs (bucket disabled / CORS blocked),
    // cancel cleanly instead of waiting for Firebase's default 10-minute retry loop.
    const stallTimer = window.setTimeout(() => {
      if (!settled && lastBytes === 0) {
        settled = true;
        firebaseStorageBackoffUntil = Date.now() + 30_000;
        try {
          task.cancel();
        } catch {
          // Ignore cancel error
        }
        reject(new Error('Firebase Storage did not respond.'));
      }
    }, stallTimeoutMs);

    task.on(
      'state_changed',
      (snap) => {
        if (settled) return;
        if (snap.bytesTransferred > 0) {
          lastBytes = snap.bytesTransferred;
        }
        if (snap.totalBytes > 0 && onProgress) {
          const pct = Math.min(99, Math.round((snap.bytesTransferred / snap.totalBytes) * 100));
          onProgress(pct);
        }
      },
      (err) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(stallTimer);
        const code = (err as {code?: string})?.code || '';
        if (
          code === 'storage/unauthorized' ||
          code === 'storage/bucket-not-found' ||
          code === 'storage/project-not-found'
        ) {
          firebaseStorageBackoffUntil = Date.now() + 5 * 60_000;
        } else if (code === 'storage/unknown' || code === 'storage/retry-limit-exceeded') {
          firebaseStorageBackoffUntil = Date.now() + 30_000;
        }
        reject(err);
      },
      async () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(stallTimer);
        try {
          const url = await getDownloadURL(task.snapshot.ref);
          onProgress?.(100);
          resolve(url);
        } catch (err) {
          reject(err);
        }
      },
    );
  });
}

async function uploadToServerWithProgress(
  blob: Blob,
  mime: string,
  folder: string,
  onProgress?: (percent: number) => void,
): Promise<string> {
  let token = '';
  try {
    token = (await auth.currentUser?.getIdToken()) || getAuthToken() || '';
  } catch {
    token = getAuthToken() || '';
  }

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload/media', true);
    xhr.timeout = 180000; // 3 minutes max for 100MB video over mobile

    xhr.setRequestHeader('Content-Type', mime || 'application/octet-stream');
    xhr.setRequestHeader('X-File-Mime', mime || 'application/octet-stream');
    if (folder) {
      xhr.setRequestHeader('X-Upload-Folder', folder);
    }
    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    }

    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable && ev.total > 0 && onProgress) {
        const pct = Math.min(99, Math.round((ev.loaded / ev.total) * 100));
        onProgress(pct);
      }
    };

    xhr.onload = () => {
      const ct = (xhr.getResponseHeader('content-type') || '').toLowerCase();
      if (xhr.status >= 200 && xhr.status < 300 && ct.includes('application/json')) {
        try {
          const data = JSON.parse(xhr.responseText) as {url?: string; error?: string};
          if (data.url) {
            onProgress?.(100);
            resolve(data.url);
            return;
          }
        } catch {
          // Fall through
        }
      }
      let message = `Upload failed (HTTP ${xhr.status}).`;
      if (ct.includes('application/json')) {
        try {
          const parsed = JSON.parse(xhr.responseText) as {error?: string};
          if (parsed.error) message = parsed.error;
        } catch {
          // Ignore
        }
      }
      reject(new Error(message));
    };

    xhr.onerror = () => {
      reject(new Error('Network error while uploading media.'));
    };
    xhr.ontimeout = () => {
      reject(new Error('Upload timed out. Please check your connection and tap Retry.'));
    };

    xhr.send(blob);
  });
}

export interface UploadedAttachment {
  url: string;
  name: string;
  size: number;
  storageBacked: boolean;
}

/**
 * Upload media (image, video, voice note, document) reliably with real 0%-100% progress.
 * - Images are always compressed first (max 1080px, 80% quality JPEG) so they never stall.
 * - Tries Firebase Storage first with a 3.5s stall guard (never hangs 10 minutes).
 * - Immediately fails over to authenticated `/api/upload/media` streaming upload with real progress.
 * - Final permanent Firestore data-URL fallback for compressed images and short voice clips if static-hosted.
 */
export async function uploadAttachmentReal(
  fileOrBlob: File | Blob,
  options: {
    folder: string;
    kind: 'image' | 'video' | 'voice' | 'document';
    fileName?: string;
    exactStoragePath?: string;
    onProgress?: (percent: number) => void;
  },
): Promise<UploadedAttachment> {
  const {folder, kind, exactStoragePath, onProgress} = options;
  const rawName =
    options.fileName ||
    (fileOrBlob instanceof File
      ? fileOrBlob.name
      : kind === 'image'
        ? `${Date.now()}.jpg`
        : kind === 'voice'
          ? `${Date.now()}.m4a`
          : kind === 'video'
            ? `${Date.now()}.mp4`
            : `${Date.now()}.bin`);

  if (kind === 'video' && fileOrBlob.size > MAX_VIDEO_BYTES) {
    throw new Error('Video too large (max 100MB / 60 sec).');
  }

  onProgress?.(2);

  // Compress photos right away (max 1080px, 80% quality) so uploads are fast & never hang
  let preparedBlob: Blob = fileOrBlob;
  let mime = inferMimeType(fileOrBlob, kind);
  let safeName = sanitizeFileName(rawName);

  if (kind === 'image') {
    preparedBlob = await compressImageToJpeg(fileOrBlob, 1080, 0.8);
    mime = preparedBlob.type || 'image/jpeg';
    if (!safeName.toLowerCase().endsWith('.jpg') && mime === 'image/jpeg') {
      safeName = `${safeName.replace(/\.[^.]+$/, '') || Date.now()}.jpg`;
    }
    onProgress?.(12);
  }

  const cleanFolder = folder.replace(/^\/+|\/+$/g, '') || 'media';
  const storagePath = exactStoragePath
    ? exactStoragePath.replace(/^\/+/, '')
    : `${cleanFolder}/${Date.now()}_${safeName}`;

  // 1. Primary path: Real Firebase Storage resumable upload (posts/{postId}/video.mp4)
  if (Date.now() >= firebaseStorageBackoffUntil) {
    try {
      const downloadUrl = await uploadToFirebaseStorageWithStallGuard(
        preparedBlob,
        storagePath,
        mime,
        onProgress,
        kind === 'video' ? 10000 : 5000,
      );
      if (downloadUrl && downloadUrl.trim()) {
        firebaseStorageBackoffUntil = 0;
        return {
          url: downloadUrl,
          name: rawName.slice(0, 180),
          size: preparedBlob.size,
          storageBacked: true,
        };
      }
    } catch {
      // Fail over cleanly below without hanging
    }
  }

  // 2. Real Express server binary streaming upload (supports up to 100MB videos, voice, docs, photos)
  try {
    const serverUrl = await uploadToServerWithProgress(
      preparedBlob,
      mime,
      cleanFolder,
      onProgress,
    );
    return {
      url: serverUrl,
      name: rawName.slice(0, 180),
      size: preparedBlob.size,
      storageBacked: false,
    };
  } catch (serverErr) {
    // 3. Permanent Firestore-safe fallback for images (compressed <= 450KB JPEG data URL)
    if (kind === 'image') {
      try {
        const imgFile =
          preparedBlob instanceof File
            ? preparedBlob
            : new File([preparedBlob], safeName || 'photo.jpg', {type: mime || 'image/jpeg'});
        const dataUrl = await compressImageForFirestore(imgFile, 'post');
        onProgress?.(100);
        return {
          url: dataUrl,
          name: rawName.slice(0, 180),
          size: preparedBlob.size,
          storageBacked: false,
        };
      } catch {
        // Fall through to throw error
      }
    }

    // 4. Permanent Firestore-safe fallback for short voice notes & small documents
    if ((kind === 'voice' || kind === 'document') && preparedBlob.size <= 440 * 1024) {
      try {
        const dataUrl = await blobToDataUrl(preparedBlob);
        if (dataUrl.length <= 630000) {
          onProgress?.(100);
          return {
            url: dataUrl,
            name: rawName.slice(0, 180),
            size: preparedBlob.size,
            storageBacked: false,
          };
        }
      } catch {
        // Fall through to throw error
      }
    }

    const detail =
      serverErr instanceof Error && serverErr.message
        ? serverErr.message
        : kind === 'video'
          ? 'Video upload failed. Tap Retry to try again.'
          : kind === 'voice'
            ? 'Voice upload failed. Tap Retry to try again.'
            : 'Upload failed. Tap Retry to try again.';
    throw new Error(detail);
  }
}

/**
 * Delete a media object from Firebase Storage if the URL points to Firebase Storage.
 * Safe no-op for non-Storage URLs or already-deleted objects.
 */
/**
 * Re-fetch a fresh downloadURL from Firebase Storage if a stored video URL is a Storage URL or gs:// path.
 */
export async function refreshFirebaseStorageUrl(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  const isStorageUrl =
    url.startsWith('https://firebasestorage.googleapis.com/') ||
    url.startsWith('https://storage.googleapis.com/') ||
    url.startsWith('gs://');
  if (!isStorageUrl) return null;
  try {
    const fileRef = ref(storage, url);
    const fresh = await getDownloadURL(fileRef);
    return fresh || null;
  } catch {
    return null;
  }
}

/**
 * Look up a post's video file at posts/{postId}/video.mp4 in Firebase Storage
 * to recover playback for older posts if needed.
 */
export async function getPostVideoStorageUrl(postId: string | null | undefined): Promise<string | null> {
  if (!postId || !/^[a-zA-Z0-9_-]{1,128}$/.test(postId)) return null;
  try {
    const fileRef = ref(storage, `posts/${postId}/video.mp4`);
    const fresh = await getDownloadURL(fileRef);
    return fresh || null;
  } catch {
    return null;
  }
}

export async function deleteFirebaseStorageUrlIfApplicable(
  url: string | null | undefined,
): Promise<void> {
  if (!url) return;
  if (url.startsWith('fsvideo://')) {
    const mediaId = url.slice('fsvideo://'.length).trim();
    if (mediaId && /^[a-zA-Z0-9_-]{1,128}$/.test(mediaId)) {
      try {
        const chunksSnap = await getDocs(
          query(collection(db, 'videoMedia', mediaId, 'chunks'), where('mediaId', '==', mediaId)),
        );
        await Promise.all(chunksSnap.docs.map((d) => deleteDoc(d.ref).catch(() => {})));
        await deleteDoc(doc(db, 'videoMedia', mediaId)).catch(() => {});
      } catch {
        // Ignore cleanup errors
      }
    }
    return;
  }
  const isFirebaseStorageUrl =
    url.startsWith('https://firebasestorage.googleapis.com/') ||
    url.startsWith('https://storage.googleapis.com/') ||
    url.startsWith('gs://');
  if (!isFirebaseStorageUrl) return;
  try {
    const fileRef = ref(storage, url);
    await deleteObject(fileRef);
  } catch {
    // Object may already be removed or bucket not enabled
  }
}

// ==========================================
// PERMANENT CLOUD VIDEO STORAGE + CACHE
// ==========================================

const VIDEO_CACHE_DB = 'verve_video_cache_v1';
const VIDEO_CACHE_STORE = 'videos';
const FIRESTORE_VIDEO_CHUNK_BYTES = 500 * 1024; // 500 KB raw -> ~667 KB base64 (safely < 750 KB rule cap)
const FIRESTORE_VIDEO_MAX_BYTES = 50 * 1024 * 1024; // 50 MB max per rules

const memoryVideoObjectUrls = new Map<string, string>();
const inflightVideoResolves = new Map<string, Promise<string | null>>();

function openVideoCacheDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(VIDEO_CACHE_DB, 1);
      req.onupgradeneeded = () => {
        const idb = req.result;
        if (!idb.objectStoreNames.contains(VIDEO_CACHE_STORE)) {
          idb.createObjectStore(VIDEO_CACHE_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function cacheVideoBlobLocally(cacheKey: string, blob: Blob): Promise<string> {
  const existingObjUrl = memoryVideoObjectUrls.get(cacheKey);
  if (existingObjUrl) return existingObjUrl;
  const objUrl = URL.createObjectURL(blob);
  memoryVideoObjectUrls.set(cacheKey, objUrl);
  try {
    const idb = await openVideoCacheDb();
    if (idb) {
      await new Promise<void>((resolve) => {
        const tx = idb.transaction(VIDEO_CACHE_STORE, 'readwrite');
        tx.objectStore(VIDEO_CACHE_STORE).put(blob, cacheKey);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    }
  } catch {
    // Memory cache still works even if IndexedDB quota is full
  }
  return objUrl;
}

async function readCachedVideoBlob(cacheKey: string): Promise<Blob | null> {
  try {
    const idb = await openVideoCacheDb();
    if (!idb) return null;
    return await new Promise<Blob | null>((resolve) => {
      const tx = idb.transaction(VIDEO_CACHE_STORE, 'readonly');
      const req = tx.objectStore(VIDEO_CACHE_STORE).get(cacheKey);
      req.onsuccess = () => resolve(req.result instanceof Blob ? req.result : null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    const slice = bytes.subarray(i, Math.min(i + step, bytes.length));
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

function base64ToUint8(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const len = binary.length;
  const buffer = new ArrayBuffer(len);
  const out = new Uint8Array(buffer);
  for (let i = 0; i < len; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

async function uploadVideoToFirestoreCloud(
  blob: Blob,
  opts: {
    mediaId: string;
    mimeType: string;
    durationSec: number;
    onProgress?: (percent: number) => void;
  },
): Promise<string> {
  const uid = auth.currentUser?.uid;
  if (!uid) {
    throw new Error('Please sign in to upload videos.');
  }
  if (blob.size <= 0) {
    throw new Error('Selected video file is empty.');
  }
  if (blob.size > FIRESTORE_VIDEO_MAX_BYTES) {
    throw new Error('Video must be 50 MB or smaller.');
  }

  const safeMime = /^video\/[a-zA-Z0-9.+-]+$/.test(opts.mimeType) ? opts.mimeType : 'video/mp4';
  const totalBytes = blob.size;
  const totalChunks = Math.ceil(totalBytes / FIRESTORE_VIDEO_CHUNK_BYTES);
  if (totalChunks > 120) {
    throw new Error('Video is too large. Please choose a shorter or smaller clip (max 50 MB).');
  }

  const mediaId = opts.mediaId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128) || `vid_${Date.now()}`;
  const safeDuration = Math.max(0, Math.min(3600, Math.round(opts.durationSec || 0)));

  opts.onProgress?.(4);

  // 1. Write manifest doc first so chunk security rules can verify ownership
  await setDoc(doc(db, 'videoMedia', mediaId), {
    id: mediaId,
    authorUid: uid,
    mimeType: safeMime,
    totalBytes,
    totalChunks,
    durationSec: safeDuration,
    visibility: 'public',
    createdAt: serverTimestamp(),
  });

  // 2. Upload all binary chunks with real 0% - 100% progress
  const buffer = await blob.arrayBuffer();
  const fullBytes = new Uint8Array(buffer);
  let uploadedCount = 0;

  // Upload in small parallel batches of 3 for fast mobile uploads without saturating Firestore
  const BATCH_SIZE = 3;
  for (let start = 0; start < totalChunks; start += BATCH_SIZE) {
    const batchPromises: Promise<void>[] = [];
    const end = Math.min(totalChunks, start + BATCH_SIZE);
    for (let idx = start; idx < end; idx++) {
      const byteStart = idx * FIRESTORE_VIDEO_CHUNK_BYTES;
      const byteEnd = Math.min(totalBytes, byteStart + FIRESTORE_VIDEO_CHUNK_BYTES);
      const chunkBytes = fullBytes.subarray(byteStart, byteEnd);
      const chunkId = `c_${idx}`;
      const b64 = uint8ToBase64(chunkBytes);
      batchPromises.push(
        setDoc(doc(db, 'videoMedia', mediaId, 'chunks', chunkId), {
          id: chunkId,
          mediaId,
          authorUid: uid,
          index: idx,
          data: b64,
          createdAt: serverTimestamp(),
        }).then(() => {
          uploadedCount += 1;
          const pct = Math.min(99, Math.max(6, Math.round((uploadedCount / totalChunks) * 96) + 3));
          opts.onProgress?.(pct);
        }),
      );
    }
    await Promise.all(batchPromises);
  }

  const permanentUrl = `fsvideo://${mediaId}`;
  await cacheVideoBlobLocally(permanentUrl, blob);
  opts.onProgress?.(100);
  return permanentUrl;
}

/**
 * Upload a Post video 100% permanently to the cloud:
 * 1) Primary: Firebase Storage at `posts/{postId}/video.mp4` -> returns real Firebase downloadURL
 * 2) Permanent Cloud Fallback: Cloud Firestore `videoMedia/{postId}` chunks -> returns `fsvideo://{postId}`
 *    (never relies on ephemeral local server disk `/uploads/...`, so it works across all devices,
 *     Shared App URL, and restarts without ever showing "Tap to retry").
 */
export async function uploadPostVideoPermanent(
  file: File | Blob,
  options: {
    postId: string;
    durationSec: number;
    onProgress?: (percent: number) => void;
  },
): Promise<UploadedAttachment> {
  const {postId, durationSec, onProgress} = options;
  if (file.size > MAX_VIDEO_BYTES) {
    throw new Error('Video too large (max 100MB / 60 sec).');
  }

  const mime = inferMimeType(file, 'video');
  const rawName = file instanceof File ? file.name : 'video.mp4';
  const storagePath = `posts/${postId}/video.mp4`;
  onProgress?.(2);

  // 1. Primary path: Real Firebase Storage upload -> Firebase downloadURL
  if (Date.now() >= firebaseStorageBackoffUntil) {
    try {
      const downloadUrl = await uploadToFirebaseStorageWithStallGuard(
        file,
        storagePath,
        mime,
        onProgress,
        6000,
      );
      if (downloadUrl && downloadUrl.trim()) {
        firebaseStorageBackoffUntil = 0;
        await cacheVideoBlobLocally(downloadUrl.trim(), file);
        return {
          url: downloadUrl.trim(),
          name: rawName.slice(0, 180),
          size: file.size,
          storageBacked: true,
        };
      }
    } catch {
      // Fall through cleanly to permanent Cloud Firestore video storage
    }
  }

  // 2. Permanent Cloud Firestore storage (works everywhere including Shared App URL & restarts)
  const fsVideoUrl = await uploadVideoToFirestoreCloud(file, {
    mediaId: postId,
    mimeType: mime,
    durationSec,
    onProgress,
  });

  return {
    url: fsVideoUrl,
    name: rawName.slice(0, 180),
    size: file.size,
    storageBacked: false,
  };
}

/**
 * Resolve any video URL to a directly playable URL for `<video src={...}>`:
 * - `https://...` (Firebase Storage downloadURL): returns directly
 * - `fsvideo://{mediaId}`: loads from local IndexedDB cache or Firestore `videoMedia/{mediaId}/chunks`
 *   and returns a playable `blob:` URL (cached locally so subsequent plays use 0 Firestore reads).
 */
export async function resolveCloudVideoUrl(src: string | null | undefined): Promise<string | null> {
  if (!src || !src.trim()) return null;
  const trimmed = src.trim();
  if (!trimmed.startsWith('fsvideo://')) {
    return trimmed;
  }

  const existingMemory = memoryVideoObjectUrls.get(trimmed);
  if (existingMemory) return existingMemory;

  const existingInflight = inflightVideoResolves.get(trimmed);
  if (existingInflight) return existingInflight;

  const task = (async (): Promise<string | null> => {
    // 1. Check local IndexedDB cache first (instant, 0 Firestore reads)
    const cachedBlob = await readCachedVideoBlob(trimmed);
    if (cachedBlob && cachedBlob.size > 0) {
      return await cacheVideoBlobLocally(trimmed, cachedBlob);
    }

    // 2. Fetch permanent chunks from Cloud Firestore
    const mediaId = trimmed.slice('fsvideo://'.length).trim();
    if (!mediaId || !/^[a-zA-Z0-9_-]{1,128}$/.test(mediaId)) return null;

    try {
      const manifestSnap = await getDoc(doc(db, 'videoMedia', mediaId));
      if (!manifestSnap.exists()) return null;
      const manifest = manifestSnap.data();
      const mimeType =
        typeof manifest.mimeType === 'string' && manifest.mimeType.startsWith('video/')
          ? manifest.mimeType
          : 'video/mp4';

      const chunksSnap = await getDocs(
        query(collection(db, 'videoMedia', mediaId, 'chunks'), where('mediaId', '==', mediaId)),
      );
      if (chunksSnap.empty) return null;

      const ordered = chunksSnap.docs
        .map((d) => d.data() as {index?: number; data?: string})
        .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

      const parts: BlobPart[] = [];
      for (const chunk of ordered) {
        if (typeof chunk.data === 'string' && chunk.data.length > 0) {
          parts.push(base64ToUint8(chunk.data));
        }
      }
      if (parts.length === 0) return null;

      const assembledBlob = new Blob(parts, {type: mimeType});
      return await cacheVideoBlobLocally(trimmed, assembledBlob);
    } catch {
      return null;
    }
  })();

  inflightVideoResolves.set(trimmed, task);
  try {
    return await task;
  } finally {
    inflightVideoResolves.delete(trimmed);
  }
}

export function formatFileSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatMediaDuration(sec: number): string {
  const safe = Math.max(0, Math.round(sec || 0));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
