import { artworkUploadMime } from "@insignia/contracts";
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
  onPreparing?: () => void;
  onMutating?: () => void;
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
/** Editing intent only; changing the viewed photo does not invalidate a quote. */
export const designerIntentKey = (state: DesignerState) =>
  JSON.stringify([state.editing, state.prints, state.quantities, state.rules.variantMatrix, state.productionChoices]);
export interface DesignerPorts {
  review?: { prepare(request: CartRequest): Promise<void | { expiresAt: string }> };
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
  /** Checking usually takes 2–4 s; past this the customer gets a retryable message instead of a spinner. */
  { processingTimeoutMs = 30_000 }: { processingTimeoutMs?: number } = {},
) {
  const renewing = new Map<string, AbortController>();
  let reviewController: AbortController | undefined;
  let reviewing = false;
  /** The current commit controller belongs to a silent re-proposal of an expired displayed quote. */
  let refreshing = false;
  let preparedSignature: string | null = null;
  let preparedExpiresAt: string | undefined;
  let uploadVersion = 0;
  let uploadController: AbortController | null = null;
  let commitController: AbortController | null = null;
  let attempt: { signature: string; designId: string; idempotencyKey: string; dispatched?: boolean } | null =
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
    reviewing = false;
    refreshing = false;
    dispatch({ type: "cart-commit-canceled" });
  }
  const preparedExpired = () =>
    preparedSignature === designerIntentKey(getState()) && !attempt?.dispatched && !!preparedExpiresAt && Date.parse(preparedExpiresAt) <= Date.now();
  async function commit(prepareOnly = false, refresh = false) {
    if (prepareOnly && !ports.review) return;
    // Add supersedes a silent refresh: the cart port re-proposes an expired quote itself.
    if (!prepareOnly && refreshing && commitController) {
      commitController.abort();
      commitController = null;
      reviewing = false;
      refreshing = false;
    }
    const observed = getState();
    const state = prepareOnly && observed.step === 1 ? {...observed,step:2 as const} : observed;
    if (commitController || !canCommitDesign(state)) return;
    const signature = designerIntentKey(state);
    const retryPreparation = prepareOnly && state.commit.kind === 'failed' && state.commit.preparation && !attempt?.dispatched;
    if (prepareOnly && !retryPreparation && preparedSignature === signature && (attempt?.dispatched || !preparedExpiresAt || Date.parse(preparedExpiresAt) > Date.now())) return;
    if (!attempt || attempt.signature !== signature) {
      preparedSignature = null;
      preparedExpiresAt = undefined;
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
    refreshing = refresh;
    const request: CartRequest = {
      onMutating() {
        if (controller.signal.aborted || commitController !== controller) return;
        if (attempt) attempt.dispatched = true;
        reviewing = false;
        dispatch({ type: 'cart-mutation-started', requestId });
      },
      onPreparing() {
        if (controller.signal.aborted || commitController !== controller) return;
        if (attempt) attempt.dispatched = false;
        reviewing = true;
        dispatch({ type: 'cart-preparation-started', requestId });
      },
      requestId,
      idempotencyKey: attempt.idempotencyKey,
      design,
      artworks: state.artworks.map((artwork) => ({ ...artwork })),
      operation: state.editing ? "updated" : "added",
      signal: controller.signal,
    };
    reviewing = prepareOnly;
    reviewController?.abort();
    reviewController = controller;
    dispatch({ type: "cart-commit-requested", requestId, design: request.design, ...(prepareOnly ? {preparation:true} : {}), ...(refresh ? {refresh:true} : {}) });
    try {
      if (prepareOnly) {
        const presentation = await ports.review?.prepare(request);
        if (!controller.signal.aborted && commitController === controller) {
          preparedExpiresAt = presentation?.expiresAt;
          if (designerIntentKey(getState()) === signature) preparedSignature = signature;
          dispatch({type:"cart-commit-canceled"});
        }
        return;
      }
      if (attempt) attempt.dispatched = true;
      const receipt = await ports.cart.commit(request);
      if (controller.signal.aborted || commitController !== controller) return;
      if (!matchesCartReceipt(receipt, request))
        throw new Error("Missing cart application receipt");
      attempt = null;
      dispatch({ type: "cart-commit-succeeded", requestId, receipt });
    } catch (error) {
      if (!controller.signal.aborted && commitController === controller) {
        if (!prepareOnly && error && typeof error === 'object' && 'reviewRequired' in error && error.reviewRequired === true) {
          if (attempt) attempt.dispatched = false;
          preparedSignature = signature;
          preparedExpiresAt = 'expiresAt' in error ? String(error.expiresAt) : undefined;
          dispatch({ type: 'cart-commit-canceled' });
          return;
        }
        if (!prepareOnly && error && typeof error === 'object' && 'acceptanceOutcome' in error && error.acceptanceOutcome === 'declined' && attempt?.idempotencyKey === request.idempotencyKey) {
          attempt = null;
          preparedSignature = null;
        }
        dispatch({
          type: "cart-commit-failed",
          requestId,
          reason: "cart-commit-failed",
          ...(prepareOnly || reviewing ? {preparation:true} : {}),
        });
      }
    } finally {
      if (commitController === controller) { commitController = null; reviewing = false; refreshing = false; }
    }
  }
  return {
    get reviewIntentId() { return attempt?.signature === designerIntentKey(getState()) ? attempt.idempotencyKey : undefined; },
    get reviewing() { return reviewing; },
    get expired() { return preparedExpired(); },
    get prepared() { return preparedSignature === designerIntentKey(getState()) && (attempt?.dispatched || !preparedExpiresAt || Date.parse(preparedExpiresAt) > Date.now()); },
    cancelUpload,
    cancelCommit,
    cancelPreparation() {
      reviewController?.abort();
      reviewController = undefined;
      if (reviewing) cancelCommit();
    },
    cancel() {
      cancelUpload();
      reviewController?.abort();
      reviewController = undefined;
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
        !artworkUploadMime(file) ||
        file.size > 5 * 1024 * 1024
      ) {
        dispatch({
          type: "upload-rejected",
          token,
          target,
          fileName: file.name,
          reason:
            file.size > 5 * 1024 * 1024
              ? "file-too-large"
              : "unsupported-file-type",
        });
        return;
      }
      const controller = new AbortController();
      uploadController = controller;
      const started: DesignerEvent = { type: "upload-started", token, target, fileName: file.name };
      if (designerReducer(getState(), started) === getState()) {
        uploadController = null;
        controller.abort();
        return;
      }
      dispatch(started);
      let phase: UploadPhase | undefined;
      let checkTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        const artwork = await ports.artwork.upload(file, {
          target,
          requestId: `upload-${token}`,
          signal: controller.signal,
          onProgress(next) {
            if (controller.signal.aborted || token !== uploadVersion) return;
            phase = next;
            dispatch({ type: 'upload-progress', token, target, phase: next });
            if (next === 'processing' && checkTimer === undefined)
              checkTimer = setTimeout(() => {
                if (controller.signal.aborted || token !== uploadVersion) return;
                controller.abort();
                dispatch({ type: 'upload-failed', token, target, reason: 'processing-timeout' });
              }, processingTimeoutMs);
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
        clearTimeout(checkTimer);
        if (uploadController === controller) uploadController = null;
      }
    },
    /** Visible-tab return: re-propose an expired displayed quote once, without a busy state. */
    refreshExpired() {
      if (!ports.review || commitController || getState().commit.kind !== 'idle' || !preparedExpired() || !canCommitDesign(getState())) return false;
      void commit(true, true);
      return true;
    },
    commit,
  };
}
