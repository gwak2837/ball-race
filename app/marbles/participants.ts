export interface Participant {
  id: string;
  name: string;
  colorHex: string;
  initials: string;
}

function stableHash32(input: string): number {
  // FNV-1a 32-bit
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function hslToHex(h: number, s: number, l: number): string {
  // h,s,l: [0..360), [0..100], [0..100]
  const sat = s / 100;
  const light = l / 100;
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp >= 0 && hp < 1) [r, g, b] = [c, x, 0];
  else if (hp >= 1 && hp < 2) [r, g, b] = [x, c, 0];
  else if (hp >= 2 && hp < 3) [r, g, b] = [0, c, x];
  else if (hp >= 3 && hp < 4) [r, g, b] = [0, x, c];
  else if (hp >= 4 && hp < 5) [r, g, b] = [x, 0, c];
  else if (hp >= 5 && hp < 6) [r, g, b] = [c, 0, x];
  const m = light - c / 2;
  const rr = Math.round((r + m) * 255);
  const gg = Math.round((g + m) * 255);
  const bb = Math.round((b + m) * 255);
  return `#${rr.toString(16).padStart(2, '0')}${gg.toString(16).padStart(2, '0')}${bb.toString(16).padStart(2, '0')}`;
}

function colorFromName(name: string): string {
  const hash = stableHash32(name.trim().toLowerCase());
  const hue = hash % 360;
  // Slightly restrained palette for readability on dark/light.
  return hslToHex(hue, 72, 52);
}

function graphemes2(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '??';
  // Prefer Intl.Segmenter if available (handles emoji/ZWJ sequences).
  const Segmenter = (Intl as unknown as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  if (Segmenter) {
    const seg = new Segmenter('ko', { granularity: 'grapheme' });
    const out: string[] = [];
    for (const s of seg.segment(trimmed)) {
      out.push(s.segment);
      if (out.length >= 2) break;
    }
    return out.join('');
  }
  return Array.from(trimmed).slice(0, 2).join('');
}

export function parseNamesFromTextarea(value: string): string[] {
  return value
    .split(/\r?\n/g)
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

export function makeAutoNames(count: number): string[] {
  const safeCount = Math.max(1, Math.min(1000, count));
  return Array.from({ length: safeCount }, (_, i) => {
    return `시청자${String(i + 1).padStart(4, '0')}`;
  });
}

export function buildParticipants(names: string[]): Participant[] {
  return names.map((raw, idx) => {
    const name = raw.trim() || `시청자${String(idx + 1).padStart(4, '0')}`;
    return {
      id: `${idx}-${stableHash32(name)}`,
      name,
      colorHex: colorFromName(name),
      initials: graphemes2(name),
    };
  });
}
