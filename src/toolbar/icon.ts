import type { ProviderState, Settings } from '../providers/types';
import { selectQuota } from './badge';
export function toolbarRows(providers: ProviderState, settings: Settings, now = Date.now()) {
  return (['claude', 'codex'] as const).map((id) => {
    const selected = selectQuota(providers, { ...settings, badge: id }, now);
    return {
      id,
      label: id === 'claude' ? 'C' : 'X',
      text: selected ? String(Math.round(selected.q[settings.display])) : '-',
      remaining: selected?.q.remaining ?? null,
    };
  });
}
// Full-height 5×7 numerals. Two-digit values use most of the icon width;
// three-digit 100 uses a compact 3×7 face so no pixels are clipped.
const digits: Record<string, string[]> = {
  '0': ['01110', '11011', '11011', '11011', '11011', '11011', '01110'],
  '1': ['00110', '01110', '00110', '00110', '00110', '00110', '11111'],
  '2': ['11110', '00011', '00011', '01110', '11000', '11000', '11111'],
  '3': ['11110', '00011', '00011', '01110', '00011', '00011', '11110'],
  '4': ['11011', '11011', '11011', '11111', '00011', '00011', '00011'],
  '5': ['11111', '11000', '11000', '11110', '00011', '00011', '11110'],
  '6': ['01110', '11000', '11000', '11110', '11011', '11011', '01110'],
  '7': ['11111', '00011', '00011', '00110', '01100', '01100', '01100'],
  '8': ['01110', '11011', '11011', '01110', '11011', '11011', '01110'],
  '9': ['01110', '11011', '11011', '01111', '00011', '00011', '01110'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
};
const compact: Record<string, string[]> = {
  '1': ['010', '110', '010', '010', '010', '010', '111'],
  '0': ['111', '101', '101', '101', '101', '101', '111'],
};
export function dualIcon(providers: ProviderState, settings: Settings, size: number): ImageData {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const c = canvas.getContext('2d')!;
  c.scale(size / 16, size / 16);
  for (const [i, row] of toolbarRows(providers, settings).entries()) {
    const y = i * 8;
    const r = row.remaining;
    c.fillStyle = r === null ? '#465057' : r > 50 ? '#16654c' : r >= 20 ? '#f5c34d' : '#973b4a';
    c.fillRect(0, y, 16, 8);
    c.fillStyle = r !== null && r >= 20 && r <= 50 ? '#161a20' : '#ffffff';
    const font = row.text.length === 3 ? compact : digits;
    const width = row.text.length === 3 ? 3 : 5;
    let x = Math.floor((16 - (row.text.length * (width + 1) - 1)) / 2);
    for (const letter of row.text) {
      const glyph = font[letter] || digits['-'];
      for (let gy = 0; gy < 7; gy++)
        for (let gx = 0; gx < width; gx++)
          if (glyph[gy][gx] === '1') c.fillRect(x + gx, y + gy, 1, 1);
      x += width + 1;
    }
  }
  return c.getImageData(0, 0, size, size);
}
