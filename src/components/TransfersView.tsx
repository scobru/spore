import { FC } from 'react';
import { Download, Upload, Pause, Play, Trash2, CheckCircle2, Clock, ArrowDownCircle, ArrowUpCircle, Folder } from 'lucide-react';
import { Track, TransferItem } from '../types';

interface TransfersViewProps {
  transfers: TransferItem[];
  downloadDir: string;
  onChangeDownloadDir: (dir: string) => void;
  onTogglePause: (id: string) => void;
  onCancelTransfer: (id: string) => void;
  onClearCompleted: () => void;
  onPlayTrack?: (track: Track) => void;
}

export const TransfersView: FC<TransfersViewProps> = ({
  transfers,
  downloadDir,
  onChangeDownloadDir,
  onTogglePause,
  onCancelTransfer,
  onClearCompleted,
  onPlayTrack,
}) => {
  const downloads = transfers.filter((t) => t.type === 'download');
  const uploads = transfers.filter((t) => t.type === 'upload');

  const totalDlSpeed = downloads
    .filter((d) => d.status === 'transferring')
    .reduce((acc, curr) => acc + curr.speedBps, 0);

  const totalUlSpeed = uploads
    .filter((u) => u.status === 'transferring')
    .reduce((acc, curr) => acc + curr.speedBps, 0);

  const formatSpeed = (bps: number) => {
    if (bps > 1024 * 1024) {
      return `${(bps / (1024 * 1024)).toFixed(2)} MB/s`;
    }
    return `${(bps / 1024).toFixed(1)} KB/s`;
  };

  const formatBytes = (bytes: number) => {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatEta = (secs: number) => {
    if (secs <= 0 || !isFinite(secs)) return '--';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}m ${s}s`;
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-neutral-950 overflow-hidden font-mono">
      {/* Transfers Header Stats */}
      <div className="p-3 bg-neutral-900/70 border-b border-neutral-800 flex items-center justify-between text-xs">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <ArrowDownCircle className="w-4 h-4 text-emerald-400" />
            <span className="text-neutral-400">Active Downloads:</span>
            <span className="text-emerald-400 font-bold">{downloads.filter((d) => d.status === 'transferring').length}</span>
            <span className="text-neutral-500">|</span>
            <span className="text-emerald-300 font-semibold">{formatSpeed(totalDlSpeed)}</span>
          </div>
          <div className="flex items-center gap-2">
            <ArrowUpCircle className="w-4 h-4 text-cyan-400" />
            <span className="text-neutral-400">Uploads (Seeding):</span>
            <span className="text-cyan-400 font-bold">{uploads.filter((u) => u.status === 'transferring').length}</span>
            <span className="text-neutral-500">|</span>
            <span className="text-cyan-300 font-semibold">{formatSpeed(totalUlSpeed)}</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden md:flex items-center gap-1.5 bg-neutral-950 border border-neutral-800 rounded px-2 py-1">
            <Folder className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span className="text-[10px] text-neutral-500">Save to:</span>
            <input
              type="text"
              value={downloadDir}
              onChange={(e) => onChangeDownloadDir(e.target.value)}
              className="bg-transparent text-[11px] text-neutral-300 w-48 focus:outline-none font-sans"
              title="Download destination folder"
            />
          </div>

          <button
            onClick={onClearCompleted}
            disabled={!transfers.some((t) => t.status === 'completed' || t.status === 'failed')}
            className="px-2.5 py-1 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-40 text-neutral-300 rounded text-[11px] flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Clear finished
          </button>
        </div>
      </div>

      {/* Main Transfers List */}
      <div className="flex-1 overflow-auto divide-y divide-neutral-900">
        {/* DOWNLOADS SECTION */}
        <div className="bg-neutral-950">
          <div className="px-4 py-2 bg-neutral-900/40 text-[11px] text-neutral-400 uppercase tracking-wider font-semibold flex items-center gap-2">
            <Download className="w-3.5 h-3.5 text-emerald-400" />
            Download Queue ({downloads.length})
          </div>

          <table className="w-full text-left border-collapse text-xs">
            <thead className="bg-neutral-900/20 text-[11px] text-neutral-500 border-b border-neutral-900">
              <tr>
                <th className="py-1.5 px-3">Track</th>
                <th className="py-1.5 px-3">Peer</th>
                <th className="py-1.5 px-3 w-48">Progress</th>
                <th className="py-1.5 px-2 text-right w-24">Transferred</th>
                <th className="py-1.5 px-2 text-right w-24">Speed</th>
                <th className="py-1.5 px-2 text-right w-20">ETA</th>
                <th className="py-1.5 px-3 text-center w-28">Status</th>
                <th className="py-1.5 px-3 text-center w-20">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-900">
              {downloads.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-neutral-500 text-xs font-sans">
                    No active downloads. Use the <b>Search</b> tab to find and download music from peers!
                  </td>
                </tr>
              ) : (
                downloads.map((item) => (
                  <tr key={item.id} className="hover:bg-neutral-900/40 transition-colors">
                    <td className="py-2 px-3 font-sans">
                      <div className="text-neutral-200 font-medium truncate max-w-xs">{item.track.title}</div>
                      <div className="text-[11px] text-neutral-500 truncate">{item.track.artist} - {item.track.album}</div>
                    </td>
                    <td className="py-2 px-3 text-emerald-400/90 text-[11px]">@{item.peerUser}</td>
                    <td className="py-2 px-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-neutral-800 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-300 ${
                              item.status === 'completed'
                                ? 'bg-emerald-500'
                                : item.status === 'paused'
                                ? 'bg-amber-500'
                                : 'bg-emerald-400'
                            }`}
                            style={{ width: `${item.progressPercent}%` }}
                          />
                        </div>
                        <span className="text-[11px] text-neutral-400 w-9 text-right font-bold">
                          {item.progressPercent.toFixed(0)}%
                        </span>
                      </div>
                    </td>
                    <td className="py-2 px-2 text-right text-neutral-400 text-[11px]">
                      {formatBytes(item.transferredBytes)} / {formatBytes(item.track.size_bytes)}
                    </td>
                    <td className="py-2 px-2 text-right text-emerald-400 font-semibold text-[11px]">
                      {item.status === 'transferring' ? formatSpeed(item.speedBps) : '--'}
                    </td>
                    <td className="py-2 px-2 text-right text-neutral-400 text-[11px]">
                      {item.status === 'transferring' ? formatEta(item.etaSecs) : '--'}
                    </td>
                    <td className="py-2 px-3 text-center">
                      <span
                        title={item.error || item.localPath || item.status}
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold ${
                          item.status === 'completed'
                            ? 'bg-emerald-950 text-emerald-400 border border-emerald-800/60'
                            : item.status === 'failed'
                            ? 'bg-rose-950 text-rose-400 border border-rose-800/60'
                            : item.status === 'transferring'
                            ? 'bg-blue-950 text-blue-400 border border-blue-800/60 animate-pulse'
                            : item.status === 'paused'
                            ? 'bg-amber-950 text-amber-400 border border-amber-800/60'
                            : 'bg-neutral-800 text-neutral-400'
                        }`}
                      >
                        {item.status === 'completed' && <CheckCircle2 className="w-3 h-3" />}
                        {item.status === 'queued' && <Clock className="w-3 h-3" />}
                        {item.status}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        {item.status === 'completed' && item.localPath && onPlayTrack && (
                          <button
                            onClick={() => onPlayTrack({ ...item.track, path: item.localPath! })}
                            title="Play downloaded file"
                            className="p-1 rounded bg-emerald-900/50 hover:bg-emerald-800 text-emerald-300 cursor-pointer"
                          >
                            <Play className="w-3 h-3 fill-current" />
                          </button>
                        )}
                        {item.status !== 'completed' && item.status !== 'failed' && (
                          <button
                            onClick={() => onTogglePause(item.id)}
                            title={item.status === 'paused' ? 'Resume' : 'Pause'}
                            className="p-1 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-300 cursor-pointer"
                          >
                            {item.status === 'paused' ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
                          </button>
                        )}
                        <button
                          onClick={() => onCancelTransfer(item.id)}
                          title="Cancel"
                          className="p-1 rounded bg-neutral-800 hover:bg-rose-900/60 text-neutral-400 hover:text-rose-300 cursor-pointer"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* UPLOADS / SEEDING SECTION */}
        <div className="bg-neutral-950">
          <div className="px-4 py-2 bg-neutral-900/40 text-[11px] text-neutral-400 uppercase tracking-wider font-semibold flex items-center gap-2">
            <Upload className="w-3.5 h-3.5 text-cyan-400" />
            Upload Queue (Seeding to Peers) ({uploads.length})
          </div>

          <table className="w-full text-left border-collapse text-xs">
            <thead className="bg-neutral-900/20 text-[11px] text-neutral-500 border-b border-neutral-900">
              <tr>
                <th className="py-1.5 px-3">Shared Track</th>
                <th className="py-1.5 px-3">Requested by Peer</th>
                <th className="py-1.5 px-3 w-48">Progress</th>
                <th className="py-1.5 px-2 text-right w-24">Sent</th>
                <th className="py-1.5 px-2 text-right w-24">UL Speed</th>
                <th className="py-1.5 px-3 text-center w-28">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-900">
              {uploads.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-neutral-500 text-xs font-sans">
                    No active uploads. Files indexed in <b>Shares</b> will automatically be served to peers requesting them!
                  </td>
                </tr>
              ) : (
                uploads.map((item) => (
                  <tr key={item.id} className="hover:bg-neutral-900/40">
                    <td className="py-2 px-3 font-sans text-neutral-200">{item.track.title}</td>
                    <td className="py-2 px-3 text-cyan-400 text-[11px]">@{item.peerUser}</td>
                    <td className="py-2 px-3">
                      <div className="h-1.5 bg-neutral-800 rounded-full overflow-hidden">
                        <div className="h-full bg-cyan-400 rounded-full" style={{ width: `${item.progressPercent}%` }} />
                      </div>
                    </td>
                    <td className="py-2 px-2 text-right text-neutral-400 text-[11px]">{formatBytes(item.transferredBytes)}</td>
                    <td className="py-2 px-2 text-right text-cyan-400 font-semibold text-[11px]">{formatSpeed(item.speedBps)}</td>
                    <td className="py-2 px-3 text-center">
                      <span className="px-2 py-0.5 rounded text-[10px] bg-cyan-950 text-cyan-400 border border-cyan-800/60 font-bold">
                        {item.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
