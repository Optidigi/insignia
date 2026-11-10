import { type KeyObject, sign } from 'node:crypto';
import {
  encodeHeaderV3,
  encodeLineCarrierV3,
  type HeaderV3Claims,
  type LineRecordV3,
  lineV3SignBytes,
  merkleProofV3,
  merkleRootV3,
} from '@insignia/cart-authorization';

/** Synchronous synthetic cart-line v3 authorization for repository fixtures. */
export function signLinesV3(
  claims: HeaderV3Claims,
  records: readonly LineRecordV3[],
  privateKey: KeyObject,
): { envelopeCarrier: string; members: { lineIndex: number; carrier: string }[] } {
  const header = { ...claims, count: records.length, rootHex: merkleRootV3(records).toString('hex') };
  const prefix = Buffer.concat([encodeHeaderV3(header), sign(null, lineV3SignBytes(header), privateKey)]);
  return {
    envelopeCarrier: prefix.toString('base64url'),
    members: records.map((record) => ({
      lineIndex: record.index,
      carrier: encodeLineCarrierV3(prefix, record, merkleProofV3(records, record.index)),
    })),
  };
}
