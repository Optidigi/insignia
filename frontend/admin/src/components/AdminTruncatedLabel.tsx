import { useRef } from 'preact/hooks';
import { useTextOverflow } from '../shared/admin-text-overflow.ts';

/** Constrained labels inside native controls retain their full accessible text.
 * Their owning selection/detail field is the full-name path on touch devices. */
export default function AdminTruncatedLabel({
  text,
  className,
  id,
}: {
  text: string;
  className?: string;
  id?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const clipped = useTextOverflow(ref, text);
  return (
    <span ref={ref} class={className} id={id} title={clipped ? text : undefined}>
      {text}
    </span>
  );
}
