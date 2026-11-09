const idPattern = /^[1-9][0-9]{0,19}$/;
const contextAttributes = [
  'proxy-base',
  'cart-root',
  'country',
  'market-id',
  'language',
  'store-name',
  'trigger-label',
];
type HiddenControl = { display: string; priority: string };
type Placement = {
  productId: string;
  hidden: Map<HTMLElement, HiddenControl>;
  buyer?: HTMLElement;
  manual?: HTMLElement;
};

export function styleThemeTrigger(button: HTMLButtonElement, host: HTMLElement): void {
  if (!button.className) button.className = 'button';
  button.classList.add('insignia-customise');
  const variant = host.getAttribute('button-style');
  if (variant === 'primary' || variant === 'secondary') {
    button.classList.remove('button--primary', 'button--secondary', 'button-secondary');
    button.classList.add(variant === 'secondary' ? 'button--secondary' : 'button--primary');
    if (variant === 'secondary') button.classList.add('button-secondary');
  }
  for (const [attribute, property] of [
    ['button-background', 'background-color'],
    ['button-color', 'color'],
    ['button-radius', 'border-radius'],
    ['button-border-width', 'border-width'],
    ['button-border-color', 'border-color'],
    ['button-spacing', 'margin-block'],
  ]) {
    const value = host.getAttribute(attribute ?? '');
    if (value && property && CSS.supports(property, value)) {
      button.style.setProperty(property, value);
      if (attribute === 'button-background') button.style.backgroundImage = 'none';
    }
  }
  if (host.hasAttribute('button-border-width')) button.style.borderStyle = 'solid';
  if (host.getAttribute('button-width') === 'full') button.style.width = '100%';
  else if (host.getAttribute('button-width') === 'content') button.style.width = 'auto';
}

