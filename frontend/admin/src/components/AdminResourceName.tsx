import type { ComponentChildren } from 'preact';
import { useId, useRef } from 'preact/hooks';
import { useTextOverflow } from '../shared/admin-text-overflow.ts';

type RenderProps = {
  textRef: { current: HTMLDivElement | null };
  interestFor: string | undefined;
  tooltip: ComponentChildren;
};

type Props = {
  text: string;
  children: (props: RenderProps) => ComponentChildren;
};

/** Adds an overflow-only tooltip to a resource link without adding another focus stop. */
export default function AdminResourceName({ text, children }: Props) {
  const textRef = useRef<HTMLDivElement>(null);
  const tooltipId = `admin-resource-name-${useId()}`;
  const overflowing = useTextOverflow(textRef, text);

  return children({
    textRef,
    interestFor: overflowing ? tooltipId : undefined,
    tooltip: overflowing ? <s-tooltip id={tooltipId}>{text}</s-tooltip> : null,
  });
}
