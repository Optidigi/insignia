import { useLayoutEffect, useState } from 'preact/hooks';

type TextElementRef = { current: HTMLElement | null };
type MeasureListener = () => void;

const listeners = new Map<HTMLElement, Set<MeasureListener>>();
const pending = new Set<HTMLElement>();
let resizeObserver: ResizeObserver | undefined;
let frame: number | null = null;
let cancelFrame: (() => void) | undefined;

function measureTextOverflow(element: HTMLElement): boolean {
  return element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight;
}

function flushMeasurements() {
  frame = null;
  cancelFrame = undefined;
  const elements = [...pending];
  pending.clear();
  for (const element of elements) {
    for (const listener of listeners.get(element) ?? []) listener();
  }
}

function requestMeasurements() {
  if (frame !== null || typeof window === 'undefined') return;
  if (typeof window.requestAnimationFrame === 'function') {
    frame = window.requestAnimationFrame(flushMeasurements);
    cancelFrame = () => window.cancelAnimationFrame(frame ?? 0);
    return;
  }
  frame = window.setTimeout(flushMeasurements, 0);
  cancelFrame = () => window.clearTimeout(frame ?? 0);
}

function scheduleMeasurement(element: HTMLElement) {
  if (!listeners.has(element)) return;
  pending.add(element);
  requestMeasurements();
}

function scheduleAllMeasurements() {
  for (const element of listeners.keys()) pending.add(element);
  requestMeasurements();
}

function onWindowResize() {
  scheduleAllMeasurements();
}

function onFontsLoaded() {
  scheduleAllMeasurements();
}

function startSharedObservers() {
  if (listeners.size !== 1) return;
  if (typeof window !== 'undefined') window.addEventListener('resize', onWindowResize, { passive: true });
  if (typeof document !== 'undefined' && document.fonts) {
    document.fonts.addEventListener('loadingdone', onFontsLoaded);
    void document.fonts.ready.then(onFontsLoaded);
  }
}

function stopSharedObservers() {
  if (listeners.size !== 0) return;
  if (typeof window !== 'undefined') window.removeEventListener('resize', onWindowResize);
  if (typeof document !== 'undefined' && document.fonts) {
    document.fonts.removeEventListener('loadingdone', onFontsLoaded);
  }
  resizeObserver?.disconnect();
  resizeObserver = undefined;
  pending.clear();
  if (frame !== null) cancelFrame?.();
  frame = null;
  cancelFrame = undefined;
}

function observeTextElement(element: HTMLElement, listener: MeasureListener): () => void {
  const existing = listeners.get(element);
  if (existing) {
    existing.add(listener);
  } else {
    listeners.set(element, new Set([listener]));
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver ??= new ResizeObserver((entries) => {
        for (const entry of entries) scheduleMeasurement(entry.target as HTMLElement);
      });
      resizeObserver.observe(element);
    }
    startSharedObservers();
  }
  scheduleMeasurement(element);

  return () => {
    const current = listeners.get(element);
    current?.delete(listener);
    if (current?.size) return;
    listeners.delete(element);
    pending.delete(element);
    resizeObserver?.unobserve(element);
    stopSharedObservers();
  };
}

/** Returns whether a constrained text element is clipped in either dimension. */
export function useTextOverflow(ref: TextElementRef, text: string): boolean {
  const [overflowing, setOverflowing] = useState(false);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    const update = () => {
      const next = measureTextOverflow(element);
      setOverflowing((current) => (current === next ? current : next));
    };
    update();
    return observeTextElement(element, update);
  }, [ref, text]);

  return overflowing;
}
