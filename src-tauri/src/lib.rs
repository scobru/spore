mod scanner;

use scanner::{scan_folder, hash_file_blake3, update_track_tags, TrackMetadata, UpdateTagPayload};

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            scan_music_folder,
            compute_file_hash,
            save_track_tags
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
