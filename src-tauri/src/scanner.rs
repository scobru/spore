use serde::{Deserialize, Serialize};
use std::fs::File;
use std::path::Path;
use lofty::file::{AudioFile, TaggedFileExt};
use lofty::probe::Probe;
use lofty::tag::Accessor;
use walkdir::WalkDir;

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

/// Compute fast BLAKE3 hash for a file.
pub fn hash_file_blake3<P: AsRef<Path>>(path: P) -> Result<String, String> {
    let mut file = File::open(path).map_err(|e| format!("Failed to open file: {}", e))?;
    let mut hasher = blake3::Hasher::new();
    std::io::copy(&mut file, &mut hasher).map_err(|e| format!("Hash copy error: {}", e))?;
    Ok(hasher.finalize().to_hex().to_string())
}

/// Scans a directory recursively for audio files and extracts metadata.
pub fn scan_folder<P: AsRef<Path>>(dir: P) -> Result<Vec<TrackMetadata>, String> {
    let mut tracks = Vec::new();
    let supported_extensions = ["mp3", "flac", "wav", "ogg", "opus", "m4a", "aac", "aiff"];

    for entry in WalkDir::new(dir)
        .follow_links(true)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let ext = path
            .extension()
            .and_then(|s| s.to_str())
            .map(|s| s.to_lowercase())
            .unwrap_or_default();

        if !supported_extensions.contains(&ext.as_str()) {
            continue;
        }

        let filename = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("Unknown")
            .to_string();

        let metadata = path.metadata().ok();
        let size_bytes = metadata.map(|m| m.len()).unwrap_or(0);

        let mut title = filename.clone();
        let mut artist = "Unknown Artist".to_string();
        let mut album = "Unknown Album".to_string();
        let mut genre = "Unknown".to_string();
        let mut year = None;
        let mut duration_secs = 0;
        let mut bitrate_kbps = None;
        let mut sample_rate = None;

        // Try reading audio tags using lofty
        if let Ok(tagged_file) = Probe::open(path).and_then(|p| p.read()) {
            let properties = tagged_file.properties();
            duration_secs = properties.duration().as_secs();
            bitrate_kbps = properties.audio_bitrate();
            sample_rate = properties.sample_rate();

            if let Some(tag) = tagged_file.primary_tag().or_else(|| tagged_file.first_tag()) {
                if let Some(t) = tag.title() {
                    title = t.to_string();
                }
                if let Some(a) = tag.artist() {
                    artist = a.to_string();
                }
                if let Some(al) = tag.album() {
                    album = al.to_string();
                }
                if let Some(g) = tag.genre() {
                    genre = g.to_string();
                }
                year = tag.year();
            }
        }

        // Fast hash
        let blake3_hash = hash_file_blake3(path).unwrap_or_default();

        tracks.push(TrackMetadata {
            path: path.to_string_lossy().to_string(),
            filename,
            title,
            artist,
            album,
            genre,
            year,
            duration_secs,
            bitrate_kbps,
            sample_rate,
            format: ext.to_uppercase(),
            size_bytes,
            blake3_hash,
        });
    }

    Ok(tracks)
}
