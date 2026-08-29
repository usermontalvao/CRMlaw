/**
 * Recupera POR ONDE o código de verificação foi enviado, quando o signatário
 * não carrega essa informação.
 *
 * O `public-sign-document` copia o canal do OTP consumido para
 * `signature_signers.auth_verified_channel` no ato da assinatura. Enquanto a
 * versão implantada da função for anterior a isso, o signatário fica sem o
 * canal — e o relatório, que não pode afirmar o que não sabe, escreve "código
 * enviado ao número", sem dizer WhatsApp.
 *
 * Só que o dado NÃO se perdeu: ele está em `signature_phone_otps.channel` (e
 * em `signature_email_otps`), com o instante da verificação. Este módulo faz a
 * junção que a função deixou de fazer, na hora de montar o relatório.
 *
 * É reconstrução, não invenção: o canal sai do registro do próprio servidor,
 * escolhido pela regra abaixo. O que muda é o momento da junção — leitura, em
 * vez de escrita.
 *
 * Sem imports, para os testes exercitarem a regra sem banco.
 */

export type CanalRecuperado = 'whatsapp' | 'sms' | 'email';

/** Uma verificação registrada pelo servidor. */
export interface VerificacaoRegistrada {
  signerId: string;
  canal: CanalRecuperado;
  /** Número ou e-mail que recebeu o código. */
  identificador: string;
  /** Instante em que o servidor deu o código por válido. */
  verificadoEm: string;
}

/** O que o relatório precisa saber sobre um signatário para fazer a junção. */
export interface SignatarioParaJuncao {
  id: string;
  signed_at?: string | null;
  auth_verified_channel?: string | null;
}

export interface CanalRecuperadoResultado {
  canal: CanalRecuperado;
  identificador: string;
  verificadoEm: string;
}

const emMs = (iso: string | null | undefined): number => {
  if (!iso) return Number.NaN;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? Number.NaN : t;
};

/**
 * Escolhe a verificação que corresponde a esta assinatura.
 *
 * Regra: a MAIS RECENTE que aconteceu ATÉ o instante da assinatura. É o código
 * que estava valendo quando a pessoa assinou. Verificações posteriores à
 * assinatura pertencem a outra tentativa e não podem ser atribuídas a esta.
 *
 * Devolve `null` — e o relatório mantém o texto sem canal — quando:
 *  · o signatário já tem canal próprio (o servidor gravou; nada a recuperar);
 *  · não há verificação nenhuma para ele;
 *  · nenhuma verificação é anterior à assinatura;
 *  · a assinatura não tem instante (não dá para dizer o que veio antes).
 */
export const recuperarCanal = (
  signatario: SignatarioParaJuncao,
  verificacoes: VerificacaoRegistrada[],
): CanalRecuperadoResultado | null => {
  if (String(signatario.auth_verified_channel || '').trim()) return null;

  const assinadoEm = emMs(signatario.signed_at);
  if (Number.isNaN(assinadoEm)) return null;

  let melhor: VerificacaoRegistrada | null = null;
  let melhorEm = Number.NEGATIVE_INFINITY;

  for (const v of verificacoes) {
    if (v.signerId !== signatario.id) continue;
    const em = emMs(v.verificadoEm);
    if (Number.isNaN(em)) continue;
    if (em > assinadoEm) continue; // posterior à assinatura: outra tentativa
    if (em > melhorEm) {
      melhor = v;
      melhorEm = em;
    }
  }

  if (!melhor) return null;
  if (!melhor.identificador.trim()) return null;

  return {
    canal: melhor.canal,
    identificador: melhor.identificador,
    verificadoEm: melhor.verificadoEm,
  };
};

/**
 * Aplica a recuperação a um signatário, devolvendo uma CÓPIA com os campos que
 * a função deveria ter gravado. Quem não precisa de recuperação volta intacto.
 */
export const comCanalRecuperado = <T extends SignatarioParaJuncao>(
  signatario: T,
  verificacoes: VerificacaoRegistrada[],
): T => {
  const achado = recuperarCanal(signatario, verificacoes);
  if (!achado) return signatario;
  return {
    ...signatario,
    auth_verified_channel: achado.canal,
    auth_verified_identifier: achado.identificador,
    auth_verified_at: achado.verificadoEm,
  };
};
