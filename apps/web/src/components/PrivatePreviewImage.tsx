import { useLayoutEffect, useState } from 'preact/hooks';

// Both inspected artwork and merchant image derivatives are limited to 2 MiB on admission.
const maximumPreviewBytes = 2 * 1024 * 1024;

/** Display an already-authorized PNG URL without sending storage cookies or a referrer. */
export default function PrivatePreviewImage({
  src,
  alt,
  aspectRatio = 1,
  maxWidth = 160,
  maxHeight = 160,
}: {
  src: string;
  alt: string;
  aspectRatio?: number;
  maxWidth?: number;
  maxHeight?: number;
}) {
  const [image, setImage] = useState<{ source: string; url: string } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useLayoutEffect(() => {
    setImage(null);
    setFailed(null);
    const controller = new AbortController();
    let localUrl: string | undefined;
    async function prepare() {
      try {
        const response = await fetch(src, {
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
          redirect: 'error',
          signal: controller.signal,
        });
        if (!response.ok || !response.body) throw new Error('Preview unavailable');
        const declaredBytes = Number(response.headers.get('Content-Length'));
        if (declaredBytes > maximumPreviewBytes) {
          await response.body.cancel();
          throw new Error('Preview exceeds admission limit');
        }
        const reader = response.body.getReader();
        const parts: Uint8Array<ArrayBuffer>[] = [];
        let byteLength = 0;
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            byteLength += value.byteLength;
            if (byteLength > maximumPreviewBytes) throw new Error('Preview exceeds admission limit');
            parts.push(new Uint8Array(value));
          }
        } finally {
          await reader.cancel();
        }
        if (controller.signal.aborted) return;
        if (!byteLength) throw new Error('Preview unavailable');
        localUrl = URL.createObjectURL(new Blob(parts, { type: 'image/png' }));
        setImage({ source: src, url: localUrl });
      } catch {
        if (!controller.signal.aborted) setFailed(src);
      }
    }
    void prepare();
    return () => {
      controller.abort();
      if (localUrl) URL.revokeObjectURL(localUrl);
    };
  }, [src]);
  return (
    <s-box
      inlineSize={`${Math.min(maxWidth, maxHeight * aspectRatio)}px`}
      blockSize={`${Math.min(maxHeight, maxWidth / aspectRatio)}px`}
    >
      {image?.source === src ? (
        <s-image
          src={image.url}
          alt={alt}
          inlineSize="fill"
          aspectRatio={`${aspectRatio}`}
          objectFit="contain"
          onError={() => {
            setImage(null);
            setFailed(src);
          }}
        />
      ) : failed === src ? (
        <s-paragraph>Artwork image unavailable.</s-paragraph>
      ) : (
        <s-box
          accessibilityRole="status"
          accessibilityLabel={`Preparing ${alt}`}
          background="subdued"
          borderRadius="base"
          inlineSize="100%"
          blockSize="100%"
        />
      )}
    </s-box>
  );
}
