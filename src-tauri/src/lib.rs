mod ffmpeg;
mod reveal;
mod scan;
mod thumbs;

use std::path::PathBuf;
use std::sync::Arc;

use tauri::{AppHandle, Manager, State};

use ffmpeg::{EncodeOptions, EncodeState, FfmpegInfo};
use scan::ImageEntry;

struct AppState {
    encode: Arc<EncodeState>,
}

fn app_cache(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_cache_dir()
        .map_err(|e| format!("Could not locate the app cache folder: {e}"))
}

#[tauri::command]
async fn list_images(folder: String) -> Result<Vec<ImageEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || scan::list_images(&folder))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn image_size(path: String) -> Result<(u32, u32), String> {
    tauri::async_runtime::spawn_blocking(move || scan::image_size(&path))
        .await
        .map_err(|e| e.to_string())?
}

/// Returns the path of a cached, downscaled JPEG for `path`. Decoding happens
/// on a blocking thread so a folder full of 45 MP frames cannot stall the UI.
#[tauri::command]
async fn thumbnail(app: AppHandle, path: String, max: u32) -> Result<String, String> {
    let cache = app_cache(&app)?;
    tauri::async_runtime::spawn_blocking(move || thumbs::get_or_create(&cache, &path, max))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn probe_ffmpeg(custom: Option<String>) -> Result<FfmpegInfo, String> {
    tauri::async_runtime::spawn_blocking(move || ffmpeg::probe(custom.as_deref()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn start_encode(
    app: AppHandle,
    state: State<'_, AppState>,
    options: EncodeOptions,
) -> Result<(), String> {
    if state.encode.is_running() {
        return Err("An encode is already running.".into());
    }
    if options.frames.is_empty() {
        return Err("Select a start and end frame first.".into());
    }
    if options.output.trim().is_empty() {
        return Err("Choose an output file name.".into());
    }

    let work_dir = app_cache(&app)?.join("work");
    ffmpeg::spawn_encode(app.clone(), Arc::clone(&state.encode), work_dir, options);
    Ok(())
}

#[tauri::command]
fn cancel_encode(state: State<'_, AppState>) -> bool {
    state.encode.cancel()
}

#[tauri::command]
fn reveal_in_file_manager(path: String) -> Result<(), String> {
    reveal::reveal(&path)
}

#[tauri::command]
async fn thumb_cache_bytes(app: AppHandle) -> Result<u64, String> {
    let cache = app_cache(&app)?;
    Ok(tauri::async_runtime::spawn_blocking(move || thumbs::cache_size(&cache))
        .await
        .map_err(|e| e.to_string())?)
}

#[tauri::command]
async fn clear_thumb_cache(app: AppHandle) -> Result<(), String> {
    let cache = app_cache(&app)?;
    tauri::async_runtime::spawn_blocking(move || thumbs::clear_cache(&cache))
        .await
        .map_err(|e| e.to_string())?
}

/// True when `path` names a file we could overwrite.
#[tauri::command]
fn path_exists(path: String) -> bool {
    std::path::Path::new(&path).exists()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState { encode: Arc::new(EncodeState::default()) })
        .invoke_handler(tauri::generate_handler![
            list_images,
            image_size,
            thumbnail,
            probe_ffmpeg,
            start_encode,
            cancel_encode,
            reveal_in_file_manager,
            thumb_cache_bytes,
            clear_thumb_cache,
            path_exists,
        ])
        .run(tauri::generate_context!())
        .expect("error while running GUI Timelapse Maker");
}
