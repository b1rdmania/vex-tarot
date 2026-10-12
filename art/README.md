# Vex room candidates

Three room backgrounds for a live portrait comparison. No room is selected yet. These files add art only; they do not change the persona, renderer or kiosk.

## Start here

- `palette.json` is the single source of truth: 32 sRGB hex colours, in fixed order.
- `rooms/index.json` lists the three candidates and their asset paths.
- Each `rooms/<id>.png` is the finished **320×200** background.
- Each `rooms/<id>.json` describes its overlay rectangles in native pixels.
- Each `rooms/<id>.laptop.png` is a **1440×900** composition mockup: a **1280×800** scene at exactly **×4**, with **80 px** side margins and **50 px** top/bottom margins.
- Each `rooms/<id>.layout.png` is an optional ×4 rectangle guide: gold = face, green = table, pink = speech, slate = controls.
- `idle-dialogue.json` contains six short Vex lines. All fit on one row at a six-pixel glyph advance.

The native backgrounds leave the face, speech and controls areas empty. The mockups add one sample line and the three control labels. Mockup controls are not interactive. No static character has been baked into the rooms: use the moving face test before choosing.

## Candidates

| ID | Composition | Face opening | Card safe area |
| --- | --- | --- | --- |
| `01-velvet-alcove` | Central gilt mirror, purple curtains, dead bouquet and overdue invoice to the left | x128, y41, 64×76 | x65, y136, 190×30 |
| `02-corner-booth` | Mirror to the left; bottle-green drawers, lamp, dead flowers and paperwork to the right | x60, y45, 64×76 | x55, y141, 180×28 |
| `03-attic-window` | Mirror to the right; cool window light, wilted flowers and books to the left | x224, y39, 64×76 | x82, y140, 174×29 |

The identical 64×76 portrait openings let the face test compare composition without also changing crop size. Start with the same head-and-shoulders framing in all three. Adjust lighting to the room: balanced warm light for the alcove, warm light from the right for the booth, cool left/warm right for the attic.

## Placement contract

Load the room JSON, its `background`, and its `palette` relative to the JSON's location. Use `rects.face`, `rects.table`, `rects.speech` and `rects.controls`. Use `safeAreas.cards` for unobstructed card placement; the wider table rectangle includes the cloth border. Use `controlItems` for labels and hit targets.

Coordinates use a top-left origin. `x` and `y` are inclusive. `x + width` and `y + height` are exclusive. Pixel aspect ratio is 1. Do not apply a 4:3 correction. Map input coordinates through the same scale and letterbox offsets as the scene.

Render in this order:

1. Native room background.
2. Live portrait, clipped to `rects.face`. The gilt frame is already in the background, outside this rectangle. Its empty glass uses palette index 0.
3. Cards inside `safeAreas.cards`.
4. Dialogue in `rects.speech`.
5. Controls in `rects.controls`.

Use nearest-neighbour scaling after composition. The supplied mockups are ×4. A 1366×768 viewport cannot fit a 1280×800 scene: use ×3 there rather than cropping or distorting the room. The runtime can select the largest whole-number scale that fits its viewport.

The table is sized for the next one-card sample and small spread thumbnails. Enlarged card inspection can use a separate overlay; do not enlarge every card into the portrait or speech area. Longer live dialogue will need paging or short chunks. The one-line guarantee applies to the six supplied idle lines, not arbitrary model speech.

## Palette roles

Use the indices below to select from `palette.json`; do not keep a second colour list in the renderer.

- 0–7: near-black, purple shadows, velvet and lilac highlights. Index 0 is also the matte and letterbox; index 7 is the sample dialogue.
- 8–13: bottle greens and muted green highlights.
- 14–17: cool slate and window light.
- 18–21: plum, rose and faded red.
- 22–27: amber, brass and candlelight.
- 28–31: aged wood, dull gold, parchment and bone.

Dither is off. Every pixel in the finished backgrounds and mockups belongs to this palette. The source images are retained for reproduction and are **not** runtime assets or palette-compliant exports.

## Production and cleanup

The source room images were generated with the built-in image-generation tool. The exact prompts are in `prompts/`. They describe original VGA adventure-game rooms without named game references, characters or borrowed jokes. The persona is unchanged.

The finishing script reduces each source to 320×200, quantises to the shared palette without dithering, then applies hand-specified native-pixel edits:

- square, uniform face openings with continuous gilt bevels;
- quiet speech bands and a clean control strip;
- simplified cloth silhouettes and uncluttered card safe areas;
- a small readable overdue stamp on each invoice;
- native-grid lettering for mockups, followed by exact ×4 scaling.

The final quantisation prevents drawing operations from introducing extra colours. The mockup font is a small original bitmap alphabet in the script; it is not a runtime font requirement.

Rebuild with Node and ImageMagick 7 installed:

```sh
node art/scripts/build.mjs
node art/scripts/verify.mjs
```

The checker validates sizes, palette membership, clear face openings, rectangle bounds and non-overlap, single-line idle text, exact ×4 pixel blocks, letterboxing, and changes restricted to UI rectangles in the mockups. Intermediate files go to the ignored `art/.build/` directory.

## Next check

Put the same moving face into each room using its JSON. Check head size, jaw/shoulder crop, lighting, mouth readability and visual separation from the card table at real laptop scale. Then choose one room for a complete sample scene with one card, dialogue and real controls. The video comparison has not been run as part of this art delivery.
