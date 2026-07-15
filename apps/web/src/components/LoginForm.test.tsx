import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { LoginForm } from './LoginForm';

describe('LoginForm', () => {
  it('requires accessible labels for household and user', async () => {
    const user = userEvent.setup();
    render(
      <LoginForm
        preferredRole="CUSTOMER"
        nextPath="/dashboard"
        scenarios={[
          {
            tenantId: '11111111-1111-1111-1111-111111111111',
            slug: 'maple',
            name: 'Maple Household',
            users: [
              {
                userId: '22222222-2222-2222-2222-222222222222',
                email: 'jordan@maple.example',
                displayName: 'Jordan',
              },
            ],
          },
        ]}
      />,
    );

    expect(screen.getByLabelText('Simulated household')).toBeInTheDocument();
    expect(screen.getByLabelText('User')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
  });
});
