import type { ComponentChildren, JSX } from 'preact';

type BoxProps = JSX.IntrinsicElements['div'] & {
  children?: ComponentChildren;
  inlineSize?: string;
  maxInlineSize?: string;
  minBlockSize?: string;
  display?: 'none' | 'auto';
  padding?: 'base' | 'small-300' | 'none';
  paddingBlock?: 'base';
  paddingInline?: 'base' | 'large-300';
  border?: 'base';
  borderRadius?: 'base' | 'large';
};

/** Loading decoration is plain HTML, so runtime registration cannot restyle it. */
export function SkeletonBox({
  children,
  inlineSize,
  maxInlineSize,
  minBlockSize,
  display,
  padding,
  paddingBlock,
  paddingInline,
  border,
  borderRadius,
  ...attributes
}: BoxProps) {
  return (
    <div
      {...attributes}
      class="admin-skeleton-box"
      data-skeleton-padding-inline={paddingInline}
      style={{
        width: inlineSize,
        maxWidth: maxInlineSize,
        minHeight: minBlockSize,
        display: display === 'none' ? 'none' : undefined,
        padding: padding === 'base' ? '16px' : padding === 'small-300' ? '6px' : padding === 'none' ? '0' : undefined,
        paddingBlock: paddingBlock ? '16px' : undefined,
        border: border ? '1px solid #e3e3e3' : undefined,
        borderRadius: borderRadius === 'large' ? '12px' : borderRadius ? '6px' : undefined,
      }}
    >
      {children}
    </div>
  );
}

type LayoutProps = JSX.IntrinsicElements['div'] & {
  children?: ComponentChildren;
  gap?: 'none' | 'small' | 'base';
  alignItems?: 'center';
  justifyItems?: 'center';
  gridTemplateColumns?: string;
  direction?: 'inline';
};
export function SkeletonStack({ children, gap = 'base', direction, alignItems, ...attributes }: LayoutProps) {
  return (
    <div
      {...attributes}
      class="admin-skeleton-stack"
      data-skeleton-gap={gap}
      data-skeleton-direction={direction}
      style={{ alignItems }}
    >
      {children}
    </div>
  );
}
export function SkeletonGrid({
  children,
  gap = 'none',
  gridTemplateColumns,
  alignItems,
  justifyItems,
  ...attributes
}: LayoutProps) {
  return (
    <div
      {...attributes}
      class="admin-skeleton-grid"
      data-skeleton-gap={gap}
      style={{ gridTemplateColumns, alignItems, justifyItems }}
    >
      {children}
    </div>
  );
}
export function SkeletonSection({
  children,
  padding = 'base',
}: {
  children?: ComponentChildren;
  padding?: 'base' | 'none';
}) {
  return (
    <div class="admin-skeleton-card" data-skeleton-card style={{ padding: padding === 'none' ? '0' : '16px' }}>
      {children}
    </div>
  );
}
