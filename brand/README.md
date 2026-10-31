# Brand assets

The Bifrozz mark — the rainbow bridge with its star. Bifrozz is a Boelabs product, but it carries
its own mark: the Boelabs isotipo belongs to Boelabs, not to one of the things Boelabs builds.

| File | What it is |
|---|---|
| `bifrozz-logo.svg` | The logotype — mark and wordmark — in `currentColor`, cropped to the artwork. The same paths both apps inline as `BifrozzLogo`, wherever the product is named. |
| `bifrozz-logo-light.png` | The logotype in black, 800px wide. The README's heading on light backgrounds. |
| `bifrozz-logo-dark.png` | The same logotype in white, for dark backgrounds. |
| `bifrozz-mark.svg` | The mark alone in `currentColor`, cropped to the artwork. The source of each app's `icon.svg`. |
| `bifrozz-mark-light.png` | Black ink on transparency, 512px wide. For light backgrounds. |
| `bifrozz-mark-dark.png` | The same mark in white. For dark backgrounds. |
| `bifrozz-isotype-source.svg` | The designer's export, the source of truth. Only a `<title>` was added, for the accessibility gate. |

## One colour, two themes

The mark is a single colour on transparency, which is what makes every surface below able to theme
it without a second file: in the apps it is inline SVG filled with `currentColor`, so it takes the
colour of the text around it; in a browser tab the SVG carries its own `prefers-color-scheme` rule;
and the README picks a file with `<picture>` because GitHub has no CSS to lend it.

Anything the operating system composites — an installed icon, an iOS home screen — uses the brand
kit's app icon instead: the white mark on its dark gradient tile. The manifest icons are the kit's
rounded tiles as delivered; `apple-icon.png` is the kit's full-bleed square, because iOS applies its
own mask and paints transparent corners black. `favicon.ico` is the kit's own.

## Regenerating

`bifrozz-mark.svg` is the source export's eight paths at two decimals (svgo, `floatPrecision: 2`),
with the viewBox cropped from the original 1455 square to the artwork's own 1444 × 957. Rasterised
at native resolution against the source, no pixel moves by more than 25 of 255 grey levels; one
decimal moves edges visibly, so two is the floor. Each app's `icon.svg` centres those paths in a
padded square with the theme rule added.

`bifrozz-logo.svg` is the kit's horizontal black logo made the same way: its C2PA metadata dropped,
the viewBox cropped from 1756 × 606 to the artwork's 1650 × 331, and the paths at two decimals (no
pixel moves by more than 18 of 255). The apps' `BifrozzLogo` components carry the same paths.

An `<img>` resolves `currentColor` to black, which is what the PNGs are rendered from.

Redo them only from the source export, and check the result the same way.
