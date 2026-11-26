import {
  BadRequestException,
  ServiceUnavailableException,
  type ExecutionContext,
} from '@nestjs/common';
import type { Env } from '../../config/env.js';
import { TurnstileGuard } from './turnstile.guard.js';
import { TurnstileService } from './turnstile.service.js';

function contextFor(body: unknown, ip = '203.0.113.7') {
  return {
    switchToHttp: () => ({ getRequest: () => ({ body, ip }) }),
  } as unknown as ExecutionContext;
}

function guardWith(secret?: string) {
  const service = new TurnstileService({
    NODE_ENV: 'test',
    TURNSTILE_SECRET_KEY: secret,
  } as Env);
  return new TurnstileGuard(service);
}

function mockSiteverify(response: unknown, status = 200) {
  return vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response(JSON.stringify(response), { status }));
}

describe('TurnstileGuard', () => {
  afterEach(() => vi.restoreAllMocks());

  it('libera tudo quando não há chave secreta', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await expect(guardWith().canActivate(contextFor({}))).resolves.toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('recusa requisição sem token', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await expect(
      guardWith('segredo').canActivate(contextFor({ email: 'a@b.com' })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('recusa token que não é string ou é grande demais', async () => {
    const guard = guardWith('segredo');
    await expect(
      guard.canActivate(contextFor({ turnstileToken: 123 })),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      guard.canActivate(contextFor({ turnstileToken: 'x'.repeat(2049) })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('libera token aceito pela Cloudflare e envia segredo e IP', async () => {
    const fetchSpy = mockSiteverify({ success: true });
    await expect(
      guardWith('segredo').canActivate(contextFor({ turnstileToken: 'tok' })),
    ).resolves.toBe(true);

    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    );
    const sent = init!.body as URLSearchParams;
    expect(sent.get('secret')).toBe('segredo');
    expect(sent.get('response')).toBe('tok');
    expect(sent.get('remoteip')).toBe('203.0.113.7');
  });

  it('recusa token que a Cloudflare rejeitou', async () => {
    mockSiteverify({ success: false, 'error-codes': ['timeout-or-duplicate'] });
    await expect(
      guardWith('segredo').canActivate(contextFor({ turnstileToken: 'tok' })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('responde 503 quando a Cloudflare não responde', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('timeout'));
    await expect(
      guardWith('segredo').canActivate(contextFor({ turnstileToken: 'tok' })),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('responde 503 quando a Cloudflare devolve erro HTTP', async () => {
    mockSiteverify({}, 500);
    await expect(
      guardWith('segredo').canActivate(contextFor({ turnstileToken: 'tok' })),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
