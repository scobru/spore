import { useState, FC } from 'react';
import { Search, Download, FolderSearch, Play, X, SlidersHorizontal, Check, Disc } from 'lucide-react';
import { SearchResult, Track } from '../types';

interface SearchViewProps {
  results: SearchResult[];
  onSearch: (query: string) => void;
  onPlayTrack: (track: Track) => void;
  onDownloadTrack: (result: SearchResult) => void;
  onBrowseUser: (username: string) => void;
}

export const SearchView: FC<SearchViewProps> = ({
  results,
  onSearch,
  onPlayTrack,
  onDownloadTrack,
  onBrowseUser,
}) => {
  const [query, setQuery] = useState('');
  const [filterFormat, setFilterFormat] = useState('ALL');
  const [downloadedIds, setDownloadedIds] = useState<Set<string>>(new Set());

  const formats = ['ALL', 'FLAC', 'MP3', 'WAV', 'EXTRAS'];

  const extraFormats = ['JPG', 'JPEG', 'PNG', 'WEBP', 'PDF', 'CUE', 'LOG', 'NFO', 'TXT'];

  const filteredResults = results.filter((res) => {
    const matchesQuery =
      !query ||
      res.track.title.toLowerCase().includes(query.toLowerCase()) ||
      res.track.artist.toLowerCase().includes(query.toLowerCase()) ||
      res.track.album.toLowerCase().includes(query.toLowerCase()) ||
      res.peerUser.toLowerCase().includes(query.toLowerCase());

    const isExtra = extraFormats.includes(res.track.format.toUpperCase());
    const matchesFormat =
      filterFormat === 'ALL' ||
      (filterFormat === 'EXTRAS' ? isExtra : res.track.format.toUpperCase() === filterFormat);

    return matchesQuery && matchesFormat;
  });

  const formatSize = (bytes: number) => {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const handleDownload = (result: SearchResult) => {
    setDownloadedIds((prev) => new Set(prev).add(result.id));
    onDownloadTrack(result);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      onSearch(query);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-neutral-950 overflow-hidden font-mono">
      {/* Search Header Bar */}
      <div className="p-3 bg-neutral-900/70 border-b border-neutral-800 flex items-center justify-between gap-4">
        <div className="relative flex-1 max-w-xl">
          <Search className="w-4 h-4 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search artist, track, album, label or user on Freenet network..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              onSearch(e.target.value);
            }}
            onKeyDown={handleKeyDown}
            className="w-full bg-neutral-950 border border-neutral-800 rounded-md pl-9 pr-8 py-1.5 text-xs text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:border-emerald-500/70 focus:ring-1 focus:ring-emerald-500/40 font-sans"
          />
          {query && (
            <button
              onClick={() => {
                setQuery('');
                onSearch('');
              }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-200 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Format Pill Filters */}
        <div className="flex items-center gap-1.5 text-xs">
          <SlidersHorizontal className="w-3.5 h-3.5 text-neutral-400 mr-1" />
          <span className="text-[11px] text-neutral-400 font-mono">Format:</span>
          {formats.map((fmt) => (
            <button
              key={fmt}
              onClick={() => setFilterFormat(fmt)}
              className={`px-2 py-0.5 rounded text-[11px] font-mono transition-colors cursor-pointer ${
                filterFormat === fmt
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 font-semibold'
                  : 'bg-neutral-800/80 text-neutral-400 hover:text-neutral-200 border border-transparent'
              }`}
            >
              {fmt}
            </button>
          ))}
        </div>

        <div className="text-[11px] font-mono text-neutral-400">
          Results: <span className="text-emerald-400 font-semibold">{filteredResults.length}</span>
        </div>
      </div>

      {/* Results Table */}
      <div className="flex-1 overflow-auto">
        {filteredResults.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-8 select-none">
            <div className="w-12 h-12 rounded-full bg-neutral-900 border border-neutral-800 flex items-center justify-center mb-3 text-neutral-600">
              <Disc className="w-6 h-6 text-neutral-500 animate-pulse" />
            </div>
            <div className="text-sm font-semibold text-neutral-300 font-sans">
              {query ? `No results found for "${query}"` : 'Freenet P2P Network Ready'}
            </div>
            <p className="text-xs text-neutral-500 max-w-md mt-1 font-sans">
              {query
                ? 'Try checking another spelling or changing format filters.'
                : 'Enter keywords above to dig across connected Freenet nodes, or scan your local library in Shares to announce files.'}
            </p>
          </div>
        ) : (
          <table className="w-full text-left border-collapse text-xs select-none">
            <thead className="bg-neutral-900 sticky top-0 border-b border-neutral-800 text-[11px] font-mono text-neutral-400 uppercase tracking-wider z-10">
              <tr>
                <th className="py-2 px-3 w-8"></th>
                <th className="py-2 px-3">Title</th>
                <th className="py-2 px-3">Artist</th>
                <th className="py-2 px-3">Album</th>
                <th className="py-2 px-2 text-center w-16">Type</th>
                <th className="py-2 px-2 text-right w-20">Bitrate</th>
                <th className="py-2 px-2 text-right w-16">Length</th>
                <th className="py-2 px-2 text-right w-20">Size</th>
                <th className="py-2 px-3">Peer</th>
                <th className="py-2 px-2 text-center w-16">Slots</th>
                <th className="py-2 px-2 text-right w-24">Speed</th>
                <th className="py-2 px-3 text-center w-24">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-900 font-mono">
              {filteredResults.map((res) => {
                const isDownloaded = downloadedIds.has(res.id);
                return (
                  <tr
                    key={res.id}
                    className="hover:bg-neutral-900/60 transition-colors group cursor-pointer"
                    onDoubleClick={() => handleDownload(res)}
                  >
                    <td className="py-1.5 px-3 text-center">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onPlayTrack(res.track);
                        }}
                        title="Listen to preview / local track"
                        className="text-neutral-500 hover:text-emerald-400 transition-colors cursor-pointer"
                      >
                        <Play className="w-3.5 h-3.5 fill-current" />
                      </button>
                    </td>
                    <td className="py-1.5 px-3 font-sans font-medium text-neutral-100 truncate max-w-[200px]">
                      {res.track.title}
                    </td>
                    <td className="py-1.5 px-3 font-sans text-neutral-300 truncate max-w-[150px]">
                      {res.track.artist}
                    </td>
                    <td className="py-1.5 px-3 text-neutral-400 truncate max-w-[160px]">
                      {res.track.album}
                    </td>
                    <td className="py-1.5 px-2 text-center">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          res.track.format === 'FLAC'
                            ? 'bg-amber-950/80 text-amber-400 border border-amber-800/60'
                            : res.track.format === 'MP3'
                            ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-800/60'
                            : extraFormats.includes(res.track.format)
                            ? 'bg-purple-950/80 text-purple-300 border border-purple-800/60'
                            : 'bg-cyan-950/80 text-cyan-400 border border-cyan-800/60'
                        }`}
                      >
                        {res.track.format}
                      </span>
                    </td>
                    <td className="py-1.5 px-2 text-right text-neutral-400">
                      {res.track.bitrate_kbps ? `${res.track.bitrate_kbps}k` : 'VBR'}
                    </td>
                    <td className="py-1.5 px-2 text-right text-neutral-400">
                      {formatTime(res.track.duration_secs)}
                    </td>
                    <td className="py-1.5 px-2 text-right text-neutral-300">
                      {formatSize(res.track.size_bytes)}
                    </td>
                    <td className="py-1.5 px-3 text-emerald-400/90 truncate max-w-[120px]">
                      @{res.peerUser}
                    </td>
                    <td className="py-1.5 px-2 text-center">
                      <span
                        className={`text-[10px] ${
                          res.freeSlots > 0 ? 'text-emerald-400' : 'text-amber-500'
                        }`}
                      >
                        {res.freeSlots > 0 ? `${res.freeSlots} free` : 'Queued'}
                      </span>
                    </td>
                    <td className="py-1.5 px-2 text-right text-neutral-400 text-[11px]">
                      {res.speedKbps} KB/s
                    </td>
                    <td className="py-1.5 px-3 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDownload(res);
                          }}
                          disabled={isDownloaded}
                          title={isDownloaded ? 'Added to transfers' : 'Download track'}
                          className={`p-1 rounded transition-colors cursor-pointer ${
                            isDownloaded
                              ? 'bg-neutral-800 text-emerald-400 cursor-default'
                              : 'bg-emerald-600/20 text-emerald-400 hover:bg-emerald-500 hover:text-neutral-950'
                          }`}
                        >
                          {isDownloaded ? <Check className="w-3.5 h-3.5" /> : <Download className="w-3.5 h-3.5" />}
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onBrowseUser(res.peerUser);
                          }}
                          title="Browse user shared folders"
                          className="p-1 rounded bg-neutral-800 text-neutral-300 hover:bg-neutral-700 hover:text-white transition-colors cursor-pointer"
                        >
                          <FolderSearch className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
