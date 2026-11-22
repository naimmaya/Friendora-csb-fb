import {deleteObject, getDownloadURL, ref, uploadBytes} from 'firebase/storage';
import {uploadMediaFile} from './api';
import {storage} from './firebase';
import {compressImageForFirestore} from './firestoreStore';

function sanitizeFileName(name: string): string {
  return (name || 'file')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 80);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read file data.'));
    reader.readAsDataURL(blob);
  });
}

export interface UploadedAttachment {
  url: string;
  name: string;
  size: number;
  storageBacked: boolean;
}

/**
 * Upload media (image, video, voice note, document) to Firebase Storage first.
 * Falls back cleanly to compressed Firestore-safe data URL or server upload if Storage
 * bucket permissions aren't enabled yet on the user's Firebase project, and throws a real
 * error if the file exceeds safe bounds (never fakes success).
 */
export async function uploadAttachmentReal(
  fileOrBlob: File | Blob,
  options: {
    folder: string;
    kind: 'image' | 'video' | 'voice' | 'document';
    fileName?: string;
  },
): Promise<UploadedAttachment> {
  const rawName =
    options.fileName || (fileOrBlob instanceof File ? fileOrBlob.name : `${options.kind}.bin`);
  const safeName = sanitizeFileName(rawName);
  const path = `${options.folder}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safeName}`;

  // 1. Primary path: Real Firebase Storage upload
  try {
    const storageRef = ref(storage, path);
    const snap = await uploadBytes(storageRef, fileOrBlob, {
      contentType: fileOrBlob.type || undefined,
    });
    const downloadUrl = await getDownloadURL(snap.ref);
    return {
      url: downloadUrl,
      name: rawName.slice(0, 180),
      size: fileOrBlob.size,
      storageBacked: true,
    };
  } catch {
    // Firebase Storage bucket may not be enabled or may block unconfigured rules — fall back gracefully
  }

  // 2. Fallback for images: compress into a permanent Firestore-safe JPEG data URL
  if (options.kind === 'image') {
    const file =
      fileOrBlob instanceof File
        ? fileOrBlob
        : new File([fileOrBlob], safeName || 'photo.jpg', {type: fileOrBlob.type || 'image/jpeg'});
    const dataUrl = await compressImageForFirestore(file, 'post');
    return {
      url: dataUrl,
      name: rawName.slice(0, 180),
      size: fileOrBlob.size,
      storageBacked: false,
    };
  }

  // 3. Fallback for voice notes & small documents: permanent Firestore-safe data URL (<= 600 KB encoded)
  if (options.kind === 'voice' || options.kind === 'document') {
    if (fileOrBlob.size <= 440 * 1024) {
      const dataUrl = await blobToDataUrl(fileOrBlob);
      if (dataUrl.length <= 630000) {
        return {
          url: dataUrl,
          name: rawName.slice(0, 180),
          size: fileOrBlob.size,
          storageBacked: false,
        };
      }
    }
  }

  // 4. Fallback for larger videos/documents: backend upload endpoint
  if (fileOrBlob instanceof File) {
    try {
      const uploaded = await uploadMediaFile(fileOrBlob);
      return {
        url: uploaded.url,
        name: rawName.slice(0, 180),
        size: fileOrBlob.size,
        storageBacked: false,
      };
    } catch {
      // Fall through to explicit error
    }
  }

  throw new Error(
    options.kind === 'voice'
      ? 'Voice clip is too large without Firebase Storage enabled. Keep clips under 30 seconds or enable Firebase Storage.'
      : options.kind === 'document'
        ? 'Document exceeds 420 KB direct Firestore limit. Enable Firebase Storage for larger files.'
        : 'Video upload failed. Try a smaller MP4/WEBM file or enable Firebase Storage.',
  );
}

/**
 * Delete a media object from Firebase Storage if the URL points to Firebase Storage.
 * Safe no-op for non-Storage URLs or already-deleted objects.
 */
export async function deleteFirebaseStorageUrlIfApplicable(url: string | null | undefined): Promise<void> {
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
