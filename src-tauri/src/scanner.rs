use serde::{Deserialize, Serialize};
use std::fs::File;
use std::path::Path;
use lofty::file::{AudioFile, TaggedFileExt};
use lofty::probe::Probe;
use lofty::tag::{Accessor, Tag, TagExt};
use lofty::config::WriteOptions;
use walkdir::WalkDir;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct UpdateTagPayload {
    pub path: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub genre: String,
    pub year: Option<u32>,
}

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

/// Scans a directory recursively for audio files and release extras.
pub fn scan_folder<P: AsRef<Path>>(dir: P) -> Result<Vec<TrackMetadata>, String> {
    let mut tracks = Vec::new();
    let audio_extensions = ["mp3", "flac", "wav", "ogg", "opus", "m4a", "aac", "aiff"];
    let extra_extensions = ["jpg", "jpeg", "png", "webp", "pdf", "cue", "log", "nfo", "txt"];

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

        let is_audio = audio_extensions.contains(&ext.as_str());
        let is_extra = extra_extensions.contains(&ext.as_str());

        if !is_audio && !is_extra {
            continue;
        }

        let filename = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("Unknown")
            .to_string();

        let metadata = path.metadata().ok();
        let size_bytes = metadata.map(|m| m.len()).unwrap_or(0);

        let parent_folder = path
            .parent()
            .and_then(|p| p.file_name())
            .and_then(|s| s.to_str())
            .unwrap_or("Release Extra")
            .to_string();

        let mut title = filename.clone();
        let mut artist = if is_extra { "Release Extra".to_string() } else { "Unknown Artist".to_string() };
        let mut album = parent_folder;
        let mut genre = if is_extra { "Artwork / Notes".to_string() } else { "Unknown".to_string() };
        let mut year = None;
        let mut duration_secs = 0;
        let mut bitrate_kbps = None;
        let mut sample_rate = None;

        if is_audio {
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

/// Updates audio tags (ID3 / Vorbis) on the actual file on disk.
pub fn update_track_tags(payload: UpdateTagPayload) -> Result<TrackMetadata, String> {
    let path = Path::new(&payload.path);
    if !path.exists() {
        return Err("File does not exist on disk".to_string());
    }

    let audio_extensions = ["mp3", "flac", "wav", "ogg", "opus", "m4a", "aac", "aiff"];
    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_lowercase())
        .unwrap_or_default();

    if !audio_extensions.contains(&ext.as_str()) {
        return Err("Tag editing is only supported on audio tracks (MP3, FLAC, OGG, WAV, etc.)".to_string());
    }

    let mut tagged_file = Probe::open(path)
        .map_err(|e| format!("Probe error: {}", e))?
        .read()
        .map_err(|e| format!("Read error: {}", e))?;

    let tag = match tagged_file.primary_tag_mut() {
        Some(t) => t,
        None => {
            if let Some(first_tag) = tagged_file.first_tag_mut() {
                first_tag
            } else {
                let tag_type = tagged_file.primary_tag_type();
                tagged_file.insert_tag(Tag::new(tag_type));
                tagged_file.primary_tag_mut().ok_or("Failed to create tag")?
            }
        }
    };

    tag.set_title(payload.title.clone());
    tag.set_artist(payload.artist.clone());
    tag.set_album(payload.album.clone());
    tag.set_genre(payload.genre.clone());
    if let Some(year) = payload.year {
        tag.set_year(year);
    }

    tag.save_to_path(path, WriteOptions::default())
        .map_err(|e| format!("Failed to save tag to file: {}", e))?;

    // Return the updated TrackMetadata with recomputed hash
    let new_hash = hash_file_blake3(path).unwrap_or_default();
    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_uppercase())
        .unwrap_or_default();

    let properties = tagged_file.properties();
    let duration_secs = properties.duration().as_secs();
    let bitrate_kbps = properties.audio_bitrate();
    let sample_rate = properties.sample_rate();
    let size_bytes = path.metadata().map(|m| m.len()).unwrap_or(0);
    let filename = path.file_name().and_then(|s| s.to_str()).unwrap_or("Unknown").to_string();

    Ok(TrackMetadata {
        path: payload.path,
        filename,
        title: payload.title,
        artist: payload.artist,
        album: payload.album,
        genre: payload.genre,
        year: payload.year,
        duration_secs,
        bitrate_kbps,
        sample_rate,
        format: ext,
        size_bytes,
        blake3_hash: new_hash,
    })
}
