import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { joinPath, pathExists } from "../api";
import { clipLength, plural } from "../format";
import { QUALITY_PRESETS, type FfmpegInfo, type ImageEntry } from "../types";
import { Thumb } from "./Thumb";
import { AlertIcon, FolderIcon } from "./icons";

export interface RenderSettings {
  fps: number;
  width: number;
  height: number;
  quality: string;
  outName: string;
  outDir: string;
}

interface Props {
  frameCount: number;
  startImage: ImageEntry;
  endImage: ImageEntry;
  sourceSize: [number, number] | null;
  settings: RenderSettings;
  onChange: (next: RenderSettings) => void;
  onBack: () => void;
  onStart: () => void;
  ffmpeg: FfmpegInfo | null;
  ffmpegError: string | null;
}

/** Standard targets plus whatever the start frame happens to be. */
function resolutionPresets(source: [number, number] | null) {
  const list: { label: string; w: number; h: number }[] = [];
  if (source) list.push({ label: `Source ${source[0]}×${source[1]}`, w: source[0], h: source[1] });
  list.push(
    { label: "4K UHD", w: 3840, h: 2160 },
    { label: "1440p", w: 2560, h: 1440 },
    { label: "1080p", w: 1920, h: 1080 },
    { label: "720p", w: 1280, h: 720 },
  );
  return list;
}

export function SettingsPanel(props: Props) {
  const { frameCount, startImage, endImage, sourceSize, settings, onChange, onBack, onStart } = props;
  const [willOverwrite, setWillOverwrite] = useState(false);

  const fileName = settings.outName.trim().toLowerCase().endsWith(".mp4")
    ? settings.outName.trim()
    : `${settings.outName.trim()}.mp4`;
  const fullPath = settings.outDir ? joinPath(settings.outDir, fileName) : "";

  useEffect(() => {
    if (!fullPath) return;
    let live = true;
    const t = setTimeout(() => {
      pathExists(fullPath).then((e) => live && setWillOverwrite(e), () => {});
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [fullPath]);

  const set = <K extends keyof RenderSettings>(key: K, value: RenderSettings[K]) =>
    onChange({ ...settings, [key]: value });

  const chooseFolder = async () => {
    const picked = await open({ directory: true, multiple: false, defaultPath: settings.outDir });
    if (typeof picked === "string") set("outDir", picked);
  };

  const nameEmpty = settings.outName.trim() === "";
  const sizeInvalid = settings.width < 2 || settings.height < 2;
  const blocked = nameEmpty || sizeInvalid || !settings.outDir || !props.ffmpeg;

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Render settings</h2>
        <p className="muted">
          {plural(frameCount, "frame")} · {clipLength(frameCount / settings.fps)} of video at{" "}
          {settings.fps} fps
        </p>
      </div>

      <div className="range-preview">
        <div className="range-card">
          <Thumb path={startImage.path} max={360} alt={startImage.name} className="range-img" />
          <div>
            <span className="range-label">Start</span>
            <span className="range-name" title={startImage.name}>
              {startImage.name}
            </span>
          </div>
        </div>
        <div className="range-arrow">→</div>
        <div className="range-card">
          <Thumb path={endImage.path} max={360} alt={endImage.name} className="range-img" />
          <div>
            <span className="range-label">End</span>
            <span className="range-name" title={endImage.name}>
              {endImage.name}
            </span>
          </div>
        </div>
      </div>

      <div className="field">
        <label>Frame rate</label>
        <div className="segmented">
          {[30, 60].map((f) => (
            <button
              key={f}
              type="button"
              className={settings.fps === f ? "on" : ""}
              onClick={() => set("fps", f)}
            >
              {f} fps
            </button>
          ))}
        </div>
        <p className="hint">
          At {settings.fps} fps these {plural(frameCount, "frame")} run for{" "}
          {clipLength(frameCount / settings.fps)}.
        </p>
      </div>

      <div className="field">
        <label>Resolution</label>
        <div className="preset-row">
          {resolutionPresets(sourceSize).map((p) => (
            <button
              key={p.label}
              type="button"
              className={`pill ${settings.width === p.w && settings.height === p.h ? "on" : ""}`}
              onClick={() => onChange({ ...settings, width: p.w, height: p.h })}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="dim-row">
          <input
            type="number"
            min={2}
            step={2}
            value={settings.width}
            aria-label="Width in pixels"
            onChange={(e) => set("width", Number(e.target.value) || 0)}
          />
          <span className="times">×</span>
          <input
            type="number"
            min={2}
            step={2}
            value={settings.height}
            aria-label="Height in pixels"
            onChange={(e) => set("height", Number(e.target.value) || 0)}
          />
          <span className="hint">
            Frames are fitted inside this box and letterboxed, never stretched.
          </span>
        </div>
      </div>

      <div className="field">
        <label>Quality</label>
        <div className="segmented">
          {QUALITY_PRESETS.map((q) => (
            <button
              key={q.id}
              type="button"
              className={settings.quality === q.id ? "on" : ""}
              onClick={() => set("quality", q.id)}
              title={q.hint}
            >
              {q.label}
            </button>
          ))}
        </div>
        <p className="hint">{QUALITY_PRESETS.find((q) => q.id === settings.quality)?.hint}</p>
      </div>

      <div className="field">
        <label htmlFor="out-name">File name</label>
        <input
          id="out-name"
          type="text"
          value={settings.outName}
          placeholder="timelapse"
          onChange={(e) => set("outName", e.target.value)}
        />
      </div>

      <div className="field">
        <label>Save to</label>
        <div className="path-row">
          <span className="path-text" title={settings.outDir}>
            {settings.outDir || "No folder chosen"}
          </span>
          <button type="button" className="btn btn-ghost" onClick={chooseFolder}>
            <FolderIcon /> Change…
          </button>
        </div>
        {fullPath && <p className="hint mono">{fullPath}</p>}
        {willOverwrite && (
          <p className="warn">
            <AlertIcon /> A file with that name already exists and will be replaced.
          </p>
        )}
      </div>

      {props.ffmpegError && (
        <p className="warn">
          <AlertIcon /> {props.ffmpegError}
        </p>
      )}

      <div className="panel-actions">
        <button type="button" className="btn btn-ghost" onClick={onBack}>
          Back to photos
        </button>
        <button type="button" className="btn btn-primary" onClick={onStart} disabled={blocked}>
          Start render
        </button>
      </div>
    </div>
  );
}
