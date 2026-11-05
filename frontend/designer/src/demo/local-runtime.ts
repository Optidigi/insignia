import type { Artwork, Design } from "../model";
import type { DesignerPorts } from "../runtime";

/** Browser-only preview upload. A connected upload adapter must return an accepted asset reference. */
export async function readLocalArtwork(
  file: File,
  { signal }: { signal: AbortSignal },
): Promise<Artwork> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const image = new Image();
    function cleanup() {
      signal.removeEventListener("abort", abort);
      reader.onload = reader.onerror = reader.onabort = null;
      image.onload = image.onerror = null;
    }
    function fail() {
      cleanup();
      reject(new Error("Image could not be read"));
    }
    function abort() {
      cleanup();
      if (reader.readyState === FileReader.LOADING) reader.abort();
      image.src = "";
      reject(new DOMException("Upload canceled", "AbortError"));
    }
    signal.addEventListener("abort", abort, { once: true });
    reader.onerror = reader.onabort = fail;
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        fail();
        return;
      }
      const url = reader.result;
      image.onerror = fail;
      image.onload = () => {
        if (signal.aborted || !image.naturalWidth || !image.naturalHeight) {
          fail();
          return;
        }
        const artwork = {
          id: crypto.randomUUID(),
          name: file.name,
          url,
          width: image.naturalWidth,
          height: image.naturalHeight,
        };
        cleanup();
        resolve(artwork);
      };
      image.src = url;
    };
    reader.readAsDataURL(file);
  });
}
function copyDesign(design: Design): Design {
  return {
    id: design.id,
    prints: design.prints.map((print) => ({
      ...print,
      position: print.position ? { ...print.position } : undefined,
    })),
    quantities: { ...design.quantities },
    ...(design.variants ? { variants: design.variants.map((variant) => ({ ...variant })) } : {}),
  };
}
/** Explicit in-memory host stand-in. No HTTP, storage, Shopify calls or production authorization. */
export function createLocalRuntime(
  options: { failCommit?: boolean; failUpload?: boolean } = {},
) {
  let designs: Design[] = [];
  const applications = new Map<string, string>();
  const ports: DesignerPorts = {
    artwork: {
      async upload(file, request) {
        if (options.failUpload) throw new Error("Local upload failure");
        return readLocalArtwork(file, request);
      },
    },
    cart: {
      async commit(request) {
        // Yield so close/unmount can cancel before the local mutation.
        await Promise.resolve();
        request.signal.throwIfAborted();
        if (options.failCommit) throw new Error("Local commit failure");
        const signature = JSON.stringify([request.operation, request.design]);
        const previous = applications.get(request.idempotencyKey);
        if (previous !== undefined && previous !== signature)
          throw new Error("Conflicting local retry");
        const design = copyDesign(request.design);
        if (previous === undefined) {
          if (request.operation === "updated") {
            if (!designs.some((saved) => saved.id === design.id))
              throw new Error("Saved local design missing");
            designs = designs.map((saved) => (saved.id === design.id ? design : saved));
          } else {
            if (designs.some((saved) => saved.id === design.id))
              throw new Error("Duplicate local design");
            designs = [...designs, design];
          }
          applications.set(request.idempotencyKey, signature);
        }
        return {
          kind: "applied",
          requestId: request.requestId,
          designId: design.id,
          operation: request.operation,
          authority: "local-preview",
        };
      },
    },
  };
  return { ports, savedDesigns: () => designs.map(copyDesign) };
}
