/**
 * whatsapp-contact-probe — "esse número tem WhatsApp? e qual é a cara dele?"
 *
 * POST { phones: string[], channel_id?: string, refresh?: boolean } (JWT da equipe)
 * → { results: [{ phone, has_whatsapp, jid, avatar_path }] }
 *
 * Quem responde é a Evolution: `/chat/whatsappNumbers` diz se o número existe
 * (e devolve o jid já com a variante certa do nono dígito brasileiro) e
 * `/chat/fetchProfilePictureUrl` dá a foto de perfil. A foto é BAIXADA e
 * guardada no bucket whatsapp-media, porque a URL que o WhatsApp devolve é de
 * CDN e expira em horas — o mesmo motivo pelo qual `whatsapp-avatar` faz cópia.
 *
 * Três cuidados que definem o desenho:
 *
 *  · SÓ O QUE ESTÁ NA TELA. A agenda tem centenas de números; sondar todos na
 *    abertura seria uma varredura no servidor do WhatsApp a cada clique em
 *    "Nova conversa" — o tipo de tráfego que faz a instância ser desconectada.
 *    O painel manda só as linhas visíveis, em lotes pequenos.
 *
 *  · CACHE DE VERDADE. A resposta vive em `whatsapp_contact_probes` e vale
 *    dias: quem tem WhatsApp hoje tem amanhã, e foto de perfil não muda de hora
 *    em hora. Número já sondado nem chega a virar requisição.
 *
 *  · SILÊNCIO NÃO É "NÃO TEM". Lookup fora do ar grava `has_whatsapp = null` —
 *    e o painel trata null como "não sei", que é diferente de "não tem". Marcar
 *    um cliente como sem WhatsApp porque a Evolution piscou seria pior do que
 *    não marcar nada.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';

const MEDIA_BUCKET = 'whatsapp-media';
/** Uma resposta vale isto antes de valer a pena perguntar de novo. */
const TTL_DIAS = 7;
/** Teto por chamada: o painel manda o que está na tela, não a agenda inteira. */
const MAX_POR_CHAMADA = 24;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-api-version',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

interface Probe {
  phone: string;
  has_whatsapp: boolean | null;
  jid: string | null;
  avatar_path: string | null;
}

