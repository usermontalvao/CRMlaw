import { supabase } from '../config/supabase';
import type {
  SignatureRequest,
  SignatureRequestWithSigners,
  Signer,
  SignatureField,
  CreateSignatureRequestDTO,
  CreateSignerDTO,
  SignDocumentDTO,
  UpdateSignerDTO,
  SignatureAuditLog,
  SignatureStats,
} from '../types/signature.types';

const STORAGE_BUCKET = 'document-templates';

class SignatureService {
  private requestsTable = 'signature_requests';
  private signersTable = 'signature_signers';
  private auditTable = 'signature_audit_log';

  private async ensureBucket(): Promise<boolean> {
    // Não tenta criar bucket - deve ser criado manualmente no Supabase Dashboard
    // Bucket: signatures (público, com policies de INSERT e SELECT)
    return true;
  }

  async verifySignedPdfBySha256(sha256: string): Promise<{ signer: Signer; request: SignatureRequest } | null> {
    const codeToUse = (sha256 || '').trim();
    if (!codeToUse) return null;

    const { data, error } = await supabase
      .rpc('public_verify_signed_pdf_by_sha256', { p_sha256: codeToUse });

    if (error) throw new Error(error.message);
    if (!data) return null;

    const signer = (data as any).signer as Signer | undefined;
    const request = (data as any).request as SignatureRequest | undefined;
    if (!signer || !request) return null;

    return { signer, request };
  }

  // ==================== SIGNATURE REQUESTS ====================

  async listRequests(filters?: {
    status?: string;
    client_id?: string;
    search?: string;
  }): Promise<SignatureRequest[]> {
    let query = supabase
      .from(this.requestsTable)
      .select('*')
      .is('archived_at', null)
      .order('created_at', { ascending: false });

    if (filters?.status) {
      query = query.eq('status', filters.status);
    }
    if (filters?.client_id) {
      query = query.eq('client_id', filters.client_id);
    }
    if (filters?.search) {
      query = query.or(
        `document_name.ilike.%${filters.search}%,client_name.ilike.%${filters.search}%`
      );
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async listRequestsWithDerivedStatus(filters?: {
    status?: string;
    client_id?: string;
    search?: string;
  }): Promise<SignatureRequest[]> {
    const requests = await this.listRequests(filters);
    if (requests.length === 0) return requests;

    const requestIds = requests.map((r) => r.id);
    const { data: signers, error } = await supabase
      .from(this.signersTable)
      .select('signature_request_id,status')
      .in('signature_request_id', requestIds);

    if (error) throw new Error(error.message);

    const byRequest = new Map<string, { total: number; signed: number }>();
    for (const s of signers ?? []) {
      const key = (s as any).signature_request_id as string;
      const status = (s as any).status as string;
      const curr = byRequest.get(key) ?? { total: 0, signed: 0 };
      curr.total += 1;
      if (status === 'signed') curr.signed += 1;
      byRequest.set(key, curr);
    }

    return requests.map((r) => {
      const agg = byRequest.get(r.id);
      if (agg && agg.total > 0 && agg.signed === agg.total) {
        return { ...r, status: 'signed', signed_at: r.signed_at ?? new Date().toISOString() };
      }
      return r;
    });
  }

  async listRequestsWithSigners(filters?: {
    status?: string;
    client_id?: string;
    search?: string;
  }): Promise<SignatureRequestWithSigners[]> {
    const requests = await this.listRequests(filters);
    if (requests.length === 0) return [];

    const requestIds = requests.map((r) => r.id);
    const { data: allSigners, error } = await supabase
      .from(this.signersTable)
      .select('*')
      .in('signature_request_id', requestIds)
      .order('order', { ascending: true });

    if (error) throw new Error(error.message);

    const signersByRequest = new Map<string, Signer[]>();
    for (const s of allSigners ?? []) {
      const key = s.signature_request_id as string;
      const arr = signersByRequest.get(key) ?? [];
      arr.push(s as Signer);
      signersByRequest.set(key, arr);
    }

    return requests.map((r) => {
      const signers = signersByRequest.get(r.id) ?? [];
      const allSigned = signers.length > 0 && signers.every((s) => s.status === 'signed');
      return {
        ...r,
        status: allSigned ? 'signed' : r.status,
        signed_at: allSigned ? (r.signed_at ?? new Date().toISOString()) : r.signed_at,
        signers,
      } as SignatureRequestWithSigners;
    });
  }

  async getRequest(id: string): Promise<SignatureRequest | null> {
    const { data, error } = await supabase
      .from(this.requestsTable)
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw new Error(error.message);
    }
    return data;
  }

  async getRequestWithSigners(id: string): Promise<SignatureRequestWithSigners | null> {
    const { data: request, error: reqError } = await supabase
      .from(this.requestsTable)
      .select('*')
      .eq('id', id)
      .single();

    if (reqError) {
      if (reqError.code === 'PGRST116') return null;
      throw new Error(reqError.message);
    }

    const { data: signers, error: signersError } = await supabase
      .from(this.signersTable)
      .select('*')
      .eq('signature_request_id', id)
      .order('order', { ascending: true });

    if (signersError) throw new Error(signersError.message);

    return {
      ...request,
      signers: signers ?? [],
    };
  }

  async getSignerById(id: string): Promise<Signer | null> {
    const { data, error } = await supabase
      .from(this.signersTable)
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw new Error(error.message);
    }

    return data;
  }

