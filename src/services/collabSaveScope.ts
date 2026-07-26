/**
 * collabSaveScope
 * -----------------------------------------------------------------------------
 * QUEM grava o documento quando mais de uma pessoa está com ele aberto.
 *
 * O editor tem duas formas de gravar no Nextcloud, e a diferença entre elas é a
 * causa de "cada um salva só o que ele mesmo escreveu":
 *
 *  1. GRAVAÇÃO PELA SALA (co-edição ativa) — o servidor aplica no .docx TODAS
 *     as operações pendentes da sala, de todo mundo, e devolve a confirmação.
 *     Quem clicar em Salvar grava o trabalho do grupo inteiro. É o que
 *     queremos sempre que existir sala.
 *
 *  2. UPLOAD DA CÓPIA LOCAL (sem sala) — este navegador exporta o .docx que
 *     tem na tela e sobe por cima do arquivo. Se outra pessoa estiver editando
 *     o mesmo arquivo, o texto dela é APAGADO: sobrevive apenas o que estava
 *     nesta janela. Era exatamente o sintoma relatado, e acontecia quando a
 *     co-edição não subia (ex.: build de produção sem a URL do serviço) —
 *     cada navegador ficava com a sua cópia e o último a salvar vencia.
 *
 * Esta regra existe para que o caso 2 NUNCA aconteça em cima de um documento
 * que outra pessoa está editando. Sem sala e com gente no arquivo, o
 * salvamento na origem é recusado com explicação — "Salvar uma cópia"
 * continua liberado, então ninguém perde o próprio trabalho.
 */

export type CollabSaveDecision =
  /** Gravar pela sala: vale para todos os participantes. */
  | { kind: 'room-flush' }
  /** Subir a cópia local: ninguém mais está no arquivo. */
  | { kind: 'direct-upload' }
  /** Recusado: subir a cópia local apagaria o texto de quem está editando. */
  | { kind: 'blocked-others-editing'; peerNames: string[] };

export interface CollabSaveScopeInput {
  /** O serviço de co-edição está configurado neste ambiente? */
  collabEnabled: boolean;
  /** Este navegador está dentro da sala do documento? */
  inRoom: boolean;
  /**
   * O destino é a ORIGEM ATIVA do documento aberto (Salvar / Salvar como no
   * próprio arquivo). "Salvar uma cópia" grava em outro caminho e nunca
   * disputa o arquivo com ninguém.
   */
  savingActiveOrigin: boolean;
  /** Nomes das OUTRAS pessoas com este documento aberto agora. */
  otherEditors: string[];
}

export function decideCollabSave(input: CollabSaveScopeInput): CollabSaveDecision {
  // Cópia em outro caminho: não há arquivo disputado, sempre pode subir.
  if (!input.savingActiveOrigin) return { kind: 'direct-upload' };

  // Com sala, quem grava é o servidor — e a gravação é do grupo.
  if (input.inRoom) return { kind: 'room-flush' };

  // Sem sala, mas o serviço existe E há gente no arquivo: subir a cópia local
  // apagaria o trabalho dessas pessoas. Recusa com nomes para a mensagem.
  const peerNames = input.otherEditors.map((name) => name.trim()).filter(Boolean);
  if (input.collabEnabled && peerNames.length > 0) {
    return { kind: 'blocked-others-editing', peerNames };
  }

  // Sozinho no arquivo (ou co-edição desligada no ambiente): comportamento
  // de sempre — este navegador grava a própria versão.
  return { kind: 'direct-upload' };
}

/** "Ana", "Ana e João", "Ana, João e +2" — para a mensagem de recusa. */
export function describeOtherEditors(peerNames: string[]): string {
  const names = peerNames.map((name) => name.trim().split(/\s+/)[0]).filter(Boolean);
  if (names.length === 0) return 'Outra pessoa';
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} e ${names[1]}`;
  return `${names[0]}, ${names[1]} e mais ${names.length - 2}`;
}
