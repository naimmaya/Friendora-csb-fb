import {useEffect, useMemo, useRef, useState} from 'react';
import {
  AlertCircle,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  RefreshCw,
  Users,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  CallRingtoneController,
  formatCallDuration,
  requestCallMedia,
  switchCameraTrack,
} from '../lib/callService';
import {
  joinGroupCallPermanent,
  leaveGroupCallPermanent,
  sendGroupCallSignal,
  subscribeGroupCallDoc,
  subscribeGroupCallParticipants,
  subscribeGroupCallSignals,
  upsertGroupCallParticipant,
  type GroupCallParticipantDoc,
  type GroupCallSignalDoc,
} from '../lib/groupService';
import type {GroupCallDoc, UserProfile} from '../types';
import {Avatar} from './MediaImage';

const GROUP_RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    {
      urls: [
        'stun:stun.l.google.com:19302',
        'stun:stun1.l.google.com:19302',
        'stun:stun2.l.google.com:19302',
        'stun:stun3.l.google.com:19302',
        'stun:stun4.l.google.com:19302',
      ],
    },
    {
      urls: [
        'stun:stun.services.mozilla.com',
        'stun:global.stun.twilio.com:3478',
      ],
    },
  ],
  iceCandidatePoolSize: 10,
};

interface GroupCallOverlayProps {
  call: GroupCallDoc;
  mode: 'incoming' | 'active';
  currentUser: UserProfile;
  allUsers: UserProfile[];
  onAcceptIncoming: (call: GroupCallDoc) => void;
  onDeclineIncoming: (callId: string) => void;
  onCallEnded: (callId: string) => void;
}

/**
 * Real-time Voice Activity Detector using Web Audio API AnalyserNode.
 * Drives the Facebook Messenger-style glowing ring around whoever is speaking.
 */
