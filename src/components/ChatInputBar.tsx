import {useEffect, useRef, useState} from 'react';
import type {ChangeEvent, FormEvent, PointerEvent as ReactPointerEvent} from 'react';
import {
  AlertCircle,
  Camera,
  FileText,
  Image as ImageIcon,
  Loader2,
  Lock,
  LockOpen,
  MapPin,
  Mic,
  Paperclip,
  RefreshCw,
  RotateCcw,
  Send,
  Smile,
  Trash2,
  Video,
  X,
} from 'lucide-react';
import {
  extractVideoMetadata,
  formatFileSize,
  formatMediaDuration,
  MAX_VIDEO_BYTES,
  MAX_VIDEO_DURATION_SEC,
  uploadAttachmentReal,
} from '../lib/mediaUpload';
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
  chatId?: string;
  placeholder?: string;
  onSend: (payload: OutgoingChatPayload) => Promise<void>;
  onTypingChange?: (isTyping: boolean) => void;
  compact?: boolean;
}

interface StagedMedia {
  kind: 'image' | 'video' | 'document';
  file: File;
  previewUrl: string | null;
  durationSec?: number;
}

interface RetryableUpload {
  kind: 'image' | 'video' | 'voice' | 'document';
  blob: File | Blob;
  fileName: string;
  caption: string;
  voiceDurationSec?: number;
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

const DEFAULT_WAVEFORM = [28, 46, 70, 52, 85, 62, 40, 78, 92, 56, 38, 66, 84, 48, 34, 60];

function formatTimer(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function ChatInputBar({
  uploadFolder,
  chatId,
  placeholder = 'Message...',
  onSend,
  onTypingChange,
  compact = false,
}: ChatInputBarProps) {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [uploadingLabel, setUploadingLabel] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [micPermissionDenied, setMicPermissionDenied] = useState(false);
  const [retryableUpload, setRetryableUpload] = useState<RetryableUpload | null>(null);

  // Staged preview right above the chat bar (for Camera photo, Gallery photo, Video, or Document)
  const [stagedMedia, setStagedMedia] = useState<StagedMedia | null>(null);

  // Popovers
  const [showEmoji, setShowEmoji] = useState(false);
  const [emojiTab, setEmojiTab] = useState(0);
  const [showAttach, setShowAttach] = useState(false);

  // Camera capture modal state
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraFacing, setCameraFacing] = useState<'user' | 'environment'>('environment');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);

  // Voice recorder state (Hold-to-record + Tap-to-record + Lock hands-free)
  const [isRecording, setIsRecording] = useState(false);
  const [isRecordLocked, setIsRecordLocked] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [waveformLevels, setWaveformLevels] = useState<number[]>(DEFAULT_WAVEFORM);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<number | null>(null);
  const recordSecondsRef = useRef(0);
  const cancelRecordingRef = useRef(false);
  const recordLockedRef = useRef(false);
  const recordStartMsRef = useRef(0);
  const holdReleasePendingRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const waveformRafRef = useRef<number | null>(null);

