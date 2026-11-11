export interface Track {
  path: string;
  filename: string;
  title: string;
  artist: string;
  album: string;
  genre: string;
  year?: number;
  duration_secs: number;
  bitrate_kbps?: number;
  sample_rate?: number;
  format: string;
  size_bytes: number;
  blake3_hash: string;
}

export interface SearchResult {
  id: string;
  track: Track;
  peerUser: string;
  freeSlots: number;
  queueLength: number;
  speedKbps: number;
}

export interface TransferItem {
  id: string;
  track: Track;
  peerUser: string;
  type: 'download' | 'upload';
  status: 'queued' | 'transferring' | 'completed' | 'paused' | 'failed';
  progressPercent: number;
  speedBps: number;
  transferredBytes: number;
  etaSecs: number;
}

export interface RadioStationState {
  isBroadcasting: boolean;
  stationName: string;
  genre: string;
  djName: string;
  djKey: string;
  nowPlaying: Track | null;
  elapsedSeconds: number;
  listenersCount: number;
  lastHeartbeat: number;
  queue: Track[];
  currentQueueIndex: number;
  bufferMode: 'ring_buffer' | 'webrtc';
  ringBufferSlot: number;
}
