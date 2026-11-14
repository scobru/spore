import {
  ContractContainer,
  ContractKey,
  ContractType,
  DeltaUpdate,
  FreenetWsApi,
  GetRequest,
  PutRequest,
  SubscribeRequest,
  UpdateData,
  UpdateDataType,
  UpdateRequest,
  WasmContractV1,
} from "@freenetorg/freenet-stdlib";
import { ContractCodeT } from "@freenetorg/freenet-stdlib/common";
import { RelatedContractsT } from "@freenetorg/freenet-stdlib/client-request";
import { blake3 } from "@noble/hashes/blake3.js";
import { invoke } from "@tauri-apps/api/core";
import p2pWasmUrl from "../wasm/p2p_contract.wasm?url";
import { SearchResult, Track } from "../types";

export const DEFAULT_FREENET_WS_URL = "ws://127.0.0.1:7509/v1/contract/command";
const DIRECTORY_ROOM_ID = "spore-p2p-directory-v1";
const REQUEST_TIMEOUT_MS = 25_000;
const CHUNK_SIZE = 32 * 1024; // 32 KB per WebRTC DataChannel message
const MAX_BUFFERED_AMOUNT = 512 * 1024; // 512 KB backpressure cap

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

const enc = new TextEncoder();
const dec = new TextDecoder();
const asBytes = (b: Uint8Array): number[] => b as unknown as number[];
const toU8 = (s: Uint8Array | number[]): Uint8Array => (s instanceof Uint8Array ? s : new Uint8Array(s));

export interface PeerInfo {
  peer_id: string;
  username: string;
  track_count: number;
  total_bytes: number;
  ts: number;
}

export interface CatalogTrack {
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

export interface PeerCatalog {
  peer_id: string;
  username: string;
  ts: number;
  tracks: CatalogTrack[];
}

export interface P2pSignal {
  signal_id: string;
  from_peer: string;
  to_peer: string;
  created_at: number;
  offer?: string;
  answer?: string;
  ts: number;
}

export interface SporeP2pState {
  peers: Record<string, PeerInfo>;
  signals: Record<string, P2pSignal>;
  catalog?: PeerCatalog;
}

// --- Local identity & config helpers ---

export function getOrCreatePeerId(): string {
  const KEY = "spore_p2p_peer_id";
  try {
    const existing = localStorage.getItem(KEY);
    if (existing && /^[a-zA-Z0-9_-]{6,64}$/.test(existing)) return existing;
    const fresh = `peer-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
    localStorage.setItem(KEY, fresh);
    return fresh;
  } catch {
    return `peer-${Math.random().toString(36).slice(2, 10)}`;
  }
}

export function getStoredUsername(): string {
  try {
    return localStorage.getItem("spore_username") || "me_sovereign";
  } catch {
    return "me_sovereign";
  }
}

export function setStoredUsername(name: string): void {
  try {
    localStorage.setItem("spore_username", name.trim() || "me_sovereign");
  } catch {}
}

export function getStoredFreenetUrl(): string {
  try {
    return localStorage.getItem("spore_freenet_ws_url") || DEFAULT_FREENET_WS_URL;
  } catch {
    return DEFAULT_FREENET_WS_URL;
  }
}

export function setStoredFreenetUrl(url: string): void {
  try {
    localStorage.setItem("spore_freenet_ws_url", url.trim() || DEFAULT_FREENET_WS_URL);
  } catch {}
}

// --- Contract WASM & Key helpers ---

function withTimeout<T>(p: Promise<T>, label = "Freenet request"): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`${label} timed out`)), REQUEST_TIMEOUT_MS)),
  ]);
}

let cachedCode: Promise<{ code: Uint8Array; hash: Uint8Array }> | null = null;
function loadP2pContractCode(): Promise<{ code: Uint8Array; hash: Uint8Array }> {
  if (!cachedCode) {
    cachedCode = fetch(p2pWasmUrl)
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to load p2p_contract.wasm: HTTP ${r.status}`);
        return r.arrayBuffer();
      })
      .then((buf) => {
        const code = new Uint8Array(buf);
        return { code, hash: blake3(code) };
      });
  }
  return cachedCode;
}