function decorativeThemeIcon(native: HTMLButtonElement): HTMLElement | undefined {
  const source = native.querySelector('svg');
  if (!source) return;
  const tags = new Set(['svg', 'g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon']);
  const attributes = new Set([
    'viewBox',
    'd',
    'fill',
    'stroke',
    'stroke-width',
    'stroke-linecap',
    'stroke-linejoin',
    'transform',
    'cx',
    'cy',
    'r',
    'rx',
    'ry',
    'x',
    'y',
    'x1',
    'x2',
    'y1',
    'y2',
    'width',
    'height',
    'points',
    'opacity',
    'class',
  ]);
  function copy(node: Element): SVGElement | undefined {
    const tag = node.localName;
    if (!tags.has(tag)) return;
    const result = document.createElementNS('http://www.w3.org/2000/svg', tag);
    if (!(result instanceof SVGElement)) return;
    for (const attribute of node.attributes)
      if (attributes.has(attribute.name) && !/url\s*\(/i.test(attribute.value))
        result.setAttribute(attribute.name, attribute.value);
    for (const child of node.children) {
      const safe = copy(child);
      if (safe) result.append(safe);
    }
    return result;
  }
  const icon = copy(source);
  if (!icon?.childElementCount) return;
  icon.setAttribute('aria-hidden', 'true');
  icon.setAttribute('focusable', 'false');
  const wrapper = document.createElement('span');
  if (source.parentElement?.tagName === 'SPAN') wrapper.className = source.parentElement.className;
  wrapper.setAttribute('aria-hidden', 'true');
  wrapper.dataset.insigniaThemeIcon = '';
  wrapper.append(icon);
  return wrapper;
}

// Slotting adds a DOM ancestor: direct-child theme rules can stop matching.
// Retain visual classes for interaction states and fill only lost presentation.
const presentationProperties = [
  'background-color',
  'background-image',
  'color',
  'border-top',
  'border-right',
  'border-bottom',
  'border-left',
  'border-radius',
  'padding',
  'font',
  'letter-spacing',
  'text-transform',
  'text-align',
  'box-shadow',
  'box-sizing',
  'align-items',
  'justify-content',
  'gap',
  'min-height',
];
const inheritedPresentation = new WeakMap<HTMLButtonElement, Set<string>>();
const idlePresentation = new WeakMap<HTMLButtonElement, Map<string, string>>();
function inheritThemePresentation(button: HTMLButtonElement, native: HTMLButtonElement, host: HTMLElement) {
  const interacting = button.matches(':hover,:active,:focus-visible');
  const idle = idlePresentation.get(button) ?? new Map<string, string>();
  const beforeStyle = getComputedStyle(button);
  const before = presentationProperties.map((property) => [property, beforeStyle.getPropertyValue(property)] as const);
  // Sample the cascade's destination, not an intermediate CSS transition value.
  const transition = button.style.getPropertyValue('transition');
  const transitionPriority = button.style.getPropertyPriority('transition');
  button.style.setProperty('transition', 'none', 'important');
  for (const property of inheritedPresentation.get(button) ?? []) button.style.removeProperty(property);
  const copied = new Set<string>();
  const variant = host.getAttribute('button-style');
  if (variant === 'primary' || variant === 'secondary') {
    if (transition) button.style.setProperty('transition', transition, transitionPriority);
    else button.style.removeProperty('transition');
    inheritedPresentation.set(button, copied);
    return;
  }
  for (const property of native.style) {
    if (!property.startsWith('--')) continue;
    button.style.setProperty(
      property,
      native.style.getPropertyValue(property),
      native.style.getPropertyPriority(property),
    );
    copied.add(property);
  }
  const source = getComputedStyle(native),
    target = getComputedStyle(button);
  for (const property of presentationProperties) {
    const value = source.getPropertyValue(property);
    const current = target.getPropertyValue(property);
    // Keep lost ancestor styling only where the theme has no state-specific value.
    // Inline fallbacks must yield to real hover/focus rules on the retained classes.
    if (interacting && idle.has(property) && current !== idle.get(property)) continue;
    if (!interacting) idle.set(property, current);
    if (value === current) continue;
    button.style.setProperty(property, value);
    copied.add(property);
  }
  if (transition) button.style.setProperty('transition', transition, transitionPriority);
  else button.style.removeProperty('transition');
  const destination = button.style.cssText;
  // Sampling is synchronous and unpainted. Restore the visible starting point
  // before committing the destination so the theme can animate between them.
  button.style.setProperty('transition', 'none', 'important');
  for (const [property, value] of before) button.style.setProperty(property, value);
  void getComputedStyle(button).padding;
  button.style.cssText = destination;
  inheritedPresentation.set(button, copied);
  idlePresentation.set(button, idle);
}

/** Presentation only. Signed publication, quote and Shopify validation remain authoritative. */
export function connectThemeIntegration(host: HTMLElement): () => void {
  const placements = new Map<HTMLElement, Placement>();
  const eligibility = new Map<string, boolean | 'pending' | 'failed'>();
  const abort = new AbortController();
  const interactionTriggers = new WeakSet<HTMLButtonElement>();
  const proxy = host.getAttribute('proxy-base') ?? '/apps/insignia';
  if (!/^\/(?:[A-Za-z0-9_-]+\/)*apps\/[a-z0-9-]{1,64}$/.test(proxy)) return () => {};
  const mainId = host.getAttribute('product-id') ?? '';
  const variants = new Set((host.getAttribute('variant-ids') ?? '').split(',').filter((id) => idPattern.test(id)));
  if (idPattern.test(mainId) && host.hasAttribute('known-required')) eligibility.set(mainId, true);
  let interactionFrame: number | undefined;
  let queued = false;
  let disposed = false;

  function productId(root: HTMLElement): string | undefined {
    const direct = root.closest<HTMLElement>('[data-product-id]')?.dataset.productId;
    const input = root.querySelector<HTMLInputElement>('input[name="product-id"]')?.value;
    const variant = root.querySelector<HTMLInputElement>('[name="id"]')?.value;
    const id = direct ?? input ?? (variant && variants.has(variant) ? mainId : undefined);
    return id && idPattern.test(id) ? id : undefined;
  }
  function manualPlacement(root: HTMLElement, id: string): HTMLElement | undefined {
    const surfaces = 'quick-add-component,sticky-add-to-cart,quick-add-modal,dialog,[role="dialog"]';
    const surface = root.closest<HTMLElement>(surfaces);
    const section =
      surface ?? root.closest<HTMLElement>('.shopify-section,section') ?? root.closest<HTMLElement>('product-info');
    if (!section) return undefined;
    return [...section.querySelectorAll<HTMLElement>('insignia-buyer:not([data-insignia-auto]):not([repair])')].find(
      (buyer) => {
        if (buyer.getAttribute('product-id') !== id || buyer.closest(surfaces) !== surface) return false;
        const button = buyer.querySelector<HTMLButtonElement>('button[slot="trigger"]');
        if (!button || !button.getClientRects().length || buyer.closest('[hidden],[inert]')) return false;
        const style = getComputedStyle(button);
        return style.visibility !== 'hidden' && style.display !== 'none';
      },
    );
  }
  function restore(root: HTMLElement, placement: Placement) {
    placement.buyer?.remove();
    for (const [control, before] of placement.hidden) {
      if (
        control.style.getPropertyValue('display') !== 'none' ||
        control.style.getPropertyPriority('display') !== 'important'
      )
        continue;
      if (before.display) control.style.setProperty('display', before.display, before.priority);
      else control.style.removeProperty('display');
    }
    placements.delete(root);
  }
  function schedule() {
    if (queued || disposed) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      scan();
    });
  }
  function scheduleInteraction() {
    if (disposed || interactionFrame !== undefined) return;
    interactionFrame = requestAnimationFrame(() => {
      interactionFrame = undefined;
      schedule();
    });
  }
  function lookup(id: string) {
    if (eligibility.has(id)) return;
    eligibility.set(id, 'pending');
    void fetch(`${proxy}/v1/eligibility?productId=${encodeURIComponent(id)}`, {
      credentials: 'same-origin',
      cache: 'no-store',
      signal: abort.signal,
    })
      .then(async (response) => {
        if (disposed) return;
        if (response.status === 404) eligibility.set(id, false);
        else if (response.ok) {
          const value: unknown = await response.json();
          if (
            value &&
            typeof value === 'object' &&
            'productId' in value &&
            value.productId === id &&
            'configured' in value &&
            value.configured === true
          )
            eligibility.set(id, true);
          else eligibility.set(id, 'failed');
        } else eligibility.set(id, 'failed');
        // Unknown/outage never downgrades a known required product to ordinary.
        schedule();
      })
      .catch(() => {
        if (!disposed) eligibility.set(id, 'failed');
      });
  }
  function scan() {
    if (disposed) return;
    observer.disconnect();
    const roots = new Set<HTMLElement>();
    for (const form of document.querySelectorAll<HTMLFormElement>('form[action]')) {
      let url: URL;
      try {
        url = new URL(form.action, location.href);
      } catch {
        continue;
      }
      if (url.origin !== location.origin || !/\/(?:[A-Za-z0-9_-]+\/)*cart\/add(?:\.js)?\/?$/.test(url.pathname))
        continue;
      roots.add(form.closest<HTMLElement>('quick-add-component[data-product-id]') ?? form);
    }
    for (const quick of document.querySelectorAll<HTMLElement>(
      'quick-add-component[data-product-id],sticky-add-to-cart[data-product-id]',
    ))
      roots.add(quick);
    for (const [root, placement] of placements) {
      if (!root.isConnected || productId(root) !== placement.productId || !roots.has(root)) restore(root, placement);
    }
    for (const root of roots) {
      const id = productId(root);
      if (!id) continue;
      lookup(id);
      if (eligibility.get(id) !== true) continue;
      const manual = manualPlacement(root, id);
      if (host.getAttribute('auto-placement') === 'false' && !manual) continue;
      const controls = [
        ...root.querySelectorAll<HTMLElement>(
          'button[name="add"],button[type="submit"],.sticky-add-to-cart__button,.shopify-payment-button,shopify-accelerated-checkout',
        ),
      ].filter((control) => !control.closest('insignia-buyer'));
      const primary = controls.find((control): control is HTMLButtonElement => control instanceof HTMLButtonElement);
      if (!primary) continue;
      let placement = placements.get(root);
      if (!placement) {
        placement = { productId: id, hidden: new Map() };
        placements.set(root, placement);
      }
      for (const control of controls) {
        if (!placement.hidden.has(control))
          placement.hidden.set(control, {
            display: control.style.getPropertyValue('display'),
            priority: control.style.getPropertyPriority('display'),
          });
        control.style.setProperty('display', 'none', 'important');
      }
      if (manual) {
        placement.manual = manual;
        placement.buyer?.remove();
        placement.buyer = undefined;
      } else if (!placement.buyer?.isConnected) {
        placement.manual = undefined;
        const buyer = document.createElement('insignia-buyer');
        buyer.setAttribute('data-insignia-auto', '');
        buyer.setAttribute('product-id', id);
        for (const key of contextAttributes) {
          const value = host.getAttribute(key);
          if (value) buyer.setAttribute(key, value);
        }
        const button = document.createElement('button');
        button.type = 'button';
        button.slot = 'trigger';
        // Copy presentation, never theme refs, handlers, names, IDs or cart authority.
        button.className = primary.className;
        button.classList.remove('loading');
        styleThemeTrigger(button, host);
        button.textContent = host.getAttribute('trigger-label') || 'Customise';
        const icon = decorativeThemeIcon(primary);
        if (icon) button.prepend(icon);
        else if (root.matches('quick-add-component,sticky-add-to-cart')) {
          button.style.width = 'auto';
          button.style.minWidth = 'max-content';
        }
        buyer.append(button);
        primary.before(buyer);
        placement.buyer = buyer;
      }
      const styleHost = placement.buyer ? host : placement.manual;
      const trigger = (placement.buyer ?? placement.manual)?.querySelector<HTMLButtonElement>('button[slot="trigger"]');
      if (trigger && styleHost) {
        if (!interactionTriggers.has(trigger)) {
          for (const event of ['pointerenter', 'pointerleave', 'pointerdown', 'pointerup', 'focus', 'blur'])
            trigger.addEventListener(event, scheduleInteraction, { signal: abort.signal });
          interactionTriggers.add(trigger);
        }
        inheritThemePresentation(trigger, primary, styleHost);
        styleThemeTrigger(trigger, styleHost);
      }
    }
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-product-id', 'value', 'style', 'class', 'hidden', 'inert', 'open'],
    });
  }
  const observer = new MutationObserver(schedule);
  const retryFailedLookups = () => {
    for (const [id, state] of eligibility) if (state === 'failed') eligibility.delete(id);
    schedule();
  };
  const preventPlainSubmission = (event: Event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    const root = form.closest<HTMLElement>('quick-add-component[data-product-id]') ?? form;
    const placement = placements.get(root);
    if (!placement) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const buyer = placement.buyer ?? placement.manual;
    buyer?.querySelector<HTMLButtonElement>('button[slot="trigger"]')?.click();
  };
  document.addEventListener('submit', preventPlainSubmission, true);
  document.addEventListener('shopify:section:load', retryFailedLookups);
  document.addEventListener('change', schedule);
  window.addEventListener('online', retryFailedLookups);
  window.addEventListener('resize', schedule);
  scan();
  return () => {
    disposed = true;
    if (interactionFrame !== undefined) cancelAnimationFrame(interactionFrame);
    abort.abort();
    observer.disconnect();
    document.removeEventListener('submit', preventPlainSubmission, true);
    document.removeEventListener('shopify:section:load', retryFailedLookups);
    document.removeEventListener('change', schedule);
    window.removeEventListener('online', retryFailedLookups);
    window.removeEventListener('resize', schedule);
    for (const [root, placement] of placements) restore(root, placement);
  };
}