  async getRequestByToken(token: string): Promise<SignatureRequestWithSigners | null> {
    const { data: request, error: reqError } = await supabase
      .from(this.requestsTable)
      .select('*')
      .eq('public_token', token)
      .single();

    if (reqError) {
      if (reqError.code === 'PGRST116') return null;
      throw new Error(reqError.message);
    }

    const { data: signers, error: signersError } = await supabase
      .from(this.signersTable)
      .select('*')
      .eq('signature_request_id', request.id)
      .order('order', { ascending: true });

    if (signersError) throw new Error(signersError.message);

    return {
      ...request,
      signers: signers ?? [],
    };
  }

  async createRequest(payload: CreateSignatureRequestDTO): Promise<SignatureRequestWithSigners> {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) throw new Error('Usuário não autenticado');

    const { signers, ...requestData } = payload;

    // Criar a solicitação
    const { data: request, error: reqError } = await supabase
      .from(this.requestsTable)
      .insert({
        ...requestData,
        created_by: userData.user.id,
      })
      .select()
      .single();

    if (reqError) throw new Error(reqError.message);

    // Criar os signatários
    const signersToInsert = signers.map((signer, index) => ({
      signature_request_id: request.id,
      name: signer.name,
      email: signer.email,
      cpf: signer.cpf,
      phone: signer.phone,
      role: signer.role,
      order: signer.order ?? index + 1,
      auth_method: signer.auth_method ?? payload.auth_method,
    }));

    const { data: createdSigners, error: signersError } = await supabase
      .from(this.signersTable)
      .insert(signersToInsert)
      .select();

    if (signersError) {
      // Rollback: deletar a solicitação
      await supabase.from(this.requestsTable).delete().eq('id', request.id);
      throw new Error(signersError.message);
    }

    // Registrar no audit log
    await this.addAuditLog(request.id, null, 'created', 'Solicitação de assinatura criada');