export async function p2pContractKey(roomId: string): Promise<{
  key: ContractKey;
  code: Uint8Array;
  params: Uint8Array;
}> {
  const { code, hash } = await loadP2pContractCode();
  const params = enc.encode(roomId);
  const combined = new Uint8Array(hash.length + params.length);
  combined.set(hash, 0);
  combined.set(params, hash.length);
  const key = new ContractKey(blake3(combined), hash);
  return { key, code, params };
}

function emptyState(): SporeP2pState {
  return { peers: {}, signals: {} };
}

function parseStateBytes(raw?: number[] | Uint8Array | null): SporeP2pState | null {
  if (!raw || raw.length === 0) return null;
  try {
    const parsed = JSON.parse(dec.decode(toU8(raw))) as Partial<SporeP2pState>;
    return {
      peers: parsed.peers || {},
      signals: parsed.signals || {},
      catalog: parsed.catalog,
    };
  } catch {
    return null;
  }
}

type UpdateNotificationLike = {
  key: ContractKey;
  update?: { updateDataType?: number; updateData?: { state?: number[]; delta?: number[] } | null };
};

export async function resolveFreenetWsUrl(wsUrl: string): Promise<string> {
  if (!wsUrl.startsWith("ws://")) return wsUrl;
  try {
    return await invoke<string>("get_freenet_proxy_ws_url", { targetUrl: wsUrl });
  } catch {
    return wsUrl;
  }
}

async function openFreenetSocket(
  wsUrl: string,
  onNotify?: (n: UpdateNotificationLike) => void,
  onDrop?: (err: Error) => void
): Promise<FreenetWsApi> {
  const effectiveUrl = await resolveFreenetWsUrl(wsUrl);
  return withTimeout(
    new Promise<FreenetWsApi>((resolve, reject) => {
      let opened = false;
      const api = new FreenetWsApi(
        new URL(effectiveUrl),
        {
          onContractPut: () => {},
          onContractGet: () => {},
          onContractUpdate: () => {},
          onContractUpdateNotification: (n) => onNotify?.(n as unknown as UpdateNotificationLike),
          onContractNotFound: () => {},
          onDelegateResponse: () => {},
          onErr: (e) => {
            const msg = e?.cause ? String(e.cause) : JSON.stringify(e);
            if (!opened) reject(new Error(`Freenet error: ${msg}`));
          },
          onOpen: () => {
            opened = true;
            resolve(api);
          },
          onClose: () => {
            const err = new Error(`Freenet node connection closed (${wsUrl})`);
            if (!opened) reject(err);
            else onDrop?.(err);
          },
        },
        ""
      );
    }),
    "Freenet node connection"
  );
}

function closeApi(api: FreenetWsApi | null) {
  if (!api) return;
  try {
    (api as unknown as { ws?: WebSocket }).ws?.close();
  } catch {}
}

async function getOrNull(api: FreenetWsApi, key: ContractKey): Promise<SporeP2pState | null> {
  try {
    const res = await withTimeout(api.get(new GetRequest(key, false, false, false)), "Freenet get");
    const raw = (res as { state?: Uint8Array | number[] })?.state;
    return parseStateBytes(raw);
  } catch {
    return null;
  }
}

async function putOrUpdate(
  api: FreenetWsApi,
  roomId: string,
  deltaState: Partial<SporeP2pState>
): Promise<void> {
  const { key, code, params } = await p2pContractKey(roomId);
  const fullPayload: SporeP2pState = {
    peers: deltaState.peers || {},
    signals: deltaState.signals || {},
    ...(deltaState.catalog ? { catalog: deltaState.catalog } : {}),
  };
  const bytes = enc.encode(JSON.stringify(fullPayload));

  const existing = await getOrNull(api, key);
  if (!existing) {
    const contract = new WasmContractV1(
      new ContractCodeT(asBytes(code), asBytes(key.codePart() ?? new Uint8Array())),
      asBytes(params),
      key
    );
    const container = new ContractContainer(ContractType.WasmContractV1, contract);
    await withTimeout(
      api.put(new PutRequest(container, asBytes(bytes), new RelatedContractsT(), false)),
      "Freenet put"
    );
  } else {
    const update = new UpdateData(UpdateDataType.DeltaUpdate, new DeltaUpdate(asBytes(bytes)));
    await withTimeout(api.update(new UpdateRequest(key, update)), "Freenet update");
  }
}

