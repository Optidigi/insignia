import type { Artwork, Design, PositionId } from "./model";
import {
  canCommitDesign,
  buildCommitDesign,
  designerReducer,
  type DesignerEvent,
  type DesignerState,
  type UploadFailureReason,
} from "./designer-state";

export type UploadPhase = 'uploading' | 'processing';
function uploadFailure(error: unknown, phase?: UploadPhase): Exclude<UploadFailureReason, 'file-too-large' | 'unsupported-file-type'> {
  const status = error && typeof error === 'object' && 'status' in error ? error.status : undefined;
  if (status === 410) return 'artwork-expired';
  if (phase === 'processing') return status === 422 ? 'inspection-rejected' : 'processing-failed';
  return phase === 'uploading' ? 'upload-failed' : 'read-failed';
}

export interface UploadRequest {
  onProgress?: (phase: UploadPhase) => void;
  requestId: string;
  target: PositionId;
  signal: AbortSignal;
}
export interface CartRequest {
  requestId: string;
  /** Separate from UI request identity; a connected adapter must preserve it on transport retries. */
  idempotencyKey: string;
  design: Design;
  artworks: readonly Artwork[];
  operation: "added" | "updated";
  signal: AbortSignal;
}
export interface CartReceipt {
  kind: "applied";
  requestId: string;
  designId: string;
  operation: "added" | "updated";
  authority: "local-preview" | "shopify";
}
export interface DesignerPorts {
  review?: { prepare(request: CartRequest): Promise<void> };
  artwork: { upload(file: File, request: UploadRequest): Promise<Artwork>; apply?(artwork:Artwork,request:UploadRequest):Promise<Artwork>; renew?(artwork:Artwork,request:UploadRequest):Promise<Artwork> };
  /** Resolve only after the requested cart application has been verified by the adapter. */
  cart: { commit(request: CartRequest): Promise<CartReceipt> };
}

export function matchesCartReceipt(
  value: unknown,
  request: Pick<CartRequest, "requestId" | "operation" | "design">,
): value is CartReceipt {
  if (!value || typeof value !== "object") return false;
  return (
    "kind" in value &&
    value.kind === "applied" &&
    "requestId" in value &&
    value.requestId === request.requestId &&
    "designId" in value &&
    value.designId === request.design.id &&
    "operation" in value &&
    value.operation === request.operation &&
    "authority" in value &&
    (value.authority === "local-preview" ||
      (value.authority === "shopify" && Boolean(request.design.variants?.length)))
  );
}

