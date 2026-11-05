# Local variant-photo fixtures

These twelve unmodified JPEG files are copied from the existing customer designer prototype at `/Users/pc/Development/Insignia/designer-prototype/public/shirt-{black,white,navy}-{front,back,left,right}.jpg`.

They exercise the same actual garment photography already used by that prototype. The local editor scenarios synthesize colour/size and Colour + Fit assignments; they do not import store inventory, assert different fit photography or change Shopify media. Larger palettes use explicit missing-image states rather than tinting these photos.

The loopback preview serves the exact filenames through its existing reserved HTTPS demo origin and service worker. No production renderer URL restrictions are relaxed.
