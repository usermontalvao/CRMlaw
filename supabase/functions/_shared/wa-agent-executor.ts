/**
 * Executor dos gatilhos do atendente de IA.
 *
 * Só roda DEPOIS que `checkToolCall` aprovou a chamada. Aqui não há decisão:
 * o que chega já passou pela cerca. Cada função devolve uma frase curta em
 * português que volta para o modelo como resultado — é assim que ele sabe se
 * deu certo e o que dizer ao cliente em seguida.
 *
 * REGRA QUE NÃO SE QUEBRA: toda mensagem sai por `evolution-send`. `fetch`
 * direto na Evolution grava "enviado" e não entrega — já custou um bug de
 * aviso fora de horário que ficou semanas marcando envio sem entregar nada.
 */

export interface ExecCtx {
  admin: any;                    // supabase client com service role
  conversationId: string;
  channelId: string | null;
  clientId: string | null;       // cadastro vinculado; null = lead solto
  supabaseUrl: string;
  serviceKey: string;
}

export type ExecResult = { ok: true; detail: string } | { ok: false; detail: string };

const ok = (detail: string): ExecResult => ({ ok: true, detail });
const fail = (detail: string): ExecResult => ({ ok: false, detail });

/** Único caminho de envio. Devolve null em sucesso, ou o motivo da falha. */
export async function sendText(ctx: ExecCtx, text: string): Promise<string | null> {
  const body = (text || '').trim();
  if (!body) return 'texto vazio';
  try {
    const res = await fetch(`${ctx.supabaseUrl}/functions/v1/evolution-send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ctx.serviceKey}`,
      },
      body: JSON.stringify({ conversation_id: ctx.conversationId, sender_user_id: null, text: body }),
      signal: AbortSignal.timeout(30_000),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok || out?.error) return String(out?.error || `HTTP ${res.status}`).slice(0, 300);
    return null;
  } catch (err) {
    return String(err instanceof Error ? err.message : err).slice(0, 300);
  }
}

/** Nota interna na conversa — é o que o advogado lê ao assumir. */
async function note(ctx: ExecCtx, body: string): Promise<void> {
  await ctx.admin.from('whatsapp_internal_notes')
    .insert({ conversation_id: ctx.conversationId, author_id: null, body })
    .then(() => {}, (e: Error) => console.error('nota interna falhou', e.message));
}

const asList = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(x => String(x).trim()).filter(Boolean) : [];

const asText = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/**
 * Executa um gatilho já validado. `state` é a linha de whatsapp_ai_agent_state,
 * mutada em memória pelo chamador quando o gatilho muda estado.
 */
