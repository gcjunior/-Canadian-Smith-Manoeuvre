import { SignJWT, jwtVerify } from 'jose';

import type { AppRole, TenantContext } from '@csm/contracts';
import { AppError, tenantContextSchema } from '@csm/contracts';

const encoder = new TextEncoder();

export interface JwtServiceOptions {
  secret: string;
  expiresSeconds: number;
}

export class JwtService {
  private readonly key: Uint8Array;
  private readonly expiresSeconds: number;

  constructor(options: JwtServiceOptions) {
    this.key = encoder.encode(options.secret);
    this.expiresSeconds = options.expiresSeconds;
  }

  async sign(context: TenantContext): Promise<{ accessToken: string; expiresIn: number }> {
    const accessToken = await new SignJWT({
      tenantId: context.tenantId,
      userId: context.userId,
      roles: context.roles,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(`${this.expiresSeconds}s`)
      .setSubject(context.userId)
      .sign(this.key);

    return { accessToken, expiresIn: this.expiresSeconds };
  }

  async verify(token: string, correlationId?: string): Promise<TenantContext> {
    try {
      const { payload } = await jwtVerify(token, this.key, { algorithms: ['HS256'] });
      return tenantContextSchema.parse({
        tenantId: payload.tenantId,
        userId: payload.userId,
        roles: payload.roles as AppRole[],
      });
    } catch (error) {
      throw new AppError({
        code: 'UNAUTHORIZED',
        message: 'Invalid or expired access token',
        cause: error,
        ...(correlationId !== undefined ? { correlationId } : {}),
        retryable: false,
      });
    }
  }
}
