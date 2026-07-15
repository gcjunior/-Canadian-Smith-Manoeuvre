export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="state-block" role="status" aria-live="polite">
      {label}
    </div>
  );
}

export function EmptyState({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="state-block panel">
      <p style={{ margin: 0, color: 'var(--ink)' }}>{title}</p>
      {detail ? <p style={{ margin: '0.5rem 0 0' }}>{detail}</p> : null}
    </div>
  );
}

export function ErrorState({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="state-block panel error" role="alert">
      <p style={{ margin: 0 }}>{title}</p>
      {detail ? <p style={{ margin: '0.5rem 0 0' }}>{detail}</p> : null}
    </div>
  );
}