/** Dígitos, com 55 na frente — o mesmo formato de `normalizePhone` no cliente. */
function normalize(raw: string): string {
  const d = String(raw || '').replace(/@.*/, '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('55')) return d;
  if (d.length === 10 || d.length === 11) return `55${d}`;
  return d;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const userClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') || '' } },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: 'Não autenticado' }, 401);
  // A agenda inteira é do escritório: o cliente logado no portal também é
  // `authenticated`, e sondar números não é assunto dele.
  const { data: ehEquipe } = await userClient.rpc('is_office_staff');
  if (ehEquipe !== true) return json({ error: 'Sem permissão' }, 403);

  const admin = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

  const pedidos: string[] = Array.from(new Set(
    (Array.isArray(body?.phones) ? body.phones : []).map((p: unknown) => normalize(String(p))).filter(Boolean),
  )).slice(0, MAX_POR_CHAMADA) as string[];
  if (pedidos.length === 0) return json({ results: [] });

  const refresh = body?.refresh === true;
  const resultado = new Map<string, Probe>();

  // 1. O que já sabemos e ainda vale.
  if (!refresh) {
    const limite = new Date(Date.now() - TTL_DIAS * 86_400_000).toISOString();
    const { data: cache } = await admin.from('whatsapp_contact_probes')
      .select('phone, has_whatsapp, jid, avatar_path')
      .in('phone', pedidos)
      .gte('checked_at', limite);
    for (const row of (cache || []) as Probe[]) resultado.set(row.phone, row);
  }

  const faltando = pedidos.filter(p => !resultado.has(p));
  if (faltando.length === 0) return json({ results: [...resultado.values()] });

  // 2. Qual instância pergunta. O canal pedido, ou qualquer um conectado.
  let instanceName: string | null = null;
  if (body?.channel_id) {
    const { data } = await admin.from('whatsapp_instances')
      .select('instance_name').eq('id', body.channel_id).maybeSingle();
    instanceName = data?.instance_name || null;
  }
  if (!instanceName) {
    const { data } = await admin.from('whatsapp_instances')
      .select('instance_name').eq('status', 'connected').limit(1).maybeSingle();
    instanceName = data?.instance_name || null;
  }

  const { data: cfgRow } = await admin.from('system_settings')
    .select('value').eq('key', 'whatsapp_evolution_config').maybeSingle();
  const server = (cfgRow?.value || {}) as { base_url?: string; api_key?: string };

  // Sem canal ou sem servidor não dá para responder — e "não deu para perguntar"
  // se devolve como desconhecido, nunca como "não tem WhatsApp".
  if (!instanceName || !server.base_url || !server.api_key) {
    for (const phone of faltando) resultado.set(phone, { phone, has_whatsapp: null, jid: null, avatar_path: null });
    return json({ results: [...resultado.values()] });
  }
  const base = server.base_url.replace(/\/+$/, '');
  const inst = encodeURIComponent(instanceName);

  // 3. Existe? (uma requisição para o lote inteiro)
  //
  // A resposta é casada de volta com o que foi PERGUNTADO, e não lida em ordem:
  // a Evolution ecoa o número em `number` em algumas versões e só devolve o
  // `jid` em outras, e o jid pode ter um dígito a menos que o pedido (o nono do
  // celular brasileiro). Casar pelos 8 últimos dígitos cobre as duas formas —
  // é a mesma tolerância que o resto do módulo usa para o nono dígito. Sem
  // isso, a falta de um campo faria a agenda inteira voltar como "não sei" sem
  // erro nenhum aparecendo.
  const existencia = new Map<string, { exists: boolean; jid: string | null }>();
  const porFinal = new Map<string, string>();
  for (const p of faltando) porFinal.set(p.slice(-8), p);
  try {
    const res = await fetch(`${base}/chat/whatsappNumbers/${inst}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: server.api_key },
      body: JSON.stringify({ numbers: faltando }),
      signal: AbortSignal.timeout(20_000),
    });
    if (res.ok) {
      const arr = await res.json().catch(() => []);
      for (const hit of Array.isArray(arr) ? arr : []) {
        const eco = normalize(String(hit?.number ?? ''));
        const doJid = normalize(String(hit?.jid ?? ''));
        const pedido = (eco && faltando.includes(eco) ? eco : null)
          ?? porFinal.get((eco || doJid).slice(-8))
          ?? null;
        if (!pedido) continue;
        existencia.set(pedido, { exists: hit?.exists === true, jid: hit?.jid || null });
      }
    }
  } catch { /* lookup fora do ar: todos ficam como desconhecidos */ }

  // 4. A foto de quem existe.
  //
  // Uma foto custa três idas à rede (perguntar a URL, baixar, subir para o
  // bucket) e elas correm EM PARALELO, seis por vez. Em fila indiana um lote de
  // 24 levava perto de meio minuto — tempo em que a agenda ficava com as
  // iniciais na tela e o atendente já tinha clicado em alguém. Seis é o meio
  // termo: encurta a espera sem despejar 24 requisições de uma vez no servidor
  // da Evolution, que atende o envio de mensagens ao mesmo tempo.
  const FRENTES = 6;

  async function buscarFoto(phone: string, jid: string | null): Promise<string | null> {
    try {
      const res = await fetch(`${base}/chat/fetchProfilePictureUrl/${inst}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: server.api_key! },
        body: JSON.stringify({ number: jid || phone }),
        signal: AbortSignal.timeout(15_000),
      });
      const out = res.ok ? await res.json().catch(() => ({})) : {};
      const picUrl: string | null = out?.profilePictureUrl || out?.profilePicUrl || null;
      if (!picUrl) return null;

      const img = await fetch(picUrl, { signal: AbortSignal.timeout(15_000) });
      if (!img.ok) return null;
      const mime = img.headers.get('content-type') || 'image/jpeg';
      const bytes = new Uint8Array(await img.arrayBuffer());
      if (bytes.byteLength === 0) return null;

      const ext = (mime.split('/')[1] || 'jpg').replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'jpg';
      const path = `avatars/contacts/${phone}.${ext}`;
      const up = await admin.storage.from(MEDIA_BUCKET)
        .upload(path, bytes, { contentType: mime, upsert: true });
      return up.error ? null : path;
    } catch {
      return null; // contato sem foto, privacidade fechada ou rede: fica sem rosto
    }
  }

  const comFoto: string[] = [];
  for (const phone of faltando) {
    const achado = existencia.get(phone);
    if (!achado) {
      resultado.set(phone, { phone, has_whatsapp: null, jid: null, avatar_path: null });
      continue;
    }
    resultado.set(phone, { phone, has_whatsapp: achado.exists, jid: achado.jid, avatar_path: null });
    if (achado.exists) comFoto.push(phone);
  }

  let proximo = 0;
  await Promise.all(Array.from({ length: Math.min(FRENTES, comFoto.length) }, async () => {
    for (;;) {
      const i = proximo++;
      if (i >= comFoto.length) return;
      const phone = comFoto[i];
      const path = await buscarFoto(phone, existencia.get(phone)?.jid ?? null);
      if (path) resultado.get(phone)!.avatar_path = path;
    }
  }));

  // 5. Guardar o que foi descoberto. Só o que teve resposta: gravar
  // desconhecido queimaria o TTL sem ter aprendido nada.
  const paraGravar = faltando
    .map(p => resultado.get(p)!)
    .filter(p => p.has_whatsapp !== null)
    .map(p => ({ ...p, checked_at: new Date().toISOString() }));
  if (paraGravar.length > 0) {
    await admin.from('whatsapp_contact_probes').upsert(paraGravar, { onConflict: 'phone' });
  }

  return json({ results: [...resultado.values()] });
});
