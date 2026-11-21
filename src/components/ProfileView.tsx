import {useEffect, useRef, useState} from 'react';
import type {ChangeEvent, FormEvent} from 'react';
import {
  AlertCircle,
  Briefcase,
  Calendar,
  Camera,
  Check,
  CheckCircle2,
  Loader2,
  Mail,
  MapPin,
  MessageSquare,
  Pencil,
  Phone,
  Upload,
  UserCheck,
  UserMinus,
  UserPlus,
  X,
} from 'lucide-react';
import {apiRequest, uploadImageFile} from '../lib/api';
import {PRESET_AVATARS, PRESET_COVERS} from '../lib/assets';
import type {CommentItem, PostItem, ReactionType, UserProfile} from '../types';
import {Avatar, CoverImage} from './MediaImage';
import {PostCard} from './PostCard';
import {PostComposer} from './PostComposer';

interface ProfileViewProps {
  profileId: number;
  currentUser: UserProfile;
  onUserUpdated: (user: UserProfile) => void;
  onOpenProfile: (userId: number) => void;
  onOpenChat: (user: UserProfile) => void;
  onOpenAccountsCentre?: () => void;
  onNetworkChanged: () => void;
  onPostMutated: () => void;
}

export function ProfileView({
  profileId,
  currentUser,
  onUserUpdated,
  onOpenProfile,
  onOpenChat,
  onOpenAccountsCentre,
  onNetworkChanged,
  onPostMutated,
}: ProfileViewProps) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [posts, setPosts] = useState<PostItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Edit profile state
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editBio, setEditBio] = useState('');
  const [editWork, setEditWork] = useState('');
  const [editLocation, setEditLocation] = useState('');
  const [editAvatarUrl, setEditAvatarUrl] = useState('');
  const [editCoverUrl, setEditCoverUrl] = useState('');
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveConfirmation, setSaveConfirmation] = useState<string | null>(null);

  const [actionBusy, setActionBusy] = useState(false);

  const avatarFileRef = useRef<HTMLInputElement>(null);
  const coverFileRef = useRef<HTMLInputElement>(null);

  const isOwnProfile = profileId === currentUser.id;

  async function fetchProfile() {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await apiRequest<{profile: UserProfile; posts: PostItem[]}>(
        `/api/users/${profileId}`,
      );
      setProfile(data.profile);
      setPosts(data.posts);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Unable to load profile.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setIsEditing(false);
    setSaveConfirmation(null);
    setSaveError(null);
    fetchProfile();
  }, [profileId]);

  function openEditor() {
    if (!profile) return;
    setEditName(profile.name);
    setEditBio(profile.bio);
    setEditWork(profile.work);
    setEditLocation(profile.location);
    setEditAvatarUrl(profile.avatar_url);
    setEditCoverUrl(profile.cover_url);
    setSaveError(null);
    setIsEditing(true);
  }

  async function handleAvatarUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSaveError(null);
    setUploadingAvatar(true);
    try {
      const url = await uploadImageFile(file);
      setEditAvatarUrl(url);
      if (!isEditing) {
        // Open editor with uploaded preview so user can confirm and save cleanly
        openEditor();
        setEditAvatarUrl(url);
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to upload avatar photo.');
    } finally {
      setUploadingAvatar(false);
      if (avatarFileRef.current) avatarFileRef.current.value = '';
    }
  }

  async function handleCoverUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSaveError(null);
    setUploadingCover(true);
    try {
      const url = await uploadImageFile(file);
      setEditCoverUrl(url);
      if (!isEditing) {
        openEditor();
        setEditCoverUrl(url);
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to upload cover photo.');
    } finally {
      setUploadingCover(false);
      if (coverFileRef.current) coverFileRef.current.value = '';
    }
  }

  async function handleSaveProfile(e: FormEvent) {
    e.preventDefault();
    setSaveError(null);
    setSavingProfile(true);
    try {
      const data = await apiRequest<{user: UserProfile; message: string}>('/api/profile', {
        method: 'PUT',
        body: JSON.stringify({
          name: editName.trim(),
          bio: editBio.trim(),
          work: editWork.trim(),
          location: editLocation.trim(),
          avatar_url: editAvatarUrl.trim(),
          cover_url: editCoverUrl.trim(),
        }),
      });
      setProfile(data.user);
      onUserUpdated(data.user);
      // Sync updated avatar & name on existing posts in this view
      setPosts((prev) =>
        prev.map((p) =>
          p.user_id === data.user.id
            ? {...p, author_name: data.user.name, author_avatar: data.user.avatar_url, author_work: data.user.work}
            : p,
        ),
      );
      setIsEditing(false);
      setSaveConfirmation(
        'Profile saved — your bio, avatar photo, and cover photo have been updated in the database.',
      );
      onPostMutated();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Unable to save profile changes.');
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleFriendAction(action: 'request' | 'accept' | 'decline' | 'remove') {
    if (!profile || actionBusy) return;
    setActionBusy(true);
    try {
      if (action === 'request') {
        await apiRequest('/api/friends/request', {
          method: 'POST',
          body: JSON.stringify({userId: profile.id}),
        });
      } else if (action === 'accept' || action === 'decline') {
        await apiRequest('/api/friends/respond', {
          method: 'POST',
          body: JSON.stringify({requesterId: profile.id, action}),
        });
      } else {
        await apiRequest(`/api/friends/${profile.id}`, {method: 'DELETE'});
      }
      await fetchProfile();
      onNetworkChanged();
    } finally {
      setActionBusy(false);
    }
  }

  async function handleFollowToggle() {
    if (!profile || actionBusy) return;
    setActionBusy(true);
    try {
      await apiRequest('/api/follows/toggle', {
        method: 'POST',
        body: JSON.stringify({userId: profile.id}),
      });
      await fetchProfile();
      onNetworkChanged();
    } finally {
      setActionBusy(false);
    }
  }

  async function handleToggleLike(postId: number, reaction?: ReactionType) {
    try {
      const data = await apiRequest<{
        liked: boolean;
        my_reaction: ReactionType | null;
        likes_count: number;
        reaction_counts: Partial<Record<ReactionType, number>>;
      }>(`/api/posts/${postId}/like`, {
        method: 'POST',
        body: JSON.stringify(reaction ? {reaction} : {}),
      });
      setPosts((prev) =>
        prev.map((p) =>
          p.id === postId
            ? {
                ...p,
                liked_by_me: data.liked,
                my_reaction: data.my_reaction,
                likes_count: data.likes_count,
                reaction_counts: data.reaction_counts,
              }
            : p,
        ),
      );
      onPostMutated();
    } catch {
      // Ignore
    }
  }

  function handleCommentAdded(postId: number, comment: CommentItem) {
    setPosts((prev) =>
      prev.map((p) =>
        p.id === postId
          ? {
              ...p,
              comments: p.comments.some((c) => c.id === comment.id)
                ? p.comments
                : [...p.comments, comment],
              comments_count: p.comments.some((c) => c.id === comment.id)
                ? p.comments_count
                : p.comments_count + 1,
            }
          : p,
      ),
    );
    onPostMutated();
  }

  async function handleDeletePost(postId: number) {
    try {
      await apiRequest(`/api/posts/${postId}`, {method: 'DELETE'});
      setPosts((prev) => prev.filter((p) => p.id !== postId));
      onPostMutated();
    } catch {
      // Ignore
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="bg-white dark:bg-[#1C1E21] border border-[#E4E6EB] dark:border-[#2E3035] rounded-2xl overflow-hidden animate-pulse">
          <div className="h-52 sm:h-64 bg-[#E4E6EB] dark:bg-[#2A2D32]" />
          <div className="p-6 space-y-3">
            <div className="w-48 h-6 bg-[#E4E6EB] dark:bg-[#2A2D32] rounded" />
            <div className="w-80 h-4 bg-[#E4E6EB] dark:bg-[#2A2D32] rounded" />
          </div>
        </div>
      </div>
    );
  }

  if (loadError || !profile) {
    return (
      <div className="bg-white dark:bg-[#1C1E21] border border-[#E4E6EB] dark:border-[#2E3035] rounded-2xl p-8 text-center">
        <p className="text-sm text-[#DC2626] dark:text-[#F87171]">{loadError || 'Profile not found.'}</p>
      </div>
    );
  }

  const displayedCover = isEditing ? editCoverUrl : profile.cover_url;
  const displayedAvatar = isEditing ? editAvatarUrl : profile.avatar_url;

  return (
    <div className="space-y-5">
      {/* Persistent Save Confirmation Banner */}
      {saveConfirmation && (
        <div
          role="status"
          className="flex items-start justify-between gap-3 p-4 rounded-2xl bg-[#ECFDF5] dark:bg-[#0F2E22] border border-[#A7F3D0] dark:border-[#166534] text-[#065F46] dark:text-[#A7F3D0]"
        >
          <div className="flex items-start gap-2.5 text-sm font-medium">
            <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5 text-[#16A34A] dark:text-[#4ADE80]" />
            <span>{saveConfirmation}</span>
          </div>
          <button
            type="button"
            onClick={() => setSaveConfirmation(null)}
            aria-label="Dismiss confirmation"
            className="p-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 shrink-0 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Hidden file inputs */}
      <input
        ref={avatarFileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        onChange={handleAvatarUpload}
        className="hidden"
      />
      <input
        ref={coverFileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        onChange={handleCoverUpload}
        className="hidden"
      />

      {/* Profile Header Card */}
      <section className="bg-white dark:bg-[#16191F] border border-[#E5E8EE] dark:border-[#252A34] rounded-2xl overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        {/* Cover Banner */}
        <div className="relative h-48 sm:h-64 bg-[#1E293B] overflow-hidden">
          <CoverImage src={displayedCover} alt={`${profile.name}'s cover photo`} />
          <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/55 to-transparent pointer-events-none" />

          {isOwnProfile && (
            <button
              type="button"
              onClick={() => (isEditing ? coverFileRef.current?.click() : openEditor())}
              disabled={uploadingCover}
              className="absolute bottom-3.5 right-3.5 inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-black/70 hover:bg-black/85 text-white text-xs sm:text-sm font-medium backdrop-blur-xs transition-colors cursor-pointer"
            >
              {uploadingCover ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Camera className="w-4 h-4" />
              )}
              <span>{uploadingCover ? 'Uploading...' : 'Edit Cover Photo'}</span>
            </button>
          )}
        </div>

        {/* Avatar + Identity + Actions */}
        <div className="px-5 sm:px-7 pb-6">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 -mt-12 sm:-mt-14 relative z-10">
            <div className="flex flex-col sm:flex-row sm:items-end gap-4">
              <div className="relative inline-block w-fit">
                <div className="rounded-full p-1 bg-white dark:bg-[#1C1E21]">
                  <Avatar src={displayedAvatar} name={profile.name} size="xl" />
                </div>
                {isOwnProfile && (
                  <button
                    type="button"
                    onClick={() => (isEditing ? avatarFileRef.current?.click() : openEditor())}
                    disabled={uploadingAvatar}
                    aria-label="Update profile avatar photo"
                    className="absolute bottom-1.5 right-1.5 w-9 h-9 rounded-full bg-[#1877F2] hover:bg-[#166FE5] text-white flex items-center justify-center shadow-sm ring-2 ring-white dark:ring-[#1C1E21] cursor-pointer"
                  >
                    {uploadingAvatar ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Camera className="w-4 h-4" />
                    )}
                  </button>
                )}
              </div>

              <div className="pb-1">
                <h1 className="text-2xl sm:text-3xl font-display font-bold text-[#111827] dark:text-white leading-tight">
                  {profile.name}
                </h1>
                <div className="flex items-center gap-2 text-sm text-[#65676B] dark:text-[#9CA3AF] mt-1 tabular-nums flex-wrap">
                  <span>
                    <strong className="text-[#111827] dark:text-[#F3F4F6] font-semibold">
                      {profile.friends_count ?? 0}
                    </strong>{' '}
                    friends
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    <strong className="text-[#111827] dark:text-[#F3F4F6] font-semibold">
                      {profile.followers_count ?? 0}
                    </strong>{' '}
                    followers
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    <strong className="text-[#111827] dark:text-[#F3F4F6] font-semibold">
                      {profile.posts_count ?? posts.length}
                    </strong>{' '}
                    posts
                  </span>
                </div>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-2.5 flex-wrap pb-1">
              {isOwnProfile ? (
                <button
                  type="button"
                  onClick={() => (isEditing ? setIsEditing(false) : openEditor())}
                  className="inline-flex items-center gap-2 px-4 h-10 rounded-xl bg-[#1877F2] hover:bg-[#166FE5] dark:bg-[#2563EB] dark:hover:bg-[#1D4ED8] text-white text-sm font-semibold transition-colors whitespace-nowrap cursor-pointer"
                >
                  <Pencil className="w-4 h-4" />
                  <span>{isEditing ? 'Close Editor' : 'Edit Profile'}</span>
                </button>
              ) : (
                <>
                  {profile.friendship_status === 'none' && (
                    <button
                      type="button"
                      disabled={actionBusy}
                      onClick={() => handleFriendAction('request')}
                      className="inline-flex items-center gap-2 px-4 h-10 rounded-xl bg-[#1877F2] hover:bg-[#166FE5] text-white text-sm font-semibold transition-colors whitespace-nowrap cursor-pointer"
                    >
                      <UserPlus className="w-4 h-4" />
                      <span>Add Friend</span>
                    </button>
                  )}

                  {profile.friendship_status === 'outgoing_pending' && (
                    <button
                      type="button"
                      disabled={actionBusy}
                      onClick={() => handleFriendAction('remove')}
                      className="inline-flex items-center gap-2 px-4 h-10 rounded-xl bg-[#F0F2F5] dark:bg-[#2A2D32] text-[#111827] dark:text-white text-sm font-semibold hover:bg-[#E4E6EB] dark:hover:bg-[#35383E] transition-colors whitespace-nowrap cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                      <span>Cancel Request</span>
                    </button>
                  )}

                  {profile.friendship_status === 'incoming_pending' && (
                    <>
                      <button
                        type="button"
                        disabled={actionBusy}
                        onClick={() => handleFriendAction('accept')}
                        className="inline-flex items-center gap-2 px-4 h-10 rounded-xl bg-[#1877F2] hover:bg-[#166FE5] text-white text-sm font-semibold transition-colors whitespace-nowrap cursor-pointer"
                      >
                        <Check className="w-4 h-4" />
                        <span>Accept Request</span>
                      </button>
                      <button
                        type="button"
                        disabled={actionBusy}
                        onClick={() => handleFriendAction('decline')}
                        className="inline-flex items-center gap-2 px-3.5 h-10 rounded-xl border border-[#D1D5DB] dark:border-[#374151] text-[#374151] dark:text-[#D1D5DB] text-sm font-semibold hover:bg-[#F0F2F5] dark:hover:bg-[#2A2D32] transition-colors whitespace-nowrap cursor-pointer"
                      >
                        <span>Decline</span>
                      </button>
                    </>
                  )}

                  {profile.friendship_status === 'friends' && (
                    <button
                      type="button"
                      disabled={actionBusy}
                      onClick={() => handleFriendAction('remove')}
                      className="inline-flex items-center gap-2 px-3.5 h-10 rounded-xl bg-[#F0F2F5] dark:bg-[#2A2D32] text-[#111827] dark:text-white text-sm font-semibold hover:bg-[#E4E6EB] dark:hover:bg-[#35383E] transition-colors whitespace-nowrap cursor-pointer"
                    >
                      <UserMinus className="w-4 h-4" />
                      <span>Friends</span>
                    </button>
                  )}

                  <button
                    type="button"
                    disabled={actionBusy}
                    onClick={handleFollowToggle}
                    className={`inline-flex items-center gap-2 px-3.5 h-10 rounded-xl text-sm font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                      profile.is_following
                        ? 'border border-[#1877F2] text-[#1877F2] dark:border-[#60A5FA] dark:text-[#60A5FA]'
                        : 'border border-[#D1D5DB] dark:border-[#374151] text-[#374151] dark:text-[#D1D5DB] hover:bg-[#F0F2F5] dark:hover:bg-[#2A2D32]'
                    }`}
                  >
                    <UserCheck className="w-4 h-4" />
                    <span>{profile.is_following ? 'Following' : 'Follow'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => onOpenChat(profile)}
                    className="inline-flex items-center gap-2 px-3.5 h-10 rounded-xl bg-[#F0F2F5] dark:bg-[#2A2D32] hover:bg-[#E4E6EB] dark:hover:bg-[#35383E] text-[#111827] dark:text-white text-sm font-semibold transition-colors whitespace-nowrap cursor-pointer"
                  >
                    <MessageSquare className="w-4 h-4" />
                    <span>Message</span>
                  </button>
                </>
              )}
            </div>
          </div>

          {!isEditing && profile.bio && (
            <p className="mt-4 text-[15px] text-[#374151] dark:text-[#D1D5DB] max-w-2xl leading-relaxed">
              {profile.bio}
            </p>
          )}
        </div>

        {/* Inline Edit Profile Drawer */}
        {isOwnProfile && isEditing && (
          <form
            onSubmit={handleSaveProfile}
            className="px-5 sm:px-7 py-6 border-t border-[#E4E6EB] dark:border-[#2E3035] bg-[#F8F9FA] dark:bg-[#17191C] space-y-5"
          >
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-display font-bold text-[#111827] dark:text-white">
                  Edit Profile
                </h2>
                <p className="text-xs text-[#65676B] dark:text-[#9CA3AF]">
                  Update your bio, avatar photo, and cover photo. Changes are saved to the database.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsEditing(false)}
                className="p-2 rounded-lg text-[#65676B] dark:text-[#9CA3AF] hover:bg-[#E4E6EB] dark:hover:bg-[#2A2D32] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {saveError && (
              <div
                role="alert"
                className="flex items-start gap-2.5 p-3 rounded-xl bg-[#FEF2F2] dark:bg-[#3B181A] border border-[#FECACA] dark:border-[#7F1D1D] text-[#B91C1C] dark:text-[#FCA5A5] text-sm"
              >
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{saveError}</span>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="edit-name"
                  className="block text-sm font-medium text-[#374151] dark:text-[#D1D5DB] mb-1.5"
                >
                  Display Name
                </label>
                <input
                  id="edit-name"
                  type="text"
                  required
                  minLength={2}
                  maxLength={60}
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full h-10 px-3.5 rounded-xl bg-white dark:bg-[#121316] border border-[#D1D5DB] dark:border-[#374151] text-sm text-[#111827] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1877F2]"
                />
              </div>

              <div>
                <label
                  htmlFor="edit-location"
                  className="block text-sm font-medium text-[#374151] dark:text-[#D1D5DB] mb-1.5"
                >
                  Location
                </label>
                <input
                  id="edit-location"
                  type="text"
                  maxLength={80}
                  value={editLocation}
                  onChange={(e) => setEditLocation(e.target.value)}
                  placeholder="San Francisco, CA"
                  className="w-full h-10 px-3.5 rounded-xl bg-white dark:bg-[#121316] border border-[#D1D5DB] dark:border-[#374151] text-sm text-[#111827] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1877F2]"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="edit-work"
                className="block text-sm font-medium text-[#374151] dark:text-[#D1D5DB] mb-1.5"
              >
                Work / Role
              </label>
              <input
                id="edit-work"
                type="text"
                maxLength={100}
                value={editWork}
                onChange={(e) => setEditWork(e.target.value)}
                placeholder="Product Designer at Studio"
                className="w-full h-10 px-3.5 rounded-xl bg-white dark:bg-[#121316] border border-[#D1D5DB] dark:border-[#374151] text-sm text-[#111827] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1877F2]"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label
                  htmlFor="edit-bio"
                  className="block text-sm font-medium text-[#374151] dark:text-[#D1D5DB]"
                >
                  Bio
                </label>
                <span className="text-xs text-[#65676B] dark:text-[#9CA3AF] tabular-nums">
                  {editBio.length}/320
                </span>
              </div>
              <textarea
                id="edit-bio"
                rows={3}
                maxLength={320}
                value={editBio}
                onChange={(e) => setEditBio(e.target.value)}
                placeholder="Tell people a bit about yourself..."
                className="w-full px-3.5 py-2.5 rounded-xl bg-white dark:bg-[#121316] border border-[#D1D5DB] dark:border-[#374151] text-sm text-[#111827] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1877F2]"
              />
            </div>

            {/* Avatar Photo Editor */}
            <div className="space-y-3 pt-2 border-t border-[#E4E6EB] dark:border-[#2E3035]">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <span className="text-sm font-semibold text-[#111827] dark:text-white block">
                    Avatar Photo
                  </span>
                  <span className="text-xs text-[#65676B] dark:text-[#9CA3AF]">
                    Upload an image from your device, choose a preset, or paste an image URL.
                  </span>
                </div>
                <button
                  type="button"
                  disabled={uploadingAvatar}
                  onClick={() => avatarFileRef.current?.click()}
                  className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-[#D1D5DB] dark:border-[#374151] bg-white dark:bg-[#1C1E21] text-xs font-semibold text-[#111827] dark:text-white hover:bg-[#F0F2F5] dark:hover:bg-[#2A2D32] cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>{uploadingAvatar ? 'Uploading...' : 'Upload Avatar'}</span>
                </button>
              </div>

              <div className="flex items-center gap-3 flex-wrap">
                {PRESET_AVATARS.map((preset) => (
                  <button
                    key={preset.url}
                    type="button"
                    onClick={() => setEditAvatarUrl(preset.url)}
                    className={`rounded-full p-0.5 transition-all cursor-pointer ${
                      editAvatarUrl === preset.url
                        ? 'ring-2 ring-[#1877F2] dark:ring-[#3B82F6]'
                        : 'opacity-80 hover:opacity-100'
                    }`}
                    title={preset.label}
                  >
                    <Avatar src={preset.url} name={preset.label} size="md" />
                  </button>
                ))}
                <input
                  type="text"
                  value={editAvatarUrl}
                  onChange={(e) => setEditAvatarUrl(e.target.value)}
                  placeholder="Or paste image URL..."
                  className="flex-1 min-w-[200px] h-9 px-3 rounded-xl bg-white dark:bg-[#121316] border border-[#D1D5DB] dark:border-[#374151] text-xs text-[#111827] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1877F2]"
                />
              </div>
            </div>

            {/* Cover Photo Editor */}
            <div className="space-y-3 pt-2 border-t border-[#E4E6EB] dark:border-[#2E3035]">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <span className="text-sm font-semibold text-[#111827] dark:text-white block">
                    Cover Photo
                  </span>
                  <span className="text-xs text-[#65676B] dark:text-[#9CA3AF]">
                    Upload a banner photo, select a preset scene, or paste an image URL.
                  </span>
                </div>
                <button
                  type="button"
                  disabled={uploadingCover}
                  onClick={() => coverFileRef.current?.click()}
                  className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-[#D1D5DB] dark:border-[#374151] bg-white dark:bg-[#1C1E21] text-xs font-semibold text-[#111827] dark:text-white hover:bg-[#F0F2F5] dark:hover:bg-[#2A2D32] cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>{uploadingCover ? 'Uploading...' : 'Upload Cover'}</span>
                </button>
              </div>

              <div className="grid grid-cols-3 gap-2.5">
                {PRESET_COVERS.map((preset) => (
                  <button
                    key={preset.url}
                    type="button"
                    onClick={() => setEditCoverUrl(preset.url)}
                    className={`relative aspect-[16/9] rounded-xl overflow-hidden border-2 transition-all cursor-pointer ${
                      editCoverUrl === preset.url
                        ? 'border-[#1877F2] dark:border-[#3B82F6]'
                        : 'border-transparent opacity-80 hover:opacity-100'
                    }`}
                  >
                    <CoverImage src={preset.url} alt={preset.label} />
                  </button>
                ))}
              </div>

              <input
                type="text"
                value={editCoverUrl}
                onChange={(e) => setEditCoverUrl(e.target.value)}
                placeholder="Or paste cover photo URL..."
                className="w-full h-9 px-3 rounded-xl bg-white dark:bg-[#121316] border border-[#D1D5DB] dark:border-[#374151] text-xs text-[#111827] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1877F2]"
              />
            </div>

            {/* Save / Cancel Controls */}
            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-[#E4E6EB] dark:border-[#2E3035]">
              <button
                type="button"
                onClick={() => setIsEditing(false)}
                className="px-4 h-10 rounded-xl border border-[#D1D5DB] dark:border-[#374151] text-sm font-medium text-[#374151] dark:text-[#D1D5DB] hover:bg-[#E4E6EB] dark:hover:bg-[#2A2D32] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingProfile || uploadingAvatar || uploadingCover}
                className="inline-flex items-center gap-2 px-5 h-10 rounded-xl bg-[#1877F2] hover:bg-[#166FE5] dark:bg-[#2563EB] dark:hover:bg-[#1D4ED8] text-white text-sm font-semibold disabled:opacity-60 transition-colors cursor-pointer"
              >
                {savingProfile && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>{savingProfile ? 'Saving...' : 'Save Changes'}</span>
              </button>
            </div>
          </form>
        )}
      </section>

      {/* Profile Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left Intro Sidebar */}
        <aside className="lg:col-span-5 bg-white dark:bg-[#16191F] border border-[#E5E8EE] dark:border-[#252A34] rounded-2xl p-5 space-y-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <h2 className="text-base font-display font-bold text-[#0F172A] dark:text-white">
            Intro
          </h2>

          <p className="text-sm text-[#334155] dark:text-[#CBD5E1] leading-relaxed">
            {profile.bio || 'No bio added yet.'}
          </p>

          <dl className="space-y-3 pt-2 border-t border-[#E5E8EE] dark:border-[#252A34] text-sm text-[#475569] dark:text-[#94A3B8]">
            {profile.work && (
              <div className="flex items-center gap-2.5">
                <Briefcase className="w-4 h-4 shrink-0 text-[#64748B] dark:text-[#94A3B8]" />
                <dd className="text-[#0F172A] dark:text-[#E2E8F0]">{profile.work}</dd>
              </div>
            )}
            {profile.location && (
              <div className="flex items-center gap-2.5">
                <MapPin className="w-4 h-4 shrink-0 text-[#64748B] dark:text-[#94A3B8]" />
                <dd className="text-[#0F172A] dark:text-[#E2E8F0]">Lives in {profile.location}</dd>
              </div>
            )}
            {isOwnProfile && profile.email && (
              <div className="flex items-center gap-2.5">
                <Mail className="w-4 h-4 shrink-0 text-[#64748B] dark:text-[#94A3B8]" />
                <dd className="text-[#0F172A] dark:text-[#E2E8F0] truncate">{profile.email}</dd>
              </div>
            )}
            {isOwnProfile && profile.phone && (
              <div className="flex items-center gap-2.5">
                <Phone className="w-4 h-4 shrink-0 text-[#64748B] dark:text-[#94A3B8]" />
                <dd className="text-[#0F172A] dark:text-[#E2E8F0] tabular-nums">{profile.phone}</dd>
              </div>
            )}
            {isOwnProfile && profile.date_of_birth && (
              <div className="flex items-center gap-2.5">
                <Calendar className="w-4 h-4 shrink-0 text-[#64748B] dark:text-[#94A3B8]" />
                <dd className="text-[#0F172A] dark:text-[#E2E8F0] tabular-nums">
                  Born{' '}
                  {new Date(`${profile.date_of_birth}T00:00:00`).toLocaleDateString('en-GB', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                </dd>
              </div>
            )}
            <div className="flex items-center gap-2.5">
              <Calendar className="w-4 h-4 shrink-0 text-[#64748B] dark:text-[#94A3B8]" />
              <dd>
                Joined{' '}
                {new Date(profile.created_at).toLocaleDateString(undefined, {
                  month: 'long',
                  year: 'numeric',
                })}
              </dd>
            </div>
          </dl>

          {isOwnProfile && !isEditing && (
            <div className="space-y-2">
              <button
                type="button"
                onClick={openEditor}
                className="w-full h-10 rounded-xl bg-[#F1F5F9] dark:bg-[#222733] hover:bg-[#E2E8F0] dark:hover:bg-[#2D3342] text-sm font-semibold text-[#0F172A] dark:text-white transition-colors cursor-pointer"
              >
                Edit Bio &amp; Details
              </button>
              {onOpenAccountsCentre && (
                <button
                  type="button"
                  onClick={onOpenAccountsCentre}
                  className="w-full h-10 rounded-xl border border-[#E5E8EE] dark:border-[#252A34] hover:bg-[#F8FAFC] dark:hover:bg-[#1D222B] text-xs font-semibold text-[#1877F2] dark:text-[#60A5FA] transition-colors cursor-pointer"
                >
                  Personal details &amp; Password security
                </button>
              )}
            </div>
          )}
        </aside>

        {/* Right Profile Posts Column */}
        <div className="lg:col-span-7 space-y-4">
          {isOwnProfile && (
            <PostComposer
              currentUser={currentUser}
              onOpenProfile={onOpenProfile}
              onPostCreated={(newPost) => {
                setPosts((prev) => [newPost, ...prev]);
                setProfile((prev) =>
                  prev ? {...prev, posts_count: (prev.posts_count ?? 0) + 1} : prev,
                );
                onPostMutated();
              }}
            />
          )}

          {posts.length === 0 ? (
            <div className="bg-white dark:bg-[#1C1E21] border border-[#E4E6EB] dark:border-[#2E3035] rounded-2xl p-8 text-center">
              <p className="text-sm font-medium text-[#111827] dark:text-white">No posts yet</p>
              <p className="text-xs text-[#65676B] dark:text-[#9CA3AF] mt-1">
                {isOwnProfile
                  ? 'Share your first text, photo, or video post above.'
                  : `${profile.name} hasn't shared any posts yet.`}
              </p>
            </div>
          ) : (
            posts.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                currentUser={currentUser}
                onOpenProfile={onOpenProfile}
                onToggleLike={handleToggleLike}
                onCommentAdded={handleCommentAdded}
                onDeletePost={handleDeletePost}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