    return {
      ...request,
      signers: createdSigners ?? [],
    };
  }

  async updateRequest(
    id: string,
    payload: Partial<SignatureRequest>
  ): Promise<SignatureRequest> {
    const { data, error } = await supabase
      .from(this.requestsTable)
      .update(payload)
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async cancelRequest(id: string): Promise<void> {
    const { error } = await supabase
      .from(this.requestsTable)
      .update({ status: 'cancelled' })
      .eq('id', id);

    if (error) throw new Error(error.message);

    // Cancelar todos os signatários pendentes
    await supabase
      .from(this.signersTable)
      .update({ status: 'cancelled' })
      .eq('signature_request_id', id)
      .eq('status', 'pending');

    await this.addAuditLog(id, null, 'cancelled', 'Solicitação de assinatura cancelada');
  }

  async archiveRequest(id: string): Promise<void> {
    // Arquiva (some do painel), invalida link público /#/assinar e mantém verificação por hash.
    const now = new Date().toISOString();

    const { error: reqError } = await supabase
      .from(this.requestsTable)
      .update({ archived_at: now, public_token: null })
      .eq('id', id);

    if (reqError) throw new Error(reqError.message);

    const { error: signersError } = await supabase
      .from(this.signersTable)
      .update({ public_token: null })
      .eq('signature_request_id', id);

    if (signersError) throw new Error(signersError.message);

    await this.addAuditLog(id, null, 'cancelled', 'Solicitação arquivada (removida do painel)');
  }

  async deleteRequest(id: string, deleteFilesFromServer: boolean = false): Promise<void> {
    // Buscar dados para possível exclusão do storage
    const request = await this.getRequestWithSigners(id);
    if (!request) return;

    const pathsToDelete: string[] = [];
    
    // Se deleteFilesFromServer = true, apaga TUDO (imagens, documentos, PDFs assinados)
    // Se deleteFilesFromServer = false, apenas remove do banco (mantém arquivos no servidor)
    if (deleteFilesFromServer) {
      // Documento original
      if (request.document_path) pathsToDelete.push(request.document_path);
      
      // Anexos
      if (request.attachment_paths && request.attachment_paths.length > 0) {
        pathsToDelete.push(...request.attachment_paths);
      }
      
      // Imagens do request
      if (request.signature_image_path) pathsToDelete.push(request.signature_image_path);
      if (request.facial_image_path) pathsToDelete.push(request.facial_image_path);
      if (request.document_image_path) pathsToDelete.push(request.document_image_path);

      // Imagens e PDFs assinados dos signatários
      request.signers.forEach((signer) => {
        if (signer.signature_image_path) pathsToDelete.push(signer.signature_image_path);
        if (signer.facial_image_path) pathsToDelete.push(signer.facial_image_path);
        if (signer.document_image_path) pathsToDelete.push(signer.document_image_path);
        if (signer.signed_document_path) pathsToDelete.push(signer.signed_document_path);
      });
    }

    // Deletar do banco (cascade deleta signers e audit_log)
    const { error } = await supabase
      .from(this.requestsTable)
      .delete()
      .eq('id', id);

    if (error) throw new Error(error.message);

    // Deletar arquivos do storage apenas se solicitado
    if (deleteFilesFromServer && pathsToDelete.length > 0) {
      console.log('[DELETE] Removendo arquivos do storage:', pathsToDelete);
      // Tentar remover de múltiplos buckets
      const buckets = ['document-templates', 'generated-documents', 'signatures', 'assinados'];
      for (const bucket of buckets) {
        try {
          await supabase.storage.from(bucket).remove(pathsToDelete);
        } catch (e) {
          console.warn(`[DELETE] Erro ao remover do bucket ${bucket}:`, e);
        }
      }
    }
  }

  // ==================== SIGNERS ====================

  async getSigner(id: string): Promise<Signer | null> {
    const { data, error } = await supabase
      .from(this.signersTable)
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw new Error(error.message);
    }
    return data;
  }

  async getSignerByToken(token: string): Promise<Signer | null> {
    const { data, error } = await supabase
      .from(this.signersTable)
      .select('*')
      .eq('public_token', token)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw new Error(error.message);
    }
    return data;
  }

  async getSignerWithRequestByToken(token: string): Promise<{ signer: Signer; request: SignatureRequest; creator?: { name: string; email: string } } | null> {
    const { data: signers, error } = await supabase
      .from(this.signersTable)
      .select('*')
      .eq('public_token', token)
      .limit(1);

    if (error) {
      console.error('Erro ao buscar signatário por token:', error);
      return null;
    }

    if (!signers || signers.length === 0) {
      return null;
    }

    const signer = signers[0];
    const request = await this.getRequest(signer.signature_request_id);
    if (!request) return null;

    // Buscar dados do criador na tabela profiles
    let creator: { name: string; email: string } | undefined;
    if (request.created_by) {
      const { data: userData } = await supabase
        .from('profiles')
        .select('name, email')
        .eq('user_id', request.created_by)
        .single();
      if (userData) {
        creator = { name: userData.name || 'Usuário', email: userData.email || '' };
      }
    }

    return { signer, request, creator };
  }

  async getPublicSigningBundle(token: string): Promise<{
    signer: Signer;
    request: SignatureRequest;
    creator?: { name: string; email: string };
    fields: SignatureField[];
  } | null> {
    const { data, error } = await supabase.rpc('get_public_signing_bundle', {
      p_token: token,
    });

    if (error) {
      console.error('Erro ao buscar bundle público:', error);
      return null;
    }

    if (!data) return null;

    const creator = data.creator?.email
      ? {
          name: data.creator?.name || 'Usuário',
          email: data.creator?.email || '',
        }
      : undefined;

    return {
      signer: data.signer as Signer,
      request: data.request as SignatureRequest,
      creator,
      fields: (data.fields ?? []) as SignatureField[],
    };
  }

  async sendPhoneOtp(params: { token: string; phone: string }): Promise<{ expires_at?: string | null }> {
    const { token, phone } = params;
    const { data, error } = await supabase.functions.invoke('smsdev-send-otp', {
      body: { token, phone },
    });

    if (error) throw new Error(error.message);
    if (!data?.success) throw new Error(data?.error || 'Não foi possível enviar o código.');
    return { expires_at: data?.expires_at ?? null };
  }

  async sendEmailOtp(params: { token: string; email: string }): Promise<{ expires_at?: string | null }> {
    const { token, email } = params;
    const { data, error } = await supabase.functions.invoke('email-send-otp', {
      body: { token, email },
    });

    if (error) throw new Error(error.message);
    if (!data?.success) throw new Error(data?.error || 'Não foi possível enviar o código.');
    return { expires_at: data?.expires_at ?? null };
  }

  async verifyPhoneOtp(params: { token: string; code: string }): Promise<{ phone?: string | null }> {
    const { token, code } = params;
    const { data, error } = await supabase.functions.invoke('smsdev-verify-otp', {
      body: { token, code },
    });

    if (error) throw new Error(error.message);
    if (!data?.success) throw new Error(data?.error || 'Código inválido.');
    return { phone: data?.phone ?? null };
  }

  async verifyEmailOtp(params: { token: string; code: string }): Promise<{ email?: string | null }> {
    const { token, code } = params;
    const { data, error } = await supabase.functions.invoke('email-verify-otp', {
      body: { token, code },
    });

    if (error) throw new Error(error.message);
    if (!data?.success) throw new Error(data?.error || 'Código inválido.');
    return { email: data?.email ?? null };
  }

  async markSignerAsViewed(signerId: string, ipAddress?: string, userAgent?: string): Promise<void> {
    const { error } = await supabase
      .from(this.signersTable)
      .update({ viewed_at: new Date().toISOString() })
      .eq('id', signerId)
      .is('viewed_at', null); // Só atualiza se ainda não foi visualizado

    if (error) {
      console.error('Erro ao marcar visualização:', error);
    }

    // Registrar no audit log com dedupe (evitar múltiplos "viewed" idênticos em curto intervalo)
    try {
      await supabase.rpc('public_log_viewed_event', {
        p_signer_id: signerId,
        p_ip_address: ipAddress ?? null,
        p_user_agent: userAgent ?? null,
      });
    } catch (e) {
      console.warn('Não foi possível registrar audit log (acesso público):', e);
    }
  }

  async addSigner(requestId: string, signer: CreateSignerDTO): Promise<Signer> {
    const { data, error } = await supabase
      .from(this.signersTable)
      .insert({
        signature_request_id: requestId,
        ...signer,
      })
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async updateSigner(id: string, payload: UpdateSignerDTO): Promise<Signer> {
    const { data, error } = await supabase
      .from(this.signersTable)
      .update(payload)
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async updateSignerSignedDocumentPath(signerId: string, signedDocumentPath: string): Promise<void> {
    const { error } = await supabase
      .from(this.signersTable)
      .update({ signed_document_path: signedDocumentPath })
      .eq('id', signerId);

    if (error) throw new Error(error.message);
  }

  async updateSignerSignedDocumentMeta(signerId: string, params: { signed_document_path: string; signed_pdf_sha256?: string | null }): Promise<void> {
    const { signed_document_path, signed_pdf_sha256 } = params;
    const { error } = await supabase
      .from(this.signersTable)
      .update({ signed_document_path, signed_pdf_sha256: signed_pdf_sha256 ?? null })
      .eq('id', signerId);

    if (error) throw new Error(error.message);
  }

  async deleteSigner(id: string): Promise<void> {
    const signer = await this.getSigner(id);
    if (!signer) return;

    const pathsToDelete: string[] = [];
    if (signer.signature_image_path) pathsToDelete.push(signer.signature_image_path);
    if (signer.facial_image_path) pathsToDelete.push(signer.facial_image_path);
    if (signer.document_image_path) pathsToDelete.push(signer.document_image_path);

    const { error } = await supabase
      .from(this.signersTable)
      .delete()
      .eq('id', id);

    if (error) throw new Error(error.message);

    if (pathsToDelete.length > 0) {
      await supabase.storage.from(STORAGE_BUCKET).remove(pathsToDelete);
    }
  }

  // ==================== SIGNING ====================

  /**
   * Assina documento via Edge Function (para uso público sem sessão autenticada)
   * Esta é a forma recomendada para a página pública de assinatura
   */
  async signDocumentPublic(
    publicToken: string,
    payload: SignDocumentDTO,
    ipAddress?: string,
    userAgent?: string
  ): Promise<Signer> {
    const { data, error } = await supabase.functions.invoke('public-sign-document', {
      body: {
        token: publicToken,
        signature_image: payload.signature_image,
        facial_image: payload.facial_image,
        document_image: payload.document_image,
        geolocation: payload.geolocation,
        signer_name: payload.signer_name,
        signer_cpf: payload.signer_cpf,
        signer_phone: payload.signer_phone,
        auth_provider: payload.auth_provider,
        auth_email: payload.auth_email,
        auth_google_sub: payload.auth_google_sub,
        auth_google_picture: payload.auth_google_picture,
        ip_address: ipAddress,
        user_agent: userAgent,
      },
    });

    if (error) {
      console.error('[signDocumentPublic] Edge function error:', error);
      throw new Error(error.message || 'Erro ao assinar documento');
    }

    if (!data?.success) {
      throw new Error(data?.error || 'Erro ao assinar documento');
    }

    return data.signer as Signer;
  }

  /**
   * Assina documento diretamente (requer sessão autenticada)
   * Use signDocumentPublic para a página pública de assinatura
   */
  async signDocument(
    signerId: string,
    payload: SignDocumentDTO,
    ipAddress?: string,
    userAgent?: string
  ): Promise<Signer> {
    await this.ensureBucket();

    const signer = await this.getSigner(signerId);
    if (!signer) throw new Error('Signatário não encontrado');
    if (signer.status !== 'pending') throw new Error('Este documento já foi assinado ou cancelado');

    const updates: Partial<Signer> = {
      status: 'signed',
      signed_at: new Date().toISOString(),
      signer_ip: ipAddress,
      signer_user_agent: userAgent,
      signer_geolocation: payload.geolocation,
      verification_hash: this.generateVerificationHash(),
      // Dados informados no momento da assinatura (não usar cadastro antigo)
      name: payload.signer_name ?? signer.name,
      cpf: payload.signer_cpf ?? signer.cpf,
      phone: payload.signer_phone ?? signer.phone,
      // Dados de autenticação
      auth_provider: payload.auth_provider || null,
      auth_email: payload.auth_email || null,
      auth_google_sub: payload.auth_google_sub || null,
      auth_google_picture: payload.auth_google_picture || null,
    };

    // Upload da assinatura
    if (payload.signature_image) {
      const signaturePath = await this.uploadBase64Image(
        payload.signature_image,
        `signature_${signerId}`
      );
      updates.signature_image_path = signaturePath;
    }

    // Upload da foto facial
    if (payload.facial_image) {
      const facialPath = await this.uploadBase64Image(
        payload.facial_image,
        `facial_${signerId}`
      );
      updates.facial_image_path = facialPath;
    }

    // Upload da foto do documento
    if (payload.document_image) {
      const documentPath = await this.uploadBase64Image(
        payload.document_image,
        `document_${signerId}`
      );
      updates.document_image_path = documentPath;
    }

    const { data, error } = await supabase
      .from(this.signersTable)
      .update(updates)
      .eq('id', signerId)
      .select()
      .single();

    if (error) throw new Error(error.message);

    // Registrar no audit log
    await this.addAuditLog(
      signer.signature_request_id,
      signerId,
      'signed',
      `Documento assinado por ${signer.name}`,
      ipAddress,
      userAgent
    );

    // Verificar se todos os signatários assinaram
    await this.checkAndUpdateRequestStatus(signer.signature_request_id);

    // Notificação é criada automaticamente pelo trigger do banco de dados (notify_on_signature)

    return data;
  }

  private async uploadBase64Image(base64: string, prefix: string): Promise<string> {
    // Remover prefixo data:image/...;base64, se existir
    const base64Data = base64.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0));

    // Detectar tipo de imagem
    let extension = 'png';
    if (base64.includes('data:image/jpeg')) extension = 'jpg';
    else if (base64.includes('data:image/webp')) extension = 'webp';

    const filePath = `${prefix}_${Date.now()}.${extension}`;
    const contentType = `image/${extension === 'jpg' ? 'jpeg' : extension}`;

    console.log('[UPLOAD] Tentando upload:', filePath, 'tamanho:', buffer.length, 'bytes', 'bucket:', STORAGE_BUCKET);

    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(filePath, buffer, {
        contentType,
        upsert: true,
      });

    if (error) {
      console.error('[UPLOAD] Erro no upload:', error);
      console.error('[UPLOAD] Bucket:', STORAGE_BUCKET, 'Path:', filePath);
      throw new Error(`Erro ao fazer upload: ${error.message}`);
    }

    console.log('[UPLOAD] Upload bem sucedido:', data, 'bucket:', STORAGE_BUCKET, 'path:', filePath);
    
    // Verificar se o arquivo foi realmente salvo
    const { data: checkData } = await supabase.storage.from(STORAGE_BUCKET).list('', { search: filePath.split('/').pop() });
    console.log('[UPLOAD] Verificação do arquivo:', checkData);
    
    return filePath;
  }

  private async checkAndUpdateRequestStatus(requestId: string): Promise<void> {
    const { data: signers } = await supabase
      .from(this.signersTable)
      .select('status')
      .eq('signature_request_id', requestId);

    if (!signers || signers.length === 0) return;

    const allSigned = signers.every((s) => s.status === 'signed');
    if (allSigned) {
      const { error } = await supabase
        .from(this.requestsTable)
        .update({
          status: 'signed',
          signed_at: new Date().toISOString(),
        })
        .eq('id', requestId);

      if (error) throw new Error(error.message);
    }
  }

  // ==================== NOTIFICAÇÃO REALTIME ====================

  private async createSignatureNotification(requestId: string, signer: Signer): Promise<void> {
    try {
      // Buscar o request para obter o created_by e document_name
      const { data: request } = await supabase
        .from(this.requestsTable)
        .select('created_by, document_name')
        .eq('id', requestId)
        .single();

      if (!request?.created_by) return;

      // Verificar quantos signatários já assinaram
      const { data: signers } = await supabase
        .from(this.signersTable)
        .select('status')
        .eq('signature_request_id', requestId);

      const totalSigners = signers?.length || 0;
      const signedCount = signers?.filter(s => s.status === 'signed').length || 0;
      const allSigned = totalSigners > 0 && signedCount === totalSigners;

      // Criar notificação APENAS quando todos assinarem (documento completo)
      if (!allSigned) {
        console.log(`⏭️ Assinatura parcial (${signedCount}/${totalSigners}) - notificação não criada`);
        return;
      }

      // Montar título e mensagem para documento totalmente assinado
      const title = '✅ Documento Totalmente Assinado!';
      const message = `"${request.document_name}" foi assinado por todos (${signedCount}/${totalSigners})`;

      // Criar notificação
      await supabase.from('user_notifications').insert({
        user_id: request.created_by,
        title,
        message,
        type: 'process_updated',
        read: false,
        created_at: new Date().toISOString(),
        metadata: {
          signature_type: 'completed',
          signer_name: signer.name,
          signer_email: signer.email,
          document_name: request.document_name,
          signed_count: signedCount,
          total_signers: totalSigners,
          request_id: requestId,
        },
      });

      console.log(`🔔 Notificação de documento completo criada: ${title}`);
    } catch (err) {
      console.error('Erro ao criar notificação de assinatura:', err);
    }
  }

  // ==================== AUDIT LOG ====================

  async addAuditLog(
    requestId: string,
    signerId: string | null,
    action: SignatureAuditLog['action'],
    description: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<void> {
    await supabase.from(this.auditTable).insert({
      signature_request_id: requestId,
      signer_id: signerId,
      action,
      description,
      ip_address: ipAddress,
      user_agent: userAgent,
    });
  }

  async getAuditLog(requestId: string): Promise<SignatureAuditLog[]> {
    const { data, error } = await supabase
      .from(this.auditTable)
      .select('*')
      .eq('signature_request_id', requestId)
      .order('created_at', { ascending: true });

    if (error) throw new Error(error.message);
    return data ?? [];
  }

  // ==================== STATS ====================

  async getStats(): Promise<SignatureStats> {
    const { data, error } = await supabase
      .from(this.requestsTable)
      .select('status');

    if (error) throw new Error(error.message);

    const stats: SignatureStats = {
      total: data?.length ?? 0,
      pending: 0,
      signed: 0,
      expired: 0,
      cancelled: 0,
    };

    data?.forEach((item) => {
      if (item.status === 'pending') stats.pending++;
      else if (item.status === 'signed') stats.signed++;
      else if (item.status === 'expired') stats.expired++;
      else if (item.status === 'cancelled') stats.cancelled++;
    });

    return stats;
  }

  // ==================== UTILS ====================

  async getSignedImageUrl(path: string, expiresIn = 3600): Promise<string> {
    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(path, expiresIn);

    if (error || !data?.signedUrl) {
      throw new Error(error?.message ?? 'Não foi possível gerar URL da imagem');
    }

    return data.signedUrl;
  }

  async uploadSignatureDocumentPdf(file: File, documentId: string): Promise<string> {
    if (!file) throw new Error('Arquivo não informado');
    if (!(file.type || '').includes('pdf') && !file.name.toLowerCase().endsWith('.pdf')) {
      throw new Error('Selecione um arquivo PDF');
    }

    // Muitos buckets têm limite (ex: 10MB). Evita 400 genérico do Storage.
    const maxBytes = 10 * 1024 * 1024;
    if (file.size > maxBytes) {
      throw new Error('O PDF excede 10MB. Reduza o tamanho do arquivo e tente novamente.');
    }

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const filePath = `signature-requests/${documentId}/${Date.now()}_${safeName}`;

    // Enviar como Blob para evitar inconsistências de Content-Type que podem gerar 400
    const blob = new Blob([file], { type: 'application/pdf' });

    const { error } = await supabase.storage
      .from('generated-documents')
      .upload(filePath, blob, {
        upsert: false,
      });

    if (error) {
      const details = JSON.stringify(error, Object.getOwnPropertyNames(error));
      console.error('Erro uploadSignatureDocumentPdf:', error);
      throw new Error(`Erro ao fazer upload do PDF: ${error.message}${details ? ` | detalhes: ${details}` : ''}`);
    }

    return filePath;
  }

  async getDocumentPreviewUrl(documentPath: string): Promise<string | null> {
    // Ir direto para URL assinada (mais rápido, evita verificação HEAD)
    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(documentPath, 3600);

    if (!error && data?.signedUrl) {
      return data.signedUrl;
    }

    // Fallback: tentar do bucket generated-documents
    const { data: data2, error: error2 } = await supabase.storage
      .from('generated-documents')
      .createSignedUrl(documentPath, 3600);

    if (!error2 && data2?.signedUrl) {
      return data2.signedUrl;
    }

    console.warn('Não foi possível gerar URL do documento:', error?.message || error2?.message);
    return null;
  }

  generatePublicSigningUrl(token: string): string {
    // URL base do app - usando hash routing
    const baseUrl = window.location.origin;
    return `${baseUrl}/#/assinar/${token}`;
  }

  generateVerificationUrl(hash: string): string {
    const baseUrl = window.location.origin;
    return `${baseUrl}/#/verificar/${hash}`;
  }

  async verifySignatureByHash(hash: string): Promise<{ signer: Signer; request: SignatureRequest } | null> {
    // Buscar signatário pelo hash de verificação
    const { data: signer, error } = await supabase
      .from(this.signersTable)
      .select('*')
      .eq('verification_hash', hash)
      .single();

    if (error || !signer) {
      // Tentar buscar na tabela de requests (assinatura única)
      const { data: request, error: reqError } = await supabase
        .from(this.requestsTable)
        .select('*')
        .eq('verification_hash', hash)
        .single();

      if (reqError || !request) {
        return null;
      }

      // Retornar request como signer simulado
      return {
        signer: {
          id: request.id,
          signature_request_id: request.id,
          name: request.client_name || 'Signatário',
          email: '',
          cpf: null,
          phone: null,
          role: null,
          order: 1,
          status: request.status,
          auth_method: request.auth_method,
          signed_at: request.signed_at,
          signature_image_path: request.signature_image_path,
          facial_image_path: request.facial_image_path,
          document_image_path: request.document_image_path,
          signer_ip: request.signer_ip,
          signer_user_agent: request.signer_user_agent,
          signer_geolocation: request.signer_geolocation,
          public_token: request.public_token,
          verification_hash: request.verification_hash,
          created_at: request.created_at,
          updated_at: request.updated_at,
        } as Signer,
        request,
      };
    }

    // Buscar request associado
    const request = await this.getRequest(signer.signature_request_id);
    if (!request) return null;

    return { signer, request };
  }

  generateVerificationHash(): string {
    // Gerar hash único de 16 caracteres hexadecimais
    const array = new Uint8Array(8);
    crypto.getRandomValues(array);
    return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  }

  // Upload de documento para assinatura
  async uploadDocument(file: File): Promise<string> {
    const extension = file.name.split('.').pop() ?? 'docx';
    // Usar mesmo padrão do documentTemplate.service (uuid simples)
    const filePath = `signatures/${crypto.randomUUID()}.${extension}`;
    
    const { error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(filePath, file, {
        contentType: file.type || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        upsert: false,
      });
    
    if (error) throw new Error(`Erro ao fazer upload: ${error.message}`);
    
    return filePath;
  }
}

export const signatureService = new SignatureService();