export async function executeTool(
  ctx: ExecCtx,
  name: string,
  args: Record<string, unknown>,
  state: Record<string, any>,
): Promise<ExecResult> {
  switch (name) {

    // ── Dados ────────────────────────────────────────────────────────────
    case 'registrar_dados': {
      const campos = asList(args.campos);
      if (!campos.length) return fail('nenhum campo informado');
      const collected = { ...(state.collected_data || {}) };
      for (const par of campos) {
        const i = par.indexOf(':');
        if (i <= 0) continue;
        const chave = par.slice(0, i).trim();
        const valor = par.slice(i + 1).trim();
        if (chave && valor) collected[chave] = valor;
      }
      state.collected_data = collected;
      await ctx.admin.from('whatsapp_ai_agent_state')
        .update({ collected_data: collected })
        .eq('conversation_id', ctx.conversationId);
      return ok(`guardado: ${campos.join(', ')}`);
    }

    case 'salvar_nome': {
      const nome = asText(args.nome);
      if (!nome) return fail('nome vazio');
      await ctx.admin.from('whatsapp_conversations')
        .update({ contact_name: nome })
        .eq('id', ctx.conversationId);
      return ok(`contato agora se chama ${nome}`);
    }

    // ── Triagem ──────────────────────────────────────────────────────────
    case 'qualificar': {
      const status = asText(args.status);
      const motivo = asText(args.motivo);
      if (!['qualificado', 'desqualificado', 'em_analise'].includes(status)) {
        return fail(`status "${status}" inválido`);
      }
      state.qualification = status;
      state.qualification_reason = motivo;
      await ctx.admin.from('whatsapp_ai_agent_state')
        .update({ qualification: status, qualification_reason: motivo })
        .eq('conversation_id', ctx.conversationId);
      await note(ctx, `🤖 Qualificação: **${status}** — ${motivo}`);
      return ok(`marcado como ${status}`);
    }

    /**
     * A etapa do funil NÃO é coluna: é uma etiqueta na conversa. Cada etapa do
     * canal declara quais etiquetas a representam (`labels`), com fallback para
     * o próprio rótulo. Mover = tirar a etiqueta da etapa antiga e pôr a nova,
     * preservando etiquetas que não são de funil.
     */
    case 'mover_etapa': {
      const alvo = asText(args.etapa).toLowerCase();
      if (!alvo) return fail('etapa não informada');
      if (!ctx.channelId) return fail('conversa sem canal');

      const { data: stages } = await ctx.admin
        .from('whatsapp_channel_funnel_stages')
        .select('stage_key, label, labels, is_active')
        .eq('channel_id', ctx.channelId);

      const ativas = (stages || []).filter((s: any) => s.is_active);
      if (!ativas.length) return fail('canal sem funil configurado');

      const etiquetasDe = (s: any): string[] => (s.labels?.length ? s.labels : [s.label]);
      const destino = ativas.find((s: any) =>
        s.label?.toLowerCase() === alvo ||
        s.stage_key?.toLowerCase() === alvo ||
        etiquetasDe(s).some((l: string) => l.toLowerCase() === alvo));

      if (!destino) {
        const nomes = ativas.map((s: any) => s.label).join(', ');
        return fail(`etapa "${args.etapa}" não existe. Disponíveis: ${nomes}`);
      }

      const todasDeFunil = new Set(
        ativas.flatMap((s: any) => etiquetasDe(s).map((l: string) => l.toLowerCase())),
      );

      const { data: conv } = await ctx.admin.from('whatsapp_conversations')
        .select('labels').eq('id', ctx.conversationId).maybeSingle();

      const mantidas = (conv?.labels || []).filter(
        (l: string) => !todasDeFunil.has(String(l).toLowerCase()));
      const novaEtiqueta = etiquetasDe(destino)[0];

      await ctx.admin.from('whatsapp_conversations')
        .update({ labels: [...mantidas, novaEtiqueta] })
        .eq('id', ctx.conversationId);

      return ok(`movido para ${destino.label}`);
    }

    // ── Documentos ───────────────────────────────────────────────────────
    // Depois disto, o cron whatsapp-doc-intake confere sozinho o que o cliente
    // mandar e dá baixa item a item. O agente só pede e acompanha.
    case 'pedir_documentos': {
      const itens = asList(args.itens);
      if (!itens.length) return fail('nenhum documento listado');
      if (!ctx.clientId) {
        return fail('a conversa ainda não está vinculada a um cadastro — não dá para abrir solicitação');
      }

      const { data: req, error } = await ctx.admin.from('document_requests')
        .insert({
          client_id: ctx.clientId,
          title: 'Documentos solicitados no atendimento',
          description: asText(args.observacao) || null,
        })
        .select('id').single();

      if (error) return fail(`não consegui abrir a solicitação: ${error.message}`);

      const { error: ie } = await ctx.admin.from('document_request_items').insert(
        itens.map(label => ({ request_id: req.id, label, required: true })),
      );
      if (ie) return fail(`solicitação criada mas os itens falharam: ${ie.message}`);

      await note(ctx, `🤖 Documentos solicitados: ${itens.join(', ')}`);
      return ok(`solicitação aberta com ${itens.length} item(ns)`);
    }

    // ── Mensagens ────────────────────────────────────────────────────────
    // É assim que a PROPOSTA é apresentada: o texto é do escritório, revisado.
    // O agente escolhe o momento, nunca redige valor ou cláusula.
    case 'enviar_template': {
      const nome = asText(args.template);
      if (!nome) return fail('template não informado');

      const { data: tpls } = await ctx.admin.from('whatsapp_templates')
        .select('name, body, is_active').eq('is_active', true);

      const tpl = (tpls || []).find((t: any) => t.name?.toLowerCase() === nome.toLowerCase());
      if (!tpl) {
        const nomes = (tpls || []).map((t: any) => t.name).join(', ') || 'nenhum';
        return fail(`template "${nome}" não existe. Disponíveis: ${nomes}`);
      }

      const erro = await sendText(ctx, tpl.body);
      if (erro) return fail(`o envio falhou: ${erro}`);
      return ok(`template "${tpl.name}" enviado`);
    }

    case 'agendar_followup': {
      const horas = Number(args.horas);
      const mensagem = asText(args.mensagem);
      if (!Number.isFinite(horas) || horas <= 0) return fail('prazo inválido');
      if (!mensagem) return fail('mensagem da cobrança vazia');

      const quando = new Date(Date.now() + horas * 3_600_000).toISOString();
      const { error } = await ctx.admin.from('whatsapp_scheduled_messages').insert({
        conversation_id: ctx.conversationId,
        channel_id: ctx.channelId,
        type: 'text',
        body: mensagem,
        scheduled_at: quando,
        status: 'pending',
      });
      if (error) return fail(`não consegui agendar: ${error.message}`);
      return ok(`cobrança agendada para daqui a ${horas}h`);
    }

    // ── Saídas ───────────────────────────────────────────────────────────
    case 'transferir_humano': {
      const motivo = asText(args.motivo) || 'sem motivo informado';
      const patch: Record<string, unknown> = {};

      if (state.__handoff_user_id) patch.assigned_user_id = state.__handoff_user_id;
      if (state.__handoff_department_id) patch.department_id = state.__handoff_department_id;

      if (Object.keys(patch).length) {
        await ctx.admin.from('whatsapp_conversations').update(patch).eq('id', ctx.conversationId);
      }

      state.status = 'transferido';
      await ctx.admin.from('whatsapp_ai_agent_state')
        .update({ status: 'transferido' })
        .eq('conversation_id', ctx.conversationId);

      await note(ctx, `🤖 Transferido para atendimento humano — ${motivo}`);
      return ok('transferido; pare de responder a partir de agora');
    }

    case 'passar_para_agente': {
      const nome = asText(args.agente);
      const motivo = asText(args.motivo);
      if (!nome) return fail('agente de destino não informado');

      const { data: agentes } = await ctx.admin.from('whatsapp_ai_agents')
        .select('id, name, slug, is_active')
        .eq('channel_id', ctx.channelId)
        .eq('is_active', true);

      const destino = (agentes || []).find((a: any) =>
        a.name?.toLowerCase() === nome.toLowerCase() || a.slug?.toLowerCase() === nome.toLowerCase());

      if (!destino) {
        const nomes = (agentes || []).map((a: any) => a.name).join(', ') || 'nenhum';
        return fail(`agente "${nome}" não existe ou está desligado. Ativos: ${nomes}`);
      }

      state.current_agent_id = destino.id;
      await ctx.admin.from('whatsapp_ai_agent_state')
        .update({ current_agent_id: destino.id })
        .eq('conversation_id', ctx.conversationId);

      await note(ctx, `🤖 Passou para o agente ${destino.name} — ${motivo}`);
      return ok(`entregue para ${destino.name}`);
    }

    case 'resumir_atendimento': {
      const resumo = asText(args.resumo);
      if (!resumo) return fail('resumo vazio');
      await note(ctx, `🤖 **Resumo do atendimento**\n${resumo}`);
      return ok('resumo registrado na conversa');
    }

    case 'parar_ia': {
      const motivo = asText(args.motivo) || 'sem motivo informado';
      state.status = 'pausado';
      await ctx.admin.from('whatsapp_ai_agent_state')
        .update({ status: 'pausado' })
        .eq('conversation_id', ctx.conversationId);
      await note(ctx, `🤖 Atendimento automático desligado nesta conversa — ${motivo}`);
      return ok('desliguei; não responda mais nesta conversa');
    }

    // ── Risco alto ───────────────────────────────────────────────────────
    // Só chegam aqui depois de aprovação humana: `needsApproval` obriga, mesmo
    // com o canal em automático.

    /**
     * O escritório NÃO redige nada aqui. Gera-se o link do modelo e o cliente
     * abre, preenche os próprios dados e assina. Por isso não há preenchimento
     * de campo nem geração de PDF neste caminho.
     */
    case 'enviar_contrato': {
      const nome = asText(args.modelo);
      if (!nome) return fail('modelo de contrato não informado');

      const { data: modelos } = await ctx.admin.from('document_templates')
        .select('id, name').ilike('name', `%${nome}%`).limit(5);

      const modelo = (modelos || []).find((t: any) => t.name?.toLowerCase() === nome.toLowerCase())
        ?? (modelos || [])[0];
      if (!modelo) return fail(`modelo "${nome}" não existe`);

      const expira = new Date(Date.now() + 7 * 24 * 3600_000).toISOString();
      const { data: link, error } = await ctx.admin.from('template_fill_links')
        .insert({ template_id: modelo.id, expires_at: expira, status: 'pending' })
        .select('public_token').single();

      if (error) return fail(`não consegui gerar o link: ${error.message}`);
      if (!link?.public_token) return fail('o link saiu sem token');

      const base = (Deno.env.get('PUBLIC_APP_URL') || 'https://jurius.com.br').replace(/\/+$/, '');
      const url = `${base}/#/preencher/${link.public_token}`;
      const texto = [asText(args.observacao), url].filter(Boolean).join('\n\n');

      const erro = await sendText(ctx, texto);
      if (erro) return fail(`o envio falhou: ${erro}`);

      await note(ctx, `🤖 Contrato "${modelo.name}" enviado para o cliente preencher e assinar.`);
      return ok('link enviado; o cliente preenche e assina por lá');
    }

    /**
     * Entra na agenda JÁ, para segurar o horário e ficar visível, mas como
     * pendente — quem confirma é o responsável. O cliente só é avisado da
     * confirmação (ou da remarcação) depois da decisão humana; por isso o
     * resultado devolvido manda a IA não prometer horário.
     */
    case 'marcar_reuniao': {
      const quando = doFusoDoEscritorio(asText(args.data_hora));
      const assunto = asText(args.assunto);
      if (!quando) return fail('data e hora inválidas — use o formato AAAA-MM-DD HH:MM');
      if (quando.getTime() < Date.now()) return fail('essa data já passou');
      if (!assunto) return fail('assunto da reunião vazio');

      const { data: conv } = await ctx.admin.from('whatsapp_conversations')
        .select('contact_name').eq('id', ctx.conversationId).maybeSingle();
      const quem = conv?.contact_name || 'cliente do WhatsApp';

      const { data: evento, error: ee } = await ctx.admin.from('calendar_events').insert({
        title: `[A confirmar] ${assunto} — ${quem}`,
        description: 'Proposta pelo atendente de IA no WhatsApp. Aguardando autorização.',
        event_type: 'reuniao',
        status: 'pendente',
        start_at: quando.toISOString(),
        end_at: new Date(quando.getTime() + 3600_000).toISOString(),
        client_id: ctx.clientId,
        client_name: quem,
      }).select('id').single();

      if (ee) return fail(`não consegui lançar na agenda: ${ee.message}`);

      const { error: me } = await ctx.admin.from('whatsapp_ai_meeting_requests').insert({
        conversation_id: ctx.conversationId,
        agent_id: ctx.agentId,
        client_id: ctx.clientId,
        calendar_event_id: evento.id,
        proposed_at: quando.toISOString(),
        subject: assunto,
        status: 'pendente',
      });
      if (me) return fail(`agenda ok, mas o pedido de autorização falhou: ${me.message}`);

      const legivel = formatarNoEscritorio(quando);
      await note(ctx, `🤖 Reunião proposta para ${legivel} — ${assunto}. **Aguardando autorização** antes de confirmar ao cliente.`);
      return ok(
        `proposto para ${legivel}, pendente de autorização. ` +
        'Diga ao cliente que vai confirmar e avisar — NÃO dê o horário como confirmado.',
      );
    }

    case 'consultar_processo': {
      if (!ctx.clientId) return fail('esta conversa ainda não está vinculada a um cadastro');

      const { data: procs } = await ctx.admin.from('processes')
        .select('process_code, status, updated_at')
        .eq('client_id', ctx.clientId)
        .order('updated_at', { ascending: false })
        .limit(5);

      if (!procs?.length) return ok('nenhum processo cadastrado para este cliente');

      const linhas = procs.map((p: any) =>
        `${p.process_code || 'sem número'}: ${p.status || 'sem status'}`).join(' | ');
      return ok(`processos: ${linhas}`);
    }

    default:
      return fail(`gatilho "${name}" não tem execução escrita`);
  }
}

