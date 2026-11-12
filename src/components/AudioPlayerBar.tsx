import { useState, useEffect, useRef, FC } from 'react';
import { Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, Disc3 } from 'lucide-react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { Track } from '../types';

interface AudioPlayerBarProps {
  currentTrack: Track | null;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onNext?: () => void;
  onPrev?: () => void;
  /** Fires once with a MediaStream that always carries whatever this player is currently playing
   *  (survives track changes), for Spore Radio to hand to a listener's RTCPeerConnection. */
  onBroadcastStreamReady?: (stream: MediaStream) => void;
}

export const AudioPlayerBar: FC<AudioPlayerBarProps> = ({
  currentTrack,
  isPlaying,
  onTogglePlay,
  onNext,
  onPrev,
  onBroadcastStreamReady,
}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(85);
  const [isMuted, setIsMuted] = useState(false);

  // Sync audio source
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (currentTrack?.path) {
      try {
        const audioSrc = convertFileSrc(currentTrack.path);
        console.log('[Spore Audio] Loading track:', currentTrack.title, 'Source:', audioSrc);
        audio.src = audioSrc;
        audio.volume = isMuted ? 0 : volume / 100;

        if (isPlaying) {
          audio
            .play()
            .then(() => console.log('[Spore Audio] Playback started'))
            .catch((err) => console.error('[Spore Audio] Playback failed:', err));
        }
      } catch (err) {
        console.error('[Spore Audio] convertFileSrc failed:', err);
      }
    } else {
      audio.pause();
      audio.src = '';
    }
  }, [currentTrack]);

  // Sync play/pause state
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio
        .play()
        .then(() => console.log('[Spore Audio] Playback resumed'))
        .catch((err) => console.error('[Spore Audio] Resume failed:', err));
    } else {
      audio.pause();
    }
  }, [isPlaying]);

  // Spore Radio's broadcast stream comes from a second, muted, hidden <audio> element that mirrors the docked
  // player, decoded through its own Web Audio graph — never the docked player's own element. Tauri serves local
  // files from a different origin (asset.localhost) than the app page, so wrapping an element playing from there
  // in a MediaElementSourceNode taints it silent, by spec, for Web Audio purposes; wrapping the docked player
  // itself silenced ordinary local playback too, since it only plays through that (silent) graph from then on.
  const broadcastAudioRef = useRef<HTMLAudioElement | null>(null);
  const broadcastWired = useRef(false);
  useEffect(() => {
    const audio = broadcastAudioRef.current;
    if (!audio || !onBroadcastStreamReady || broadcastWired.current) return;
    broadcastWired.current = true;
    const ctx = new AudioContext();
    const source = ctx.createMediaElementSource(audio);
    const destination = ctx.createMediaStreamDestination();
    source.connect(destination);
    onBroadcastStreamReady(destination.stream);
    const unlock = () => void ctx.resume();
    document.addEventListener('pointerdown', unlock, { once: true });
    document.addEventListener('keydown', unlock, { once: true });
  }, []);

  // Mirror the docked player's track and play state into the broadcast element.
  useEffect(() => {
    const audio = broadcastAudioRef.current;
    if (!audio || !onBroadcastStreamReady) return;
    if (currentTrack?.path) {
      audio.src = convertFileSrc(currentTrack.path);
      audio.load();
      if (isPlaying) audio.play().catch(() => {});
    } else {
      audio.pause();
      audio.src = '';
    }
  }, [currentTrack, onBroadcastStreamReady]);

  useEffect(() => {
    const audio = broadcastAudioRef.current;
    if (!audio || !audio.src) return;
    if (isPlaying) audio.play().catch(() => {});
    else audio.pause();
  }, [isPlaying]);

  // Sync volume
  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.volume = isMuted ? 0 : volume / 100;
  }, [volume, isMuted]);

  const formatTime = (secs: number) => {
    if (!secs || isNaN(secs)) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const effectiveDuration = duration || currentTrack?.duration_secs || 0;
  const progressPercent = effectiveDuration > 0 ? (currentTime / effectiveDuration) * 100 : 0;

  return (
    <footer className="h-18 bg-neutral-900 border-t border-neutral-800 px-4 flex items-center justify-between select-none z-30">
      <audio
        ref={audioRef}
        preload="auto"
        onError={(e) => console.error('[Spore Audio] HTML5 audio error event:', e)}
        onTimeUpdate={() => {
          if (audioRef.current) {
            setCurrentTime(audioRef.current.currentTime);
          }
        }}
        onLoadedMetadata={() => {
          if (audioRef.current) {
            console.log('[Spore Audio] Duration loaded:', audioRef.current.duration);
            setDuration(audioRef.current.duration);
          }
        }}
        onEnded={() => {
          if (onNext) onNext();
          else onTogglePlay();
        }}
      />
      {onBroadcastStreamReady && <audio ref={broadcastAudioRef} muted preload="auto" />}

      {/* Track Info */}
      <div className="flex items-center gap-3 w-1/4 min-w-[200px]">
        <div className="w-11 h-11 bg-neutral-800 rounded-md flex items-center justify-center border border-neutral-700/60 shadow-inner">
          <Disc3
            className={`w-6 h-6 text-emerald-400 ${isPlaying ? 'animate-spin' : ''}`}
            style={{ animationDuration: '3s' }}
          />
        </div>
        <div className="truncate">
          <div className="font-semibold text-sm text-neutral-100 truncate">
            {currentTrack ? currentTrack.title : 'No track selected'}
          </div>
          <div className="text-xs text-neutral-400 truncate flex items-center gap-1.5 mt-0.5">
            <span>{currentTrack ? currentTrack.artist : 'Select a track from Shares or Search'}</span>
            {currentTrack && (
              <>
                <span className="text-neutral-600">•</span>
                <span className="px-1.5 py-0.2 bg-emerald-950/80 text-emerald-400 border border-emerald-800/60 rounded text-[10px] font-mono">
                  {currentTrack.format} {currentTrack.bitrate_kbps ? `${currentTrack.bitrate_kbps} kbps` : ''}
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Player Controls & Scrubber */}
      <div className="flex flex-col items-center gap-1.5 w-2/4 max-w-xl">
        <div className="flex items-center gap-4">
          <button
            onClick={onPrev}
            title="Previous"
            className="text-neutral-400 hover:text-neutral-100 transition-colors p-1 cursor-pointer"
          >
            <SkipBack className="w-4 h-4" />
          </button>
          <button
            onClick={onTogglePlay}
            disabled={!currentTrack}
            title={isPlaying ? 'Pause' : 'Play'}
            className="w-8 h-8 rounded-full bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-neutral-950 flex items-center justify-center transition-transform active:scale-95 shadow-md shadow-emerald-950/40 cursor-pointer"
          >
            {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
          </button>
          <button
            onClick={onNext}
            title="Next"
            className="text-neutral-400 hover:text-neutral-100 transition-colors p-1 cursor-pointer"
          >
            <SkipForward className="w-4 h-4" />
          </button>
        </div>

        <div className="w-full flex items-center gap-2 text-xs font-mono text-neutral-400">
          <span className="w-9 text-right text-[11px]">{formatTime(currentTime)}</span>
          <div
            onClick={(e) => {
              if (!effectiveDuration || !audioRef.current) return;
              const rect = e.currentTarget.getBoundingClientRect();
              const clickPos = (e.clientX - rect.left) / rect.width;
              const newTime = clickPos * effectiveDuration;
              audioRef.current.currentTime = newTime;
              setCurrentTime(newTime);
            }}
            className="flex-1 h-1.5 bg-neutral-800 rounded-full cursor-pointer relative overflow-hidden group"
          >
            <div
              className="h-full bg-emerald-500 rounded-full transition-all duration-100 group-hover:bg-emerald-400"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <span className="w-9 text-[11px]">{formatTime(effectiveDuration)}</span>
        </div>
      </div>

      {/* Volume & Details */}
      <div className="flex items-center justify-end gap-3 w-1/4">
        <button
          onClick={() => setIsMuted(!isMuted)}
          className="text-neutral-400 hover:text-neutral-200 transition-colors cursor-pointer"
          title={isMuted ? 'Unmute' : 'Mute'}
        >
          {isMuted || volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
        </button>
        <input
          type="range"
          min="0"
          max="100"
          value={isMuted ? 0 : volume}
          onChange={(e) => {
            setVolume(Number(e.target.value));
            if (isMuted) setIsMuted(false);
          }}
          className="w-20 h-1 bg-neutral-800 accent-emerald-500 cursor-pointer"
        />
      </div>
    </footer>
  );
};
