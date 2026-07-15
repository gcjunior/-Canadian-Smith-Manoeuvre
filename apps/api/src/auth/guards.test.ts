import { describe, expect, it } from 'vitest';

import { AppError } from '@csm/contracts';

import { assertCustomerOwnsUser, requireRoles } from './guards.js';

describe('authz failure modes', () => {
  it('rejects forged cross-user access for customers', () => {
    expect(() =>
      assertCustomerOwnsUser(
        {
          tenantId: '11111111-1111-4111-8111-111111111111',
          userId: '22222222-2222-4222-8222-222222222222',
          roles: ['CUSTOMER'],
        },
        '33333333-3333-4333-8333-333333333333',
        'corr-1',
      ),
    ).toThrow(AppError);
  });

  it('allows OPERATIONS to access another user in-tenant', () => {
    expect(() =>
      assertCustomerOwnsUser(
        {
          tenantId: '11111111-1111-4111-8111-111111111111',
          userId: '22222222-2222-4222-8222-222222222222',
          roles: ['OPERATIONS'],
        },
        '33333333-3333-4333-8333-333333333333',
      ),
    ).not.toThrow();
  });

  it('rejects CUSTOMER when OPERATIONS role required', () => {
    expect(() =>
      requireRoles(
        {
          tenantId: '11111111-1111-4111-8111-111111111111',
          userId: '22222222-2222-4222-8222-222222222222',
          roles: ['CUSTOMER'],
        },
        ['OPERATIONS'],
        'corr-2',
      ),
    ).toThrow(AppError);
  });
});
