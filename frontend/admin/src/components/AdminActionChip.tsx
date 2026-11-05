import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useAdminLocale } from '../shared/admin-i18n.js';

type ActionChipIcon = JSX.IntrinsicElements['s-icon']['type'];
type ActionChipCommand = JSX.IntrinsicElements['button']['command'];
type ActionChipClick = JSX.IntrinsicElements['button']['onClick'];

/** Compact action control for dense resource-selection rows. */
export default function AdminActionChip({
  children,
  accessibilityLabel,
  icon,
  trailingIcon,
  iconOnly = false,
  disabled = false,
  loading = false,
  commandFor,
  command,
  onClick,
}: {
  children?: ComponentChildren;
  accessibilityLabel?: string;
  icon?: ActionChipIcon;
  trailingIcon?: ActionChipIcon;
  iconOnly?: boolean;
  disabled?: boolean;
  loading?: boolean;
  commandFor?: string;
  command?: ActionChipCommand;
  onClick?: ActionChipClick;
}) {
  const { t } = useAdminLocale();
  const label =
    accessibilityLabel ??
    (typeof children === 'string' || typeof children === 'number' ? String(children) : t('common:actions.action'));
  const hasTrailingIcon = !iconOnly && trailingIcon !== undefined;
  const tracksMenu = Boolean(commandFor) && command !== '--show';
  const [expanded, setExpanded] = useState(false);
  const expandedRef = useRef(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!tracksMenu || !expanded) return;
    const closeMenu = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== 'Escape') return;
      if (event.type === 'click' && event.target instanceof Node && buttonRef.current?.contains(event.target)) {
        return;
      }
      expandedRef.current = false;
      setExpanded(false);
    };
    document.addEventListener('keydown', closeMenu);
    document.addEventListener('click', closeMenu);
    return () => {
      document.removeEventListener('keydown', closeMenu);
      document.removeEventListener('click', closeMenu);
    };
  }, [expanded, tracksMenu]);

  return (
    <button
      ref={buttonRef}
      type="button"
      class={`admin-action-chip${iconOnly ? ' admin-action-chip-icon-only' : ''}${hasTrailingIcon ? ' admin-action-chip-with-trailing-icon' : ''}`}
      aria-label={label}
      aria-controls={commandFor}
      aria-haspopup={commandFor ? (command === '--show' ? 'dialog' : 'menu') : undefined}
      aria-expanded={tracksMenu ? expanded : undefined}
      aria-busy={loading ? 'true' : undefined}
      commandFor={commandFor}
      command={commandFor ? (command ?? '--auto') : undefined}
      disabled={disabled || loading}
      onClick={(event) => {
        if (tracksMenu) {
          const next = !expandedRef.current;
          expandedRef.current = next;
          setExpanded(next);
        }
        onClick?.(event);
      }}
    >
      <span class="admin-action-chip-content">
        {iconOnly ? (
          icon && <s-icon type={icon} />
        ) : (
          <>
            <span class="admin-action-chip-label">{children}</span>
            {trailingIcon && <s-icon type={trailingIcon} size="small" />}
          </>
        )}
      </span>
    </button>
  );
}
