import { AppShell } from '@/components/AppShell';
import { OnboardingWizard } from '@/components/onboarding/OnboardingWizard';

export default function OnboardingPage() {
  return (
    <AppShell>
      <h1 className="brand">Onboarding</h1>
      <p className="lede">
        Set up simulated accounts, choose an ETF, set a monthly cap, then acknowledge leverage risk
        before activating automatic conversion.
      </p>
      <div style={{ marginTop: '1.5rem' }}>
        <OnboardingWizard />
      </div>
    </AppShell>
  );
}
