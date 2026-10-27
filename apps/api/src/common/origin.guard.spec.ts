import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Env } from '../config/env.js';
import { OriginGuard } from './origin.guard.js';

function contextFor(method: string, headers: Record<string, string> = {}) {
  return {
    getType: () => 'http',
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ method, headers }) }),
  } as unknown as ExecutionContext;
}

describe('OriginGuard', () => {
  const env = { FRONTEND_ORIGINS: ['http://localhost:5173'] } as Env;
  const guard = new OriginGuard(env, new Reflector());

  it('libera métodos seguros de qualquer origem', () => {
    expect(
      guard.canActivate(contextFor('GET', { origin: 'https://evil.example' })),
    ).toBe(true);
  });

  it('libera POST vindo do frontend', () => {
    expect(
      guard.canActivate(
        contextFor('POST', { origin: 'http://localhost:5173' }),
      ),
    ).toBe(true);
  });

  it('bloqueia POST de outra origem', () => {
    expect(() =>
      guard.canActivate(contextFor('POST', { origin: 'https://evil.example' })),
    ).toThrow(ForbiddenException);
  });

  it('bloqueia POST cross-site sem Origin', () => {
    expect(() =>
      guard.canActivate(contextFor('POST', { 'sec-fetch-site': 'cross-site' })),
    ).toThrow(ForbiddenException);
  });

  it('libera clientes fora do navegador (sem Origin)', () => {
    expect(guard.canActivate(contextFor('POST'))).toBe(true);
  });
});
