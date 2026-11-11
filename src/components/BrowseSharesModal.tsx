import { FC } from 'react';
import { X, Folder, Download, Disc } from 'lucide-react';
import { Track } from '../types';

interface BrowseSharesModalProps {
  username: string | null;
  tracks?: Track[];
  onClose: () => void;
  onDownloadTrack: (track: Track, username: string) => void;
  onDownloadAll: (tracks: Track[], username: string) => void;
}

export const BrowseSharesModal: FC<BrowseSharesModalProps> = ({
  username,
  tracks = [],
  onClose,
  onDownloadTrack,
  onDownloadAll,
}) => {
  if (!username) return null;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-neutral-900 border border-neutral-800 rounded-lg w-full max-w-3xl h-[520px] flex flex-col shadow-2xl overflow-hidden font-mono">
        {/* Modal Header */}
        <div className="p-3 bg-neutral-950 border-b border-neutral-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Folder className="w-4 h-4 text-emerald-400" />
            <span className="font-bold text-neutral-100 text-xs">
              Shared Library of <span className="text-emerald-400">@{username}</span>
            </span>
          </div>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-100 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Folder Header */}
        <div className="p-4 bg-neutral-950/40 border-b border-neutral-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-neutral-800 rounded flex items-center justify-center text-emerald-400 border border-neutral-700">
              <Disc className="w-5 h-5" />
            </div>
            <div>
              <div className="text-sm font-bold text-neutral-100 font-sans">
                {tracks.length > 0 ? `${tracks[0].artist} - ${tracks[0].album}` : 'Shared Collection'}
              </div>
              <div className="text-xs text-neutral-400 flex items-center gap-2 mt-0.5">
                <span>{tracks.length} tracks available</span>
              </div>
            </div>
          </div>

          {tracks.length > 0 && (
            <button
              onClick={() => onDownloadAll(tracks, username)}
              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-neutral-950 font-bold rounded text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              Download all tracks
            </button>
          )}
        </div>

        {/* Tracks Table */}
        <div className="flex-1 overflow-auto">
          {tracks.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-neutral-500 font-sans text-xs">
              This peer has not published any public folders yet.
            </div>
          ) : (
            <table className="w-full text-left text-xs">
              <thead className="bg-neutral-950 sticky top-0 border-b border-neutral-800 text-[11px] text-neutral-400">
                <tr>
                  <th className="py-2 px-3">Track</th>
                  <th className="py-2 px-2 text-center w-16">Format</th>
                  <th className="py-2 px-2 text-right w-20">Bitrate</th>
                  <th className="py-2 px-2 text-right w-20">Length</th>
                  <th className="py-2 px-2 text-right w-24">Size</th>
                  <th className="py-2 px-3 text-center w-24">Download</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-900">
                {tracks.map((track, i) => (
                  <tr key={i} className="hover:bg-neutral-800/40">
                    <td className="py-2 px-3 font-sans text-neutral-200">
                      <span className="text-neutral-500 font-mono mr-2">{(i + 1).toString().padStart(2, '0')}</span>
                      {track.title}
                    </td>
                    <td className="py-2 px-2 text-center">
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-950 text-amber-400 border border-amber-800/60 font-bold">
                        {track.format}
                      </span>
                    </td>
                    <td className="py-2 px-2 text-right text-neutral-400">{track.bitrate_kbps ? `${track.bitrate_kbps}k` : 'VBR'}</td>
                    <td className="py-2 px-2 text-right text-neutral-400">
                      {Math.floor(track.duration_secs / 60)}:{(track.duration_secs % 60).toString().padStart(2, '0')}
                    </td>
                    <td className="py-2 px-2 text-right text-neutral-300">
                      {(track.size_bytes / (1024 * 1024)).toFixed(1)} MB
                    </td>
                    <td className="py-2 px-3 text-center">
                      <button
                        onClick={() => onDownloadTrack(track, username)}
                        className="p-1 rounded bg-neutral-800 hover:bg-emerald-600 hover:text-neutral-950 text-neutral-300 transition-colors cursor-pointer"
                        title="Download track"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};
