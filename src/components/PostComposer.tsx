import {useRef, useState} from 'react';
import type {ChangeEvent, FormEvent} from 'react';
import {ImagePlus, Loader2, Send, X} from 'lucide-react';
import {apiRequest, uploadImageFile} from '../lib/api';
import type {PostItem, UserProfile} from '../types';
import {Avatar} from './MediaImage';

interface PostComposerProps {
  currentUser: UserProfile;
  onPostCreated: (post: PostItem) => void;
  onOpenProfile: (userId: number) => void;
}

export function PostComposer({currentUser, onPostCreated, onOpenProfile}: PostComposerProps) {
  const [content, setContent] = useState('');
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const firstName = currentUser.name.split(' ')[0] || 'there';

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const url = await uploadImageFile(file);
      setImageUrl(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload image.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!content.trim() && !imageUrl) return;
    setError(null);
    setSubmitting(true);
    try {
      const data = await apiRequest<{post: PostItem}>('/api/posts', {
        method: 'POST',
        body: JSON.stringify({
          content: content.trim(),
          image_url: imageUrl,
        }),
      });
      setContent('');
      setImageUrl(null);
      onPostCreated(data.post);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not publish post.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white dark:bg-[#1C1E21] border border-[#E4E6EB] dark:border-[#2E3035] rounded-2xl p-4 sm:p-5"
    >
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={() => onOpenProfile(currentUser.id)}
          className="shrink-0 cursor-pointer rounded-full focus-visible:outline-2 focus-visible:outline-[#1877F2]"
        >
          <Avatar src={currentUser.avatar_url} name={currentUser.name} size="md" />
        </button>

        <div className="flex-1 min-w-0">
          <textarea
            rows={2}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={`What's on your mind, ${firstName}?`}
            className="w-full resize-none bg-[#F0F2F5] dark:bg-[#121316] rounded-xl px-3.5 py-2.5 text-[15px] text-[#111827] dark:text-[#F3F4F6] placeholder:text-[#65676B] dark:placeholder:text-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#1877F2] dark:focus:ring-[#3B82F6]"
          />

          {imageUrl && (
            <div className="relative mt-3 rounded-xl overflow-hidden border border-[#E4E6EB] dark:border-[#2E3035] bg-[#111827]">
              <img
                src={imageUrl}
                alt="Attached upload preview"
                referrerPolicy="no-referrer"
                className="w-full max-h-72 object-cover block"
              />
              <button
                type="button"
                onClick={() => setImageUrl(null)}
                aria-label="Remove attached photo"
                className="absolute top-2.5 right-2.5 w-8 h-8 rounded-full bg-black/70 hover:bg-black/85 text-white flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {error && (
            <p role="alert" className="mt-2 text-xs text-[#DC2626] dark:text-[#F87171]">
              {error}
            </p>
          )}

          <div className="mt-3 pt-3 border-t border-[#E4E6EB] dark:border-[#2E3035] flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                onChange={handleFileChange}
                className="hidden"
              />
              <button
                type="button"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-[#374151] dark:text-[#D1D5DB] hover:bg-[#F0F2F5] dark:hover:bg-[#2A2D32] transition-colors whitespace-nowrap cursor-pointer"
              >
                {uploading ? (
                  <Loader2 className="w-4 h-4 animate-spin text-[#1877F2]" />
                ) : (
                  <ImagePlus className="w-4 h-4 text-[#16A34A]" />
                )}
                <span>{uploading ? 'Uploading...' : 'Add Photo'}</span>
              </button>
            </div>

            <button
              type="submit"
              disabled={submitting || uploading || (!content.trim() && !imageUrl)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#1877F2] hover:bg-[#166FE5] dark:bg-[#2563EB] dark:hover:bg-[#1D4ED8] text-white text-sm font-semibold transition-colors disabled:opacity-50 whitespace-nowrap cursor-pointer"
            >
              <Send className="w-4 h-4" />
              <span>{submitting ? 'Posting...' : 'Post'}</span>
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}
