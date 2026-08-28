/**
 * Quebra da resposta do agente em mensagens separadas de WhatsApp.
 *
 * Uma pessoa não manda saudação, contexto e pergunta num parágrafo só: manda a
 * saudação, e logo depois a pergunta. O modelo já escreve nesse formato — o que
 * faltava era entregar cada bloco como uma mensagem, em vez de colar tudo numa
 * bolha só.
 *
 * A quebra é do TEXTO, nunca do sentido: listas continuam grudadas na frase que
 * as introduz, porque "mande os documentos:" sozinho não quer dizer nada. E o
 * total é limitado, senão um agente prolixo vira uma rajada de notificações.
 *
 * Arquivo puro de propósito: sem imports, para poder ser espelhado byte a byte
 * em supabase/functions/_shared/wa-ai-reply-parts.ts e rodar dentro da Edge
 * Function. Se mudar aqui, copie o arquivo inteiro para lá.
 */

/** Mais que isto vira rajada de notificação no celular do cliente. */
export const WA_AI_MAX_REPLY_PARTS = 3;

/**
 * Pausa entre uma mensagem e a seguinte.
 *
 * Não é anti-colisão: é ritmo de gente. Duas bolhas no mesmo segundo são
 * lidas como uma só — a pessoa responde a primeira coisa que leu e a pergunta
 * se perde. Um instante entre elas faz a segunda chegar quando a primeira já
 * foi lida, que é o que acontece numa conversa de verdade.
 *
 * OS NÚMEROS FORAM CORTADOS EM 12/08/2026, e o motivo é do outro lado: somando
 * o agrupamento das mensagens do cliente, a chamada ao modelo e três blocos de
 * até cinco segundos cada, a resposta demorava perto de meio minuto para
 * aparecer. Quem espera não vê "ritmo de gente", vê atendimento lento. O balão
 * de "digitando..." continua inteiro — o que encolheu foi o relógio.
 */
export const WA_AI_PART_PAUSE_MIN_MS = 600;
export const WA_AI_PART_PAUSE_MAX_MS = 2200;

/** Item de lista: `- item`, `1. item`, `2) item`, `• item`. */
const LIST_ITEM = /^(?:[-*•·–—]|\d{1,2}[.)]|[a-z][.)])\s+/i;

/** Fim de frase, tolerando fecho de aspas/parênteses e emoji depois do ponto. */
const SENTENCE_END = /[.!?…][)\]"'”’»]*[\s\p{Extended_Pictographic}️‍]*$/u;

/** Pelo menos uma letra ou dígito — um bloco só de emoji não vira mensagem sozinho. */
const HAS_WORD = /[\p{L}\p{N}]/u;

/**
 * Divide a resposta nas mensagens que serão enviadas, na ordem.
 *
 * Quebra em linha em branco e também na troca de linha entre frases fechadas —
 * é assim que o modelo separa "Olá, tudo bem?" de "Qual é o seu nome?". NÃO
 * quebra antes de item de lista nem depois de linha terminada em dois-pontos.
 *
 * Devolve `[]` para texto vazio, e sempre um array de blocos já aparados.
 */
export function splitWaAiReply(text: string): string[] {
  const normalizado = String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(linha => linha.replace(/[ \t]+$/g, ''))
    .join('\n')
    .trim();
  if (!normalizado) return [];

  const blocos: string[] = [];
  let atual: string[] = [];
  const fechar = () => {
    const bloco = atual.join('\n').trim();
    if (bloco) blocos.push(bloco);
    atual = [];
  };

  for (const linha of normalizado.split('\n')) {
    const conteudo = linha.trim();
    if (!conteudo) { fechar(); continue; }
    const anterior = atual.length > 0 ? atual[atual.length - 1].trim() : '';
    if (anterior
      && SENTENCE_END.test(anterior)
      && !anterior.endsWith(':')
      && !LIST_ITEM.test(conteudo)
      && !LIST_ITEM.test(anterior)) fechar();
    atual.push(linha);
  }
  fechar();

  // Blocos sem palavra nenhuma ("🙂", "—") voltam a colar no vizinho: mensagem
  // solta de um emoji só não é conversa natural, é ruído.
  const juntados: string[] = [];
  for (const bloco of blocos) {
    if (!HAS_WORD.test(bloco) && juntados.length > 0) {
      juntados[juntados.length - 1] = `${juntados[juntados.length - 1]}\n${bloco}`;
      continue;
    }
    juntados.push(bloco);
  }

  // Segunda passada: a pergunta final sai do bloco e vira mensagem própria.
  const separados: string[] = [];
  for (const bloco of juntados) separados.push(...separarPerguntaFinal(bloco));

  if (separados.length <= WA_AI_MAX_REPLY_PARTS) return separados;
  const cabeca = separados.slice(0, WA_AI_MAX_REPLY_PARTS - 1);
  const resto = separados.slice(WA_AI_MAX_REPLY_PARTS - 1).join('\n\n');
  return [...cabeca, resto];
}

