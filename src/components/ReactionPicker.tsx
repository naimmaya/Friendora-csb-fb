import {useEffect, useRef, useState} from 'react';
import {ThumbsUp} from 'lucide-react';
import type {ReactionType} from '../types';

export interface ReactionMeta {
  type: ReactionType;
  label: string;
  emoji: string;
  textColor: string;
  activeBg: string;
  badgeBg: string;
}

export const REACTIONS: ReactionMeta[] = [
  {
    type: 'like',
    label: 'Like',
    emoji: '👍',
    textColor: 'text-[#1877F2] dark:text-[#60A5FA]',
    activeBg: 'bg-[#1877F2]/10 dark:bg-[#3B82F6]/15',
    badgeBg: 'bg-gradient-to-b from-[#3B9EFF] to-[#1877F2]',
  },
  {
    type: 'love',
    label: 'Love',
    emoji: '❤️',
    textColor: 'text-[#F33E58] dark:text-[#FB7185]',
    activeBg: 'bg-[#F33E58]/10 dark:bg-[#F33E58]/15',
    badgeBg: 'bg-gradient-to-b from-[#FF5D7A] to-[#E11D48]',
  },
  {
    type: 'care',
    label: 'Care',
    emoji: '🥰',
    textColor: 'text-[#EAB308] dark:text-[#FACC15]',
    activeBg: 'bg-[#F7B125]/12 dark:bg-[#F7B125]/15',
    badgeBg: 'bg-gradient-to-b from-[#FFD452] to-[#F59E0B]',
  },
  {
    type: 'haha',
    label: 'Haha',
    emoji: '😆',
    textColor: 'text-[#EAB308] dark:text-[#FACC15]',
    activeBg: 'bg-[#F7B125]/12 dark:bg-[#F7B125]/15',
    badgeBg: 'bg-gradient-to-b from-[#FFD452] to-[#F59E0B]',
  },
  {
    type: 'wow',
    label: 'Wow',
    emoji: '😮',
    textColor: 'text-[#EAB308] dark:text-[#FACC15]',
    activeBg: 'bg-[#F7B125]/12 dark:bg-[#F7B125]/15',
    badgeBg: 'bg-gradient-to-b from-[#FFD452] to-[#F59E0B]',
  },
  {
    type: 'sad',
    label: 'Sad',
    emoji: '😢',
    textColor: 'text-[#EAB308] dark:text-[#FACC15]',
    activeBg: 'bg-[#F7B125]/12 dark:bg-[#F7B125]/15',
    badgeBg: 'bg-gradient-to-b from-[#FFD452] to-[#F59E0B]',
  },
  {
    type: 'angry',
    label: 'Angry',
    emoji: '😡',
    textColor: 'text-[#EA580C] dark:text-[#FB923C]',
    activeBg: 'bg-[#EA580C]/10 dark:bg-[#EA580C]/15',
    badgeBg: 'bg-gradient-to-b from-[#FF7B47] to-[#DC2626]',
  },
];

export const REACTION_MAP: Record<ReactionType, ReactionMeta> = REACTIONS.reduce(
  (acc, item) => {
    acc[item.type] = item;
    return acc;
  },
  {} as Record<ReactionType, ReactionMeta>,
);

