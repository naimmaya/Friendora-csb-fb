import {useEffect, useRef, useState} from 'react';
import {
  Check,
  CheckCheck,
  Download,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  MapPin,
  Pause,
  Phone,
  PhoneMissed,
  Play,
  Video,
  X,
} from 'lucide-react';
import {formatRelativeTime} from '../lib/api';
import {formatFileSize} from '../lib/mediaUpload';
import type {ChatMessageType} from '../types';
import {Avatar, useResolvedMediaUrl} from './MediaImage';

export interface UnifiedBubbleMessage {
  id: string | number;
  mine: boolean;
  senderName?: string;
  senderAvatar?: string;
  content: string;
  messageType: ChatMessageType | 'system';
  mediaUrl?: string;
  mediaName?: string;
  mediaSize?: number;
  voiceDurationSec?: number;
  locationLat?: number;
  locationLng?: number;
  locationLabel?: string;
  callType?: '' | 'audio' | 'video';
  callStatus?: '' | 'completed' | 'missed' | 'declined';
  read?: boolean;
  showSeenTick?: boolean;
  createdAt: string;
}

interface ChatMessageBubbleProps {
  message: UnifiedBubbleMessage;
  showSenderIdentity?: boolean;
  onCallBack?: (type: 'audio' | 'video') => void;
}

// Global voice playback coordinator: playing one voice message automatically pauses any other!
let currentlyPlayingAudio: HTMLAudioElement | null = null;

const VOICE_BAR_HEIGHTS = [
  32, 55, 42, 78, 92, 60, 48, 84, 70, 38, 64, 96, 74, 52, 44, 88, 68, 40, 76, 58, 36, 62, 46, 30,
];

