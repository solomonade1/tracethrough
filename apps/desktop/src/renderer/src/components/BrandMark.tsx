import { useId } from 'react';

/** The app icon's mark (apps/desktop/build/icon.svg), drawn inline so it needs no asset request. */
export function BrandMark({ size = 20 }: { size?: number }) {
  const uid = useId();
  return (
    <svg width={size} height={size} viewBox="64 64 896 896" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${uid}-bg`} x1="0" y1="64" x2="0" y2="960" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#18223a" />
          <stop offset="1" stopColor="#0a0e18" />
        </linearGradient>
        <linearGradient id={`${uid}-tr`} x1="0" y1="300" x2="0" y2="600" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#6ea8ff" />
          <stop offset="1" stopColor="#b79cff" />
        </linearGradient>
      </defs>
      <rect x="64" y="64" width="896" height="896" rx="200" fill={`url(#${uid}-bg)`} />
      <rect x="216" y="228" width="592" height="124" rx="62" fill="#6ea8ff" />
      <rect x="454" y="300" width="116" height="300" fill={`url(#${uid}-tr)`} />
      <circle cx="512" cy="706" r="118" fill="#0f1626" stroke="#b79cff" strokeWidth="64" />
      <circle cx="512" cy="706" r="40" fill="#e7ebf3" />
    </svg>
  );
}
