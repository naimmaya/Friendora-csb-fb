import {useEffect, useMemo, useRef, useState} from 'react';
import type {ChangeEvent, FormEvent} from 'react';
import {
  AlertCircle,
  Bookmark,
  Check,
  CornerDownRight,
  EyeOff,
  Flag,
  ImagePlus,
  Link2,
  Loader2,
  MessageCircle,
  MessageCircleOff,
  MoreHorizontal,
  Pencil,
  Send,
  Share2,
  Trash2,
  UserMinus,
  UserPlus,
  X,
} from 'lucide-react';
import {formatRelativeTime} from '../lib/api';
import {formatFirestoreErrorMessage} from '../lib/firebase';
import {
  addCommentPermanent,
  compressImageForFirestore,
  deleteCommentPermanent,
  reportPostPermanent,
  setPostCommentsDisabledPermanent,
  subscribePostReactionsPermanent,
  updatePostPermanent,
  type PostReactionEntry,
} from '../lib/firestoreStore';
import type {
  CommentItem,
  PostItem,
  PostReportReason,
  ReactionType,
  UserProfile,
} from '../types';
import {Avatar, PostPhoto, PostVideo, useResolvedMediaUrl} from './MediaImage';
import {
  ReactionActionButton,
  ReactionSummaryBar,
  ReactionViewerModal,
} from './ReactionPicker';

interface PostCardProps {
  post: PostItem;
  currentUser: UserProfile;
  isFollowingAuthor?: boolean;
  onOpenProfile: (userId: number) => void;
  onOpenPage?: (pageId: string) => void;
  onToggleLike: (postId: number, reaction?: ReactionType) => void;
  onToggleSave?: (postId: number) => void;
  onHidePost?: (post: PostItem) => Promise<void> | void;
  onToggleFollowAuthor?: (authorUid: string) => Promise<void> | void;
  onCommentAdded: (postId: number, comment: CommentItem) => void;
  onCommentDeleted?: (postId: number, commentId: number) => void;
  onDeletePost: (postId: number) => Promise<void> | void;
}

interface ReplyTargetState {
  rootCommentDocId: string;
  replyToName: string;
  replyToAuthorUid?: string;
}

const REPORT_REASONS: Array<{value: PostReportReason; label: string; desc: string}> = [
  {value: 'spam', label: 'Spam or misleading', desc: 'Repetitive, promotional, or scam content'},
  {value: 'harassment', label: 'Harassment or bullying', desc: 'Abusive language or targeted attacks'},
  {value: 'misinformation', label: 'False information', desc: 'Deceptive claims or manipulated media'},
  {value: 'inappropriate', label: 'Inappropriate content', desc: 'Graphic, violent, or unsafe content'},
  {value: 'other', label: 'Other issue', desc: 'Something else that violates community rules'},
];

