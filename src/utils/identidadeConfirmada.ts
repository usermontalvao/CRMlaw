/**
 * A IDENTIDADE QUE O SERVIDOR CONFIRMOU — e como escrevê-la no relatório.
 *
 * Um signatário tem dois telefones e dois e-mails, e eles não valem a mesma
 * coisa:
 *
 *  · `phone` / `email` — o que a pessoa DIGITOU no formulário, ou o que o
 *    escritório cadastrou. Serve de contato. Não prova nada.
 *  · `auth_verified_identifier` — o número ou endereço que RECEBEU um código e
 *    o devolveu certo, gravado pelo `public-sign-document` a partir da linha de
 *    OTP consumida. Este, sim, é prova.
 *
 * O dossiê antigo imprimia o primeiro com cara de segundo: dizia "Autenticação
 * via Telefone (65 9xxxx-xxxx)" mostrando o número do formulário, mesmo que
 * nenhum código tivesse sido validado. Tudo que for exibido como confirmado
 * passa por aqui, para que a distinção não dependa de quem está escrevendo a
 * tela.
 *
 * Assinaturas ANTIGAS não têm estas colunas — foram feitas antes da regra. Elas
 * devolvem `null` e cada chamador cai no texto legado, que descreve o método
 * declarado sem chamá-lo de confirmado.
 *
 * SEM IMPORTS de propósito (a formatação do telefone está copiada de
 * `formatters.ts`): módulo puro, para o `node --test` carregá-lo sem arrastar
 * cadeia nenhuma. É o que o resto do repositório faz com lógica testável.
 */

export type CanalConfirmado = 'whatsapp' | 'sms' | 'email' | 'google';

export interface IdentidadeConfirmada {
  canal: CanalConfirmado;
  /** Como o canal se chama no texto corrido: "WhatsApp", "SMS", "e-mail"… */
  rotuloCanal: string;
  /** O identificador pronto para leitura humana (telefone já formatado). */
  identificador: string;
  /** Instante em que o servidor deu a confirmação por boa. */
  em: string | null;
}

const ROTULOS: Record<CanalConfirmado, string> = {
  whatsapp: 'WhatsApp',
  sms: 'SMS',
  email: 'e-mail',
  google: 'conta Google',
};

/**
 * Telefone brasileiro vem do OTP em dígitos crus, às vezes com o 55 na frente
 * (WhatsApp) e às vezes sem (SMS). O relatório mostra os dois do mesmo jeito.
 */
const formatarIdentificador = (canal: CanalConfirmado, valor: string): string => {
  if (canal !== 'whatsapp' && canal !== 'sms') return valor;
  const digitos = valor.replace(/\D/g, '');
  const nacional = digitos.length > 11 && digitos.startsWith('55') ? digitos.slice(2) : digitos;
  const formatado =
    nacional.length === 11 ? `(${nacional.slice(0, 2)}) ${nacional.slice(2, 7)}-${nacional.slice(7)}`
    : nacional.length === 10 ? `(${nacional.slice(0, 2)}) ${nacional.slice(2, 6)}-${nacional.slice(6)}`
    : null;
  return formatado ? `+55 ${formatado}` : valor;
};

export const lerIdentidadeConfirmada = (s: {
  auth_verified_channel?: string | null;
  auth_verified_identifier?: string | null;
  auth_verified_at?: string | null;
} | null | undefined): IdentidadeConfirmada | null => {
  const canal = String(s?.auth_verified_channel || '').trim() as CanalConfirmado;
  const bruto = String(s?.auth_verified_identifier || '').trim();
  if (!canal || !bruto || !(canal in ROTULOS)) return null;
  return {
    canal,
    rotuloCanal: ROTULOS[canal],
    identificador: formatarIdentificador(canal, bruto),
    em: s?.auth_verified_at ?? null,
  };
};

/**
 * A linha da ficha — diz O QUE foi feito e PARA ONDE, sem esconder nada.
 *
 * O número aparece inteiro, de propósito. Mascarar ("+55 (65) 9****-8888")
 * protegeria de quê? O dossiê é o documento que serve de prova de que aquela
 * pessoa, naquele número, recebeu e devolveu um código — um número mascarado
 * não prova coisa nenhuma, e quem lê o dossiê já tem em mãos o CPF, o e-mail e
 * a assinatura do signatário.
 */
export const rotuloIdentidadeConfirmada = (id: IdentidadeConfirmada): string =>
  id.canal === 'google'
    ? `Conta Google autenticada: ${id.identificador}`
    : `Código de verificação enviado por ${id.rotuloCanal === 'e-mail' ? 'e-mail' : id.rotuloCanal} para ${id.identificador}, informado corretamente`;

/** A mesma coisa em uma linha, para a cadeia de eventos. */
export const fraseIdentidadeConfirmada = (id: IdentidadeConfirmada): string =>
  id.canal === 'google'
    ? `Identidade confirmada pela conta Google (${id.identificador})`
    : `Identidade confirmada por código de verificação enviado por ${id.rotuloCanal} para ${id.identificador}`;
