import { useEffect, useState } from "react";
import { fileUrl, thumbnail } from "../api";

interface Props {
  path: string;
  max: number;
  alt: string;
  className?: string;
}

/**
 * Renders the cached downscale of `path`. Only mounted tiles ask for one, so
 * the virtualised grid never decodes frames the user has not scrolled to.
 */
export function Thumb({ path, max, alt, className }: Props) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setSrc(null);
    setFailed(false);
    thumbnail(path, max).then(
      (p) => {
        if (live) setSrc(fileUrl(p));
      },
      () => {
        if (live) setFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [path, max]);

  if (failed) return <div className={`thumb-fallback ${className ?? ""}`}>unreadable</div>;
  if (!src) return <div className={`thumb-skeleton ${className ?? ""}`} />;
  return <img className={className} src={src} alt={alt} draggable={false} />;
}
