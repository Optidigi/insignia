import type { ComponentChildren } from 'preact';
import { useId, useLayoutEffect, useRef, useState } from 'preact/hooks';

export default function AdminDisclosure({
  label,
  children,
  actionLabels,
}: {
  label: string;
  children: ComponentChildren;
  actionLabels?: { show: string; hide: string };
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const trigger = useRef<HTMLElementTagNameMap['s-button']>(null);
  useLayoutEffect(() => {
    // App Home's Collapsible migration uses ARIA attributes on the public host.
    trigger.current?.setAttribute('aria-expanded', String(open));
    trigger.current?.setAttribute('aria-controls', id);
  }, [open, id]);
  return (
    <s-stack gap="base">
      <div class="admin-action-wrap">
        <s-button
          ref={trigger}
          accessibilityLabel={actionLabels ? (open ? actionLabels.hide : actionLabels.show) : undefined}
          variant="tertiary"
          inlineSize="fill"
          icon={open ? 'chevron-up' : 'chevron-down'}
          onClick={() => setOpen(!open)}
        >
          <span class="admin-action-label admin-action-label--start">{label}</span>
        </s-button>
      </div>
      <div id={id} hidden={!open}>
        {children}
      </div>
    </s-stack>
  );
}
