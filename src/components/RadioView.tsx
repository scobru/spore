import { useState, useEffect, useRef, FC, Dispatch, SetStateAction } from 'react';
import {
  Radio,
  Play,
  Square,
  SkipForward,
  Shuffle,
  ListPlus,
  Share2,
  Copy,
  Check,
  Disc3,
  Layers,
  Activity,
  Trash2,
  Sliders,
  Headphones,
  RefreshCw,
  Mic,
  MonitorSpeaker,
  Link2,
} from 'lucide-react';
import { Track } from '../types';
import { createRadioOffer, completeRadioOffer, joinRadioOffer } from '../lib/webrtcSignal';
import {
  FreenetRadioBroadcaster,
  FreenetRadioListener,
  ListenerPeerInfo,
  StationInfo,
  getOrCreateLocalRoomId,
  regenerateLocalRoomId,
} from '../lib/freenetRadio';

interface RadioViewProps {
  shares: Track[];
  onPlayTrack: (track: Track) => void;
  currentPlayingTrack: Track | null;
  isPlaying: boolean;
  /** A live MediaStream of whatever the docked player is currently playing (null until a track has
   *  loaded once); this is what an invited listener actually hears. */
  broadcastStream: MediaStream | null;
  onBroadcastingChange?: (live: boolean) => void;
  broadcastQueue: Track[];
  queueIndex: number;
  onSetBroadcastQueue: Dispatch<SetStateAction<Track[]>>;
  onSetQueueIndex: Dispatch<SetStateAction<number>>;
  sourceMode: BroadcastSourceMode;
  onSourceModeChange: (mode: BroadcastSourceMode) => void;
}

type BroadcastSourceMode = 'playlist' | 'mic' | 'system' | 'url';

interface ListenerConnection {
  id: string;
  pc: RTCPeerConnection;
  state: RTCPeerConnectionState;
}

