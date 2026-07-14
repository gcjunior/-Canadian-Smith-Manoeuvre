const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

export default function HomePage() {
  return (
    <main style={{ padding: '4rem 1.5rem', maxWidth: 720, margin: '0 auto' }}>
      <p style={{ letterSpacing: '0.08em', textTransform: 'uppercase', opacity: 0.75 }}>
        Canadian Smith Manoeuvre
      </p>
      <h1 style={{ fontSize: '2.75rem', lineHeight: 1.1, margin: '0.5rem 0 1rem' }}>
        Automation simulator
      </h1>
      <p style={{ fontSize: '1.125rem', lineHeight: 1.6, opacity: 0.92 }}>
        This product simulates readvanceable mortgage / HELOC debt conversion into a non-registered
        investment purchase. It does <strong>not</strong> move real money, provide investment
        advice, or determine tax outcomes.
      </p>
      <section
        style={{
          marginTop: '2rem',
          padding: '1.25rem 0',
          borderTop: '1px solid rgba(243, 239, 230, 0.25)',
        }}
      >
        <h2 style={{ fontSize: '1.125rem' }}>Risk disclosures</h2>
        <ul style={{ lineHeight: 1.7, paddingLeft: '1.2rem' }}>
          <li>The strategy uses borrowed money (HELOC). Debt and interest costs can grow.</li>
          <li>Investments can decline in value; losses can exceed interest tax benefits.</li>
          <li>
            HELOC interest is paid from an ordinary bank account — never from investment proceeds.
          </li>
          <li>Simulated results do not predict real bank or brokerage behaviour.</li>
        </ul>
      </section>
      <p style={{ marginTop: '2rem', opacity: 0.7 }}>
        API (browser): <code>{apiBase}</code>
      </p>
    </main>
  );
}
