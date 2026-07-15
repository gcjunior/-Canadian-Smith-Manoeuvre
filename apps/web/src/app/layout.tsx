import type { ReactNode } from 'react';
import { Source_Serif_4 } from 'next/font/google';

import './globals.css';

const sourceSerif = Source_Serif_4({
  subsets: ['latin'],
  variable: '--font-source-serif',
  display: 'swap',
});

export const metadata = {
  title: 'Canadian Smith Manoeuvre',
  description:
    'Simulated Smith Manoeuvre automation. Uses borrowed HELOC funds and creates investment debt.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-CA" className={sourceSerif.variable}>
      <body style={{ fontFamily: 'var(--font-source-serif), var(--font-body)' }}>{children}</body>
    </html>
  );
}
