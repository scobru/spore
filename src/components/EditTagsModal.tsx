import { useState, FC, FormEvent } from 'react';
import { X, Tag, Save, Music, Disc, Calendar, Layers, Folder } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { Track } from '../types';

interface EditTagsModalProps {
  track: Track | null;
  onClose: () => void;
  onTrackUpdated: (updatedTrack: Track) => void;
}

export const EditTagsModal: FC<EditTagsModalProps> = ({
  track,
  onClose,
  onTrackUpdated,
}) => {
  if (!track) return null;

  const [title, setTitle] = useState(track.title);
  const [artist, setArtist] = useState(track.artist);
  const [album, setAlbum] = useState(track.album);
  const [genre, setGenre] = useState(track.genre);
  const [year, setYear] = useState(track.year ? track.year.toString() : '');
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setErrorMessage('');

    try {
      const parsedYear = year ? parseInt(year, 10) : undefined;
      const updatedTrack = await invoke<Track>('save_track_tags', {
        payload: {
          path: track.path,
          title: title.trim(),
          artist: artist.trim(),
          album: album.trim(),
          genre: genre.trim(),
          year: isNaN(parsedYear as number) ? null : parsedYear,
        },
      });

      onTrackUpdated(updatedTrack);
      onClose();
    } catch (err: unknown) {
      console.error(err);
      setErrorMessage(`Failed to write tags to disk: ${String(err)}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 select-none font-mono">
      <div className="bg-neutral-900 border border-neutral-800 rounded-lg w-full max-w-lg shadow-2xl overflow-hidden flex flex-col">
        {/* Modal Header */}
        <div className="p-3 bg-neutral-950 border-b border-neutral-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Tag className="w-4 h-4 text-emerald-400" />
            <span className="font-bold text-neutral-100 text-xs">
              Edit Metadata (ID3 / Vorbis) — <span className="text-emerald-400">{track.filename}</span>
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-100 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body / Form */}
        <form onSubmit={handleSave} className="p-4 space-y-3.5 text-xs">
          {/* File Path Info */}
          <div className="bg-neutral-950 p-2.5 rounded border border-neutral-800 flex items-start gap-2 text-neutral-400">
            <Folder className="w-4 h-4 text-neutral-500 shrink-0 mt-0.5" />
            <div className="truncate text-[11px] font-sans">
              <span className="text-neutral-300 font-mono">Disk path: </span>
              {track.path}
            </div>
          </div>

          {/* Title */}
          <div>
            <label className="block text-[11px] text-neutral-400 mb-1 flex items-center gap-1.5">
              <Music className="w-3.5 h-3.5 text-emerald-400" />
              Track Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              className="w-full bg-neutral-950 border border-neutral-800 rounded px-3 py-1.5 text-neutral-100 focus:outline-none focus:border-emerald-500 font-sans"
            />
          </div>

          {/* Artist */}
          <div>
            <label className="block text-[11px] text-neutral-400 mb-1 flex items-center gap-1.5">
              <Disc className="w-3.5 h-3.5 text-cyan-400" />
              Artist
            </label>
            <input
              type="text"
              value={artist}
              onChange={(e) => setArtist(e.target.value)}
              required
              className="w-full bg-neutral-950 border border-neutral-800 rounded px-3 py-1.5 text-neutral-100 focus:outline-none focus:border-emerald-500 font-sans"
            />
          </div>

          {/* Album */}
          <div>
            <label className="block text-[11px] text-neutral-400 mb-1 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-amber-400" />
              Album
            </label>
            <input
              type="text"
              value={album}
              onChange={(e) => setAlbum(e.target.value)}
              className="w-full bg-neutral-950 border border-neutral-800 rounded px-3 py-1.5 text-neutral-100 focus:outline-none focus:border-emerald-500 font-sans"
            />
          </div>

          {/* Genre & Year Row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-neutral-400 mb-1">Genre</label>
              <input
                type="text"
                value={genre}
                onChange={(e) => setGenre(e.target.value)}
                className="w-full bg-neutral-950 border border-neutral-800 rounded px-3 py-1.5 text-neutral-100 focus:outline-none focus:border-emerald-500 font-sans"
              />
            </div>
            <div>
              <label className="block text-[11px] text-neutral-400 mb-1 flex items-center gap-1">
                <Calendar className="w-3 h-3 text-purple-400" />
                Year
              </label>
              <input
                type="number"
                value={year}
                onChange={(e) => setYear(e.target.value)}
                placeholder="e.g. 1996"
                className="w-full bg-neutral-950 border border-neutral-800 rounded px-3 py-1.5 text-neutral-100 focus:outline-none focus:border-emerald-500 font-mono"
              />
            </div>
          </div>

          {errorMessage && (
            <div className="p-2 bg-rose-950/60 border border-rose-800/80 rounded text-rose-300 text-[11px]">
              {errorMessage}
            </div>
          )}

          {/* Modal Footer Buttons */}
          <div className="pt-2 flex items-center justify-end gap-2 border-t border-neutral-800/80">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="px-4 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-neutral-950 font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              {isSaving ? 'Writing to Disk...' : 'Save Tags to File'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
