import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import PizZip from 'https://esm.sh/pizzip@3.2.0?target=deno';
import Docxtemplater from 'https://esm.sh/docxtemplater@3.66.5?target=deno';
import { matchWaAiClientsByPhone } from '../_shared/wa-ai-client-link.ts';
import { camposParaGravar, planejarTelefoneDoKit } from '../_shared/kit-client-merge.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type Action = 'get' | 'submit' | 'heartbeat' | 'contact';

type GetRequestBody = {
  action: 'get';
  token: string;
};

type SubmitRequestBody = {
  action: 'submit';
  token: string;
  values: Record<string, string>;
  signer: {
    name: string;
    email?: string | null;
    cpf?: string | null;
    phone?: string | null;
  };
  expires_at?: string | null;
};

type RequestBody = GetRequestBody | SubmitRequestBody;

const parseToken = (raw: string) => {
  try {
    const cleaned = (raw || '').trim();
    if (!cleaned) return null;
    return cleaned;
  } catch {
    return null;
  }
};

const isExpired = (expiresAt?: string | null) => {
  if (!expiresAt) return false;
  const d = new Date(expiresAt);
  if (Number.isNaN(d.getTime())) return false;
  return d.getTime() < Date.now();
};

const normalizeValues = (values: Record<string, string>) => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(values || {})) {
    const key = (k || '').trim();
    if (!key) continue;

    const safeValue = (v ?? '').toString();

    out[key] = safeValue;
    out[key.toUpperCase()] = safeValue;

    // Também suporta placeholders com espaços, etc.
    const normalizedKey = key
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .normalize('NFC');

    out[normalizedKey] = safeValue;
    out[normalizedKey.toUpperCase()] = safeValue;
  }

  return out;
};

const normalizeKey = (value: string) =>
  (value || '')
    .trim()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .normalize('NFC')
    .toUpperCase();

const cleanDigits = (value: string) => (value || '').replace(/\D/g, '');

const inferClientType = (cpfCnpjDigits: string | null) => {
  const digits = (cpfCnpjDigits || '').replace(/\D/g, '');
  return digits.length > 11 ? 'pessoa_juridica' : 'pessoa_fisica';
};

/**
 * Variantes do mesmo número brasileiro com e sem o 9º dígito de celular —
 * espelha `phoneVariants` do módulo WhatsApp. A conversa ora foi aberta pelo
 * número novo, ora pelo antigo; sem as duas formas, o kit não reencontra a
 * thread de quem acabou de preencher.
 */
const phoneVariants = (input: string): string[] => {
  let d = (input || '').replace(/\D/g, '');
  if (!d) return [];
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  if (d.length < 12 || d.length > 13) return [];
  const out = new Set<string>([d]);
  const m = d.match(/^55(\d{2})(\d+)$/);
  if (m) {
    const [, ddd, rest] = m;
    if (rest.length === 9 && rest[0] === '9') out.add(`55${ddd}${rest.slice(1)}`);
    else if (rest.length === 8) out.add(`55${ddd}9${rest}`);
  }
  return Array.from(out);
};

