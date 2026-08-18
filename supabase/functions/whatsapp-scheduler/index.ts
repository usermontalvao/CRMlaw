// WhatsApp — dispatcher de mensagens agendadas (Fase 8.1).
// Chamada por pg_cron a cada minuto (token na query). Pega as mensagens
// `pending` vencidas e dispara via evolution-send (service role). Marca
// sent/failed e trata conversa bloqueada com regra clara.
//
// Desde 11/08/2026 este mesmo cron também despacha os ACOMPANHAMENTOS do
// assistente de IA (`processarFollowupsIA`, no fim do arquivo). É reuso
// deliberado: o cron de minuto em minuto já existia, e criar outro para a IA
// significaria mais um job chamando Edge Function com JWT — a armadilha que já
// deixou o weekly-digest seis semanas quebrado em silêncio.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  buildWaAiFollowupMessage,
  decideAutoFollowup,
  decideFollowup,
  isWithinFollowupWindow,
  nextAllowedSlot,
  normalizeWaAiFollowupPolicy,
  waAiFirstName,
} from '../_shared/wa-ai-followup.ts';
import { ensureWaAiFollowupScheduled } from '../_shared/wa-ai-followup-store.ts';
import { isWithinBusinessHours, localTimeInTz } from '../_shared/wa-business-hours.ts';
import { CHANNEL_FLAP_GRACE_MS, applyChannelState, isWaConnectionFailure } from '../_shared/wa-channel-state.ts';

const TOKEN = Deno.env.get('WA_SCHEDULER_TOKEN') || 'wa-scheduler-2026';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Detecção robusta de "canal fora": prioriza a flag estruturada que o
// evolution-send devolve (reconnect_pending) e cai no texto só por compatibilidade.
function isReconnectPending(flag: unknown, message: string): boolean {
  if (flag === true) return true;
  // Socket caído no meio do envio (inclusive o código de fechamento pelado, tipo
  // `1006`) é canal fora, não falha da mensagem: continua retida em vez de morrer.
  if (isWaConnectionFailure(message)) return true;
  const lower = (message || '').toLowerCase();
  return lower.includes('canal desconectado')
    || lower.includes('reconectando automaticamente')
    || lower.includes('aguarde alguns segundos')
    || lower.includes('não reconectou sozinho');
}

// ── Política da retenção por reconexão ──────────────────────────────────────
// A retida volta sozinha quando o canal reconecta, mas um canal pode estar morto
// (sessão caída há semanas, esperando QR). Sem teto, cada mensagem presa ficava
// batendo na Evolution de minuto em minuto para sempre — e o atendente nunca
// descobria que aquilo não ia sair.
const MAX_HOLD_MS = 12 * 60 * 60_000;

/** Espaça as tentativas conforme a espera cresce: 1min → 5min → 15min → 30min. */
function proximaTentativaMs(esperaMs: number): number {
  if (esperaMs < 5 * 60_000) return 60_000;
  if (esperaMs < 30 * 60_000) return 5 * 60_000;
  if (esperaMs < 2 * 60 * 60_000) return 15 * 60_000;
  return 30 * 60_000;
}

/**
 * Batimento do estado dos canais — a contrapartida da carência anti-piscada.
 *
 * O status do canal só desce quando chega um evento dizendo que ele caiu. Se a
 * Evolution simplesmente PARAR de falar (servidor derrubado, instância removida),
 * o último evento foi um `open` e o CRM ficaria verde para sempre, prometendo um
 * envio que não acontece. Aqui, uma vez por minuto, todo canal verde que não dá
 * sinal há mais que a carência é conferido na fonte.
 */
