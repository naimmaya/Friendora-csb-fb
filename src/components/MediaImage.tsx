import {useEffect, useState} from 'react';
import {Film, Image as ImageIcon} from 'lucide-react';
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

interface PostVideoProps {
  src: string;
  className?: string;
}

export function PostVideo({src, className = ''}: PostVideoProps) {
  const [failed, setFailed] = useState(false);
  const resolvedSrc = useResolvedMediaUrl(src);

  useEffect(() => {
    setFailed(false);
  }, [resolvedSrc]);

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

  return (
    <div
      className={`w-full bg-black overflow-hidden border-y border-[#E5E8EE] dark:border-[#252A34] ${className}`}
    >
      <video
        src={resolvedSrc}
        controls
        playsInline
        preload="metadata"
        onError={() => setFailed(true)}
        className="w-full max-h-[540px] mx-auto block"
      />
    </div>
  );
}