// --- Public Catalog & Discovery API ---

export async function publishCatalogToFreenet(
  peerId: string,
  username: string,
  shares: Track[],
  wsUrl = getStoredFreenetUrl()
): Promise<{ publishedTracks: number }> {
  const api = await openFreenetSocket(wsUrl);
  try {
    const ts = Date.now();
    const capped = shares.slice(0, 2000);
    const catalogTracks: CatalogTrack[] = capped.map((t) => ({
      filename: t.filename,
      title: t.title,
      artist: t.artist,
      album: t.album,
      genre: t.genre,
      ...(t.year !== undefined ? { year: t.year } : {}),
      duration_secs: t.duration_secs,
      ...(t.bitrate_kbps !== undefined ? { bitrate_kbps: t.bitrate_kbps } : {}),
      ...(t.sample_rate !== undefined ? { sample_rate: t.sample_rate } : {}),
      format: t.format,
      size_bytes: t.size_bytes,
      blake3_hash: t.blake3_hash,
    }));

    await putOrUpdate(api, `spore-catalog:${peerId}`, {
      catalog: {
        peer_id: peerId,
        username,
        ts,
        tracks: catalogTracks,
      },
    });

    const totalBytes = capped.reduce((acc, t) => acc + t.size_bytes, 0);
    await putOrUpdate(api, DIRECTORY_ROOM_ID, {
      peers: {
        [peerId]: {
          peer_id: peerId,
          username,
          track_count: catalogTracks.length,
          total_bytes: totalBytes,
          ts,
        },
      },
    });

    return { publishedTracks: catalogTracks.length };
  } finally {
    closeApi(api);
  }
}

export async function fetchNetworkCatalogs(
  myPeerId: string,
  wsUrl = getStoredFreenetUrl()
): Promise<{ peers: PeerInfo[]; results: SearchResult[] }> {
  const api = await openFreenetSocket(wsUrl);
  try {
    const { key: dirKey } = await p2pContractKey(DIRECTORY_ROOM_ID);
    const dirState = (await getOrNull(api, dirKey)) || emptyState();
    const peers = Object.values(dirState.peers).sort((a, b) => b.ts - a.ts);

    const results: SearchResult[] = [];
    for (const peer of peers) {
      if (peer.peer_id === myPeerId) continue;
      const { key: catKey } = await p2pContractKey(`spore-catalog:${peer.peer_id}`);
      const catState = await getOrNull(api, catKey);
      const tracks = catState?.catalog?.tracks || [];
      tracks.forEach((ct, i) => {
        results.push({
          id: `net-${peer.peer_id}-${ct.blake3_hash || i}`,
          peerUser: peer.username,
          peerId: peer.peer_id,
          freeSlots: 4,
          queueLength: 0,
          speedKbps: 5000,
          track: {
            ...ct,
            path: "",
          },
        });
      });
    }

    return { peers, results };
  } finally {
    closeApi(api);
  }
}

// --- Binary framing over WebRTC DataChannel ---
// Header: 64 bytes transferId (UTF-8, null-padded) + 8 bytes Float64LE offset = 72 bytes.

const HEADER_BYTES = 72;

function encodeChunkFrame(transferId: string, offset: number, chunk: Uint8Array): ArrayBuffer {
  const frame = new Uint8Array(HEADER_BYTES + chunk.byteLength);
  const idBytes = enc.encode(transferId);
  frame.set(idBytes.subarray(0, 64), 0);
  const view = new DataView(frame.buffer);
  view.setFloat64(64, offset, true);
  frame.set(chunk, HEADER_BYTES);
  return frame.buffer;
}