function formatSec(sec: number): string {
  const safe = Math.max(0, Math.round(sec || 0));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function VoiceMessagePlayer({
  src,
  durationHintSec,
  mine,
}: {
  src: string;
  durationHintSec?: number;
  mine: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState<number>(durationHintSec || 0);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    const audio = audioRef.current;
    return () => {
      if (audio) {
        audio.pause();
        if (currentlyPlayingAudio === audio) {
          currentlyPlayingAudio = null;
        }
      }
    };
  }, []);

  async function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
      return;
    }
    if (currentlyPlayingAudio && currentlyPlayingAudio !== audio) {
      currentlyPlayingAudio.pause();
    }
    currentlyPlayingAudio = audio;
    try {
      await audio.play();
    } catch {
      setLoadFailed(true);
    }
  }

  function handleSeek(barIndex: number) {
    const audio = audioRef.current;
    const total = duration || durationHintSec || 0;
    if (!audio || !total) return;
    const target = ((barIndex + 0.5) / VOICE_BAR_HEIGHTS.length) * total;
    audio.currentTime = Math.max(0, Math.min(total, target));
    setCurrentTime(audio.currentTime);
  }

  const effectiveDuration = duration > 0 ? duration : durationHintSec || 0;
  const progressRatio =
    effectiveDuration > 0 ? Math.min(1, currentTime / effectiveDuration) : 0;

  return (
    <div className="flex items-center gap-2.5 min-w-[215px] max-w-[270px]">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => setIsPlaying(true)}
        onPause={() => {
          setIsPlaying(false);
          if (currentlyPlayingAudio === audioRef.current) {
            currentlyPlayingAudio = null;
          }
        }}
        onEnded={() => {
          setIsPlaying(false);
          setCurrentTime(0);
          if (currentlyPlayingAudio === audioRef.current) {
            currentlyPlayingAudio = null;
          }
        }}
        onTimeUpdate={(e) => {
          setCurrentTime(e.currentTarget.currentTime);
        }}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setDuration(d);
        }}
        onError={() => setLoadFailed(true)}
      />

      {/* Play / Pause Button */}
      <button
        type="button"
        disabled={loadFailed}
        onClick={() => void togglePlay()}
        aria-label={isPlaying ? 'Pause voice message' : 'Play voice message'}
        className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-transform active:scale-95 cursor-pointer ${
          mine
            ? 'bg-white text-[#1877F2]'
            : 'bg-[#1877F2] text-white'
        }`}
      >
        {isPlaying ? (
          <Pause className="w-4 h-4 fill-current" />
        ) : (
          <Play className="w-4 h-4 fill-current ml-0.5" />
        )}
      </button>

      {/* Interactive Waveform */}
      <div className="flex-1 flex items-center gap-[2.5px] h-7 cursor-pointer">
        {VOICE_BAR_HEIGHTS.map((h, idx) => {
          const barFraction = (idx + 1) / VOICE_BAR_HEIGHTS.length;
          const active = barFraction <= progressRatio;
          return (
            <button
              key={idx}
              type="button"
              onClick={() => handleSeek(idx)}
              aria-label={`Seek voice note to ${Math.round(barFraction * 100)}%`}
              className="flex-1 h-full flex items-center justify-center cursor-pointer"
            >
              <span
                className={`w-[3px] rounded-full transition-colors ${
                  mine
                    ? active
                      ? 'bg-white'
                      : 'bg-white/40'
                    : active
                      ? 'bg-[#1877F2] dark:bg-[#60A5FA]'
                      : 'bg-[#CBD5E1] dark:bg-[#475569]'
                }`}
                style={{height: `${h}%`}}
              />
            </button>
          );
        })}
      </div>

      {/* Duration */}
      <span
        className={`text-[11px] font-semibold tabular-nums shrink-0 ${
          mine ? 'text-white/95' : 'text-[#475569] dark:text-[#CBD5E1]'
        }`}
      >
        {isPlaying || currentTime > 0 ? formatSec(currentTime) : formatSec(effectiveDuration)}
      </span>
    </div>
  );
}

export function ChatMessageBubble({
  message,
  showSenderIdentity = false,
  onCallBack,
}: ChatMessageBubbleProps) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);
  const resolvedMedia = useResolvedMediaUrl(message.mediaUrl || null);

  useEffect(() => {
    setImgFailed(false);
  }, [resolvedMedia]);

  async function handleDownloadPhoto() {
    if (!resolvedMedia) return;
    try {
      const response = await fetch(resolvedMedia);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = message.mediaName || `verve_photo_${Date.now()}.jpg`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1500);
    } catch {
      const a = document.createElement('a');
      a.href = resolvedMedia;
      a.download = message.mediaName || `verve_photo_${Date.now()}.jpg`;
      a.target = '_blank';
      a.rel = 'noreferrer';
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
  }

  if (message.messageType === 'system') {
    return (
      <div className="flex justify-center py-1">
        <span className="px-3 py-1 rounded-full bg-[#E5E8EE]/70 dark:bg-[#232732] text-[11px] font-medium text-[#475569] dark:text-[#94A3B8] text-center max-w-[85%]">
          {message.content}
        </span>
      </div>
    );
  }

  if (message.messageType === 'call') {
    const isMissedOrDeclined =
      message.callStatus === 'missed' || message.callStatus === 'declined';
    const isVideoCall = message.callType === 'video';
    return (
      <div className={`flex flex-col ${message.mine ? 'items-end' : 'items-start'}`}>
        <div className="max-w-[88%] rounded-2xl bg-white dark:bg-[#1E222B] border border-[#E5E8EE] dark:border-[#252A34] px-3.5 py-2.5 shadow-xs flex items-center gap-3">
          <span
            className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
              isMissedOrDeclined
                ? 'bg-red-500/15 text-red-500'
                : 'bg-[#1877F2]/12 text-[#1877F2] dark:text-[#60A5FA]'
            }`}
          >
            {isMissedOrDeclined ? (
              <PhoneMissed className="w-4 h-4" />
            ) : isVideoCall ? (
              <Video className="w-4 h-4" />
            ) : (
              <Phone className="w-4 h-4" />
            )}
          </span>
          <div className="min-w-0">
            <p className="text-xs sm:text-sm font-semibold text-[#0F172A] dark:text-white">
              {message.content}
            </p>
            <p className="text-[11px] text-[#64748B] dark:text-[#94A3B8] tabular-nums">
              {formatRelativeTime(message.createdAt)}
            </p>
          </div>
          {onCallBack && (
            <button
              type="button"
              onClick={() => onCallBack(isVideoCall ? 'video' : 'audio')}
              className="ml-1 px-2.5 py-1 rounded-lg bg-[#F1F5F9] dark:bg-[#2A303E] hover:bg-[#E2E8F0] dark:hover:bg-[#353D4E] text-[11px] font-semibold text-[#0F172A] dark:text-white whitespace-nowrap cursor-pointer"
            >
              Call back
            </button>
          )}
        </div>
      </div>
    );
  }

  const bubbleClasses = message.mine
    ? 'bg-[#1877F2] dark:bg-[#2563EB] text-white rounded-br-sm'
    : 'bg-white dark:bg-[#1E222B] border border-[#E5E8EE] dark:border-[#252A34] text-[#0F172A] dark:text-[#F1F5F9] rounded-bl-sm';

  const mapsUrl =
    message.messageType === 'location'
      ? `https://www.google.com/maps?q=${message.locationLat ?? 0},${message.locationLng ?? 0}`
      : '';

  return (
    <>
      <div
        className={`flex items-end gap-2 ${message.mine ? 'justify-end' : 'justify-start'}`}
      >
        {showSenderIdentity && !message.mine && (
          <div className="shrink-0 mb-4">
            <Avatar
              src={message.senderAvatar || ''}
              name={message.senderName || 'Member'}
              size="xs"
            />
          </div>
        )}

        <div className={`flex flex-col max-w-[82%] ${message.mine ? 'items-end' : 'items-start'}`}>
          {showSenderIdentity && !message.mine && message.senderName && (
            <span className="text-[11px] font-semibold text-[#64748B] dark:text-[#94A3B8] px-1 mb-0.5">
              {message.senderName}
            </span>
          )}

          {/* IMAGE */}
          {message.messageType === 'image' && (
            <div className="rounded-2xl overflow-hidden border border-[#E5E8EE] dark:border-[#252A34] bg-[#0F1115] max-w-[260px]">
              {resolvedMedia && !imgFailed ? (
                <button
                  type="button"
                  onClick={() => setLightboxOpen(true)}
                  className="block cursor-pointer w-full"
                >
                  <img
                    src={resolvedMedia}
                    alt={message.mediaName || 'Shared photo'}
                    referrerPolicy="no-referrer"
                    onError={() => setImgFailed(true)}
                    className="w-full max-h-64 object-cover block"
                  />
                </button>
              ) : (
                <div className="w-52 h-36 bg-[#1E222B] flex flex-col items-center justify-center gap-1.5 text-[#94A3B8] text-xs px-3 text-center">
                  <ImageIcon className="w-5 h-5" />
                  <span>{imgFailed ? 'Photo unavailable' : 'Loading photo...'}</span>
                </div>
              )}
              {message.content && (
                <p className={`px-3 py-2 text-xs ${bubbleClasses}`}>{message.content}</p>
              )}
            </div>
          )}

          {/* VIDEO */}
          {message.messageType === 'video' && (
            <div className="rounded-2xl overflow-hidden border border-[#E5E8EE] dark:border-[#252A34] bg-black max-w-[280px]">
              {resolvedMedia ? (
                <video
                  src={resolvedMedia}
                  controls
                  playsInline
                  preload="metadata"
                  className="w-full max-h-64 block"
                />
              ) : (
                <div className="w-60 h-40 animate-pulse bg-[#1E222B]" />
              )}
              {message.content && (
                <p className={`px-3 py-2 text-xs ${bubbleClasses}`}>{message.content}</p>
              )}
            </div>
          )}

          {/* VOICE MESSAGE (Facebook Messenger Play + Waveform + Duration Bubble) */}
          {message.messageType === 'voice' && (
            <div className={`px-3 py-2.5 rounded-2xl ${bubbleClasses}`}>
              {resolvedMedia ? (
                <VoiceMessagePlayer
                  src={resolvedMedia}
                  durationHintSec={message.voiceDurationSec}
                  mine={message.mine}
                />
              ) : (
                <span className="text-xs opacity-80">Voice message</span>
              )}
            </div>
          )}

          {/* DOCUMENT */}
          {message.messageType === 'document' && (
            <div className={`px-3.5 py-2.5 rounded-2xl ${bubbleClasses} min-w-[210px]`}>
              <div className="flex items-center gap-2.5">
                <span
                  className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                    message.mine
                      ? 'bg-white/20 text-white'
                      : 'bg-[#1877F2]/12 text-[#1877F2] dark:text-[#60A5FA]'
                  }`}
                >
                  <FileText className="w-4 h-4" />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold truncate">
                    {message.mediaName || 'Document'}
                  </p>
                  {message.mediaSize ? (
                    <p className="text-[10px] opacity-80 tabular-nums">
                      {formatFileSize(message.mediaSize)}
                    </p>
                  ) : null}
                </div>
                {resolvedMedia && (
                  <a
                    href={resolvedMedia}
                    download={message.mediaName || 'document'}
                    target="_blank"
                    rel="noreferrer"
                    aria-label="Download document"
                    className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                      message.mine
                        ? 'bg-white/20 hover:bg-white/30 text-white'
                        : 'bg-[#F4F6F9] dark:bg-[#252A34] hover:bg-[#E5E8EE] text-[#0F172A] dark:text-white'
                    }`}
                  >
                    <Download className="w-4 h-4" />
                  </a>
                )}
              </div>
            </div>
          )}

          {/* LOCATION */}
          {message.messageType === 'location' && (
            <a
              href={mapsUrl}
              target="_blank"
              rel="noreferrer"
              className={`block px-3.5 py-2.5 rounded-2xl ${bubbleClasses} min-w-[210px] hover:opacity-95 transition-opacity`}
            >
              <div className="flex items-center gap-2.5">
                <span
                  className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                    message.mine
                      ? 'bg-white/20 text-white'
                      : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                  }`}
                >
                  <MapPin className="w-4 h-4" />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold">Shared Location</p>
                  <p className="text-[11px] opacity-85 truncate tabular-nums">
                    {message.locationLabel ||
                      `${(message.locationLat ?? 0).toFixed(4)}, ${(message.locationLng ?? 0).toFixed(4)}`}
                  </p>
                </div>
                <ExternalLink className="w-3.5 h-3.5 shrink-0 opacity-80" />
              </div>
            </a>
          )}

          {/* TEXT */}
          {message.messageType === 'text' && (
            <div
              className={`px-3.5 py-2 rounded-2xl text-sm leading-relaxed break-words whitespace-pre-wrap ${bubbleClasses}`}
            >
              {message.content}
            </div>
          )}

          {/* Timestamp + Seen Tick */}
          <div className="flex items-center gap-1 mt-1 px-1 text-[10px] text-[#64748B] dark:text-[#94A3B8] tabular-nums">
            <span>{formatRelativeTime(message.createdAt)}</span>
            {message.mine && message.showSeenTick && (
              <span
                title={message.read ? 'Seen' : 'Sent'}
                className={
                  message.read
                    ? 'text-[#1877F2] dark:text-[#60A5FA] inline-flex items-center gap-0.5 font-semibold'
                    : 'text-[#94A3B8] inline-flex items-center'
                }
              >
                {message.read ? (
                  <>
                    <CheckCheck className="w-3.5 h-3.5" />
                    <span>Seen</span>
                  </>
                ) : (
                  <Check className="w-3.5 h-3.5" />
                )}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Fullscreen Image Lightbox with Download & Close */}
      {lightboxOpen && resolvedMedia && (
        <div
          onClick={() => setLightboxOpen(false)}
          className="fixed inset-0 z-[130] bg-black/92 flex items-center justify-center p-4"
        >
          <div
            className="absolute top-4 right-4 flex items-center gap-2"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => void handleDownloadPhoto()}
              aria-label="Download photo"
              className="h-10 px-3.5 rounded-full bg-white/15 hover:bg-white/25 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>Download</span>
            </button>
            <button
              type="button"
              onClick={() => setLightboxOpen(false)}
              aria-label="Close image preview"
              className="w-10 h-10 rounded-full bg-white/15 hover:bg-white/25 text-white flex items-center justify-center cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <img
            src={resolvedMedia}
            alt={message.mediaName || 'Photo'}
            className="max-w-full max-h-[85vh] rounded-xl object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}
