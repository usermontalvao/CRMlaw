/**
 * Qual assinatura vai em qual campo.
 *
 * É a regra mais delicada da montagem inteira, e o motivo é simples: o erro
 * possível aqui não é estético. Estampar a imagem de uma pessoa no campo de
 * outra produz um documento que atribui uma manifestação de vontade a quem não
 * a fez — e ele sai bonito, assinado, sem nada que denuncie.
 *
 * Por isso a decisão foi separada do desenho: aqui não há pdf-lib nem imagem,
 * só a escolha, com nome. Quem desenha recebe um veredito explícito e não tem
 * como improvisar.
 *
 * Espelha o laço de `generateSignedPdf` em `pdfSignature.service.ts`.
 */

/** O que fazer com um campo. */
export type Decisao =
  /** Estampar a imagem DESTE signatário. */
  | { tipo: 'assinatura-do-titular'; signerId: string }
  /**
   * O campo é de alguém que ainda NÃO assinou. Não se desenha nada — e nunca a
   * imagem de outra pessoa. O envelope segue pendente até essa pessoa assinar.
   */
  | { tipo: 'pular-ainda-nao-assinou'; signerId: string }
  /**
   * Campo sem dono, ou com dono que não existe mais no envelope. Vale a imagem
   * de reserva (quem está assinando agora). Não é o caso feliz: um `signer_id`
   * órfão é dado inconsistente, e a alternativa — deixar o campo em branco —
   * produziria um documento com espaço de assinatura vazio.
   */
  | { tipo: 'assinatura-de-reserva'; motivo: 'sem-dono' | 'dono-desconhecido' }
  /** Não há imagem nenhuma para usar. Nada é desenhado. */
  | { tipo: 'pular-sem-imagem' };

export type EstadoDosAssinantes = {
  /** Ids de quem JÁ assinou e tem imagem embutida. */
  comAssinatura: ReadonlySet<string>;
  /** Ids de TODOS os signatários do envelope, tenham assinado ou não. */
  conhecidos: ReadonlySet<string>;
  /** Existe imagem de reserva (a de quem está assinando agora)? */
  temReserva: boolean;
};

/**
 * Decide um campo.
 *
 * A ordem dos testes é a regra, e o degrau do meio é o que protege a pessoa:
 *
 *   1. o dono do campo já assinou           → usa a imagem dele;
 *   2. o dono existe mas AINDA NÃO assinou   → não desenha NADA;
 *   3. o dono não existe (ou não há dono)    → imagem de reserva.
 *
 * Sem o passo 2, um campo de signatário pendente cairia no passo 3 e receberia
 * a assinatura de quem estivesse assinando naquele instante. Num envelope com
 * dois signatários, o primeiro a assinar assinaria pelos dois.
 */
export function decidirCampo(
  signerIdDoCampo: string | null | undefined,
  estado: EstadoDosAssinantes,
): Decisao {
  const dono = typeof signerIdDoCampo === 'string' && signerIdDoCampo.length > 0
    ? signerIdDoCampo
    : null;

  if (dono) {
    if (estado.comAssinatura.has(dono)) {
      return { tipo: 'assinatura-do-titular', signerId: dono };
    }
    if (estado.conhecidos.has(dono)) {
      return { tipo: 'pular-ainda-nao-assinou', signerId: dono };
    }
    return estado.temReserva
      ? { tipo: 'assinatura-de-reserva', motivo: 'dono-desconhecido' }
      : { tipo: 'pular-sem-imagem' };
  }

  return estado.temReserva
    ? { tipo: 'assinatura-de-reserva', motivo: 'sem-dono' }
    : { tipo: 'pular-sem-imagem' };
}

/** `true` quando a decisão manda desenhar alguma coisa. */
export function vaiDesenhar(decisao: Decisao): boolean {
  return decisao.tipo === 'assinatura-do-titular' || decisao.tipo === 'assinatura-de-reserva';
}

/**
 * O envelope precisa da posição de reserva (canto da última página)?
 *
 * Só quando NENHUM campo produziu desenho. Esta é a correção de um defeito
 * antigo, e vale deixar escrito: antes a reserva disparava sempre que um
 * `signer_id` não casava, jogando a assinatura para a última página MESMO com
 * campos corretamente posicionados no documento. O gatilho é "não desenhei
 * nada em lugar nenhum", não "um campo falhou".
 */
export function precisaDaPosicaoDeReserva(
  decisoes: readonly Decisao[],
  temImagemDeAssinatura: boolean,
): boolean {
  if (!temImagemDeAssinatura) return false;
  return !decisoes.some(vaiDesenhar);
}
