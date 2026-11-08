/** A read-only Docker image root, with no bind mounts covering code, is immutable
 * to this unprivileged/capability-free verifier. State and auth mounts are separate.
 * Read-only host bind mounts are deliberately NOT treated as immutable code.
 */
export function immutableImageBoundary(mountInfo: string, codeRoot: string): string | null {
  if (!codeRoot.startsWith('/') || codeRoot === '/' || codeRoot.includes('..')) return null;
  const entries = mountInfo
    .trim()
    .split('\n')
    .map((line) => {
      const [left, right] = line.split(' - ');
      const fields = left?.split(' ') ?? [];
      return {
        line,
        point: fields[4]?.replace(/\\([0-7]{3})/g, (_, octal: string) =>
          String.fromCharCode(Number.parseInt(octal, 8)),
        ),
        options: fields[5]?.split(','),
        type: right?.split(' ')[0],
      };
    });
  if (entries.some((entry) => !entry.point || !entry.options || !entry.type)) return null;
  const root = entries.filter((entry) => entry.point === '/');
  if (
    root.length !== 1 ||
    root[0]?.type !== 'overlay' ||
    !root[0].options?.includes('ro') ||
    root[0].options.includes('rw')
  )
    return null;
  if (
    entries.some(
      (entry) =>
        entry.point !== '/' &&
        entry.point &&
        (codeRoot === entry.point || codeRoot.startsWith(`${entry.point}/`) || entry.point.startsWith(`${codeRoot}/`)),
    )
  )
    return null;
  return root[0].line;
}
