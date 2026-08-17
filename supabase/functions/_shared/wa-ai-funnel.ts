/**
 * A etapa do funil que a escada da IA alcançou — REGRAS PURAS.
 *
 * ATENÇÃO — ESTE ARQUIVO EXISTE EM DUAS CÓPIAS BYTE A BYTE:
 *   src/utils/waAiFunnel.ts
 *   supabase/functions/_shared/wa-ai-funnel.ts
 * Ao mexer em um, COPIE O ARQUIVO INTEIRO para o outro; `waAiFunnel.test.ts`
 * compara os dois byte a byte. SEM IMPORTS de propósito.
 *
 * POR QUE ISTO EXISTE
 * Existiam dois gatilhos de funil no banco (`wa_apply_channel_initial_funnel` e
 * `wa_apply_funnel_entry_stage`) e os dois só posicionam a conversa na etapa de
 * ENTRADA — ambos começam com "se já tem etiqueta, não encosta". Depois disso
 * nada mais mexe. Em 14/08/2026 a conversa 358ea6b3 ficou em "Aguardando
 * Documentos" enquanto os documentos chegavam, o KIT era enviado, assinado e o
 * atendimento era transferido: o quadro mostrava um estado de vinte minutos
 * atrás.
 *
 * POR QUE POR RÓTULO, E NÃO POR CHAVE
 * As etapas são do usuário. No canal "Comercial" as chaves são legíveis
 * (`aguardando_documentos`), no canal "Pedro" são `nova_etapa_3` e
 * `nova_etapa_4`. Amarrar em chave funcionaria num canal e falharia no outro.
 * O rótulo é o que o escritório escreveu para significar alguma coisa.
 *
 * NA DÚVIDA, NÃO MEXE. Etapa que não casa com nada é etapa que o escritório
 * usa para outra finalidade, e mover o card de alguém é pior do que deixá-lo
 * onde está.
 */

/** Os degraus que o BACKEND sabe ter alcançado. Nenhum vem do modelo. */
export type WaAiFunnelMilestone =
  | 'documentos_solicitados'
  | 'documentos_completos'
  | 'kit_enviado'
  | 'kit_assinado'
  | 'transferido'
  | 'desqualificado';

export interface WaAiFunnelStage {
  stageKey: string;
  label: string;
  labels?: string[] | null;
  position: number;
  isActive?: boolean | null;
}

function simples(value: string | null | undefined): string {
  return String(value || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * O que cada degrau procura no rótulo da etapa, em ordem de preferência.
 * A primeira expressão que casar decide.
 */
const PISTAS: Record<WaAiFunnelMilestone, string[]> = {
  documentos_solicitados: ['aguardando documento', 'aguardando docs', 'documento'],
  documentos_completos: ['documento recebid', 'documento complet', 'documentos ok'],
  kit_enviado: ['aguardando assinatura', 'assinatura'],
  kit_assinado: ['assinado', 'finalizado', 'concluido'],
  transferido: ['transferid', 'em atendimento', 'atendimento'],
  desqualificado: ['nao qualificado', 'desqualificad', 'descartad'],
};

/** Todo texto pelo qual uma etapa pode ser reconhecida. */
function textosDaEtapa(stage: WaAiFunnelStage): string[] {
  return [stage.label, ...(stage.labels || [])].map(simples).filter(Boolean);
}

/**
 * A etapa configurada que corresponde a este degrau, ou null.
 *
 * `null` é resultado legítimo e comum: o funil do escritório pode simplesmente
 * não ter uma etapa para "KIT enviado". Nesse caso a conversa fica onde está.
 */
export function pickWaAiFunnelStage(
  milestone: WaAiFunnelMilestone, stages: WaAiFunnelStage[],
): WaAiFunnelStage | null {
  const ativas = (stages || []).filter(item => item && item.isActive !== false);
  for (const pista of PISTAS[milestone] || []) {
    const achada = ativas.find(stage => textosDaEtapa(stage).some(texto => texto.indexOf(pista) !== -1));
    if (achada) return achada;
  }
  return null;
}

/** A etiqueta que representa a etapa: a primeira da lista, ou o rótulo. */
export function waAiFunnelLabelFor(stage: WaAiFunnelStage): string {
  const primeira = (stage.labels || []).map(item => String(item || '').trim()).filter(Boolean)[0];
  return primeira || String(stage.label || '').trim();
}

/**
 * A conversa deve andar para esta etapa?
 *
 * TRÊS recusas, e cada uma protege alguém:
 *   - dono humano: quem assumiu a conversa manda no card dela. A única exceção
 *     é a própria transferência, que é quem PÕE o dono;
 *   - andar para trás: o atendente que empurrou o card adiante não pode vê-lo
 *     voltar porque um gancho atrasado chegou depois;
 *   - já está lá: escrever de novo só geraria evento de tempo real à toa.
 */
export function shouldMoveWaAiFunnel(input: {
  milestone: WaAiFunnelMilestone;
  target: WaAiFunnelStage | null;
  currentLabels?: string[] | null;
  stages: WaAiFunnelStage[];
  hasHumanOwner?: boolean;
}): boolean {
  const alvo = input.target;
  if (!alvo) return false;
  if (input.hasHumanOwner && input.milestone !== 'transferido') return false;

  const atuais = (input.currentLabels || []).map(simples).filter(Boolean);
  if (atuais.length === 0) return true;
  if (textosDaEtapa(alvo).some(texto => atuais.indexOf(texto) !== -1)) return false;

  // A etapa em que a conversa está hoje, para não recuar.
  const atual = (input.stages || [])
    .filter(stage => textosDaEtapa(stage).some(texto => atuais.indexOf(texto) !== -1))
    .sort((a, b) => b.position - a.position)[0];
  // Etiqueta que não é etapa nenhuma (posta à mão pelo atendente) não bloqueia.
  if (!atual) return true;
  return alvo.position > atual.position;
}
