import {useEffect, useRef, useState} from 'react';
import type {ChangeEvent, FormEvent} from 'react';
import {
  AlertCircle,
  Camera,
  FileText,
  Image as ImageIcon,
  Loader2,
  MapPin,
  Mic,
  Paperclip,
  RefreshCw,
  Send,
  Smile,
  Square,
  Trash2,
  Video,
  X,
} from 'lucide-react';
import {uploadAttachmentReal} from '../lib/mediaUpload';
import type {ChatMessageType} from '../types';

export interface OutgoingChatPayload {
  content: string;
  messageType: ChatMessageType;
  mediaUrl?: string;
  mediaName?: string;
  mediaSize?: number;
  voiceDurationSec?: number;
  locationLat?: number;
  locationLng?: number;
  locationLabel?: string;
}

interface ChatInputBarProps {
  uploadFolder: string;
  placeholder?: string;
  onSend: (payload: OutgoingChatPayload) => Promise<void>;
  onTypingChange?: (isTyping: boolean) => void;
  compact?: boolean;
}

const EMOJI_CATEGORIES: Array<{label: string; items: string[]}> = [
  {
    label: 'Smileys',
    items: [
      '😀', '😂', '🤣', '😊', '😍', '🥰', '😘', '😎',
      '🤩', '🥳', '😇', '🤔', '😅', '😢', '😭', '😡',
      '🤯', '😴', '🤗', '🤭', '😜', '🥺', '🙏', '🔥',
    ],
  },
  {
    label: 'Gestures & Hearts',
    items: [
      '👍', '👎', '👏', '🙌', '🤝', '✌️', '🤞', '👌',
      '💪', '🎉', '✨', '💯', '❤️', '🧡', '💛', '💚',
      '💙', '💜', '🖤', '🤍', '💔', '💖', '🌹', '⭐',
    ],
  },
  {
    label: 'Everyday',
    items: [
      '☕', '🍕', '🍔', '🎂', '🎵', '📷', '🎬', '⚽',
      '🏏', '🎮', '✈️', '🏠', '📱', '💻', '📚', '💡',
    ],
  },
];

