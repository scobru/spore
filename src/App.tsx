import { useState, useEffect, useRef } from 'react';
import { Search, ArrowDownUp, HardDrive, Radio, Shield } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { Track, SearchResult, TransferItem } from './types';
import { SearchView } from './components/SearchView';
import { TransfersView } from './components/TransfersView';
import { MySharesView } from './components/MySharesView';
import { RadioView } from './components/RadioView';
import { AudioPlayerBar } from './components/AudioPlayerBar';
import { BrowseSharesModal } from './components/BrowseSharesModal';
import {
  FreenetP2pNode,
  PeerInfo,
  fetchNetworkCatalogs,
  getOrCreatePeerId,
  getStoredFreenetUrl,
  getStoredUsername,
  publishCatalogToFreenet,
  setStoredUsername,
} from './lib/freenetP2p';

const SHARES_STORAGE_KEY = 'spore_shares_v1';
const loadStoredShares = (): Track[] => {
  try {
    const raw = localStorage.getItem(SHARES_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Track[]) : [];
  } catch {
    return [];
  }
};

export function App() {
  const [activeTab, setActiveTab] = useState<'search' | 'transfers' | 'shares' | 'radio'>('shares');
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [transfers, setTransfers] = useState<TransferItem[]>([]);
  const [shares, setShares] = useState<Track[]>(loadStoredShares);
  const [networkPeers, setNetworkPeers] = useState<PeerInfo[]>([]);
  const [networkResults, setNetworkResults] = useState<SearchResult[]>([]);
  const [isSyncingNetwork, setIsSyncingNetwork] = useState(false);
  const [lastQuery, setLastQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [browsingUser, setBrowsingUser] = useState<string | null>(null);
  const [broadcastStream, setBroadcastStream] = useState<MediaStream | null>(null);
  const [isRadioLive, setIsRadioLive] = useState(false);
  const [radioQueue, setRadioQueue] = useState<Track[]>([]);
  const [radioQueueIndex, setRadioQueueIndex] = useState(0);
  const [radioSourceMode, setRadioSourceMode] = useState<'playlist' | 'mic' | 'system' | 'url'>('playlist');

  const [myPeerId] = useState(() => getOrCreatePeerId());
  const [username, setUsername] = useState(() => getStoredUsername());
  const [downloadDir, setDownloadDir] = useState(() => {
    try {
      return localStorage.getItem('spore_download_dir') || 'D:\\Music\\SporeDownloads';
    } catch {
      return 'D:\\Music\\SporeDownloads';
    }
  });
  const [freenetWsUrl] = useState(() => getStoredFreenetUrl());

  const sharesRef = useRef<Track[]>(shares);
  sharesRef.current = shares;
  const p2pNodeRef = useRef<FreenetP2pNode | null>(null);

  useEffect(() => {
    try {
      if (!localStorage.getItem('spore_download_dir')) {
        void invoke<string>('get_default_download_dir')
          .then((dir) => setDownloadDir(dir))
          .catch(() => {});
      }
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('spore_download_dir', downloadDir);
    } catch {}
  }, [downloadDir]);

  // Scanning a folder is slow (ID3/FLAC parsing + BLAKE3 hashing over a whole library): keep the result past a
  // restart instead of asking for it again every time the app opens.
  useEffect(() => {
    try {
      localStorage.setItem(SHARES_STORAGE_KEY, JSON.stringify(shares));
    } catch {}
  }, [shares]);

  useEffect(() => {
    if (radioQueue.length === 0 && shares.length > 0) {
      setRadioQueue(shares);
      setRadioQueueIndex(0);
    }
  }, [shares, radioQueue.length]);

  const handlePlayTrack = (track: Track) => {
    setCurrentTrack(track);
    setIsPlaying(true);
    if (isRadioLive && radioSourceMode === 'playlist') {
      const idx = radioQueue.findIndex((t) => t.path === track.path);
      if (idx >= 0) {
        setRadioQueueIndex(idx);
      }
    }
  };

  const handleNextTrack = () => {
    if (isRadioLive && radioSourceMode === 'playlist' && radioQueue.length > 0) {
      const nextIdx = (radioQueueIndex + 1) % radioQueue.length;
      setRadioQueueIndex(nextIdx);
      setCurrentTrack(radioQueue[nextIdx]);
      setIsPlaying(true);
      return;
    }

    if (!currentTrack || shares.length === 0) {
      setIsPlaying(false);
      return;
    }
    const idx = shares.findIndex((t) => t.path === currentTrack.path);
    if (idx >= 0 && idx < shares.length - 1) {
      setCurrentTrack(shares[idx + 1]);
      setIsPlaying(true);
    } else {
      setIsPlaying(false);
    }
  };

  const handlePrevTrack = () => {
    if (isRadioLive && radioSourceMode === 'playlist' && radioQueue.length > 0) {
      const prevIdx = (radioQueueIndex - 1 + radioQueue.length) % radioQueue.length;
      setRadioQueueIndex(prevIdx);
      setCurrentTrack(radioQueue[prevIdx]);
      setIsPlaying(true);
      return;
    }

    if (!currentTrack || shares.length === 0) return;
    const idx = shares.findIndex((t) => t.path === currentTrack.path);
    if (idx > 0) {
      setCurrentTrack(shares[idx - 1]);
      setIsPlaying(true);
    }
  };

  // Start P2P Seeder/Downloader node on Freenet
  useEffect(() => {
    const node = new FreenetP2pNode();
    p2pNodeRef.current = node;

    void node
      .start(myPeerId, freenetWsUrl, () => sharesRef.current, {
        onUploadStart: (transferId, peerUser, peerId, track) => {
          setTransfers((prev) => [
            {
              id: transferId,
              type: 'upload',
              status: 'transferring',
              progressPercent: 0,
              speedBps: 0,
              transferredBytes: 0,
              etaSecs: 0,
              peerUser,
              peerId,
              track,
            },
            ...prev.filter((t) => t.id !== transferId),
          ]);
        },
        onUploadProgress: (transferId, transferredBytes, speedBps, etaSecs) => {
          setTransfers((prev) =>
            prev.map((item) => {
              if (item.id !== transferId) return item;
              const pct = item.track.size_bytes > 0 ? Math.min(100, (transferredBytes / item.track.size_bytes) * 100) : 0;
              return { ...item, transferredBytes, progressPercent: pct, speedBps, etaSecs, status: 'transferring' };
            })
          );
        },
        onUploadComplete: (transferId) => {
          setTransfers((prev) =>
            prev.map((item) =>
              item.id === transferId
                ? { ...item, transferredBytes: item.track.size_bytes, progressPercent: 100, status: 'completed', etaSecs: 0 }
                : item
            )
          );
        },
        onUploadError: (transferId, error) => {
          setTransfers((prev) =>
            prev.map((item) => (item.id === transferId ? { ...item, status: 'failed', error } : item))
          );
        },
      })
      .catch((err) => {
        console.warn('[Spore P2P] Seeder standby (Freenet node offline?):', err);
      });

    return () => {
      node.stop();
      if (p2pNodeRef.current === node) p2pNodeRef.current = null;
    };
  }, [myPeerId, freenetWsUrl]);

  const handlePublishCatalog = async (): Promise<number> => {
    const { publishedTracks } = await publishCatalogToFreenet(myPeerId, username, shares, freenetWsUrl);
    return publishedTracks;
  };

  const applySearchFilter = (query: string, netRes: SearchResult[]) => {
    const q = query.trim().toLowerCase();
    const localMatching: SearchResult[] = shares
      .filter(
        (t) =>
          !q ||
          t.title.toLowerCase().includes(q) ||
          t.artist.toLowerCase().includes(q) ||
          t.album.toLowerCase().includes(q) ||
          t.genre.toLowerCase().includes(q)
      )
      .map((t, i) => ({
        id: `res-local-${i}-${t.blake3_hash.slice(0, 8)}`,
        track: t,
        peerUser: username,
        freeSlots: 4,
        queueLength: 0,
        speedKbps: 8500,
      }));

    const remoteMatching = netRes.filter(
      (r) =>
        !q ||
        r.track.title.toLowerCase().includes(q) ||
        r.track.artist.toLowerCase().includes(q) ||
        r.track.album.toLowerCase().includes(q) ||
        r.track.genre.toLowerCase().includes(q) ||
        r.peerUser.toLowerCase().includes(q)
    );

    // Show remote Freenet peer results first, then local shares
    setSearchResults([...remoteMatching, ...localMatching]);
  };

  const handleSyncNetwork = async () => {
    setIsSyncingNetwork(true);
    try {
      const { peers, results } = await fetchNetworkCatalogs(myPeerId, freenetWsUrl);
      setNetworkPeers(peers);
      setNetworkResults(results);
      applySearchFilter(lastQuery, results);
    } catch (err) {
      console.warn('[Spore P2P] Sync failed:', err);
    } finally {
      setIsSyncingNetwork(false);
    }
  };

  // Search across Freenet peer catalogs and local shares
  const handleSearch = (query: string) => {
    setLastQuery(query);
    if (!query.trim() && networkResults.length === 0) {
      setSearchResults([]);
      return;
    }
    applySearchFilter(query, networkResults);
  };

  const handleDownloadTrack = (res: SearchResult) => {
    const transferId = `dl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    if (!res.peerId) {
      setTransfers((prev) => [
        {
          id: transferId,
          type: 'download',
          status: 'failed',
          progressPercent: 0,
          speedBps: 0,
          transferredBytes: 0,
          etaSecs: 0,
          peerUser: res.peerUser,
          track: res.track,
          error: 'Local track (already on this machine) or missing peer ID.',
        },
        ...prev,
      ]);
      return;
    }

    const newItem: TransferItem = {
      id: transferId,
      type: 'download',
      status: 'transferring',
      progressPercent: 0,
      speedBps: 0,
      transferredBytes: 0,
      etaSecs: 0,
      peerUser: res.peerUser,
      peerId: res.peerId,
      track: res.track,
    };
    setTransfers((prev) => [newItem, ...prev]);

    void p2pNodeRef.current?.startDownload(transferId, res.peerId, res.track, downloadDir, {
      onProgress: (transferredBytes, speedBps, etaSecs) => {
        setTransfers((prev) =>
          prev.map((item) => {
            if (item.id !== transferId) return item;
            const pct = item.track.size_bytes > 0 ? Math.min(100, (transferredBytes / item.track.size_bytes) * 100) : 0;
            return { ...item, transferredBytes, progressPercent: pct, speedBps, etaSecs, status: 'transferring' };
          })
        );
      },
      onComplete: (localPath) => {
        setTransfers((prev) =>
          prev.map((item) =>
            item.id === transferId
              ? {
                  ...item,
                  transferredBytes: item.track.size_bytes,
                  progressPercent: 100,
                  status: 'completed',
                  etaSecs: 0,
                  localPath,
                }
              : item
          )
        );
      },
      onError: (error) => {
        setTransfers((prev) =>
          prev.map((item) => (item.id === transferId ? { ...item, status: 'failed', error } : item))
        );
      },
    });
  };

  const handleTogglePause = (id: string) => {
    setTransfers((prev) =>
      prev.map((t) => (t.id === id ? { ...t, status: t.status === 'paused' ? 'transferring' : 'paused' } : t))
    );
  };

  const handleCancelTransfer = (id: string) => {
    const target = transfers.find((t) => t.id === id);
    if (target && target.type === 'download') {
      p2pNodeRef.current?.cancelDownload(id, target.peerId, downloadDir, target.track.filename);
    }
    setTransfers((prev) => prev.filter((t) => t.id !== id));
  };

  const handleClearCompleted = () => {
    setTransfers((prev) => prev.filter((t) => t.status !== 'completed' && t.status !== 'failed'));
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-neutral-950 text-neutral-100 select-none overflow-hidden font-sans">
      {/* Top Header / Navigation Tabs */}
      <header className="h-13 bg-neutral-900 border-b border-neutral-800 px-4 flex items-center justify-between z-20">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xl">🍄</span>
            <span className="font-extrabold text-base tracking-tight text-neutral-100 font-mono">SPORE</span>
          </div>
          <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-950 text-emerald-400 border border-emerald-800/80 font-semibold">
            Freenet P2P
          </span>
        </div>

        {/* 3 Core Navigation Tabs */}
        <nav className="flex items-center gap-1.5 font-mono text-xs">
          <button
            onClick={() => setActiveTab('search')}
            className={`px-3.5 py-1.5 rounded flex items-center gap-2 transition-colors cursor-pointer ${
              activeTab === 'search'
                ? 'bg-neutral-800 text-emerald-400 border border-neutral-700 font-semibold'
                : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/60'
            }`}
          >
            <Search className="w-3.5 h-3.5" />
            Search
          </button>

          <button
            onClick={() => setActiveTab('transfers')}
            className={`px-3.5 py-1.5 rounded flex items-center gap-2 transition-colors cursor-pointer ${
              activeTab === 'transfers'
                ? 'bg-neutral-800 text-emerald-400 border border-neutral-700 font-semibold'
                : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/60'
            }`}
          >
            <ArrowDownUp className="w-3.5 h-3.5" />
            Transfers
            {transfers.filter((t) => t.status === 'transferring').length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-emerald-500 text-neutral-950 text-[10px] font-bold">
                {transfers.filter((t) => t.status === 'transferring').length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('shares')}
            className={`px-3.5 py-1.5 rounded flex items-center gap-2 transition-colors cursor-pointer ${
              activeTab === 'shares'
                ? 'bg-neutral-800 text-emerald-400 border border-neutral-700 font-semibold'
                : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/60'
            }`}
          >
            <HardDrive className="w-3.5 h-3.5" />
            Shares
            {shares.length > 0 && (
              <span className="text-[10px] text-neutral-400">({shares.length})</span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('radio')}
            className={`px-3.5 py-1.5 rounded flex items-center gap-2 transition-colors cursor-pointer ${
              activeTab === 'radio'
                ? 'bg-neutral-800 text-rose-400 border border-neutral-700 font-semibold shadow-inner'
                : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/60'
            }`}
          >
            <Radio className={`w-3.5 h-3.5 ${isRadioLive ? 'text-rose-400 animate-pulse' : ''}`} />
            Radio FM
            {isRadioLive && (
              <span className="px-1.5 py-0.2 rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/50 text-[9px] font-bold">
                LIVE
              </span>
            )}
          </button>
        </nav>

        {/* Freenet Status & Identity */}
        <div className="flex items-center gap-4 text-xs font-mono">
          <div className="flex items-center gap-1.5 text-neutral-400">
            <Radio className="w-3 h-3 text-emerald-400 animate-pulse" />
            <span className="text-[11px]">Freenet Node: <b className="text-emerald-400">127.0.0.1:7509</b></span>
          </div>
          <div className="flex items-center gap-1 text-[11px] text-neutral-400 bg-neutral-950 px-2 py-1 rounded border border-neutral-800">
            <Shield className="w-3 h-3 text-cyan-400 shrink-0" />
            <span>@</span>
            <input
              type="text"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                setStoredUsername(e.target.value);
              }}
              className="bg-transparent text-neutral-200 w-24 focus:outline-none"
              title={`Peer ID: ${myPeerId}`}
            />
          </div>
        </div>
      </header>

      {/* Main Tab Viewport */}
      <main className="flex-1 overflow-y-auto relative flex flex-col">
        {activeTab === 'search' && (
          <SearchView
            results={searchResults}
            onSearch={handleSearch}
            onSyncNetwork={handleSyncNetwork}
            isSyncingNetwork={isSyncingNetwork}
            networkPeersCount={networkPeers.filter((p) => p.peer_id !== myPeerId).length}
            networkTracksCount={networkResults.length}
            onPlayTrack={handlePlayTrack}
            onDownloadTrack={handleDownloadTrack}
            onBrowseUser={(u) => setBrowsingUser(u)}
          />
        )}

        {activeTab === 'transfers' && (
          <TransfersView
            transfers={transfers}
            downloadDir={downloadDir}
            onChangeDownloadDir={setDownloadDir}
            onTogglePause={handleTogglePause}
            onCancelTransfer={handleCancelTransfer}
            onClearCompleted={handleClearCompleted}
            onPlayTrack={handlePlayTrack}
          />
        )}

        {activeTab === 'shares' && (
          <MySharesView
            shares={shares}
            onSetShares={(newShares) => {
              setShares(newShares);
              if (!currentTrack && newShares.length > 0) {
                setCurrentTrack(newShares[0]);
              }
            }}
            onPlayTrack={handlePlayTrack}
            onPublishCatalog={handlePublishCatalog}
          />
        )}

        {/* Keep RadioView always mounted so switching tabs never interrupts WebRTC broadcast or listener */}
        <div className={activeTab === 'radio' ? 'flex-1 flex flex-col overflow-hidden' : 'hidden'}>
          <RadioView
            shares={shares}
            onPlayTrack={handlePlayTrack}
            currentPlayingTrack={currentTrack}
            isPlaying={isPlaying}
            broadcastStream={broadcastStream}
            onBroadcastingChange={setIsRadioLive}
            broadcastQueue={radioQueue}
            queueIndex={radioQueueIndex}
            onSetBroadcastQueue={setRadioQueue}
            onSetQueueIndex={setRadioQueueIndex}
            sourceMode={radioSourceMode}
            onSourceModeChange={setRadioSourceMode}
          />
        </div>
      </main>

      {/* Docked Audio Player Bar */}
      <AudioPlayerBar
        currentTrack={currentTrack}
        isPlaying={isPlaying}
        onTogglePlay={() => setIsPlaying(!isPlaying)}
        onNext={handleNextTrack}
        onPrev={handlePrevTrack}
        onBroadcastStreamReady={setBroadcastStream}
      />

      {/* Browse User Shares Modal */}
      <BrowseSharesModal
        username={browsingUser}
        tracks={
          browsingUser && browsingUser !== username
            ? networkResults.filter((r) => r.peerUser === browsingUser).map((r) => r.track)
            : shares
        }
        onClose={() => setBrowsingUser(null)}
        onDownloadTrack={(track, user) => {
          const peerMatch = networkResults.find((r) => r.peerUser === user);
          handleDownloadTrack({
            id: `dl-${Date.now()}`,
            peerUser: user,
            peerId: peerMatch?.peerId,
            freeSlots: 2,
            queueLength: 0,
            speedKbps: 4000,
            track,
          });
          setActiveTab('transfers');
          setBrowsingUser(null);
        }}
        onDownloadAll={(tracks, user) => {
          const peerMatch = networkResults.find((r) => r.peerUser === user);
          tracks.forEach((track) => {
            handleDownloadTrack({
              id: `dl-${Date.now()}-${Math.random()}`,
              peerUser: user,
              peerId: peerMatch?.peerId,
              freeSlots: 2,
              queueLength: 0,
              speedKbps: 4000,
              track,
            });
          });
          setActiveTab('transfers');
          setBrowsingUser(null);
        }}
      />
    </div>
  );
}

export default App;
