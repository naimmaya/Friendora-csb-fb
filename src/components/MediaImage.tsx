import {useEffect, useRef, useState} from 'react';
import {
  Image as ImageIcon,
  Loader2,
  Maximize2,
  Pause,
  Play,
  RotateCcw,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {getInitials} from '../lib/api';
import {resolveMediaUrl} from '../lib/localFallback';
import {getPostVideoStorageUrl, refreshFirebaseStorageUrl} from '../lib/mediaUpload';

export function useResolvedMediaUrl(src?: string | null): string | null {
  const [resolved, setResolved] = useState<string | null>(() => {
    if (!src || !src.trim()) return null;
    return src.startsWith('idb://') ? null : src;
  });

  useEffect(() => {
    let active = true;
    if (!src || !src.trim()) {
      setResolved(null);
      return;
    }
    if (!src.startsWith('idb://')) {
      setResolved(src);
      return;
    }
    resolveMediaUrl(src).then((url) => {
      if (active) setResolved(url);
    });
    return () => {
      active = false;
    };
  }, [src]);

  return resolved;
}

interface AvatarProps {
  src?: string | null;
  name: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  online?: boolean;
  className?: string;
}

const SIZE_CLASSES: Record<NonNullable<AvatarProps['size']>, string> = {
  xs: 'w-7 h-7 text-[11px]',
  sm: 'w-9 h-9 text-xs',
  md: 'w-10 h-10 text-sm',
  lg: 'w-14 h-14 text-base',
  xl: 'w-28 h-28 sm:w-32 sm:h-32 text-2xl',
};

export function Avatar({src, name, size = 'md', online, className = ''}: AvatarProps) {
  const [failed, setFailed] = useState(false);
  const resolvedSrc = useResolvedMediaUrl(src);

  useEffect(() => {
    setFailed(false);
  }, [resolvedSrc]);

  const showImage = Boolean(resolvedSrc && !failed);

  return (
    <div className={`relative inline-flex shrink-0 ${className}`}>
      <div
        className={`${SIZE_CLASSES[size]} rounded-full overflow-hidden flex items-center justify-center font-display font-semibold bg-[#E5E8EE] dark:bg-[#252A34] text-[#0F172A] dark:text-[#F1F5F9] select-none`}
      >
        {showImage ? (
          <img
            src={resolvedSrc!}
            alt={name}
            referrerPolicy="no-referrer"
            onError={() => setFailed(true)}
            className="w-full h-full object-cover"
          />
        ) : (
          <span>{getInitials(name || 'U')}</span>
        )}
      </div>
      {online && (
        <span
          title="Online now"
          className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-[#16A34A] ring-2 ring-white dark:ring-[#16191F]"
        />
      )}
    </div>
  );
}

interface CoverImageProps {
  src?: string | null;
  alt: string;
  className?: string;
}

export function CoverImage({src, alt, className = ''}: CoverImageProps) {
  const [failed, setFailed] = useState(false);
  const resolvedSrc = useResolvedMediaUrl(src);

  useEffect(() => {
    setFailed(false);
  }, [resolvedSrc]);

  const showImage = Boolean(resolvedSrc && !failed);

  if (!showImage) {
    return (
      <div
        className={`w-full h-full bg-gradient-to-br from-[#1E3A5F] via-[#274C77] to-[#18283B] flex items-center justify-center ${className}`}
      >
        <div className="flex items-center gap-2 text-white/70 text-sm font-medium">
          <ImageIcon className="w-5 h-5" />
          <span>Cover photo</span>
        </div>
      </div>
    );
  }

  return (
    <img
      src={resolvedSrc!}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={`w-full h-full object-cover ${className}`}
    />
  );
}

interface PostPhotoProps {
  src: string;
  alt: string;
}

export function PostPhoto({src, alt}: PostPhotoProps) {
  const [failed, setFailed] = useState(false);
  const resolvedSrc = useResolvedMediaUrl(src);

  useEffect(() => {
    setFailed(false);
  }, [resolvedSrc]);

  if (failed || (!resolvedSrc && !src.startsWith('idb://'))) {
    return (
      <div className="w-full aspect-[4/3] bg-[#F4F6F9] dark:bg-[#1E222B] flex flex-col items-center justify-center gap-2 text-[#64748B] dark:text-[#94A3B8] text-sm border-y border-[#E5E8EE] dark:border-[#252A34]">
        <ImageIcon className="w-6 h-6" />
        <span>Image unavailable</span>
      </div>
    );
  }

  if (!resolvedSrc) {
    return (
      <div className="w-full aspect-[4/3] bg-[#0F1115] animate-pulse border-y border-[#E5E8EE] dark:border-[#252A34]" />
    );
  }

  return (
    <div className="w-full bg-[#0F1115] overflow-hidden border-y border-[#E5E8EE] dark:border-[#252A34]">
      <img
        src={resolvedSrc}
        alt={alt}
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="w-full max-h-[540px] object-cover block"
      />
    </div>
  );
}

function formatVideoTime(sec: number): string {
  const safe = Math.max(0, Math.floor(sec || 0));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

interface PostVideoProps {
  src: string;
  poster?: string | null;
  postId?: string;
  className?: string;
}

export function PostVideo({src, poster, postId, className = ''}: PostVideoProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const [overrideSrc, setOverrideSrc] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [failed, setFailed] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [soundBadge, setSoundBadge] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const userPausedRef = useRef(false);
  const autoRefreshedRef = useRef(false);
  const playOnReadyRef = useRef(false);
  const soundBadgeTimerRef = useRef<number | null>(null);

  const resolvedSrc = useResolvedMediaUrl(src);
  const resolvedPoster = useResolvedMediaUrl(poster || null);
  const activeVideoUrl = overrideSrc || resolvedSrc;

  // Reset state whenever the source URL changes
  useEffect(() => {
    setOverrideSrc(null);
    setRetryCount(0);
    setFailed(false);
    setVideoReady(false);
    setBuffering(false);
    setPlaying(false);
    setMuted(true);
    setCurrentTime(0);
    setDuration(0);
    userPausedRef.current = false;
    autoRefreshedRef.current = false;
    playOnReadyRef.current = false;
  }, [resolvedSrc]);

  // Auto-recover older video posts if videoUrl is missing by checking posts/{postId}/video.mp4
  useEffect(() => {
    if (activeVideoUrl || !postId || src.startsWith('idb://')) return;
    let cancelled = false;
    void getPostVideoStorageUrl(postId).then((recoveredUrl) => {
      if (!cancelled && recoveredUrl) {
        setOverrideSrc(recoveredUrl);
        setFailed(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [activeVideoUrl, postId, src]);

  useEffect(() => {
    return () => {
      if (soundBadgeTimerRef.current) window.clearTimeout(soundBadgeTimerRef.current);
    };
  }, []);

  function flashSoundBadge(label: string) {
    setSoundBadge(label);
    if (soundBadgeTimerRef.current) window.clearTimeout(soundBadgeTimerRef.current);
    soundBadgeTimerRef.current = window.setTimeout(() => {
      setSoundBadge(null);
    }, 1100);
  }

  // Facebook-style viewport Autoplay (auto-muted when visible >= 60%, auto-pause when scrolled away)
  useEffect(() => {
    const container = containerRef.current;
    const video = videoRef.current;
    if (!container || !video || !activeVideoUrl || failed) return;

    if (typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry || !videoRef.current) return;
        const v = videoRef.current;
        if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
          if (!userPausedRef.current && v.paused && !failed) {
            v.muted = true;
            setMuted(true);
            void v.play().catch(() => {
              // Autoplay may still be deferred until interaction on some devices
            });
          }
        } else if (entry.intersectionRatio < 0.25) {
          if (!v.paused) {
            v.pause();
          }
        }
      },
      {threshold: [0.2, 0.25, 0.5, 0.75]},
    );

    observer.observe(container);
    return () => observer.disconnect();
  }, [activeVideoUrl, failed, retryCount]);

  // Tapping the video surface:
  // - If currently playing muted (autoplayed), tapping turns sound ON (Facebook behavior)
  // - If playing with sound ON, tapping pauses
  // - If paused, tapping plays with sound ON
  async function handleSurfaceTap() {
    const v = videoRef.current;
    if (!v || failed) return;

    if (!v.paused && !v.ended && v.muted) {
      v.muted = false;
      setMuted(false);
      flashSoundBadge('Sound on');
      return;
    }

    await togglePlay(true);
  }

  async function togglePlay(preferUnmuted = false) {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused || v.ended) {
      userPausedRef.current = false;
      if (preferUnmuted) {
        v.muted = false;
        setMuted(false);
      }
      try {
        await v.play();
      } catch {
        // Fallback: mute and retry if browser autoplay policy blocks unmuted play
        v.muted = true;
        setMuted(true);
        await v.play().catch(() => {});
      }
    } else {
      userPausedRef.current = true;
      v.pause();
    }
  }

  function toggleMute() {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
    flashSoundBadge(v.muted ? 'Muted' : 'Sound on');
  }

  function toggleFullscreen() {
    const v = videoRef.current as
      | (HTMLVideoElement & {webkitEnterFullscreen?: () => void})
      | null;
    const container = containerRef.current;
    if (!v) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    } else if (container?.requestFullscreen) {
      void container.requestFullscreen().catch(() => {
        if (v.webkitEnterFullscreen) v.webkitEnterFullscreen();
      });
    } else if (v.webkitEnterFullscreen) {
      v.webkitEnterFullscreen();
    }
  }

  async function handleVideoError() {
    // Auto-attempt 1 silent Firebase Storage URL refresh / posts/{postId}/video.mp4 recovery before showing Tap to retry
    if (!autoRefreshedRef.current) {
      autoRefreshedRef.current = true;
      const freshUrl =
        (await refreshFirebaseStorageUrl(src)) ||
        (postId ? await getPostVideoStorageUrl(postId) : null);
      if (freshUrl && freshUrl !== activeVideoUrl) {
        setOverrideSrc(freshUrl);
        setFailed(false);
        return;
      }
    }
    playOnReadyRef.current = false;
    setBuffering(false);
    setPlaying(false);
    setFailed(true);
  }

  async function handleRetry() {
    setFailed(false);
    setBuffering(true);
    setVideoReady(false);
    userPausedRef.current = false;
    playOnReadyRef.current = true;

    const freshUrl =
      (await refreshFirebaseStorageUrl(src)) ||
      (postId ? await getPostVideoStorageUrl(postId) : null);
    if (freshUrl) {
      setOverrideSrc(freshUrl);
    } else if (resolvedSrc && !resolvedSrc.startsWith('blob:') && !resolvedSrc.startsWith('data:')) {
      const sep = resolvedSrc.includes('?') ? '&' : '?';
      setOverrideSrc(`${resolvedSrc}${sep}retry=${Date.now()}`);
    }
    setRetryCount((c) => c + 1);
  }

  // If no playable URL yet (resolving idb:// or empty legacy URL), show thumbnail + Tap to retry (NEVER "Video unavailable")
  if (!activeVideoUrl) {
    return (
      <div className={`relative w-full aspect-video bg-[#0F1115] overflow-hidden border-y border-[#E5E8EE] dark:border-[#252A34] ${className}`}>
        {resolvedPoster && (
          <img
            src={resolvedPoster}
            alt="Video preview"
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover"
          />
        )}
        <div className="absolute inset-0 bg-black/45 flex flex-col items-center justify-center gap-2 text-white">
          {src.startsWith('idb://') ? (
            <Loader2 className="w-7 h-7 animate-spin text-white/85" />
          ) : (
            <button
              type="button"
              onClick={() => void handleRetry()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/15 hover:bg-white/25 backdrop-blur-md border border-white/25 text-xs sm:text-sm font-semibold text-white cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
              <span>Tap to retry</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  const progressPct = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  return (
    <div
      ref={containerRef}
      className={`relative w-full bg-black overflow-hidden border-y border-[#E5E8EE] dark:border-[#252A34] group ${className}`}
    >
      {/* 1-second frame thumbnail displayed seamlessly until video frame loads (or behind retry overlay) */}
      {resolvedPoster && (!videoReady || failed) && (
        <img
          src={resolvedPoster}
          alt="Video thumbnail"
          referrerPolicy="no-referrer"
          className="absolute inset-0 w-full h-full object-cover pointer-events-none select-none"
        />
      )}

      <video
        key={`${activeVideoUrl}_${retryCount}`}
        ref={videoRef}
        src={activeVideoUrl}
        poster={resolvedPoster || undefined}
        muted={muted}
        playsInline
        preload="metadata"
        onClick={() => void handleSurfaceTap()}
        onPlay={() => {
          setPlaying(true);
          setFailed(false);
        }}
        onPlaying={() => {
          setPlaying(true);
          setVideoReady(true);
          setBuffering(false);
          setFailed(false);
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onWaiting={() => setBuffering(true)}
        onCanPlay={() => {
          setVideoReady(true);
          setBuffering(false);
          if (playOnReadyRef.current && videoRef.current) {
            playOnReadyRef.current = false;
            videoRef.current.muted = true;
            setMuted(true);
            void videoRef.current.play().catch(() => {});
          }
        }}
        onLoadedData={() => {
          setVideoReady(true);
          setBuffering(false);
        }}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setDuration(d);
        }}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onError={() => void handleVideoError()}
        className={`relative w-full max-h-[540px] min-h-[220px] mx-auto block cursor-pointer object-contain bg-transparent ${
          failed ? 'opacity-0 pointer-events-none' : 'opacity-100'
        }`}
      />

      {/* Buffering spinner overlay (only while loading frames, never hides thumbnail) */}
      {!failed && buffering && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/20">
          <span className="w-12 h-12 rounded-full bg-black/60 backdrop-blur-xs flex items-center justify-center text-white">
            <Loader2 className="w-6 h-6 animate-spin" />
          </span>
        </div>
      )}

      {/* Brief Sound On / Muted feedback pill when user taps video */}
      {soundBadge && !failed && (
        <div className="pointer-events-none absolute top-3 right-3 px-3 py-1 rounded-full bg-black/70 backdrop-blur-xs text-white text-xs font-semibold flex items-center gap-1.5 shadow-md">
          {muted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
          <span>{soundBadge}</span>
        </div>
      )}

      {/* Subtle "Tap for sound" pill while autoplaying muted like Facebook */}
      {playing && muted && !failed && !soundBadge && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            toggleMute();
          }}
          className="absolute top-3 right-3 px-2.5 py-1 rounded-full bg-black/65 hover:bg-black/80 backdrop-blur-xs text-white text-[11px] font-semibold flex items-center gap-1.5 shadow-md cursor-pointer"
        >
          <VolumeX className="w-3.5 h-3.5" />
          <span>Tap for sound</span>
        </button>
      )}

      {/* Centered Play Overlay when paused (and not failed) */}
      {!playing && !failed && !buffering && (
        <button
          type="button"
          onClick={() => void togglePlay(true)}
          aria-label="Play video"
          className="absolute inset-0 flex items-center justify-center bg-black/25 hover:bg-black/35 transition-colors cursor-pointer"
        >
          <span className="w-16 h-16 rounded-full bg-black/70 border border-white/30 text-white flex items-center justify-center shadow-xl">
            <Play className="w-7 h-7 fill-current ml-1" />
          </span>
        </button>
      )}

      {/* Clean "Tap to retry" overlay on load error (NEVER "Video unavailable") */}
      {failed && (
        <button
          type="button"
          onClick={() => void handleRetry()}
          className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 bg-black/60 hover:bg-black/70 backdrop-blur-[2px] text-white transition-colors cursor-pointer"
        >
          <span className="w-14 h-14 rounded-full bg-white/15 border border-white/30 flex items-center justify-center shadow-lg">
            <RotateCcw className="w-6 h-6" />
          </span>
          <span className="text-sm font-semibold">Tap to retry</span>
        </button>
      )}

      {/* Facebook-style Bottom Controls: [Play/Pause] [Progress Bar] [Time] [Mute/Unmute] [Full Screen] */}
      {!failed && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-3 pt-6 pb-2.5 flex items-center gap-2.5 text-white"
        >
          <button
            type="button"
            onClick={() => void togglePlay(false)}
            aria-label={playing ? 'Pause video' : 'Play video'}
            className="w-8 h-8 rounded-full hover:bg-white/15 flex items-center justify-center shrink-0 cursor-pointer"
          >
            {playing ? (
              <Pause className="w-4 h-4 fill-current" />
            ) : (
              <Play className="w-4 h-4 fill-current ml-0.5" />
            )}
          </button>

          {/* Progress bar */}
          <input
            type="range"
            min={0}
            max={duration || 100}
            step={0.1}
            value={currentTime}
            aria-label="Seek video"
            onChange={(e) => {
              const next = Number(e.target.value);
              if (videoRef.current) videoRef.current.currentTime = next;
              setCurrentTime(next);
            }}
            style={{
              background: `linear-gradient(to right, #3B82F6 ${progressPct}%, rgba(255,255,255,0.3) ${progressPct}%)`,
            }}
            className="flex-1 h-1.5 rounded-full appearance-none cursor-pointer accent-[#3B82F6]"
          />

          <span className="text-[11px] font-medium tabular-nums shrink-0 text-white/90">
            {formatVideoTime(currentTime)} / {formatVideoTime(duration)}
          </span>

          <button
            type="button"
            onClick={toggleMute}
            aria-label={muted ? 'Unmute video' : 'Mute video'}
            className="w-8 h-8 rounded-full hover:bg-white/15 flex items-center justify-center shrink-0 cursor-pointer"
          >
            {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>

          <button
            type="button"
            onClick={toggleFullscreen}
            aria-label="Full screen video"
            className="w-8 h-8 rounded-full hover:bg-white/15 flex items-center justify-center shrink-0 cursor-pointer"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
