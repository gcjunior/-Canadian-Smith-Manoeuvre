'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { listCanadianTimezones } from '@/lib/timezone';
import { dollarsInputToCents } from '@/lib/money';

const STEPS = [
  'Bank scenario',
  'Mortgage',
  'HELOC',
  'Ordinary account',
  'Brokerage',
  'ETF',
  'Monthly cap',
  'Risk disclosure',
  'Activate',
] as const;

const BANK_SCENARIOS = [
  {
    id: 'readvanceable-core',
    title: 'Readvanceable core',
    detail: 'Standard simulated mortgage + HELOC with monthly principal unlocking credit.',
  },
  {
    id: 'tight-credit',
    title: 'Tight available credit',
    detail: 'Smaller HELOC headroom to exercise skip / wait-for-credit paths.',
  },
] as const;

const ETF_OPTIONS = [
  { symbol: 'VCN.TO', name: 'Vanguard FTSE Canada All Cap' },
  { symbol: 'XEQT.TO', name: 'iShares Core Equity ETF Portfolio' },
  { symbol: 'VFV.TO', name: 'Vanguard S&P 500 Index ETF' },
] as const;

type BankConnectResult = {
  connection: { id: string };
  accounts: {
    mortgageAccountId: string;
    helocAccountId: string;
    bankAccountId: string;
  };
};

type BrokerConnectResult = {
  connection: { id: string };
  accounts: { brokerageAccountId: string };
};

type StrategyResponse = {
  id: string;
  name: string;
  state: string;
};

