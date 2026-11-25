import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Eye,
  Heart,
  Image as ImageIcon,
  Loader2,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  Send,
  Trash2,
  Type,
  Video as VideoIcon,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import type {
  StoryItem,
  StoryMediaType,
  StoryReactionItem,
  StoryReactionType,
  StoryViewerItem,
  UserProfile,
  UserStoryGroup,
} from '../types';
import {
  createStoryPermanent,
  deleteStoryPermanent,
  formatStoryTimeAgo,
  getLocalSeenStoryIds,
  getMyStoryReaction,
  getStoryGradientClass,
  markStorySeenLocal,
  reactToStoryPermanent,
  recordStoryViewPermanent,
  replyToStoryPermanent,
  STORY_GRADIENTS,
  STORY_REACTION_MAP,
  STORY_REACTIONS,
  subscribeActiveStoriesPermanent,
  subscribeStoryReactionsPermanent,
  subscribeStoryViewersPermanent,
  syncSeenStoryIdsFromFirestore,
} from '../lib/storyService';
import {
  compressImageToJpeg,
  extractVideoMetadata,
  MAX_VIDEO_BYTES,
  MAX_VIDEO_DURATION_SEC,
  resolveCloudVideoUrl,
  uploadPostVideoPermanent,
} from '../lib/mediaUpload';
import {Avatar} from './MediaImage';

const PHOTO_TEXT_STORY_DURATION_MS = 5000; // 5 seconds per photo/text story

interface StoriesBarProps {
  currentUser: UserProfile;
  hiddenUserUids: Set<string>;
  onOpenProfile?: (userId: number) => void;
}

