/**
 * prerender.mjs — Static HTML pre-rendering for Sport Center SPA
 *
 * Runs AFTER `vite build`. Reads dist/public/index.html (the built template),
 * injects route-specific title / description / canonical / og:* / twitter:*
 * for each public route, and writes dist/public/{route}/index.html.
 *
 * express.static in app.ts will serve these files directly (directory index),
 * so each route gets unique meta tags for crawlers and social previews.
 *
 * Usage: node scripts/prerender.mjs
 * Env:   VITE_PUBLIC_URL — canonical base URL (default: https://sc.travelintrips.co.id)
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, "../dist/public");
const BASE_URL =
  process.env.VITE_PUBLIC_URL ?? "https://sc.travelintrips.co.id";
const DEFAULT_IMAGE = `${BASE_URL}/opengraph.jpg`;

/** @type {{ path: string; title: string; description: string; image?: string }[]} */
const routes = [
  {
    path: "/",
    title: "Sport Center Soekarno-Hatta | Booking Lapangan Olahraga",
    description:
      "Pusat olahraga premium di kawasan Bandara Soekarno-Hatta. Booking lapangan futsal, basket, badminton, dan gym secara online 24/7.",
  },
  {
    path: "/facilities",
    title: "Fasilitas Olahraga | Sport Center Soekarno-Hatta",
    description:
      "Temukan fasilitas olahraga terlengkap di Sport Center Soekarno-Hatta. Lapangan futsal, basket, badminton, gym, dan banyak lagi — tersedia untuk booking online.",
  },
  {
    path: "/promos",
    title: "Promo & Penawaran Spesial | Sport Center Soekarno-Hatta",
    description:
      "Dapatkan promo dan diskon terbaik untuk booking lapangan olahraga di Sport Center Soekarno-Hatta. Penawaran terbatas, segera manfaatkan!",
  },
  {
    path: "/membership",
    title: "Keanggotaan Member Gym | Sport Center Soekarno-Hatta",
    description:
      "Bergabunglah sebagai member Sport Center Soekarno-Hatta dan nikmati berbagai keuntungan eksklusif, diskon booking, dan akses prioritas ke fasilitas gym premium.",
  },
  {
    path: "/contact",
    title: "Hubungi Kami | Sport Center Soekarno-Hatta",
    description:
      "Hubungi Sport Center Soekarno-Hatta untuk informasi booking, keanggotaan, atau layanan lainnya. Kami siap membantu Anda kapan saja.",
  },
  {
    path: "/privacy",
    title: "Kebijakan Privasi | Sport Center Soekarno-Hatta",
    description:
      "Baca kebijakan privasi Sport Center Soekarno-Hatta untuk memahami bagaimana kami mengumpulkan, menggunakan, dan melindungi data pribadi Anda.",
  },
  {
    path: "/terms",
    title: "Syarat & Ketentuan | Sport Center Soekarno-Hatta",
    description:
      "Syarat dan ketentuan penggunaan layanan Sport Center Soekarno-Hatta. Harap baca dengan seksama sebelum menggunakan layanan pemesanan lapangan kami.",
  },
];

/**
 * Inject route-specific meta tags into the template HTML.
 * Replaces/removes existing generic tags then appends a clean block.
 */
function injectMeta(templateHtml, route) {
  const canonicalUrl = `${BASE_URL}${route.path}`;
  const image = route.image ?? DEFAULT_IMAGE;

  let html = templateHtml;

  // 1. Replace <title>
  html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${route.title}</title>`);

  // 2. Replace name="description"
  html = html.replace(
    /<meta\s+name="description"[^>]*>/g,
    `<meta name="description" content="${route.description}" />`
  );

  // 3. Remove all existing og:*, twitter:*, and canonical so we can inject fresh ones
  html = html.replace(/<meta\s+property="og:[^"]*"[^>]*>\s*/g, "");
  html = html.replace(/<meta\s+name="twitter:[^"]*"[^>]*>\s*/g, "");
  html = html.replace(/<link\s+rel="canonical"[^>]*>\s*/g, "");

  // 4. Build injection block
  const block = [
    `    <link rel="canonical" href="${canonicalUrl}" />`,
    `    <meta property="og:type" content="website" />`,
    `    <meta property="og:site_name" content="Sport Center Soekarno-Hatta" />`,
    `    <meta property="og:title" content="${route.title}" />`,
    `    <meta property="og:description" content="${route.description}" />`,
    `    <meta property="og:url" content="${canonicalUrl}" />`,
    `    <meta property="og:image" content="${image}" />`,
    `    <meta property="og:image:width" content="1200" />`,
    `    <meta property="og:image:height" content="630" />`,
    `    <meta property="og:locale" content="id_ID" />`,
    `    <meta name="twitter:card" content="summary_large_image" />`,
    `    <meta name="twitter:title" content="${route.title}" />`,
    `    <meta name="twitter:description" content="${route.description}" />`,
    `    <meta name="twitter:image" content="${image}" />`,
  ].join("\n");

  html = html.replace("</head>", `${block}\n  </head>`);

  return html;
}

// ── main ──────────────────────────────────────────────────────────────────────

const templateHtml = readFileSync(join(distDir, "index.html"), "utf-8");

let ok = 0;
for (const route of routes) {
  const html = injectMeta(templateHtml, route);

  if (route.path === "/") {
    writeFileSync(join(distDir, "index.html"), html, "utf-8");
    console.log(`✓  /  →  dist/public/index.html`);
  } else {
    const routeDir = join(distDir, route.path);
    mkdirSync(routeDir, { recursive: true });
    writeFileSync(join(routeDir, "index.html"), html, "utf-8");
    console.log(`✓  ${route.path}  →  dist/public${route.path}/index.html`);
  }
  ok++;
}

console.log(`\n✅ Prerender complete — ${ok}/${routes.length} routes written.`);
console.log(`   BASE_URL: ${BASE_URL}`);
