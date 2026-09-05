/**
 * Confere as chaves de licença do Syncfusion do `.env` local.
 *
 * Existe porque a falha desta configuração é MUDA: o EJ2 ignora chave que não
 * decodifica e desenha o aviso de avaliação por cima da página — que num PDF
 * assinado é documento estragado. Aqui a chave é decodificada com o mesmo
 * algoritmo da biblioteca e o script diz o que ela licencia.
 *
 * NÃO IMPRIME A CHAVE: só plataforma, versão e validade.
 *
 * Uso: npx ts-node --esm scripts/conferir-licenca-syncfusion.mts [.env]
 */
import { readFileSync } from 'node:fs';

import { VARIAVEIS_DE_LICENCA, lerChaves } from '../src/utils/syncfusionRuntime.ts';

/** A tabela de XOR do `getInfoFromKey` do `@syncfusion/ej2-base`. */
const PKEY = [5439488, 7929856, 5111808, 6488064, 4587520, 7667712, 5439488,
  6881280, 5177344, 7208960, 4194304, 4456448, 6619136, 7733248, 5242880, 7077888,
  6356992, 7602176, 4587520, 7274496, 7471104, 7143424];

function claro(chave: string): string | null {
  let bruto: string;
  try { bruto = Buffer.from(chave, 'base64').toString('binary'); } catch { return null; }
  let saida = '';
  for (let i = 0, k = 0; i < bruto.length; i++, k++) {
    if (k === PKEY.length) k = 0;
    saida += String.fromCharCode(bruto.charCodeAt(i) ^ (PKEY[k] >> 16));
  }
  return saida;
}

const caminho = process.argv[2] ?? '.env';
const linhas = readFileSync(caminho, 'utf8').split('\n');
const valorDe = (nome: string): string => {
  const linha = linhas.find((l) => l.startsWith(`${nome}=`));
  return linha ? linha.slice(nome.length + 1) : '';
};

const { chaves, descartadas } = lerChaves(
  VARIAVEIS_DE_LICENCA.map((variavel) => ({ variavel, valor: valorDe(variavel) })),
);

for (const variavel of descartadas) {
  console.log(`✖ ${variavel}: valor ilegível — não é base64 (sobrou o nome da variável colado nele?)`);
}
if (chaves.length === 0) {
  console.log('✖ nenhuma chave utilizável. O conversor vai cair no motor de reserva.');
  process.exit(1);
}

for (const chave of chaves) {
  const campos = (claro(chave) ?? '').split(';');
  const legivel = campos.length > 3;
  console.log(`${legivel ? '✔' : '✖'} ${chave.slice(0, 10)}… (${chave.length} chars)`);
  if (legivel) {
    console.log(`    plataforma: ${campos[0]}`);
    console.log(`    versão:     ${campos[1]}`);
    console.log(`    validade:   ${campos[2]}`);
  } else {
    console.log('    não decodifica — o EJ2 vai IGNORAR esta chave, calado');
  }
}
