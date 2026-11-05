import type { ReactNode } from 'react';

export const metadata = { title: 'Sample shop (Next.js)' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
