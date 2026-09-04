# Montagem do PDF assinado no servidor

> Documento de trabalho. É o mapa da migração e o diário de bordo dela: se a
> sessão acabar no meio, quem retomar lê **"Onde parei"** no fim e continua sem
> reconstruir nada.

## O problema, em uma frase

Hoje o PDF assinado é **montado no aparelho de quem assina**. O navegador
desenha o documento, calcula o SHA-256, cria o código de verificação e manda
tudo pronto para o servidor — que grava e depois "confere" o hash contra o
valor que o próprio navegador enviou.

O servidor prova que *o arquivo recebido não mudou*. Ele não prova que o
arquivo **é** o documento original acrescido das assinaturas. E a `pades-sign`,
que sela o PDF com a nossa chave, acaba assinando criptograficamente um
conteúdo que nós não construímos.

## O destino

A montagem passa a acontecer em `supabase/functions/` — que é servidor, mas
**não é máquina**: é pasta deste repositório, sobe junto com o resto, sem
processo de pé e sem custo fixo. O front continua estático (Render/Netlify
publicam `dist/`), e **não há Node em lugar nenhum do projeto** — nem vai
haver.

O navegador perde a capacidade de produzir o artefato jurídico.

## Fatos medidos (não repetir a pesquisa)

| Fato | Consequência | Quando |
|---|---|---|
| 241 dos 291 envelopes (83%) nascem de **DOCX**; o modelo `per_document` é 100% DOCX | portar só o caminho PDF cobriria 17% do uso | 03/09/2026 |
| `pdf-lib` **já roda no Deno** neste projeto: `npm:pdf-lib@1.17.1` na `pades-sign`, em produção | a montagem em PDF é portável; não é o obstáculo | — |
| `docs.jurius-api.com` **não converte para PDF** — o `Export` aceita o pedido e devolve `application/msword`, porque não tem `DocIORenderer` | não dá para mandar o DOCX ao servidor e pedir o PDF | 30/07/2026 |
| Nenhum runtime de JavaScript (Node ou Deno) abre `.docx` e desenha a página | a conversão Word→PDF **tem** de continuar no navegador | — |
| `html2canvas` só aparece no caminho DOCX (`pdfSignature.service.ts:2819` e `:3307`) | congelado o original em PDF, o resto da montagem não toca no DOM | — |

Daí o desenho em duas etapas: **primeiro o original vira PDF e congela**,
depois a montagem inteira sai do navegador.

## Etapa 1 — congelar o original

Na **criação** do envelope (navegador de quem cria, autenticado, uma vez só):

1. arquivo `.docx` → `docxToPdf()` (pipeline único que o Cloud, os Documentos e
   o Nextcloud já usam) → o **PDF** é o que vira `document_path`;
2. o `.docx` de origem fica registrado, para proveniência;
3. o **servidor** relê cada arquivo congelado do Storage e calcula o SHA-256
   dele — o `document_hash` deixa de vir do navegador.

O que isso compra:

- a montagem passa a ser **sempre PDF→PDF**, e portanto portável;
- quem assina vê exatamente o arquivo congelado;
- o hash da origem passa a ser autoridade do servidor;
- a confiança sai do navegador **de quem assina** (adversário no modelo de
  ameaça) e vai para o de **quem cria** (autenticado, e o resultado é conferido
  pelo servidor logo em seguida).

## Etapa 2 — a montagem sai do navegador

Função nova, chamada pelo job que já existe (`signature_finalization_jobs`, com
trava, retry e estágios):

1. lê o PDF congelado do Storage;
2. monta com `npm:pdf-lib` — o código de desenho de hoje, portado;
3. grava o artefato e o SHA-256 que **ela mesma** calculou;
4. **primeiro olha o ponteiro**: se o artefato já existe, devolve o que existe.

### Uma vez só é requisito, não detalhe

O documento assinado nasce **uma vez**. Clicar de novo devolve o mesmo arquivo,
nunca gera um segundo.

As travas que já existem: `public-signing-upload` devolve 409 quando o ponteiro
já foi gravado, e o bucket `assinados` é `upsert:false`.

**A que falta:** [`SignatureModule.tsx:3434`](../src/components/SignatureModule.tsx)
— ao **baixar**, se o PDF assinado não é encontrado, o código gera um documento
novo, grava no bucket e regrava o `signed_pdf_sha256` com hash calculado no
navegador. Uma ação de ler produzindo artefato jurídico novo. Isso morre na
etapa 2: baixar vira somente-leitura, e regerar (se for mesmo preciso) vira
ação explícita, do servidor, registrada na trilha.

### O que some no fim

- `pdfSignatureService.saveSignedPdfToStorage` do lado do cliente;
- a Edge Function `public-signing-upload` inteira — ela só existe para receber
  o PDF que o navegador montava.

## Portes pendentes do `pdfSignature.service.ts` (etapa 2)

O arquivo tem 3.857 linhas; o que é de navegador é pouco e tem troca direta:

| Hoje | No servidor | Estado |
|---|---|---|
| quebra de linha do texto | já usa `font.widthOfTextAtSize()` do pdf-lib | **não precisava porte** |
| `QRCode.toCanvas` (`:712`) | matriz do QR desenhada como retângulos | **pronto** — `_shared/montagem/qr-em-retangulos.ts` |
| remoção de fundo branco (`:507`) | mesma conta de pixel, sem DOM | **pronto** — `_shared/montagem/fundo-branco.ts` |
| wordmark "jurius.com.br" (`:565`) | ver abaixo | pendente |
| `window.location.origin` | parâmetro/env da função | trivial |
| `html2canvas` (`:2819`, `:3307`) | **desaparece** com a etapa 1 | — |

Duas descobertas ao portar:

- **A quebra de linha já era portável.** O `wrapText` do laudo usa as métricas do
  pdf-lib, não o canvas. Um item a menos do que a lista original dizia.
- **O QR ficou melhor de graça.** Desenhado como retângulos ele é vetorial —
  nítido em qualquer zoom e mais leve que o PNG de 512 px de hoje. A emenda de
  módulos vizinhos derruba 672 operações de desenho para 362, e o resultado foi
  conferido pixel a pixel contra o PNG da própria biblioteca: zero divergência,
  orientação inclusive (QR espelhado continua *parecendo* um QR e não abre nada).

### O wordmark — RESOLVIDO em 04/09/2026

Era a última peça de navegador. Foi pela **opção 1** (pré-renderizar o mesmo
canvas de hoje), e a fidelidade foi medida, não assumida:

1. `wordmark-lab.html` roda o MESMO código do cliente, no Chrome, com a Spectral
   de verdade. A prova de que a fonte carregou e não caiu no serif de reserva:
   `document.fonts.check("700 128px Spectral")` verdadeiro **e** a largura de
   "jurius" em 346,24 px contra 395 px do Georgia — larguras iguais teriam
   denunciado fallback silencioso;
2. o mesmo desenho foi refeito em Node com `@napi-rs/canvas` e a Spectral do
   Google Fonts;
3. os dois foram comparados por **assinatura de pixels** (perfil de tinta por
   coluna, 40 baldes, normalizado), em vez de transportar 27 KB de base64:

| | |
|---|---|
| dimensões | 794×149 nos dois |
| ratio | 5.328859060402684 nos dois (15 casas) |
| desvio do perfil | máximo **0,27%** da tinta, médio 0,068% |
| tinta total | Node 6,8% menor |

Os 6,8% são antialiasing do rasterizador, não posição de glifo — o perfil
normalizado é justamente o que separa uma coisa da outra.

Vive em `supabase/functions/_shared/montagem/wordmark.ts` (PNG de 16.452 bytes),
com 6 testes que pegam truncamento, imagem trocada, ratio alterado e buffer
compartilhado entre montagens simultâneas.

A opção 2 (embutir a Spectral e usar `embedFont`, ficando vetorial) continua
valendo como melhoria futura — mas aí a bancada vai acusar diferença, com razão,
e o antes/depois precisa de aprovação no olho.

### Um defeito achado no caminho

O recorte de fundo branco pode apagar a assinatura INTEIRA — assinatura clara
demais, ou imagem que já veio quase branca. Hoje nada olha o resultado: apagar
100% dos pixels não lança erro, e o documento sai assinado com um retângulo
vazio no lugar da assinatura. O módulo portado devolve quanto apagou, e
`recorteApagouDemais()` responde a pergunta que ninguém fazia. Quem chamar deve
preferir a imagem original nesse caso: fundo branco indesejado é feio;
assinatura ausente é um documento sem assinatura.

## O marcador `[[ASSINATURA]]` mudou de momento (04/09/2026)

**O problema que isto resolve.** O marcador era procurado na hora de ASSINAR,
sobre o Word renderizado pelo `docx-preview` no aparelho de quem assina. Com o
congelamento, o original vira PDF na CRIAÇÃO — e aí o marcador já foi impresso
na folha. A âncora se perdia duas vezes: o texto `[[ASSINATURA]]` aparecia no
documento assinado, e a rubrica caía no rodapé por fallback.

A detecção passou para a conversão. Três peças:

| Onde | O que faz |
|---|---|
| `src/utils/marcadoresDeAssinatura.ts` | a regra **pura**: achar marcadores num texto, converter retângulo em porcentagem, montar a máscara. 15 testes |
| `src/utils/docxToPdf.ts` | `detectarMarcadores?: boolean` (desligado por padrão). Ligado, mede com `Range` e **oculta** o marcador antes do `html2canvas`; devolve `marcadores` no resultado |
| `congelamentoDeOriginal.service.ts` → `SignatureModule` | leva os marcadores até o envelope e grava como `signature_fields` |

Decisões que valem lembrar:

- **ocultar acontece antes do `html2canvas` E antes da camada de texto.** Se
  saísse só da imagem, o PDF continuaria com `[[ASSINATURA]]` localizável pelo
  Ctrl+F — conteúdo que ninguém escreveu, num documento que vale como prova;
- **a máscara é espaço inquebrável do mesmo comprimento.** Apagar refluiria o
  parágrafo, e o PDF congelado deixaria de bater com o Word do autor;
- **duas passadas** (medir tudo, depois mascarar). Medir e mascarar juntos
  funciona hoje porque a máscara preserva o comprimento; separar impede que
  trocar a máscara um dia quebre a medição em silêncio;
- **piso de 8% × 4%** no tamanho do campo. Um run partido pode medir largura
  quase zero, e assinatura invisível parece documento NÃO assinado — pior que
  assinatura fora de lugar;