async function reconciliarCanais(admin: any) {
  const limite = new Date(Date.now() - CHANNEL_FLAP_GRACE_MS).toISOString();
  const { data: canais } = await admin.from('whatsapp_instances')
    .select('id, instance_name, status, last_open_at, connected_at')
    .eq('is_active', true)
    .eq('status', 'connected')
    .or(`last_open_at.is.null,last_open_at.lt.${limite}`);
  if (!canais?.length) return;

  const { data: cfg } = await admin.from('system_settings').select('value')
    .eq('key', 'whatsapp_evolution_config').maybeSingle();
  const server = (cfg?.value || {}) as { base_url?: string; api_key?: string };
  if (!server.base_url || !server.api_key) return;
  const base = server.base_url.replace(/\/+$/, '');

  for (const canal of canais as any[]) {
    try {
      const res = await fetch(`${base}/instance/connectionState/${encodeURIComponent(canal.instance_name)}`, {
        headers: { apikey: server.api_key! },
        signal: AbortSignal.timeout(10_000),
      });
      // Servidor fora do ar não é canal desconectado — nesse caso não se mexe no status.
      if (!res.ok) continue;
      const out = await res.json().catch(() => ({}));
      await applyChannelState(admin, canal, out?.instance?.state || out?.state || 'close');
    } catch { /* rede instável não derruba canal */ }
  }
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  if (url.searchParams.get('token') !== TOKEN) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const nowIso = new Date().toISOString();

  await reconciliarCanais(admin).catch(() => {});

  // Mensagens vencidas, com o estado de bloqueio da conversa-pai.
  const { data: due, error } = await admin
    .from('whatsapp_scheduled_messages')
    .select('id, conversation_id, type, body, storage_path, mime_type, file_name, created_by, hold_since, whatsapp_conversations(is_blocked, status)')
    .eq('status', 'pending')
    .lte('scheduled_at', nowIso)
    .order('scheduled_at', { ascending: true })
    .limit(25);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  let sent = 0, failed = 0, skipped = 0;
  for (const candidate of (due || []) as any[]) {
    // Revalida imediatamente antes de enviar. A inbox pode ter movido esta
    // retenção para outro canal depois que a consulta do lote rodou; sem este
    // segundo olhar, o cron ainda usaria o retrato velho e poderia entregar a
    // mesma mensagem pelo número antigo enquanto a troca já a envia pelo novo.
    const { data: latest, error: latestError } = await admin
      .from('whatsapp_scheduled_messages')
      .select('id, conversation_id, type, body, storage_path, mime_type, file_name, created_by, hold_since, whatsapp_conversations(is_blocked, status)')
      .eq('id', candidate.id)
      .eq('status', 'pending')
      .lte('scheduled_at', nowIso)
      .maybeSingle();
    if (latestError || !latest) { skipped++; continue; }
    const m = latest as any;
    const conv = m.whatsapp_conversations || {};
    // Conversa bloqueada → não envia; marca falha com motivo claro.
    if (conv.is_blocked) {
      await admin.from('whatsapp_scheduled_messages')
        .update({ status: 'failed', error: 'Conversa bloqueada no momento do disparo.' })
        .eq('id', m.id);
      failed++; continue;
    }

    const payload: Record<string, unknown> = { conversation_id: m.conversation_id, sender_user_id: m.created_by ?? null };
    if (m.type && m.type !== 'text') {
      payload.type = m.type;
      payload.storage_path = m.storage_path;
      payload.mime_type = m.mime_type;
      payload.file_name = m.file_name;
      if (m.body) payload.text = m.body;
    } else {
      payload.text = m.body || '';
    }

    try {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/evolution-send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SERVICE_ROLE}` },
        body: JSON.stringify(payload),
      });
      const j = await resp.json().catch(() => ({}));
      if (!resp.ok || j?.error) {
        const err = new Error(j?.error || `HTTP ${resp.status}`) as Error & { reconnectPending?: boolean };
        if (j?.reconnect_pending === true) err.reconnectPending = true;
        throw err;
      }
      await admin.from('whatsapp_scheduled_messages')
        .update({ status: 'sent', sent_at: new Date().toISOString(), error: null, hold_reason: null, hold_since: null })
        .eq('id', m.id);
      sent++;
    } catch (e) {
      // Com pilha: em 17/08/2026 uma leva caiu com "TypeError: Cannot read
      // properties of undefined (reading 'id')" e a linha do banco guardava só a
      // frase — sem origem, o erro não tinha como ser encontrado.
      console.error('envio agendado falhou', m.id, e);
      const message = String((e as Error).message || e);
      if (isReconnectPending((e as { reconnectPending?: boolean })?.reconnectPending, message)) {
        // Retida: volta sozinha quando o canal reconectar. `hold_since` guarda o
        // início da espera (na primeira retenção) para espaçar as tentativas e
        // desistir quando passa do teto — canal que não volta em 12h precisa de
        // gente (revalidar o QR), não de mais uma tentativa por minuto.
        const desde = m.hold_since ? new Date(m.hold_since).getTime() : Date.now();
        const espera = Date.now() - desde;
        if (espera >= MAX_HOLD_MS) {
          await admin.from('whatsapp_scheduled_messages')
            .update({
              status: 'failed',
              // Mantém a origem para a sirene do autor continuar acesa. Limpar
              // aqui faria o alerta sumir justamente quando a mensagem desistiu
              // de vez e mais precisa de ação humana.
              hold_reason: 'reconnect',
              error: 'O canal ficou fora do ar por mais de 12h e a mensagem não foi enviada. Revalide o número em Configurações → Integrações → WhatsApp, ou envie por outro canal.',
            })
            .eq('id', m.id);
          failed++;
          continue;
        }
        await admin.from('whatsapp_scheduled_messages')
          .update({
            status: 'pending',
            hold_reason: 'reconnect',
            hold_since: new Date(desde).toISOString(),
            error: 'Aguardando reconexão automática do canal.',
            scheduled_at: new Date(Date.now() + proximaTentativaMs(espera)).toISOString(),
          })
          .eq('id', m.id);
        skipped++;
        continue;
      }
      await admin.from('whatsapp_scheduled_messages')
        .update({ status: 'failed', error: message.slice(0, 500) })
        .eq('id', m.id);
      failed++;
    }
  }

  const ia = await processarFollowupsIA(admin).catch((e) => {
    // O despacho da IA nunca pode derrubar o das mensagens agendadas: elas são
    // do atendente e já estão contabilizadas acima.
    console.error('followups de IA falharam', e);
    return { enviados: 0, cancelados: 0, adiados: 0, falhas: 0 };
  });

  const inatividade = await encerrarPorInatividade(admin).catch((e) => {
    console.error('encerramento por inatividade falhou', e);
    return { encerrados: 0, avisados: 0, reservados: 0, descartados: 0, adiados: 0, perdidos: 0 };
  });

  return new Response(JSON.stringify({ ok: true, processed: (due || []).length, sent, failed, skipped, ia, inatividade }), {
    headers: { 'Content-Type': 'application/json' },
  });
});

// ── Encerramento automático por inatividade ─────────────────────────────────

/**
 * Encerra as conversas que passaram do prazo de silêncio do próprio canal.
 *
 * Mora neste cron pelo mesmo motivo dos follow-ups da IA: o job de minuto em
 * minuto já existe, e criar outro chamando Edge Function com JWT é a armadilha
 * que deixou o weekly-digest seis semanas quebrado em silêncio.
 *
 * Quem escolhe É O BANCO (`wa_auto_close_due`): a comparação é entre o silêncio
 * de cada conversa e o prazo do canal dela, duas tabelas diferentes, e o relógio
 * tem de ser um só. Aqui só sobram duas decisões: o expediente (que depende do
 * fuso de cada canal) e o envio da despedida.
 *
 * O relógio conta desde a última mensagem NOSSA, quando é a última da conversa,
 * e o aviso de ausência não é resposta (ver `wa_auto_close_idle_since`). Sem
 * isso, mensagem que chega às 22h vira conversa encerrada 24h depois sem
 * ninguém ter atendido: o robô responde, o relógio zera na resposta do robô, e
 * o encerramento apaga do painel justamente o caso que o escritório deixou
 * passar.
 *
 * O EXPEDIENTE SEGURA A DESPEDIDA, NÃO O ENCERRAMENTO. O prazo vence a qualquer
 * hora e a conversa fecha na hora em que venceu — do contrário, com prazo de 4h
 * e expediente até as 18h, toda conversa falada depois das 14h passaria a noite
 * aberta no painel para encerrar às 08h com um "16h sem retorno" que ninguém
 * reconhece. O que espera a abertura é a única parte que o cliente vê: a
 * despedida fica RESERVADA na conversa (`auto_close_farewell_due_at`) e sai na
 * primeira varredura de expediente aberto.
 *
 * A ORDEM é encerrar-e-depois-avisar, ao contrário do encerramento manual. O
 * `wa_auto_close_claim` fecha e reserva no mesmo UPDATE, então duas varreduras
 * cruzadas nunca mandam duas despedidas para o mesmo cliente. O preço é que uma
 * falha de envio deixa a conversa encerrada sem aviso — some do painel, mas o
 * cliente não recebeu nada, e é isso que o log registra.
 */
async function encerrarPorInatividade(admin: any) {
  let encerrados = 0, avisados = 0, reservados = 0, descartados = 0, adiados = 0, perdidos = 0;

  // Uma consulta de agenda por CANAL, não por conversa: um canal com trinta
  // conversas paradas é o caso comum, e trinta consultas idênticas seriam um
  // N+1 nascido pronto.
  const agendaPorCanal = new Map<string, any[]>();
  const carregarAgenda = async (canalId: string) => {
    if (agendaPorCanal.has(canalId)) return agendaPorCanal.get(canalId)!;
    const { data } = await admin.from('whatsapp_business_hours')
      .select('day_of_week, start_time, end_time, is_active')
      .eq('instance_id', canalId);
    const rows = (data || []) as any[];
    agendaPorCanal.set(canalId, rows);
    return rows;
  };

  /** O canal pode falar com o cliente agora? Sem a trava, sempre pode. */
  const podeFalarAgora = async (linha: any) => {
    if (!linha.business_hours_only) return true;
    const agenda = await carregarAgenda(String(linha.channel_id));
    return isWithinBusinessHours(agenda, localTimeInTz(String(linha.channel_timezone || 'America/Cuiaba')));
  };

  const mandarDespedida = async (convId: string, texto: string): Promise<boolean> => {
    try {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/evolution-send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SERVICE_ROLE}` },
        body: JSON.stringify({ conversation_id: convId, text: texto }),
      });
      const j = await resp.json().catch(() => ({}));
      if (!resp.ok || j?.error) throw new Error(j?.error || `HTTP ${resp.status}`);
      return true;
    } catch (e) {
      // A conversa já está encerrada — refazer o envio depois mandaria uma
      // despedida solta numa conversa que ninguém está mais acompanhando.
      console.error('despedida de inatividade não saiu', convId, String((e as Error).message || e));
      return false;
    }
  };

  // ── 1. As despedidas que ficaram reservadas fora do expediente ────────────
  // Vêm ANTES dos encerramentos novos de propósito: são dívida do dia anterior,
  // e o limite de 40 por varredura não pode ser gasto todo com conversa nova.
  const { data: reservas, error: reservaErr } = await admin.rpc('wa_auto_close_farewells_due', { p_limit: 40 });
  if (reservaErr) console.error('wa_auto_close_farewells_due falhou', reservaErr);

  for (const reserva of (reservas || []) as any[]) {
    const convId = String(reserva.conversation_id);
    if (!(await podeFalarAgora(reserva))) { adiados++; continue; }

    const { data: aindaEncerrada, error: claimErr } = await admin.rpc('wa_auto_close_farewell_claim', {
      p_conversation_id: convId,
    });
    if (claimErr) { console.error('wa_auto_close_farewell_claim falhou', convId, claimErr); perdidos++; continue; }
    // FALSE = o cliente voltou a escrever durante a espera. Despedir-se de quem
    // acabou de chegar é pior do que não se despedir. NULL = outra varredura levou.
    if (aindaEncerrada !== true) { descartados++; continue; }

    const texto = String(reserva.farewell || '').trim();
    if (!texto) continue;
    if (await mandarDespedida(convId, texto)) avisados++; else perdidos++;
  }

  // ── 2. Os encerramentos vencidos ──────────────────────────────────────────
  const { data: vencidas, error } = await admin.rpc('wa_auto_close_due', { p_limit: 40 });
  if (error) {
    console.error('wa_auto_close_due falhou', error);
    return { encerrados, avisados, reservados, descartados, adiados, perdidos };
  }

  for (const linha of (vencidas || []) as any[]) {
    const convId = String(linha.conversation_id);
    const despedida = String(linha.farewell || '').trim();
    // Fora do expediente a conversa encerra assim mesmo; o que espera a abertura
    // é o aviso. Sem despedida configurada não há nada a reservar.
    const noHorario = await podeFalarAgora(linha);
    const guardarDespedida = !noHorario && !!despedida;

    // O silêncio REAL (desde que a bola passou para o cliente), não o prazo do
    // canal: os dois divergem sempre que a varredura fica adiada, e o motivo que
    // fica registrado é lido por gente.
    const horas = Math.round((Number(linha.silent_minutes ?? linha.idle_minutes) / 60) * 10) / 10;
    const motivo = `Encerrado automaticamente: ${horas}h sem retorno do cliente.`;

    const { data: fechou, error: claimErr } = await admin.rpc('wa_auto_close_claim', {
      p_conversation_id: convId,
      p_idle_minutes: Number(linha.idle_minutes),
      p_reason: motivo,
      p_hold_farewell: guardarDespedida,
    });
    if (claimErr) { console.error('wa_auto_close_claim falhou', convId, claimErr); perdidos++; continue; }
    // NULL = o cliente escreveu no meio do caminho, ou outra varredura chegou antes.
    if (!fechou) { adiados++; continue; }
    encerrados++;

    if (!despedida) continue;
    if (guardarDespedida) { reservados++; continue; }
    if (await mandarDespedida(convId, despedida)) avisados++; else perdidos++;
  }

  return { encerrados, avisados, reservados, descartados, adiados, perdidos };
}

