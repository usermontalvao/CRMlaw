import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import PizZip from 'https://esm.sh/pizzip@3.2.0?target=deno';
import Docxtemplater from 'https://esm.sh/docxtemplater@3.66.5?target=deno';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type Action = 'get' | 'submit';

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

    if (action !== 'get' && action !== 'submit') {
      throw new Error('Ação inválida');
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
      data: new Date().toLocaleDateString('pt-BR'),
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

    let clientId: string | null = null;
    try {
      let existingClient: any = null;
      if (clientPayload.cpf_cnpj) {
        const { data, error } = await admin
          .from('clients')
          .select('*')
          .eq('cpf_cnpj', clientPayload.cpf_cnpj)
          .maybeSingle();
        if (!error && data) existingClient = data;
      } else if (clientPayload.email) {
        const { data, error } = await admin
          .from('clients')
          .select('*')
          .eq('email', clientPayload.email)
          .maybeSingle();
        if (!error && data) existingClient = data;
      }

      if (existingClient?.id) {
        clientId = existingClient.id;
        const updateData: Record<string, any> = { updated_by: link.created_by };

        for (const [k, v] of Object.entries(clientPayload)) {
          if (k === 'client_type' || k === 'created_by') continue;
          if (v === null || v === '') continue;
          const curr = (existingClient as any)[k];
          if (curr === null || curr === '' || curr === undefined) {
            updateData[k] = v;
          }
        }

        const hasUpdates = Object.keys(updateData).length > 1;
        if (hasUpdates) {
          await admin.from('clients').update(updateData).eq('id', clientId);
        }
      } else {
        const { data: created, error: createError } = await admin
          .from('clients')
          .insert(clientPayload)
          .select('id')
          .single();
        if (!createError && created?.id) clientId = created.id;
      }
    } catch (e) {
      console.warn('Falha ao criar/atualizar cliente automaticamente:', e);
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

        attachmentPaths.push(outAttachPath);
      }
    } catch (e) {
      console.warn('Erro ao processar anexos do template:', e);
    }

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
      const signatureConfig = (mainFile as any)?.signature_field_config ?? (template as any)?.signature_field_config;
      const configArray = Array.isArray(signatureConfig)
        ? signatureConfig
        : signatureConfig
          ? [signatureConfig]
          : [];

      const fieldsToInsert = configArray
        .filter((c: any) => c !== null && typeof c === 'object')
        .map((c: any) => ({
          signature_request_id: request.id,
          signer_id: createdSigner.id,
          field_type: 'signature',
          page: c.page || 1,
          x_percent: c.x_percent || 0,
          y_percent: c.y_percent || 0,
          w_percent: c.width_percent || c.w_percent || 20,
          h_percent: c.height_percent || c.h_percent || 8,
          required: true,
          document_id: 'main',
        }));

      if (fieldsToInsert.length > 0) {
        const { error: fieldsError } = await admin.from('signature_fields').insert(fieldsToInsert);
        if (fieldsError) {
          console.warn('Erro ao criar signature_fields:', fieldsError.message);
        }
      }
    } catch (e) {
      console.warn('Erro ao processar signature_field_config:', e);
    }

    await admin
      .from('template_fill_links')
      .update({
        status: 'submitted',
        submitted_at: new Date().toISOString(),
        signature_request_id: request.id,
      })
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
