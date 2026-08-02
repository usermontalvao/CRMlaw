import { supabase } from '../config/supabase';
import { validateBirthDate } from '../utils/birthday';

export const BIRTHDAY_UPDATED_EVENT = 'crm-birthday-updated';

export type BirthdayUpdatedDetail = {
  userId: string;
  birthDate: string;
};

export type BirthdayRecord = {
  birthDate: string | null;
  celebratedYear: number | null;
  /**
   * Colaborador ativo. Vem de profiles.is_active — o mesmo campo que o
   * AuthContext usa para bloquear a conta. Quem foi desligado não é
   * homenageado, mesmo que ainda consiga abrir o app por um instante.
   */
  isActive: boolean;
};

const EMPTY_RECORD: BirthdayRecord = { birthDate: null, celebratedYear: null, isActive: false };

class BirthdayService {
  private readonly tableName = 'staff_birthdays';

  async getMyBirthday(userId: string): Promise<BirthdayRecord> {
    // select('*') de propósito: em ambientes onde a migração do
    // celebrated_year ainda não rodou, pedir a coluna pelo nome derruba a
    // consulta inteira — e aí o cadastro obrigatório deixaria de aparecer.
    const [birthday, profile] = await Promise.all([
      supabase.from(this.tableName).select('*').eq('user_id', userId).maybeSingle(),
      supabase.from('profiles').select('is_active').eq('user_id', userId).maybeSingle(),
    ]);

    if (birthday.error) throw new Error(birthday.error.message);

    // Só desliga a homenagem quando o banco AFIRMA que a pessoa está inativa.
    // Se a leitura do perfil falhar, seguimos como ativo — um erro de rede não
    // deve apagar o aniversário de ninguém.
    const isActive = profile.data?.is_active !== false;
    if (!birthday.data) return { ...EMPTY_RECORD, isActive };

    return {
      birthDate: birthday.data.birth_date ? String(birthday.data.birth_date) : null,
      celebratedYear:
        birthday.data.celebrated_year === null || birthday.data.celebrated_year === undefined
          ? null
          : Number(birthday.data.celebrated_year),
      isActive,
    };
  }

  async getMyBirthDate(userId: string): Promise<string | null> {
    const { birthDate } = await this.getMyBirthday(userId);
    return birthDate;
  }

  async saveMyBirthDate(userId: string, birthDate: string): Promise<string> {
    const validationError = validateBirthDate(birthDate);
    if (validationError) throw new Error(validationError);

    const { data, error } = await supabase
      .from(this.tableName)
      .upsert(
        {
          user_id: userId,
          birth_date: birthDate,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      )
      .select('birth_date')
      .single();

    if (error) throw new Error(error.message);

    const savedBirthDate = String(data.birth_date);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent<BirthdayUpdatedDetail>(BIRTHDAY_UPDATED_EVENT, {
          detail: { userId, birthDate: savedBirthDate },
        }),
      );
    }

    return savedBirthDate;
  }

  /**
   * Registra que a pessoa ABRIU a celebração deste ano — é essa confirmação
   * (e não o simples aviso na tela) que encerra a experiência para o ano.
   */
  async markCelebrated(userId: string, year = new Date().getFullYear()): Promise<void> {
    const { error } = await supabase
      .from(this.tableName)
      .update({ celebrated_year: year, updated_at: new Date().toISOString() })
      .eq('user_id', userId);

    if (error) throw new Error(error.message);
  }
}

export const birthdayService = new BirthdayService();
