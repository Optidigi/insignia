/** Hard wall-clock bound even when an injected transport ignores AbortSignal. */
export async function withAdminDeadline<T>(
  task: (signal: AbortSignal) => Promise<T>,
  label: string,
  onTimeout?: () => void,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      try {
        onTimeout?.();
      } catch {
        /* cancellation is best effort */
      }
      reject(new Error(label + ' timed out'));
    }, 10_000);
  });
  try {
    return await Promise.race([task(controller.signal), deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
