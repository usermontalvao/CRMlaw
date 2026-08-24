/**
 * Claro, escuro ou o que o sistema mandar.
 *
 * O padrão é `sistema`: a folha segue `prefers-color-scheme` e ninguém precisa
 * escolher nada. Quem quer decidir escolhe, e a escolha vira um atributo em
 * `<html>` que vence a consulta de mídia.
 *
 * POR QUE ESTE VALOR NÃO PASSA PELO SERVICE WORKER, como todo o resto do popup:
 * ler por mensagem pode precisar ACORDAR o worker, e acordar leva tempo
 * suficiente para a tela piscar no tema errado antes de assentar no certo.
 * Aqui não há segredo nenhum em jogo — é uma preferência de aparência —, então
 * ela é lida direto do armazenamento local, que responde na hora.
 */

const CHAVE = 'vault.tema';
const VALIDOS = new Set(['sistema', 'claro', 'escuro']);

export async function lerTema() {
  try {
    const guardado = await chrome.storage.local.get(CHAVE);
    const valor = guardado[CHAVE];
    return VALIDOS.has(valor) ? valor : 'sistema';
  } catch (_) {
    return 'sistema';
  }
}

export async function salvarTema(tema) {
  const escolhido = VALIDOS.has(tema) ? tema : 'sistema';
  aplicarTema(escolhido);
  await chrome.storage.local.set({ [CHAVE]: escolhido });
  return escolhido;
}

/** `sistema` remove o atributo — sem atributo, quem manda é a consulta de mídia. */
export function aplicarTema(tema) {
  if (tema === 'sistema') document.documentElement.removeAttribute('data-tema');
  else document.documentElement.setAttribute('data-tema', tema);
}

/** Aplica o que estiver guardado, o mais cedo possível na vida da página. */
export async function aplicarTemaGuardado() {
  const tema = await lerTema();
  aplicarTema(tema);
  return tema;
}
