import { island } from './island.js';

export const SIZE = 3000;
export const COOLDOWN = 27_000;
export const PIXELS_PER_TURN = 7;
// Keep each stored index in its original color family when revising swatches.
export const palette = [
  ['White', '#ffffff'], ['Silver', '#c0c0c0'], ['Gray', '#808080'], ['Black', '#000000'],
  ['Maroon', '#800000'], ['Red', '#ff0000'], ['Vermilion', '#ff3300'], ['Orange', '#ff9900'],
  ['Olive', '#808000'], ['Gold', '#ffcc00'], ['Yellow', '#ffff00'], ['Lemon', '#ffff66'],
  ['Forest', '#003300'], ['Green', '#008000'], ['Grass', '#33cc00'], ['Lime', '#00ff00'],
  ['Chartreuse', '#99ff00'], ['Teal', '#008080'], ['Spring green', '#00cc99'], ['Aqua', '#00ffff'],
  ['Navy', '#000080'], ['Blue', '#0000ff'], ['Azure', '#0066ff'], ['Sky', '#00ccff'],
  ['Ice', '#99ffff'], ['Purple', '#800080'], ['Violet', '#9933ff'], ['Fuchsia', '#ff00ff'],
  ['Umber', '#663300'], ['Sienna', '#993300'], ['Copper', '#cc6600'], ['Amber', '#ff9933']
];
export function initialRow(y) {
  const row = new Uint8Array(SIZE);
  const pixels = island.rows[y - island.y];
  if (pixels) {
    for (let x = 0; x < pixels.length; x++) row[island.x + x] = parseInt(pixels[x], 32);
  }
  return row;
}