export function StoriesBar({currentUser, hiddenUserUids}: StoriesBarProps) {
  const myUid = currentUser.uid || '';
  const [stories, setStories] = useState<StoryItem[]>([]);
  const [seenIds, setSeenIds] = useState<Set<string>>(() => getLocalSeenStoryIds(myUid));
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [creatorOpen, setCreatorOpen] = useState(false);
  const [viewerTarget, setViewerTarget] = useState<{groupIndex: number; storyIndex: number} | null>(
    null,
  );
  const syncedIdsRef = useRef<Set<string>>(new Set());

  // Reset local seen cache when switching signed-in user
  useEffect(() => {
    setSeenIds(getLocalSeenStoryIds(myUid));
    syncedIdsRef.current = new Set();
  }, [myUid]);

  // Real-time Firestore subscription to all active (<24h) stories
  useEffect(() => {
    if (!myUid) return;
    const unsub = subscribeActiveStoriesPermanent(myUid, (nextStories) => {
      setStories(nextStories);
    });
    return () => unsub();
  }, [myUid]);

  // Periodic 30-second expiry clock so stories auto-disappear & auto-delete right at 24h
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowTick(Date.now());
    }, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  // Auto-delete any own story that crossed 24h while the page stayed open
  useEffect(() => {
    if (!myUid) return;
    for (const s of stories) {
      if (s.expiresAtMs <= nowTick && s.userId === myUid) {
        void deleteStoryPermanent(s, myUid);
      }
    }
  }, [stories, nowTick, myUid]);

  // Sync viewed status from Firestore for active stories not yet in localStorage (cross-device Blue Ring sync)
  useEffect(() => {
    if (!myUid || stories.length === 0) return;
    const toCheck = stories
      .filter((s) => s.userId !== myUid && !seenIds.has(s.id) && !syncedIdsRef.current.has(s.id))
      .map((s) => s.id);
    if (toCheck.length === 0) return;
    toCheck.forEach((id) => syncedIdsRef.current.add(id));

    let cancelled = false;
    void syncSeenStoryIdsFromFirestore(toCheck, myUid).then((found) => {
      if (cancelled || found.length === 0) return;
      setSeenIds((prev) => {
        const next = new Set(prev);
        found.forEach((id) => next.add(id));
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [stories, myUid, seenIds]);

  // Filter out expired & blocked/suspended users and group by user
  const storyGroups: UserStoryGroup[] = useMemo(() => {
    const byUser = new Map<string, StoryItem[]>();
    for (const s of stories) {
      if (s.expiresAtMs <= nowTick) continue;
      if (s.userId !== myUid && hiddenUserUids.has(s.userId)) continue;
      const list = byUser.get(s.userId);
      if (list) {
        list.push(s);
      } else {
        byUser.set(s.userId, [s]);
      }
    }

    const groups: UserStoryGroup[] = [];
    for (const [userId, userStories] of byUser.entries()) {
      userStories.sort((a, b) => a.createdAtMs - b.createdAtMs);
      const latest = userStories[userStories.length - 1];
      const hasUnseen = userStories.some((s) => !seenIds.has(s.id));
      groups.push({
        userId,
        userName: userId === myUid ? currentUser.name : latest.userName,
        userPhoto: userId === myUid ? currentUser.avatar_url : latest.userPhoto,
        stories: userStories,
        hasUnseen,
        latestCreatedAtMs: latest.createdAtMs,
      });
    }

    // Order: Current user's own story first (if any), then unseen stories (Blue Ring), then seen stories
    groups.sort((a, b) => {
      if (a.userId === myUid) return -1;
      if (b.userId === myUid) return 1;
      if (a.hasUnseen !== b.hasUnseen) return a.hasUnseen ? -1 : 1;
      return b.latestCreatedAtMs - a.latestCreatedAtMs;
    });

    return groups;
  }, [stories, nowTick, hiddenUserUids, myUid, seenIds, currentUser.name, currentUser.avatar_url]);

  const handleMarkSeen = useCallback(
    (storyId: string) => {
      if (!myUid || !storyId) return;
      markStorySeenLocal(myUid, storyId);
      setSeenIds((prev) => {
        if (prev.has(storyId)) return prev;
        const next = new Set(prev);
        next.add(storyId);
        return next;
      });
    },
    [myUid],
  );

  function openGroup(groupIdx: number) {
    const grp = storyGroups[groupIdx];
    if (!grp || grp.stories.length === 0) return;
    // Start on first unseen story if available, else first story
    const firstUnseen = grp.stories.findIndex((s) => !seenIds.has(s.id));
    setViewerTarget({
      groupIndex: groupIdx,
      storyIndex: firstUnseen >= 0 ? firstUnseen : 0,
    });
  }

  return (
    <>
      <section
        aria-label="Stories"
        className="bg-white dark:bg-[#1C1E21] border border-[#E4E6EB] dark:border-[#2E3035] rounded-2xl px-3.5 py-3.5 shadow-[0_1px_2px_rgba(0,0,0,0.03)]"
      >
        <div className="flex items-start gap-3.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {/* Add Story Box */}
          <button
            type="button"
            onClick={() => setCreatorOpen(true)}
            className="group flex flex-col items-center gap-1.5 shrink-0 w-[74px] cursor-pointer focus:outline-none"
          >
            <div className="relative w-[64px] h-[64px] rounded-full p-[3px] border-2 border-dashed border-[#1877F2]/60 group-hover:border-[#1877F2] transition-colors bg-[#F0F2F5] dark:bg-[#232732] flex items-center justify-center">
              <Avatar
                src={currentUser.avatar_url}
                name={currentUser.name}
                size="lg"
                className="!w-full !h-full"
              />
              <span className="absolute -bottom-0.5 -right-0.5 w-6 h-6 rounded-full bg-[#1877F2] text-white border-2 border-white dark:border-[#1C1E21] flex items-center justify-center shadow-sm group-hover:scale-105 transition-transform">
                <Plus className="w-3.5 h-3.5 stroke-[3]" />
              </span>
            </div>
            <span className="text-[11px] font-semibold text-[#111827] dark:text-[#F3F4F6] truncate w-full text-center leading-tight">
              Add Story
            </span>
          </button>

          {/* Circular Facebook-style Story Items (Blue Ring for unseen, ring gone once viewed) */}
          {storyGroups.map((group, idx) => {
            const isMine = group.userId === myUid;
            const firstName = isMine
              ? 'Your Story'
              : group.userName.trim().split(/\s+/)[0] || group.userName;
            const latest = group.stories[group.stories.length - 1];

            return (
              <button
                key={group.userId}
                type="button"
                onClick={() => openGroup(idx)}
                className="group flex flex-col items-center gap-1.5 shrink-0 w-[74px] cursor-pointer focus:outline-none"
              >
                <div
                  className={`relative w-[64px] h-[64px] rounded-full p-[3px] transition-all ${
                    group.hasUnseen
                      ? 'ring-[3px] ring-[#1877F2] bg-white dark:bg-[#1C1E21]'
                      : 'ring-1 ring-[#D1D5DB] dark:ring-[#3A3D45] bg-transparent'
                  }`}
                >
                  <div className="w-full h-full rounded-full overflow-hidden relative bg-[#F0F2F5] dark:bg-[#2A2D32]">
                    {latest.mediaType === 'image' && latest.storyImage ? (
                      <img
                        src={latest.storyImage}
                        alt={`${group.userName}'s story`}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                      />
                    ) : latest.mediaType === 'video' && latest.storyImage ? (
                      <img
                        src={latest.storyImage}
                        alt={`${group.userName}'s video story`}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                      />
                    ) : latest.mediaType === 'text' ? (
                      <div
                        className={`w-full h-full flex items-center justify-center p-1.5 ${getStoryGradientClass(
                          latest.bgGradient,
                        )}`}
                      >
                        <span className="text-[9px] font-bold text-white text-center line-clamp-3 leading-tight">
                          {latest.textContent}
                        </span>
                      </div>
                    ) : (
                      <Avatar
                        src={group.userPhoto}
                        name={group.userName}
                        size="lg"
                        className="!w-full !h-full"
                      />
                    )}
                  </div>

                  {/* Mini owner avatar badge at bottom-right so you instantly recognize who posted */}
                  <div className="absolute -bottom-0.5 -right-0.5 w-6 h-6 rounded-full border-2 border-white dark:border-[#1C1E21] overflow-hidden bg-white dark:bg-[#1C1E21] shadow-xs">
                    <Avatar
                      src={group.userPhoto}
                      name={group.userName}
                      size="xs"
                      className="!w-full !h-full"
                    />
                  </div>

                  {/* Multi-story count pill */}
                  {group.stories.length > 1 && (
                    <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[#1877F2] text-white text-[10px] font-bold border-2 border-white dark:border-[#1C1E21] flex items-center justify-center tabular-nums">
                      {group.stories.length}
                    </span>
                  )}
                </div>

                <span
                  className={`text-[11px] truncate w-full text-center leading-tight ${
                    group.hasUnseen
                      ? 'font-bold text-[#111827] dark:text-white'
                      : 'font-medium text-[#65676B] dark:text-[#9CA3AF]'
                  }`}
                >
                  {firstName}
                </span>
              </button>
            );
          })}

          {storyGroups.length === 0 && (
            <button
              type="button"
              onClick={() => setCreatorOpen(true)}
              className="flex-1 min-w-[180px] h-[64px] rounded-xl border border-dashed border-[#D8DDE6] dark:border-[#323640] bg-[#F8FAFC] dark:bg-[#16181D] hover:bg-[#F0F2F5] dark:hover:bg-[#22252C] px-4 flex items-center justify-between gap-3 text-left transition-colors cursor-pointer"
            >
              <div>
                <p className="text-xs font-semibold text-[#111827] dark:text-white">
                  Share a photo, video, or text story
                </p>
                <p className="text-[11px] text-[#65676B] dark:text-[#9CA3AF]">
                  Disappears automatically after 24 hours
                </p>
              </div>
              <span className="text-xs font-semibold text-[#1877F2] shrink-0">Create</span>
            </button>
          )}
        </div>
      </section>

      {creatorOpen && (
        <CreateStoryModal
          currentUser={currentUser}
          onClose={() => setCreatorOpen(false)}
          onCreated={() => {
            setCreatorOpen(false);
          }}
        />
      )}

      {viewerTarget && storyGroups.length > 0 && (
        <StoryViewerModal
          currentUser={currentUser}
          groups={storyGroups}
          initialGroupIndex={Math.min(viewerTarget.groupIndex, storyGroups.length - 1)}
          initialStoryIndex={viewerTarget.storyIndex}
          onMarkSeen={handleMarkSeen}
          onOpenAddStory={() => {
            setViewerTarget(null);
            setCreatorOpen(true);
          }}
          onClose={() => setViewerTarget(null)}
        />
      )}
    </>
  );
}

/* ============================================================================
 * CREATE STORY MODAL (Photo / Video / Text -> Firestore `stories` with 24h TTL)
 * ============================================================================ */

interface CreateStoryModalProps {
  currentUser: UserProfile;
  onClose: () => void;
  onCreated: (story: StoryItem) => void;
}

function CreateStoryModal({currentUser, onClose, onCreated}: CreateStoryModalProps) {
  const [mode, setMode] = useState<StoryMediaType>('image');
  const [caption, setCaption] = useState('');
  const [textContent, setTextContent] = useState('');
  const [bgGradient, setBgGradient] = useState(STORY_GRADIENTS[0].id);

  // Photo state
  const [photoDataUrl, setPhotoDataUrl] = useState<string>('');
  const [photoPreparing, setPhotoPreparing] = useState(false);

  // Video state (uploads 100% before Share Story is enabled)
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string>('');
  const [videoThumb, setVideoThumb] = useState<string>('');
  const [videoDuration, setVideoDuration] = useState<number>(0);
  const [videoUploadedUrl, setVideoUploadedUrl] = useState<string>('');
  const [videoStoryId, setVideoStoryId] = useState<string>('');
  const [videoUploadPct, setVideoUploadPct] = useState<number>(0);
  const [videoUploadState, setVideoUploadState] = useState<
    'idle' | 'preparing' | 'uploading' | 'done' | 'error'
  >('idle');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const photoInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const videoUploadRunRef = useRef(0);

  useEffect(() => {
    return () => {
      if (videoPreviewUrl) {
        URL.revokeObjectURL(videoPreviewUrl);
      }
    };
  }, [videoPreviewUrl]);

  async function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
      reader.onerror = () => reject(new Error('Could not read image data.'));
      reader.readAsDataURL(blob);
    });
  }

  async function handlePickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Please select a valid image file.');
      return;
    }
    setError('');
    setPhotoPreparing(true);
    try {
      let blob = await compressImageToJpeg(file, 1080, 0.8);
      let dataUrl = await blobToDataUrl(blob);
      if (dataUrl.length > 520_000) {
        blob = await compressImageToJpeg(file, 840, 0.68);
        dataUrl = await blobToDataUrl(blob);
      }
      if (dataUrl.length > 540_000) {
        blob = await compressImageToJpeg(file, 680, 0.58);
        dataUrl = await blobToDataUrl(blob);
      }
      if (!dataUrl || dataUrl.length > 550_000) {
        throw new Error('Photo is too large. Please pick a smaller image.');
      }
      setPhotoDataUrl(dataUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not process image.');
    } finally {
      setPhotoPreparing(false);
    }
  }

  async function handlePickVideo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('video/')) {
      setError('Please select a valid video file.');
      return;
    }
    if (file.size > MAX_VIDEO_BYTES) {
      setError('Video must be 100 MB or smaller.');
      return;
    }

    const runId = ++videoUploadRunRef.current;
    setError('');
    setVideoUploadState('preparing');
    setVideoUploadPct(0);
    setVideoUploadedUrl('');
    if (videoPreviewUrl) {
      URL.revokeObjectURL(videoPreviewUrl);
    }
    const localUrl = URL.createObjectURL(file);
    setVideoPreviewUrl(localUrl);

    try {
      const meta = await extractVideoMetadata(file);
      if (runId !== videoUploadRunRef.current) return;
      if (meta.durationSec > MAX_VIDEO_DURATION_SEC) {
        setVideoUploadState('error');
        setError(`Story video must be ${MAX_VIDEO_DURATION_SEC} seconds or shorter.`);
        return;
      }
      if (!meta.durationSec || meta.durationSec <= 0) {
        setVideoUploadState('error');
        setError('Could not read video duration. Please pick another clip.');
        return;
      }

      setVideoThumb(meta.thumbnailDataUrl || '');
      setVideoDuration(Math.round(meta.durationSec));
      setVideoUploadState('uploading');

      const rand = Math.random().toString(36).slice(2, 10);
      const generatedStoryId = `story_${Date.now().toString(36)}_${rand}`;
      setVideoStoryId(generatedStoryId);

      const uploaded = await uploadPostVideoPermanent(file, {
        postId: generatedStoryId,
        durationSec: meta.durationSec,
        onProgress: (pct) => {
          if (runId === videoUploadRunRef.current) {
            setVideoUploadPct(pct);
          }
        },
      });

      if (runId !== videoUploadRunRef.current) return;
      setVideoUploadedUrl(uploaded.url);
      setVideoUploadPct(100);
      setVideoUploadState('done');
    } catch (err) {
      if (runId !== videoUploadRunRef.current) return;
      setVideoUploadState('error');
      setError(err instanceof Error ? err.message : 'Video upload failed. Please try again.');
    }
  }

  const canShare =
    !submitting &&
    ((mode === 'image' && Boolean(photoDataUrl) && !photoPreparing) ||
      (mode === 'video' && videoUploadState === 'done' && Boolean(videoUploadedUrl)) ||
      (mode === 'text' && textContent.trim().length > 0));

  async function handleSubmit() {
    if (!canShare) return;
    setSubmitting(true);
    setError('');
    try {
      const created = await createStoryPermanent(currentUser, {
        storyId: mode === 'video' ? videoStoryId : undefined,
        mediaType: mode,
        storyImage: mode === 'image' ? photoDataUrl : mode === 'video' ? videoThumb : '',
        storyVideo: mode === 'video' ? videoUploadedUrl : '',
        textContent: mode === 'text' ? textContent.trim() : '',
        bgGradient,
        caption: mode === 'text' ? '' : caption.trim(),
        durationSec: mode === 'video' ? videoDuration : 5,
      });
      onCreated(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not publish story.');
      setSubmitting(false);
    }
  }

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[130] bg-black/75 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-white dark:bg-[#1C1E21] border border-[#E4E6EB] dark:border-[#2E3035] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]"
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-[#E4E6EB] dark:border-[#2E3035] flex items-center justify-between">
          <h2 className="font-display font-bold text-base text-[#111827] dark:text-white">
            Create Story
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Create Story"
            className="w-8 h-8 rounded-full bg-[#F0F2F5] dark:bg-[#2A2D32] hover:bg-[#E4E6EB] dark:hover:bg-[#3A3D45] text-[#65676B] dark:text-[#D1D5DB] flex items-center justify-center cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Mode Tabs: Photo / Video / Text */}
        <div className="px-4 pt-3 pb-2 grid grid-cols-3 gap-2">
          {[
            {id: 'image' as StoryMediaType, label: 'Photo', icon: ImageIcon},
            {id: 'video' as StoryMediaType, label: 'Video', icon: VideoIcon},
            {id: 'text' as StoryMediaType, label: 'Text', icon: Type},
          ].map(({id, label, icon: Icon}) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setMode(id);
                setError('');
              }}
              className={`py-2 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                mode === id
                  ? 'bg-[#1877F2] text-white shadow-xs'
                  : 'bg-[#F0F2F5] dark:bg-[#262930] text-[#4B5563] dark:text-[#D1D5DB] hover:bg-[#E4E6EB] dark:hover:bg-[#32363F]'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{label}</span>
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="p-4 overflow-y-auto space-y-3">
          {error && (
            <div className="px-3 py-2 rounded-xl bg-[#FEF2F2] dark:bg-[#3B181A] border border-[#FECACA] dark:border-[#7F1D1D] text-xs font-medium text-[#DC2626] dark:text-[#FCA5A5]">
              {error}
            </div>
          )}

          {/* PHOTO STORY */}
          {mode === 'image' && (
            <div className="space-y-3">
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handlePickPhoto}
              />

              {photoDataUrl ? (
                <div className="relative rounded-2xl overflow-hidden bg-black aspect-[9/12] max-h-[360px] mx-auto flex items-center justify-center">
                  <img
                    src={photoDataUrl}
                    alt="Story preview"
                    className="w-full h-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => photoInputRef.current?.click()}
                    className="absolute top-3 right-3 px-3 py-1.5 rounded-full bg-black/65 hover:bg-black/80 text-white text-xs font-semibold cursor-pointer"
                  >
                    Change Photo
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={photoPreparing}
                  onClick={() => photoInputRef.current?.click()}
                  className="w-full h-56 rounded-2xl border-2 border-dashed border-[#D1D5DB] dark:border-[#3A3D45] hover:border-[#1877F2] bg-[#F8FAFC] dark:bg-[#16181D] flex flex-col items-center justify-center gap-2 text-center px-4 transition-colors cursor-pointer"
                >
                  {photoPreparing ? (
                    <Loader2 className="w-8 h-8 text-[#1877F2] animate-spin" />
                  ) : (
                    <div className="w-12 h-12 rounded-full bg-[#1877F2]/10 text-[#1877F2] flex items-center justify-center">
                      <ImageIcon className="w-6 h-6" />
                    </div>
                  )}
                  <p className="text-sm font-semibold text-[#111827] dark:text-white">
                    {photoPreparing ? 'Optimizing photo...' : 'Choose a photo from your device'}
                  </p>
                  <p className="text-xs text-[#65676B] dark:text-[#9CA3AF]">
                    Visible for 24 hours, then automatically deleted
                  </p>
                </button>
              )}

              <input
                type="text"
                maxLength={300}
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="Add a caption (optional)..."
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#F0F2F5] dark:bg-[#262930] border border-transparent focus:border-[#1877F2] text-sm text-[#111827] dark:text-white placeholder:text-[#65676B] dark:placeholder:text-[#9CA3AF] outline-none"
              />
            </div>
          )}

          {/* VIDEO STORY */}
          {mode === 'video' && (
            <div className="space-y-3">
              <input
                ref={videoInputRef}
                type="file"
                accept="video/*"
                className="hidden"
                onChange={handlePickVideo}
              />

              {videoPreviewUrl ? (
                <div className="relative rounded-2xl overflow-hidden bg-black aspect-[9/12] max-h-[340px] mx-auto flex items-center justify-center">
                  <video
                    src={videoPreviewUrl}
                    poster={videoThumb || undefined}
                    controls
                    playsInline
                    className="w-full h-full object-contain"
                  />
                  <button
                    type="button"
                    onClick={() => videoInputRef.current?.click()}
                    className="absolute top-3 right-3 px-3 py-1.5 rounded-full bg-black/70 hover:bg-black/85 text-white text-xs font-semibold cursor-pointer"
                  >
                    Change Video
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => videoInputRef.current?.click()}
                  className="w-full h-56 rounded-2xl border-2 border-dashed border-[#D1D5DB] dark:border-[#3A3D45] hover:border-[#1877F2] bg-[#F8FAFC] dark:bg-[#16181D] flex flex-col items-center justify-center gap-2 text-center px-4 transition-colors cursor-pointer"
                >
                  <div className="w-12 h-12 rounded-full bg-[#1877F2]/10 text-[#1877F2] flex items-center justify-center">
                    <VideoIcon className="w-6 h-6" />
                  </div>
                  <p className="text-sm font-semibold text-[#111827] dark:text-white">
                    Choose a video (up to {MAX_VIDEO_DURATION_SEC}s)
                  </p>
                  <p className="text-xs text-[#65676B] dark:text-[#9CA3AF]">
                    Uploads 100% before sharing • Auto-deletes after 24 hours
                  </p>
                </button>
              )}

              {/* Video upload progress */}
              {(videoUploadState === 'preparing' || videoUploadState === 'uploading') && (
                <div className="space-y-1.5 px-3 py-2.5 rounded-xl bg-[#EFF6FF] dark:bg-[#1E293B] border border-[#BFDBFE] dark:border-[#334155]">
                  <div className="flex items-center justify-between text-xs font-semibold text-[#1D4ED8] dark:text-[#93C5FD]">
                    <span className="inline-flex items-center gap-1.5">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      {videoUploadState === 'preparing'
                        ? 'Preparing video...'
                        : `Uploading Video... ${videoUploadPct}%`}
                    </span>
                    <span className="tabular-nums">{videoUploadPct}%</span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-[#DBEAFE] dark:bg-[#334155] overflow-hidden">
                    <div
                      className="h-full bg-[#1877F2] transition-all duration-200"
                      style={{width: `${Math.max(4, videoUploadPct)}%`}}
                    />
                  </div>
                </div>
              )}

              {videoUploadState === 'done' && (
                <div className="px-3 py-2 rounded-xl bg-[#ECFDF5] dark:bg-[#064E3B]/40 border border-[#A7F3D0] dark:border-[#065F46] text-xs font-semibold text-[#047857] dark:text-[#6EE7B7] flex items-center gap-1.5">
                  <Check className="w-4 h-4" />
                  <span>Video uploaded 100% — ready to share</span>
                </div>
              )}

              <input
                type="text"
                maxLength={300}
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="Add a caption (optional)..."
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#F0F2F5] dark:bg-[#262930] border border-transparent focus:border-[#1877F2] text-sm text-[#111827] dark:text-white placeholder:text-[#65676B] dark:placeholder:text-[#9CA3AF] outline-none"
              />
            </div>
          )}

          {/* TEXT STORY */}
          {mode === 'text' && (
            <div className="space-y-3">
              <div
                className={`rounded-2xl p-6 min-h-[260px] flex items-center justify-center shadow-inner ${getStoryGradientClass(
                  bgGradient,
                )}`}
              >
                <textarea
                  rows={4}
                  maxLength={500}
                  value={textContent}
                  onChange={(e) => setTextContent(e.target.value)}
                  placeholder="Start typing your story..."
                  className="w-full bg-transparent text-white placeholder:text-white/70 text-center text-xl font-display font-bold leading-snug resize-none outline-none"
                />
              </div>

              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-[#65676B] dark:text-[#9CA3AF]">
                  Background
                </span>
                <div className="flex items-center gap-2">
                  {STORY_GRADIENTS.map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      title={g.label}
                      onClick={() => setBgGradient(g.id)}
                      className={`w-7 h-7 rounded-full ${g.className} transition-transform cursor-pointer ${
                        bgGradient === g.id
                          ? 'ring-2 ring-offset-2 ring-[#1877F2] dark:ring-offset-[#1C1E21] scale-110'
                          : 'opacity-80 hover:opacity-100'
                      }`}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-[#E4E6EB] dark:border-[#2E3035] flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-[#4B5563] dark:text-[#D1D5DB] hover:bg-[#F0F2F5] dark:hover:bg-[#2A2D32] cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canShare}
            onClick={() => void handleSubmit()}
            className="px-5 py-2 rounded-xl bg-[#1877F2] hover:bg-[#166FE5] disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            <span>{submitting ? 'Sharing...' : 'Share to Story'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
 * FULL-SCREEN STORY VIEWER + OWN STORY "SEEN BY X" VIEWERS & REACTIONS SHEET
 * ============================================================================ */

interface StoryViewerModalProps {
  currentUser: UserProfile;
  groups: UserStoryGroup[];
  initialGroupIndex: number;
  initialStoryIndex: number;
  onMarkSeen: (storyId: string) => void;
  onOpenAddStory: () => void;
  onClose: () => void;
}

function StoryViewerModal({
  currentUser,
  groups,
  initialGroupIndex,
  initialStoryIndex,
  onMarkSeen,
  onOpenAddStory,
  onClose,
}: StoryViewerModalProps) {
  const myUid = currentUser.uid || '';
  const [groupIdx, setGroupIdx] = useState(initialGroupIndex);
  const [storyIdx, setStoryIdx] = useState(initialStoryIndex);
  const [progress, setProgress] = useState(0); // 0..100
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Own story viewers + reactions (real-time onSnapshot)
  const [viewers, setViewers] = useState<StoryViewerItem[]>([]);
  const [reactions, setReactions] = useState<StoryReactionItem[]>([]);
  const [viewersSheetOpen, setViewersSheetOpen] = useState(false);
  const [viewersTab, setViewersTab] = useState<'viewers' | 'reactions'>('viewers');

  // Viewer reply + reaction state (for other people's stories)
  const [replyText, setReplyText] = useState('');
  const [replyFocused, setReplyFocused] = useState(false);
  const [sendingReply, setSendingReply] = useState(false);
  const [myReaction, setMyReaction] = useState<StoryReactionType | null>(null);
  const [floatingEmoji, setFloatingEmoji] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Resolved video URL (handles Firebase downloadURL + permanent cloud fsvideo://)
  const [resolvedVideoUrl, setResolvedVideoUrl] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const safeGroupIdx = Math.min(Math.max(0, groupIdx), Math.max(0, groups.length - 1));
  const activeGroup = groups[safeGroupIdx];
  const safeStoryIdx = activeGroup
    ? Math.min(Math.max(0, storyIdx), Math.max(0, activeGroup.stories.length - 1))
    : 0;
  const activeStory = activeGroup?.stories[safeStoryIdx] || null;
  const isOwnStory = Boolean(activeStory && activeStory.userId === myUid);

  const isEffectivelyPaused =
    paused || menuOpen || viewersSheetOpen || replyFocused || deleting || sendingReply;

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    window.setTimeout(() => {
      setToastMsg((prev) => (prev === msg ? null : prev));
    }, 2200);
  }, []);

  // Navigation helpers
  const goNext = useCallback(() => {
    if (!activeGroup) {
      onClose();
      return;
    }
    if (safeStoryIdx + 1 < activeGroup.stories.length) {
      setStoryIdx(safeStoryIdx + 1);
      setProgress(0);
    } else if (safeGroupIdx + 1 < groups.length) {
      setGroupIdx(safeGroupIdx + 1);
      setStoryIdx(0);
      setProgress(0);
    } else {
      onClose();
    }
  }, [activeGroup, safeStoryIdx, safeGroupIdx, groups.length, onClose]);

  const goPrev = useCallback(() => {
    if (safeStoryIdx > 0) {
      setStoryIdx(safeStoryIdx - 1);
      setProgress(0);
    } else if (safeGroupIdx > 0) {
      const prevGroup = groups[safeGroupIdx - 1];
      setGroupIdx(safeGroupIdx - 1);
      setStoryIdx(Math.max(0, prevGroup.stories.length - 1));
      setProgress(0);
    } else {
      setProgress(0);
    }
  }, [safeStoryIdx, safeGroupIdx, groups]);

  // Keyboard shortcuts (Escape, ArrowRight, ArrowLeft)
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (replyFocused) return;
      if (e.key === 'Escape') {
        if (viewersSheetOpen) {
          setViewersSheetOpen(false);
        } else {
          onClose();
        }
      } else if (e.key === 'ArrowRight') {
        goNext();
      } else if (e.key === 'ArrowLeft') {
        goPrev();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [replyFocused, viewersSheetOpen, onClose, goNext, goPrev]);

  // Reset per-story transient state when active story changes
  useEffect(() => {
    setProgress(0);
    setMenuOpen(false);
    setReplyText('');
    setMyReaction(null);
    setViewers([]);
    setReactions([]);
    setResolvedVideoUrl(null);
  }, [activeStory?.id]);

  // Record real view in Firestore & clear Blue Ring immediately
  useEffect(() => {
    if (!activeStory || !myUid) return;
    onMarkSeen(activeStory.id);
    void recordStoryViewPermanent(activeStory, currentUser);
  }, [activeStory?.id, myUid, onMarkSeen, currentUser]);

  // Real-time `onSnapshot` listeners for OWN story Viewers & Reactions
  useEffect(() => {
    if (!activeStory || !isOwnStory || !myUid) return;
    const unsubViewers = subscribeStoryViewersPermanent(activeStory.id, myUid, setViewers);
    const unsubReactions = subscribeStoryReactionsPermanent(activeStory.id, myUid, setReactions);
    return () => {
      unsubViewers();
      unsubReactions();
    };
  }, [activeStory?.id, isOwnStory, myUid]);

  // Load viewer's own existing reaction on someone else's story
  useEffect(() => {
    if (!activeStory || isOwnStory || !myUid) return;
    let cancelled = false;
    void getMyStoryReaction(activeStory.id, myUid).then((r) => {
      if (!cancelled) setMyReaction(r);
    });
    return () => {
      cancelled = true;
    };
  }, [activeStory?.id, isOwnStory, myUid]);

  // Resolve video URL if this is a video story
  useEffect(() => {
    if (!activeStory || activeStory.mediaType !== 'video' || !activeStory.storyVideo) return;
    let cancelled = false;
    void resolveCloudVideoUrl(activeStory.storyVideo).then((url) => {
      if (!cancelled && url) {
        setResolvedVideoUrl(url);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [activeStory?.id, activeStory?.mediaType, activeStory?.storyVideo]);

  // Sync video element play/pause with effective pause state
  useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;
    if (isEffectivelyPaused) {
      vid.pause();
    } else {
      void vid.play().catch(() => {
        // Autoplay with audio may require muted fallback
        vid.muted = true;
        setMuted(true);
        void vid.play().catch(() => {});
      });
    }
  }, [isEffectivelyPaused, resolvedVideoUrl]);

  // Auto-advance timer (5 seconds for photo/text stories)
  useEffect(() => {
    if (!activeStory || isEffectivelyPaused) return;
    if (activeStory.mediaType === 'video') return; // Video drives progress via onTimeUpdate/onEnded

    const tickMs = 50;
    const step = (tickMs / PHOTO_TEXT_STORY_DURATION_MS) * 100;
    const timer = window.setInterval(() => {
      setProgress((prev) => {
        const next = prev + step;
        if (next >= 100) {
          window.clearInterval(timer);
          window.setTimeout(() => goNext(), 0);
          return 100;
        }
        return next;
      });
    }, tickMs);

    return () => window.clearInterval(timer);
  }, [activeStory?.id, activeStory?.mediaType, isEffectivelyPaused, goNext]);

  async function handleReact(reaction: StoryReactionType) {
    if (!activeStory || isOwnStory) return;
    setMyReaction(reaction);
    const meta = STORY_REACTION_MAP[reaction];
    setFloatingEmoji(meta.emoji);
    window.setTimeout(() => setFloatingEmoji(null), 900);
    try {
      await reactToStoryPermanent(activeStory, currentUser, reaction);
    } catch {
      // Non-fatal
    }
  }

  async function handleSendReply(e: React.FormEvent) {
    e.preventDefault();
    if (!activeStory || isOwnStory || !replyText.trim() || sendingReply) return;
    setSendingReply(true);
    try {
      await replyToStoryPermanent(activeStory, currentUser, replyText.trim());
      setReplyText('');
      setReplyFocused(false);
      showToast(`Reply sent to ${activeStory.userName}`);
    } catch {
      showToast('Could not send reply. Please try again.');
    } finally {
      setSendingReply(false);
    }
  }

  async function handleDeleteStory() {
    if (!activeStory || !isOwnStory || deleting) return;
    setDeleting(true);
    setMenuOpen(false);
    const deletingStory = activeStory;
    const remainingInGroup = (activeGroup?.stories.length || 1) - 1;
    try {
      await deleteStoryPermanent(deletingStory, myUid);
      if (remainingInGroup <= 0) {
        if (groups.length <= 1) {
          onClose();
        } else {
          setGroupIdx((prev) => Math.min(prev, Math.max(0, groups.length - 2)));
          setStoryIdx(0);
        }
      } else {
        setStoryIdx((prev) => Math.max(0, Math.min(prev, remainingInGroup - 1)));
      }
    } catch {
      showToast('Failed to delete story.');
    } finally {
      setDeleting(false);
    }
  }

  if (!activeGroup || !activeStory) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[140] bg-black/95 flex items-center justify-center select-none">
      {/* Desktop Prev Group / Story Chevron */}
      <button
        type="button"
        onClick={goPrev}
        aria-label="Previous story"
        className="hidden sm:flex absolute left-5 z-20 w-11 h-11 rounded-full bg-white/15 hover:bg-white/25 text-white items-center justify-center transition-colors cursor-pointer"
      >
        <ChevronLeft className="w-6 h-6" />
      </button>

      {/* Main 9:16 Story Card Stage */}
      <div className="relative w-full h-full sm:w-[420px] sm:max-w-[95vw] sm:h-[92vh] sm:max-h-[820px] sm:rounded-2xl overflow-hidden bg-[#0F1115] shadow-2xl flex flex-col">
        {/* Top Segmented Progress Bars */}
        <div className="absolute top-0 inset-x-0 z-30 pt-3 px-3 bg-gradient-to-b from-black/75 via-black/35 to-transparent pb-6 pointer-events-none">
          <div className="flex items-center gap-1 mb-2.5">
            {activeGroup.stories.map((st, idx) => {
              const fill = idx < safeStoryIdx ? 100 : idx === safeStoryIdx ? progress : 0;
              return (
                <div
                  key={st.id}
                  className="flex-1 h-[3px] rounded-full bg-white/30 overflow-hidden"
                >
                  <div
                    className="h-full bg-white rounded-full transition-[width] duration-75 ease-linear"
                    style={{width: `${Math.min(100, Math.max(0, fill))}%`}}
                  />
                </div>
              );
            })}
          </div>

          {/* Story Header: User Photo + Name + Time + Controls */}
          <div className="flex items-center justify-between gap-2 pointer-events-auto">
            <div className="flex items-center gap-2.5 min-w-0">
              <Avatar
                src={activeStory.userPhoto || activeGroup.userPhoto}
                name={activeStory.userName}
                size="sm"
                className="ring-2 ring-white/40"
              />
              <div className="min-w-0">
                <p className="text-sm font-bold text-white truncate leading-tight drop-shadow-xs">
                  {activeStory.userName}
                </p>
                <p className="text-[11px] font-medium text-white/80 leading-tight">
                  {formatStoryTimeAgo(activeStory.createdAtMs)}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0 relative">
              <button
                type="button"
                onClick={() => setPaused((p) => !p)}
                aria-label={paused ? 'Resume story' : 'Pause story'}
                className="w-8 h-8 rounded-full hover:bg-white/15 text-white flex items-center justify-center cursor-pointer"
              >
                {paused ? <Play className="w-4 h-4 fill-current" /> : <Pause className="w-4 h-4" />}
              </button>

              {activeStory.mediaType === 'video' && (
                <button
                  type="button"
                  onClick={() => {
                    const next = !muted;
                    setMuted(next);
                    if (videoRef.current) videoRef.current.muted = next;
                  }}
                  aria-label={muted ? 'Unmute story video' : 'Mute story video'}
                  className="w-8 h-8 rounded-full hover:bg-white/15 text-white flex items-center justify-center cursor-pointer"
                >
                  {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                </button>
              )}

              {/* 3-dot Menu for Own Story -> Delete Story */}
              {isOwnStory && (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setMenuOpen((o) => !o)}
                    aria-label="Story options"
                    className="w-8 h-8 rounded-full hover:bg-white/15 text-white flex items-center justify-center cursor-pointer"
                  >
                    <MoreHorizontal className="w-5 h-5" />
                  </button>
                  {menuOpen && (
                    <div className="absolute right-0 top-10 w-44 rounded-xl bg-white dark:bg-[#1C1E21] border border-[#E4E6EB] dark:border-[#2E3035] shadow-xl py-1.5 z-40">
                      <button
                        type="button"
                        disabled={deleting}
                        onClick={() => void handleDeleteStory()}
                        className="w-full px-3.5 py-2.5 text-left text-xs font-semibold text-[#DC2626] hover:bg-[#FEF2F2] dark:hover:bg-[#3B181A]/60 flex items-center gap-2 cursor-pointer"
                      >
                        {deleting ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Trash2 className="w-4 h-4" />
                        )}
                        <span>{deleting ? 'Deleting...' : 'Delete Story'}</span>
                      </button>
                    </div>
                  )}
                </div>
              )}

              <button
                type="button"
                onClick={onClose}
                aria-label="Close story viewer"
                className="w-8 h-8 rounded-full hover:bg-white/15 text-white flex items-center justify-center cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>

        {/* Story Media Canvas */}
        <div className="relative flex-1 w-full h-full flex items-center justify-center overflow-hidden bg-black">
          {activeStory.mediaType === 'image' && (
            <img
              src={activeStory.storyImage}
              alt={activeStory.caption || `${activeStory.userName}'s story`}
              referrerPolicy="no-referrer"
              className="w-full h-full object-contain bg-black"
            />
          )}

          {activeStory.mediaType === 'video' && (
            <div className="w-full h-full flex items-center justify-center bg-black relative">
              {resolvedVideoUrl ? (
                <video
                  ref={videoRef}
                  src={resolvedVideoUrl}
                  poster={activeStory.storyImage || undefined}
                  autoPlay
                  playsInline
                  muted={muted}
                  preload="metadata"
                  onTimeUpdate={(e) => {
                    const v = e.currentTarget;
                    if (v.duration && Number.isFinite(v.duration) && v.duration > 0) {
                      setProgress((v.currentTime / v.duration) * 100);
                    }
                  }}
                  onEnded={() => goNext()}
                  className="w-full h-full object-contain"
                />
              ) : activeStory.storyImage ? (
                <img
                  src={activeStory.storyImage}
                  alt="Loading video story"
                  className="w-full h-full object-contain"
                />
              ) : (
                <Loader2 className="w-8 h-8 text-white animate-spin" />
              )}
            </div>
          )}

          {activeStory.mediaType === 'text' && (
            <div
              className={`w-full h-full flex items-center justify-center px-8 py-24 ${getStoryGradientClass(
                activeStory.bgGradient,
              )}`}
            >
              <p className="text-white text-2xl sm:text-3xl font-display font-bold text-center leading-snug whitespace-pre-wrap break-words drop-shadow-sm">
                {activeStory.textContent}
              </p>
            </div>
          )}

          {/* Left / Right Tap Zones for Previous / Next Story */}
          <button
            type="button"
            aria-label="Previous story zone"
            onClick={goPrev}
            className="absolute left-0 top-16 bottom-28 w-[34%] z-10 cursor-pointer focus:outline-none"
          />
          <button
            type="button"
            aria-label="Next story zone"
            onClick={goNext}
            className="absolute right-0 top-16 bottom-28 w-[66%] z-10 cursor-pointer focus:outline-none"
          />

          {/* Floating Reaction Burst */}
          {floatingEmoji && (
            <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center">
              <span className="text-7xl animate-bounce drop-shadow-2xl">{floatingEmoji}</span>
            </div>
          )}

          {/* Toast feedback */}
          {toastMsg && (
            <div className="pointer-events-none absolute top-20 inset-x-0 z-40 flex justify-center px-4">
              <div className="px-4 py-2 rounded-full bg-black/80 text-white text-xs font-semibold shadow-lg border border-white/15">
                {toastMsg}
              </div>
            </div>
          )}

          {/* Story Caption Overlay */}
          {activeStory.caption && (
            <div className="pointer-events-none absolute bottom-28 inset-x-4 z-20 flex justify-center">
              <p className="px-4 py-2 rounded-2xl bg-black/55 backdrop-blur-xs text-white text-sm font-medium text-center leading-snug max-w-full break-words">
                {activeStory.caption}
              </p>
            </div>
          )}
        </div>

        {/* BOTTOM BAR: Own Story Viewers Option vs Other User's Reply + React Bar */}
        <div className="relative z-30 px-3.5 pt-3 pb-4 bg-gradient-to-t from-black/90 via-black/70 to-transparent">
          {isOwnStory ? (
            <div className="flex items-center justify-between gap-3">
              {/* MAIN FIX: Facebook-style Eye icon + "Seen by X" button -> opens Story Viewers popup */}
              <button
                type="button"
                onClick={() => {
                  setViewersTab('viewers');
                  setViewersSheetOpen(true);
                }}
                className="flex items-center gap-2.5 px-3.5 py-2 rounded-full bg-white/15 hover:bg-white/25 backdrop-blur-xs text-white transition-colors cursor-pointer"
              >
                <Eye className="w-4 h-4 text-white shrink-0" />
                <span className="text-xs font-bold tabular-nums">
                  Seen by {viewers.length}
                </span>
                {viewers.length > 0 && (
                  <div className="flex items-center -space-x-1.5 ml-0.5">
                    {viewers.slice(0, 3).map((v) => (
                      <div
                        key={v.viewerId}
                        className="w-5 h-5 rounded-full overflow-hidden border border-white/80 bg-[#1F2937]"
                      >
                        <Avatar
                          src={v.viewerPhoto}
                          name={v.viewerName}
                          size="xs"
                          className="!w-full !h-full"
                        />
                      </div>
                    ))}
                  </div>
                )}
                <ChevronUp className="w-4 h-4 text-white/80" />
              </button>

              <div className="flex items-center gap-2">
                {/* Quick button directly to Reactions Tab */}
                <button
                  type="button"
                  onClick={() => {
                    setViewersTab('reactions');
                    setViewersSheetOpen(true);
                  }}
                  className="px-3 py-2 rounded-full bg-white/15 hover:bg-white/25 backdrop-blur-xs text-white text-xs font-bold inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Heart className="w-3.5 h-3.5 text-[#F43F5E] fill-[#F43F5E]" />
                  <span className="tabular-nums">{reactions.length}</span>
                </button>

                <button
                  type="button"
                  onClick={onOpenAddStory}
                  aria-label="Add another story"
                  className="w-9 h-9 rounded-full bg-[#1877F2] hover:bg-[#166FE5] text-white flex items-center justify-center shadow-sm cursor-pointer"
                >
                  <Plus className="w-4 h-4 stroke-[2.5]" />
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-2.5">
              {/* Facebook Story React Bar: Like 👍, Love ❤️, Haha 😆, Wow 😮, Sad 😢, Angry 😡 */}
              <div className="flex items-center justify-between gap-1 px-1">
                {STORY_REACTIONS.map((item) => {
                  const selected = myReaction === item.type;
                  return (
                    <button
                      key={item.type}
                      type="button"
                      title={item.label}
                      onClick={() => void handleReact(item.type)}
                      className={`flex flex-col items-center justify-center px-2 py-1 rounded-full transition-transform hover:scale-125 active:scale-95 cursor-pointer ${
                        selected ? 'bg-white/25 ring-2 ring-white/80 scale-110' : 'hover:bg-white/10'
                      }`}
                    >
                      <span className="text-xl leading-none">{item.emoji}</span>
                    </button>
                  );
                })}
              </div>

              {/* Story Reply Box -> sends to owner's Inbox with story photo */}
              <form onSubmit={handleSendReply} className="flex items-center gap-2">
                <input
                  type="text"
                  maxLength={1000}
                  value={replyText}
                  onFocus={() => setReplyFocused(true)}
                  onBlur={() => setReplyFocused(false)}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder={`Reply to ${activeStory.userName.split(/\s+/)[0]}...`}
                  className="flex-1 px-4 py-2.5 rounded-full bg-white/15 border border-white/30 text-sm text-white placeholder:text-white/75 focus:bg-white/20 focus:border-white outline-none"
                />
                <button
                  type="submit"
                  disabled={!replyText.trim() || sendingReply}
                  aria-label="Send story reply"
                  className="w-10 h-10 rounded-full bg-[#1877F2] hover:bg-[#166FE5] disabled:opacity-45 text-white flex items-center justify-center shrink-0 transition-colors cursor-pointer"
                >
                  {sendingReply ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                </button>
              </form>
            </div>
          )}
        </div>

        {/* STORY VIEWERS BOTTOM SHEET (Own Story: Tab 1 Viewers + Tab 2 Reactions) */}
        {isOwnStory && viewersSheetOpen && (
          <div
            onClick={() => setViewersSheetOpen(false)}
            className="absolute inset-0 z-50 bg-black/60 backdrop-blur-[2px] flex items-end"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full h-[72%] bg-white dark:bg-[#1C1E21] rounded-t-3xl border-t border-[#E4E6EB] dark:border-[#2E3035] shadow-2xl flex flex-col overflow-hidden"
            >
              {/* Grab handle */}
              <div className="pt-2.5 pb-1 flex justify-center">
                <div className="w-10 h-1 rounded-full bg-[#D1D5DB] dark:bg-[#4B5563]" />
              </div>

              {/* Sheet Header */}
              <div className="px-4 py-2 flex items-center justify-between border-b border-[#E4E6EB] dark:border-[#2E3035]">
                <div className="flex items-center gap-2">
                  <Eye className="w-4 h-4 text-[#1877F2]" />
                  <h3 className="font-display font-bold text-base text-[#111827] dark:text-white">
                    Story Viewers
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setViewersSheetOpen(false)}
                  aria-label="Close Story Viewers"
                  className="w-8 h-8 rounded-full bg-[#F0F2F5] dark:bg-[#2A2D32] hover:bg-[#E4E6EB] dark:hover:bg-[#3A3D45] text-[#65676B] dark:text-[#D1D5DB] flex items-center justify-center cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* 2 Tabs: TAB 1 - Viewers | TAB 2 - Reactions */}
              <div className="grid grid-cols-2 border-b border-[#E4E6EB] dark:border-[#2E3035]">
                <button
                  type="button"
                  onClick={() => setViewersTab('viewers')}
                  className={`py-3 text-xs font-bold flex items-center justify-center gap-1.5 border-b-2 transition-colors cursor-pointer ${
                    viewersTab === 'viewers'
                      ? 'border-[#1877F2] text-[#1877F2]'
                      : 'border-transparent text-[#65676B] dark:text-[#9CA3AF] hover:text-[#111827] dark:hover:text-white'
                  }`}
                >
                  <Eye className="w-4 h-4" />
                  <span>Viewers</span>
                  <span className="px-1.5 py-0.5 rounded-full bg-[#F0F2F5] dark:bg-[#2A2D32] text-[11px] tabular-nums">
                    {viewers.length}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setViewersTab('reactions')}
                  className={`py-3 text-xs font-bold flex items-center justify-center gap-1.5 border-b-2 transition-colors cursor-pointer ${
                    viewersTab === 'reactions'
                      ? 'border-[#1877F2] text-[#1877F2]'
                      : 'border-transparent text-[#65676B] dark:text-[#9CA3AF] hover:text-[#111827] dark:hover:text-white'
                  }`}
                >
                  <Heart className="w-4 h-4" />
                  <span>Reactions</span>
                  <span className="px-1.5 py-0.5 rounded-full bg-[#F0F2F5] dark:bg-[#2A2D32] text-[11px] tabular-nums">
                    {reactions.length}
                  </span>
                </button>
              </div>

              {/* Tab Content */}
              <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
                {viewersTab === 'viewers' ? (
                  viewers.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center px-6 py-10 space-y-2">
                      <div className="w-12 h-12 rounded-full bg-[#F0F2F5] dark:bg-[#2A2D32] text-[#65676B] dark:text-[#9CA3AF] flex items-center justify-center">
                        <Eye className="w-6 h-6" />
                      </div>
                      <p className="text-sm font-semibold text-[#111827] dark:text-white">
                        No viewers yet
                      </p>
                      <p className="text-xs text-[#65676B] dark:text-[#9CA3AF]">
                        People who view your story will appear here in real time.
                      </p>
                    </div>
                  ) : (
                    viewers.map((viewer) => (
                      <div
                        key={viewer.viewerId}
                        className="flex items-center justify-between gap-3 px-2.5 py-2 rounded-xl hover:bg-[#F8FAFC] dark:hover:bg-[#24272E] transition-colors"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <Avatar
                            src={viewer.viewerPhoto}
                            name={viewer.viewerName}
                            size="md"
                          />
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-[#111827] dark:text-white truncate">
                              {viewer.viewerName}
                            </p>
                            <p className="text-[11px] text-[#65676B] dark:text-[#9CA3AF]">
                              Viewed {formatStoryTimeAgo(viewer.viewedAtMs)}
                            </p>
                          </div>
                        </div>
                        <span className="text-[11px] font-medium text-[#65676B] dark:text-[#9CA3AF] shrink-0">
                          {formatStoryTimeAgo(viewer.viewedAtMs)}
                        </span>
                      </div>
                    ))
                  )
                ) : reactions.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center px-6 py-10 space-y-2">
                    <div className="w-12 h-12 rounded-full bg-[#F0F2F5] dark:bg-[#2A2D32] text-[#65676B] dark:text-[#9CA3AF] flex items-center justify-center">
                      <Heart className="w-6 h-6" />
                    </div>
                    <p className="text-sm font-semibold text-[#111827] dark:text-white">
                      No reactions yet
                    </p>
                    <p className="text-xs text-[#65676B] dark:text-[#9CA3AF]">
                      When someone reacts to your story, their name and reaction will appear here.
                    </p>
                  </div>
                ) : (
                  reactions.map((item) => {
                    const meta = STORY_REACTION_MAP[item.reaction];
                    return (
                      <div
                        key={item.userId}
                        className="flex items-center justify-between gap-3 px-2.5 py-2 rounded-xl hover:bg-[#F8FAFC] dark:hover:bg-[#24272E] transition-colors"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="relative shrink-0">
                            <Avatar src={item.userPhoto} name={item.userName} size="md" />
                            <span className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-white dark:bg-[#1C1E21] shadow-xs flex items-center justify-center text-xs leading-none">
                              {meta.emoji}
                            </span>
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-[#111827] dark:text-white truncate">
                              {item.userName}
                            </p>
                            <p className="text-[11px] text-[#65676B] dark:text-[#9CA3AF]">
                              {formatStoryTimeAgo(item.updatedAtMs)}
                            </p>
                          </div>
                        </div>

                        <span
                          className={`px-2.5 py-1 rounded-full text-xs font-bold inline-flex items-center gap-1 shrink-0 ${meta.accentBg}`}
                        >
                          <span>{meta.emoji}</span>
                          <span>{meta.label}</span>
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Desktop Next Group / Story Chevron */}
      <button
        type="button"
        onClick={goNext}
        aria-label="Next story"
        className="hidden sm:flex absolute right-5 z-20 w-11 h-11 rounded-full bg-white/15 hover:bg-white/25 text-white items-center justify-center transition-colors cursor-pointer"
      >
        <ChevronRight className="w-6 h-6" />
      </button>
    </div>
  );
}
