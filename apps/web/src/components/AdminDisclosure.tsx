import type { ComponentChildren } from 'preact';
import { useId, useState } from 'preact/hooks';

export default function AdminDisclosure({ label, children }: { label: string; children: ComponentChildren }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <s-stack gap="base">
      <s-button
        variant="tertiary"
        icon={open ? 'chevron-up' : 'chevron-down'}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        {label}
      </s-button>
      <div id={id} hidden={!open}>
        {children}
      </div>
    </s-stack>
  );
}
