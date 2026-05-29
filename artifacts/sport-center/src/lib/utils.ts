import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getFacilityImage(category?: string | null, images?: any[]) {
  if (images && images.length > 0) return images[0].url;
  if (!category) return '/hero.png';
  const c = category.toLowerCase();
  if (c.includes('futsal')) return '/futsal.png';
  if (c.includes('basket')) return '/basket.png';
  if (c.includes('voli')) return '/voli.png';
  if (c.includes('tennis') || c.includes('tenis')) return '/tennis.png';
  if (c.includes('badminton') || c.includes('bulu')) return '/badminton.png';
  if (c.includes('gym') || c.includes('fitness')) return '/gym.png';
  if (c.includes('billiard') || c.includes('biliar')) return '/billiard.png';
  return '/hero.png';
}
