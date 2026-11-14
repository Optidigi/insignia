import type { ComponentProps } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { canonicalDecimalText } from '../../examples/admin/support/decimal-input.mts';
import { canonicalPriceText } from '../../examples/admin/support/method-workflow-prices.mts';

type TextFieldProps = ComponentProps<'s-text-field'>;
type Props = Omit<TextFieldProps, 'value' | 'onInput' | 'onChange' | 'ref'> & {
  value: string;
  /** Called with the typed text on every edit, and with its canonical form when the merchant leaves the field. */
  onValue(text: string): void;
  /** Called after the merchant leaves the field or presses Enter, with the settled text. */
  onCommit?(text: string): void;
  /** `price` settles a valid entry to exact two-decimal text; `number` only unifies the separator. */
  kind?: 'price' | 'number';
};

/**
 * A Polaris text field for merchant decimals. Browsers discard a typed "," in a number input before the page sees
 * it ("7,5" would arrive as 75), so these fields keep the text and the shared decimal parser reads it. Polaris
 * does not forward `inputMode`, so the decimal keypad is requested on the rendered input directly.
 */
export function DecimalField({ onValue, onCommit, kind = 'number', ...field }: Props) {
  const host = useRef<HTMLElementTagNameMap['s-text-field']>(null);
  useLayoutEffect(() => {
    const input = host.current?.shadowRoot?.querySelector('input');
    if (input) input.inputMode = 'decimal';
  }, []);
  const settle = kind === 'price' ? canonicalPriceText : canonicalDecimalText;
  return (
    <s-text-field
      {...field}
      ref={host}
      onInput={(event) => onValue(event.currentTarget.value)}
      onChange={(event) => {
        const typed = event.currentTarget.value;
        const settled = settle(typed);
        if (settled !== typed) onValue(settled);
        onCommit?.(settled);
      }}
    />
  );
}
