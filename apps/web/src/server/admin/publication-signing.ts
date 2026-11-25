import { PUBLICATION_STEP_MARGIN_MS } from '../merchant-config.ts';
import type { AdminActor } from './contracts.js';
import type { AutomaticSigningState } from './signing-automatic.ts';
import type { SigningOwnerAction, SigningOwnerStatus } from './signing-owner-action.ts';

export type SigningPreparation = { ready: boolean; reason: string | null; resend?: true };

const READY: SigningPreparation = { ready: true, reason: null };
const UNAVAILABLE: SigningPreparation = {
  ready: false,
  reason: 'Publication preparation is unavailable. Contact support.',
};
const NEW_SESSION: SigningPreparation = { ready: false, reason: 'Publication needs a new session.', resend: true };

/** Signing provisioning re-uses the session token itself (it verifies and exchanges it again), so
 * unlike the other publication steps it needs the token's own step margin. A publish may otherwise
 * outlive its token (owner decision, 25 Nov 2026). */
export function sessionTokenUsable(actor: AdminActor, now = Date.now()): boolean {
  return (actor.sessionTokenExpiresAtMs ?? actor.expiresAtMs) - now >= PUBLICATION_STEP_MARGIN_MS;
}

/** Owner-plan states a request with a usable token could still turn into PROVISIONED: not started
 * (READY) or running (PENDING). Every other state is terminal or held for the owner. */
const OWNER_STATES_A_TOKEN_CAN_ADVANCE: readonly SigningOwnerStatus['state'][] = ['READY', 'PENDING'];

/**
 * The signing part of publication preparation. With a usable session token it provisions as before.
 * Without one, a store that already has its key continues; one whose key a usable token could still
 * provision answers `resend` (nothing was dispatched); any other state is unavailable, as before.
 */
export async function prepareSigningForPublication(
  actor: AdminActor,
  signing:
    | {
        kind: 'automatic';
        automatic: {
          ensure(actor: AdminActor, idToken: string | null, ianaTimezone: string): Promise<AutomaticSigningState>;
        };
        token: string;
        timezone: string;
      }
    | { kind: 'owner'; owner: Pick<SigningOwnerAction, 'prepare' | 'status'>; token: string },
  now = Date.now(),
): Promise<SigningPreparation> {
  const usable = sessionTokenUsable(actor, now);
  if (signing.kind === 'automatic') {
    const state = await signing.automatic.ensure(actor, usable ? signing.token : null, signing.timezone);
    if (state === 'SESSION_REQUIRED') return NEW_SESSION;
    return state === 'READY' || state === 'PROVISIONED' ? READY : UNAVAILABLE;
  }
  if (!usable) {
    const current = await signing.owner.status(actor);
    if (current.state === 'PROVISIONED') return READY;
    return OWNER_STATES_A_TOKEN_CAN_ADVANCE.includes(current.state) ? NEW_SESSION : UNAVAILABLE;
  }
  const result = await signing.owner.prepare(actor, signing.token);
  return result.state === 'PROVISIONED' ? READY : UNAVAILABLE;
}
