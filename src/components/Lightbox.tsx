import { useEffect, useRef, useState } from "react";
import { fileUrl, thumbnail } from "../api";
import type { ImageEntry } from "../types";
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon, FlagEndIcon, FlagStartIcon } from "./icons";

const PREVIEW_MAX = 1800;
const GRID_MAX = 360;
/**
 * Holding an arrow key steps through frames far faster than any of them can be
 * decoded. Nothing is requested until the user pauses, so the frame they stop
 * on is not stuck behind a queue of frames they already flew past.
 */
const ROUGH_DEBOUNCE_MS = 70;
const SHARP_DEBOUNCE_MS = 200;

interface Shown {
  src: string;
  path: string;
  /** True once this is the full-size decode rather than the grid thumbnail. */
  sharp: boolean;
}

interface Props {
  images: ImageEntry[];
  index: number;
  startIdx: number | null;
  endIdx: number | null;
  onIndex: (index: number) => void;
  onClose: () => void;
  onSetStart: (index: number) => void;
  onSetEnd: (index: number) => void;
}

export function Lightbox(props: Props) {
  const { images, index, startIdx, endIdx, onIndex, onClose, onSetStart, onSetEnd } = props;
  const image = images[index];
  const [shown, setShown] = useState<Shown | null>(null);
  const [error, setError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const go = (delta: number) => {
    const next = index + delta;
    if (next >= 0 && next < images.length) onIndex(next);
  };

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    let live = true;
    const path = image.path;
    setError(null);

    // The grid-sized thumbnail lands quickly and is often already cached, so
    // it stands in until the real decode is ready.
    const rough = setTimeout(() => {
      thumbnail(path, GRID_MAX).then(
        (p) =>
          live &&
          // Never downgrade if the full-size decode has already arrived.
          setShown((cur) =>
            cur?.path === path && cur.sharp ? cur : { src: fileUrl(p), path, sharp: false },
          ),
        () => {},
      );
    }, ROUGH_DEBOUNCE_MS);

    const sharp = setTimeout(() => {
      thumbnail(path, PREVIEW_MAX).then(
        (p) => live && setShown({ src: fileUrl(p), path, sharp: true }),
        (e) => live && setError(String(e)),
      );
    }, SHARP_DEBOUNCE_MS);

    return () => {
      live = false;
      clearTimeout(rough);
      clearTimeout(sharp);
    };
  }, [image.path]);

  // Warm the neighbours so left/right feels instant — again only once the
  // user has settled on a frame.
  useEffect(() => {
    const timer = setTimeout(() => {
      for (const n of [index - 1, index + 1]) {
        if (n >= 0 && n < images.length) void thumbnail(images[n].path, PREVIEW_MAX).catch(() => {});
      }
    }, SHARP_DEBOUNCE_MS * 2);
    return () => clearTimeout(timer);
  }, [index, images]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      switch (e.key) {
        case "Escape":
          e.preventDefault();
          return onClose();
        case "ArrowLeft":
          e.preventDefault();
          return go(-1);
        case "ArrowRight":
          e.preventDefault();
          return go(1);
        case "Home":
          e.preventDefault();
          return onIndex(0);
        case "End":
          e.preventDefault();
          return onIndex(images.length - 1);
        case "[":
          e.preventDefault();
          return onSetStart(index);
        case "]":
          e.preventDefault();
          return onSetEnd(index);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  const isStart = index === startIdx;
  const isEnd = index === endIdx;

  return (
    <div
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={`${image.name}, ${index + 1} of ${images.length}`}
      onClick={onClose}
    >
      <header className="lightbox-bar" onClick={(e) => e.stopPropagation()}>
        <div className="lightbox-title">
          <strong>{image.name}</strong>
          <span className="muted">
            {index + 1} of {images.length}
          </span>
        </div>
        <button ref={closeRef} type="button" className="icon-btn" onClick={onClose} title="Close (Esc)">
          <CloseIcon />
        </button>
      </header>

      <div className="lightbox-stage" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="nav-btn nav-prev"
          onClick={() => go(-1)}
          disabled={index === 0}
          title="Previous (←)"
          aria-label="Previous photo"
        >
          <ChevronLeftIcon />
        </button>

        <div className="lightbox-canvas" onClick={onClose}>
          {error ? (
            <p className="lightbox-error">Could not open this image.<br />{error}</p>
          ) : shown ? (
            <>
              <img
                className={[
                  "lightbox-img",
                  shown.sharp ? "" : "is-rough",
                  // While scrubbing, the frame on screen may lag the selection.
                  shown.path === image.path ? "" : "is-stale",
                ]
                  .filter(Boolean)
                  .join(" ")}
                src={shown.src}
                alt={image.name}
                onClick={(e) => e.stopPropagation()}
              />
              {(!shown.sharp || shown.path !== image.path) && <div className="spinner is-overlay" />}
            </>
          ) : (
            <div className="spinner" />
          )}
        </div>

        <button
          type="button"
          className="nav-btn nav-next"
          onClick={() => go(1)}
          disabled={index === images.length - 1}
          title="Next (→)"
          aria-label="Next photo"
        >
          <ChevronRightIcon />
        </button>
      </div>

      <footer className="lightbox-actions" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className={`btn ${isStart ? "btn-primary" : "btn-ghost"}`}
          onClick={() => onSetStart(index)}
        >
          <FlagStartIcon /> {isStart ? "This is the start frame" : "Set as start"}
        </button>
        <button
          type="button"
          className={`btn ${isEnd ? "btn-primary" : "btn-ghost"}`}
          onClick={() => onSetEnd(index)}
        >
          <FlagEndIcon /> {isEnd ? "This is the end frame" : "Set as end"}
        </button>
        <span className="lightbox-hint">← → to browse · Esc closes and selects this photo</span>
      </footer>
    </div>
  );
}
