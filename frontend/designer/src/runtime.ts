import type { Artwork, Design, PositionId } from "./model";
import {
  canCommitDesign,
  buildCommitDesign,
  designerReducer,
  type DesignerEvent,
  type DesignerState,
} from "./designer-state";

export interface UploadRequest {
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
  artwork: { upload(file: File, request: UploadRequest): Promise<Artwork>; apply?(artwork:Artwork,request:UploadRequest):Promise<Artwork> };
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
    },
    async apply(artworkId:string,target:PositionId) {
      const artwork=getState().artworks.find((artwork)=>artwork.id===artworkId);
      if(!artwork||!ports.artwork.apply)return;
      if(getState().prints.find((print)=>print.id===target)?.artworkId===artworkId){dispatch({type:'artwork-applied',positionId:target,artworkId});return;}
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
      }catch{if(!controller.signal.aborted&&token===uploadVersion)dispatch({type:'upload-failed',token,target,reason:'read-failed'});}
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
      try {
        const artwork = await ports.artwork.upload(file, {
          target,
          requestId: `upload-${token}`,
          signal: controller.signal,
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
      } catch {
        if (!controller.signal.aborted && token === uploadVersion)
          dispatch({
            type: "upload-failed",
            token,
            target,
            reason: "read-failed",
          });
      } finally {
        if (uploadController === controller) uploadController = null;
      }
    },
    async commit(prepareOnly = false) {
      if (prepareOnly && !ports.review) return;
      const state = getState();
      if (commitController || !canCommitDesign(state)) return;
      const signature = JSON.stringify([state.editing, state.prints, state.quantities, state.rules.variantMatrix]);
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
