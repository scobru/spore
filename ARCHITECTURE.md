# 🍄 Spore — Architecture & Technical Specifications

This document outlines the internal architecture, network mechanics, and design principles behind **Spore**.

---

## 1. High-Level Architecture Overview

Spore uses a dual-engine architecture: a high-performance **Rust native backend** for file I/O, audio tag parsing, and cryptographic hashing, coupled with a reactive **React 19 / TypeScript frontend** encapsulated within **Tauri v2**.

```
+--------------------------------------------------------------------------+
|                               TAURI SHELL                                |
|                                                                          |
|  +--------------------------------------------------------------------+  |
|  |                     FRONTEND (React 19 / Vite)                     |  |
|  |                                                                    |  |
|  |  [ Search Tab ]      [ Transfers Queue ]       [ Shares Manager ]  |  |
|  |                                                                    |  |
|  |  +--------------------------------------------------------------+  |  |
|  |  |                Docked Audio Player (HTML5 / Audio)           |  |  |
|  |  +--------------------------------------------------------------+  |  |
|  +-----------------------------------▲--------------------------------+  |
|                                      │                                   |
|                Tauri IPC Invocation  │  Asset Protocol Stream            |
|                (invoke<T>)           │  (asset:// / http://asset...)     |
|                                      │                                   |
|  +-----------------------------------▼--------------------------------+  |
|  |                      RUST BACKEND (src-tauri)                      |  |
|  |                                                                    |  |
|  |  * scanner.rs       Recursive directory traversal via `walkdir`    |  |
|  |  * lofty            Instant ID3/FLAC/Vorbis audio tag extraction   |  |
|  |  * blake3           SIMD-accelerated 256-bit chunk hashing         |  |
|  |  * Asset Protocol   Streaming local audio files with HTTP range    |  |
|  +--------------------------------------------------------------------+  |
+--------------------------------------▲-----------------------------------+
                                       │
                    Local RPC / WebSocket (Port 7509)
                                       │
+--------------------------------------▼-----------------------------------+
|                         LOCAL FREENET DAEMON                             |
|                                                                          |
|  * Decentralized State Contracts (Join-semilattice merges)               |
|  * User Library Manifests (Content-addressed catalog)                    |
|  * Reed-Solomon Blob Storage (`freenet-blob`)                             |
+--------------------------------------------------------------------------+
```

---

## 2. Native Rust Engine (`src-tauri/`)

### 2.1 File Traversal and Metadata Parsing (`scanner.rs`)
Traditional JavaScript file system traversal suffers from node-gyp native overhead and heavy garbage collection when scanning folders containing tens of thousands of tracks.

Spore executes all file discovery in compiled Rust:
- **`walkdir`**: Traverses directory trees with link-following and directory recursion.
- **`lofty`**: High-performance audio tagging crate supporting:
  - Lossless: **FLAC**, **WAV**, **AIFF**.
  - Compressed: **MP3**, **OGG (Vorbis)**, **OPUS**, **M4A (AAC)**.
  - Extracts title, artist, album, genre, recording year, audio duration (in seconds), bitrate, and sample rate.
- **`blake3`**: Hashes file contents with tree hashing, generating a cryptographic finger-print at disk read speeds (over 1 GB/s per core).

```rust
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TrackMetadata {
    pub path: String,
    pub filename: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub genre: String,
    pub year: Option<u32>,
    pub duration_secs: u64,
    pub bitrate_kbps: Option<u32>,
    pub sample_rate: Option<u32>,
    pub format: String,
    pub size_bytes: u64,
    pub blake3_hash: String,
}
```

### 2.2 Tauri Commands Exposed to Frontend
1. **`scan_music_folder(folder_path: String) -> Result<Vec<TrackMetadata>, String>`**
   Scans the directory provided, extracts all audio metadata, and returns an array of typed tracks to the frontend in a single IPC call.
2. **`compute_file_hash(file_path: String) -> Result<String, String>`**
   Computes the BLAKE3 hash for an individual file on disk.

---

## 3. Local Audio Streaming & The Asset Protocol

Loading and playing local media files (`D:\Music\song.mp3`) in a browser sandbox is restricted by browser security policies.

### 3.1 The Asset Protocol Pipeline
To stream audio directly without loading entire multi-megabyte files into memory or converting them to Base64, Spore uses Tauri's **Asset Protocol**:
1. When a user clicks **Play**, the frontend converts the local path using `convertFileSrc(track.path)`:
   ```typescript
   import { convertFileSrc } from '@tauri-apps/api/core';
   const assetUrl = convertFileSrc(track.path);
   // Produces: http://asset.localhost/D%3A%2FMusic%2Fsong.mp3
   ```
2. The HTML5 `<audio>` element requests this URL.
3. The native Tauri process intercepts the request, verifies that the path matches the permitted scope in `tauri.conf.json`:
   ```json
   "security": {
     "assetProtocol": {
       "enable": true,
       "scope": ["**", "**/*"]
     }
   }
   ```
4. Tauri streams the audio stream with standard HTTP Range requests (`206 Partial Content`), allowing smooth scrubbing and instant seeking across tracks.

---

## 4. Freenet Integration & Data Transfer

Spore separates **Catalog Discovery** from **Data Transfer** to maintain high speed while leveraging Freenet's decentralized guarantees.

### 4.1 Catalog Discovery (Freenet Contracts)
- A user's shared library is represented as a **Compressed Manifest**:
  - Contains artist, album, track names, bitrate, duration, file size, and the file's root BLAKE3 hash.
- This manifest is published onto a Freenet contract associated with the user's cryptographic identity (`@pubkey...`).
- Connected peers query Freenet contracts to perform keyword searches across all announced catalogs.

### 4.2 Data Transfer Options

#### Mode A: Direct P2P Streaming (WebRTC / Freehole Engine)
- **Signaling**: Peer connection handshake (SDP Offer/Answer and ICE candidates) is exchanged via Freenet state contracts or the ZEN signaling protocol (~2 KB payload).
- **Data Transfer**: Once connected, files are streamed directly over a binary `RTCDataChannel` in 64 KB chunks.
- **Zero Database Overhead**: Raw audio files travel over UDP wire-speed without entering Freenet contract state.
- **Privacy Note**: To mask IP addresses in this mode, users simply run a system-wide VPN.

#### Mode B: Native Decentralized Blob Storage (`freenet-blob`)
- Powered by `freenet-blob`:
  - Files are partitioned into 256 KB shards.
  - Generates parity shards using a **Galois Field $\text{GF}(2^8)$ Reed-Solomon** matrix ($K$-of-$N$ encoding).
  - Shards are distributed across Freenet nodes under `blake3(chunk)` keys.
  - **Self-Healing**: If nodes go offline, any client can reconstruct the missing shards and republish them with `repairBlob()`.
  - **100% Anonymous**: IP addresses are never revealed between peers.

---

## 5. Security Model

1. **Content Security Policy (CSP):**
   Explicitly configured in `tauri.conf.json` to allow local asset streaming while preventing unauthorized outbound network calls:
   ```json
   "csp": "default-src 'self' 'unsafe-inline'; media-src 'self' asset: http://asset.localhost https://asset.localhost blob: data:; img-src 'self' asset: http://asset.localhost https://asset.localhost blob: data:;"
   ```
2. **Read-Only Scanner Scope:**
   The scanner in `scanner.rs` strictly performs read operations (`File::open`) during directory inspection. It never modifies, renames, or writes to shared source files.
3. **End-to-End Cryptography:**
   Transfers negotiated via Freehole use **AES-256-GCM** authenticated encryption with ephemeral keys.
