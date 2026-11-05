import { useLayoutEffect, useRef, useState } from 'preact/hooks';

type Props = {
  id?: string;
  label: string;
  lang?: string;
  value: string;
  placeholder?: string;
  readOnly?: boolean;
  disabled?: boolean;
  error?: string;
  onInput?(value: string): void;
  onBlur?(): void;
};

function renderedTextarea(root: ParentNode): HTMLTextAreaElement | null {
  const direct = root.querySelector('textarea');
  if (direct) return direct;
  for (const child of root.querySelectorAll('*')) {
    if (!child.shadowRoot) continue;
    const nested = renderedTextarea(child.shadowRoot);
    if (nested) return nested;
  }
  return null;
}

/** Pinned-runtime focus bridge. Native HTMLElement.focus does not delegate through these shadow roots. */
export function focusTextArea(control: HTMLElement): void {
  control.focus({ preventScroll: true });
  const input = control.shadowRoot ? renderedTextarea(control.shadowRoot) : null;
  input?.focus({ preventScroll: true });
}

/** Measure a hidden HTML copy without changing the native control or its cursor/scroll position. */
function rowsFor(input: HTMLTextAreaElement, value: string): number {
  const style = getComputedStyle(input);
  const line = Number.parseFloat(style.lineHeight) || 20;
  const padding = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
  const mirror = input.cloneNode(false) as HTMLTextAreaElement;
  mirror.removeAttribute('id');
  mirror.removeAttribute('name');
  mirror.setAttribute('aria-hidden', 'true');
  mirror.inert = true;
  mirror.tabIndex = -1;
  mirror.rows = 1;
  mirror.value = value;
  Object.assign(mirror.style, {
    position: 'fixed',
    left: '-10000px',
    top: '0',
    visibility: 'hidden',
    display: 'block',
    height: '0',
    minHeight: '0',
    maxHeight: 'none',
    overflow: 'hidden',
    resize: 'none',
    boxSizing: 'border-box',
    width: `${input.getBoundingClientRect().width}px`,
    padding: style.padding,
    border: style.border,
    font: style.font,
    letterSpacing: style.letterSpacing,
    textIndent: style.textIndent,
    textTransform: style.textTransform,
    wordBreak: style.wordBreak,
    overflowWrap: style.overflowWrap,
    whiteSpace: style.whiteSpace,
    direction: style.direction,
    unicodeBidi: style.unicodeBidi,
  });
  document.body.append(mirror);
  try {
    return Math.min(12, Math.max(1, Math.ceil((mirror.scrollHeight - padding) / line)));
  } finally {
    mirror.remove();
  }
}

/** Public Polaris control; rows follow rendered geometry, independently of workflow state. */
export default function AutoSizeTextArea({ value, onInput, ...props }: Props) {
  const measurementText = value || props.placeholder || '';
  const control = useRef<HTMLElementTagNameMap['s-text-area']>(null);
  const [rows, setRows] = useState(1);
  useLayoutEffect(() => {
    let alive = true;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!alive || !control.current) return;
        // Read-only seam for the pinned runtime, including nested open shadow roots.
        const input = control.current.shadowRoot ? renderedTextarea(control.current.shadowRoot) : null;
        if (!input) {
          // Remain usable if a future runtime changes/closes its shadow tree.
          setRows(measurementText.length > 50 || measurementText.includes('\n') ? 4 : 1);
        } else if (rows > 1 || input.scrollHeight > input.clientHeight + 1 || measurementText !== value) {
          setRows(rowsFor(input, measurementText));
        }
      });
    };
    const observer = new ResizeObserver(measure);
    if (control.current) observer.observe(control.current);
    void customElements.whenDefined('s-text-area').then(() => {
      if (alive) measure();
    });
    void document.fonts.ready.then(() => {
      if (alive) measure();
    });
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [value, measurementText, rows]);
  return (
    <s-text-area
      {...props}
      ref={control}
      labelAccessibilityVisibility="exclusive"
      value={value}
      rows={rows}
      onInput={(event) => onInput?.(event.currentTarget.value)}
    />
  );
}