function decodeChunkFrame(buf: ArrayBuffer): { transferId: string; offset: number; chunk: Uint8Array } {
  const bytes = new Uint8Array(buf);
  let idEnd = 64;
  for (let i = 0; i < 64; i++) {
    if (bytes[i] === 0) {
      idEnd = i;
      break;
    }
  }
  const transferId = dec.decode(bytes.subarray(0, idEnd));
  const view = new DataView(buf);
  const offset = view.getFloat64(64, true);
  const chunk = bytes.subarray(HEADER_BYTES);
  return { transferId, offset, chunk };
}

function encodeSignal(desc: RTCSessionDescriptionInit): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify(desc))));
}

function decodeSignal(code: string): RTCSessionDescriptionInit {
  return JSON.parse(decodeURIComponent(escape(atob(code.trim()))));
}

function waitIceGatheringComplete(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      pc.removeEventListener("icegatheringstatechange", check);
      clearTimeout(timer);
      resolve();
    };
    const check = () => pc.iceGatheringState === "complete" && done();
    pc.addEventListener("icegatheringstatechange", check);
    const timer = setTimeout(done, 4000);
  });
}

// --- P2P Node for Seeding & Downloading ---

export interface DownloadCallbacks {
  onProgress: (transferredBytes: number, speedBps: number, etaSecs: number) => void;
  onComplete: (localPath: string) => void;
  onError: (err: string) => void;
}

export interface UploadEventCallbacks {
  onUploadStart: (transferId: string, peerUser: string, peerId: string, track: Track) => void;
  onUploadProgress: (transferId: string, transferredBytes: number, speedBps: number, etaSecs: number) => void;
  onUploadComplete: (transferId: string) => void;
  onUploadError: (transferId: string, err: string) => void;
}

interface ActiveDownload {
  transferId: string;
  track: Track;
  destDir: string;
  receivedBytes: number;
  lastTickTime: number;
  lastTickBytes: number;
  paused: boolean;
  cancelled: boolean;
  callbacks: DownloadCallbacks;
}

export class FreenetP2pNode {
  private api: FreenetWsApi | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private myPeerId = "";
  private wsUrl = DEFAULT_FREENET_WS_URL;
  private getShares: () => Track[] = () => [];
  private uploadCallbacks: UploadEventCallbacks | null = null;

  private peerChannels = new Map<string, { pc: RTCPeerConnection; dc: RTCDataChannel }>();
  private handledIncomingSignals = new Set<string>();
  private pendingOutgoingSignals = new Map<
    string,
    {
      pc: RTCPeerConnection;
      dc: RTCDataChannel;
      resolve: (dc: RTCDataChannel) => void;
      reject: (err: Error) => void;
    }
  >();
  private activeDownloads = new Map<string, ActiveDownload>();
  private cancelledUploads = new Set<string>();

  async start(
    myPeerId: string,
    wsUrl: string,
    getShares: () => Track[],
    uploadCallbacks: UploadEventCallbacks
  ): Promise<void> {
    this.stop();
    this.stopped = false;
    this.myPeerId = myPeerId;
    this.wsUrl = wsUrl;
    this.getShares = getShares;
    this.uploadCallbacks = uploadCallbacks;

    const api = await openFreenetSocket(
      wsUrl,
      (n) => {
        const u = n.update;
        const raw = u?.updateDataType === 2 ? u.updateData?.delta : u?.updateData?.state;
        const st = parseStateBytes(raw);
        if (st) void this.handleDirectoryState(st);
      },
      () => {}
    );
    if (this.stopped) {
      closeApi(api);
      return;
    }
    this.api = api;

    const { key } = await p2pContractKey(DIRECTORY_ROOM_ID);
    const existing = await getOrNull(api, key);
    if (existing) {
      await this.handleDirectoryState(existing);
    }
    try {
      await api.subscribe(new SubscribeRequest(key, undefined));
    } catch {}

    this.pollTimer = setInterval(() => {
      if (!this.api || this.stopped) return;
      void getOrNull(this.api, key).then((st) => {
        if (st) void this.handleDirectoryState(st);
      });
    }, 3000);
  }