function useSpeakingDetector(stream: MediaStream | null, streamVersion: number, isMuted: boolean): boolean {
  const [isSpeaking, setIsSpeaking] = useState(false);

  useEffect(() => {
    if (!stream || isMuted) {
      setIsSpeaking(false);
      return;
    }

    const audioTracks = stream.getAudioTracks().filter((t) => t.readyState === 'live' && t.enabled);
    if (audioTracks.length === 0) {
      setIsSpeaking(false);
      return;
    }

    const AudioCtx =
      window.AudioContext ||
      (window as unknown as {webkitAudioContext?: typeof AudioContext}).webkitAudioContext;
    if (!AudioCtx) return;

    let ctx: AudioContext | null = null;
    let intervalId: number | null = null;

    try {
      ctx = new AudioCtx();
      const audioOnlyStream = new MediaStream(audioTracks);
      const source = ctx.createMediaStreamSource(audioOnlyStream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.5;
      source.connect(analyser);

      const data = new Uint8Array(analyser.fftSize);
      intervalId = window.setInterval(() => {
        if (!ctx) return;
        if (ctx.state === 'suspended') {
          ctx.resume().catch(() => {});
        }
        analyser.getByteTimeDomainData(data);
        let sumSq = 0;
        for (let i = 0; i < data.length; i++) {
          const norm = (data[i] - 128) / 128;
          sumSq += norm * norm;
        }
        const rms = Math.sqrt(sumSq / data.length);
        setIsSpeaking(rms > 0.032);
      }, 140);
    } catch {
      setIsSpeaking(false);
    }

    return () => {
      if (intervalId !== null) window.clearInterval(intervalId);
      if (ctx) {
        ctx.close().catch(() => {});
      }
      setIsSpeaking(false);
    };
  }, [stream, streamVersion, isMuted]);

  return isSpeaking;
}

interface ParticipantTileProps {
  name: string;
  avatar: string;
  stream: MediaStream | null;
  streamVersion: number;
  isVideoCall: boolean;
  isLocal: boolean;
  muted: boolean;
  cameraOff: boolean;
  speakerOn: boolean;
  facingMode?: 'user' | 'environment';
  onAudioBlocked?: () => void;
  audioUnlockSignal: number;
}

function ParticipantTile({
  name,
  avatar,
  stream,
  streamVersion,
  isVideoCall,
  isLocal,
  muted,
  cameraOff,
  speakerOn,
  facingMode = 'user',
  onAudioBlocked,
  audioUnlockSignal,
}: ParticipantTileProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const isSpeaking = useSpeakingDetector(stream, streamVersion, muted);

  const hasLiveVideoTrack =
    isVideoCall &&
    !cameraOff &&
    Boolean(
      stream &&
        stream.getVideoTracks().some((t) => t.enabled && t.readyState === 'live'),
    );

  // Always keep remote <audio> playing reliably (separate from <video> to avoid autoplay blocks & echo)
  useEffect(() => {
    const audioEl = audioRef.current;
    if (!audioEl || isLocal || !stream) return;
    if (audioEl.srcObject !== stream) {
      audioEl.srcObject = stream;
    }
    audioEl.muted = !speakerOn;
    audioEl.volume = speakerOn ? 1.0 : 0;
    audioEl.play().catch(() => {
      onAudioBlocked?.();
    });
  }, [stream, streamVersion, isLocal, speakerOn, audioUnlockSignal, onAudioBlocked]);

  // Always bind <video> element whenever mounted or stream/camera updates
  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl || !stream || !hasLiveVideoTrack) return;
    if (videoEl.srcObject !== stream) {
      videoEl.srcObject = stream;
    }
    // Keep <video> muted so every browser autoplays video immediately while <audio> plays voice cleanly
    videoEl.muted = true;
    videoEl.play().catch(() => {});
  }, [stream, streamVersion, hasLiveVideoTrack]);

  // AUDIO GROUP CALL TILE: Circular Profile Photo Grid with Active Speaker Glow
  if (!isVideoCall) {
    return (
      <div
        className={`relative w-full h-full min-h-[140px] rounded-3xl bg-[#151B28]/90 border transition-all duration-200 flex flex-col items-center justify-center p-4 ${
          isSpeaking
            ? 'border-emerald-400/80 shadow-[0_0_28px_rgba(52,211,153,0.28)]'
            : 'border-white/10'
        }`}
      >
        {!isLocal && <audio ref={audioRef} autoPlay playsInline className="hidden" />}

        <div className="relative mb-3">
          {isSpeaking && (
            <>
              <span className="absolute -inset-3 rounded-full bg-emerald-400/25 animate-ping" />
              <span className="absolute -inset-1.5 rounded-full ring-4 ring-emerald-400/80" />
            </>
          )}
          <div
            className={`relative rounded-full p-1 transition-all duration-200 ${
              isSpeaking
                ? 'bg-gradient-to-tr from-emerald-400 via-teal-400 to-blue-500 scale-105'
                : 'bg-white/15'
            }`}
          >
            <Avatar
              src={avatar}
              name={name}
              size="xl"
              className="w-20 h-20 sm:w-24 sm:h-24 ring-2 ring-[#0B0F17]"
            />
          </div>
          {muted && (
            <span
              title="Muted"
              className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-red-500 text-white flex items-center justify-center ring-2 ring-[#151B28] shadow-md"
            >
              <MicOff className="w-3.5 h-3.5" />
            </span>
          )}
        </div>

        <p className="text-sm sm:text-base font-bold text-white truncate max-w-full px-2">
          {name}
          {isLocal ? ' (You)' : ''}
        </p>
        <p
          className={`mt-0.5 text-xs font-medium ${
            muted
              ? 'text-red-300/90'
              : isSpeaking
                ? 'text-emerald-300'
                : 'text-white/60'
          }`}
        >
          {muted
            ? 'Muted'
            : isSpeaking
              ? 'Speaking...'
              : isLocal || stream
                ? 'Connected'
                : 'Connecting...'}
        </p>
      </div>
    );
  }

  // VIDEO GROUP CALL TILE: Video Grid + Profile Photo Fallback when Camera is Off
  return (
    <div
      className={`relative w-full h-full min-h-[130px] rounded-2xl overflow-hidden bg-[#151B28] border-2 transition-all duration-200 flex flex-col items-center justify-center ${
        isSpeaking
          ? 'border-emerald-400 shadow-[0_0_24px_rgba(52,211,153,0.3)]'
          : 'border-white/10'
      }`}
    >
      {!isLocal && <audio ref={audioRef} autoPlay playsInline className="hidden" />}

      {hasLiveVideoTrack ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`w-full h-full object-cover ${isLocal && facingMode === 'user' ? '-scale-x-100' : ''}`}
        />
      ) : (
        <div className="flex flex-col items-center justify-center p-4 text-center">
          <div className="relative">
            {isSpeaking && (
              <span className="absolute -inset-2 rounded-full ring-3 ring-emerald-400/80 animate-pulse" />
            )}
            <Avatar
              src={avatar}
              name={name}
              size="lg"
              className="w-16 h-16 sm:w-20 sm:h-20 ring-2 ring-white/20"
            />
          </div>
          <p className="mt-2.5 text-xs sm:text-sm font-bold text-white truncate max-w-[170px]">
            {name}
            {isLocal ? ' (You)' : ''}
          </p>
          <p className="text-[11px] text-white/60 mt-0.5">
            {cameraOff
              ? 'Camera off'
              : isLocal || stream
                ? 'Audio only'
                : 'Connecting video...'}
          </p>
        </div>
      )}

      {/* Subtle bottom gradient + name/mic badge */}
      <div className="absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-black/75 via-black/30 to-transparent pointer-events-none" />
      <div className="absolute bottom-2.5 left-2.5 right-2.5 flex items-center justify-between gap-2 pointer-events-none">
        <span className="px-2.5 py-1 rounded-lg bg-black/55 backdrop-blur-xs text-[11px] sm:text-xs font-semibold text-white truncate max-w-[82%] flex items-center gap-1.5">
          {isSpeaking && !muted && (
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
          )}
          <span className="truncate">
            {name}
            {isLocal ? ' (You)' : ''}
          </span>
        </span>
        {muted && (
          <span className="w-6 h-6 rounded-full bg-red-500/90 text-white flex items-center justify-center shrink-0">
            <MicOff className="w-3.5 h-3.5" />
          </span>
        )}
      </div>
    </div>
  );
}

