import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import '@testing-library/jest-dom/vitest';

import { StatusBadge } from './StatusBadge';

describe('StatusBadge', () => {
  it('renders customer-facing status text', () => {
    render(<StatusBadge status="Waiting for available credit" />);
    expect(screen.getByText('Waiting for available credit')).toBeInTheDocument();
  });
});
