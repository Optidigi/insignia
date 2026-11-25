import assert from 'node:assert/strict';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
/** Bind the complete flat buyer runtime, including retained CDN chunks, not only its bootstrap. */
export function collectThemeArtifacts(root: string): string[] {
  const groups = [join(root, 'apps/storefront/dist'), join(root, 'extensions/insignia-theme/assets')].map(
    (directory) => {
      const files = new Map<string, string>();
      for (const name of readdirSync(directory)) {
        if (!/^insignia-[A-Za-z0-9_.-]+\.(?:js|css)$/.test(name)) continue;
        const path = join(directory, name),
          info = lstatSync(path);
        assert(
          !info.isSymbolicLink() && info.isFile() && info.size > 0,
          'theme artifact must be a nonempty regular file',
        );
        files.set(name, path);
      }
      assert(
        files.has('insignia-storefront.js') && files.has('insignia-element.js'),
        'current build is missing its bootstrap or element',
      );
      return files;
    },
  );
  const [build, theme] = groups;
  assert(build && theme);
  for (const [name, source] of build) {
    const destination = theme.get(name);
    assert(
      destination && readFileSync(destination).equals(readFileSync(source)),
      `theme asset differs from current build: ${name}`,
    );
  }
  return groups.flatMap((group) => [...group.values()].map((path) => relative(root, path))).sort();
}
