import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ImageEntry } from "../types";
import { Thumb } from "./Thumb";
import { ExpandIcon, FlagStartIcon, FlagEndIcon } from "./icons";

const GAP = 14;
const CAPTION_H = 28;

interface Props {
  images: ImageEntry[];
  tileSize: number;
  startIdx: number | null;
  endIdx: number | null;
  focusIdx: number;
  keyboardEnabled: boolean;
  onFocus: (index: number) => void;
  onExpand: (index: number) => void;
  onSetStart: (index: number) => void;
  onSetEnd: (index: number) => void;
  /** Bump to re-centre the viewport on `focusIdx` (e.g. after closing the lightbox). */
  scrollNonce: number;
}

export function ImageGrid(props: Props) {
  const {
    images,
    tileSize,
    startIdx,
    endIdx,
    focusIdx,
    keyboardEnabled,
    onFocus,
    onExpand,
    onSetStart,
    onSetEnd,
    scrollNonce,
  } = props;

  const scroller = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [scrollTop, setScrollTop] = useState(0);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setBox({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const innerWidth = Math.max(0, box.width - GAP * 2);
  const cols = Math.max(1, Math.floor((innerWidth + GAP) / (tileSize + GAP)));
  const cellH = tileSize + CAPTION_H;
  const rowH = cellH + GAP;
  const rows = Math.ceil(images.length / cols);
  const totalH = Math.max(0, rows * rowH - GAP);

  // Overscan a couple of rows so fast scrolling does not reveal empty space.
  const firstRow = Math.max(0, Math.floor(scrollTop / rowH) - 2);
  const lastRow = Math.min(rows - 1, Math.ceil((scrollTop + box.height) / rowH) + 2);

  const onScroll = useCallback(() => {
    const el = scroller.current;
    if (el) setScrollTop(el.scrollTop);
  }, []);

  // Keep the focused frame on screen when it moves for reasons other than the
  // user scrolling — arrow keys, or returning from the lightbox.
  useEffect(() => {
    const el = scroller.current;
    if (!el || cols === 0 || images.length === 0) return;
    const row = Math.floor(focusIdx / cols);
    const top = row * rowH;
    const bottom = top + cellH;
    if (top < el.scrollTop || bottom > el.scrollTop + el.clientHeight) {
      el.scrollTo({ top: Math.max(0, top - (el.clientHeight - cellH) / 2), behavior: "smooth" });
    }
  }, [focusIdx, scrollNonce, cols, rowH, cellH, images.length]);

  useEffect(() => {
    if (!keyboardEnabled) return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

      const move = (delta: number) => {
        e.preventDefault();
        onFocus(Math.min(images.length - 1, Math.max(0, focusIdx + delta)));
      };
      switch (e.key) {
        case "ArrowLeft":
          return move(-1);
        case "ArrowRight":
          return move(1);
        case "ArrowUp":
          return move(-cols);
        case "ArrowDown":
          return move(cols);
        case "PageUp":
          return move(-cols * 3);
        case "PageDown":
          return move(cols * 3);
        case "Home":
          e.preventDefault();
          return onFocus(0);
        case "End":
          e.preventDefault();
          return onFocus(images.length - 1);
        case "Enter":
          e.preventDefault();
          return onExpand(focusIdx);
        case "[":
          e.preventDefault();
          return onSetStart(focusIdx);
        case "]":
          e.preventDefault();
          return onSetEnd(focusIdx);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [keyboardEnabled, focusIdx, cols, images.length, onFocus, onExpand, onSetStart, onSetEnd]);

  const visible: number[] = [];
  for (let r = firstRow; r <= lastRow; r++) visible.push(r);

  const inRange = (i: number) =>
    startIdx !== null && endIdx !== null && i >= Math.min(startIdx, endIdx) && i <= Math.max(startIdx, endIdx);

  return (
    <div className="grid-scroller" ref={scroller} onScroll={onScroll}>
      <div className="grid-inner" style={{ height: totalH }}>
        {box.width > 0 &&
          visible.map((row) => (
            <div
              key={row}
              className="grid-row"
              style={{
                top: row * rowH,
                gridTemplateColumns: `repeat(${cols}, ${tileSize}px)`,
                gap: GAP,
              }}
            >
              {Array.from({ length: cols }, (_, c) => row * cols + c)
                .filter((i) => i < images.length)
                .map((i) => {
                  const img = images[i];
                  const isStart = i === startIdx;
                  const isEnd = i === endIdx;
                  return (
                    <figure
                      key={img.path}
                      className={[
                        "tile",
                        i === focusIdx ? "is-focused" : "",
                        inRange(i) ? "in-range" : "",
                        isStart ? "is-start" : "",
                        isEnd ? "is-end" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      style={{ width: tileSize }}
                      onClick={() => onFocus(i)}
                      onDoubleClick={() => onExpand(i)}
                    >
                      <div className="tile-frame" style={{ height: tileSize }}>
                        <Thumb path={img.path} max={360} alt={img.name} className="tile-img" />

                        <button
                          type="button"
                          className="tile-expand"
                          title="Open larger (Enter)"
                          aria-label={`Open ${img.name} larger`}
                          onClick={(e) => {
                            e.stopPropagation();
                            onExpand(i);
                          }}
                        >
                          <ExpandIcon />
                        </button>

                        <div className="tile-actions">
                          <button
                            type="button"
                            className={`chip ${isStart ? "chip-on" : ""}`}
                            title="Set as start frame ( [ )"
                            onClick={(e) => {
                              e.stopPropagation();
                              onSetStart(i);
                            }}
                          >
                            <FlagStartIcon /> Start
                          </button>
                          <button
                            type="button"
                            className={`chip ${isEnd ? "chip-on" : ""}`}
                            title="Set as end frame ( ] )"
                            onClick={(e) => {
                              e.stopPropagation();
                              onSetEnd(i);
                            }}
                          >
                            <FlagEndIcon /> End
                          </button>
                        </div>

                        {(isStart || isEnd) && (
                          <div className="tile-badges">
                            {isStart && <span className="badge badge-start">START</span>}
                            {isEnd && <span className="badge badge-end">END</span>}
                          </div>
                        )}
                      </div>
                      <figcaption className="tile-caption" title={img.name}>
                        <span className="tile-index">{i + 1}</span>
                        <span className="tile-name">{img.name}</span>
                      </figcaption>
                    </figure>
                  );
                })}
            </div>
          ))}
      </div>
    </div>
  );
}