const getManausDateString = () => new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Manaus',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
}).format(new Date());

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!supabaseUrl || !serviceKey) {
      throw new Error('Supabase env não configurado (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)');
    }

    const admin = createClient(supabaseUrl, serviceKey);

    const body = (await req.json()) as RequestBody;
    const action = body?.action as Action;

    if (action !== 'get' && action !== 'submit' && action !== 'heartbeat' && action !== 'contact') {
      throw new Error('Ação inválida');
    }

    // Contato público do escritório (não exige token) — usado pelas telas
    // públicas (ex.: link indisponível) para oferecer um canal de suporte.
    if (action === 'contact') {
      const { data: row } = await admin
        .from('system_settings')
        .select('value')
        .eq('key', 'office_identity')
        .maybeSingle();
      const office = (row?.value ?? {}) as Record<string, string>;
      return new Response(
        JSON.stringify({
          success: true,
          office: {
            name: office.name ?? null,
            phone: office.phone ?? null,
            email: office.email ?? null,
            logo_url: office.logo_url ?? null,
          },
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const token = parseToken(body.token);
    if (!token) {
      throw new Error('Token inválido');
    }

    const { data: link, error: linkError } = await admin
      .from('template_fill_links')
      .select('*')
      .eq('public_token', token)
      .limit(1)
      .maybeSingle();

    if (linkError) throw new Error(linkError.message);
    if (!link) throw new Error('Link não encontrado');

    // ── Link já preenchido não é link morto: é link ADIANTADO ────────────────
    //
    // Antes, reabrir o link de preenchimento depois de enviado dava "Este link
    // não está mais disponível" — a mesma frase de um link expirado. Só que
    // quem reabre esse link quase nunca quer preencher de novo: quer CONTINUAR.
    // Fechou a aba antes de assinar, voltou do WhatsApp, clicou de novo no
    // histórico da conversa. Mandar essa pessoa pedir um link novo ao
    // escritório é perder uma assinatura que já estava pronta para acontecer.
    //
    // Então o link passa a apontar para o passo seguinte do MESMO kit:
    //   · preenchido e ainda não assinado → a página de assinatura;
    //   · já assinado → a verificação, onde estão os documentos e o código.
    //
    // O redirecionamento devolve só o TOKEN/CÓDIGO. Quem monta a URL é a tela
    // pública (`buildPublicSigningUrl`/`buildPublicVerificationUrl`), que é
    // quem sabe o domínio — a Edge Function não tem essa informação e
    // adivinhá-la geraria link quebrado no dia em que o domínio mudasse.
    if (action === 'get' && link.status === 'submitted' && link.signature_request_id) {
      const { data: signers } = await admin
        .from('signature_signers')
        .select('public_token, status, verification_hash, order')
        .eq('signature_request_id', link.signature_request_id)
        .order('order', { ascending: true });

      const lista = (signers ?? []) as Array<{
        public_token: string | null;
        status: string | null;
        verification_hash: string | null;
      }>;

      // Quem ainda tem trabalho a fazer vem primeiro. "Recusado" também vai
      // para a página de assinatura: é lá que a recusa está explicada.
      const pendente = lista.find((s) => s.status !== 'signed' && s.public_token);
      const assinado = lista.find((s) => s.status === 'signed' && s.verification_hash);

      const destino = pendente
        ? { kind: 'sign' as const, token: pendente.public_token as string }
        : assinado
          ? { kind: 'verify' as const, token: assinado.verification_hash as string }
          // Assinado sem código de verificação (modelo por documento, em que o
          // código mora em cada arquivo): a própria página de assinatura já
          // mostra o estado "assinado" com os documentos finais.
          : lista.find((s) => s.public_token)
            ? { kind: 'sign' as const, token: lista.find((s) => s.public_token)!.public_token as string }
            : null;

      if (destino) {
        return new Response(
          JSON.stringify({ success: true, redirect: destino }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
    }

    if (link.status !== 'pending') {
      throw new Error('Este link não está mais disponível');
    }
    if (isExpired(link.expires_at)) {
      await admin
        .from('template_fill_links')
        .update({ status: 'expired' })
        .eq('id', link.id);
      throw new Error('Este link expirou');
    }

    // Template
    const { data: template, error: templateError } = await admin
      .from('document_templates')
      .select('*')
      .eq('id', link.template_id)
      .single();

    if (templateError) throw new Error(templateError.message);

    // Arquivos do template (multi-doc)
    const { data: templateFiles, error: filesError } = await admin
      .from('template_files')
      .select('*')
      .eq('template_id', link.template_id)
      .order('order', { ascending: true });

    if (filesError) throw new Error(filesError.message);

    // Determinar arquivo principal
    // Prioridade:
    // 1. Se link.template_file_id foi especificado, usar esse arquivo
    // 2. Se template.file_path existe (documento principal do template), usar ele
    // 3. Fallback: primeiro arquivo de template_files (para templates antigos sem file_path)
    let mainFile: any = null;
    let mainFilePath: string | null = null;
    let mainFileName: string = 'documento.docx';

    if (link.template_file_id && Array.isArray(templateFiles)) {
      mainFile = templateFiles.find((f: any) => f.id === link.template_file_id) || null;
    }

    if (mainFile) {
      mainFilePath = mainFile.file_path;
      mainFileName = mainFile.file_name || 'documento.docx';
    } else if (template.file_path) {
      // Documento principal do template (não é anexo)
      mainFilePath = template.file_path;
      mainFileName = template.file_name || template.name || 'documento.docx';
    } else if (Array.isArray(templateFiles) && templateFiles.length > 0) {
      // Fallback para templates antigos
      mainFile = templateFiles[0];
      mainFilePath = mainFile.file_path;
      mainFileName = mainFile.file_name || 'documento.docx';
    }

    if (action === 'get') {
      const nowIso = new Date().toISOString();
      await admin
        .from('template_fill_links')
        .update({
          opened_at: link.opened_at ?? nowIso,
          last_seen_at: nowIso,
        })
        .eq('id', link.id);

      if (!mainFilePath) {
        throw new Error('Template sem arquivo');
      }

      const { data: urlData, error: urlError } = await admin
        .storage
        .from('document-templates')
        .createSignedUrl(mainFilePath, 60 * 10);

      if (urlError || !urlData?.signedUrl) {
        throw new Error(urlError?.message ?? 'Não foi possível gerar URL do template');
      }

      const { data: customFields, error: cfError } = await admin
        .from('document_custom_fields')
        .select('*')
        .order('order', { ascending: true });

      if (cfError) throw new Error(cfError.message);

      const { data: templateCustomFields, error: tcfError } = await admin
        .from('template_custom_fields')
        .select('*')
        .eq('template_id', template.id)
        .order('order', { ascending: true });

      if (tcfError) throw new Error(tcfError.message);

      return new Response(
        JSON.stringify({
          success: true,
          template: {
            id: template.id,
            name: template.name,
            description: template.description ?? null,
          },
          mainFile: {
            file_name: mainFileName,
            signed_url: urlData.signedUrl,
          },
          customFields: customFields ?? [],
          templateCustomFields: templateCustomFields ?? [],
          prefill: link.prefill ?? null,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    if (action === 'heartbeat') {
      const nowIso = new Date().toISOString();
      await admin
        .from('template_fill_links')
        .update({
          opened_at: link.opened_at ?? nowIso,
          last_seen_at: nowIso,
        })
        .eq('id', link.id);

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // SUBMIT
    if (!mainFilePath) {
      throw new Error('Template sem arquivo');
    }

    const submitBody = body as SubmitRequestBody;
    const signerName = (submitBody.signer?.name || '').trim();
    const providedEmail = (submitBody.signer?.email || '').trim();
    if (!signerName) {
      throw new Error('Nome do signatário é obrigatório');
    }

    // signature_signers.email é NOT NULL; quando o template não coleta e-mail, geramos um interno.
    // Importante: não usamos esse e-mail "fake" para atualizar/criar cadastro de cliente.
    const generatedEmail = `public+${crypto.randomUUID()}@crm.local`;
    const signerEmail = providedEmail || generatedEmail;

    const rawValues: Record<string, string> = {
      ...(link.prefill ?? {}),
      ...(submitBody.values ?? {}),
      data: getManausDateString(),
    };

    const values = normalizeValues(rawValues);

    const valuesByKey = new Map<string, string>();
    for (const [k, v] of Object.entries(rawValues)) {
      valuesByKey.set(normalizeKey(k), (v ?? '').toString());
    }
    const inferredPhone = (valuesByKey.get('TELEFONE') || valuesByKey.get('CELULAR') || '').trim() || null;
    const signerPhone = (submitBody.signer?.phone || '').trim() || inferredPhone;

    const inferredCpf =
      cleanDigits((submitBody.signer?.cpf || '').trim()) || cleanDigits((valuesByKey.get('CPF') || '').trim());

    const inferredCpfDigits = inferredCpf ? cleanDigits(inferredCpf) : '';
    const inferredClientType = inferClientType(inferredCpfDigits || null);

    const clientPayload: Record<string, any> = {
      full_name: signerName,
      cpf_cnpj: inferredCpfDigits || null,
      email: providedEmail || null,
      phone: signerPhone || null,
      mobile: signerPhone || null,
      nationality: (valuesByKey.get('NACIONALIDADE') || '').trim() || null,
      marital_status: (valuesByKey.get('ESTADO CIVIL') || '').trim() || null,
      profession: (valuesByKey.get('PROFISSÃO') || valuesByKey.get('PROFISSAO') || '').trim() || null,
      address_street: (valuesByKey.get('ENDEREÇO') || valuesByKey.get('ENDERECO') || '').trim() || null,
      address_number: (valuesByKey.get('NÚMERO') || valuesByKey.get('NUMERO') || '').trim() || null,
      address_complement: (valuesByKey.get('COMPLEMENTO') || '').trim() || null,
      address_neighborhood: (valuesByKey.get('BAIRRO') || '').trim() || null,
      address_city: (valuesByKey.get('CIDADE') || '').trim() || null,
      address_state: (valuesByKey.get('ESTADO') || '').trim() || null,
      address_zip_code: cleanDigits((valuesByKey.get('CEP') || '').trim()) || null,
      client_type: inferredClientType,
      status: 'ativo',
      created_by: link.created_by,
      updated_by: link.created_by,
    };

    // Quem é essa pessoa no cadastro, da identidade mais forte para a mais fraca.
    //
    // O telefone entrou no meio da fila porque é o ÚNICO dado que o atendimento
    // do WhatsApp tem quando abre o pré-cadastro: sem ele, quem preenchia o kit
    // virava um SEGUNDO registro, e a conversa continuava apontando para o
    // primeiro. O cliente assinava, o contrato nascia pendurado no registro
    // novo, e na conversa não acendia nada — nem o acompanhamento, nem o aviso.
    let clientId: string | null = null;
    try {
      let existingClient: any = null;
      let clientMatch: 'cpf' | 'link' | 'phone' | 'email' | null = null;

      const carregarCliente = async (id: string) => {
        const { data } = await admin
          .from('clients')
          .select('*')
          .eq('id', id)
          .is('merged_into_client_id', null)
          .maybeSingle();
        return data ?? null;
      };

      // 1. CPF/CNPJ — identidade de verdade, vence qualquer outro sinal.
      if (clientPayload.cpf_cnpj) {
        const { data, error } = await admin
          .from('clients')
          .select('*')
          .eq('cpf_cnpj', clientPayload.cpf_cnpj)
          .maybeSingle();
        if (!error && data) {
          existingClient = data;
          clientMatch = 'cpf';
        }

        // Cadastros antigos ainda podem guardar CPF pontuado. A comparação
        // forte continua sendo pelos dígitos para o cliente conseguir atualizar
        // a própria ficha sem nascer uma duplicata.
        if (!existingClient) {
          const tail = clientPayload.cpf_cnpj.slice(-4);
          const { data: legacyRows, error: legacyError } = await admin
            .from('clients')
            .select('*')
            .ilike('cpf_cnpj', `%${tail}%`)
            .is('merged_into_client_id', null)
            .limit(20);
          if (legacyError) throw new Error(`Falha ao conferir o CPF: ${legacyError.message}`);
          const sameCpf = (legacyRows ?? []).filter((row: any) =>
            cleanDigits(String(row?.cpf_cnpj ?? '')) === clientPayload.cpf_cnpj
          );
          if (sameCpf.length === 1) {
            existingClient = sameCpf[0];
            clientMatch = 'cpf';
          }
        }
      }

      // 2. O cliente que o próprio link já carregava (kit disparado de dentro
      //    da conversa, pelo atalho "/"): o vínculo veio de quem enviou.
      if (!existingClient && link.client_id) {
        existingClient = await carregarCliente(link.client_id);
        if (existingClient) clientMatch = 'link';
      }

      // 3. Telefone — é assim que se acha o pré-cadastro aberto no atendimento.
      //    A busca é interna à Edge Function e não depende da política de uma
      //    RPC da inbox. Assim, uma mudança de permissão na interface não pode
      //    voltar a criar um segundo cadastro para o mesmo telefone.
      if (!existingClient && signerPhone) {
        const { data, error } = await matchWaAiClientsByPhone(admin, signerPhone);
        const hits = Array.isArray(data) ? data : [];
        if (error) throw new Error(`Falha ao conferir o telefone: ${error.message || error}`);
        if (hits.length > 1) {
          // Telefone repetido não decide identidade, mas também não pode impedir
          // o documento. Sem CPF/vínculo forte, o envelope segue sem alterar
          // nenhuma das fichas ambíguas.
          console.warn('Telefone corresponde a mais de um cadastro; documento seguirá sem vínculo automático.');
        }
        if (hits.length === 1 && hits[0]?.id) {
          existingClient = await carregarCliente(hits[0].id);
          if (existingClient) clientMatch = 'phone';
        }
      }

      // 4. E-mail informado no kit.
      if (!existingClient && clientPayload.email) {
        const { data, error } = await admin
          .from('clients')
          .select('*')
          .eq('email', clientPayload.email)
          .maybeSingle();
        if (!error && data) {
          existingClient = data;
          clientMatch = 'email';
        }
      }

      if (existingClient?.id) {
        clientId = existingClient.id;

        // Preencheu a ficha inteira e vai assinar: deixou de ser "alguém que
        // ligou". A marca sai do MESMO registro — compromissos, prazos e
        // documentos já pendurados nele continuam exatamente onde estavam.
        const promovendo = existingClient.is_pre_cadastro === true;

        // CPF/vínculo explícito torna o formulário uma atualização cadastral.
        // Telefone/e-mail isolados continuam conservadores para não permitir
        // que uma coincidência fraca reescreva a ficha de outra pessoa.
        const strongMatch = clientMatch === 'cpf' || clientMatch === 'link' || promovendo;
        const cadastroSemTelefones = { ...clientPayload, phone: null, mobile: null };
        const updateData: Record<string, any> = {
          ...camposParaGravar({
            atual: existingClient as Record<string, unknown>,
            doKit: cadastroSemTelefones,
            promovendo,
            substituirPreenchidos: strongMatch,
            ignorar: ['client_type', 'created_by', 'status'],
          }),
          updated_by: link.created_by,
        };

        const phonePlan = planejarTelefoneDoKit(existingClient, signerPhone, strongMatch);
        if (phonePlan.field) updateData[phonePlan.field] = phonePlan.value;

        if (promovendo) updateData.is_pre_cadastro = false;

        const hasUpdates = Object.keys(updateData).length > 1;
        if (hasUpdates) {
          const { error: updateError } = await admin.from('clients').update(updateData).eq('id', clientId);
          if (updateError) {
            // Cadastro e documento são duas responsabilidades diferentes. Uma
            // inconsistência na ficha fica registrada no log, mas nunca mais
            // segura o contrato na tela de carregamento.
            console.warn('Falha ao atualizar cadastro; documento seguirá:', updateError.message);
          } else {
            const historyRows = Object.entries(updateData)
              .filter(([field]) => field !== 'updated_by')
              .map(([field, newValue]) => ({
                client_id: clientId,
                field,
                old_value: existingClient[field] == null ? null : String(existingClient[field]),
                new_value: newValue == null ? null : String(newValue),
                source: 'assinatura',
                source_label: field === 'is_pre_cadastro'
                  ? 'Pré-cadastro promovido ao preencher o kit de assinatura'
                  : 'Dados atualizados pelo cliente no kit de assinatura',
                changed_by: link.created_by ?? null,
              }));
            if (historyRows.length > 0) {
              const { error: historyError } = await admin.from('client_change_history').insert(historyRows);
              if (historyError) console.warn('Falha ao registrar histórico do cadastro:', historyError.message);
            }
          }
        }
      } else {
        const { data: created, error: createError } = await admin
          .from('clients')
          .insert(clientPayload)
          .select('id')
          .single();
        if (createError || !created?.id) {
          throw new Error(`Falha ao criar cliente: ${createError?.message || 'cadastro não retornado'}`);
        }
        clientId = created.id;
      }
    } catch (e) {
      console.warn('Falha ao criar/atualizar cliente automaticamente:', e);
      // A sincronização cadastral é importante, mas secundária. O documento
      // continua sendo gerado; quando a identidade já havia sido resolvida,
      // preservamos o vínculo mesmo que algum campo ou o histórico falhe.
    }

    // Baixar DOCX principal
    const { data: fileData, error: dlError } = await admin
      .storage
      .from('document-templates')
      .download(mainFilePath);

    if (dlError || !fileData) {
      throw new Error(dlError?.message ?? 'Falha ao baixar template');
    }

    const arrayBuffer = await fileData.arrayBuffer();
    const zip = new PizZip(arrayBuffer);

    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      delimiters: { start: '[[', end: ']]' },
      nullGetter: (part: any) => {
        const key = typeof part?.value === 'string' ? part.value.trim() : '';
        if (/^ASSINATURA(_\d+)?$/i.test(key)) return `[[${key}]]`;
        return '';
      },
    });

    doc.render(values);

    const rendered = doc.getZip().generate({
      type: 'uint8array',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });

    const documentId = crypto.randomUUID();
    const outNameBase = `${template.name} - ${signerName}`.slice(0, 140);

    const outPath = `signatures/${crypto.randomUUID()}.docx`;

    const { error: upError } = await admin
      .storage
      .from('document-templates')
      .upload(outPath, rendered, {
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        upsert: false,
      });

    if (upError) throw new Error(upError.message);

    // Processar anexos do template (template_files) e salvar em attachment_paths
    const attachmentPaths: string[] = [];
    // Config de assinatura (designer) de cada anexo, indexada na MESMA ordem de
    // attachment_paths → vira document_id 'attachment-<index>' em signature_fields.
    const attachmentConfigs: { index: number; cfg: any }[] = [];
    try {
      const attachmentsToProcess = (Array.isArray(templateFiles) ? templateFiles : [])
        .filter((f: any) => {
          const path = (f?.file_path || '').toString();
          if (!path) return false;
          // não duplicar o arquivo principal
          if (path === mainFilePath) return false;
          if (mainFile?.id && f?.id && f.id === mainFile.id) return false;
          return true;
        });

      for (const attach of attachmentsToProcess) {
        const attachPath = (attach?.file_path || '').toString();
        const attachName = (attach?.file_name || '').toString();
        const mime = (attach?.mime_type || '').toString();

        const { data: attachData, error: attachDlError } = await admin
          .storage
          .from('document-templates')
          .download(attachPath);
        if (attachDlError || !attachData) {
          console.warn('Falha ao baixar anexo:', attachPath, attachDlError?.message);
          continue;
        }

        const lowerName = (attachName || attachPath.split('/').pop() || '').toLowerCase();
        const isDocx = lowerName.endsWith('.docx') || lowerName.endsWith('.doc') || mime.includes('wordprocessingml');

        let outAttachBytes: Uint8Array;
        let outAttachContentType = mime || 'application/octet-stream';
        let outAttachExt = lowerName.endsWith('.pdf') ? 'pdf' : (lowerName.endsWith('.docx') ? 'docx' : (lowerName.endsWith('.doc') ? 'doc' : 'bin'));

        if (isDocx) {
          try {
            const attachBuf = await attachData.arrayBuffer();
            const attachZip = new PizZip(attachBuf);
            const attachDoc = new Docxtemplater(attachZip, {
              paragraphLoop: true,
              linebreaks: true,
              delimiters: { start: '[[', end: ']]' },
              nullGetter: (part: any) => {
                const key = typeof part?.value === 'string' ? part.value.trim() : '';
                if (/^ASSINATURA(_\d+)?$/i.test(key)) return `[[${key}]]`;
                return '';
              },
            });
            attachDoc.render(values);
            outAttachBytes = attachDoc.getZip().generate({
              type: 'uint8array',
              mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            });
            outAttachContentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
            outAttachExt = 'docx';
          } catch (e) {
            console.warn('Falha ao renderizar anexo DOCX, enviando original:', attachPath, e);
            outAttachBytes = new Uint8Array(await attachData.arrayBuffer());
          }
        } else {
          outAttachBytes = new Uint8Array(await attachData.arrayBuffer());
        }

        const outAttachPath = `signatures/${crypto.randomUUID()}.${outAttachExt}`;
        const { error: attachUpError } = await admin
          .storage
          .from('document-templates')
          .upload(outAttachPath, outAttachBytes, {
            contentType: outAttachContentType,
            upsert: false,
          });
        if (attachUpError) {
          console.warn('Falha ao enviar anexo:', outAttachPath, attachUpError.message);
          continue;
        }

        attachmentConfigs.push({ index: attachmentPaths.length, cfg: (attach as any)?.signature_field_config ?? null });
        attachmentPaths.push(outAttachPath);
      }
    } catch (e) {
      console.warn('Erro ao processar anexos do template:', e);
    }

    // Modelo VERSIONADO: o kit define signature_model ('consolidated' legado |
    // 'per_document'). Carimbamos no envelope para o fluxo público saber gerar 1 PDF
    // consolidado (legado) ou 1 PDF assinado por arquivo. Default seguro: 'consolidated'.
    const signatureModel = ((template as any)?.signature_model === 'per_document')
      ? 'per_document'
      : 'consolidated';

    const { data: request, error: reqError } = await admin
      .from('signature_requests')
      .insert({
        document_id: documentId,
        document_name: outNameBase,
        document_path: outPath,
        attachment_paths: attachmentPaths,
        client_id: clientId,
        client_name: signerName,
        auth_method: 'signature_only',
        signature_model: signatureModel,
        expires_at: submitBody.expires_at ?? null,
        created_by: link.created_by,
      })
      .select('*')
      .single();

    if (reqError || !request) {
      throw new Error(reqError?.message ?? 'Falha ao criar solicitação de assinatura');
    }

    const { data: createdSigner, error: signerError } = await admin
      .from('signature_signers')
      .insert({
        signature_request_id: request.id,
        name: signerName,
        email: signerEmail,
        cpf: inferredCpf || null,
        phone: signerPhone,
        auth_method: 'signature_only',
        status: 'pending',
        order: 1,
      })
      .select('*')
      .single();

    if (signerError || !createdSigner) {
      throw new Error(signerError?.message ?? 'Falha ao criar signatário');
    }

    try {
      // Converte a config do designer (page/width_percent/height_percent) em linhas
      // de signature_fields. CORREÇÃO: a coluna é `page_number` (não `page`) — antes
      // o insert falhava inteiro e NENHUM campo manual era persistido (posição caía no
      // fallback da última página). Vale para os fluxos consolidado e per_document.
      const buildFields = (cfg: any, documentId: string) => {
        const arr = Array.isArray(cfg) ? cfg : (cfg ? [cfg] : []);
        return arr
          .filter((c: any) => c !== null && typeof c === 'object')
          .map((c: any) => ({
            signature_request_id: request.id,
            signer_id: createdSigner.id,
            field_type: 'signature',
            page_number: c.page || c.page_number || 1,
            x_percent: c.x_percent || 0,
            y_percent: c.y_percent || 0,
            w_percent: c.width_percent || c.w_percent || 20,
            h_percent: c.height_percent || c.h_percent || 8,
            required: true,
            document_id: documentId,
          }));
      };

      const mainConfig = (mainFile as any)?.signature_field_config ?? (template as any)?.signature_field_config;
      // Campos do principal ('main') + campos de CADA anexo ('attachment-<index>'),
      // casando com o document_id usado no designer e na geração do PDF.
      const fieldsToInsert = [
        ...buildFields(mainConfig, 'main'),
        ...attachmentConfigs.flatMap((a) => buildFields(a.cfg, `attachment-${a.index}`)),
      ];

      if (fieldsToInsert.length > 0) {
        const { error: fieldsError } = await admin.from('signature_fields').insert(fieldsToInsert);
        if (fieldsError) {
          console.warn('Erro ao criar signature_fields:', fieldsError.message);
        }
      }
    } catch (e) {
      console.warn('Erro ao processar signature_field_config:', e);
    }

    // Devolve ao link o cliente e a conversa. É por esse vínculo que o módulo
    // WhatsApp acompanha o kit — o painel "Assinaturas pendentes", o selo na
    // lista de conversas e o lembrete automático leem tudo por `client_id`.
    // Link colado à mão (gerado pelo link fixo) chegava aqui sem nada, e o
    // acompanhamento simplesmente nunca começava.
    const linkPatch: Record<string, any> = {
      status: 'submitted',
      submitted_at: new Date().toISOString(),
      signature_request_id: request.id,
    };
    if (!link.client_id && clientId) linkPatch.client_id = clientId;

    if (!link.conversation_id && clientId) {
      try {
        // Primeiro pela conversa que já aponta para esse cliente.
        const { data: byClient } = await admin
          .from('whatsapp_conversations')
          .select('id')
          .eq('client_id', clientId)
          .order('last_message_at', { ascending: false, nullsFirst: false })
          .limit(1)
          .maybeSingle();

        if (byClient?.id) {
          linkPatch.conversation_id = byClient.id;
        } else if (signerPhone) {
          // Sem cliente na conversa: acha pelo número e aproveita para amarrar
          // o cadastro nela — é a mesma pessoa, acabou de assinar o contrato.
          const jids = phoneVariants(signerPhone).map((v) => `${v}@s.whatsapp.net`);
          if (jids.length > 0) {
            const { data: byPhone } = await admin
              .from('whatsapp_conversations')
              .select('id, client_id')
              .in('remote_jid', jids)
              .order('last_message_at', { ascending: false, nullsFirst: false })
              .limit(1)
              .maybeSingle();
            if (byPhone?.id) {
              linkPatch.conversation_id = byPhone.id;
              if (!byPhone.client_id) {
                await admin.from('whatsapp_conversations')
                  .update({ client_id: clientId })
                  .eq('id', byPhone.id)
                  .is('client_id', null);
              }
            }
          }
        }
      } catch (e) {
        // Vínculo é acompanhamento, não é o documento: nada aqui pode derrubar
        // uma assinatura que já foi gerada.
        console.warn('Falha ao vincular o kit à conversa do WhatsApp:', e);
      }
    }

    await admin
      .from('template_fill_links')
      .update(linkPatch)
      .eq('id', link.id);

    const signerToken = createdSigner.public_token;
    if (!signerToken) throw new Error('Falha ao gerar token público do signatário');

    return new Response(
      JSON.stringify({
        success: true,
        signature_request_id: request.id,
        signer_token: signerToken,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    console.error('template-fill error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: (error as any)?.message ?? 'Erro desconhecido',
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  }
});
