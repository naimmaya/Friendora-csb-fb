import {handleLocalFallbackRequest, saveLocalMediaBlob} from './localFallback';

const TOKEN_KEY = 'verve_auth_token';

// Track whether the backend server is unavailable (e.g., static Vercel deployment)
let useLocalFallback = false;

export function isUsingLocalFallback(): boolean {
  return useLocalFallback;
}

export function getAuthToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setAuthToken(token: string | null) {
  try {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  } catch {
    // Ignore storage errors
  }
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getAuthToken();

  // If this token was created in local fallback mode or server is already known unavailable
  if (useLocalFallback || (token && token.startsWith('local_'))) {
    return handleLocalFallbackRequest<T>(path, options, token);
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(path, {
      ...options,
      headers,
    });
  } catch {
    // Network unreachable — fall back seamlessly to local store
    useLocalFallback = true;
    return handleLocalFallbackRequest<T>(path, options, token);
  }

  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  const isJson = contentType.includes('application/json');

  // If the server returned non-JSON on an /api/* route (for example, Vercel static hosting
  // returning an HTML 404/405 page or index.html SPA fallback), transparently switch to local mode.
  if (!isJson && (res.status === 404 || res.status === 405 || res.status === 502 || res.status === 503 || res.ok)) {
    useLocalFallback = true;
    return handleLocalFallbackRequest<T>(path, options, token);
  }

  const data = isJson ? await res.json().catch(() => ({})) : {};
  if (!res.ok) {
    throw new Error((data as {error?: string}).error || 'Request failed. Please try again.');
  }
  return data as T;
}

// Optimize large mobile camera photos cleanly before uploading
async function compressImageIfNeeded(file: File): Promise<{blob: Blob; mime: string}> {
  const mime = file.type || 'image/jpeg';
  // Keep animated GIFs or small images untouched
  if (mime === 'image/gif' || file.size <= 1.2 * 1024 * 1024) {
    return {blob: file, mime};
  }

  try {
    const objectUrl = URL.createObjectURL(file);
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Decode failed'));
      el.src = objectUrl;
    });
    URL.revokeObjectURL(objectUrl);

    const maxDim = 1920;
    let {width, height} = img;
    if (width > maxDim || height > maxDim) {
      const ratio = Math.min(maxDim / width, maxDim / height);
      width = Math.round(width * ratio);
      height = Math.round(height * ratio);
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return {blob: file, mime};
    ctx.drawImage(img, 0, 0, width, height);

    const outBlob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.85),
    );
    if (outBlob && outBlob.size > 0 && outBlob.size < file.size) {
      return {blob: outBlob, mime: 'image/jpeg'};
    }
  } catch {
    // Fall back to original file
  }
  return {blob: file, mime};
}

export async function uploadMediaFile(
  file: File,
): Promise<{url: string; mediaType: 'image' | 'video'}> {
  const lowerName = file.name.toLowerCase();
  const isImage =
    file.type.startsWith('image/') ||
    /\.(jpg|jpeg|png|webp|gif|avif|bmp|heic|heif)$/i.test(lowerName);
  const isVideo =
    file.type.startsWith('video/') ||
    /\.(mp4|webm|mov|m4v|ogv|ogg|3gp)$/i.test(lowerName);

  if (!isImage && !isVideo) {
    throw new Error('Please choose a photo (JPG, PNG, WEBP, GIF) or video (MP4, WEBM, MOV).');
  }

  if (isImage && file.size > 20 * 1024 * 1024) {
    throw new Error('Photo must be smaller than 20 MB.');
  }
  if (isVideo && file.size > 58 * 1024 * 1024) {
    throw new Error('Video must be smaller than 58 MB.');
  }

  let uploadBlob: Blob = file;
  let mime = file.type;

  if (isImage) {
    const optimized = await compressImageIfNeeded(file);
    uploadBlob = optimized.blob;
    mime = optimized.mime || 'image/jpeg';
  } else {
    if (!mime) {
      if (lowerName.endsWith('.webm')) mime = 'video/webm';
      else if (lowerName.endsWith('.mov')) mime = 'video/quicktime';
      else if (lowerName.endsWith('.ogv') || lowerName.endsWith('.ogg')) mime = 'video/ogg';
      else if (lowerName.endsWith('.3gp')) mime = 'video/3gpp';
      else mime = 'video/mp4';
    }
  }

  const token = getAuthToken();

  // Local fallback mode: store blob cleanly in IndexedDB
  if (useLocalFallback || (token && token.startsWith('local_'))) {
    const url = await saveLocalMediaBlob(uploadBlob);
    return {url, mediaType: isVideo ? 'video' : 'image'};
  }

  // Primary path: fast raw binary stream upload to Express (zero base64 bloat, supports 58MB videos)
  try {
    const headers: Record<string, string> = {
      'Content-Type': mime,
      'X-File-Mime': mime,
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const res = await fetch('/api/upload/media', {
      method: 'POST',
      headers,
      body: uploadBlob,
    });

    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (ct.includes('application/json')) {
      const data = (await res.json().catch(() => ({}))) as {
        url?: string;
        mediaType?: 'image' | 'video';
        error?: string;
      };
      if (res.ok && data.url) {
        return {url: data.url, mediaType: data.mediaType || (isVideo ? 'video' : 'image')};
      }
      if (res.status >= 400 && res.status !== 404 && res.status !== 405) {
        throw new Error(data.error || 'Could not upload media file.');
      }
    }

    // Static host (404/405 HTML) -> switch to local fallback seamlessly
    useLocalFallback = true;
    const url = await saveLocalMediaBlob(uploadBlob);
    return {url, mediaType: isVideo ? 'video' : 'image'};
  } catch (err) {
    if (err instanceof TypeError) {
      useLocalFallback = true;
      const url = await saveLocalMediaBlob(uploadBlob);
      return {url, mediaType: isVideo ? 'video' : 'image'};
    }
    throw err;
  }
}

export async function uploadImageFile(file: File): Promise<string> {
  if (!file.type.startsWith('image/') && !/\.(jpg|jpeg|png|webp|gif|avif|bmp)$/i.test(file.name)) {
    throw new Error('Please choose an image file (PNG, JPG, WEBP, or GIF).');
  }
  const uploaded = await uploadMediaFile(file);
  return uploaded.url;
}

export function formatRelativeTime(isoString: string | null | undefined): string {
  if (!isoString) return '';
  const date = new Date(isoString.includes('T') ? isoString : `${isoString}Z`);
  if (Number.isNaN(date.getTime())) return '';
  const diffSec = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (diffSec < 45) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d`;
  return date.toLocaleDateString(undefined, {month: 'short', day: 'numeric'});
}

export function getInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || '')
    .join('');
}
