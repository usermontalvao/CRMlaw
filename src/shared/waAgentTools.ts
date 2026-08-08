/**
 * Catálogo de gatilhos — cópia de EXIBIÇÃO para a tela.
 *
 * A autoridade é `supabase/functions/_shared/wa-agent-tools.ts`, que roda no
 * motor: é ela que decide o que a IA pode fazer. Esta cópia existe só porque o
 * `rootDir` do tsconfig é `src/`, e relaxá-lo mexeria no build inteiro do CRM
 * por causa de um import.
 *
 * Só metadado de tela mora aqui — nome, risco, se executa e para que serve.
 * Nenhuma regra de decisão: marcar um gatilho aqui não o libera de verdade, e
 * um gatilho que só exista aqui será BARRADO pelo motor e aparecerá assim no
 * log de decisões.
 *
 * A divergência é guardada por `wa-agent-tools.mirror.test.ts`, que quebra o
 * `npm test` se as duas listas saírem de sincronia.
 */

export type WaToolRisk = 'baixo' | 'medio' | 'alto';

/** Ver o tipo homônimo no catálogo do motor: `bloqueia` segura a ação até o sim; `reserva` cria pendência reversível na hora. */
export type WaToolApproval = 'bloqueia' | 'reserva';

export interface WaToolDisplay {
  name: string;
  mention: string;
  risk: WaToolRisk;
  implemented: boolean;
  /** Presente só nos gatilhos que passam pela fila de aprovação. */
  approval?: WaToolApproval;
  description: string;
}

export const WA_AGENT_TOOLS_DISPLAY: WaToolDisplay[] = [
  { name: 'registrar_dados', mention: '@RegistrarDados', risk: 'baixo', implemented: true,
    description: 'Grava o que o cliente informou (nome, CPF, o que aconteceu, datas).' },
  { name: 'salvar_nome', mention: '@SalvarNome', risk: 'baixo', implemented: true,
    description: 'Corrige o nome do contato quando ele se identifica.' },
  { name: 'qualificar', mention: '@Qualificar', risk: 'medio', implemented: true,
    description: 'Registra se o caso serve para o escritório, com o motivo.' },
  { name: 'mover_etapa', mention: '@MoverEtapa', risk: 'medio', implemented: true,
    description: 'Avança a conversa para outra etapa do funil do canal.' },
  { name: 'pedir_documentos', mention: '@PedirDocumentos', risk: 'medio', implemented: true,
    description: 'Abre solicitação de documentos. A conferência do que chegar é automática.' },
  { name: 'enviar_template', mention: '@EnviarTemplate', risk: 'medio', implemented: true,
    description: 'Envia uma mensagem pronta do escritório. É assim que a proposta é apresentada.' },
  { name: 'agendar_followup', mention: '@AgendarFollowup', risk: 'medio', implemented: true,
    description: 'Agenda cobrança para quando o cliente ficar sem responder.' },
  { name: 'transferir_humano', mention: '@TransferirHumano', risk: 'baixo', implemented: true,
    description: 'Passa para uma pessoa do escritório e para de responder.' },
  { name: 'passar_para_agente', mention: '@PassarPara', risk: 'medio', implemented: true,
    description: 'Entrega a conversa para outro agente especializado.' },
  { name: 'resumir_atendimento', mention: '@Resumir', risk: 'baixo', implemented: true,
    description: 'Escreve o resumo do caso como nota interna.' },
  { name: 'parar_ia', mention: '@PararIA', risk: 'baixo', implemented: true,
    description: 'Desliga o atendimento automático nesta conversa.' },
  { name: 'enviar_contrato', mention: '@EnviarContrato', risk: 'alto', implemented: true, approval: 'bloqueia',
    description: 'Envia o link do contrato. O cliente preenche os próprios dados e assina pelo link.' },
  { name: 'marcar_reuniao', mention: '@MarcarReuniao', risk: 'alto', implemented: true, approval: 'reserva',
    description: 'Propõe reunião. Entra na agenda como pendente até o responsável autorizar.' },
  { name: 'consultar_processo', mention: '@ConsultarProcesso', risk: 'baixo', implemented: true,
    description: 'Consulta os processos do cliente vinculado à conversa.' },
];
