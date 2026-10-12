import { SaxesParser } from 'saxes';

const SVG = 'http://www.w3.org/2000/svg';
const elements = new Set([
  'svg',
  'g',
  'defs',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'use',
  'symbol',
  'clipPath',
  'linearGradient',
  'radialGradient',
  'stop',
  'title',
  'desc',
]);
const attributes = new Set([
  'id',
  'width',
  'height',
  'viewBox',
  'preserveAspectRatio',
  'x',
  'y',
  'x1',
  'x2',
  'y1',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'd',
  'points',
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-dasharray',
  'stroke-dashoffset',
  'opacity',
  'transform',
  'clip-path',
  'clip-rule',
  'gradientUnits',
  'gradientTransform',
  'offset',
  'stop-color',
  'stop-opacity',
  'spreadMethod',
  'href',
]);
/** A deliberately small static SVG subset. Unsupported constructs are rejected, never rewritten. */
export function assertSafeSvg(bytes: Uint8Array): void {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (/[&]/.test(text)) throw new Error('SVG entities are unsupported');
  const parser = new SaxesParser({ xmlns: true });
  const nodes: Array<{ children: number[]; refs: string[] }> = [];
  const names: string[] = [];
  const stack: number[] = [];
  const ids = new Map<string, number>();
  let references = 0;
  parser.on('doctype', () => {
    throw new Error('SVG DTD forbidden');
  });
  parser.on('processinginstruction', () => {
    throw new Error('SVG processing instruction forbidden');
  });
  parser.on('error', (error) => {
    throw error;
  });
  parser.on('opentag', (tag) => {
    if (tag.uri !== SVG || !elements.has(tag.local) || (nodes.length === 0 && tag.local !== 'svg'))
      throw new Error('Unsupported SVG element');
    if (nodes.length >= 2048 || stack.length >= 32 || Object.keys(tag.attributes).length > 32)
      throw new Error('SVG resource limit');
    const index = nodes.length;
    const node = { children: [] as number[], refs: [] as string[] };
    nodes.push(node);
    const parentIndex = stack.at(-1);
    if (parentIndex !== undefined) {
      const parent = nodes[parentIndex];
      if (!parent) throw new Error('Invalid SVG structure');
      parent.children.push(index);
    }
    stack.push(index);
    names.push(tag.local);
    for (const attr of Object.values(tag.attributes)) {
      if (attr.uri === 'http://www.w3.org/2000/xmlns/') {
        if (attr.value !== SVG && attr.value !== 'http://www.w3.org/1999/xlink')
          throw new Error('Unsupported SVG namespace');
        continue;
      }
      if (
        !attributes.has(attr.local) ||
        (attr.uri !== '' && !(attr.local === 'href' && attr.uri === 'http://www.w3.org/1999/xlink')) ||
        attr.value.length > 131072
      )
        throw new Error('Unsupported SVG attribute');
      if (attr.local === 'id') {
        if (!/^[A-Za-z_][\w.-]{0,127}$/.test(attr.value) || ids.has(attr.value)) throw new Error('Invalid SVG id');
        ids.set(attr.value, index);
      }
      let reference: string | undefined;
      if (attr.local === 'href') {
        if (tag.local !== 'use' || !/^#[A-Za-z_][\w.-]{0,127}$/.test(attr.value))
          throw new Error('SVG external reference forbidden');
        reference = attr.value.slice(1);
      } else if (/url\s*\(/i.test(attr.value)) {
        const match = /^url\(#[A-Za-z_][\w.-]{0,127}\)$/.exec(attr.value);
        if (!match || !['fill', 'stroke', 'clip-path'].includes(attr.local))
          throw new Error('SVG external reference forbidden');
        reference = attr.value.slice(5, -1);
      } else if (/(?:https?:|file:|data:|@import|\\)/i.test(attr.value))
        throw new Error('SVG external content forbidden');
      if (reference) {
        if (++references > 64) throw new Error('SVG reference limit');
        node.refs.push(reference);
      }
    }
  });
  parser.on('closetag', () => {
    stack.pop();
    names.pop();
  });
  parser.on('text', (value) => {
    if (value.trim() && !['title', 'desc'].includes(names.at(-1) ?? '')) throw new Error('SVG text unsupported');
  });
  parser.on('cdata', () => {
    throw new Error('SVG CDATA unsupported');
  });
  parser.write(text).close();
  let expanded = 0;
  const visit = (index: number, ancestors: Set<number>, depth: number): void => {
    if (ancestors.has(index) || depth > 32 || ++expanded > 8192) throw new Error('SVG reference expansion limit');
    const next = new Set(ancestors);
    next.add(index);
    const node = nodes[index];
    if (!node) throw new Error('Invalid SVG structure');
    for (const child of node.children) visit(child, next, depth + 1);
    for (const id of node.refs) {
      const target = ids.get(id);
      if (target === undefined) throw new Error('Missing SVG reference');
      visit(target, next, depth + 1);
    }
  };
  if (!nodes.length) throw new Error('Empty SVG');
  visit(0, new Set(), 0);
}