export function ReactionSummaryBar({
  totalCount,
  reactionCounts,
  myReaction,
}: {
  totalCount: number;
  reactionCounts?: Partial<Record<ReactionType, number>>;
  myReaction?: ReactionType | null;
}) {
  const [showBreakdown, setShowBreakdown] = useState(false);

  if (totalCount <= 0) {
    return (
      <span className="text-xs text-[#64748B] dark:text-[#94A3B8]">
        Be the first to react
      </span>
    );
  }

  const entries = Object.entries(reactionCounts || {})
    .filter(([, count]) => typeof count === 'number' && count > 0)
    .sort((a, b) => (b[1] || 0) - (a[1] || 0)) as Array<[ReactionType, number]>;

  const topReactions: ReactionType[] =
    entries.length > 0
      ? entries.slice(0, 3).map(([type]) => type)
      : [myReaction || 'like'];

  return (
    <div className="relative inline-flex items-center">
      <button
        type="button"
        onClick={() => setShowBreakdown((prev) => !prev)}
        onMouseEnter={() => setShowBreakdown(true)}
        onMouseLeave={() => setShowBreakdown(false)}
        className="inline-flex items-center gap-1.5 text-xs text-[#64748B] dark:text-[#94A3B8] hover:underline cursor-pointer"
      >
        <span className="inline-flex items-center -space-x-1">
          {topReactions.map((type) => {
            const meta = REACTION_MAP[type] || REACTION_MAP.like;
            return (
              <span
                key={type}
                title={meta.label}
                className={`w-[18px] h-[18px] rounded-full ${meta.badgeBg} ring-2 ring-white dark:ring-[#16191F] flex items-center justify-center text-[10px] leading-none select-none`}
              >
                {meta.emoji}
              </span>
            );
          })}
        </span>
        <span className="tabular-nums font-medium">
          {myReaction && totalCount === 1
            ? 'You'
            : myReaction && totalCount > 1
              ? `You and ${totalCount - 1} ${totalCount - 1 === 1 ? 'other' : 'others'}`
              : totalCount}
        </span>
      </button>

      {showBreakdown && entries.length > 0 && (
        <div className="absolute left-0 bottom-full mb-2 z-30 min-w-[150px] rounded-xl bg-[#0F172A]/95 dark:bg-[#232732] text-white px-3 py-2 shadow-lg text-xs space-y-1 pointer-events-none">
          {entries.map(([type, count]) => {
            const meta = REACTION_MAP[type] || REACTION_MAP.like;
            return (
              <div key={type} className="flex items-center justify-between gap-4">
                <span className="inline-flex items-center gap-1.5">
                  <span>{meta.emoji}</span>
                  <span>{meta.label}</span>
                </span>
                <span className="tabular-nums font-semibold">{count}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface ReactionActionButtonProps {
  myReaction: ReactionType | null;
  likedByMe: boolean;
  onReact: (reaction: ReactionType) => void;
  compact?: boolean;
}

export function ReactionActionButton({
  myReaction,
  likedByMe,
  onReact,
  compact = false,
}: ReactionActionButtonProps) {
  const [trayOpen, setTrayOpen] = useState(false);
  const [hoveredType, setHoveredType] = useState<ReactionType | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hoverOpenTimer = useRef<number | null>(null);
  const hoverCloseTimer = useRef<number | null>(null);
  const longPressTimer = useRef<number | null>(null);
  const longPressTriggered = useRef(false);

  const effectiveReaction: ReactionType | null = myReaction || (likedByMe ? 'like' : null);
  const activeMeta = effectiveReaction ? REACTION_MAP[effectiveReaction] : null;

  useEffect(() => {
    if (!trayOpen) return;
    function handleOutside(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setTrayOpen(false);
        setHoveredType(null);
      }
    }
    document.addEventListener('pointerdown', handleOutside);
    return () => document.removeEventListener('pointerdown', handleOutside);
  }, [trayOpen]);

  useEffect(() => {
    return () => {
      if (hoverOpenTimer.current) window.clearTimeout(hoverOpenTimer.current);
      if (hoverCloseTimer.current) window.clearTimeout(hoverCloseTimer.current);
      if (longPressTimer.current) window.clearTimeout(longPressTimer.current);
    };
  }, []);

  function clearTimers() {
    if (hoverOpenTimer.current) window.clearTimeout(hoverOpenTimer.current);
    if (hoverCloseTimer.current) window.clearTimeout(hoverCloseTimer.current);
  }

  function handleMouseEnter() {
    clearTimers();
    hoverOpenTimer.current = window.setTimeout(() => {
      setTrayOpen(true);
    }, 160);
  }

  function handleMouseLeave() {
    clearTimers();
    hoverCloseTimer.current = window.setTimeout(() => {
      setTrayOpen(false);
      setHoveredType(null);
    }, 280);
  }

  function handlePointerDown(e: React.PointerEvent) {
    longPressTriggered.current = false;
    if (e.pointerType !== 'mouse') {
      longPressTimer.current = window.setTimeout(() => {
        longPressTriggered.current = true;
        setTrayOpen(true);
      }, 280);
    }
  }

  function handlePointerUp() {
    if (longPressTimer.current) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  function handleButtonClick(e: React.MouseEvent) {
    if (longPressTriggered.current) {
      longPressTriggered.current = false;
      return;
    }
    // On mobile/touch or if tray isn't open yet via click:
    // Opening the reaction picker tray on tap lets users immediately pick Like, Love, Care, Haha, Wow, Sad, Angry.
    // Tapping the button again while the tray is open selects Like (or toggles off current reaction).
    const isTouch =
      (e.nativeEvent as PointerEvent)?.pointerType === 'touch' ||
      window.matchMedia('(hover: none)').matches;

    if (!trayOpen) {
      setTrayOpen(true);
      return;
    }

    if (isTouch) {
      // Second tap on main button while tray is open -> quick toggle Like / remove active
      onReact(effectiveReaction || 'like');
      setTrayOpen(false);
    } else {
      onReact(effectiveReaction || 'like');
      setTrayOpen(false);
    }
  }

  function handleSelectReaction(type: ReactionType) {
    clearTimers();
    setTrayOpen(false);
    setHoveredType(null);
    onReact(type);
  }

  return (
    <div
      ref={containerRef}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className="relative"
    >
      {/* Floating Facebook-style Reactions Picker Dock */}
      {trayOpen && (
        <div
          role="menu"
          aria-label="Choose a reaction"
          className="absolute bottom-full left-0 pb-2 z-40"
        >
          <div className="flex items-center gap-0.5 sm:gap-1 px-2 py-1.5 rounded-full bg-white dark:bg-[#1E222B] border border-[#E5E8EE] dark:border-[#303644] shadow-[0_10px_30px_rgba(15,23,42,0.18)] dark:shadow-[0_12px_32px_rgba(0,0,0,0.6)]">
            {REACTIONS.map((item) => {
              const isSelected = effectiveReaction === item.type;
              const isHovered = hoveredType === item.type;
              return (
                <button
                  key={item.type}
                  type="button"
                  role="menuitem"
                  aria-label={item.label}
                  onMouseEnter={() => setHoveredType(item.type)}
                  onMouseLeave={() => setHoveredType(null)}
                  onClick={() => handleSelectReaction(item.type)}
                  className={`relative w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center transition-transform duration-150 cursor-pointer select-none ${
                    isHovered ? 'scale-135 -translate-y-1.5' : 'hover:scale-125 active:scale-110'
                  } ${
                    isSelected
                      ? 'ring-2 ring-[#1877F2] dark:ring-[#60A5FA] bg-[#1877F2]/10'
                      : ''
                  }`}
                >
                  {isHovered && (
                    <span className="absolute -top-7 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full bg-[#0F172A] text-white text-[10px] font-semibold whitespace-nowrap pointer-events-none shadow-sm">
                      {item.label}
                    </span>
                  )}
                  <span className="text-[22px] sm:text-[26px] leading-none" role="img" aria-hidden="true">
                    {item.emoji}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Trigger button */}
      <button
        type="button"
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onClick={handleButtonClick}
        className={`${
          compact
            ? 'inline-flex items-center gap-1.5 font-semibold text-xs cursor-pointer'
            : `w-full h-10 rounded-xl flex items-center justify-center gap-1.5 text-xs sm:text-sm font-semibold transition-colors cursor-pointer ${
                activeMeta
                  ? `${activeMeta.textColor} ${activeMeta.activeBg}`
                  : 'text-[#64748B] dark:text-[#94A3B8] hover:bg-[#F4F6F9] dark:hover:bg-[#1E232D]'
              }`
        }`}
      >
        {activeMeta ? (
          <>
            <span className="text-base leading-none" role="img" aria-hidden="true">
              {activeMeta.emoji}
            </span>
            <span className={compact ? activeMeta.textColor : ''}>{activeMeta.label}</span>
          </>
        ) : (
          <>
            <ThumbsUp className="w-4 h-4" />
            <span>Like</span>
          </>
        )}
      </button>
    </div>
  );
}