// ── Fuso do escritório ──────────────────────────────────────────────────────
// Horário de compromisso é âncora em America/Cuiaba, nunca em UTC nem no fuso
// de quem roda o código. Marcar no fuso errado erra a hora e erra em silêncio.

const FUSO = 'America/Cuiaba';

/** Quantos minutos o fuso do escritório está à frente do UTC naquele instante. */
function deslocamentoMin(d: Date): number {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: FUSO, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(d).filter(p => p.type !== 'literal');

  const v: Record<string, number> = {};
  for (const p of partes) v[p.type] = Number(p.value);
  const comoSeUtc = Date.UTC(v.year, v.month - 1, v.day, v.hour % 24, v.minute, v.second);
  return Math.round((comoSeUtc - d.getTime()) / 60_000);
}

/** "AAAA-MM-DD HH:MM" no relógio do escritório → instante real (UTC). */
export function doFusoDoEscritorio(texto: string): Date | null {
  const m = texto.match(/(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})/);
  if (!m) return null;
  const [Y, Mo, D, H, Mi] = m.slice(1).map(Number);
  if (H > 23 || Mi > 59) return null;

  const parede = Date.UTC(Y, Mo - 1, D, H, Mi);
  // Duas passadas bastam: a primeira usa um deslocamento aproximado, a segunda
  // já usa o deslocamento do instante certo (importa em virada de horário).
  let ms = parede;
  for (let i = 0; i < 2; i++) ms = parede - deslocamentoMin(new Date(ms)) * 60_000;
  return new Date(ms);
}

export function formatarNoEscritorio(d: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: FUSO, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(d);
}
