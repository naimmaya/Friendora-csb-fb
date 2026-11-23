import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import type {CallSessionDoc, CallType, UserProfile} from '../types';
import {db, handleFirestoreError, OperationType} from './firebase';
import {createNotificationPermanent, sendMessagePermanent} from './firestoreStore';

const RTC_CONFIG: RTCConfiguration = {
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

function makeId(prefix: string): string {
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 14)
      : `${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

function clamp(value: string | null | undefined, max: number): string {
  return String(value || '').trim().slice(0, max);
}

export function formatCallDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (hrs > 0) return `${hrs}:${pad(mins)}:${pad(secs)}`;
  return `${mins}:${pad(secs)}`;
}

export function formatCallLogMessage(
  type: CallType,
  status: 'completed' | 'missed' | 'declined',
  durationSec: number,
): string {
  const label = type === 'video' ? 'Video Call' : 'Audio Call';
  if (status === 'completed') {
    const dur = formatCallDuration(Math.max(1, durationSec));
    return `${label} - ${dur} min`;
  }
  if (status === 'declined') {
    return `Declined ${label}`;
  }
  return `Missed ${label}`;
}

/**
 * Web Audio API Messenger-style ringtone + mobile vibration controller.
 * Works offline without external MP3 dependencies and cleans up safely.
 */
export class CallRingtoneController {
  private ctx: AudioContext | null = null;
  private timer: number | null = null;
  private mode: 'incoming' | 'outgoing' | null = null;

  start(mode: 'incoming' | 'outgoing') {
    this.stop();
    this.mode = mode;

    const playTone = () => {
      try {
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as {webkitAudioContext?: typeof AudioContext}).webkitAudioContext;
        if (!AudioCtx) return;
        if (!this.ctx) {
          this.ctx = new AudioCtx();
        }
        if (this.ctx.state === 'suspended') {
          this.ctx.resume().catch(() => {});
        }

        const now = this.ctx.currentTime;
        if (mode === 'incoming') {
          // Bright Messenger-like 3-note chime
          const notes = [587.33, 739.99, 880.0];
          notes.forEach((freq, idx) => {
            if (!this.ctx) return;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, now + idx * 0.14);
            gain.gain.setValueAtTime(0.001, now + idx * 0.14);
            gain.gain.exponentialRampToValueAtTime(0.14, now + idx * 0.14 + 0.03);
            gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.14 + 0.28);
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start(now + idx * 0.14);
            osc.stop(now + idx * 0.14 + 0.3);
          });
          if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
            navigator.vibrate([320, 160, 320]);
          }
        } else {
          // Soft outgoing ringback tone
          const osc1 = this.ctx.createOscillator();
          const osc2 = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc1.type = 'sine';
          osc2.type = 'sine';
          osc1.frequency.setValueAtTime(440, now);
          osc2.frequency.setValueAtTime(480, now);
          gain.gain.setValueAtTime(0.001, now);
          gain.gain.exponentialRampToValueAtTime(0.055, now + 0.05);
          gain.gain.setValueAtTime(0.055, now + 0.85);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 1.0);
          osc1.connect(gain);
          osc2.connect(gain);
          gain.connect(this.ctx.destination);
          osc1.start(now);
          osc2.start(now);
          osc1.stop(now + 1.05);
          osc2.stop(now + 1.05);
        }
      } catch {
        // Browser may defer audio until user gesture
      }
    };

    playTone();
    this.timer = window.setInterval(playTone, mode === 'incoming' ? 2100 : 2800);
  }

  stop() {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try {
        navigator.vibrate(0);
      } catch {
        // Ignore
      }
    }
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }
    this.mode = null;
  }

  get activeMode() {
    return this.mode;
  }
}

/**
 * Request Camera & Microphone permissions cleanly with helpful mobile/desktop error guidance.
 * Audio call -> { audio: true, video: false }
 * Video call -> { audio: true, video: true }
 * Ensures Mic ON and (for video calls) Video ON by default.
 */
export async function requestCallMedia(
  type: CallType,
  facingMode: 'user' | 'environment' = 'user',
): Promise<MediaStream> {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error(
      'Your browser does not support camera/microphone calling here. Please open the app over HTTPS in Chrome or Safari.',
    );
  }

  const audioConstraints: MediaTrackConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };

  const ensureTracksEnabled = (stream: MediaStream) => {
    stream.getTracks().forEach((track) => {
      track.enabled = true;
    });
    return stream;
  };

  try {
    if (type === 'audio') {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: audioConstraints,
          video: false,
        });
        return ensureTracksEnabled(stream);
      } catch (audioErr) {
        const errName = audioErr instanceof Error ? audioErr.name : '';
        if (errName === 'OverconstrainedError' || errName === 'ConstraintNotSatisfiedError') {
          const fallback = await navigator.mediaDevices.getUserMedia({audio: true, video: false});
          return ensureTracksEnabled(fallback);
        }
        throw audioErr;
      }
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
        video: {
          facingMode: {ideal: facingMode},
          width: {ideal: 1280},
          height: {ideal: 720},
        },
      });
      return ensureTracksEnabled(stream);
    } catch (videoErr) {
      const errName = videoErr instanceof Error ? videoErr.name : '';
      if (errName === 'OverconstrainedError' || errName === 'ConstraintNotSatisfiedError') {
        const fallback = await navigator.mediaDevices.getUserMedia({audio: true, video: true});
        return ensureTracksEnabled(fallback);
      }
      throw videoErr;
    }
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
      throw new Error(
        type === 'video'
          ? 'Camera and Microphone permission was blocked. Please allow Camera & Mic access in your browser settings and try again.'
          : 'Microphone permission was blocked. Please allow Microphone access in your browser settings and try again.',
      );
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      // Fallback: if video camera missing, try audio-only so call still connects
      if (type === 'video') {
        try {
          const audioOnly = await navigator.mediaDevices.getUserMedia({audio: true, video: false});
          return ensureTracksEnabled(audioOnly);
        } catch {
          throw new Error('No microphone or camera was detected on this device.');
        }
      }
      throw new Error('No microphone was detected on this device.');
    }
    if (name === 'NotReadableError' || name === 'TrackStartError') {
      throw new Error('Camera or microphone is already in use by another app.');
    }
    throw new Error(err instanceof Error ? err.message : 'Could not access microphone/camera.');
  }
}

export async function switchCameraTrack(
  pc: RTCPeerConnection | null,
  currentStream: MediaStream,
  nextFacingMode: 'user' | 'environment',
): Promise<MediaStream> {
  const newVideoStream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: {ideal: nextFacingMode},
      width: {ideal: 1280},
      height: {ideal: 720},
    },
    audio: false,
  });

  const newTrack = newVideoStream.getVideoTracks()[0];
  if (!newTrack) {
    throw new Error('Unable to switch camera on this device.');
  }
  newTrack.enabled = true;

  const oldVideoTracks = currentStream.getVideoTracks();
  if (pc) {
    const sender = pc.getSenders().find((s) => s.track && s.track.kind === 'video');
    if (sender) {
      await sender.replaceTrack(newTrack);
    } else {
      pc.addTrack(newTrack, currentStream);
    }
  }

  oldVideoTracks.forEach((t) => {
    currentStream.removeTrack(t);
    t.stop();
  });
  currentStream.addTrack(newTrack);
  return currentStream;
}

export interface ActiveCallHandles {
  callDoc: CallSessionDoc;
  pc: RTCPeerConnection;
  cleanup: () => void;
}

interface CallLifecycleCallbacks {
  onRemoteStream: (stream: MediaStream) => void;
  onStatusChange: (status: CallSessionDoc['status']) => void;
  onConnectionStateChange?: (state: RTCPeerConnectionState) => void;
  onError?: (message: string) => void;
}

function buildIceCandidateInit(data: Record<string, unknown>): RTCIceCandidateInit | null {
  const candidate = String(data.candidate || '').trim();
  if (!candidate) return null;
  const sdpMid = typeof data.sdpMid === 'string' && data.sdpMid.length > 0 ? data.sdpMid : undefined;
  const sdpMLineIndex = typeof data.sdpMLineIndex === 'number' ? data.sdpMLineIndex : 0;
  return {
    candidate,
    sdpMLineIndex,
    ...(sdpMid !== undefined ? {sdpMid} : {}),
  };
}

async function addIceCandidateSafe(
  pc: RTCPeerConnection,
  candidateInit: RTCIceCandidateInit | null,
  pendingQueue: RTCIceCandidateInit[],
) {
  if (!candidateInit || !candidateInit.candidate) return;
  if (pc.signalingState === 'closed') return;
  if (!pc.remoteDescription || !pc.remoteDescription.type) {
    pendingQueue.push(candidateInit);
    return;
  }
  try {
    await pc.addIceCandidate(new RTCIceCandidate(candidateInit));
  } catch {
    // Ignore stale/duplicate ICE candidates
  }
}

async function flushPendingCandidates(
  pc: RTCPeerConnection,
  pendingQueue: RTCIceCandidateInit[],
) {
  if (pc.signalingState === 'closed') {
    pendingQueue.length = 0;
    return;
  }
  while (pendingQueue.length > 0) {
    const item = pendingQueue.shift();
    if (!item || !item.candidate) continue;
    try {
      await pc.addIceCandidate(new RTCIceCandidate(item));
    } catch {
      // Ignore individual ICE failure
    }
  }
}

function wireRemoteTrackHandling(
  pc: RTCPeerConnection,
  remoteStream: MediaStream,
  callbacks: CallLifecycleCallbacks,
) {
  pc.ontrack = (event) => {
    const incomingTracks: MediaStreamTrack[] = [];
    if (event.streams && event.streams[0]) {
      event.streams[0].getTracks().forEach((t) => incomingTracks.push(t));
    }
    if (event.track && !incomingTracks.some((t) => t.id === event.track.id)) {
      incomingTracks.push(event.track);
    }

    incomingTracks.forEach((track) => {
      if (!remoteStream.getTracks().some((existing) => existing.id === track.id)) {
        remoteStream.addTrack(track);
      }
      track.onunmute = () => {
        callbacks.onRemoteStream(remoteStream);
      };
      track.onended = () => {
        callbacks.onRemoteStream(remoteStream);
      };
    });

    callbacks.onRemoteStream(remoteStream);
  };
}

function wireConnectionStateHandling(
  pc: RTCPeerConnection,
  callbacks: CallLifecycleCallbacks,
  isDisposed: () => boolean,
) {
  pc.onconnectionstatechange = () => {
    if (isDisposed()) return;
    callbacks.onConnectionStateChange?.(pc.connectionState);
  };

  pc.oniceconnectionstatechange = () => {
    if (isDisposed()) return;
    const ice = pc.iceConnectionState;
    if (ice === 'connected' || ice === 'completed') {
      callbacks.onConnectionStateChange?.('connected');
    } else if (ice === 'failed') {
      callbacks.onConnectionStateChange?.('failed');
      try {
        pc.restartIce?.();
      } catch {
        // Ignore if unsupported
      }
    } else if (ice === 'disconnected') {
      callbacks.onConnectionStateChange?.('disconnected');
    }
  };
}

/**
 * Caller creates a WebRTC offer, writes `calls/{callId}` to Firestore,
 * trickles ICE candidates into `calls/{callId}/candidates`, and listens for receiver's
 * answer + receiver's ICE candidates in the exact same `calls/{callId}` room.
 */
export async function createOutgoingCallSession(
  caller: UserProfile,
  receiver: UserProfile,
  type: CallType,
  localStream: MediaStream,
  callbacks: CallLifecycleCallbacks,
): Promise<ActiveCallHandles> {
  if (!caller.uid || !receiver.uid) {
    throw new Error('Both caller and receiver must have verified accounts.');
  }

  const callId = makeId('call');
  const participantUids: [string, string] = [caller.uid, receiver.uid];
  const pc = new RTCPeerConnection(RTC_CONFIG);
  const remoteStream = new MediaStream();
  const pendingRemoteIce: RTCIceCandidateInit[] = [];
  const seenRemoteIceIds = new Set<string>();
  const queuedLocalCandidates: RTCIceCandidate[] = [];
  let callDocCreated = false;
  let answerApplied = false;
  let disposed = false;

  // Add all local audio/video tracks to RTCPeerConnection
  localStream.getTracks().forEach((track) => {
    pc.addTrack(track, localStream);
  });

  wireRemoteTrackHandling(pc, remoteStream, callbacks);
  wireConnectionStateHandling(pc, callbacks, () => disposed);

  const writeLocalIce = async (cand: RTCIceCandidate) => {
    if (disposed || !cand.candidate) return;
    const candId = makeId('ice');
    try {
      await setDoc(doc(db, 'calls', callId, 'candidates', candId), {
        senderUid: caller.uid!,
        participantUids,
        candidate: clamp(cand.candidate, 4096),
        sdpMid: clamp(cand.sdpMid || '', 64),
        sdpMLineIndex: typeof cand.sdpMLineIndex === 'number' ? cand.sdpMLineIndex : 0,
        createdAt: serverTimestamp(),
      });
    } catch {
      // Ignore ICE write if call already ended
    }
  };

  pc.onicecandidate = (event) => {
    if (!event.candidate || !event.candidate.candidate) return;
    if (!callDocCreated) {
      queuedLocalCandidates.push(event.candidate);
      return;
    }
    void writeLocalIce(event.candidate);
  };

  const offer = await pc.createOffer({
    offerToReceiveAudio: true,
    offerToReceiveVideo: type === 'video',
  });
  await pc.setLocalDescription(offer);

  const callDoc: CallSessionDoc = {
    id: callId,
    callerId: caller.uid,
    callerName: clamp(caller.name, 60) || 'Member',
    callerAvatar: clamp(caller.avatar_url, 450000),
    receiverId: receiver.uid,
    receiverName: clamp(receiver.name, 60) || 'Member',
    receiverAvatar: clamp(receiver.avatar_url, 450000),
    participantUids,
    type,
    status: 'ringing',
    offerSdp: offer.sdp || '',
    offerType: 'offer',
    answerSdp: '',
    answerType: '',
    durationSec: 0,
    timestampIso: new Date().toISOString(),
  };

  try {
    await setDoc(doc(db, 'calls', callId), {
      id: callDoc.id,
      callerId: callDoc.callerId,
      callerName: callDoc.callerName,
      callerAvatar: callDoc.callerAvatar,
      receiverId: callDoc.receiverId,
      receiverName: callDoc.receiverName,
      receiverAvatar: callDoc.receiverAvatar,
      participantUids: callDoc.participantUids,
      type: callDoc.type,
      status: 'ringing',
      offerSdp: callDoc.offerSdp,
      offerType: 'offer',
      answerSdp: '',
      answerType: '',
      durationSec: 0,
      timestamp: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    callDocCreated = true;
  } catch (error) {
    pc.close();
    handleFirestoreError(error, OperationType.CREATE, `calls/${callId}`);
  }

  // Flush any ICE candidates collected while calls/{callId} was being created
  for (const cand of queuedLocalCandidates) {
    void writeLocalIce(cand);
  }
  queuedLocalCandidates.length = 0;

  // Notify receiver
  createNotificationPermanent({
    recipientUid: receiver.uid,
    actor: caller,
    type: 'call',
    message: `${caller.name} started a ${type} call with you.`,
  }).catch(() => {});

  // Listen for receiver's answer SDP & call status changes on calls/{callId}
  const unsubCall = onSnapshot(
    doc(db, 'calls', callId),
    async (snap) => {
      if (!snap.exists() || disposed) return;
      const data = snap.data();
      const status = data.status as CallSessionDoc['status'];
      callDoc.status = status;

      if (
        !answerApplied &&
        typeof data.answerSdp === 'string' &&
        data.answerSdp.length > 0 &&
        data.answerType === 'answer'
      ) {
        answerApplied = true;
        try {
          if (pc.signalingState !== 'closed') {
            await pc.setRemoteDescription(
              new RTCSessionDescription({type: 'answer', sdp: data.answerSdp}),
            );
            await flushPendingCandidates(pc, pendingRemoteIce);
          }
        } catch (err) {
          callbacks.onError?.(
            err instanceof Error ? err.message : 'Failed to connect media stream.',
          );
        }
      }

      callbacks.onStatusChange(status);
    },
    (error) => {
      callbacks.onError?.(error.message);
    },
  );

  // Listen for receiver's ICE candidates in calls/{callId}/candidates
  const unsubCandidates = onSnapshot(
    query(
      collection(db, 'calls', callId, 'candidates'),
      where('participantUids', 'array-contains', caller.uid),
    ),
    (snap) => {
      if (disposed) return;
      snap.docChanges().forEach((change) => {
        if (change.type !== 'added' || seenRemoteIceIds.has(change.doc.id)) return;
        const d = change.doc.data();
        if (d.senderUid === caller.uid) return; // Ignore own candidates
        seenRemoteIceIds.add(change.doc.id);
        void addIceCandidateSafe(pc, buildIceCandidateInit(d), pendingRemoteIce);
      });
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, `calls/${callId}/candidates`);
      } catch {
        // Logged
      }
    },
  );

  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    unsubCall();
    unsubCandidates();
    try {
      pc.ontrack = null;
      pc.onicecandidate = null;
      pc.onconnectionstatechange = null;
      pc.oniceconnectionstatechange = null;
      pc.close();
    } catch {
      // Ignore
    }
  };

  return {callDoc, pc, cleanup};
}

/**
 * Receiver accepts an incoming ringing call in the exact same `calls/{callId}` room:
 * sets remote offer, subscribes to caller's ICE candidates in `calls/{callId}/candidates`,
 * creates WebRTC answer SDP, writes `status: "accepted"` + `answerSdp` to `calls/{callId}`,
 * and trickles local ICE candidates to `calls/{callId}/candidates`.
 */
export async function acceptIncomingCallSession(
  callDoc: CallSessionDoc,
  localStream: MediaStream,
  callbacks: CallLifecycleCallbacks,
): Promise<ActiveCallHandles> {
  // Verify latest call doc in Firestore so we have exact offerSdp and live ringing state
  let offerSdp = callDoc.offerSdp;
  try {
    const latestSnap = await getDoc(doc(db, 'calls', callDoc.id));
    if (!latestSnap.exists()) {
      throw new Error('This call is no longer available.');
    }
    const latestData = latestSnap.data();
    const latestStatus = String(latestData.status || '');
    if (latestStatus === 'ended' || latestStatus === 'missed' || latestStatus === 'declined') {
      throw new Error('The caller already ended this call.');
    }
    if (typeof latestData.offerSdp === 'string' && latestData.offerSdp.length > 0) {
      offerSdp = latestData.offerSdp;
    }
  } catch (err) {
    if (err instanceof Error && (err.message.includes('already ended') || err.message.includes('no longer available'))) {
      throw err;
    }
    // Continue with cached offerSdp if transient read error
  }

  if (!offerSdp) {
    throw new Error('Call offer data is missing. Please try calling again.');
  }

  const pc = new RTCPeerConnection(RTC_CONFIG);
  const remoteStream = new MediaStream();
  const pendingRemoteIce: RTCIceCandidateInit[] = [];
  const seenRemoteIceIds = new Set<string>();
  let disposed = false;

  // Add all local audio/video tracks to RTCPeerConnection
  localStream.getTracks().forEach((track) => {
    pc.addTrack(track, localStream);
  });

  wireRemoteTrackHandling(pc, remoteStream, callbacks);
  wireConnectionStateHandling(pc, callbacks, () => disposed);

  // Send receiver's ICE candidates to calls/{callId}/candidates
  pc.onicecandidate = (event) => {
    if (disposed || !event.candidate || !event.candidate.candidate) return;
    const candId = makeId('ice');
    void setDoc(doc(db, 'calls', callDoc.id, 'candidates', candId), {
      senderUid: callDoc.receiverId,
      participantUids: callDoc.participantUids,
      candidate: clamp(event.candidate.candidate, 4096),
      sdpMid: clamp(event.candidate.sdpMid || '', 64),
      sdpMLineIndex:
        typeof event.candidate.sdpMLineIndex === 'number' ? event.candidate.sdpMLineIndex : 0,
      createdAt: serverTimestamp(),
    }).catch(() => {});
  };

  // Apply caller's SDP offer first
  await pc.setRemoteDescription(
    new RTCSessionDescription({type: 'offer', sdp: offerSdp}),
  );

  // Subscribe to caller's ICE candidates in calls/{callId}/candidates right away
  const unsubCandidates = onSnapshot(
    query(
      collection(db, 'calls', callDoc.id, 'candidates'),
      where('participantUids', 'array-contains', callDoc.receiverId),
    ),
    (snap) => {
      if (disposed) return;
      snap.docChanges().forEach((change) => {
        if (change.type !== 'added' || seenRemoteIceIds.has(change.doc.id)) return;
        const d = change.doc.data();
        if (d.senderUid === callDoc.receiverId) return; // Ignore own candidates
        seenRemoteIceIds.add(change.doc.id);
        void addIceCandidateSafe(pc, buildIceCandidateInit(d), pendingRemoteIce);
      });
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, `calls/${callDoc.id}/candidates`);
      } catch {
        // Logged
      }
    },
  );

  // Create WebRTC answer SDP and set local description (starts local ICE gathering)
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  // Save answer + status = "accepted" in Firestore calls/{callId}
  try {
    await updateDoc(doc(db, 'calls', callDoc.id), {
      status: 'accepted',
      answerSdp: answer.sdp || '',
      answerType: 'answer',
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    disposed = true;
    unsubCandidates();
    pc.close();
    handleFirestoreError(error, OperationType.UPDATE, `calls/${callDoc.id}`);
  }

  // Listen to calls/{callId} so if caller ends the call, receiver closes cleanly
  const unsubCall = onSnapshot(doc(db, 'calls', callDoc.id), (snap) => {
    if (!snap.exists() || disposed) return;
    const status = snap.data().status as CallSessionDoc['status'];
    callbacks.onStatusChange(status);
  });

  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    unsubCandidates();
    unsubCall();
    try {
      pc.ontrack = null;
      pc.onicecandidate = null;
      pc.onconnectionstatechange = null;
      pc.oniceconnectionstatechange = null;
      pc.close();
    } catch {
      // Ignore
    }
  };

  return {callDoc: {...callDoc, status: 'accepted'}, pc, cleanup};
}

/**
 * Receiver declines a ringing call and records a Messenger-style call history message in chat.
 */
export async function declineIncomingCallDoc(
  callDoc: CallSessionDoc,
  myUid: string,
): Promise<void> {
  try {
    await updateDoc(doc(db, 'calls', callDoc.id), {
      status: 'declined',
      updatedAt: serverTimestamp(),
    });
  } catch {
    // Call might already have been cancelled by caller
  }

  const peerUid = callDoc.callerId === myUid ? callDoc.receiverId : callDoc.callerId;
  await sendMessagePermanent(
    myUid,
    peerUid,
    formatCallLogMessage(callDoc.type, 'declined', 0),
    {
      callType: callDoc.type,
      callStatus: 'declined',
      callDurationSec: 0,
    },
  ).catch(() => {});
}

/**
 * End an active or ringing call in Firestore (`status = "ended"`, or `"missed"` on timeout)
 * and write a Messenger-style call log message in chat.
 */
export async function endCallInFirestore(
  callDoc: CallSessionDoc,
  myUid: string,
  durationSec: number,
  wasAccepted: boolean,
  writeChatLog = true,
  markAsMissed = false,
): Promise<void> {
  const nextStatus: 'ended' | 'missed' = markAsMissed ? 'missed' : 'ended';
  const safeDuration = wasAccepted ? Math.max(1, Math.round(durationSec)) : 0;

  try {
    await updateDoc(doc(db, 'calls', callDoc.id), {
      status: nextStatus,
      durationSec: safeDuration,
      updatedAt: serverTimestamp(),
    });
  } catch {
    // Ignore if remote already closed the call
  }

  if (writeChatLog) {
    const peerUid = callDoc.callerId === myUid ? callDoc.receiverId : callDoc.callerId;
    const logStatus = wasAccepted ? 'completed' : 'missed';
    await sendMessagePermanent(
      myUid,
      peerUid,
      formatCallLogMessage(callDoc.type, logStatus, safeDuration),
      {
        callType: callDoc.type,
        callStatus: logStatus,
        callDurationSec: safeDuration,
      },
    ).catch(() => {});
  }
}

/**
 * Real-time Firestore listener for incoming calls ringing for `myUid`.
 * Automatically ignores calls older than 90 seconds so stale docs never ghost-ring.
 */
export function subscribeIncomingCalls(
  myUid: string,
  onIncomingCall: (call: CallSessionDoc | null) => void,
): Unsubscribe {
  const q = query(
    collection(db, 'calls'),
    where('participantUids', 'array-contains', myUid),
    where('status', '==', 'ringing'),
  );

  return onSnapshot(
    q,
    (snap) => {
      const nowMs = Date.now();
      const freshIncoming = snap.docs
        .map((d) => {
          const data = d.data();
          const tsMs =
            data.timestamp && typeof data.timestamp.toDate === 'function'
              ? data.timestamp.toDate().getTime()
              : nowMs;
          return {
            tsMs,
            call: {
              id: d.id,
              callerId: String(data.callerId || ''),
              callerName: String(data.callerName || 'Member'),
              callerAvatar: String(data.callerAvatar || ''),
              receiverId: String(data.receiverId || ''),
              receiverName: String(data.receiverName || 'Member'),
              receiverAvatar: String(data.receiverAvatar || ''),
              participantUids: (Array.isArray(data.participantUids) &&
              data.participantUids.length === 2
                ? [String(data.participantUids[0]), String(data.participantUids[1])]
                : [String(data.callerId || ''), String(data.receiverId || '')]) as [
                string,
                string,
              ],
              type: (data.type === 'video' ? 'video' : 'audio') as CallType,
              status: 'ringing' as const,
              offerSdp: String(data.offerSdp || ''),
              offerType: 'offer' as const,
              answerSdp: String(data.answerSdp || ''),
              answerType: (data.answerType === 'answer' ? 'answer' : '') as '' | 'answer',
              durationSec: typeof data.durationSec === 'number' ? data.durationSec : 0,
              timestampIso: new Date(tsMs).toISOString(),
            } satisfies CallSessionDoc,
          };
        })
        .filter((item) => item.call.receiverId === myUid && nowMs - item.tsMs < 90_000)
        .sort((a, b) => b.tsMs - a.tsMs);

      onIncomingCall(freshIncoming[0]?.call || null);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'calls');
      } catch {
        // Logged
      }
    },
  );
}
