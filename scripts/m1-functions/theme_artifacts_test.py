import tempfile
import unittest
from pathlib import Path
from theme_artifacts import collect_theme_artifacts


class ThemeArtifacts(unittest.TestCase):
    def fixture(self, root):
        build = root / 'apps/storefront/dist'
        theme = root / 'extensions/insignia-theme/assets'
        build.mkdir(parents=True)
        theme.mkdir(parents=True)
        for name, value in [('insignia-storefront.js', b'import("./insignia-element.js")'), ('insignia-element.js', b'import("./insignia-customizer-hash.js")'), ('insignia-customizer-hash.js', b'export const actualCustomizer = true')]:
            (build / name).write_bytes(value)
            (theme / name).write_bytes(value)
        return build, theme

    def test_lazy_chunks_and_retained_assets_are_bound_not_just_bootstrap(self):
        with tempfile.TemporaryDirectory() as scratch:
            root = Path(scratch)
            build, theme = self.fixture(root)
            (theme / 'insignia-retained-hash.js').write_bytes(b'cached entry dependency')
            paths = collect_theme_artifacts(root)
            self.assertIn('apps/storefront/dist/insignia-customizer-hash.js', paths)
            self.assertIn('extensions/insignia-theme/assets/insignia-customizer-hash.js', paths)
            self.assertIn('extensions/insignia-theme/assets/insignia-retained-hash.js', paths)
            self.assertEqual(len(paths), 7)

    def test_missing_or_different_copied_chunk_rejects(self):
        with tempfile.TemporaryDirectory() as scratch:
            root = Path(scratch)
            _, theme = self.fixture(root)
            chunk = theme / 'insignia-customizer-hash.js'
            chunk.unlink()
            with self.assertRaisesRegex(ValueError, 'current build'):
                collect_theme_artifacts(root)
            chunk.write_bytes(b'different')
            with self.assertRaisesRegex(ValueError, 'current build'):
                collect_theme_artifacts(root)

    def test_asset_symlink_rejects(self):
        with tempfile.TemporaryDirectory() as scratch:
            root = Path(scratch)
            _, theme = self.fixture(root)
            (theme / 'insignia-alias.js').symlink_to('insignia-element.js')
            with self.assertRaisesRegex(ValueError, 'regular'):
                collect_theme_artifacts(root)


if __name__ == '__main__':
    unittest.main()
