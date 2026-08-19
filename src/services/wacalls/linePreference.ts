// A LINHA PREFERIDA — a estrela ao lado do canal no discador.
//
// Guardada no navegador, e não no banco, de propósito: "por qual número eu
// gosto de ligar" é preferência de mesa, como o microfone escolhido e a posição
// da janela da chamada, e muda com quem senta ali. Levar isso ao servidor
// criaria uma configuração por usuário para uma escolha que se refaz em dois
// cliques — e que precisa valer antes de qualquer consulta, no primeiro quadro
// em que o discador abre.
//
// O QUE SE GUARDA É A CHAVE DA LINHA, que é o id do CANAL quando existe um.
// Guardar o id da sessão de voz seria pior: ele é fixo hoje ('default') e muda
// se a conta for repareada, então a preferência migraria sozinha para outro
// número sem ninguém pedir.
const KEY = 'wa:dialerPreferredLine';

export function readPreferredLine(): string | null {
  try {
    return localStorage.getItem(KEY) || null;
  } catch {
    // Navegador com storage bloqueado: sem preferência, e nada quebra.
    return null;
  }
}

/** Marca (ou desmarca, com `null`) a linha preferida. */
export function writePreferredLine(key: string | null): void {
  try {
    if (key) localStorage.setItem(KEY, key);
    else localStorage.removeItem(KEY);
  } catch {
    // Idem: a escolha vale só nesta sessão, o que ainda é melhor do que erro.
  }
}
