import { LoginForm } from '@/components/LoginForm';
import { apiFetchPublic } from '@/lib/api-server';

type Scenario = {
  tenantId: string;
  slug: string;
  name: string;
  users: { userId: string; email: string; displayName: string }[];
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; role?: string }>;
}) {
  const params = await searchParams;
  let scenarios: Scenario[] = [];
  let loadError: string | undefined;
  try {
    scenarios = await apiFetchPublic<Scenario[]>('/auth/dev-scenarios');
  } catch (error) {
    loadError = error instanceof Error ? error.message : 'Unable to load scenarios';
  }

  return (
    <main className="shell" style={{ maxWidth: 640, paddingTop: '3rem' }}>
      <h1 className="brand">Canadian Smith Manoeuvre</h1>
      <p className="lede">
        Sign in to a simulated household. Your access token stays in an HTTP-only cookie — never in
        browser storage.
      </p>
      {loadError ? (
        <p className="state-block error panel" role="alert">
          {loadError}. Start the API and seed data, then reload.
        </p>
      ) : (
        <LoginForm
          scenarios={scenarios}
          nextPath={params.next ?? '/dashboard'}
          preferredRole={params.role === 'OPERATIONS' ? 'OPERATIONS' : 'CUSTOMER'}
        />
      )}
    </main>
  );
}
