# Vex cartoon sprite

`vex-sheet.png` is a transparent 256×380 atlas. Every cell is 64×76 with identical alignment. Load the exact named rectangles and timings from `vex-sheet.json`. `vex-reactions-preview.png` shows composed expressions; `vex-sheet-preview.png` shows the atlas layers. Neither preview is a runtime atlas.

| Row | Cells, left to right |
| --- | --- |
| 0 | idle, breathe in, half blink, blink |
| 1 | eye roll, smirk, dramatic, unimpressed |
| 2 | closed mouth, slightly open, open, wide |
| 3 | resting smirk mouth; three unused transparent cells |
| 4 | hand rest (transparent), reach, turn, settle |

## Draw contract

1. Draw the room's clean `background` plate, not the composed `still`.
2. Copy the selected body cell to `rects.sprite.x, rects.sprite.y` at 64×76.
3. Copy the selected mouth cell to exactly the same destination. Its padding already positions the lips. `mouthAnchor` describes the lip location; it is not an extra draw offset.
4. Draw cards, then the optional hand at `sprite.handOrigin`. The hand contact point is (29,54) within its cell; reposition its origin if the runtime moves the card.
5. Draw dialogue and controls, then upscale the entire scene with nearest-neighbour sampling.

Redraw the clean plate before each changed frame, or restore every affected rectangle. Drawing a transparent mouth over the previous mouth without restoring the body leaves old pixels behind. The static `vex-idle.png` combines idle body and closed mouth for previews.

## Voice and expression

Select the four ordered mouth frames from smoothed **Vex output voice** volume, not the microphone input. Close the mouth on silence and when speech stops. Tune amplitude thresholds against actual output audio; none have been validated in this art delivery. A short hold and different thresholds for opening/closing can reduce chatter.

Body reactions do not change mouth registration: the voice can continue through any expression. Use the extra smirk mouth only as a silent resting expression, then return to the amplitude-driven mouth while speaking. Breathing changes the chest, leaving the head fixed. The blink sequence uses neutral eyes; defer it while a reaction is held so it does not interrupt that expression. Restore idle after a one-shot reaction or blink.

The dealing hand is an optional, stylised independent overlay. Time the card reveal to `hand/turn`; the atlas does not animate or replace the card artwork. Its placement and timing need a browser check with the real card.

## Build and validation

Run `node art/scripts/build.mjs` to rebuild the sprite and all room compositions. Run `node art/scripts/verify.mjs` for the full art check, or `node art/scripts/verify-sprites.mjs` for the atlas alone. All opaque sprite pixels use `art/palette.json`; alpha is either 0 or 255.

Source artwork was generated with the built-in image tool, then quantised and edited at native pixel coordinates. The prompt and source are retained under `art/prompts/` and `art/sources/`. Runtime assets have no additional palette dependency.
