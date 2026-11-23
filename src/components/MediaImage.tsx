import {useEffect, useRef, useState} from 'react';
import {
  Film,
  Image as ImageIcon,
  Maximize2,
  Pause,
  Play,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {getInitials} from '../lib/api';
import {resolveMediaUrl} from '../lib/localFallback';

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
  className?: string;
}

export function PostVideo({src, poster, className = ''}: PostVideoProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const resolvedSrc = useResolvedMediaUrl(src);
  const resolvedPoster = useResolvedMediaUrl(poster || null);

  useEffect(() => {
    setFailed(false);
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
  }, [resolvedSrc]);

  async function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused || v.ended) {
      try {
        await v.play();
      } catch {
        // Fallback: mute and retry if browser autoplay policy requires it
        v.muted = true;
        setMuted(true);
        await v.play().catch(() => {});
      }
    } else {
      v.pause();
    }
  }

  function toggleMute() {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
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

  if (failed) {
    return (
      <div className="w-full aspect-video bg-[#111827] flex flex-col items-center justify-center gap-2 text-white/70 text-sm border-y border-[#E5E8EE] dark:border-[#252A34]">
        <Film className="w-6 h-6" />
        <span>Video unavailable</span>
      </div>
    );
  }

  if (!resolvedSrc) {
    return (
      <div className="w-full aspect-video bg-[#0F1115] animate-pulse border-y border-[#E5E8EE] dark:border-[#252A34]" />
    );
  }

  const progressPct = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  return (
    <div
      ref={containerRef}
      className={`relative w-full bg-black overflow-hidden border-y border-[#E5E8EE] dark:border-[#252A34] group ${className}`}
    >
      <video
        ref={videoRef}
        src={resolvedSrc}
        poster={resolvedPoster || undefined}
        playsInline
        preload="metadata"
        onClick={() => void togglePlay()}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setDuration(d);
        }}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onError={() => setFailed(true)}
        className="w-full max-h-[540px] mx-auto block cursor-pointer"
      />

      {/* Centered Play Overlay when paused */}
      {!playing && (
        <button
          type="button"
          onClick={() => void togglePlay()}
          aria-label="Play video"
          className="absolute inset-0 flex items-center justify-center bg-black/25 hover:bg-black/35 transition-colors cursor-pointer"
        >
          <span className="w-16 h-16 rounded-full bg-black/70 border border-white/30 text-white flex items-center justify-center shadow-xl">
            <Play className="w-7 h-7 fill-current ml-1" />
          </span>
        </button>
      )}

      {/* Facebook-style Bottom Controls: Play/Pause, Scrubber, Duration, Mute/Unmute, Fullscreen */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-3 pt-6 pb-2.5 flex items-center gap-2.5 text-white"
      >
        <button
          type="button"
          onClick={() => void togglePlay()}
          aria-label={playing ? 'Pause video' : 'Play video'}
          className="w-8 h-8 rounded-full hover:bg-white/15 flex items-center justify-center shrink-0 cursor-pointer"
        >
          {playing ? (
            <Pause className="w-4 h-4 fill-current" />
          ) : (
            <Play className="w-4 h-4 fill-current ml-0.5" />
          )}
        </button>

        {/* Seek bar */}
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
    </div>
  );
}