- **falha macia**: erro na detecção não derruba a conversão, que é o que o
  usuário pediu. Sem marcador, cai no caminho de antes;
- **só no motor `preview`.** O Syncfusion não tem DOM para medir, e devolve
  lista vazia. O congelamento já pede `preview` pela armadilha da geometria.

**A regra antiduplicação se resolveu sozinha.** Campo vindo de marcador é
gravado com UUID real, então na assinatura o `hasManualFieldForDoc` o trata como
campo manual e pula a detecção por placeholder. A precedência "campo marcado a
mão vence o marcador" continua valendo, sem código novo.

**O que ainda não foi provado:** nenhum envelope real passou por este caminho.
O teste de verdade é criar um envelope a partir de um `.docx` com
`[[ASSINATURA]]`, conferir que o PDF congelado NÃO mostra o texto do marcador, e
que a rubrica sai no lugar dele — e não no rodapé.

## A armadilha da geometria (decisão tomada, não esquecida)

Os campos de assinatura são marcados na tela **sobre o Word renderizado pelo
`docx-preview`**, e ficam guardados como página + porcentagem. O PDF assinado de
hoje nasce desse mesmo desenho — página e geometria batem por construção.

O `docxToPdf` prefere o motor **Syncfusion**, que é melhor de fidelidade e
pagina por conta própria. Uma quebra de página em lugar diferente move o campo
da página 3 para a 4: **a assinatura sai no lugar errado de um documento
jurídico**, e o defeito só aparece depois de assinado.

Por isso o congelamento roda com `engine: 'preview'` — o mesmo renderizador da
tela de posicionamento. A camada de texto invisível (PDF pesquisável) sai igual
nos dois motores, então não se perde busca; perde-se só fidelidade de layout.

**Como destravar o Syncfusion:** mover a conversão do momento do *envio* para o
momento da **seleção** do documento. Aí o wizard mostra o PDF final, os campos
são marcados sobre ele, e a paginação do conversor deixa de ser um risco —
passa a ser a verdade. Fica como o próximo passo natural da etapa 1.

## Estado

- [x] **Etapa 1 — escrita e verificada localmente** (typecheck limpo, 2.421
      testes, build de produção passando)
  - [x] `src/utils/congelamentoDoOriginal.ts` — as regras puras (+ 15 testes)
  - [x] migration `20260903210000_congelar_original_da_assinatura.sql`
  - [x] Edge Function `signature-freeze-source` (hash apurado no servidor)
  - [x] `src/services/congelamentoDeOriginal.service.ts` — converte e envia
  - [x] `SignatureModule.handleSubmit` congela antes de criar o envelope
  - [x] migration `20260903210500_hash_do_original_vem_do_servidor.sql` — o
        `document_hash` passa a sair do congelamento
  - [x] **migrations aplicadas em produção em 03/09/2026** (as duas, conferidas)
  - [x] **Edge Function `signature-freeze-source` NO AR** (04/09/2026, versão 1,
        `verify_jwt: true`; conferida: 401 sem JWT e 401 do porteiro interno com
        anon key — nenhum 503, então o deploy não saiu parcial)
  - [ ] conversão no momento da SELEÇÃO (destrava o Syncfusion — ver acima)
- [ ] **Etapa 2**
  - [x] **uma vez só**: ler nunca mais refaz o artefato (baixar, abrir e ZIP),
        com teste que vigia a regra em `artefatoAssinadoUmaVezSo.test.ts`
  - [x] **bancada de comparação** — `npm run montagem:comparar`, a página
        `/montagem-lab.html`, e o núcleo puro em `src/utils/comparacaoDePdf.ts`
  - [x] peças portadas: QR vetorial e recorte de fundo branco
  - [x] **wordmark pré-renderizado** (04/09/2026) —
        `_shared/montagem/wordmark.ts`, PNG de 16.452 bytes + 6 testes
  - [ ] Edge Function `montar-documento-assinado`
  - [ ] remoção da montagem do cliente e da `public-signing-upload`

### O porte da montagem — o que já saiu do navegador (04/09/2026)

A descoberta que destravou o porte: **os módulos de desenho são pdf-lib puro**,
e o `node_modules` tem pdf-lib **1.17.1**, a MESMA versão que a Edge Function usa
(`npm:pdf-lib@1.17.1`). Então dá para exercitar o código portado localmente, com
a biblioteca de produção, e OLHAR o resultado — em vez de escrever às cegas e
descobrir em produção, num documento que vale como prova.

Isso virou `npm run montagem:servidor` (`scripts/montar-no-servidor.mts`).

| Módulo | O que é | Testes |
|---|---|---|
| `geometria.ts` | onde cada coisa é desenhada: inversão do eixo Y, encaixe na página, qual página do PDF montado, posição de reserva, faixa do rodapé | 16 |
| `colocacaoDeAssinatura.ts` | **qual assinatura vai em qual campo** | 12 |
| `rodape.ts` | a faixa de rodapé e o carimbo lateral, portados linha a linha | 11 |
| `laudoDesign.ts` | paleta, primitivas de forma e quebra de linha | 18 |
| `provasDeAutenticacao.ts` | **o que o laudo AFIRMA** sobre cada assinatura | 8 |
| `laudoCabecalho.ts` | o papel timbrado e o rótulo de seção | — |
| `laudoCapa.ts` | a capa: selo de validação + um cartão por signatário | 8 |
| `laudoSignatario.ts` | biometria, ficha e bloco de certificado | 9 |
| `linhaDoTempo.ts` | **a ORDEM dos eventos** da trilha | 14 |
| `laudoTrilha.ts` | o desenho da trilha, com paginação própria | 7 |
| `wordmark.ts`, `qr-em-retangulos.ts`, `fundo-branco.ts` | já estavam prontos | — |

#### O teste que mais importa deste porte

Em `colocacaoDeAssinatura.ts`, o degrau do meio:

1. o dono do campo já assinou → usa a imagem dele;
2. **o dono existe mas AINDA NÃO assinou → não desenha NADA**;
3. o dono não existe (ou não há dono) → imagem de reserva.

Sem o passo 2, num envelope de dois signatários o primeiro a assinar assinaria
pelos dois: o campo do segundo cairia na reserva e receberia a imagem do
primeiro. O documento sairia bonito, assinado, atribuindo a manifestação de
vontade de uma pessoa a outra.

#### Conferido no olho, não só em teste

O rodapé foi desenhado sobre o kit real e comparado com a referência do
navegador (`kit-page-1.png`). Bateram: wordmark em Spectral, "ASSINATURA
ELETRÔNICA" com tracking, código monoespaçado, protocolo, SHA-256 rotulado,
"VALIDAÇÃO DIGITAL", o fio laranja no topo da faixa e os carimbos girados nas
**duas** margens. Estrutura: 2 páginas preservadas, altura +84, origem -84,
conteúdo sem deslocar.

O QR passou a ser desenhado em **retângulos vetoriais** dentro do rodapé (era
imagem). Some a última dependência de canvas dessa peça, e o `QRCode.create()`
que alimenta a matriz é puro — roda igual no Deno.

#### A armadilha do `drawSvgPath`

O `drawSvgPath` do pdf-lib usa origem no canto **superior** esquerdo, com y para
**baixo** — ao contrário do resto do PDF. Um cartão ancorado pela borda errada
sai deslocado da própria altura, sem erro nenhum. Por isso
`npm run montagem:servidor -- --formas` desenha uma amostra com régua: as bordas
de CIMA dos cartões têm de encostar na linha laranja. Conferido no olho em
04/09/2026 — encostam.

#### A regra do `provasDeAutenticacao.ts`

Cada linha da lista é uma AFIRMAÇÃO num documento que pode ir a juízo. A regra
que o teste vigia: **sem confirmação do servidor, o laudo não afirma canal
nenhum**. Assinatura antiga não tem como provar se o código foi por WhatsApp ou
SMS, e afirmar o errado é pior do que não afirmar. A ordem também é regra — do
ato para o circunstancial, senão o laudo abriria com "Dispositivo: iPhone", que
não sustenta nada sozinho.

#### Uma divergência deliberada do cliente

`posicaoDeReserva` grampeia o retângulo dentro da folha; o cliente não faz isso.
Numa página menor que A4 o cliente desenharia a assinatura para fora do papel.
Não afeta A4, que é o caso real, mas está escrito para não parecer descuido.

#### O que falta

**O laudo inteiro está portado** (04/09/2026), e as três páginas foram
desenhadas com pdf-lib de verdade e conferidas no olho
(`npm run montagem:servidor -- --laudo`, 4 páginas):

| Página | Conferido |
|---|---|
| **capa** | selo com visto, cartão por signatário, "Assinar" virou "Signatário", nome longo truncado, e o cartão do segundo signatário CRESCEU por ter mais fatores |
| **signatário** | ficha com valores monoespaçados, placeholder de selfie, QR emoldurado com legenda |
| **trilha** | linha do tempo com nós, selos coloridos por tipo, paginação em 2 páginas, agente de usuário quebrando em 3 linhas |

Duas correções antigas foram **preservadas e são visíveis no render**:

1. o **SHA-256 não passa por cima do QR** — o bloco desce por cursor e o hash
   tem linha própria, limitada pela borda do QR;
2. a linha da **autenticação quebra em vez de ser cortada** — antes saía como
   "Autenticação realizada por código enviad…", justamente a linha que precisa
   ser lida por inteiro num documento de prova.

E duas regras ganharam teste próprio, por serem as que fazem o laudo mentir se
quebrarem:

- **Termos nunca aparece depois de Assinado.** O relógio do aparelho pode gravar
  valor igual ou posterior (fuso, latência, ajuste manual). Um laudo que mostra
  assinatura antes do aceite é munição para a outra parte;
- **sem confirmação do servidor, nenhum canal é afirmado.**

**Falta a Edge Function `montar-documento-assinado`**, que junta as peças, e
depois a remoção da montagem do cliente e da `public-signing-upload`.

### A bancada

Sem ela o porte seria uma reescrita no escuro de um documento que vale como
prova: layout milimétrico, "compila" não diz nada, e a diferença que importa
some numa tela de 14 polegadas.

```bash
npm run montagem:autoteste                          # a bancada se prova
npm run montagem:comparar -- referencia.pdf novo.pdf # A contra B
```

