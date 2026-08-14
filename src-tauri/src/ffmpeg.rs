use std::collections::VecDeque;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

/// Build a `Command` that will not flash a console window on Windows.
pub fn quiet_command(program: &Path) -> Command {
    let cmd = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let mut cmd = cmd;
        cmd.creation_flags(CREATE_NO_WINDOW);
        return cmd;
    }
    #[cfg(not(windows))]
    cmd
}

#[cfg(windows)]
const EXE: &str = "ffmpeg.exe";
#[cfg(not(windows))]
const EXE: &str = "ffmpeg";

/// Locations to try beyond `PATH`. A GUI app launched from Finder or the
/// Start menu inherits a minimal environment, so Homebrew/MacPorts installs
/// are usually invisible unless we look for them explicitly.
#[cfg(target_os = "macos")]
const EXTRA_DIRS: &[&str] = &[
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/opt/local/bin",
    "/usr/bin",
];
#[cfg(target_os = "linux")]
const EXTRA_DIRS: &[&str] = &["/usr/bin", "/usr/local/bin", "/snap/bin", "/var/lib/flatpak/exports/bin"];
#[cfg(windows)]
const EXTRA_DIRS: &[&str] = &[
    r"C:\ffmpeg\bin",
    r"C:\Program Files\ffmpeg\bin",
    r"C:\ProgramData\chocolatey\bin",
];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FfmpegInfo {
    pub path: String,
    pub version: String,
}

/// Resolve an ffmpeg binary: an explicit override first, then a copy shipped
/// next to our own executable, then `PATH`, then the usual install prefixes.
pub fn find_ffmpeg(custom: Option<&str>) -> Option<PathBuf> {
    if let Some(c) = custom.map(str::trim).filter(|c| !c.is_empty()) {
        let p = PathBuf::from(c);
        return p.is_file().then_some(p);
    }

    if let Some(dir) = std::env::current_exe().ok().and_then(|p| p.parent().map(Path::to_path_buf)) {
        let side = dir.join(EXE);
        if side.is_file() {
            return Some(side);
        }
    }

    let path_dirs = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect::<Vec<_>>())
        .unwrap_or_default();

    path_dirs
        .into_iter()
        .chain(EXTRA_DIRS.iter().map(PathBuf::from))
        .map(|d| d.join(EXE))
        .find(|c| c.is_file())
}

pub fn probe(custom: Option<&str>) -> Result<FfmpegInfo, String> {
    let path = find_ffmpeg(custom).ok_or_else(|| {
        "ffmpeg was not found. Install it, or point the app at the binary manually.".to_string()
    })?;

    let out = quiet_command(&path)
        .arg("-version")
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("Could not run {}: {e}", path.display()))?;

    if !out.status.success() {
        return Err(format!("{} -version exited with {}", path.display(), out.status));
    }

    let version = String::from_utf8_lossy(&out.stdout)
        .lines()
        .next()
        .unwrap_or("ffmpeg")
        .trim()
        .to_string();

    Ok(FfmpegInfo { path: path.to_string_lossy().to_string(), version })
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EncodeOptions {
    /// Absolute paths of the frames, already trimmed to the chosen range and
    /// in the order they should appear.
    pub frames: Vec<String>,
    pub fps: u32,
    pub width: u32,
    pub height: u32,
    pub output: String,
    /// x264 CRF. Lower is better quality and a bigger file.
    pub crf: u32,
    pub preset: String,
    pub ffmpeg_path: Option<String>,
}

#[derive(Default)]
pub struct EncodeState {
    child: Mutex<Option<Child>>,
    cancelled: AtomicBool,
    running: AtomicBool,
}

