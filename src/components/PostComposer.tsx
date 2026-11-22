import {useRef, useState} from 'react';
import type {ChangeEvent, FormEvent} from 'react';
import {AlertCircle, CheckCircle2, ImagePlus, Loader2, Send, Video, X} from 'lucide-react';
import {formatFirestoreErrorMessage} from '../lib/firebase';
import {createPostPermanent} from '../lib/firestoreStore';
import {uploadAttachmentReal} from '../lib/mediaUpload';
import type {PostItem, SocialPageDoc, UserProfile} from '../types';
import {Avatar, useResolvedMediaUrl} from './MediaImage';

interface PostComposerProps {
  currentUser: UserProfile;
  postingAsPage?: SocialPageDoc | null;
  onPostCreated: (post: PostItem) => void;
  onOpenProfile: (userId: number) => void;
}

export function PostComposer({
  currentUser,
  postingAsPage = null,
  onPostCreated,
  onOpenProfile,
}: PostComposerProps) {
  const [content, setContent] = useState('');
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [uploadingKind, setUploadingKind] = useState<'image' | 'video' | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedToast, setSavedToast] = useState<string | null>(null);

  const photoInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  const resolvedImagePreview = useResolvedMediaUrl(imageUrl);
  const resolvedVideoPreview = useResolvedMediaUrl(videoUrl);

  const firstName = currentUser.name.split(' ')[0] || 'there';
  const uploading = uploadingKind !== null;
  const composerAvatar = postingAsPage ? postingAsPage.pagePhoto : currentUser.avatar_url;
  const composerName = postingAsPage ? postingAsPage.pageName : currentUser.name;

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>, expectedKind: 'image' | 'video') {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setSavedToast(null);
    setUploadingKind(expectedKind);
    try {
      const uploaded = await uploadAttachmentReal(file, {
        folder: postingAsPage
          ? `pages/${postingAsPage.pageId}/posts`
          : `posts/${currentUser.uid || 'user'}`,
        kind: expectedKind,
        fileName: file.name,
      });
      if (expectedKind === 'image') {
        setVideoUrl(null);
        setImageUrl(uploaded.url);
      } else {
        setImageUrl(null);
        setVideoUrl(uploaded.url);
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : expectedKind === 'video'
            ? 'Failed to upload video. Please try a smaller MP4/WEBM file.'
            : 'Failed to prepare photo.',
      );
    } finally {
      setUploadingKind(null);
      if (photoInputRef.current) photoInputRef.current.value = '';
      if (videoInputRef.current) videoInputRef.current.value = '';
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!content.trim() && !imageUrl && !videoUrl) return;
    setError(null);
    setSavedToast(null);
    setSubmitting(true);
    try {
      const post = await createPostPermanent(currentUser, {
        content: content.trim(),
        imageUrl,
        videoUrl,
        page: postingAsPage,
      });
      setContent('');
      setImageUrl(null);
      setVideoUrl(null);
      setSavedToast(
        postingAsPage
          ? `Published as ${postingAsPage.pageName} to Cloud Firestore.`
          : 'Post saved permanently to Cloud Firestore.',
      );
      window.setTimeout(() => setSavedToast(null), 3500);
      onPostCreated(post);
    } catch (err) {
      setError(formatFirestoreErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
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
            onChange={(e) => setContent(e.target.value)}
            placeholder={
              postingAsPage
                ? `Write a post as ${postingAsPage.pageName}...`
                : `What's on your mind, ${firstName}?`
            }
            className="w-full resize-none bg-[#F4F6F9] dark:bg-[#0E1014] rounded-xl px-3.5 py-2.5 text-[15px] text-[#0F172A] dark:text-[#F1F5F9] placeholder:text-[#64748B] dark:placeholder:text-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#1877F2] dark:focus:ring-[#3B82F6]"
          />

          {/* Photo preview */}
          {imageUrl && (
            <div className="relative mt-3 rounded-xl overflow-hidden border border-[#E5E8EE] dark:border-[#252A34] bg-[#0F1115]">
              {resolvedImagePreview ? (
                <img
                  src={resolvedImagePreview}
                  alt="Attached photo preview"
                  referrerPolicy="no-referrer"
                  className="w-full max-h-72 object-cover block"
                />
              ) : (
                <div className="w-full h-44 animate-pulse bg-[#1E222B]" />
              )}
              <button
                type="button"
                onClick={() => setImageUrl(null)}
                aria-label="Remove attached photo"
                className="absolute top-2.5 right-2.5 w-8 h-8 rounded-full bg-black/75 hover:bg-black text-white flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Video preview */}
          {videoUrl && (
            <div className="relative mt-3 rounded-xl overflow-hidden border border-[#E5E8EE] dark:border-[#252A34] bg-black">
              {resolvedVideoPreview ? (
                <video
                  src={resolvedVideoPreview}
                  controls
                  playsInline
                  muted
                  className="w-full max-h-80 block mx-auto"
                />
              ) : (
                <div className="w-full h-48 animate-pulse bg-[#1E222B]" />
              )}
              <button
                type="button"
                onClick={() => setVideoUrl(null)}
                aria-label="Remove attached video"
                className="absolute top-2.5 right-2.5 w-8 h-8 rounded-full bg-black/75 hover:bg-black text-white flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="mt-2.5 flex items-start gap-2 rounded-xl bg-[#FEF2F2] dark:bg-[#3B181A] border border-[#FECACA] dark:border-[#7F1D1D] px-3 py-2 text-xs font-medium text-[#B91C1C] dark:text-[#FCA5A5]"
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
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
                ref={photoInputRef}
                type="file"
                accept="image/*"
                onChange={(e) => handleFileChange(e, 'image')}
                className="hidden"
              />
              <button
                type="button"
                disabled={uploading}
                onClick={() => photoInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-2 rounded-xl text-xs sm:text-sm font-medium text-[#334155] dark:text-[#CBD5E1] hover:bg-[#F4F6F9] dark:hover:bg-[#1E232D] transition-colors whitespace-nowrap disabled:opacity-50 cursor-pointer"
              >
                {uploadingKind === 'image' ? (
                  <Loader2 className="w-4 h-4 animate-spin text-[#16A34A]" />
                ) : (
                  <ImagePlus className="w-4 h-4 text-[#16A34A]" />
                )}
                <span>{uploadingKind === 'image' ? 'Uploading...' : 'Photo'}</span>
              </button>

              <input
                ref={videoInputRef}
                type="file"
                accept="video/*"
                onChange={(e) => handleFileChange(e, 'video')}
                className="hidden"
              />
              <button
                type="button"
                disabled={uploading}
                onClick={() => videoInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-2 rounded-xl text-xs sm:text-sm font-medium text-[#334155] dark:text-[#CBD5E1] hover:bg-[#F4F6F9] dark:hover:bg-[#1E232D] transition-colors whitespace-nowrap disabled:opacity-50 cursor-pointer"
              >
                {uploadingKind === 'video' ? (
                  <Loader2 className="w-4 h-4 animate-spin text-[#E11D48]" />
                ) : (
                  <Video className="w-4 h-4 text-[#E11D48]" />
                )}
                <span>{uploadingKind === 'video' ? 'Uploading...' : 'Video'}</span>
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
                disabled={submitting || uploading || (!content.trim() && !imageUrl && !videoUrl)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#1877F2] hover:bg-[#166FE5] dark:bg-[#2563EB] dark:hover:bg-[#1D4ED8] text-white text-sm font-semibold transition-all active:scale-[0.985] disabled:opacity-50 whitespace-nowrap cursor-pointer"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                <span>{submitting ? 'Saving...' : 'Post'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </form>
  );
}
