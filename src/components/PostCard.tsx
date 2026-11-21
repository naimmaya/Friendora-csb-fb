import {useState} from 'react';
import type {FormEvent} from 'react';
import {Bookmark, Check, MessageCircle, Send, Share2, Trash2} from 'lucide-react';
import {apiRequest, formatRelativeTime} from '../lib/api';
import type {CommentItem, PostItem, ReactionType, UserProfile} from '../types';
import {Avatar, PostPhoto, PostVideo} from './MediaImage';
import {ReactionActionButton, ReactionSummaryBar} from './ReactionPicker';

interface PostCardProps {
  post: PostItem;
  currentUser: UserProfile;
  onOpenProfile: (userId: number) => void;
  onToggleLike: (postId: number, reaction?: ReactionType) => void;
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
  const [copiedShare, setCopiedShare] = useState(false);

  const isOwner = post.user_id === currentUser.id;

  function handleSharePost() {
    const shareUrl = `${window.location.origin}/profile/${post.user_id}#post-${post.id}`;
    navigator.clipboard?.writeText(shareUrl).then(() => {
      setCopiedShare(true);
      setTimeout(() => setCopiedShare(false), 2000);
    });
  }

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
    <article
      id={`post-${post.id}`}
      className="bg-white dark:bg-[#16191F] border border-[#E5E8EE] dark:border-[#252A34] rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
    >
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
              className="font-display font-semibold text-[15px] text-[#0F172A] dark:text-[#F1F5F9] hover:underline truncate block text-left cursor-pointer"
            >
              {post.author_name}
            </button>
            <div className="flex items-center gap-1.5 text-xs text-[#64748B] dark:text-[#94A3B8] mt-0.5 flex-wrap">
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
                  className="px-2 py-1 rounded-lg text-xs font-medium text-[#64748B] dark:text-[#94A3B8] hover:bg-[#F4F6F9] dark:hover:bg-[#232732] cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                aria-label="Delete post"
                className="p-2 rounded-lg text-[#64748B] dark:text-[#94A3B8] hover:text-[#DC2626] dark:hover:text-[#F87171] hover:bg-[#F4F6F9] dark:hover:bg-[#232732] transition-colors cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Text content */}
      {post.content && (
        <div className="px-4 sm:px-5 pb-3.5 text-[15px] leading-relaxed text-[#0F172A] dark:text-[#E2E8F0] whitespace-pre-wrap break-words">
          {post.content}
        </div>
      )}

      {/* Photo */}
      {post.image_url && <PostPhoto src={post.image_url} alt={`Photo shared by ${post.author_name}`} />}

      {/* Video */}
      {post.video_url && <PostVideo src={post.video_url} />}

      {/* Engagement stats with Facebook-style stacked reaction badges */}
      <div className="px-4 sm:px-5 py-2.5 flex items-center justify-between text-xs text-[#64748B] dark:text-[#94A3B8]">
        <ReactionSummaryBar
          totalCount={post.likes_count}
          reactionCounts={post.reaction_counts}
          myReaction={post.my_reaction || (post.liked_by_me ? 'like' : null)}
        />
        <button
          type="button"
          onClick={() => setShowComments((prev) => !prev)}
          className="hover:underline tabular-nums cursor-pointer"
        >
          {post.comments_count} {post.comments_count === 1 ? 'comment' : 'comments'}
        </button>
      </div>

      {/* Action buttons with Facebook-style Reaction Picker */}
      <div
        className={`mx-4 sm:mx-5 border-t border-[#E5E8EE] dark:border-[#252A34] py-1.5 grid ${
          onToggleSave ? 'grid-cols-4' : 'grid-cols-3'
        } gap-1`}
      >
        <ReactionActionButton
          myReaction={post.my_reaction || null}
          likedByMe={post.liked_by_me}
          onReact={(reaction) => onToggleLike(post.id, reaction)}
        />

        <button
          type="button"
          onClick={() => setShowComments((prev) => !prev)}
          className="h-10 rounded-xl flex items-center justify-center gap-1.5 text-xs sm:text-sm font-semibold text-[#64748B] dark:text-[#94A3B8] hover:bg-[#F4F6F9] dark:hover:bg-[#1E232D] transition-colors cursor-pointer"
        >
          <MessageCircle className="w-4 h-4" />
          <span>Comment</span>
        </button>

        {onToggleSave && (
          <button
            type="button"
            onClick={() => onToggleSave(post.id)}
            className={`h-10 rounded-xl flex items-center justify-center gap-1.5 text-xs sm:text-sm font-semibold transition-colors cursor-pointer ${
              post.saved_by_me
                ? 'text-[#7C3AED] dark:text-[#A78BFA] bg-[#7C3AED]/10 dark:bg-[#7C3AED]/15'
                : 'text-[#64748B] dark:text-[#94A3B8] hover:bg-[#F4F6F9] dark:hover:bg-[#1E232D]'
            }`}
          >
            <Bookmark className={`w-4 h-4 ${post.saved_by_me ? 'fill-current' : ''}`} />
            <span>{post.saved_by_me ? 'Saved' : 'Save'}</span>
          </button>
        )}

        <button
          type="button"
          onClick={handleSharePost}
          className={`h-10 rounded-xl flex items-center justify-center gap-1.5 text-xs sm:text-sm font-semibold transition-colors cursor-pointer ${
            copiedShare
              ? 'text-[#16A34A] dark:text-[#4ADE80] bg-[#ECFDF5] dark:bg-[#0B291E]'
              : 'text-[#64748B] dark:text-[#94A3B8] hover:bg-[#F4F6F9] dark:hover:bg-[#1E232D]'
          }`}
        >
          {copiedShare ? <Check className="w-4 h-4" /> : <Share2 className="w-4 h-4" />}
          <span>{copiedShare ? 'Copied' : 'Share'}</span>
        </button>
      </div>

      {/* Comments Section */}
      {showComments && (
        <div className="px-4 sm:px-5 pt-2 pb-4 border-t border-[#E5E8EE] dark:border-[#252A34] space-y-3 rounded-b-2xl">
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
                  <div className="flex-1 min-w-0 bg-[#F4F6F9] dark:bg-[#1E222B] rounded-xl px-3 py-2">
                    <div className="flex items-baseline gap-2">
                      <button
                        type="button"
                        onClick={() => onOpenProfile(comment.user_id)}
                        className="text-xs font-semibold text-[#0F172A] dark:text-[#F1F5F9] hover:underline cursor-pointer"
                      >
                        {comment.author_name}
                      </button>
                      <span className="text-[11px] text-[#64748B] dark:text-[#94A3B8] tabular-nums">
                        {formatRelativeTime(comment.created_at)}
                      </span>
                    </div>
                    <p className="text-sm text-[#1E293B] dark:text-[#E2E8F0] mt-0.5 break-words">
                      {comment.content}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          <form onSubmit={handleCommentSubmit} className="flex items-center gap-2 pt-1">
            <Avatar src={currentUser.avatar_url} name={currentUser.name} size="xs" />
            <div className="flex-1 flex items-center gap-2 bg-[#F4F6F9] dark:bg-[#0E1014] rounded-xl px-3 py-1.5 border border-transparent focus-within:border-[#1877F2] dark:focus-within:border-[#3B82F6]">
              <input
                type="text"
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder="Write a comment..."
                className="flex-1 bg-transparent text-sm text-[#0F172A] dark:text-[#F1F5F9] placeholder:text-[#64748B] dark:placeholder:text-[#94A3B8] focus:outline-none"
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
