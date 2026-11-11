import { useState, useEffect } from 'react';
import { Search, ArrowDownUp, HardDrive, Radio, Shield } from 'lucide-react';
import { Track, SearchResult, TransferItem } from './types';
import { SearchView } from './components/SearchView';
import { TransfersView } from './components/TransfersView';
import { MySharesView } from './components/MySharesView';
import { RadioView } from './components/RadioView';
import { AudioPlayerBar } from './components/AudioPlayerBar';
import { BrowseSharesModal } from './components/BrowseSharesModal';

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
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [browsingUser, setBrowsingUser] = useState<string | null>(null);
  const [broadcastStream, setBroadcastStream] = useState<MediaStream | null>(null);

  // Scanning a folder is slow (ID3/FLAC parsing + BLAKE3 hashing over a whole library): keep the result past a
  // restart instead of asking for it again every time the app opens.
  useEffect(() => {
    try {
      localStorage.setItem(SHARES_STORAGE_KEY, JSON.stringify(shares));
    } catch {}
  }, [shares]);

  // Search across local shares and Freenet peer announcements
  const handleSearch = (query: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }

    const q = query.toLowerCase();
    const matchingTracks = shares
      .filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          t.artist.toLowerCase().includes(q) ||
          t.album.toLowerCase().includes(q) ||
          t.genre.toLowerCase().includes(q)
      )
      .map((t, i) => ({
        id: `res-local-${i}`,
        track: t,
        peerUser: 'local_node',
        freeSlots: 4,
        queueLength: 0,
        speedKbps: 8500,
      }));

    setSearchResults(matchingTracks);
  };

  // Dynamic transfer progression simulation
  useEffect(() => {
    const timer = setInterval(() => {
      setTransfers((prev) =>
        prev.map((item) => {
          if (item.status !== 'transferring') return item;
          const chunk = item.speedBps;
          const newTransferred = Math.min(item.transferredBytes + chunk, item.track.size_bytes);
          const newPercent = (newTransferred / item.track.size_bytes) * 100;
          const isDone = newTransferred >= item.track.size_bytes;

          return {
            ...item,
            transferredBytes: newTransferred,
            progressPercent: newPercent,
            status: isDone ? 'completed' : 'transferring',
            etaSecs: isDone ? 0 : Math.ceil((item.track.size_bytes - newTransferred) / item.speedBps),
          };
        })
      );
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const handleDownloadTrack = (res: SearchResult) => {
    const newItem: TransferItem = {
      id: `dl-${Date.now()}-${Math.random()}`,
      type: 'download',
      status: 'transferring',
      progressPercent: 0,
      speedBps: Math.floor(Math.random() * 2000000 + 2500000),
      transferredBytes: 0,
      etaSecs: Math.ceil(res.track.size_bytes / 3500000),
      peerUser: res.peerUser,
      track: res.track,
    };
    setTransfers((prev) => [newItem, ...prev]);
  };

  const handleTogglePause = (id: string) => {
    setTransfers((prev) =>
      prev.map((t) => (t.id === id ? { ...t, status: t.status === 'paused' ? 'transferring' : 'paused' } : t))
    );
  };

  const handleCancelTransfer = (id: string) => {
    setTransfers((prev) => prev.filter((t) => t.id !== id));
  };

  const handleClearCompleted = () => {
    setTransfers((prev) => prev.filter((t) => t.status !== 'completed'));
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
            <Radio className="w-3.5 h-3.5" />
            Radio FM
          </button>
        </nav>

        {/* Freenet Status & Identity */}
        <div className="flex items-center gap-4 text-xs font-mono">
          <div className="flex items-center gap-1.5 text-neutral-400">
            <Radio className="w-3 h-3 text-emerald-400 animate-pulse" />
            <span className="text-[11px]">Freenet Node: <b className="text-emerald-400">127.0.0.1:7509</b></span>
          </div>
          <div className="flex items-center gap-1 text-[11px] text-neutral-400 bg-neutral-950 px-2 py-1 rounded border border-neutral-800">
            <Shield className="w-3 h-3 text-cyan-400" />
            <span>@me_sovereign</span>
          </div>
        </div>
      </header>

      {/* Main Tab Viewport */}
      <main className="flex-1 overflow-hidden relative">
        {activeTab === 'search' && (
          <SearchView
            results={searchResults}
            onSearch={handleSearch}
            onPlayTrack={(track) => {
              setCurrentTrack(track);
              setIsPlaying(true);
            }}
            onDownloadTrack={handleDownloadTrack}
            onBrowseUser={(username) => setBrowsingUser(username)}
          />
        )}

        {activeTab === 'transfers' && (
          <TransfersView
            transfers={transfers}
            onTogglePause={handleTogglePause}
            onCancelTransfer={handleCancelTransfer}
            onClearCompleted={handleClearCompleted}
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
            onPlayTrack={(track) => {
              setCurrentTrack(track);
              setIsPlaying(true);
            }}
          />
        )}

        {activeTab === 'radio' && (
          <RadioView
            shares={shares}
            onPlayTrack={(track) => {
              setCurrentTrack(track);
              setIsPlaying(true);
            }}
            currentPlayingTrack={currentTrack}
            isPlaying={isPlaying}
            broadcastStream={broadcastStream}
          />
        )}
      </main>

      {/* Docked Audio Player Bar */}
      <AudioPlayerBar
        currentTrack={currentTrack}
        isPlaying={isPlaying}
        onTogglePlay={() => setIsPlaying(!isPlaying)}
        onNext={() => {
          if (!currentTrack || shares.length === 0) return;
          const idx = shares.findIndex((t) => t.path === currentTrack.path);
          if (idx >= 0 && idx < shares.length - 1) {
            setCurrentTrack(shares[idx + 1]);
          }
        }}
        onPrev={() => {
          if (!currentTrack || shares.length === 0) return;
          const idx = shares.findIndex((t) => t.path === currentTrack.path);
          if (idx > 0) {
            setCurrentTrack(shares[idx - 1]);
          }
        }}
        onBroadcastStreamReady={setBroadcastStream}
      />

      {/* Browse User Shares Modal */}
      <BrowseSharesModal
        username={browsingUser}
        tracks={shares}
        onClose={() => setBrowsingUser(null)}
        onDownloadTrack={(track, user) => {
          handleDownloadTrack({
            id: `dl-${Date.now()}`,
            peerUser: user,
            freeSlots: 2,
            queueLength: 0,
            speedKbps: 4000,
            track,
          });
          setActiveTab('transfers');
          setBrowsingUser(null);
        }}
        onDownloadAll={(tracks, user) => {
          tracks.forEach((track) => {
            handleDownloadTrack({
              id: `dl-${Date.now()}-${Math.random()}`,
              peerUser: user,
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
