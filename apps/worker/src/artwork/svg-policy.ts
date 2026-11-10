import { SaxesParser } from 'saxes';

const SVG = 'http://www.w3.org/2000/svg';
const XLINK = 'http://www.w3.org/1999/xlink';
const XML = 'http://www.w3.org/XML/1998/namespace';
const XMLNS = 'http://www.w3.org/2000/xmlns/';
/**
 * Editor metadata namespaces. Renderers ignore these elements and attributes, so they are skipped rather than
 * rejected. Any other foreign namespace (XHTML, XInclude, XSLT, unknown) is rejected because a renderer or browser
 * might act on it.
 */
const METADATA_NAMESPACES = [
  'http://www.inkscape.org/namespaces/inkscape',
  'http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd',
  'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  'http://creativecommons.org/ns#',
  'http://web.resource.org/cc/',
  'http://purl.org/dc/elements/1.1/',
  'http://purl.org/dc/terms/',
  'http://www.bohemiancoding.com/sketch/ns',
  'http://www.figma.com/figma/ns',
  'http://www.corel.com/coreldraw/odm/2003',
];
const METADATA_PREFIXES = ['http://ns.adobe.com/', 'http://www.serif.com/'];
const isMetadataNamespace = (uri: string) =>
  METADATA_NAMESPACES.includes(uri) || METADATA_PREFIXES.some((prefix) => uri.startsWith(prefix));

/** Static rendering subset. Animation, scripting, foreignObject, feImage, textPath, markers and links stay out. */
const ELEMENTS = new Set([
  'svg',
  'g',
  'defs',
  'symbol',
  'use',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'image',
  'clipPath',
  'mask',
  'pattern',
  'linearGradient',
  'radialGradient',
  'stop',
  'filter',
  'feGaussianBlur',
  'feOffset',
  'feColorMatrix',
  'feFlood',
  'feComposite',
  'feMerge',
  'feMergeNode',
  'feBlend',
  'feComponentTransfer',
  'feFuncR',
  'feFuncG',
  'feFuncB',
  'feFuncA',
  'style',
  'title',
  'desc',
  'metadata',
]);
const TEXT_ELEMENTS = new Set(['text', 'tspan', 'style', 'title', 'desc']);
/** Elements whose `href` is a local template/instance reference. `image` accepts only an embedded raster. */
const HREF_ELEMENTS = new Set(['use', 'linearGradient', 'radialGradient', 'pattern']);
const ATTRIBUTES = new Set(
  [
    // Structure and harmless document annotations.
    'id class style version baseProfile width height viewBox preserveAspectRatio x y transform href type media',
    'focusable role tabindex lang zoomAndPan',
    // Geometry.
    'x1 x2 y1 y2 cx cy r rx ry fx fy fr d points pathLength dx dy rotate textLength lengthAdjust',
    // Presentation.
    'fill fill-opacity fill-rule stroke stroke-width stroke-opacity stroke-linecap stroke-linejoin',
    'stroke-miterlimit stroke-dasharray stroke-dashoffset opacity clip-path clip-rule mask mask-type filter',
    'color display visibility overflow enable-background color-interpolation color-interpolation-filters',
    'color-rendering shape-rendering image-rendering text-rendering paint-order vector-effect mix-blend-mode',
    'isolation stop-color stop-opacity flood-color flood-opacity solid-color solid-opacity',
    'font font-family font-size font-size-adjust font-weight font-style font-variant font-stretch',
    'letter-spacing word-spacing text-anchor text-decoration dominant-baseline alignment-baseline',
    'baseline-shift writing-mode direction unicode-bidi white-space',
    // Paint servers, clipping, masking and filters.
    'gradientUnits gradientTransform spreadMethod offset clipPathUnits maskUnits maskContentUnits',
    'patternUnits patternContentUnits patternTransform filterUnits primitiveUnits in in2 result',
    'stdDeviation edgeMode values operator k1 k2 k3 k4 mode tableValues slope intercept amplitude exponent',
  ]
    .join(' ')
    .split(' '),
);
const CSS_FUNCTIONS = new Set([
  'url',
  'rgb',
  'rgba',
  'hsl',
  'hsla',
  'matrix',
  'translate',
  'translatex',
  'translatey',
  'scale',
  'scalex',
  'scaley',
  'rotate',
  'skewx',
  'skewy',
]);
/** Element and expansion budgets cover representative editor exports (10k+ shapes) with headroom. */
export const SVG_LIMITS = {
  elements: 20_000,
  depth: 32,
  attributes: 64,
  attributeValue: 1024 * 1024,
  css: 256 * 1024,
  text: 64 * 1024,
  references: 20_000,
  expansion: 100_000,
  // Each filtered element is rasterized separately; this bounds blur/composite work well inside the wall clock.
  filteredElements: 1_000,
  rasterPixels: 40_000_000,
  rasterEdge: 12_000,
} as const;