  stop(): void {
    this.stopped = true;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    for (const { pc, dc } of this.peerChannels.values()) {
      try {
        dc.close();
        pc.close();
      } catch {}
    }
    this.peerChannels.clear();
    for (const pending of this.pendingOutgoingSignals.values()) {
      pending.reject(new Error("P2P node stopped"));
      try {
        pending.pc.close();
      } catch {}
    }
    this.pendingOutgoingSignals.clear();
    closeApi(this.api);
    this.api = null;
  }

  private async handleDirectoryState(state: SporeP2pState): Promise<void> {
    if (this.stopped || !this.api) return;

    for (const [sigId, sig] of Object.entries(state.signals)) {
      // 1. Incoming offer for us
      if (sig.to_peer === this.myPeerId && sig.offer && !sig.answer && !this.handledIncomingSignals.has(sigId)) {
        this.handledIncomingSignals.add(sigId);
        void this.acceptOffer(sigId, sig);
      }

      // 2. Answer to our outgoing offer
      if (sig.from_peer === this.myPeerId && sig.answer) {
        const pending = this.pendingOutgoingSignals.get(sigId);
        if (pending) {
          this.pendingOutgoingSignals.delete(sigId);
          void this.completeOutgoingOffer(sig.to_peer, pending, sig.answer);
        }
      }
    }
  }

