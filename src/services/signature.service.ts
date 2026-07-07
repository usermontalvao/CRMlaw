import { supabase } from '../config/supabase';
import { toWhatsappNumber } from '../utils/whatsapp';
import type {
  SignatureRequest,
  SignatureRequestWithSigners,
  Signer,
  SignatureField,
  SignatureRequestDocument,
  CreateSignatureRequestDTO,
  CreateSignerDTO,
  SignDocumentDTO,
  UpdateSignerDTO,
  SignatureAuditLog,
  SignatureStats,
} from '../types/signature.types';
import { matchesNormalizedSearch, normalizeSearchText } from '../utils/search';
import { buildPublicSigningUrl, buildPublicVerificationUrl } from '../utils/publicAppUrl';

const STORAGE_BUCKET = 'document-templates';

/**
 * Rótulo do emissor exibido quando a autoria não deve ser atribuída a uma
 * pessoa: documentos de origem KIT ou cujo emissor foi desativado
 * (profiles.is_active = false). Centralizado para manter o fluxo público,
 * o PDF assinado e o relatório de assinatura sempre consistentes.
 */
export const SYSTEM_ISSUER_LABEL = 'Jurius CRM';

/** Resultado da verificação pública por hash. */
/** Documento final de um envelope no modelo per_document (para a verificação pública). */
export interface VerifiedDocument {
  verification_code?: string | null;
  display_name?: string | null;
  document_type: 'main' | 'attachment';
  sort_order?: number | null;
}