/** Abreviações comuns: o ponto delas não termina frase. */
const ABREVIACAO = /(?:^|\s)(?:sr|sra|srta|dr|dra|prof|profa|art|arts|av|ex|etc|jr|obs|pag|pág|fls|nº|no|min|seg|kg|km|\p{L})\.$/iu;

/**
 * Frases de um parágrafo, tolerando abreviação e número com ponto.
 *
 * Varredura manual em vez de `split` com lookbehind: lookbehind quebra o parse
 * do bundle inteiro em Safari antigo, e este módulo também roda no navegador.
 */
function dividirFrases(texto: string): string[] {
  const out: string[] = [];
  let atual = '';
  for (let i = 0; i < texto.length; i++) {
    atual += texto[i];
    if ('.!?…'.indexOf(texto[i]) === -1) continue;

    // Fechamentos de aspas e parênteses pertencem à frase que termina.
    let j = i + 1;
    while (j < texto.length && ')]"\'”’»'.indexOf(texto[j]) !== -1) { atual += texto[j]; j++; }

    // Sem espaço depois, é decimal ("1.800") ou domínio — não é fim de frase.
    if (j >= texto.length || !/\s/.test(texto[j])) { i = j - 1; continue; }
    if (ABREVIACAO.test(atual)) { i = j - 1; continue; }

    out.push(atual.trim());
    atual = '';
    i = j - 1;
    while (i + 1 < texto.length && /\s/.test(texto[i + 1])) i++;
  }
  if (atual.trim()) out.push(atual.trim());
  return out;
}

/** Tamanho mínimo da pergunta para valer uma mensagem só dela. */
const PERGUNTA_MIN_CHARS = 8;

/**
 * "Obrigado, Pedro. Você teve outro trabalho sem carteira?" vira DUAS mensagens.
 *
 * Ninguém escreve confirmação e pergunta na mesma bolha: quem lê responde a
 * primeira coisa que viu e a pergunta fica sem resposta — foi exatamente o que
 * aconteceu na triagem de 12/08/2026. A pergunta é sempre a última frase, então
 * é ela que se separa.
 *
 * Não mexe em lista (o item perderia a frase que o introduz), em bloco de mais
 * de uma linha (a primeira passada já cuidou disso) nem em pergunta curta
 * demais para valer uma notificação sozinha.
 */
function separarPerguntaFinal(bloco: string): string[] {
  if (bloco.indexOf('\n') !== -1) return [bloco];
  if (LIST_ITEM.test(bloco)) return [bloco];

  const frases = dividirFrases(bloco);
  if (frases.length < 2) return [bloco];

  const pergunta = frases[frases.length - 1];
  if (!pergunta.endsWith('?')) return [bloco];
  if (pergunta.length < PERGUNTA_MIN_CHARS) return [bloco];

  const cabeca = frases.slice(0, -1).join(' ').trim();
  if (!HAS_WORD.test(cabeca) || !HAS_WORD.test(pergunta)) return [bloco];

  return [cabeca, pergunta];
}

/**
 * Quanto esperar ANTES de mandar esta parte — e, agora, por quanto tempo mostrar
 * "digitando..." no aparelho do contato durante essa espera.
 *
 * Proporcional ao tamanho, porque é literalmente o tempo de digitar: 15 ms por
 * caractere, algo como 65 caracteres por segundo — rápido, mas ainda humano.
 * Limitada nos dois extremos: rápido demais chega tudo junto, devagar demais
 * faz o cliente olhar para a tela esperando.
 *
 * Vale para TODAS as partes, inclusive a primeira. Enquanto a pausa era só
 * anti-atropelo, pular a primeira fazia sentido; virando balão de digitação,
 * pular a primeira é justamente a mensagem que aparece pronta, do nada.
 */
