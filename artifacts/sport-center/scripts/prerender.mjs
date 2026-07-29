#!/usr/bin/env node
/**
 * prerender.mjs — Static HTML pre-rendering for Sport Center SPA
 *
 * Run automatically after `vite build`.
 * Generates dist/public/{route}/index.html for each public route
 * with unique SEO metadata baked into raw HTML so non-JS crawlers
 * (WhatsApp, Telegram, Facebook, Googlebot) see unique tags per page.
 *
 * Strategy:
 *  1. Read the built dist/public/index.html
 *  2. Strip the generic SEO tags that Vite baked from index.html
 *  3. For each route, inject route-specific tags after <meta viewport>
 *  4. Write to dist/public/{route}/index.html
 *
 * Usage: node scripts/prerender.mjs
 * Env:   VITE_PUBLIC_URL — canonical base URL (default: https://sc.travelintrips.co.id)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, '../dist/public');

const BASE_URL = (process.env.VITE_PUBLIC_URL ?? 'https://sc.travelintrips.co.id').replace(/\/$/, '');
const OG_IMAGE = `${BASE_URL}/opengraph.jpg`;
const ROBOTS = 'index,follow,max-snippet:-1,max-image-preview:large,max-video-preview:-1';
const SITE_NAME = 'Sport Center Soekarno-Hatta';

const ROUTES = [
  {
    path: '/',
    title: 'Sport Center Soekarno-Hatta | Booking Lapangan Olahraga',
    description: 'Pusat olahraga premium di kawasan Bandara Soekarno-Hatta. Booking lapangan futsal, basket, badminton, dan gym secara online 24/7.',
  },
  {
    path: '/facilities',
    title: 'Fasilitas Olahraga | Sport Center Soekarno-Hatta',
    description: 'Temukan fasilitas olahraga terlengkap di Sport Center Soekarno-Hatta. Lapangan futsal, basket, badminton, gym, dan banyak lagi — tersedia untuk booking online.',
  },
  {
    path: '/promos',
    title: 'Promo & Penawaran Spesial | Sport Center Soekarno-Hatta',
    description: 'Dapatkan promo dan diskon terbaik untuk booking lapangan olahraga di Sport Center Soekarno-Hatta. Penawaran terbatas, segera manfaatkan!',
  },
  {
    path: '/membership',
    title: 'Keanggotaan Member Gym | Sport Center Soekarno-Hatta',
    description: 'Bergabunglah sebagai member Sport Center Soekarno-Hatta dan nikmati berbagai keuntungan eksklusif, diskon booking, dan akses prioritas ke fasilitas gym premium.',
  },
  {
    path: '/contact',
    title: 'Hubungi Kami | Sport Center Soekarno-Hatta',
    description: 'Hubungi Sport Center Soekarno-Hatta untuk informasi booking, keanggotaan, atau layanan lainnya. Kami siap membantu Anda kapan saja.',
  },
  {
    path: '/privacy',
    title: 'Kebijakan Privasi | Sport Center Soekarno-Hatta',
    description: 'Baca kebijakan privasi Sport Center Soekarno-Hatta untuk memahami bagaimana kami mengumpulkan, menggunakan, dan melindungi data pribadi Anda.',
  },
  {
    path: '/terms',
    title: 'Syarat & Ketentuan | Sport Center Soekarno-Hatta',
    description: 'Syarat dan ketentuan penggunaan layanan Sport Center Soekarno-Hatta. Harap baca dengan seksama sebelum menggunakan layanan pemesanan lapangan kami.',
  },
];

const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

function buildSeoBlock(route) {
  const url = BASE_URL ? `${BASE_URL}${route.path}` : '';
  const lines = [
    `    <title>${esc(route.title)}</title>`,
    `    <meta name="description" content="${esc(route.description)}" />`,
    `    <meta name="robots" content="${ROBOTS}" />`,
    url ? `    <link rel="canonical" href="${url}" />` : null,
    `    <meta property="og:type" content="website" />`,
    `    <meta property="og:site_name" content="${esc(SITE_NAME)}" />`,
    `    <meta property="og:title" content="${esc(route.title)}" />`,
    `    <meta property="og:description" content="${esc(route.description)}" />`,
    url ? `    <meta property="og:url" content="${url}" />` : null,
    `    <meta property="og:image" content="${OG_IMAGE}" />`,
    `    <meta property="og:image:width" content="1200" />`,
    `    <meta property="og:image:height" content="630" />`,
    `    <meta property="og:locale" content="id_ID" />`,
    `    <meta name="twitter:card" content="summary_large_image" />`,
    `    <meta name="twitter:title" content="${esc(route.title)}" />`,
    `    <meta name="twitter:description" content="${esc(route.description)}" />`,
    `    <meta name="twitter:image" content="${OG_IMAGE}" />`,
  ];
  return lines.filter(Boolean).join('\n');
}

function stripGenericSeoTags(html) {
  return html
    .replace(/[ \t]*<title>[^<]*<\/title>\n?/g, '')
    .replace(/[ \t]*<meta\s+name="description"[^>]*\/?>\n?/g, '')
    .replace(/[ \t]*<meta\s+name="robots"[^>]*\/?>\n?/g, '')
    .replace(/[ \t]*<meta\s+property="og:[^"]*"[^>]*\/?>\n?/g, '')
    .replace(/[ \t]*<meta\s+name="twitter:[^"]*"[^>]*\/?>\n?/g, '')
    .replace(/[ \t]*<link\s+rel="canonical"[^>]*\/?>\n?/g, '');
}

const baseHtml = readFileSync(join(distDir, 'index.html'), 'utf-8');
const stripped = stripGenericSeoTags(baseHtml);

const VIEWPORT_RE = /(<meta\s+name="viewport"[^>]*\/>)/;
if (!VIEWPORT_RE.test(stripped)) {
  console.error('❌  Could not find <meta name="viewport"> in built HTML. Aborting.');
  process.exit(1);
}

console.log('\nPhase 2 Prerender — generating unique HTML per route\n');

let written = 0;
for (const route of ROUTES) {
  const block = buildSeoBlock(route);
  const html = stripped.replace(VIEWPORT_RE, `$1\n${block}`);

  let dest;
  if (route.path === '/') {
    dest = join(distDir, 'index.html');
    writeFileSync(dest, html, 'utf-8');
  } else {
    const dir = join(distDir, route.path.replace(/^\//, ''));
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    dest = join(dir, 'index.html');
    writeFileSync(dest, html, 'utf-8');
  }

  const relDest = `dist/public${route.path === '/' ? '/index.html' : route.path + '/index.html'}`;
  console.log(`  ✓  ${route.path.padEnd(14)} → ${relDest}`);
  written++;
}

console.log(`\n✅  ${written} routes written with unique metadata`);

if (!process.env.VITE_PUBLIC_URL) {
  console.warn('\n⚠   VITE_PUBLIC_URL is not set — using default https://sc.travelintrips.co.id');
}
