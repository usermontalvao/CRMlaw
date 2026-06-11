import { supabase } from '../config/supabase';

export interface PinMeta {
  has_pin: boolean;
  pin_set_at?: string;
  updated_at?: string;
  failed_attempts?: number;
  locked_until?: string | null;
  last_verified_at?: string | null;
  pin_required_setup?: boolean;
  removed_at?: string | null;
}

export interface VerifyResult {
  ok: boolean;
  error?: 'no_pin' | 'locked' | 'wrong_pin' | 'unauthenticated';
  message?: string;
  locked_until?: string;
  attempts_left?: number;
}

const BLOCKED_PINS = new Set([
  '000000','111111','222222','333333','444444','555555',
  '666666','777777','888888','999999','123456','654321',
  '012345','098765','111222','112233',
]);

function validatePinFormat(pin: string): string | null {
  if (!/^\d{6}$/.test(pin)) return 'PIN deve ter exatamente 6 dígitos numéricos';
  if (BLOCKED_PINS.has(pin)) return 'PIN muito simples. Escolha uma combinação mais segura';
  return null;
}

class SecurityPinService {
  validatePin(pin: string): string | null {
    return validatePinFormat(pin);
  }

  async hasSecurityPin(): Promise<boolean> {
    const { data, error } = await supabase.rpc('has_security_pin');
    if (error) {
      console.error('[SecurityPin] hasSecurityPin error:', error);
      return false;
    }
    return Boolean(data);
  }

  async getPinMeta(userId?: string): Promise<PinMeta> {
    const { data, error } = await supabase.rpc('get_security_pin_meta', {
      p_user_id: userId ?? null,
    });
    if (error) {
      console.error('[SecurityPin] getPinMeta error:', error);
      return { has_pin: false };
    }
    return (data as PinMeta) ?? { has_pin: false };
  }

  async createSecurityPin(pin: string): Promise<void> {
    const { error } = await supabase.rpc('create_security_pin', { p_pin: pin });
    if (error) throw new Error(error.message);
  }

  async verifySecurityPin(
    pin: string,
    action: string,
    resourceType?: string,
    resourceId?: string,
  ): Promise<VerifyResult> {
    const { data, error } = await supabase.rpc('verify_security_pin', {
      p_pin: pin,
      p_action: action,
      p_resource_type: resourceType ?? null,
      p_resource_id: resourceId ?? null,
    });
    if (error) return { ok: false, message: error.message };
    return (data as VerifyResult) ?? { ok: false, message: 'Erro desconhecido' };
  }

  async changeSecurityPin(oldPin: string, newPin: string): Promise<VerifyResult> {
    const { data, error } = await supabase.rpc('change_security_pin', {
      p_old_pin: oldPin,
      p_new_pin: newPin,
    });
    if (error) return { ok: false, message: error.message };
    return (data as VerifyResult) ?? { ok: false, message: 'Erro desconhecido' };
  }

  async removeSecurityPin(pin: string): Promise<VerifyResult> {
    const { data, error } = await supabase.rpc('remove_security_pin', { p_pin: pin });
    if (error) return { ok: false, message: error.message };
    return (data as VerifyResult) ?? { ok: false, message: 'Erro desconhecido' };
  }

  async adminResetSecurityPin(targetUserId: string): Promise<void> {
    const { error } = await supabase.rpc('admin_reset_security_pin', {
      p_target_user_id: targetUserId,
    });
    if (error) throw new Error(error.message);
  }
}

export const securityPinService = new SecurityPinService();
