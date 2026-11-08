import { useLayoutEffect, useRef, useState } from "preact/hooks";
import type { Artwork } from "./model";
import { useLocale } from "./customer-locale";

interface FileNameProps {
  name: string;
  multiline?: boolean;
  onTruncationChange?: (truncated: boolean) => void;
}

// The accessible name and stored filename stay intact. Only the visible stem
// can shrink; keeping the extension helps distinguish similarly named files.
export function FileName({
  name,
  multiline = false,
  onTruncationChange,
}: FileNameProps) {
  const stemRef = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const stem = stemRef.current;
    if (!stem || !onTruncationChange) return;
    const measure = () =>
      onTruncationChange(
        stem.scrollWidth > stem.clientWidth + 1 ||
          stem.scrollHeight > stem.clientHeight + 1,
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stem);
    return () => observer.disconnect();
  }, [name, multiline, onTruncationChange]);
  const dot = name.lastIndexOf(".");
  const hasExtension = dot > 0 && name.length - dot <= 12;
  return (
    <span className={`file-name${multiline ? " multiline" : ""}`} title={name}>
      <span className="sr-only">{name}</span>
      <span className="file-stem" aria-hidden="true" ref={stemRef}>
        {hasExtension && !multiline ? name.slice(0, dot) : name}
      </span>
      {hasExtension && !multiline && (
        <span className="file-extension" aria-hidden="true">
          {name.slice(dot)}
        </span>
      )}
    </span>
  );
}

export function ArtworkFile({
  artwork,
  onChoose,
}: {
  artwork: Artwork;
  onChoose: (id: string) => void;
}) {
  const { t } = useLocale();
  const [truncated, setTruncated] = useState(false);
  return (
    <div className="artwork-file">
      <button onClick={() => onChoose(artwork.id)}>
        <span>
          {artwork.url ? <img
            src={artwork.url}
            alt=""
            width={160}
            height={120}
            loading="lazy"
          /> : <span role="status">{t("customer:positioning.previewUnavailable")}</span>}
        </span>
        <strong>
          <FileName
            name={artwork.name}
            multiline
            onTruncationChange={setTruncated}
          />
        </strong>
      </button>
      {truncated && (
        <details className="file-details">
          <summary>{t("customer:files.fullFilename")}</summary>
          <span>{artwork.name}</span>
        </details>
      )}
    </div>
  );
}
