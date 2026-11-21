import {useState} from 'react';
import {Image as ImageIcon} from 'lucide-react';
import {getInitials} from '../lib/api';

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
  const showImage = Boolean(src && src.trim() && !failed);

  return (
    <div className={`relative inline-flex shrink-0 ${className}`}>
      <div
        className={`${SIZE_CLASSES[size]} rounded-full overflow-hidden flex items-center justify-center font-display font-semibold bg-[#E4E6EB] dark:bg-[#2E3035] text-[#111827] dark:text-[#F3F4F6] select-none`}
      >
        {showImage ? (
          <img
            src={src!}
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
          className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-[#16A34A] ring-2 ring-white dark:ring-[#1C1E21]"
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
  const showImage = Boolean(src && src.trim() && !failed);

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
      src={src!}
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

  if (failed) {
    return (
      <div className="w-full aspect-[4/3] bg-[#F0F2F5] dark:bg-[#24262B] flex flex-col items-center justify-center gap-2 text-[#65676B] dark:text-[#9CA3AF] text-sm border-y border-[#E4E6EB] dark:border-[#2E3035]">
        <ImageIcon className="w-6 h-6" />
        <span>Image unavailable</span>
      </div>
    );
  }

  return (
    <div className="w-full bg-[#0F1115] overflow-hidden border-y border-[#E4E6EB] dark:border-[#2E3035]">
      <img
        src={src}
        alt={alt}
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="w-full max-h-[520px] object-cover block"
      />
    </div>
  );
}
