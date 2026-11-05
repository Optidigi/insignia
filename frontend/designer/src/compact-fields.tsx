import { useId, useRef } from "preact/hooks";
import type { ComponentChildren, RefObject } from "preact";
import { IconX } from "./legacy-icons";

interface FloatingSearchProps {
  label: string;
  clearLabel: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  controls?: string;
  inputRef?: RefObject<HTMLInputElement>;
}

export function FloatingSearch({
  label,
  clearLabel,
  name,
  value,
  onChange,
  controls,
  inputRef,
}: FloatingSearchProps) {
  const id = useId();
  const localRef = useRef<HTMLInputElement>(null);
  const ref = inputRef ?? localRef;
  return (
    <div className="floating-search" data-filled={value.length > 0}>
      <input
        id={id}
        ref={ref}
        type="search"
        name={name}
        autoComplete="off"
        spellcheck={false}
        enterKeyHint="search"
        aria-controls={controls}
        value={value}
        onInput={(event) => onChange(event.currentTarget.value)}
      />
      <label htmlFor={id}>{label}</label>
      {value && (
        <button
          type="button"
          className="clear-search"
          aria-label={clearLabel}
          onClick={() => {
            onChange("");
            ref.current?.focus();
          }}
        >
          <IconX size={16} />
        </button>
      )}
    </div>
  );
}

interface FloatingSelectProps {
  label: string;
  name: string;
  value: string | number;
  onChange: (value: string) => void;
  children: ComponentChildren;
  className?: string;
}

export function FloatingSelect({
  label,
  name,
  value,
  onChange,
  children,
  className = "",
}: FloatingSelectProps) {
  const id = useId();
  return (
    <div className={`floating-select ${className}`}>
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        name={name}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      >
        {children}
      </select>
    </div>
  );
}
