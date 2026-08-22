/**
 * evolution-instance — conecta/consulta um CANAL (instância) na Evolution API.
 *
 * POST { action: 'connect' | 'status', channel_id }
 *   - connect: garante a instância do canal, configura o webhook (token do canal)
 *     e retorna QR + estado.
 *   - status:  consulta o estado atual.
 *
 * Servidor (base_url + api_key) vem de system_settings.whatsapp_evolution_config.
 * Dados do canal (instance_name, webhook_token) vêm de whatsapp_instances.
 * Requer JWT (equipe).
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { applyChannelState } from '../_shared/wa-channel-state.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-api-version',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const admin = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  // O cabeçalho diz "requer JWT (equipe)" desde sempre, mas quem conferia era só
  // o gateway — que aceita QUALQUER `authenticated`, inclusive o cliente logado
  // no Portal. E o que sai daqui é o QR CODE do canal: quem lê o QR entra na
  // conta de WhatsApp do escritório. A conferência é de gente do escritório E de
  // acesso àquele canal, e quem responde a segunda é a policy `wa_can_see_channel`
  // (pelo cliente do USUÁRIO — o `admin` acima ignora RLS de propósito).
  const userClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') || '' } },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: 'Não autenticado' }, 401);
  const { data: ehEquipe } = await userClient.rpc('is_office_staff');
  if (ehEquipe !== true) return json({ error: 'Sem permissão' }, 403);

  let body: any = {};
  try { body = await req.json(); } catch { /* */ }
  const action = body?.action || 'connect';
  const channelId = body?.channel_id;
  if (!channelId) return json({ error: 'channel_id obrigatório' }, 400);

  const { data: canalVisivel } = await userClient
    .from('whatsapp_instances').select('id').eq('id', channelId).maybeSingle();
  if (!canalVisivel) return json({ error: 'Você não tem acesso a este canal.' }, 403);

  // Servidor
  const { data: row } = await admin.from('system_settings').select('value')
    .eq('key', 'whatsapp_evolution_config').maybeSingle();
  const server = (row?.value || {}) as { base_url?: string; api_key?: string };
  if (!server.base_url || !server.api_key) {
    return json({ error: 'Servidor Evolution não configurado (URL + API key em Configurações).' }, 400);
  }

  // Canal
  const { data: channel } = await admin.from('whatsapp_instances')
    .select('*').eq('id', channelId).maybeSingle();
  if (!channel) return json({ error: 'Canal não encontrado' }, 404);

  const base = server.base_url.replace(/\/+$/, '');
  const evo = (path: string, init?: RequestInit) =>
    fetch(`${base}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', apikey: server.api_key!, ...(init?.headers || {}) },
    });
  const inst = encodeURIComponent(channel.instance_name);

  try {
    const stateRes = await evo(`/instance/connectionState/${inst}`);
    const exists = stateRes.status !== 404;
    let state = 'close';
    if (exists) {
      const sj = await stateRes.json().catch(() => ({}));
      state = sj?.instance?.state || sj?.state || 'close';
    }

    if (action === 'status') {
      const decision = await applyChannelState(admin, channel, state);
      return json({ status: decision.status, phone: channel.phone_number });
    }

    // ── connect ──
    //
    // O token do webhook saiu de `whatsapp_instances` (tabela que o navegador de
    // toda a equipe lê) para `private.whatsapp_instance_secrets`. Quem o entrega
    // — criando um na primeira vez — é uma RPC SECURITY DEFINER concedida só ao
    // service role. São 32 bytes aleatórios em hex, e não mais um uuid: uuid v4
    // é identificador, não segredo.
    const { data: token, error: tokenErr } = await admin.rpc('wa_ensure_webhook_token', { p_channel: channel.id });
    if (tokenErr || !token) return json({ error: 'Falha ao preparar o webhook do canal.' }, 500);
    const webhookUrl = `${SUPABASE_URL}/functions/v1/evolution-webhook?token=${token}`;
    const events = ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CONNECTION_UPDATE', 'CONTACTS_UPSERT', 'PRESENCE_UPDATE'];

    if (!exists) {
      await evo('/instance/create', {
        method: 'POST',
        body: JSON.stringify({
          instanceName: channel.instance_name,
          qrcode: true,
          integration: 'WHATSAPP-BAILEYS',
          webhook: { url: webhookUrl, byEvents: false, base64: true, events },
        }),
      });
    }

    await evo(`/webhook/set/${inst}`, {
      method: 'POST',
      body: JSON.stringify({
        webhook: { enabled: true, url: webhookUrl, webhookByEvents: false, webhookBase64: true, events },
      }),
    }).catch(() => {});

    // ── Nunca criar um segundo socket para a mesma sessão ──
    //
    // `/instance/connect` numa instância que ainda tem socket vivo abre OUTRA
    // conexão com a MESMA credencial, e o WhatsApp derruba uma delas com
    // `conflict type="replaced"`. As duas reconectam, se derrubam de novo, e o
    // canal entra numa guerra que não termina sozinha (medido em 17/08/2026:
    // estado alternando open/close/connecting várias vezes por segundo, envios
    // morrendo com `1006`). Só se sai dela reiniciando o processo da Evolution.
    //
    // Por isso duas travas antes de conectar:
    //   1. uma leitura `open` já basta para NÃO conectar;
    //   2. leitura ruim é conferida uma segunda vez — numa instância em guerra a
    //      primeira leitura mente metade das vezes, e é justamente aí que o
    //      clique de socorro colocava mais um lutador no ringue.
    if (state === 'open') {
      const decision = await applyChannelState(admin, channel, state);
      return json({ status: decision.status, phone: channel.phone_number, already_connected: true });
    }
    if (exists) {
      await new Promise(resolve => setTimeout(resolve, 1_200));
      const conferencia = await evo(`/instance/connectionState/${inst}`)
        .then(r => r.json()).catch(() => ({}));
      const segunda = conferencia?.instance?.state || conferencia?.state || state;
      if (segunda === 'open') {
        const decision = await applyChannelState(admin, channel, segunda);
        return json({ status: decision.status, phone: channel.phone_number, already_connected: true });
      }
      state = segunda;
    }

    let qr: string | null = null;
    const connRes = await evo(`/instance/connect/${inst}`);
    if (connRes.ok) {
      const cj = await connRes.json().catch(() => ({}));
      qr = cj?.base64 || cj?.qrcode?.base64 || cj?.qr || cj?.code || null;
    }

    const st2 = await evo(`/instance/connectionState/${inst}`).then(r => r.json()).catch(() => ({}));
    const finalState = st2?.instance?.state || state;

    // O QR vai na RESPOSTA e não é mais guardado. `last_qr` existia desde a
    // primeira migration do módulo e nunca foi lido por ninguém — era um QR de
    // pareamento parado no banco, e quem lê o QR entra na conta de WhatsApp do
    // escritório. Um segredo que ninguém consome só tem tempo para vazar.
    await admin.from('whatsapp_instances')
      .update({ last_reconnect_attempt_at: new Date().toISOString() }).eq('id', channel.id);
    const decision = await applyChannelState(admin, channel, finalState);
    return json({ status: decision.status, qr, phone: channel.phone_number });
  } catch (err) {
    return json({ error: (err as Error).message || 'Erro ao conectar à Evolution.' }, 500);
  }
});