export function GroupCallOverlay({
  call,
  mode,
  currentUser,
  allUsers,
  onAcceptIncoming,
  onDeclineIncoming,
  onCallEnded,
}: GroupCallOverlayProps) {
  const [liveCall, setLiveCall] = useState<GroupCallDoc>(call);
  const [participantDocs, setParticipantDocs] = useState<GroupCallParticipantDoc[]>([]);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(call.type === 'audio');
  const [speakerOn, setSpeakerOn] = useState(true);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [switchingCamera, setSwitchingCamera] = useState(false);
  const [mediaReady, setMediaReady] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [audioUnlockSignal, setAudioUnlockSignal] = useState(0);

  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [localStreamVersion, setLocalStreamVersion] = useState(0);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [remoteStreamVersions, setRemoteStreamVersions] = useState<Record<string, number>>({});

  const ringtoneRef = useRef<CallRingtoneController | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const pcsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const remoteStreamsRef = useRef<Map<string, MediaStream>>(new Map());
  const pendingIceRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const elapsedRef = useRef(0);
  const endedRef = useRef(false);

  const myUid = currentUser.uid || '';
  const isVideo = liveCall.type === 'video';

  const userByUid = useMemo(() => {
    const map = new Map<string, UserProfile>();
    if (currentUser.uid) map.set(currentUser.uid, currentUser);
    for (const u of allUsers) {
      if (u.uid) map.set(u.uid, u);
    }
    return map;
  }, [allUsers, currentUser]);

  const participantDocByUid = useMemo(() => {
    const map = new Map<string, GroupCallParticipantDoc>();
    for (const p of participantDocs) {
      map.set(p.uid, p);
    }
    return map;
  }, [participantDocs]);

  // Active peer UIDs from real-time participants subcollection + liveCall.activeUids (never empty while in call)
  const activeJoinedUids = useMemo(() => {
    const joinedFromSubcollection = participantDocs
      .filter((p) => p.status === 'joined')
      .map((p) => p.uid);
    const leftFromSubcollection = new Set(
      participantDocs.filter((p) => p.status === 'left').map((p) => p.uid),
    );
    const fromCallDoc = liveCall.activeUids.filter((uid) => !leftFromSubcollection.has(uid));
    const merged = Array.from(
      new Set([
        ...(mode === 'active' && myUid ? [myUid] : []),
        ...joinedFromSubcollection,
        ...fromCallDoc,
      ]),
    );
    return merged.slice(0, 12);
  }, [participantDocs, liveCall.activeUids, mode, myUid]);

  // Build ordered tile list for the Grid (ALL hooks stay unconditionally above any early return!)
  const participants = useMemo(() => {
    return activeJoinedUids.map((uid) => {
      const pDoc = participantDocByUid.get(uid);
      const prof = userByUid.get(uid);
      const isLocal = uid === myUid;
      return {
        uid,
        name: pDoc?.name || prof?.name || 'Member',
        avatar: pDoc?.avatarUrl || prof?.avatar_url || '',
        isLocal,
        stream: isLocal ? localStream : remoteStreams[uid] || null,
        streamVersion: isLocal ? localStreamVersion : remoteStreamVersions[uid] || 0,
        muted: isLocal ? isMuted : Boolean(pDoc?.isMuted),
        cameraOff: isLocal ? cameraOff : isVideo ? Boolean(pDoc?.isVideoOff) : true,
      };
    });
  }, [
    activeJoinedUids,
    participantDocByUid,
    userByUid,
    myUid,
    localStream,
    localStreamVersion,
    remoteStreams,
    remoteStreamVersions,
    isMuted,
    cameraOff,
    isVideo,
  ]);

  function cleanupPeer(peerUid: string) {
    const pc = pcsRef.current.get(peerUid);
    if (pc) {
      try {
        pc.ontrack = null;
        pc.onicecandidate = null;
        pc.onconnectionstatechange = null;
        pc.oniceconnectionstatechange = null;
        pc.close();
      } catch {
        // Ignore
      }
      pcsRef.current.delete(peerUid);
    }
    const rStream = remoteStreamsRef.current.get(peerUid);
    if (rStream) {
      rStream.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {
          // Ignore
        }
      });
      remoteStreamsRef.current.delete(peerUid);
    }
    pendingIceRef.current.delete(peerUid);
    setRemoteStreams((prev) => {
      if (!(peerUid in prev)) return prev;
      const next = {...prev};
      delete next[peerUid];
      return next;
    });
  }

  function cleanupMediaAndPeers() {
    ringtoneRef.current?.stop();
    Array.from(pcsRef.current.keys()).forEach((peerUid) => cleanupPeer(peerUid));
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {
          // Ignore
        }
      });
      localStreamRef.current = null;
    }
    setLocalStream(null);
    setRemoteStreams({});
  }

  async function flushPendingIce(peerUid: string, pc: RTCPeerConnection) {
    const queue = pendingIceRef.current.get(peerUid);
    if (!queue || queue.length === 0 || pc.signalingState === 'closed') return;
    while (queue.length > 0) {
      const cand = queue.shift();
      if (!cand || !cand.candidate) continue;
      try {
        await pc.addIceCandidate(new RTCIceCandidate(cand));
      } catch {
        // Ignore individual stale ICE candidate
      }
    }
  }

  function createPeerConnection(peerUid: string): RTCPeerConnection {
    const existing = pcsRef.current.get(peerUid);
    if (existing && existing.signalingState !== 'closed' && existing.connectionState !== 'failed') {
      return existing;
    }
    if (existing) {
      cleanupPeer(peerUid);
    }

    const pc = new RTCPeerConnection(GROUP_RTC_CONFIG);
    pcsRef.current.set(peerUid, pc);

    const peerRemoteStream = new MediaStream();
    remoteStreamsRef.current.set(peerUid, peerRemoteStream);

    // Add all local audio/video tracks to this per-member PeerConnection
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current!);
      });
    }

    const notifyRemoteUpdate = () => {
      setRemoteStreams((prev) => ({...prev, [peerUid]: peerRemoteStream}));
      setRemoteStreamVersions((prev) => ({...prev, [peerUid]: (prev[peerUid] || 0) + 1}));
    };

    pc.ontrack = (event) => {
      const incomingTracks: MediaStreamTrack[] = [];
      if (event.streams && event.streams[0]) {
        event.streams[0].getTracks().forEach((t) => incomingTracks.push(t));
      }
      if (event.track && !incomingTracks.some((t) => t.id === event.track.id)) {
        incomingTracks.push(event.track);
      }

      incomingTracks.forEach((track) => {
        if (!peerRemoteStream.getTracks().some((t) => t.id === track.id)) {
          peerRemoteStream.addTrack(track);
        }
        track.onunmute = notifyRemoteUpdate;
        track.onended = notifyRemoteUpdate;
      });
      notifyRemoteUpdate();
    };

    pc.onicecandidate = (event) => {
      if (event.candidate && event.candidate.candidate && myUid) {
        void sendGroupCallSignal({
          callId: call.id,
          fromUid: myUid,
          toUid: peerUid,
          kind: 'ice',
          candidate: event.candidate.candidate,
          sdpMid: event.candidate.sdpMid || '',
          sdpMLineIndex:
            typeof event.candidate.sdpMLineIndex === 'number'
              ? event.candidate.sdpMLineIndex
              : 0,
        });
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'failed') {
        try {
          pc.restartIce?.();
        } catch {
          // Ignore
        }
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'closed') {
        cleanupPeer(peerUid);
      }
    };

    return pc;
  }

  // Subscribe to groupCalls/{callId} & groupCalls/{callId}/participants in real time
  useEffect(() => {
    const unsubCall = subscribeGroupCallDoc(call.id, (updated) => {
      if (!updated) return;
      setLiveCall(updated);
      if (updated.status === 'ended' && !endedRef.current) {
        endedRef.current = true;
        cleanupMediaAndPeers();
        onCallEnded(call.id);
      }
    });
    const unsubParticipants = subscribeGroupCallParticipants(call.id, (list) => {
      setParticipantDocs(list);
    });
    return () => {
      unsubCall();
      unsubParticipants();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call.id]);

  // Ringtone for incoming call or outgoing ring while waiting for others to join
  useEffect(() => {
    const ringtone = new CallRingtoneController();
    ringtoneRef.current = ringtone;
    if (mode === 'incoming') {
      ringtone.start('incoming');
    } else if (liveCall.status === 'ringing' && activeJoinedUids.length <= 1) {
      ringtone.start('outgoing');
    }
    return () => {
      ringtone.stop();
    };
  }, [mode, liveCall.status, activeJoinedUids.length]);

  // Live duration timer while active
  useEffect(() => {
    if (mode !== 'active') return;
    const timer = window.setInterval(() => {
      elapsedRef.current += 1;
      setElapsedSec(elapsedRef.current);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [mode]);

  // Boot active group call:
  // 1) Acquire mic (+ auto camera ON for video calls) with echoCancellation + noiseSuppression
  // 2) Register joined status in groupCalls/{callId} + groupCalls/{callId}/participants/{myUid}
  // 3) Subscribe to per-member WebRTC mesh signals in groupCalls/{callId}/signals/{from_to_...}
  useEffect(() => {
    if (mode !== 'active' || !myUid) return;
    let cancelled = false;
    let unsubSignals: (() => void) | null = null;
    setMediaReady(false);
    setMediaError(null);

    async function bootActiveCall() {
      let acquiredCameraOff = call.type === 'audio';
      try {
        // Auto Video ON for video group call, Auto Mic ON with echoCancellation + noiseSuppression
        const stream = await requestCallMedia(call.type, 'user');
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        localStreamRef.current = stream;
        setLocalStream(stream);
        setLocalStreamVersion((v) => v + 1);
        acquiredCameraOff = call.type === 'audio' || stream.getVideoTracks().length === 0;
        setCameraOff(acquiredCameraOff);
      } catch (err) {
        if (cancelled) return;
        acquiredCameraOff = true;
        setCameraOff(true);
        setMediaError(
          err instanceof Error
            ? err.message
            : 'Could not access microphone/camera. Please allow permission.',
        );
      }

      if (cancelled) return;

      // Join call in Firestore (groupCalls/{callId} + groupCalls/{callId}/participants/{myUid})
      try {
        await joinGroupCallPermanent(call.id, currentUser, acquiredCameraOff);
      } catch {
        // Non-fatal if host already joined
      }

      if (cancelled) return;

      // Subscribe to pairwise WebRTC mesh signals AFTER local stream is ready so answers always include local tracks!
      unsubSignals = subscribeGroupCallSignals(call.id, myUid, async (sig: GroupCallSignalDoc) => {
        if (cancelled || !sig.fromUid || sig.fromUid === myUid) return;
        const pc = createPeerConnection(sig.fromUid);
        try {
          if (sig.kind === 'offer' && sig.sdp) {
            // Handle signaling glare gracefully: if already have local offer and remote has smaller UID, rollback
            if (pc.signalingState === 'have-local-offer') {
              if (sig.fromUid < myUid) {
                await pc.setLocalDescription({type: 'rollback'});
              } else {
                return;
              }
            }
            await pc.setRemoteDescription(new RTCSessionDescription({type: 'offer', sdp: sig.sdp}));
            await flushPendingIce(sig.fromUid, pc);

            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            if (answer.sdp) {
              await sendGroupCallSignal({
                callId: call.id,
                fromUid: myUid,
                toUid: sig.fromUid,
                kind: 'answer',
                sdp: answer.sdp,
              });
            }
          } else if (sig.kind === 'answer' && sig.sdp) {
            if (pc.signalingState === 'have-local-offer') {
              await pc.setRemoteDescription(
                new RTCSessionDescription({type: 'answer', sdp: sig.sdp}),
              );
              await flushPendingIce(sig.fromUid, pc);
            }
          } else if (sig.kind === 'ice' && sig.candidate) {
            const candInit: RTCIceCandidateInit = {
              candidate: sig.candidate,
              sdpMLineIndex: sig.sdpMLineIndex >= 0 ? sig.sdpMLineIndex : 0,
              ...(sig.sdpMid ? {sdpMid: sig.sdpMid} : {}),
            };
            if (!pc.remoteDescription || !pc.remoteDescription.type) {
              const queue = pendingIceRef.current.get(sig.fromUid) || [];
              queue.push(candInit);
              pendingIceRef.current.set(sig.fromUid, queue);
            } else if (pc.signalingState !== 'closed') {
              await pc.addIceCandidate(new RTCIceCandidate(candInit));
            }
          }
        } catch {
          // Ignore transient out-of-order signaling race
        }
      });

      setMediaReady(true);
    }

    void bootActiveCall();

    return () => {
      cancelled = true;
      unsubSignals?.();
      cleanupMediaAndPeers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, call.id, myUid]);

  // Mesh WebRTC Coordinator: create a dedicated PeerConnection to EVERY active peer once local media is ready!
  // Lexicographically smaller UID initiates the Offer to avoid glare.
  useEffect(() => {
    if (mode !== 'active' || !myUid || !mediaReady) return;
    const otherActive = activeJoinedUids.filter((u) => u !== myUid);

    otherActive.forEach(async (peerUid) => {
      if (myUid < peerUid && !pcsRef.current.has(peerUid)) {
        const pc = createPeerConnection(peerUid);
        try {
          const offer = await pc.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: isVideo,
          });
          await pc.setLocalDescription(offer);
          if (offer.sdp) {
            await sendGroupCallSignal({
              callId: call.id,
              fromUid: myUid,
              toUid: peerUid,
              kind: 'offer',
              sdp: offer.sdp,
            });
          }
        } catch {
          // Clean up failed peer attempt so next tick can retry
          cleanupPeer(peerUid);
        }
      }
    });

    // Immediately remove peers who left the call from WebRTC mesh & Grid
    const activeSet = new Set(otherActive);
    Array.from(pcsRef.current.keys()).forEach((peerUid) => {
      if (!activeSet.has(peerUid)) {
        cleanupPeer(peerUid);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, mediaReady, activeJoinedUids, myUid, isVideo]);

  function handleToggleMute() {
    const next = !isMuted;
    setIsMuted(next);
    localStreamRef.current?.getAudioTracks().forEach((t) => {
      t.enabled = !next;
    });
    void upsertGroupCallParticipant(call.id, currentUser, {
      status: 'joined',
      isMuted: next,
      isVideoOff: cameraOff,
    });
  }

  function handleToggleCamera() {
    if (!isVideo) return;
    const next = !cameraOff;
    setCameraOff(next);
    localStreamRef.current?.getVideoTracks().forEach((t) => {
      t.enabled = !next;
    });
    setLocalStreamVersion((v) => v + 1);
    void upsertGroupCallParticipant(call.id, currentUser, {
      status: 'joined',
      isMuted,
      isVideoOff: next,
    });
  }

  async function handleSwitchCamera() {
    if (!isVideo || !localStreamRef.current || switchingCamera || cameraOff) return;
    setSwitchingCamera(true);
    const nextFacing: 'user' | 'environment' = facingMode === 'user' ? 'environment' : 'user';
    try {
      const updatedStream = await switchCameraTrack(null, localStreamRef.current, nextFacing);
      const newVideoTrack = updatedStream.getVideoTracks()[0];
      if (newVideoTrack) {
        pcsRef.current.forEach((pc) => {
          const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
          if (sender) {
            sender.replaceTrack(newVideoTrack).catch(() => {});
          }
        });
      }
      setFacingMode(nextFacing);
      setLocalStreamVersion((v) => v + 1);
    } catch {
      // Single-camera device
    } finally {
      setSwitchingCamera(false);
    }
  }

  async function handleLeaveCall() {
    if (endedRef.current) return;
    endedRef.current = true;
    cleanupMediaAndPeers();
    await leaveGroupCallPermanent(call.id, currentUser, elapsedRef.current);
    onCallEnded(call.id);
  }

  // ============================================
  // INCOMING GROUP CALL POPUP (ALL MEMBERS)
  // ============================================
  if (mode === 'incoming') {
    const activeCount = Math.max(1, activeJoinedUids.length);
    return (
      <div className="fixed inset-0 z-[140] bg-[#0B0F17]/95 backdrop-blur-md flex flex-col items-center justify-between py-12 px-6 text-white select-none">
        <div className="text-center space-y-2">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 border border-white/10 text-xs font-semibold uppercase tracking-wider text-[#60A5FA]">
            <Users className="w-3.5 h-3.5" />
            <span>Incoming Group {isVideo ? 'Video' : 'Audio'} Call</span>
          </span>
          <h2 className="text-2xl sm:text-3xl font-display font-bold mt-2">{liveCall.groupName}</h2>
          <p className="text-sm text-white/75">
            Started by {liveCall.hostName} · {activeCount} {activeCount === 1 ? 'person' : 'people'} in call
          </p>
        </div>

        <div className="relative">
          <div className="absolute -inset-6 rounded-full bg-[#1877F2]/25 animate-ping" />
          <div className="absolute -inset-3 rounded-full bg-[#1877F2]/20 animate-pulse" />
          <div className="relative rounded-full p-2 bg-white/10 ring-4 ring-white/20">
            <Avatar src={liveCall.groupPhoto} name={liveCall.groupName} size="xl" />
          </div>
        </div>

        <div className="flex items-center justify-center gap-12">
          <div className="flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={() => onDeclineIncoming(liveCall.id)}
              aria-label="Decline group call"
              className="w-16 h-16 rounded-full bg-[#EF4444] hover:bg-[#DC2626] text-white flex items-center justify-center shadow-lg shadow-red-600/30 active:scale-95 transition-transform cursor-pointer"
            >
              <PhoneOff className="w-7 h-7" />
            </button>
            <span className="text-xs font-semibold text-white/85">Decline</span>
          </div>

          <div className="flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={() => onAcceptIncoming(liveCall)}
              aria-label="Join group call"
              className="w-16 h-16 rounded-full bg-[#22C55E] hover:bg-[#16A34A] text-white flex items-center justify-center shadow-lg shadow-green-600/35 animate-pulse active:scale-95 transition-transform cursor-pointer"
            >
              {isVideo ? <Video className="w-7 h-7" /> : <Phone className="w-7 h-7" />}
            </button>
            <span className="text-xs font-semibold text-white/85">Join Call</span>
          </div>
        </div>
      </div>
    );
  }

  // ============================================
  // ACTIVE GROUP CALL — RESPONSIVE MESSENGER GRID
  // 1 = full, 2 = 2 tiles, 3-4 = 2x2, 5-6 = 2x3/3x2, 7+ = 3-col grid
  // ============================================
  const count = participants.length;
  const gridClass =
    count <= 1
      ? 'grid-cols-1 grid-rows-1'
      : count === 2
        ? 'grid-cols-1 sm:grid-cols-2 grid-rows-2 sm:grid-rows-1'
        : count <= 4
          ? 'grid-cols-2 grid-rows-2'
          : count <= 6
            ? 'grid-cols-2 sm:grid-cols-3 grid-rows-3 sm:grid-rows-2'
            : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 auto-rows-fr';

  return (
    <div className="fixed inset-0 z-[140] bg-[#0B0F17] text-white flex flex-col select-none">
      {/* Top Bar */}
      <div className="px-4 sm:px-6 py-3.5 border-b border-white/10 bg-[#10141E]/95 flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <Avatar src={liveCall.groupPhoto} name={liveCall.groupName} size="sm" />
          <div className="min-w-0">
            <h2 className="font-display font-bold text-sm sm:text-base truncate">
              {liveCall.groupName}
            </h2>
            <p className="text-xs text-white/70 tabular-nums flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse inline-block" />
              <span>
                {count <= 1 ? 'Waiting for others...' : formatCallDuration(elapsedSec)} · {count}{' '}
                {count === 1 ? 'participant' : 'participants'}
              </span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {isVideo && (
            <button
              type="button"
              onClick={handleSwitchCamera}
              disabled={switchingCamera || cameraOff}
              title="Switch Camera"
              className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-40 flex items-center justify-center transition-colors cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 ${switchingCamera ? 'animate-spin' : ''}`} />
            </button>
          )}
          <span className="px-2.5 py-1 rounded-full bg-white/10 border border-white/10 text-[11px] font-semibold text-white/90">
            {isVideo ? 'Group Video' : 'Group Audio'}
          </span>
        </div>
      </div>

      {/* Tap-to-unmute audio fallback ONLY if mobile browser blocked autoplay */}
      {audioBlocked && (
        <div className="px-4 py-2 bg-emerald-500/20 border-b border-emerald-400/30 flex items-center justify-center">
          <button
            type="button"
            onClick={() => {
              setAudioBlocked(false);
              setAudioUnlockSignal((v) => v + 1);
            }}
            className="inline-flex items-center gap-2 rounded-full bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs px-4 py-1.5 shadow-md cursor-pointer"
          >
            <Volume2 className="w-4 h-4" />
            Tap to hear group audio
          </button>
        </div>
      )}

      {/* Media permission error banner */}
      {mediaError && (
        <div className="px-4 py-2.5 bg-red-500/20 border-b border-red-500/30 text-xs text-red-100 flex items-center justify-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-300 shrink-0" />
          <span>{mediaError}</span>
        </div>
      )}

      {/* Participant Grid (Video Grid OR Audio Profile Circle Grid) */}
      <div className={`flex-1 min-h-0 overflow-y-auto p-3 sm:p-4 grid gap-2.5 sm:gap-3 ${gridClass}`}>
        {participants.map((p) => (
          <ParticipantTile
            key={p.uid}
            name={p.name}
            avatar={p.avatar}
            stream={p.stream}
            streamVersion={p.streamVersion}
            isVideoCall={isVideo}
            isLocal={p.isLocal}
            muted={p.muted}
            cameraOff={p.cameraOff}
            speakerOn={speakerOn}
            facingMode={facingMode}
            onAudioBlocked={() => setAudioBlocked(true)}
            audioUnlockSignal={audioUnlockSignal}
          />
        ))}
      </div>

      {/* Bottom Messenger Controls: [Mute] [Video On/Off] [Speaker] [Leave Call - Red] */}
      <div className="px-4 py-4 sm:py-5 border-t border-white/10 bg-[#10141E] shrink-0">
        <div className="max-w-md mx-auto flex items-center justify-around gap-3">
          {/* Mute */}
          <button
            type="button"
            onClick={handleToggleMute}
            aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'}
            className="flex flex-col items-center gap-1.5 cursor-pointer"
          >
            <span
              className={`w-12 h-12 sm:w-14 sm:h-14 rounded-full flex items-center justify-center transition-colors ${
                isMuted ? 'bg-white text-[#0F172A]' : 'bg-white/15 hover:bg-white/25 text-white'
              }`}
            >
              {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            </span>
            <span className="text-[11px] font-medium text-white/80">
              {isMuted ? 'Unmute' : 'Mute'}
            </span>
          </button>

          {/* Video On/Off */}
          {isVideo && (
            <button
              type="button"
              onClick={handleToggleCamera}
              aria-label={cameraOff ? 'Turn video on' : 'Turn video off'}
              className="flex flex-col items-center gap-1.5 cursor-pointer"
            >
              <span
                className={`w-12 h-12 sm:w-14 sm:h-14 rounded-full flex items-center justify-center transition-colors ${
                  cameraOff ? 'bg-white text-[#0F172A]' : 'bg-white/15 hover:bg-white/25 text-white'
                }`}
              >
                {cameraOff ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
              </span>
              <span className="text-[11px] font-medium text-white/80">
                {cameraOff ? 'Video Off' : 'Video On'}
              </span>
            </button>
          )}

          {/* Speaker */}
          <button
            type="button"
            onClick={() => setSpeakerOn((prev) => !prev)}
            aria-label={speakerOn ? 'Mute speaker' : 'Unmute speaker'}
            className="flex flex-col items-center gap-1.5 cursor-pointer"
          >
            <span
              className={`w-12 h-12 sm:w-14 sm:h-14 rounded-full flex items-center justify-center transition-colors ${
                speakerOn ? 'bg-white text-[#0F172A]' : 'bg-white/15 hover:bg-white/25 text-white'
              }`}
            >
              {speakerOn ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
            </span>
            <span className="text-[11px] font-medium text-white/80">Speaker</span>
          </button>

          {/* Leave Call (Red) */}
          <button
            type="button"
            onClick={handleLeaveCall}
            aria-label="Leave group call"
            className="flex flex-col items-center gap-1.5 cursor-pointer"
          >
            <span className="w-14 h-12 sm:w-14 sm:h-14 rounded-full bg-[#EF4444] hover:bg-[#DC2626] text-white flex items-center justify-center shadow-lg shadow-red-600/35 active:scale-95 transition-transform">
              <PhoneOff className="w-6 h-6" />
            </span>
            <span className="text-[11px] font-semibold text-red-300">Leave Call</span>
          </button>
        </div>
      </div>
    </div>
  );
}
