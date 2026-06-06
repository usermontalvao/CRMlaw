/**
 * Service de queries do Portal do Cliente
 *
 * Todas as queries passam pelas RPCs `portal_*` (SECURITY DEFINER) no Postgres,
 * que validam o portal_user_id e filtram pelos dados do cliente. Isso evita
 * abrir RLS para a role `anon`.
 *
 * Assinatura: cada método recebe `portalUserId` (UUID do registro em
 * `client_portal_users`), obtido na sessão após o login.
 */
import { supabasePortal as supabase } from '../lib/supabasePortal';
import { clientAuthService } from './clientAuth.service';

export interface DocumentUpload {
  id: string;
  processing_status: 'pending' | 'processing' | 'ready' | 'error';
  review_status: 'pending' | 'approved' | 'rejected';
  rejection_reason?: string | null;
  final_name?: string | null;
  ai_document_type?: string | null;
  pages_count?: number | null;
  uploaded_at: string;
}

export interface DocumentRequestItem {
  id: string;
  label: string;
  description?: string | null;
  required: boolean;
  sort_order: number;
  status: 'pending' | 'uploaded' | 'approved' | 'rejected';
  upload?: DocumentUpload | null;
}

export interface DocumentRequest {
  id: string;
  title: string;
  description?: string | null;
  due_date?: string | null;
  status: 'pending' | 'partial' | 'complete' | 'reviewed' | 'cancelled';
  created_at: string;
  items: DocumentRequestItem[];
}

export interface ClientProfile {
  cpf?: string | null;
  full_name?: string | null;
  email?: string | null;
  phone?: string | null;
  birth_date?: string | null;
  marital_status?: string | null;
  profession?: string | null;
  nationality?: string | null;
  address_street?: string | null;
  address_number?: string | null;
  address_neighborhood?: string | null;
  address_city?: string | null;
  address_state?: string | null;
  address_zip_code?: string | null;
}

export interface ProfileUpdateRequest {
  id: string;
  changes: ClientProfile;
  status: 'pending' | 'approved' | 'rejected';
  rejection_reason?: string | null;
  requested_at: string;
  reviewed_at?: string | null;
}

const SESSION_KEYWORD = /Sessão de portal inválida/i;

// Erros estruturais (migration pendente) — ruído conhecido, silenciar.
const STRUCTURAL_ERROR =
  /(column .* does not exist|relation .* does not exist|function .* does not exist|undefined column|schema cache)/i;

let warnedAboutMigration = false;
function warnMigrationOnce(where: string, message: string): void {
  if (warnedAboutMigration) return;
  warnedAboutMigration = true;
  // Um único aviso por sessão — não polui o console.
  console.warn(
    `[Portal] Migration do portal não aplicada ou desatualizada (${where}: ${message}). ` +
      `Aplique 'supabase/migrations/20260601000004_client_portal_final.sql' no Supabase para corrigir.`
  );
}

const AI_FAILURE_COOLDOWN_MS = 60_000;
const aiFailureUntil = new Map<string, number>();

function isAiCoolingDown(key: string): boolean {
  const until = aiFailureUntil.get(key) || 0;
  return until > Date.now();
}

function startAiCooldown(key: string): void {
  aiFailureUntil.set(key, Date.now() + AI_FAILURE_COOLDOWN_MS);
}

/**
 * Detecta erros de sessão inválida e força logout + reload.
 * Cobre o caso de localStorage com user.id inexistente no banco.
 */
function handlePortalError(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  const msg = error.message || '';
  if (SESSION_KEYWORD.test(msg)) {
    clientAuthService.logout();
    if (typeof window !== 'undefined') {
      window.location.href = '/portal';
    }
    return true;
  }
  return false;
}

/**
 * Trata o erro de uma RPC do portal:
 *  - sessão inválida → logout
 *  - migration pendente (erro estrutural) → silencia, log único, devolve fallback
 *  - outros → log normal
 * Retorna true se foi um erro "esperado" que o caller deve tratar como vazio.
 */
function handleRpcError(where: string, error: { message?: string; code?: string }): boolean {
  if (handlePortalError(error)) return true;
  const msg = error.message || '';
  if (STRUCTURAL_ERROR.test(msg)) {
    warnMigrationOnce(where, msg);
    return true;
  }
  console.warn(`[Portal] ${where}:`, msg);
  return true;
}

class ClientPortalService {
  /**
   * Lista processos do cliente
   */
  async listProcesses(portalUserId: string) {
    const { data, error } = await supabase.rpc('portal_list_processes', {
      p_portal_user_id: portalUserId,
    });
    if (error) {
      handleRpcError('listProcesses', error);
      return [];
    }
    return (data as unknown[]) || [];
  }

  /**
   * Contato oficial do escritório (advogado responsável) — para o banner
   * anti-golpe. Retorna { name, phone, oab } ou null.
   */
  async getOfficeContact(): Promise<{ name?: string; phone?: string; oab?: string } | null> {
    const { data, error } = await supabase.rpc('portal_office_contact');
    if (error) {
      handleRpcError('getOfficeContact', error);
      return null;
    }
    return (data as { name?: string; phone?: string; oab?: string }) || null;
  }