export function OnboardingWizard() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [scenario, setScenario] =
    useState<(typeof BANK_SCENARIOS)[number]['id']>('readvanceable-core');
  const [bankAccounts, setBankAccounts] = useState<BankConnectResult['accounts'] | null>(null);
  const [brokerageAccountId, setBrokerageAccountId] = useState<string | null>(null);
  const [etf, setEtf] = useState<(typeof ETF_OPTIONS)[number]['symbol']>('VCN.TO');
  const [capDollars, setCapDollars] = useState('5000');
  const [timezone, setTimezone] = useState('America/Toronto');
  const [paymentDay, setPaymentDay] = useState(1);
  const [disclosed, setDisclosed] = useState(false);
  const [strategy, setStrategy] = useState<StrategyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const timezones = useMemo(() => listCanadianTimezones(), []);

  async function api(path: string, init?: RequestInit) {
    const res = await fetch(`/api/backend${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });
    const data = (await res.json()) as { error?: { message?: string } } & Record<string, unknown>;
    if (!res.ok) {
      throw new Error(data.error?.message ?? `Request failed (${res.status})`);
    }
    return data;
  }

  async function connectBank() {
    setPending(true);
    setError(null);
    try {
      const result = (await api('/financial-connections/simulated-bank', {
        method: 'POST',
        body: JSON.stringify({ scenario }),
      })) as unknown as BankConnectResult;
      setBankAccounts(result.accounts);
      setStep(4);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bank connect failed');
    } finally {
      setPending(false);
    }
  }

  async function connectBrokerage() {
    setPending(true);
    setError(null);
    try {
      const result = (await api('/financial-connections/simulated-brokerage', {
        method: 'POST',
        body: '{}',
      })) as unknown as BrokerConnectResult;
      setBrokerageAccountId(result.accounts.brokerageAccountId);
      setStep(5);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Brokerage connect failed');
    } finally {
      setPending(false);
    }
  }

  async function createStrategy() {
    if (!bankAccounts || !brokerageAccountId) return;
    setPending(true);
    setError(null);
    try {
      const cents = dollarsInputToCents(capDollars);
      const created = (await api('/strategies', {
        method: 'POST',
        body: JSON.stringify({
          name: 'My Smith Manoeuvre',
          timezone,
          expectedPaymentDay: paymentDay,
          mortgageAccountId: bankAccounts.mortgageAccountId,
          helocAccountId: bankAccounts.helocAccountId,
          bankAccountId: bankAccounts.bankAccountId,
          brokerageAccountId,
          investmentPolicy: {
            symbol: etf,
            exchange: 'TSX',
            userMonthlyCapCents: cents,
            allowFractionalShares: true,
          },
        }),
      })) as unknown as StrategyResponse;
      setStrategy(created);
      setStep(8);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Strategy setup failed');
    } finally {
      setPending(false);
    }
  }

  async function activate() {
    if (!strategy || !disclosed) return;
    setPending(true);
    setError(null);
    try {
      await api(`/strategies/${strategy.id}/activate`, {
        method: 'POST',
        body: JSON.stringify({ acknowledgeRiskDisclosures: true }),
      });
      router.push('/dashboard');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Activation failed');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="stack">
      <ol className="steps" aria-label="Onboarding progress">
        {STEPS.map((label, index) => (
          <li key={label} aria-current={index === step ? 'step' : undefined}>
            {index + 1}. {label}
          </li>
        ))}
      </ol>

      {error ? (
        <p className="panel error" role="alert" style={{ color: 'var(--danger)' }}>
          {error}
        </p>
      ) : null}

      {step === 0 && (
        <section className="panel stack">
          <h2 style={{ margin: 0 }}>Select simulated bank scenario</h2>
          <p className="lede" style={{ margin: 0 }}>
            Accounts remain simulated. Connecting later will create mortgage, HELOC, and ordinary
            bank accounts in one step.
          </p>
          {BANK_SCENARIOS.map((item) => (
            <label key={item.id} className="panel" style={{ cursor: 'pointer' }}>
              <input
                type="radio"
                name="scenario"
                value={item.id}
                checked={scenario === item.id}
                onChange={() => setScenario(item.id)}
              />{' '}
              <strong>{item.title}</strong>
              <div className="hint">{item.detail}</div>
            </label>
          ))}
          <button type="button" className="btn btn-primary" onClick={() => setStep(1)}>
            Continue
          </button>
        </section>
      )}

      {step >= 1 && step <= 3 && (
        <section className="panel stack">
          <h2 style={{ margin: 0 }}>
            {step === 1 && 'Connect simulated mortgage'}
            {step === 2 && 'Connect simulated HELOC'}
            {step === 3 && 'Connect ordinary bank account for interest'}
          </h2>
          <p className="lede" style={{ margin: 0 }}>
            {step === 1 &&
              'Mortgage principal repayments unlock HELOC credit used for the conversion.'}
            {step === 2 &&
              'The HELOC is borrowed money. Drawing creates investment debt that must be managed.'}
            {step === 3 &&
              'HELOC interest is paid only from this ordinary account — never from investment proceeds.'}
          </p>
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button
              type="button"
              className="btn"
              onClick={() => setStep(step - 1)}
              disabled={pending}
            >
              Back
            </button>
            {step < 3 ? (
              <button type="button" className="btn btn-primary" onClick={() => setStep(step + 1)}>
                Mark connected
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void connectBank()}
                disabled={pending}
              >
                {pending ? 'Connecting…' : 'Connect bank accounts'}
              </button>
            )}
          </div>
          {bankAccounts ? (
            <p className="hint">
              Bank accounts ready. Mortgage, HELOC, and ordinary chequing linked.
            </p>
          ) : null}
        </section>
      )}

      {step === 4 && (
        <section className="panel stack">
          <h2 style={{ margin: 0 }}>Connect simulated non-registered brokerage</h2>
          <p className="lede" style={{ margin: 0 }}>
            Purchases occur in a taxable brokerage cash account (simulation only).
          </p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void connectBrokerage()}
            disabled={pending}
          >
            {pending ? 'Connecting…' : 'Connect brokerage'}
          </button>
        </section>
      )}

      {step === 5 && (
        <section className="panel stack">
          <h2 style={{ margin: 0 }}>Select one simulated ETF</h2>
          {ETF_OPTIONS.map((option) => (
            <label key={option.symbol}>
              <input
                type="radio"
                name="etf"
                value={option.symbol}
                checked={etf === option.symbol}
                onChange={() => setEtf(option.symbol)}
              />{' '}
              {option.symbol} — {option.name}
            </label>
          ))}
          <button type="button" className="btn btn-primary" onClick={() => setStep(6)}>
            Continue
          </button>
        </section>
      )}

      {step === 6 && (
        <section className="panel stack">
          <h2 style={{ margin: 0 }}>Configure monthly investment cap</h2>
          <div className="field">
            <label htmlFor="cap">Monthly cap (CAD)</label>
            <input
              id="cap"
              name="cap"
              inputMode="decimal"
              value={capDollars}
              onChange={(e) => setCapDollars(e.target.value)}
              required
            />
            <span className="hint">Amounts are stored and displayed in Canadian dollars.</span>
          </div>
          <div className="field">
            <label htmlFor="tz">Canadian timezone</label>
            <select id="tz" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
              {timezones.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="day">Expected mortgage payment day</label>
            <input
              id="day"
              type="number"
              min={1}
              max={28}
              value={paymentDay}
              onChange={(e) => setPaymentDay(Number(e.target.value))}
            />
          </div>
          <button type="button" className="btn btn-primary" onClick={() => setStep(7)}>
            Continue
          </button>
        </section>
      )}

      {step === 7 && (
        <section className="panel stack disclosure">
          <h2 style={{ margin: 0 }}>Review leverage and risk disclosure</h2>
          <ul style={{ lineHeight: 1.7, margin: 0, paddingLeft: '1.1rem' }}>
            <li>This strategy uses borrowed HELOC funds and creates investment debt.</li>
            <li>Market losses can leave you owing more than your investments are worth.</li>
            <li>Interest is charged on the HELOC and paid from your ordinary bank account.</li>
            <li>Automatic conversion borrows and invests monthly up to your configured cap.</li>
          </ul>
          <label>
            <input
              type="checkbox"
              checked={disclosed}
              onChange={(e) => setDisclosed(e.target.checked)}
            />{' '}
            I understand this uses leverage and creates investment debt.
          </label>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!disclosed || pending}
            onClick={() => void createStrategy()}
          >
            {pending ? 'Saving…' : 'Save strategy draft'}
          </button>
        </section>
      )}

      {step === 8 && strategy && (
        <section className="panel stack">
          <h2 style={{ margin: 0 }}>Activate automatic monthly conversion</h2>
          <p className="lede" style={{ margin: 0 }}>
            Strategy <strong>{strategy.name}</strong> is ready. Activation schedules simulated
            monthly checks — still using borrowed HELOC funds.
          </p>
          <button
            type="button"
            className="btn btn-primary"
            disabled={pending}
            onClick={() => void activate()}
          >
            {pending ? 'Activating…' : 'Activate automation'}
          </button>
        </section>
      )}
    </div>
  );
}
