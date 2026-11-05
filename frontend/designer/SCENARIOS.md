# Configuring preview scenarios

Open [the scenario gallery](http://127.0.0.1:5173/scenarios). Each card offers an example with artwork and an empty design. The preview toolbar switches product and starting state without editing code. Hide controls removes the toolbar while keeping the current design, so the product gets the full viewport.

Switching product or starting state clears the local design, uploaded files, quantities, undo history and simulated cart. Browser Back/Forward restores the selected scenario, with a fresh design when crossing scenarios. This keeps one fictional store's data separate from another's.

Direct URLs work too:

- `/?scenario=colour-studio&lab=1` starts empty with the preview toolbar.
- `/?scenario=extended-sizes&lab=1&example=accordion` starts with sample artwork.
- `/?scenario=phone-case&lab=1` shows a generic non-garment product using a portrait schematic.
- `/?scenario=phone-case-options&lab=1` checks Model × Finish labels using the same phone-case schematic.
- `/?scenario=long-content&lab=1` opens the bilingual staff polo with preview controls.
- `/?scenario=minimal` shows the customer layout without preview controls.
- `/` remains the original six-colour product, starting empty.

## Add or change a product

Edit a JSON file in `src/scenarios/`, or copy one to a new filename. Set a unique `id`. The gallery discovers JSON files automatically. Run `npm run check:configs` to validate every file, then reload the preview. Changes to a fixture reset its in-memory design.

The minimal fixture is a complete example:

```json
{
  "id": "my-apron",
  "name": "My apron test",
  "description": "One colour, one size and one placement.",
  "storeName": "Example Store",
  "productName": "Cotton apron",
  "productDescription": "A cotton apron with a chest logo.",
  "basePrice": 2195,
  "currency": "EUR",
  "locale": "en-NL",
  "garment": "apron",
  "preview": "illustration",
  "maxQuantity": 999,
  "artworkLater": false,
  "sizes": [{ "id": "one-size", "label": "One size" }],
  "colors": [{ "id": "natural", "name": "Natural", "hex": "#e8ddc8" }],
  "views": [{ "id": "front", "label": "Front" }],
  "positions": [{
    "id": "chest",
    "name": "Upper chest",
    "view": "front",
    "x": 50,
    "y": 27,
    "width": 12,
    "price": 900,
    "dimensions": [12],
    "sizePrices": [0],
    "methodIds": ["print"]
  }],
  "methods": [{ "id": "print", "label": "Print", "surcharge": 0 }]
}
```

All prices are integer cents. IDs stay separate from visible labels and cannot contain spaces or colons. Every option group must contain at least one entry. Placements are limited to 32, matching the new Insignia buyer contract. Placement views, placement methods and colour availability must reference existing IDs. Invalid records report the failing field path.

`dimensions` lists widths in centimetres. `sizePrices` contains one additional price for each width in the same order. A placement's configured price, width price and selected method surcharge form its decoration price. The item price is the base price plus all selected placements. These are demo arithmetic rules, not the new Insignia's authoritative quoting integration. All sizes and colours share this item price; variant-specific prices and discounts are outside these fixtures.

`methodIds` belongs to each placement. One placement can be embroidery-only while another allows printing, embroidery and heat transfer. A method label can be changed without changing its ID. An optional `artworkLater` boolean on a placement overrides the product default, matching the new Insignia's per-placement artwork policy. This can make one position require artwork while allowing it later for another.

Every choice must declare `availableSizeIds`, for example `["s", "m", "l"]`. An empty list means no available combinations; an omitted list is invalid. Unavailable combinations remain visible as disabled quantity fields with an explanation.

## Images and geometry

Use `"preview": "photo"` and give each colour an `images` map covering every configured view:

```json
"images": {
  "front": "/shirt-black-front.jpg",
  "back": "/shirt-black-back.jpg"
}
```

Files live under `public/`, referenced from `/`. The existing shirt-photo fixtures use the Superfunny T-shirt images. The fictional hoodie, polo, apron and extended palette use SVG garment illustrations; they do not imply that matching photographs were obtained. Set `garment` to `tshirt`, `hoodie`, `polo` or `apron` when using an illustration preview. Illustration previews require a supported garment; photo previews can omit it. If a preview image is unavailable and no garment illustration was configured, the interface shows a neutral unavailable placeholder instead of substituting a shirt. Each view can set `illustration` to `front`, `back`, `left` or `right` for the demo silhouette. It defaults to `front`. View IDs are arbitrary stable identifiers and never choose the silhouette or infer a position. Photo-backed placement thumbnails use the same configured image as the preview. Both photo and illustration thumbnails generate their marker from the placement geometry, so no per-position icon is required.

The `phone-case` fixture uses a local 600 × 1000 SVG schematic. It is deliberately not a product photograph or calibrated manufacturing template. Its single rectangular movement area sits below the camera island and inside the case edges; the three size names are relative display labels, not measurements. This checks portrait image geometry and generic photo-backed configuration without adding phone-specific rendering rules.

The `phone-case-options` fixture uses the existing schematic to exercise explicit Finish/Model labels and a sparse option matrix. Its numeric variant IDs are synthetic test IDs, not records from a store. Only listed available cells can be selected. Named choices omit hex colours. `optionPresentation` supplies exact row/column `label` values and an explicit `swatch` or `named-choice` display mode; missing presentation uses generic Option text and named choices. The task tab always says Quantities. This example does not establish physical compatibility, calibration or production pricing. Real hosts use the validated Shopify variant matrix adapter and exact canonical IDs.

Placement `x`, `y` and `width` are percentages of the square preview image, not of a body measurement. `width` describes the visual width at the first configured physical dimension. Other widths scale proportionally. Keep photo alignment consistent across colours. These fixtures do not provide production calibration or constrain tall artwork to a manufacturing boundary.

## Adaptive controls

| Options | Behaviour |
| --- | --- |
| One colour | Static colour value, no colour picker or Add colour action |
| Multiple colours | Up to five desktop swatches, searchable overflow picker; phone picker at the right edge |
| One size | One labelled quantity field |
| Many sizes | Wrapping grid with unavailable variants disabled |
| One view | No view selector |
| Two or three views | Segmented view buttons |
| Four or more views | View dropdown |
| One remaining placement | Add directly without a redundant chooser |
| Multiple remaining placements | Grouped by view, with configured labels, derived thumbnails and prices |
| More than eight configured placements | Search and view filter; only the results scroll, keeping controls visible |
| All placements in use | Omit Add artwork |
| One method or width | Static value |
| Two to six artwork widths | Wrapping buttons, with four choices in a balanced 2×2 grid |
| More than six artwork widths | Native Width dropdown showing dimensions and size surcharges |
| Two methods | Native radio options |
| Three or more methods | Method dropdown |

The interface uses generic Artwork, Item and Per item labels. Product names still come from configuration. It remains an English prototype; supplying translated product labels is a layout check, not full interface translation.

The [scenario coverage matrix](SCENARIO-COVERAGE.md) documents the original product cases. The `long-content` fixture adds bilingual copy and long-label coverage.


## Variable content checks

The Sponsor hoodie in the gallery has 18 positions and view IDs such as `angle-a`. It exercises grouping, search, view filtering, long placement names and mixed artwork-later permissions. Used positions remain visible as Added and cannot be added twice. One remaining position still adds directly.

To check filenames, upload a valid PNG, JPG or SVG with a long name. Compact controls shorten the stem and retain the extension, while screen readers receive the complete name. Open the artwork chooser and expand Full filename for long names to read or copy the entire name without hover. Files retain their original names in state and are identified by generated IDs.

[UI-DATA-AUDIT.md](UI-DATA-AUDIT.md) separates store data, derived visuals, interface copy and production integration requirements.


The Many artwork widths product has twelve options from 6 to 28 cm. Larger option sets use a native dropdown instead of adding button rows. Selecting a width updates the preview scale, item price and review. Reopening a collapsed placement preserves the selection. Width values must be unique; the prototype currently offers numerical widths in centimetres rather than merchant-named sizes such as Small or A4.


## Colour search and larger palettes

The Large colour range scenario contains 60 fictional garment colours. The picker retains merchant ordering and supplies no inferred colour families or translated colour names. Search ignores case, accents and repeated spaces, and matches each search word regardless of order. For example, `creme rose` finds Crème rose and `blue royal` finds Royal blue.

Search uses a floating native label, kept visible on focus and after entering text. A clear button returns focus to the field. Opening the picker does not automatically focus search, so phone users can browse swatches before opening their keyboard. The current colour scrolls into view when reopening the picker. For more than twelve available colours, a total beside the title makes the larger palette apparent, and the dialog keeps a stable height as results change. Search and Close remain visible while the swatches scroll. Adding a quantity row excludes colours already used; its available palette shrinks accordingly.

Checks and captures are in `artifacts/colour-picker/`. Viewport checks include a short 390×560 window, but do not constitute physical phone keyboard testing.


## Long content and bilingual labels

The `long-content` fixture is a German-English staff polo shown with the front and back illustrations because the local photos do not include a matching polo. It has two colours, eight sizes, two views, four placements, mixed decoration methods, and twelve widths for the chest mark. Its 120-character product name, long colour and placement labels, 43-character method label, and 21-character unbroken size code exercise wrapping, truncation, and price alignment. One colour omits the largest size, and one placement requires artwork up front.

Use `/?scenario=long-content&lab=1` at a narrow phone width and desktop width. Browser viewport captures do not verify a physical phone keyboard or a native select popup; use a device for those checks.


## Quantities and correction

One configured tuple uses one quantity control. Small sets of up to six tuples with at most three column values use compact rows with editable minus/plus quantities. Larger short-labelled axes retain direct-entry grids; long column labels use a list, with search when there are more than twelve values. These are presentation heuristics shared by every product, not category detection or merchant settings. Actual unavailable tuples and absent combinations remain distinct. Filtering, focus and window resizing do not discard entered quantities. Retained unavailable selections must be removed explicitly before Review.

Empty fields represent zero items. Enter moves through enabled size fields, including across colour rows, and focuses Review after the final field. Values must be whole numbers from zero to the configured `maxQuantity`. Invalid values stay in the field, display an inline message and block review. They do not contribute to the shown total. Correcting, clearing or removing the field clears the issue; undoing removal restores its value and validation.

Review rows return directly to the corresponding placement while preserving artwork, settings and quantities. The selected placement receives keyboard focus. Placement search uses the same compact search field as colour search, with a clear action and Reset filters for an empty result.
