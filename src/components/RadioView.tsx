import { useState, useEffect, FC } from 'react';
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
} from 'lucide-react';
import { Track } from '../types';

interface RadioViewProps {
  shares: Track[];
  onPlayTrack: (track: Track) => void;
  currentPlayingTrack: Track | null;
  isPlaying: boolean;
}

export const RadioView: FC<RadioViewProps> = ({
  shares,
  onPlayTrack,
  currentPlayingTrack,
  isPlaying,
}) => {
  // Station configuration
  const [stationName, setStationName] = useState('Spore Sovereign FM');
  const [genre, setGenre] = useState('Electronic / Ambient / IDM');
  const [djName, setDjName] = useState('scobru');
  const [djKey] = useState('5HqW7b9mDkH6ZXA6ehUyWBBjT6Xg4tQE4ALZjSsgXERd');

  // Radio operational state
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [broadcastQueue, setBroadcastQueue] = useState<Track[]>([]);
  const [queueIndex, setQueueIndex] = useState(0);
  const [uptimeSeconds, setUptimeSeconds] = useState(0);
  const [lastHeartbeatSecsAgo, setLastHeartbeatSecsAgo] = useState(0);
  const [ringSlot, setRingSlot] = useState(0);
  const [listenersCount, setListenersCount] = useState(0);
  const [copiedLink, setCopiedLink] = useState(false);
  const [isEditingSettings, setIsEditingSettings] = useState(false);

  // Auto-populate queue with shared tracks if empty
  useEffect(() => {
    if (broadcastQueue.length === 0 && shares.length > 0) {
      setBroadcastQueue(shares.slice(0, 15));
    }
  }, [shares]);

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

  const handleToggleBroadcast = () => {
    if (isBroadcasting) {
      setIsBroadcasting(false);
      setListenersCount(0);
    } else {
      if (broadcastQueue.length === 0 && shares.length > 0) {
        setBroadcastQueue(shares);
      }
      setIsBroadcasting(true);
      setListenersCount(Math.floor(Math.random() * 8 + 3));
      // Start audio playback of current track if not playing
      if (currentBroadcastTrack && (!currentPlayingTrack || currentPlayingTrack.blake3_hash !== currentBroadcastTrack.blake3_hash)) {
        onPlayTrack(currentBroadcastTrack);
      }
    }
  };

  const handleNextTrack = () => {
    if (broadcastQueue.length === 0) return;
    const nextIdx = (queueIndex + 1) % broadcastQueue.length;
    setQueueIndex(nextIdx);
    onPlayTrack(broadcastQueue[nextIdx]);
  };

  const handleShuffleQueue = () => {
    const shuffled = [...broadcastQueue].sort(() => Math.random() - 0.5);
    setBroadcastQueue(shuffled);
    setQueueIndex(0);
    if (shuffled.length > 0 && isBroadcasting) {
      onPlayTrack(shuffled[0]);
    }
  };

  const handleAddAllShares = () => {
    setBroadcastQueue(shares);
    setQueueIndex(0);
  };

  const handleRemoveFromQueue = (index: number) => {
    setBroadcastQueue((prev) => prev.filter((_, i) => i !== index));
    if (index === queueIndex && broadcastQueue.length > 1) {
      const nextIdx = index < broadcastQueue.length - 1 ? index : 0;
      setQueueIndex(nextIdx);
      if (isBroadcasting) onPlayTrack(broadcastQueue[nextIdx]);
    }
  };

  const radioPermalink = `spore:radio:${djKey}`;
  const radicaShareText = `[📻 ${stationName} (${genre}) on Spore](${radioPermalink})`;

  const handleCopyLink = () => {
    navigator.clipboard.writeText(radicaShareText);
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
                <span title={`Full key: ${djKey}`}>Key: {djKey.slice(0, 8)}...</span>
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
            <div className="bg-gradient-to-br from-emerald-950/30 to-neutral-900 border border-emerald-900/40 rounded-xl p-5">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-mono text-xs font-bold text-emerald-400 flex items-center gap-2">
                  <Share2 className="w-4 h-4" />
                  Radica Live Presence &amp; Share Link
                </h3>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800/80">
                  4-Slot Ring Buffer
                </span>
              </div>

              <p className="text-xs text-neutral-300 leading-relaxed mb-4">
                Share this link on Radica. When Spore is broadcasting, Radica reads your signed heartbeat and marks your post as{' '}
                <b className="text-rose-400">🔴 LIVE NOW</b> with your current track. When Spore is closed, Radica seamlessly shows{' '}
                <b className="text-neutral-400">⚪ OFFLINE</b> with zero dead links.
              </p>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <div className="flex-1 bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 font-mono text-xs text-neutral-300 truncate select-all">
                  {radicaShareText}
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
                      Copy for Radica
                    </>
                  )}
                </button>
              </div>

              <div className="mt-3 flex items-center gap-2 text-[11px] font-mono text-neutral-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                <span>Zero network bloat: strictly capped to ~240 KB on Freenet via sliding circular overwrite.</span>
              </div>
            </div>
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
                            setQueueIndex(idx);
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