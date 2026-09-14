# Brand assets

The Bifrost mark — the rainbow bridge with its star. Bifrost is a Boelabs product, but it carries
its own mark: the Boelabs isotipo belongs to Boelabs, not to one of the things Boelabs builds.

| File | What it is |
|---|---|
| `bifrost-mark.svg` | The mark, cropped to the artwork. What both apps serve as `logo.svg`. |
| `bifrost-mark-light.png` | Black ink on transparency, 512px. For light backgrounds. |
| `bifrost-mark-dark.png` | The same mark in white. For dark backgrounds. |
| `bifrost-isotipo-source.svg` | The designer's export, the source of truth. Only a `<title>` was added, for the accessibility gate. |

## One colour, two themes

The mark is a single colour on transparency, which is what makes every surface below able to theme
it without a second file: in the apps the ink is black as drawn and inverted on a dark background
(`dark:invert`), in a browser tab the SVG carries its own `prefers-color-scheme` rule, and the README
picks a file with `<picture>` because GitHub has no CSS to lend it.

Anything the operating system composites — an installed icon, an iOS home screen — gets a white
ground baked in instead. A transparent black mark on those is a black square, because iOS paints
transparency onto black.

## Regenerating

`bifrost-mark.svg` is `bifrost-isotipo-source.svg` with the group transform folded into the path,
the coordinates written as the integers they already were, and the viewBox cropped from the original
1067-square (which was two thirds empty) to the artwork's own 1063 × 677. It is the same shape to
the pixel, at a quarter of the bytes — verified by rasterising both at native resolution and
diffing, not by eye.

Redo it only from the source export, and check the result the same way.