impl EncodeState {
    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }

    /// Kill the in-flight ffmpeg, if any.
    pub fn cancel(&self) -> bool {
        if !self.is_running() {
            return false;
        }
        self.cancelled.store(true, Ordering::SeqCst);
        if let Ok(mut guard) = self.child.lock() {
            if let Some(child) = guard.as_mut() {
                let _ = child.kill();
                return true;
            }
        }
        false
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Progress {
    frame: u64,
    total_frames: u64,
    percent: f64,
    fps: f64,
    speed: String,
    elapsed_ms: u128,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Done {
    output: String,
    elapsed_ms: u128,
    size_bytes: u64,
}

/// Escape one path for the concat demuxer's `file '...'` syntax.
fn concat_line(path: &str) -> String {
    // Backslashes confuse the demuxer's own escaping on Windows, and forward
    // slashes work there too.
    let normalized = path.replace('\\', "/");
    format!("file '{}'", normalized.replace('\'', r"'\''"))
}

fn write_concat_list(dir: &Path, opts: &EncodeOptions) -> Result<PathBuf, String> {
    let list_path = dir.join("timelapse-frames.txt");
    let file = std::fs::File::create(&list_path)
        .map_err(|e| format!("Could not write the frame list: {e}"))?;
    let mut w = std::io::BufWriter::new(file);

    // Deliberately no per-entry `duration`: pacing comes from the demuxer's
    // input frame rate instead. Declaring durations here makes ffmpeg emit one
    // extra frame at the tail when it resamples to CFR.
    writeln!(w, "ffconcat version 1.0").map_err(stringify)?;
    for f in &opts.frames {
        writeln!(w, "{}", concat_line(f)).map_err(stringify)?;
    }
    w.flush().map_err(stringify)?;
    Ok(list_path)
}

fn stringify(e: std::io::Error) -> String {
    e.to_string()
}

fn build_args(list: &Path, opts: &EncodeOptions) -> Vec<String> {
    // yuv420p needs even dimensions; round down rather than surprise the user
    // with a stretched frame.
    let w = opts.width.max(2) & !1;
    let h = opts.height.max(2) & !1;

    let vf = format!(
        "scale={w}:{h}:force_original_aspect_ratio=decrease:flags=lanczos,\
         pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1"
    );

    vec![
        "-hide_banner".into(),
        "-nostdin".into(),
        "-y".into(),
        // Input frame rate: one image per 1/fps second, in list order.
        "-r".into(),
        opts.fps.to_string(),
        "-f".into(),
        "concat".into(),
        "-safe".into(),
        "0".into(),
        "-i".into(),
        list.to_string_lossy().to_string(),
        "-vf".into(),
        vf,
        "-r".into(),
        opts.fps.to_string(),
        "-fps_mode".into(),
        "cfr".into(),
        // Belt and braces: the clip is exactly as long as the chosen range,
        // whatever the demuxer decides to do at the tail.
        "-frames:v".into(),
        opts.frames.len().to_string(),
        "-c:v".into(),
        "libx264".into(),
        "-preset".into(),
        opts.preset.clone(),
        "-crf".into(),
        opts.crf.to_string(),
        "-pix_fmt".into(),
        "yuv420p".into(),
        "-movflags".into(),
        "+faststart".into(),
        "-progress".into(),
        "pipe:1".into(),
        "-nostats".into(),
        opts.output.clone(),
    ]
}

/// Run ffmpeg on a worker thread, streaming progress back to the UI as events.
pub fn spawn_encode(app: AppHandle, state: Arc<EncodeState>, work_dir: PathBuf, opts: EncodeOptions) {
    std::thread::spawn(move || {
        state.running.store(true, Ordering::SeqCst);
        state.cancelled.store(false, Ordering::SeqCst);

        let result = run_encode(&app, &state, &work_dir, &opts);

        state.running.store(false, Ordering::SeqCst);
        if let Ok(mut g) = state.child.lock() {
            *g = None;
        }

        match result {
            Ok(Some(done)) => {
                let _ = app.emit("encode:done", done);
            }
            // `None` means we killed it on purpose.
            Ok(None) => {
                let _ = app.emit("encode:cancelled", ());
            }
            Err(message) => {
                let _ = app.emit("encode:error", message);
            }
        }
    });
}

fn run_encode(
    app: &AppHandle,
    state: &EncodeState,
    work_dir: &Path,
    opts: &EncodeOptions,
) -> Result<Option<Done>, String> {
    if opts.frames.is_empty() {
        return Err("No frames were selected.".into());
    }
    let bin = find_ffmpeg(opts.ffmpeg_path.as_deref())
        .ok_or_else(|| "ffmpeg was not found on this machine.".to_string())?;

    std::fs::create_dir_all(work_dir).map_err(|e| format!("Could not create a work folder: {e}"))?;
    if let Some(parent) = Path::new(&opts.output).parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Could not create the output folder: {e}"))?;
    }

    let list = write_concat_list(work_dir, opts)?;
    let args = build_args(&list, opts);
    let _ = app.emit(
        "encode:log",
        format!("{} {}", bin.display(), args.join(" ")),
    );

    let mut child = quiet_command(&bin)
        .args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Could not start ffmpeg: {e}"))?;

    let stdout = child.stdout.take().ok_or("ffmpeg produced no progress stream")?;
    let stderr = child.stderr.take().ok_or("ffmpeg produced no error stream")?;

    *state.child.lock().map_err(|_| "encoder state was poisoned")? = Some(child);

    // ffmpeg reports real diagnostics on stderr; keep the tail so a failure can
    // be explained rather than reduced to an exit code.
    let tail: Arc<Mutex<VecDeque<String>>> = Arc::new(Mutex::new(VecDeque::new()));
    let stderr_tail = Arc::clone(&tail);
    let stderr_app = app.clone();
    let stderr_thread = std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            let _ = stderr_app.emit("encode:log", line.clone());
            if let Ok(mut t) = stderr_tail.lock() {
                if t.len() == 40 {
                    t.pop_front();
                }
                t.push_back(line);
            }
        }
    });

    let started = Instant::now();
    let total = opts.frames.len() as u64;
    let mut frame: u64 = 0;
    let mut fps = 0.0_f64;
    let mut speed = String::from("0x");

    for line in BufReader::new(stdout).lines().map_while(Result::ok) {
        let Some((key, value)) = line.split_once('=') else { continue };
        match key.trim() {
            "frame" => frame = value.trim().parse().unwrap_or(frame),
            "fps" => fps = value.trim().parse().unwrap_or(fps),
            "speed" => speed = value.trim().to_string(),
            "progress" => {
                let percent = if total > 0 {
                    ((frame as f64 / total as f64) * 100.0).clamp(0.0, 100.0)
                } else {
                    0.0
                };
                let _ = app.emit(
                    "encode:progress",
                    Progress {
                        frame,
                        total_frames: total,
                        percent,
                        fps,
                        speed: speed.clone(),
                        elapsed_ms: started.elapsed().as_millis(),
                    },
                );
            }
            _ => {}
        }
    }

    let mut child = state
        .child
        .lock()
        .map_err(|_| "encoder state was poisoned")?
        .take()
        .ok_or("the encoder was already torn down")?;
    let status = child.wait().map_err(|e| format!("ffmpeg failed: {e}"))?;
    let _ = stderr_thread.join();
    let _ = std::fs::remove_file(&list);

    if state.cancelled.load(Ordering::SeqCst) {
        let _ = std::fs::remove_file(&opts.output);
        return Ok(None);
    }

    if !status.success() {
        let detail = tail
            .lock()
            .map(|t| t.iter().cloned().collect::<Vec<_>>().join("\n"))
            .unwrap_or_default();
        return Err(if detail.trim().is_empty() {
            format!("ffmpeg exited with {status}")
        } else {
            format!("ffmpeg exited with {status}:\n{detail}")
        });
    }

    let size_bytes = std::fs::metadata(&opts.output).map(|m| m.len()).unwrap_or(0);
    Ok(Some(Done {
        output: opts.output.clone(),
        elapsed_ms: started.elapsed().as_millis(),
        size_bytes,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quotes_in_filenames_are_escaped() {
        assert_eq!(concat_line("/a/b'c.jpg"), r"file '/a/b'\''c.jpg'");
    }

    #[test]
    fn windows_separators_become_forward_slashes() {
        assert_eq!(concat_line(r"C:\shots\a.jpg"), "file 'C:/shots/a.jpg'");
    }

    /// Drives the real `write_concat_list` + `build_args` output through a real
    /// ffmpeg and checks the resulting file, so a broken filter chain or a
    /// mis-escaped path fails here rather than in front of the user. Skipped
    /// when the machine has no ffmpeg.
    #[test]
    fn produces_a_playable_mp4_from_real_frames() {
        let Some(bin) = find_ffmpeg(None) else {
            eprintln!("skipping: ffmpeg not installed");
            return;
        };

        let dir = std::env::temp_dir().join("gtm-encode-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        // A space and an apostrophe in the name exercise the concat escaping.
        let mut frames = Vec::new();
        for i in 0..12u32 {
            let mut img = image::RgbImage::new(160, 120);
            for (x, y, px) in img.enumerate_pixels_mut() {
                *px = image::Rgb([(x as u32 * 2 % 256) as u8, (y * 2 % 256) as u8, (i * 20) as u8]);
            }
            let p = dir.join(format!("Coulter's shot {i:03}.png"));
            img.save(&p).unwrap();
            frames.push(p.to_string_lossy().to_string());
        }

        let ffprobe = bin.with_file_name(if cfg!(windows) { "ffprobe.exe" } else { "ffprobe" });

        for fps in [30u32, 60] {
            let output = dir.join(format!("out{fps}.mp4"));
            let opts = EncodeOptions {
                frames: frames.clone(),
                fps,
                width: 320,
                height: 240,
                output: output.to_string_lossy().to_string(),
                crf: 30,
                preset: "ultrafast".into(),
                ffmpeg_path: None,
            };

            let list = write_concat_list(&dir, &opts).unwrap();
            let out = quiet_command(&bin)
                .args(build_args(&list, &opts))
                .stdin(Stdio::null())
                .output()
                .unwrap();
            assert!(
                out.status.success(),
                "ffmpeg failed at {fps} fps:\n{}",
                String::from_utf8_lossy(&out.stderr)
            );
            assert!(
                std::fs::metadata(&output).unwrap().len() > 0,
                "output file is empty at {fps} fps"
            );

            if !ffprobe.is_file() {
                continue;
            }
            // Every selected frame must land in the video exactly once, and the
            // clip must be exactly `count / fps` seconds long.
            let probe = quiet_command(&ffprobe)
                .args([
                    "-v", "error", "-count_frames", "-select_streams", "v:0",
                    "-show_entries", "stream=nb_read_frames:format=duration",
                    "-of", "csv=p=0",
                ])
                .arg(&output)
                .output()
                .unwrap();
            assert!(probe.status.success(), "ffprobe failed");

            let text = String::from_utf8_lossy(&probe.stdout);
            let mut values = text.split_whitespace();
            let counted: usize = values.next().unwrap_or("0").trim().parse().unwrap_or(0);
            let seconds: f64 = values.next().unwrap_or("0").trim().parse().unwrap_or(0.0);

            assert_eq!(counted, frames.len(), "frame count mismatch at {fps} fps");
            let expected = frames.len() as f64 / fps as f64;
            assert!(
                (seconds - expected).abs() < 0.01,
                "duration at {fps} fps was {seconds}s, expected {expected}s"
            );
        }

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn odd_dimensions_are_rounded_to_even() {
        let opts = EncodeOptions {
            frames: vec!["/a.jpg".into()],
            fps: 30,
            width: 1921,
            height: 1081,
            output: "/out.mp4".into(),
            crf: 20,
            preset: "medium".into(),
            ffmpeg_path: None,
        };
        let args = build_args(Path::new("/list.txt"), &opts);
        let vf = args.iter().find(|a| a.starts_with("scale=")).unwrap();
        assert!(vf.contains("scale=1920:1080"), "{vf}");
    }
}
