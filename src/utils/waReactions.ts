/**
 * Reações de mensagem do WhatsApp — a regra, sem tela e sem rede.
 *
 * No WhatsApp uma pessoa tem UMA reação por mensagem: reagir de novo troca a
 * anterior, e reagir com o mesmo emoji tira a reação. Toda a lógica disso mora
 * aqui, para a bolha só desenhar e o módulo só chamar.
 *
 * A MESMA regra existe do lado do servidor, em
 * `supabase/functions/_shared/wa-reactions.ts` — é ela que grava o que chega do
 * webhook. Cópia dupla de propósito (o Deno das Edge Functions não importa de
 * `src/`), e as duas têm teste vigiando o mesmo comportamento: mexeu em uma,
 * mexa na outra.
 *
 * Sem imports de propósito: módulo puro, para o ts-node do `npm test`.
 */

/** Uma reação de uma pessoa a uma mensagem. */
export interface WaReacao {
  emoji: string;
  /** 'in' = o contato reagiu; 'out' = alguém do escritório reagiu. */
  from: 'in' | 'out';
  /** Quem reagiu: o JID do contato, ou o id do usuário do CRM. */
  actor: string;
  /** Nome de quem reagiu, quando o CRM sabe (equipe). */
  name?: string | null;
  /** ISO. */
  at: string;
}

/** Uma "pastilha" na bolha: o emoji, quantos reagiram e se eu sou um deles. */
export interface ChipDeReacao {
  emoji: string;
  total: number;
  minha: boolean;
  /** Nomes/origens para o `title` da pastilha, na ordem em que reagiram. */
  quem: string[];
}

/**
 * Quem é o "escritório" numa reação.
 *
 * Do lado de cá o ator NÃO é a pessoa que clicou, e sim o número: o WhatsApp
 * guarda UMA reação por conta, então dois atendentes reagindo pelo mesmo canal
 * são uma reação só — a segunda troca a primeira, exatamente como aconteceria
 * no aparelho. O nome de quem clicou vai em `name`, para a pastilha saber dizer
 * quem foi. Gravar por usuário criaria pastilhas que existem só no CRM e que o
 * contato nunca veria.
 */
export const ACTOR_ESCRITORIO = 'office';

/**
 * Quem é o "contato" numa reação.
 *
 * Constante, e não o JID de quem mandou, porque o módulo só atende conversa de
 * DUAS pontas (o webhook descarta grupo) — do outro lado há uma pessoa só. E
 * porque o mesmo contato chega ora como `<numero>@s.whatsapp.net`, ora como
 * `<lid>@lid`: gravar o JID faria a mesma pessoa virar duas pastilhas conforme
 * a forma como o WhatsApp entregou o evento (ver `whatsapp-lid-nao-e-telefone`).
 */
export const ACTOR_CONTATO = 'contact';

/** Teto de reações guardadas por mensagem — grupo grande não vira linha infinita. */
export const MAX_REACOES = 50;

/**
 * Grava a reação de uma pessoa na lista: troca a que ela tinha, ou a remove
 * quando `emoji` vem vazio.
 *
 * NÃO alterna. A tentação de fazer "mesmo emoji de novo = desfaz" aqui dentro é
 * grande — é o que o dedo faz na tela —, mas esta função também recebe o que
 * chega do webhook, e ali a mesma reação pode chegar DUAS VEZES (reentrega da
 * Evolution). Com alternância, a segunda entrega apagaria a reação do contato
 * sem que ninguém tivesse tocado em nada. Gravar é gravar; desfazer é mandar
 * emoji vazio — exatamente como o WhatsApp faz no fio.
 *
 * Quem traduz o toque na pastilha para "vazio" é `proximaReacao`, abaixo.
 */
export function aplicarReacao(
  atuais: WaReacao[] | null | undefined,
  entrada: WaReacao,
): WaReacao[] {
  const lista = Array.isArray(atuais) ? atuais : [];
  const semAMinha = lista.filter(r => r.actor !== entrada.actor);
  if (!entrada.emoji) return semAMinha;
  return [...semAMinha, entrada].slice(-MAX_REACOES);
}

/**
 * O que enviar quando alguém clica num emoji: o próprio, ou vazio (remover) se
 * já era essa a reação da pessoa. É a alternância da tela, separada da gravação.
 */
export function proximaReacao(atual: string | null | undefined, clicado: string): string {
  return atual === clicado ? '' : clicado;
}

/** A reação que uma pessoa deu nesta mensagem, se deu alguma. */
export function reacaoDe(
  atuais: WaReacao[] | null | undefined,
  actor: string | null | undefined,
): string | null {
  if (!actor) return null;
  return (atuais || []).find(r => r.actor === actor)?.emoji ?? null;
}

/**
 * Agrupa por emoji, na ordem da PRIMEIRA reação de cada um — a mesma do
 * aplicativo, onde a pastilha não pula de lugar quando outra pessoa reage.
 */
export function agruparReacoes(
  atuais: WaReacao[] | null | undefined,
  meuActor?: string | null,
): ChipDeReacao[] {
  const chips: ChipDeReacao[] = [];
  const porEmoji = new Map<string, ChipDeReacao>();
  for (const r of atuais || []) {
    if (!r?.emoji) continue;
    let chip = porEmoji.get(r.emoji);
    if (!chip) {
      chip = { emoji: r.emoji, total: 0, minha: false, quem: [] };
      porEmoji.set(r.emoji, chip);
      chips.push(chip);
    }
    chip.total += 1;
    if (meuActor && r.actor === meuActor) chip.minha = true;
    chip.quem.push(r.name || (r.from === 'out' ? 'Equipe' : 'Contato'));
  }
  return chips;
}
