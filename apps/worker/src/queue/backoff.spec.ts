import { backoffSeconds } from './backoff.js';

describe('backoffSeconds', () => {
  it('cresce a cada falha', () => {
    expect([1, 2, 3, 4, 5].map(backoffSeconds)).toEqual([
      30, 120, 600, 3_600, 21_600,
    ]);
  });

  it('para no teto depois da quinta falha', () => {
    expect(backoffSeconds(9)).toBe(21_600);
  });

  it('trata valores fora da faixa como a primeira falha', () => {
    expect(backoffSeconds(0)).toBe(30);
  });
});
