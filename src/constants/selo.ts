/**
 * A IDENTIDADE DO SELO DE INTEGRIDADE — uma fonte só.
 *
 * A impressão digital do certificado precisa aparecer em três lugares: no
 * carimbo de margem do PDF, na página pública de conferência e no arquivo
 * publicado para download. Ela estava escrita à mão em dois deles, e um valor
 * de conferência copiado é um valor que um dia diverge — e divergir aqui
 * significa a página dizer que o certificado é um e o arquivo trazer outro,
 * que é exatamente a falsificação que a impressão digital existe para detectar.
 *
 * Trocar o certificado (por um e-CNPJ da ICP-Brasil, por exemplo) muda só este
 * arquivo, além do secret `PADES_P12_BASE64` no servidor.
 *
 * Ver `supabase/functions/pades-sign/CERTIFICADO.md`.
 */

/** SHA-256 do certificado, no formato que o `openssl x509 -fingerprint` imprime. */
export const SELO_IMPRESSAO_DIGITAL =
  '82:96:16:50:C2:60:54:2C:C1:48:83:D4:54:BA:6C:E1:E8:7B:45:59:69:27:44:5F:50:F6:6D:05:8E:DD:E7:80';

/** O certificado público, servido junto com o site. */
export const SELO_URL_DO_CERTIFICADO = '/selo-de-integridade.crt';

/** Como o certificado se apresenta nos leitores de PDF. */
export const SELO_TITULAR = 'Jurius — Selo de Integridade';

/**
 * A forma CURTA, para caber num carimbo de margem de 6 pt.
 *
 * A impressão inteira tem 95 caracteres; numa faixa vertical ela não seria
 * lida por ninguém e ainda empurraria o protocolo para fora da folha. Os
 * primeiros 8 bytes (16 dígitos) já distinguem o nosso certificado de
 * qualquer outro na prática, e quem quiser conferir os 32 bytes tem o
 * arquivo completo em `SELO_URL_DO_CERTIFICADO`.
 */
export const seloImpressaoCurta = (grupos = 4): string =>
  SELO_IMPRESSAO_DIGITAL.split(':').slice(0, grupos * 2).join('').toUpperCase();
