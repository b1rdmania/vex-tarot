// Copies the runtime art from art/ into public/retro/ and builds palette-matched
// pixel cards from public/cards/. Requires ImageMagick 7 (magick).
// Run after Codex changes anything in art/: node scripts/build-retro.mjs
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const art = join(root, "art");
const out = join(root, "public/retro");
// Card sizes: native 320x200 pixels x2 (retro.js CARD x CARD_RES), so cards keep
// finer detail than the room. xs/sm = table, lg = reveal.
const SIZES = { xs: [36, 60], sm: [44, 76], lg: [120, 206] };

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "rooms"), { recursive: true });
mkdirSync(join(out, "sprites"), { recursive: true });

copyFileSync(join(art, "palette.json"), join(out, "palette.json"));
copyFileSync(join(art, "idle-dialogue.json"), join(out, "idle-dialogue.json"));
copyFileSync(join(art, "sprites/vex-sheet.png"), join(out, "sprites/vex-sheet.png"));
copyFileSync(join(art, "sprites/vex-sheet.json"), join(out, "sprites/vex-sheet.json"));
const { candidates: rooms } = JSON.parse(readFileSync(join(art, "rooms/index.json")));
for (const room of rooms) {
  copyFileSync(join(art, "rooms", room.background), join(out, "rooms", room.background));
  copyFileSync(join(art, "rooms", room.layout), join(out, "rooms", room.layout));
}

const { colors } = JSON.parse(readFileSync(join(art, "palette.json")));
const ppm = join(out, ".palette.ppm");
writeFileSync(ppm, `P3\n${colors.length} 1\n255\n` + colors.map(c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16)).join(" ")).join("\n"));
const cards = readdirSync(join(root, "public/cards")).filter(f => f.endsWith(".jpg"));
for (const [size, [w, h]] of Object.entries(SIZES)) {
  mkdirSync(join(out, "cards", size), { recursive: true });
  for (const file of cards) {
    execFileSync("magick", [join(root, "public/cards", file), "-filter", "Box", "-resize", `${w}x${h}!`,
      "+dither", "-remap", ppm, join(out, "cards", size, file.replace(".jpg", ".png"))]);
  }
}
rmSync(ppm);
console.log(`retro: ${rooms.length} rooms, ${cards.length} cards x ${Object.keys(SIZES).length} sizes`);
