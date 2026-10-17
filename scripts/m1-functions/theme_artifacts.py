"""Enumerate and compare the complete flat storefront/theme runtime for CI."""
import re
from pathlib import Path


def collect_theme_artifacts(root: Path) -> list[str]:
    build = root / 'apps/storefront/dist'
    theme = root / 'extensions/insignia-theme/assets'
    groups = []
    for directory in (build, theme):
        files = {}
        for path in directory.iterdir():
            if not re.fullmatch(r'insignia-[A-Za-z0-9_.-]+\.(?:js|css)', path.name):
                continue
            if path.is_symlink() or not path.is_file() or path.stat().st_size == 0:
                raise ValueError('theme artifact must be a nonempty regular file')
            files[path.name] = path
        if not {'insignia-storefront.js', 'insignia-element.js'} <= files.keys():
            raise ValueError('current build is missing its bootstrap or element')
        groups.append(files)
    for name, source in groups[0].items():
        target = groups[1].get(name)
        if target is None or target.read_bytes() != source.read_bytes():
            raise ValueError(f'theme asset differs from current build: {name}')
    return sorted(str(path.relative_to(root)) for files in groups for path in files.values())
