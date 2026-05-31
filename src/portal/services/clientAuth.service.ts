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
import { supabase } from '../../config/supabase';
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

    const { data, error } = await supabase.rpc('portal_login', {
      p_cpf: normalizedCpf,
      p_password: normalizedPwd,
    });

    if (error) {
      // Limpa qualquer sessão fantasma antes de propagar o erro
      this.logout();
      // Mensagens vindas do RAISE EXCEPTION da função
      const msg = error.message || 'Erro ao validar acesso.';
      // Limpa prefixos típicos do PostgREST (ex: "P0001: ...")
      const clean = msg.replace(/^[A-Z0-9]+:\s*/, '');
      throw new Error(clean);
    }

    if (!data || typeof data !== 'object') {
      throw new Error('Resposta inválida do servidor.');
    }

    const payload = data as PortalLoginRpcResponse;
    if (!payload.user?.id || !payload.client?.id) {
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
      const { data, error } = await supabase.storage
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
      const { data: path, error } = await supabase.rpc('portal_get_client_photo', {
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
  }
}

export const clientAuthService = new ClientAuthService();
