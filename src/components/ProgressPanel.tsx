import { useEffect, useRef } from "react";
import { duration, plural } from "../format";
import type { EncodeProgress } from "../types";

interface Props {
  progress: EncodeProgress | null;
  log: string[];
  outputName: string;
  onCancel: () => void;
}

export function ProgressPanel({ progress, log, outputName, onCancel }: Props) {
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log]);

  const percent = progress?.percent ?? 0;
  const elapsed = (progress?.elapsedMs ?? 0) / 1000;
  // ffmpeg's own ETA is not exposed via -progress for image input, so derive
  // one from how far along we are. Meaningless until a few frames are in.
  const eta = percent > 1 ? (elapsed / percent) * (100 - percent) : NaN;

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Building {outputName}</h2>
        <p className="muted">ffmpeg is stitching your frames together.</p>
      </div>

      <div
        className="progress-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
      >
        <div className="progress-fill" style={{ width: `${percent}%` }} />
      </div>

      <div className="progress-stats">
        <div>
          <span className="stat-value">{percent.toFixed(1)}%</span>
          <span className="stat-label">complete</span>
        </div>
        <div>
          <span className="stat-value">
            {(progress?.frame ?? 0).toLocaleString()}
            <span className="muted"> / {(progress?.totalFrames ?? 0).toLocaleString()}</span>
          </span>
          <span className="stat-label">frames encoded</span>
        </div>
        <div>
          <span className="stat-value">{progress?.speed ?? "—"}</span>
          <span className="stat-label">speed</span>
        </div>
        <div>
          <span className="stat-value">{duration(elapsed)}</span>
          <span className="stat-label">elapsed</span>
        </div>
        <div>
          <span className="stat-value">{isFinite(eta) ? duration(eta) : "—"}</span>
          <span className="stat-label">remaining</span>
        </div>
      </div>

      <details className="log-box">
        <summary>ffmpeg output ({plural(log.length, "line")})</summary>
        <pre ref={logRef}>{log.join("\n")}</pre>
      </details>

      <div className="panel-actions">
        <button type="button" className="btn btn-danger" onClick={onCancel}>
          Cancel render
        </button>
      </div>
    </div>
  );
}
