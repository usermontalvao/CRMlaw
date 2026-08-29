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
  /** Como o canal se chama no texto corrido. */
  rotuloCanal: string;
  /** O identificador pronto para leitura humana (telefone já formatado). */
  identificador: string;
  /** Instante em que o servidor deu a confirmação por boa. */
  em: string | null;
}

/** O canal como ele se chama dentro da frase. Curto de propósito: o leitor do
 *  documento reconhece "WhatsApp", não "WhatsApp profissional do escritório". */
const CANAL_CURTO: Record<CanalConfirmado, string> = {
  whatsapp: 'WhatsApp',
  sms: 'SMS',
  email: 'e-mail',
  google: 'conta Google',
};

const ROTULOS: Record<CanalConfirmado, string> = {
  whatsapp: 'WhatsApp profissional do escritório',
  sms: 'SMS',
  email: 'e-mail',
  google: 'conta Google',
};

/**
 * Telefone brasileiro vem do OTP em dígitos crus, às vezes com o 55 na frente
 * (WhatsApp) e às vezes sem (SMS). O relatório mostra os dois do mesmo jeito.
 */
export const formatarTelefoneConfirmado = (valor: string | null | undefined): string => {
  const bruto = String(valor ?? '').trim();
  if (!bruto) return '';
  const digitos = bruto.replace(/\D/g, '');
  const nacional = digitos.length > 11 && digitos.startsWith('55') ? digitos.slice(2) : digitos;
  const formatado =
    nacional.length === 11 ? `(${nacional.slice(0, 2)}) ${nacional.slice(2, 7)}-${nacional.slice(7)}`
    : nacional.length === 10 ? `(${nacional.slice(0, 2)}) ${nacional.slice(2, 6)}-${nacional.slice(6)}`
    : null;
  return formatado ? `+55 ${formatado}` : bruto;
};

const formatarIdentificador = (canal: CanalConfirmado, valor: string): string =>
  canal === 'whatsapp' || canal === 'sms' ? formatarTelefoneConfirmado(valor) : valor;

/**
 * Como descrever a autenticação por código quando o canal NÃO está registrado.
 *
 * Uma constante, e não a frase solta em cada tela: o relatório comparava este
 * texto por igualdade de string para escolher o rótulo do chip, então trocar a
 * frase num lugar e não no outro quebrava o rótulo em silêncio.
 */
export const AUTENTICACAO_OTP_SEM_CANAL = 'Autenticação realizada por código enviado ao número informado';

/** A mesma frase com o número já formatado. */
export const autenticacaoOtpSemCanal = (telefone?: string | null): string => {
  const numero = formatarTelefoneConfirmado(telefone);
  return numero
    ? `Autenticação realizada por código enviado ao número ${numero}`
    : AUTENTICACAO_OTP_SEM_CANAL;
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
    ? `Autenticação realizada pela conta Google ${id.identificador}`
    : `Autenticação realizada por código enviado via ${CANAL_CURTO[id.canal]} para ${id.identificador}`;

/** A mesma coisa em uma linha, para a cadeia de eventos. */
export const fraseIdentidadeConfirmada = (id: IdentidadeConfirmada): string =>
  id.canal === 'google'
    ? `Autenticação realizada pela conta Google ${id.identificador}`
    : `Autenticação realizada por código enviado via ${CANAL_CURTO[id.canal]} para ${id.identificador}`;

/**
 * Descrição curta para o campo "Autenticação" das fichas e relatórios.
 *
 * Diz o QUE foi feito (código de verificação) e POR ONDE (o canal real). Os
 * textos antigos erravam nos dois: "Autenticação via Telefone" descrevia só o
 * dado de contato, e "SMS" nomeava um canal que muitas vezes não foi o usado.
 */
export const resumoIdentidadeConfirmada = (id: IdentidadeConfirmada): string => {
  if (id.canal === 'google') return `Autenticação realizada via conta Google (${id.identificador})`;
  if (id.canal === 'whatsapp') return `Autenticação realizada via WhatsApp (${id.identificador})`;
  if (id.canal === 'sms') return `Autenticação realizada via SMS (${id.identificador})`;
  return `Autenticação realizada via e-mail (${id.identificador})`;
};

/**
 * O instante em que o servidor deu a confirmação por boa.
 *
 * Só sai quando existe de verdade: assinatura antiga não tem esta coluna, e um
 * documento de prova não pode inventar a hora de um ato que ele não registrou.
 */
export const instanteConfirmacao = (
  id: IdentidadeConfirmada,
  formatar: (iso: string) => string,
): string | null => (id.em ? formatar(id.em) : null);

/**
 * Como chamar o identificador no detalhamento.
 *
 * "Telefone" e "E-mail" descrevem um dado de CONTATO, que qualquer um pode
 * declarar. O que está sendo exibido aqui é outra coisa: o endereço que
 * recebeu um código e o devolveu certo. O rótulo tem de dizer isso.
 */
export const rotuloIdentificadorConfirmado = (id: IdentidadeConfirmada): string =>
  id.canal === 'whatsapp' || id.canal === 'sms' ? 'Número verificado' : 'E-mail verificado';
