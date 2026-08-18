/**
 * whatsapp-contact-probe — "esse número tem WhatsApp? e qual é a cara dele?"
 *
 * POST { phones: string[], channel_id?: string, refresh?: boolean } (JWT da equipe)
 * → { results: [{ phone, has_whatsapp, jid, avatar_path }] }
 *
 * E a segunda pergunta, do telefone tocando:
 *
 * POST { lid: string, channel_id?: string }
 * → { lid, phone, name, avatar_path, source }
 *
 * DE QUEM É ESTE APELIDO? O WhatsApp entrega algumas chamadas endereçadas só
 * por LID (`<n>@lid`), sem telefone nenhum dentro, e o cartão da ligação
 * escrevia "Número não identificado" para gente que o escritório conhece. A
 * evidência que resolve isso está nos GRUPOS: a lista de participantes que a
 * Evolution devolve traz, na mesma linha, o LID (`id`) e o telefone real
 * (`phoneNumber`). Não é palpite — é o próprio WhatsApp dizendo que aquele
 * apelido é daquele número. Achando, o mapeamento é REGISTRADO na conversa
 * (`wa_link_lid`), e a próxima ligação da mesma pessoa já chega com nome.
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

/**
 * Baixa a foto de perfil e guarda no bucket, devolvendo o caminho.
 *
 * A URL que o WhatsApp devolve é de CDN e expira em horas; por isso a cópia.
 * `alvo` é o que a Evolution entende como destinatário (número ou jid) e
 * `arquivo` é o nome no bucket — o telefone quando há telefone, o apelido
 * quando a ligação só tem apelido.
 */