  // File inputs & typing timer
  const photoInputRef = useRef<HTMLInputElement>(null);
  const nativeCameraInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);
  const typingTimerRef = useRef<number | null>(null);
  const textInputRef = useRef<HTMLInputElement>(null);

  const resolvedChatKey =
    (chatId || uploadFolder.split('/').filter(Boolean).pop() || 'general').replace(
      /[^a-zA-Z0-9_-]/g,
      '',
    ) || 'general';

  const hasTextOrMedia = draft.trim().length > 0 || stagedMedia !== null;

  function getFolderForKind(kind: 'image' | 'video' | 'voice' | 'document'): string {
    if (kind === 'image') return `chat_images/${resolvedChatKey}`;
    if (kind === 'voice') return `chat_voices/${resolvedChatKey}`;
    return `chat_media/${resolvedChatKey}`;
  }

  useEffect(() => {
    return () => {
      if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current);
      if (recordTimerRef.current) window.clearInterval(recordTimerRef.current);
      stopWaveformAnalyzer();
      stopCameraStream();
    };
  }, []);

  useEffect(() => {
    const url = stagedMedia?.previewUrl;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [stagedMedia?.previewUrl]);

  function stopCameraStream() {
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((t) => t.stop());
      cameraStreamRef.current = null;
    }
    setCameraReady(false);
  }

  function stopWaveformAnalyzer() {
    if (waveformRafRef.current) {
      window.cancelAnimationFrame(waveformRafRef.current);
      waveformRafRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
  }

  function startWaveformAnalyzer(stream: MediaStream) {
    stopWaveformAnalyzer();
    try {
      const AudioCtx = window.AudioContext || (window as unknown as {webkitAudioContext: typeof AudioContext}).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      audioContextRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      let frame = 0;

      const tick = () => {
        frame += 1;
        if (frame % 3 === 0) {
          analyser.getByteFrequencyData(dataArray);
          const bars: number[] = [];
          for (let i = 0; i < 16; i += 1) {
            const val = dataArray[i] || 0;
            // Ensure subtle lively bar motion even in quiet rooms
            const pct = Math.max(18, Math.min(100, Math.round((val / 255) * 100) + 14));
            bars.push(pct);
          }
          setWaveformLevels(bars);
        }
        waveformRafRef.current = window.requestAnimationFrame(tick);
      };
      waveformRafRef.current = window.requestAnimationFrame(tick);
    } catch {
      // Fallback animation still renders cleanly
    }
  }

  async function startCamera(facing: 'user' | 'environment') {
    setCameraError(null);
    setCameraReady(false);
    stopCameraStream();
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Live camera viewfinder is unavailable here. Use device camera or gallery below.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {facingMode: {ideal: facing}, width: {ideal: 1280}, height: {ideal: 960}},
        audio: false,
      });
      cameraStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
        setCameraReady(true);
      }
    } catch {
      try {
        const fallback = await navigator.mediaDevices.getUserMedia({video: true, audio: false});
        cameraStreamRef.current = fallback;
        if (videoRef.current) {
          videoRef.current.srcObject = fallback;
          await videoRef.current.play().catch(() => {});
          setCameraReady(true);
        }
      } catch (err) {
        setCameraError(
          err instanceof Error
            ? `Camera permission blocked (${err.message}). Allow Camera or open Device Camera below.`
            : 'Camera access was denied. Allow Camera permission or use Device Camera below.',
        );
      }
    }
  }

  useEffect(() => {
    if (cameraOpen) {
      void startCamera(cameraFacing);
    } else {
      stopCameraStream();
    }
  }, [cameraOpen, cameraFacing]);

  function closeCameraModal() {
    stopCameraStream();
    setCameraError(null);
    setCameraOpen(false);
  }

  function handleCapturePhoto() {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return;
    const maxDim = 1080;
    const scale = Math.min(1, maxDim / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], `camera_${Date.now()}.jpg`, {type: 'image/jpeg'});
        const previewUrl = URL.createObjectURL(file);
        closeCameraModal();
        setError(null);
        setRetryableUpload(null);
        setStagedMedia({kind: 'image', file, previewUrl});
        textInputRef.current?.focus();
      },
      'image/jpeg',
      0.82,
    );
  }

  function clearStagedMedia() {
    setStagedMedia(null);
    setError(null);
    setRetryableUpload(null);
  }

  async function executeMediaUploadAndSend(job: RetryableUpload) {
    setSending(true);
    setError(null);
    setMicPermissionDenied(false);
    setRetryableUpload(null);
    setUploadProgress(2);
    setUploadingLabel(
      job.kind === 'image'
        ? 'Uploading photo...'
        : job.kind === 'video'
          ? 'Uploading video...'
          : job.kind === 'voice'
            ? 'Sending voice message...'
            : 'Uploading document...',
    );

    try {
      const uploaded = await uploadAttachmentReal(job.blob, {
        folder: getFolderForKind(job.kind),
        kind: job.kind,
        fileName: job.fileName,
        onProgress: (pct) => setUploadProgress(pct),
      });

      await onSend({
        content: job.caption,
        messageType: job.kind,
        mediaUrl: uploaded.url,
        mediaName: uploaded.name,
        mediaSize: uploaded.size,
        voiceDurationSec: job.voiceDurationSec,
      });

      setStagedMedia(null);
      setDraft('');
      onTypingChange?.(false);
    } catch (err) {
      setRetryableUpload(job);
      setError(err instanceof Error ? err.message : `Failed to send ${job.kind}.`);
    } finally {
      setSending(false);
      setUploadingLabel(null);
      setUploadProgress(0);
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

  async function handleFormSubmit(e: FormEvent) {
    e.preventDefault();
    if (sending) return;
    setShowEmoji(false);
    setShowAttach(false);

    // 1. If a photo/video/document is staged in preview tray -> upload and send it now
    if (stagedMedia) {
      await executeMediaUploadAndSend({
        kind: stagedMedia.kind,
        blob: stagedMedia.file,
        fileName: stagedMedia.file.name,
        caption: draft.trim(),
      });
      return;
    }

    // 2. Plain text message
    const trimmed = draft.trim();
    if (!trimmed) return;
    setSending(true);
    setError(null);
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
    setRetryableUpload(null);
    setMicPermissionDenied(false);

    if (kind === 'image') {
      const previewUrl = URL.createObjectURL(file);
      setStagedMedia({kind: 'image', file, previewUrl});
      textInputRef.current?.focus();
      return;
    }

    if (kind === 'video') {
      if (file.size > MAX_VIDEO_BYTES) {
        setError('Video too large (max 100MB / 60 sec).');
        return;
      }
      const meta = await extractVideoMetadata(file);
      if (meta.durationSec > MAX_VIDEO_DURATION_SEC) {
        setError('Video too large (max 100MB / 60 sec).');
        return;
      }
      const previewUrl = URL.createObjectURL(file);
      setStagedMedia({kind: 'video', file, previewUrl, durationSec: meta.durationSec});
      textInputRef.current?.focus();
      return;
    }

    // Document: stage preview so user confirms and taps Send
    setStagedMedia({kind: 'document', file, previewUrl: null});
  }

  async function handleShareLocation() {
    setShowAttach(false);
    setError(null);
    setRetryableUpload(null);
    if (!navigator.geolocation) {
      setError('Location sharing is not supported by this browser.');
      return;
    }
    setSending(true);
    setUploadingLabel('Getting current location...');
    setUploadProgress(40);
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
      setUploadProgress(0);
    }
  }

  // VOICE RECORDING: Hold-to-record OR Tap-to-record + Lock hands-free like Facebook Messenger
  async function startVoiceRecording(startLocked: boolean) {
    if (isRecording || sending) return;
    setError(null);
    setRetryableUpload(null);
    setMicPermissionDenied(false);
    setShowAttach(false);
    setShowEmoji(false);

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Voice recording is not supported on this browser.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      const mimeType = MediaRecorder.isTypeSupported('audio/mp4')
        ? 'audio/mp4'
        : MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : MediaRecorder.isTypeSupported('audio/webm')
            ? 'audio/webm'
            : '';

      const recorder = mimeType
        ? new MediaRecorder(stream, {mimeType, audioBitsPerSecond: 48000})
        : new MediaRecorder(stream);

      audioChunksRef.current = [];
      cancelRecordingRef.current = false;
      recordSecondsRef.current = 0;
      recordLockedRef.current = startLocked;
      recordStartMsRef.current = Date.now();
      setRecordSeconds(0);
      setIsRecordLocked(startLocked);
      setWaveformLevels(DEFAULT_WAVEFORM);

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          audioChunksRef.current.push(ev.data);
        }
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        stopWaveformAnalyzer();
        if (recordTimerRef.current) {
          window.clearInterval(recordTimerRef.current);
          recordTimerRef.current = null;
        }
        setIsRecording(false);
        setIsRecordLocked(false);
        recordLockedRef.current = false;

        if (cancelRecordingRef.current || audioChunksRef.current.length === 0) {
          return;
        }

        const elapsedMs = Date.now() - recordStartMsRef.current;
        const durationSec = Math.max(1, Math.round(elapsedMs / 1000) || recordSecondsRef.current);
        const type = recorder.mimeType || 'audio/webm';
        const ext = type.includes('mp4') ? 'm4a' : 'webm';
        const blob = new Blob(audioChunksRef.current, {type});

        await executeMediaUploadAndSend({
          kind: 'voice',
          blob,
          fileName: `${Date.now()}.${ext}`,
          caption: '',
          voiceDurationSec: durationSec,
        });
      };

      mediaRecorderRef.current = recorder;
      recorder.start(200);
      setIsRecording(true);
      startWaveformAnalyzer(stream);

      recordTimerRef.current = window.setInterval(() => {
        recordSecondsRef.current += 1;
        setRecordSeconds(recordSecondsRef.current);
        if (recordSecondsRef.current >= 120) {
          recorder.stop();
        }
      }, 1000);

      // If user already released pointer during permission prompt -> switch to locked hands-free mode
      if (holdReleasePendingRef.current) {
        holdReleasePendingRef.current = false;
        recordLockedRef.current = true;
        setIsRecordLocked(true);
      }
    } catch {
      setMicPermissionDenied(true);
      setError('Allow Mic Permission to record voice messages.');
    }
  }

  function stopVoiceRecording(cancel: boolean) {
    cancelRecordingRef.current = cancel;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    } else {
      setIsRecording(false);
      setIsRecordLocked(false);
      recordLockedRef.current = false;
    }
  }

  function handleMicPointerDown(e: ReactPointerEvent<HTMLButtonElement>) {
    e.preventDefault();
    if (sending || isRecording) return;
    holdReleasePendingRef.current = false;
    void startVoiceRecording(false);
  }

  function handleMicPointerUp() {
    if (!isRecording) {
      // User tapped quickly before getUserMedia resolved -> keep recording locked hands-free!
      holdReleasePendingRef.current = true;
      return;
    }
    if (recordLockedRef.current) return;
    const heldMs = Date.now() - recordStartMsRef.current;
    // Quick tap (< 450ms) locks hands-free recording; long hold (>= 450ms) sends immediately on release!
    if (heldMs < 450) {
      recordLockedRef.current = true;
      setIsRecordLocked(true);
    } else {
      stopVoiceRecording(false);
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
        ref={nativeCameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
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

      {/* Real-time Upload Progress Bar (never hangs!) */}
      {uploadingLabel && (
        <div className="px-3.5 py-2 bg-[#1877F2]/8 dark:bg-[#3B82F6]/15 border-b border-[#E5E8EE] dark:border-[#252A34] space-y-1.5">
          <div className="flex items-center justify-between gap-2 text-xs font-medium text-[#1877F2] dark:text-[#60A5FA]">
            <span className="inline-flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
              <span>{uploadingLabel}</span>
            </span>
            {uploadProgress > 0 && (
              <span className="tabular-nums font-semibold">{uploadProgress}%</span>
            )}
          </div>
          <div className="h-1.5 w-full rounded-full bg-[#1877F2]/20 overflow-hidden">
            <div
              className="h-full rounded-full bg-[#1877F2] dark:bg-[#60A5FA] transition-all duration-150"
              style={{width: `${Math.max(8, uploadProgress)}%`}}
            />
          </div>
        </div>
      )}

      {/* Error Alert with real Retry / Allow Mic Permission button */}
      {error && (
        <div
          role="alert"
          className="px-3.5 py-2 bg-[#FEF2F2] dark:bg-[#3B181A] border-b border-[#FECACA] dark:border-[#7F1D1D] flex items-center justify-between gap-2 text-xs font-medium text-[#B91C1C] dark:text-[#FCA5A5]"
        >
          <span className="flex items-center gap-1.5 min-w-0">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{error}</span>
          </span>
          <div className="flex items-center gap-1.5 shrink-0">
            {retryableUpload && !sending && (
              <button
                type="button"
                onClick={() => void executeMediaUploadAndSend(retryableUpload)}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#DC2626] hover:bg-[#B91C1C] text-white text-[11px] font-semibold cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Retry</span>
              </button>
            )}
            {micPermissionDenied && !sending && (
              <button
                type="button"
                onClick={() => void startVoiceRecording(true)}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#1877F2] hover:bg-[#166FE5] text-white text-[11px] font-semibold cursor-pointer"
              >
                <Mic className="w-3 h-3" />
                <span>Allow Mic</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setError(null);
                setRetryableUpload(null);
                setMicPermissionDenied(false);
              }}
              aria-label="Dismiss error"
              className="p-0.5 hover:bg-black/10 rounded cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Messenger-style Small Preview Tray BEFORE Sending (Camera / Gallery Photo / Video / Document) */}
      {stagedMedia && !isRecording && (
        <div className="px-3 py-2.5 border-b border-[#E5E8EE] dark:border-[#252A34] bg-[#F8FAFC] dark:bg-[#11141B] flex items-center gap-3">
          <div className="relative shrink-0">
            {stagedMedia.kind === 'image' && stagedMedia.previewUrl ? (
              <img
                src={stagedMedia.previewUrl}
                alt="Photo ready to send"
                className="w-16 h-16 rounded-xl object-cover border border-[#E5E8EE] dark:border-[#252A34] bg-black"
              />
            ) : stagedMedia.kind === 'video' && stagedMedia.previewUrl ? (
              <div className="relative w-20 h-16 rounded-xl overflow-hidden border border-[#E5E8EE] dark:border-[#252A34] bg-black">
                <video
                  src={stagedMedia.previewUrl}
                  muted
                  playsInline
                  preload="metadata"
                  className="w-full h-full object-cover"
                />
                {stagedMedia.durationSec ? (
                  <span className="absolute bottom-1 right-1 px-1 py-0.5 rounded bg-black/75 text-[10px] font-semibold text-white tabular-nums">
                    {formatMediaDuration(stagedMedia.durationSec)}
                  </span>
                ) : null}
              </div>
            ) : (
              <div className="w-14 h-14 rounded-xl bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                <FileText className="w-6 h-6" />
              </div>
            )}

            <button
              type="button"
              disabled={sending}
              onClick={clearStagedMedia}
              aria-label="Remove preview"
              className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-[#0F172A] text-white flex items-center justify-center shadow cursor-pointer"
            >
              <X className="w-3 h-3" />
            </button>
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-[#0F172A] dark:text-white truncate">
              {stagedMedia.kind === 'image'
                ? 'Photo ready to send'
                : stagedMedia.kind === 'video'
                  ? 'Video ready to send'
                  : stagedMedia.file.name}
            </p>
            <p className="text-[11px] text-[#64748B] dark:text-[#94A3B8] truncate">
              {formatFileSize(stagedMedia.file.size)} · Tap Send to deliver
            </p>
          </div>

          <button
            type="button"
            disabled={sending}
            onClick={() =>
              void executeMediaUploadAndSend({
                kind: stagedMedia.kind,
                blob: stagedMedia.file,
                fileName: stagedMedia.file.name,
                caption: draft.trim(),
              })
            }
            className="h-9 px-3.5 rounded-full bg-[#1877F2] hover:bg-[#166FE5] text-white text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50 shrink-0 cursor-pointer"
          >
            {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            <span>Send</span>
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

      {/* Attach Popover: Photo, Video, Document, Location */}
      {showAttach && (
        <div className="absolute bottom-full right-3 mb-2 w-56 bg-white dark:bg-[#1C2029] border border-[#E5E8EE] dark:border-[#2D3342] rounded-2xl shadow-xl p-2 z-30 grid grid-cols-2 gap-1.5">
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

      {/* Facebook Messenger Voice Recording Bar OR Standard [Emoji] [Message] [Attach] [Camera] [Mic/Send] */}
      {isRecording ? (
        <div className="p-2.5 flex items-center justify-between gap-2">
          {/* Cancel / Delete */}
          <button
            type="button"
            onClick={() => stopVoiceRecording(true)}
            aria-label="Cancel voice recording"
            title="Cancel recording"
            className="w-9 h-9 rounded-full bg-[#FEF2F2] dark:bg-[#3B181A] hover:bg-[#FEE2E2] text-[#DC2626] dark:text-[#FCA5A5] flex items-center justify-center shrink-0 cursor-pointer"
          >
            <Trash2 className="w-4 h-4" />
          </button>

          {/* Red dot + Timer + Live Waveform + Recording... */}
          <div className="flex-1 min-w-0 flex items-center gap-2.5 px-3 py-2 rounded-full bg-[#FEF2F2] dark:bg-[#2B1517] border border-[#FECACA]/60 dark:border-[#7F1D1D]/60">
            <span className="w-2.5 h-2.5 rounded-full bg-[#EF4444] animate-pulse shrink-0" />
            <span className="text-xs font-bold text-[#B91C1C] dark:text-[#FCA5A5] tabular-nums shrink-0">
              {formatTimer(recordSeconds)}
            </span>
            <div className="flex-1 flex items-center justify-center gap-[3px] h-5 overflow-hidden">
              {waveformLevels.map((lvl, idx) => (
                <span
                  key={idx}
                  className="w-[3px] rounded-full bg-[#EF4444] dark:bg-[#F87171] transition-all duration-75"
                  style={{height: `${Math.max(20, Math.min(100, lvl))}%`}}
                />
              ))}
            </div>
            <span className="hidden sm:inline text-[11px] font-medium text-[#B91C1C] dark:text-[#FCA5A5] shrink-0">
              Recording...
            </span>
          </div>

          {/* Lock Hands-Free Button */}
          <button
            type="button"
            onClick={() => {
              const next = !recordLockedRef.current;
              recordLockedRef.current = next;
              setIsRecordLocked(next);
            }}
            aria-label={isRecordLocked ? 'Recording locked hands-free' : 'Lock hands-free recording'}
            title={isRecordLocked ? 'Locked (hands-free)' : 'Lock hands-free'}
            className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-colors cursor-pointer ${
              isRecordLocked
                ? 'bg-[#1877F2]/15 text-[#1877F2] dark:text-[#60A5FA]'
                : 'bg-[#F4F6F9] dark:bg-[#232732] text-[#64748B] dark:text-[#94A3B8]'
            }`}
          >
            {isRecordLocked ? <Lock className="w-4 h-4" /> : <LockOpen className="w-4 h-4" />}
          </button>

          {/* Send Voice Button */}
          <button
            type="button"
            onClick={() => stopVoiceRecording(false)}
            aria-label="Send voice message"
            className="h-9 px-3.5 rounded-full bg-[#1877F2] hover:bg-[#166FE5] text-white text-xs font-semibold inline-flex items-center gap-1.5 shrink-0 cursor-pointer"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Send</span>
          </button>
        </div>
      ) : (
        <form
          onSubmit={handleFormSubmit}
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
            placeholder={stagedMedia ? 'Add a caption...' : placeholder}
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
            aria-label="Attach photo, video, document, or location"
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

          {/* [Mic] -> becomes [Send] when text or photo preview is present */}
          {hasTextOrMedia ? (
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
              onPointerDown={handleMicPointerDown}
              onPointerUp={handleMicPointerUp}
              onContextMenu={(e) => e.preventDefault()}
              aria-label="Hold or tap to record voice message"
              title="Tap or hold to record voice message"
              className="w-10 h-10 rounded-full bg-[#1877F2]/12 hover:bg-[#1877F2]/20 text-[#1877F2] dark:text-[#60A5FA] flex items-center justify-center disabled:opacity-45 active:scale-95 transition-all shrink-0 touch-none select-none cursor-pointer"
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
              <span className="font-display font-semibold text-sm">Take Photo</span>
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
                  <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        closeCameraModal();
                        nativeCameraInputRef.current?.click();
                      }}
                      className="px-4 py-2 rounded-xl bg-[#1877F2] text-white text-xs font-semibold cursor-pointer"
                    >
                      Open Device Camera
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        closeCameraModal();
                        photoInputRef.current?.click();
                      }}
                      className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-semibold cursor-pointer"
                    >
                      Choose From Gallery
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover"
                  />
                  {!cameraReady && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-white text-xs gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Starting camera...</span>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="p-4 flex items-center justify-between gap-3 bg-[#161A23]">
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
                disabled={Boolean(cameraError) || !cameraReady}
                onClick={handleCapturePhoto}
                aria-label="Take photo"
                className="w-16 h-16 rounded-full border-4 border-white flex items-center justify-center active:scale-95 disabled:opacity-40 transition-transform cursor-pointer"
              >
                <span className="w-12 h-12 rounded-full bg-white block" />
              </button>

              <button
                type="button"
                onClick={() => {
                  closeCameraModal();
                  photoInputRef.current?.click();
                }}
                title="Pick from gallery"
                className="w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center cursor-pointer"
              >
                <ImageIcon className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
