import { useState } from "react";
import { fileUrl, revealInFileManager } from "../api";
import { bytes, clipLength, duration, plural } from "../format";
import type { EncodeDone } from "../types";
import { CheckIcon, FolderIcon } from "./icons";

interface Props {
  done: EncodeDone;
  frameCount: number;
  fps: number;
  width: number;
  height: number;
  onStartOver: () => void;
  onAdjust: () => void;
}

const revealLabel =
  navigator.userAgent.includes("Mac") ? "Show in Finder"
  : navigator.userAgent.includes("Windows") ? "Show in Explorer"
  : "Open containing folder";

export function ResultPanel(props: Props) {
  const { done, frameCount, fps, width, height, onStartOver, onAdjust } = props;
  const [revealError, setRevealError] = useState<string | null>(null);
  // The asset URL is stable across renders of the same file name, so force a
  // reload when a second render overwrites the first.
  const [nonce] = useState(() => Date.now());

  const reveal = () => {
    setRevealError(null);
    revealInFileManager(done.output).catch((e) => setRevealError(String(e)));
  };

  return (
    <div className="panel">
      <div className="success">
        <span className="success-icon">
          <CheckIcon />
        </span>
        <div>
          <h2>Your timelapse is ready</h2>
          <p className="muted">
            {plural(frameCount, "frame")} · {clipLength(frameCount / fps)} · {width}×{height} ·{" "}
            {bytes(done.sizeBytes)} · rendered in {duration(done.elapsedMs / 1000)}
          </p>
        </div>
      </div>

      <div className="result-path mono" title={done.output}>
        {done.output}
      </div>

      <div className="panel-actions align-start">
        <button type="button" className="btn btn-primary" onClick={reveal}>
          <FolderIcon /> {revealLabel}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onAdjust}>
          Change settings and re-render
        </button>
        <button type="button" className="btn btn-ghost" onClick={onStartOver}>
          Pick a different range
        </button>
      </div>

      {revealError && <p className="warn">{revealError}</p>}

      <video
        className="result-video"
        src={`${fileUrl(done.output)}?v=${nonce}`}
        controls
        loop
        preload="metadata"
      />
    </div>
  );
}
