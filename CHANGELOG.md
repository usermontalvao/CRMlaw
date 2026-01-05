# Changelog

## 1.9.61
- **Processos (Mapa de Fases)**: adicionada visão em formato de **mapa** por etapas (ex.: Conciliação, Instrução, etc.). Ao clicar em uma fase, o sistema lista os processos daquela etapa com busca e atalhos para abrir detalhes/timeline.

## 1.9.60
- **Processos (Timeline Geral)**: adicionada **Linha do Tempo Geral** (feed unificado) para buscar publicações/movimentações dos processos sincronizadas do DJEN, com busca por cliente/número/órgão/texto e atalho para abrir o processo ou a timeline completa.

## 1.9.59
- **Notificações (Assinatura)**: corrigida duplicação de notificações/popups de assinatura; agora a assinatura gera **apenas 1 notificação** (documento totalmente assinado), com dedupe por `request_id`.
- **Database (Trigger)**: trigger `notify_on_signature` tornado **idempotente** para evitar inserts duplicados ao concluir assinatura.
- **Build**: corrigido erro TypeScript (`TS18047: x is possibly 'null'`) no `PetitionEditorModule.tsx`.

## 1.9.58
- **Assinatura (PDF)**: atualizado o texto da **validade jurídica** (MP 2.200-2/2001) na página de registro de assinatura do PDF, com redação mais completa e formal.

## 1.9.57
- **Assinatura (OTP por E-mail)**: padronizadas as cores do fluxo (botões e destaques) para o **tema laranja** do projeto.

## 1.9.56
- **Assinatura (OTP por E-mail)**: melhorado o **template do e-mail** (layout mais compatível com clientes como Gmail/Outlook) e padronizado para as **cores do projeto**.
- **Assinatura (OTP por E-mail)**: melhorias visuais no modal de autenticação (animações/feedback de envio e validação).

## 1.9.55
- **Assinatura (OTP por E-mail)**: ajustadas as Edge Functions para **não retornarem status HTTP de erro** (sempre `200` com `{ success: false, error }`), evitando o erro genérico "Edge Function returned a non-2xx status code" no frontend.

## 1.9.54
- **Assinatura (OTP por E-mail)**: corrigida a etapa **“Continuar com E-mail”** que ficava em branco no modal; incluída a renderização da etapa `email_otp`.

## 1.9.53
- **Assinatura (Código por E-mail)**: adicionado novo método de autenticação por **código via e-mail (OTP)** usando SMTP (Hostinger), com Edge Functions `email-send-otp` / `email-verify-otp` e persistência em `signature_email_otps`.

## 1.9.52
- **Preencher (Validação Telefone/WhatsApp)**: o campo de telefone/WhatsApp agora exige **11 dígitos** (DDD + 9) e não permite avançar com 10 dígitos.

## 1.9.51
- **Processos (Timeline Profissional)**: redesign completo da linha do tempo inline com cards individuais, layout limpo e espaçado, ícones maiores, melhor hierarquia visual, badges refinados e botão de detalhes mais claro.

## 1.9.50
- **Intimações (IA via Cron)**: desativada a análise de IA no frontend; o módulo agora apenas exibe análises **salvas no banco** (geradas via Edge/Cron), evitando consumo repetido ao abrir.

## 1.9.49
- **Processos (IA Persistente)**: Edge Function `analyze-intimations` agora salva a análise também em `djen_comunicacoes.ai_analysis`, permitindo que a timeline consuma a análise do banco e reanalise **apenas** quando chegar nova movimentação.

## 1.9.48
- **Processos (Timeline Inline)**: melhorias na linha do tempo no card: exibe **data completa + hora**, **órgão/tribunal**, permite **expandir detalhes** e inclui **botão de atualizar**; layout refinado e classes Tailwind ajustadas para evitar falhas de build.

## 1.9.47
- **Processos (Edge Function)**: nova Edge Function `update-process-status` para atualização automática de status dos processos via cron, sem necessidade de abrir o navegador.
- **Processos (Timeline Inline)**: linha do tempo agora é exibida diretamente no card do processo (expansível/recolhível), sem necessidade de abrir modal.
- **Processos (Alerta Inteligente)**: sistema detecta e alerta quando um processo arquivado ainda possui prazos pendentes, exibindo notificação visual no módulo.
- **Processos (Timeline Desktop)**: ao clicar na linha da tabela, a timeline expande abaixo da linha ao invés de abrir modal.

## 1.9.45
- **Peticionamento (Blocos)**: removida a **numeração automática** na listagem de blocos.

## 1.9.44
- **Peticionamento (Busca de Blocos)**: resultados agora exibem **todas as tags** e uma **porcentagem de match**; ao clicar em um item, abre o **View do bloco** com a opção **Adicionar no documento** (não insere automaticamente).

## 1.9.43
- **Peticionamento (Busca de Blocos)**: busca refinada no modal (ignora stopwords como "de/da/do", suporta frase exata com aspas e aplica filtro/ranking mais estrito priorizando título/tags, reduzindo resultados genéricos).

## 1.9.42
- **Peticionamento (Pré-visualização de Blocos)**: container do `docx-preview` agora permanece montado durante o carregamento (com overlay), evitando fallback e garantindo renderização correta por **parágrafos/páginas**.

## 1.9.41
- **Peticionamento (Pré-visualização de Blocos)**: ajustado CSS do `docx-preview` no modo *view* para restaurar **quebras de linha** e **espaçamento entre parágrafos**, evitando texto "colado".

## 1.9.40
- **Peticionamento (Pré-visualização de Blocos)**: visualização agora renderiza o conteúdo via **DOCX (gerado a partir do SFDT) + docx-preview**, garantindo exibição do documento no modo *view* sem travar na geração de PDF.

## 1.9.39
- **Peticionamento (Pré-visualização de Blocos)**: tentativa inicial de renderização via PDF gerado a partir do SFDT.

## 1.9.38
- **Peticionamento (Editor de Blocos)**: botão de editar bloco reexibido na lista lateral (ícone lápis).
- **Peticionamento (Editor de Blocos)**: reforço visual A4 no modal (largura total, folha centralizada, sombra/borda) e altura do editor ampliada para 520px.
- **Peticionamento (Syncfusion)**: margens mínimas com dimensões A4 aplicadas ao editor do modal para manter proporção real de página.

## 1.9.36
- **Peticionamento (Editor de Blocos)**: restauradas declarações de estado/refs do modal de blocos (corrige build e exibição do editor).
- **Peticionamento (Syncfusion)**: corrigido ajuste de layout que usava `pageWidth` como string, evitando falha silenciosa na inicialização do editor.

## 1.9.35
- **Peticionamento (Editor de Blocos)**: corrigido problema de largura reduzida do editor SFDT no modal. Removido layout grid que limitava a largura e adicionados CSS mais fortes para garantir 100% de ocupação do espaço disponível.

## 1.9.34
- **Peticionamento (Editor de Blocos)**: corrigido problema de largura reduzida do editor SFDT no modal. Agora o editor ocupa 100% da largura disponível, eliminando o espaço em branco à direita.

## 1.9.33
- **Peticionamento (Editor de Blocos)**: corrigido carregamento do conteúdo SFDT no modal de edição de blocos. Agora o conteúdo é carregado automaticamente quando o modal abre.
- **Peticionamento (Pré-visualização)**: melhorada extração de texto SFDT com suporte a quebras de parágrafo e fallback mais robusto.

## 1.9.32
- **Peticionamento (Tags Inteligentes)**: reformulada lógica de sugestão para ser estritamente baseada em termos jurídicos. O sistema agora ignora palavras aleatórias e foca em uma base de dados de mais de 100 termos e expressões jurídicas (ex: "nexo causal", "estabilidade gestante", "litispendencia").
- **Peticionamento (Sincronização)**: implementada detecção de mudanças no editor de blocos em tempo real, permitindo que as sugestões de tags se adaptem instantaneamente ao texto que está sendo digitado.

## 1.9.31
- **Peticionamento (Tags Inteligentes)**: sistema de sugestão de tags agora é 100% dinâmico, analisando o título e conteúdo do bloco em tempo real para sugerir termos jurídicos relevantes.
- **Peticionamento (Editor de Blocos)**: corrigido problema onde o conteúdo aparecia espremido/com wrap excessivo nos modais; implementado `ResizeObserver` e ajuste automático de margens para garantir 100% de largura.
- **Peticionamento (Pré-visualização)**: melhorada a extração de texto de arquivos SFDT (Syncfusion) para evitar a mensagem "Pré-visualização indisponível".
- **Database**: migration para garantir a existência da coluna `order` na tabela `petition_blocks`, resolvendo erros 400 na API.

## 1.9.30
- **Peticionamento (Supabase/Erros)**: corrigido acesso ao usuário no service (getUser async) e leitura do modelo padrão com `maybeSingle()` para evitar 406 quando não há registro; melhorada detecção de ausência da coluna `document_type` para evitar 400 repetidos.

## 1.9.29
- **Peticionamento (Modelo Padrão)**: migrado do localStorage para Supabase; agora o modelo é salvo no banco e sincronizado entre dispositivos, com fallback para localStorage em caso de falha.
- **Database**: adicionada tabela `petition_default_templates` com RLS para armazenar modelo padrão por usuário.

## 1.9.27
- **Peticionamento (Otimização Supabase)**: salvamento instantâneo limitado (throttle) para evitar múltiplos saves durante digitação e refresh das petições via realtime com debounce para reduzir leituras.

## 1.9.26
- **Peticionamento (Header)**: removido indicador visual do auto-salvamento e estabilizado layout para não deslocar o chip do cliente quando o status "Atualizado" muda.
- **Build**: restaurado `package.json` (arquivo estava vazio), evitando quebra do projeto.

## 1.9.23
- **Peticionamento (Histórico/Recentes)**: abrir documento com 1 clique e indicador de carregamento "Abrindo..." com bloqueio durante a abertura.

## 1.9.22
- **Peticionamento (Online-only)**: editor passa para modo leitura quando offline e bloqueia salvamentos/edições; adicionada proteção contra perda por navegação (alerta ao sair e salvamento best-effort ao ocultar/fechar a aba).

## 1.9.21
- **Peticionamento (Salvamento)**: adicionado salvamento instantâneo (debounce) e autosave contínuo, com proteção para não salvar durante carregamento e bloqueio de múltiplos cliques ao abrir petições (estado "Abrindo...").

## 1.9.20
- **Peticionamento (Auto-salvamento)**: corrigido bug onde o indicador ficava em "Auto-salvando em 30s" e não executava o salvamento automático (timer estabilizado com refs e execução via handler único).

## 1.9.19
- **Peticionamento (Auto-salvamento)**: implementado salvamento automático a cada 30 segundos quando há alterações não salvas e cliente selecionado. Indicador visual mostra contador regressivo ("Auto-salvando em Xs") e status em tempo real.

## 1.9.18
- **Assinaturas ↔ Requerimentos**: correção do vínculo automático do requerimento criado via assinatura (persistência do `signature_id` até o momento do salvar), garantindo exibição do badge "Requerimento Criado".

## 1.9.17
- **Assinaturas ↔ Requerimentos**: integração automática - ao criar requerimento a partir da assinatura, o badge "Requerimento Criado" agora aparece automaticamente no card.

## 1.9.16
- **Assinaturas (Cards)**: indicadores visuais para processo e requerimento criados a partir da assinatura (badges coloridos nos cards).

## 1.9.15
- **Assinaturas (Detalhes)**: botões "Abrir processo" e "Requerimento" agora em estilo de texto (sem fundo), com ícones e hover effects, seguindo o padrão de links estilizados.

## 1.9.14
- **Assinaturas (Detalhes)**: botões "Criar processo" e "Requerimento" agora mais compactos (padding reduzido, fonte menor e ícones ajustados).

