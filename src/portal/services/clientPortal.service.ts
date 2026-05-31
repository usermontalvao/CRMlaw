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
import { supabase } from '../../config/supabase';
import { clientAuthService } from './clientAuth.service';

export interface ClientProfile {
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
                'Você é um assistente jurídico que explica andamentos de processos para CLIENTES LEIGOS, em português claro e acolhedor, sem juridiquês. Você recebe a linha do tempo completa do processo e deve explicar APENAS o andamento marcado, SEMPRE usando o contexto dos andamentos anteriores para deixar claro A QUE ele se refere. Exemplo: um "Decurso de Prazo" logo após uma citação significa que o prazo da parte contrária para se defender terminou — explique assim, conectando ao evento anterior. Responda em 1 a 2 frases curtas. Se nenhuma ação do cliente for necessária, tranquilize dizendo que o advogado cuida de tudo. Não invente fatos além do que está na linha do tempo.',
            },
            { role: 'user', content },
          ],
        },
      });
      if (error) {
        handleRpcError('explainMovement', error);
        return null;
      }
      const text = (data as { choices?: { message?: { content?: string } }[] })
        ?.choices?.[0]?.message?.content?.trim();
      return text || null;
    } catch {
      return null;
    }
  }

  /**
   * Explica o PROCESSO INTEIRO em linguagem simples (IA), para o cliente leigo.
   * Recebe contexto resumido (situação atual + últimos andamentos) e devolve
   * um panorama acolhedor: o que já aconteceu, em que pé está e o que esperar.
   */
  async explainProcess(params: {
    statusLabel: string;
    area?: string | null;
    movements: { nome?: string; data?: string; detalhe?: string }[];
    publications?: { data?: string; tipo?: string; orgao?: string; texto?: string }[];
  }): Promise<string | null> {
    const fmt = (d?: string) => (d ? new Date(d).toLocaleDateString('pt-BR') : 's/data');

    // Esqueleto da tramitação (nomes dos movimentos)
    const skeleton = params.movements
      .slice(0, 25)
      .map((m) => `- ${fmt(m.data)}: ${m.nome || ''}`)
      .join('\n');

    // Publicações com TEXTO INTEGRAL do DJEN — base factual (tutela, sentença, recurso).
    // Em documentos longos (sentença/decisão), o DESFECHO fica no FIM (dispositivo),
    // então enviamos início + fim para a IA não perder o resultado.
    const clip = (t: string) => {
      const s = (t || '').replace(/\s+/g, ' ').trim();
      if (s.length <= 3800) return s;
      return `${s.slice(0, 2200)}\n[...trecho omitido...]\n${s.slice(-1600)}`;
    };
    const pubs = (params.publications || [])
      .slice(0, 10)
      .map((p) => `### ${fmt(p.data)} — ${p.tipo || 'Publicação'}${p.orgao ? ` (${p.orgao})` : ''}\n${clip(p.texto || '')}`)
      .join('\n\n');

    const content =
      `Situação atual: ${params.statusLabel}` +
      (params.area ? `\nÁrea: ${params.area}` : '') +
      (skeleton ? `\n\nTRAMITAÇÃO (mais recente primeiro):\n${skeleton}` : '') +
      (pubs ? `\n\nPUBLICAÇÕES OFICIAIS DO DJEN (texto integral — esta é a fonte para qualquer afirmação sobre decisões, tutela, recursos):\n\n${pubs}` : '');

    try {
      const { data, error } = await supabase.functions.invoke('openai-proxy', {
        body: {
          model: 'gpt-4o',
          messages: [
            {
              role: 'system',
              content:
                'Você é um assistente jurídico que explica para um CLIENTE LEIGO como está o processo dele, em português claro e acolhedor, sem juridiquês.\n\nLEIA o texto integral de TODAS as publicações e ESCREVA um panorama de 4 a 6 frases, específico para ESTE caso (nunca genérico). COMECE pelo que MAIS IMPORTA para o cliente.\n\nVALORES — REGRA CENTRAL: sempre que houver condenação, indenização, acordo ou execução, INFORME O VALOR EM REAIS, extraindo-o do texto. O valor da condenação fica no DISPOSITIVO da sentença (ex.: "condenar a Ré ao pagamento de R$ 2.000,00"). Se o processo está em CUMPRIMENTO/EXECUÇÃO e a intimação atual não repete o valor, BUSQUE o valor na sentença anterior e diga claramente quanto o cliente tem a receber, mencionando que incidem correção monetária e juros. NUNCA diga que há um valor a pagar/receber sem dizer QUANTO, se o número estiver disponível em alguma publicação.\n\nFONTE DA VERDADE: as PUBLICAÇÕES OFICIAIS DO DJEN (texto integral). Extraia: resultado da sentença (procedente/improcedente/parcial) + VALOR; tutela deferida/indeferida; estágio do recurso/cumprimento.\n\nREGRAS:\n- NÃO comece por tecnicismos ("efeito devolutivo", "trânsito em julgado") — mencione só de passagem se couber.\n- Afirme desfechos e valores SOMENTE se estiverem no texto, citando-os.\n- NÃO afirme QUEM recorreu se o texto não disser; diga "há um recurso aguardando julgamento".\n- Nunca invente nem prometa resultado futuro.\n\nTom honesto e tranquilizador. Finalize lembrando que o advogado acompanha tudo e que dúvidas devem ser tiradas pelo canal oficial.',
            },
            { role: 'user', content },
          ],
        },
      });
      if (error) {
        handleRpcError('explainProcess', error);
        return null;
      }
      const text = (data as { choices?: { message?: { content?: string } }[] })
        ?.choices?.[0]?.message?.content?.trim();
      return text || null;
    } catch {
      return null;
    }
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

  /**
   * Configuração de módulos habilitados no portal
   */
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
    const [processes, signatures, deadlines, documents, agreements, events] = await Promise.all([
      this.listProcesses(portalUserId).catch(() => []),
      this.listSignaturesPending(portalUserId).catch(() => []),
      this.listDeadlines(portalUserId).catch(() => []),
      this.listDocuments(portalUserId).catch(() => []),
      this.listFinancial(portalUserId).catch(() => []),
      this.listCalendarEvents(portalUserId).catch(() => []),
    ]);

    type Anyrec = Record<string, unknown>;
    const arr = <T = Anyrec>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : []);
    const num = (x: unknown): number => (typeof x === 'number' ? x : Number(x ?? 0) || 0);
    const str = (x: unknown): string | undefined => (typeof x === 'string' ? x : undefined);

    const procs = arr<Anyrec>(processes);
    const sigs = arr<Anyrec>(signatures);
    const dls = arr<Anyrec>(deadlines);
    const ags = arr<Anyrec>(agreements);
    const evts = arr<Anyrec>(events);

    const now = new Date();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Processos
    const processesActive = procs.filter((p) => str(p.status) === 'ativo').length;

    // Assinaturas pendentes
    const signaturesPending = sigs.filter((s) => {
      const st = str(s.status);
      return st === 'pending' || st === 'in_progress';
    }).length;

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
      signaturesPending,
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
}

export const clientPortalService = new ClientPortalService();
