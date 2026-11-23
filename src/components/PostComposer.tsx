import {useEffect, useRef, useState} from 'react';
import type {ChangeEvent, FormEvent} from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ImagePlus,
  Loader2,
  Play,
  RotateCcw,
  Send,
  Video,
  X,
} from 'lucide-react';
import {formatFirestoreErrorMessage} from '../lib/firebase';
import {createPostPermanent, generatePostDocId} from '../lib/firestoreStore';
import {
  extractVideoMetadata,
  formatFileSize,
  formatMediaDuration,
  MAX_VIDEO_BYTES,
  MAX_VIDEO_DURATION_SEC,
  uploadAttachmentReal,
} from '../lib/mediaUpload';
import type {PostItem, SocialPageDoc, UserProfile} from '../types';
import {Avatar} from './MediaImage';

interface PostComposerProps {
  currentUser: UserProfile;
  postingAsPage?: SocialPageDoc | null;
  onPostCreated: (post: PostItem) => void;
  onOpenProfile: (userId: number) => void;
}

interface PendingPostMedia {
  kind: 'image' | 'video';
  file: File;
  previewUrl: string;
  durationSec?: number;
  thumbnailDataUrl?: string | null;
}

function isVideoFile(file: File): boolean {
  if (file.type.startsWith('video/')) return true;
  return /\.(mp4|webm|mov|m4v|ogv|ogg|3gp|mkv)$/i.test(file.name);
}

function isImageFile(file: File): boolean {
  if (file.type.startsWith('image/')) return true;
  return /\.(jpg|jpeg|png|webp|gif|avif|bmp|heic|heif)$/i.test(file.name);
}

