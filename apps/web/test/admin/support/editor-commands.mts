import { type MerchantDraft, MerchantDraftSchema } from '@insignia/contracts';
import type { GeometryV1 } from '@insignia/visualizer/geometry';
import type { Request } from 'playwright';
import { record, required, text } from './fixtures.mts';
import { readGeometry } from './merchant-draft.mts';
export type EditorDraft = Omit<MerchantDraft, 'geometry'> & { geometry: GeometryV1 };
export type EditorCommand = Record<string, unknown> & {
  action: string;
  configId?: string;
  draftVersion?: string;
  draft?: EditorDraft;
};
export type EditorSave = EditorCommand & { configId: string; draftVersion: string; draft: EditorDraft };
export function editorCommand(request: Pick<Request, 'postDataJSON'>): EditorCommand {
  const value: unknown = request.postDataJSON(),
    raw = record(value);
  const command: EditorCommand = { ...raw, action: text(raw.action) };
  if (raw.configId !== undefined) command.configId = text(raw.configId);
  if (raw.draftVersion !== undefined) command.draftVersion = text(raw.draftVersion);
  if (raw.draft !== undefined) {
    const draft = MerchantDraftSchema.parse(raw.draft);
    command.draft = { ...draft, geometry: readGeometry(draft.geometry) };
  }
  return command;
}
export function editorSave(request: Pick<Request, 'postDataJSON'>): EditorSave {
  const command = editorCommand(request);
  return {
    ...command,
    configId: required(command.configId),
    draftVersion: required(command.draftVersion),
    draft: required(command.draft),
  };
}
export function fixedRate(rate: EditorDraft['pricingRules'][number]['rate']) {
  if (rate.kind !== 'fixed') throw new Error('Expected fixed rate in fixture observation');
  return rate;
}
