// FIXAR CONVERSA NO TOPO — o estado, por usuário.
//
// Irmão de `muteStore`, e de propósito com a mesma forma: um mapa em memória,
// `useSyncExternalStore` para a UI, e o banco como fonte. Duas diferenças, as
// duas deliberadas:
//
// 1. SEM REALTIME. O silenciamento entrou na publicação porque o notificador de
//    OUTRA aba precisa parar de tocar na hora. Fixar não tem urgência: quem fixa
//    é a própria pessoa, no próprio aparelho, e a tela dela já mudou no clique.
//    Ver a nota na migration — o decodificador de WAL cobra por tabela
//    publicada, e sincronizar isso entre dispositivos em tempo real não vale o
//    preço. A outra aba pega na próxima carga da inbox.
//
// 2. O CLIQUE PINTA A TELA ANTES DA REDE. Fixar é um gesto de arrumação: a
//    conversa tem de subir no mesmo quadro do clique. O banco vem depois; se
//    ele recusar, o mapa volta atrás e quem chamou recebe o erro para avisar.
import { supabase } from '../../config/supabase';

const PIN_TABLE = 'whatsapp_conversation_pins';

/** conversation_id → instante em que foi fixada (ordena as fixadas entre si). */
const map = new Map<string, string>();
const listeners = new Set<() => void>();
let initialized = false;
let version = 0; // muda a cada emit → snapshot estável para useSyncExternalStore

function emit() { version += 1; listeners.forEach(l => l()); }

export const pinStore = {
  isPinned(conversationId: string): boolean {
    return map.has(conversationId);
  },

  /**
   * Quando foi fixada — a chave de desempate entre as fixadas. `undefined`
   * quando não está fixada.
   */
  pinnedAt(conversationId: string): string | undefined {
    return map.get(conversationId);
  },

  /** Quantas estão fixadas agora. */
  get size(): number { return map.size; },

  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  },

  /** Snapshot para `useSyncExternalStore` — número, e não objeto novo. */
  getSnapshot(): number { return version; },

  /** Lê do banco uma vez por sessão. A RLS já limita às linhas deste usuário. */
  async init(): Promise<void> {
    if (initialized) return;
    initialized = true;
    await this.reload();
  },

  async reload(): Promise<void> {
    const { data, error } = await supabase.from(PIN_TABLE).select('conversation_id, created_at');
    // Silencioso: sem as marcas a lista continua na ordem de atividade, que é a
    // ordem correta. Uma inbox que não abre por causa de um enfeite seria pior.
    if (error) return;
    map.clear();
    for (const r of data || []) map.set(r.conversation_id as string, (r.created_at as string) || new Date().toISOString());
    emit();
  },

  /**
   * Liga/desliga a marca. Devolve o estado que ficou valendo.
   *
   * Pinta primeiro e grava depois; em caso de falha desfaz e relança, para a
   * tela poder dizer que não deu — uma conversa que "some do topo sozinha" no
   * recarregamento seguinte é pior do que um aviso na hora.
   */
  async toggle(conversationId: string): Promise<boolean> {
    const { data: sessao } = await supabase.auth.getUser();
    const userId = sessao.user?.id;
    if (!userId) throw new Error('Não autenticado');

    const estava = map.has(conversationId);
    const antes = map.get(conversationId);
    if (estava) map.delete(conversationId); else map.set(conversationId, new Date().toISOString());
    emit();

    try {
      if (estava) {
        const { error } = await supabase.from(PIN_TABLE).delete()
          .eq('conversation_id', conversationId).eq('user_id', userId);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await supabase.from(PIN_TABLE)
          // `upsert` e não `insert`: clicar duas vezes depressa (ou ter a marca
          // criada em outro aparelho) não pode virar erro de chave duplicada
          // numa ação cujo resultado desejado já está no banco.
          .upsert({ conversation_id: conversationId, user_id: userId }, { onConflict: 'conversation_id,user_id' });
        if (error) throw new Error(error.message);
      }
      return !estava;
    } catch (e) {
      if (estava && antes !== undefined) map.set(conversationId, antes);
      else map.delete(conversationId);
      emit();
      throw e;
    }
  },

  /** Esquece tudo — para a troca de usuário não herdar as marcas do anterior. */
  reset(): void {
    initialized = false;
    map.clear();
    emit();
  },
};
