import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AMPARO_LEGAL_DO_SELO,
  ROTULOS_MONOESPACADOS,
  TEXTO_DO_SELO_DE_INTEGRIDADE,
  fichaDoSignatario,
  valorVazio,
} from './laudoSignatario.ts';

const base = { nome: 'Ana Souza', assinadoEm: '03/09/2026 09:02:41' };

test('a ficha vai de identidade a circunstância e termina no ato', () => {
  const rotulos = fichaDoSignatario(base).map(([r]) => r);
  assert.deepEqual(rotulos, [
    'Nome', 'Papel', 'Contato', 'CPF',
    'Endereço IP', 'Localização', 'Dispositivo',
    'Autenticação', 'Termos de Uso', 'Assinado em',
  ]);
});

test('"Assinar" não é papel — é rótulo de botão que vazou', () => {
  const papel = (v: string | null) =>
    fichaDoSignatario({ ...base, papel: v }).find(([r]) => r === 'Papel')?.[1];
  assert.equal(papel('Assinar'), 'Signatário');
  assert.equal(papel(null), 'Signatário');
  assert.equal(papel('Contratante'), 'Contratante');
});

test('campo sem valor vira travessão, não "null"', () => {
  const ficha = fichaDoSignatario(base);
  const cpf = ficha.find(([r]) => r === 'CPF')?.[1];
  assert.equal(cpf, '—');
});

test('sem autenticação declarada, a ficha diz "Assinatura direta"', () => {
  // Nunca um campo vazio: no laudo, espaço em branco onde deveria haver método
  // parece erro de geração, e quem lê não sabe se houve autenticação ou não.
  const a = fichaDoSignatario(base).find(([r]) => r === 'Autenticação')?.[1];
  assert.equal(a, 'Assinatura direta');
});

test('valorVazio reconhece os três jeitos de não ter dado', () => {
  assert.equal(valorVazio(''), true);
  assert.equal(valorVazio('   '), true);
  assert.equal(valorVazio('—'), true);
  assert.equal(valorVazio('-'), true);
  assert.equal(valorVazio(null), true);
  assert.equal(valorVazio(undefined), true);
  assert.equal(valorVazio('0'), false, 'zero é um valor');
  assert.equal(valorVazio('Ana'), false);
});

test('os campos conferidos caractere a caractere são monoespaçados', () => {
  // IP, CPF, coordenadas e data são LIDOS, não escaneados: em fonte
  // proporcional, 0 e O ficam quase iguais.
  for (const r of ['CPF', 'Endereço IP', 'Localização', 'Assinado em']) {
    assert.ok(ROTULOS_MONOESPACADOS.has(r), `${r} deveria ser monoespaçado`);
  }
  assert.ok(!ROTULOS_MONOESPACADOS.has('Nome'), 'nome é texto, não código');
  assert.ok(!ROTULOS_MONOESPACADOS.has('Autenticação'));
});

test('o selo de integridade é INSTRUÇÃO, não afirmação de que já foi selado', () => {
  // A selagem acontece segundos depois desta página ser desenhada, e é falha
  // macia. "Confira no leitor" é verdade nos dois casos; "está selado" não.
  const t = TEXTO_DO_SELO_DE_INTEGRIDADE;
  assert.ok(/Para conferir/.test(t), 'tem de instruir a conferência');
  assert.ok(!/est[eá] (arquivo )?(já )?selado/i.test(t), 'não pode afirmar que já está selado');
});

test('o selo cita o amparo legal e NÃO deprecia o próprio certificado', () => {
  // A frase "não é ICP-Brasil" saiu de propósito: num documento que circula ela
  // não informa — deprecia, e convida a parte contrária a tratar o que é válido
  // como se fosse de segunda.
  const t = TEXTO_DO_SELO_DE_INTEGRIDADE;
  assert.ok(t.includes('MP 2.200-2/2001'), 'o amparo legal tem de estar escrito');
  assert.ok(t.includes('STJ'));
  assert.ok(!/ICP[- ]?Brasil/i.test(t), 'não pode se comparar desfavoravelmente');
});

test('o amparo legal é CITAÇÃO literal do § 2º, não paráfrase', () => {
  // A força da citação está em ser o texto da lei, palavra por palavra: quem
  // recebe o documento confere contra o Planalto sem depender de nós. Reescrever
  // "com as próprias palavras" transformaria prova em opinião.
  const t = AMPARO_LEGAL_DO_SELO.texto;
  assert.ok(t.startsWith('O disposto nesta Medida Provisória não obsta'));
  assert.ok(t.includes('inclusive os que utilizem certificados não emitidos pela ICP-Brasil'));
  assert.ok(t.endsWith('aceito pela pessoa a quem for oposto o documento.'));
  assert.ok(/2\.200-2\/2001/.test(AMPARO_LEGAL_DO_SELO.fonte), 'a fonte tem de ser conferível');
  assert.ok(/Art\. 10/.test(AMPARO_LEGAL_DO_SELO.fonte));
});

test('"ICP-Brasil" só aparece na boca da lei, nunca na nossa', () => {
  // A divisão de trabalho entre os dois textos: o selo é NOSSA afirmação e não
  // se compara desfavoravelmente; a citação é a LEI e é justamente ela quem
  // pode dizer "certificados não emitidos pela ICP-Brasil" — ali a frase é
  // fundamento, não desculpa.
  assert.ok(!/ICP[- ]?Brasil/i.test(TEXTO_DO_SELO_DE_INTEGRIDADE));
  assert.ok(/ICP-Brasil/.test(AMPARO_LEGAL_DO_SELO.texto));
  // E a condição que a lei impõe tem de vir junto: sem ela a citação estaria
  // recortada a nosso favor.
  assert.ok(AMPARO_LEGAL_DO_SELO.texto.includes('desde que admitido pelas partes'));
});

test('a ficha aceita todos os campos preenchidos sem perder nenhum', () => {
  const ficha = fichaDoSignatario({
    nome: 'Ana', papel: 'Contratante', contato: 'ana@x.com', cpf: '000.000.000-00',
    ip: '200.1.2.3', localizacao: '-15,-56', dispositivo: 'iPhone - Safari',
    autenticacao: 'WhatsApp', termos: 'Aceitos · versão v1', assinadoEm: 'agora',
  });
  assert.equal(ficha.length, 10);
  assert.ok(ficha.every(([, v]) => v && v !== '—'), 'nenhum campo pode sair vazio');
});