function formatTimer(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function ChatInputBar({
  uploadFolder,
  placeholder = 'Message...',
  onSend,
  onTypingChange,
  compact = false,
}: ChatInputBarProps) {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [uploadingLabel, setUploadingLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Popovers
  const [showEmoji, setShowEmoji] = useState(false);
  const [emojiTab, setEmojiTab] = useState(0);
  const [showAttach, setShowAttach] = useState(false);

  // Camera capture modal state
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraFacing, setCameraFacing] = useState<'user' | 'environment'>('environment');
  const [cameraPreviewBlob, setCameraPreviewBlob] = useState<Blob | null>(null);
  const [cameraPreviewUrl, setCameraPreviewUrl] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);

  // Voice recorder state
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<number | null>(null);
  const recordSecondsRef = useRef(0);
  const cancelRecordingRef = useRef(false);

  // File inputs & typing timer
  const photoInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);
  const typingTimerRef = useRef<number | null>(null);
  const textInputRef = useRef<HTMLInputElement>(null);

  const hasText = draft.trim().length > 0;

  useEffect(() => {
    return () => {
      if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current);
      if (recordTimerRef.current) window.clearInterval(recordTimerRef.current);
      stopCameraStream();
      if (cameraPreviewUrl) URL.revokeObjectURL(cameraPreviewUrl);
    };
  }, [cameraPreviewUrl]);

  function stopCameraStream() {
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((t) => t.stop());
      cameraStreamRef.current = null;
    }
  }

  async function startCamera(facing: 'user' | 'environment') {
    setCameraError(null);
    stopCameraStream();
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Camera is not supported in this browser.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {facingMode: {ideal: facing}, width: {ideal: 1280}, height: {ideal: 720}},
        audio: false,
      });
      cameraStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
    } catch {
      try {
        const fallback = await navigator.mediaDevices.getUserMedia({video: true, audio: false});
        cameraStreamRef.current = fallback;
        if (videoRef.current) {
          videoRef.current.srcObject = fallback;
          await videoRef.current.play().catch(() => {});
        }
      } catch (err) {
        setCameraError(
          err instanceof Error
            ? `Camera permission denied: ${err.message}`
            : 'Camera access was denied. Please allow camera permission.',
        );
      }
    }
  }

  useEffect(() => {
    if (cameraOpen && !cameraPreviewUrl) {
      void startCamera(cameraFacing);
    } else if (!cameraOpen) {
      stopCameraStream();
    }
  }, [cameraOpen, cameraFacing, cameraPreviewUrl]);

  function closeCameraModal() {
    stopCameraStream();
    if (cameraPreviewUrl) URL.revokeObjectURL(cameraPreviewUrl);
    setCameraPreviewUrl(null);
    setCameraPreviewBlob(null);
    setCameraError(null);
    setCameraOpen(false);
  }

  function handleCapturePhoto() {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        stopCameraStream();
        const url = URL.createObjectURL(blob);
        setCameraPreviewBlob(blob);
        setCameraPreviewUrl(url);
      },
      'image/jpeg',
      0.86,
    );
  }

  async function handleSendCapturedPhoto() {
    if (!cameraPreviewBlob || sending) return;
    setSending(true);
    setUploadingLabel('Uploading photo...');
    setError(null);
    try {
      const file = new File([cameraPreviewBlob], `camera_${Date.now()}.jpg`, {
        type: 'image/jpeg',
      });
      const uploaded = await uploadAttachmentReal(file, {
        folder: uploadFolder,
        kind: 'image',
        fileName: file.name,
      });
      await onSend({
        content: '',
        messageType: 'image',
        mediaUrl: uploaded.url,
        mediaName: uploaded.name,
        mediaSize: uploaded.size,
      });
      closeCameraModal();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send captured photo.');
    } finally {
      setSending(false);
      setUploadingLabel(null);
    }
  }

  function handleDraftChange(val: string) {
    setDraft(val);
    setError(null);
    if (onTypingChange) {
      onTypingChange(val.trim().length > 0);
      if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current);
      typingTimerRef.current = window.setTimeout(() => {
        onTypingChange(false);
      }, 2000);
    }
  }

  function insertEmoji(emoji: string) {
    handleDraftChange(`${draft}${emoji}`);
    textInputRef.current?.focus();
  }

  async function handleTextSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setError(null);
    setShowEmoji(false);
    setShowAttach(false);
    try {
      await onSend({content: trimmed, messageType: 'text'});
      setDraft('');
      onTypingChange?.(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send message.');
    } finally {
      setSending(false);
    }
  }

  async function handleFileSelected(
    e: ChangeEvent<HTMLInputElement>,
    kind: 'image' | 'video' | 'document',
  ) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setShowAttach(false);
    setShowEmoji(false);
    setError(null);
    setSending(true);
    setUploadingLabel(
      kind === 'image'
        ? 'Uploading photo...'
        : kind === 'video'
          ? 'Uploading video...'
          : 'Uploading document...',
    );
    try {
      const uploaded = await uploadAttachmentReal(file, {
        folder: uploadFolder,
        kind,
        fileName: file.name,
      });
      await onSend({
        content: '',
        messageType: kind,
        mediaUrl: uploaded.url,
        mediaName: uploaded.name,
        mediaSize: uploaded.size,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to send ${kind}.`);
    } finally {
      setSending(false);
      setUploadingLabel(null);
    }
  }

  async function handleShareLocation() {
    setShowAttach(false);
    setError(null);
    if (!navigator.geolocation) {
      setError('Location sharing is not supported by this browser.');
      return;
    }
    setSending(true);
    setUploadingLabel('Getting current location...');
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 12000,
          maximumAge: 15000,
        });
      });
      const lat = Number(pos.coords.latitude.toFixed(6));
      const lng = Number(pos.coords.longitude.toFixed(6));
      await onSend({
        content: `Shared location (${lat}, ${lng})`,
        messageType: 'location',
        locationLat: lat,
        locationLng: lng,
        locationLabel: `${lat}, ${lng}`,
      });
    } catch (err) {
      setError(
        err instanceof GeolocationPositionError
          ? 'Location permission was denied or unavailable. Please enable GPS/location.'
          : 'Could not determine your location.',
      );
    } finally {
      setSending(false);
      setUploadingLabel(null);
    }
  }

  async function startVoiceRecording() {
    setError(null);
    setShowAttach(false);
    setShowEmoji(false);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Voice recording is not supported on this device/browser.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({audio: true});
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : MediaRecorder.isTypeSupported('audio/mp4')
            ? 'audio/mp4'
            : '';
      const recorder = mimeType
        ? new MediaRecorder(stream, {mimeType, audioBitsPerSecond: 32000})
        : new MediaRecorder(stream);

      audioChunksRef.current = [];
      cancelRecordingRef.current = false;
      recordSecondsRef.current = 0;
      setRecordSeconds(0);

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          audioChunksRef.current.push(ev.data);
        }
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (recordTimerRef.current) {
          window.clearInterval(recordTimerRef.current);
          recordTimerRef.current = null;
        }
        setIsRecording(false);
        if (cancelRecordingRef.current || audioChunksRef.current.length === 0) {
          return;
        }
        const durationSec = Math.max(1, recordSecondsRef.current);
        const type = recorder.mimeType || 'audio/webm';
        const ext = type.includes('mp4') ? 'm4a' : 'webm';
        const blob = new Blob(audioChunksRef.current, {type});

        setSending(true);
        setUploadingLabel('Sending voice message...');
        try {
          const uploaded = await uploadAttachmentReal(blob, {
            folder: uploadFolder,
            kind: 'voice',
            fileName: `voice_${Date.now()}.${ext}`,
          });
          await onSend({
            content: '',
            messageType: 'voice',
            mediaUrl: uploaded.url,
            mediaName: uploaded.name,
            mediaSize: uploaded.size,
            voiceDurationSec: durationSec,
          });
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to send voice message.');
        } finally {
          setSending(false);
          setUploadingLabel(null);
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start(250);
      setIsRecording(true);
      recordTimerRef.current = window.setInterval(() => {
        recordSecondsRef.current += 1;
        setRecordSeconds(recordSecondsRef.current);
        if (recordSecondsRef.current >= 120) {
          recorder.stop();
        }
      }, 1000);
    } catch {
      setError('Microphone permission denied. Please allow microphone access to record voice.');
    }
  }

  function stopVoiceRecording(cancel: boolean) {
    cancelRecordingRef.current = cancel;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    } else {
      setIsRecording(false);
    }
  }

  return (
    <div className="relative border-t border-[#E5E8EE] dark:border-[#252A34] bg-white dark:bg-[#16191F] shrink-0">
      {/* Hidden file pickers */}
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        onChange={(e) => handleFileSelected(e, 'image')}
        className="hidden"
      />
      <input
        ref={videoInputRef}
        type="file"
        accept="video/*"
        onChange={(e) => handleFileSelected(e, 'video')}
        className="hidden"
      />
      <input
        ref={docInputRef}
        type="file"
        accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip,.csv,application/pdf"
        onChange={(e) => handleFileSelected(e, 'document')}
        className="hidden"
      />

      {/* Uploading banner */}
      {uploadingLabel && (
        <div className="px-3.5 py-2 bg-[#1877F2]/8 dark:bg-[#3B82F6]/15 border-b border-[#E5E8EE] dark:border-[#252A34] flex items-center gap-2 text-xs font-medium text-[#1877F2] dark:text-[#60A5FA]">
          <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
          <span>{uploadingLabel}</span>
        </div>
      )}

      {/* Error alert */}
      {error && (
        <div
          role="alert"
          className="px-3.5 py-2 bg-[#FEF2F2] dark:bg-[#3B181A] border-b border-[#FECACA] dark:border-[#7F1D1D] flex items-center justify-between gap-2 text-xs font-medium text-[#B91C1C] dark:text-[#FCA5A5]"
        >
          <span className="flex items-center gap-1.5 min-w-0">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{error}</span>
          </span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="p-0.5 hover:bg-black/10 rounded cursor-pointer shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Emoji Picker Popover */}
      {showEmoji && (
        <div className="absolute bottom-full left-2 right-2 sm:right-auto sm:w-72 mb-2 bg-white dark:bg-[#1C2029] border border-[#E5E8EE] dark:border-[#2D3342] rounded-2xl shadow-xl z-30 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-[#E5E8EE] dark:border-[#252A34]">
            <div className="flex items-center gap-1">
              {EMOJI_CATEGORIES.map((cat, idx) => (
                <button
                  key={cat.label}
                  type="button"
                  onClick={() => setEmojiTab(idx)}
                  className={`px-2 py-1 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer ${
                    emojiTab === idx
                      ? 'bg-[#1877F2]/12 text-[#1877F2] dark:text-[#60A5FA]'
                      : 'text-[#64748B] dark:text-[#94A3B8] hover:bg-[#F4F6F9] dark:hover:bg-[#232732]'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setShowEmoji(false)}
              className="p-1 rounded-lg text-[#64748B] hover:bg-[#F4F6F9] dark:hover:bg-[#232732] cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="p-2.5 grid grid-cols-8 gap-1 max-h-48 overflow-y-auto">
            {EMOJI_CATEGORIES[emojiTab].items.map((em) => (
              <button
                key={em}
                type="button"
                onClick={() => insertEmoji(em)}
                className="w-8 h-8 rounded-lg hover:bg-[#F4F6F9] dark:hover:bg-[#252A34] flex items-center justify-center text-lg transition-transform active:scale-90 cursor-pointer"
              >
                {em}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Attach Popover: Document, Photo, Video, Location */}
      {showAttach && (
        <div className="absolute bottom-full right-3 mb-2 w-56 bg-white dark:bg-[#1C2029] border border-[#E5E8EE] dark:border-[#2D3342] rounded-2xl shadow-xl p-2 z-30 grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() => docInputRef.current?.click()}
            className="flex flex-col items-center gap-1.5 p-3 rounded-xl hover:bg-[#F4F6F9] dark:hover:bg-[#252A34] transition-colors cursor-pointer"
          >
            <span className="w-10 h-10 rounded-full bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
              <FileText className="w-5 h-5" />
            </span>
            <span className="text-xs font-semibold text-[#0F172A] dark:text-white">Document</span>
          </button>

          <button
            type="button"
            onClick={() => photoInputRef.current?.click()}
            className="flex flex-col items-center gap-1.5 p-3 rounded-xl hover:bg-[#F4F6F9] dark:hover:bg-[#252A34] transition-colors cursor-pointer"
          >
            <span className="w-10 h-10 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <ImageIcon className="w-5 h-5" />
            </span>
            <span className="text-xs font-semibold text-[#0F172A] dark:text-white">Photo</span>
          </button>

          <button
            type="button"
            onClick={() => videoInputRef.current?.click()}
            className="flex flex-col items-center gap-1.5 p-3 rounded-xl hover:bg-[#F4F6F9] dark:hover:bg-[#252A34] transition-colors cursor-pointer"
          >
            <span className="w-10 h-10 rounded-full bg-rose-500/15 text-rose-600 dark:text-rose-400 flex items-center justify-center">
              <Video className="w-5 h-5" />
            </span>
            <span className="text-xs font-semibold text-[#0F172A] dark:text-white">Video</span>
          </button>

          <button
            type="button"
            onClick={handleShareLocation}
            className="flex flex-col items-center gap-1.5 p-3 rounded-xl hover:bg-[#F4F6F9] dark:hover:bg-[#252A34] transition-colors cursor-pointer"
          >
            <span className="w-10 h-10 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center">
              <MapPin className="w-5 h-5" />
            </span>
            <span className="text-xs font-semibold text-[#0F172A] dark:text-white">Location</span>
          </button>
        </div>
      )}

      {/* Voice Recording Active Bar OR Standard [Emoji] [Message] [Attach] [Camera] [Mic/Send] */}
      {isRecording ? (
        <div className="p-2.5 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => stopVoiceRecording(true)}
            aria-label="Cancel voice recording"
            className="w-10 h-10 rounded-full bg-[#FEF2F2] dark:bg-[#3B181A] text-[#DC2626] dark:text-[#FCA5A5] flex items-center justify-center cursor-pointer"
          >
            <Trash2 className="w-4 h-4" />
          </button>

          <div className="flex-1 flex items-center justify-center gap-2.5 px-3 py-2 rounded-full bg-[#FEF2F2] dark:bg-[#2B1517]">
            <span className="w-2.5 h-2.5 rounded-full bg-[#DC2626] animate-pulse" />
            <span className="text-xs font-semibold text-[#B91C1C] dark:text-[#FCA5A5] tabular-nums">
              Recording voice · {formatTimer(recordSeconds)}
            </span>
          </div>

          <button
            type="button"
            onClick={() => stopVoiceRecording(false)}
            aria-label="Stop and send voice message"
            className="h-10 px-4 rounded-full bg-[#1877F2] hover:bg-[#166FE5] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Square className="w-3 h-3 fill-current" />
            <span>Send</span>
          </button>
        </div>
      ) : (
        <form
          onSubmit={handleTextSubmit}
          className={`${compact ? 'p-2 gap-1' : 'p-2.5 sm:p-3 gap-1.5'} flex items-center`}
        >
          {/* [Emoji] */}
          <button
            type="button"
            disabled={sending}
            onClick={() => {
              setShowEmoji((prev) => !prev);
              setShowAttach(false);
            }}
            aria-label="Choose emoji"
            className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors shrink-0 cursor-pointer ${
              showEmoji
                ? 'bg-[#1877F2]/15 text-[#1877F2] dark:text-[#60A5FA]'
                : 'text-[#64748B] dark:text-[#94A3B8] hover:bg-[#F4F6F9] dark:hover:bg-[#232732]'
            }`}
          >
            <Smile className="w-5 h-5" />
          </button>

          {/* [Message] */}
          <input
            ref={textInputRef}
            type="text"
            value={draft}
            disabled={sending}
            onChange={(e) => handleDraftChange(e.target.value)}
            onFocus={() => {
              setShowAttach(false);
            }}
            placeholder={placeholder}
            className="flex-1 min-w-0 h-10 px-3.5 rounded-full bg-[#F4F6F9] dark:bg-[#0E1014] border border-transparent focus:border-[#1877F2]/40 text-sm text-[#0F172A] dark:text-white placeholder:text-[#64748B] dark:placeholder:text-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#1877F2]/25"
          />

          {/* [Attach] */}
          <button
            type="button"
            disabled={sending}
            onClick={() => {
              setShowAttach((prev) => !prev);
              setShowEmoji(false);
            }}
            aria-label="Attach document, photo, video, or location"
            className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors shrink-0 cursor-pointer ${
              showAttach
                ? 'bg-[#1877F2]/15 text-[#1877F2] dark:text-[#60A5FA]'
                : 'text-[#64748B] dark:text-[#94A3B8] hover:bg-[#F4F6F9] dark:hover:bg-[#232732]'
            }`}
          >
            <Paperclip className="w-[18px] h-[18px]" />
          </button>

          {/* [Camera] */}
          <button
            type="button"
            disabled={sending}
            onClick={() => {
              setShowEmoji(false);
              setShowAttach(false);
              setCameraOpen(true);
            }}
            aria-label="Open camera to take photo"
            className="w-9 h-9 rounded-full text-[#64748B] dark:text-[#94A3B8] hover:bg-[#F4F6F9] dark:hover:bg-[#232732] flex items-center justify-center transition-colors shrink-0 cursor-pointer"
          >
            <Camera className="w-[18px] h-[18px]" />
          </button>

          {/* [Mic] -> becomes [Send] when text is typed */}
          {hasText ? (
            <button
              type="submit"
              disabled={sending}
              aria-label="Send message"
              className="w-10 h-10 rounded-full bg-[#1877F2] hover:bg-[#166FE5] dark:bg-[#2563EB] text-white flex items-center justify-center disabled:opacity-45 active:scale-95 transition-all shrink-0 cursor-pointer"
            >
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          ) : (
            <button
              type="button"
              disabled={sending}
              onClick={startVoiceRecording}
              aria-label="Record voice message"
              className="w-10 h-10 rounded-full bg-[#1877F2]/12 hover:bg-[#1877F2]/20 text-[#1877F2] dark:text-[#60A5FA] flex items-center justify-center disabled:opacity-45 active:scale-95 transition-all shrink-0 cursor-pointer"
            >
              <Mic className="w-[18px] h-[18px]" />
            </button>
          )}
        </form>
      )}

      {/* Live Camera Capture Modal */}
      {cameraOpen && (
        <div className="fixed inset-0 z-[120] bg-black/85 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#11141B] border border-white/10 rounded-2xl overflow-hidden shadow-2xl">
            <div className="px-4 py-3 flex items-center justify-between border-b border-white/10 text-white">
              <span className="font-display font-semibold text-sm">Camera</span>
              <button
                type="button"
                onClick={closeCameraModal}
                aria-label="Close camera"
                className="w-8 h-8 rounded-full hover:bg-white/10 flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="relative aspect-[3/4] max-h-[65vh] w-full bg-black flex items-center justify-center overflow-hidden">
              {cameraError ? (
                <div className="p-6 text-center space-y-3">
                  <AlertCircle className="w-8 h-8 text-red-400 mx-auto" />
                  <p className="text-sm text-white/90">{cameraError}</p>
                  <button
                    type="button"
                    onClick={() => photoInputRef.current?.click()}
                    className="px-4 py-2 rounded-xl bg-[#1877F2] text-white text-xs font-semibold cursor-pointer"
                  >
                    Pick Photo From Gallery
                  </button>
                </div>
              ) : cameraPreviewUrl ? (
                <img
                  src={cameraPreviewUrl}
                  alt="Captured photo preview"
                  className="w-full h-full object-contain"
                />
              ) : (
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                />
              )}
            </div>

            <div className="p-4 flex items-center justify-between gap-3 bg-[#161A23]">
              {cameraPreviewUrl ? (
                <>
                  <button
                    type="button"
                    disabled={sending}
                    onClick={() => {
                      if (cameraPreviewUrl) URL.revokeObjectURL(cameraPreviewUrl);
                      setCameraPreviewUrl(null);
                      setCameraPreviewBlob(null);
                    }}
                    className="px-4 h-10 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-semibold cursor-pointer"
                  >
                    Retake
                  </button>
                  <button
                    type="button"
                    disabled={sending}
                    onClick={handleSendCapturedPhoto}
                    className="flex-1 h-10 rounded-xl bg-[#1877F2] hover:bg-[#166FE5] text-white text-xs font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
                  >
                    {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    <span>{sending ? 'Sending...' : 'Send Photo'}</span>
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      setCameraFacing((prev) => (prev === 'user' ? 'environment' : 'user'))
                    }
                    className="w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center cursor-pointer"
                    title="Switch Camera"
                  >
                    <RefreshCw className="w-5 h-5" />
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(cameraError)}
                    onClick={handleCapturePhoto}
                    aria-label="Take photo"
                    className="w-16 h-16 rounded-full border-4 border-white flex items-center justify-center active:scale-95 transition-transform cursor-pointer"
                  >
                    <span className="w-12 h-12 rounded-full bg-white block" />
                  </button>
                  <div className="w-11 h-11" />
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