Ela confere **estrutura primeiro** (página a mais, a menos ou de tamanho trocado
reprova sozinho — é o defeito que faz um campo da página 3 sair na 4), depois
mede tinta, texto extraível e diferença de pixel. E diz **onde**: "1,4% dos
pixels numa área de 52,9×16,5 mm a partir de 134,0 mm" é o carimbo da
assinatura; a mesma porcentagem espalhada pela folha é o documento errado.

O autoteste monta três PDFs conhecidos e exige os três pareceres — inclusive o
mais importante, o de que **dois arquivos idênticos dão zero diferença**. Uma
bancada que acusa diferença onde não há transforma todo porte em caça a
fantasma.

A página `/montagem-lab.html` faz o mesmo e pinta a diferença em vermelho sobre
a página. **Abrir no Chrome de verdade**: no navegador embutido do Claude Code o
`page.render` do pdf.js não resolve — a mesma armadilha do `docx-pdf-lab.html`.

### O que ainda falta antes do porte

**A etapa 1 no ar.** A montagem no servidor só funciona sobre o PDF congelado, e
a fidelidade só pode ser medida contra um artefato real: pega-se um envelope
assinado hoje pelo navegador, monta-se o mesmo no servidor, e a bancada dá o
parecer. Portar 1.500 linhas de desenho antes disso é trabalho que pode precisar
ser refeito inteiro.

### O que já subiu (03/09/2026)

1. ✅ `20260903210000_congelar_original_da_assinatura.sql` — `signature_source_files`
   com 18 colunas, RLS ligada, 1 policy, gatilho de `updated_at`, e
   `source_frozen` acrescentado ao CHECK de `signature_audit_log.action`.
2. ✅ `20260903210500_hash_do_original_vem_do_servidor.sql` — a RPC
   `public_attach_signed_document` passou a ler `signature_source_files`
   (uma única versão da função; EXECUTE só para anon/authenticated/service_role,
   nunca PUBLIC).

**Falta a Edge Function `signature-freeze-source`.**

Meio-caminho é seguro, e vale saber por quê: sem a função, criar um envelope
converte o `.docx` normalmente, cria a solicitação, e a chamada de congelamento
falha macia — a tela avisa que o servidor ainda não conferiu os arquivos. Na
hora de assinar não há linha congelada, então a RPC cai no valor do cliente,
que é exatamente o comportamento de antes. Nada quebra; só não melhora ainda.
Conferido em produção: os três envelopes mais recentes têm zero linhas
congeladas e a consulta nova não erra.

## Medido em produção (04/09/2026)

Envelope de teste `49fb62f0-b998-408d-9637-ca4afbb4472d` — KIT CONSUMIDOR, três
documentos, assinado pelo link de preenchimento.

| | |
|---|---|
| montagem no aparelho de quem assina | **≈ 24 s** (6,6 + 11,5 + 5,9) |
| tempo total na página (abrir → assinar) | 58 s |
| ou seja | **41% da experiência do cliente é o celular dele montando PDF** |

E o desperdício, três vezes: a mesma assinatura (16.656 B) baixada e recortada
3×, a mesma selfie (188 KB) baixada 3× (tentando PNG, falhando, embutindo como
JPG), o mesmo DOCX rasterizado a 2,5× por documento. ~616 KB onde 205 KB
bastariam.

Confirmações do mesmo teste:

- `Campos de assinatura recebidos via override: 0` seguido de
  `Placeholder [[ASSINATURA]] encontrado` — a âncora é achada no texto na hora
  de assinar, como a seção da armadilha descreve;
- os três `document_hash` (origem) vieram do navegador; os três
  `signed_pdf_sha256` têm `hash_source = server`. É o fallback funcionando:
  sem linha congelada, vale o do cliente.

### A referência da bancada

Os três PDFs assinados desse envelope são o "A" da comparação:

```
49fb62f0-b998-408d-9637-ca4afbb4472d/signed_main_f12655c4-…_1788488503935.pdf
49fb62f0-b998-408d-9637-ca4afbb4472d/signed_attachment-0_…_1788488515421.pdf
49fb62f0-b998-408d-9637-ca4afbb4472d/signed_attachment-1_…_1788488521279.pdf
```

## A DECISÃO QUE TRAVA TUDO

Os envelopes se dividem assim (medido em 03/09/2026):

| Caminho | Envelopes | Formato | Congela hoje? |
|---|---|---|---|
| **`template-fill`** (link de preenchimento) | **241** | 100% DOCX | ❌ |
| Assistente do módulo Assinaturas | 47 | PDF | ✅ |
| Documentos → "enviar para assinatura" | 1 | DOCX | ❌ |

O `template-fill` monta o `.docx` **no servidor**, a partir das respostas que o
cliente digitou — não existe navegador nesse caminho para converter. Enquanto
não houver conversor DOCX→PDF no servidor, **esses 241 envelopes nunca congelam
e a etapa 2 não os alcança**: os 24 s continuam no celular do cliente.

Duas saídas, as duas em máquina que já está de pé (não é servidor novo):

1. **Ligar o `DocIORenderer` no `docs.jurius-api.com`** — ele já recebe o DOCX e
   já faz o layout; falta só o componente que exporta PDF. Menor conserto, e
   devolve PDF vetorial (mata o truque de imagem + camada de texto invisível).
2. **LibreOffice headless** na mesma VPS, atrás de um endpoint.

Sem uma das duas, a montagem no servidor vale só para o assistente (16% do uso),
e o kit por link segue montado no navegador de quem assina.

### DECIDIDO em 03/09/2026: opção 1 — `DocIORenderer` no `docs.jurius-api.com`

O usuário escolheu ligar o export de PDF no servidor Syncfusion que já está de
pé. Consequência: a etapa 2 passa a valer para **100%** do uso, e o PDF do
`template-fill` sai **vetorial** — o truque de "imagem da página + camada de
texto invisível" deixa de ser necessário nesse caminho.

**O trabalho é fora deste repositório**, no repo irmão `docs` (Docker + Caddy,
deploy manual do usuário). Escrito em 03/09/2026; falta o deploy.

#### O que o `Export` faz hoje (medido em 03/09/2026 — fato de 30/07 CONFIRMADO)

O `Export` funciona. Ele aceita `format: "Pdf"`, ignora, e devolve
**`200 application/msword`** com um arquivo que começa em `d0cf11e0a1b11ae1` — a
assinatura OLE2 de um `.doc` legado. É um `switch` sem caso para PDF caindo no
padrão. Exatamente o que o diário registrava em 30/07.

> **Armadilha ao testar:** o `Import` devolve o SFDT **comprimido** (base64 de um
> zip com um único arquivo, `sfdt`). Mandar esse valor direto no `content` do
> `Export` dá **500 de corpo vazio para todo formato** — e parece serviço quebrado.
> É preciso descompactar antes. Custou uma conclusão errada nesta sessão.

Rotas vivas em produção (sonda de 03/09/2026): `Import`, `Export`, `ExportSFDT`,
`SystemClipboard`, `RestrictEditing`, `SpellCheck`, `SpellCheckByPage`,
`LoadDocument`, `MailMerge`, `CompareDocuments`. **Não existe rota de PDF**:
`ExportPdf`, `SaveAsPdf` e `ToPdf` dão 404.

