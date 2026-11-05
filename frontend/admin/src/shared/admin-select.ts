// Polaris uses an empty option's text as its native value. This sentinel cannot collide with persisted IDs.
export const noSelection = '@insignia/no-selection';

export function selectedValue(value: string): string | undefined {
  return value === noSelection ? undefined : value;
}
