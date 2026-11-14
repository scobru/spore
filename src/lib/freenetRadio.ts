import {
  ContractContainer,
  ContractKey,
  ContractType,
  DeltaUpdate,
  FreenetWsApi,
  GetRequest,
  PutRequest,
  UpdateData,
  UpdateDataType,
  UpdateRequest,
  WasmContractV1,
} from "@freenetorg/freenet-stdlib";
import { ContractCodeT } from "@freenetorg/freenet-stdlib/common";
import { RelatedContractsT } from "@freenetorg/freenet-stdlib/client-request";
import { blake3 } from "@noble/hashes/blake3.js";
import radioWasmUrl from "../wasm/radio_contract.wasm?url";
import { completeRadioOffer, createRadioOffer, joinRadioOffer } from "./webrtcSignal";

export interface StationInfo {
  station_name: string;
  genre: string;
  dj_name: string;
  now_playing: string;
  live: boolean;
  ts: number;
}

export interface SignalEntry {
  listener_id: string;
  joined_at: number;
  offer?: string;
  answer?: string;
  ts: number;
}

export interface RadioRoomState {
  station?: StationInfo;
  signals: Record<string, SignalEntry>;
}

export interface ListenerPeerInfo {
  id: string;
  state: RTCPeerConnectionState;
}

const enc = new TextEncoder();
const dec = new TextDecoder();
const asBytes = (b: Uint8Array): number[] => b as unknown as number[];
const toU8 = (s: Uint8Array | number[]): Uint8Array => (s instanceof Uint8Array ? s : new Uint8Array(s));

const REQUEST_TIMEOUT_MS = 25_000;
const FREENET_WS_URL = "ws://127.0.0.1:7509/v1/contract/command";

function withTimeout<T>(p: Promise<T>, label = "Freenet request"): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`${label} timed out`)), REQUEST_TIMEOUT_MS)),
  ]);
}