export type VerifyResult =
  | { status: 'valid';   signer: Signer; request: SignatureRequest; documents?: VerifiedDocument[] }
  | { status: 'blocked'; reason?: string | null; signer?: Signer; request?: SignatureRequest; documents?: VerifiedDocument[] }
  | null;

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

    // Checar lixeira / bloqueio (independente do RPC)
    const { data: flags } = await supabase
      .from(this.requestsTable)
      .select('deleted_at, blocked_at, blocked_reason')
      .eq('id', request.id)
      .single();
    if (flags?.deleted_at) return null;
    if (flags?.blocked_at) {
      throw new Error(
        flags.blocked_reason
          ? `Documento bloqueado/revogado pelo emissor. Motivo: ${flags.blocked_reason}`
          : 'Documento bloqueado/revogado pelo emissor. Esta assinatura não está disponível para validação.'
      );
    }

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
      .is('deleted_at', null)
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
    const rows = data ?? [];
    if (!filters?.search) return rows;

    const normalizedSearch = normalizeSearchText(filters.search);
    return rows.filter((item) => matchesNormalizedSearch(normalizedSearch, [item.document_name, item.client_name]));
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

    const byRequest = new Map<string, { total: number; signed: number; refused: number }>();
    for (const s of signers ?? []) {
      const key = (s as any).signature_request_id as string;
      const status = (s as any).status as string;
      const curr = byRequest.get(key) ?? { total: 0, signed: 0, refused: 0 };
      curr.total += 1;
      if (status === 'signed') curr.signed += 1;
      if (status === 'refused') curr.refused += 1;
      byRequest.set(key, curr);
    }

    return requests.map((r) => {
      const agg = byRequest.get(r.id);
      if (agg && agg.refused > 0) {
        return { ...r, status: 'refused' as const };
      }
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
      const anyRefused = signers.some((s) => s.status === 'refused');
      const allSigned = signers.length > 0 && signers.every((s) => s.status === 'signed');
      return {
        ...r,
        status: anyRefused ? 'refused' : (allSigned ? 'signed' : r.status),
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

    // Modelo `per_document`: o envelope recebe um PROTOCOLO próprio, separado dos
    // códigos de verificação individuais de cada documento. Geramos aqui, na
    // criação, para que o protocolo exista e seja estável desde o início. A
    // finalização server-side preserva este valor (usa `|| generateVerificationHash()`),
    // então nada é regravado depois. Fluxo consolidado (legado) não recebe protocolo.
    const insertData: Record<string, any> = {
      ...requestData,
      created_by: userData.user.id,
    };
    if (requestData.signature_model === 'per_document' && !insertData.envelope_verification_code) {
      insertData.envelope_verification_code = this.generateVerificationHash().toUpperCase();
    }

    // Criar a solicitação
    const { data: request, error: reqError } = await supabase
      .from(this.requestsTable)
      .insert(insertData)
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
      public_token: this.generatePublicToken(),
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
      .maybeSingle();

    if (error) throw new Error(error.message);

    if (data) return data;

    const { data: refreshed, error: refreshError } = await supabase
      .from(this.requestsTable)
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (refreshError) throw new Error(refreshError.message);
    if (!refreshed) throw new Error('Solicitação de assinatura não encontrada após atualização.');
    return refreshed;
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

  /**
   * @deprecated Use {@link archiveRequest}. "Arquivar" e "remover do painel" são o
   * mesmo conceito (lixeira restaurável). Este método antes gravava apenas
   * `deleted_at`, que NÃO era lido pela lixeira ({@link listArchivedRequests} usa
   * `archived_at`) — gerando um estado órfão e invisível na UI. Agora delega para
   * `archiveRequest` para manter um único ciclo de vida consistente.
   */
  async deleteRequest(id: string, _deleteFilesFromServer: boolean = false): Promise<void> {
    void _deleteFilesFromServer; // compat — soft delete não apaga arquivos
    await this.archiveRequest(id);
  }

  /** Restaura um documento removido (lixeira) de volta ao painel. */
  async restoreRequest(id: string): Promise<void> {
    const { error } = await supabase
      .from(this.requestsTable)
      .update({ archived_at: null, deleted_at: null })
      .eq('id', id);
    if (error) throw new Error(error.message);
  }

  /** Lista os documentos removidos do painel (lixeira), com signatários. */
  async listArchivedRequests(): Promise<SignatureRequestWithSigners[]> {
    const { data, error } = await supabase
      .from(this.requestsTable)
      .select('*')
      .not('archived_at', 'is', null)
      .order('archived_at', { ascending: false });
    if (error) throw new Error(error.message);
    const requests = (data ?? []) as SignatureRequest[];
    if (requests.length === 0) return [];

    const ids = requests.map((r) => r.id);
    const { data: allSigners } = await supabase
      .from(this.signersTable)
      .select('*')
      .in('signature_request_id', ids)
      .order('order', { ascending: true });

    const byReq = new Map<string, Signer[]>();
    for (const s of (allSigners ?? []) as Signer[]) {
      const arr = byReq.get(s.signature_request_id) ?? [];
      arr.push(s);
      byReq.set(s.signature_request_id, arr);
    }
    return requests.map((r) => ({ ...r, signers: byReq.get(r.id) ?? [] }));
  }

  /** Bloqueia/revoga um documento: não pode mais ser validado publicamente. */
  async blockRequest(id: string, reason?: string | null): Promise<void> {
    const { error } = await supabase
      .from(this.requestsTable)
      .update({ blocked_at: new Date().toISOString(), blocked_reason: reason ?? null })
      .eq('id', id);
    if (error) throw new Error(error.message);
  }

  /** Desbloqueia um documento revogado. */
  async unblockRequest(id: string): Promise<void> {
    const { error } = await supabase
      .from(this.requestsTable)
      .update({ blocked_at: null, blocked_reason: null })
      .eq('id', id);
    if (error) throw new Error(error.message);
  }

  /** Remove paths de todos os buckets relevantes (best-effort). */
  private async removePathsFromStorage(paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    const buckets = ['document-templates', 'generated-documents', 'signatures', 'assinados'];
    for (const bucket of buckets) {
      try {
        await supabase.storage.from(bucket).remove(paths);
      } catch (e) {
        console.warn(`[STORAGE] Erro ao remover do bucket ${bucket}:`, e);
      }
    }
  }

  /**
   * Apaga os DOCX provisórios (documento principal + anexos) do storage após a
   * assinatura estar concluída. Mantém o PDF assinado (artefato legal).
   * Idempotente — marca provisional_cleaned_at.
   */
  async cleanupProvisionalDocs(requestId: string): Promise<void> {
    const request = await this.getRequest(requestId);
    if (!request || request.provisional_cleaned_at) return;

    const isDocx = (p?: string | null) => !!p && /\.(docx?|doc)$/i.test(p);
    const paths: string[] = [];
    if (isDocx(request.document_path)) paths.push(request.document_path!);
    for (const a of request.attachment_paths ?? []) {
      if (isDocx(a)) paths.push(a);
    }

    if (paths.length > 0) {
      console.log('[CLEANUP] Removendo DOCX provisórios:', paths);
      await this.removePathsFromStorage(paths);
    }

    await supabase
      .from(this.requestsTable)
      .update({ provisional_cleaned_at: new Date().toISOString() })
      .eq('id', requestId);
  }

  /**
   * Exclusão DEFINITIVA (a partir da lixeira): apaga do banco (cascade) e,
   * opcionalmente, todos os arquivos do storage.
   */
  async permanentlyDeleteRequest(id: string, deleteFilesFromServer: boolean = true): Promise<void> {
    const request = await this.getRequestWithSigners(id);
    if (!request) return;

    const pathsToDelete: string[] = [];
    if (deleteFilesFromServer) {
      if (request.document_path) pathsToDelete.push(request.document_path);
      if (request.attachment_paths?.length) pathsToDelete.push(...request.attachment_paths);
      if (request.signature_image_path) pathsToDelete.push(request.signature_image_path);
      if (request.facial_image_path) pathsToDelete.push(request.facial_image_path);
      if (request.document_image_path) pathsToDelete.push(request.document_image_path);
      request.signers.forEach((signer) => {
        if (signer.signature_image_path) pathsToDelete.push(signer.signature_image_path);
        if (signer.facial_image_path) pathsToDelete.push(signer.facial_image_path);
        if (signer.document_image_path) pathsToDelete.push(signer.document_image_path);
        if (signer.signed_document_path) pathsToDelete.push(signer.signed_document_path);
      });
    }

    const { error } = await supabase
      .from(this.requestsTable)
      .delete()
      .eq('id', id);
    if (error) throw new Error(error.message);

    if (deleteFilesFromServer) {
      await this.removePathsFromStorage(pathsToDelete);
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

  async getSignerWithRequestByToken(token: string): Promise<{ signer: Signer; request: SignatureRequest; creator?: { name: string } } | null> {
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
    let creator: { name: string } | undefined;
    if (request.created_by) {
      const { data: userData } = await supabase
        .from('profiles')
        .select('name, is_active')
        .eq('user_id', request.created_by)
        .single();
      if (userData) {
        creator = { name: userData.name || 'Usuário' };
        // Documentos de ORIGEM KIT (ou cujo emissor foi desativado) não devem
        // atribuir a autoria a uma pessoa — aparecem como SYSTEM_ISSUER_LABEL.
        if ((await this.isKitOrigin(request.id)) || userData.is_active === false) {
          creator = { name: SYSTEM_ISSUER_LABEL };
        }
      }
    }

    return { signer, request, creator };
  }

  /** Documento gerado por um KIT (preenchimento público) — há template_fill_links apontando p/ a request. */
  private async isKitOrigin(requestId: string): Promise<boolean> {
    if (!requestId) return false;
    const { data } = await supabase
      .from('template_fill_links')
      .select('id')
      .eq('signature_request_id', requestId)
      .limit(1);
    return !!(data && data.length > 0);
  }

  async getPublicSigningBundle(token: string): Promise<{
    signer: Signer;
    request: SignatureRequest;
    creator?: { name: string };
    fields: SignatureField[];
    auth_config?: { google: boolean; email: boolean; phone: boolean };
    /** Em ordem sequencial, nome do signatário anterior ainda pendente (null = é a vez deste signatário). */
    waiting_for?: string | null;
  } | null> {
    const { data, error } = await supabase.rpc('get_public_signing_bundle', {
      p_token: token,
    });

    if (error) {
      console.error('Erro ao buscar bundle público:', error);
      return null;
    }

    if (!data) return null;

    // A RPC já resolve o nome do emissor server-side, retornando apenas
    // { name } — inclusive "Jurius CRM" quando a origem é KIT ou o emissor
    // está desativado (a re-derivação de is_active/KIT no cliente é
    // desnecessária pois os campos não vêm mais no bundle público).
    const creator = data.creator?.name
      ? { name: data.creator.name as string }
      : undefined;

    return {
      signer: data.signer as Signer,
      request: data.request as SignatureRequest,
      creator,
      fields: (data.fields ?? []) as SignatureField[],
      auth_config: (data.auth_config ?? undefined) as any,
      waiting_for: (data.waiting_for ?? null) as string | null,
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

  /**
   * Marca visualização + registra evento de auditoria pelo PÚBLICO.
   * Usa RPC SECURITY DEFINER restrita por public_token — sem update anon direto.
   */
  async markSignerAsViewed(token: string, ipAddress?: string, userAgent?: string): Promise<void> {
    try {
      await supabase.rpc('public_mark_signer_viewed', {
        p_token: token,
        p_ip_address: ipAddress ?? null,
        p_user_agent: userAgent ?? null,
      });
    } catch (e) {
      console.warn('Não foi possível registrar visualização (acesso público):', e);
    }
  }

  /** Heartbeat de presença pelo PÚBLICO via RPC restrita por public_token. */
  async heartbeatSignerPresence(token: string): Promise<void> {
    try {
      await supabase.rpc('public_heartbeat_signer', { p_token: token });
    } catch (error) {
      console.warn('Não foi possível atualizar heartbeat da assinatura:', error);
    }
  }

  /**
   * Anexa o PDF assinado/sha256 ao signatário pelo PÚBLICO via RPC restrita por
   * public_token (substitui o update anon direto). Só grava após assinado.
   */
  async attachSignedPdfPublic(token: string, signedDocumentPath: string, sha256?: string | null, integritySha256?: string | null): Promise<void> {
    const { error } = await supabase.rpc('public_attach_signed_pdf', {
      p_token: token,
      p_path: signedDocumentPath,
      p_sha256: sha256 ?? null,
      p_integrity_sha256: integritySha256 ?? null,
    });
    if (error) console.warn('Não foi possível anexar PDF assinado (acesso público):', error);
  }

  // ==================== DOCUMENTOS DO ENVELOPE (modelo per_document) ====================

  /**
   * Fluxo PÚBLICO (modelo per_document): persiste o PDF assinado INDIVIDUAL de um
   * arquivo do kit (principal ou anexo) via RPC one-shot restrita por public_token.
   * Cada documento tem seu próprio código de verificação, hash e arquivo. Não toca no
   * fluxo consolidado (legado), que continua usando attachSignedPdfPublic.
   */
  async attachSignedDocumentPublic(
    token: string,
    params: {
      document_key: string;
      document_type: 'main' | 'attachment';
      display_name?: string | null;
      source_file_path?: string | null;
      signed_file_path: string;
      verification_code: string;
      signed_pdf_sha256?: string | null;
      document_hash?: string | null;
      page_count?: number | null;
      sort_order?: number | null;
    },
  ): Promise<void> {
    const { error } = await supabase.rpc('public_attach_signed_document', {
      p_token: token,
      p_document_key: params.document_key,
      p_document_type: params.document_type,
      p_display_name: params.display_name ?? null,
      p_source_file_path: params.source_file_path ?? null,
      p_signed_path: params.signed_file_path,
      p_verification_code: params.verification_code,
      p_sha256: params.signed_pdf_sha256 ?? null,
      p_document_hash: params.document_hash ?? null,
      p_page_count: params.page_count ?? null,
      p_sort_order: params.sort_order ?? 0,
    });
    // Persistência do documento individual é requisito jurídico: NÃO pode falhar
    // silenciosamente. A RPC retorna void (sem erro) mesmo quando aplica a trava
    // last-signer-wins (replay/recência) — só há `error` em falha real de banco.
    if (error) {
      console.error('[PER-DOC] Falha ao anexar documento assinado (público):', error);
      throw new Error(error.message || 'Falha ao persistir o documento assinado.');
    }
  }

  /** Fluxo PÚBLICO: lista os documentos assinados individuais do envelope (por token). */
  async getPublicRequestDocuments(token: string): Promise<SignatureRequestDocument[]> {
    if (!token) return [];
    const { data, error } = await supabase.rpc('public_signing_request_documents', { p_token: token });
    if (error) {
      console.warn('[PER-DOC] Falha ao listar documentos do envelope (público):', error);
      return [];
    }
    return (data ?? []) as SignatureRequestDocument[];
  }

  /**
   * Dossiê probatório completo de um envelope (uso INTERNO, office-staff ou criador).
   * Monta no servidor: envelope + documentos (com hashes) + signatários (prova do ato:
   * IP, dispositivo, geolocalização, autenticação, aceite, biometria, carimbos) +
   * trilha de auditoria encadeada + VEREDITO de integridade da cadeia. É o material
   * para juntar num processo e comprovar a licitude da assinatura.
   */
  async getForensicReport(requestId: string): Promise<any | null> {
    if (!requestId) return null;
    const { data, error } = await supabase.rpc('signature_forensic_report', { p_request_id: requestId });
    if (error) {
      console.error('[FORENSE] Falha ao gerar dossiê probatório:', error);
      throw new Error(error.message || 'Falha ao gerar o relatório forense.');
    }
    return data ?? null;
  }

  /** Fluxo INTERNO (office-staff): lista os documentos assinados individuais de um envelope. */
  async listRequestDocuments(requestId: string): Promise<SignatureRequestDocument[]> {
    if (!requestId) return [];
    const { data, error } = await supabase
      .from('signature_request_documents')
      .select('*')
      .eq('signature_request_id', requestId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) {
      console.warn('[PER-DOC] Falha ao listar documentos do envelope (interno):', error);
      return [];
    }
    return (data ?? []) as SignatureRequestDocument[];
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

  async updateSignerSignedDocumentMeta(signerId: string, params: { signed_document_path: string; signed_pdf_sha256?: string | null; integrity_sha256?: string | null }): Promise<void> {
    const { signed_document_path, signed_pdf_sha256, integrity_sha256 } = params;
    const update: Record<string, unknown> = { signed_document_path, signed_pdf_sha256: signed_pdf_sha256 ?? null };
    // Só grava o hash de integridade quando informado (preserva valor em fluxos que não o calculam)
    if (integrity_sha256 !== undefined) update.integrity_sha256 = integrity_sha256;
    const { error } = await supabase
      .from(this.signersTable)
      .update(update)
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
        terms_accepted: payload.terms_accepted,
        terms_version: payload.terms_version,
        allow_signature_selfie_for_profile: payload.allow_signature_selfie_for_profile === true,
        selfie_profile_consent_version: payload.selfie_profile_consent_version,
        // Instantes reais das etapas (o servidor clampa à janela [viewed_at, now()])
        auth_at: payload.auth_at,
        facial_captured_at: payload.facial_captured_at,
        geolocation_captured_at: payload.geolocation_captured_at,
        ip_address: ipAddress,
        user_agent: userAgent,
      },
    });

    if (error) {
      console.error('[signDocumentPublic] Edge function error:', error);
      // Em respostas não-2xx (ex.: 409 ordem sequencial, 403 CPF), o corpo com a
      // mensagem amigável fica em error.context — extrair para exibir ao signatário.
      const serverMessage = await this.extractEdgeErrorMessage(error);
      throw new Error(serverMessage || error.message || 'Erro ao assinar documento');
    }

    if (!data?.success) {
      throw new Error(data?.error || 'Erro ao assinar documento');
    }

    return data.signer as Signer;
  }

  /**
   * FASE 1 (server-side): aciona o orquestrador `finalize-signature-envelope`, que
   * relê os PDFs do Storage, RECALCULA o SHA-256 no servidor (A1), detecta
   * sobrescrita (A4) e é a ÚNICA autoridade que flipa o envelope e dispara e-mail.
   * Idempotente. Retorna a forma compatível com o finalize legado.
   */
  async finalizeEnvelopeServerSide(
    publicToken: string,
    params: { expectedDocumentCount: number; origin?: string; ipAddress?: string; userAgent?: string },
  ): Promise<{ finalized: boolean; reason?: string; persistedCount: number; expectedDocumentCount: number; jobId?: string }> {
    const { data, error } = await supabase.functions.invoke('finalize-signature-envelope', {
      body: {
        token: publicToken,
        origin: params.origin,
        ip_address: params.ipAddress,
        user_agent: params.userAgent,
      },
    });
    if (error) {
      const serverMessage = await this.extractEdgeErrorMessage(error);
      throw new Error(serverMessage || error.message || 'Erro ao finalizar o envelope assinado');
    }
    if (data && data.success === false) {
      throw new Error(data.error || 'Erro ao finalizar o envelope assinado');
    }
    return {
      finalized: data?.finalized === true,
      reason: data?.reason || undefined,
      persistedCount: Number(data?.persisted ?? 0),
      expectedDocumentCount: Number(data?.expected ?? params.expectedDocumentCount),
      jobId: data?.job_id,
    };
  }

  /** FASE 2: status do job de finalização para o polling do frontend público (token-scoped). */
  async getFinalizationStatusPublic(publicToken: string): Promise<{
    requestStatus: string | null; jobStatus: string; stage: string | null; progress: number;
    expected: number | null; persisted: number | null; finalized: boolean; error: string | null;
  } | null> {
    if (!publicToken) return null;
    const { data, error } = await supabase.rpc('public_signature_finalization_status', { p_token: publicToken });
    if (error || !data) return null;
    return {
      requestStatus: (data as any).request_status ?? null,
      jobStatus: (data as any).job_status ?? 'none',
      stage: (data as any).stage ?? null,
      progress: Number((data as any).progress ?? 0),
      expected: (data as any).expected ?? null,
      persisted: (data as any).persisted ?? null,
      finalized: (data as any).finalized === true,
      error: (data as any).error ?? null,
    };
  }

  /**
   * FASE 2: aguarda a finalização REAL do envelope no servidor via polling do job,
   * emitindo progresso por etapas. Usado quando o orquestrador ainda não retornou
   * `finalized` (ex.: lock em outro worker, aguardando persistência). Nunca lança
   * por timeout — devolve o último estado conhecido para o chamador decidir.
   */
  async waitForFinalizationPublic(
    publicToken: string,
    opts?: { timeoutMs?: number; intervalMs?: number; onProgress?: (p: { stage: string | null; progress: number }) => void },
  ): Promise<{ finalized: boolean; failed: boolean; error: string | null; stage: string | null; progress: number }> {
    const timeoutMs = opts?.timeoutMs ?? 30_000;
    const intervalMs = opts?.intervalMs ?? 2_000;
    const deadline = Date.now() + timeoutMs;
    let last = { finalized: false, failed: false, error: null as string | null, stage: null as string | null, progress: 0 };
    while (Date.now() < deadline) {
      const s = await this.getFinalizationStatusPublic(publicToken);
      if (s) {
        last = { finalized: s.finalized, failed: s.jobStatus === 'failed', error: s.error, stage: s.stage, progress: s.progress };
        opts?.onProgress?.({ stage: s.stage, progress: s.progress });
        if (s.finalized) return last;
        if (s.jobStatus === 'failed') return last;
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    return last;
  }

  async finalizePerDocumentSigningPublic(
    publicToken: string,
    params: {
      expectedDocumentCount: number;
      origin?: string;
      ipAddress?: string;
      userAgent?: string;
    },
  ): Promise<{ finalized: boolean; reason?: string; persistedCount: number; expectedDocumentCount: number }> {
    // Prefere o orquestrador server-side (autoridade sobre hash/finalização, A1/A4).
    // Fallback gracioso para o caminho legado se a função nova ainda não estiver
    // deployada — garante deploy incremental sem quebrar produção.
    try {
      const res = await this.finalizeEnvelopeServerSide(publicToken, params);
      return { finalized: res.finalized, reason: res.reason, persistedCount: res.persistedCount, expectedDocumentCount: res.expectedDocumentCount };
    } catch (e) {
      const msg = (e as Error)?.message || '';
      const notDeployed = /not\s*found|404|Failed to send a request|Function not found/i.test(msg);
      if (!notDeployed) throw e;
      console.warn('[FINALIZE] orquestrador server-side indisponível; usando caminho legado.', msg);
    }

    const { data, error } = await supabase.functions.invoke('public-sign-document', {
      body: {
        action: 'finalize_per_document',
        token: publicToken,
        expected_document_count: params.expectedDocumentCount,
        origin: params.origin,
        ip_address: params.ipAddress,
        user_agent: params.userAgent,
      },
    });

    if (error) {
      const serverMessage = await this.extractEdgeErrorMessage(error);
      throw new Error(serverMessage || error.message || 'Erro ao finalizar o envelope assinado');
    }
    if (!data?.success) {
      throw new Error(data?.error || 'Erro ao finalizar o envelope assinado');
    }

    return {
      finalized: data.finalized === true,
      reason: data.reason || undefined,
      persistedCount: Number(data.persisted_count ?? 0),
      expectedDocumentCount: Number(data.expected_document_count ?? params.expectedDocumentCount),
    };
  }

  async reportPerDocumentFailurePublic(
    publicToken: string,
    params: {
      stage: string;
      error: string;
      expectedDocumentCount?: number;
      persistedCount?: number;
      ipAddress?: string;
      userAgent?: string;
    },
  ): Promise<void> {
    const { error } = await supabase.functions.invoke('public-sign-document', {
      body: {
        action: 'report_per_document_failure',
        token: publicToken,
        stage: params.stage,
        error: params.error,
        expected_document_count: params.expectedDocumentCount ?? null,
        persisted_count: params.persistedCount ?? null,
        ip_address: params.ipAddress,
        user_agent: params.userAgent,
      },
    });
    if (error) {
      console.warn('[PER-DOC] Falha ao registrar auditoria pública de finalização:', error);
    }
  }

  /** Extrai a mensagem de erro do corpo JSON de uma resposta não-2xx de Edge Function. */
  private async extractEdgeErrorMessage(error: any): Promise<string | null> {
    try {
      const res = error?.context;
      if (res && typeof res.json === 'function') {
        const body = await res.clone().json();
        if (body?.error) return String(body.error);
      }
    } catch {
      // ignore — cai no fallback do chamador
    }
    return null;
  }

  /**
   * Recusa o documento via Edge Function (uso público sem sessão autenticada).
   * Exige que a solicitação tenha allow_refusal = true. Registra motivo, audit e notifica o criador.
   */
  async refuseDocumentPublic(
    publicToken: string,
    reason: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<Signer> {
    const { data, error } = await supabase.functions.invoke('public-refuse-document', {
      body: {
        token: publicToken,
        reason,
        ip_address: ipAddress,
        user_agent: userAgent,
      },
    });

    if (error) {
      console.error('[refuseDocumentPublic] Edge function error:', error);
      throw new Error(error.message || 'Erro ao recusar documento');
    }
    if (!data?.success) {
      throw new Error(data?.error || 'Erro ao recusar documento');
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

    // Regras de negócio da solicitação — as MESMAS do fluxo público (edge function).
    // Sem isso, o caminho interno do CRM contornaria require_cpf e signing_order,
    // produzindo uma assinatura que o fluxo público corretamente rejeitaria.
    const { data: reqRules } = await supabase
      .from(this.requestsTable)
      .select('require_cpf, signing_order')
      .eq('id', signer.signature_request_id)
      .maybeSingle();

    if (reqRules?.signing_order === 'sequential') {
      const myOrder = typeof signer.order === 'number' ? signer.order : 1;
      const { data: priorSigners } = await supabase
        .from(this.signersTable)
        .select('name, order, status')
        .eq('signature_request_id', signer.signature_request_id)
        .lt('order', myOrder)
        .neq('status', 'signed');
      if (priorSigners && priorSigners.length > 0) {
        const next = [...priorSigners].sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0))[0];
        throw new Error(`Ordem sequencial: aguarde a assinatura de ${(next?.name || '').trim() || 'o signatário anterior'} antes deste signatário.`);
      }
    }

    if (reqRules?.require_cpf) {
      const onlyDigits = (v: unknown) => String(v ?? '').replace(/\D/g, '');
      const submittedCpf = onlyDigits(payload.signer_cpf);
      const expectedCpf = onlyDigits(signer.cpf);
      if (submittedCpf.length !== 11) {
        throw new Error('Este documento exige o CPF do signatário para assinar.');
      }
      if (expectedCpf.length === 11 && submittedCpf !== expectedCpf) {
        throw new Error('O CPF informado não confere com o CPF cadastrado do signatário.');
      }
    }

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

    const { error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(filePath, buffer, {
        contentType,
        upsert: true,
      });

    if (error) {
      console.error('[UPLOAD] Erro no upload:', error.message);
      throw new Error(`Erro ao fazer upload: ${error.message}`);
    }

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

      // Documento concluído → apagar DOCX provisórios do storage (mantém PDF assinado).
      // Best-effort: não falha o fluxo de assinatura se a limpeza der erro.
      try {
        await this.cleanupProvisionalDocs(requestId);
      } catch (e) {
        console.warn('[CLEANUP] Falha ao limpar DOCX provisórios:', e);
      }
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
        type: 'signature_completed',
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

  /**
   * Fluxo PÚBLICO: obtém uma URL assinada de um arquivo da assinatura validando
   * o token no servidor (edge function token-scoped), sem expor o storage ao
   * papel `anon`. Retorna null se não autorizado/inexistente.
   */
  async getPublicFileUrl(token: string, path: string, expiresIn = 3600): Promise<string | null> {
    if (!token || !path) return null;
    const { data, error } = await supabase.functions.invoke('public-signing-file', {
      body: { token, path, expiresIn },
    });
    if (error || !data?.url) {
      console.error('[getPublicFileUrl] falha ao obter URL:', error ?? data?.error);
      return null;
    }
    return data.url as string;
  }

  /**
   * Fluxo PÚBLICO de VERIFICAÇÃO: obtém a URL assinada do PDF assinado validando
   * o `verification_hash` no servidor (edge hash-scoped), sem expor o bucket
   * `assinados` ao papel `anon`. Retorna null se não autorizado/inexistente.
   */
  async getVerifiedFileUrl(hash: string, expiresIn = 3600): Promise<string | null> {
    if (!hash) return null;
    const { data, error } = await supabase.functions.invoke('public-verify-file', {
      body: { hash, expiresIn },
    });
    if (error || !data?.url) {
      console.warn('[getVerifiedFileUrl] falha ao obter URL:', error ?? data?.error);
      return null;
    }
    return data.url as string;
  }

  /**
   * Fluxo PÚBLICO: lista os co-signatários do request do `token` via RPC
   * SECURITY DEFINER token-scoped, sem leitura anon direta na tabela. Usado
   * para compor o certificado/relatório do PDF assinado (multi-signatário).
   */
  async getPublicReportSigners(token: string): Promise<Signer[] | null> {
    if (!token) return null;
    const { data, error } = await supabase.rpc('public_signing_request_signers', { p_token: token });
    if (error) {
      console.warn('[getPublicReportSigners] falha:', error);
      return null;
    }
    return (data ?? []) as Signer[];
  }

  /**
   * Fluxo PÚBLICO: telefone/WhatsApp do escritório (fonte central `office_identity`)
   * via RPC SECURITY DEFINER `portal_office_contact`, liberada ao anon. Retorna o
   * número já normalizado para `wa.me` (ou null quando não configurado).
   */
  async getOfficeWhatsapp(): Promise<string | null> {
    const { data, error } = await supabase.rpc('portal_office_contact');
    if (error) {
      console.warn('[getOfficeWhatsapp] falha:', error);
      return null;
    }
    return toWhatsappNumber((data as { phone?: string } | null)?.phone);
  }

  /**
   * Fluxo PÚBLICO: lista a trilha de auditoria do request do `token` via RPC
   * SECURITY DEFINER token-scoped, sem leitura anon direta na tabela.
   */
  async getPublicReportAuditLog(token: string): Promise<SignatureAuditLog[] | null> {
    if (!token) return null;
    const { data, error } = await supabase.rpc('public_signing_audit_log', { p_token: token });
    if (error) {
      console.warn('[getPublicReportAuditLog] falha:', error);
      return null;
    }
    return (data ?? []) as SignatureAuditLog[];
  }

  /**
   * Fluxo PÚBLICO: grava o PDF assinado/relatório no bucket `assinados` via
   * edge token-scoped (`public-signing-upload`), em vez do INSERT anon direto.
   * Retorna true em sucesso. O servidor valida token → request e que o path
   * pertence ao próprio signatário.
   */
  async uploadSignedFilePublic(
    token: string,
    path: string,
    bytes: Uint8Array,
    contentType = 'application/pdf',
  ): Promise<boolean> {
    if (!token || !path || !bytes?.length) return false;
    // Converte para base64 em blocos (evita estouro de pilha em arquivos grandes).
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
    }
    const contentBase64 = btoa(binary);

    const { data, error } = await supabase.functions.invoke('public-signing-upload', {
      body: { token, path, contentBase64, contentType },
    });
    if (error || !data?.success) {
      console.warn('[uploadSignedFilePublic] falha:', error ?? data?.error);
      return false;
    }
    return true;
  }

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
      .from(STORAGE_BUCKET)
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
    // createSignedUrl always succeeds even for non-existent files, so we
    // must verify the file actually lives in the bucket before signing.
    const bucketsToTry = [STORAGE_BUCKET, 'generated-documents', 'cloud-files'];

    // Helper: check if a file exists in a given bucket using list()
    const fileExistsInBucket = async (bucket: string, path: string): Promise<boolean> => {
      try {
        const lastSlash = path.lastIndexOf('/');
        const folder   = lastSlash >= 0 ? path.slice(0, lastSlash)  : '';
        const filename = lastSlash >= 0 ? path.slice(lastSlash + 1) : path;
        const { data, error } = await supabase.storage
          .from(bucket)
          .list(folder, { search: filename, limit: 1 });
        if (error || !data) return false;
        return data.some((f) => f.name === filename);
      } catch {
        return false;
      }
    };

    for (const bucket of bucketsToTry) {
      const exists = await fileExistsInBucket(bucket, documentPath);
      if (!exists) continue;

      const { data, error } = await supabase.storage
        .from(bucket)
        .createSignedUrl(documentPath, 3600);

      if (!error && data?.signedUrl) {
        return data.signedUrl;
      }
    }

    console.warn('Não foi possível localizar o documento em nenhum bucket:', documentPath);
    return null;
  }

  generatePublicSigningUrl(token: string): string {
    return buildPublicSigningUrl(token);
  }

  generateVerificationUrl(hash: string): string {
    return buildPublicVerificationUrl(hash);
  }

  /**
   * Verificação pública por hash via RPC SECURITY DEFINER que retorna apenas
   * os campos mínimos (sem PII como IP, user agent, geolocalização, e-mails ou
   * auth_google_sub). Não depende de leitura anon direta nas tabelas.
   */
  async verifySignatureByHash(hash: string): Promise<VerifyResult> {
    const { data, error } = await supabase.rpc('public_verify_by_hash', { p_hash: hash });
    if (error) {
      console.error('Erro na verificação por hash:', error);
      return null;
    }
    if (!data) return null;

    const status = (data as any).status as string;
    const signer = (data as any).signer ? ((data as any).signer as Signer) : undefined;
    const request = (data as any).request ? ((data as any).request as SignatureRequest) : undefined;
    const documents = Array.isArray((data as any).documents)
      ? ((data as any).documents as VerifiedDocument[])
      : undefined;

    if (status === 'blocked') {
      return { status: 'blocked', reason: (data as any).reason ?? null, signer, request, documents };
    }
    return { status: 'valid', signer: signer as any, request: request as any, documents };
  }

  generateVerificationHash(): string {
    // Gerar hash único de 16 caracteres hexadecimais
    const array = new Uint8Array(8);
    crypto.getRandomValues(array);
    return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  generatePublicToken(): string {
    return crypto.randomUUID();
  }

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

  /**
   * Envia o link público do documento assinado para o e-mail dos signatários.
   */
  async sendSignatureLinkEmail(
    requestId: string,
    force = false,
  ): Promise<{ sent: string[]; failed: { email: string; error: string }[] }> {
    const origin = 'https://jurius.com.br';
    const { data, error } = await supabase.functions.invoke('send-signature-link', {
      body: { request_id: requestId, origin, force },
    });
    if (error) throw new Error(error.message ?? 'Erro ao enviar e-mail');
    if (!data?.success && data?.sent?.length === 0) throw new Error(data?.failed?.[0]?.error ?? 'Falha no envio');
    return { sent: data.sent ?? [], failed: data.failed ?? [] };
  }
}

export const signatureService = new SignatureService();
