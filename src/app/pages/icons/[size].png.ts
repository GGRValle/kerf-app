import type { APIRoute } from 'astro';
import sharp from 'sharp';

// PWA icons — SSR-rendered PNGs (Goal B PR-1). Font-free geometric mark so
// sharp/resvg renders deterministically (no system-font dependency): the
// Right Hand gold field on the app's dark ground, with a dark right-angle
// motif. Maskable variant pads the safe zone so platform masks don't clip.
export const prerender = false;

const DARK = '#0A0D11';
const GOLD = '#C9A961';

function iconSvg(size: number, maskable: boolean): string {
  const pad = maskable ? Math.round(size * 0.16) : 0; // maskable safe zone
  const inner = size - pad * 2;
  const fieldRadius = maskable ? Math.round(inner * 0.18) : Math.round(size * 0.22);
  // Right-angle motif (the "Right Hand" corner), drawn with rects — no fonts.
  const stroke = Math.round(inner * 0.13);
  const m = pad + Math.round(inner * 0.30);
  const len = Math.round(inner * 0.40);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect width="${size}" height="${size}" fill="${DARK}"/>
    <rect x="${pad}" y="${pad}" width="${inner}" height="${inner}" rx="${fieldRadius}" fill="${GOLD}"/>
    <rect x="${m}" y="${m}" width="${stroke}" height="${len + stroke}" rx="${Math.round(stroke / 3)}" fill="${DARK}"/>
    <rect x="${m}" y="${m + len}" width="${len + stroke}" height="${stroke}" rx="${Math.round(stroke / 3)}" fill="${DARK}"/>
  </svg>`;
}

const SIZES: Record<string, { size: number; maskable: boolean }> = {
  '180': { size: 180, maskable: false },
  '192': { size: 192, maskable: false },
  '512': { size: 512, maskable: false },
  'maskable-512': { size: 512, maskable: true },
};

export const GET: APIRoute = async ({ params }) => {
  const spec = SIZES[params.size ?? ''];
  if (!spec) return new Response('not found', { status: 404 });
  const png = await sharp(Buffer.from(iconSvg(spec.size, spec.maskable))).png().toBuffer();
  return new Response(new Uint8Array(png), {
    headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' },
  });
};
