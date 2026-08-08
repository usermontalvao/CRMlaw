/**
 * whatsapp-ai-decide — a decisão humana sobre o que o atendente de IA propôs.
 *
 * Fecha as duas pontas que ficavam abertas: o motor gravava "precisa de
 * aprovação" e não existia nada capaz de dar essa aprovação. Aqui é onde alguém
 * do escritório diz sim ou não, e — importante — é o MESMO lugar que produz o
 * efeito da decisão. As tabelas são só-leitura para o staff justamente para que
 * não haja um segundo caminho: marcar uma reunião como "autorizada" direto no
 * banco deixaria o cliente sem aviso e o efeito sem acontecer.
 *
 * Auth: JWT do usuário + linha em profiles (mesma regra do is_office_staff()).
 * A execução em si usa service role, depois que a pessoa foi identificada.
 *
 * Body:
 *   { kind: 'reuniao',    id, action: 'autorizar'|'remarcar'|'recusar',
 *     novo_horario?: 'AAAA-MM-DD HH:MM', motivo?: string }
 *   { kind: 'ferramenta', id, action: 'aprovar'|'recusar', motivo?: string }
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  doFusoDoEscritorio,
  executeTool,
  formatarNoEscritorio,
  sendText,
  type ExecCtx,
} from '../_shared/wa-agent-executor.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  // ── Quem está decidindo ───────────────────────────────────────────────────
  const authHeader = req.headers.get('authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return new Response('Unauthorized', { status: 401 });

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { authorization: authHeader } },
  });
  const { data: { user }, error: userErr } = await userClient.auth.getUser();
  if (userErr || !user) return new Response('Unauthorized', { status: 401 });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  // Cliente do portal também tem JWT válido. Aprovar ação do escritório é do
  // escritório: exige linha em profiles, igual ao is_office_staff() das RLS.
  const { data: perfil } = await admin.from('profiles')
    .select('user_id').eq('user_id', user.id).maybeSingle();
  if (!perfil) return new Response('Forbidden', { status: 403 });

  let body: {
    kind?: string; id?: string; action?: string;
    novo_horario?: string; motivo?: string;
  };
  try { body = await req.json(); } catch { return new Response('Bad JSON', { status: 400 }); }

  const { kind, id, action } = body;
  if (!id) return json({ error: 'id obrigatório' }, 400);

  try {
    if (kind === 'reuniao') return await decidirReuniao(admin, user.id, body);
    if (kind === 'ferramenta') return await decidirFerramenta(admin, user.id, body);
    return json({ error: `kind "${kind}" desconhecido` }, 400);
  } catch (err) {
    const motivo = String(err instanceof Error ? err.message : err).slice(0, 500);
    console.error('whatsapp-ai-decide', kind, action, motivo);
    return json({ error: motivo }, 500);
  }
});

// ── Reunião ─────────────────────────────────────────────────────────────────

async function decidirReuniao(
  admin: any, userId: string,
  body: { id?: string; action?: string; novo_horario?: string; motivo?: string },
): Promise<Response> {
  const { data: pedido } = await admin.from('whatsapp_ai_meeting_requests')
    .select('*').eq('id', body.id).maybeSingle();

  if (!pedido) return json({ error: 'pedido de reunião não encontrado' }, 404);
  if (pedido.status !== 'pendente') {
    return json({ error: `este pedido já foi ${pedido.status}` }, 409);
  }

  const ctx = ctxDaConversa(admin, pedido.conversation_id, pedido.client_id, pedido.agent_id);
  const motivo = (body.motivo || '').trim() || null;

  let novoStatus: 'autorizada' | 'remarcada' | 'recusada';
  let quandoFinal: Date | null = null;
  let aviso: string;

  if (body.action === 'autorizar') {
    novoStatus = 'autorizada';
    quandoFinal = new Date(pedido.proposed_at);
    aviso = `Seu horário está confirmado: ${formatarNoEscritorio(quandoFinal)}. ${pedido.subject}.`;

  } else if (body.action === 'remarcar') {
    const novo = doFusoDoEscritorio((body.novo_horario || '').trim());
    if (!novo) return json({ error: 'novo_horario inválido — use AAAA-MM-DD HH:MM' }, 400);
    if (novo.getTime() < Date.now()) return json({ error: 'o novo horário já passou' }, 400);
    novoStatus = 'remarcada';
    quandoFinal = novo;
    aviso = `Precisei ajustar o horário: ficou para ${formatarNoEscritorio(novo)}. ${pedido.subject}.`
      + (motivo ? ` ${motivo}` : '');

  } else if (body.action === 'recusar') {
    novoStatus = 'recusada';
    aviso = 'Não vou conseguir manter o horário que combinamos para a reunião.'
      + (motivo ? ` ${motivo}` : '')
      + ' Me diga um outro horário que funcione para você.';

  } else {
    return json({ error: `action "${body.action}" inválida para reunião` }, 400);
  }

  // ── A agenda acompanha a decisão ──────────────────────────────────────────
  if (pedido.calendar_event_id) {
    if (novoStatus === 'recusada') {
      await admin.from('calendar_events')
        .update({ status: 'cancelado' }).eq('id', pedido.calendar_event_id);
    } else {
      const { data: ev } = await admin.from('calendar_events')
        .select('title').eq('id', pedido.calendar_event_id).maybeSingle();
      // Tira o "[A confirmar]" do título: é ele que sinaliza pendência na agenda.
      const titulo = String(ev?.title || '').replace(/^\[A confirmar\]\s*/, '');
      await admin.from('calendar_events').update({
        title: titulo,
        description: 'Reunião do atendimento no WhatsApp, autorizada por pessoa do escritório.',
        start_at: quandoFinal!.toISOString(),
        end_at: new Date(quandoFinal!.getTime() + 3600_000).toISOString(),
      }).eq('id', pedido.calendar_event_id);
    }
  }

  // ── O cliente é avisado, e só então marcamos que foi avisado ──────────────
  // Ordem importa: carimbar antes de enviar produziria "avisado" sem aviso —
  // exatamente o modo de falha que já mordeu o aviso de fora de horário.
  const erroEnvio = await sendText(ctx, aviso);

  await admin.from('whatsapp_ai_meeting_requests').update({
    status: novoStatus,
    rescheduled_at: novoStatus === 'remarcada' ? quandoFinal!.toISOString() : null,
    decided_by: userId,
    decided_at: new Date().toISOString(),
    reason: motivo,
    client_notified_at: erroEnvio ? null : new Date().toISOString(),
  }).eq('id', pedido.id);

  await nota(
    admin, pedido.conversation_id,
    `🤖 Reunião ${novoStatus} por decisão humana.`
    + (quandoFinal ? ` Horário: ${formatarNoEscritorio(quandoFinal)}.` : '')
    + (motivo ? ` Motivo: ${motivo}.` : '')
    + (erroEnvio ? ` ⚠️ O aviso ao cliente NÃO saiu: ${erroEnvio}` : ' Cliente avisado.'),
  );

  return json({ ok: true, status: novoStatus, cliente_avisado: !erroEnvio, erro_envio: erroEnvio });
}

