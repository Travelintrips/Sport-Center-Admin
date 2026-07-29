/**
 * SEOHead — uses React 19's native document metadata hoisting.
 * <title>, <meta>, and <link> placed anywhere in the tree are
 * automatically moved to <head> by React 19, no library needed.
 */

const SITE_NAME = "Sport Center Soekarno-Hatta";
const BASE_URL = (import.meta.env.VITE_PUBLIC_URL as string | undefined) ?? "";
const DEFAULT_IMAGE = `${BASE_URL}/og-image.jpg`;
const ROBOTS =
  "index,follow,max-snippet:-1,max-image-preview:large,max-video-preview:-1";

interface SEOHeadProps {
  title: string;
  description: string;
  path: string;
  image?: string;
  type?: "website" | "article";
}

export default function SEOHead({
  title,
  description,
  path,
  image = DEFAULT_IMAGE,
  type = "website",
}: SEOHeadProps) {
  const canonicalUrl = BASE_URL ? `${BASE_URL}${path}` : undefined;

  return (
    <>
      {/* Primary */}
      <title>{title}</title>
      <meta name="description" content={description} />
      <meta name="robots" content={ROBOTS} />
      {canonicalUrl && <link rel="canonical" href={canonicalUrl} />}

      {/* Open Graph */}
      <meta property="og:type" content={type} />
      <meta property="og:site_name" content={SITE_NAME} />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      {canonicalUrl && <meta property="og:url" content={canonicalUrl} />}
      <meta property="og:image" content={image} />
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />
      <meta property="og:locale" content="id_ID" />

      {/* Twitter */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={image} />
    </>
  );
}
