import {useEffect, useRef, useState} from 'react';
import {
  Image as ImageIcon,
  Loader2,
  Maximize2,
  Pause,
  Play,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {getInitials} from '../lib/api';
import {resolveMediaUrl} from '../lib/localFallback';
import {
  getPostVideoStorageUrl,
  refreshFirebaseStorageUrl,
  resolveCloudVideoUrl,
} from '../lib/mediaUpload';

export function useResolvedMediaUrl(src?: string | null): string | null {
  const [resolved, setResolved] = useState<string | null>(() => {
    if (!src || !src.trim()) return null;
    return src.startsWith('idb://') || src.startsWith('fsvideo://') ? null : src;
  });

  useEffect(() => {
    let active = true;
    if (!src || !src.trim()) {
      setResolved(null);
      return;
    }
    if (src.startsWith('fsvideo://')) {
      resolveCloudVideoUrl(src).then((url) => {
        if (active) setResolved(url);
      });
      return () => {
        active = false;
      };
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
  durationSec?: number;
  className?: string;
}

export function PostVideo({src, poster, postId, durationSec = 0, className = ''}: PostVideoProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const [overrideSrc, setOverrideSrc] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [videoReady, setVideoReady] = useState(false);
  const [loadingCloud, setLoadingCloud] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [soundBadge, setSoundBadge] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(durationSec > 0 ? durationSec : 0);

  const userPausedRef = useRef(false);
  const autoRefreshedRef = useRef(false);
  const playOnReadyRef = useRef(false);
  const unmuteOnReadyRef = useRef(false);
  const soundBadgeTimerRef = useRef<number | null>(null);

  const resolvedSrc = useResolvedMediaUrl(src);
  const resolvedPoster = useResolvedMediaUrl(poster || null);
  const activeVideoUrl = overrideSrc || resolvedSrc;

  // Reset state whenever the source URL changes
  useEffect(() => {
    setOverrideSrc(null);
    setReloadNonce(0);
    setVideoReady(false);
    setLoadingCloud(Boolean(src && src.startsWith('fsvideo://') && !resolvedSrc));
    setBuffering(false);
    setPlaying(false);
    setMuted(true);
    setCurrentTime(0);
    setDuration(durationSec > 0 ? durationSec : 0);
    userPausedRef.current = false;
    autoRefreshedRef.current = false;
    playOnReadyRef.current = false;
    unmuteOnReadyRef.current = false;
  }, [src, durationSec]);

  useEffect(() => {
    if (resolvedSrc) {
      setLoadingCloud(false);
    }
  }, [resolvedSrc]);

  // Auto-recover older video posts if videoUrl is missing by checking posts/{postId}/video.mp4
  useEffect(() => {
    if (activeVideoUrl || !postId || src.startsWith('idb://') || src.startsWith('fsvideo://')) {
      return;
    }
    let cancelled = false;
    void getPostVideoStorageUrl(postId).then((recoveredUrl) => {
      if (!cancelled && recoveredUrl) {
        setOverrideSrc(recoveredUrl);
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

  // Facebook-style viewport Autoplay (auto-muted when visible >= 50%, auto-pause when scrolled away)
  useEffect(() => {
    const container = containerRef.current;
    const video = videoRef.current;
    if (!container || !video || !activeVideoUrl) return;
    if (typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry || !videoRef.current) return;
        const v = videoRef.current;
        if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
          if (!userPausedRef.current && v.paused) {
            v.muted = true;
            setMuted(true);
            void v.play().catch(() => {
              // Mobile browsers may wait for direct tap
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
  }, [activeVideoUrl, reloadNonce]);

  async function attemptSilentRecovery(): Promise<string | null> {
    if (src.startsWith('fsvideo://')) {
      const resolved = await resolveCloudVideoUrl(src);
      if (resolved) {
        setOverrideSrc(resolved);
        return resolved;
      }
    }
    const freshUrl =
      (await refreshFirebaseStorageUrl(src)) ||
      (postId ? await getPostVideoStorageUrl(postId) : null);
    if (freshUrl) {
      setOverrideSrc(freshUrl);
      return freshUrl;
    }
    return null;
  }

  // Tapping the video surface:
  // - If currently playing muted (autoplayed), tapping turns sound ON (Facebook behavior)
  // - If playing with sound ON, tapping pauses
  // - If paused, tapping plays with sound ON (silently reloading if needed)
  async function handleSurfaceTap() {
    const v = videoRef.current;
    if (!v) {
      await handleTapWhenUnloaded();
      return;
    }

    if (!v.paused && !v.ended && v.muted) {
      v.muted = false;
      setMuted(false);
      flashSoundBadge('Sound on');
      return;
    }

    await togglePlay(true);
  }

  async function handleTapWhenUnloaded() {
    setLoadingCloud(true);
    playOnReadyRef.current = true;
    unmuteOnReadyRef.current = true;
    const recovered = await attemptSilentRecovery();
    setLoadingCloud(false);
    if (recovered) {
      setReloadNonce((n) => n + 1);
    }
  }

  async function togglePlay(preferUnmuted = false) {
    const v = videoRef.current;
    if (!v) {
      await handleTapWhenUnloaded();
      return;
    }
    if (v.paused || v.ended) {
      userPausedRef.current = false;
      if (preferUnmuted) {
        v.muted = false;
        setMuted(false);
      }
      try {
        await v.play();
      } catch {
        // If media element had a stale error/network hiccup, silently recover & play
        if (v.error || v.networkState === HTMLMediaElement.NETWORK_NO_SOURCE) {
          playOnReadyRef.current = true;
          unmuteOnReadyRef.current = preferUnmuted;
          const recovered = await attemptSilentRecovery();
          if (recovered) {
            setReloadNonce((n) => n + 1);
            return;
          }
          if (activeVideoUrl && !activeVideoUrl.startsWith('blob:') && !activeVideoUrl.startsWith('data:')) {
            v.load();
          }
        }
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
    setBuffering(false);
    setPlaying(false);
    if (!autoRefreshedRef.current) {
      autoRefreshedRef.current = true;
      const freshUrl = await attemptSilentRecovery();
      if (freshUrl && freshUrl !== activeVideoUrl) {
        setReloadNonce((n) => n + 1);
        return;
      }
    }
    // Keep clean thumbnail visible (NEVER display "Video unavailable" or "Tap to retry")
    setVideoReady(false);
  }

  // While permanent cloud video is resolving or if no URL yet, display clean thumbnail + Play button (NEVER "Video unavailable" / "Tap to retry")
  if (!activeVideoUrl) {
    return (
      <div
        className={`relative w-full aspect-video bg-[#0F1115] overflow-hidden border-y border-[#E5E8EE] dark:border-[#252A34] ${className}`}
      >
        {resolvedPoster && (
          <img
            src={resolvedPoster}
            alt="Video thumbnail"
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover"
          />
        )}
        <button
          type="button"
          onClick={() => void handleTapWhenUnloaded()}
          aria-label="Play video"
          className="absolute inset-0 bg-black/25 hover:bg-black/35 flex items-center justify-center transition-colors cursor-pointer"
        >
          <span className="w-16 h-16 rounded-full bg-black/70 border border-white/30 text-white flex items-center justify-center shadow-xl">
            {loadingCloud || src.startsWith('idb://') ? (
              <Loader2 className="w-7 h-7 animate-spin" />
            ) : (
              <Play className="w-7 h-7 fill-current ml-1" />
            )}
          </span>
        </button>
      </div>
    );
  }

  const effectiveDuration = duration > 0 ? duration : durationSec > 0 ? durationSec : 0;
  const progressPct =
    effectiveDuration > 0 ? Math.min(100, (currentTime / effectiveDuration) * 100) : 0;

  return (
    <div
      ref={containerRef}
      className={`relative w-full bg-black overflow-hidden border-y border-[#E5E8EE] dark:border-[#252A34] group ${className}`}
    >
      {/* Crisp 1-second video thumbnail displayed seamlessly until video frames load */}
      {resolvedPoster && !videoReady && (
        <img
          src={resolvedPoster}
          alt="Video thumbnail"
          referrerPolicy="no-referrer"
          className="absolute inset-0 w-full h-full object-cover pointer-events-none select-none"
        />
      )}

      <video
        key={`${activeVideoUrl}_${reloadNonce}`}
        ref={videoRef}
        src={activeVideoUrl}
        poster={resolvedPoster || undefined}
        muted={muted}
        playsInline
        preload="metadata"
        onClick={() => void handleSurfaceTap()}
        onPlay={() => {
          setPlaying(true);
        }}
        onPlaying={() => {
          setPlaying(true);
          setVideoReady(true);
          setBuffering(false);
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onWaiting={() => setBuffering(true)}
        onCanPlay={() => {
          setVideoReady(true);
          setBuffering(false);
          if (playOnReadyRef.current && videoRef.current) {
            playOnReadyRef.current = false;
            const wantUnmuted = unmuteOnReadyRef.current;
            unmuteOnReadyRef.current = false;
            videoRef.current.muted = !wantUnmuted;
            setMuted(!wantUnmuted);
            void videoRef.current.play().catch(() => {
              if (videoRef.current) {
                videoRef.current.muted = true;
                setMuted(true);
                void videoRef.current.play().catch(() => {});
              }
            });
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
        className="relative w-full max-h-[540px] min-h-[220px] mx-auto block cursor-pointer object-contain bg-transparent"
      />

      {/* Buffering spinner overlay only while actively buffering */}
      {buffering && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/20">
          <span className="w-12 h-12 rounded-full bg-black/60 backdrop-blur-xs flex items-center justify-center text-white">
            <Loader2 className="w-6 h-6 animate-spin" />
          </span>
        </div>
      )}

      {/* Brief Sound On / Muted feedback pill when user taps video */}
      {soundBadge && (
        <div className="pointer-events-none absolute top-3 right-3 px-3 py-1 rounded-full bg-black/70 backdrop-blur-xs text-white text-xs font-semibold flex items-center gap-1.5 shadow-md">
          {muted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
          <span>{soundBadge}</span>
        </div>
      )}

      {/* Subtle "Tap for sound" pill while autoplaying muted like Facebook */}
      {playing && muted && !soundBadge && (
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

      {/* Centered Play Overlay when paused */}
      {!playing && !buffering && (
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

      {/* Facebook-style Bottom Controls: [Play/Pause] [Progress Bar] [Time] [Mute/Unmute] [Full Screen] */}
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
          max={effectiveDuration || 100}
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
          {formatVideoTime(currentTime)} / {formatVideoTime(effectiveDuration)}
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
    </div>
  );
}
