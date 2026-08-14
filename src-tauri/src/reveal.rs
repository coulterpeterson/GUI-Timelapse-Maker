use std::path::Path;
use std::process::{Command, Stdio};

/// Open the platform file manager with `path` selected, falling back to just
/// opening the containing folder when selection is not supported.
pub fn reveal(path: &str) -> Result<(), String> {
    let target = Path::new(path);
    if !target.exists() {
        return Err(format!("{path} no longer exists."));
    }
    platform_reveal(target)
}

#[cfg(target_os = "macos")]
fn platform_reveal(target: &Path) -> Result<(), String> {
    spawn("open", &["-R", &target.to_string_lossy()])
}

#[cfg(windows)]
fn platform_reveal(target: &Path) -> Result<(), String> {
    // `explorer` reports a non-zero exit code even on success, so this is
    // fire-and-forget by design.
    let _ = spawn("explorer", &[&format!("/select,{}", target.display())]);
    Ok(())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn platform_reveal(target: &Path) -> Result<(), String> {
    // Most Linux file managers expose this D-Bus interface and will highlight
    // the file; if the call fails we settle for opening the folder.
    let selected = spawn(
        "dbus-send",
        &[
            "--session",
            "--dest=org.freedesktop.FileManager1",
            "--type=method_call",
            "/org/freedesktop/FileManager1",
            "org.freedesktop.FileManager1.ShowItems",
            &format!("array:string:file://{}", target.display()),
            "string:",
        ],
    );
    if selected.is_ok() {
        return Ok(());
    }
    let parent = target.parent().unwrap_or(target);
    spawn("xdg-open", &[&parent.to_string_lossy()])
}

fn spawn(program: &str, args: &[&str]) -> Result<(), String> {
    Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Could not run {program}: {e}"))
}
