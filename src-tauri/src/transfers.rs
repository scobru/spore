use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

/// Sanitize a filename so a remote peer cannot traverse directories.
fn sanitize_filename(name: &str) -> String {
    let base = Path::new(name)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("download.bin");
    let cleaned: String = base
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            c if c.is_control() => '_',
            c => c,
        })
        .collect();
    if cleaned.is_empty() {
        "download.bin".to_string()
    } else {
        cleaned
    }
}

pub fn default_download_dir() -> Result<String, String> {
    if let Ok(profile) = std::env::var("USERPROFILE") {
        let p = PathBuf::from(profile).join("Downloads").join("Spore");
        return Ok(p.to_string_lossy().to_string());
    }
    if let Ok(home) = std::env::var("HOME") {
        let p = PathBuf::from(home).join("Downloads").join("Spore");
        return Ok(p.to_string_lossy().to_string());
    }
    Ok("SporeDownloads".to_string())
}

pub fn read_file_chunk(file_path: &str, offset: u64, length: usize) -> Result<Vec<u8>, String> {
    let mut file = File::open(file_path).map_err(|e| format!("Failed to open file: {}", e))?;
    file.seek(SeekFrom::Start(offset))
        .map_err(|e| format!("Failed to seek file: {}", e))?;
    let mut buf = vec![0u8; length];
    let n = file
        .read(&mut buf)
        .map_err(|e| format!("Failed to read file: {}", e))?;
    buf.truncate(n);
    Ok(buf)
}

pub fn write_file_chunk(
    dest_dir: &str,
    filename: &str,
    offset: u64,
    data: &[u8],
) -> Result<String, String> {
    let dir = Path::new(dest_dir);
    fs::create_dir_all(dir).map_err(|e| format!("Failed to create download dir: {}", e))?;

    let safe_name = sanitize_filename(filename);
    let part_path = dir.join(format!("{}.part", safe_name));

    let mut file = OpenOptions::new()
        .create(true)
        .write(true)
        .open(&part_path)
        .map_err(|e| format!("Failed to open part file: {}", e))?;

    file.seek(SeekFrom::Start(offset))
        .map_err(|e| format!("Failed to seek part file: {}", e))?;
    file.write_all(data)
        .map_err(|e| format!("Failed to write chunk: {}", e))?;

    Ok(part_path.to_string_lossy().to_string())
}

pub fn finalize_download(
    dest_dir: &str,
    filename: &str,
    expected_blake3: &str,
) -> Result<String, String> {
    let dir = Path::new(dest_dir);
    let safe_name = sanitize_filename(filename);
    let part_path = dir.join(format!("{}.part", safe_name));

    if !part_path.exists() {
        return Err("Partial download file not found".to_string());
    }

    if !expected_blake3.is_empty() {
        let mut file = File::open(&part_path).map_err(|e| format!("Failed to open part: {}", e))?;
        let mut hasher = blake3::Hasher::new();
        std::io::copy(&mut file, &mut hasher).map_err(|e| format!("Hash error: {}", e))?;
        let actual = hasher.finalize().to_hex().to_string();
        if actual != expected_blake3 {
            return Err(format!(
                "BLAKE3 mismatch: expected {}, got {}",
                &expected_blake3[..12.min(expected_blake3.len())],
                &actual[..12.min(actual.len())]
            ));
        }
    }

    let mut final_path = dir.join(&safe_name);
    if final_path.exists() {
        let stem = Path::new(&safe_name)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("file");
        let ext = Path::new(&safe_name)
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("");
        let mut counter = 1u32;
        loop {
            let candidate = if ext.is_empty() {
                format!("{} ({})", stem, counter)
            } else {
                format!("{} ({}).{}", stem, counter, ext)
            };
            let p = dir.join(candidate);
            if !p.exists() {
                final_path = p;
                break;
            }
            counter += 1;
        }
    }

    fs::rename(&part_path, &final_path)
        .map_err(|e| format!("Failed to rename completed download: {}", e))?;

    Ok(final_path.to_string_lossy().to_string())
}

pub fn cancel_download_part(dest_dir: &str, filename: &str) -> Result<(), String> {
    let dir = Path::new(dest_dir);
    let safe_name = sanitize_filename(filename);
    let part_path = dir.join(format!("{}.part", safe_name));
    if part_path.exists() {
        fs::remove_file(&part_path).map_err(|e| format!("Failed to remove part file: {}", e))?;
    }
    Ok(())
}
