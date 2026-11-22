import React, {useEffect, useRef, useState} from 'react';
import {
  AlertCircle,
  Mic,
  MicOff,
  Phone,
  PhoneIncoming,
  PhoneOff,
  RefreshCw,
  UserPlus,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import type {CallSessionDoc, CallType, UserProfile} from '../types';
import {
  acceptIncomingCallSession,
  CallRingtoneController,
  createOutgoingCallSession,
  declineIncomingCallDoc,
  endCallInFirestore,
  formatCallDuration,
  requestCallMedia,
  switchCameraTrack,
  type ActiveCallHandles,
} from '../lib/callService';
import {formatFirestoreErrorMessage} from '../lib/firebase';
import {sendMessagePermanent} from '../lib/firestoreStore';
import {Avatar} from './MediaImage';

interface CallOverlayProps {
  currentUser: UserProfile;
  /** Non-null when current user initiates an outgoing call */
  outgoingTarget: {peer: UserProfile; type: CallType} | null;
  /** Non-null when Firestore detects a ringing incoming call for current user */
  incomingCall: CallSessionDoc | null;
  /** Friends/users list for the Messenger-style "Add Person" button */
  inviteCandidates: UserProfile[];
  onCloseCall: () => void;
}

type CallPhase =
  | 'incoming'
  | 'requesting_media'
  | 'calling'
  | 'connecting'
  | 'connected'
  | 'ended';

export const CallOverlay: React.FC<CallOverlayProps> = ({
  currentUser,
  outgoingTarget,
  incomingCall,
  inviteCandidates,
  onCloseCall,
}) => {
  const isOutgoing = Boolean(outgoingTarget);
  const callType: CallType = outgoingTarget?.type || incomingCall?.type || 'audio';

  const peerName = outgoingTarget
    ? outgoingTarget.peer.name
    : incomingCall?.callerName || 'Member';
  const peerAvatar = outgoingTarget
    ? outgoingTarget.peer.avatar_url
    : incomingCall?.callerAvatar || '';
  const peerUid = outgoingTarget
    ? outgoingTarget.peer.uid || ''
    : incomingCall?.callerId || '';

  const [phase, setPhase] = useState<CallPhase>(isOutgoing ? 'requesting_media' : 'incoming');
  const [statusNote, setStatusNote] = useState<string>(
    isOutgoing ? 'Requesting camera & microphone...' : `Incoming ${callType === 'video' ? 'Video' : 'Audio'} Call`,
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [elapsedSec, setElapsedSec] = useState<number>(0);

  const [muted, setMuted] = useState(false);
  const [speakerOn, setSpeakerOn] = useState(callType === 'video');
  const [cameraOff, setCameraOff] = useState(callType === 'audio');
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [switchingCamera, setSwitchingCamera] = useState(false);
  const [hasRemoteVideo, setHasRemoteVideo] = useState(false);

  const [showAddPerson, setShowAddPerson] = useState(false);
  const [invitedUids, setInvitedUids] = useState<Record<string, boolean>>({});

  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const handlesRef = useRef<ActiveCallHandles | null>(null);
  const ringtoneRef = useRef<CallRingtoneController | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

  const elapsedRef = useRef(0);
  const wasAcceptedRef = useRef(false);
  const closedRef = useRef(false);

  const stopAllMedia = () => {
    ringtoneRef.current?.stop();
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
    if (remoteStreamRef.current) {
      remoteStreamRef.current.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {
          // Ignore
        }
      });
      remoteStreamRef.current = null;
    }
    if (handlesRef.current) {
      handlesRef.current.cleanup();
      handlesRef.current = null;
    }
  };

  const attachLocalPreview = (stream: MediaStream) => {
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = stream;
      localVideoRef.current.muted = true;
      localVideoRef.current.play().catch(() => {});
    }
  };

  const attachRemoteMedia = (stream: MediaStream) => {
    remoteStreamRef.current = stream;
    const videoTracks = stream.getVideoTracks().filter((t) => t.readyState === 'live');
    setHasRemoteVideo(videoTracks.length > 0 && callType === 'video');

    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = stream;
      remoteAudioRef.current.volume = speakerOn ? 1.0 : 0.55;
      remoteAudioRef.current.play().catch(() => {});
    }
    if (remoteVideoRef.current && callType === 'video') {
      remoteVideoRef.current.srcObject = stream;
      remoteVideoRef.current.play().catch(() => {});
    }
  };

  const finishAndClose = (finalLabel: string, delayMs = 900) => {
    if (closedRef.current) return;
    closedRef.current = true;
    ringtoneRef.current?.stop();
    setPhase('ended');
    setStatusNote(finalLabel);
    stopAllMedia();
    window.setTimeout(() => {
      onCloseCall();
    }, delayMs);
  };

  // Timer when connected
  useEffect(() => {
    if (phase !== 'connected') return;
    const interval = window.setInterval(() => {
      elapsedRef.current += 1;
      setElapsedSec(elapsedRef.current);
    }, 1000);
    return () => window.clearInterval(interval);
  }, [phase]);

  // Speaker volume toggle
  useEffect(() => {
    if (remoteAudioRef.current) {
      remoteAudioRef.current.volume = speakerOn ? 1.0 : 0.45;
    }
  }, [speakerOn]);

  // Re-attach preview whenever phase or cameraOff changes
  useEffect(() => {
    if (localStreamRef.current && localVideoRef.current && callType === 'video' && !cameraOff) {
      localVideoRef.current.srcObject = localStreamRef.current;
      localVideoRef.current.muted = true;
      localVideoRef.current.play().catch(() => {});
    }
  }, [phase, cameraOff, callType]);

  // Start ringtone for incoming call
  useEffect(() => {
    ringtoneRef.current = new CallRingtoneController();
    if (!isOutgoing && incomingCall) {
      ringtoneRef.current.start('incoming');
    }
    return () => {
      stopAllMedia();
    };
  }, []);

  // Outgoing call auto-initialization
  useEffect(() => {
    if (!outgoingTarget) return;
    let cancelled = false;
    let noAnswerTimer: number | null = null;

    const startOutgoing = async () => {
      try {
        setPhase('requesting_media');
        setStatusNote(
          outgoingTarget.type === 'video'
            ? 'Requesting Camera & Microphone...'
            : 'Requesting Microphone...',
        );
        const stream = await requestCallMedia(outgoingTarget.type, 'user');
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        localStreamRef.current = stream;
        attachLocalPreview(stream);

        setPhase('calling');
        setStatusNote('Calling...');
        ringtoneRef.current?.start('outgoing');

        const handles = await createOutgoingCallSession(
          currentUser,
          outgoingTarget.peer,
          outgoingTarget.type,
          stream,
          {
            onRemoteStream: (remote) => {
              attachRemoteMedia(remote);
              ringtoneRef.current?.stop();
              wasAcceptedRef.current = true;
              setPhase('connected');
              setStatusNote('Connected');
            },
            onStatusChange: (status) => {
              if (closedRef.current) return;
              if (status === 'ringing') {
                setStatusNote('Ringing...');
              } else if (status === 'accepted') {
                ringtoneRef.current?.stop();
                wasAcceptedRef.current = true;
                if (noAnswerTimer) {
                  window.clearTimeout(noAnswerTimer);
                  noAnswerTimer = null;
                }
                setPhase('connected');
                setStatusNote('Connected');
              } else if (status === 'declined') {
                if (noAnswerTimer) {
                  window.clearTimeout(noAnswerTimer);
                  noAnswerTimer = null;
                }
                finishAndClose('Call declined', 1100);
              } else if (status === 'ended' || status === 'missed') {
                if (noAnswerTimer) {
                  window.clearTimeout(noAnswerTimer);
                  noAnswerTimer = null;
                }
                finishAndClose('Call ended', 900);
              }
            },
            onConnectionStateChange: (state) => {
              if (state === 'connected') {
                ringtoneRef.current?.stop();
                wasAcceptedRef.current = true;
                setPhase('connected');
                setStatusNote('Connected');
              } else if (state === 'failed' || state === 'disconnected') {
                if (!closedRef.current && wasAcceptedRef.current) {
                  setStatusNote('Reconnecting...');
                }
              }
            },
            onError: (msg) => {
              setErrorMessage(msg);
            },
          },
        );

        if (cancelled) {
          handles.cleanup();
          return;
        }
        handlesRef.current = handles;
        setStatusNote('Ringing...');

        // 45-second unanswered timeout -> Missed Call
        noAnswerTimer = window.setTimeout(async () => {
          if (!closedRef.current && !wasAcceptedRef.current && handlesRef.current && currentUser.uid) {
            await endCallInFirestore(handlesRef.current.callDoc, currentUser.uid, 0, false, true);
            finishAndClose('No answer — Missed call', 1200);
          }
        }, 45_000);
      } catch (err) {
        if (cancelled) return;
        ringtoneRef.current?.stop();
        setErrorMessage(formatFirestoreErrorMessage(err));
        setPhase('ended');
        setStatusNote('Could not start call');
      }
    };

    void startOutgoing();

    return () => {
      cancelled = true;
      if (noAnswerTimer) window.clearTimeout(noAnswerTimer);
    };
  }, [outgoingTarget]);

  const handleAcceptIncoming = async () => {
    if (!incomingCall || !currentUser.uid) return;
    ringtoneRef.current?.stop();
    setErrorMessage(null);
    setPhase('connecting');
    setStatusNote(
      incomingCall.type === 'video'
        ? 'Allowing Camera & Microphone...'
        : 'Allowing Microphone...',
    );

    try {
      const stream = await requestCallMedia(incomingCall.type, 'user');
      localStreamRef.current = stream;
      attachLocalPreview(stream);

      const handles = await acceptIncomingCallSession(incomingCall, stream, {
        onRemoteStream: (remote) => {
          attachRemoteMedia(remote);
          wasAcceptedRef.current = true;
          setPhase('connected');
          setStatusNote('Connected');
        },
        onStatusChange: (status) => {
          if (closedRef.current) return;
          if (status === 'ended' || status === 'missed' || status === 'declined') {
            finishAndClose('Call ended', 900);
          }
        },
        onConnectionStateChange: (state) => {
          if (state === 'connected') {
            wasAcceptedRef.current = true;
            setPhase('connected');
            setStatusNote('Connected');
          }
        },
        onError: (msg) => setErrorMessage(msg),
      });

      handlesRef.current = handles;
      wasAcceptedRef.current = true;
      setPhase('connected');
      setStatusNote('Connected');
    } catch (err) {
      setErrorMessage(formatFirestoreErrorMessage(err));
      setPhase('incoming');
      setStatusNote('Permission needed to answer call');
    }
  };

  const handleDeclineIncoming = async () => {
    if (!incomingCall || !currentUser.uid) {
      onCloseCall();
      return;
    }
    ringtoneRef.current?.stop();
    await declineIncomingCallDoc(incomingCall, currentUser.uid);
    finishAndClose('Call declined', 500);
  };

  const handleEndCall = async () => {
    ringtoneRef.current?.stop();
    const activeDoc = handlesRef.current?.callDoc || incomingCall;
    if (activeDoc && currentUser.uid) {
      await endCallInFirestore(
        activeDoc,
        currentUser.uid,
        elapsedRef.current,
        wasAcceptedRef.current,
        true,
      );
    }
    finishAndClose(
      wasAcceptedRef.current
        ? `Ended · ${formatCallDuration(Math.max(1, elapsedRef.current))}`
        : 'Call cancelled',
      600,
    );
  };

  const handleToggleMute = () => {
    const next = !muted;
    setMuted(next);
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach((t) => {
        t.enabled = !next;
      });
    }
  };

  const handleToggleCamera = () => {
    if (callType !== 'video') return;
    const next = !cameraOff;
    setCameraOff(next);
    if (localStreamRef.current) {
      localStreamRef.current.getVideoTracks().forEach((t) => {
        t.enabled = !next;
      });
    }
  };

  const handleSwitchCamera = async () => {
    if (callType !== 'video' || !localStreamRef.current || switchingCamera) return;
    setSwitchingCamera(true);
    const nextMode: 'user' | 'environment' = facingMode === 'user' ? 'environment' : 'user';
    try {
      await switchCameraTrack(handlesRef.current?.pc || null, localStreamRef.current, nextMode);
      setFacingMode(nextMode);
      attachLocalPreview(localStreamRef.current);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Unable to switch camera on this device.');
    } finally {
      setSwitchingCamera(false);
    }
  };

  const handleInvitePerson = async (person: UserProfile) => {
    if (!currentUser.uid || !person.uid) return;
    setInvitedUids((prev) => ({...prev, [person.uid!]: true}));
    await sendMessagePermanent(
      currentUser.uid,
      person.uid,
      `📞 ${currentUser.name} invited you to join their live ${callType === 'video' ? 'Video' : 'Audio'} Call with ${peerName}.`,
    ).catch(() => {});
  };

  const availableToInvite = inviteCandidates.filter(
    (u) => u.uid && u.uid !== currentUser.uid && u.uid !== peerUid,
  );

  return (
    <div className="fixed inset-0 z-[90] flex flex-col bg-slate-950 text-white select-none overflow-hidden">
      {/* Hidden audio element ensures remote voice plays reliably on mobile & desktop */}
      <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />

      {/* Background layer: Full-screen remote video OR rich Messenger blur gradient */}
      {callType === 'video' && phase !== 'incoming' ? (
        <div className="absolute inset-0 bg-slate-950">
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className={`h-full w-full object-cover transition-opacity duration-300 ${
              hasRemoteVideo ? 'opacity-100' : 'opacity-0'
            }`}
          />
          {!hasRemoteVideo && (
            <div className="absolute inset-0 bg-gradient-to-b from-slate-900 via-[#111936] to-slate-950" />
          )}
          <div className="absolute inset-0 bg-gradient-to-b from-black/55 via-transparent to-black/75 pointer-events-none" />
        </div>
      ) : (
        <div className="absolute inset-0 bg-gradient-to-b from-[#0f172a] via-[#172554] to-[#020617]">
          <div className="absolute inset-0 opacity-30 bg-[radial-gradient(circle_at_50%_30%,rgba(59,130,246,0.55),transparent_60%)]" />
        </div>
      )}

      {/* Top Messenger status bar */}
      <div className="relative z-10 flex items-center justify-between px-4 sm:px-6 pt-5 pb-3">
        <div className="flex items-center gap-2.5">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 backdrop-blur-md px-3 py-1 text-xs font-semibold text-white/90 border border-white/10">
            {callType === 'video' ? (
              <Video className="w-3.5 h-3.5 text-blue-400" />
            ) : (
              <Phone className="w-3.5 h-3.5 text-emerald-400" />
            )}
            {callType === 'video' ? 'Messenger Video Call' : 'Messenger Audio Call'}
          </span>
          {phase === 'connected' && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/20 border border-emerald-400/30 px-3 py-1 text-xs font-mono font-bold text-emerald-300">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              {formatCallDuration(elapsedSec)}
            </span>
          )}
        </div>

        {callType === 'video' && phase !== 'incoming' && phase !== 'ended' && (
          <button
            type="button"
            onClick={handleSwitchCamera}
            disabled={switchingCamera || cameraOff}
            title="Switch Camera"
            className="h-10 w-10 rounded-full bg-white/15 backdrop-blur-md hover:bg-white/25 disabled:opacity-40 flex items-center justify-center transition-colors"
          >
            <RefreshCw className={`w-5 h-5 ${switchingCamera ? 'animate-spin' : ''}`} />
          </button>
        )}
      </div>

      {/* Error banner if camera/mic blocked or Firestore error */}
      {errorMessage && (
        <div className="relative z-20 mx-4 sm:mx-auto max-w-md rounded-2xl bg-red-500/20 border border-red-400/40 backdrop-blur-md px-4 py-3 text-sm text-red-100 flex items-start gap-2.5">
          <AlertCircle className="w-5 h-5 text-red-300 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-medium leading-snug">{errorMessage}</p>
            {phase === 'ended' && (
              <button
                type="button"
                onClick={onCloseCall}
                className="mt-2 inline-flex items-center px-3 py-1 rounded-lg bg-white/15 hover:bg-white/25 text-xs font-semibold text-white"
              >
                Close Call Screen
              </button>
            )}
          </div>
        </div>
      )}

      {/* Center Caller / Peer Profile Hero (hidden once full-screen remote video is live) */}
      <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-6 text-center">
        {(!hasRemoteVideo || callType === 'audio' || phase === 'incoming') && (
          <>
            <div className="relative mb-6">
              {(phase === 'incoming' || phase === 'calling' || phase === 'connecting') && (
                <>
                  <span className="absolute -inset-4 rounded-full bg-blue-500/25 animate-ping" />
                  <span className="absolute -inset-2 rounded-full bg-blue-400/20 animate-pulse" />
                </>
              )}
              <div className="relative rounded-full p-1.5 bg-gradient-to-tr from-blue-500 via-indigo-400 to-cyan-400 shadow-2xl">
                <Avatar
                  src={peerAvatar}
                  name={peerName}
                  size="xl"
                  className="w-32 h-32 sm:w-36 sm:h-36 ring-4 ring-slate-950"
                />
              </div>
            </div>

            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
              {peerName}
            </h2>
            <p className="mt-2 text-base font-medium text-blue-200/90 flex items-center justify-center gap-2">
              {phase === 'incoming' && (
                <PhoneIncoming className="w-4 h-4 text-emerald-400 animate-bounce" />
              )}
              {phase === 'connected' ? formatCallDuration(elapsedSec) : statusNote}
            </p>
          </>
        )}

        {/* Small floating local video preview bottom-right (PiP) */}
        {callType === 'video' && phase !== 'incoming' && phase !== 'ended' && (
          <div className="fixed right-4 bottom-28 sm:right-6 sm:bottom-32 z-20 w-28 h-40 sm:w-36 sm:h-52 rounded-2xl overflow-hidden bg-slate-900 border-2 border-white/25 shadow-2xl">
            {!cameraOff ? (
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className={`h-full w-full object-cover ${facingMode === 'user' ? 'scale-x-[-1]' : ''}`}
              />
            ) : (
              <div className="h-full w-full flex flex-col items-center justify-center bg-slate-900 text-slate-400 gap-2 p-2">
                <VideoOff className="w-6 h-6" />
                <span className="text-[11px] font-medium">Camera Off</span>
              </div>
            )}
            <span className="absolute bottom-1.5 left-2 text-[10px] font-semibold bg-black/50 px-1.5 py-0.5 rounded text-white/90">
              You
            </span>
          </div>
        )}
      </div>

      {/* Bottom Controls Bar */}
      <div className="relative z-20 pb-8 pt-4 px-4 sm:px-6">
        {phase === 'incoming' ? (
          /* Incoming Call: Green Accept + Red Decline */
          <div className="max-w-xs mx-auto flex items-center justify-between gap-8">
            <div className="flex flex-col items-center gap-2">
              <button
                type="button"
                onClick={handleDeclineIncoming}
                className="h-16 w-16 rounded-full bg-red-600 hover:bg-red-500 active:scale-95 text-white flex items-center justify-center shadow-xl shadow-red-600/35 transition-all"
                aria-label="Decline call"
              >
                <PhoneOff className="w-7 h-7" />
              </button>
              <span className="text-xs font-semibold text-white/85">Decline</span>
            </div>

            <div className="flex flex-col items-center gap-2">
              <button
                type="button"
                onClick={handleAcceptIncoming}
                className="h-16 w-16 rounded-full bg-emerald-500 hover:bg-emerald-400 active:scale-95 text-white flex items-center justify-center shadow-xl shadow-emerald-500/40 animate-pulse transition-all"
                aria-label="Accept call"
              >
                {callType === 'video' ? (
                  <Video className="w-7 h-7" />
                ) : (
                  <Phone className="w-7 h-7" />
                )}
              </button>
              <span className="text-xs font-semibold text-white/85">Accept</span>
            </div>
          </div>
        ) : (
          /* Active / Outgoing Call Controls */
          <div className="max-w-lg mx-auto rounded-3xl bg-white/10 backdrop-blur-xl border border-white/15 px-3 sm:px-5 py-3.5 shadow-2xl">
            <div className="flex items-center justify-around gap-2">
              {/* Speaker */}
              <button
                type="button"
                onClick={() => setSpeakerOn((v) => !v)}
                className="flex flex-col items-center gap-1.5 group"
              >
                <span
                  className={`h-12 w-12 rounded-full flex items-center justify-center transition-all ${
                    speakerOn
                      ? 'bg-white text-slate-950'
                      : 'bg-white/15 text-white hover:bg-white/25'
                  }`}
                >
                  {speakerOn ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
                </span>
                <span className="text-[11px] font-medium text-white/80">Speaker</span>
              </button>

              {/* Video-only controls: Camera Off + Switch Camera */}
              {callType === 'video' && (
                <>
                  <button
                    type="button"
                    onClick={handleToggleCamera}
                    className="flex flex-col items-center gap-1.5"
                  >
                    <span
                      className={`h-12 w-12 rounded-full flex items-center justify-center transition-all ${
                        cameraOff
                          ? 'bg-white text-slate-950'
                          : 'bg-white/15 text-white hover:bg-white/25'
                      }`}
                    >
                      {cameraOff ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
                    </span>
                    <span className="text-[11px] font-medium text-white/80">
                      {cameraOff ? 'Cam Off' : 'Camera'}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={handleSwitchCamera}
                    disabled={switchingCamera || cameraOff}
                    className="flex flex-col items-center gap-1.5 disabled:opacity-40"
                  >
                    <span className="h-12 w-12 rounded-full bg-white/15 hover:bg-white/25 text-white flex items-center justify-center transition-all">
                      <RefreshCw className={`w-5 h-5 ${switchingCamera ? 'animate-spin' : ''}`} />
                    </span>
                    <span className="text-[11px] font-medium text-white/80">Flip</span>
                  </button>
                </>
              )}

              {/* Mute */}
              <button
                type="button"
                onClick={handleToggleMute}
                className="flex flex-col items-center gap-1.5"
              >
                <span
                  className={`h-12 w-12 rounded-full flex items-center justify-center transition-all ${
                    muted ? 'bg-white text-slate-950' : 'bg-white/15 text-white hover:bg-white/25'
                  }`}
                >
                  {muted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                </span>
                <span className="text-[11px] font-medium text-white/80">
                  {muted ? 'Unmute' : 'Mute'}
                </span>
              </button>

              {/* Add Person (Audio & Video) */}
              <button
                type="button"
                onClick={() => setShowAddPerson(true)}
                className="flex flex-col items-center gap-1.5"
              >
                <span className="h-12 w-12 rounded-full bg-white/15 hover:bg-white/25 text-white flex items-center justify-center transition-all">
                  <UserPlus className="w-5 h-5" />
                </span>
                <span className="text-[11px] font-medium text-white/80">Add</span>
              </button>

              {/* End Call (Red) */}
              <button
                type="button"
                onClick={handleEndCall}
                className="flex flex-col items-center gap-1.5"
                aria-label="End call"
              >
                <span className="h-12 w-12 rounded-full bg-red-600 hover:bg-red-500 active:scale-95 text-white flex items-center justify-center shadow-lg shadow-red-600/40 transition-all">
                  <PhoneOff className="w-5 h-5" />
                </span>
                <span className="text-[11px] font-semibold text-red-300">End</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Messenger-style "Add Person" Invite Drawer */}
      {showAddPerson && (
        <div
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-4"
          onClick={() => setShowAddPerson(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-slate-900 border border-white/15 shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3.5 border-b border-white/10">
              <div>
                <h3 className="font-bold text-white text-base">Add person to call</h3>
                <p className="text-xs text-slate-400">Send a live call invite to a friend</p>
              </div>
              <button
                type="button"
                onClick={() => setShowAddPerson(false)}
                className="h-8 w-8 rounded-full hover:bg-white/10 flex items-center justify-center text-slate-300"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="max-h-72 overflow-y-auto p-3 space-y-2">
              {availableToInvite.length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-400">
                  No other friends available to invite right now.
                </p>
              ) : (
                availableToInvite.map((person) => {
                  const invited = Boolean(person.uid && invitedUids[person.uid]);
                  return (
                    <div
                      key={person.uid || person.id}
                      className="flex items-center justify-between gap-3 rounded-xl bg-white/5 px-3 py-2.5"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <Avatar src={person.avatar_url} name={person.name} size="sm" />
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-white truncate">{person.name}</p>
                          <p className="text-xs text-slate-400 truncate">
                            {person.work || person.location || 'Verve member'}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={invited}
                        onClick={() => handleInvitePerson(person)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                          invited
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : 'bg-blue-600 hover:bg-blue-500 text-white'
                        }`}
                      >
                        {invited ? 'Invited' : 'Invite'}
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
