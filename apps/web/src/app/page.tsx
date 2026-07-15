import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="shell" style={{ paddingTop: '3.5rem' }}>
      <p style={{ letterSpacing: '0.08em', textTransform: 'uppercase', opacity: 0.75, margin: 0 }}>
        Simulator
      </p>
      <h1 className="brand" style={{ marginTop: '0.5rem' }}>
        Canadian Smith Manoeuvre
      </h1>
      <p className="lede">
        Automate a simulated monthly conversion from mortgage principal paydown into HELOC-funded
        ETF purchases. Borrowed money creates investment debt — this product makes that explicit.
      </p>
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginTop: '1.75rem' }}>
        <Link className="btn btn-primary" href="/login">
          Sign in
        </Link>
        <Link className="btn" href="/login?role=OPERATIONS">
          Operations
        </Link>
      </div>
      <section className="panel disclosure" style={{ marginTop: '2.5rem' }}>
        <h2 style={{ marginTop: 0, fontSize: '1.15rem' }}>Leverage disclosure</h2>
        <ul
          style={{ lineHeight: 1.7, margin: 0, paddingLeft: '1.1rem', color: 'var(--ink-muted)' }}
        >
          <li>The strategy uses borrowed HELOC funds and creates investment debt.</li>
          <li>Investments can decline; losses can exceed any tax treatment of interest.</li>
          <li>HELOC interest is paid from an ordinary bank account — never investment proceeds.</li>
          <li>This simulator does not move real money or provide advice.</li>
        </ul>
      </section>
    </main>
  );
}
