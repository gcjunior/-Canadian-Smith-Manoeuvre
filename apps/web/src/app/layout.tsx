import type { ReactNode } from 'react';

export const metadata = {
  title: 'Canadian Smith Manoeuvre Simulator',
  description:
    'Multi-tenant automation simulator for the Smith Manoeuvre. Uses simulated HELOC leverage to invest; disclosures of debt, interest, and investment risk are required.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily: '"Source Serif 4", "Iowan Old Style", Georgia, serif',
          background: 'linear-gradient(160deg, #0f2a24 0%, #1c4a3e 45%, #0b1c18 100%)',
          color: '#f3efe6',
          minHeight: '100vh',
        }}
      >
        {children}
      </body>
    </html>
  );
}
