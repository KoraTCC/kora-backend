import {
  formatUnits,
  halfOf,
  quoteCryptoAmount,
  toNetworkDecimals,
} from './quote.js';

describe('quote', () => {
  it('converte BRL para cripto com as casas da rede', () => {
    // 24900 / 1353260 = 0.01840001... → teto em 4 casas = 0.0185
    expect(quoteCryptoAmount(24_900, 'sepolia')).toBe('0.0185');
    expect(quoteCryptoAmount(10_000, 'amoy')).toBe('18.46');
    expect(quoteCryptoAmount(35_200_000, 'bitcoin-testnet')).toBe('1.000000');
  });

  it('arredonda para cima: o cliente nunca paga menos', () => {
    // 100 / 542 = 0.18450...  → 0.19 (e não 0.18)
    expect(quoteCryptoAmount(100, 'amoy')).toBe('0.19');
  });

  it('formata unidades inteiras como decimal', () => {
    expect(formatUnits(5n, 4)).toBe('0.0005');
    expect(formatUnits(123456n, 2)).toBe('1234.56');
  });

  it('ajusta decimais vindos do banco às casas da rede', () => {
    expect(toNetworkDecimals('0.01840000', 'sepolia')).toBe('0.0184');
    expect(toNetworkDecimals('18', 'amoy')).toBe('18.00');
  });

  it('calcula metade para o pagamento parcial', () => {
    expect(halfOf('0.0184', 'sepolia')).toBe('0.0092');
    expect(halfOf('18.47', 'amoy')).toBe('9.23');
  });
});