  /**
   * Explica um andamento específico em linguagem simples (IA), USANDO O CONTEXTO
   * de toda a linha do tempo do processo — assim "Decurso de Prazo" é explicado
   * em relação ao que veio antes (ex: prazo da defesa, do recurso, etc.).
   */
  async explainMovement(params: {
    target: { nome?: string; complemento?: string; data?: string };
    timeline: { nome?: string; data?: string }[];
    statusLabel?: string;
    area?: string | null;
  }): Promise<string | null> {
    if (isAiCoolingDown('explainMovement')) return null;
    const fmt = (d?: string) => (d ? new Date(d).toLocaleDateString('pt-BR') : 's/data');
    // Ordena do mais antigo para o mais recente (cronológico) e marca o alvo
    const chrono = [...params.timeline].sort(
      (a, b) => new Date(a.data || 0).getTime() - new Date(b.data || 0).getTime()
    );
    const targetKey = `${params.target.data || ''}|${params.target.nome || ''}`;
    let marked = false;
    const lines = chrono.slice(0, 40).map((m) => {
      const isTarget = !marked && `${m.data || ''}|${m.nome || ''}` === targetKey;
      if (isTarget) marked = true;
      return `${fmt(m.data)}: ${m.nome || ''}${isTarget ? '   <<< EXPLICAR ESTE' : ''}`;
    }).join('\n');

    const content =
      (params.area ? `Processo na área de ${params.area}. ` : '') +
      (params.statusLabel ? `Situação atual: ${params.statusLabel}.\n\n` : '\n') +
      `LINHA DO TEMPO (mais antigo → mais recente):\n${lines}\n\n` +
      (params.target.complemento
        ? `Teor do andamento marcado:\n${params.target.complemento.slice(0, 1500)}\n\n`
        : '') +
      `Explique APENAS o andamento marcado com "<<< EXPLICAR ESTE".`;

    try {
      const { data, error } = await supabase.functions.invoke('openai-proxy', {
        body: {
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content:
                'Você é um assistente jurídico que explica andamentos de processos para CLIENTES LEIGOS, em português claro e acolhedor, sem juridiquês. Você recebe a linha do tempo completa do processo e deve explicar APENAS o andamento marcado, SEMPRE usando o contexto dos andamentos anteriores para deixar claro A QUE ele se refere. Exemplo: um "Decurso de Prazo" logo após uma citação significa que o prazo da parte contrária para se defender terminou — explique assim, conectando ao evento anterior. Responda em 1 a 2 frases curtas. REGRA CRÍTICA DE TOM: nunca dê a entender que o advogado errou, se atrasou, perdeu um prazo ou foi negligente — apresente sempre o advogado como atuante e no controle, e atribua eventuais demoras ao ritmo natural da Justiça. Se nenhuma ação do cliente for necessária, tranquilize dizendo que o advogado cuida de tudo. Não invente fatos além do que está na linha do tempo.',
            },
            { role: 'user', content },
          ],
        },
      });
      if (error) {
        startAiCooldown('explainMovement');
        handleRpcError('explainMovement', error);
        return null;
      }
      const text = (data as { choices?: { message?: { content?: string } }[] })
        ?.choices?.[0]?.message?.content?.trim();
      return text || null;
    } catch {
      startAiCooldown('explainMovement');
      return null;
    }
  }

  /**
   * Explica o PROCESSO INTEIRO em linguagem simples (IA), para o cliente leigo.
   * Recebe contexto resumido (situação atual + últimos andamentos) e devolve
   * um panorama acolhedor: o que já aconteceu, em que pé está e o que esperar.
   */
  async explainProcess(params: {
    statusKey: string;
    statusLabel: string;
    statusUpdatedAt?: string | null;
    processCode?: string | null;
    court?: string | null;
    distributedAt?: string | null;
    responsibleLawyer?: string | null;
    area?: string | null;
    lawyerNotes?: string;
    movements: { nome?: string; data?: string; detalhe?: string }[];
    publications?: { data?: string; tipo?: string; orgao?: string; texto?: string }[];
    appointments?: { title?: string; event_type?: string; start_at?: string; event_mode?: string | null }[];
    deadlines?: { title?: string; due_date?: string; status?: string; priority?: string }[];
    timeline?: { date: string; source: string; title: string; description?: string; marco?: boolean; rawText?: string }[];
  }): Promise<string | null> {
    if (isAiCoolingDown('explainProcess')) return null;
    const fmt = (d?: string | null) => (d ? new Date(d).toLocaleDateString('pt-BR') : '');
    const fmtDt = (d?: string) => {
      if (!d) return '';
      const dt = new Date(d);
      return dt.toLocaleDateString('pt-BR') + (d.includes('T') ? ` às ${dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : '');
    };

    // Determina limite por publicação baseado no volume total
    const allPubs = (params.publications || [])
      .filter(p => p.texto && p.texto.trim().length > 10)
      .sort((a, b) => new Date(a.data || 0).getTime() - new Date(b.data || 0).getTime());
    // 4 mais antigas (sentença/valor) + 8 mais recentes (estado atual)
    const selectedPubs = allPubs.length <= 12
      ? allPubs
      : [...allPubs.slice(0, 4), ...allPubs.slice(-8)];
    const totalPubChars = selectedPubs.reduce((s, p) => s + (p.texto?.length || 0), 0);
    // Se muito texto, reduz limite por publicação proporcionalmente (mín 800, máx 2500)
    const perPubLimit = Math.max(800, Math.min(2500, Math.floor(18000 / Math.max(selectedPubs.length, 1))));

    const clip = (t: string, maxLen = perPubLimit) => {
      const s = (t || '').replace(/\s+/g, ' ').trim();
      if (s.length <= maxLen) return s;
      const half = Math.floor(maxLen / 2);
      return `${s.slice(0, half)}\n[...]\n${s.slice(-half)}`;
    };

    const pubs = selectedPubs
      .map((p) => `=== ${fmt(p.data)} — ${p.tipo || 'Publicação'}${p.orgao ? ` (${p.orgao})` : ''} ===\n${clip(p.texto || '')}`)
      .join('\n\n');

    // ── Tramitação processual (DataJud) ──
    // Os movimentos contam a história do caso. Selecionamos de forma inteligente:
    // TODOS os marcos decisivos + os recentes, em ordem cronológica (antigo→recente).
    const MARCO_KEYWORDS = [
      'procedente', 'procedência', 'improcedente', 'improcedência', 'parcialmente',
      'sentença', 'senten', 'acórdão', 'acordao', 'homolog', 'acordo',
      'trânsito em julgado', 'transito em julgado', 'cumprimento', 'execução', 'execucao',
      'liquidação', 'liquidacao', 'recurso', 'apelação', 'apelacao', 'agravo', 'embargos',
      'arquiv', 'extinção', 'extincao', 'distribuição', 'distribuicao',
      'citação', 'citacao', 'audiência', 'audiencia', 'pagamento', 'penhora', 'alvará', 'alvara',
      'tutela', 'liminar', 'designada', 'expedição de alvará',
    ];
    const isMarco = (nome: string) => {
      const n = (nome || '').toLowerCase();
      return MARCO_KEYWORDS.some((k) => n.includes(k));
    };

    const movsAsc = [...params.movements].sort(
      (a, b) => new Date(a.data || 0).getTime() - new Date(b.data || 0).getTime()
    );
    const marcos = movsAsc.filter((m) => isMarco(m.nome || ''));
    const recentes = movsAsc.slice(-25); // últimos 25 (contexto recente)
    // União sem duplicar, preservando ordem cronológica
    const selecionados = movsAsc.filter(
      (m) => marcos.includes(m) || recentes.includes(m)
    );

    const skeleton = selecionados
      .map((m) => {
        const marca = isMarco(m.nome || '') ? '★ ' : '  ';
        const det = m.detalhe ? ` — ${m.detalhe}` : '';
        return `${marca}${fmt(m.data)}: ${m.nome || ''}${det}`;
      })
      .join('\n');

    const totalMovs = params.movements.length;

    const TYPE_LABEL: Record<string, string> = {
      hearing: 'Audiência', pericia: 'Perícia', meeting: 'Reunião', deadline: 'Prazo',
    };
    const apts = (params.appointments || [])
      .sort((a, b) => new Date(a.start_at || 0).getTime() - new Date(b.start_at || 0).getTime())
      .map((a) => {
        const tipo = TYPE_LABEL[a.event_type || ''] || a.event_type || 'Compromisso';
        const modo = a.event_mode ? ` (${a.event_mode})` : '';
        return `- ${fmtDt(a.start_at)}: ${tipo}${modo} — ${a.title || ''}`;
      }).join('\n');

    const dlsPendentes = (params.deadlines || [])
      .filter(d => d.status === 'pendente')
      .sort((a, b) => new Date(a.due_date || 0).getTime() - new Date(b.due_date || 0).getTime())
      .map(d => `- [PENDENTE] Vence ${fmt(d.due_date)}: ${d.title || ''}${d.priority === 'alta' ? ' [URGENTE]' : ''}`)
      .join('\n');

    const dlsCumpridos = (params.deadlines || [])
      .filter(d => d.status === 'cumprido')
      .sort((a, b) => new Date(a.due_date || 0).getTime() - new Date(b.due_date || 0).getTime())
      .map(d => `- [CUMPRIDO] ${fmt(d.due_date)}: ${d.title || ''}`)
      .join('\n');

    const dls = [dlsCumpridos, dlsPendentes].filter(Boolean).join('\n');

    // ── Linha do Tempo Unificada (quando fornecida) ──────────────────────────
    // Usa a mesma timeline que o cliente vê na aba "Linha do Tempo" do portal:
    // DataJud + DJEN + Prazos + Compromissos, em ordem cronológica.
    const SOURCE_LABEL: Record<string, string> = {
      datajud: 'DataJud', djen: 'DJEN', prazo: 'Prazo', calendario: 'Agenda',
    };
    const tl = (params.timeline || []).slice().sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    // Para eventos DJEN na timeline, inclui o texto integral (clippado)
    const tlLines = tl.map(e => {
      const src = SOURCE_LABEL[e.source] || e.source;
      const marco = e.marco ? ' ★' : '';
      const base = `[${src}] ${fmt(e.date)}${marco}: ${e.title}`;
      if (e.description && e.source !== 'djen') return `${base} — ${e.description}`;
      if (e.rawText) return `${base}\n    ${clip(e.rawText, 1200)}`;
      return base;
    }).join('\n');

    // Monta o conteúdo final — guard simples: truncar no total a 28k chars
    const rawParts = [
      `NÚMERO DO PROCESSO: ${params.processCode || 'não informado'}`,
      params.court          ? `VARA/TRIBUNAL: ${params.court}` : '',
      params.distributedAt  ? `DISTRIBUÍDO EM: ${fmt(params.distributedAt)}` : '',
      params.area           ? `ÁREA: ${params.area}` : '',
      `STATUS INTERNO DO ESCRITÓRIO: ${params.statusKey}`,
      `SITUAÇÃO ATUAL: ${params.statusLabel}`,
      params.statusUpdatedAt ? `STATUS ATUALIZADO EM: ${fmtDt(params.statusUpdatedAt)}` : '',
      params.lawyerNotes    ? `\nOBSERVAÇÕES DO ADVOGADO:\n${params.lawyerNotes}` : '',
      // Quando há timeline unificada, usa ela (mais completa). Senão, cai nos arrays separados.
      tlLines
        ? `\nLINHA DO TEMPO COMPLETA (${tl.length} eventos — DataJud ★=marcos + DJEN com texto + Prazos + Agenda; ordem cronológica antigo→recente):\n${tlLines}`
        : [
            skeleton ? `\nTRAMITAÇÃO PROCESSUAL (${totalMovs} andamentos; ★=marco; cronológico):\n${skeleton}` : '',
            apts     ? `\nCOMPROMISSOS:\n${apts}` : '',
            dls      ? `\nPRAZOS:\n${dls}` : '',
            pubs     ? `\nPUBLICAÇÕES DJEN:\n\n${pubs}` : '',
          ].filter(Boolean).join('\n'),
    ].filter(Boolean);

    let content = rawParts.join('\n');
    if (content.length > 28000) content = content.slice(0, 28000) + '\n[conteúdo truncado por limite]';
    void totalPubChars; // suprime warning

    const systemPrompt = `Você é um assistente jurídico que explica o processo para o PRÓPRIO CLIENTE (leigo), em português claro, acolhedor e sem juridiquês. Fale na 2ª pessoa ("seu processo", "você").

══ COMO RACIOCINAR ══
Leia TODA a linha do tempo antes de escrever — do primeiro ao último evento. A fase atual de um processo só faz sentido no contexto de tudo que aconteceu antes. Não tire conclusões de um único evento isolado; cruze os marcos (★), o texto das publicações e o status interno para entender a história completa.

══ FONTE DE DADOS ══
LINHA DO TEMPO COMPLETA — lista cronológica unificada de todos os eventos do processo:
• [DataJud] = andamentos oficiais do tribunal (nome + data). Linhas com ★ são marcos decisivos.
• [DJEN] = publicações do diário oficial com texto integral. AQUI estão os VALORES (R$) e o dispositivo da sentença. LEIA com atenção — procure expressões como "condeno ao pagamento de R$", "arbitro em R$", "valor de R$".
• [Prazo] = prazos processuais registrados pelo escritório (status: pendente/cumprido/vencido).
• [Agenda] = audiências, perícias, reuniões agendadas.
• STATUS INTERNO DO ESCRITÓRIO = fase atual já validada pelo sistema. É CONFIÁVEL — use como âncora da fase atual.
• OBSERVAÇÕES DO ADVOGADO = verdade prioritária; se presentes, prevalecem sobre qualquer inferência sua.

══ TAREFA ══
Escreva 4 a 6 frases em parágrafo corrido (sem listas), nesta ordem:
1. DESFECHO — ganhou, perdeu, ganhou em parte, em andamento? Use os marcos ★ e/ou o texto das publicações.
2. VALOR — se houver condenação/acordo, diga QUANTO em R$. Procure expressões como "condeno ao pagamento", "arbitro em R$", "valor de R$" nos textos das publicações. Se o valor estiver em alguma publicação, CITE-O. Só diga "será confirmado pelo advogado" se o valor realmente não aparecer em nenhum texto.
3. FASE ATUAL — o que está acontecendo agora, ancorado no STATUS INTERNO e confirmado pela publicação DJEN mais recente.
   - "cumprimento" = a decisão está sendo executada; o processo está ATIVO, buscando o recebimento dos valores. NUNCA diga que está encerrado.
   - "recurso" = há recurso em análise por instância superior; processo ATIVO.
   - "arquivado" = processo efetivamente encerrado (só quando não há execução/recurso em curso).
4. PRÓXIMO PASSO — o que o cliente pode esperar, com datas quando disponíveis.

══ REGRAS DE TOM (CRÍTICAS) ══
- NUNCA dê a entender, sugira ou insinue que o advogado errou, se atrasou, esqueceu um prazo, deixou de agir ou foi negligente. Isso é proibido em qualquer hipótese.
- Apresente SEMPRE o advogado como atuante e no controle: "seu advogado já protocolou", "seu advogado acompanha", "seu advogado tomará as medidas cabíveis".
- Se algo está parado ou demorando, atribua ao ritmo natural da Justiça (e não a uma falha do escritório): "o processo aguarda a análise do juiz", "é normal que esta fase leve alguns meses".
- Se um prazo está pendente ou venceu no sistema, NÃO diga que foi perdido — diga que "está sendo acompanhado pelo seu advogado".
- Seja específico: cite datas (ex.: "sentença favorável em 27/11/2025, definitiva em 13/02/2026").
- Não invente fatos. Não prometa resultados. Tom honesto, tranquilizador e realista.
- Finalize SEMPRE com: "Seu advogado acompanha cada etapa e está à disposição para esclarecer dúvidas pelo canal oficial."`;

    try {
      const { data, error } = await supabase.functions.invoke('openai-proxy', {
        body: {
          model: 'gpt-4o',
          max_tokens: 600,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content },
          ],
        },
      });
      if (error) {
        const detail = (data as any)?.error || error.message;
        startAiCooldown('explainProcess');
        console.warn('[Portal] explainProcess OpenAI indisponível:', detail);
        handleRpcError('explainProcess', error);
        return null;
      }
      const text = (data as { choices?: { message?: { content?: string } }[] })
        ?.choices?.[0]?.message?.content?.trim();
      return text || null;
    } catch (e) {
      startAiCooldown('explainProcess');
      console.warn('[Portal] explainProcess exception:', e);
      return null;
    }
  }

  // ── Cache de Análise IA ────────────────────────────────────────────────────

  /** Lê cache de análise IA. Retorna null se não existir ou se expirado (ttlDays). */
  async getAiCache(
    portalUserId: string,
    entityType: 'process' | 'requirement',
    entityId: string,
    ttlDays = 7,
    invalidatedAfter?: string | Date | null,
  ): Promise<{ text: string; generatedAt: Date } | null> {
    try {
      const { data, error } = await supabase.rpc('portal_get_ai_cache', {
        p_portal_user_id: portalUserId,
        p_entity_type:    entityType,
        p_entity_id:      entityId,
      });
      if (error || !data) return null;
      const d = data as { generated_text: string; generated_at: string };
      const generatedAt = new Date(d.generated_at);
      const invalidationDate = invalidatedAfter ? new Date(invalidatedAfter) : null;
      const ageDays = (Date.now() - generatedAt.getTime()) / 86_400_000;
      if (ageDays > ttlDays) return null;
      if (invalidationDate && !Number.isNaN(invalidationDate.getTime()) && generatedAt <= invalidationDate) return null;
      return { text: d.generated_text, generatedAt };
    } catch { return null; }
  }

  /** Persiste análise IA no cache. */
  async saveAiCache(
    portalUserId: string,
    entityType: 'process' | 'requirement',
    entityId: string,
    text: string,
  ): Promise<void> {
    try {
      await supabase.rpc('portal_upsert_ai_cache', {
        p_portal_user_id: portalUserId,
        p_entity_type:    entityType,
        p_entity_id:      entityId,
        p_text:           text,
        p_model:          'gpt-4o',
      });
    } catch { /* silencia — cache é best-effort */ }
  }

  // ── Push Subscriptions (PWA) ───────────────────────────────────────────────

  async savePushSubscription(
    portalUserId: string,
    sub: PushSubscriptionJSON,
  ): Promise<void> {
    const keys = sub.keys as { p256dh: string; auth: string } | undefined;
    if (!sub.endpoint || !keys?.p256dh || !keys?.auth) return;
    try {
      await supabase.rpc('portal_save_push_subscription', {
        p_portal_user_id: portalUserId,
        p_endpoint:       sub.endpoint,
        p_p256dh:         keys.p256dh,
        p_auth:           keys.auth,
        p_user_agent:     navigator.userAgent.slice(0, 200),
      });
    } catch { /* silencia */ }
  }

  async removePushSubscription(portalUserId: string, endpoint: string): Promise<void> {
    try {
      await supabase.rpc('portal_remove_push_subscription', {
        p_portal_user_id: portalUserId,
        p_endpoint:       endpoint,
      });
    } catch { /* silencia */ }
  }

  // ── Chat Portal ────────────────────────────────────────────────────────────

  async getChatMessages(portalUserId: string) {
    const { data, error } = await supabase.rpc('portal_list_chat_messages', {
      p_portal_user_id: portalUserId,
      p_limit: 100,
    });
    if (error) { handleRpcError('getChatMessages', error); return null; }
    return data as { room: { id: string; name: string }; messages: import('../../types/chat.types').PortalChatMessage[] } | null;
  }

  async sendChatMessage(portalUserId: string, content: string) {
    const { data, error } = await supabase.rpc('portal_send_chat_message', {
      p_portal_user_id: portalUserId,
      p_content: content,
    });
    if (error) { handleRpcError('sendChatMessage', error); return null; }
    return data;
  }

  /**
   * Detalhes de um processo (validação interna do dono)
   */
  async getProcess(portalUserId: string, processId: string) {
    const { data, error } = await supabase.rpc('portal_get_process', {
      p_portal_user_id: portalUserId,
      p_process_id: processId,
    });
    if (error) {
      handleRpcError('getProcess', error);
      return null;
    }
    return data;
  }

  /**
   * Documentos do cliente (cloud_files)
   */
  async listDocuments(portalUserId: string) {
    const { data, error } = await supabase.rpc('portal_list_documents', {
      p_portal_user_id: portalUserId,
    });
    if (error) {
      handleRpcError('listDocuments', error);
      return [];
    }
    return (data as unknown[]) || [];
  }

  /**
   * Solicitações de assinatura pendentes
   */
  async listSignaturesPending(portalUserId: string) {
    const { data, error } = await supabase.rpc('portal_list_signatures', {
      p_portal_user_id: portalUserId,
    });
    if (error) {
      handleRpcError('listSignatures', error);
      return [];
    }
    return (data as unknown[]) || [];
  }

  /**
   * Contratos financeiros + parcelas (via JSON do RPC)
   */
  async listFinancial(portalUserId: string) {
    const { data, error } = await supabase.rpc('portal_list_agreements', {
      p_portal_user_id: portalUserId,
    });
    if (error) {
      handleRpcError('listFinancial', error);
      return [];
    }
    return (data as unknown[]) || [];
  }

  /**
   * Eventos do calendário relevantes ao cliente
   */
  async listCalendarEvents(portalUserId: string) {
    const { data, error } = await supabase.rpc('portal_list_calendar', {
      p_portal_user_id: portalUserId,
    });
    if (error) {
      handleRpcError('listCalendar', error);
      return [];
    }
    return (data as unknown[]) || [];
  }

  /**
   * Notificações do cliente
   */
  async listNotifications(portalUserId: string) {
    const { data, error } = await supabase.rpc('portal_list_notifications', {
      p_portal_user_id: portalUserId,
    });
    if (error) {
      handleRpcError('listNotifications', error);
      return [];
    }
    return (data as unknown[]) || [];
  }

  async markNotificationRead(portalUserId: string, notificationId: string) {
    await supabase.rpc('portal_mark_notification_read', {
      p_portal_user_id: portalUserId,
      p_notification_id: notificationId,
    });
  }

  async markAllNotificationsRead(portalUserId: string) {
    await supabase.rpc('portal_mark_all_notifications_read', {
      p_portal_user_id: portalUserId,
    });
  }

  async markNotificationsSeen(portalUserId: string, seenAt?: string) {
    const { data, error } = await supabase.rpc('portal_mark_notifications_seen', {
      p_portal_user_id: portalUserId,
      p_seen_at: seenAt ?? new Date().toISOString(),
    });
    if (error) {
      handleRpcError('markNotificationsSeen', error);
      return null;
    }
    return typeof data === 'string' ? data : null;
  }

  /**
   * Prazos do cliente (deadlines)
   */
  async listDeadlines(portalUserId: string) {
    const { data, error } = await supabase.rpc('portal_list_deadlines', {
      p_portal_user_id: portalUserId,
    });
    if (error) {
      handleRpcError('listDeadlines', error);
      return [];
    }
    return (data as unknown[]) || [];
  }

  /** Lista solicitações de documentos do cliente */
  async listDocumentRequests(portalUserId: string) {
    const { data, error } = await supabase.rpc('portal_list_document_requests', {
      p_portal_user_id: portalUserId,
    });
    if (error) { handleRpcError('listDocumentRequests', error); return []; }
    return (Array.isArray(data) ? data : []) as DocumentRequest[];
  }

  /** Faz upload de arquivos para um item de solicitação */
  async uploadDocumentFiles(
    portalUserId: string,
    requestItemId: string,
    clientId: string,
    files: File[],
  ): Promise<{ upload_id: string } | null> {
    // 1. Salva arquivos no Storage
    const paths: string[] = [];
    for (const file of files) {
      const ext = file.name.split('.').pop() || 'bin';
      const path = `${clientId}/raw/${requestItemId}_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
      const { error: storageErr } = await supabase.storage
        .from('client-documents')
        .upload(path, file, { upsert: false });
      if (storageErr) { console.error('Storage upload error:', storageErr); return null; }
      paths.push(path);
    }

    // 2. Cria registro de upload
    const { data: uploadRec, error: dbErr } = await supabase
      .from('document_uploads')
      .insert({ request_item_id: requestItemId, client_id: clientId, original_paths: paths })
      .select('id')
      .single();
    if (dbErr || !uploadRec) { console.error('DB insert error:', dbErr); return null; }

    // 3. Notifica admins
    try {
      await supabase.rpc('portal_notify_document_uploaded', {
        p_portal_user_id: portalUserId,
        p_upload_id: uploadRec.id,
      });
    } catch { /* silent */ }

    // 4. Dispara processamento assíncrono
    supabase.functions.invoke('process-document-upload', {
      body: { upload_id: uploadRec.id },
    }).then(() => null, () => null);

    return { upload_id: uploadRec.id };
  }

  /** Configuração de módulos habilitados no portal */
  async getModulesConfig(): Promise<Record<string, boolean>> {
    const { data, error } = await supabase.rpc('portal_get_modules_config');
    if (error) { handleRpcError('getModulesConfig', error); return {}; }
    return (data as Record<string, boolean>) || {};
  }

  /**
   * Perfil completo do cliente (campos editáveis)
   */
  async getProfile(portalUserId: string): Promise<ClientProfile | null> {
    const { data, error } = await supabase.rpc('portal_get_profile', {
      p_portal_user_id: portalUserId,
    });
    if (error) { handleRpcError('getProfile', error); return null; }
    return (data as ClientProfile) || null;
  }

  /**
   * Solicita atualização cadastral (aguarda aprovação do admin)
   */
  async requestProfileUpdate(
    portalUserId: string,
    changes: ClientProfile
  ): Promise<{ id: string } | null> {
    const { data, error } = await supabase.rpc('portal_request_profile_update', {
      p_portal_user_id: portalUserId,
      p_changes: changes,
    });
    if (error) { handleRpcError('requestProfileUpdate', error); return null; }
    return data as { id: string } | null;
  }

  /**
   * Lista as últimas solicitações de atualização do cliente
   */
  async listProfileRequests(portalUserId: string): Promise<ProfileUpdateRequest[]> {
    const { data, error } = await supabase.rpc('portal_list_profile_requests', {
      p_portal_user_id: portalUserId,
    });
    if (error) { handleRpcError('listProfileRequests', error); return []; }
    return (Array.isArray(data) ? data : []) as ProfileUpdateRequest[];
  }

  /**
   * Resumo agregado para o Dashboard.
   *
   * 1) Tenta a RPC `portal_dashboard_summary` (rápida — uma só chamada).
   * 2) Se a RPC não existir (404 / 42883), compõe o resumo localmente a
   *    partir das outras RPCs. Isso garante que o dashboard funciona mesmo
   *    quando o usuário ainda não aplicou a migration final.
   */
  async getDashboardSummary(portalUserId: string) {
    const { data, error } = await supabase.rpc('portal_dashboard_summary', {
      p_portal_user_id: portalUserId,
    });
    if (!error) return data;
    if (handlePortalError(error)) return null;
    // Erro estrutural ou outro — cai no fallback local.
    if (STRUCTURAL_ERROR.test(error.message || '')) {
      warnMigrationOnce('getDashboardSummary', error.message || '');
    } else {
      console.warn('[Portal] getDashboardSummary (fallback):', error.message);
    }
    return this.composeDashboardSummary(portalUserId);
  }

  /**
   * Fallback: monta o summary do dashboard combinando as RPCs individuais.
   * Tolerante a falhas: cada parte que falhar entra com zero/null.
   */
  private async composeDashboardSummary(portalUserId: string) {
    const [processes, requirements, signatures, deadlines, documents, agreements, events, docRequests] = await Promise.all([
      this.listProcesses(portalUserId).catch(() => []),
      this.listRequirements(portalUserId).catch(() => []),
      this.listSignaturesPending(portalUserId).catch(() => []),
      this.listDeadlines(portalUserId).catch(() => []),
      this.listDocuments(portalUserId).catch(() => []),
      this.listFinancial(portalUserId).catch(() => []),
      this.listCalendarEvents(portalUserId).catch(() => []),
      this.listDocumentRequests(portalUserId).catch(() => []),
    ]);

    type Anyrec = Record<string, unknown>;
    const arr = <T = Anyrec>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : []);
    const num = (x: unknown): number => (typeof x === 'number' ? x : Number(x ?? 0) || 0);
    const str = (x: unknown): string | undefined => (typeof x === 'string' ? x : undefined);

    const procs = arr<Anyrec>(processes);
    const reqs  = arr<Anyrec>(requirements);
    const sigs  = arr<Anyrec>(signatures);
    const dreqs = arr<DocumentRequest>(docRequests);
    const dls = arr<Anyrec>(deadlines);
    const ags = arr<Anyrec>(agreements);
    const evts = arr<Anyrec>(events);

    const now = new Date();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Processos — ativo = qualquer status exceto 'arquivado'
    const processesActive = procs.filter((p) => str(p.status) !== 'arquivado').length;

    // Assinaturas pendentes
    const signaturesPending = sigs.filter((s) => {
      const st = str(s.status);
      return st === 'pending' || st === 'in_progress';
    }).length;

    // Solicitações de documentos pendentes (aguardando envio ou parcialmente enviadas)
    const docRequestsPending = dreqs.filter((r) =>
      r.status === 'pending' || r.status === 'partial',
    ).length;

    // Prazos
    let deadlinesPending = 0;
    let deadlinesOverdue = 0;
    let nextDeadline: Anyrec | null = null;
    dls
      .filter((d) => str(d.status) === 'pendente')
      .forEach((d) => {
        const due = d.due_date ? new Date(String(d.due_date)) : null;
        if (!due || isNaN(due.getTime())) return;
        if (due < today) deadlinesOverdue++;
        else {
          deadlinesPending++;
          if (!nextDeadline || new Date(String(nextDeadline.due_date)) > due) nextDeadline = d;
        }
      });

    // Financeiro
    let total = 0;
    let paid = 0;
    let pending = 0;
    let overdue = 0;
    let nextInstallment: Anyrec | null = null;
    ags.forEach((a) => {
      total += num(a.total_value);
      paid += num(a.paid_total);
      pending += num(a.pending_total);
      overdue += num(a.overdue_total);
      const ni = a.next_installment as Anyrec | null | undefined;
      if (ni && ni.due_date) {
        if (!nextInstallment || new Date(String(ni.due_date)) < new Date(String(nextInstallment.due_date))) {
          nextInstallment = { ...ni, agreement_title: a.title };
        }
      }
    });

    // Próximo evento
    const nextEvent = evts
      .map((e) => ({ e, t: e.start_at ? new Date(String(e.start_at)).getTime() : 0 }))
      .filter((x) => x.t >= now.getTime())
      .sort((a, b) => a.t - b.t)[0]?.e ?? null;

    // Últimas movimentações (vindo de processes[*].last_movement)
    const recentMovements = procs
      .filter((p) => p.last_movement)
      .map<Anyrec>((p) => ({
        ...(p.last_movement as Anyrec),
        process_code: p.process_code,
      }))
      .sort((a, b) => {
        const av = a.data_hora || a.data;
        const bv = b.data_hora || b.data;
        const da = av ? new Date(String(av)).getTime() : 0;
        const db = bv ? new Date(String(bv)).getTime() : 0;
        return db - da;
      })
      .slice(0, 5);

    return {
      processesTotal: procs.length,
      processesActive,
      requirementsTotal: reqs.length,
      casesTotal: procs.length + reqs.length,
      signaturesPending,
      docRequestsPending,
      deadlinesPending,
      deadlinesOverdue,
      documentsCount: arr(documents).length,
      financial: { total, paid, pending, overdue },
      nextEvent,
      nextDeadline,
      nextInstallment,
      recentMovements,
    };
  }

  // ── IA — Requerimento administrativo ────────────────────────────────────────

  /**
   * Gera uma análise em linguagem simples do requerimento INSS para o cliente.
   * Inclui o contexto dos processos vinculados e das datas relevantes.
   */
  async explainRequirement(params: {
    benefitLabel: string;
    statusLabel: string;
    entryDate?: string | null;
    exigencyDueDate?: string | null;
    pericaMedicaAt?: string | null;
    pericaSocialAt?: string | null;
    observations?: string | null;
    linkedProcesses?: { process_code: string; status: string; practice_area?: string | null; requirement_role?: string | null }[];
    appointments?: { title?: string; event_type?: string; start_at?: string; event_mode?: string | null }[];
  }): Promise<string | null> {
    const fmt = (d?: string | null) => (d ? new Date(d).toLocaleDateString('pt-BR') : null);
    const fmtDt = (d?: string | null) => {
      if (!d) return 's/data';
      const dt = new Date(d);
      return dt.toLocaleDateString('pt-BR') + (d.includes('T') ? ` às ${dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : '');
    };

    const lines: string[] = [
      `Benefício: ${params.benefitLabel}`,
      `Situação atual: ${params.statusLabel}`,
    ];
    if (params.entryDate) lines.push(`Data de entrada do pedido: ${fmt(params.entryDate)}`);
    if (params.exigencyDueDate) lines.push(`Prazo da exigência INSS: ${fmt(params.exigencyDueDate)}`);
    if (params.pericaMedicaAt) lines.push(`Perícia médica (campo): ${fmt(params.pericaMedicaAt)}`);
    if (params.pericaSocialAt) lines.push(`Perícia social (campo): ${fmt(params.pericaSocialAt)}`);
    if (params.observations) lines.push(`\nObservações do escritório: ${params.observations}`);

    if (params.appointments?.length) {
      const TYPE_LABEL: Record<string, string> = {
        hearing: 'Audiência', pericia: 'Perícia', meeting: 'Reunião',
      };
      lines.push('\nCompromissos vinculados (agenda):');
      [...params.appointments]
        .sort((a, b) => new Date(a.start_at || 0).getTime() - new Date(b.start_at || 0).getTime())
        .forEach(a => {
          const tipo = TYPE_LABEL[a.event_type || ''] || a.event_type || 'Compromisso';
          const modo = a.event_mode ? ` (${a.event_mode})` : '';
          lines.push(`- ${fmtDt(a.start_at)}: ${tipo}${modo} — ${a.title || ''}`);
        });
    }

    if (params.linkedProcesses?.length) {
      lines.push('\nProcessos judiciais vinculados:');
      params.linkedProcesses.forEach(p => {
        const role = p.requirement_role === 'ms'
          ? 'Mandado de Segurança (demora na análise)'
          : 'Processo nascido do requerimento negado';
        lines.push(`- ${p.process_code} | ${role} | Situação: ${p.status}${p.practice_area ? ` (${p.practice_area})` : ''}`);
      });
    }

    try {
      const { data, error } = await supabase.functions.invoke('openai-proxy', {
        body: {
          model: 'gpt-4o',
          messages: [
            {
              role: 'system',
              content:
                'Você é um assistente jurídico especializado em Direito Previdenciário (INSS). ' +
                'Explique a situação do requerimento administrativo para um CLIENTE LEIGO, em português simples e acolhedor, sem juridiquês. ' +
                'Escreva de 3 a 5 frases específicas para ESTE caso.\n\n' +
                'REGRAS:\n' +
                '- Se houver processos vinculados, explique CLARAMENTE: o INSS negou, mas o advogado entrou com ação judicial (ou MS) em busca do benefício — e informe o número do processo e sua situação.\n' +
                '- Se status = "indeferido" SEM processo vinculado, diga que o pedido foi negado e que o advogado avalia o recurso.\n' +
                '- Se status = "em_exigencia", diga que o INSS pediu documentos e que o advogado está providenciando — mencione o prazo se houver.\n' +
                '- Se status = "aguardando_pericia", explique que será chamado para perícia médica ou social.\n' +
                '- Se status = "deferido", celebre a aprovação e explique os próximos passos (implantação do benefício).\n' +
                '- Nunca invente datas, valores ou resultados. Tom honesto e tranquilizador.\n' +
                '- Termine lembrando que dúvidas devem ser tiradas com o advogado pelo canal oficial.',
            },
            { role: 'user', content: lines.join('\n') },
          ],
        },
      });
      if (error) { handleRpcError('explainRequirement', error); return null; }
      const text = (data as { choices?: { message?: { content?: string } }[] })
        ?.choices?.[0]?.message?.content?.trim();
      return text || null;
    } catch {
      return null;
    }
  }

  // ── Requerimentos administrativos (INSS) ─────────────────────────────────

  /**
   * Lista requerimentos do cliente (sem campos sensíveis como inss_password).
   * Ordenados por urgência: em_exigencia e aguardando_pericia primeiro.
   */
  async listRequirements(portalUserId: string) {
    const { data, error } = await supabase.rpc('portal_list_requirements', {
      p_portal_user_id: portalUserId,
    });
    if (error) { handleRpcError('listRequirements', error); return []; }
    return (data as unknown[]) || [];
  }

  /**
   * Detalhes de um requerimento (validado por client_id) + compromissos vinculados.
   */
  async getRequirement(portalUserId: string, requirementId: string) {
    const { data, error } = await supabase.rpc('portal_get_requirement', {
      p_portal_user_id: portalUserId,
      p_requirement_id: requirementId,
    });
    if (error) { handleRpcError('getRequirement', error); return null; }
    return data;
  }
}

export const clientPortalService = new ClientPortalService();