export const RadioView: FC<RadioViewProps> = ({
  shares,
  onPlayTrack,
  currentPlayingTrack,
  isPlaying,
  broadcastStream,
  onBroadcastingChange,
  broadcastQueue,
  queueIndex,
  onSetBroadcastQueue,
  onSetQueueIndex,
  sourceMode,
  onSourceModeChange,
}) => {
  // Station configuration
  const [stationName, setStationName] = useState('Spore Sovereign FM');
  const [genre, setGenre] = useState('Electronic / Ambient / IDM');
  const [djName, setDjName] = useState('scobru');
  const [roomId, setRoomId] = useState(() => getOrCreateLocalRoomId());

  // External audio source state
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [externalUrl, setExternalUrl] = useState('');
  const [externalStream, setExternalStream] = useState<MediaStream | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [sourceStatus, setSourceStatus] = useState<string | null>(null);
  const externalAudioElRef = useRef<HTMLAudioElement | null>(null);
  const externalAudioCtxRef = useRef<AudioContext | null>(null);

  const activeBroadcastStream = sourceMode === 'playlist' ? broadcastStream : externalStream;

  // Radio operational state
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [uptimeSeconds, setUptimeSeconds] = useState(0);
  const [lastHeartbeatSecsAgo, setLastHeartbeatSecsAgo] = useState(0);
  const [ringSlot, setRingSlot] = useState(0);
  const [copiedLink, setCopiedLink] = useState(false);
  const [isEditingSettings, setIsEditingSettings] = useState(false);

  // --- Freenet P2P Broadcast (1-click automatic signaling) ---
  const broadcasterRef = useRef<FreenetRadioBroadcaster | null>(null);
  const [freenetPeers, setFreenetPeers] = useState<ListenerPeerInfo[]>([]);
  const [freenetStatus, setFreenetStatus] = useState<string | null>(null);
  const [freenetError, setFreenetError] = useState<string | null>(null);

  // --- Freenet P2P Listener (paste link & listen) ---
  const listenerRef = useRef<FreenetRadioListener | null>(null);
  const [listenLinkInput, setListenLinkInput] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [listenStatus, setListenStatus] = useState<string | null>(null);
  const [listenError, setListenError] = useState<string | null>(null);
  const [listenConnState, setListenConnState] = useState<RTCPeerConnectionState | null>(null);
  const [remoteStation, setRemoteStation] = useState<StationInfo | null>(null);

  // --- Manual WebRTC fallback (no Freenet) ---
  const [listenerConnections, setListenerConnections] = useState<ListenerConnection[]>([]);
  const [pendingInvite, setPendingInvite] = useState<{ pc: RTCPeerConnection; code: string } | null>(null);
  const [pendingAnswerInput, setPendingAnswerInput] = useState('');
  const [inviteCopied, setInviteCopied] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const listenersCount =
    freenetPeers.filter((c) => c.state === 'connected').length +
    listenerConnections.filter((c) => c.state === 'connected').length;

  const handleGenerateInvite = async () => {
    setInviteError(null);
    if (!activeBroadcastStream) {
      setInviteError('Load a track or connect an external audio source first.');
      return;
    }
    try {
      const { pc, inviteCode } = await createRadioOffer(activeBroadcastStream);
      const id = `listener-${Date.now()}`;
      pc.addEventListener('connectionstatechange', () => {
        setListenerConnections((prev) => prev.map((c) => (c.id === id ? { ...c, state: pc.connectionState } : c)));
      });
      setListenerConnections((prev) => [...prev, { id, pc, state: pc.connectionState }]);
      setPendingInvite({ pc, code: inviteCode });
      setPendingAnswerInput('');
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleCompleteInvite = async () => {
    if (!pendingInvite || !pendingAnswerInput.trim()) return;
    try {
      await completeRadioOffer(pendingInvite.pc, pendingAnswerInput.trim());
      setPendingInvite(null);
      setPendingAnswerInput('');
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleCopyInviteCode = () => {
    if (!pendingInvite) return;
    navigator.clipboard.writeText(pendingInvite.code);
    setInviteCopied(true);
    setTimeout(() => setInviteCopied(false), 2000);
  };

  // --- Listen to a friend's radio (manual fallback) ---
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [joinAnswerCode, setJoinAnswerCode] = useState<string | null>(null);
  const [joinAnswerCopied, setJoinAnswerCopied] = useState(false);
  const [joinState, setJoinState] = useState<RTCPeerConnectionState | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

  const handleListenFreenet = async () => {
    if (isListening) {
      listenerRef.current?.leave();
      listenerRef.current = null;
      setIsListening(false);
      setListenStatus(null);
      setListenConnState(null);
      setRemoteStation(null);
      if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
      return;
    }
    if (!listenLinkInput.trim()) return;
    setListenError(null);
    setListenStatus('Connecting…');
    setIsListening(true);
    const listener = new FreenetRadioListener();
    listenerRef.current = listener;
    try {
      await listener.join(listenLinkInput.trim(), {
        onStatus: setListenStatus,
        onConnectionState: setListenConnState,
        onStationUpdate: setRemoteStation,
        onStream: (stream) => {
          if (remoteAudioRef.current) {
            remoteAudioRef.current.srcObject = stream;
            void remoteAudioRef.current.play().catch(() => {});
          }
        },
        onError: (err) => {
          setListenError(err);
          setListenStatus(null);
          setIsListening(false);
        },
      });
    } catch (err) {
      setListenError(err instanceof Error ? err.message : String(err));
      setListenStatus(null);
      setIsListening(false);
    }
  };

  const handleJoinRadio = async () => {
    setJoinError(null);
    if (!joinCodeInput.trim()) return;
    try {
      const { pc, answerCode, remoteStream } = await joinRadioOffer(joinCodeInput.trim());
      pc.addEventListener('connectionstatechange', () => setJoinState(pc.connectionState));
      setJoinState(pc.connectionState);
      setJoinAnswerCode(answerCode);
      remoteStream.then((stream) => {
        if (remoteAudioRef.current) remoteAudioRef.current.srcObject = stream;
      });
    } catch (err) {
      setJoinError(err instanceof Error ? err.message : 'That invite code looks invalid or expired.');
    }
  };

  const handleCopyAnswerCode = () => {
    if (!joinAnswerCode) return;
    navigator.clipboard.writeText(joinAnswerCode);
    setJoinAnswerCopied(true);
    setTimeout(() => setJoinAnswerCopied(false), 2000);
  };

  // Broadcast timer & heartbeat simulator
  useEffect(() => {
    if (!isBroadcasting) {
      setUptimeSeconds(0);
      setLastHeartbeatSecsAgo(0);
      return;
    }

    const timer = setInterval(() => {
      setUptimeSeconds((prev) => prev + 1);
      setLastHeartbeatSecsAgo((prev) => {
        if (prev >= 25) {
          // Heartbeat pulse every 25s, rotate ring buffer slot (0 to 3)
          setRingSlot((s) => (s + 1) % 4);
          return 0;
        }
        return prev + 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isBroadcasting]);

  // Track queue progression when broadcasting
  const currentBroadcastTrack = broadcastQueue[queueIndex] || null;
  const radioPermalink = `spore:radio:${roomId}`;

  const getNowPlayingLabel = () => {
    if (sourceMode === 'mic') return 'Live Audio Input (Mic / Line-In)';
    if (sourceMode === 'system') return 'System / App Audio Capture';
    if (sourceMode === 'url') return externalUrl ? `External Stream: ${externalUrl}` : 'External Audio Stream';
    const activeTrack = isBroadcasting && currentPlayingTrack ? currentPlayingTrack : currentBroadcastTrack;
    return activeTrack ? `${activeTrack.artist} - ${activeTrack.title}` : 'Live Audio Stream';
  };

  // Notify parent App when broadcasting state changes (for tab badge)
  useEffect(() => {
    onBroadcastingChange?.(isBroadcasting);
  }, [isBroadcasting, onBroadcastingChange]);

  const stopExternalSource = () => {
    if (externalStream) {
      externalStream.getTracks().forEach((t) => t.stop());
      setExternalStream(null);
    }
    if (externalAudioElRef.current) {
      externalAudioElRef.current.pause();
      externalAudioElRef.current.src = '';
      externalAudioElRef.current = null;
    }
    if (externalAudioCtxRef.current) {
      void externalAudioCtxRef.current.close().catch(() => {});
      externalAudioCtxRef.current = null;
    }
    setSourceStatus(null);
  };

  const refreshAudioDevices = async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices.filter((d) => d.kind === 'audioinput');
      setAudioDevices(inputs);
      if (!selectedDeviceId && inputs.length > 0) {
        setSelectedDeviceId(inputs[0].deviceId);
      }
    } catch {}
  };

  useEffect(() => {
    if (sourceMode === 'mic') {
      void refreshAudioDevices();
    }
  }, [sourceMode]);

  const handleConnectMic = async (deviceId?: string) => {
    setSourceError(null);
    stopExternalSource();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        video: false,
      });
      setExternalStream(stream);
      const label = stream.getAudioTracks()[0]?.label || 'Audio Input';
      setSourceStatus(`Connected: ${label}`);
      void refreshAudioDevices();
    } catch (err) {
      setSourceError(err instanceof Error ? err.message : 'Could not access audio input device.');
    }
  };

  const handleConnectSystemAudio = async () => {
    setSourceError(null);
    stopExternalSource();
    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
      displayStream.getVideoTracks().forEach((vt) => {
        vt.stop();
        displayStream.removeTrack(vt);
      });
      if (displayStream.getAudioTracks().length === 0) {
        setSourceError('No audio track captured. Make sure "Share audio" is checked in the prompt.');
        return;
      }
      setExternalStream(displayStream);
      setSourceStatus('Connected: System / App Audio');
    } catch (err) {
      setSourceError(err instanceof Error ? err.message : 'System audio capture was cancelled or unsupported.');
    }
  };

  const handleConnectUrl = async () => {
    setSourceError(null);
    if (!externalUrl.trim()) {
      setSourceError('Enter a valid HTTP/HTTPS audio stream URL.');
      return;
    }
    stopExternalSource();
    try {
      const audio = new Audio();
      audio.crossOrigin = 'anonymous';
      audio.src = externalUrl.trim();
      const ctx = new AudioContext();
      const src = ctx.createMediaElementSource(audio);
      const dest = ctx.createMediaStreamDestination();
      src.connect(dest);
      // Also monitor locally at low/normal volume? Keep muted or let user control; connect to dest only so no double echo unless needed
      await audio.play();
      externalAudioElRef.current = audio;
      externalAudioCtxRef.current = ctx;
      setExternalStream(dest.stream);
      setSourceStatus(`Streaming URL: ${externalUrl.trim()}`);
    } catch (err) {
      setSourceError(
        err instanceof Error
          ? `${err.message} (Note: external HTTP streams must allow CORS for Web Audio capture)`
          : 'Failed to open external stream URL.'
      );
    }
  };

  // Cleanup external source on true unmount
  useEffect(() => {
    return () => {
      stopExternalSource();
    };
  }, []);

  // Automatically start/stop Freenet broadcaster when isBroadcasting + activeBroadcastStream are ready
  useEffect(() => {
    if (!isBroadcasting || !activeBroadcastStream) return;

    const broadcaster = new FreenetRadioBroadcaster();
    broadcasterRef.current = broadcaster;
    setFreenetError(null);

    const nowPlaying = getNowPlayingLabel();

    void broadcaster
      .start(
        roomId,
        {
          station_name: stationName,
          genre,
          dj_name: djName,
          now_playing: nowPlaying,
          live: true,
          ts: Date.now(),
        },
        activeBroadcastStream,
        {
          onListenersChange: setFreenetPeers,
          onStatus: (s) => setFreenetStatus(s),
          onError: (e) => setFreenetError(e),
        }
      )
      .then(() => {
        navigator.clipboard?.writeText(radioPermalink).then(() => {
          setCopiedLink(true);
          setTimeout(() => setCopiedLink(false), 2500);
        }).catch(() => {});
      })
      .catch((err) => {
        setFreenetError(err instanceof Error ? err.message : String(err));
        setFreenetStatus(null);
      });

    return () => {
      void broadcaster.stop();
      if (broadcasterRef.current === broadcaster) {
        broadcasterRef.current = null;
      }
      setFreenetPeers([]);
      setFreenetStatus(null);
    };
  }, [isBroadcasting, activeBroadcastStream, roomId]);

  // Push track / station metadata updates to Freenet while live
  useEffect(() => {
    if (!isBroadcasting || !broadcasterRef.current) return;
    const nowPlaying = getNowPlayingLabel();
    void broadcasterRef.current
      .updateStation({
        station_name: stationName,
        genre,
        dj_name: djName,
        now_playing: nowPlaying,
        live: true,
        ts: Date.now(),
      })
      .catch(() => {});
  }, [isBroadcasting, currentBroadcastTrack, currentPlayingTrack, sourceMode, externalUrl, stationName, genre, djName]);

  // Cleanup listener on unmount
  useEffect(() => {
    return () => {
      listenerRef.current?.leave();
    };
  }, []);

  const handleToggleBroadcast = () => {
    if (isBroadcasting) {
      setIsBroadcasting(false);
      setFreenetError(null);
      listenerConnections.forEach((c) => c.pc.close());
      setListenerConnections([]);
      setPendingInvite(null);
    } else {
      if (sourceMode === 'playlist') {
        let queue = broadcastQueue;
        if (queue.length === 0 && shares.length > 0) {
          queue = shares;
          onSetBroadcastQueue(queue);
          onSetQueueIndex(0);
        }
        const trackToPlay = queue[queueIndex] ?? queue[0] ?? null;
        setIsBroadcasting(true);
        // Always start audio playback if paused or playing a different track so broadcastStream stays live
        if (trackToPlay && (!isPlaying || currentPlayingTrack?.path !== trackToPlay.path)) {
          onPlayTrack(trackToPlay);
        }
      } else {
        setIsBroadcasting(true);
      }
    }
  };

  const handleRegenerateRoom = () => {
    if (isBroadcasting) return;
    setRoomId(regenerateLocalRoomId());
  };

  const handleNextTrack = () => {
    if (broadcastQueue.length === 0) return;
    const nextIdx = (queueIndex + 1) % broadcastQueue.length;
    onSetQueueIndex(nextIdx);
    onPlayTrack(broadcastQueue[nextIdx]);
  };

  const handleShuffleQueue = () => {
    const shuffled = [...broadcastQueue].sort(() => Math.random() - 0.5);
    onSetBroadcastQueue(shuffled);
    onSetQueueIndex(0);
    if (shuffled.length > 0 && isBroadcasting) {
      onPlayTrack(shuffled[0]);
    }
  };

  const handleAddAllShares = () => {
    onSetBroadcastQueue(shares);
    onSetQueueIndex(0);
  };

  const handleRemoveFromQueue = (index: number) => {
    const nextQueue = broadcastQueue.filter((_, i) => i !== index);
    onSetBroadcastQueue(nextQueue);
    if (nextQueue.length === 0) {
      onSetQueueIndex(0);
      return;
    }
    if (index === queueIndex) {
      const nextIdx = index < nextQueue.length ? index : 0;
      onSetQueueIndex(nextIdx);
      if (isBroadcasting) onPlayTrack(nextQueue[nextIdx]);
    } else if (index < queueIndex) {
      onSetQueueIndex(queueIndex - 1);
    }
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(radioPermalink);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2500);
  };

  const formatSeconds = (sec: number) => {
    const hrs = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (hrs > 0) {
      return `${hrs}:${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
    }
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <div className="flex-1 flex flex-col bg-neutral-950 overflow-hidden font-sans">
      {/* Radio Deck Control Header */}
      <div className="bg-neutral-900 border-b border-neutral-800 p-4 shrink-0">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-4">
          {/* Station Identity & Status */}
          <div className="flex items-center gap-4">
            <div
              className={`w-14 h-14 rounded-xl flex items-center justify-center border transition-all ${
                isBroadcasting
                  ? 'bg-rose-950/60 border-rose-500/80 shadow-[0_0_25px_rgba(244,63,94,0.35)]'
                  : 'bg-neutral-800 border-neutral-700/80'
              }`}
            >
              <Radio
                className={`w-7 h-7 transition-colors ${
                  isBroadcasting ? 'text-rose-400 animate-pulse' : 'text-neutral-400'
                }`}
              />
            </div>

            <div>
              <div className="flex items-center gap-2.5">
                <h2 className="text-lg font-bold text-neutral-100 font-mono tracking-tight">
                  {stationName}
                </h2>
                {isBroadcasting ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-mono font-bold bg-rose-500/20 text-rose-400 border border-rose-500/50 animate-pulse">
                    <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
                    ON AIR
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-neutral-800 text-neutral-400 border border-neutral-700">
                    STANDBY
                  </span>
                )}
                <button
                  onClick={() => setIsEditingSettings(!isEditingSettings)}
                  title="Station settings"
                  className="p-1 rounded text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 transition-colors"
                >
                  <Sliders className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="flex items-center gap-2 text-xs text-neutral-400 mt-1 font-mono">
                <span>DJ: <b className="text-emerald-400">@{djName}</b></span>
                <span className="text-neutral-600">•</span>
                <span className="truncate max-w-[200px] text-neutral-300">{genre}</span>
                <span className="text-neutral-600">•</span>
                <span title={`Room ID: ${roomId}`}>Room: {roomId}</span>
              </div>
            </div>
          </div>

          {/* Quick Stats & Main Broadcast Toggle */}
          <div className="flex items-center gap-3">
            {isBroadcasting && (
              <div className="hidden sm:flex items-center gap-4 px-3.5 py-2 bg-neutral-950/80 border border-neutral-800 rounded-lg text-xs font-mono">
                <div>
                  <div className="text-neutral-500 text-[10px] uppercase">Live Uptime</div>
                  <div className="font-semibold text-neutral-200">{formatSeconds(uptimeSeconds)}</div>
                </div>
                <div className="w-px h-6 bg-neutral-800" />
                <div>
                  <div className="text-neutral-500 text-[10px] uppercase">Listeners</div>
                  <div className="font-semibold text-emerald-400">👥 {listenersCount}</div>
                </div>
                <div className="w-px h-6 bg-neutral-800" />
                <div>
                  <div className="text-neutral-500 text-[10px] uppercase">Ring Slot</div>
                  <div className="font-semibold text-amber-400 flex items-center gap-1">
                    <Layers className="w-3 h-3" />
                    Slot #{ringSlot}/3
                  </div>
                </div>
              </div>
            )}

            <button
              onClick={handleToggleBroadcast}
              className={`px-5 py-2.5 rounded-lg font-mono text-xs font-bold flex items-center gap-2 transition-all cursor-pointer shadow-lg ${
                isBroadcasting
                  ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-900/30'
                  : 'bg-emerald-600 hover:bg-emerald-500 text-neutral-950 shadow-emerald-950/40'
              }`}
            >
              {isBroadcasting ? (
                <>
                  <Square className="w-4 h-4 fill-current" />
                  Stop Broadcast
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-current" />
                  Start Broadcast
                </>
              )}
            </button>
          </div>
        </div>

        {/* Station Settings Inline Drawer */}
        {isEditingSettings && (
          <div className="max-w-6xl mx-auto mt-4 p-4 bg-neutral-950/90 border border-neutral-800 rounded-lg grid grid-cols-1 md:grid-cols-3 gap-3 text-xs font-mono">
            <div>
              <label className="text-neutral-400 block mb-1">Station Name</label>
              <input
                type="text"
                value={stationName}
                onChange={(e) => setStationName(e.target.value)}
                className="w-full bg-neutral-900 border border-neutral-700 rounded px-2.5 py-1.5 text-neutral-100 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="text-neutral-400 block mb-1">Musical Genre / Vibe</label>
              <input
                type="text"
                value={genre}
                onChange={(e) => setGenre(e.target.value)}
                className="w-full bg-neutral-900 border border-neutral-700 rounded px-2.5 py-1.5 text-neutral-100 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="text-neutral-400 block mb-1">DJ Handle (Viso Persona)</label>
              <input
                type="text"
                value={djName}
                onChange={(e) => setDjName(e.target.value)}
                className="w-full bg-neutral-900 border border-neutral-700 rounded px-2.5 py-1.5 text-neutral-100 focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>
        )}
      </div>

      {/* Main Radio Dashboard Content */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left 2 Cols: On-Air Status & Now Playing */}
          <div className="lg:col-span-2 flex flex-col gap-5">
            {/* Broadcast Audio Source Selector */}
            <div className="bg-neutral-900/90 border border-neutral-800 rounded-xl p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <span className="text-xs font-mono text-neutral-400 uppercase font-semibold">
                  Audio Source
                </span>
                <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px]">
                  {(
                    [
                      { id: 'playlist', label: 'Playlist', icon: Disc3 },
                      { id: 'mic', label: 'Mic / Line-In', icon: Mic },
                      { id: 'system', label: 'System Audio', icon: MonitorSpeaker },
                      { id: 'url', label: 'Stream URL', icon: Link2 },
                    ] as const
                  ).map(({ id, label, icon: Icon }) => (
                    <button
                      key={id}
                      onClick={() => {
                        setSourceError(null);
                        if (id === 'playlist') stopExternalSource();
                        onSourceModeChange(id);
                      }}
                      className={`px-2.5 py-1 rounded flex items-center gap-1.5 transition-colors cursor-pointer ${
                        sourceMode === id
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/50 font-semibold'
                          : 'bg-neutral-950 text-neutral-400 border border-neutral-800 hover:text-neutral-200'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {sourceMode === 'mic' && (
                <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
                  <select
                    value={selectedDeviceId}
                    onChange={(e) => setSelectedDeviceId(e.target.value)}
                    className="flex-1 min-w-[180px] bg-neutral-950 border border-neutral-800 rounded px-2.5 py-1.5 text-neutral-200"
                  >
                    {audioDevices.length === 0 && <option value="">Default Audio Input</option>}
                    {audioDevices.map((d) => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.label || `Input (${d.deviceId.slice(0, 8)})`}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => void handleConnectMic(selectedDeviceId || undefined)}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-neutral-950 font-bold rounded cursor-pointer"
                  >
                    Connect Input
                  </button>
                </div>
              )}

              {sourceMode === 'system' && (
                <div className="flex items-center justify-between gap-3 text-xs font-mono">
                  <span className="text-neutral-400">
                    Capture audio from another app or system output (enable "Share audio" in the picker).
                  </span>
                  <button
                    onClick={() => void handleConnectSystemAudio()}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-neutral-950 font-bold rounded shrink-0 cursor-pointer"
                  >
                    Capture System Audio
                  </button>
                </div>
              )}

              {sourceMode === 'url' && (
                <div className="flex items-center gap-2 text-xs font-mono">
                  <input
                    type="text"
                    value={externalUrl}
                    onChange={(e) => setExternalUrl(e.target.value)}
                    placeholder="https://stream.example.com/radio.mp3 (CORS-enabled Icecast/HTTP)"
                    className="flex-1 bg-neutral-950 border border-neutral-800 rounded px-2.5 py-1.5 text-neutral-200 placeholder:text-neutral-600"
                  />
                  <button
                    onClick={() => void handleConnectUrl()}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-neutral-950 font-bold rounded cursor-pointer"
                  >
                    Load Stream
                  </button>
                </div>
              )}

              {sourceStatus && (
                <div className="mt-2 text-[11px] font-mono text-emerald-400">{sourceStatus}</div>
              )}
              {sourceError && (
                <div className="mt-2 text-[11px] font-mono text-rose-400">{sourceError}</div>
              )}
            </div>

            {/* On-Air Live Player Card */}
            <div className="bg-neutral-900/90 border border-neutral-800 rounded-xl p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs font-mono text-neutral-400 flex items-center gap-1.5 uppercase font-semibold">
                  <Activity className="w-3.5 h-3.5 text-emerald-400" />
                  Currently Transmitting
                </span>
                {isBroadcasting && (
                  <span className="text-[11px] font-mono text-neutral-400 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    Heartbeat: {lastHeartbeatSecsAgo}s ago
                  </span>
                )}
              </div>

              {currentBroadcastTrack ? (
                <div className="flex flex-col sm:flex-row items-center gap-5">
                  <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-lg bg-neutral-800 border border-neutral-700/80 flex items-center justify-center shrink-0 shadow-inner relative overflow-hidden">
                    <Disc3
                      className={`w-12 h-12 text-emerald-400 ${
                        isBroadcasting && isPlaying ? 'animate-spin' : ''
                      }`}
                      style={{ animationDuration: '4s' }}
                    />
                    {isBroadcasting && (
                      <div className="absolute inset-0 bg-emerald-500/5 pointer-events-none" />
                    )}
                  </div>

                  <div className="flex-1 truncate w-full text-center sm:text-left">
                    <div className="text-lg font-bold text-neutral-100 truncate">
                      {currentBroadcastTrack.title}
                    </div>
                    <div className="text-sm font-medium text-emerald-400 truncate mt-0.5">
                      {currentBroadcastTrack.artist}
                    </div>
                    <div className="text-xs text-neutral-400 truncate mt-1">
                      {currentBroadcastTrack.album} {currentBroadcastTrack.year ? `(${currentBroadcastTrack.year})` : ''}
                    </div>

                    <div className="flex flex-wrap items-center justify-center sm:justify-start gap-1.5 mt-3">
                      <span className="px-2 py-0.5 bg-neutral-800 text-neutral-300 rounded text-[10px] font-mono font-semibold">
                        {currentBroadcastTrack.format}
                      </span>
                      {currentBroadcastTrack.bitrate_kbps && (
                        <span className="px-2 py-0.5 bg-neutral-800 text-neutral-400 rounded text-[10px] font-mono">
                          {currentBroadcastTrack.bitrate_kbps} kbps
                        </span>
                      )}
                      <span className="px-2 py-0.5 bg-neutral-800 text-neutral-400 rounded text-[10px] font-mono">
                        {formatSeconds(currentBroadcastTrack.duration_secs)}
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 text-neutral-500 font-mono text-xs">
                  No tracks queued in broadcast deck. Add shared music below to start your radio.
                </div>
              )}

              {/* Animated Waveform Equalizer when live */}
              {isBroadcasting && (
                <div className="mt-5 pt-4 border-t border-neutral-800 flex items-center justify-between gap-1 h-9 px-2">
                  {[40, 75, 25, 90, 60, 30, 85, 45, 100, 70, 35, 95, 50, 80, 65, 30, 85, 45, 90, 60, 25, 75, 40].map(
                    (height, i) => (
                      <span
                        key={i}
                        className="flex-1 bg-emerald-400/80 rounded-full transition-all duration-300"
                        style={{
                          height: `${Math.max(15, (height * (isPlaying ? 1 : 0.2)))}%`,
                          animationDelay: `${i * 0.08}s`,
                        }}
                      />
                    )
                  )}
                </div>
              )}

              {/* Next Up Info */}
              {broadcastQueue.length > 1 && (
                <div className="mt-4 pt-3 border-t border-neutral-800/60 flex items-center justify-between text-xs font-mono">
                  <div className="text-neutral-400 truncate">
                    <span className="text-neutral-500 uppercase text-[10px] font-semibold mr-2">Next Up:</span>
                    <span className="text-neutral-200">
                      {broadcastQueue[(queueIndex + 1) % broadcastQueue.length]?.artist} -{' '}
                      {broadcastQueue[(queueIndex + 1) % broadcastQueue.length]?.title}
                    </span>
                  </div>
                  <button
                    onClick={handleNextTrack}
                    className="flex items-center gap-1 text-emerald-400 hover:text-emerald-300 font-semibold cursor-pointer shrink-0 ml-3"
                  >
                    <SkipForward className="w-3.5 h-3.5" />
                    Skip
                  </button>
                </div>
              )}
            </div>

            {/* Radica & Freenet Ecosystem Integration Card */}
            {/* Freenet 1-Click Share Link & Live Status */}
            <div className="bg-gradient-to-br from-emerald-950/30 to-neutral-900 border border-emerald-900/40 rounded-xl p-5">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-mono text-xs font-bold text-emerald-400 flex items-center gap-2">
                  <Share2 className="w-4 h-4" />
                  Share Radio Link (Freenet P2P)
                </h3>
                <span
                  className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                    freenetError
                      ? 'bg-rose-950/80 text-rose-400 border-rose-800/80'
                      : 'bg-emerald-950 text-emerald-400 border-emerald-800/80'
                  }`}
                >
                  {freenetError ? 'Offline / Error' : freenetStatus ? freenetStatus : isBroadcasting ? 'Starting…' : 'Ready'}
                </span>
              </div>

              <p className="text-xs text-neutral-300 leading-relaxed mb-4">
                Click <b className="text-emerald-400">Start Broadcast</b> above and share this link (also works on Radica).
                Anyone with Spore + Freenet who pastes this link will tune in automatically — no invite/answer codes needed.
              </p>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <div className="flex-1 bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 font-mono text-xs text-neutral-200 truncate select-all">
                  {radioPermalink}
                </div>
                <button
                  onClick={handleCopyLink}
                  className={`px-4 py-2 rounded-lg font-mono text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                    copiedLink
                      ? 'bg-emerald-500 text-neutral-950'
                      : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-100 border border-neutral-700'
                  }`}
                >
                  {copiedLink ? (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      Copy Link
                    </>
                  )}
                </button>
                {!isBroadcasting && (
                  <button
                    onClick={handleRegenerateRoom}
                    title="Generate a new room link"
                    className="px-2.5 py-2 rounded-lg font-mono text-xs bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border border-neutral-700 flex items-center justify-center cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {freenetError && (
                <p className="mt-3 text-xs text-rose-400 font-mono">{freenetError}</p>
              )}

              {freenetPeers.length > 0 && (
                <div className="mt-3 pt-3 border-t border-neutral-800/80 space-y-1">
                  {freenetPeers.map((p, i) => (
                    <div key={p.id} className="flex items-center justify-between text-[11px] font-mono text-neutral-400">
                      <span>Listener #{i + 1}</span>
                      <span
                        className={
                          p.state === 'connected'
                            ? 'text-emerald-400'
                            : p.state === 'failed' || p.state === 'closed' || p.state === 'disconnected'
                              ? 'text-rose-400'
                              : 'text-amber-400'
                        }
                      >
                        {p.state}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Listen to a Friend's Radio (1-click Freenet P2P) */}
            <div className="bg-neutral-900/90 border border-neutral-800 rounded-xl p-5">
              <h3 className="font-mono text-xs font-bold text-neutral-200 flex items-center gap-2 mb-2">
                <Headphones className="w-4 h-4 text-cyan-400" />
                Listen to a Friend's Radio
              </h3>
              <p className="text-xs text-neutral-400 leading-relaxed mb-3">
                Paste the <code className="text-cyan-300">spore:radio:...</code> link a friend shared with you and click{' '}
                <b className="text-neutral-200">Listen</b>.
              </p>

              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={listenLinkInput}
                    onChange={(e) => setListenLinkInput(e.target.value)}
                    disabled={isListening}
                    placeholder="spore:radio:sp-..."
                    className="flex-1 bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 font-mono text-xs text-neutral-100 focus:outline-none focus:border-cyan-500 disabled:opacity-60"
                  />
                  <button
                    onClick={handleListenFreenet}
                    disabled={!isListening && !listenLinkInput.trim()}
                    className={`px-4 py-2 rounded-lg font-mono text-xs font-semibold shrink-0 cursor-pointer transition-colors ${
                      isListening
                        ? 'bg-rose-600 hover:bg-rose-500 text-white'
                        : 'bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-neutral-950'
                    }`}
                  >
                    {isListening ? 'Stop' : 'Listen'}
                  </button>
                </div>

                {(listenStatus || listenConnState) && (
                  <div className="flex items-center justify-between text-[11px] font-mono">
                    <span className="text-neutral-400">{listenStatus ?? 'Connection:'}</span>
                    {listenConnState && (
                      <span
                        className={
                          listenConnState === 'connected'
                            ? 'text-emerald-400'
                            : listenConnState === 'failed' || listenConnState === 'closed' || listenConnState === 'disconnected'
                              ? 'text-rose-400'
                              : 'text-amber-400'
                        }
                      >
                        {listenConnState}
                      </span>
                    )}
                  </div>
                )}

                {remoteStation && (
                  <div className="p-3 rounded-lg bg-neutral-950 border border-neutral-800 text-xs font-mono space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-neutral-100">{remoteStation.station_name}</span>
                      <span className={remoteStation.live ? 'text-rose-400' : 'text-neutral-500'}>
                        {remoteStation.live ? '🔴 LIVE' : '⚪ OFFLINE'}
                      </span>
                    </div>
                    <div className="text-neutral-400 text-[11px]">
                      DJ: <span className="text-emerald-400">@{remoteStation.dj_name}</span> • {remoteStation.genre}
                    </div>
                    <div className="text-cyan-300 text-[11px] truncate">♪ {remoteStation.now_playing}</div>
                  </div>
                )}

                {listenError && <p className="text-xs text-rose-400 font-mono">{listenError}</p>}

                <audio ref={remoteAudioRef} autoPlay controls className="w-full mt-1" />
              </div>
            </div>

            {/* Optional Manual WebRTC Fallback (without Freenet) */}
            <details className="bg-neutral-900/50 border border-neutral-800/80 rounded-xl p-4 text-xs">
              <summary className="font-mono font-semibold text-neutral-400 hover:text-neutral-200 cursor-pointer select-none">
                Advanced: Manual WebRTC Invite/Answer (without Freenet)
              </summary>
              <div className="mt-4 space-y-4">
                <div>
                  <div className="font-mono text-[11px] font-bold text-neutral-300 mb-2">Broadcaster: Generate Invite Code</div>
                  {!isBroadcasting ? (
                    <p className="text-xs text-neutral-500 font-mono">Start broadcasting above first.</p>
                  ) : (
                    <div className="space-y-2">
                      <button
                        onClick={handleGenerateInvite}
                        className="px-3 py-1.5 rounded-lg font-mono text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-neutral-950 cursor-pointer"
                      >
                        Generate Invite Code
                      </button>
                      {inviteError && <p className="text-xs text-rose-400 font-mono">{inviteError}</p>}
                      {pendingInvite && (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <textarea
                              readOnly
                              value={pendingInvite.code}
                              rows={2}
                              className="flex-1 bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 font-mono text-[10px] text-neutral-400 resize-none"
                            />
                            <button
                              onClick={handleCopyInviteCode}
                              className="px-3 py-2 rounded-lg font-mono text-xs bg-neutral-800 hover:bg-neutral-700 text-neutral-100 border border-neutral-700 flex items-center gap-1.5 shrink-0 cursor-pointer"
                            >
                              {inviteCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                              {inviteCopied ? 'Copied' : 'Copy'}
                            </button>
                          </div>
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              value={pendingAnswerInput}
                              onChange={(e) => setPendingAnswerInput(e.target.value)}
                              placeholder="Paste their answer code here…"
                              className="flex-1 bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 font-mono text-xs text-neutral-100 focus:outline-none focus:border-emerald-500"
                            />
                            <button
                              onClick={handleCompleteInvite}
                              disabled={!pendingAnswerInput.trim()}
                              className="px-3 py-2 rounded-lg font-mono text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-neutral-950 shrink-0 cursor-pointer"
                            >
                              Connect
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="pt-3 border-t border-neutral-800 space-y-2">
                  <div className="font-mono text-[11px] font-bold text-neutral-300">Listener: Paste Invite Code</div>
                  <div className="flex items-center gap-2">
                    <textarea
                      value={joinCodeInput}
                      onChange={(e) => setJoinCodeInput(e.target.value)}
                      placeholder="Paste invite code here…"
                      rows={2}
                      className="flex-1 bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 font-mono text-[10px] text-neutral-100 resize-none focus:outline-none focus:border-cyan-500"
                    />
                    <button
                      onClick={handleJoinRadio}
                      disabled={!joinCodeInput.trim()}
                      className="px-3 py-2 rounded-lg font-mono text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-neutral-950 shrink-0 cursor-pointer"
                    >
                      Join
                    </button>
                  </div>
                  {joinError && <p className="text-xs text-rose-400 font-mono">{joinError}</p>}
                  {joinAnswerCode && (
                    <div className="flex items-center gap-2">
                      <textarea
                        readOnly
                        value={joinAnswerCode}
                        rows={2}
                        className="flex-1 bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 font-mono text-[10px] text-neutral-400 resize-none"
                      />
                      <button
                        onClick={handleCopyAnswerCode}
                        className="px-3 py-2 rounded-lg font-mono text-xs bg-neutral-800 hover:bg-neutral-700 text-neutral-100 border border-neutral-700 flex items-center gap-1.5 shrink-0 cursor-pointer"
                      >
                        {joinAnswerCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        {joinAnswerCopied ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                  )}
                  {joinState && (
                    <div className="text-[11px] font-mono text-neutral-400">
                      Manual WebRTC: <span className="text-neutral-200">{joinState}</span>
                    </div>
                  )}
                </div>
              </div>
            </details>
          </div>

          {/* Right Col: Playlist / Broadcast Queue */}
          <div className="bg-neutral-900/90 border border-neutral-800 rounded-xl p-4 flex flex-col h-[520px]">
            <div className="flex items-center justify-between pb-3 border-b border-neutral-800 mb-3">
              <div>
                <h3 className="font-mono text-xs font-bold text-neutral-200 uppercase">
                  Broadcast Queue
                </h3>
                <span className="text-[11px] font-mono text-neutral-400">
                  {broadcastQueue.length} tracks queued
                </span>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  onClick={handleShuffleQueue}
                  title="Shuffle queue"
                  className="p-1.5 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-300 transition-colors"
                >
                  <Shuffle className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={handleAddAllShares}
                  title="Queue all shared music"
                  className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-300 font-mono text-[10px] flex items-center gap-1 transition-colors"
                >
                  <ListPlus className="w-3.5 h-3.5" />
                  All Shares
                </button>
              </div>
            </div>

            {/* Queue List */}
            <div className="flex-1 overflow-y-auto space-y-1 pr-1 font-mono text-xs">
              {broadcastQueue.map((t, idx) => {
                const isCurrent = idx === queueIndex;
                return (
                  <div
                    key={`${t.blake3_hash}-${idx}`}
                    className={`p-2.5 rounded-lg flex items-center justify-between gap-2 border transition-colors ${
                      isCurrent
                        ? 'bg-emerald-950/40 border-emerald-800/80 text-emerald-200'
                        : 'bg-neutral-950/50 border-neutral-800/60 hover:bg-neutral-800/40 text-neutral-300'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 truncate">
                      <span className="text-[10px] text-neutral-500 w-4 text-right">
                        {idx + 1}
                      </span>
                      {isCurrent && isBroadcasting ? (
                        <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping shrink-0" />
                      ) : (
                        <button
                          onClick={() => {
                            onSetQueueIndex(idx);
                            onPlayTrack(t);
                          }}
                          className="text-neutral-400 hover:text-emerald-400 shrink-0"
                          title="Jump to track"
                        >
                          <Play className="w-3 h-3 fill-current" />
                        </button>
                      )}
                      <div className="truncate">
                        <div className="truncate font-semibold text-neutral-100">
                          {t.title}
                        </div>
                        <div className="truncate text-[10px] text-neutral-400">
                          {t.artist}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[10px] text-neutral-500">
                        {formatSeconds(t.duration_secs)}
                      </span>
                      <button
                        onClick={() => handleRemoveFromQueue(idx)}
                        title="Remove from queue"
                        className="text-neutral-500 hover:text-rose-400 transition-colors p-1"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                );
              })}

              {broadcastQueue.length === 0 && (
                <div className="text-center py-12 text-neutral-500 text-xs">
                  Queue is empty. Click "All Shares" above to load your music library into the deck.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};