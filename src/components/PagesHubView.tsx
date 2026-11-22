import {useMemo, useRef, useState} from 'react';
import type {ChangeEvent, FormEvent} from 'react';
import {
  AlertCircle,
  Camera,
  Check,
  ChevronLeft,
  ExternalLink,
  Flag,
  Globe,
  Image as ImageIcon,
  Loader2,
  MessageCircle,
  Plus,
  Settings,
  Shield,
  ThumbsUp,
  Trash2,
  UserMinus,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import {formatFirestoreErrorMessage} from '../lib/firebase';
import {compressImageForFirestore} from '../lib/firestoreStore';
import {
  addPageAdminPermanent,
  createPagePermanent,
  deletePagePermanent,
  PAGE_CATEGORIES,
  removePageAdminPermanent,
  togglePageFollowPermanent,
  updatePagePermanent,
} from '../lib/pageService';
import type {
  CommentItem,
  PostItem,
  ReactionType,
  SocialPageDoc,
  UserProfile,
} from '../types';
import {Avatar, CoverImage, PostPhoto} from './MediaImage';
import {PostCard} from './PostCard';
import {PostComposer} from './PostComposer';

interface PagesHubViewProps {
  currentUser: UserProfile;
  allUsers: UserProfile[];
  pages: SocialPageDoc[];
  allPosts: PostItem[];
  activePageId: string | null;
  followingIds: number[];
  onSelectPage: (pageId: string | null) => void;
  onBack: () => void;
  onOpenProfile: (userId: number) => void;
  onPostCreated: (post: PostItem) => void;
  onToggleLike: (postId: number, reaction?: ReactionType) => void;
  onToggleSave: (postId: number) => void;
  onHidePost: (post: PostItem) => Promise<void> | void;
  onToggleFollowAuthor: (authorUid: string) => Promise<void> | void;
  onCommentAdded: (postId: number, comment: CommentItem) => void;
  onCommentDeleted: (postId: number, commentId: number) => void;
  onDeletePost: (postId: number) => Promise<void> | void;
}

export function PagesHubView({
  currentUser,
  allUsers,
  pages,
  allPosts,
  activePageId,
  followingIds,
  onSelectPage,
  onBack,
  onOpenProfile,
  onPostCreated,
  onToggleLike,
  onToggleSave,
  onHidePost,
  onToggleFollowAuthor,
  onCommentAdded,
  onCommentDeleted,
  onDeletePost,
}: PagesHubViewProps) {
  const myUid = currentUser.uid || '';

  // Create Page modal
  const [createOpen, setCreateOpen] = useState(false);
  const [pageName, setPageName] = useState('');
  const [category, setCategory] = useState<string>(PAGE_CATEGORIES[0]);
  const [bio, setBio] = useState('');
  const [website, setWebsite] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [pagePhoto, setPagePhoto] = useState('');
  const [coverPhoto, setCoverPhoto] = useState('');
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Page Profile tabs & settings
  const [pageTab, setPageTab] = useState<'posts' | 'about' | 'photos' | 'followers'>('posts');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [followBusyId, setFollowBusyId] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);

  // Settings form drafts
  const [editName, setEditName] = useState('');
  const [editCategory, setEditCategory] = useState<string>(PAGE_CATEGORIES[0]);
  const [editBio, setEditBio] = useState('');
  const [editWebsite, setEditWebsite] = useState('');
  const [editWhatsapp, setEditWhatsapp] = useState('');
  const [editPhoto, setEditPhoto] = useState('');
  const [editCover, setEditCover] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);
  const [adminBusyUid, setAdminBusyUid] = useState<string | null>(null);
  const [deletingPage, setDeletingPage] = useState(false);

  const createPhotoRef = useRef<HTMLInputElement>(null);
  const createCoverRef = useRef<HTMLInputElement>(null);
  const editPhotoRef = useRef<HTMLInputElement>(null);
  const editCoverRef = useRef<HTMLInputElement>(null);

  const userByUid = useMemo(() => {
    const map = new Map<string, UserProfile>();
    if (currentUser.uid) map.set(currentUser.uid, currentUser);
    for (const u of allUsers) {
      if (u.uid) map.set(u.uid, u);
    }
    return map;
  }, [allUsers, currentUser]);

  const myPages = useMemo(
    () => pages.filter((p) => p.ownerId === myUid || p.adminIds.includes(myUid)),
    [pages, myUid],
  );
  const likedPages = useMemo(
    () => pages.filter((p) => p.followers.includes(myUid)),
    [pages, myUid],
  );
  const suggestedPages = useMemo(
    () =>
      pages.filter(
        (p) => p.ownerId !== myUid && !p.adminIds.includes(myUid) && !p.followers.includes(myUid),
      ),
    [pages, myUid],
  );

  const activePage = useMemo(
    () => (activePageId ? pages.find((p) => p.pageId === activePageId) || null : null),
    [activePageId, pages],
  );

  async function handleImagePick(
    e: ChangeEvent<HTMLInputElement>,
    kind: 'avatar' | 'cover',
    setter: (val: string) => void,
    setBusy: (b: boolean) => void,
  ) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setFormError(null);
    setPageError(null);
    try {
      const dataUrl = await compressImageForFirestore(file, kind);
      setter(dataUrl);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to prepare photo.';
      setFormError(msg);
      setPageError(msg);
    } finally {
      setBusy(false);
    }
  }

  async function handleCreatePage(e: FormEvent) {
    e.preventDefault();
    if (!myUid || creating) return;
    setCreating(true);
    setFormError(null);
    try {
      const created = await createPagePermanent({
        ownerUid: myUid,
        pageName: pageName.trim(),
        category,
        pagePhoto,
        coverPhoto,
        bio: bio.trim(),
        website: website.trim(),
        whatsapp: whatsapp.trim(),
      });
      setCreateOpen(false);
      setPageName('');
      setCategory(PAGE_CATEGORIES[0]);
      setBio('');
      setWebsite('');
      setWhatsapp('');
      setPagePhoto('');
      setCoverPhoto('');
      onSelectPage(created.pageId);
      setPageTab('posts');
    } catch (err) {
      setFormError(formatFirestoreErrorMessage(err));
    } finally {
      setCreating(false);
    }
  }

  async function handleToggleFollow(page: SocialPageDoc) {
    if (!myUid || followBusyId) return;
    setFollowBusyId(page.pageId);
    setPageError(null);
    try {
      await togglePageFollowPermanent(page, myUid);
    } catch (err) {
      setPageError(formatFirestoreErrorMessage(err));
    } finally {
      setFollowBusyId(null);
    }
  }

  function openSettingsFor(page: SocialPageDoc) {
    setEditName(page.pageName);
    setEditCategory(page.category);
    setEditBio(page.bio);
    setEditWebsite(page.website);
    setEditWhatsapp(page.whatsapp);
    setEditPhoto(page.pagePhoto);
    setEditCover(page.coverPhoto);
    setPageError(null);
    setSettingsOpen(true);
  }

  async function handleSavePageSettings(e: FormEvent) {
    e.preventDefault();
    if (!activePage || savingSettings) return;
    setSavingSettings(true);
    setPageError(null);
    try {
      await updatePagePermanent(activePage.pageId, {
        pageName: editName.trim(),
        category: editCategory,
        pagePhoto: editPhoto,
        coverPhoto: editCover,
        bio: editBio.trim(),
        website: editWebsite.trim(),
        whatsapp: editWhatsapp.trim(),
      });
      setSettingsOpen(false);
    } catch (err) {
      setPageError(formatFirestoreErrorMessage(err));
    } finally {
      setSavingSettings(false);
    }
  }

  async function handleAddAdmin(targetUid: string) {
    if (!activePage || adminBusyUid) return;
    setAdminBusyUid(targetUid);
    setPageError(null);
    try {
      await addPageAdminPermanent(activePage, targetUid);
    } catch (err) {
      setPageError(formatFirestoreErrorMessage(err));
    } finally {
      setAdminBusyUid(null);
    }
  }

  async function handleRemoveAdmin(targetUid: string) {
    if (!activePage || adminBusyUid) return;
    setAdminBusyUid(targetUid);
    setPageError(null);
    try {
      await removePageAdminPermanent(activePage, targetUid);
    } catch (err) {
      setPageError(formatFirestoreErrorMessage(err));
    } finally {
      setAdminBusyUid(null);
    }
  }

  async function handleDeletePage() {
    if (!activePage || deletingPage) return;
    setDeletingPage(true);
    setPageError(null);
    try {
      await deletePagePermanent(activePage.pageId);
      setDeleteConfirmOpen(false);
      setSettingsOpen(false);
      onSelectPage(null);
    } catch (err) {
      setPageError(formatFirestoreErrorMessage(err));
    } finally {
      setDeletingPage(false);
    }
  }

  // ==========================================================
  // INDIVIDUAL FACEBOOK PAGE PROFILE VIEW
  // ==========================================================
  if (activePage) {
    const isOwner = activePage.ownerId === myUid;
    const isAdmin = isOwner || activePage.adminIds.includes(myUid);
    const isFollowing = activePage.followers.includes(myUid);
    const pagePosts = allPosts.filter((p) => p.page_id === activePage.pageId);
    const pagePhotos = pagePosts.filter((p) => Boolean(p.image_url));
    const followerProfiles = activePage.followers
      .map((uid) => userByUid.get(uid))
      .filter((u): u is UserProfile => Boolean(u));
    const adminCandidates = allUsers.filter(
      (u) => u.uid && !activePage.adminIds.includes(u.uid),
    );

    const whatsappHref = activePage.whatsapp
      ? activePage.whatsapp.startsWith('http')
        ? activePage.whatsapp
        : `https://wa.me/${activePage.whatsapp.replace(/[^0-9]/g, '')}`
      : '';
    const websiteHref = activePage.website
      ? activePage.website.startsWith('http')
        ? activePage.website
        : `https://${activePage.website}`
      : '';

    return (
      <div className="space-y-4">
        {/* Back to Pages Hub */}
        <button
          type="button"
          onClick={() => {
            setSettingsOpen(false);
            onSelectPage(null);
          }}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#1877F2] dark:text-[#60A5FA] hover:underline cursor-pointer"
        >
          <ChevronLeft className="w-4 h-4" />
          <span>Back to Pages</span>
        </button>

        {pageError && (
          <div className="flex items-start gap-2 rounded-2xl bg-[#FEF2F2] dark:bg-[#3B181A] border border-[#FECACA] dark:border-[#7F1D1D] p-3.5 text-xs font-medium text-[#B91C1C] dark:text-[#FCA5A5]">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{pageError}</span>
          </div>
        )}

        {/* Page Hero Header Card */}
        <section className="bg-white dark:bg-[#16191F] border border-[#E5E8EE] dark:border-[#252A34] rounded-2xl overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="relative h-44 sm:h-60 bg-[#1E293B]">
            <CoverImage src={activePage.coverPhoto} alt={`${activePage.pageName} cover`} />
            <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/55 to-transparent pointer-events-none" />
          </div>

          <div className="px-5 sm:px-7 pb-5">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 -mt-12 relative z-10">
              <div className="flex flex-col sm:flex-row sm:items-end gap-4">
                <div className="rounded-full p-1 bg-white dark:bg-[#16191F] w-fit">
                  <Avatar src={activePage.pagePhoto} name={activePage.pageName} size="xl" />
                </div>
                <div className="pb-1">
                  <h1 className="text-2xl sm:text-3xl font-display font-bold text-[#0F172A] dark:text-white leading-tight">
                    {activePage.pageName}
                  </h1>
                  <p className="text-xs sm:text-sm text-[#64748B] dark:text-[#94A3B8] mt-1 tabular-nums">
                    <span className="font-semibold text-[#1877F2] dark:text-[#60A5FA]">
                      {activePage.category}
                    </span>{' '}
                    ·{' '}
                    <strong className="text-[#0F172A] dark:text-white">
                      {activePage.followers.length}
                    </strong>{' '}
                    {activePage.followers.length === 1 ? 'follower' : 'followers'} ·{' '}
                    <strong className="text-[#0F172A] dark:text-white">{pagePosts.length}</strong>{' '}
                    {pagePosts.length === 1 ? 'post' : 'posts'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 flex-wrap pb-1">
                <button
                  type="button"
                  disabled={followBusyId === activePage.pageId}
                  onClick={() => handleToggleFollow(activePage)}
                  className={`inline-flex items-center gap-2 px-4 h-10 rounded-xl text-sm font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                    isFollowing
                      ? 'bg-[#F4F6F9] dark:bg-[#232732] text-[#0F172A] dark:text-white hover:bg-[#E5E8EE] dark:hover:bg-[#2D3342]'
                      : 'bg-[#1877F2] hover:bg-[#166FE5] text-white'
                  }`}
                >
                  {isFollowing ? <Check className="w-4 h-4" /> : <ThumbsUp className="w-4 h-4" />}
                  <span>{isFollowing ? 'Following' : 'Like & Follow'}</span>
                </button>

                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => openSettingsFor(activePage)}
                    className="inline-flex items-center gap-2 px-3.5 h-10 rounded-xl border border-[#D1D5DB] dark:border-[#374151] text-sm font-semibold text-[#0F172A] dark:text-white hover:bg-[#F4F6F9] dark:hover:bg-[#232732] whitespace-nowrap cursor-pointer"
                  >
                    <Settings className="w-4 h-4" />
                    <span>Page Settings</span>
                  </button>
                )}
              </div>
            </div>

            {activePage.bio && (
              <p className="mt-4 text-sm text-[#334155] dark:text-[#CBD5E1] leading-relaxed max-w-2xl">
                {activePage.bio}
              </p>
            )}

            {/* Page Navigation Tabs: Posts, About, Photos, Followers */}
            <div className="mt-5 pt-3 border-t border-[#E5E8EE] dark:border-[#252A34] flex items-center gap-1 overflow-x-auto">
              {(
                [
                  {id: 'posts', label: `Posts (${pagePosts.length})`},
                  {id: 'about', label: 'About'},
                  {id: 'photos', label: `Photos (${pagePhotos.length})`},
                  {id: 'followers', label: `Followers (${activePage.followers.length})`},
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setPageTab(tab.id)}
                  className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                    pageTab === tab.id
                      ? 'bg-[#1877F2]/12 text-[#1877F2] dark:text-[#60A5FA]'
                      : 'text-[#64748B] dark:text-[#94A3B8] hover:bg-[#F4F6F9] dark:hover:bg-[#232732]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* TAB: POSTS */}
        {pageTab === 'posts' && (
          <div className="space-y-4">
            {isAdmin && (
              <PostComposer
                currentUser={currentUser}
                postingAsPage={activePage}
                onPostCreated={onPostCreated}
                onOpenProfile={onOpenProfile}
              />
            )}

            {pagePosts.length === 0 ? (
              <div className="bg-white dark:bg-[#16191F] border border-[#E5E8EE] dark:border-[#252A34] rounded-2xl p-10 text-center space-y-2">
                <Flag className="w-7 h-7 mx-auto text-[#64748B] dark:text-[#94A3B8]" />
                <p className="text-sm font-semibold text-[#0F172A] dark:text-white">
                  No Page posts yet
                </p>
                <p className="text-xs text-[#64748B] dark:text-[#94A3B8]">
                  {isAdmin
                    ? `Publish a post above as ${activePage.pageName} — it will appear in the Home Feed too!`
                    : `${activePage.pageName} hasn't published any posts yet.`}
                </p>
              </div>
            ) : (
              pagePosts.map((post) => (
                <PostCard
                  key={post.id}
                  post={post}
                  currentUser={currentUser}
                  isFollowingAuthor={followingIds.includes(post.user_id)}
                  onOpenProfile={onOpenProfile}
                  onOpenPage={(pid) => onSelectPage(pid)}
                  onToggleLike={onToggleLike}
                  onToggleSave={onToggleSave}
                  onHidePost={onHidePost}
                  onToggleFollowAuthor={onToggleFollowAuthor}
                  onCommentAdded={onCommentAdded}
                  onCommentDeleted={onCommentDeleted}
                  onDeletePost={onDeletePost}
                />
              ))
            )}
          </div>
        )}

        {/* TAB: ABOUT */}
        {pageTab === 'about' && (
          <div className="bg-white dark:bg-[#16191F] border border-[#E5E8EE] dark:border-[#252A34] rounded-2xl p-5 space-y-4">
            <h2 className="font-display font-bold text-base text-[#0F172A] dark:text-white">
              About {activePage.pageName}
            </h2>
            <p className="text-sm text-[#334155] dark:text-[#CBD5E1] leading-relaxed">
              {activePage.bio || 'No description added yet.'}
            </p>
            <div className="space-y-2.5 pt-3 border-t border-[#E5E8EE] dark:border-[#252A34] text-sm">
              <div className="flex items-center gap-2.5 text-[#475569] dark:text-[#94A3B8]">
                <Flag className="w-4 h-4 shrink-0" />
                <span>Category: {activePage.category}</span>
              </div>
              {activePage.whatsapp && (
                <div className="flex items-center gap-2.5">
                  <MessageCircle className="w-4 h-4 shrink-0 text-[#16A34A]" />
                  <a
                    href={whatsappHref}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[#1877F2] dark:text-[#60A5FA] hover:underline inline-flex items-center gap-1"
                  >
                    <span>WhatsApp: {activePage.whatsapp}</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              )}
              {activePage.website && (
                <div className="flex items-center gap-2.5">
                  <Globe className="w-4 h-4 shrink-0 text-[#1877F2]" />
                  <a
                    href={websiteHref}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[#1877F2] dark:text-[#60A5FA] hover:underline inline-flex items-center gap-1 break-all"
                  >
                    <span>{activePage.website}</span>
                    <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                  </a>
                </div>
              )}
              <div className="flex items-center gap-2.5 text-[#475569] dark:text-[#94A3B8]">
                <Shield className="w-4 h-4 shrink-0" />
                <span>
                  Managed by{' '}
                  {activePage.adminIds
                    .map((uid) => userByUid.get(uid)?.name || 'Admin')
                    .join(', ')}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* TAB: PHOTOS */}
        {pageTab === 'photos' && (
          <div className="bg-white dark:bg-[#16191F] border border-[#E5E8EE] dark:border-[#252A34] rounded-2xl p-5">
            {pagePhotos.length === 0 ? (
              <div className="py-10 text-center space-y-2">
                <ImageIcon className="w-7 h-7 mx-auto text-[#64748B]" />
                <p className="text-sm font-semibold text-[#0F172A] dark:text-white">
                  No photos yet
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {pagePhotos.map((p) => (
                  <div key={p.id} className="rounded-xl overflow-hidden border border-[#E5E8EE] dark:border-[#252A34]">
                    {p.image_url && <PostPhoto src={p.image_url} alt={p.content || activePage.pageName} />}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB: FOLLOWERS */}
        {pageTab === 'followers' && (
          <div className="bg-white dark:bg-[#16191F] border border-[#E5E8EE] dark:border-[#252A34] rounded-2xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[#E5E8EE] dark:border-[#252A34]">
              <h2 className="font-display font-bold text-sm text-[#0F172A] dark:text-white tabular-nums">
                Followers ({activePage.followers.length})
              </h2>
            </div>
            {followerProfiles.length === 0 ? (
              <div className="p-8 text-center text-sm text-[#64748B] dark:text-[#94A3B8]">
                No followers yet. Share this Page so people can follow!
              </div>
            ) : (
              <div className="divide-y divide-[#E5E8EE] dark:divide-[#252A34]">
                {followerProfiles.map((u) => (
                  <button
                    key={u.uid}
                    type="button"
                    onClick={() => onOpenProfile(u.id)}
                    className="w-full px-5 py-3 flex items-center gap-3 text-left hover:bg-[#F8FAFC] dark:hover:bg-[#1E222B] cursor-pointer"
                  >
                    <Avatar src={u.avatar_url} name={u.name} size="sm" />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[#0F172A] dark:text-white truncate">
                        {u.name}
                      </p>
                      {u.work && (
                        <p className="text-xs text-[#64748B] dark:text-[#94A3B8] truncate">
                          {u.work}
                        </p>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* PAGE SETTINGS MODAL (Edit Page, Manage Admins, Delete Page) */}
        {settingsOpen && isAdmin && (
          <div className="fixed inset-0 z-[115] bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="w-full max-w-lg bg-white dark:bg-[#16191F] border border-[#E5E8EE] dark:border-[#252A34] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
              <div className="px-5 py-4 border-b border-[#E5E8EE] dark:border-[#252A34] flex items-center justify-between">
                <h2 className="font-display font-bold text-base text-[#0F172A] dark:text-white">
                  Page Settings
                </h2>
                <button
                  type="button"
                  onClick={() => setSettingsOpen(false)}
                  className="p-1.5 rounded-lg text-[#64748B] hover:bg-[#F4F6F9] dark:hover:bg-[#232732] cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-5 space-y-5 overflow-y-auto flex-1">
                <form id="page-settings-form" onSubmit={handleSavePageSettings} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-semibold text-[#334155] dark:text-[#CBD5E1] block mb-1">
                        Page Name
                      </label>
                      <input
                        type="text"
                        required
                        minLength={2}
                        maxLength={80}
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="w-full h-10 px-3 rounded-xl bg-[#F4F6F9] dark:bg-[#0E1014] text-sm text-[#0F172A] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1877F2]"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-[#334155] dark:text-[#CBD5E1] block mb-1">
                        Category
                      </label>
                      <select
                        value={editCategory}
                        onChange={(e) => setEditCategory(e.target.value)}
                        className="w-full h-10 px-3 rounded-xl bg-[#F4F6F9] dark:bg-[#0E1014] text-sm text-[#0F172A] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1877F2]"
                      >
                        {PAGE_CATEGORIES.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-[#334155] dark:text-[#CBD5E1] block mb-1">
                      About / Bio
                    </label>
                    <textarea
                      rows={3}
                      maxLength={500}
                      value={editBio}
                      onChange={(e) => setEditBio(e.target.value)}
                      className="w-full p-3 rounded-xl bg-[#F4F6F9] dark:bg-[#0E1014] text-sm text-[#0F172A] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1877F2]"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-semibold text-[#334155] dark:text-[#CBD5E1] block mb-1">
                        WhatsApp Number / Link
                      </label>
                      <input
                        type="text"
                        maxLength={40}
                        value={editWhatsapp}
                        onChange={(e) => setEditWhatsapp(e.target.value)}
                        placeholder="+8801..."
                        className="w-full h-10 px-3 rounded-xl bg-[#F4F6F9] dark:bg-[#0E1014] text-sm text-[#0F172A] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1877F2]"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-[#334155] dark:text-[#CBD5E1] block mb-1">
                        Website URL
                      </label>
                      <input
                        type="text"
                        maxLength={200}
                        value={editWebsite}
                        onChange={(e) => setEditWebsite(e.target.value)}
                        placeholder="https://example.com"
                        className="w-full h-10 px-3 rounded-xl bg-[#F4F6F9] dark:bg-[#0E1014] text-sm text-[#0F172A] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1877F2]"
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-3 flex-wrap">
                    <input
                      ref={editPhotoRef}
                      type="file"
                      accept="image/*"
                      onChange={(e) => handleImagePick(e, 'avatar', setEditPhoto, setUploadingPhoto)}
                      className="hidden"
                    />
                    <input
                      ref={editCoverRef}
                      type="file"
                      accept="image/*"
                      onChange={(e) => handleImagePick(e, 'cover', setEditCover, setUploadingCover)}
                      className="hidden"
                    />
                    <button
                      type="button"
                      disabled={uploadingPhoto}
                      onClick={() => editPhotoRef.current?.click()}
                      className="inline-flex items-center gap-1.5 px-3.5 h-9 rounded-xl bg-[#F4F6F9] dark:bg-[#232732] text-xs font-semibold text-[#0F172A] dark:text-white cursor-pointer"
                    >
                      <Camera className="w-3.5 h-3.5" />
                      <span>{uploadingPhoto ? 'Uploading...' : 'Change Page Photo'}</span>
                    </button>
                    <button
                      type="button"
                      disabled={uploadingCover}
                      onClick={() => editCoverRef.current?.click()}
                      className="inline-flex items-center gap-1.5 px-3.5 h-9 rounded-xl bg-[#F4F6F9] dark:bg-[#232732] text-xs font-semibold text-[#0F172A] dark:text-white cursor-pointer"
                    >
                      <ImageIcon className="w-3.5 h-3.5" />
                      <span>{uploadingCover ? 'Uploading...' : 'Change Cover Photo'}</span>
                    </button>
                  </div>
                </form>

                {/* Manage Page Admins (Owner Only) */}
                {isOwner && (
                  <div className="pt-4 border-t border-[#E5E8EE] dark:border-[#252A34] space-y-3">
                    <h3 className="text-xs font-bold uppercase tracking-wide text-[#64748B] dark:text-[#94A3B8]">
                      Page Admins ({activePage.adminIds.length})
                    </h3>
                    <div className="space-y-1.5">
                      {activePage.adminIds.map((uid) => {
                        const u = userByUid.get(uid);
                        return (
                          <div
                            key={uid}
                            className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-[#F4F6F9] dark:bg-[#0E1014]"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <Avatar src={u?.avatar_url || ''} name={u?.name || 'Admin'} size="xs" />
                              <span className="text-xs font-semibold text-[#0F172A] dark:text-white truncate">
                                {u?.name || 'Member'} {uid === activePage.ownerId ? '(Owner)' : ''}
                              </span>
                            </div>
                            {uid !== activePage.ownerId && (
                              <button
                                type="button"
                                disabled={adminBusyUid === uid}
                                onClick={() => handleRemoveAdmin(uid)}
                                className="text-xs font-semibold text-[#DC2626] hover:underline inline-flex items-center gap-1 cursor-pointer"
                              >
                                <UserMinus className="w-3.5 h-3.5" />
                                <span>Remove</span>
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {adminCandidates.length > 0 && (
                      <div className="space-y-1.5">
                        <p className="text-xs text-[#64748B] dark:text-[#94A3B8]">Add Admin:</p>
                        <div className="max-h-32 overflow-y-auto space-y-1">
                          {adminCandidates.map((u) => (
                            <div
                              key={u.uid}
                              className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-xl border border-[#E5E8EE] dark:border-[#252A34]"
                            >
                              <span className="text-xs text-[#0F172A] dark:text-white truncate">
                                {u.name}
                              </span>
                              <button
                                type="button"
                                disabled={adminBusyUid === u.uid}
                                onClick={() => handleAddAdmin(u.uid!)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#1877F2] text-white text-[11px] font-semibold cursor-pointer"
                              >
                                <UserPlus className="w-3 h-3" />
                                <span>Add Admin</span>
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Delete Page (Owner Only) */}
                    <div className="pt-3 border-t border-[#E5E8EE] dark:border-[#252A34]">
                      {deleteConfirmOpen ? (
                        <div className="p-3 rounded-xl bg-[#FEF2F2] dark:bg-[#3B181A] space-y-2.5">
                          <p className="text-xs font-semibold text-[#B91C1C] dark:text-[#FCA5A5]">
                            Are you sure you want to permanently delete "{activePage.pageName}"?
                          </p>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              disabled={deletingPage}
                              onClick={handleDeletePage}
                              className="px-3.5 h-8 rounded-lg bg-[#DC2626] text-white text-xs font-semibold cursor-pointer"
                            >
                              {deletingPage ? 'Deleting...' : 'Confirm Delete'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteConfirmOpen(false)}
                              className="px-3 h-8 rounded-lg text-xs font-semibold text-[#475569] dark:text-[#CBD5E1] cursor-pointer"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setDeleteConfirmOpen(true)}
                          className="w-full h-10 rounded-xl bg-[#FEF2F2] dark:bg-[#3B181A] text-[#DC2626] dark:text-[#FCA5A5] text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                          <span>Delete Page</span>
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="px-5 py-3.5 border-t border-[#E5E8EE] dark:border-[#252A34] flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setSettingsOpen(false)}
                  className="px-4 h-10 rounded-xl text-xs font-semibold text-[#64748B] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  form="page-settings-form"
                  disabled={savingSettings || uploadingPhoto || uploadingCover}
                  className="inline-flex items-center gap-1.5 px-5 h-10 rounded-xl bg-[#1877F2] hover:bg-[#166FE5] text-white text-xs font-semibold disabled:opacity-50 cursor-pointer"
                >
                  {savingSettings && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>{savingSettings ? 'Saving...' : 'Save Changes'}</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ==========================================================
  // PAGES HUB: [Create Page] + My Pages + Liked Pages + Suggested Pages
  // ==========================================================
  function renderPageCard(page: SocialPageDoc, showManageTag = false) {
    const isFollowing = page.followers.includes(myUid);
    return (
      <div
        key={page.pageId}
        className="bg-white dark:bg-[#16191F] border border-[#E5E8EE] dark:border-[#252A34] rounded-2xl overflow-hidden flex flex-col justify-between"
      >
        <div>
          <button
            type="button"
            onClick={() => {
              setPageTab('posts');
              onSelectPage(page.pageId);
            }}
            className="block w-full text-left cursor-pointer"
          >
            <div className="h-24 bg-[#1E293B]">
              <CoverImage src={page.coverPhoto} alt={page.pageName} />
            </div>
            <div className="px-4 pb-3 -mt-6 relative z-10">
              <div className="rounded-full p-0.5 bg-white dark:bg-[#16191F] w-fit">
                <Avatar src={page.pagePhoto} name={page.pageName} size="md" />
              </div>
              <h3 className="font-display font-bold text-base text-[#0F172A] dark:text-white mt-2 truncate hover:underline">
                {page.pageName}
              </h3>
              <p className="text-xs text-[#64748B] dark:text-[#94A3B8] tabular-nums">
                {page.category} · {page.followers.length}{' '}
                {page.followers.length === 1 ? 'follower' : 'followers'}
              </p>
              {page.bio && (
                <p className="text-xs text-[#475569] dark:text-[#CBD5E1] mt-1.5 line-clamp-2">
                  {page.bio}
                </p>
              )}
            </div>
          </button>
        </div>

        <div className="px-4 pb-4 flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setPageTab('posts');
              onSelectPage(page.pageId);
            }}
            className="flex-1 h-9 rounded-xl bg-[#F4F6F9] dark:bg-[#232732] hover:bg-[#E5E8EE] dark:hover:bg-[#2D3342] text-xs font-semibold text-[#0F172A] dark:text-white cursor-pointer"
          >
            {showManageTag ? 'Manage Page' : 'View Page'}
          </button>
          <button
            type="button"
            disabled={followBusyId === page.pageId}
            onClick={() => handleToggleFollow(page)}
            className={`px-3.5 h-9 rounded-xl text-xs font-semibold whitespace-nowrap cursor-pointer ${
              isFollowing
                ? 'border border-[#1877F2] text-[#1877F2] dark:border-[#60A5FA] dark:text-[#60A5FA]'
                : 'bg-[#1877F2] hover:bg-[#166FE5] text-white'
            }`}
          >
            {isFollowing ? 'Following' : 'Follow'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="bg-white dark:bg-[#16191F] border border-[#E5E8EE] dark:border-[#252A34] rounded-2xl p-4 sm:p-5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-[#F4F6F9] dark:hover:bg-[#232732] text-[#0F172A] dark:text-white shrink-0 cursor-pointer"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="min-w-0">
            <h1 className="text-xl font-display font-bold text-[#0F172A] dark:text-white truncate">
              Pages
            </h1>
            <p className="text-xs text-[#64748B] dark:text-[#94A3B8] truncate">
              Create and manage your own Facebook-style Pages
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            setFormError(null);
            setCreateOpen(true);
          }}
          className="inline-flex items-center gap-1.5 px-4 h-10 rounded-xl bg-[#1877F2] hover:bg-[#166FE5] text-white text-xs sm:text-sm font-semibold whitespace-nowrap cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Create Page</span>
        </button>
      </div>

      {pageError && (
        <div className="flex items-start gap-2 rounded-2xl bg-[#FEF2F2] dark:bg-[#3B181A] border border-[#FECACA] dark:border-[#7F1D1D] p-3.5 text-xs font-medium text-[#B91C1C] dark:text-[#FCA5A5]">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{pageError}</span>
        </div>
      )}

      {/* Your Pages */}
      <section className="space-y-3">
        <h2 className="text-sm font-display font-bold text-[#0F172A] dark:text-white px-1">
          Your Pages ({myPages.length})
        </h2>
        {myPages.length === 0 ? (
          <div className="bg-white dark:bg-[#16191F] border border-[#E5E8EE] dark:border-[#252A34] rounded-2xl p-6 text-center space-y-2.5">
            <Flag className="w-7 h-7 mx-auto text-[#1877F2] dark:text-[#60A5FA]" />
            <p className="text-sm font-semibold text-[#0F172A] dark:text-white">
              You haven&apos;t created any Pages yet
            </p>
            <p className="text-xs text-[#64748B] dark:text-[#94A3B8]">
              Create a Page for your business, shop, community, or creator brand inside your account.
            </p>
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="inline-flex items-center gap-1.5 px-4 h-9 rounded-xl bg-[#1877F2] text-white text-xs font-semibold cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Create Page</span>
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {myPages.map((p) => renderPageCard(p, true))}
          </div>
        )}
      </section>

      {/* Liked & Followed Pages */}
      <section className="space-y-3">
        <h2 className="text-sm font-display font-bold text-[#0F172A] dark:text-white px-1">
          Liked &amp; Followed Pages ({likedPages.length})
        </h2>
        {likedPages.length === 0 ? (
          <div className="bg-white dark:bg-[#16191F] border border-[#E5E8EE] dark:border-[#252A34] rounded-2xl p-5 text-center text-xs text-[#64748B] dark:text-[#94A3B8]">
            Pages you like or follow will appear here in real time.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {likedPages.map((p) => renderPageCard(p, p.ownerId === myUid))}
          </div>
        )}
      </section>

      {/* Suggested Pages */}
      <section className="space-y-3">
        <h2 className="text-sm font-display font-bold text-[#0F172A] dark:text-white px-1">
          Suggested Pages ({suggestedPages.length})
        </h2>
        {suggestedPages.length === 0 ? (
          <div className="bg-white dark:bg-[#16191F] border border-[#E5E8EE] dark:border-[#252A34] rounded-2xl p-5 text-center text-xs text-[#64748B] dark:text-[#94A3B8]">
            <Users className="w-5 h-5 mx-auto mb-1 opacity-70" />
            No other public Pages to discover yet.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {suggestedPages.map((p) => renderPageCard(p, false))}
          </div>
        )}
      </section>

      {/* CREATE PAGE MODAL */}
      {createOpen && (
        <div className="fixed inset-0 z-[115] bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <form
            onSubmit={handleCreatePage}
            className="w-full max-w-lg bg-white dark:bg-[#16191F] border border-[#E5E8EE] dark:border-[#252A34] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
          >
            <div className="px-5 py-4 border-b border-[#E5E8EE] dark:border-[#252A34] flex items-center justify-between">
              <div>
                <h2 className="font-display font-bold text-base text-[#0F172A] dark:text-white">
                  Create a Page
                </h2>
                <p className="text-xs text-[#64748B] dark:text-[#94A3B8]">
                  Saved permanently to Cloud Firestore under your account
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="p-1.5 rounded-lg text-[#64748B] hover:bg-[#F4F6F9] dark:hover:bg-[#232732] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto flex-1">
              {formError && (
                <div className="flex items-start gap-2 rounded-xl bg-[#FEF2F2] dark:bg-[#3B181A] border border-[#FECACA] dark:border-[#7F1D1D] px-3 py-2 text-xs text-[#B91C1C] dark:text-[#FCA5A5]">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{formError}</span>
                </div>
              )}

              {/* Cover + Avatar uploaders */}
              <div className="relative rounded-xl overflow-hidden border border-[#E5E8EE] dark:border-[#252A34] bg-[#F4F6F9] dark:bg-[#0E1014]">
                <input
                  ref={createCoverRef}
                  type="file"
                  accept="image/*"
                  onChange={(e) => handleImagePick(e, 'cover', setCoverPhoto, setUploadingCover)}
                  className="hidden"
                />
                <input
                  ref={createPhotoRef}
                  type="file"
                  accept="image/*"
                  onChange={(e) => handleImagePick(e, 'avatar', setPagePhoto, setUploadingPhoto)}
                  className="hidden"
                />
                <div className="h-28 bg-[#1E293B] relative">
                  {coverPhoto && <CoverImage src={coverPhoto} alt="Page cover" />}
                  <button
                    type="button"
                    disabled={uploadingCover}
                    onClick={() => createCoverRef.current?.click()}
                    className="absolute bottom-2 right-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-black/70 text-white text-xs font-semibold cursor-pointer"
                  >
                    <ImageIcon className="w-3.5 h-3.5" />
                    <span>{uploadingCover ? 'Uploading...' : 'Cover Photo'}</span>
                  </button>
                </div>
                <div className="px-4 pb-3 flex items-center gap-3 -mt-6 relative z-10">
                  <button
                    type="button"
                    disabled={uploadingPhoto}
                    onClick={() => createPhotoRef.current?.click()}
                    className="relative w-14 h-14 rounded-full bg-white dark:bg-[#16191F] p-0.5 border border-[#E5E8EE] dark:border-[#252A34] flex items-center justify-center overflow-hidden cursor-pointer shrink-0"
                  >
                    {pagePhoto ? (
                      <img src={pagePhoto} alt="Page photo" className="w-full h-full rounded-full object-cover" />
                    ) : (
                      <Camera className="w-5 h-5 text-[#64748B]" />
                    )}
                  </button>
                  <span className="text-xs text-[#64748B] dark:text-[#94A3B8] pt-5">
                    Tap circle to upload Page Profile Photo
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-[#334155] dark:text-[#CBD5E1] block mb-1">
                    Page Name *
                  </label>
                  <input
                    type="text"
                    required
                    minLength={2}
                    maxLength={80}
                    value={pageName}
                    onChange={(e) => setPageName(e.target.value)}
                    placeholder="e.g. Dhaka Coffee House"
                    className="w-full h-10 px-3 rounded-xl bg-[#F4F6F9] dark:bg-[#0E1014] text-sm text-[#0F172A] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1877F2]"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-[#334155] dark:text-[#CBD5E1] block mb-1">
                    Category *
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full h-10 px-3 rounded-xl bg-[#F4F6F9] dark:bg-[#0E1014] text-sm text-[#0F172A] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1877F2]"
                  >
                    {PAGE_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-[#334155] dark:text-[#CBD5E1] block mb-1">
                  About / Bio
                </label>
                <textarea
                  rows={3}
                  maxLength={500}
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder="Describe what your Page is about..."
                  className="w-full p-3 rounded-xl bg-[#F4F6F9] dark:bg-[#0E1014] text-sm text-[#0F172A] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1877F2]"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-[#334155] dark:text-[#CBD5E1] block mb-1">
                    WhatsApp (optional)
                  </label>
                  <input
                    type="text"
                    maxLength={40}
                    value={whatsapp}
                    onChange={(e) => setWhatsapp(e.target.value)}
                    placeholder="+8801XXXXXXXXX"
                    className="w-full h-10 px-3 rounded-xl bg-[#F4F6F9] dark:bg-[#0E1014] text-sm text-[#0F172A] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1877F2]"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-[#334155] dark:text-[#CBD5E1] block mb-1">
                    Website (optional)
                  </label>
                  <input
                    type="text"
                    maxLength={200}
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                    placeholder="https://yourwebsite.com"
                    className="w-full h-10 px-3 rounded-xl bg-[#F4F6F9] dark:bg-[#0E1014] text-sm text-[#0F172A] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1877F2]"
                  />
                </div>
              </div>
            </div>

            <div className="px-5 py-3.5 border-t border-[#E5E8EE] dark:border-[#252A34] flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="px-4 h-10 rounded-xl text-xs font-semibold text-[#64748B] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={creating || uploadingPhoto || uploadingCover || pageName.trim().length < 2}
                className="inline-flex items-center gap-1.5 px-5 h-10 rounded-xl bg-[#1877F2] hover:bg-[#166FE5] text-white text-xs font-semibold disabled:opacity-50 cursor-pointer"
              >
                {creating && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>{creating ? 'Creating...' : 'Create Page'}</span>
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
