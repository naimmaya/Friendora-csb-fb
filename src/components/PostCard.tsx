import {useState} from 'react';
import type {FormEvent} from 'react';
import {Bookmark, MessageCircle, Send, ThumbsUp, Trash2} from 'lucide-react';
import {apiRequest, formatRelativeTime} from '../lib/api';
import type {CommentItem, PostItem, UserProfile} from '../types';
import {Avatar, PostPhoto} from './MediaImage';

interface PostCardProps {
  post: PostItem;
  currentUser: UserProfile;
  onOpenProfile: (userId: number) => void;
  onToggleLike: (postId: number) => void;
  onToggleSave?: (postId: number) => void;
  onCommentAdded: (postId: number, comment: CommentItem) => void;
  onDeletePost: (postId: number) => void;
}

export function PostCard({
  post,
  currentUser,
  onOpenProfile,
  onToggleLike,
  onToggleSave,
  onCommentAdded,
  onDeletePost,
}: PostCardProps) {
  const [showComments, setShowComments] = useState(post.comments.length > 0 && post.comments.length <= 2);
  const [commentText, setCommentText] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isOwner = post.user_id === currentUser.id;

  async function handleCommentSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = commentText.trim();
    if (!trimmed || submittingComment) return;
    setSubmittingComment(true);
    try {
      const data = await apiRequest<{comment: CommentItem}>(`/api/posts/${post.id}/comments`, {
        method: 'POST',
        body: JSON.stringify({content: trimmed}),
      });
      setCommentText('');
      setShowComments(true);
      onCommentAdded(post.id, data.comment);
    } catch {
      // Keep input on failure
    } finally {
      setSubmittingComment(false);
    }
  }

  return (
    <article className="bg-white dark:bg-[#1C1E21] border border-[#E4E6EB] dark:border-[#2E3035] rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="p-4 sm:px-5 sm:pt-4 sm:pb-3 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={() => onOpenProfile(post.user_id)}
            className="shrink-0 cursor-pointer rounded-full focus-visible:outline-2 focus-visible:outline-[#1877F2]"
          >
            <Avatar src={post.author_avatar} name={post.author_name} size="md" />
          </button>
          <div className="min-w-0">
            <button
              type="button"
              onClick={() => onOpenProfile(post.user_id)}
              className="font-display font-semibold text-[15px] text-[#111827] dark:text-[#F3F4F6] hover:underline truncate block text-left cursor-pointer"
            >
              {post.author_name}
            </button>
            <div className="flex items-center gap-1.5 text-xs text-[#65676B] dark:text-[#9CA3AF] mt-0.5 flex-wrap">
              <span className="tabular-nums">{formatRelativeTime(post.created_at)}</span>
              {post.author_work && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="truncate max-w-[240px]">{post.author_work}</span>
                </>
              )}
            </div>
          </div>
        </div>

        {isOwner && (
          <div className="shrink-0">
            {confirmDelete ? (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => onDeletePost(post.id)}
                  className="px-2.5 py-1 rounded-lg bg-[#DC2626] text-white text-xs font-medium hover:bg-[#B91C1C] cursor-pointer"
                >
                  Delete
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="px-2 py-1 rounded-lg text-xs font-medium text-[#65676B] dark:text-[#9CA3AF] hover:bg-[#F0F2F5] dark:hover:bg-[#2A2D32] cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                aria-label="Delete post"
                className="p-2 rounded-lg text-[#65676B] dark:text-[#9CA3AF] hover:text-[#DC2626] dark:hover:text-[#F87171] hover:bg-[#F0F2F5] dark:hover:bg-[#2A2D32] transition-colors cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Text content */}
      {post.content && (
        <div className="px-4 sm:px-5 pb-3.5 text-[15px] leading-relaxed text-[#111827] dark:text-[#E5E7EB] whitespace-pre-wrap break-words">
          {post.content}
        </div>
      )}

      {/* Photo */}
      {post.image_url && <PostPhoto src={post.image_url} alt={`Photo shared by ${post.author_name}`} />}

      {/* Clean unboxed engagement stats */}
      <div className="px-4 sm:px-5 py-2.5 flex items-center justify-between text-xs text-[#65676B] dark:text-[#9CA3AF]">
        <span className="tabular-nums">
          {post.likes_count === 0
            ? 'Be the first to like this'
            : `${post.likes_count} ${post.likes_count === 1 ? 'like' : 'likes'}`}
        </span>
        <button
          type="button"
          onClick={() => setShowComments((prev) => !prev)}
          className="hover:underline tabular-nums cursor-pointer"
        >
          {post.comments_count} {post.comments_count === 1 ? 'comment' : 'comments'}
        </button>
      </div>

      {/* Action buttons */}
      <div
        className={`mx-4 sm:mx-5 border-t border-[#E4E6EB] dark:border-[#2E3035] py-1.5 grid ${
          onToggleSave ? 'grid-cols-3' : 'grid-cols-2'
        } gap-1`}
      >
        <button
          type="button"
          onClick={() => onToggleLike(post.id)}
          className={`h-10 rounded-xl flex items-center justify-center gap-2 text-sm font-semibold transition-colors cursor-pointer ${
            post.liked_by_me
              ? 'text-[#1877F2] dark:text-[#60A5FA] bg-[#1877F2]/8 dark:bg-[#3B82F6]/15'
              : 'text-[#65676B] dark:text-[#9CA3AF] hover:bg-[#F0F2F5] dark:hover:bg-[#2A2D32]'
          }`}
        >
          <ThumbsUp className={`w-4 h-4 ${post.liked_by_me ? 'fill-current' : ''}`} />
          <span>{post.liked_by_me ? 'Liked' : 'Like'}</span>
        </button>

        <button
          type="button"
          onClick={() => setShowComments((prev) => !prev)}
          className="h-10 rounded-xl flex items-center justify-center gap-2 text-sm font-semibold text-[#65676B] dark:text-[#9CA3AF] hover:bg-[#F0F2F5] dark:hover:bg-[#2A2D32] transition-colors cursor-pointer"
        >
          <MessageCircle className="w-4 h-4" />
          <span>Comment</span>
        </button>

        {onToggleSave && (
          <button
            type="button"
            onClick={() => onToggleSave(post.id)}
            className={`h-10 rounded-xl flex items-center justify-center gap-2 text-sm font-semibold transition-colors cursor-pointer ${
              post.saved_by_me
                ? 'text-[#7C3AED] dark:text-[#A78BFA] bg-[#7C3AED]/10 dark:bg-[#7C3AED]/15'
                : 'text-[#65676B] dark:text-[#9CA3AF] hover:bg-[#F0F2F5] dark:hover:bg-[#2A2D32]'
            }`}
          >
            <Bookmark className={`w-4 h-4 ${post.saved_by_me ? 'fill-current' : ''}`} />
            <span>{post.saved_by_me ? 'Saved' : 'Save'}</span>
          </button>
        )}
      </div>

      {/* Comments Section */}
      {showComments && (
        <div className="px-4 sm:px-5 pt-2 pb-4 border-t border-[#E4E6EB] dark:border-[#2E3035] space-y-3">
          {post.comments.length > 0 && (
            <div className="space-y-3 pt-1">
              {post.comments.map((comment) => (
                <div key={comment.id} className="flex items-start gap-2.5">
                  <button
                    type="button"
                    onClick={() => onOpenProfile(comment.user_id)}
                    className="shrink-0 mt-0.5 cursor-pointer rounded-full"
                  >
                    <Avatar src={comment.author_avatar} name={comment.author_name} size="xs" />
                  </button>
                  <div className="flex-1 min-w-0 bg-[#F0F2F5] dark:bg-[#24262B] rounded-xl px-3 py-2">
                    <div className="flex items-baseline gap-2">
                      <button
                        type="button"
                        onClick={() => onOpenProfile(comment.user_id)}
                        className="text-xs font-semibold text-[#111827] dark:text-[#F3F4F6] hover:underline cursor-pointer"
                      >
                        {comment.author_name}
                      </button>
                      <span className="text-[11px] text-[#65676B] dark:text-[#9CA3AF] tabular-nums">
                        {formatRelativeTime(comment.created_at)}
                      </span>
                    </div>
                    <p className="text-sm text-[#1F2937] dark:text-[#E5E7EB] mt-0.5 break-words">
                      {comment.content}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          <form onSubmit={handleCommentSubmit} className="flex items-center gap-2 pt-1">
            <Avatar src={currentUser.avatar_url} name={currentUser.name} size="xs" />
            <div className="flex-1 flex items-center gap-2 bg-[#F0F2F5] dark:bg-[#121316] rounded-xl px-3 py-1.5 border border-transparent focus-within:border-[#1877F2] dark:focus-within:border-[#3B82F6]">
              <input
                type="text"
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder="Write a comment..."
                className="flex-1 bg-transparent text-sm text-[#111827] dark:text-[#F3F4F6] placeholder:text-[#65676B] dark:placeholder:text-[#9CA3AF] focus:outline-none"
              />
              <button
                type="submit"
                disabled={!commentText.trim() || submittingComment}
                aria-label="Send comment"
                className="p-1.5 rounded-lg text-[#1877F2] dark:text-[#60A5FA] hover:bg-[#1877F2]/10 disabled:opacity-40 transition-colors cursor-pointer"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </form>
        </div>
      )}
    </article>
  );
}