const reject = (reason: string): never => {
  throw new Error(reason);
};

/** Fragment-only `url(#id)` references; any other url(), at-rule, escape or function call is rejected. */
function cssReferences(css: string): string[] {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, ' ');
  if (/[@\\<]|\/\*|expression|behavior|-moz-binding|javascript:/i.test(source)) reject('SVG style unsupported');
  for (const call of source.matchAll(/([\w-]*)\s*\(/g))
    if (!CSS_FUNCTIONS.has((call[1] ?? '').toLowerCase())) reject('SVG style function unsupported');
  const refs: string[] = [];
  // Anchor at every url( so an unterminated url(… cannot slip past a closed-paren pattern.
  const fragment = /url\s*\(\s*(['"]?)#([A-Za-z_][\w.-]{0,127})\1\s*\)/iy;
  for (const url of source.matchAll(/url\s*\(/gi)) {
    fragment.lastIndex = url.index;
    refs.push(fragment.exec(source)?.[2] ?? reject('SVG external reference forbidden'));
  }
  return refs;
}

/** Rightmost compound selector, over-approximated by its first class, then id, then tag; otherwise universal. */
function selectorKey(selector: string): string {
  const compound = (
    selector
      .trim()
      .split(/[\s>+~]+/)
      .at(-1) ?? ''
  ).replace(/::?[\w-]+|\[[^\]]*\]/g, '');
  const cls = /\.([\w-]+)/.exec(compound)?.[1];
  if (cls) return `.${cls}`;
  const id = /#([\w.-]+)/.exec(compound)?.[1];
  if (id) return `#${id}`;
  const tag = /^[A-Za-z][\w-]*/.exec(compound)?.[0];
  return tag ? tag : '*';
}

/** Decoded pixels of an embedded `data:` PNG/JPEG; anything else is rejected. */
function embeddedRasterPixels(href: string): number {
  const match = /^data:image\/(png|jpe?g);base64,([A-Za-z0-9+/=\s]+)$/i.exec(href);
  if (!match?.[1] || !match[2]) return reject('SVG image must be an embedded PNG or JPEG');
  const bytes = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
  let width = 0;
  let height = 0;
  if (match[1].toLowerCase() === 'png') {
    if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || bytes.length < 24)
      reject('SVG embedded PNG invalid');
    width = bytes.readUInt32BE(16);
    height = bytes.readUInt32BE(20);
  } else {
    if (bytes[0] !== 255 || bytes[1] !== 216) reject('SVG embedded JPEG invalid');
    let offset = 2;
    while (offset + 9 <= bytes.length && !width) {
      if (bytes[offset] !== 255) reject('SVG embedded JPEG invalid');
      const marker = bytes[offset + 1] ?? 0;
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        height = bytes.readUInt16BE(offset + 5);
        width = bytes.readUInt16BE(offset + 7);
      } else offset += 2 + bytes.readUInt16BE(offset + 2);
    }
  }
  if (!width || !height || width > SVG_LIMITS.rasterEdge || height > SVG_LIMITS.rasterEdge)
    reject('SVG embedded raster limit');
  return width * height;
}

interface SvgNode {
  tag: string;
  classes: string[];
  id?: string;
  children: number[];
  refs: string[];
}

/**
 * Bounded static SVG policy. Executable, external and unbounded constructs are rejected; harmless editor metadata
 * and presentation attributes are ignored. The original bytes are never rewritten.
 */
export function assertSafeSvg(bytes: Uint8Array): void {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  // Only predefined XML entities and character references parse: there is no DTD to declare others.
  const parser = new SaxesParser({ xmlns: true });
  const nodes: SvgNode[] = [];
  const stack: number[] = [];
  const textAllowed: boolean[] = [];
  const metadataStack: boolean[] = [];
  const ids = new Map<string, number>();
  const cssRules = new Map<string, string[]>();
  let references = 0;
  let rasterPixels = 0;
  let textLength = 0;
  let css = '';
  const addRefs = (node: SvgNode, refs: string[]) => {
    references += refs.length;
    if (references > SVG_LIMITS.references) reject('SVG reference limit');
    node.refs.push(...refs);
  };
  parser.on('doctype', () => reject('SVG DTD forbidden'));
  parser.on('processinginstruction', () => reject('SVG processing instruction forbidden'));
  parser.on('error', (error) => {
    throw error;
  });
  parser.on('opentag', (tag) => {
    if (nodes.length >= SVG_LIMITS.elements || stack.length >= SVG_LIMITS.depth) reject('SVG resource limit');
    if (Object.keys(tag.attributes).length > SVG_LIMITS.attributes) reject('SVG resource limit');
    const metadata = tag.uri !== SVG && isMetadataNamespace(tag.uri);
    if (nodes.length === 0 ? tag.uri !== SVG || tag.local !== 'svg' : !metadata && tag.uri !== SVG)
      reject('Unsupported SVG namespace');
    if (!metadata && !ELEMENTS.has(tag.local)) reject('Unsupported SVG element');
    const index = nodes.length;
    const node: SvgNode = { tag: metadata ? '' : tag.local, classes: [], children: [], refs: [] };
    nodes.push(node);
    const parent = stack.at(-1);
    if (parent !== undefined) nodes[parent]?.children.push(index);
    stack.push(index);
    // Metadata subtrees (editor state, RDF, SVG <metadata>) may carry inert text; elements inside are still checked.
    const inMetadata = metadataStack.at(-1) === true || metadata || tag.local === 'metadata';
    metadataStack.push(inMetadata);
    textAllowed.push(inMetadata || TEXT_ELEMENTS.has(tag.local));
    for (const attr of Object.values(tag.attributes)) {
      if (attr.value.length > SVG_LIMITS.attributeValue && !(tag.local === 'image' && attr.local === 'href'))
        reject('SVG resource limit');
      if (attr.uri === XMLNS) continue; // Declarations are inert; element/attribute use is checked.
      if (attr.uri === XML) {
        if (attr.local !== 'space' && attr.local !== 'lang') reject('Unsupported SVG attribute');
        continue;
      }
      if (attr.uri !== '' && attr.uri !== XLINK) {
        if (!isMetadataNamespace(attr.uri)) reject('Unsupported SVG attribute');
        continue;
      }
      if (metadata) continue;
      if (attr.uri === XLINK && attr.local !== 'href') {
        if (attr.local !== 'title') reject('Unsupported SVG attribute');
        continue;
      }
      const name = attr.local;
      if (attr.uri === '' && !ATTRIBUTES.has(name) && !/^(?:data|aria)-[\w.-]+$/.test(name))
        reject('Unsupported SVG attribute');
      if (name === 'id') {
        node.id = attr.value;
        if (!ids.has(attr.value)) ids.set(attr.value, index);
      } else if (name === 'class') node.classes = attr.value.split(/\s+/).filter(Boolean);
      else if (name === 'href') {
        if (tag.local === 'image') {
          rasterPixels += embeddedRasterPixels(attr.value);
          if (rasterPixels > SVG_LIMITS.rasterPixels) reject('SVG embedded raster limit');
        } else if (!HREF_ELEMENTS.has(tag.local) || !/^#[A-Za-z_][\w.-]{0,127}$/.test(attr.value))
          reject('SVG external reference forbidden');
        else addRefs(node, [attr.value.slice(1)]);
      } else if (name === 'style') addRefs(node, cssReferences(attr.value));
      else if (/url\s*\(/i.test(attr.value)) addRefs(node, cssReferences(attr.value));
      else if (!name.startsWith('data-') && /(?:[a-z][\w+.-]*:\/\/|javascript:|data:)/i.test(attr.value))
        reject('SVG external content forbidden');
    }
    if (tag.local === 'image' && !metadata && !Object.values(tag.attributes).some((a) => a.local === 'href'))
      reject('SVG image must be an embedded PNG or JPEG');
  });
  const onText = (value: string) => {
    if (!value.trim()) return;
    if (!textAllowed.at(-1)) reject('SVG text unsupported');
    const current = nodes[stack.at(-1) ?? 0];
    if (current?.tag === 'style') css += value;
    else if (current?.tag === 'text' || current?.tag === 'tspan') {
      textLength += value.length;
      if (textLength > SVG_LIMITS.text) reject('SVG text limit');
    }
  };
  parser.on('text', onText);
  parser.on('cdata', onText);
  parser.on('closetag', () => {
    const closed = nodes[stack.pop() ?? 0];
    textAllowed.pop();
    metadataStack.pop();
    if (closed?.tag !== 'style') return;
    if (css.length > SVG_LIMITS.css) reject('SVG style limit');
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, ' ').split('}');
    if (rules.at(-1)?.trim()) reject('SVG style unsupported');
    for (const rule of rules.slice(0, -1)) {
      const [selectors, declarations, extra] = rule.split('{');
      if (selectors === undefined || declarations === undefined || extra !== undefined) reject('SVG style unsupported');
      const refs = cssReferences(`${selectors}{${declarations}`);
      if (!refs.length) continue;
      for (const selector of (selectors as string).split(',')) {
        const key = selectorKey(selector);
        cssRules.set(key, [...(cssRules.get(key) ?? []), ...refs]);
      }
    }
    css = '';
  });
  parser.write(text).close();
  if (!nodes.length) reject('Empty SVG');
  // Stylesheet references apply to every element their (over-approximated) selector may match.
  if (cssRules.size)
    for (const node of nodes) {
      if (!node.tag) continue;
      const keys = ['*', node.tag, ...node.classes.map((c) => `.${c}`), ...(node.id ? [`#${node.id}`] : [])];
      for (const key of keys) addRefs(node, cssRules.get(key) ?? []);
    }
  let expanded = 0;
  let filtered = 0;
  const ancestors = new Set<number>();
  const visit = (index: number, depth: number): void => {
    if (ancestors.has(index) || depth > SVG_LIMITS.depth || ++expanded > SVG_LIMITS.expansion)
      reject('SVG reference expansion limit');
    const node = nodes[index];
    if (!node) throw new Error('Invalid SVG structure');
    ancestors.add(index);
    for (const child of node.children) visit(child, depth + 1);
    for (const id of node.refs) {
      const target = ids.get(id);
      if (target === undefined) reject('Missing SVG reference');
      else {
        if (nodes[target]?.tag === 'filter' && ++filtered > SVG_LIMITS.filteredElements) reject('SVG filter limit');
        visit(target, depth + 1);
      }
    }
    ancestors.delete(index);
  };
  visit(0, 0);
}
