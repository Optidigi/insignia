import { type ComponentChildren, createContext, type FunctionComponent, h } from 'preact';
import { useContext, useLayoutEffect, useState } from 'preact/hooks';
import type { LocaleController, LocaleSnapshot } from './core.js';

export interface LocaleProviderProps<TTranslator, TMessage = never> {
  readonly controller: LocaleController<TTranslator, TMessage>;
  /** Match server markup on hydration, then reconcile before the first paint. */
  readonly initialSnapshot?: LocaleSnapshot<TTranslator, TMessage>;
  readonly children?: ComponentChildren;
}

export interface PreactLocaleBindings<TTranslator, TMessage = never> {
  readonly LocaleProvider: FunctionComponent<LocaleProviderProps<TTranslator, TMessage>>;
  readonly useLocale: () => LocaleSnapshot<TTranslator, TMessage>;
}

/**
 * Creates one stable context and hook pair for an audience module. Providers
 * receive their own controller, so concurrent roots and modal instances do not
 * share mutable language state.
 */
export function createPreactLocaleBindings<TTranslator, TMessage = never>(
  createDefaultSnapshot: () => LocaleSnapshot<TTranslator, TMessage>,
): PreactLocaleBindings<TTranslator, TMessage> {
  const LocaleContext = createContext<LocaleSnapshot<TTranslator, TMessage> | undefined>(undefined);

  const LocaleProvider: FunctionComponent<LocaleProviderProps<TTranslator, TMessage>> = ({
    controller,
    initialSnapshot,
    children,
  }) => {
    const [snapshot, setSnapshot] = useState(() => initialSnapshot ?? controller.getSnapshot());

    useLayoutEffect(() => {
      const update = () => setSnapshot(controller.getSnapshot());
      const unsubscribe = controller.subscribe(update);
      update();
      return unsubscribe;
    }, [controller]);

    return h(LocaleContext.Provider, { value: snapshot }, children);
  };

  const useLocale = (): LocaleSnapshot<TTranslator, TMessage> => useContext(LocaleContext) ?? createDefaultSnapshot();

  return { LocaleProvider, useLocale };
}