async function baixarFotoPerfil(
  admin: any, base: string, apikey: string, inst: string, alvo: string, arquivo: string,
): Promise<string | null> {
  try {
    const res = await fetch(`${base}/chat/fetchProfilePictureUrl/${inst}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey },
      body: JSON.stringify({ number: alvo }),
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
    const path = `avatars/contacts/${arquivo}.${ext}`;
    const up = await admin.storage.from(MEDIA_BUCKET)
      .upload(path, bytes, { contentType: mime, upsert: true });
    return up.error ? null : path;
  } catch {
    return null; // contato sem foto, privacidade fechada ou rede: fica sem rosto
  }
}

/** Dígitos, com 55 na frente — o mesmo formato de `normalizePhone` no cliente. */
function normalize(raw: string): string {
  const d = String(raw || '').replace(/@.*/, '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('55')) return d;
  if (d.length === 10 || d.length === 11) return `55${d}`;
  return d;
}

/**
 * QUEM É ESTE LID — a resposta em quatro degraus, do mais exato ao mais fraco.
 *
 *  1. AS CONVERSAS (`/chat/findChats`). É onde o mapeamento REALMENTE mora: a
 *     última mensagem do chat traz `key.remoteJidAlt` com o telefone de verdade
 *     ao lado do `remoteJid` em `@lid`, e o `pushName` de quebra. Conferido em
 *     18/08/2026 com uma ligação que o CRM tinha dado como anônima: o apelido
 *     `16758979195047` era do Lucindo Vieira, cliente com ficha e conversa
 *     abertas — o número estava ali o tempo todo, ninguém tinha perguntado.
 *  2. AS MENSAGENS (`/chat/findMessages`). Mesma evidência, para quando o chat
 *     não veio (mensagem antiga, chat arquivado).
 *  3. OS GRUPOS. Participante traz `id` (LID) e `phoneNumber` na mesma linha:
 *     resolve quem nunca escreveu para o escritório, mas está num grupo com ele.
 *  4. O NOME DE PERFIL (`/chat/findContacts`). Não identifica cliente, mas é
 *     muito melhor do que "não identificado" na tela de quem vai atender.
 *
 * A foto vem pelo telefone quando ele aparece; pelo próprio apelido quando não
 * (a Evolution aceita o jid `<n>@lid`). Sem nenhum dos quatro, devolve vazio —
 * e o cartão continua dizendo a verdade.
 */
async function resolverLid(
  admin: any, base: string, apikey: string, instancias: string[], lid: string,
): Promise<{ phone: string; name: string | null; avatar_path: string | null; source: string }> {
  let phone = '';
  let name: string | null = null;
  let source = 'none';
  const alvoJid = `${lid}@lid`;

  /** O telefone escondido no `remoteJidAlt` de uma chave de mensagem. */
  const doAlt = (key: any): string => {
    const alt = normalize(String(key?.remoteJidAlt || ''));
    return alt.length >= 12 && alt.length <= 13 ? alt : '';
  };
  const anota = (achado: string, origem: string) => {
    if (!achado || phone) return;
    phone = achado;
    source = origem;
  };

  const post = async (inst: string, rota: string, corpo: unknown, ms = 8_000) => {
    const res = await fetch(`${base}/${rota}/${inst}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(ms),
    });
    return res.ok ? await res.json().catch(() => null) : null;
  };

  for (const nome of instancias) {
    const inst = encodeURIComponent(nome);

    // 1. A conversa daquele apelido.
    if (!phone || !name) {
      try {
        const chats = await post(inst, 'chat/findChats', { where: { remoteJid: alvoJid } });
        for (const chat of Array.isArray(chats) ? chats : []) {
          anota(doAlt(chat?.lastMessage?.key), 'chat');
          const push = String(chat?.pushName || chat?.lastMessage?.pushName || '').trim();
          if (push && !name) name = push;
        }
      } catch { /* conversas fora do ar: tenta o resto */ }
    }

    // 2. As mensagens daquele apelido.
    if (!phone) {
      try {
        const out = await post(inst, 'chat/findMessages', { where: { key: { remoteJid: alvoJid } } });
        const registros = out?.messages?.records ?? out?.records ?? [];
        for (const m of Array.isArray(registros) ? registros : []) {
          anota(doAlt(m?.key), 'message');
          const push = String(m?.pushName || '').trim();
          if (push && !name) name = push;
          if (phone) break;
        }
      } catch { /* mensagens fora do ar */ }
    }

    // 3. Os grupos.
    if (!phone) {
      try {
        // Dez segundos e não mais: do outro lado tem um telefone TOCANDO, e um
        // nome que chega depois de a pessoa desligar não serviu para nada.
        const res = await fetch(`${base}/group/fetchAllGroups/${inst}?getParticipants=true`, {
          headers: { apikey },
          signal: AbortSignal.timeout(10_000),
        });
        if (res.ok) {
          const grupos = await res.json().catch(() => []);
          for (const g of Array.isArray(grupos) ? grupos : []) {
            for (const p of Array.isArray(g?.participants) ? g.participants : []) {
              if (String(p?.id || '').replace(/\D/g, '') !== lid) continue;
              const numero = normalize(String(p?.phoneNumber || ''));
              // 12/13 dígitos: telefone brasileiro de verdade. Qualquer outra
              // coisa é o próprio apelido voltando disfarçado.
              if (numero.length >= 12 && numero.length <= 13) anota(numero, 'group');
              break;
            }
            if (phone) break;
          }
        }
      } catch { /* grupos fora do ar */ }
    }

    // 4. O nome de perfil, quando nada mais deu nome.
    if (!name) {
      try {
        const arr = await post(inst, 'chat/findContacts', { where: { remoteJid: alvoJid } });
        const push = String((Array.isArray(arr) ? arr : [])[0]?.pushName || '').trim();
        if (push) {
          name = push;
          if (source === 'none') source = 'pushname';
        }
      } catch { /* contatos fora do ar */ }
    }

    if (phone && name) break;
  }

  const inst0 = encodeURIComponent(instancias[0] || '');
  const avatar_path = inst0
    ? await baixarFotoPerfil(admin, base, apikey, inst0, phone || alvoJid, phone || `lid-${lid}`)
    : null;

  return { phone, name, avatar_path, source };
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

  // ── A pergunta do telefone tocando: de quem é este apelido? ───────────────
  const lidPedido = String(body?.lid ?? '').replace(/\D/g, '');
  if (lidPedido) {
    const { data: cfgLid } = await admin.from('system_settings')
      .select('value').eq('key', 'whatsapp_evolution_config').maybeSingle();
    const srv = (cfgLid?.value || {}) as { base_url?: string; api_key?: string };
    const { data: canais } = await admin.from('whatsapp_instances')
      .select('instance_name').eq('status', 'connected');
    const nomes = (canais || [])
      .map((c: { instance_name: string | null }) => c.instance_name)
      .filter((n: string | null): n is string => !!n);
    if (!srv.base_url || !srv.api_key || nomes.length === 0) {
      return json({ lid: lidPedido, phone: '', name: null, avatar_path: null, source: 'none' });
    }
    // O LID é global: vale perguntar a QUALQUER conta conectada, não só à que
    // recebeu a ligação (que, no caso das chamadas de voz, nem é uma instância
    // da Evolution — o WaCalls usa um terceiro número).
    const achado = await resolverLid(
      admin, srv.base_url.replace(/\/+$/, ''), srv.api_key, nomes, lidPedido,
    );
    // Aprendeu: registra na conversa para a PRÓXIMA ligação já chegar com nome,
    // e devolve identidade às chamadas que ficaram anônimas com este apelido.
    if (achado.phone) {
      try {
        await userClient.rpc('wa_link_lid', { p_phone: achado.phone, p_lid: lidPedido });
        await userClient.rpc('wa_resolve_call_lids', { p_lid: lidPedido });
      } catch { /* ganho futuro, nunca um erro na tela */ }
    }
    return json({ lid: lidPedido, ...achado });
  }

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

  const buscarFoto = (phone: string, jid: string | null) =>
    baixarFotoPerfil(admin, base, server.api_key!, inst, jid || phone, phone);

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
