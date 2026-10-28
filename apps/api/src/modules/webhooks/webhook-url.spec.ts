import { unsafeWebhookUrlReason } from './webhook-url.js';

describe('unsafeWebhookUrlReason', () => {
  it('aceita um domínio público com https', () => {
    expect(
      unsafeWebhookUrlReason('https://lojaexemplo.com/kora/hooks'),
    ).toBeNull();
  });

  it.each([
    'http://lojaexemplo.com/hooks',
    'https://user:senha@lojaexemplo.com/hooks',
    'https://localhost/hooks',
    'https://api.localhost/hooks',
    'https://printer.local/hooks',
    'https://127.0.0.1/hooks',
    'https://169.254.169.254/latest/meta-data',
    'https://10.0.0.5/hooks',
    'https://[::1]/hooks',
    'https://intranet/hooks',
  ])('recusa %s', (url) => {
    expect(unsafeWebhookUrlReason(url)).not.toBeNull();
  });
});
