/** Compact nonnegative count series, with a real zero baseline. */
export function homeSparklinePoints(
  values: readonly number[],
  options: { width?: number; height?: number; maximum?: number } = {},
): string | undefined {
  if (values.length === 0 || values.some((value) => !Number.isFinite(value) || value < 0)) return undefined;
  const maximum = Math.max(1, ...values, options.maximum ?? 0);
  const width = options.width ?? 104;
  const height = options.height ?? 28;
  return values
    .map((value, index) => {
      const x = values.length === 1 ? width / 2 : 2 + (index / (values.length - 1)) * (width - 4);
      const y = height - 2 - (value / maximum) * (height - 4);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
}