// ── Acompanhamentos do assistente de IA ─────────────────────────────────────

/**
 * Despacha os follow-ups agendados pelo agente.
 *
 * Nada é enviado só porque venceu. Antes de cada envio o estado é RELIDO e
 * passa por `decideFollowup`: cliente que respondeu, conversa encerrada,
 * handoff humano, IA desligada no canal ou no agente e teto de tentativas
 * cancelam o lembrete. Fora da janela de dias/horas do canal ele é ADIADO para
 * a próxima abertura, nunca enviado de madrugada.
 *
 * O envio sai por `evolution-send`, o mesmo caminho resiliente das demais
 * mensagens automáticas.
 */
async function processarFollowupsIA(admin: any) {
  const agora = new Date();
  let enviados = 0, cancelados = 0, adiados = 0, falhas = 0;

  const { data: vencidos } = await admin
    .from('whatsapp_ai_followups')
    .select('id, conversation_id, assistant_id, attempt, scheduled_at, message, created_at')
    .eq('status', 'pending')
    .lte('scheduled_at', agora.toISOString())
    .order('scheduled_at', { ascending: true })
    .limit(20);

  for (const fu of (vencidos || []) as any[]) {
    const { data: conv } = await admin.from('whatsapp_conversations')
      .select('id, instance_id, status, is_blocked, assigned_user_id, awaiting_accept, contact_name, last_customer_message_at')
      .eq('id', fu.conversation_id).maybeSingle();
    const { data: session } = await admin.from('whatsapp_ai_sessions')
      .select('ai_active, status, followup_attempts, pending_items, followup_opt_out')
      .eq('conversation_id', fu.conversation_id).maybeSingle();
    const { data: assistant } = await admin.from('whatsapp_ai_assistants')
      .select('*').eq('id', fu.assistant_id).maybeSingle();

    if (!conv || !assistant) {
      await cancelarFollowup(admin, fu.id, fu.conversation_id, 'Conversa ou agente não existe mais.');
      cancelados++; continue;
    }

    const { data: config } = await admin.from('whatsapp_ai_channel_config')
      .select('ai_enabled, assistant_id').eq('channel_id', conv.instance_id).maybeSingle();

    const decisao = decideFollowup({
      attempt: fu.attempt,
      createdAtIso: fu.created_at,
      lastCustomerMessageAtIso: conv.last_customer_message_at ?? null,
      conversationStatus: String(conv.status || 'open'),
      aiActive: session?.ai_active !== false,
      assistantActive: assistant.is_active === true,
      channelAiEnabled: config?.ai_enabled === true,
      followupEnabled: assistant.followup_enabled === true,
      maxAttempts: Number(assistant.followup_max_attempts || 3),
      optedOut: session?.followup_opt_out === true,
    });

    // Um atendente que assumiu a conversa também para o lembrete: quem fala com
    // o cliente agora é ele.
    if (decisao.send && conv.assigned_user_id) {
      await cancelarFollowup(admin, fu.id, conv.id, 'Conversa assumida por um atendente.');
      cancelados++; continue;
    }
    if (conv.is_blocked) {
      await cancelarFollowup(admin, fu.id, conv.id, 'Contato bloqueado.');
      cancelados++; continue;
    }
    if (!decisao.send) {
      await cancelarFollowup(admin, fu.id, conv.id, decisao.reason);
      cancelados++; continue;
    }

    const policy = normalizeWaAiFollowupPolicy({
      enabled: assistant.followup_enabled,
      maxAttempts: assistant.followup_max_attempts,
      strategy: assistant.followup_strategy,
      intervalHours: Number(assistant.followup_interval_hours),
      customHours: (assistant.followup_custom_hours || []).map(Number),
      days: assistant.followup_days || [],
      startMinute: assistant.followup_start_minute,
      endMinute: assistant.followup_end_minute,
      timezone: assistant.timezone,
      inactivityMinutes: Number(assistant.followup_inactivity_minutes ?? 10),
    });

    if (!isWithinFollowupWindow(agora, policy)) {
      const proximo = nextAllowedSlot(agora, policy);
      await admin.from('whatsapp_ai_followups')
        .update({ scheduled_at: proximo.toISOString() }).eq('id', fu.id).eq('status', 'pending');
      // A sessão promete o que a linha pendente marca: adiar uma sem a outra
      // deixa o painel anunciando um horário que já não existe.
      await sincronizarPromessa(admin, conv.id, proximo.toISOString());
      adiados++; continue;
    }

    try {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/evolution-send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SERVICE_ROLE}` },
        body: JSON.stringify({ conversation_id: fu.conversation_id, sender_user_id: null, text: fu.message }),
      });
      const j = await resp.json().catch(() => ({}));
      if (!resp.ok || j?.error) {
        // Canal fora do ar: o lembrete espera a reconexão, como as agendadas.
        if (j?.reconnect_pending === true) {
          const espera = new Date(Date.now() + 15 * 60_000).toISOString();
          await admin.from('whatsapp_ai_followups')
            .update({ scheduled_at: espera })
            .eq('id', fu.id).eq('status', 'pending');
          await sincronizarPromessa(admin, conv.id, espera);
          adiados++; continue;
        }
        throw new Error(String(j?.error || `HTTP ${resp.status}`));
      }

      await admin.from('whatsapp_ai_followups')
        .update({ status: 'sent', sent_at: new Date().toISOString(), error: null })
        .eq('id', fu.id);

      // O agente registra o turno, avança o contador e cria a PRÓXIMA linha
      // pendente. Falhar aqui não desfaz o envio: a mensagem já saiu.
      const registrado = await fetch(`${SUPABASE_URL}/functions/v1/whatsapp-ai-agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SERVICE_ROLE}` },
        body: JSON.stringify({ conversation_id: fu.conversation_id, followup_id: fu.id }),
        signal: AbortSignal.timeout(20_000),
      }).then(r => r.ok, (e) => {
        console.error('registro do turno de follow-up falhou', fu.id, e);
        return false;
      });

      // Rede de segurança. Se o agente não respondeu, a escada pararia aqui
      // para sempre — este follow-up já está `sent` e ninguém mais olha para
      // ele. `ensureWaAiFollowupScheduled` é idempotente, então quando o agente
      // TIVER criado a próxima linha esta chamada não cria uma segunda.
      if (!registrado) {
        await avancarEscadaIA(admin, { fu, conv, session, assistant, config, policy })
          .catch(e => console.error('rede de segurança da escada falhou', fu.id, e));
      }

      enviados++;
    } catch (e) {
      await admin.from('whatsapp_ai_followups')
        .update({ status: 'failed', error: String((e as Error).message || e).slice(0, 500) })
        .eq('id', fu.id);
      // Falhou: não há mais pendente, então não há mais promessa a fazer.
      await sincronizarPromessa(admin, conv.id, null);
      falhas++;
    }
  }

  return { enviados, cancelados, adiados, falhas };
}

/** `whatsapp_ai_sessions.next_followup_at` sempre igual ao pendente da conversa. */
async function sincronizarPromessa(admin: any, conversationId: string, iso: string | null) {
  await admin.from('whatsapp_ai_sessions')
    .update({ next_followup_at: iso })
    .eq('conversation_id', conversationId)
    .then(() => {}, () => {});
}

/**
 * Cria a linha pendente da PRÓXIMA tentativa quando o agente não respondeu.
 *
 * É a mesma conta que `runFollowupTurn` faz, com os dados que este laço já
 * carregou. Existe porque a alternativa é a escada morrer em silêncio: o
 * follow-up recém-enviado já está `sent`, e nada mais no sistema volta a olhar
 * para uma conversa sem linha pendente.
 */
async function avancarEscadaIA(admin: any, ctx: {
  fu: any; conv: any; session: any; assistant: any; config: any;
  policy: ReturnType<typeof normalizeWaAiFollowupPolicy>;
}) {
  const attempts = Math.max(Number(ctx.fu.attempt || 0), Number(ctx.session?.followup_attempts || 0) + 1);

  await admin.from('whatsapp_ai_sessions')
    .update({ followup_attempts: attempts })
    .eq('conversation_id', ctx.conv.id)
    .then(() => {}, () => {});

  const decisao = decideAutoFollowup({
    mode: ctx.assistant.mode === 'auto' ? 'auto' : 'test',
    replySent: true,
    policyEnabled: ctx.policy.enabled,
    maxAttempts: ctx.policy.maxAttempts,
    attemptsDone: attempts,
    assistantActive: ctx.assistant.is_active === true,
    channelAiEnabled: ctx.config?.ai_enabled === true,
    aiActive: ctx.session?.ai_active !== false,
    sessionStatus: String(ctx.session?.status || 'active'),
    conversationStatus: String(ctx.conv.status || 'open'),
    conversationBlocked: ctx.conv.is_blocked === true,
    assignedUserId: ctx.conv.assigned_user_id ?? null,
    awaitingAccept: ctx.conv.awaiting_accept === true,
    handedOff: false,
    followupCancelled: false,
    optedOut: ctx.session?.followup_opt_out === true,
  });

  if (!decisao.schedule) {
    await admin.from('whatsapp_ai_sessions')
      .update({ next_followup_at: null }).eq('conversation_id', ctx.conv.id)
      .then(() => {}, () => {});
    return;
  }

  await ensureWaAiFollowupScheduled(admin, {
    conversationId: ctx.conv.id,
    assistantId: ctx.assistant.id,
    policy: ctx.policy,
    attempt: decisao.attempt,
    fromIso: new Date().toISOString(),
    message: buildWaAiFollowupMessage({
      firstName: waAiFirstName(ctx.conv.contact_name),
      lastQuestion: null,
      pendingItems: Array.isArray(ctx.session?.pending_items)
        ? ctx.session.pending_items.map((i: unknown) => String(i))
        : [],
      attempt: decisao.attempt,
    }),
    reason: `Escada automática · tentativa ${decisao.attempt} de ${ctx.policy.maxAttempts}.`,
  });
}

/**
 * Cancela o lembrete e apaga a promessa da sessão no mesmo gesto. Deixar
 * `next_followup_at` de pé sem linha pendente é o estado que faz o painel
 * anunciar uma retomada que nunca vai sair.
 */
async function cancelarFollowup(admin: any, id: string, conversationId: string, motivo: string) {
  await admin.from('whatsapp_ai_followups')
    .update({ status: 'cancelled', cancel_reason: motivo.slice(0, 300) })
    .eq('id', id).eq('status', 'pending');
  await admin.from('whatsapp_ai_sessions')
    .update({ next_followup_at: null })
    .eq('conversation_id', conversationId)
    .then(() => {}, () => {});
}