let cachedCode: Promise<{ code: Uint8Array; hash: Uint8Array }> | null = null;
function loadRadioContractCode(): Promise<{ code: Uint8Array; hash: Uint8Array }> {
  if (!cachedCode) {
    cachedCode = fetch(radioWasmUrl)
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to load radio_contract.wasm: HTTP ${r.status}`);
        return r.arrayBuffer();
      })
      .then((buf) => {
        const code = new Uint8Array(buf);
        return { code, hash: blake3(code) };
      });
  }
  return cachedCode;
}

export async function radioContractKey(roomId: string): Promise<{
  key: ContractKey;
  code: Uint8Array;
  params: Uint8Array;
}> {
  const { code, hash } = await loadRadioContractCode();
  const params = enc.encode(roomId);
  const combined = new Uint8Array(hash.length + params.length);
  combined.set(hash, 0);
  combined.set(params, hash.length);
  const key = new ContractKey(blake3(combined), hash);
  return { key, code, params };
}

/** Extract the room ID from `spore:radio:<id>`, `spore://radio/<id>`, markdown links, or a plain ID. */
export function normalizeRoomId(input: string): string {
  const trimmed = input.trim();
  const md = /\[[^\]]+\]\((?:spore:radio:|spore:\/\/radio\/|#\/?spore-radio[\/=])([a-zA-Z0-9_-]{3,64})\)/i.exec(trimmed);
  if (md) return md[1];
  const uri = /(?:spore:radio:|spore:\/\/radio\/|#\/?spore-radio[\/=])([a-zA-Z0-9_-]{3,64})/i.exec(trimmed);
  if (uri) return uri[1];
  return trimmed;
}

export function getOrCreateLocalRoomId(): string {
  const STORAGE_KEY = "spore_radio_room_id";
  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    if (existing && /^[a-zA-Z0-9_-]{3,64}$/.test(existing)) return existing;
    const fresh = `sp-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(STORAGE_KEY, fresh);
    return fresh;
  } catch {
    return `sp-${Math.random().toString(36).slice(2, 10)}`;
  }
}

export function regenerateLocalRoomId(): string {
  const fresh = `sp-${Math.random().toString(36).slice(2, 10)}`;
  try {
    localStorage.setItem("spore_radio_room_id", fresh);
  } catch {
    // ignore storage errors
  }
  return fresh;
}

type UpdateNotificationLike = {
  key: ContractKey;
  update?: { updateDataType?: number; updateData?: { state?: number[]; delta?: number[] } | null };
};

function parseNotificationState(n: UpdateNotificationLike): RadioRoomState | null {
  const u = n.update;
  const raw = u?.updateDataType === 2 ? u.updateData?.delta : u?.updateData?.state;
  if (!raw?.length) return null;
  try {
    return JSON.parse(dec.decode(Uint8Array.from(raw))) as RadioRoomState;
  } catch {
    return null;
  }
}

function openFreenetSocket(
  onNotify: (n: UpdateNotificationLike) => void,
  onDrop?: (err: Error) => void
): Promise<FreenetWsApi> {
  return withTimeout(
    new Promise<FreenetWsApi>((resolve, reject) => {
      let opened = false;
      const api = new FreenetWsApi(
        new URL(FREENET_WS_URL),
        {
          onContractPut: () => {},
          onContractGet: () => {},
          onContractUpdate: () => {},
          onContractUpdateNotification: (n) => onNotify(n as unknown as UpdateNotificationLike),
          onContractNotFound: () => {},
          onDelegateResponse: () => {},
          onErr: (e) => {
            const msg = e?.cause ? String(e.cause) : JSON.stringify(e);
            console.warn("[Spore Radio Freenet]", msg);
            if (!opened) reject(new Error(`Freenet error: ${msg}`));
          },
          onOpen: () => {
            opened = true;
            resolve(api);
          },
          onClose: () => {
            const err = new Error("Freenet node connection closed (is Freenet running on 127.0.0.1:7509?)");
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
  } catch {
    // ignore
  }
}

export class FreenetRadioBroadcaster {
  private api: FreenetWsApi | null = null;
  private key: ContractKey | null = null;
  private peers = new Map<string, { pc: RTCPeerConnection; answerApplied: boolean }>();
  private negotiating = new Set<string>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private lastStation: StationInfo | null = null;

  async start(
    roomId: string,
    station: StationInfo,
    stream: MediaStream,
    callbacks: {
      onListenersChange: (listeners: ListenerPeerInfo[]) => void;
      onStatus?: (status: string) => void;
      onError?: (err: string) => void;
    }
  ): Promise<void> {
    this.stopped = false;
    this.lastStation = station;
    callbacks.onStatus?.("Connecting to local Freenet node (127.0.0.1:7509)…");

    const { key, code, params } = await radioContractKey(roomId);
    this.key = key;
    const keyStr = key.encode();

    const handleState = async (state: RadioRoomState) => {
      if (this.stopped || !this.api || !this.key) return;
      const entries = Object.values(state.signals ?? {});
      for (const sig of entries) {
        // 1. New listener joined without an offer yet -> create WebRTC offer & push it
        if (!sig.offer && !this.peers.has(sig.listener_id) && !this.negotiating.has(sig.listener_id)) {
          this.negotiating.add(sig.listener_id);
          void (async () => {
            try {
              const { pc, inviteCode } = await createRadioOffer(stream);
              if (this.stopped) {
                pc.close();
                return;
              }
              this.peers.set(sig.listener_id, { pc, answerApplied: false });
              pc.addEventListener("connectionstatechange", () => {
                this.emitListeners(callbacks.onListenersChange);
              });
              this.emitListeners(callbacks.onListenersChange);

              const delta: RadioRoomState = {
                signals: {
                  [sig.listener_id]: {
                    ...sig,
                    offer: inviteCode,
                    ts: Date.now(),
                  },
                },
              };
              await this.pushDelta(delta);
            } catch (e) {
              callbacks.onError?.(e instanceof Error ? e.message : String(e));
            } finally {
              this.negotiating.delete(sig.listener_id);
            }
          })();
        }

        // 2. Listener posted an answer -> complete the WebRTC handshake
        const existing = this.peers.get(sig.listener_id);
        if (existing && !existing.answerApplied && sig.answer) {
          existing.answerApplied = true;
          void completeRadioOffer(existing.pc, sig.answer).catch((e) => {
            callbacks.onError?.(e instanceof Error ? e.message : String(e));
          });
        }
      }
    };

    this.api = await openFreenetSocket(
      (n) => {
        if (n.key.encode() !== keyStr) return;
        const parsed = parseNotificationState(n);
        if (parsed) void handleState(parsed);
      },
      (err) => {
        if (!this.stopped) callbacks.onError?.(err.message);
      }
    );

    const initialState: RadioRoomState = {
      station,
      signals: {},
    };
    const stateBytes = enc.encode(JSON.stringify(initialState));
    const contract = new WasmContractV1(
      new ContractCodeT(asBytes(code), asBytes(key.codePart() ?? new Uint8Array())),
      asBytes(params),
      key
    );

    callbacks.onStatus?.("Publishing radio room on Freenet…");
    try {
      await withTimeout(
        this.api.put(
          new PutRequest(
            new ContractContainer(ContractType.WasmContractV1, contract),
            asBytes(stateBytes),
            new RelatedContractsT(),
            true
          )
        ),
        "Publish radio room"
      );
    } catch {
      // Contract may already exist on the network; update station info & subscribe instead
      await this.pushDelta({ station, signals: {} });
      await withTimeout(this.api.get(new GetRequest(key, false, true)), "Subscribe radio room");
    }

    callbacks.onStatus?.("Live on Freenet P2P");

    // Safety poll every 3s in case a notification was missed
    this.pollTimer = setInterval(() => {
      if (this.stopped || !this.api || !this.key) return;
      void this.api
        .get(new GetRequest(this.key, false, true))
        .then((r) => {
          if (r.state.length) {
            const parsed = JSON.parse(dec.decode(toU8(r.state))) as RadioRoomState;
            void handleState(parsed);
          }
        })
        .catch(() => {});
    }, 3000);
  }

  private async pushDelta(delta: RadioRoomState): Promise<void> {
    if (!this.api || !this.key) return;
    const bytes = enc.encode(JSON.stringify(delta));
    await withTimeout(
      this.api.update(new UpdateRequest(this.key, new UpdateData(UpdateDataType.DeltaUpdate, new DeltaUpdate(asBytes(bytes))))),
      "Update radio room"
    );
  }

  async updateStation(station: StationInfo): Promise<void> {
    this.lastStation = station;
    if (this.stopped) return;
    await this.pushDelta({ station, signals: {} });
  }

  private emitListeners(cb: (listeners: ListenerPeerInfo[]) => void) {
    cb(
      Array.from(this.peers.entries()).map(([id, { pc }]) => ({
        id,
        state: pc.connectionState,
      }))
    );
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.lastStation && this.api && this.key) {
      await this.pushDelta({
        station: { ...this.lastStation, live: false, ts: Date.now() },
        signals: {},
      }).catch(() => {});
    }
    for (const { pc } of this.peers.values()) {
      pc.close();
    }
    this.peers.clear();
    this.negotiating.clear();
    closeApi(this.api);
    this.api = null;
    this.key = null;
  }
}

export class FreenetRadioListener {
  private api: FreenetWsApi | null = null;
  private pc: RTCPeerConnection | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;

  async join(
    linkOrRoomId: string,
    callbacks: {
      onStatus: (status: string) => void;
      onConnectionState: (state: RTCPeerConnectionState) => void;
      onStationUpdate: (station: StationInfo) => void;
      onStream: (stream: MediaStream) => void;
      onError: (err: string) => void;
    }
  ): Promise<void> {
    this.stopped = false;
    const roomId = normalizeRoomId(linkOrRoomId);
    if (!roomId) {
      callbacks.onError("Invalid radio link or room ID.");
      return;
    }

    const listenerId = `l-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
    let answered = false;
    let joinedAt = Date.now();

    callbacks.onStatus("Connecting to Freenet node…");
    const { key } = await radioContractKey(roomId);
    const keyStr = key.encode();

    const handleState = (state: RadioRoomState) => {
      if (this.stopped) return;
      if (state.station) {
        callbacks.onStationUpdate(state.station);
      }
      const mySig = state.signals?.[listenerId];
      if (mySig?.offer && !answered) {
        answered = true;
        callbacks.onStatus("Negotiating P2P audio…");
        void (async () => {
          try {
            const { pc, answerCode, remoteStream } = await joinRadioOffer(mySig.offer!);
            if (this.stopped) {
              pc.close();
              return;
            }
            this.pc = pc;
            pc.addEventListener("connectionstatechange", () => {
              callbacks.onConnectionState(pc.connectionState);
              if (pc.connectionState === "connected") {
                callbacks.onStatus("Connected & Listening");
                if (this.pollTimer) {
                  clearInterval(this.pollTimer);
                  this.pollTimer = null;
                }
              }
            });
            callbacks.onConnectionState(pc.connectionState);

            void remoteStream.then((stream) => {
              if (!this.stopped) callbacks.onStream(stream);
            });

            const answerDelta: RadioRoomState = {
              signals: {
                [listenerId]: {
                  listener_id: listenerId,
                  joined_at: joinedAt,
                  offer: mySig.offer,
                  answer: answerCode,
                  ts: Date.now(),
                },
              },
            };
            if (this.api) {
              await withTimeout(
                this.api.update(
                  new UpdateRequest(
                    key,
                    new UpdateData(UpdateDataType.DeltaUpdate, new DeltaUpdate(asBytes(enc.encode(JSON.stringify(answerDelta)))))
                  )
                ),
                "Send WebRTC answer"
              );
            }
          } catch (e) {
            callbacks.onError(e instanceof Error ? e.message : String(e));
          }
        })();
      }
    };

    this.api = await openFreenetSocket(
      (n) => {
        if (n.key.encode() !== keyStr) return;
        const parsed = parseNotificationState(n);
        if (parsed) handleState(parsed);
      },
      (err) => {
        if (!this.stopped) callbacks.onError(err.message);
      }
    );

    callbacks.onStatus("Looking up station on Freenet…");
    try {
      const getRes = await withTimeout(this.api.get(new GetRequest(key, true, true)), "Find radio station");
      if (getRes.state.length) {
        const parsed = JSON.parse(dec.decode(toU8(getRes.state))) as RadioRoomState;
        handleState(parsed);
      }
    } catch {
      callbacks.onError("Station not found on Freenet (check the link or make sure the DJ is broadcasting).");
      return;
    }

    callbacks.onStatus("Requesting audio stream…");
    const joinDelta: RadioRoomState = {
      signals: {
        [listenerId]: {
          listener_id: listenerId,
          joined_at: joinedAt,
          ts: joinedAt,
        },
      },
    };
    await withTimeout(
      this.api.update(
        new UpdateRequest(
          key,
          new UpdateData(UpdateDataType.DeltaUpdate, new DeltaUpdate(asBytes(enc.encode(JSON.stringify(joinDelta)))))
        )
      ),
      "Join radio room"
    );

    // Poll every 2s until WebRTC connects
    this.pollTimer = setInterval(() => {
      if (this.stopped || !this.api || answered) return;
      void this.api
        .get(new GetRequest(key, false, true))
        .then((r) => {
          if (r.state.length) {
            const parsed = JSON.parse(dec.decode(toU8(r.state))) as RadioRoomState;
            handleState(parsed);
          }
        })
        .catch(() => {});
    }, 2000);
  }

  leave(): void {
    this.stopped = true;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.pc?.close();
    this.pc = null;
    closeApi(this.api);
    this.api = null;
  }
}
