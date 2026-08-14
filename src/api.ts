import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type { EncodeOptions, FfmpegInfo, ImageEntry } from "./types";

export const listImages = (folder: string) => invoke<ImageEntry[]>("list_images", { folder });

export const imageSize = (path: string) => invoke<[number, number]>("image_size", { path });

export const probeFfmpeg = (custom: string | null) =>
  invoke<FfmpegInfo>("probe_ffmpeg", { custom });

export const startEncode = (options: EncodeOptions) => invoke<void>("start_encode", { options });

export const cancelEncode = () => invoke<boolean>("cancel_encode");

export const revealInFileManager = (path: string) =>
  invoke<void>("reveal_in_file_manager", { path });

export const thumbCacheBytes = () => invoke<number>("thumb_cache_bytes");

export const clearThumbCache = () => invoke<void>("clear_thumb_cache");

export const pathExists = (path: string) => invoke<boolean>("path_exists", { path });

/**
 * Decoding a full-resolution frame costs real time, so thumbnail requests are
 * memoised and capped at a handful of concurrent workers. Without the cap a
 * grid of a few thousand frames would fire a few thousand simultaneous
 * decodes and starve everything else.
 */
const MAX_CONCURRENT = 6;
const cache = new Map<string, Promise<string>>();
let active = 0;
const waiting: (() => void)[] = [];

function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active++;
    return Promise.resolve();
  }
  return new Promise((resolve) => waiting.push(resolve));
}

function release() {
  const next = waiting.shift();
  if (next) next();
  else active--;
}

export function thumbnail(path: string, max: number): Promise<string> {
  const key = `${max}:${path}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const job = acquire()
    .then(() => invoke<string>("thumbnail", { path, max }))
    .then(
      (result) => {
        release();
        return result;
      },
      (error) => {
        release();
        cache.delete(key); // let a later render retry
        throw error;
      },
    );

  cache.set(key, job);
  return job;
}

/** Turn an on-disk path into something an <img>/<video> tag can load. */
export const fileUrl = (path: string) => convertFileSrc(path);

export function dirName(path: string): string {
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return idx > 0 ? path.slice(0, idx) : path;
}

export function joinPath(dir: string, name: string): string {
  const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  return dir.endsWith(sep) ? `${dir}${name}` : `${dir}${sep}${name}`;
}
