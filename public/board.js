import { island } from './island.js';

export const SIZE = 1000;
export const COOLDOWN = 30_000;
// Palette indices are part of the stored artwork. Append new colors at the end.
export const palette = [
  ['White', '#ffffff'], ['Silver', '#c2c8ca'], ['Slate', '#798896'], ['Ink', '#263043'],
  ['Wine', '#82374b'], ['Red', '#d74146'], ['Coral', '#fc7664'], ['Peach', '#ffbd90'],
  ['Ochre', '#bc832d'], ['Gold', '#f4ae32'], ['Sunshine', '#ffe269'], ['Cream', '#fff3c4'],
  ['Pine', '#295b45'], ['Leaf', '#468347'], ['Grass', '#70ad48'], ['Lime', '#aad45a'],
  ['Mint', '#d5e985'], ['Teal', '#328a86'], ['Jade', '#6fc8a5'], ['Ice', '#a9e4dc'],
  ['Navy', '#34527c'], ['Blue', '#386fc1'], ['Lake', '#559dd5'], ['Sky', '#96cfea'],
  ['Mist', '#d6ecf1'], ['Violet', '#7355a1'], ['Lilac', '#b094ce'], ['Pink', '#f0a3c3'],
  ['Earth', '#664735'], ['Bark', '#916342'], ['Clay', '#b98857'], ['Sand', '#dfb781']
];
export function initialRow(y) {
  const row = new Uint8Array(SIZE);
  const pixels = island.rows[y - island.y];
  if (pixels) {
    for (let x = 0; x < pixels.length; x++) row[island.x + x] = parseInt(pixels[x], 32);
  }
  return row;
}
