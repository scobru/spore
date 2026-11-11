# 🍄 Spore

> **Sovereign P2P Music & File Digging for Freenet**

[![Tauri](https://img.shields.io/badge/Tauri-v2-blue.svg?logo=tauri)](https://tauri.app)
[![Rust](https://img.shields.io/badge/Rust-1.99+-orange.svg?logo=rust)](https://www.rust-lang.org)
[![React](https://img.shields.io/badge/React-19-61dafb.svg?logo=react)](https://react.dev)
[![Freenet](https://img.shields.io/badge/Network-Freenet-22c55e.svg)](https://freenet.org)
[![Storage](https://img.shields.io/badge/Storage-BLAKE3%20%7C%20freenet--blob-blueviolet.svg)](https://github.com/scobru/freenet-blob)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

**Spore** is a sovereign, lightweight desktop application inspired by the spirit of **Soulseek** and **eMule**, designed from the ground up for underground crate digging, decentralized file sharing, and local audio streaming on the **Freenet** peer-to-peer network.

---

## ⚡ Why Spore?

Traditional P2P clients either rely on centralized indexing servers (like original Soulseek) or leak network telemetry. Cloud streaming platforms lock users behind subscription paywalls and algorithms.

**Spore restores digital sovereignty:**
- **Zero Central Servers**: Catalogs and manifests are published onto cryptographic Freenet state contracts.
- **Ultra-Fast Native Engine**: Powered by Rust, reading audio tags and generating BLAKE3 hashes for thousands of tracks in seconds.
- **Featherweight Footprint**: Built with **Tauri v2** (~15 MB binary, ~40 MB idle RAM vs. Electron's 300+ MB).
- **Focused, Clean Experience**: Stripped of bloat, ads, and noisy chat channels. Built purely for **Search, Transfers, Shares, and Listening**.

---

## 🎯 Core Features

### 1. 🔍 High-Density Search (Soulseek Style)
- Multi-column data view: **Title, Artist, Album, Format, Bitrate, Duration, File Size, Peer, Free Slots, and Speed**.
- Live filters for formats: `ALL`, `FLAC`, `MP3`, `WAV`, `EXTRAS` (artwork, booklets, cue logs).
- Instant search across connected peer libraries and locally indexed files.
- Double-click to queue downloads immediately.

### 2. ⚡ Sovereign Transfer Engine
- **Dedicated Queues**: Real-time tracking of active **Downloads** and **Uploads (Seeding)**.
- **Wire-Speed Transfer**: Powered by binary data streaming (WebRTC DataChannel chunks / `freenet-blob`).
- **Granular Controls**: Pause, resume, cancel, and clear completed transfers with one click.
- **Persistent Recovery**: Pauses automatically when a peer goes offline and resumes seamlessly when they reconnect.

### 3. 📁 High-Performance Local Shares
- **Rust Multi-Thread Scanner**: Scans deep folder trees (`walkdir`) and parses metadata using `lofty` without blocking the UI.
- **BLAKE3 Content Addressing**: Cryptographically hashes files for tamper-proof verification and chunk mapping.
- **Freenet Manifest Publisher**: Compresses and announces your library onto Freenet contracts so peers can discover your shared music.

### 4. 👥 Peer Folder Explorer (Browse Shares)
- Right-click or inspect any peer to view their full shared album folder hierarchy.
- **One-Click Album Download**: Batch queue an entire album or select individual tracks.

### 5. 🎵 Integrated Hi-Fi Audio Player
- Docked bottom bar with waveform scrubbing, time remaining, volume control, and codec badge (`FLAC 24-bit`, `MP3 320k`).
- Native streaming of local files directly from disk via Tauri's secured **Asset Protocol**.

### 6. ✏️ Native Tag Editor (ID3 / Vorbis)
- In-place metadata editing powered by Rust `lofty`: rename Title, Artist, Album, Genre, and Year directly on disk.
- Instant BLAKE3 rehashing upon saving to guarantee content-addressing integrity across peers.

---

## 🎼 Curated Scope: Music & Release Extras Only

To prevent malware injection, trojans (`.exe`, `.scr`, `.bat`), and junk bloat that plagued legacy P2P networks, Spore enforces a strict **Music & Release Extras Only** policy:

* **🎶 Lossless & Hi-Fi Audio:** `.flac`, `.wav`, `.aiff`, `.m4a` (ALAC/AAC), `.ogg` (Vorbis), `.opus`, `.mp3`.
* **🖼️ Cover Art & Packaging:** `.jpg`, `.jpeg`, `.png`, `.webp`.
* **📖 Booklets, Liner Notes & Zines:** `.pdf`, `.txt`, `.nfo`.
* **💿 Accurate Rip Logs & Track Sheets:** `.cue`, `.log` (EAC / Whipper rip verification).
* 🚫 **All Executables & Arbitrary Binaries Blocked:** Spore completely rejects and ignores executable binaries, installers, and system scripts.

---

## 🏗️ Architecture & Technology Stack

| Layer | Technologies |
| :--- | :--- |
| **Desktop Shell** | [Tauri v2](https://tauri.app) (Rust core + WebView2 / WebKit) |
| **Audio & Metadata (Rust)** | [`lofty`](https://crates.io/crates/lofty) (ID3, Vorbis, FLAC parser), [`walkdir`](https://crates.io/crates/walkdir) |
| **Cryptography & Hashing** | [`blake3`](https://crates.io/crates/blake3) (256-bit SIMD accelerated hashing) |
| **Frontend Framework** | React 19, TypeScript, Vite, Tailwind CSS v4, Lucide Icons |
| **P2P Directory & Consensus**| [Freenet](https://freenet.org) (Node RPC at `127.0.0.1:7509`, WASM contracts) |
| **Data Transfer Engine** | Hybrid: Direct P2P via WebRTC (`Freehole`) + Reed-Solomon blob storage (`freenet-blob`) |

---

## 🔒 Privacy & Network Model

Spore is designed with flexible privacy guarantees:

1. **Direct P2P Mode (Default - Soulseek style):**
   - Direct connection between peers for maximum wire speed (100+ MB/s).
   - **VPN Protection**: When running any system VPN (e.g., Mullvad, ProtonVPN, WireGuard), peers only see the VPN's IP address. Your residential IP remains completely hidden.
2. **Native Freenet Blob Mode (`freenet-blob`):**
   - Files are split into 256 KB shards with **Reed-Solomon ($K$-of-$N$)** error correction and distributed across Freenet nodes.
   - 100% anonymous without requiring a VPN.

For a deep dive into the internal design, see [ARCHITECTURE.md](ARCHITECTURE.md).

---

## 🚀 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v20+ recommended)
- [Rust](https://www.rust-lang.org/tools/install) (1.80+ or latest stable)
- C++ Build Tools (Visual Studio Build Tools on Windows)

### Installation & Development

```bash
# 1. Clone repository
git clone https://github.com/scobru/spore.git
cd spore

# 2. Install dependencies
npm install

# 3. Launch Spore in desktop development mode (Tauri)
npm run tauri dev
```

### Production Build

To build a standalone desktop installer (`.msi` / `.exe` on Windows, `.dmg` on macOS, `.AppImage` / `.deb` on Linux):

```bash
npm run tauri build
```
The compiled binaries will be output in `src-tauri/target/release/bundle/`.

---

## 🗺️ Project Structure

```
spore/
├── src-tauri/                       # Native Rust Backend
│   ├── Cargo.toml                   # Rust crates: lofty, blake3, walkdir, tauri
│   ├── tauri.conf.json              # Window settings, permissions & Asset Protocol scope
│   ├── capabilities/
│   │   └── default.json             # Tauri v2 security capabilities
│   └── src/
│       ├── main.rs                  # Application binary entry point
│       ├── lib.rs                   # Tauri command registration
│       └── scanner.rs               # Multi-threaded audio metadata & hashing engine
│
├── src/                             # Modern React 19 Frontend
│   ├── App.tsx                      # Root shell, state store & tab coordinator
│   ├── App.css                      # Tailwind v4 setup & dark mode rules
│   ├── types.ts                     # TypeScript definitions (Track, SearchResult, TransferItem)
│   └── components/
│       ├── SearchView.tsx           # High-density search table with format filters
│       ├── TransfersView.tsx        # Download and Upload queue manager
│       ├── MySharesView.tsx         # Local folder scanner and catalog publisher
│       ├── AudioPlayerBar.tsx       # Bottom audio player dock with native asset playback
│       └── BrowseSharesModal.tsx    # Peer folder explorer and album downloader
│
├── index.html                       # HTML5 container with dark theme
├── vite.config.ts                   # Vite bundler configuration
└── package.json                     # Dependencies & build scripts
```

---

## ⚖️ Content Policy & Copyright Notice

> [!IMPORTANT]
> **Spore is strictly intended for sharing non-copyright-infringing, royalty-free, and legally authorized content.**

Spore is built as a decentralized, neutral communication protocol and file management client. In alignment with open culture and legal compliance:

- **Permitted & Encouraged Content**:
  - **Public Domain Works**: Historical audio, archival recordings, and media whose copyright has expired or was dedicated to the public domain.
  - **Creative Commons & Open Licenses**: Music, samples, and audio published under permissive licenses (e.g., CC0, CC-BY, CC-SA).
  - **Independent & Self-Produced Audio**: Original music, field recordings, sample packs, synthesizer patches, and productions shared directly by their creators.
  - **Authorized Live Recordings**: Live bootlegs, DJ mixes, and tape recordings distributed with the consent of the respective artists and labels.
- **Prohibited Use**:
  - **Do NOT** use Spore to index, distribute, or download commercial copyrighted music, proprietary digital assets, or media protected by copyright without the explicit permission or license of the rights holder.
- **User Responsibility**:
  - Spore operates over a serverless peer-to-peer network with no central authority, indexing server, or content gatekeeper. Each user bears sole and exclusive legal responsibility for the material they decide to index, announce, upload, or download.
  - The creators and maintainers of Spore do not endorse, encourage, or tolerate copyright infringement.

---

## 📄 License

Released under the [MIT License](LICENSE).
Created with 🌱 by the decentralized community.
