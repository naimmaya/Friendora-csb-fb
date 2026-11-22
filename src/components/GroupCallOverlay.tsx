import {useEffect, useMemo, useRef, useState} from 'react';
import {
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
import {CallRingtoneController, formatCallDuration} from '../lib/callService';
import {
  joinGroupCallPermanent,
  leaveGroupCallPermanent,
  sendGroupCallSignal,
  subscribeGroupCallDoc,
  subscribeGroupCallSignals,
  type GroupCallSignalDoc,
} from '../lib/groupService';
import type {GroupCallDoc, UserProfile} from '../types';
import {Avatar} from './MediaImage';

const GROUP_ICE_SERVERS: RTCIceServer[] = [
  {
    urls: [
      'stun:stun.l.google.com:19302',
      'stun:stun1.l.google.com:19302',
      'stun:stun2.l.google.com:19302',
    ],
  },
];

interface GroupCallOverlayProps {
  call: GroupCallDoc;
  mode: 'incoming' | 'active';
  currentUser: UserProfile;
  allUsers: UserProfile[];
  onAcceptIncoming: (call: GroupCallDoc) => void;
  onDeclineIncoming: (callId: string) => void;
  onCallEnded: () => void;
}

function ParticipantTile({
  name,
  avatar,
  stream,
  isVideoCall,
  isLocal,
  muted,
  cameraOff,
  speakerMuted,
}: {
  name: string;
  avatar: string;
  stream: MediaStream | null;
  isVideoCall: boolean;
  isLocal: boolean;
  muted?: boolean;
  cameraOff?: boolean;
  speakerMuted?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => {});
    }
    if (audioRef.current && stream && !isLocal) {
      audioRef.current.srcObject = stream;
      audioRef.current.muted = Boolean(speakerMuted);
      audioRef.current.play().catch(() => {});
    }
  }, [stream, isLocal, speakerMuted]);

  const hasVideoTrack =
    isVideoCall &&
    !cameraOff &&
    Boolean(stream && stream.getVideoTracks().some((t) => t.enabled && t.readyState === 'live'));

  return (
    <div className="relative w-full h-full min-h-[120px] rounded-2xl overflow-hidden bg-[#171B24] border border-white/10 flex flex-col items-center justify-center">
      {hasVideoTrack ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isLocal || Boolean(speakerMuted)}
          className={`w-full h-full object-cover ${isLocal ? '-scale-x-100' : ''}`}
        />
      ) : (
        <div className="flex flex-col items-center justify-center p-3 text-center">
          <Avatar src={avatar} name={name} size="lg" />
          <p className="mt-2.5 text-xs sm:text-sm font-semibold text-white truncate max-w-[160px]">
            {name}
          </p>
          <p className="text-[11px] text-white/60">
            {isLocal ? (cameraOff ? 'Camera off' : 'Connected') : stream ? 'Audio connected' : 'Connecting...'}
          </p>
        </div>
      )}

      {!isLocal && !hasVideoTrack && (
        <audio ref={audioRef} autoPlay playsInline muted={Boolean(speakerMuted)} className="hidden" />
      )}

      {/* Name badge */}
      <div className="absolute bottom-2.5 left-2.5 right-2.5 flex items-center justify-between gap-2 pointer-events-none">
        <span className="px-2.5 py-1 rounded-lg bg-black/60 backdrop-blur-xs text-[11px] font-semibold text-white truncate max-w-[80%]">
          {name}
          {isLocal ? ' (You)' : ''}
        </span>
        {muted && (
          <span className="w-6 h-6 rounded-full bg-red-500/90 text-white flex items-center justify-center shrink-0">
            <MicOff className="w-3 h-3" />
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
  const [elapsedSec, setElapsedSec] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(call.type === 'audio');
  const [speakerMuted, setSpeakerMuted] = useState(false);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});

  const ringtoneRef = useRef<CallRingtoneController | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const pcsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
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

  // Keep call doc synced via onSnapshot
  useEffect(() => {
    const unsub = subscribeGroupCallDoc(call.id, (updated) => {
      if (!updated) return;
      setLiveCall(updated);
      if (updated.status === 'ended' && !endedRef.current) {
        endedRef.current = true;
        cleanupMediaAndPeers();
        onCallEnded();
      }
    });
    return () => unsub();
  }, [call.id, onCallEnded]);

  // Ringtone for incoming call
  useEffect(() => {
    const ringtone = new CallRingtoneController();
    ringtoneRef.current = ringtone;
    if (mode === 'incoming') {
      ringtone.start('incoming');
    } else if (liveCall.status === 'ringing' && liveCall.activeUids.length <= 1) {
      ringtone.start('outgoing');
    }
    return () => {
      ringtone.stop();
    };
  }, [mode, liveCall.status, liveCall.activeUids.length]);

  // Call timer when active
  useEffect(() => {
    if (mode !== 'active') return;
    const timer = window.setInterval(() => {
      elapsedRef.current += 1;
      setElapsedSec(elapsedRef.current);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [mode]);

  function cleanupMediaAndPeers() {
    ringtoneRef.current?.stop();
    pcsRef.current.forEach((pc) => {
      try {
        pc.close();
      } catch {
        // ignore
      }
    });
    pcsRef.current.clear();
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    setLocalStream(null);
    setRemoteStreams({});
  }

  function createPeerConnection(peerUid: string): RTCPeerConnection {
    const existing = pcsRef.current.get(peerUid);
    if (existing) return existing;

    const pc = new RTCPeerConnection({iceServers: GROUP_ICE_SERVERS});
    pcsRef.current.set(peerUid, pc);

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current!);
      });
    }

    pc.ontrack = (event) => {
      const [stream] = event.streams;
      if (stream) {
        setRemoteStreams((prev) => ({...prev, [peerUid]: stream}));
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate && myUid) {
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
              : -1,
        });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        pcsRef.current.delete(peerUid);
        setRemoteStreams((prev) => {
          const next = {...prev};
          delete next[peerUid];
          return next;
        });
      }
    };

    return pc;
  }

  // Acquire local media & subscribe to mesh WebRTC signals when active
  useEffect(() => {
    if (mode !== 'active' || !myUid) return;
    let cancelled = false;
    let unsubSignals: (() => void) | null = null;

    async function bootActiveCall() {
      try {
        await joinGroupCallPermanent(call.id, myUid);
      } catch {
        // Host already joined
      }

      if (navigator.mediaDevices?.getUserMedia) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: isVideo ? {facingMode: 'user', width: {ideal: 640}, height: {ideal: 480}} : false,
          });
          if (cancelled) {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
          localStreamRef.current = stream;
          setLocalStream(stream);
        } catch (err) {
          setMediaError(
            err instanceof Error
              ? `Camera/Microphone permission error: ${err.message}`
              : 'Could not access microphone/camera.',
          );
        }
      }

      unsubSignals = subscribeGroupCallSignals(call.id, myUid, async (sig: GroupCallSignalDoc) => {
        if (cancelled) return;
        const pc = createPeerConnection(sig.fromUid);
        try {
          if (sig.kind === 'offer' && sig.sdp) {
            await pc.setRemoteDescription({type: 'offer', sdp: sig.sdp});
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
              await pc.setRemoteDescription({type: 'answer', sdp: sig.sdp});
            }
          } else if (sig.kind === 'ice' && sig.candidate) {
            await pc.addIceCandidate({
              candidate: sig.candidate,
              sdpMid: sig.sdpMid || undefined,
              sdpMLineIndex: sig.sdpMLineIndex >= 0 ? sig.sdpMLineIndex : undefined,
            });
          }
        } catch {
          // Ignore out-of-order signaling race
        }
      });
    }

    void bootActiveCall();

    return () => {
      cancelled = true;
      unsubSignals?.();
      cleanupMediaAndPeers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, call.id, myUid]);

  // Initiate WebRTC offers deterministically (lexicographically smaller UID initiates offer)
  useEffect(() => {
    if (mode !== 'active' || !myUid) return;
    const otherActive = liveCall.activeUids.filter((u) => u !== myUid);

    otherActive.forEach(async (peerUid) => {
      if (myUid < peerUid && !pcsRef.current.has(peerUid)) {
        const pc = createPeerConnection(peerUid);
        try {
          const offer = await pc.createOffer();
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
          // Retry on next state tick if needed
        }
      }
    });

    // Clean up departed peers
    const activeSet = new Set(otherActive);
    Array.from(pcsRef.current.keys()).forEach((peerUid) => {
      if (!activeSet.has(peerUid)) {
        pcsRef.current.get(peerUid)?.close();
        pcsRef.current.delete(peerUid);
        setRemoteStreams((prev) => {
          const next = {...prev};
          delete next[peerUid];
          return next;
        });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, liveCall.activeUids, myUid, localStream]);

  function handleToggleMute() {
    const next = !isMuted;
    setIsMuted(next);
    localStreamRef.current?.getAudioTracks().forEach((t) => {
      t.enabled = !next;
    });
  }

  function handleToggleCamera() {
    if (!isVideo) return;
    const next = !cameraOff;
    setCameraOff(next);
    localStreamRef.current?.getVideoTracks().forEach((t) => {
      t.enabled = !next;
    });
  }

  async function handleSwitchCamera() {
    if (!isVideo || !navigator.mediaDevices?.getUserMedia) return;
    const nextFacing = facingMode === 'user' ? 'environment' : 'user';
    try {
      const newVideoStream = await navigator.mediaDevices.getUserMedia({
        video: {facingMode: {ideal: nextFacing}},
        audio: false,
      });
      const newTrack = newVideoStream.getVideoTracks()[0];
      if (!newTrack) return;

      const oldStream = localStreamRef.current;
      if (oldStream) {
        oldStream.getVideoTracks().forEach((t) => {
          oldStream.removeTrack(t);
          t.stop();
        });
        oldStream.addTrack(newTrack);
      }

      pcsRef.current.forEach((pc) => {
        const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
        if (sender) {
          sender.replaceTrack(newTrack).catch(() => {});
        }
      });
      setFacingMode(nextFacing);
    } catch {
      // Single camera device
    }
  }

  async function handleHangUp() {
    if (endedRef.current) return;
    endedRef.current = true;
    const isHost = liveCall.hostUid === myUid;
    const onlyMeLeft = liveCall.activeUids.filter((u) => u !== myUid).length === 0;
    cleanupMediaAndPeers();
    await leaveGroupCallPermanent(
      call.id,
      currentUser,
      elapsedRef.current,
      isHost && onlyMeLeft,
    );
    onCallEnded();
  }

  // ============================================
  // INCOMING GROUP CALL POPUP (ALL MEMBERS)
  // ============================================
  if (mode === 'incoming') {
    return (
      <div className="fixed inset-0 z-[140] bg-[#0B0F17]/92 backdrop-blur-md flex flex-col items-center justify-between py-12 px-6 text-white">
        <div className="text-center space-y-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-[#60A5FA]">
            <Users className="w-4 h-4" />
            <span>Incoming Group {isVideo ? 'Video' : 'Audio'} Call</span>
          </span>
          <h2 className="text-2xl sm:text-3xl font-display font-bold">{liveCall.groupName}</h2>
          <p className="text-sm text-white/75">
            Started by {liveCall.hostName} · {liveCall.activeUids.length} in call
          </p>
        </div>

        <div className="relative">
          <div className="absolute -inset-6 rounded-full bg-[#1877F2]/25 animate-ping" />
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
            <span className="text-xs font-medium text-white/80">Decline</span>
          </div>

          <div className="flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={() => onAcceptIncoming(liveCall)}
              aria-label="Join group call"
              className="w-16 h-16 rounded-full bg-[#22C55E] hover:bg-[#16A34A] text-white flex items-center justify-center shadow-lg shadow-green-600/30 active:scale-95 transition-transform cursor-pointer"
            >
              {isVideo ? <Video className="w-7 h-7" /> : <Phone className="w-7 h-7" />}
            </button>
            <span className="text-xs font-medium text-white/80">Join Call</span>
          </div>
        </div>
      </div>
    );
  }

  // ============================================
  // ACTIVE GROUP CALL — GRID VIEW (1=full, 4=2x2, 12=3x4)
  // ============================================
  const participants = useMemo(() => {
    const uids = Array.from(new Set([myUid, ...liveCall.activeUids])).slice(0, 12);
    return uids.map((uid) => {
      const prof = userByUid.get(uid);
      return {
        uid,
        name: prof?.name || 'Member',
        avatar: prof?.avatar_url || '',
        isLocal: uid === myUid,
        stream: uid === myUid ? localStream : remoteStreams[uid] || null,
      };
    });
  }, [myUid, liveCall.activeUids, userByUid, localStream, remoteStreams]);

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
            : 'grid-cols-3 grid-rows-4';

  return (
    <div className="fixed inset-0 z-[140] bg-[#0B0F17] text-white flex flex-col">
      {/* Top Bar */}
      <div className="px-4 sm:px-6 py-3.5 border-b border-white/10 flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <Avatar src={liveCall.groupPhoto} name={liveCall.groupName} size="sm" />
          <div className="min-w-0">
            <h2 className="font-display font-bold text-sm sm:text-base truncate">
              {liveCall.groupName}
            </h2>
            <p className="text-xs text-white/70 tabular-nums">
              {liveCall.activeUids.length <= 1 ? 'Ringing group...' : formatCallDuration(elapsedSec)} ·{' '}
              {liveCall.activeUids.length} active ({liveCall.joinedUids.length} joined)
            </p>
          </div>
        </div>

        <span className="px-2.5 py-1 rounded-lg bg-white/10 text-[11px] font-semibold text-white/90 shrink-0">
          {isVideo ? 'Group Video' : 'Group Audio'}
        </span>
      </div>

      {mediaError && (
        <div className="px-4 py-2 bg-red-500/20 border-b border-red-500/30 text-xs text-red-200 text-center">
          {mediaError}
        </div>
      )}

      {/* Responsive Participant Grid: 1=full, 4=2x2, 12=3x4 */}
      <div className={`flex-1 min-h-0 p-3 sm:p-4 grid gap-2.5 sm:gap-3 ${gridClass}`}>
        {participants.map((p) => (
          <ParticipantTile
            key={p.uid}
            name={p.name}
            avatar={p.avatar}
            stream={p.stream}
            isVideoCall={isVideo}
            isLocal={p.isLocal}
            muted={p.isLocal ? isMuted : false}
            cameraOff={p.isLocal ? cameraOff : false}
            speakerMuted={speakerMuted}
          />
        ))}
      </div>

      {/* Bottom Messenger Controls */}
      <div className="px-4 py-5 border-t border-white/10 bg-[#10141E] flex items-center justify-center gap-4 sm:gap-6 shrink-0">
        <button
          type="button"
          onClick={handleToggleMute}
          aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'}
          className={`w-12 h-12 sm:w-14 sm:h-14 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
            isMuted ? 'bg-white text-[#0F172A]' : 'bg-white/15 hover:bg-white/25 text-white'
          }`}
        >
          {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
        </button>

        {isVideo && (
          <button
            type="button"
            onClick={handleToggleCamera}
            aria-label={cameraOff ? 'Turn camera on' : 'Turn camera off'}
            className={`w-12 h-12 sm:w-14 sm:h-14 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
              cameraOff ? 'bg-white text-[#0F172A]' : 'bg-white/15 hover:bg-white/25 text-white'
            }`}
          >
            {cameraOff ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
          </button>
        )}

        {isVideo && (
          <button
            type="button"
            onClick={handleSwitchCamera}
            aria-label="Switch camera"
            className="w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-white/15 hover:bg-white/25 text-white flex items-center justify-center transition-colors cursor-pointer"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
        )}

        <button
          type="button"
          onClick={() => setSpeakerMuted((prev) => !prev)}
          aria-label={speakerMuted ? 'Unmute speaker' : 'Mute speaker'}
          className={`w-12 h-12 sm:w-14 sm:h-14 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
            speakerMuted ? 'bg-white text-[#0F172A]' : 'bg-white/15 hover:bg-white/25 text-white'
          }`}
        >
          {speakerMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
        </button>

        <button
          type="button"
          onClick={handleHangUp}
          aria-label="End group call"
          className="w-14 h-14 rounded-full bg-[#EF4444] hover:bg-[#DC2626] text-white flex items-center justify-center shadow-lg shadow-red-600/30 active:scale-95 transition-transform cursor-pointer"
        >
          <PhoneOff className="w-6 h-6" />
        </button>
      </div>
    </div>
  );
}
