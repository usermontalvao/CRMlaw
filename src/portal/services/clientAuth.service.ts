/**
 * Service de autenticação do Portal do Cliente
 *
 * Usa a RPC `portal_login(cpf, password)` (SECURITY DEFINER) no Postgres
 * para validar credenciais sem expor RLS a `anon`. A RPC retorna {user, client}.
 *
 * Em produção, pode ser substituído por OTP via edge functions:
 *   - email-send-otp / email-verify-otp
 *   - smsdev-send-otp / smsdev-verify-otp
 */
import { supabasePortal } from '../lib/supabasePortal';
import type { ClientPortalUser, PortalSession } from '../types/portal.types';

const SESSION_STORAGE_KEY = 'jurius_portal_session';

interface PortalLoginRpcResponse {
  user: ClientPortalUser;
  client: {
    id: string;
    nome: string;
    email: string | null;
    telefone: string | null;
    photo_path?: string | null;
  };
}

const STORAGE_BUCKET = 'document-templates';
const PHOTO_SIGNED_TTL = 60 * 60; // 1h

class ClientAuthService {
  private onlyDigits(value: string): string {
    return (value || '').replace(/\D/g, '');
  }

  /**
   * Login por CPF + senha (4 últimos dígitos do telefone cadastrado).
   *
   * Chama a função `portal_login` no Postgres, que valida CPF + senha
   * e cria/atualiza o registro em `client_portal_users`.
   */
  async loginByCPF(cpf: string, password: string): Promise<PortalSession> {
    const normalizedCpf = this.onlyDigits(cpf);
    const normalizedPwd = this.onlyDigits(password);

    if (normalizedCpf.length !== 11) {
      throw new Error('CPF inválido. Digite os 11 dígitos.');
    }
    if (normalizedPwd.length !== 4) {
      throw new Error('Senha inválida. Digite os 4 últimos dígitos do seu telefone.');
    }

    // 1. Valida credenciais e obtém um OTP via edge function. A edge function
    //    emite a identidade no GoTrue (sessão real, assinada, com refresh token).
    const { data, error } = await supabasePortal.functions.invoke('portal-login', {
      body: { cpf: normalizedCpf, password: normalizedPwd },
    });

    if (error) {
      this.logout();
      // Erros da edge function chegam com a mensagem no corpo (FunctionsHttpError).
      let msg = 'Erro ao validar acesso.';
      try {
        const ctx = (error as { context?: { json?: () => Promise<{ error?: string }> } }).context;
        const bodyJson = ctx?.json ? await ctx.json() : null;
        if (bodyJson?.error) msg = bodyJson.error;
      } catch { /* mantém msg padrão */ }
      throw new Error(msg.replace(/^[A-Z0-9]+:\s*/, ''));
    }

    const resp = data as {
      success?: boolean;
      error?: string;
      email?: string;
      token?: string;
      user?: PortalLoginRpcResponse['user'];
      client?: PortalLoginRpcResponse['client'];
    } | null;

    if (!resp?.success || !resp.email || !resp.token) {
      this.logout();
      throw new Error(resp?.error || 'Não foi possível validar o acesso.');
    }

    // 2. Conclui a sessão no client dedicado do portal (verifyOtp gera a sessão
    //    Supabase real — daqui pra frente RPCs e realtime usam o JWT do cliente).
    const { error: otpError } = await supabasePortal.auth.verifyOtp({
      email: resp.email,
      token: resp.token,
      type: 'magiclink',
    });
    if (otpError) {
      this.logout();
      throw new Error('Falha ao estabelecer a sessão do portal.');
    }

    const payload = resp as PortalLoginRpcResponse;
    if (!payload.user?.id || !payload.client?.id) {
      this.logout();
      throw new Error('Resposta inválida do servidor.');
    }

    // Tenta gerar signed URL da foto do cliente (silencioso em caso de erro)
    const photoUrl = await this.resolvePhotoUrl(payload.client.photo_path ?? null);

    const session: PortalSession = {
      user: payload.user,
      client: {
        ...payload.client,
        photo_url: photoUrl,
      },
      loginMethod: 'cpf_phone4',
      loginAt: new Date().toISOString(),
    };

    this.persistSession(session);
    return session;
  }

  /**
   * Gera (e retorna) a signed URL da foto do cliente.
   * Retorna null silenciosamente caso não exista ou falhe.
   */
  async resolvePhotoUrl(path: string | null | undefined): Promise<string | null> {
    if (!path) return null;
    try {
      const { data, error } = await supabasePortal.storage
        .from(STORAGE_BUCKET)
        .createSignedUrl(path, PHOTO_SIGNED_TTL);
      if (error || !data?.signedUrl) return null;
      return data.signedUrl;
    } catch {
      return null;
    }
  }

  /**
   * Renova a foto da sessão atual (caso o link expire ou o cliente atualize a foto).
   * Chama a RPC `portal_get_client_photo` para pegar o photo_path atual.
   */
  async refreshSessionPhoto(): Promise<string | null> {
    const session = this.getStoredSession();
    if (!session) return null;
    try {
      const { data: path, error } = await supabasePortal.rpc('portal_get_client_photo', {
        p_portal_user_id: session.user.id,
      });
      if (error) return session.client.photo_url ?? null;
      const url = await this.resolvePhotoUrl(path as string | null);
      const updated: PortalSession = {
        ...session,
        client: { ...session.client, photo_path: path as string | null, photo_url: url },
      };
      this.persistSession(updated);
      return url;
    } catch {
      return session.client.photo_url ?? null;
    }
  }

  /**
   * [PRODUÇÃO - TODO] Inicia OTP por email
   */
  async sendEmailOTP(_email: string): Promise<void> {
    throw new Error('OTP por email ainda não implementado neste scaffolding.');
  }

  /**
   * [PRODUÇÃO - TODO] Verifica OTP e cria sessão
   */
  async verifyEmailOTP(_email: string, _code: string): Promise<PortalSession> {
    throw new Error('OTP por email ainda não implementado neste scaffolding.');
  }

  /**
   * Recupera sessão persistida do localStorage
   */
  getStoredSession(): PortalSession | null {
    if (typeof window === 'undefined') return null;
    try {
      const raw = localStorage.getItem(SESSION_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as PortalSession;
      if (!parsed?.client?.id || !parsed?.user?.id) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  persistSession(session: PortalSession): void {
    if (typeof window === 'undefined') return;
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  }

  logout(): void {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(SESSION_STORAGE_KEY);
    // Encerra a sessão Supabase do portal (escopo local — não toca no staff).
    void supabasePortal.auth.signOut({ scope: 'local' }).catch(() => null);
  }
}

export const clientAuthService = new ClientAuthService();
