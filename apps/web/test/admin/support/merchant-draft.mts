import { type MerchantDraft, MerchantDraftSchema } from '@insignia/contracts';
import { type GeometryV1, validateGeometry } from '@insignia/visualizer/geometry';
import type { ConfigView } from '../../../src/shared/admin-view.js';
import { array, number, record, required, text } from './fixtures.mts';

type LabelMaps = NonNullable<MerchantDraft['labels']>;
export type FixtureDraft = Omit<MerchantDraft, 'geometry' | 'labels'> & {
  geometry: GeometryV1;
  labels: LabelMaps & Required<Pick<LabelMaps, 'methods' | 'placements' | 'steps' | 'views' | 'options' | 'values'>>;
};
export function readFixtureDraft(value: unknown): FixtureDraft {
  const draft = MerchantDraftSchema.parse(value),
    labels = required(draft.labels);
  return {
    ...draft,
    geometry: readGeometry(draft.geometry),
    labels: {
      ...labels,
      methods: required(labels.methods),
      placements: required(labels.placements),
      steps: required(labels.steps),
      views: required(labels.views),
      options: required(labels.options),
      values: required(labels.values),
    },
  };
}
export function readConfig(view: ConfigView) {
  const config = required(view.config);
  return { ...config, draft: readFixtureDraft(config.draft) };
}

export function readGeometry(value: unknown): GeometryV1 {
  const raw = record(value);
  if (raw.version !== 'm5-geometry-v1') throw new Error('Expected geometry v1');
  const image = (value: unknown) => {
    const row = record(value);
    return { ...row, revisionId: text(row.revisionId), width: number(row.width), height: number(row.height) };
  };
  const rect = (value: unknown) => {
    const row = record(value);
    return {
      ...row,
      centerX: number(row.centerX),
      centerY: number(row.centerY),
      width: number(row.width),
      height: number(row.height),
    };
  };
  return validateGeometry({
    ...raw,
    version: raw.version,
    views: array(raw.views).map((value) => {
      const row = record(value);
      return {
        ...row,
        id: text(row.id),
        ...(row.image === undefined ? {} : { image: image(row.image) }),
        variantImages: array(row.variantImages).map((value) => {
          const item = record(value);
          return { ...item, variantId: text(item.variantId), image: image(item.image) };
        }),
        placements: array(row.placements).map((value) => {
          const item = record(value);
          return {
            ...item,
            id: text(item.id),
            rect: rect(item.rect),
            ...(item.variantOverrides === undefined
              ? {}
              : {
                  variantOverrides: array(item.variantOverrides).map((value) => {
                    const override = record(value);
                    return { ...override, variantId: text(override.variantId), rect: rect(override.rect) };
                  }),
                }),
          };
        }),
      };
    }),
    steps: array(raw.steps).map((value) => {
      const row = record(value);
      return {
        ...row,
        id: text(row.id),
        widthFraction: number(row.widthFraction),
        heightFraction: number(row.heightFraction),
        ...(row.physicalMm === undefined
          ? {}
          : {
              physicalMm: {
                width: number(record(row.physicalMm).width),
                height: number(record(row.physicalMm).height),
              },
            }),
      };
    }),
  });
}