E não vão existir por configuração: `ExportPdf` é código que cada projeto
[acrescenta ao próprio web service](https://help.syncfusion.com/document-processing/word/word-processor/react/how-to/export-document-as-pdf),
com `Syncfusion.DocIORenderer.Net.Core`. A imagem oficial não o embarca.

#### A solução construída em 03/09/2026 (no repo `docs`, fora deste)

Um **segundo container**, imagem nossa (ASP.NET Core 8 + DocIORenderer), com uma
rota só:

```
POST /api/documenteditor/ConvertToPdf   ->  .docx entra, application/pdf sai
```

Aceita multipart (campo `files`, igual ao `Import`) ou o `.docx` cru no corpo com
`?fileName=` — este segundo é o que a Edge Function vai usar.

O `word-processor-server` oficial **não foi tocado**. O Caddy desvia só esse
caminho; todo o resto continua indo para o binário oficial, com o mesmo
comportamento de sempre.

**Por que somar em vez de substituir** — a decisão contraria a instrução inicial
("construir nossa própria imagem em vez de rodar a oficial"), e o motivo é medido:
o exemplo público `SyncfusionExamples/Word-Processor-Server-Docker` **não é** o
código da imagem que está no ar. O exemplo tem 9 rotas; produção tem 11. Produção
expõe `ExportSFDT` e `MailMerge`, que o exemplo não tem, e o `Export` do exemplo
recebe `multipart` enquanto o de produção recebe JSON. Buildar a partir do exemplo
perderia duas rotas e trocaria o contrato de uma terceira — quebrando os próprios
requisitos de "preservar as rotas atuais" e "não alterar o `Export`".

Detalhes que valem lembrar:

- **fontes são requisito, não enfeite.** O PDF é paginado com a fonte que o
  container encontrar; fonte de métrica diferente move as quebras de linha e de
  página. O Dockerfile instala `fonts-liberation` (Arial/Times/Courier) e tenta
  Carlito/Caladea (Calibri/Cambria);
- **versões travadas juntas:** DocIORenderer 34.2.6 e SkiaSharp.NativeAssets.Linux
  3.119.1. Subir o Skia para 4.x sem subir o DocIORenderer quebra em execução;
- **o serviço está aberto.** O `DOCX_API_KEY` que o `.env.server.example`
  descrevia nunca foi implementado — o Caddyfile só lista `X-Api-Key` no CORS, sem
  conferir valor. E CORS não protege chamada sem navegador. Há agora um
  `PDF_API_KEY` (conferido dentro do serviço, não no Caddy), desligado por padrão.

#### No ar em 03/09/2026 — e o que ficou faltando

O `docs` subiu e a rota responde. Medido contra `kit-trabalhista-source.docx`:

| | |
|---|---|
| HTTP / tipo | `200` · `application/pdf` |
| tamanho | **68 KB** (contra 1,39 MB do artefato rasterizado de hoje) |
| páginas | 2, A4 (595×842 pt) |
| texto extraível | 7.506 chars — **vetorial**, sem camada invisível |
| fontes embutidas | `LiberationSerif` regular/negrito/itálico |

As fontes saíram como o Dockerfile pretendia: o DOCX pede Times New Roman, o
container não tem, e a Liberation Serif substitui com **as mesmas métricas** — que
é o que impede a quebra de linha de andar.

**BLOQUEADOR: o PDF sai com marca d'água de avaliação do Syncfusion** — tarja
vermelha no topo ("Created with a trial version of Syncfusion PDF library or
registered the wrong key") e marca diagonal na página. A licença que o
`word-processor-server` aceita **não está sendo aceita para o DocIO**. Três causas
possíveis, na ordem em que vale checar:

1. **versão**: a chave do Syncfusion é presa à versão. O `pdf-service` está
   travado em DocIORenderer **34.2.6**; se a chave foi gerada para outra linha,
   é preciso trocar a versão no `.csproj` (uma linha) ou gerar a chave para a 34.x;
2. **cobertura**: a licença pode cobrir o Word Processor server-side e não o
   Document Processing / DocIO;
3. **a variável não chegou** ao container novo.

O (3) se descarta em um comando, e o log do serviço responde direto:

```bash
cd ~/docs && docker compose logs pdf-service | grep -i licen
```

`Licença Syncfusion registrada.` = a chave chegou (então é 1 ou 2);
`SYNCFUSION_LICENSE_KEY vazia` = é o (3).

##### A checagem que mentiu

O smoke test dava PASS na marca d'água. O texto do aviso vai **comprimido** dentro
do PDF, então `grep "trial"` no arquivo cru não acha nada e a ausência de prova
virava prova de ausência. O que sobra em bytes crus é o **link** da anotação: um
PDF licenciado não tem `syncfusion.com` dentro dele. Corrigido — e o smoke test
passou de "17 ok / 0 falhas" (falso) para **16 ok / 1 falha** (verdadeiro).

##### O diagnóstico de licença (escrito em 03/09/2026, aguardando deploy)

Não se adivinha licença: o `pdf-service` passou a **validar e publicar** o que a
chave cobre. Só booleanos — a chave nunca sai do container, e as mensagens da
Syncfusion passam por uma função que redige a chave caso ela seja ecoada.

```bash
curl -s https://docs.jurius-api.com/api/documenteditor/LicenseStatus
```

Devolve `chavePresente`, `quantidadeDeChaves` (contagem, não conteúdo),
`versaoDocIORenderer`, os focos `WordToPDF` / `Word` / `WordEditor` com
`valida` + `existeNestaVersao` + `mensagem`, e o mapa completo de plataformas
cobertas e descobertas. O mesmo vai para o log da subida.

As plataformas são varridas com `Enum.GetValues<Platform>()` e os focos são
resolvidos **por nome** (`Enum.TryParse`), não por membro fixo: a 34.1.29 removeu
membros do enum (WPF, Blazor…), e um nome que sumiu vira resposta
`existeNestaVersao: false` em vez de erro de compilação.

**A hipótese que isso vai confirmar ou derrubar:** a partir da 31.x a Syncfusion
separou as edições. O `Import` funciona e o painel diz "Licença Ativa", ou seja a
chave vale para o **Editor** (`WordEditor`). O que falta é o **Document SDK**
(`Word` / `WordToPDF`), que é outra edição. Se `WordToPDF` vier `false` com
`WordEditor` `true`, é isso — e a saída é gerar a licença certa no portal, não
mexer no código.

Duas chaves legítimas cabem juntas: `RegisterLicense` aceita várias separadas por
`;` ou `,` numa chamada só, então `CHAVE_DO_EDITOR;CHAVE_DO_DOCUMENT_SDK` vai
inteira na mesma variável de ambiente. Já suportado.

##### A licença — RESOLVIDA em 04/09/2026

Chave **Essential Studio® Document SDK (Developer Binary License)** aplicada em
`SYNCFUSION_LICENSE_KEY`, no stack `docs` do Portainer. Resultado:

| | |
|---|---|
| `WordToPDF` | **true** |
| `Word` | **true** |
| `WordEditor` | false |
| cobertas | Excel, ExcelToPDF, Markdown, PDF, PowerPoint, PowerPointToPDF, Word, WordToPDF |

PDF sem marca d'água, conferido por bytes (`syncfusion.com` ausente) **e** no olho
(render da página 1). Smoke test: **20 ok / 0 falhas**.

**O que custou duas rodadas, e a lição:** a primeira leitura depois de "subi a
chave" deu os mesmos três `false`. Não dava para saber se a chave nova era
recusada ou se nem tinha chegado. A instrumentação que resolveu foi a
**impressão digital** — SHA-256 da chave, 8 primeiros hex (não é a chave, não
reconstrói) — mais o **comprimento** e o **`processoIniciadoEm`**. A leitura
seguinte mostrou `51857a1f`/88, que é exatamente a chave ANTIGA do editor: o
valor no Portainer nunca tinha sido trocado. Depois da troca real, `72dce9fb`/84
e `WordToPDF: true`.

Sem essa impressão digital, "chave inválida" e "chave não aplicada" são o mesmo
sintoma — e a conclusão errada teria sido "a licença nova também não serve".

**Ponto em aberto (baixo risco):** a chave nova **não cobre `WordEditor`**, e ela
substituiu a antiga na mesma variável — que também alimenta o
`word-processor-server`. O `Import` continua respondendo 200 com SFDT válido, mas
SFDT não tem onde carimbar marca d'água, então isso não prova licenciamento. Se a
chave antiga licenciava o editor, o certo é somar as duas:
`SYNCFUSION_LICENSE_KEY=NOVA;ANTIGA`. Custa nada e restaura o que existia.

##### O diagnóstico de licença (escrito em 03/09/2026, aguardando deploy)##### O diagnóstico de licença (escrito em 03/09/2026, aguardando deploy)

Não se adivinha licença: o `pdf-service` passou a **validar e publicar** o que a
chave cobre. Só booleanos — a chave nunca sai do container, e as mensagens da
Syncfusion passam por uma função que redige a chave caso ela seja ecoada.

```bash
curl -s https://docs.jurius-api.com/api/documenteditor/LicenseStatus
```

Devolve `chavePresente`, `quantidadeDeChaves` (contagem, não conteúdo),
`versaoDocIORenderer`, os focos `WordToPDF` / `Word` / `WordEditor` com
`valida` + `existeNestaVersao` + `mensagem`, e o mapa completo de plataformas
cobertas e descobertas. O mesmo vai para o log da subida.

As plataformas são varridas com `Enum.GetValues<Platform>()` e os focos são
resolvidos **por nome** (`Enum.TryParse`), não por membro fixo: a 34.1.29 removeu
membros do enum (WPF, Blazor…), e um nome que sumiu vira resposta
`existeNestaVersao: false` em vez de erro de compilação.

**A hipótese que isso vai confirmar ou derrubar:** a partir da 31.x a Syncfusion
separou as edições. O `Import` funciona e o painel diz "Licença Ativa", ou seja a
chave vale para o **Editor** (`WordEditor`). O que falta é o **Document SDK**
(`Word` / `WordToPDF`), que é outra edição. Se `WordToPDF` vier `false` com
`WordEditor` `true`, é isso — e a saída é gerar a licença certa no portal, não
mexer no código.

Duas chaves legítimas cabem juntas: `RegisterLicense` aceita várias separadas por
`;` ou `,` numa chamada só, então `CHAVE_DO_EDITOR;CHAVE_DO_DOCUMENT_SDK` vai
inteira na mesma variável de ambiente. Já suportado.

##### O veredito da licença (medido em 03/09/2026)

O diagnóstico rodou. A hipótese da separação de edições estava **errada**:

```jsonc
{
  "chavePresente": true, "quantidadeDeChaves": 1,
  "versaoDocIORenderer": "34.2.6.0",
  "apiDeValidacaoDisponivel": true,
  "focos": {
    "WordToPDF":  { "valida": false, "existeNestaVersao": true,
                    "mensagem": "The included Syncfusion® license key is invalid." },
    "Word":       { "valida": false, ... mesma mensagem },
    "WordEditor": { "valida": false, ... mesma mensagem }
  },
  "plataformasCobertas": []        // NENHUMA das 29
}
```

Não é recorte de edição: a chave é **rejeitada como inválida para todas as 29
plataformas**, `WordEditor` inclusive. Se fosse a separação 31+, `WordEditor`
teria vindo `true`.

A assinatura real da API, para o registro: nesta versão só existe
`ValidateLicense(Platform[])` e `ValidateLicense(Platform[], out String)` — **só
a forma em array**. Foi por isso que a primeira tentativa não achou o método, e
antes disso o build quebrou: eu havia escrito a forma escalar.

**A consequência incômoda:** o `word-processor-server` provavelmente também nunca
esteve licenciado. Ele responde `Import` normalmente porque **SFDT é JSON e não
tem onde carimbar marca d'água** — só o PDF denuncia. O "Licença Ativa" do painel
`status.html` mede *"o SFDT voltou válido"*, que não é uma verificação de licença.
O `latest` da imagem oficial é a **34.2.2** (06/08/2026) e a nossa é a 34.2.6 —
mesma linha 34.2, então a diferença de versão entre elas não explica nada.

**O que pedir no portal da Syncfusion:** uma chave de **Document Processing /
File Formats (Document SDK — DocIO + DocIORenderer)** que cubra `WordToPDF`,
**gerada para a linha 34.2**. A mesma chave serve os dois containers.

Antes de comprar, três checagens baratas: (1) que produtos e versão a chave atual
cobre, no portal; (2) se ela não foi truncada/aspada ao ser colada nas variáveis
do stack no Portainer; (3) se existir chave válida de OUTRA versão, dá para fixar
o pacote nessa versão em `pdf-service/src/JuriusPdfService.csproj` em vez de
gerar chave nova.

Nada foi feito para contornar a marca d'água, e nada deve ser.

##### O que ainda NÃO foi comparado

A paginação contra o pipeline de hoje. O `kit-trabalhista-signed.pdf` **não serve
de referência**: ele é o artefato assinado — página rasterizada, reduzida para
caber a tarja de assinatura, com laudo. A bancada reprova por estrutura (6 contra
2) sem que isso signifique defeito. A comparação justa é contra o `docxToPdf`
(motor `preview`) do MESMO docx, que só sai de um navegador. Fica para depois da
licença, porque com marca d'água nada de layout pode ser aprovado.

#### O que isso puxa para dentro deste repo (quando o servidor estiver pronto)

- o `template-fill` passa a poder congelar — e aí a detecção de `[[ASSINATURA]]`
  **tem** de sair da hora de assinar e ir para a hora de congelar, senão o
  placeholder é impresso no PDF e a assinatura perde a âncora. É o mesmo
  trabalho do item 3 da fila, mas valendo para 241 envelopes em vez de 1;
- a bancada tem de aprovar no olho a troca de "página rasterizada" por "PDF
  vetorial": é outra aparência, e ela vai acusar diferença com razão.

## A comparação A/B do laudo — FECHADA em 04/09/2026

O `npm run montagem:servidor -- --referencia` desenha as 4 páginas do laudo com
os dados lidos do próprio `kit-trabalhista-signed.pdf` (envelope
`4835bfad-…`, assinado pelo navegador em 02/09/2026) e recorta as páginas 3 a 6
da referência. Os dois lados, os mesmos dados, motores diferentes.

O parecer final:

| Página | Pixels diferentes | Tinta A / B | Texto A / B |
|---|---|---|---|
| capa | 0,520% | 5,29% / 5,05% | 1216 / 1216 — **igual** |
| signatário | 11,928% | 16,98% / 7,48% | 1915 / 1875 |
| trilha 1 | 0,279% | 9,30% / 9,31% | 1925 / 1925 — **igual** |
| trilha 2 | 0,279% | 10,50% / 10,51% | 2659 / 2659 — **igual** |

Estrutura idêntica (4 contra 4). O texto extraível bate **caractere a
caractere** em três das quatro páginas — que é a prova que mais vale num
documento de prova, porque é o texto que a outra parte lê e cita.

**As três diferenças que sobram, todas explicadas:**

1. **a selfie e a rubrica** (página 2, e o cartão da capa) — a bancada não tem
   as imagens, que só existem no Storage. O lado A traz a foto real com a marca
   `CONFIDENTIAL`; o lado B traz o texto "Selfie não coletada". São exatamente
   os 40 caracteres de diferença da página 2, e o grosso dos 11,9% de pixel.
   O porte DESENHA a marca `CONFIDENTIAL` e o carimbo de protocolo
   (`laudoSignatario.ts`) — conferido no código, não só no render;
2. **o QR** — vetorial de um lado, PNG de 512 px reamostrado do outro. Toda
   borda de módulo discorda, e é assim que tem de ser: o vetorial é o que fica
   nítido em qualquer zoom;
3. **antialiasing do wordmark** — alguns pixels na borda das letras.

Depois das correções abaixo, o desvio máximo das páginas da trilha caiu de
**255 para 127**: não há mais nenhum pixel que seja preto de um lado e branco do
outro. O que sobra é sombra de borda.

### As três divergências REAIS que a A/B pegou

Nenhuma delas quebra nada. É por isso que precisavam da bancada.

**1. O QR estava em preto puro, e o cliente usa `#111827`.**
Dois documentos do MESMO envelope sairiam com QR de cores diferentes conforme
tivessem sido montados antes ou depois desta migração.

**2. O QR estava com correção de erro `M`, e o cliente usa `H`.**
Esta é a que teria custado caro. `M` recupera ~15%; `H`, ~30%. O laudo é
impresso, fotocopiado, fotografado de celular e digitalizado torto — e é
justamente nessas condições que `M` começa a falhar. Um QR ilegível num
documento de prova é o link de verificação perdido. Trocar também MUDA o
desenho (outra versão do QR, outra máscara), e era por isso que a bancada
acusava a página inteira.

As duas viraram constante única em `qr-em-retangulos.ts` (`TINTA_DO_QR`,
`CORRECAO_DE_ERRO_DO_QR`), porque são DOIS os lugares que desenham QR — o
rodapé e a ficha do signatário — e eles têm de concordar. Com teste, incluindo
a régua que a troca para `H` exigia: em `H` o QR tem mais módulos, cada um
encolhe, e o teste exige que no lado de 44 pt do rodapé o módulo continue acima
de 0,7 pt (o limite abaixo do qual a câmera erra).

**3. A função inventou a variável `PUBLIC_APP_URL`.**
A convenção do projeto é `PUBLIC_APP_ORIGIN` (`whatsapp-signature-followup`,
`whatsapp-template-fill-followup`, `whatsapp-ai-agent`). Como nada define
`PUBLIC_APP_URL`, a função caía no padrão embutido e **ignorava em silêncio a
origem já configurada** — e o QR de um documento de prova apontaria para outro
domínio sem ninguém errar nada. Corrigido.

## O defeito que só apareceu ao ligar o interruptor (04/09/2026)

Achado ao escrever a troca no cliente, não pela bancada — a bancada compara
desenho, e este é um defeito de *decisão*.

A função tinha, como primeiro passo real, a leitura ingênua de "uma vez só":

> se `signature_request_documents` já tem o arquivo desta chave, devolve o que
> existe e não desenha nada.

Num envelope de UM signatário está certo. **Em um de dois, produz o pior defeito
possível aqui:**

> a primeira pessoa assina e o artefato nasce com a rubrica dela. A segunda
> assina, a função vê o ponteiro, devolve o arquivo da PRIMEIRA — e o envelope
> fecha com um documento em que a assinatura da segunda simplesmente não está.
> Nada falha, ninguém erra, e o que fica arquivado é um documento incompleto
> que se apresenta como assinado.

O banco nunca teve esse problema: a RPC `public_attach_signed_document` aplica
`last-signer-wins` — só troca a linha quando quem chega assinou DEPOIS de quem
está lá. **A função tinha de concordar com o banco, e não concordava.**

A regra certa é POR SIGNATÁRIO, e virou módulo puro com teste
(`_shared/montagem/donoDoArtefato.ts`), porque erra em silêncio nos DOIS
sentidos — refazendo de menos (some uma assinatura) ou refazendo demais (um PDF
órfão no bucket a cada clique):

| Situação | Decisão |
|---|---|
| o artefato é MEU | devolve o que existe — é o segundo clique |
| o dono assinou **depois** de mim | devolve o dele — a RPC recusaria o meu |
| o dono assinou **antes** de mim | **monta**: a versão nova traz todas as rubricas |
| registro sem `signer_id` (legado) | devolve o que existe — não se sobrescreve o que não se sabe de quem é |

Duas decisões deliberadas, escritas para não parecerem descuido: o **empate**
conta como "depois" (dois instantes iguais não provam que a minha versão é a
mais nova), e o dono com **data ilegível** perde (refazer a mais custa um
arquivo no bucket; refazer a menos custa uma assinatura que não aparece).

E a regra nunca olha `signature_signers.order`: essa é a ordem de CONVITE. Quem
assina primeiro pode ser o segundo da lista, e usar a ordem faria a versão nova
perder para a velha em todo envelope assinado fora de ordem. Tem teste.

## A troca no cliente — o interruptor (04/09/2026)

`src/config/montagemNoServidor.ts`. **O fluxo antigo continua inteiro**; o
interruptor só decide qual dos dois é TENTADO primeiro.

Três degraus, do mais específico ao mais geral:

| Degrau | Como | Alcance |
|---|---|---|
| `?montagem=servidor` na URL | link | esta aba — o teste ponta a ponta com o build JÁ publicado, sem rebuild e sem deploy |
| `localStorage.montagemNoServidor = 'servidor'` | console | este aparelho, durante a validação |
| `VITE_MONTAGEM_NO_SERVIDOR=true` | build | todo mundo — é o degrau que fecha a migração |

Padrão **desligado**: sem nenhum dos três, nada muda. É o que torna seguro subir
o código novo sem mudar o comportamento de ninguém.

**A DIREÇÃO É ÚNICA, e é regra:** o que está escrito ali só LIGA. Não existe
`?montagem=cliente`. O caminho do servidor é o mais rigoroso dos dois — é ele
que calcula o SHA-256 sobre os bytes que o próprio servidor leu — e dar a quem
abre o link de assinatura o poder de escolher o caminho mais frouxo devolveria,
por outra porta, exatamente o que a migração existe para tirar do navegador.
Tem teste, com as seis grafias tentadoras (`cliente`, `navegador`, `false`,
`0`, `off`, `nao`).

**A armadilha do hash router:** a página pública vive em `/#/assinar/<token>`,
então um `?montagem=servidor` colado no fim do link cai DENTRO do fragmento e
nunca chega em `location.search`. Ler só a busca faria o interruptor não
responder justamente no link que ele existe para testar — e o sintoma ("liguei e
não mudou nada") se confunde com a montagem no servidor ter falhado em silêncio.
`lerParametro` lê as duas metades. Tem teste.

### Onde ele foi ligado, e onde NÃO foi

O laço `per_document` de `PublicSigningPage.tsx` — o do link de assinatura, que
é o caminho dos 241 envelopes. **Um lugar só**, e de propósito: são 7 chamadas
de `saveSignedPdfToStorage`/`saveSignedDocxAsPdf` espalhadas por dois
componentes, e espalhar o interruptor por todas seria a receita de esquecer uma.

Uma chamada substitui as TRÊS etapas do laço — desenhar, subir e registrar —
porque a Edge Function faz as três.

**O código de verificação passa a ser o que o SERVIDOR devolveu**, não o gerado
localmente na linha de cima: é o do servidor que está impresso no rodapé e no QR
do arquivo que realmente existe. Usar o local faria a tela de confirmação
mostrar um código que não abre documento nenhum.

**NÃO foi ligado** no assistente interno (`SignatureModule.tsx`): a Edge Function
se autentica pelo `public_token` do signatário, que o fluxo interno não tem. É
outro trabalho, e ele só faz sentido depois de o caminho público estar validado.

### Os três estados da resposta, e por que os três importam

`signatureService.montarDocumentoAssinadoNoServidor` devolve `montou`,
`recusou` ou `falhou`. Confundir os dois últimos é o que faria o interruptor
mentir:

- **`recusou`** (409 com `codigo`: `sem_original_congelado`, `original_nao_e_pdf`)
  — o servidor entendeu e disse que não monta ESTE documento. É o estado normal
  enquanto o congelamento não alcança todos os caminhos. Cai para o navegador
  sem barulho;
- **`falhou`** — rede, função fora do ar, 500. Também cai para o navegador, mas
  com `console.warn`: recusa é esperada, falha não é. Sem essa separação, um
  deploy parcial (503 em tudo — ver a memória do assunto) passaria por
  comportamento normal e ninguém saberia que a migração parou de acontecer.

A leitura do `codigo` sai do CORPO da resposta, não da frase da mensagem — casar
texto prenderia a decisão à redação. Reusa o `extractEdgeErrorBody` que já
existia.

Nunca estoura: uma exceção ali derrubaria a assinatura de quem está com o dedo
na tela por causa de um caminho que ainda é opcional.

## O artefato completo, montado pelo código do servidor (04/09/2026)

`npm run montagem:servidor -- --completo` chama `montarDocumentoAssinado` — o
MESMO código que a Edge Function chama — sobre o PDF vetorial de 67 KB que o
`ConvertToPdf` licenciado produziu.

```
paginasDeConteudo: 2      paginasTotais: 6      bytes: 148.401
laudo: { capa: 1, signatarios: 1, trilha: 2, total: 4 }
decisoes: [{ campo: 0, decisao: "assinatura-do-titular", pagina: 1 }]
usouPosicaoDeReserva: false
```

Conferido no olho na página de conteúdo: texto preservado sem deslocar, faixa de
rodapé com wordmark/código/protocolo/SHA-256/QR, carimbos girados nas duas
margens, marca d'água diagonal, e a rubrica na coordenada do campo. A folha
cresceu 84 pt para baixo e a origem desceu 84 — nada do conteúdo se moveu.

**Um achado do render, e ele NÃO é defeito da montagem:** o `[[ASSINATURA]]` sai
impresso na folha. O PDF de entrada da bancada veio do `ConvertToPdf` do
servidor, que não tem detecção de marcador — e uma vez convertido, o marcador é
conteúdo de página e a montagem não tem como removê-lo. Ver a seção seguinte.

## O `[[ASSINATURA]]` já mudou de momento — para o caminho do NAVEGADOR

Está feito, e vale registrar para não ser refeito: `congelamentoDeOriginal.service.ts`
converte com `engine: 'preview'` e `detectarMarcadores: true`, o
`docxToPdf.ts` **oculta** o marcador antes de rasterizar (passada 2), e o
`SignatureModule.handleSubmit` grava os achados como `signature_fields` com o
`signer_id` certo (`[[ASSINATURA_2]]` é do segundo). A precedência é a de
sempre: documento com campo marcado a mão ignora o marcador automático — somar
os dois daria duas assinaturas no mesmo documento.

**O que continua em aberto é só o caminho do SERVIDOR.** Quando o `template-fill`
passar a congelar pelo `ConvertToPdf`, não há navegador para achar e ocultar o
marcador: ele seria impresso, e a rubrica cairia por cima do texto dele. É o
mesmo trabalho, valendo para 241 envelopes.

## O primeiro congelamento REAL — 04/09/2026

`signature_source_files` ganhou sua primeira linha em produção, pelo assistente
do módulo Assinaturas: `document_key: main`, `is_pdf: true`, `sha256`
**apurado pelo servidor** (`a5a6e993cda100e8…`). A etapa 1 está provada ponta a
ponta.

Antes dela, a consulta contava **zero linhas congeladas em TODOS os envelopes** —
os 7 dos últimos 10 dias, todos `KIT CONSUMIDOR`/`KIT TRABALHISTA`, ou seja
`template-fill`. É a medida do bloqueio: enquanto o congelamento morar só no
navegador, ele não alcança nenhum envelope real.

### As duas armadilhas de TESTE que custaram duas rodadas

Nenhuma é bug. As duas fazem o teste parecer que falhou quando ele nem chegou a
acontecer, e nenhuma se adivinha olhando o código.

**1. Envelope do `template-fill` nunca congela.** Testar pelo link de
preenchimento (que é o caminho natural, porque é o que o escritório usa) dá
`sem_original_congelado` e cai no navegador — corretamente. O teste da montagem
no servidor tem de nascer no **assistente do módulo Assinaturas**.

**2. Um documento só produz envelope `consolidated`, e o interruptor não age lá.**

```ts
const isMultiDocEnvelope = (attachPaths?.length ?? 0) > 0;   // SignatureModule.tsx
signature_model: isMultiDocEnvelope ? 'per_document' : 'consolidated',
```

**O envelope só vira `per_document` se tiver pelo menos um ANEXO.** Com um
arquivo só, a assinatura desce pelo fluxo consolidado (legado), que é outro
trecho de `PublicSigningPage.tsx` — e ali o interruptor não existe.

E ele não deve existir: a Edge Function registra pela RPC
`public_attach_signed_document`, que escreve em `signature_request_documents`. O
consolidado não usa essa tabela — guarda o ponteiro em
`signature_signers.signed_document_path`. Ligar o interruptor lá gravaria o
documento numa tabela que a tela do consolidado nunca lê: o PDF existiria e
ninguém o veria. O `per_document` é onde estão 241 dos 291 envelopes; o
consolidado é legado.

**Receita do teste, então:** assistente do módulo Assinaturas, **documento
principal + pelo menos um anexo**, e o link com `?montagem=servidor`.

### O interruptor mudo — corrigido

Na primeira rodada o interruptor não imprimia nada quando estava desligado, e
"liguei e não mudou nada" ficou indistinguível de "esqueci de ligar". Era a
mesma confusão que a seção do hash router descreve, e eu não a tinha prevenido.
Agora ele **anuncia sempre**, com a origem da decisão e o valor lido:

```
[PER-DOC] montagem no servidor: desligada (origem: padrao, montagem=«ausente»)
[PER-DOC] montagem no servidor: LIGADA (origem: url, montagem=servidor)
```

O `montagem=«ausente»` é o que separa "o parâmetro não chegou" (hash router
comendo a query — plano B é `localStorage`) de "chegou e foi ignorado".

## A lentidão medida de novo, agora com 6 documentos (04/09/2026)

Envelope `dde1c5f9-…` (KIT AUX. POR INCAPACIDADE TEMPORÁRIA, `template-fill`,
6 arquivos). Pelos carimbos de tempo nos nomes dos arquivos gravados:

| Documento | Δ até o anterior |
|---|---|
| main | — |
| attachment-0 | **10,4 s** |
| attachment-1 | 8,1 s |
| attachment-2 | 8,5 s |
| attachment-3 | 7,9 s |
| attachment-4 | 7,1 s |

**≈ 48 s** no aparelho de quem assina, ~8 s por documento, linear. Confirma a
medição de 04/09 (≈24 s para 3 documentos) e mostra que ela ESCALA com o kit.

O desperdício do diário, agora contado neste log: a **mesma** assinatura
(17.108 B) baixada e recortada **6 vezes**; a **mesma** selfie (143.879 B)
baixada **6 vezes**, tentando PNG, falhando (`The input is not a PNG file!`) e
embutindo como JPG, toda vez. ~863 KB onde 144 KB bastariam.

**A verdade incômoda deste número:** ele veio de um envelope `template-fill`, e é
justamente ali que a montagem no servidor NÃO chega hoje. Enquanto o
`template-fill` não congelar, a etapa 2 não encosta em 83% do uso — e os 48 s
continuam no celular do cliente. Ligar o interruptor não muda isso.

## O cronômetro de fases (04/09/2026)

`src/utils/cronometroDeFases.ts` + 11 testes. Instrumenta o fluxo atual para
responder a pergunta que decide a otimização: **onde vão os ~8 s por
documento?** As duas hipóteses pedem soluções opostas — se o peso é a REDE
(mesma rubrica e mesma selfie baixadas uma vez por documento), cache resolve; se
é a RASTERIZAÇÃO (`html2canvas` a 2,5×), só tirar o desenho do navegador
resolve.

Fases medidas: `renderizar o DOCX (docx-preview)`, `rasterizar o DOCX
(html2canvas)`, `imagem: rubrica (baixar+recortar)`, `imagem: selfie
(baixar+embutir)`, `desenhar o laudo (pdf-lib)`, `upload do PDF assinado`,
`registrar no banco (RPC)`. O relatório sai no console ao fim do envelope.

**A regra de projeto do módulo:** ele imprime o que **NÃO** foi medido. Um
relatório que só soma as fases instrumentadas dá 100% sempre e esconde o gargalo
que ninguém cronometrou — e aí se otimiza a fase que por acaso foi medida. A
contagem de passagens (`×6`) é o que denuncia trabalho repetido.

## A CAUSA RAIZ: o `template-fill` congelando no servidor

O bloqueio: 241 dos 291 envelopes nascem como `.docx` montado no servidor, sem
navegador que os converta — então nunca congelam, e sem PDF congelado a etapa 2
não os alcança.

Converter no servidor **não basta**, e é onde a solução ingênua morre: o
`ConvertToPdf` imprimiria o texto `[[ASSINATURA]]` na folha e a âncora se
perderia — documento de prova com marcador visível e rubrica caindo no rodapé.

E não há como calcular a posição no servidor: nenhum runtime de JavaScript abre
um `.docx` e diagrama a página. **O repo do `docs.jurius-api.com` não está nesta
máquina**, então mudar aquele serviço também está fora.

### A saída: não calcular — perguntar ao PDF

Trocar o marcador por uma **imagem inline transparente** antes de converter. O
Syncfusion diagrama (ele É um diagramador de verdade), e o PDF resultante
**carrega a resposta**: uma imagem é desenhada com uma matriz explícita no fluxo
de conteúdo.

```
q  120 0 0 40  90 620 cm  /Im3 Do  Q
  └──────── a b c d e f ────────┘
```

Duas peças novas, puras e testadas:

| Módulo | O que faz | Testes |
|---|---|---|
| `_shared/montagem/ancoraNoDocx.ts` | acha o marcador no `document.xml` (inclusive **partido em vários runs**, que é o caso normal), troca por âncora, e cuida de rels + `[Content_Types]` | 20 |
| `_shared/montagem/ancoraNoPdf.ts` | interpretador mínimo de `q`/`Q`/`cm`/`Do` que lê a matriz de volta e converte para porcentagem | 16 |

`marcadoresDeAssinatura.ts` foi **espelhado** em `_shared/montagem/` com teste de
igualdade byte a byte — a mesma decisão do `selo.ts`. Se as duas regras
divergirem, o mesmo documento ganha campo por um caminho e não pelo outro.

### PROVADO contra o conversor de verdade (04/09/2026)

`npm run ancora:bancada` (`scripts/ancora-no-servidor.mts`) faz a volta inteira:
injeta a âncora, chama o `ConvertToPdf` real, e lê a coordenada de volta.

```
marcadores achados: 1
ConvertToPdf: HTTP 200 application/pdf
âncora #1 (assinante 1)
  página ..... 2 de 2  (595.3×841.9 pt)
  em pontos .. x=311.3 y=237.6  1.0×1.0
  em % ....... x=52.30 y=71.66
```

A âncora sobrevive ao Syncfusion e o fluxo de conteúdo devolve a posição exata.
**O caminho do `template-fill` é viável.**

### A âncora é um PONTO — e isso foi medido, não escolhido

A primeira versão usava âncora do tamanho da assinatura (160×40 pt) e a caixa
dela como o campo. Contra o conversor real, o `kit-trabalhista-source.docx`
passou de **2 para 3 páginas**: uma imagem inline de 40 pt força a linha a ter
40 pt onde o texto tinha ~14.

Um documento congelado com paginação diferente da que o autor escreveu é
inaceitável — e a causa seria a nossa própria instrumentação. Pior, o defeito é
**silencioso**: o PDF sai bonito, só com uma quebra a mais.

Com âncora de **1×1 pt**, a paginação volta às 2 páginas originais e a
coordenada continua exata. A caixa da assinatura passa a ser derivada do ponto
por convenção escrita (`caixaDaAssinatura`): a âncora é o canto inferior
esquerdo e a rubrica cresce para a direita e para **cima**, como uma assinatura
feita à mão sobre uma linha — crescer para baixo cairia sobre o "Nome:" que
costuma vir logo abaixo.

### A Edge Function `congelar-docx-no-servidor` (04/09/2026)

A costura, escrita. Para cada arquivo do envelope: baixa → se for `.docx`,
planta âncoras, converte no `docs.jurius-api.com` e sobe o PDF → lê as âncoras
→ grava `signature_source_files` (com o SHA-256 que ela apurou) **e** os
`signature_fields` que os marcadores viraram.

**Dois chamadores legítimos, e nenhum é o público:** a equipe logada (a
permissão sobre o envelope não é reimplementada — a leitura passa pela RLS com o
token de quem chamou) e o `template-fill`, que é servidor e chega com a service
role. Congelar reescreve a origem de um documento que vale como prova.

A **proveniência** é gravada junto (`original_path`, `converted_from: docx`,
`conversion_engine: syncfusion-docio`, `conversion_searchable: true`): o dossiê
publica que o arquivo conferido é um PDF que veio de um `.docx`, e por qual
motor. Sem isso o laudo afirmaria um original que não é o que o autor escreveu,
sem dizer que houve conversão.

**Marcador achado mas âncora não localizada vira linha de auditoria**, não só
log: significa que a conversão engoliu a imagem e o documento vai ficar sem
campo de assinatura.

### A TRAVA DE PAGINAÇÃO — a decisão de segurança desta parte

Documento que **já tem campo marcado** (pelo designer, ou à mão) **não é
convertido**. As coordenadas daqueles campos foram medidas contra a paginação do
`docx-preview`, no navegador; o PDF congelado é paginado pelo **Syncfusion**, que
quebra por conta própria. Uma quebra em lugar diferente move o campo da página 3
para a 4 — e a assinatura sai no lugar errado de um documento jurídico, defeito
que só aparece depois de assinado.

A âncora não tem esse problema, e é exatamente essa a diferença: a coordenada
dela sai do MESMO PDF que está sendo congelado, então não existem duas
paginações para divergir.

Então o congelamento no servidor vale **só para documento cuja posição vem de
`[[ASSINATURA]]`** — que é o caso dos kits (medido no console: `Campos de
assinatura recebidos via override: 0` seguido de `Placeholder [[ASSINATURA]]
encontrado`). Até a comparação de paginação `preview` × `DocIORenderer`
acontecer, esta trava é o que impede um erro silencioso.

### O enganche no `template-fill`

Depois de criar o envelope, o signatário e os campos, o `template-fill` chama a
função nova. **Falha macia, e isso é requisito:** o cliente acabou de preencher o
formulário e está esperando o link. Se o conversor estiver fora do ar, derrubar
a criação trocaria "a assinatura vai demorar 8 s por documento" por "o cliente
não recebeu documento nenhum". Sem congelamento, o envelope funciona exatamente
como funcionava antes.

### Um só código, dos dois lados

`docxParaPdf.ts` e `lerAncorasDoPdf.ts` existem porque a primeira versão tinha a
volta escrita DENTRO da bancada. A prova valeria para o código da bancada e não
para o que roda em produção — a forma mais silenciosa de um teste mentir. Agora
`npm run ancora:bancada` e a Edge Function chamam a mesma função.

### NO AR em 04/09/2026

| Função | Estado |
|---|---|
| `congelar-docx-no-servidor` | v1, `verify_jwt: true`, 6/6 arquivos idênticos ao repo |
| `template-fill` | **v64**, `verify_jwt` **continuou false**, sha `ea3c03bb…`→`fedc155c…`, 3/3 idênticos, com a chamada do congelamento presente no implantado |

Fumaça que prova o que interessa, e ela está na DIFERENÇA entre as duas:

- `template-fill` responde com as mensagens do **próprio código**
  (`{"success":false,"error":"Ação inválida"}`) — se o `--no-verify-jwt` tivesse
  escapado, viria o `UNAUTHORIZED_NO_AUTH_HEADER` do gateway e o link de
  preenchimento estaria quebrado para todos os clientes;
- `congelar-docx-no-servidor` devolve o 401 **do gateway** sem `Authorization`
  (não é chamável publicamente) e, com a chave anônima — que passa o portão —
  devolve `{"error":"Não autenticado"}`, que é a mensagem do **porteiro dela**.
  É essa segunda resposta que prova que o módulo carregou: os 5 imports de
  `_shared/`, mais `npm:fflate`, `npm:fast-png` e `npm:pdf-lib`, todos
  resolvidos. Boot quebrado daria 500/503.

### O que falta desta parte

- **o primeiro kit real**: o próximo `template-fill` preenchido deve gravar
  linha em `signature_source_files` e campos vindos da âncora. Até isso
  acontecer, o caminho está no ar mas nunca rodou sobre dado de verdade;
- ligar o interruptor da montagem depois que o congelamento estiver produzindo
  linhas;
- a comparação de paginação `preview` × `DocIORenderer`, que é o que libera a
  trava de segurança acima.

## MEDIDO: onde vai o tempo da assinatura (04/09/2026)

Duas assinaturas reais de kit de 3 documentos, pelo cronômetro de fases.

| Fase | 1ª (23,7 s) | 2ª (20,3 s) |
|---|---|---|
| **upload do PDF assinado** | 31,0% | 22,1% |
| **não medido** | 30,2% | 30,4% |
| imagem: rubrica (baixar+recortar) | 13,1% | 15,4% |
| imagem: selfie (baixar+embutir) | 9,5% | 11,8% |
| renderizar o DOCX (docx-preview) | 6,9% | 7,6% |
| **rasterizar o DOCX (html2canvas)** | **6,1%** | **9,6%** |
| desenhar o laudo (pdf-lib) | 1,7% | 1,8% |
| registrar no banco (RPC) | 1,5% | 1,4% |

**A hipótese estava ERRADA.** A rasterização — a vilã presumida, a razão pela
qual "só tirar o desenho do navegador resolve" — é **6 a 10%**. O gargalo é
**rede e IO**: upload mais downloads de imagem dão **~50%**, e os 30% não
medidos são a mesma vizinhança (base64 de ~1,4 MB antes de subir, SHA-256, URLs
assinadas).

Três consequências:

1. **cache de imagem economizaria ~15%** (as 2 de 3 baixas repetidas). Seria
   consolo, não solução — a recusa do usuário em aceitar cache como resposta
   definitiva estava certa, e agora está medida;
2. **a montagem no servidor continua sendo a resposta, por outro motivo**: não
   por desenhar mais rápido, mas porque o **upload do navegador desaparece** (o
   servidor grava direto no Storage) e as imagens passam a ser baixadas dentro
   do mesmo datacenter. Some o que custa, não o que se supunha custar;
3. o "não medido" de 30% merece instrumentação antes de qualquer micro-otimização.

## A REGRESSÃO de 04/09/2026 — campo da âncora no desenho do navegador

Achada no primeiro kit real depois do deploy, e ela é a **imagem espelhada** da
trava de paginação.

O congelamento funcionou (3 arquivos, 3 âncoras) e gravou os campos em
`signature_fields`. Só que aquelas coordenadas são da paginação do **Syncfusion**,
e quem as consumiu foi o **navegador**, que pagina com o `docx-preview`:

```
[PDF] Campos de assinatura recebidos via override: 1        ← antes era 0
[PDF] Campo manual mapeado (main): page_designer=5 → section=1/1, yPct=100.0
```

O campo dizia "página 5"; o navegador tinha 1 seção, grampeou em `yPct=100` e a
rubrica foi para o rodapé. **Pior que não funcionar: antes disso o navegador
achava o `[[ASSINATURA]]` sozinho e ACERTAVA.** Gravar o campo substituiu uma
detecção que funcionava por uma coordenada de outra paginação.

**Alcance real: um envelope** — o próprio teste. Nenhum cliente preencheu kit na
janela. Conferido por consulta, não por suposição.

**A correção:** as âncoras localizadas passam a ficar **só na auditoria** e não
entram em `signature_fields` enquanto a montagem for do navegador. O
congelamento continua valendo. Confirmado no kit seguinte: `override: 0` e
`Placeholder [[ASSINATURA]] encontrado`, nas posições certas.

**A regra que sai disso, e vale para os dois lados:** campo do designer não pode
ir para o PDF do servidor; campo do servidor não pode ir para o desenho do
navegador. As duas coordenadas só param de brigar quando **congelamento e
montagem estiverem do mesmo lado**.

## A armadilha do `import.meta.env` no Vite

O interruptor não ligava mesmo com `VITE_MONTAGEM_NO_SERVIDOR=true` no `.env` e
o servidor reiniciado. A causa não era o `.env` nem o cache: **o Vite substitui
`import.meta.env.VITE_X` textualmente, e a substituição só casa o acesso
DIRETO.** Estava escrito com optional chaining e cast
(`(import.meta as any)?.env?.VITE_X`), o texto não batia, e a variável
simplesmente não existia no bundle.

Diagnóstico que resolveu em um comando — perguntar ao dev server o que ele está
servindo, em vez de adivinhar:

```bash
curl -s http://localhost:3000/src/config/montagemNoServidor.ts | grep VITE_
```

O módulo chegava ao navegador com o acesso intacto, sem valor no lugar. Depois
da correção, o bundle de produção compila para `function Wn(){try{return"true"}catch`
— o valor assado — e não sobra nenhum `import.meta.env.VITE_MONTAGEM` cru.

## A PRIMEIRA MONTAGEM NO SERVIDOR — 04/09/2026

Envelope `53bd903a-…`, KIT CONSUMIDOR de 3 documentos, pelo link de preenchimento.

```
[PER-DOC] montagem no servidor: LIGADA — decidido por: build
[PER-DOC] montado NO SERVIDOR main ... código: e3c359b5ba3857b0
[PER-DOC] montado NO SERVIDOR attachment-0 ...
[PER-DOC] montado NO SERVIDOR attachment-1 ...
── assinatura de 3 documento(s): 8,5 s ──
  não medido  8,5 s  100.0%
```

**20,3 s → 8,5 s.** E o "não medido 100%" é a leitura certa, não uma falha do
cronômetro: todas as fases que ele conhecia **deixaram de acontecer** no
navegador. Sobraram 3 chamadas HTTP.

No banco, os três documentos:

| | |
|---|---|
| `hash_source` | **`server`** — o objetivo inteiro da migração |
| `document_hash` | **igual ao SHA do congelado**, byte a byte |
| `converted_from` / `conversion_engine` | `docx` / `syncfusion-docio` |

### E o defeito que ela expôs: a rubrica foi para o canto

```
MONTAGEM: nenhum campo de assinatura foi aproveitado em main;
a rubrica foi para a posição de reserva (canto da última folha).   ×3
```

As âncoras tinham sido localizadas (main pg5 x=52,30 y=35,11) mas ficavam **só
na auditoria**, por causa da correção da regressão anterior. Resultado: a
montagem no servidor não achou campo e caiu na reserva — assinatura no canto
inferior direito, longe da linha do CONTRATANTE. Conferido no PDF, no olho.

A auditoria fez o que foi construída para fazer: **gritou em vez de falhar em
silêncio.** Sem aquela linha, o defeito seria um PDF bonito com a assinatura no
lugar errado.

### A resolução: a âncora mora junto do arquivo congelado

Migration `ancoras_da_assinatura_no_congelado`: coluna `signature_anchors jsonb`
em `signature_source_files`.

As duas coordenadas **não podem dividir a mesma tabela**. `signature_fields` é o
que o navegador consome, e ele pagina com o `docx-preview`; a âncora é medida na
paginação do PDF do Syncfusion. Guardá-la ao lado do arquivo que ela descreve
resolve os dois lados de uma vez:

| Quem monta | De onde tira a posição | Certo porque |
|---|---|---|
| navegador | acha o `[[ASSINATURA]]` sozinho | mede na própria renderização |
| servidor | `signature_source_files.signature_anchors` | mede no PDF que ele mesmo vai montar |

E guardar junto do congelado não é arrumação: se o arquivo for recongelado, a
linha inteira é substituída e a coordenada velha vai junto — não sobra posição
órfã apontando para uma paginação que não existe mais.

## Upload de Word no painel (04/09/2026)

O assistente aceitava só PDF (`accept=".pdf"` + filtro `f.type.includes('pdf')`).
Passou a aceitar `.doc`/`.docx`.

**A conversão acontece na SELEÇÃO, não no congelamento** — e é essa a decisão
que importa. Converter no congelamento traria de volta a divergência de
paginação: os campos seriam marcados sobre uma renderização e o documento
assinado nasceria de outra. Convertendo na seleção, o assistente inteiro
(visualização, tela de posicionamento, congelamento e assinatura) vê **o mesmo
PDF**. Não há duas paginações para divergir.

É o item "conversão no momento da SELEÇÃO" que estava na fila desde a etapa 1.

Os `[[ASSINATURA]]` são detectados e ocultados nessa mesma passada e ficam
guardados em `marcadoresDoUpload` até o envio — porque dali em diante o
congelamento vê um PDF e não tem mais o que procurar. No envio, os marcadores da
seleção e os do congelamento são somados; sem isso, o Word enviado entraria sem
campo e a rubrica cairia no rodapé.

## Onde parei

Nada comitado desde `dfd5ec6` (v1.22.18) — o pedido é testar local antes, e não
comitar. O pre-commit exige bump em `package.json` + entrada em
`src/data/releases.ts`.

**Verde, nesta ordem:** `npm run typecheck` · `npm test` (2.668, zero falhas) ·
`npm run build` · `npm run montagem:autoteste` ("bancada confiável") ·
`npm run montagem:servidor` · `npm run montagem:servidor -- --completo`.

O financeiro não foi tocado.

### A Edge Function subiu — 04/09/2026

`montar-documento-assinado`, **versão 1**, `verify_jwt: false`,
`ezbr_sha256: 8a2e29f6b460d8b2…`. Deploy pelo CLI
(`npx --yes supabase@latest functions deploy … --no-verify-jwt`).

`verify_jwt: false` é a convenção do fluxo público inteiro — `public-sign-document`,
`public-refuse-document`, `public-signing-upload`, `public-signing-file` e
`pades-sign` são todas assim. A autenticação é o `public_token` do signatário,
conferido dentro da função.

**As três conferências, todas verdes:**

1. **25 de 25 arquivos idênticos ao repositório, byte a byte** (`get_edge_function`
   contra o disco). Os dois blobs de base64 bateram no SHA-256:
   `wordmark.ts` `41eb98dae806`, `logo.ts` `c46130412797`. É a prova contra o
   deploy parcial, que dá 503 em tudo sem deixar linha de erro no banco;
2. **fumaça HTTP** — cada resposta vem do código da própria função, o que só
   acontece se os 24 imports resolveram:

   | Requisição | Resposta |
   |---|---|
   | `GET` | `405 Method not allowed` |
   | `OPTIONS` | `200 ok` (preflight) |
   | `POST` com JSON quebrado | `400 JSON inválido` |
   | `POST {}` | `400 token é obrigatório` |
   | `POST` com token inexistente | `403 Token inválido` |

   A última é a mais forte: para chegar nela a função leu as variáveis de
   ambiente, criou o cliente e **consultou `signature_signers` no banco**;
3. **`query_logs`** em `function_logs`: nenhum `boot error`.

**Duas armadilhas do deploy, para não custarem tempo de novo:**

- o `functions deploy` devolveu **`401 Unauthorized` DEPOIS de listar os 25
  assets** — o bundling funciona e quem recusa é a chamada final. `npx supabase
  login` **não resolve** (já medido em 02/09). A saída é `SUPABASE_ACCESS_TOKEN=…`
  na mesma linha;
- `WARN: Skipping import path outside source root: /selo-de-integridade.crt` é
  **inofensivo**: não é import, é a constante `SELO_URL_DO_CERTIFICADO` de
  `selo.ts`, que a análise estática do CLI confundiu. O bundle está completo.

### O que falta, na ordem

1. ~~Deploy da Edge Function~~ — **FEITO** em 04/09/2026 (ver acima);
2. **O teste ponta a ponta**, que depende de mim (ver abaixo);
3. **Ligar o `VITE_MONTAGEM_NO_SERVIDOR=true`** no build, depois que o teste
   passar;
4. **Só então** remover a montagem do cliente e a `public-signing-upload`.

### O que precisa de deploy

| O quê | Onde | Estado |
|---|---|---|
| `montar-documento-assinado` + `_shared/montagem/` | Supabase Edge Functions | **no ar** (v1, `verify_jwt:false`, 25/25 conferidos byte a byte) |
| `signature-freeze-source` | Supabase Edge Functions | no ar (versão 1) |
| as duas migrations do congelamento | banco | aplicadas em 03/09/2026 |
| `PUBLIC_APP_ORIGIN` | secrets da função | conferir se já está definido — sem ele, o QR usa `https://jurius.com.br` |
| `VITE_MONTAGEM_NO_SERVIDOR` | build do front | **não ligar ainda** |

### Os testes que dependem do usuário, no CRM

Nenhum dos dois pode ser feito daqui: um precisa de envelope real, o outro de
navegador de verdade.

**1. `[[ASSINATURA]]` ponta a ponta.** Criar um envelope pelo assistente com um
`.docx` que tenha `[[ASSINATURA]]` no corpo e conferir, na ordem:

- o PDF congelado **não mostra** o texto `[[ASSINATURA]]` na folha;
- `signature_fields` ganhou uma linha com o `signer_id` certo, na página e na
  posição onde o marcador estava;
- ao assinar, a rubrica cai **ali**, e não no rodapé (o rodapé é o *fallback*, e
  vê-lo é o sinal de que a posição se perdeu);
- com dois signatários e `[[ASSINATURA]]` + `[[ASSINATURA_2]]`, cada rubrica no
  seu lugar — este é o caso que o `colocacaoDeAssinatura.ts` existe para
  proteger.

**2. A paginação DOCX — a comparação que nunca foi feita.** O `ConvertToPdf` do
`docs.jurius-api.com` pagina por conta própria, e o `docxToPdf` (motor
`preview`) pagina como a tela de posicionamento. **Uma quebra em lugar diferente
move o campo da página 3 para a 4, e a assinatura sai no lugar errado de um
documento jurídico — defeito que só aparece depois de assinado.** É por isso que
o congelamento está fixo em `preview` hoje.

O lado B só sai de um navegador de verdade:

- abrir `/montagem-lab.html` **no Chrome** (no navegador embutido o
  `page.render` do pdf.js não resolve — a mesma armadilha do `docx-pdf-lab.html`);
- converter `tmp/pdfs/kit-trabalhista-source.docx` pelo motor `preview` e salvar;
- comparar contra `tmp/pdfs/kit-servidor-licenciado.pdf` (o mesmo `.docx` pelo
  servidor);
- o parecer que importa é **a contagem de páginas e onde cada quebra cai**, não
  a porcentagem de pixel: são aparências diferentes (rasterizado × vetorial) e a
  bancada vai acusar diferença com razão.

**3. E o teste do interruptor**, quando a função estiver no ar: abrir um envelope
**novo** (nunca assinado — envelope já assinado pelo navegador tem ponteiro
gravado, e a função devolve o artefato antigo, como deve) com
`?montagem=servidor` no fim do link, e conferir no console
`[PER-DOC] montado NO SERVIDOR`. Se aparecer `servidor não monta … —
sem_original_congelado`, o envelope não passou pelo congelamento; se aparecer
`montagem no servidor FALHOU`, é a função — e aí o log dela diz o resto.