export function PostCard({
  post,
  currentUser,
  isFollowingAuthor,
  onOpenProfile,
  onOpenPage,
  onToggleLike,
  onToggleSave,
  onHidePost,
  onToggleFollowAuthor,
  onCommentAdded,
  onCommentDeleted,
  onDeletePost,
}: PostCardProps) {
  const [showComments, setShowComments] = useState(post.comments.length > 0 && post.comments.length <= 3);
  const [commentText, setCommentText] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);
  const [copiedShare, setCopiedShare] = useState(false);

  // 3-dot bottom popup menu & action modals
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deletingPost, setDeletingPost] = useState(false);

  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editContent, setEditContent] = useState(post.content);
  const [editImageUrl, setEditImageUrl] = useState<string | null>(post.image_url);
  const [editVideoUrl, setEditVideoUrl] = useState<string | null>(post.video_url || null);
  const [uploadingEditPhoto, setUploadingEditPhoto] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);

  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [reportReason, setReportReason] = useState<PostReportReason>('spam');
  const [reportDetails, setReportDetails] = useState('');
  const [submittingReport, setSubmittingReport] = useState(false);
  const [reportSuccess, setReportSuccess] = useState(false);

  const [menuActionBusy, setMenuActionBusy] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Facebook-style threaded comment reply state
  const [replyingTo, setReplyingTo] = useState<ReplyTargetState | null>(null);
  const [replyText, setReplyText] = useState('');
  const [submittingReply, setSubmittingReply] = useState(false);
  const [expandedThreads, setExpandedThreads] = useState<Record<string, boolean>>({});
  const [deletingCommentId, setDeletingCommentId] = useState<number | null>(null);
  const replyInputRef = useRef<HTMLInputElement>(null);
  const editPhotoInputRef = useRef<HTMLInputElement>(null);

  // Real-time Firestore onSnapshot state for post reactions (posts/{postId}/likes) + "People who reacted" popup
  const [reactionViewerOpen, setReactionViewerOpen] = useState(false);
  const [liveReactions, setLiveReactions] = useState<{
    items: PostReactionEntry[];
    likes_count: number;
    liked_by_me: boolean;
    my_reaction: ReactionType | null;
    reaction_counts: Partial<Record<ReactionType, number>>;
  } | null>(null);

  useEffect(() => {
    if (!post.docId || !currentUser.uid) {
      setLiveReactions(null);
      return;
    }
    const unsub = subscribePostReactionsPermanent(post.docId, currentUser.uid, (data) => {
      setLiveReactions(data);
    });
    return () => unsub();
  }, [post.docId, currentUser.uid]);

  const effectiveLikesCount = liveReactions ? liveReactions.likes_count : post.likes_count;
  const effectiveLikedByMe = liveReactions ? liveReactions.liked_by_me : post.liked_by_me;
  const effectiveMyReaction = liveReactions ? liveReactions.my_reaction : post.my_reaction || null;
  const effectiveReactionCounts = liveReactions
    ? liveReactions.reaction_counts
    : post.reaction_counts || {};

  const resolvedEditPreview = useResolvedMediaUrl(editImageUrl);

  const isOwner =
    post.user_id === currentUser.id ||
    (Boolean(post.author_uid) && post.author_uid === currentUser.uid);

  const isPagePost = Boolean(post.page_id && post.page_name);

  // Group comments into top-level comments and nested replies by parent docId
  const {topLevelComments, repliesByParent} = useMemo(() => {
    const docIdSet = new Set(post.comments.map((c) => c.docId).filter(Boolean) as string[]);
    const roots: CommentItem[] = [];
    const replies: Record<string, CommentItem[]> = {};

    for (const comment of post.comments) {
      const parentId = comment.parent_comment_id;
      if (parentId && docIdSet.has(parentId)) {
        if (!replies[parentId]) replies[parentId] = [];
        replies[parentId].push(comment);
      } else {
        roots.push(comment);
      }
    }
    return {topLevelComments: roots, repliesByParent: replies};
  }, [post.comments]);

  function flashMessage(msg: string) {
    setActionFeedback(msg);
    window.setTimeout(() => setActionFeedback(null), 2600);
  }

  function handleCopyLink() {
    const shareUrl = isPagePost
      ? `${window.location.origin}/?page=${post.page_id}#post-${post.id}`
      : `${window.location.origin}/?profile=${post.user_id}#post-${post.id}`;
    navigator.clipboard?.writeText(shareUrl).then(() => {
      setCopiedShare(true);
      flashMessage('Post link copied to clipboard.');
      setTimeout(() => setCopiedShare(false), 2000);
    });
    setMenuOpen(false);
  }

  function openEditModal() {
    setEditContent(post.content);
    setEditImageUrl(post.image_url);
    setEditVideoUrl(post.video_url || null);
    setActionError(null);
    setMenuOpen(false);
    setEditModalOpen(true);
  }

  async function handleEditPhotoPick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadingEditPhoto(true);
    setActionError(null);
    try {
      const dataUrl = await compressImageForFirestore(file, 'post');
      setEditVideoUrl(null);
      setEditImageUrl(dataUrl);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to prepare photo.');
    } finally {
      setUploadingEditPhoto(false);
    }
  }

  async function handleSaveEdit(e: FormEvent) {
    e.preventDefault();
    if (!post.docId || savingEdit) return;
    setSavingEdit(true);
    setActionError(null);
    try {
      await updatePostPermanent(post.docId, {
        content: editContent.trim(),
        imageUrl: editImageUrl,
        videoUrl: editVideoUrl,
      });
      setEditModalOpen(false);
      flashMessage('Post updated in Cloud Firestore.');
    } catch (err) {
      setActionError(formatFirestoreErrorMessage(err));
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleConfirmDeletePost() {
    if (deletingPost) return;
    setDeletingPost(true);
    setActionError(null);
    try {
      await onDeletePost(post.id);
      setDeleteModalOpen(false);
    } catch (err) {
      setActionError(formatFirestoreErrorMessage(err));
      setDeletingPost(false);
    }
  }

  async function handleToggleCommentsOff() {
    if (!post.docId || menuActionBusy) return;
    setMenuActionBusy(true);
    setActionError(null);
    try {
      const nextDisabled = !post.comments_disabled;
      await setPostCommentsDisabledPermanent(post.docId, nextDisabled);
      setMenuOpen(false);
      flashMessage(nextDisabled ? 'Comments turned off for this post.' : 'Comments turned back on.');
    } catch (err) {
      setActionError(formatFirestoreErrorMessage(err));
    } finally {
      setMenuActionBusy(false);
    }
  }

  async function handleHidePostAction() {
    if (!onHidePost || menuActionBusy) return;
    setMenuActionBusy(true);
    setActionError(null);
    try {
      await onHidePost(post);
      setMenuOpen(false);
    } catch (err) {
      setActionError(formatFirestoreErrorMessage(err));
    } finally {
      setMenuActionBusy(false);
    }
  }

  async function handleUnfollowAction() {
    if (!onToggleFollowAuthor || !post.author_uid || menuActionBusy) return;
    setMenuActionBusy(true);
    setActionError(null);
    try {
      await onToggleFollowAuthor(post.author_uid);
      setMenuOpen(false);
      flashMessage(
        isFollowingAuthor ? `Unfollowed ${post.author_name}.` : `Following ${post.author_name}.`,
      );
    } catch (err) {
      setActionError(formatFirestoreErrorMessage(err));
    } finally {
      setMenuActionBusy(false);
    }
  }

  async function handleSubmitReport(e: FormEvent) {
    e.preventDefault();
    if (!post.docId || !currentUser.uid || !post.author_uid || submittingReport) return;
    setSubmittingReport(true);
    setActionError(null);
    try {
      await reportPostPermanent({
        reporterUid: currentUser.uid,
        postDocId: post.docId,
        targetAuthorUid: post.author_uid,
        reason: reportReason,
        details: reportDetails.trim(),
      });
      setReportSuccess(true);
      setReportDetails('');
      window.setTimeout(() => {
        setReportModalOpen(false);
        setReportSuccess(false);
      }, 1400);
    } catch (err) {
      setActionError(formatFirestoreErrorMessage(err));
    } finally {
      setSubmittingReport(false);
    }
  }

  function handleStartReply(rootComment: CommentItem, targetComment: CommentItem) {
    if (!rootComment.docId || post.comments_disabled) return;
    setCommentError(null);
    setShowComments(true);
    setExpandedThreads((prev) => ({...prev, [rootComment.docId!]: true}));
    setReplyingTo({
      rootCommentDocId: rootComment.docId,
      replyToName: targetComment.author_name,
      replyToAuthorUid: targetComment.author_uid,
    });
    setReplyText('');
    window.setTimeout(() => {
      replyInputRef.current?.focus();
    }, 30);
  }

  async function handleCommentSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = commentText.trim();
    if (!trimmed || submittingComment || !post.docId || post.comments_disabled) return;
    setSubmittingComment(true);
    setCommentError(null);
    try {
      const comment = await addCommentPermanent(
        post.docId,
        post.id,
        currentUser,
        post.author_uid,
        trimmed,
      );
      setCommentText('');
      setShowComments(true);
      onCommentAdded(post.id, comment);
    } catch (err) {
      setCommentError(formatFirestoreErrorMessage(err));
    } finally {
      setSubmittingComment(false);
    }
  }

  async function handleReplySubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = replyText.trim();
    if (!trimmed || submittingReply || !post.docId || !replyingTo || post.comments_disabled) return;
    setSubmittingReply(true);
    setCommentError(null);
    try {
      const reply = await addCommentPermanent(
        post.docId,
        post.id,
        currentUser,
        post.author_uid,
        trimmed,
        {
          parentCommentId: replyingTo.rootCommentDocId,
          replyToName: replyingTo.replyToName,
          replyToAuthorUid: replyingTo.replyToAuthorUid,
        },
      );
      setReplyText('');
      setExpandedThreads((prev) => ({...prev, [replyingTo.rootCommentDocId]: true}));
      setReplyingTo(null);
      onCommentAdded(post.id, reply);
    } catch (err) {
      setCommentError(formatFirestoreErrorMessage(err));
    } finally {
      setSubmittingReply(false);
    }
  }

  async function handleDeleteComment(comment: CommentItem) {
    if (!post.docId || !comment.docId || deletingCommentId !== null) return;
    setDeletingCommentId(comment.id);
    setCommentError(null);
    try {
      await deleteCommentPermanent(post.docId, comment.docId);
      onCommentDeleted?.(post.id, comment.id);
    } catch (err) {
      setCommentError(formatFirestoreErrorMessage(err));
    } finally {
      setDeletingCommentId(null);
    }
  }

  function handleHeaderIdentityClick() {
    if (isPagePost && post.page_id && onOpenPage) {
      onOpenPage(post.page_id);
    } else {
      onOpenProfile(post.user_id);
    }
  }

  const displayAvatar = isPagePost ? post.page_avatar || '' : post.author_avatar;
  const displayName = isPagePost ? post.page_name || post.author_name : post.author_name;
  const displaySubtitle = isPagePost
    ? post.page_category || 'Page'
    : post.author_work || '';

  return (
    <>
      <article
        id={`post-${post.id}`}
        className="bg-white dark:bg-[#16191F] border border-[#E5E8EE] dark:border-[#252A34] rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
      >
        {/* Header with Top-Right 3-Dot (...) Menu on EVERY Post */}
        <div className="p-4 sm:px-5 sm:pt-4 sm:pb-3 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={handleHeaderIdentityClick}
              className="shrink-0 cursor-pointer rounded-full focus-visible:outline-2 focus-visible:outline-[#1877F2]"
            >
              <Avatar src={displayAvatar} name={displayName} size="md" />
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  type="button"
                  onClick={handleHeaderIdentityClick}
                  className="font-display font-semibold text-[15px] text-[#0F172A] dark:text-[#F1F5F9] hover:underline truncate block text-left cursor-pointer"
                >
                  {displayName}
                </button>
                {isPagePost && (
                  <span className="text-[11px] font-semibold text-[#1877F2] dark:text-[#60A5FA]">
                    · Page
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 text-xs text-[#64748B] dark:text-[#94A3B8] mt-0.5 flex-wrap">
                <span className="tabular-nums">{formatRelativeTime(post.created_at)}</span>
                {post.edited && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>Edited</span>
                  </>
                )}
                {displaySubtitle && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="truncate max-w-[220px]">{displaySubtitle}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* 3-Dot Menu Trigger (Facebook-style) */}
          <button
            type="button"
            onClick={() => {
              setActionError(null);
              setMenuOpen(true);
            }}
            aria-label="Post options"
            className="w-9 h-9 rounded-full text-[#64748B] dark:text-[#94A3B8] hover:text-[#0F172A] dark:hover:text-white hover:bg-[#F4F6F9] dark:hover:bg-[#232732] flex items-center justify-center transition-colors shrink-0 cursor-pointer"
          >
            <MoreHorizontal className="w-5 h-5" />
          </button>
        </div>

        {/* Transient Real Action Confirmation */}
        {actionFeedback && (
          <div className="mx-4 sm:mx-5 mb-2.5 px-3 py-1.5 rounded-xl bg-[#ECFDF5] dark:bg-[#0F2E22] text-[#065F46] dark:text-[#A7F3D0] text-xs font-medium flex items-center gap-1.5">
            <Check className="w-3.5 h-3.5 shrink-0" />
            <span>{actionFeedback}</span>
          </div>
        )}

        {/* Text content */}
        {post.content && (
          <div className="px-4 sm:px-5 pb-3.5 text-[15px] leading-relaxed text-[#0F172A] dark:text-[#E2E8F0] whitespace-pre-wrap break-words">
            {post.content}
          </div>
        )}

        {/* Photo (only when post is not a video post with thumbnail) */}
        {post.image_url && !post.video_url && (
          <PostPhoto src={post.image_url} alt={`Photo shared by ${displayName}`} />
        )}

        {/* Video (Facebook-style player with thumbnail poster, Play/Pause, Mute/Unmute, Full-screen) */}
        {post.video_url && <PostVideo src={post.video_url} poster={post.image_url} />}

        {/* Engagement stats */}
        <div className="px-4 sm:px-5 py-2.5 flex items-center justify-between text-xs text-[#64748B] dark:text-[#94A3B8]">
          <ReactionSummaryBar
            totalCount={effectiveLikesCount}
            reactionCounts={effectiveReactionCounts}
            myReaction={effectiveMyReaction || (effectiveLikedByMe ? 'like' : null)}
            onOpenViewer={() => setReactionViewerOpen(true)}
          />
          <button
            type="button"
            onClick={() => setShowComments((prev) => !prev)}
            className="hover:underline tabular-nums cursor-pointer"
          >
            {post.comments_disabled
              ? 'Comments off'
              : `${post.comments_count} ${post.comments_count === 1 ? 'comment' : 'comments'}`}
          </button>
        </div>

        {/* Action buttons */}
        <div
          className={`mx-4 sm:mx-5 border-t border-[#E5E8EE] dark:border-[#252A34] py-1.5 grid ${
            onToggleSave ? 'grid-cols-4' : 'grid-cols-3'
          } gap-1`}
        >
          <ReactionActionButton
            myReaction={effectiveMyReaction}
            likedByMe={effectiveLikedByMe}
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
            onClick={handleCopyLink}
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

        {/* Comments & Threaded Replies Section */}
        {showComments && (
          <div className="px-4 sm:px-5 pt-2 pb-4 border-t border-[#E5E8EE] dark:border-[#252A34] space-y-3 rounded-b-2xl">
            {post.comments_disabled && (
              <div className="flex items-center gap-2 rounded-xl bg-[#F4F6F9] dark:bg-[#1E222B] px-3.5 py-2.5 text-xs font-medium text-[#64748B] dark:text-[#94A3B8]">
                <MessageCircleOff className="w-4 h-4 shrink-0" />
                <span>Comments are turned off for this post.</span>
              </div>
            )}

            {topLevelComments.length > 0 && (
              <div className="space-y-3.5 pt-1">
                {topLevelComments.map((comment) => {
                  const threadDocId = comment.docId || '';
                  const threadReplies = threadDocId ? repliesByParent[threadDocId] || [] : [];
                  const isReplyingHere =
                    Boolean(threadDocId) && replyingTo?.rootCommentDocId === threadDocId;
                  const isThreadOpen =
                    expandedThreads[threadDocId] ?? (threadReplies.length <= 2 || isReplyingHere);
                  const canDeleteComment =
                    comment.user_id === currentUser.id ||
                    (Boolean(comment.author_uid) && comment.author_uid === currentUser.uid);

                  return (
                    <div key={comment.id} className="space-y-2">
                      {/* Top-Level Comment */}
                      <div className="flex items-start gap-2.5">
                        <button
                          type="button"
                          onClick={() => onOpenProfile(comment.user_id)}
                          className="shrink-0 mt-0.5 cursor-pointer rounded-full"
                        >
                          <Avatar src={comment.author_avatar} name={comment.author_name} size="xs" />
                        </button>
                        <div className="flex-1 min-w-0">
                          <div className="inline-block max-w-full bg-[#F4F6F9] dark:bg-[#1E222B] rounded-2xl px-3.5 py-2">
                            <button
                              type="button"
                              onClick={() => onOpenProfile(comment.user_id)}
                              className="text-xs font-semibold text-[#0F172A] dark:text-[#F1F5F9] hover:underline block text-left cursor-pointer"
                            >
                              {comment.author_name}
                            </button>
                            <p className="text-sm text-[#1E293B] dark:text-[#E2E8F0] mt-0.5 break-words whitespace-pre-wrap">
                              {comment.content}
                            </p>
                          </div>

                          <div className="flex items-center gap-3.5 px-2.5 mt-1 text-[11px] text-[#64748B] dark:text-[#94A3B8]">
                            <span className="tabular-nums">
                              {formatRelativeTime(comment.created_at)}
                            </span>
                            {threadDocId && !post.comments_disabled && (
                              <button
                                type="button"
                                onClick={() => handleStartReply(comment, comment)}
                                className="font-semibold hover:text-[#1877F2] dark:hover:text-[#60A5FA] hover:underline cursor-pointer"
                              >
                                Reply
                              </button>
                            )}
                            {canDeleteComment && comment.docId && (
                              <button
                                type="button"
                                disabled={deletingCommentId === comment.id}
                                onClick={() => handleDeleteComment(comment)}
                                className="font-medium hover:text-[#DC2626] dark:hover:text-[#F87171] hover:underline disabled:opacity-50 cursor-pointer"
                              >
                                {deletingCommentId === comment.id ? 'Deleting...' : 'Delete'}
                              </button>
                            )}
                          </div>
                        </div>
                      </div>

                      {threadReplies.length > 0 && !isThreadOpen && (
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedThreads((prev) => ({...prev, [threadDocId]: true}))
                          }
                          className="ml-9 inline-flex items-center gap-1.5 text-xs font-semibold text-[#1877F2] dark:text-[#60A5FA] hover:underline cursor-pointer"
                        >
                          <CornerDownRight className="w-3.5 h-3.5" />
                          <span>
                            View {threadReplies.length}{' '}
                            {threadReplies.length === 1 ? 'reply' : 'replies'}
                          </span>
                        </button>
                      )}

                      {threadReplies.length > 0 && isThreadOpen && (
                        <div className="ml-8 pl-3 border-l-2 border-[#E5E8EE] dark:border-[#2A303D] space-y-2.5">
                          {threadReplies.length > 2 && (
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedThreads((prev) => ({...prev, [threadDocId]: false}))
                              }
                              className="text-[11px] font-semibold text-[#64748B] dark:text-[#94A3B8] hover:underline cursor-pointer"
                            >
                              Hide replies
                            </button>
                          )}

                          {threadReplies.map((reply) => {
                            const canDeleteReply =
                              reply.user_id === currentUser.id ||
                              (Boolean(reply.author_uid) && reply.author_uid === currentUser.uid);

                            return (
                              <div key={reply.id} className="flex items-start gap-2">
                                <button
                                  type="button"
                                  onClick={() => onOpenProfile(reply.user_id)}
                                  className="shrink-0 mt-0.5 cursor-pointer rounded-full"
                                >
                                  <Avatar
                                    src={reply.author_avatar}
                                    name={reply.author_name}
                                    size="xs"
                                  />
                                </button>
                                <div className="flex-1 min-w-0">
                                  <div className="inline-block max-w-full bg-[#F4F6F9] dark:bg-[#1E222B] rounded-2xl px-3 py-1.5">
                                    <button
                                      type="button"
                                      onClick={() => onOpenProfile(reply.user_id)}
                                      className="text-xs font-semibold text-[#0F172A] dark:text-[#F1F5F9] hover:underline block text-left cursor-pointer"
                                    >
                                      {reply.author_name}
                                    </button>
                                    <p className="text-[13px] text-[#1E293B] dark:text-[#E2E8F0] mt-0.5 break-words whitespace-pre-wrap">
                                      {reply.reply_to_name && (
                                        <span className="font-semibold text-[#1877F2] dark:text-[#60A5FA] mr-1">
                                          @{reply.reply_to_name}
                                        </span>
                                      )}
                                      {reply.content}
                                    </p>
                                  </div>

                                  <div className="flex items-center gap-3.5 px-2.5 mt-1 text-[11px] text-[#64748B] dark:text-[#94A3B8]">
                                    <span className="tabular-nums">
                                      {formatRelativeTime(reply.created_at)}
                                    </span>
                                    {threadDocId && !post.comments_disabled && (
                                      <button
                                        type="button"
                                        onClick={() => handleStartReply(comment, reply)}
                                        className="font-semibold hover:text-[#1877F2] dark:hover:text-[#60A5FA] hover:underline cursor-pointer"
                                      >
                                        Reply
                                      </button>
                                    )}
                                    {canDeleteReply && reply.docId && (
                                      <button
                                        type="button"
                                        disabled={deletingCommentId === reply.id}
                                        onClick={() => handleDeleteComment(reply)}
                                        className="font-medium hover:text-[#DC2626] dark:hover:text-[#F87171] hover:underline disabled:opacity-50 cursor-pointer"
                                      >
                                        {deletingCommentId === reply.id ? 'Deleting...' : 'Delete'}
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {isReplyingHere && replyingTo && !post.comments_disabled && (
                        <form
                          onSubmit={handleReplySubmit}
                          className="ml-8 pl-3 border-l-2 border-[#1877F2]/40 space-y-1.5"
                        >
                          <div className="flex items-center justify-between gap-2 text-[11px] text-[#64748B] dark:text-[#94A3B8]">
                            <span className="inline-flex items-center gap-1">
                              <CornerDownRight className="w-3 h-3 text-[#1877F2] dark:text-[#60A5FA]" />
                              Replying to{' '}
                              <strong className="text-[#0F172A] dark:text-white">
                                {replyingTo.replyToName}
                              </strong>
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                setReplyingTo(null);
                                setReplyText('');
                              }}
                              aria-label="Cancel reply"
                              className="p-0.5 rounded hover:bg-[#F4F6F9] dark:hover:bg-[#232732] cursor-pointer"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          <div className="flex items-center gap-2">
                            <Avatar src={currentUser.avatar_url} name={currentUser.name} size="xs" />
                            <div className="flex-1 flex items-center gap-2 bg-[#F4F6F9] dark:bg-[#0E1014] rounded-xl px-3 py-1.5 border border-[#1877F2]/40 focus-within:border-[#1877F2] dark:focus-within:border-[#3B82F6]">
                              <input
                                ref={replyInputRef}
                                type="text"
                                maxLength={1000}
                                value={replyText}
                                onChange={(e) => setReplyText(e.target.value)}
                                placeholder={`Reply to ${replyingTo.replyToName}...`}
                                className="flex-1 bg-transparent text-sm text-[#0F172A] dark:text-[#F1F5F9] placeholder:text-[#64748B] dark:placeholder:text-[#94A3B8] focus:outline-none"
                              />
                              <button
                                type="submit"
                                disabled={!replyText.trim() || submittingReply}
                                aria-label="Send reply"
                                className="p-1.5 rounded-lg text-[#1877F2] dark:text-[#60A5FA] hover:bg-[#1877F2]/10 disabled:opacity-40 transition-colors cursor-pointer"
                              >
                                <Send className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        </form>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {!post.comments_disabled && (
              <form onSubmit={handleCommentSubmit} className="flex items-center gap-2 pt-1">
                <Avatar src={currentUser.avatar_url} name={currentUser.name} size="xs" />
                <div className="flex-1 flex items-center gap-2 bg-[#F4F6F9] dark:bg-[#0E1014] rounded-xl px-3 py-1.5 border border-transparent focus-within:border-[#1877F2] dark:focus-within:border-[#3B82F6]">
                  <input
                    type="text"
                    maxLength={1000}
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
            )}

            {commentError && (
              <p
                role="alert"
                className="flex items-center gap-1.5 text-xs font-medium text-[#DC2626] dark:text-[#F87171] pl-8"
              >
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>{commentError}</span>
              </p>
            )}
          </div>
        )}
      </article>

      {/* PEOPLE WHO REACTED POPUP (Real-time Firestore onSnapshot + [All] [👍] [❤️] [🥰] [😆] [😮] [😢] [😡] filters) */}
      {reactionViewerOpen && (
        <ReactionViewerModal
          items={liveReactions?.items || []}
          reactionCounts={effectiveReactionCounts}
          currentUserUid={currentUser.uid}
          onClose={() => setReactionViewerOpen(false)}
          onOpenProfile={onOpenProfile}
        />
      )}

      {/* 3-DOT BOTTOM POPUP SHEET (Facebook-style) */}
      {menuOpen && (
        <div
          onClick={() => setMenuOpen(false)}
          className="fixed inset-0 z-[115] bg-black/55 backdrop-blur-[1px] flex items-end sm:items-center justify-center p-0 sm:p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-sm bg-white dark:bg-[#181B22] border-t sm:border border-[#E5E8EE] dark:border-[#2A303E] rounded-t-3xl sm:rounded-2xl shadow-2xl overflow-hidden pb-3 sm:pb-2"
          >
            {/* Mobile grab bar */}
            <div className="sm:hidden flex justify-center pt-2.5 pb-1">
              <div className="w-10 h-1 rounded-full bg-[#CBD5E1] dark:bg-[#3B4252]" />
            </div>

            <div className="px-4 py-2.5 border-b border-[#E5E8EE] dark:border-[#252A34] flex items-center justify-between">
              <span className="font-display font-bold text-sm text-[#0F172A] dark:text-white">
                Post Options
              </span>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                className="p-1.5 rounded-full text-[#64748B] hover:bg-[#F4F6F9] dark:hover:bg-[#252A34] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {actionError && (
              <div className="mx-3 mt-2.5 px-3 py-2 rounded-xl bg-[#FEF2F2] dark:bg-[#3B181A] text-xs text-[#B91C1C] dark:text-[#FCA5A5] flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{actionError}</span>
              </div>
            )}

            <div className="p-2 space-y-0.5">
              {isOwner ? (
                <>
                  {/* MY POST OPTIONS */}
                  <button
                    type="button"
                    onClick={openEditModal}
                    className="w-full px-3.5 py-3 rounded-xl flex items-center gap-3 text-left hover:bg-[#F4F6F9] dark:hover:bg-[#232732] transition-colors cursor-pointer"
                  >
                    <span className="w-9 h-9 rounded-full bg-[#F1F5F9] dark:bg-[#252B37] text-[#0F172A] dark:text-white flex items-center justify-center shrink-0">
                      <Pencil className="w-4 h-4" />
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-[#0F172A] dark:text-white">
                        Edit Post
                      </p>
                      <p className="text-xs text-[#64748B] dark:text-[#94A3B8]">
                        Update text or photo in real time
                      </p>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      setActionError(null);
                      setDeleteModalOpen(true);
                    }}
                    className="w-full px-3.5 py-3 rounded-xl flex items-center gap-3 text-left hover:bg-[#FEF2F2] dark:hover:bg-[#3B181A]/60 transition-colors cursor-pointer"
                  >
                    <span className="w-9 h-9 rounded-full bg-[#FEF2F2] dark:bg-[#3B181A] text-[#DC2626] dark:text-[#F87171] flex items-center justify-center shrink-0">
                      <Trash2 className="w-4 h-4" />
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-[#DC2626] dark:text-[#F87171]">
                        Delete Post
                      </p>
                      <p className="text-xs text-[#64748B] dark:text-[#94A3B8]">
                        Permanently remove from Firestore &amp; Storage
                      </p>
                    </div>
                  </button>

                  <button
                    type="button"
                    disabled={menuActionBusy}
                    onClick={handleToggleCommentsOff}
                    className="w-full px-3.5 py-3 rounded-xl flex items-center gap-3 text-left hover:bg-[#F4F6F9] dark:hover:bg-[#232732] transition-colors cursor-pointer"
                  >
                    <span className="w-9 h-9 rounded-full bg-[#F1F5F9] dark:bg-[#252B37] text-[#0F172A] dark:text-white flex items-center justify-center shrink-0">
                      <MessageCircleOff className="w-4 h-4" />
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-[#0F172A] dark:text-white">
                        {post.comments_disabled ? 'Turn On Comments' : 'Turn Off Comments'}
                      </p>
                      <p className="text-xs text-[#64748B] dark:text-[#94A3B8]">
                        {post.comments_disabled
                          ? 'Allow people to comment and reply again'
                          : 'Stop new comments on this post'}
                      </p>
                    </div>
                  </button>

                  {onHidePost && (
                    <button
                      type="button"
                      disabled={menuActionBusy}
                      onClick={handleHidePostAction}
                      className="w-full px-3.5 py-3 rounded-xl flex items-center gap-3 text-left hover:bg-[#F4F6F9] dark:hover:bg-[#232732] transition-colors cursor-pointer"
                    >
                      <span className="w-9 h-9 rounded-full bg-[#F1F5F9] dark:bg-[#252B37] text-[#0F172A] dark:text-white flex items-center justify-center shrink-0">
                        <EyeOff className="w-4 h-4" />
                      </span>
                      <div>
                        <p className="text-sm font-semibold text-[#0F172A] dark:text-white">
                          Hide Post
                        </p>
                        <p className="text-xs text-[#64748B] dark:text-[#94A3B8]">
                          Remove this post from your Home feed
                        </p>
                      </div>
                    </button>
                  )}

                  {onToggleSave && (
                    <button
                      type="button"
                      onClick={() => {
                        onToggleSave(post.id);
                        setMenuOpen(false);
                      }}
                      className="w-full px-3.5 py-3 rounded-xl flex items-center gap-3 text-left hover:bg-[#F4F6F9] dark:hover:bg-[#232732] transition-colors cursor-pointer"
                    >
                      <span className="w-9 h-9 rounded-full bg-[#F1F5F9] dark:bg-[#252B37] text-[#0F172A] dark:text-white flex items-center justify-center shrink-0">
                        <Bookmark className={`w-4 h-4 ${post.saved_by_me ? 'fill-current text-[#7C3AED]' : ''}`} />
                      </span>
                      <div>
                        <p className="text-sm font-semibold text-[#0F172A] dark:text-white">
                          {post.saved_by_me ? 'Unsave Post' : 'Save Post'}
                        </p>
                        <p className="text-xs text-[#64748B] dark:text-[#94A3B8]">
                          {post.saved_by_me ? 'Remove from Saved' : 'Add to your Saved items'}
                        </p>
                      </div>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={handleCopyLink}
                    className="w-full px-3.5 py-3 rounded-xl flex items-center gap-3 text-left hover:bg-[#F4F6F9] dark:hover:bg-[#232732] transition-colors cursor-pointer"
                  >
                    <span className="w-9 h-9 rounded-full bg-[#F1F5F9] dark:bg-[#252B37] text-[#0F172A] dark:text-white flex items-center justify-center shrink-0">
                      <Link2 className="w-4 h-4" />
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-[#0F172A] dark:text-white">
                        Copy Link
                      </p>
                      <p className="text-xs text-[#64748B] dark:text-[#94A3B8]">
                        Copy direct link to this post
                      </p>
                    </div>
                  </button>
                </>
              ) : (
                <>
                  {/* OTHER'S POST OPTIONS */}
                  {onToggleSave && (
                    <button
                      type="button"
                      onClick={() => {
                        onToggleSave(post.id);
                        setMenuOpen(false);
                      }}
                      className="w-full px-3.5 py-3 rounded-xl flex items-center gap-3 text-left hover:bg-[#F4F6F9] dark:hover:bg-[#232732] transition-colors cursor-pointer"
                    >
                      <span className="w-9 h-9 rounded-full bg-[#F1F5F9] dark:bg-[#252B37] text-[#0F172A] dark:text-white flex items-center justify-center shrink-0">
                        <Bookmark className={`w-4 h-4 ${post.saved_by_me ? 'fill-current text-[#7C3AED]' : ''}`} />
                      </span>
                      <div>
                        <p className="text-sm font-semibold text-[#0F172A] dark:text-white">
                          {post.saved_by_me ? 'Unsave Post' : 'Save Post'}
                        </p>
                        <p className="text-xs text-[#64748B] dark:text-[#94A3B8]">
                          {post.saved_by_me ? 'Remove from Saved' : 'Bookmark permanently in Saved'}
                        </p>
                      </div>
                    </button>
                  )}

                  {onHidePost && (
                    <button
                      type="button"
                      disabled={menuActionBusy}
                      onClick={handleHidePostAction}
                      className="w-full px-3.5 py-3 rounded-xl flex items-center gap-3 text-left hover:bg-[#F4F6F9] dark:hover:bg-[#232732] transition-colors cursor-pointer"
                    >
                      <span className="w-9 h-9 rounded-full bg-[#F1F5F9] dark:bg-[#252B37] text-[#0F172A] dark:text-white flex items-center justify-center shrink-0">
                        <EyeOff className="w-4 h-4" />
                      </span>
                      <div>
                        <p className="text-sm font-semibold text-[#0F172A] dark:text-white">
                          Hide Post
                        </p>
                        <p className="text-xs text-[#64748B] dark:text-[#94A3B8]">
                          See fewer posts like this in your feed
                        </p>
                      </div>
                    </button>
                  )}

                  {onToggleFollowAuthor && post.author_uid && (
                    <button
                      type="button"
                      disabled={menuActionBusy}
                      onClick={handleUnfollowAction}
                      className="w-full px-3.5 py-3 rounded-xl flex items-center gap-3 text-left hover:bg-[#F4F6F9] dark:hover:bg-[#232732] transition-colors cursor-pointer"
                    >
                      <span className="w-9 h-9 rounded-full bg-[#F1F5F9] dark:bg-[#252B37] text-[#0F172A] dark:text-white flex items-center justify-center shrink-0">
                        {isFollowingAuthor ? (
                          <UserMinus className="w-4 h-4" />
                        ) : (
                          <UserPlus className="w-4 h-4" />
                        )}
                      </span>
                      <div>
                        <p className="text-sm font-semibold text-[#0F172A] dark:text-white">
                          {isFollowingAuthor
                            ? `Unfollow ${post.author_name}`
                            : `Follow ${post.author_name}`}
                        </p>
                        <p className="text-xs text-[#64748B] dark:text-[#94A3B8]">
                          {isFollowingAuthor
                            ? 'Stop following their updates'
                            : 'Follow their public updates'}
                        </p>
                      </div>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      setActionError(null);
                      setReportSuccess(false);
                      setReportModalOpen(true);
                    }}
                    className="w-full px-3.5 py-3 rounded-xl flex items-center gap-3 text-left hover:bg-[#FEF2F2] dark:hover:bg-[#3B181A]/60 transition-colors cursor-pointer"
                  >
                    <span className="w-9 h-9 rounded-full bg-[#FEF2F2] dark:bg-[#3B181A] text-[#DC2626] dark:text-[#F87171] flex items-center justify-center shrink-0">
                      <Flag className="w-4 h-4" />
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-[#DC2626] dark:text-[#F87171]">
                        Report Post
                      </p>
                      <p className="text-xs text-[#64748B] dark:text-[#94A3B8]">
                        Flag inappropriate or harmful content
                      </p>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={handleCopyLink}
                    className="w-full px-3.5 py-3 rounded-xl flex items-center gap-3 text-left hover:bg-[#F4F6F9] dark:hover:bg-[#232732] transition-colors cursor-pointer"
                  >
                    <span className="w-9 h-9 rounded-full bg-[#F1F5F9] dark:bg-[#252B37] text-[#0F172A] dark:text-white flex items-center justify-center shrink-0">
                      <Link2 className="w-4 h-4" />
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-[#0F172A] dark:text-white">
                        Copy Link
                      </p>
                      <p className="text-xs text-[#64748B] dark:text-[#94A3B8]">
                        Copy direct link to this post
                      </p>
                    </div>
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* CONFIRM DELETE POPUP MODAL */}
      {deleteModalOpen && (
        <div
          onClick={() => !deletingPost && setDeleteModalOpen(false)}
          className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm bg-white dark:bg-[#181B22] border border-[#E5E8EE] dark:border-[#2A303E] rounded-2xl shadow-2xl p-5 space-y-4"
          >
            <div className="space-y-1.5">
              <h3 className="font-display font-bold text-base text-[#0F172A] dark:text-white">
                Delete Post?
              </h3>
              <p className="text-sm text-[#475569] dark:text-[#94A3B8]">
                Are you sure you want to delete this post? It will be permanently removed from your
                Feed, Profile, and Storage.
              </p>
            </div>

            {actionError && (
              <p className="text-xs font-medium text-[#DC2626] dark:text-[#FCA5A5]">{actionError}</p>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                disabled={deletingPost}
                onClick={() => setDeleteModalOpen(false)}
                className="px-4 h-10 rounded-xl bg-[#F4F6F9] dark:bg-[#232732] hover:bg-[#E5E8EE] dark:hover:bg-[#2D3342] text-sm font-semibold text-[#0F172A] dark:text-white cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deletingPost}
                onClick={handleConfirmDeletePost}
                className="inline-flex items-center gap-2 px-4 h-10 rounded-xl bg-[#DC2626] hover:bg-[#B91C1C] text-white text-sm font-semibold disabled:opacity-50 cursor-pointer"
              >
                {deletingPost && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>{deletingPost ? 'Deleting...' : 'Delete'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* EDIT POST MODAL */}
      {editModalOpen && (
        <div
          onClick={() => !savingEdit && setEditModalOpen(false)}
          className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <form
            onSubmit={handleSaveEdit}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg bg-white dark:bg-[#181B22] border border-[#E5E8EE] dark:border-[#2A303E] rounded-2xl shadow-2xl overflow-hidden"
          >
            <div className="px-5 py-3.5 border-b border-[#E5E8EE] dark:border-[#252A34] flex items-center justify-between">
              <h3 className="font-display font-bold text-base text-[#0F172A] dark:text-white">
                Edit Post
              </h3>
              <button
                type="button"
                onClick={() => setEditModalOpen(false)}
                className="p-1.5 rounded-full text-[#64748B] hover:bg-[#F4F6F9] dark:hover:bg-[#252A34] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
              {actionError && (
                <div className="px-3 py-2 rounded-xl bg-[#FEF2F2] dark:bg-[#3B181A] text-xs text-[#B91C1C] dark:text-[#FCA5A5]">
                  {actionError}
                </div>
              )}

              <textarea
                rows={4}
                maxLength={2000}
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                placeholder="Update your post..."
                className="w-full p-3.5 rounded-xl bg-[#F4F6F9] dark:bg-[#0E1014] text-sm text-[#0F172A] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1877F2]"
              />

              {editImageUrl && (
                <div className="relative rounded-xl overflow-hidden border border-[#E5E8EE] dark:border-[#252A34] bg-[#0F1115]">
                  {resolvedEditPreview && (
                    <img
                      src={resolvedEditPreview}
                      alt="Post photo"
                      className="w-full max-h-64 object-cover block"
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => setEditImageUrl(null)}
                    aria-label="Remove photo"
                    className="absolute top-2.5 right-2.5 w-8 h-8 rounded-full bg-black/75 text-white flex items-center justify-center cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}

              <div>
                <input
                  ref={editPhotoInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleEditPhotoPick}
                  className="hidden"
                />
                <button
                  type="button"
                  disabled={uploadingEditPhoto}
                  onClick={() => editPhotoInputRef.current?.click()}
                  className="inline-flex items-center gap-2 px-3.5 h-9 rounded-xl bg-[#F4F6F9] dark:bg-[#232732] hover:bg-[#E5E8EE] dark:hover:bg-[#2D3342] text-xs font-semibold text-[#0F172A] dark:text-white cursor-pointer"
                >
                  {uploadingEditPhoto ? (
                    <Loader2 className="w-4 h-4 animate-spin text-[#16A34A]" />
                  ) : (
                    <ImagePlus className="w-4 h-4 text-[#16A34A]" />
                  )}
                  <span>{editImageUrl ? 'Replace Photo' : 'Add Photo'}</span>
                </button>
              </div>
            </div>

            <div className="px-5 py-3.5 border-t border-[#E5E8EE] dark:border-[#252A34] flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={savingEdit}
                onClick={() => setEditModalOpen(false)}
                className="px-4 h-10 rounded-xl text-sm font-semibold text-[#64748B] hover:bg-[#F4F6F9] dark:hover:bg-[#232732] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={
                  savingEdit ||
                  uploadingEditPhoto ||
                  (!editContent.trim() && !editImageUrl && !editVideoUrl)
                }
                className="inline-flex items-center gap-2 px-5 h-10 rounded-xl bg-[#1877F2] hover:bg-[#166FE5] text-white text-sm font-semibold disabled:opacity-50 cursor-pointer"
              >
                {savingEdit && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>{savingEdit ? 'Saving...' : 'Save Changes'}</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* REPORT POST MODAL */}
      {reportModalOpen && (
        <div
          onClick={() => !submittingReport && setReportModalOpen(false)}
          className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <form
            onSubmit={handleSubmitReport}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md bg-white dark:bg-[#181B22] border border-[#E5E8EE] dark:border-[#2A303E] rounded-2xl shadow-2xl overflow-hidden"
          >
            <div className="px-5 py-3.5 border-b border-[#E5E8EE] dark:border-[#252A34] flex items-center justify-between">
              <h3 className="font-display font-bold text-base text-[#0F172A] dark:text-white">
                Report Post
              </h3>
              <button
                type="button"
                onClick={() => setReportModalOpen(false)}
                className="p-1.5 rounded-full text-[#64748B] hover:bg-[#F4F6F9] dark:hover:bg-[#252A34] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {reportSuccess ? (
              <div className="p-6 text-center space-y-2">
                <span className="w-12 h-12 rounded-full bg-[#ECFDF5] dark:bg-[#0F2E22] text-[#16A34A] dark:text-[#4ADE80] mx-auto flex items-center justify-center">
                  <Check className="w-6 h-6" />
                </span>
                <p className="font-display font-bold text-sm text-[#0F172A] dark:text-white">
                  Report submitted
                </p>
                <p className="text-xs text-[#64748B] dark:text-[#94A3B8]">
                  Saved to Firestore moderation queue. Thank you for keeping Verve safe.
                </p>
              </div>
            ) : (
              <>
                <div className="p-5 space-y-3">
                  {actionError && (
                    <div className="px-3 py-2 rounded-xl bg-[#FEF2F2] dark:bg-[#3B181A] text-xs text-[#B91C1C] dark:text-[#FCA5A5]">
                      {actionError}
                    </div>
                  )}

                  <p className="text-xs text-[#64748B] dark:text-[#94A3B8]">
                    Select why you are reporting this post:
                  </p>
                  <div className="space-y-1.5">
                    {REPORT_REASONS.map((r) => (
                      <label
                        key={r.value}
                        className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                          reportReason === r.value
                            ? 'border-[#1877F2] bg-[#1877F2]/6 dark:bg-[#3B82F6]/12'
                            : 'border-[#E5E8EE] dark:border-[#252A34] hover:bg-[#F8FAFC] dark:hover:bg-[#1E222B]'
                        }`}
                      >
                        <input
                          type="radio"
                          name="report-reason"
                          checked={reportReason === r.value}
                          onChange={() => setReportReason(r.value)}
                          className="mt-0.5 accent-[#1877F2]"
                        />
                        <div>
                          <p className="text-xs font-semibold text-[#0F172A] dark:text-white">
                            {r.label}
                          </p>
                          <p className="text-[11px] text-[#64748B] dark:text-[#94A3B8]">
                            {r.desc}
                          </p>
                        </div>
                      </label>
                    ))}
                  </div>

                  <textarea
                    rows={2}
                    maxLength={500}
                    value={reportDetails}
                    onChange={(e) => setReportDetails(e.target.value)}
                    placeholder="Additional details (optional)..."
                    className="w-full p-3 rounded-xl bg-[#F4F6F9] dark:bg-[#0E1014] text-xs text-[#0F172A] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1877F2]"
                  />
                </div>

                <div className="px-5 py-3.5 border-t border-[#E5E8EE] dark:border-[#252A34] flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setReportModalOpen(false)}
                    className="px-4 h-9 rounded-xl text-xs font-semibold text-[#64748B] cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submittingReport}
                    className="inline-flex items-center gap-1.5 px-4 h-9 rounded-xl bg-[#DC2626] hover:bg-[#B91C1C] text-white text-xs font-semibold disabled:opacity-50 cursor-pointer"
                  >
                    {submittingReport && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    <span>{submittingReport ? 'Submitting...' : 'Submit Report'}</span>
                  </button>
                </div>
              </>
            )}
          </form>
        </div>
      )}
    </>
  );
}