export function waAiPartPauseMs(part: string): number {
  const chars = String(part ?? '').trim().length;
  const ms = WA_AI_PART_PAUSE_MIN_MS + Math.round(chars * 15);
  return Math.max(WA_AI_PART_PAUSE_MIN_MS, Math.min(WA_AI_PART_PAUSE_MAX_MS, ms));
}

/**
 * Uma pergunta curta é fórmula de cortesia — "Tudo bem?", "Certo?" —, não a
 * pergunta da rodada. Sem este piso, a saudação padrão perderia o "qual é o seu
 * nome?", porque o "Tudo bem?" teria gasto a cota.
 */
const MIN_PALAVRAS_PERGUNTA = 4;

function ehPerguntaDeVerdade(frase: string): boolean {
  const limpa = frase.trim();
  if (!/[?][)\]"'”’»]*$/.test(limpa)) return false;
  return (limpa.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length >= MIN_PALAVRAS_PERGUNTA;
}

/**
 * Deixa passar UMA pergunta por rodada, cortando as seguintes.
 *
 * Existe porque a regra escrita no prompt não segurou. Três vezes o modelo
 * emendou duas perguntas antes de esperar qualquer resposta — inclusive dentro
 * do mesmo parágrafo, onde nem a quebra em blocos ajuda. Uma pergunta por vez é
 * a diferença entre uma conversa e um formulário, então vira garantia do
 * backend, não pedido.
 *
 * Corta só a PERGUNTA. O que vem depois dela sem ser pergunta continua — é o que
 * preserva "Você tem alguma prova? Pode ser Pix, conversa de WhatsApp ou foto",
 * onde a segunda frase são os exemplos, não outra pergunta. Itens de lista
 * passam inteiros pelo mesmo motivo.
 *
 * O que é cortado não se perde: continua nas pendências da memória, e sai na
 * rodada seguinte — que é exatamente onde deveria ter saído.
 */
export function waAiKeepOneQuestion(text: string): string {
  const linhas = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  let jaPerguntou = false;
  const saida: string[] = [];

  for (const linha of linhas) {
    const original = linha.trim();
    if (!original || LIST_ITEM.test(original)) {
      saida.push(linha);
      continue;
    }
    const mantidas: string[] = [];
    for (const frase of linha.split(/(?<=[.!?…])\s+/)) {
      if (!ehPerguntaDeVerdade(frase)) { mantidas.push(frase); continue; }
      if (jaPerguntou) continue;
      jaPerguntou = true;
      mantidas.push(frase);
    }
    const resultado = mantidas.join(' ').trim();
    // Linha que existia e virou vazia sai de vez: deixá-la em branco criaria um
    // separador de bloco e a resposta sairia com uma bolha fantasma.
    if (resultado) saida.push(resultado);
  }

  return saida.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Forma comparável da pergunta, sem fazer acento ou pontuação parecer mudança. */
function perguntaComparavel(text: string): string {
  const perguntas = String(text ?? '').match(/[^?]*\?/g) || [];
  const ultima = perguntas.length > 0 ? perguntas[perguntas.length - 1] : '';
  return ultima.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Uma pergunta necessária pode continuar pendente, mas nunca deve reaparecer
 * como se o cliente não tivesse escrito nada.
 *
 * Quando o fallback determinístico produz exatamente a última pergunta
 * enviada, acrescentamos a razão humana da repetição. A pergunta permanece uma
 * só e o fluxo não avança sem dado; o que some é o efeito de robô travado.
 */
export function waAiContextualizeRepeatedQuestion(text: string, previousAssistantText: string): string {
  const atual = String(text ?? '').trim();
  const anterior = String(previousAssistantText ?? '').trim();
  const perguntaAtual = perguntaComparavel(atual);
  const perguntaAnterior = perguntaComparavel(anterior);
  if (!perguntaAtual || perguntaAtual !== perguntaAnterior) return atual;
  if (/não consegui (?:entender|encaixar|ligar)|só para confirmar/i.test(atual)) return atual;
  return `Não consegui ligar sua resposta a essa parte.\n\n${atual}`;
}