export function PostComposer({
  currentUser,
  postingAsPage = null,
  onPostCreated,
  onOpenProfile,
}: PostComposerProps) {
  const [content, setContent] = useState('');
  const [pendingMedia, setPendingMedia] = useState<PendingPostMedia | null>(null);
  const [preparingMedia, setPreparingMedia] = useState(false);
  const [videoPlayingPreview, setVideoPlayingPreview] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStage, setUploadStage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canRetry, setCanRetry] = useState(false);
  const [savedToast, setSavedToast] = useState<string | null>(null);

  const combinedInputRef = useRef<HTMLInputElement>(null);
  const videoPreviewRef = useRef<HTMLVideoElement>(null);

  const firstName = currentUser.name.split(' ')[0] || 'there';
  const composerAvatar = postingAsPage ? postingAsPage.pagePhoto : currentUser.avatar_url;
  const composerName = postingAsPage ? postingAsPage.pageName : currentUser.name;

  useEffect(() => {
    const url = pendingMedia?.previewUrl;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [pendingMedia?.previewUrl]);

  function clearMedia() {
    setPendingMedia(null);
    setVideoPlayingPreview(false);
    setError(null);
    setCanRetry(false);
  }

  async function handleMediaPicked(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setError(null);
    setCanRetry(false);
    setSavedToast(null);
    setVideoPlayingPreview(false);

    if (isVideoFile(file)) {
      if (file.size > MAX_VIDEO_BYTES) {
        setError('Video too large (max 100MB / 60 sec).');
        return;
      }

      setPreparingMedia(true);
      try {
        const meta = await extractVideoMetadata(file);
        if (meta.durationSec > MAX_VIDEO_DURATION_SEC) {
          setError(
            `Video too large (${formatMediaDuration(meta.durationSec)} — max 100MB / 60 sec).`,
          );
          return;
        }
        const previewUrl = URL.createObjectURL(file);
        setPendingMedia({
          kind: 'video',
          file,
          previewUrl,
          durationSec: meta.durationSec,
          thumbnailDataUrl: meta.thumbnailDataUrl,
        });
      } finally {
        setPreparingMedia(false);
      }
      return;
    }

    if (isImageFile(file)) {
      const previewUrl = URL.createObjectURL(file);
      setPendingMedia({
        kind: 'image',
        file,
        previewUrl,
      });
      return;
    }

    setError('Please select a Photo (JPG, PNG, WEBP, GIF) or Video (MP4, WEBM, MOV).');
  }

  async function publishPost() {
    if (submitting || preparingMedia) return;
    if (!content.trim() && !pendingMedia) return;

    setError(null);
    setCanRetry(false);
    setSavedToast(null);
    setSubmitting(true);
    setUploadProgress(0);

    try {
      const postId = generatePostDocId();
      let uploadedImageUrl: string | null = null;
      let uploadedVideoUrl: string | null = null;
      let uploadedVideoThumbnail: string | null = null;
      let mediaType: 'text' | 'image' | 'video' = 'text';

      if (pendingMedia) {
        const ownerKey = postingAsPage
          ? `pages/${postingAsPage.pageId}`
          : currentUser.uid || 'user';

        if (pendingMedia.kind === 'video') {
          mediaType = 'video';
          setUploadStage('Uploading video...');
          const uploaded = await uploadAttachmentReal(pendingMedia.file, {
            folder: `posts/${postId}`,
            exactStoragePath: `posts/${postId}/video.mp4`,
            kind: 'video',
            fileName: 'video.mp4',
            onProgress: (pct) => setUploadProgress(pct),
          });
          if (!uploaded.url || !uploaded.url.trim()) {
            throw new Error('Video upload did not return a playable URL. Please tap Retry.');
          }
          uploadedVideoUrl = uploaded.url.trim();
          uploadedVideoThumbnail = pendingMedia.thumbnailDataUrl || null;
          if (uploaded.storageBacked && pendingMedia.thumbnailDataUrl) {
            try {
              const thumbResp = await fetch(pendingMedia.thumbnailDataUrl);
              const thumbBlob = await thumbResp.blob();
              const uploadedThumb = await uploadAttachmentReal(thumbBlob, {
                folder: `posts/${postId}`,
                exactStoragePath: `posts/${postId}/thumbnail.jpg`,
                kind: 'image',
                fileName: 'thumbnail.jpg',
              });
              if (uploadedThumb.url) {
                uploadedVideoThumbnail = uploadedThumb.url;
              }
            } catch {
              // Keep compact 1-second JPEG data URL thumbnail
            }
          }
          uploadedImageUrl = null;
        } else {
          mediaType = 'image';
          setUploadStage('Uploading photo...');
          const uploaded = await uploadAttachmentReal(pendingMedia.file, {
            folder: postingAsPage
              ? `pages/${postingAsPage.pageId}/post_images`
              : `post_images/${ownerKey}`,
            kind: 'image',
            fileName: `${Date.now()}.jpg`,
            onProgress: (pct) => setUploadProgress(pct),
          });
          if (!uploaded.url || !uploaded.url.trim()) {
            throw new Error('Photo upload did not complete. Please tap Retry.');
          }
          uploadedImageUrl = uploaded.url.trim();
        }
      }

      // Only create Firestore post AFTER media upload finishes and returns a real download URL
      setUploadStage('Saving post...');
      const post = await createPostPermanent(currentUser, {
        postId,
        content: content.trim(),
        imageUrl: uploadedImageUrl,
        videoUrl: uploadedVideoUrl,
        videoThumbnail: uploadedVideoThumbnail,
        mediaType,
        page: postingAsPage,
      });

      setContent('');
      setPendingMedia(null);
      setVideoPlayingPreview(false);
      setUploadProgress(0);
      setUploadStage(null);
      setSavedToast(
        postingAsPage
          ? `Published as ${postingAsPage.pageName} to Cloud Firestore.`
          : uploadedVideoUrl
            ? 'Video post published to Cloud Firestore.'
            : 'Post saved permanently to Cloud Firestore.',
      );
      window.setTimeout(() => setSavedToast(null), 3500);
      onPostCreated(post);
    } catch (err) {
      setCanRetry(true);
      setError(
        err instanceof Error ? formatFirestoreErrorMessage(err) : 'Post upload failed. Tap Retry.',
      );
    } finally {
      setSubmitting(false);
      setUploadStage(null);
      setUploadProgress(0);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    void publishPost();
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white dark:bg-[#16191F] border border-[#E5E8EE] dark:border-[#252A34] rounded-2xl p-4 sm:p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
    >
      {postingAsPage && (
        <div className="mb-3 flex items-center justify-between text-xs text-[#64748B] dark:text-[#94A3B8]">
          <span>
            Posting as Page:{' '}
            <strong className="text-[#0F172A] dark:text-white">{postingAsPage.pageName}</strong>
          </span>
          <span>Visible in Home Feed</span>
        </div>
      )}

      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={() => !postingAsPage && onOpenProfile(currentUser.id)}
          className="shrink-0 cursor-pointer rounded-full focus-visible:outline-2 focus-visible:outline-[#1877F2]"
        >
          <Avatar src={composerAvatar} name={composerName} size="md" />
        </button>

        <div className="flex-1 min-w-0">
          <textarea
            rows={2}
            maxLength={2000}
            value={content}
            disabled={submitting}
            onChange={(e) => setContent(e.target.value)}
            placeholder={
              postingAsPage
                ? `Write a post as ${postingAsPage.pageName}...`
                : `What's on your mind, ${firstName}?`
            }
            className="w-full resize-none bg-[#F4F6F9] dark:bg-[#0E1014] rounded-xl px-3.5 py-2.5 text-[15px] text-[#0F172A] dark:text-[#F1F5F9] placeholder:text-[#64748B] dark:placeholder:text-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#1877F2] dark:focus:ring-[#3B82F6]"
          />

          {/* Reading video metadata indicator */}
          {preparingMedia && (
            <div className="mt-3 rounded-xl border border-[#E5E8EE] dark:border-[#252A34] bg-[#F4F6F9] dark:bg-[#0E1014] px-3.5 py-3 flex items-center gap-2 text-xs font-medium text-[#475569] dark:text-[#94A3B8]">
              <Loader2 className="w-4 h-4 animate-spin text-[#1877F2]" />
              <span>Preparing video preview...</span>
            </div>
          )}

          {/* Photo preview (immediate, before upload) */}
          {pendingMedia?.kind === 'image' && (
            <div className="relative mt-3 rounded-xl overflow-hidden border border-[#E5E8EE] dark:border-[#252A34] bg-[#0F1115]">
              <img
                src={pendingMedia.previewUrl}
                alt="Attached photo preview"
                className="w-full max-h-72 object-cover block"
              />
              {!submitting && (
                <button
                  type="button"
                  onClick={clearMedia}
                  aria-label="Remove attached photo"
                  className="absolute top-2.5 right-2.5 w-8 h-8 rounded-full bg-black/75 hover:bg-black text-white flex items-center justify-center cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          )}

          {/* Video preview (immediate Play button + duration + size like Facebook) */}
          {pendingMedia?.kind === 'video' && (
            <div className="relative mt-3 rounded-xl overflow-hidden border border-[#E5E8EE] dark:border-[#252A34] bg-black">
              <video
                ref={videoPreviewRef}
                src={pendingMedia.previewUrl}
                poster={pendingMedia.thumbnailDataUrl || undefined}
                controls={videoPlayingPreview}
                playsInline
                preload="metadata"
                onPlay={() => setVideoPlayingPreview(true)}
                onPause={() => setVideoPlayingPreview(false)}
                className="w-full max-h-80 block mx-auto"
              />

              {!videoPlayingPreview && (
                <button
                  type="button"
                  onClick={() => {
                    setVideoPlayingPreview(true);
                    void videoPreviewRef.current?.play().catch(() => {});
                  }}
                  aria-label="Preview video"
                  className="absolute inset-0 flex items-center justify-center bg-black/30 hover:bg-black/40 transition-colors cursor-pointer"
                >
                  <span className="w-14 h-14 rounded-full bg-black/70 border border-white/30 text-white flex items-center justify-center shadow-lg">
                    <Play className="w-6 h-6 fill-current ml-0.5" />
                  </span>
                </button>
              )}

              {/* Duration + Size badge */}
              <div className="absolute bottom-2.5 left-2.5 flex items-center gap-1.5 pointer-events-none">
                {pendingMedia.durationSec ? (
                  <span className="px-2 py-0.5 rounded-md bg-black/75 text-white text-[11px] font-semibold tabular-nums">
                    {formatMediaDuration(pendingMedia.durationSec)}
                  </span>
                ) : null}
                <span className="px-2 py-0.5 rounded-md bg-black/75 text-white/90 text-[11px] font-medium tabular-nums">
                  {formatFileSize(pendingMedia.file.size)}
                </span>
              </div>

              {!submitting && (
                <button
                  type="button"
                  onClick={clearMedia}
                  aria-label="Remove attached video"
                  className="absolute top-2.5 right-2.5 w-8 h-8 rounded-full bg-black/75 hover:bg-black text-white flex items-center justify-center cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          )}

          {/* Real 0% - 100% Upload Progress Bar */}
          {submitting && uploadStage && (
            <div className="mt-3 rounded-xl bg-[#1877F2]/8 dark:bg-[#3B82F6]/15 border border-[#1877F2]/20 px-3.5 py-2.5 space-y-1.5">
              <div className="flex items-center justify-between text-xs font-semibold text-[#1877F2] dark:text-[#60A5FA]">
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>{uploadStage}</span>
                </span>
                <span className="tabular-nums">{uploadProgress}%</span>
              </div>
              <div className="h-2 w-full rounded-full bg-[#1877F2]/20 overflow-hidden">
                <div
                  className="h-full rounded-full bg-[#1877F2] dark:bg-[#60A5FA] transition-all duration-150"
                  style={{width: `${Math.max(4, uploadProgress)}%`}}
                />
              </div>
            </div>
          )}

          {/* Real Error Banner with Retry button */}
          {error && (
            <div
              role="alert"
              className="mt-2.5 flex items-center justify-between gap-2 rounded-xl bg-[#FEF2F2] dark:bg-[#3B181A] border border-[#FECACA] dark:border-[#7F1D1D] px-3 py-2 text-xs font-medium text-[#B91C1C] dark:text-[#FCA5A5]"
            >
              <span className="flex items-start gap-2 min-w-0">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </span>
              {canRetry && !submitting && (
                <button
                  type="button"
                  onClick={() => void publishPost()}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#DC2626] hover:bg-[#B91C1C] text-white text-xs font-semibold shrink-0 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Retry</span>
                </button>
              )}
            </div>
          )}

          {savedToast && (
            <div
              role="status"
              className="mt-2.5 flex items-center gap-2 rounded-xl bg-[#ECFDF5] dark:bg-[#0F2E22] border border-[#A7F3D0] dark:border-[#166534] px-3 py-2 text-xs font-medium text-[#065F46] dark:text-[#A7F3D0]"
            >
              <CheckCircle2 className="w-4 h-4 shrink-0 text-[#16A34A] dark:text-[#4ADE80]" />
              <span>{savedToast}</span>
            </div>
          )}

          <div className="mt-3 pt-3 border-t border-[#E5E8EE] dark:border-[#252A34] flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-1 sm:gap-2">
              <input
                ref={combinedInputRef}
                type="file"
                accept="image/*,video/*"
                onChange={handleMediaPicked}
                className="hidden"
              />
              <button
                type="button"
                disabled={submitting || preparingMedia}
                onClick={() => combinedInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 sm:gap-2 px-3 py-2 rounded-xl text-xs sm:text-sm font-medium text-[#334155] dark:text-[#CBD5E1] hover:bg-[#F4F6F9] dark:hover:bg-[#1E232D] transition-colors whitespace-nowrap disabled:opacity-50 cursor-pointer"
              >
                <span className="inline-flex items-center gap-1">
                  <ImagePlus className="w-4 h-4 text-[#16A34A]" />
                  <Video className="w-4 h-4 text-[#E11D48]" />
                </span>
                <span>Photo/Video</span>
              </button>
            </div>

            <div className="flex items-center gap-3 ml-auto">
              {content.length > 0 && (
                <span className="text-[11px] text-[#64748B] dark:text-[#94A3B8] tabular-nums">
                  {content.length}/2000
                </span>
              )}
              <button
                type="submit"
                disabled={submitting || preparingMedia || (!content.trim() && !pendingMedia)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#1877F2] hover:bg-[#166FE5] dark:bg-[#2563EB] dark:hover:bg-[#1D4ED8] text-white text-sm font-semibold transition-all active:scale-[0.985] disabled:opacity-50 whitespace-nowrap cursor-pointer"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                <span>{submitting ? `${uploadProgress || 0}%` : 'Post'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </form>
  );
}
