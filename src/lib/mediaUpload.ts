import {
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytesResumable,
  type UploadTask,
} from 'firebase/storage';
import {getAuthToken} from './api';
import {auth, storage} from './firebase';
import {compressImageForFirestore} from './firestoreStore';

export const MAX_VIDEO_BYTES = 100 * 1024 * 1024; // 100 MB
export const MAX_VIDEO_DURATION_SEC = 60; // 60 seconds

// Remember when Firebase Storage bucket is unavailable/unconfigured in this session
// so subsequent uploads fail over instantaneously instead of waiting on every file.
let firebaseStorageUnavailable = false;

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
    video.preload = 'metadata';
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

    const captureFrame = () => {
      const durationSec = Number.isFinite(video.duration) ? Math.round(video.duration) : 0;
      const w = video.videoWidth || 640;
      const h = video.videoHeight || 360;
      let thumbnailDataUrl: string | null = null;
      try {
        const scale = Math.min(1, 720 / Math.max(w, h));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(w * scale));
        canvas.height = Math.max(1, Math.round(h * scale));
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const candidate = canvas.toDataURL('image/jpeg', 0.72);
          if (candidate.length <= 350000) {
            thumbnailDataUrl = candidate;
          }
        }
      } catch {
        thumbnailDataUrl = null;
      }
      finish({durationSec, width: w, height: h, thumbnailDataUrl});
    };

    video.onloadedmetadata = () => {
      const targetTime =
        Number.isFinite(video.duration) && video.duration > 0.6 ? 0.5 : 0;
      try {
        video.currentTime = targetTime;
      } catch {
        captureFrame();
      }
    };

    video.onseeked = () => {
      captureFrame();
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

    // Fast stall guard: if 0 bytes transfer within 3.5 seconds (bucket disabled / CORS blocked),
    // cancel immediately instead of waiting for Firebase's default 10-minute retry loop!
    const stallTimer = window.setTimeout(() => {
      if (!settled && lastBytes === 0) {
        settled = true;
        firebaseStorageUnavailable = true;
        try {
          task.cancel();
        } catch {
          // Ignore cancel error
        }
        reject(new Error('Firebase Storage did not respond.'));
      }
    }, 3500);

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
          code === 'storage/project-not-found' ||
          code === 'storage/unknown' ||
          code === 'storage/retry-limit-exceeded'
        ) {
          firebaseStorageUnavailable = true;
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
    onProgress?: (percent: number) => void;
  },
): Promise<UploadedAttachment> {
  const {folder, kind, onProgress} = options;
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
  const storagePath = `${cleanFolder}/${Date.now()}_${safeName}`;

  // 1. Primary path: Real Firebase Storage resumable upload (with 3.5s stall guard)
  if (!firebaseStorageUnavailable) {
    try {
      const downloadUrl = await uploadToFirebaseStorageWithStallGuard(
        preparedBlob,
        storagePath,
        mime,
        onProgress,
      );
      return {
        url: downloadUrl,
        name: rawName.slice(0, 180),
        size: preparedBlob.size,
        storageBacked: true,
      };
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
export async function deleteFirebaseStorageUrlIfApplicable(
  url: string | null | undefined,
): Promise<void> {
  if (!url) return;
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
