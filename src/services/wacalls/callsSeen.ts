// "EU JÁ VI AS LIGAÇÕES ATÉ AQUI" — uma marca só, para dois avisos.
//
// O CRM tem dois lugares dizendo que existe chamada perdida: o distintivo da
// aba de Ligações (`useCallHistory`) e o cartão que fica na tela em qualquer
// módulo (`missedCallStore`). Eles precisam concordar — abrir a aba e ver a
// lista, mas continuar com o cartão de aviso na tela, é o tipo de aviso que se
// aprende a ignorar; e dispensar o cartão sem zerar o distintivo é o mesmo
// defeito ao contrário.
//
// A marca mora no NAVEGADOR, e não no banco, de propósito: "eu já vi" é do
// operador e da mesa dele. A recepcionista abrir a aba não pode apagar o aviso
// do advogado que ainda não olhou — foi para essa pessoa que o aviso existia.
// É a mesma escolha que o WhatsApp faz entre um aparelho e outro.

const SEEN_KEY = 'wa:callsSeenUntil';

const listeners = new Set<() => void>();

/** O instante (ISO) da chamada mais recente já dada por vista, ou `null`. */
export function readCallsSeenUntil(): string | null {
  try { return localStorage.getItem(SEEN_KEY); } catch { return null; }
}

/** A mesma marca em ms — o formato que as regras comparam. */
export function readCallsSeenUntilMs(): number | null {
  const iso = readCallsSeenUntil();
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/**
 * Avança a marca. NUNCA recua.
 *
 * Recuar apagaria a única coisa que a marca protege: uma chamada mais nova que
 * ela é novidade. Duas telas gravando marcas diferentes (a aba de Ligações usa
 * a chamada mais recente da lista inteira; o cartão usa a perdida mais recente
 * que ele mostra) precisam poder escrever na mesma chave sem que a menor
 * ressuscite avisos já vistos.
 */
export function markCallsSeen(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const novo = Date.parse(iso);
  if (!Number.isFinite(novo)) return false;
  const atual = readCallsSeenUntilMs();
  if (atual !== null && novo <= atual) return false;
  try { localStorage.setItem(SEEN_KEY, iso); } catch { /* aba privada: o aviso volta, e tudo bem */ }
  listeners.forEach(fn => fn());
  return true;
}

/**
 * Avisa quando a marca muda — nesta aba ou em outra.
 *
 * O `storage` do navegador só dispara nas OUTRAS abas; por isso `markCallsSeen`
 * chama os ouvintes na mão. Sem as duas metades, dispensar o cartão numa aba
 * deixaria o distintivo aceso na outra, olhando para a mesma ligação.
 */
export function subscribeCallsSeen(fn: () => void): () => void {
  listeners.add(fn);
  const doOutraAba = (event: StorageEvent) => { if (event.key === SEEN_KEY) fn(); };
  window.addEventListener('storage', doOutraAba);
  return () => {
    listeners.delete(fn);
    window.removeEventListener('storage', doOutraAba);
  };
}
