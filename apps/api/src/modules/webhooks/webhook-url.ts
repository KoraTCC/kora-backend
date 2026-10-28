import { isIP } from 'node:net';

/**
 * Recusa URLs que apontam para a própria infraestrutura (SSRF): quando a
 * entrega real existir, a API faria requisições para elas. A checagem
 * definitiva tem que ser na hora do envio, resolvendo o DNS; aqui barramos
 * os casos óbvios no cadastro.
 */
export function unsafeWebhookUrlReason(raw: string): string | null {
  const url = new URL(raw);
  if (url.protocol !== 'https:') return 'Use https://';
  if (url.username || url.password)
    return 'A URL não pode conter usuário ou senha';

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    return 'Use um endereço público';
  }
  if (isIP(host)) return 'Use um domínio, não um endereço IP';
  if (!host.includes('.')) return 'Use um domínio público';
  return null;
}