  private async acceptOffer(sigId: string, sig: P2pSignal): Promise<void> {
    if (!this.api || !sig.offer) return;
    const pc = new RTCPeerConnection(RTC_CONFIG);

    pc.ondatachannel = (ev) => {
      const dc = ev.channel;
      this.wireDataChannel(sig.from_peer, pc, dc);
    };

    try {
      await pc.setRemoteDescription(decodeSignal(sig.offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await waitIceGatheringComplete(pc);

      const encodedAnswer = encodeSignal(pc.localDescription!);
      await putOrUpdate(this.api, DIRECTORY_ROOM_ID, {
        signals: {
          [sigId]: {
            ...sig,
            answer: encodedAnswer,
            ts: Date.now(),
          },
        },
      });
    } catch (err) {
      console.warn("[Spore P2P] Failed to accept offer:", err);
      pc.close();
    }
  }

  private async completeOutgoingOffer(
    remotePeerId: string,
    pending: {
      pc: RTCPeerConnection;
      dc: RTCDataChannel;
      resolve: (dc: RTCDataChannel) => void;
      reject: (err: Error) => void;
    },
    encodedAnswer: string
  ): Promise<void> {
    try {
      await pending.pc.setRemoteDescription(decodeSignal(encodedAnswer));
      if (pending.dc.readyState === "open") {
        this.wireDataChannel(remotePeerId, pending.pc, pending.dc);
        pending.resolve(pending.dc);
      } else {
        pending.dc.addEventListener(
          "open",
          () => {
            this.wireDataChannel(remotePeerId, pending.pc, pending.dc);
            pending.resolve(pending.dc);
          },
          { once: true }
        );
      }
    } catch (err) {
      pending.reject(err instanceof Error ? err : new Error(String(err)));
    }
  }

  private wireDataChannel(remotePeerId: string, pc: RTCPeerConnection, dc: RTCDataChannel) {
    dc.binaryType = "arraybuffer";
    this.peerChannels.set(remotePeerId, { pc, dc });

    dc.onclose = () => {
      const cur = this.peerChannels.get(remotePeerId);
      if (cur?.dc === dc) this.peerChannels.delete(remotePeerId);
    };

    dc.onmessage = (ev) => {
      if (typeof ev.data === "string") {
        try {
          const msg = JSON.parse(ev.data) as {
            type: string;
            transferId?: string;
            blake3_hash?: string;
            offset?: number;
            error?: string;
          };
          void this.handleControlMessage(remotePeerId, dc, msg);
        } catch {}
      } else if (ev.data instanceof ArrayBuffer) {
        void this.handleBinaryChunk(ev.data);
      }
    };
  }

  private async handleControlMessage(
    remotePeerId: string,
    dc: RTCDataChannel,
    msg: { type: string; transferId?: string; blake3_hash?: string; offset?: number; error?: string }
  ) {
    if (msg.type === "request_file" && msg.transferId && msg.blake3_hash) {
      const track = this.getShares().find((t) => t.blake3_hash === msg.blake3_hash);
      if (!track || !track.path) {
        dc.send(JSON.stringify({ type: "file_error", transferId: msg.transferId, error: "Track not found on peer" }));
        return;
      }
      void this.streamFileToPeer(dc, msg.transferId, remotePeerId, track, msg.offset || 0);
    } else if (msg.type === "cancel_file" && msg.transferId) {
      this.cancelledUploads.add(msg.transferId);
    } else if (msg.type === "file_done" && msg.transferId) {
      const dl = this.activeDownloads.get(msg.transferId);
      if (!dl || dl.cancelled) return;
      this.activeDownloads.delete(msg.transferId);
      try {
        const finalPath = await invoke<string>("finalize_download", {
          destDir: dl.destDir,
          filename: dl.track.filename,
          expectedBlake3: dl.track.blake3_hash,
        });
        dl.callbacks.onComplete(finalPath);
      } catch (err) {
        dl.callbacks.onError(err instanceof Error ? err.message : String(err));
      }
    } else if (msg.type === "file_error" && msg.transferId) {
      const dl = this.activeDownloads.get(msg.transferId);
      if (dl) {
        this.activeDownloads.delete(msg.transferId);
        dl.callbacks.onError(msg.error || "Remote peer failed to send file");
      }
    }
  }

  private async streamFileToPeer(
    dc: RTCDataChannel,
    transferId: string,
    remotePeerId: string,
    track: Track,
    startOffset: number
  ) {
    this.cancelledUploads.delete(transferId);
    this.uploadCallbacks?.onUploadStart(transferId, remotePeerId, remotePeerId, track);

    let offset = startOffset;
    const total = track.size_bytes;
    let lastTick = performance.now();
    let lastBytes = offset;

    try {
      while (offset < total) {
        if (this.stopped || dc.readyState !== "open" || this.cancelledUploads.has(transferId)) {
          return;
        }

        if (dc.bufferedAmount > MAX_BUFFERED_AMOUNT) {
          await new Promise((r) => setTimeout(r, 20));
          continue;
        }

        const chunkVec = await invoke<number[]>("read_file_chunk", {
          filePath: track.path,
          offset,
          length: CHUNK_SIZE,
        });

        if (chunkVec.length === 0) break;

        const chunkU8 = new Uint8Array(chunkVec);
        dc.send(encodeChunkFrame(transferId, offset, chunkU8));
        offset += chunkU8.byteLength;

        const now = performance.now();
        if (now - lastTick >= 350 || offset >= total) {
          const dt = Math.max((now - lastTick) / 1000, 0.05);
          const speedBps = (offset - lastBytes) / dt;
          const etaSecs = speedBps > 0 ? Math.ceil((total - offset) / speedBps) : 0;
          this.uploadCallbacks?.onUploadProgress(transferId, offset, speedBps, etaSecs);
          lastTick = now;
          lastBytes = offset;
        }
      }

      dc.send(JSON.stringify({ type: "file_done", transferId, blake3_hash: track.blake3_hash }));
      this.uploadCallbacks?.onUploadComplete(transferId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      try {
        dc.send(JSON.stringify({ type: "file_error", transferId, error: msg }));
      } catch {}
      this.uploadCallbacks?.onUploadError(transferId, msg);
    }
  }

  private async handleBinaryChunk(buf: ArrayBuffer) {
    const { transferId, offset, chunk } = decodeChunkFrame(buf);
    const dl = this.activeDownloads.get(transferId);
    if (!dl || dl.cancelled) return;

    try {
      await invoke("write_file_chunk", {
        destDir: dl.destDir,
        filename: dl.track.filename,
        offset,
        data: Array.from(chunk),
      });

      dl.receivedBytes = Math.max(dl.receivedBytes, offset + chunk.byteLength);
      const now = performance.now();
      if (now - dl.lastTickTime >= 300 || dl.receivedBytes >= dl.track.size_bytes) {
        const dt = Math.max((now - dl.lastTickTime) / 1000, 0.05);
        const speedBps = (dl.receivedBytes - dl.lastTickBytes) / dt;
        const remaining = Math.max(0, dl.track.size_bytes - dl.receivedBytes);
        const etaSecs = speedBps > 0 ? Math.ceil(remaining / speedBps) : 0;
        dl.callbacks.onProgress(dl.receivedBytes, speedBps, etaSecs);
        dl.lastTickTime = now;
        dl.lastTickBytes = dl.receivedBytes;
      }
    } catch (err) {
      this.activeDownloads.delete(transferId);
      dl.callbacks.onError(err instanceof Error ? err.message : String(err));
    }
  }

  private async getOrConnectChannel(targetPeerId: string): Promise<RTCDataChannel> {
    const existing = this.peerChannels.get(targetPeerId);
    if (existing && existing.dc.readyState === "open") {
      return existing.dc;
    }

    if (!this.api) {
      await this.start(this.myPeerId, this.wsUrl, this.getShares, this.uploadCallbacks!);
    }
    if (!this.api) {
      throw new Error("Freenet node not connected");
    }

    const pc = new RTCPeerConnection(RTC_CONFIG);
    const dc = pc.createDataChannel("spore-p2p", { ordered: true });
    dc.binaryType = "arraybuffer";

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitIceGatheringComplete(pc);

    const sigId = `${this.myPeerId}__${targetPeerId}__${Date.now()}`;
    const encodedOffer = encodeSignal(pc.localDescription!);

    return new Promise<RTCDataChannel>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingOutgoingSignals.delete(sigId);
        try {
          pc.close();
        } catch {}
        reject(new Error("Peer did not answer P2P handshake in time"));
      }, 25_000);

      this.pendingOutgoingSignals.set(sigId, {
        pc,
        dc,
        resolve: (openDc) => {
          clearTimeout(timeout);
          resolve(openDc);
        },
        reject: (err) => {
          clearTimeout(timeout);
          reject(err);
        },
      });

      void putOrUpdate(this.api!, DIRECTORY_ROOM_ID, {
        signals: {
          [sigId]: {
            signal_id: sigId,
            from_peer: this.myPeerId,
            to_peer: targetPeerId,
            created_at: Date.now(),
            offer: encodedOffer,
            ts: Date.now(),
          },
        },
      }).catch((err) => {
        clearTimeout(timeout);
        this.pendingOutgoingSignals.delete(sigId);
        pc.close();
        reject(err instanceof Error ? err : new Error(String(err)));
      });
    });
  }

  async startDownload(
    transferId: string,
    targetPeerId: string,
    track: Track,
    destDir: string,
    callbacks: DownloadCallbacks
  ): Promise<void> {
    this.activeDownloads.set(transferId, {
      transferId,
      track,
      destDir,
      receivedBytes: 0,
      lastTickTime: performance.now(),
      lastTickBytes: 0,
      paused: false,
      cancelled: false,
      callbacks,
    });

    try {
      const dc = await this.getOrConnectChannel(targetPeerId);
      const dl = this.activeDownloads.get(transferId);
      if (!dl || dl.cancelled) return;
      dc.send(
        JSON.stringify({
          type: "request_file",
          transferId,
          blake3_hash: track.blake3_hash,
          offset: 0,
        })
      );
    } catch (err) {
      this.activeDownloads.delete(transferId);
      callbacks.onError(err instanceof Error ? err.message : String(err));
    }
  }

  cancelDownload(transferId: string, targetPeerId?: string, destDir?: string, filename?: string): void {
    const dl = this.activeDownloads.get(transferId);
    if (dl) {
      dl.cancelled = true;
      this.activeDownloads.delete(transferId);
    }
    if (targetPeerId) {
      const ch = this.peerChannels.get(targetPeerId);
      if (ch && ch.dc.readyState === "open") {
        try {
          ch.dc.send(JSON.stringify({ type: "cancel_file", transferId }));
        } catch {}
      }
    }
    if (destDir && filename) {
      void invoke("cancel_download_part", { destDir, filename }).catch(() => {});
    }
  }
}
