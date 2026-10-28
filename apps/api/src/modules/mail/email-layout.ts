/**
 * Layout HTML dos e-mails da Kora.
 *
 * E-mail não é página web: Gmail, Outlook e apps de celular ignoram CSS
 * externo e boa parte do moderno. Por isso: tabelas para o layout, estilos
 * inline, largura máxima de 560px, botão "à prova de Outlook" (link dentro
 * de célula com fundo) e o link também em texto, se o botão não renderizar.
 */

const COLORS = {
  page: '#f4f7f1',
  card: '#ffffff',
  border: '#e3e8df',
  text: '#0e110e',
  muted: '#5c6459',
  lime: '#b8f24b',
  onLime: '#0a0c0a',
};

const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

export interface EmailLayoutOptions {
  /** Texto de prévia que aparece ao lado do assunto na caixa de entrada. */
  preheader: string;
  title: string;
  /** Parágrafos em HTML já escapado. */
  paragraphs: string[];
  button?: { label: string; url: string };
  /** Nota final em letra menor (ex.: "se não foi você…"). */
  footnote?: string;
}

export function renderEmail(options: EmailLayoutOptions): string {
  const { preheader, title, paragraphs, button, footnote } = options;
  const paragraph = (html: string) =>
    `<p style="margin:0 0 16px;font-family:${FONT};font-size:15px;line-height:24px;color:${COLORS.text};">${html}</p>`;

  const buttonHtml = button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;">
        <tr>
          <td bgcolor="${COLORS.lime}" style="border-radius:10px;">
            <a href="${escapeHtml(button.url)}" target="_blank"
               style="display:inline-block;padding:14px 28px;font-family:${FONT};font-size:15px;font-weight:700;color:${COLORS.onLime};text-decoration:none;border-radius:10px;">
              ${escapeHtml(button.label)}
            </a>
          </td>
        </tr>
      </table>
      <p style="margin:0 0 16px;font-family:${FONT};font-size:13px;line-height:20px;color:${COLORS.muted};">
        Se o botão não funcionar, copie e cole este endereço no navegador:<br>
        <a href="${escapeHtml(button.url)}" style="color:${COLORS.text};word-break:break-all;">${escapeHtml(button.url)}</a>
      </p>`
    : '';

  const footnoteHtml = footnote
    ? `<p style="margin:24px 0 0;padding-top:16px;border-top:1px solid ${COLORS.border};font-family:${FONT};font-size:13px;line-height:20px;color:${COLORS.muted};">${footnote}</p>`
    : '';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background-color:${COLORS.page};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLORS.page}">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
          <tr>
            <td style="padding:0 4px 20px;font-family:${FONT};font-size:22px;font-weight:800;letter-spacing:-0.5px;color:${COLORS.text};">
              Kora<span style="color:${COLORS.lime};">.</span>
            </td>
          </tr>
          <tr>
            <td bgcolor="${COLORS.card}" style="padding:32px;border:1px solid ${COLORS.border};border-radius:16px;">
              <h1 style="margin:0 0 20px;font-family:${FONT};font-size:22px;line-height:30px;font-weight:700;color:${COLORS.text};">${escapeHtml(title)}</h1>
              ${paragraphs.map(paragraph).join('\n              ')}
              ${buttonHtml}
              ${footnoteHtml}
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:20px 4px 0;font-family:${FONT};font-size:12px;line-height:18px;color:${COLORS.muted};">
              Kora · Checkout de pagamentos com stablecoins<br>
              Este é um e-mail automático, não é preciso respondê-lo.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