## 1.9.13
- **Assinaturas (Detalhes)**: ajuste fino nos botões "Criar processo" e "Requerimento" para fundo mais claro (neutral-700), com bordas definidas e ícones brancos, melhorando a definição visual.

## 1.9.11
- **Assinaturas (Detalhes)**: fidelização total do design dos botões "Criar processo" e "Requerimento" (fundo dark #333333, ícones brancos e ajuste de pesos de fonte).

## 1.9.10
- **Assinaturas (Detalhes)**: refinamento final do design dos botões de ação (Top e Bottom), garantindo que todos utilizem cantos `rounded-xl`, cores vibrantes e o novo padrão visual dark para ações secundárias.

## 1.9.09
- **Assinaturas (Detalhes)**: botões "Processo" e "Requerimento" agora utilizam fundo escuro e texto branco, seguindo o novo padrão visual de destaque secundário.

## 1.9.08
- **Assinaturas (Detalhes)**: refinamento do design das ações de Processo e Requerimento (botões lado a lado com estilo modernizado).

## 1.9.07
- **Assinaturas (Detalhes)**: modal de detalhes mais compacto e ações de Processo/Requerimento reposicionadas abaixo dos botões principais (mais discretas).

## 1.9.06
- **Assinaturas (Estabilidade)**: corrigido erro que quebrava o módulo de Assinaturas (referência a `detailsRequest` antes da inicialização).

## 1.9.05
- **Assinaturas (Detalhes)**: botão "Processo" agora abre fluxo de criação quando não há processo vinculado (status "Aguardando Confecção" com seleção de área).

## 1.9.04
- **Assinaturas (Detalhes)**: quando não há processo vinculado, agora permite selecionar a área e criar um Processo com status "Aguardando Confecção".

## 1.9.03
- **Assinaturas (Detalhes)**: corrigido botão "Abrir processo" (fallback por número do processo) e ajustes no layout dos botões.

## 1.9.02
- **Assinaturas (Detalhes)**: após assinar, adicionados atalhos para abrir o Processo vinculado e iniciar um Requerimento Administrativo (a confeccionar).

## 1.9.01
- **Assinatura (Login Google)**: ajustado selo "Recomendado" para não sobrepor o botão do Google.

## 1.9.00
- **Assinatura (Login Google)**: adicionado selo "Recomendado" na opção "Fazer Login com o Google".

## 1.8.99
- **Assinatura (PDF)**: ajustada escala da assinatura para 1.5x (meio termo entre muito pequena e muito grande).

## 1.8.98
- **Assinatura (DOCX)**: corrigido problema onde documentos DOCX assinados mostravam apenas o relatório de assinatura; agora gera o documento completo com a assinatura.

## 1.8.97
- **Assinatura (PDF)**: corrigido tamanho excessivo da assinatura no documento final; removida escala 2x que causava assinaturas muito grandes.

## 1.8.96
- **Editor de Petições (Recentes)**: adicionado botão de excluir em cada item da lista de Recentes com confirmação via modal de cálculo.
- **Clientes (Detalhes)**: adicionada seção "Petições vinculadas" com opção de abrir e excluir petições do cliente.

## 1.8.95
- **Editor de Petições (Documento padrão)**: melhoria na persistência; quando o navegador não consegue salvar (armazenamento cheio), o sistema avisa e mantém fallback em memória para a sessão.

## 1.8.94
- **Editor de Petições (Documento padrão)**: ao importar um arquivo Word, o documento passa a ser salvo como "Documento padrão", permitindo que "Novo → Documento padrão" carregue o template selecionado.

## 1.8.93
- **Clientes (Detalhes)**: seção "Documentos/Contratos assinados" agora exibe item "Vinculado" e organiza documentos em "Assinados" e "Gerados", com mensagem de vazio exibida abaixo.

## 1.8.92
- **Editor de Petições (Tela Inicial)**: corrigido o atalho "Novo → Documento padrão" para carregar o template cadastrado (aguarda editor estar pronto e evita falha silenciosa).

## 1.8.91
- **Editor de Petições (Tela Inicial)**: ajuste na exibição do nome do usuário para capitalização correta (ex.: "Pedro" em vez de "pedro").

## 1.8.90
- **Editor de Petições (Salvamento)**: salvamento (manual e automático) permitido apenas com cliente vinculado; documentos antigos sem vínculo são removidos automaticamente.
- **Editor de Petições (Tela Inicial)**: botão "Documento padrão" em "Novo" volta a carregar corretamente o template.
- **Editor de Petições (Tela Inicial)**: saudação passa a exibir o nome do usuário logado.

## 1.8.89
- **Editor de Petições (Recentes)**: corrigido bug onde múltiplos cliques ao abrir um documento recente podiam carregar vazio e disparar salvamento automático em branco.
- **Editor de Petições (Tela Inicial)**: renomeado atalho "Modelo" para "Documento padrão".

## 1.8.88
- **Editor de Petições (Tela Inicial)**: adicionados atalhos "Modelo" e "Importar arquivo" em "Novo".
- **Editor de Petições (Recentes)**: confirmação de exclusão agora mostra detalhes (documento/cliente/total) como nos demais módulos.

## 1.8.87
- **Editor de Petições (Tela Inicial)**: exibe nome do usuário logado (sem e-mail), adiciona botões de minimizar/fechar (widget) e mostra Recentes com arquivo + cliente vinculado.

## 1.8.86
- **Editor de Petições (Salvamento)**: documentos passam a ser salvos apenas quando há cliente vinculado (autosave e salvar manual).
- **Editor de Petições (Recentes)**: adicionada ação para excluir todos os documentos salvos e listagem de recentes agora considera apenas itens com cliente.

## 1.8.85
- **Editor de Petições (UI)**: tela inicial (abertura) remodelada em estilo Word (Novo/Recentes) e exibição do nome do usuário.

## 1.8.84
- **Editor de Petições (Blocos)**: cabeçalho agora é inserido sem numeração (sem prefixo "1 - "), mantendo o cabeçalho limpo.

## 1.8.83
- **Editor de Petições (Blocos)**: corrigido erro 400 ao listar blocos no Supabase (coluna `order` agora é referenciada corretamente na ordenação).
- **Editor de Petições (Syncfusion)**: mitigados crashes/intermitências do ruler/selection quando o documento ainda não está inicializado.
- **Editor de Petições (Blocos/Performance)**: placeholders do cliente passam a ser processados antes da inserção (sem `replaceAll` no editor principal), reduzindo travamento/lag após inserir bloco.

## 1.8.82
- **Editor de Petições (Performance)**: solução definitiva para o travamento de digitação após inserir bloco. Agora os dados do cliente (placeholders) são substituídos diretamente no código (SFDT) antes da colagem, eliminando 12 operações pesadas de substituição no editor que congelavam a interface.
- **Editor de Petições (UI)**: reforçado estado editável e atualização de layout (repaint) no foco do editor.

## 1.8.81
- **Editor de Petições (Blocos)**: simplificado mecanismo de foco após inserir bloco para resolver bug de edição travada (focusIn + moveToDocumentEnd).

## 1.8.80
- **Editor de Petições (Blocos)**: foco do editor agora força atualização/repaint do viewer após inserir bloco, evitando precisar rolar a página para o texto digitado aparecer.

## 1.8.79
- **Editor de Petições (Blocos)**: corrigido travamento/atraso de digitação após inserir bloco, executando as substituições (placeholders do cliente) de forma assíncrona e fatiada.

## 1.8.78
- **Editor de Petições (Blocos)**: numeração automática (1 - , 2 - , etc.) agora é inserida antes do conteúdo do bloco.
- **Editor de Petições (Blocos)**: corrigido bug de digitação travada/lenta após inserir bloco (foco melhorado com múltiplas tentativas).

## 1.8.77
- **Editor de Petições (Blocos)**: numeração/ordem dos blocos voltou a aparecer na lista.
- **Editor de Petições (Blocos)**: após inserir um bloco, o foco retorna ao editor para permitir edição imediata.

## 1.8.76
- **Editor de Petições (Toolbar)**: removido item `Break` da toolbar.

## 1.8.75
- **Editor de Petições (Toolbar/Layout)**: toolbar volta com itens de ação (header/footer/page setup/page number/TOC/bookmark/break) e agora não quebra linha; usa scroll horizontal interno para preservar a altura e aumentar a área de edição.

## 1.8.74
- **Editor de Petições (Toolbar/Layout)**: removida a formatação de texto da toolbar (mantida apenas no painel lateral TEXT) e toolbar enxugada para evitar empurrar/afastar o documento.

## 1.8.73
- **Editor de Petições (Toolbar/Layout)**: removidos itens não essenciais da toolbar (page setup/number, comentários, track changes, restrict editing, campos, bookmark/TOC etc.) para reduzir largura e evitar que o documento seja empurrado/afastado.

## 1.8.72
- **Editor de Petições (Toolbar)**: corrigido crash do Syncfusion ao adicionar botões de formatação; itens de formatação agora são botões custom com ação via `toolbarClick` (negrito/itálico/sublinhado e alinhamento).

## 1.8.71
- **Editor de Petições (Toolbar)**: adicionadas opções de formatação diretamente na barra superior (negrito/itálico/sublinhado, fonte/tamanho, cor/highlight, alinhamento, listas, indentação e espaçamento).

## 1.8.70
- **Editor de Petições (UI)**: toolbar ultra-compacta (altura 22px, ícones 12px, padding mínimo) para caber em 100% de zoom sem precisar reduzir.

## 1.8.69
- **Editor de Petições (UI)**: toolbar superior compactada (aprox. metade) com botões menores e labels ocultos (mantendo ícones), para caber melhor em 100% de zoom.

## 1.8.68
- **Editor de Petições (UI)**: toolbar superior do editor (Syncfusion) ajustada para não compactar em 100% de zoom, permitindo quebra em múltiplas linhas (wrap) e altura automática.

## 1.8.67
- **Editor de Petições (UI)**: painel de formatação (TEXT) agora possui modo colapsado (aba fina), expandindo ao passar o mouse e com botão para fixar aberto/fechado.

## 1.8.66
- **Editor de Petições (UI)**: painel de formatação (TEXT) reduzido ainda mais para caber melhor em 100% de zoom (padrão ~180px, mínimo 160px).

## 1.8.65
- **Editor de Petições (UI)**: ajustados os limites do painel de formatação (TEXT) para manter "metade" da largura com usabilidade (padrão ~220px, mínimo 180px) e evitar painel estreito demais.

## 1.8.64
- **Editor de Petições (UI)**: painel de formatação (TEXT) reduzido para aproximadamente metade da largura para melhorar a visualização da folha em 100% de zoom.
- **Editor de Petições (UI)**: reset do tamanho antigo do painel (chave do `localStorage` atualizada) para garantir que a nova largura padrão seja aplicada.

## 1.8.63
- **Editor de Petições (Layout 100% Zoom - Correção Definitiva)**: reescrito CSS do editor com estrutura flexbox correta para funcionar em 100% de zoom:
  - **Diagnóstico**: O problema era causado por `min-width` implícito nos containers flex do Syncfusion e o Navigation Pane ativo criando gap à esquerda
  - **Solução**: 
    - Wrapper com `flex: 1 1 0%` e `min-width: 0` para permitir encolhimento
    - Container principal com `max-width: 100%` e `overflow: hidden`
    - Viewer com `flex: 1 1 auto` e `min-width: 0` para caber no espaço disponível
    - Properties Pane com largura responsiva (320px → 260px conforme resolução)
    - Navigation Pane desabilitado via prop e CSS
  - **Resultado**: Editor totalmente utilizável em 100% zoom sem scroll horizontal, com folha centralizada e painel TEXT sempre acessível
  - Testado para resoluções: 1366px, 1440px, 1920px

## 1.8.62
- **Editor de Petições (Layout Definitivo 100% Zoom)**: corrigido conflito de CSS com layout nativo do Syncfusion. O editor agora funciona perfeitamente em 100% de zoom sem hacks:
  - Folha alinhada naturalmente à esquerda (próxima ao painel de blocos)
  - Painel de formatação (TEXT) sempre visível e acessível à direita
  - Sem scroll horizontal desnecessário
  - Responsividade automática para diferentes resoluções (1366/1440/1920px)
  - CSS limpo que respeita o gerenciamento de layout interno do Syncfusion

## 1.8.59
- **Editor de Petições (Layout Final)**: corrigida usabilidade em 100% zoom. A folha agora fica alinhada à esquerda (perto dos blocos) e o painel de formatação (TEXT) permanece fixo e visível à direita, sem ser empurrado para fora da tela.

## 1.8.58
- **Editor de Petições (Layout/Zoom 100%)**: ajustado flex do Syncfusion para manter painel de formatação acessível em 100% e aproximar a folha do painel de blocos (sem precisar reduzir zoom).

## 1.8.57
- **Editor de Petições (Layout/Usabilidade)**: removidos overrides de CSS que desbalanceavam a visualização em 100% e garantido painel de formatação do Syncfusion visível (fonte, tamanho, etc).

## 1.8.56
- **Editor de Petições (Layout)**: folha alinhada à esquerda (junto ao painel de blocos) + painel de formatação (fonte, tamanho, etc) visível à direita.

## 1.8.55
- **Editor de Petições (UI)**: restaurado painel de formatação (Properties Pane) do Syncfusion no lado direito após ajuste de alinhamento da folha.

## 1.8.54
- **Editor de Petições (Layout)**: ajuste fino para ficar exatamente como antes (folha mais próxima do painel, removida centralização excessiva do canvas).

## 1.8.53
- **Editor de Petições (Layout)**: ajustado alinhamento da folha no Syncfusion para ficar mais à direita (mais próximo do painel lateral), reduzindo espaço vazio.

## 1.8.52
- **Editor de Petições**: corrigido erro "Editor não disponível" ao carregar petição da tela inicial (agora carrega conteúdo após editor estar pronto).

## 1.8.51
- **Editor de Petições**: corrigidos erros de compilação e restauradas funções essenciais (savePetition, loadPetition, newPetition, insertBlock, deleteBlock, saveBlock, exportToWord, handleImportTemplate).
- **Editor de Petições - Realtime**: lista "Recentes" atualiza automaticamente a cada 15s (tick) e via Supabase Realtime (postgres_changes).
- **Editor de Petições - Save**: update otimista ao salvar - lista "Recentes" reflete imediatamente sem precisar F5.

## 1.8.50
- **Editor de Petições - Blocos**: corrigida numeração automática "N –" ao inserir blocos (agora incrementa corretamente: 1, 2, 3... e reseta ao criar/carregar documento).

## 1.8.49
- **Editor de Petições - Blocos**: inserção de blocos agora respeita a posição atual do cursor (não altera seleção ao calcular numeração e não força mover o cursor para o fim).

## 1.8.48
- **Editor de Petições - Blocos**: numeração automática "N –" ao inserir blocos agora ignora a categoria "cabecalho".

## 1.8.47
- **Editor de Petições - Blocos**: ao inserir um bloco no editor, agora é adicionado automaticamente um prefixo com numeração no formato "N –" (ex.: "1 – ", "2 – ").

## 1.8.46
- **Editor de Petições - Blocos (Tags)**: tags ficaram mais inteligentes, priorizando expressões jurídicas (ex.: "acumulo de funcao", "aviso previo cumprido") e melhorando o fallback quando IA não retornar boas tags.

## 1.8.45
- **Editor de Petições - Blocos**: reduzidas requisições 400 repetidas quando `document_type` ainda não existe no banco (service desativa automaticamente o uso do filtro após detectar PGRST204).

## 1.8.44
- **Editor de Petições - Blocos**: `createBlock` agora tem fallback quando a coluna `document_type` ainda não existe no banco (evita erro PGRST204/400 e permite criar blocos até aplicar a migration).

## 1.8.43
- **Editor de Petições - Blocos (Sidebar)**: categorias agora iniciam recolhidas (fechadas) por padrão.

## 1.8.42
- **Editor de Petições - Categorias de Blocos**: corrigida migration de categorias (erro SQL 42601 por conflito de dollar-quote em `DO $$`).
- **Editor de Petições - UX**: confirmações de "alterações não salvas" agora informam qual documento/cliente está pendente antes de continuar.

## 1.8.41
- **Editor de Petições - Categorias de Blocos**: categorias agora são configuráveis por tipo de documento (petição/contestação/impugnação/recurso), com persistência no banco.
- **Editor de Petições - Categorias de Blocos**: adicionada tela/modal "Configurar categorias" para editar nomes e ordem das seções exibidas na sidebar.
- **Editor de Petições - Categorias de Blocos**: removida restrição rígida (CHECK) de `petition_blocks.category` para permitir categorias diferentes por tipo.

## 1.8.40
- **Editor de Petições - Blocos**: blocos agora são separados por tipo de documento (petição/contestação/impugnação/recurso) via campo `document_type` e filtro na interface.

## 1.8.39
- **Editor de Petições - Blocos (Sidebar)**: busca "Buscar bloco..." agora filtra por tags/título/conteúdo e aceita múltiplos termos separados por vírgula.
- **Editor de Petições - Blocos (Sidebar)**: tags do bloco passam a ser exibidas abaixo do título.

## 1.8.38
- **Editor de Petições - Blocos**: corrigido modal "Visualizar Conteúdo" (evita tela em branco aguardando o editor inicializar e usando fallback para texto quando necessário).
- **Editor de Petições - Blocos**: tags agora aparecem na lista de blocos e são derivadas automaticamente para blocos antigos sem tags persistidas.
- **Editor de Petições - Blocos**: fallback de palavras-chave melhorado quando IA estiver indisponível (extração básica a partir de título+conteúdo).

## 1.8.37
- **Editor de Petições - Blocos**: adicionadas palavras-chave (tags) automáticas para facilitar encontrar blocos por contexto (ex.: "horas extras, rescisão indireta"), com geração via IA quando habilitada e fallback heurístico.
- **Editor de Petições - Blocos**: busca agora considera título + conteúdo + tags e aceita múltiplos termos separados por vírgula.

## 1.8.36
- **Editor de Petições - Blocos/Clientes**: seção "qualificação" foi renomeada na interface para "DAS QUESTÕES INICIAIS".

## 1.8.35
- **Editor de Petições - Blocos**: melhorada performance após inserir bloco formatado (placeholders são substituídos no fragmento antes de colar, evitando replaceAll global que gerava lentidão).

## 1.8.34
- **Editor de Petições - Blocos**: inserção de blocos volta a preservar formatação usando conversão segura de SFDT para fragmento antes de colar no editor (fallback para texto quando necessário).

## 1.8.33
- **Editor de Petições - Endereçamento**: ao selecionar/inserir qualificação do cliente, preenche automaticamente "DA COMARCA DE" com cidade-UF quando estiver em branco.

## 1.8.32
- **Editor de Petições - Buscar Empresa (CNPJ)**: ao inserir no editor, o nome da empresa (fantasia/razão social) é aplicado em negrito real.

## 1.8.31
- **Editor de Petições - Buscar Empresa (CNPJ)**: qualificação ajustada (e-mail em minúsculo, telefones deduplicados e rótulo 'telefones' quando houver mais de um).

## 1.8.30
- **Editor de Petições - Buscar Empresa (CNPJ)**: consulta BrasilAPI + OpenCNPJ e usa IA para compilar/normalizar os dados (ex.: e-mail pode vir de uma fonte e não da outra).

## 1.8.29
- **Editor de Petições - Clientes**: qualificação agora insere o nome do cliente em negrito real (sem '**' literal).

## 1.8.28
- **Editor de Petições - Blocos**: endurecida extração de texto do SFDT (inclui 'tlp') para evitar inserção de JSON/SFDT cru no editor.
- **Editor de Petições - Blocos**: modal 'Visualizar Conteúdo' evita exibir JSON cru e mostra mensagem quando não for possível gerar preview.

## 1.8.27
- **Editor de Petições - Blocos**: melhorada extração de texto de SFDT (inclui chave 'tlp') para evitar inserção de JSON cru.
- **Editor de Petições - Blocos**: modal 'Visualizar Conteúdo' exibe mensagem quando não for possível gerar preview.

## 1.8.26
- **Editor de Petições - Blocos**: corrigido bug crítico onde pasteSfdt corrompia o estado do editor Syncfusion causando erros em cascata. Agora blocos são inseridos como texto puro para maior estabilidade.

## 1.8.25
- **Editor de Petições - Blocos**: corrigido bug onde bloco era inserido no topo do documento em vez de na posição do cursor.
- **Editor de Petições - Blocos**: melhorado foco no elemento editável após inserir bloco para permitir digitação imediata.

## 1.8.24
- **Editor de Petições - Blocos/Clientes**: corrigido bug onde texto digitado ficava em buffer invisível e só aparecia após colar (forçado resize do editor para re-render).

## 1.8.23
- **Editor de Petições - Blocos/Clientes**: corrigido bug onde após inserir bloco o editor aceitava colar mas não aceitava digitação direta (forçado foco no elemento editável interno).

## 1.8.22
- **Editor de Petições - Blocos/Clientes**: após inserir bloco ou qualificação, o cursor é movido para o final do conteúdo inserido, permitindo digitar imediatamente.

## 1.8.21
- **Editor de Petições - Blocos/Clientes**: após inserir bloco ou qualificação do cliente, o foco volta automaticamente para o editor para permitir edição imediata.

## 1.8.20
- **Editor de Petições - Blocos**: modal 'Visualizar Conteúdo' agora exibe fallback em texto quando o Syncfusion renderiza em branco.

## 1.8.19
- **Editor de Petições - Blocos**: melhorada extração de texto do SFDT para preview no modal 'Adicionar Bloco'.
- **Editor de Petições - Blocos**: corrigido modal 'Visualizar Conteúdo' abrindo em branco (fallback para texto quando necessário).

## 1.8.18
- **Editor de Petições - Toolbar**: botão de abrir/fechar painel agora usa ícones de painel (mais distinto do botão de voltar).
- **Editor de Petições - Blocos**: corrigido preview no modal 'Adicionar Bloco' para evitar exibir SFDT/JSON cru.

## 1.8.17
- **Editor de Petições - UI**: corrigido problema onde a interface do Syncfusion estava sobrepondo a toolbar e a sidebar (Blocos/Clientes).

## 1.8.16
- **Editor de Petições - Tela inicial**: adicionado botão 'Excluir temporários' para deletar em lote petições sem vinculação com cliente, com confirmação e feedback.

## 1.8.15
- **Editor de Petições - Tela inicial**: adicionado botão de deletar (lixeira) na lista de documentos recentes, com confirmação e efeito hover.

## 1.8.14
- **Editor de Petições - Auto-save**: salvamento automático agora só ocorre quando a petição está vinculada a um cliente.
- **Editor de Petições - Sidebar**: removida a aba "Salvos".
- **Editor de Petições - Toolbar**: botões de minimizar/fechar do widget movidos para o lado direito.

## 1.8.13
- **Editor de Petições - Toolbar**: adicionado botão 'Voltar para a tela inicial' com ícone ArrowLeft para retornar à start screen (com aviso se houver alterações não salvas).

## 1.8.12
- **Editor de Petições - Tela inicial**: botão X agora fecha o editor inteiro (widget), não apenas a tela inicial.

## 1.8.11
- **Editor de Petições - Tela inicial**: adicionado botão X ao lado de "Ir para o editor" para fechar a tela inicial.

## 1.8.10
- **Editor de Petições - Widget Flutuante**: ao minimizar, o editor agora permanece montado (oculto) para preservar o documento aberto; ao reabrir pelo botão flutuante, retorna ao mesmo documento em vez de voltar para a tela inicial.

## 1.8.9
- **Editor de Petições - Widget Flutuante**: removido o painel flutuante de controles (minimizar/fechar) no canto superior direito para evitar sobreposição na interface; controles permanecem na toolbar do editor.

## 1.8.8
- **Editor de Petições - Tela inicial**: ao criar "Documento em branco" ou aplicar "Modelo padrão", mantém o cliente vinculado quando o editor é aberto a partir de um cliente.
- **Editor de Petições - Widget Flutuante**: ajustado espaçamento da tela inicial para não ficar por baixo dos botões de minimizar/fechar.

## 1.8.7
- **Editor de Petições - Widget Flutuante**: removida a barra superior do widget (nav), mantendo apenas botões flutuantes de minimizar/fechar.
- **Editor de Petições**: adicionada tela inicial estilo Word ao abrir o editor (modelos + recentes), para iniciar documento em branco, aplicar modelo padrão ou abrir recente.

## 1.8.6
- **Editor de Petições - Widget Flutuante**: header agora exibe "Última atualização" (há X) e "Cliente vinculado" do documento aberto.
- **Editor de Petições - Lista de Salvos**: documentos agora mostram tempo relativo de modificação (há X) e cliente vinculado.

## 1.8.5
- **Editor de Petições - Widget Flutuante**: corrigido minimizar para ocultar totalmente o overlay, mantendo apenas o botão flutuante "Editor de Petições".

## 1.8.4
- **Editor de Petições - Widget Flutuante**: o editor agora funciona como um widget flutuante global que pode ser aberto de qualquer módulo sem trocar de rota.
- **Editor de Petições - Persistência**: estado do widget (aberto/minimizado) e contexto do documento são persistidos em localStorage, restaurando automaticamente após refresh da página.
- **Editor de Petições - Integração com Clientes**: botão "Nova Petição" adicionado nas ações rápidas da ficha do cliente, abrindo o editor já vinculado ao cliente selecionado.
- **Editor de Petições - Minimizar**: ao minimizar, o editor vira um botão flutuante no canto inferior direito, permitindo continuar trabalhando em outros módulos.
- **UX**: sidebar não mais oculta ao abrir o editor; navegação permanece visível e funcional.

## 1.8.3
- **Editor de Petições**: corrigido erro de build causado por JSX corrompido/duplicado na seção dos modais (Empresa/Blocos).
- **Editor de Petições**: modais de Empresa/Busca de Bloco/Editor de Bloco reestruturados e estabilizados para evitar conflitos com CSS global (botões e layout).

## 1.8.2
- **Editor de Petições**: busca de empresa por CNPJ agora usa BrasilAPI (dados completos) + OpenCNPJ (complemento, como e-mail) e refina a qualificação via IA quando configurada.

## 1.8.1
- **Editor de Petições**: modais alinhados ao tema do sistema (faixa laranja no topo, tipografia e botões em gradiente).

## 1.8.0
- **Editor de Petições**: modais de "Buscar Empresa" e "Adicionar Bloco" adequados ao tema do sistema (header/footer, botões e inputs padronizados).
- **Editor de Petições**: corrigido render do modal de busca de blocos (empty state vs lista de resultados).

## 1.7.9
- **Editor de Petições**: qualificação de empresa (CNPJ) agora identifica tipo de logradouro (Rua/Avenida/etc.) e ajusta o texto automaticamente ("na Rua...", "na Avenida...").

## 1.7.8
- **Editor de Petições**: qualificação de empresa (CNPJ) agora usa logradouro completo (ex.: "Avenida") e melhor formatação de cidade/CEP.
- **Editor de Petições**: corrigido erro de auto-save em `saved_petitions` (406 / "Cannot coerce...") tornando o update tolerante quando o retorno não vem como objeto único.

## 1.7.7
- **Editor de Petições**: adicionada opção "Buscar empresa..." no menu de contexto (CNPJ) que consulta `api.opencnpj.org`, formata a qualificação e insere no cursor.

## 1.7.6
- **Editor de Petições**: correção de timing na inicialização do Syncfusion para garantir carregamento automático do modelo padrão (fila de ações antes do `created`).

## 1.7.5
- **Editor de Petições**: ao abrir o módulo, o modelo padrão (DOCX) é carregado automaticamente (sem sobrescrever petições já carregadas).

## 1.7.4
- **Editor de Petições**: adicionado modelo padrão (DOCX) com logo/rodapé: ao importar em "Modelo" o arquivo é salvo como padrão e pode ser aplicado via botão "Padrão".

## 1.7.3
- **Editor de Petições**: view de bloco ajustado para modo leitura (Syncfusion) escondendo barra inferior de página/zoom.

## 1.7.2
- **Editor de Petições**: visualização de conteúdo do bloco agora usa Syncfusion (renderização SFDT) em modo somente leitura.

## 1.7.1
- **Editor de Petições**: adicionada opção de visualizar o conteúdo do bloco (modal read-only) diretamente na lista da sidebar.

## 1.7.0
- **Editor de Petições**: corrigido colar do Microsoft Word (evitava atualizar e colava conteúdo antigo) desabilitando `enableLocalPaste`/`LocalClipboard` para forçar uso do clipboard do sistema.

## 1.6.9
- **Editor de Petições**: atalho `Alt+Espaço` abre busca de blocos.
- **Editor de Petições**: busca de blocos agora é tolerante a erro de digitação (fuzzy) e ordena por relevância (prioriza título).

## 1.6.8
- **Editor de Petições**: adicionada opção de excluir bloco diretamente na lista da sidebar.

## 1.6.7
- **Editor de Petições**: corrigido colar conteúdo externo (Ctrl+V) no Syncfusion garantindo `id` único por instância de editor (evita conflitos entre editor principal e modal).

## 1.6.6
- **Editor de Petições**: sidebar de Blocos organizado por seção (hierarquia) em ordem fixa (Trabalhista) e ignorando categorias legadas.
- **Database**: categorias legadas em `petition_blocks` normalizadas para `outros` e constraint de `category` restrito apenas às seções trabalhistas do app.

## 1.6.5
- **Editor de Petições**: inserção de bloco na petição agora preserva formatação (usa `pasteSfdt`) e evita colar o SFDT (JSON) como texto; placeholders do cliente são substituídos via `replaceAll`.

## 1.6.4
- **Database**: corrigido erro `23514` no insert de blocos ajustando o constraint `petition_blocks_category_check` para aceitar as categorias do app (e manter compatibilidade com valores legados).

## 1.6.3
- **Database**: alinhado schema de `petition_blocks` com o app (renomeia coluna `name` -> `title` quando necessário).
- **Database**: corrigido erro de RLS ao inserir blocos (`new row violates row-level security policy`) criando policies permissivas para usuários `authenticated`.

## 1.6.2
- **Database**: corrigido erro `PGRST204: Could not find the 'is_active' column` adicionando colunas faltantes (`is_active`, `is_default`, `order`, `tags`, `category`) na tabela `petition_blocks`.

## 1.6.1
- **Editor de Petições**: modal de Bloco agora força margens mínimas após colar conteúdo (`applyMinimalMargins`), garantindo que o texto ocupe a largura total do editor.

## 1.6.0
- **Editor de Petições**: modal de Bloco agora ocupa largura total no editor (margens mínimas + `FitPageWidth`, reaplicado após mudanças no documento).

## 1.5.9
- **Editor de Petições**: corrigido bug de visualização no modal de Bloco (agora usa `layoutType="Continuous"` para exibir apenas área de texto, sem visual de página A4).

## 1.5.8
- **Editor de Petições**: ao cadastrar seleção como bloco, o SFDT da seleção é capturado no clique do menu de contexto e enviado para o modal, evitando perda de seleção e preservando formatação.

## 1.5.7
- **Editor de Petições**: melhoria de confiabilidade ao cadastrar seleção como bloco (foco no editor do modal + pequeno delay antes de `paste(sfdt)` para preservar formatação).

## 1.5.6
- **Editor de Petições**: ao cadastrar seleção como bloco, preserva formatação inserindo o SFDT da seleção via `editor.paste(sfdt)` (fragmento), sem depender de clipboard.
- **Editor de Petições**: modal de Bloco estabilizado (altura máxima + scroll interno; régua/painel de navegação ocultos no editor do modal).

## 1.5.5
- **Editor de Petições**: corrigido modal de Bloco não puxando conteúdo da seleção (agora usa `getSelectionSfdt()` em vez de clipboard).
- **Editor de Petições**: visual do modal de Bloco melhorado (toolbar escondida, layout mais limpo, espaçamentos ajustados).

## 1.5.4
- **Editor de Petições**: correção de dependência do useEffect para inicialização do modal de Bloco.

## 1.5.3
- **Editor de Petições**: modal de Bloco ajustado (mais largo e menos alto).
- **Editor de Petições**: corrigida oscilação/loop que ficava alterando estado de Undo no modal (inicialização do editor ocorre 1x por abertura).
- **Editor de Petições**: melhoria no copiar/colar da seleção para o modal (tentativa via APIs `selection` e `editor` do Syncfusion; mantém botão "Colar com formatação" quando necessário).

## 1.5.2
- **Editor de Petições**: interface padronizada para "Blocos" (remoção de textos residuais de "Cláusulas").
- **Editor de Petições**: cadastro/edição de bloco agora usa **Syncfusion** no modal e salva conteúdo em **SFDT**.
- **Editor de Petições**: ao cadastrar seleção como bloco, o sistema tenta colar com formatação; se o navegador bloquear a colagem automática, exibe botão "Colar com formatação".

## 1.5.1
- **Editor de Petições**: migration de renomeação para "blocos" agora garante que a tabela `petition_blocks` tenha a coluna `"order"`, corrigindo erro `petition_blocks.order does not exist` ao listar.

## 1.5.0
- **BREAKING CHANGE**: Renomeação de "Cláusula" para "Bloco" em todo o sistema:
  - Tipos: `PetitionClause` → `PetitionBlock`, `ClauseCategory` → `BlockCategory`
  - Service: `listClauses()` → `listBlocks()`, `createClause()` → `createBlock()`, etc.
  - Tabela no banco: `petition_clauses` → `petition_blocks`
  - Coluna: `clauses_used` → `blocks_used` na tabela `saved_petitions`
  - Labels e textos de interface atualizados
- **Editor de Petições**: removido campo "Formatação" do cadastro de bloco (formatação agora é gerenciada pelo Syncfusion SFDT)
- **Editor de Petições**: menu de contexto atualizado com novos textos ("Inserir bloco...", "Cadastrar seleção como bloco...")
- **Migration**: arquivo `20251229_rename_clauses_to_blocks.sql` criado para atualizar o banco de dados

## 1.4.9
- **Editor de Petições**: menu de contexto do Syncfusion agora inclui ações do sistema:
  - Inserir cláusula (abre a busca de cláusulas)
  - Cadastrar seleção como cláusula (abre o cadastro já preenchido com o texto selecionado)

## 1.4.8
- **Editor de Petições**: redimensionamento do painel de propriedades também pode ser feito arrastando pelo cabeçalho "TEXT".

## 1.4.7
- **Editor de Petições**: painel de propriedades do Syncfusion agora é redimensionável por arraste e a largura fica persistida localmente.

## 1.4.6
- **Editor de Petições**: melhorias no Syncfusion DocumentEditor:
  - Régua (ruler) habilitada via `documentEditorSettings.showRuler`
  - Toolbar completa com todas as opções de formatação (Header, Footer, PageSetup, etc.)
  - Painel de propriedades habilitado (`showPropertiesPane`)
  - Configuração automática de página A4 com margens de 3cm
  - Novos métodos: `getSelectedText()`, `applyParagraphFormat()`, `applyCitationFormat()`

## 1.4.5
- **Syncfusion**: licenciamento simplificado via `.env` (`VITE_SYNCFUSION_LICENSE_KEY`) registrado no `main.tsx`.

## 1.4.4
- **Syncfusion**: ajuste final no licenciamento via Supabase (Edge Function `syncfusion-license`), evitando warning de TypeScript no workspace.

## 1.4.3
- **Syncfusion**: licenciamento via Supabase (Edge Function `syncfusion-license` + `registerLicense()` no PetitionEditor).

## 1.4.2
- **Syncfusion**: registro da licença no `main.tsx` via `registerLicense()` (lendo `VITE_SYNCFUSION_LICENSE_KEY`).

## 1.4.1
- **Editor de Petições**: atualização das dependências Syncfusion para `32.1.19`.

## 1.4.0
- **Editor de Petições**: substituição completa do Quill pelo **Syncfusion DocumentEditor** para fidelidade 100% com formatação DOCX.
  - Novo componente `SyncfusionEditor.tsx` encapsulando o DocumentEditorContainerComponent.
  - Toolbar nativa do Syncfusion com todas as opções de formatação Word.
  - Import/export de arquivos DOCX via `serviceUrl` configurável (`VITE_SYNC_FUSION`).
  - Salvar petições em formato SFDT (nativo Syncfusion) com compatibilidade para petições antigas.
  - CSS do Syncfusion importado globalmente em `index.css`.
  - Sidebar e splitter mantidos para cláusulas, clientes e petições salvas.

## 1.3.66
- **Notificações**: correção definitiva de responsividade no dropdown (mobile fixed, desktop absolute) e ajustes de layout no módulo completo para evitar overflow em telas pequenas.

## 1.3.65
- **Editor de Petições**: adicionada opção de altura da linha (line-height) na toolbar.

## 1.3.64
- **Editor de Petições**: sidebar agora é redimensionável via arraste (splitter) e a largura escolhida é persistida localmente.

## 1.3.63
- **Editor de Petições**: layout ajustado para a folha ocupar toda a área disponível, removendo o fundo ao redor e escalando a régua com a largura.

## 1.3.62
- **Editor de Petições**: corrigido editor em branco causado por CSP (`unsafe-eval`) removendo imports estáticos de libs DOCX e carregando-as somente via import dinâmico quando necessário.

## 1.3.61
- **Editor de Petições**: formatação ajustada para a régua (4cm = recuo da primeira linha; 6cm = recuo do bloco para citação) e alinhamento do bloco é normalizado ao aplicar formatações.

## 1.3.60
- **Editor de Petições**: inserção de cláusulas/qualificação agora usa texto puro (com normalização de espaços/quebras) e aplica formatação por linha, garantindo parágrafo/citação/título conforme o padrão do editor.

## 1.3.59
- **Editor de Petições**: inicialização do editor mais resiliente (try/catch, `enable(true)` e `tabIndex`), exibindo erro quando o Quill não inicializa e evitando editor “morto” sem digitação/inserção.

## 1.3.58
- **Editor de Petições**: inicialização do Quill mais robusta (recria a instância quando o container anterior sai do DOM), corrigindo casos em que o editor aparecia mas não permitia digitar/inserir.

## 1.3.57
- **Editor de Petições**: editor agora permanece sempre em modal (portal) e o toggle de tela cheia altera apenas o layout, evitando remount do Quill que travava digitação/inserção.

## 1.3.56
- **Editor de Petições**: corrigido bug crítico onde minimizar quebrava o editor e impedia digitação/inserção.
- **Editor de Petições**: atalho Shift não interfere mais ao digitar (só dispara quando Shift é pressionado sozinho).
- **Editor de Petições**: auto-save agora cria a petição automaticamente no primeiro texto digitado.
- **Editor de Petições**: carregamento de petições mais robusto (aceita `content_delta` como JSON ou string JSON).

## 1.3.55
- **Editor de Petições**: modal fullscreen (sem menu/nav) com botões minimizar/maximizar/fechar.
- **Editor de Petições**: salvamento instantâneo (debounce 2s) ao digitar.
- **Editor de Petições**: atalhos de teclado - Shift 1x = parágrafo 4cm, Shift 2x = citação, Ctrl+S = salvar.
- **Editor de Petições**: foco automático no editor ao abrir.
- **Editor de Petições**: upload de fonte customizada (.ttf, .otf, .woff, .woff2).
- **Editor de Petições**: dica de atalhos visível na interface.

## 1.3.54
- **Editor de Petições**: corrigido erro `Parchment.Attributor.Class is not a constructor` que impedia o editor de inicializar.

## 1.3.53
- **Editor de Petições**: ao importar modelo `.docx`, opção de carregar o conteúdo do arquivo diretamente no editor.

## 1.3.52
- **Editor de Petições**: validação imediata ao importar modelo `.docx` e mensagem de erro mais clara quando o template não contém `[[CONTEUDO]]`.

## 1.3.51
- **Editor de Petições**: header do app agora exibe título/descrição do módulo Petições.
- **Editor de Petições**: formatação padrão ajustada para o modelo (parágrafo sem recuo; estilo 4cm opcional via botão).

## 1.3.50
- **Editor de Petições**: menu do sistema restaurado (header/rodapé), mantendo apenas o nav lateral oculto.
- **Editor de Petições**: ajustes de formatação para o padrão do modelo (título sublinhado/centralizado; citação centralizada em caixa alta).

## 1.3.49
- **Editor de Petições**: migração para Quill (core) para maior estabilidade e edição fluida.
  - Remove `contentEditable`/`document.execCommand` e passa a usar Quill como fonte de verdade
  - Salvamento/auto-save agora persiste `content` (HTML) + `content_delta` (Quill Delta)
  - Carregamento restaura preferencialmente via `content_delta` (fallback para HTML)
  - Inserção de cláusulas/qualificação de cliente no cursor via Quill

## 1.3.48
- **Editor de Petições**: modo tela cheia para peticionar mais rápido.
  - Oculta menu lateral (nav) no módulo Petições
  - Oculta header e rodapé do app no módulo Petições
  - Editor passa a ocupar 100% da tela

## 1.3.47
- **Editor de Petições**: melhorias visuais e funcionais.
  - Régua estilo Word com marcações em centímetros (0-21cm)
  - Indicadores de recuo (parágrafo 4cm, citação 6cm) na régua
  - Botão "PDF" separado para exportar petição em PDF
  - Botão "Imprimir" para impressão direta
  - Auto-save a cada 1 minuto (antes era 30 segundos)
  - Vinculação com cliente mantida (aba Clientes na sidebar)

## 1.3.46
- **Editor de Petições**: exportação DOCX real com preservação do modelo.
  - Importar modelo `.docx` e exportar preenchendo `[[CONTEUDO]]` via `docxtemplater`
  - Preserva cabeçalho, rodapé e logo do modelo no Word
  - Normalização do editor para manter estrutura em parágrafos (`<p>`) e evitar perda de formatação ao salvar

## 1.3.45
- **Editor de Petições**: ajustes para preservar formatação no Word.
  - Exportação/Impressão: troca de recuo para `margin-left` (compatibilidade melhor com Word)
  - CSS do export corrigido para usar `margin-left`/`margin-bottom` explícitos (evita interpretação incorreta)

## 1.3.44
- **Editor de Petições**: correção do recuo padrão e adição de régua.
  - Recuo do parágrafo/citação agora considera a margem da folha (evita “ficar como citação”)
  - Enter após citação/título/subtítulo volta para parágrafo padrão
  - Régua visual na folha A4 (margem 3cm, parágrafo 4cm, citação 6cm)

## 1.3.43
- **Editor de Petições**: correção dos modais que não cabiam na tela.
  - Modal de cláusula: scroll no backdrop, header/footer sticky, textarea reduzido
  - Modal de busca: altura máxima 50vh, scroll interno

## 1.3.42
- **Editor de Petições Trabalhistas v4**: novas funcionalidades e melhorias.
  - Texto padrão inicial: cabeçalho TRT + qualificação do reclamante + reclamada
  - Botão "Modelo": importar modelo Word (.doc/.docx) com logo e rodapé
  - Botão "Word": exportar documento formatado
  - Menu de contexto (botão direito) melhorado:
    - "Adicionar cláusula": abre modal de busca com todas as cláusulas
    - "Salvar como cláusula": salva texto selecionado como nova cláusula
  - Modal de busca de cláusulas com filtro por título/conteúdo
  - Dados do advogado pré-configurados no texto padrão

## 1.3.41
- **Editor de Petições Trabalhistas v3**: melhorias significativas na toolbar e funcionalidades.
  - Toolbar completa estilo Word: fonte, tamanho, negrito, itálico, sublinhado, tachado, subscrito, sobrescrito
  - Cores de texto e destaque (highlight)
  - Alinhamento: esquerda, centro, direita, justificado (padrão)
  - Listas com marcadores e numeradas
  - Formatação de parágrafo: 4cm, 6cm (citação), título, subtítulo, normal
  - Menu de contexto (botão direito): salvar seleção como cláusula
  - Auto-save a cada 30 segundos quando há alterações
  - Indicador de status de salvamento (última vez salvo / não salvo)
  - Vinculação com cliente: aba "Clientes" na sidebar
  - Qualificação automática do cliente (nome, CPF, RG, nacionalidade, estado civil, profissão, endereço)
  - Variáveis de cliente nas cláusulas: [[NOME_CLIENTE]], [[CPF]], [[RG]], etc.
  - Substituição automática de variáveis ao inserir cláusula com cliente selecionado

## 1.3.40
- **Editor de Petições Trabalhistas v2**: redesenhado para tela cheia com editor de texto livre.
  - Editor ocupa página inteira sem header (folha A4 visual)
  - Texto livre (não mais baseado em blocos) - edição fluida como Word
  - Formatação Word preservada: Parágrafo (4cm), Citação (6cm), Título, Subtítulo
  - Toolbar com negrito, itálico, sublinhado e botões de formatação
  - Sidebar retrátil com cláusulas organizadas por categoria
  - Cláusulas inseridas na posição do cursor
  - Exportação DOC e PDF/Impressão com formatação correta
  - Migration executada via MCP Supabase

## 1.3.39
- **Editor de Petições Trabalhistas**: novo módulo isolado para criação de petições com cláusulas reutilizáveis.
  - Cláusulas organizadas por categoria (Cabeçalho, Qualificação, Fatos, Direito, Pedidos, Encerramento)
  - Formatação específica: Parágrafo (4cm), Citação (6cm), Título, Subtítulo
  - Cláusulas padrão pré-cadastradas para petições trabalhistas
  - Editor visual com drag-and-drop de blocos
  - Exportação para DOC e PDF/Impressão
  - Salvar e carregar petições
  - Gerenciamento completo de cláusulas (criar, editar, excluir, definir padrão)
  - Módulo completamente isolado (pode ser removido sem afetar outros módulos)

## 1.3.38
- Documentos: adicionado campo de busca para filtrar modelos no seletor de templates (inclui Petições Padrões e Novo Documento) para facilitar quando houver muitos arquivos/modelos.

## 1.3.37
- Cache/Sincronização: implementado sistema de eventos globais para invalidação de cache e sincronização de clientes. Clientes criados, atualizados ou excluídos agora são refletidos imediatamente em todos os módulos (Dashboard, Clientes, Processos, Financeiro) sem necessidade de atualizar a página.
- Documentos: corrigido campo nome do modal "Adicionar Template" que não era limpo ao abrir o modal.

## 1.3.36
- Cache/Sincronização: clientes criados, atualizados ou excluídos agora são refletidos imediatamente em todos os módulos (Dashboard, Clientes, Processos, Financeiro) sem necessidade de atualizar a página. Implementado sistema de eventos globais para invalidação de cache e sincronização de estado entre componentes.

## 1.3.35
- Documentos: Petições Padrões — adequação completa ao padrão visual do CRM (header branco, botões laranja, cards de stats, remoção de gradientes escuros) para consistência com os demais módulos.

## 1.3.34
- Documentos: Petições Padrões — ajustes de tema (cores/bordas/inputs/botões) e suporte a dark mode (incluindo modais de criar/editar, campos e visualização).

## 1.3.33
- Documentos: corrigido dropdown de seleção de cliente (autocomplete) que podia ficar cortado/atrás do rodapé ou de containers com overflow; lista agora abre em overlay (portal) com posicionamento inteligente.

## 1.3.32
- Performance: pré-carregamento (prefetch) em background dos módulos principais após login para navegação mais rápida e redução do tempo de carregamento ao abrir módulos.

## 1.3.31
- Documentação: redesign da superpágina para o padrão visual do sistema (layout limpo/profissional, sem gradientes chamativos e sem aparência de template), mantendo sidebar, busca e seções.

## 1.3.30
- Documentação: nova superpágina de documentação premium com design moderno, sidebar de navegação, seções organizadas (Início, Guia do Sistema, Changelog, FAQ), busca integrada e layout responsivo.

## 1.3.29
- Autenticidade/Verificação: exibição do contato do signatário agora prioriza o e-mail/telefone realmente usado na autenticação (Google/telefone), evitando mostrar e-mail interno `public+...@crm.local`.

## 1.3.28
- Assinatura (selfie): anti-falso-negativo — se a IA reclamar apenas de “clareza/borrão/iluminação” mas não indicar ausência de rosto/obstrução/borrão severo, a foto é aceita.

## 1.3.27
- Assinatura (selfie): critérios da IA ajustados para não reprovar por iluminação; reprova apenas por ausência de rosto, obstrução no rosto ou foto muito borrada.

## 1.3.26
- Assinatura Pública: validação de selfie com IA agora bloqueia envio quando a foto estiver sem rosto visível/nítido e exibe o motivo.
- Edge Function: `analyze-facial-photo` agora aceita validação via `token` público (sem login) com checagem no backend.

## 1.3.25
- Assinatura Eletrônica: validação de foto facial com IA (OpenAI Vision) - verifica nitidez, iluminação e visibilidade do rosto.
- Se a foto não passar na validação, exibe mensagem e pede para tirar nova foto.
- Opção "Usar mesmo assim" para casos excepcionais.

## 1.3.24
- Notificações: suporte a notificação do navegador ao receber notificações via Realtime (quando o usuário conceder permissão).
- Notificações: clique na notificação de assinatura abre diretamente o módulo Assinaturas no modal de detalhes.

## 1.3.23
- Notificações: popups na tela agora ficam fixos até o usuário fechar (sem expirar automaticamente).
- Notificações: redesign das notificações de assinatura (badge + progresso + cores) no popup e no dropdown.

## 1.3.22
- Notificações: `analyze-intimations` agora cria notificação para todas as novas intimações analisadas (não apenas urgentes).
- Notificações: título da intimação agora reflete a urgência (📄/📋/⚠️/🚨).
- Notificações: `NotificationBell` com Realtime mais robusto em ambiente dev (evita duplicidade no React StrictMode).

## 1.3.21
- Notificações: integração de Requerimentos (alertas de MS/tempo em análise) via `notification-scheduler`.
- Notificações: `user_notifications` agora suporta `requirement_id` e tipo `requirement_alert`.
- Notificações: clique no sino/popup abre diretamente Requerimentos quando o alerta for de requerimento.
- Notificações: scheduler agora respeita `notify_days_before` (prazos) e `notify_minutes_before` (agenda) e usa deduplicação por `dedupe_key`.
- Notificações: correção de seleção de usuários ativos via `profiles.is_active`/`profiles.user_id`.

## 1.3.20
- Notificações: popup na tela agora permanece por 60 minutos (com botão de fechar).
- Notificações: múltiplos popups empilhados (um em cima do outro) no canto da tela.

## 1.3.19
- Notificações: popup na tela estilo Facebook/Instagram quando chega notificação via Realtime.
- Notificações: intimações agora exibem partes (nomes/polo) e resumo/assunto para maior precisão.
- Notificações: assinaturas digitais disparam popup realtime quando alguém assina documento.
- Notificações: barra de progresso visual no popup (6 segundos para fechar automaticamente).

## 1.3.18
- Clientes: seção "Documentos/Contratos assinados" nos detalhes do cliente (lista documentos assinados via módulo de Assinatura Digital, com acesso ao PDF assinado).

## 1.3.17
- Notificações: geração quase realtime de notificações de intimações (run-djen-sync chama analyze-intimations ao salvar novas intimações).
- Notificações: dropdown do sino exibe apenas não lidas (ao marcar como lida, some da lista).

## 1.3.16
- Notificações: Edge Function `analyze-intimations` para análise automática de intimações via cron.
- Notificações: cron job executa a cada 30 minutos para analisar novas intimações.
- Notificações: intimações urgentes (alta/crítica) geram notificação automática.
- Notificações: usa Groq AI como provider principal, OpenAI como fallback.

## 1.3.15
- Notificações: ao marcar intimação como lida, notificação correspondente é marcada como lida automaticamente.
- Notificações: dropdown mostra apenas notificações não lidas (lidas somem da lista).

## 1.3.14
- Notificações: sistema de lembretes automáticos via Edge Function (cron).
- Notificações: lembrete de prazo 1-3 dias antes do vencimento.
- Notificações: lembrete de compromisso 1 dia antes.
- Notificações: alerta de intimação urgente (análise IA).
- Notificações: alerta de assinatura pendente há mais de 1 dia.
- Notificações: trigger automático quando cliente assina documento.
- Notificações: cron jobs executam a cada hora e às 8h da manhã.
- Notificações: deduplicação para evitar notificações repetidas em 24h.

## 1.3.13
- Notificações: integração completa em todo o sistema.
- Notificações: prazos criados geram notificação (urgente se ≤3 dias ou prioridade alta).
- Notificações: compromissos criados geram notificação com data/hora.
- Notificações: assinaturas digitais geram notificação quando cliente assina.
- Notificações: processos criados geram notificação com número e cliente.
- Notificações: ícone de caneta (PenTool) para assinaturas digitais.

## 1.3.12
- Notificações: cria notificação para TODAS as intimações (não apenas urgentes).
- Notificações: badges de tribunal e urgência (ALTA, CRÍTICA) nas notificações.
- Notificações: ícone diferenciado para intimações urgentes (triângulo vermelho).
- Notificações: cor de fundo do ícone baseada na urgência.
- Notificações: mensagem com resumo da análise de IA.

## 1.3.11
- Notificações: suporte a Realtime (notificações instantâneas via WebSocket).
- Notificações: som toca automaticamente ao receber nova notificação.
- Notificações: habilitado Realtime na tabela user_notifications.

## 1.3.10
- Notificações: corrigido RLS policy para permitir INSERT/UPDATE/DELETE na tabela user_notifications.

## 1.3.9
- Notificações: novo sistema estilo Facebook/Instagram com dropdown moderno.
- Notificações: som de alerta usando Web Audio API (pode ser ativado/desativado).
- Notificações: badge com contador animado (pulse) no ícone do sino.
- Notificações: tempo relativo (agora, 5m, 2h, 3d).
- Notificações: ações rápidas (marcar como lida, deletar) ao passar o mouse.
- Notificações: botão para marcar todas como lidas.
- Notificações: polling automático a cada 30 segundos.

## 1.3.8
- Notificações: corrigido erro 400 ao criar notificações de intimação urgente (mapeia `intimation_urgent` para `intimation_new` e registra `urgent: true` no metadata).

## 1.3.7
- Intimações DJEN: layout unificado em barra única (header + filtros + ações).
- Intimações DJEN: indicadores inline (total, não lidas, urgência).
- Intimações DJEN: botões de ação apenas com ícones (Filtros, Histórico, Exportar, Config).
- Intimações DJEN: exibição dos nomes das partes (destinatários ou extraídos do texto).
- Intimações DJEN: fallback de extração de partes do texto quando não há destinatários cadastrados.
- Intimações DJEN: vinculação automática quando nome da parte = nome do cliente cadastrado (match 100%).
- Intimações DJEN: prioridade de visualização para as intimações.

## 1.3.6
- Intimações DJEN: análise automática de IA agora é disparada quando novas intimações chegam via realtime.

## 1.3.5
- Intimações DJEN: toast de realtime agora mostra a quantidade de novas intimações recebidas (inserts agrupados em lote).

## 1.3.4
- Edge Function run-djen-sync: removido limite de 10 processos - agora busca TODOS os processos cadastrados.

## 1.3.3
- Database: habilitado Realtime (postgres_changes) para tabela `djen_comunicacoes` - agora a lista atualiza automaticamente ao chegar nova intimação.

## 1.3.2
- Intimações DJEN: busca agora considera também o número do processo cadastrado (process_code) e agrupamento prioriza process_code quando houver vínculo.

## 1.3.1
- Intimações DJEN: atualização automática da lista e notificação quando chegar nova intimação (realtime).

## 1.3.0
- Intimações DJEN: período de busca alterado para 7 dias (Edge Function + sync manual).
- Edge Function run-djen-sync: extrai número do processo do texto quando não vem da API.
- Edge Function run-djen-sync: vinculação automática com processos cadastrados melhorada.
- Deletadas intimações antigas do banco (desde 11/12).

## 1.2.9
- Database: coluna `numero_processo` em `djen_comunicacoes` agora é nullable (API do DJEN nem sempre retorna esse campo).

## 1.2.8
- Edge Function run-djen-sync: corrigido insert em `djen_comunicacoes` preenchendo campos obrigatórios (`djen_id` e `hash`) e melhorados logs de erro para diagnosticar falhas (evita "saved=0" silencioso).

## 1.2.7
- Intimações DJEN: corrigido "Última atualização" para exibir a sincronização mais recente (não a primeira).
- Edge Function run-djen-sync: corrigido nome da tabela `djen_comunicacoes_local` → `djen_comunicacoes`.
- Corrigido nome da tabela em `processTimeline.service.ts`.

## 1.2.6
- Intimações DJEN: melhorias visuais no header e ações (layout mais premium).
- Intimações DJEN: período de busca do DJEN ampliado para 15 dias (cron/Edge Function e sincronização manual).

## 1.2.5
- Intimações DJEN: "Última atualização" agora é baseada exclusivamente no histórico do cron (`djen_sync_history`).
- DJEN cron: Edge Function `run-djen-sync` registra execução bloqueada (token inválido) no `djen_sync_history`.

## 1.2.4
- Intimações DJEN: sincronização manual agora registra na tabela `djen_sync_history` do Supabase.
- Intimações DJEN: adicionados métodos `logSync` e `updateSync` no service de status.

## 1.2.3
- Intimações DJEN: criada migration para tabela `djen_sync_history` com políticas RLS corretas.
- Intimações DJEN: corrigido service para não lançar exceção quando tabela não existe.

## 1.2.2
- Modelos de Documentos: scroll automático ao selecionar categoria, modelo e cliente na aba Gerar.

## 1.2.1
- Modelos de Documentos: repaginação do layout geral do módulo mantendo abas (Gerar/Gerenciar), com header premium e contadores.
- Modelos de Documentos: aba Gerenciar com filtros e ação "Novo Modelo" em layout mais limpo.

## 1.2.0
- Petições Padrões: novo layout da aba "Gerar Documento" com fluxo em 3 passos (Categoria → Modelo → Cliente).
- Petições Padrões: seleção visual de categorias com contagem de modelos disponíveis.
- Petições Padrões: indicador de progresso (steps) no topo do formulário.
- Petições Padrões: animações suaves ao revelar cada etapa.
- Petições Padrões: header com gradiente e design mais moderno.
- Petições Padrões: campos personalizados agora aparecem em grid 2 colunas.

## 1.1.99
- Petições Padrões: normalização automática de pontuação para evitar vírgulas duplicadas quando campos opcionais (ex: complemento) estão vazios.

## 1.1.98
- Petições Padrões: cidade agora é formatada em Title Case (ex: "Várzea Grande") e UF em maiúsculo (ex: "MT") na geração de documentos.

## 1.1.97
- Petições Padrões: invertida ordem das abas - "Gerar Documento" agora é a primeira aba (padrão).

## 1.1.96
- Petições Padrões: adicionada função de substituir template DOCX no modal de edição.
- Petições Padrões: UI melhorada para mostrar arquivo atual e botão "Substituir" quando já existe um template.
- Petições Padrões: aviso visual quando o arquivo será substituído.

## 1.1.95
- Petições Padrões: corrigido conflito entre [[ESTADO]] (UF) e [[ESTADO CIVIL]] - agora cidade e UF mantêm capitalização original.
- Petições Padrões: adicionado placeholder [[UF]] como alternativa para estado.

## 1.1.94
- Petições Padrões: CPF agora é formatado com máscara (000.000.000-00).
- Petições Padrões: CEP agora é formatado com máscara (00000-000).
- Petições Padrões: nacionalidade, estado civil e profissão agora são exibidos em minúsculo.

## 1.1.93
- Petições Padrões: placeholders do cliente agora funcionam igual ao módulo Documentos (com variações: maiúsculo, minúsculo, com/sem acento, com espaço ou underscore).
- Petições Padrões: adicionado placeholder [[ENDERECO_COMPLETO]] com endereço formatado.
- Petições Padrões: corrigido problema de campos do cliente vindo "undefined".

## 1.1.92
- Petições Padrões: arquivos DOCX agora são processados automaticamente com substituição de placeholders (não pede mais para editar manualmente).
- Petições Padrões: usa docxtemplater para gerar documento DOCX com todos os campos preenchidos.

## 1.1.91
- Petições Padrões: campo tipo "date" agora abre calendário nativo do navegador.
- Petições Padrões: campos personalizados agora são renderizados conforme seu tipo (date, textarea, select, number, currency).
- Petições Padrões: geração de documento agora aplica corretamente os valores dos campos personalizados.
- Petições Padrões: datas são formatadas para DD/MM/YYYY e moedas para R$ X.XXX,XX no documento gerado.

## 1.1.90
- Petições Padrões: adicionada opção de editar campo personalizado no modal de campos.

## 1.1.89
- Petições Padrões: modais (Nova/Editar, Campos, Visualizar) agora respeitam o tema e não ficam pretos no modo claro.

## 1.1.88
- Documentos: templates marcados como petições/requerimentos não aparecem mais na aba "Gerenciar templates" (ficam apenas na aba "Petições Padrões").

## 1.1.87
- **Submódulo Petições Padrões**: Nova aba no módulo de Documentos para gerenciar petições e requerimentos padrões.
  - CRUD completo de petições com categorias (Requerimento Administrativo, Petição Inicial, Recurso, Contestação, Outros)
  - Upload de arquivos DOCX ou criação de templates em texto com placeholders
  - Campos personalizados por petição (texto, número, data, seleção, moeda, CPF, telefone, CEP)
  - Geração de documentos com substituição automática de dados do cliente
  - Histórico de documentos gerados
- Arquivos criados:
  - `src/components/StandardPetitionsModule.tsx` - Componente de UI completo
  - `src/services/standardPetition.service.ts` - Service com CRUD
  - `src/types/standardPetition.types.ts` - Tipos TypeScript
  - `supabase/migrations/20251227_standard_petitions.sql` - Migration do banco

## 1.1.86
- Processos: exibida a última atualização do cron DJEN no header (data/hora, status, encontrados/salvos).

## 1.1.85
- Módulo Intimações: banner "Atualizando dados em segundo plano..." agora só aparece após o primeiro carregamento completo (não aparece ao entrar no módulo).

## 1.1.84
- Módulo Intimações: não exibe mais o banner "Atualizando dados em segundo plano..." no carregamento inicial.

## 1.1.83
- **Módulo Intimações**: Removida análise automática de IA ao abrir o módulo (agora só via cron)
- **UI Melhorada**: Header redesenhado com card de "Última atualização" mostrando:
  - Data e hora da última execução do cron
  - Status (Sucesso/Erro/Executando) com badge colorido
  - Quantidade de intimações encontradas e salvas
- Removida mensagem "Atualizando em segundo plano" desnecessária

## 1.1.82
- **Cron 2x/dia**: Alterado de 1x para 2x por dia (7h e 19h)
- **Módulo Intimações**: Removida sincronização automática ao abrir o módulo (agora só via cron ou botão manual)
- **Edge Function**: Logs detalhados da execução do cron com ID único de execução, etapas numeradas e duração total
- Header atualizado: "Sincronização automática: 2x/dia (7h e 19h) via cron Supabase"

## 1.1.81
- **Cron DJEN Completo**: Edge Function `run-djen-sync` agora atualiza **status do processo automaticamente** quando salva nova intimação vinculada.
  - Detecta status baseado no texto: citação, conciliação, contestação, instrução, sentença, recurso, cumprimento, arquivado
  - Atualiza flags `djen_synced`, `djen_last_sync`, `djen_has_data` no processo
- **Linha do Tempo do Processo**: agora busca do **banco local** (`djen_comunicacoes_local`) com análise IA já pronta pelo cron.
  - Abre instantaneamente sem precisar chamar OpenAI/Groq novamente
  - Fallback para DJEN direto se não houver dados no banco
  - Novo método `fetchTimelineFromDatabase` no `processTimeline.service.ts`
- Fluxo completo: Cron diário → Sincroniza DJEN → Salva intimações → Analisa IA → Atualiza processo → Timeline pronta

## 1.1.80
- Edge Function `run-djen-sync`: agora executa **análise automática de IA** após sincronizar intimações do DJEN.
  - Busca até 50 intimações sem análise
  - Chama OpenAI (gpt-4o-mini) para extrair: resumo, urgência, prazo, pontos-chave
  - Salva análise no campo `ai_analysis` da tabela `djen_comunicacoes_local`
  - Delay de 1.5s entre análises para respeitar rate limit
  - Requer `OPENAI_API_KEY` configurada nos secrets do Supabase
- Cron diário unificado: sincronização DJEN + análise IA em uma única chamada

## 1.1.79
- Linha do Tempo (Processos): modal mais organizado e com visual mais premium:
  - Header com ação de atualizar e melhor alinhamento/spacing
  - Layout em 2 colunas com sidebar mais limpa e componentes com bordas arredondadas
  - Cards de eventos com hierarquia visual melhor e expansão mais legível
- Linha do Tempo (Processos): correção de segurança no filtro/busca quando `description` vem vazio.

## 1.1.78
- Linha do Tempo (Processos): redesign ultra-minimalista:
  - Sem cards, bordas ou sombras - apenas texto e espaço
  - Timeline dot mínimo (2px)
  - Data e tipo em linha única discreta
  - Título como elemento principal
  - Ações aparecem apenas quando expandido
  - Conteúdo expandido limpo e compacto

## 1.1.77
- Linha do Tempo (Processos): redesign completo dos cards com UI/UX mais limpo e humano:
  - Tipografia mais leve e hierarquia visual clara
  - Badges removidos, substituídos por texto sutil
  - Indicadores de urgência discretos (apenas quando necessário)
  - Botões de ação como links minimalistas
  - Cards com bordas arredondadas e sombras suaves
  - Espaçamento respirado e cores neutras

## 1.1.76
- Linha do Tempo (Processos): reduzida poluição visual nos cards (badges mais discretos/compactos e ações em botões outline menores).

## 1.1.75
- Processos: status do processo agora é persistido **obrigatoriamente** conforme o subestágio do mapa exibido na Linha do Tempo (ex.: Conciliação/Contestação/Recurso), garantindo consistência entre modal e lista.
- Build: correções de TypeScript para compatibilidade de tipos em Perfil/Requerimentos.

## 1.1.74
- Processos: ajustada ordem de prioridade na detecção automática de status. Agora "Conciliação" tem prioridade sobre "Contestação" e a detecção de Contestação exige termos mais específicos (evitando falsos positivos como "solicitou retificação").

## 1.1.73
- Processos: adicionados **sub-estágios** ao status do processo: Citação, Conciliação, Contestação, Instrução e Recurso.
- IA agora detecta e atualiza automaticamente para o sub-estágio correto baseado nos eventos da timeline.
- Novos badges coloridos para cada sub-estágio na lista de processos.
- Migration SQL incluída para atualizar constraint do banco de dados.

## 1.1.72
- Processos: melhorada detecção de status pela IA. Agora prioriza os **eventos mais recentes** (últimos 5) e exige termos mais específicos para "Arquivado" (ex.: "arquivamento definitivo", "autos arquivados"). Eventos como Decisão, Intimação e Citação agora corretamente detectam status "Em Andamento".

## 1.1.71
- Processos: corrigida lógica de atualização automática de status pela IA. Agora a análise pode **corrigir** status incorretos (ex.: "Arquivado" → "Em Andamento"), não apenas avançar na hierarquia.

## 1.1.70
- Processos: corrigido status exibido no front após análise/sincronização (DJEN/IA). Agora a atualização de status passa por `processService.updateStatus`, garantindo invalidação de cache e recarregamento correto.

## 1.1.69
- Financeiro: separadores brilhantes agora aparecem entre parcelas no modo escuro quando existe mais de uma parcela.
- Linha discreta `via-white/15` com fade nas extremidades adiciona leitura entre cards.

## 1.1.68
- Financeiro: cartão de parcelas em atraso no dark mode agora usa gradiente vinho (#3f0b1d → #09090b) alinhado ao tema.
- Badges/pílulas receberam `dark:bg-[#4c0e1f]` e texto claro para leitura segura.
- Indicador numérico usa `dark:bg-[#fb7185]` para manter o status visual.

## 1.1.67
- Financeiro: melhorado contraste do card vermelho (parcelas em atraso) no modo escuro.
- Fundo alterado de `dark:from-rose-500/15` para `dark:from-rose-500/30` com fundo zinc-800.
- Bordas e badges ajustados para melhor legibilidade em dark mode.

## 1.1.66
- Perfil: métricas da aba "Métricas" com contraste alto (cards brancos, texto escuro).
- Corrigidas cores dos ícones e labels para garantir visibilidade das estatísticas.
- Melhorias de acessibilidade e legibilidade no dashboard do perfil.

## 1.1.64
- Requerimentos/MS: textos oficiais atualizados para BPC LOAS.
- MS agora imprime:
  - "Benefício de Prestação Continuada (BPC/LOAS) à Pessoa com Deficiência"
  - "Benefício de Prestação Continuada (BPC/LOAS) – Idoso"
- Adequado para padrão do Ministério da Saúde.

## 1.1.63
- Requerimentos: ajustado label do tipo legado.
- 'bpc_loas' agora exibe "BPC LOAS - Deficiente".
- Nomenclatura mais clara para registros antigos.

## 1.1.62
- Requerimentos: corrigido erro de constraint do banco.
- Mantido tipo legado 'bpc_loas' para compatibilidade.
- Atualizada constraint do banco para incluir novos tipos.
- MS continua imprimindo textos oficiais corretos.

## 1.1.61
- Requerimentos/MS: saída do campo "Tipo/benefício" ajustada para exibir descrições oficiais do BPC LOAS.
- MS agora imprime:
  - "BENEFÍCIO ASSISTENCIAL AO PORTADOR DE DEFICIÊNCIA"
  - "Benefício de Prestação Continuada-BPC LOAS IDOSO"
- Corrigido erro de constraint do banco removendo tipo legado.

## 1.1.60
- Requerimentos: template MS atualizado para novos tipos BPC LOAS.
- Placeholder [[BENEFICIO]] agora exibe labels corretos:
  - "BPC LOAS - Deficiência"
  - "BPC LOAS - Idoso"
- Adequado para saída no Ministério da Saúde.

## 1.1.61
- Requerimentos/MS: saída do campo "Tipo/benefício" ajustada para exibir descrições oficiais do BPC LOAS.
- Compatibilidade com registros antigos: tipo legado "bpc_loas" agora sai como "BENEFÍCIO ASSISTENCIAL AO PORTADOR DE DEFICIÊNCIA".

## 1.1.59
- Requerimentos: adequação para BPC LOAS do MS.
- Separado BPC LOAS em duas categorias:
  - BPC LOAS - Deficiência
  - BPC LOAS - Idoso
- Atualizados tipos e labels para adequação legal.
- Benefícios agora classificados corretamente para MS.

## 1.1.58
- Requerimentos: animações premium nos ícones de status.
- Animações pulse e bounce com drop-shadow para destaque.
- Aplicado tanto nas abas superiores quanto na tabela.
- Corrigidos erros TypeScript em ícones Lucide.

## 1.1.57
- Requerimentos: removido loader fixo do status "Em Análise".
- Loader aparece apenas durante atualização de status.
- Status "Em Análise" agora exibe apenas ícone Activity estático.

## 1.1.56
- Requerimentos: animações adicionadas nos ícones de status.
- Em Exigência: animate-pulse (âmbar)
- Aguardando Perícia: animate-bounce (ciano)
- Aguardando Confecção: animate-pulse (índigo)
- Deferidos: animate-pulse (verde)
- Em Análise: sem animação (apenas loader)

## 1.1.55
- Requerimentos: ícones restaurados na tabela de status.
- Ícones temáticos agora visíveis ao lado do select.
- Mantida identificação visual clara dos status.

## 1.1.54
- Requerimentos: removido ícone duplicado na tabela de status.
- Mantido apenas ícone nas abas superiores para evitar poluição visual.
- Layout mais limpo e profissional.

## 1.1.53
- Requerimentos: ícones adicionados ao dropdown de status na tabela.
- Ícones temáticos agora visíveis ao lado de cada status.
- Melhor identificação visual dos requerimentos.

## 1.1.52
- Requerimentos: redesign profissional das animações de status.
- Removidas animações complexas e gradientes excessivos.
- Visual limpo com cores sólidas e ícones simples.
- Corrigidos bugs de renderização e TypeScript.
- Abas de status com hover suave e escala sutil.
- Dropdowns simplificados sem animações que causavam bugs.

## 1.1.51
- Requerimentos: novas animações e ícones temáticos para status.
- Em Análise: ícone Activity com animação pulse (1.6s).
- Aguardando Perícia: ícone Microscope com animação bounce (2.4s).
- Gradientes modernos em badges (amber→orange, cyan→blue, etc.).
- Animações mais suaves com shadow-lg e ring effects.
- Ícones médicos e gráficos para melhor identificação visual.

## 1.1.50
- Requerimentos: visão geral reorganizada com cartões e listas estruturadas.
- Layout limpo usando rounded-2xl, shadow-sm e divide-y para separar informações.
- Corrigido erro de sintaxe (className sem =) e import Search adicionado.
- Visual mais profissional e menos poluído na aba de visão geral.

## 1.1.49
- Requerimentos: removida linha vertical que dividia as colunas do modal.
- Layout agora sem separador visual entre colunas esquerda e direita.
- Visual mais limpo e unificado entre informações do cliente e do requerimento.
- Espaçamento natural do grid já separa o conteúdo adequadamente.

## 1.1.48
- Requerimentos: removidas informações duplicadas do header do modal.
- Header agora exibe apenas nome do beneficiário e protocolo.
- CPF e benefício removidos do topo para evitar duplicação.
- Informações completas ficam apenas na visão geral.

## 1.1.47
- Requerimentos: removidas listas da visão geral, agora usa apenas separadores.
- Layout limpo com linhas horizontais (h-px) entre informações.
- Separadores contextuais: âmbar para exigência, ciano para perícias.
- Visual mais limpo e organizado sem bordas em cada item.

## 1.1.46
- Requerimentos: colunas da visão geral invertidas.
- Coluna esquerda: informações do cliente e processos vinculados.
- Coluna direita: informações do requerimento (data, telefone, senha, protocolo, benefício).
- Layout mais intuitivo com informações do cliente em primeiro lugar.

## 1.1.45
- Requerimentos: adicionado separador visual entre colunas da visão geral.
- Linha vertical sutil (w-px) entre as duas colunas em desktop.
- Separador oculto em mobile (hidden lg:block) para manter layout responsivo.
- Melhora visual na distinção entre informações do requerimento e do cliente.

## 1.1.44
- Requerimentos: visão geral organizada em duas colunas lado a lado.
- Coluna esquerda: informações do requerimento (data, telefone, senha, protocolo, benefício).
- Coluna direita: informações do cliente (nome, CPF, telefone, benefício) e processos vinculados.
- Layout responsivo com grid-cols-1 lg:grid-cols-2 para melhor aproveitamento de espaço.

## 1.1.43
- Requerimentos: visão geral organizada em layout linear (sem blocos).
- Informações exibidas em formato de lista com bordas separadoras.
- Processos vinculados em cards simplificados e alinhados verticalmente.
- Layout mais limpo e fácil de escanear visualmente.

## 1.1.42
- Requerimentos: modal de detalhes padronizado para seguir layout do sistema.
- Header agora usa faixa laranja e estrutura consistente com outros modais.
- Botão fechar movido para direita com estilo padrão do sistema.
- Subtítulo "Detalhes do Requerimento" e informações reorganizadas.

## 1.1.41
- Requerimentos: layout da aba Notas invertido (conteúdo acima, input abaixo).
- Melhoria na UX para seguir padrão de apps de mensagens (conteúdo primeiro, campo de digitação embaixo).

## 1.1.40
- Requerimentos: notas agora exibidas em ordem inversa (mais recentes primeiro).
- Melhoria na experiência de leitura ao ver as notas mais recentes no topo.

## 1.1.39
- Requerimentos: Observações movidas para uma aba dedicada ao lado de Notas no modal.
- Nova aba destaca o texto interno com ícone NotebookPen e blocos organizados.
- Removido submenu anterior das observações na aba Visão Geral para reduzir ruído.
- Mostra também a última atualização do requerimento dentro da aba Observações.

## 1.1.38
- Requerimentos: visão geral do modal reorganizada com layout mais limpo.
- Informações divididas em seções: "Informações Principais" e "Processos Vinculados".
- Observações movidas para submenu com botão Exibir/Ocultar.
- Botão de observações com ícones Eye/EyeOff e estado showObservations.
- Layout mais espaçado com space-y-6 entre seções principais.
- Títulos de seção com text-sm font-semibold para melhor hierarquia.
- Observações em container destacado com background quando expandidas.
- Melhor organização visual e UX na aba "Visão Geral".

## 1.1.37
- Requerimentos: botões do header de documentos (Ver docs/Gerar MS) refinados para visual mais premium e consistente.

## 1.1.36
- Requerimentos: modal de detalhes otimizado para ficar menos carregado (Notas/Status/Documentos recolhíveis + composer de notas mais compacto).

## 1.1.35
- Requerimentos: Histórico de Notas agora permite registrar nova nota no estilo comentários (Instagram-like), com campo de texto e botão publicar.

## 1.1.34
- Requerimentos: melhorado destaque/visibilidade do botão "Gerar MS" na seção de documentos.

## 1.1.33
- Requerimentos: corrigido erro de interface que impedia abrir detalhes (ícone Eye ausente).
- Requerimentos: histórico de notas ajustado para comentários estilo Instagram com avatar/foto, usuário, data/hora e resposta.

## 1.1.32
- Requerimentos: histórico de notas reformulado para estilo de chat (Instagram-like) com foto, nome, data e respostas.
- Requerimentos: botões de ação do modal de detalhes reorganizados para melhor usabilidade e hierarquia visual.
- Requerimentos: botão "Gerar MS" agora possui fundo preto para destaque.

## 1.1.31
- Requerimentos: melhorado layout visual do modal de detalhes com seções agrupadas e ícones.
- Requerimentos: organizadas informações em cards com gradientes e cores distintas por categoria.
- Requerimentos: adicionados ícones contextuais para melhor identificação visual dos campos.
- Requerimentos: melhorada UX com layout responsivo e suporte a dark mode aprimorado.

## 1.1.30
- Requerimentos: histórico de status (auditoria) no modal de detalhes.
- Requerimentos: alertas de MS por nível (30/60/90+) e filtro "Somente risco MS (90+)".
- Requerimentos: ações rápidas no detalhe (voltar p/ Em análise, prazo de exigência, agendar perícia).

## 1.1.29
- Requerimentos: após passar a última perícia, o status retorna automaticamente para "Em análise".

## 1.1.28
- Requerimentos: modal "Registrar prazo para exigência" ajustado para fundo branco claro com faixa laranja.

## 1.1.27
- Requerimentos: tempo em análise (MS) agora considera a última entrada em "Em análise" (reinicia ao reentrar).
- Agenda: log de exclusões agrupado por dia (Hoje/Ontem/Data) para melhor leitura.

## 1.1.26
- Agenda: removida opção de limpar log; exibição limitada aos últimos 30 dias.
- Requerimentos: agendar perícia médica/social agora cria apenas compromisso na Agenda (sem prazo).

## 1.1.25
- Agenda: removida a opção de adicionar manualmente exclusões no log (mantido apenas registro automático).

## 1.1.24
- Agenda: log de exclusões agora permite adicionar manualmente exclusões feitas anteriormente (ex.: hoje antes do log existir).

## 1.1.23
- Agenda: log persistente de exclusões de compromissos com botão "Log" ao lado de "Filtros".

## 1.1.22
- Requerimentos: correção de layout para remover espaço vazio à direita após a coluna AÇÕES (tabela ocupa 100% do container).

## 1.0.97
- Exibição padrão do módulo de Assinaturas alterada para blocos (grid), mantendo a preferência do usuário no armazenamento local.

## 1.0.96
- Correção robusta na geração de URLs assinadas para imagens de selfie/assinatura no modal de detalhes, evitando erros 400 com tratamento específico por bucket e logs detalhados para diagnóstico.

## 1.0.95
- Correção na geração de URLs assinadas do modal de detalhes (normaliza caminhos vindos com prefixo do bucket, evitando erro 400 ao exibir selfie/assinatura no Supabase Storage).

## 1.0.94
- Ajuste no modal de detalhes do módulo de Assinaturas para organizar os botões de ação no desktop (Ver assinado / Baixar documento lado a lado e Excluir separado), evitando empilhamento.

## 1.0.93
- Ajuste no layout do modal de detalhes do módulo de Assinaturas no desktop, organizando os botões de ação em grid responsivo para evitar empilhamento e desconfiguração.

## 1.0.92
- Versão anterior.

## Releases

### 1.9.42
- **Peticionamento (Pré-visualização de Blocos)**: container do `docx-preview` agora permanece montado durante o carregamento (com overlay), evitando fallback e garantindo renderização correta por **parágrafos/páginas**.
