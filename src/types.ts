export interface ImageEntry {
  path: string;
  name: string;
  size: number;
  modified: number | null;
}

export interface FfmpegInfo {
  path: string;
  version: string;
}

export interface EncodeOptions {
  frames: string[];
  fps: number;
  width: number;
  height: number;
  output: string;
  crf: number;
  preset: string;
  ffmpegPath: string | null;
}

export interface EncodeProgress {
  frame: number;
  totalFrames: number;
  percent: number;
  fps: number;
  speed: string;
  elapsedMs: number;
}

export interface EncodeDone {
  output: string;
  elapsedMs: number;
  sizeBytes: number;
}

export type Step = "pick" | "select" | "configure" | "encoding" | "done";

export interface QualityPreset {
  id: string;
  label: string;
  hint: string;
  crf: number;
  preset: string;
}

export const QUALITY_PRESETS: QualityPreset[] = [
  { id: "high", label: "High", hint: "Largest file, best detail", crf: 16, preset: "slow" },
  { id: "balanced", label: "Balanced", hint: "Recommended", crf: 20, preset: "medium" },
  { id: "compact", label: "Compact", hint: "Smallest file, faster", crf: 24, preset: "veryfast" },
];
