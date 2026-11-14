mod scanner;
mod transfers;

use scanner::{scan_folder, hash_file_blake3, update_track_tags, TrackMetadata, UpdateTagPayload};
use transfers::{
    cancel_download_part as cancel_part_impl, default_download_dir, finalize_download as finalize_impl,
    read_file_chunk as read_chunk_impl, write_file_chunk as write_chunk_impl,
};

#[tauri::command]
fn scan_music_folder(folder_path: String) -> Result<Vec<TrackMetadata>, String> {
    scan_folder(folder_path)
}

#[tauri::command]
fn compute_file_hash(file_path: String) -> Result<String, String> {
    hash_file_blake3(file_path)
}

#[tauri::command]
fn save_track_tags(payload: UpdateTagPayload) -> Result<TrackMetadata, String> {
    update_track_tags(payload)
}

#[tauri::command]
fn get_default_download_dir() -> Result<String, String> {
    default_download_dir()
}

#[tauri::command]
fn read_file_chunk(file_path: String, offset: u64, length: usize) -> Result<Vec<u8>, String> {
    read_chunk_impl(&file_path, offset, length)
}

#[tauri::command]
fn write_file_chunk(
    dest_dir: String,
    filename: String,
    offset: u64,
    data: Vec<u8>,
) -> Result<String, String> {
    write_chunk_impl(&dest_dir, &filename, offset, &data)
}

#[tauri::command]
fn finalize_download(
    dest_dir: String,
    filename: String,
    expected_blake3: String,
) -> Result<String, String> {
    finalize_impl(&dest_dir, &filename, &expected_blake3)
}

#[tauri::command]
fn cancel_download_part(dest_dir: String, filename: String) -> Result<(), String> {
    cancel_part_impl(&dest_dir, &filename)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            scan_music_folder,
            compute_file_hash,
            save_track_tags,
            get_default_download_dir,
            read_file_chunk,
            write_file_chunk,
            finalize_download,
            cancel_download_part
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