/** Effects only. The reducer owns drafts, validation, undo and stale-result guards. */
export function createDesignerRuntime(
  ports: DesignerPorts,
  getState: () => DesignerState,
  dispatch: (event: DesignerEvent) => void,
) {
  const renewing = new Map<string, AbortController>();
  let reviewing = false;
  let uploadVersion = 0;
  let uploadController: AbortController | null = null;
  let commitController: AbortController | null = null;
  let attempt: { signature: string; designId: string; idempotencyKey: string } | null =
    null;
  function cancelUpload() {
    uploadVersion += 1;
    uploadController?.abort();
    uploadController = null;
    dispatch({ type: "upload-canceled" });
  }
  function cancelCommit() {
    commitController?.abort();
    commitController = null;
    dispatch({ type: "cart-commit-canceled" });
  }
  return {
    get reviewing() { return reviewing; },
    cancelUpload,
    cancelCommit,
    cancel() {
      cancelUpload();
      cancelCommit();
      for (const controller of renewing.values()) controller.abort();
      renewing.clear();
    },
    async renew(artwork: Artwork) {
      if (!ports.artwork.renew || renewing.has(artwork.id)) return false;
      const controller = new AbortController(); renewing.set(artwork.id, controller);
      const expectedExpiry = artwork.previewExpiresAt;
      dispatch({ type: 'artwork-preview-expired', id: artwork.id, expectedExpiry });
      try {
        const fresh = await ports.artwork.renew(artwork, { target: getState().active ?? getState().rules.positions[0]?.id ?? '', requestId: crypto.randomUUID(), signal: controller.signal });
        if (controller.signal.aborted || fresh.id !== artwork.id || !fresh.url || !Number.isFinite(fresh.width) || !Number.isFinite(fresh.height) || fresh.width <= 0 || fresh.height <= 0 || !fresh.previewExpiresAt || !Number.isFinite(Date.parse(fresh.previewExpiresAt)) || Date.parse(fresh.previewExpiresAt) <= Date.now()) return false;
        dispatch({ type: 'artwork-preview-refreshed', artwork: fresh, expectedExpiry });
        return true;
      } catch (error) {
        if (!controller.signal.aborted && error && typeof error === 'object' && 'status' in error && [403, 404, 410].includes(Number(error.status)))
          dispatch({ type: 'artwork-unavailable', id: artwork.id, expectedExpiry });
        return false;
      } finally { if (renewing.get(artwork.id) === controller) renewing.delete(artwork.id); }
    },
    async apply(artworkId:string,target:PositionId) {
      const artwork=getState().artworks.find((artwork)=>artwork.id===artworkId);
      if(!artwork||!ports.artwork.apply)return;
      if(getState().prints.find((print)=>print.id===target)?.artworkId===artworkId && artwork.url && (!artwork.previewExpiresAt || Date.parse(artwork.previewExpiresAt) > Date.now())){dispatch({type:'artwork-applied',positionId:target,artworkId});return;}
      cancelUpload();
      const token=Math.max(uploadVersion+1,getState().uploadVersion+1);uploadVersion=token;
      const controller=new AbortController();uploadController=controller;
      const started:DesignerEvent={type:'upload-started',token,target};
      if(designerReducer(getState(),started)===getState()){uploadController=null;return;}
      dispatch(started);
      try{
        const applied=await ports.artwork.apply(artwork,{target,requestId:crypto.randomUUID(),signal:controller.signal});
        if(controller.signal.aborted||token!==uploadVersion)return;
        if(applied.id!==artwork.id||!applied.url||!Number.isFinite(applied.width)||!Number.isFinite(applied.height)||applied.width<=0||applied.height<=0)throw new Error('Invalid applied artwork');
        dispatch({type:'upload-succeeded',token,target,artwork:applied});
      }catch(error){if(!controller.signal.aborted&&token===uploadVersion)dispatch({type:'upload-failed',token,target,reason:uploadFailure(error)});}
      finally{if(uploadController===controller)uploadController=null;}
    },
    async upload(file: File, target: PositionId) {
      cancelUpload();
      const token = Math.max(uploadVersion + 1, getState().uploadVersion + 1);
      uploadVersion = token;
      if (
        !["image/png", "image/jpeg", "image/svg+xml"].includes(file.type) ||
        file.size > 5 * 1024 * 1024
      ) {
        dispatch({
          type: "upload-rejected",
          token,
          target,
          reason:
            file.size > 5 * 1024 * 1024
              ? "file-too-large"
              : "unsupported-file-type",
        });
        return;
      }
      const controller = new AbortController();
      uploadController = controller;
      const started: DesignerEvent = { type: "upload-started", token, target };
      if (designerReducer(getState(), started) === getState()) {
        uploadController = null;
        controller.abort();
        return;
      }
      dispatch(started);
      let phase: UploadPhase | undefined;
      try {
        const artwork = await ports.artwork.upload(file, {
          target,
          requestId: `upload-${token}`,
          signal: controller.signal,
          onProgress(next) {
            if (controller.signal.aborted || token !== uploadVersion) return;
            phase = next;
            dispatch({ type: 'upload-progress', token, target, phase: next });
          },
        });
        if (controller.signal.aborted || token !== uploadVersion) return;
        if (
          !artwork.id ||
          !artwork.url ||
          !Number.isFinite(artwork.width) ||
          !Number.isFinite(artwork.height) ||
          !(artwork.width > 0) ||
          !(artwork.height > 0)
        )
          throw new Error("Invalid artwork result");
        dispatch({ type: "upload-succeeded", token, target, artwork });
      } catch (error) {
        if (!controller.signal.aborted && token === uploadVersion)
          dispatch({
            type: "upload-failed",
            token,
            target,
            reason: uploadFailure(error, phase),
          });
      } finally {
        if (uploadController === controller) uploadController = null;
      }
    },
    async commit(prepareOnly = false) {
      if (prepareOnly && !ports.review) return;
      const state = getState();
      if (commitController || !canCommitDesign(state)) return;
      const signature = JSON.stringify([state.editing, state.prints, state.quantities, state.rules.variantMatrix, state.productionChoices]);
      if (!attempt || attempt.signature !== signature) {
        attempt = {
          signature,
          designId: state.editing ?? crypto.randomUUID(),
          idempotencyKey: crypto.randomUUID(),
        };
      }
      const design = buildCommitDesign(state, attempt.designId);
      if (!design) return;
      const requestId = crypto.randomUUID();
      const controller = new AbortController();
      commitController = controller;
      const request: CartRequest = {
        requestId,
        idempotencyKey: attempt.idempotencyKey,
        design,
        artworks: state.artworks.map((artwork) => ({ ...artwork })),
        operation: state.editing ? "updated" : "added",
        signal: controller.signal,
      };
      reviewing = prepareOnly;
      dispatch({ type: "cart-commit-requested", requestId, design: request.design });
      try {
        if (prepareOnly) {
          await ports.review?.prepare(request);
          if (!controller.signal.aborted && commitController === controller) dispatch({type:"cart-commit-canceled"});
          return;
        }
        const receipt = await ports.cart.commit(request);
        if (controller.signal.aborted || commitController !== controller) return;
        if (!matchesCartReceipt(receipt, request))
          throw new Error("Missing cart application receipt");
        attempt = null;
        dispatch({ type: "cart-commit-succeeded", requestId, receipt });
      } catch {
        if (!controller.signal.aborted && commitController === controller)
          dispatch({
            type: "cart-commit-failed",
            requestId,
            reason: "cart-commit-failed",
          });
      } finally {
        if (commitController === controller) { commitController = null; reviewing = false; }
      }
    },
  };
}