// ── Ferramenta de risco alto ────────────────────────────────────────────────

async function decidirFerramenta(
  admin: any, userId: string,
  body: { id?: string; action?: string; motivo?: string },
): Promise<Response> {
  const { data: pedido } = await admin.from('whatsapp_ai_tool_approvals')
    .select('*').eq('id', body.id).maybeSingle();

  if (!pedido) return json({ error: 'pedido não encontrado' }, 404);
  if (pedido.status !== 'pendente') {
    return json({ error: `este pedido já foi ${pedido.status}` }, 409);
  }

  const motivo = (body.motivo || '').trim() || null;
  const agora = new Date().toISOString();

  if (body.action === 'recusar') {
    await admin.from('whatsapp_ai_tool_approvals').update({
      status: 'recusada', decided_by: userId, decided_at: agora, reason: motivo,
    }).eq('id', pedido.id);
    await nota(admin, pedido.conversation_id,
      `🤖 Ação "${pedido.tool_name}" recusada.${motivo ? ` Motivo: ${motivo}.` : ''} Nada foi enviado ao cliente.`);
    return json({ ok: true, status: 'recusada' });
  }

  if (body.action !== 'aprovar') {
    return json({ error: `action "${body.action}" inválida para ferramenta` }, 400);
  }

  // Aprovar EXECUTA — e executa exatamente os args que estavam na tela de quem
  // aprovou, não uma nova chamada ao modelo.
  const { data: conv } = await admin.from('whatsapp_conversations')
    .select('instance_id, client_id').eq('id', pedido.conversation_id).maybeSingle();

  const ctx = ctxDaConversa(admin, pedido.conversation_id, conv?.client_id ?? null, pedido.agent_id, conv?.instance_id ?? null);

  const { data: estado } = await admin.from('whatsapp_ai_agent_state')
    .select('*').eq('conversation_id', pedido.conversation_id).maybeSingle();

  const r = await executeTool(ctx, pedido.tool_name, pedido.args || {}, estado || {});

  await admin.from('whatsapp_ai_tool_approvals').update({
    status: 'aprovada',
    decided_by: userId,
    decided_at: agora,
    reason: motivo,
    executed_at: new Date().toISOString(),
    execution_ok: r.ok,
    execution_detail: r.detail,
  }).eq('id', pedido.id);

  await nota(admin, pedido.conversation_id,
    r.ok
      ? `🤖 Ação "${pedido.tool_name}" aprovada e executada: ${r.detail}`
      : `🤖 Ação "${pedido.tool_name}" foi aprovada mas FALHOU ao executar: ${r.detail}`);

  return json({ ok: r.ok, status: 'aprovada', detalhe: r.detail });
}

// ── Apoio ───────────────────────────────────────────────────────────────────

function ctxDaConversa(
  admin: any, conversationId: string, clientId: string | null,
  agentId: string | null, channelId: string | null = null,
): ExecCtx {
  return {
    admin, conversationId, channelId, clientId, agentId,
    supabaseUrl: SUPABASE_URL, serviceKey: SERVICE_KEY,
  };
}

async function nota(admin: any, conversationId: string, body: string): Promise<void> {
  await admin.from('whatsapp_internal_notes')
    .insert({ conversation_id: conversationId, author_id: null, body })
    .then(() => {}, (e: Error) => console.error('nota interna falhou', e.message));
}
