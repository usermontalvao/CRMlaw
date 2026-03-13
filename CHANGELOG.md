# Changelog
  
  ## 1.9.914
- **Cloud**: Adicionado scroll ao menu de contexto de arquivos para permitir visualizar todas as opções quando o menu ultrapassar a altura da tela.

  ## 1.9.913
- **Cloud**: Corrigido o clique do menu de contexto de arquivos após a mudança para fechamento por `mousedown`, adicionando a referência do menu para impedir fechamento prematuro.

  ## 1.9.912
- **Cloud**: Corrigido o menu de contexto de arquivos que estava com cliques sem ação por renderizar um bloco duplicado sobre o menu principal.

  ## 1.9.911
- **Cloud**: A ação de fixar/desafixar arquivos e pastas agora mostra confirmação visual imediata, evitando a sensação de clique sem resposta.

  ## 1.9.910
- **Cloud**: Simplificada a exibição dos badges de pasta para evitar combinações confusas como `Pendente` e `Resolvido` ao mesmo tempo no card.

  ## 1.9.909
- **Assinatura**: Corrigido o erro de build do TypeScript causado pelo uso de `selectedClientId` antes da declaração no carregamento do telefone do cliente.

  ## 1.9.908
- **Cloud**: O cabeçalho agora prioriza mais espaço para a navegação da pasta, evitando corte prematuro do breadcrumb quando ainda há área livre.

  ## 1.9.907
- **Cloud**: Ajustado o layout do cabeçalho para exibir nome, telefone e `WA.me` do cliente sem quebrar a barra superior.

  ## 1.9.906
- **Cloud**: Corrigido o erro em tempo de execução no cabeçalho da pasta após adicionar o telefone do cliente, com a importação do ícone `Phone` que estava ausente.

  ## 1.9.905
- **Cloud**: O cabeçalho da pasta agora exibe o telefone do cliente com atalho `WA.me` ao lado do nome no topo.

  ## 1.9.904
- **Cloud**: Corrigida a referência ausente de `handleOpenCreateFolder`, restaurando a ação de `Nova pasta` e eliminando a falha de build no deploy.

  ## 1.9.903
- **Assinatura**: O cliente selecionado agora exibe o telefone com atalho `WA.me` para abrir o WhatsApp diretamente no fluxo de assinatura.

  ## 1.9.902
- **Cloud**: O download de pasta agora exibe uma tela de carregamento visível com a mensagem `Aguarde... estamos montando a pasta...` enquanto o ZIP é preparado.

  ## 1.9.901
- **Cloud**: Ao usar `Baixar pasta`, o sistema agora exibe a animação com a mensagem `Aguarde... montando pasta...` enquanto prepara o download do ZIP.

  ## 1.9.900
- **Cloud**: Pastas marcadas como `alerta` agora exibem uma sirene animada no badge para destacar visualmente o estado crítico.

  ## 1.9.899
- **Cloud**: O texto do `motivo` de `alerta`/`pendência` nos cards de pasta agora é exibido em vermelho para reforçar o destaque visual.

  ## 1.9.898
- **Cloud**: Os cards de pasta agora exibem também o `motivo` registrado para `alerta` ou `pendência`, facilitando a visualização sem abrir os detalhes.

  ## 1.9.897
- **Cloud**: O menu contextual da pasta agora possui rolagem própria para exibir todas as opções, o modal rápido de `alerta`/`pendência` foi ajustado para o visual claro do Cloud e o badge de alerta/pendência passou a aparecer também nos cards de pasta.

  ## 1.9.896
- **Cloud**: `Marcar alerta` e `Marcar pendência` agora abrem um modal obrigatório para informar o motivo antes de salvar, e o menu contextual da pasta passou a fechar apenas por clique fora.

  ## 1.9.895
- **Cloud**: O menu contextual das pastas não fecha mais automaticamente ao fazer scroll e agora também permite marcar `pendência`, `alerta` e `resolvido` diretamente pelo menu.

  ## 1.9.894
- **Cloud**: Pastas agora aceitam `pendência` ou `alerta`, com registro de motivo e ação para marcar como resolvido diretamente no painel de detalhes.

  ## 1.9.893
- **Cloud**: Removido o cabeçalho duplicado do player de vídeo, mantendo apenas o título principal do modal para evitar repetição visual.

  ## 1.9.892
- **Cloud**: Refinado o player de vídeo para um visual mais limpo e coerente com o Cloud, mantendo a marca Jurius de forma discreta e priorizando o conteúdo do vídeo.

  ## 1.9.891
- **Cloud**: Adicionado suporte a vídeo com player estilizado da marca Jurius no preview, incluindo reconhecimento nativo de arquivos `.mp4`, `.mov`, `.webm`, `.m4v`, `.avi` e `.mkv`.

  ## 1.9.890
- **Cloud**: Corrigido o crash do preview de PDF nas ferramentas do Cloud ao garantir que as páginas do `react-pdf` só sejam renderizadas após o documento estar pronto e ao limpar esse estado ao trocar ou fechar o arquivo.

  ## 1.9.889
- **Cloud**: Adicionado aviso durante a operação de colar, informando que os itens estão sendo colados e bloqueando nova tentativa até o término.

  ## 1.9.888
- **Cloud**: Corrigido o upload duplicado ao arrastar arquivos de fora para dentro do módulo, evitando que o mesmo drop fosse processado ao mesmo tempo pela janela e pela área central.

  ## 1.9.887
- **Cloud**: O sufixo `(cópia)` agora só é aplicado ao copiar arquivos ou pastas para o mesmo destino de origem; ao colar em outra pasta, o nome original é preservado.

  ## 1.9.886
- **Cloud**: O renomear arquivo passou a travar a extensão em todos os fluxos relevantes, incluindo modal e renomeação inline, evitando alteração acidental do sufixo do arquivo.

  ## 1.9.885
- **Cloud**: O modal de converter imagens em PDF passou a abrir acima do preview, com fechamento do preview atual para evitar sobreposição incorreta.

  ## 1.9.884
- **Cloud**: Corrigido o erro de build causado pela ausência de `closePdfToolsModal`, restaurando o fechamento correto do hub de PDF.

  ## 1.9.883
- **Cloud**: Corrigido o erro de runtime no `CloudModule` ao baixar pasta, restaurando a state de controle usada pelo botão de preparação do download.

  ## 1.9.882
- **Cloud**: O download de pasta ficou mais confiável no primeiro clique, com bloqueio contra cliques repetidos e indicador visual enquanto o ZIP é preparado.

  ## 1.9.881
- **Cloud**: Pastas arquivadas e itens da lixeira deixaram de aparecer na árvore da Caixa de entrada, ficando visíveis apenas nas visões apropriadas.

  ## 1.9.880
- **Cloud**: O arrastar e soltar de arquivos passou a reconhecer toda a área central do Cloud, com overlay visual grande e drop permitido em qualquer ponto útil do painel.

  ## 1.9.879
- **Cloud**: O modo em cards passou a manter a área vazia abaixo da grade como parte real da dropzone, aceitando arrastar arquivos também nesse espaço livre.

  ## 1.9.878
- **Cloud**: A área vazia abaixo da listagem/cards passou a fazer parte real da dropzone, aceitando arrastar arquivos também no espaço livre do painel.

  ## 1.9.877
- **Cloud**: A área de arrastar arquivos no explorador foi expandida para ocupar toda a região útil, facilitando o drop em qualquer espaço livre da listagem/cards.

  ## 1.9.876
- **Cloud**: A rotação rápida de imagens e PDFs passou a atualizar a listagem sem exibir o carregamento global do Cloud.
- **Cloud**: O carregamento inicial foi desacoplado da identidade interna do `loadData`, reduzindo recarregamentos visuais desnecessários após ações rápidas.

  ## 1.9.875
- **Cloud/PDF**: O preview principal de PDF no Cloud passou a centralizar melhor a página, com área de visualização ajustada para evitar corte lateral e deslocamento do conteúdo.

  ## 1.9.874
- **Cloud/PDF**: Corrigido o crash do preview de PDFs no Hub PDF ao forçar remontagem limpa do `react-pdf` quando o arquivo ou a URL do preview mudam.
- **Cloud**: Removidas duplicações acidentais no `CloudModule` que estavam quebrando o build e causando erro 500 no recarregamento do Vite.

  ## 1.9.873
- **Cloud**: Recarregamentos após ações como copiar, colar e mover itens passaram a ocorrer de forma silenciosa, evitando sensação de tela recarregando à toa.
- **Cloud**: O carregamento principal foi estabilizado para não ser reexecutado desnecessariamente quando apenas a referência interna da pasta atual muda.

  ## 1.9.872
- **Cloud/Word**: A conversão client-side de Word para PDF passou a forçar layout A4, renderizar cabeçalho/rodapé e capturar cada página separadamente para reduzir distorções de formatação.

  ## 1.9.871
- **Cloud/Word**: Corrigida a geração de PDF em branco ao alinhar o container de renderização do DOCX com a implementação estável já usada no módulo de documentos.

  ## 1.9.870
- **Cloud/Word**: A conversão de Word para PDF foi substituída por uma solução baseada em `docx-preview` + `html2canvas` + `jsPDF`, removendo a dependência do Syncfusion para essa funcionalidade.

  ## 1.9.869
- **Cloud/Word**: O editor oculto da conversão passou a permanecer invisível dentro da viewport, reduzindo travas de renderização/exportação em segundo plano.
- **Cloud/Word**: A exportação PDF do Syncfusion agora reaplica o `serviceUrl` e força ajuste de layout antes do `saveAsBlob('Pdf')`.

  ## 1.9.868
- **Cloud/Word**: O editor oculto usado na conversão para PDF agora possui identificador exclusivo, evitando conflito interno com outras instâncias do editor e reduzindo timeouts na exportação.

  ## 1.9.867
- **Cloud/Word**: A conversão de Word para PDF passou a aguardar um sinal real de documento carregado no editor antes da exportação.
- **Cloud/Word**: O botão de conversão agora mostra `Convertendo...` imediatamente após o clique para indicar que a ação foi iniciada.

  ## 1.9.866
- **Cloud/Word**: A conversão de Word para PDF não força mais atualização visual do preview durante o processamento.
- **Cloud/Word**: Removida a validação frágil de renderização completa antes da exportação, reduzindo falhas com a mensagem de demora excessiva para renderizar.

  ## 1.9.865
- **Cloud/Word**: A conversão de Word para PDF agora valida a renderização das páginas antes de exportar e interrompe com erro controlado quando excede o tempo limite, evitando ficar processando indefinidamente.

  ## 1.9.864
- **Cloud/Word**: O aviso `Estamos convertendo...` foi reposicionado para o topo da tela, evitando conflito com o botão de mensagens.
- **Cloud/Word**: Corrigido o fluxo de conversão Word->PDF no Cloud com espera real do carregamento do documento no editor antes da exportação.

  ## 1.9.863
- **Cloud/Word**: Adicionado feedback visual animado com a mensagem `Estamos convertendo...` durante a conversão de Word para PDF no Cloud.

  ## 1.9.862
- **Cloud/Word**: A conversão de `.docx` para PDF no Cloud foi estabilizada com exportação via editor Syncfusion, preservando melhor paginação, layout e tipografia do documento.

  ## 1.9.861
- **Cloud/Word**: Adicionada a função de converter arquivos Word `.docx` em PDF diretamente no Cloud, com ação disponível no menu contextual e nas ações do arquivo selecionado.

  ## 1.9.860
- **Cloud/PDF Preview**: Corrigido o reflash automático do modal de PDF ao navegar no Cloud. O preview não recarrega mais apenas por mudança de pasta ou atualização visual incidental.

  ## 1.9.859
- **Cloud/Cards**: Os controles `P/M/G` agora também alteram o tamanho visual dos cards de pasta, incluindo altura, padding, espaçamento e ícone, mantendo consistência com os arquivos.

  ## 1.9.858
- **Cloud/Header**: Os controles `Lista/Cards` e `P/M/G` do header global agora refletem corretamente o estado ativo do `CloudModule`, inclusive o botão de `Filtros`.
- **Cloud/UX**: Adicionada transição visual curta na troca entre os modos `Lista` e `Cards`, deixando a mudança de visualização perceptível.

  ## 1.9.856
- **Cloud/Hub PDF**: Clarificada a interface do Hub PDF quando há múltiplos PDFs selecionados. O cabeçalho e o resumo agora deixam explícita a diferença entre o `PDF atual` aberto para edição e os `PDFs selecionados para juntar`.
- **Cloud/Hub PDF**: Adicionada uma listagem visual dos PDFs selecionados para juntar dentro do Hub, com destaque para o arquivo atualmente aberto.

  ## 1.9.848
- **Cloud/Loading**: Removidas as bordas visíveis do card e do núcleo da animação de carregamento, mantendo apenas brilho e profundidade visual.
- **Cloud/UX**: O loading ficou mais limpo e leve, sem contornos marcados ao redor da animação.

  ## 1.9.847
- **Cloud/Loading**: A animação da tela de carregamento do Cloud ficou mais fluida, com camadas de movimento mais suaves no ícone e transições visuais mais elegantes.
- **Cloud/UX**: A barra de progresso e os indicadores de sincronização foram refinados para transmitir carregamento ativo de forma mais moderna e limpa.

  ## 1.9.846
- **Cloud/Sidebar**: Largura da coluna lateral ampliada para melhorar a leitura dos nomes de clientes e pastas na árvore e listas rápidas.
- **Cloud/UX**: Nomes longos agora usam truncamento com ellipsis em vez de quebrar em várias linhas na sidebar.

  ## 1.9.845
- **Cloud/PDF Preview**: O preview de PDF agora ocupa a altura total real da página, sem margem superior ou inferior.
- **Cloud/View**: A largura tradicional do modal foi preservada, com expansão aplicada apenas no eixo vertical.

  ## 1.9.844
- **Cloud/PDF Preview**: Mantida a largura anterior do modal de preview, com ajuste aplicado somente na altura.
- **Cloud/View**: O PDF continua com mais altura útil, sem abrir em largura total.

  ## 1.9.843
- **Cloud/PDF Preview**: Modal de visualização de PDF ajustado para ocupar a altura total da página.
- **Cloud/View**: A área de preview agora usa a tela inteira, aumentando a leitura e a área útil do documento.

  ## 1.9.842
- **Cloud/Breadcrumb**: Removido o texto `Cloud`, mantendo um breadcrumb mais limpo com o ícone inicial e a pasta atual.
- **Cloud/Header**: Barra de busca compactada novamente com menor altura vertical para liberar mais área útil.
- **Cloud/UX**: Badge `Sem cliente` mantido colado ao campo de busca para leitura mais natural.
- **Cloud/Cards**: Cards ampliados mais uma vez para ocupar melhor telas largas.
- **Cloud/Sidebar**: Espaçamento vertical da lateral reduzido para mostrar mais itens sem scroll.

  ## 1.9.841
- **Cloud/Header**: Reduzida a altura da barra contextual com menos padding vertical no bloco da busca.
- **Cloud/UX**: O status `Sem cliente` foi aproximado da busca para melhorar o equilíbrio visual da barra superior.
- **Cloud/Cards**: Cards ampliados novamente com largura mínima maior para reduzir o vazio horizontal no explorador.

  ## 1.9.840
- **Cloud/Layout**: Reduzido ainda mais o padding externo do módulo para aproximar o conteúdo do navbar e das bordas laterais.
- **Cloud/Cards**: Grid ampliado com largura mínima maior para aproveitar melhor a área horizontal e exibir mais conteúdo por linha.
- **Cloud/Divisória**: Suavizado o alinhamento visual entre sidebar e área de cards com bordas mais leves no cabeçalho do explorador.

  ## 1.9.839
- **Cloud/Navbar**: Removido o título `Cloud` do navbar superior para eliminar redundância visual.
- **Cloud/Layout**: Reduzidos paddings e margens do módulo para aproveitar melhor a largura e a altura da tela.
- **Cloud/Workspace**: Sidebar e área principal ficaram mais próximas do navbar e das bordas, ampliando a área útil de trabalho.

## 1.9.838
- **Cloud/Layout**: Campo `Pesquisar nesta pasta` reposicionado para a barra contextual do Cloud, ao lado do breadcrumb e do status do cliente.
- **Cloud/UI**: Removido o visual isolado da busca no canto direito do cabeçalho de conteúdo.
- **Cloud/UX**: Melhorado o equilíbrio visual da seção com título, busca e status agrupados em um único bloco.

## 1.9.837
- **Cloud/UI**: Removido o menu de ações duplicado dentro da área de conteúdo do Cloud.
- **Cloud/Navbar**: Mantido apenas o menu superior com Enviar, Nova pasta, Filtros, Lista/Cards e P/M/G.
- **Cloud/UX**: Melhorada a hierarquia visual com redução de redundância e poluição na interface.

## 1.9.836
- **Cloud/UI**: Botões de ação movidos para o header principal do sistema.
- **Cloud/Header**: Enviar, Nova pasta, Filtros, Lista/Cards e P/M/G agora aparecem no header global.
- **Cloud/Header**: Botões são exibidos apenas quando o módulo Cloud está ativo.
- **Cloud/Header**: Design consistente com outros botões do sistema (shadow, border, hover effects).
- **Cloud/Organização**: Header do CloudModule agora contém apenas busca e navegação mobile.

## 1.9.834
- **Cloud/Seleção**: Corrigido menu contextual para manter seleção múltipla ao abrir com botão direito.
- **Cloud/Preview**: Adicionada navegação com setas entre imagens no preview (← →).
- **Cloud/Preview**: Adicionado botão "Converter para PDF" diretamente no preview de imagens.
- **Cloud/Preview**: Melhorado header do preview para mostrar contador de imagens (ex: "1 de 5").
- **Cloud/Ferramentas**: Mantido botão "Girar 90°" para imagens e PDFs no preview.

## 1.9.833
- **Cloud/Seleção**: Corrigido menu contextual para manter seleção múltipla ao abrir com botão direito.
- **Cloud/Preview**: Adicionada navegação com setas entre imagens no preview (← →).
- **Cloud/Preview**: Adicionado botão "Converter para PDF" diretamente no preview de imagens.
- **Cloud/Preview**: Melhorado header do preview para mostrar contador de imagens (ex: "1 de 5").
- **Cloud/Ferramentas**: Mantido botão "Girar 90°" para imagens e PDFs no preview.

## 1.9.832
  - **Cloud/Crash**: Corrigido o erro `Cannot access 'explorerItemKeys' before initialization` causado pela ordem de inicialização dos hooks da seleção por caixa no `CloudModule`.

  ## 1.9.831
  - **Cloud/Header**: Corrigido o chip de cliente no topo para priorizar o cliente do item selecionado antes do cliente da pasta aberta, evitando exibir `Sem cliente` ao clicar em pasta vinculada.

  ## 1.9.830
  - **Cloud/Produtividade**: Implementado renomear inline em lista/cards com suporte ao `F2`, `Enter` e `Esc` no estilo desktop.
  - **Cloud/Seleção**: Adicionada seleção por caixa ao arrastar no espaço vazio do explorador.
  - **Cloud/Cards**: Adicionado zoom dos cards com tamanhos pequeno, médio e grande, persistido localmente.
  - **Cloud/Favoritos**: Arquivos agora também podem ser fixados em favoritos pela lista, cards e menu contextual.
  - **Cloud/Recentes**: Adicionado bloco de arquivos recentes com rastreamento de abertura e download.
  - **Cloud/Drag and Drop**: Melhorado o feedback visual de pasta alvo e do estado da ação (`mover`, `copiar`, `recortar`).

  ## 1.9.829
  - **Cloud/Rolagem**: Removidos os scrolls internos da navegação lateral e da área principal de arquivos para priorizar rolagem única da página.
  - **Cloud/Sidebar**: A navegação lateral agora acompanha a página com comportamento `sticky`, sem criar rolagem própria.

  ## 1.9.828
  - **Cloud/Cards**: Corrigido o bug de pastas com espaço vazio excessivo no modo cards.
  - **Cloud/Layout**: Os cards de pasta não esticam mais para acompanhar a altura de arquivos vizinhos na mesma linha.

  ## 1.9.827
  - **Cloud/Cards**: Ajustada a grade do modo cards para caber 4 itens por linha com mais conforto em larguras maiores.
  - **Cloud/Layout**: Reduzida a largura mínima dos cards no explorador para aproveitar melhor o espaço horizontal disponível.

  ## 1.9.826
  - **Cloud/Renomear PDF**: A extensão `.pdf` foi protegida no modal de renomear para evitar alteração acidental.
  - **Cloud/Renomear PDF**: O campo de edição agora altera apenas o nome base do arquivo, mantendo `.pdf` fixo no final.

  ## 1.9.825
  - **Cloud/Cards**: Os cards de pasta ficaram mais compactos, com ícone menor em estilo mais próximo do Windows.
  - **Cloud/Cards**: Removidas as informações abaixo das pastas em modo cards, como cliente e data de modificação.

  ## 1.9.824
  - **Cloud/Modal Renomear**: Corrigida a sobreposição para o modal de renomear abrir acima do modal de preview/view.
  - **Cloud/Empilhamento**: Ajustado o `z-index` dos modais de renomeação para evitar que fiquem escondidos atrás da visualização do arquivo.

  ## 1.9.823
  - **Cloud/Nova pasta**: Corrigido o clique com botão direito no espaço vazio para abrir o menu contextual com a ação `Nova pasta`.
  - **Cloud/Estado vazio**: A ação de criação de pasta na tela vazia/inicial foi padronizada como `Nova pasta` para ficar mais visível.

  ## 1.9.822
  - **Cloud/PDF Preview**: O modal de visualização de PDF agora permite navegar entre outros PDFs da lista em modo galeria.
  - **Cloud/PDF Preview**: Adicionadas ações rápidas no modal para `Renomear`, `Baixar`, `Excluir` e abrir o `Hub PDF`.

  ## 1.9.821
  - **Cloud/Seleção**: Corrigido o `Ctrl`/`Cmd` na árvore lateral para permitir seleção aditiva de pastas sem substituir a seleção atual.
  - **Cloud/Atalhos de clique**: A árvore lateral passou a respeitar também `Shift+clique` para seleção em intervalo usando a mesma lógica do explorador principal.

  ## 1.9.820
  - **Cloud/Lateral**: O painel lateral de detalhes não abre mais automaticamente ao selecionar arquivos ou pastas.
  - **Cloud/Seleção**: Melhorada a experiência de multisseleção, evitando que o painel lateral atrapalhe a marcação de vários itens.

  ## 1.9.819
  - **Cloud/PDF**: A seção `Páginas do PDF` agora mostra miniaturas reais das páginas em vez de apenas blocos numerados.
  - **Cloud/Preview**: Melhorada a seleção visual de páginas no Hub PDF com preview imediato do conteúdo de cada página.

  ## 1.9.818
  - **Cloud/Crash**: Corrigido o erro `Cannot access 'handlePasteClipboardToFolder' before initialization` que derrubava o Cloud após a adição do atalho de colar.
  - **Cloud/Atalhos**: O listener global do teclado foi reordenado para inicializar depois dos handlers de clipboard, mantendo `Ctrl+V` funcional sem quebrar a tela.

  ## 1.9.817
  - **Cloud/Colar**: Adicionado botão visível de `Colar` na barra superior da pasta atual, inclusive em subpastas, quando há itens copiados ou recortados.
  - **Cloud/Atalhos**: Adicionados `Ctrl+C`, `Ctrl+X` e `Ctrl+V` para copiar, recortar e colar diretamente no Cloud.

  ## 1.9.816
  - **Cloud/Atalhos**: Corrigido o atalho do teclado para `Delete/Del` voltar a enviar itens selecionados para a lixeira.
  - **Cloud/Seleção**: O handler de exclusão por teclado agora permanece sincronizado com a seleção atual do explorador.

  ## 1.9.815
  - **Cloud/Upload de pastas**: Corrigido o envio de pastas para preservar a pasta raiz ao arrastar/jogar conteúdo no Cloud.
  - **Cloud/Estrutura**: O módulo agora usa o caminho relativo real do navegador ao importar arquivos, evitando que apenas os arquivos internos sejam recriados soltos no destino.

  ## 1.9.814
  - **Cloud/Clipboard**: Adicionadas as ações `Copiar`, `Recortar` e `Colar` para arquivos, pastas e seleções dentro do módulo Cloud.
  - **Cloud/Cópias**: Adicionada a ação `Criar cópia` para arquivos e pastas, incluindo duplicação de subpastas e arquivos internos.

  ## 1.9.813
  - **Cloud/Ações**: Adicionadas as opções `Recortar seleção para cá` e `Copiar seleção para cá` no menu das pastas.
  - **Cloud/UX**: Agora é possível enviar itens selecionados diretamente para uma pasta-alvo, movendo ou criando cópias do conteúdo sem sair do fluxo atual.

  ## 1.9.812
  - **Cloud/Lixeira**: Garantida a exclusão definitiva ao esvaziar a lixeira, inclusive para itens aninhados já marcados como removidos.
  - **Cloud/Storage**: Pastas apagadas agora percorrem também arquivos e subpastas que já estavam na lixeira, removendo registros e arquivos físicos para liberar espaço.

  ## 1.9.811
  - **Cloud/Lixeira**: Corrigido o modal de esvaziamento da lixeira que ainda podia aparecer com fundo preto no estado de sucesso.
  - **Cloud/UX**: O feedback visual da remoção permanente agora mantém base branca e contraste estável também ao concluir o esvaziamento.

  ## 1.9.810
  - **Cloud/Modal**: Corrigido o modal de transferência e exclusão que podia aparecer com fundo escuro/preto e texto com baixo contraste.
  - **Cloud/UX**: As superfícies dos modais de progresso agora forçam tema claro para manter legibilidade consistente durante upload e exclusão.

  ## 1.9.809
  - **Cloud/PDF**: Corrigido o erro que podia quebrar o preview após enviar vários documentos ou renomear arquivos no Cloud.
  - **Cloud/UX**: O ciclo de vida dos previews foi estabilizado para limpar estados inválidos e remontar o preview PDF quando a URL/arquivo muda.

  ## 1.9.808
  - **Cloud/Sidebar**: O ícone de vínculo das pastas na árvore lateral foi reposicionado para aparecer ao lado do nome, em vez de abaixo.
  - **Cloud/UX**: A leitura da lista lateral ficou mais compacta e alinhada visualmente.

  ## 1.9.807
  - **Cloud/Sidebar**: O indicador de vínculo na árvore lateral agora aparece apenas como ícone visual, sem texto, deixando a leitura mais limpa.
  - **Cloud/UX**: Pastas vinculadas exibem apenas o ícone verde e pastas sem vínculo exibem apenas o ícone vermelho.

  ## 1.9.806
  - **Cloud/Sidebar**: O selo lateral das pastas agora usa status visual mais direto: `Corrigido` em verde quando há vínculo e `X` em vermelho quando não há.
  - **Cloud/UX**: Refinado o feedback visual da árvore lateral para facilitar leitura rápida do estado de cada pasta.

  ## 1.9.805
  - **Cloud/UX**: Ajustada a interação entre seleção e abertura de itens para que o painel lateral de detalhes não roube a intenção de duplo clique ao entrar em pastas.
  - **Cloud/Navegação**: A abertura automática do drawer de detalhes agora respeita um pequeno atraso cancelável, melhorando a fluidez ao navegar por pastas e arquivos.

  ## 1.9.804
  - **Cloud/Peticionamento**: Corrigida a abertura de arquivos Word vindos do Cloud para evitar importação duplicada do documento no editor de petições.
  - **Peticionamento/Performance**: O widget flutuante do editor deixa de carregar a lista pesada de petições salvas quando é aberto apenas para importar um documento inicial, reduzindo risco de `statement timeout`.
  - **Peticionamento/Logs**: Removidos logs ruidosos do fluxo de importação inicial e da configuração do Syncfusion.

  ## 1.9.803
  - **Cloud/UX**: O painel de detalhes agora abre como drawer overlay à direita, preservando a largura da área principal e permitindo abrir/fechar os detalhes sob demanda.
  - **Cloud/Cards**: A visualização em cards passou a usar grid responsivo com largura mínima por card, reduzindo deformações quando o espaço disponível diminui.

  ## 1.9.802
  - **Cloud/Sidebar**: Ajustado o layout da árvore lateral para deixar as informações auxiliares abaixo do nome da pasta, reforçando a leitura vertical e reduzindo a sensação de conteúdo espremido.

  ## 1.9.801
  - **Cloud/Sidebar**: Melhorada a árvore lateral de pastas para evitar esmagamento visual em nomes longos, com título em até duas linhas e selo de vínculo posicionado abaixo do nome.

  ## 1.9.800
  - **Cloud/Caixa de entrada**: Corrigida a identificação de pastas e arquivos arrastados ao soltar na `Caixa de entrada`, resolvendo cenários em que o highlight aparecia mas a restauração/desarquivamento não era executado.

  ## 1.9.799
  - **Cloud/Sidebar**: Corrigida a identificação de pastas/arquivos arrastados ao soltar em `Arquivado` e `Lixeira`, resolvendo o caso em que o highlight aparecia mas nenhuma ação era executada.

  ## 1.9.798
  - **Cloud/Sidebar**: `Arquivado` e `Lixeira` agora aceitam drop direto de arquivos e pastas na lateral, executando arquivamento ou envio para lixeira com feedback visual.

  ## 1.9.797
  - **Cloud/Caixa de entrada**: Agora é possível arrastar pastas e arquivos de `Arquivado` ou `Lixeira` para a `Caixa de entrada`, restaurando/desarquivando o item automaticamente.

  ## 1.9.796
  - **Cloud/Lixeira**: Corrigido o filtro da view da Lixeira para usar `delete_scheduled_for`, eliminando o bug onde o contador mostrava itens mas a tela renderizava vazia.

  ## 1.9.795
  - **Cloud/Lixeira**: Corrigida lógica de filtro para exibir corretamente pastas e arquivos de topo na Lixeira, evitando visualização vazia quando há itens.
  - **Cloud/UX**: Modal de upload já está com tema claro - se ainda aparecer escuro, limpe o cache do navegador (Ctrl+Shift+R).

  ## 1.9.794
  - **Cloud/Arquivado**: Corrigida a contagem para considerar apenas itens de topo no Arquivado, sem somar arquivos que já estão dentro de pastas arquivadas.
  - **Cloud/Lixeira**: Corrigida a visualização e contagem para considerar apenas itens de topo da Lixeira, sem exibir ou somar arquivos internos de pastas já deletadas.

  ## 1.9.793
  - **Cloud/Lixeira**: Corrigida regressão onde pastas excluídas ainda estavam sendo arquivadas em vez de irem para a Lixeira, causando a visualização vazia.
  - **Cloud/UX**: Refinado o modal animado de upload para remover o restante do visual escuro no tema claro.

  ## 1.9.792
  - **Cloud/UX**: Ajustado o visual dos modais animados de carregamento e exclusão para respeitar corretamente o tema claro, removendo a aparência escura indevida.

  ## 1.9.791
  - **Cloud/UX**: Melhorada a animação de carregamento principal do Cloud com card animado, barra dinâmica e estados visuais mais premium.
  - **Cloud/UX**: Reforçada a animação do modal de exclusão/processamento com transições mais visíveis, indicador circular, brilho dinâmico e feedback visual para sucesso/erro.

  ## 1.9.790
  - **Cloud/Sidebar**: Corrigidos os contadores de `Arquivado` e `Lixeira` para mostrar a quantidade real de objetos, independentemente da pasta ou visualização atual.

  ## 1.9.789
  - **Cloud/Sidebar**: Removido o bloco `Recentes` da lateral do Cloud.
  - **Cloud/Sidebar**: `Arquivado` e `Lixeira` foram reposicionados para baixo da árvore de pastas ativas.

  ## 1.9.788
  - **Cloud/Lixeira**: Restaurada a lixeira dedicada do Cloud. Excluir item volta a enviar para a Lixeira em vez de confundir com Arquivado.
  - **Cloud/Arquivado**: O Arquivado volta a representar apenas itens arquivados manualmente, sem reativar exclusão automática.
  - **Cloud/Bugfix**: Ajustados filtros, restauração e contadores para separar corretamente itens da Lixeira e do Arquivado.

  ## 1.9.787
  - **Cloud/Arquivado**: Corrigida a hierarquia da área `Arquivado` para impedir que subpastas e arquivos de uma pasta pai arquivada apareçam soltos no nível raiz.
  - **Cloud/UX**: A visualização do Arquivado agora respeita melhor a estrutura original das pastas arquivadas.

  ## 1.9.786
  - **Cloud/Compartilhamento Público**: Corrigido o fluxo de acesso público para evitar a busca direta da pasta raiz compartilhada, reduzindo o risco de `statement timeout` e erro `500` no link público.
  - **Cloud/Compartilhamento Público**: Mensagem de link sem senha foi mantida mais clara, com acesso automático quando o compartilhamento não exige senha.

  ## 1.9.785
  - **Cloud/Compartilhamento Público**: A página pública da pasta agora só exibe campo de senha quando o link realmente possui senha.
  - **Cloud/Compartilhamento Público**: Links sem senha passam a entrar automaticamente na pasta compartilhada, sem exigir interação desnecessária.
  - **Cloud/Bugfix**: O carregamento público foi simplificado para evitar consultas desnecessárias na página compartilhada, reduzindo risco de timeout/erro 500.

  ## 1.9.784
  - **Cloud/Arquivado**: Removida a exclusão automática de itens arquivados. O arquivamento agora funciona apenas como estado manual até você restaurar ou excluir manualmente.
  - **Cloud/UI**: Textos e indicadores de agendamento automático foram removidos da interface do Arquivado.

  ## 1.9.783
  - **Cloud/Bugfix**: Corrigido o layout dos cards de pasta no modo visual, evitando quebra/empilhamento incorreto dos botões de ação no canto superior.
  - **Cloud/Arquivado**: A área `Arquivado` passou a exibir também arquivos arquivados, não apenas pastas.
  - **Cloud/UX**: Adicionadas ações mais coerentes para arquivos arquivados, incluindo opção de desarquivar diretamente pela interface e pelo menu de contexto.

  ## 1.9.782
  - **Cloud/Arquivado**: Adicionada a área `Arquivado` na navegação do Cloud, ao lado de `Este Computador` e `Lixeira`.
  - **Cloud/Arquivamento**: Pastas arquivadas agora podem ser visualizadas em uma área dedicada, com ação de arquivar mais acessível na interface.

  ## 1.9.781
  - **Cloud/Pastas**: Os cards de pastas ficaram menores e mais compactos, com visual mais próximo do Explorer do Windows.
  - **Cloud/UI**: O ícone visual de pasta foi redesenhado para se aproximar do estilo mostrado na referência enviada.

  ## 1.9.780
  - **Cloud/Lixeira**: Adicionado botão visível de `Esvaziar lixeira` no topo da visualização da lixeira, facilitando o acesso à ação dentro da própria pasta.

  ## 1.9.779
  - **Cloud/Lixeira**: A lixeira passou a funcionar como uma pasta/área real do Cloud, navegável pela lateral, exibindo arquivos e pastas arquivados no conteúdo principal.
  - **Cloud/Exclusão**: Excluir pastas agora envia a árvore inteira para a lixeira em vez de remover permanentemente de imediato.
  - **Cloud/UI**: Removido o bloco `Histórico recente` da lateral para reduzir confusão visual.

  ## 1.9.778
  - **Cloud/Explorer**: Removido o botão `Colar print` da toolbar, mantendo a funcionalidade disponível pelo atalho `Ctrl+V`.
  - **Cloud/UI**: Barra superior, breadcrumb e navegação lateral foram refinados para deixar o módulo mais próximo da experiência visual do Windows Explorer.

  ## 1.9.777
  - **Cloud/Lixeira**: A lateral do Cloud foi reorganizada com uma lixeira dedicada, visual próprio para arquivos excluídos e ação de `Esvaziar lixeira` no estilo Windows.
  - **Cloud/Organização**: Pastas arquivadas, lixeira e histórico recente foram separados em blocos mais claros para reduzir confusão visual na navegação lateral.

  ## 1.9.776
  - **Cloud/Upload**: A antiga fila visual inline foi substituída por um modal premium de progresso com status por arquivo, barra animada, fechamento automático no sucesso total e ação de tentar novamente nos itens com falha.
  - **Cloud/Exclusão**: A exclusão e o envio para lixeira agora exibem um modal animado mostrando o documento sendo removido, com feedback visual de processamento, sucesso e erro.

  ## 1.9.775
  - **Cloud/UI**: Removido o cabeçalho redundante com `Cloud / Raiz` e o contador superior de itens, deixando a navegação mais limpa.
  - **Cloud/Responsivo**: Melhorada a responsividade do módulo com painel lateral recolhível no mobile, toolbar adaptável e layout de lista mais flexível em telas menores.
  - **Cloud/UX**: Reforçada a hierarquia visual com breadcrumb dedicado e melhor distribuição das informações entre navegação, ações e conteúdo.

  ## 1.9.774
  - **Cloud/Lixeira**: Arquivos do Cloud agora vão para a lixeira antes da exclusão definitiva, com restauração rápida e indicação de data prevista para remoção permanente.
  - **Cloud/Histórico**: Adicionada base de histórico de atividades no banco e painel lateral com eventos recentes de arquivos, pastas e links compartilhados.

  ## 1.9.773
  - **Cloud/Busca**: Adicionada busca global com filtros por cliente, etiqueta, extensão, data e tamanho, permitindo localizar arquivos e pastas com mais precisão em todo o Cloud.
  - **Cloud/Organização**: Adicionados favoritos locais para pastas, renomeação em lote, movimentação em lote, atalhos de teclado (`F2`, `Ctrl+M`, `Ctrl+Shift+R`) e reforço do menu de contexto com ações rápidas para seleção múltipla.

  ## 1.9.772
  - **Cloud/Upload**: Adicionada fila de upload com estados por arquivo (`na fila`, `enviando`, `concluído`, `falhou`), retry individual e barra de progresso visual por item e total do lote.
  - **Cloud/Raiz**: Arquivos soltos enviados na raiz do Cloud agora criam automaticamente uma pasta de upload, enquanto o arraste de diretórios passou a preservar melhor a estrutura completa de pastas e subpastas.

  ## 1.9.771
  - **Cloud/PDF**: Corrigido o preview de PDFs no modo cards do Cloud para renderizar a primeira página real do documento, em vez de exibir apenas um placeholder com ícone.

  ## 1.9.770
  - **Cloud/Upload**: Corrigida a leitura do caminho no arraste de pasta para preservar o nome da pasta raiz e recriar a estrutura completa no Cloud, inclusive quando o drop acontece em `/cloud`.

  ## 1.9.769
  - **Cloud/Upload**: Ajustada a tipagem do suporte a arrastar pasta para manter a leitura recursiva de diretórios compatível com os navegadores sem depender de tipos DOM ausentes no build.

  ## 1.9.768
  - **Cloud/Upload**: O Cloud agora aceita arrastar pasta com arquivos, lendo os itens internos do diretório e enviando tudo pelo mesmo fluxo de upload já usado para arquivos avulsos.

  ## 1.9.767
  - **Cloud/Upload**: O arraste de pasta no Cloud agora é interceptado e rejeitado com mensagem clara, evitando tentativas inválidas de upload que geravam erro ao tratar diretório como arquivo.

  ## 1.9.766
  - **Service Worker**: Incrementada versão do cache para forçar limpeza de URLs antigas que causavam `ERR_ACCESS_DENIED` em arquivos do Cloud.

  ## 1.9.765
  - **Assinaturas/Cloud**: Ajustada a busca de URLs assinadas no módulo de assinaturas para também tentar o bucket `cloud-files`, evitando `ERR_ACCESS_DENIED` ao abrir selfie e assinatura salvas no Cloud.

  ## 1.9.764
  - **Cloud/Storage**: Removidas novamente as chamadas administrativas de bucket no frontend do Cloud, eliminando os erros `400` em `storage/v1/bucket/cloud-files`.
  - **Assinaturas**: Corrigido o update de solicitações para não falhar com `406` ao coercionar o retorno para um único objeto JSON.

  ## 1.9.763
  - **Peticionamento/Performance**: A abertura de documentos do Cloud no editor agora inicia em paralelo ao carregamento do módulo, reduzindo o tempo percebido até o DOCX começar a abrir.

  ## 1.9.762
  - **Cloud/UX**: Removida a duplicidade entre `Abrir editor` e `Abrir no módulo petição` nos arquivos Word do Cloud, mantendo apenas uma ação de abertura.

  ## 1.9.761
  - **Peticionamento/DOCX**: Corrigido o endpoint de importação de DOCX para usar o serviço oficial documentado da Syncfusion: `https://document.syncfusion.com/web-services/docx-editor/api/documenteditor/`.
  - **Peticionamento/DOCX**: Resolve definitivamente o erro `404` que ocorria com o endpoint antigo `ej2services.syncfusion.com`.
  - **Peticionamento/DOCX**: Atualizada a Edge Function `syncfusion-import` para usar o mesmo endpoint oficial.

  ## 1.9.760
  - **Peticionamento/DOCX**: Forçada a aplicação do `serviceUrl` diretamente no `documentEditor` interno do Syncfusion durante a criação do editor e antes do `editor.open(file)`.
  - **Peticionamento/DOCX**: Corrige o cenário em que o container recebia a URL configurada, mas a conversão interna de `.docx` ainda caía no endpoint padrão `ej2services.syncfusion.com`.

  ## 1.9.759
  - **Peticionamento/DOCX**: Removida a conversão manual/proxy de `.docx` no `SyncfusionEditor`.
  - **Peticionamento/DOCX**: O carregamento voltou ao fluxo padrão do Syncfusion, usando apenas `editor.open(file)`.

  ## 1.9.758
  - **Peticionamento/DOCX**: Criada Edge Function `syncfusion-import` no Supabase para fazer proxy do serviço de conversão DOCX → SFDT.
  - **Peticionamento/DOCX**: O `SyncfusionEditor` agora tenta a Edge Function primeiro, com fallback para o endpoint público do Syncfusion.
  - **Peticionamento/DOCX**: Resolve o erro `404` do endpoint público `ej2services.syncfusion.com` que não é confiável para produção.

  ## 1.9.757
  - **Peticionamento/DOCX**: Restaurado `SyncfusionEditor.tsx` do commit `3994aeb` (versão que funcionava com formatação preservada).
  - **Peticionamento/DOCX**: O fluxo volta ao comportamento original: `.docx` abre via `editor.open(file)` e `.doc` usa o serviço `Import`.

  ## 1.9.756
  - **Peticionamento/DOCX**: Arquivos `.docx` agora são carregados via `mammoth.convertToHtml`, preservando formatação básica (negrito, itálico, listas, parágrafos) sem depender do endpoint `Import` do Syncfusion.
  - **Peticionamento/DOCX**: Elimina o erro `404` no console mantendo a formatação do documento.

  ## 1.9.755
  - **Peticionamento/DOCX**: Arquivos `.docx` agora são carregados diretamente via `mammoth` no `SyncfusionEditor`, eliminando completamente a chamada ao endpoint `Import` do Syncfusion e o erro `404` no console.
  - **Peticionamento/DOCX**: Arquivos `.doc` legados continuam usando o serviço `Import` quando disponível.

  ## 1.9.754
  - **Peticionamento/DOCX**: Corrigido o fluxo de importação no `SyncfusionEditor` após confirmar via stack trace que `editor.open(file)` também dispara `Import` internamente no Syncfusion para arquivos `.docx`.
  - **Peticionamento/DOCX**: Quando essa abertura nativa falhar com `404` no endpoint `Import`, o editor agora aplica fallback local com `mammoth`, evitando quebra no carregamento do documento.

  ## 1.9.753
  - **Peticionamento/DOCX**: Restaurada a penúltima versão do `git` para `src/components/SyncfusionEditor.tsx` (commit base `3994aeb`). O fluxo volta a abrir arquivos `.docx` diretamente no editor.
  - **Peticionamento/DOCX**: Arquivos `.doc` continuam usando o serviço `Import`, e o método `loadDocxViaImport` permanece disponível para fluxos que precisam forçar conversão server-side.

  ## 1.9.752
  - **Peticionamento/DOCX**: Restaurada a versão anterior ao ajuste `1.9.751`, voltando a priorizar a conversão via serviço `Import` para abertura de `.docx` no `SyncfusionEditor`.
  - **Peticionamento/DOCX**: Mantido o fallback local com `mammoth` apenas quando a conversão do `Import` falhar.

  ## 1.9.751
  - **Peticionamento/DOCX**: Restaurado o comportamento anterior do `SyncfusionEditor` conforme o fluxo que estava funcionando no `git`: arquivos `.docx` voltam a abrir diretamente no editor, enquanto arquivos `.doc` continuam usando o serviço `Import`.
  - **Peticionamento/DOCX**: Mantido o método `loadDocxViaImport` para os fluxos que precisam forçar a conversão server-side.

  ## 1.9.750
  - **Peticionamento/DOCX**: O `SyncfusionEditor` voltou a priorizar a conversão via serviço `Import` também para arquivos `.docx`, preservando a formatação original do documento sempre que o endpoint estiver disponível.
  - **Peticionamento/DOCX**: O fallback local com `mammoth` foi mantido apenas como contingência quando a conversão com formatação falhar.

  ## 1.9.749
  - **SQL/Peticionamento**: O script `sql/optimize_petition_editor.sql` agora valida a existência de colunas antes de criar índices, evitando falhas em bancos com schema legado sem `user_id` ou outras colunas opcionais.
  - **SQL/Peticionamento**: Mantida a execução idempotente para índices e publicação realtime, permitindo reaplicar o script com segurança.

  ## 1.9.748
  - **Syncfusion Editor**: Restaurado `serviceUrl` para evitar erro 404 ao utilizar o botão 'Abrir' da barra de ferramentas nativa.
  - **DOCX Local Loading**: Adicionado log de depuração para inspecionar o tamanho do `ArrayBuffer` e validar falhas de download.
  - **Resiliência de Rede**: Melhorado o tratamento de erros no `PetitionEditorModule` para identificar timeouts do Supabase e arquivos vazios (0 bytes).
  - **Performance de Banco**: Criado script de otimização `sql/optimize_petition_editor.sql` com índices estratégicos para as tabelas `petition_blocks`, `saved_petitions` e `petition_default_templates` para mitigar erros 500 (Statement Timeout).

  ## 1.9.747
  - **Dev/Peticionamento**: O `Service Worker` foi desabilitado no ambiente de desenvolvimento para evitar cache de bundles antigos interferindo no carregamento atual do editor.
  - **Peticionamento**: O carregamento local de arquivos `.docx` agora falha com erro explícito quando não houver conteúdo legível extraído, evitando abertura silenciosa em branco.

  ## 1.9.746
  - **Peticionamento**: Arquivos `.docx` agora são carregados localmente no `SyncfusionEditor` com `mammoth`, eliminando as chamadas ao endpoint `Import` do Syncfusion e os erros `404` correspondentes no console.
  - **Peticionamento**: Arquivos `.doc` legados continuam dependendo de conversão server-side, enquanto os erros `500` atuais de listas/modelos permanecem relacionados ao banco/Supabase.

  ## 1.9.745
  - **Peticionamento**: Removida a dependência do endpoint `Import` do Syncfusion para arquivos `.docx`, eliminando os erros `404` no console ao abrir documentos no editor.

  ## 1.9.744
  - **Cloud**: Corrigido o crash do preview em `Cards` para arquivos PDF, removendo a renderização frágil que derrubava o componente `<Page>` do `react-pdf`.
  - **Cloud/Peticionamento**: Ajustado o carregamento de arquivos `.docx` no editor Syncfusion com fallback automático quando o endpoint `Import` estiver indisponível ou retornar `404`.

  ## 1.9.743
  - **Peticionamento**: Adicionada edição de seleção com IA diretamente no editor Syncfusion.
  - **Peticionamento**: A IA agora usa os blocos mais relevantes como base de conhecimento para refinar o trecho selecionado com linguagem jurídica mais técnica e coerente.

  ## 1.9.742
  - **Cloud**: Ao criar subpasta, o modal foi simplificado para exibir apenas o campo `Nome da subpasta`.
  - **Cloud**: As opções de etiqueta, vínculo com cliente e cadastro de nova etiqueta continuam disponíveis apenas para criação de pasta principal.

  ## 1.9.741
  - **Cloud**: Adicionada opção de `Girar 90°` também no preview do arquivo para imagens e PDFs.
  - **Cloud**: O preview reaproveita a mesma rotação rápida do card, com bloqueio durante o processamento para evitar giros múltiplos acidentais.

  ## 1.9.740
  - **Cloud**: Corrigida a rotação rápida no card para evitar múltiplas rotações no mesmo clique enquanto o arquivo ainda está sendo processado.
  - **Cloud**: Adicionada ação rápida discreta de download sobre o preview do card, mantendo o modo `Cards` mais útil sem abrir menus extras.

  ## 1.9.739
  - **Cloud**: Simplificado o controle de rotação nos cards. O botão textual `Girar` foi substituído por um ícone discreto sobre o preview do arquivo.
  - **Cloud**: Mantida a rotação rápida para imagens e PDFs, agora com menos poluição visual no modo `Cards`.

  ## 1.9.738
  - **Cloud**: Adicionado botão `Girar` diretamente no card de arquivos do modo `Cards` para imagens e PDFs.
  - **Cloud**: A rotação rápida salva a alteração no próprio arquivo sem exigir abertura do preview ou do hub PDF.

  ## 1.9.737
  - **Cloud**: Prints/imagens colados na pasta atual agora são convertidos automaticamente em PDF antes do salvamento.
  - **Cloud**: O botão `Colar print` e o atalho de colagem passam a gerar o arquivo final já em `.pdf`, evitando a etapa manual de conversão após o upload.

  ## 1.9.736
  - **Cloud**: Corrigido o arrastar e soltar para a raiz `/Cloud`. Agora pastas podem voltar para a raiz pelo painel lateral.
  - **Cloud**: Mantido o bloqueio para arquivos na raiz quando o fluxo exigir pasta, exibindo mensagem orientativa em vez de falha silenciosa.

  ## 1.9.735
  - **Cloud**: Removidos também os badges de status (`Pendente`/`Concluído`) das subpastas. Agora esses avisos visuais aparecem apenas nas pastas principais.

  ## 1.9.734
  - **Cloud**: O badge de vínculo com cliente agora aparece somente nas pastas principais. Subpastas não exibem mais esse aviso visual.
  - **Clientes/Cloud**: Adicionada seção `Pastas do Cloud` no detalhe do cliente, mostrando as pastas principais vinculadas, com status ativo/arquivada e data de atualização.

  ## 1.9.733
  - **Cloud**: Corrigida a coluna `Tamanho` no explorador para exibir também o tamanho calculado das pastas, somando arquivos internos e subpastas em vez de mostrar apenas `—`.

  ## 1.9.732
  - **Cloud/Compartilhamento**: Corrigido o erro de `statement timeout` na abertura do link compartilhado, removendo a consulta pesada com join direto na resolução pública do token.
  - **Cloud/Compartilhamento**: O link compartilhado agora é único por pasta. Se o link já existir, o sistema reaproveita o mesmo token em vez de gerar outro.
  - **Cloud/Compartilhamento**: Adicionadas ações para atualizar senha e validade do link existente, remover senha e tornar a pasta privada novamente.
  - **Cloud/Compartilhamento**: O modal agora informa quando a pasta já possui um link único ativo e permite gerenciá-lo sem perder a URL existente.

  ## 1.9.731
  - **Cloud**: Removido o título duplicado do cabeçalho interno, mantendo apenas a navegação atual da pasta.
  - **Cloud**: Adicionado badge visual nas pastas indicando quando estão `Vinculadas` ou `Sem vínculo` com cliente, na árvore lateral, lista e cards.

  ## 1.9.730
  - **Cloud**: Adicionado menu contextual no espaço branco (botão direito) com opções: Nova pasta, Enviar arquivos, Colar imagem, Atualizar, e Converter imagens em PDF (quando há imagens selecionadas).
  - **Cloud**: Agora é possível arrastar arquivos e pastas para a árvore de pastas no painel lateral esquerdo, facilitando a organização.
  - **Hub PDF**: Adicionada função de extrair páginas selecionadas para um novo PDF.
  - **Hub PDF**: Adicionados botões de seleção rápida: Selecionar todas, Inverter seleção, Limpar.
  - **Hub PDF**: Adicionada grade visual de páginas para seleção rápida na tela inicial.
  - **Hub PDF**: Adicionado botão de download direto do PDF.

  ## 1.9.729
  - **Cloud**: Adicionado drag and drop para mover arquivos e pastas arrastando para dentro de outras pastas. Ao arrastar um item sobre uma pasta, ela fica destacada indicando que pode receber o item.
  - **Cloud**: Adicionada função de renomear arquivos e pastas via menu contextual (botão direito).
  - **Cloud**: Adicionada função de duplicar arquivos, criando uma cópia na mesma pasta.
  - **Cloud**: Adicionada função de copiar link do arquivo para a área de transferência.

  ## 1.9.728
  - **Cloud/PDF**: Corrigido o espaço em branco no PDF gerado a partir de imagens. Agora cada página do PDF tem exatamente o tamanho da imagem, sem margens nem espaço extra.
  - **Cloud**: Adicionado `preventDefault` nos handlers de clique para garantir que `Alt`+clique funcione corretamente na seleção múltipla.

  ## 1.9.727
  - **Cloud**: Corrigida definitivamente a seleção múltipla com `Ctrl`/`Alt`/`Cmd` + clique. Adicionado `stopPropagation` nos handlers de clique dos itens para evitar que o evento borbulhe para o container e limpe a seleção.

  ## 1.9.726
  - **Cloud**: Melhorado o modal `Mover arquivo` para listar a pasta principal e suas subpastas com hierarquia visual no seletor de destino, facilitando identificar o nível de cada pasta antes de mover o arquivo.

  ## 1.9.725
  - **Cloud**: Corrigida a limpeza indevida da seleção ao clicar em textos e elementos internos dos itens do explorador. Agora `Ctrl`/`Alt`/`Cmd` + clique mantém corretamente a multiseleção na lista e nos cards.

  ## 1.9.724
  - **Cloud**: Adicionado `Ctrl+A`/`Cmd+A` para selecionar todos os itens visíveis no explorador da pasta atual, reforçando o comportamento de storage/explorer.
  - **Cloud**: Mantidas as melhorias recentes de seleção múltipla com modificadores e navegação por setas no explorador.

  ## 1.9.723
  - **Cloud**: Corrigida a seleção em massa no explorador para voltar a aceitar múltipla seleção com `Ctrl`/`Alt`/`Meta` + clique entre arquivos e pastas.
  - **Cloud**: Adicionada navegação por teclado com setas no estilo explorer/storage. As setas agora movem a seleção entre itens e ajudam na navegação tanto em `Lista` quanto em `Cards`.

  ## 1.9.722
  - **Cloud**: Restaurado o painel de detalhes para aparecer novamente quando um item estiver selecionado, mantendo o comportamento de ocultar o painel quando não houver seleção.
  - **Cloud**: Ajustada a visualização em `Cards` para ficar mais compacta e comportar até 4 itens por linha em telas largas.

  ## 1.9.721
  - **Cloud**: Simplificados os cards de arquivos para reduzir ruído visual. Agora eles exibem badge com o tipo do documento (ex.: `PDF`, `DOC`, `Imagem`) e removem metadados textuais redundantes como tamanho, cliente e data diretamente no card.
  - **Cloud**: Reduzido o tamanho de ícones nos cards e removido o painel lateral de detalhes para arquivos. Ao clicar fora na área branca do explorador, a seleção agora é limpa de fato e o detalhe não permanece visível.

  ## 1.9.720
  - **Cloud/PDF**: O `Hub PDF` passou a executar as ações principais no próprio preview das páginas. Agora é possível organizar folhas por arrastar, girar cada página diretamente na miniatura e remover páginas a partir da seleção visual no editor.
  - **Cloud/PDF**: O modal do hub agora mantém `Salvar PDF` e `Fechar` fixos no rodapé, facilitando o uso contínuo durante a edição.

  ## 1.9.719
  - **Cloud**: Corrigida a persistência do modo de exibição para reabrir corretamente no último layout escolhido (`Lista` ou `Cards`).
  - **Cloud**: Os cards agora exibem preview real do conteúdo quando possível: imagens mostram thumbnail da própria imagem e PDFs mostram a primeira página como miniatura. Outros arquivos continuam com ícone padrão.

  ## 1.9.718
  - **Cloud/PDF**: Redesenhado o `Hub PDF` para uma experiência mais próxima de uma central de ferramentas, com tela inicial em grade e apenas funções essenciais no fluxo atual: `Organizar PDFs`, `Rodar páginas PDF`, `Remover páginas PDF` e `Juntar PDF`.
  - **Cloud/PDF**: O editor do hub agora exibe páginas em grade visual, permitindo seleção mais clara das folhas antes de girar, remover ou reorganizar.

  ## 1.9.717
  - **Cloud**: Melhorado o `View` do painel lateral para mostrar visualização rápida do arquivo selecionado. Imagens agora aparecem diretamente no painel e arquivos suportados também podem exibir conteúdo embutido, como PDF e texto.

  ## 1.9.716
  - **Cloud**: Adicionado acesso rápido às pastas arquivadas na lateral do explorador, com exibição da exclusão agendada e do período restante até a remoção automática.
  - **Cloud**: Adicionada ação de `Desarquivar pasta` no painel de detalhes e no menu contextual, restaurando a pasta ao fluxo normal e removendo o agendamento de exclusão.

## 1.9.715
- **Cloud**: Adicionados modos de exibição `Lista` e `Cards` no explorador, com persistência da preferência do usuário para manter o layout escolhido nas próximas visitas.

## 1.9.714
- **Cloud**: Melhorada a seleção em massa com suporte a `Ctrl`/`Alt`/`Meta` + clique, além de atalhos de teclado com `Del` para excluir itens selecionados e `Enter` para abrir o item em foco.
- **Cloud/PDF**: Adicionado o primeiro `Hub PDF` no `Cloud`, com ações para remover páginas, girar páginas selecionadas e salvar o arquivo editado por cima ou como cópia.

## 1.9.713
- **Assinaturas/Cloud**: Melhorada a identificação da subpasta da contraparte para priorizar o nome do banco/empresa presente no título do contrato, evitando nomes genéricos como `Novo Contrato`. Agora a organização favorece estruturas como `DARIO / NUBANK / NÃO PROTOCOLAR`.

## 1.9.712
- **Cloud**: Padronizados os modais restantes do módulo para visual claro, especialmente `Mover arquivo` e `Compartilhar pasta`, eliminando a aparência preta/escura inconsistente.

## 1.9.711
- **Cloud**: Melhorado o modal de conversão de imagens em PDF para visual claro e consistente com o sistema. A ordenação das imagens agora exibe miniaturas reais e permite reorganização por arrastar e soltar.

## 1.9.710
- **Cloud**: Removido o bloqueio que exigia pasta vazia para exclusão. Agora a exclusão de pastas no `Cloud` apaga recursivamente subpastas e arquivos internos.

## 1.9.709
- **Assinaturas/Cloud**: Quando o mesmo cliente possui múltiplas assinaturas/contratos com réus ou partes contrárias diferentes, o sistema agora cria e identifica subpastas por nome dessas partes antes de `NÃO PROTOCOLAR`, evitando mistura entre contratos do mesmo cliente. A estrutura com processo continua sendo respeitada quando existir.

## 1.9.708
- **Assinaturas/Cloud**: Ajustada a identificação de destino no `Cloud` para casos em que o mesmo cliente possui múltiplos processos. Agora, quando houver processo vinculado, a cópia e a detecção usam a estrutura `Cliente / PROCESSO <número> / NÃO PROTOCOLAR`, mantendo compatibilidade com a estrutura antiga sem processo.

## 1.9.707
- **Assinaturas/Cloud**: O módulo de `Assinaturas` agora exibe visualmente quando a pasta/cópia correspondente já foi criada no `Cloud`, tanto nos cards/lista quanto no detalhe da assinatura, com atualização imediata após a ação `Criar pasta`.

## 1.9.706
- **Cloud**: Adicionado suporte para colar prints/imagens diretamente na pasta atual com nome aleatório. Também foi adicionada conversão de imagens em PDF, com seleção de imagens, modal para organizar a ordem e salvamento do PDF na mesma pasta com o título escolhido.

## 1.9.705
- **Cloud**: O painel `Detalhes` agora fica oculto quando nenhum arquivo ou pasta estiver selecionado. Também foi ajustado o clique em área branca da listagem para limpar a seleção e esconder o painel lateral.

## 1.9.704
- **Cloud/Assinaturas**: Corrigida a atualização imediata do `Cloud` após a cópia de documentos vindos de Assinaturas usando evento interno do sistema. Também foi adicionada migration para incluir as tabelas `cloud_*` na publicação `supabase_realtime` do Supabase.

## 1.9.703
- **Cloud**: Ativada atualização realtime para arquivos, pastas e compartilhamentos. O módulo agora reflete mudanças automaticamente sem necessidade de recarregar manualmente.

## 1.9.702
- **Assinaturas/Cloud**: Adicionada ação `Criar pasta` no detalhe da assinatura para copiar o documento assinado para o `Cloud`, criando automaticamente a pasta do cliente e a subpasta `NÃO PROTOCOLAR` sem alterar o arquivo original assinado.

## 1.9.701
- **Cloud**: Adicionada opção de arquivar pasta. Pastas arquivadas saem da listagem padrão e ficam com exclusão automática agendada para 30 dias.

## 1.9.700
- **Cloud**: Adicionadas ações de download para arquivos e pastas. Arquivos agora podem ser baixados diretamente e pastas com múltiplos arquivos são baixadas em `.zip` mantendo a estrutura interna.

## 1.9.699
- **Cloud/Petição**: Restaurado o fluxo direto de abertura de arquivos Word do `Cloud` para o editor de petições, sem passar pelo modal intermediário do preview embutido.

## 1.9.698
- **Cloud/Petição**: Corrigida a regressão na abertura de documentos no editor de petições; o comportamento antigo do editor foi restaurado e a importação reforçada via `Import` do Syncfusion ficou restrita ao fluxo do `Cloud`.

## 1.9.697
- **Cloud**: Corrigida a abertura de alguns arquivos Word que apareciam em branco no editor/preview do `Cloud`; o carregamento agora usa a conversão via serviço `Import` do Syncfusion também para `.docx`, tornando a importação mais robusta.

## 1.9.696
- **Cloud/Petição**: Corrigida a sincronização entre o editor de petições e o arquivo original do `Cloud`; ao salvar um documento aberto a partir do `Cloud`, o sistema agora sobrescreve o mesmo arquivo no storage em vez de atualizar apenas o histórico interno do editor.

## 1.9.695
- **Cloud**: Restaurado o menu de botão direito em arquivos no explorador, impedindo o menu nativo do navegador e exibindo novamente ações rápidas como abrir, abrir no módulo de petição, mover e excluir.

## 1.9.694
- **Cloud/Petição**: Reforçado o reaproveitamento automático do cliente vinculado à pasta/arquivo do `Cloud`, evitando que o editor volte a exigir vínculo manual enquanto a lista de clientes termina de carregar.
- **Cloud/Petição**: Adicionado overlay visual de `Carregando documento...` durante a importação do `.doc`, com feedback mais bonito e mais claro ao usuário.

## 1.9.693
- **Cloud/Petição**: Adicionado aviso visível após importar `.doc`, informando que o documento ficou em rascunho e será salvo automaticamente no editor.
- **Cloud/Petição**: Ajustado o fluxo para aplicar automaticamente o cliente vindo da pasta do `Cloud` antes da importação, evitando exigência desnecessária de vinculação manual.

## 1.9.692
- **Cloud/Petição**: Corrigida a abertura de arquivos `.doc` que ficavam presos na tela inicial do editor de petições; agora o editor monta diretamente quando há documento inicial para importar.

## 1.9.691
- **Cloud/Petição**: Corrigido o fluxo de abertura de arquivos `.doc` para enviar a referência assinada do arquivo ao editor de petições, evitando travamento no widget por transporte do documento em `base64`.

## 1.9.690
- **Cloud/Petição**: Arquivos `.doc` legados agora abrem diretamente no editor de petições usando conversão server-side do Syncfusion, sem necessidade de download ou conversão manual.

## 1.9.689
- **Cloud**: Arquivos `.doc` legados agora são baixados diretamente para abertura no Microsoft Word instalado, já que o editor web não suporta esse formato nativamente.

## 1.9.688
- **Cloud/Petição**: Ajustado o importador do `SyncfusionEditor` para preservar o tipo real de arquivos `.doc`, evitando que documentos legados fossem enviados ao editor como se fossem `.docx`.

## 1.9.687
- **Cloud**: Corrigida a abertura de arquivos `.doc` quando o editor de petição já estava aberto, forçando nova importação do documento para evitar que nada acontecesse após o aviso de sucesso.

## 1.9.686
- **Cloud**: Corrigida a integração de arquivos `.doc` com o editor de petição para abrir o documento já importado diretamente no editor, sem cair na tela inicial genérica.

## 1.9.685
- **Cloud**: Corrigida a abertura de arquivos `.doc` para que não caiam mais no preview genérico; agora seguem o fluxo de edição/documento Word no módulo Cloud e no editor de petição.

## 1.9.684
- **Cloud**: Adicionado menu contextual de botão direito para pastas, com ações rápidas como abrir, alterar status, compartilhar, focar o vínculo com cliente, criar subpasta e excluir pasta.

## 1.9.683
- **Cloud**: O painel lateral de detalhes agora permanece oculto no conteúdo quando nenhuma pasta ou arquivo estiver selecionado, evitando ruído visual desnecessário.

## 1.9.682
- **Cloud**: Restaurada uma área visível para adicionar mais etiquetas diretamente no painel da pasta, sem depender apenas do modal de criação.
- **Cloud**: Ajustado o visual do preview e overlays para uma apresentação clara, reduzindo o aspecto escuro indesejado nos modais do módulo.
- **Cloud**: Arquivos `.doc`/`.docx` agora abrem em editor Syncfusion em tela cheia no fluxo do `Cloud`, com ações de minimizar/fechar e atalho para abrir no módulo de petição.

## 1.9.681
- **Cloud**: Adicionadas etiquetas de pasta com estados iniciais `Pendente` e `Concluído`, seleção por pasta e opção de cadastrar novas etiquetas diretamente no modal de criação.
- **Cloud**: Corrigido o upload de arquivos com nomes problemáticos para o storage, sanitizando caracteres inválidos que causavam erro de chave ao subir documentos.
- **Cloud**: Melhorado o modal de nova pasta com visual claro e mais organizado, além de incluir vínculo com cliente e definição de etiqueta inicial.
- **Cloud**: Quando a pasta não possui cliente vinculado, o painel lateral agora permite vincular um cliente diretamente.

## 1.9.680
- **Cloud**: Refinada novamente a interface do módulo `Cloud` para reduzir ruído visual, removendo duplicações de localização e fortalecendo a hierarquia da barra superior e do breadcrumb.
- **Cloud**: Aplicado o tema laranja do sistema no explorador, botões principais e estados de destaque, substituindo o acento azul anterior.
- **Cloud**: Mantida a lateral esquerda, agora com uso mais útil para navegação e recentes, e o painel direito foi enriquecido com metadados e ações mais relevantes para arquivos e pastas.

## 1.9.679
- **Cloud**: Ajustado o módulo `Cloud` para ocupar melhor a largura útil da área principal, reduzindo a sensação de janela estreita no explorador.
- **Cloud**: Convertido o visual principal para uma apresentação clara no modo claro, com fundos claros, bordas suaves e contraste mais leve sem perder a estrutura estilo Explorer.

## 1.9.678
- **Cloud**: Redesenhado o módulo `Cloud` para uma experiência inspirada no Windows Explorer, com painel lateral em árvore, barra superior de ações, breadcrumb, área central em colunas e painel lateral de detalhes para arquivos e pastas.
- **Cloud**: Mantidas no novo layout as funções já criadas de upload por arrastar/soltar, mover arquivo, preview de PDF/imagem/DOCX, vínculo com cliente e compartilhamento público com senha.

## 1.9.677
- **Cloud**: Criada a primeira base do novo módulo `Cloud`, com estrutura de pastas e subpastas, vínculo opcional com clientes, upload de arquivos por arrastar/soltar, movimentação de arquivos entre pastas, preview de PDF/imagem e abertura de `.docx` com `SyncfusionEditor` em modo leitura.
- **Compartilhamento**: Adicionada base de compartilhamento público de pasta com link dedicado e opção de senha, incluindo página pública inicial para acesso aos arquivos compartilhados.
- **Infraestrutura**: Adicionados `cloud.service`, `cloud.types`, `CloudModule`, `PublicCloudSharePage` e migration `20260308_cloud_module.sql` com tabelas, bucket e políticas iniciais para o ecossistema Cloud.

## 1.9.676
- **Notificações**: Corrigidos fluxos inconsistentes no sistema de notificações, incluindo auto-notificação residual em ações originadas por intimações, destinatário incorreto em menções do feed, uso de tipos semânticos mais adequados (`process_created`, `signature_completed`, `poll_invite`) e remoção do uso legado do serviço local de notificações no `App`.
- **Estabilidade**: Ajustados `App.tsx`, `NotificationBell`, `CalendarModule`, `IntimationsModule`, `ProcessesModule`, `feedPolls.service`, `signature.service` e tipos de `user_notification` para restaurar compilação limpa e navegação consistente a partir das notificações.

## 1.9.675
- **Notificações**: Corrigido o envio de auto-notificações ao criar prazos e compromissos. Agora `DeadlinesModule` e `CalendarModule` só notificam quando o responsável atribuído é diferente do usuário que criou o item.

## 1.9.674
- **Clientes**: Corrigido o fluxo de exclusão no `ClientsModule` e no `client.service`, que estava apenas inativando o cadastro. Agora a ação remove o cliente permanentemente e os textos de confirmação foram alinhados ao comportamento real.

## 1.9.673
- **Assinatura Pública**: Corrigida a geração do placeholder `data` na edge function `template-fill`, que ainda montava o documento final da solicitação com `new Date().toLocaleDateString('pt-BR')` sem fixar `America/Manaus`.

## 1.9.672
- **Requerimentos**: Corrigida a geração de `DATA_ATUAL_EXTENSO` e `data` no `RequirementsModule` para usar a data corrente em `America/Manaus`, evitando avanço indevido do dia em documentos MS gerados.

## 1.9.671
- **Documentos**: Corrigida a geração de placeholders de data no `DocumentsModule` para usar a data corrente em `America/Manaus`, evitando avanço indevido de dia em linhas como `[[cidade]] – [[estado]], [[data]]`.
- **Petições Padrão**: Corrigida a substituição de `[[DATA]]` e `[[DATA_ATUAL]]` no `StandardPetitionsModule` para usar a mesma base de data de Manaus do relatório de assinaturas.

## 1.9.670
- **Assinaturas**: Corrigida a formatação de data/hora no `pdfSignature.service` para centralizar o uso de `America/Manaus` no contrato assinado e no histórico de autenticidade.
- **Assinaturas**: O histórico do relatório passou a ordenar eventos pelo timestamp real, evitando inconsistências causadas por ordenação sobre strings formatadas.

## 1.9.669
- **Assinaturas**: O visualizador do `SignatureModule` passou a empilhar todas as folhas do PDF verticalmente quando há múltiplas páginas, em vez de manter exibição de página isolada.
- **Assinaturas**: A navegação entre páginas agora rola até a folha correspondente e o posicionamento de campos respeita a página clicada no documento empilhado.

## 1.9.668
- **Requerimentos**: O `RequirementsModule` passou a reutilizar o formatador compartilhado de data/hora, preservando a formatação especial de data em UTC já existente.

## 1.9.667
- **Intimações**: O `IntimationsModule` passou a reutilizar os formatadores compartilhados de data e data/hora, preservando o fallback local de exibição.

## 1.9.666
- **Processos**: O `ProcessesModule` passou a reutilizar os formatadores compartilhados de data e data/hora, preservando os fallbacks locais de exibição.

## 1.9.665
- **Tarefas**: O `TasksModule` passou a reutilizar os formatadores compartilhados de data e hora, reduzindo duplicação local com baixo risco.

## 1.9.664
- **Cleanup**: Removidos setters redundantes de `useSelectionState` em `ClientsModule` e `SignatureModule`, mantendo apenas os helpers efetivamente usados.

## 1.9.663
- **Cleanup**: Removido setter redundante de seleção de requests no `SignatureModule`, reduzindo ruído interno após a adoção do `useSelectionState`.

## 1.9.662
- **Cleanup**: Removidos wrappers triviais de limpeza de seleção em `ClientsModule` e `SignatureModule`, passando a usar diretamente os helpers do `useSelectionState`.
- **Estabilidade**: Ajustadas referências residuais após o cleanup para manter a compilação limpa.

## 1.9.661
- **Assinaturas**: Ajustada a limpeza da seleção de uploads no `SignatureModule` ao resetar o wizard e ao selecionar arquivo único, evitando estado residual entre fluxos.

## 1.9.660
- **Assinaturas**: A seleção de arquivos enviados no `SignatureModule` passou a reutilizar o `useSelectionState`, reduzindo duplicação de estado no fluxo de envelope/upload.
- **Hook compartilhado**: O `useSelectionState` passou a suportar chaves numéricas, permitindo reuso seguro também para seleções por índice.
- **Estabilidade**: Ajustados pontos residuais no bloco de uploads do `SignatureModule` para manter a compilação limpa após a extração.

## 1.9.659
- **Intimações**: A seleção em massa do `IntimationsModule` passou a reutilizar o `useSelectionState`, reduzindo duplicação de estado e mantendo o mesmo comportamento das ações em lote.
- **Estabilidade**: Ajustado o bloco de helpers do `IntimationsModule` durante a refatoração para preservar compilação limpa.

## 1.9.658
- **Seleção em massa**: Extraídos helpers reutilizáveis no `useSelectionState` para substituir seleção e podar IDs inválidos com segurança.
- **Clientes**: `ClientsModule` passou a reutilizar helper central para selecionar duplicados visíveis e encerrar seleção após ações em lote.
- **Assinaturas**: `SignatureModule` passou a reutilizar helper central para podar seleção quando a lista filtrada muda.

## 1.9.657
- **Documentação**: Padronizada a busca sem acento no `DocsChangesPage` para versão, resumo, codename e alterações internas.
- **Intimações**: Padronizada a busca sem acento nos dropdowns de seleção de responsável do `IntimationsModule`.

## 1.9.656
- **Feed**: Padronizada a busca sem acento nas menções expandidas de comentários do `Feed`.
- **Documentação**: Padronizada a busca sem acento no `DocsPage` para módulos, FAQ e changelog.
- **Chat**: Padronizada a busca sem acento no `ChatFloatingWidget` para nome, e-mail e cargo de membros.

## 1.9.655
- **Prazos**: Padronizada a busca sem acento no `DeadlinesModule` para título e descrição.
- **Financeiro**: Padronizada a busca sem acento no `FinancialModule` para título, descrição, observações, cliente e processo.

## 1.9.654
- **Petições**: Padronizada a busca sem acento no `StandardPetitionsModule` para nome e descrição.
- **Documentos**: Padronizada a busca sem acento no `DocumentsModule` para templates do fluxo de novo documento.
- **Posts**: Padronizada a busca sem acento no `PostModal` para menções de usuários.
- **Intimações**: Padronizada a busca sem acento em campos textuais do `IntimationsModule`, mantendo a busca numérica por processo e dígitos.

## 1.9.653
- **Configurações**: Padronizada a busca sem acento no `SettingsModule` para nome, e-mail, cargo, telefone e OAB.
- **Requerimentos**: Padronizada a busca sem acento no `RequirementsModule` para protocolo e beneficiário.
- **Timeline**: Padronizada a busca sem acento no `ProcessTimeline` para título e descrição.

## 1.9.652
- **Feed**: Padronizada a busca sem acento em audiência, menções e tags inline no `Feed` e no `FeedWidget`.
- **Notificações**: Padronizada a busca sem acento no `NotificationsModuleNew` para título e descrição.

## 1.9.651
- **Notificações**: Padronizada a busca sem acento no `NotificationsModule` para título e descrição.

## 1.9.650
- **Tarefas**: Padronizada a busca sem acento no `TasksModule` para o filtro de tarefas concluídas.

## 1.9.649
- **Perfil**: Padronizada a busca sem acento no `UserProfilePage` para filtros de audiência e menções.

## 1.9.648
- **Usuários**: Padronizada a busca sem acento no `UserManagementModule` para nome, e-mail e cargo.

## 1.9.647
- **Assinaturas**: Extraída e estabilizada a lógica de filtros e busca derivada do `SignatureModule` em util compartilhado, mantendo o mesmo comportamento da tela.

## 1.9.646
- **Clientes**: Extraídas as regras de qualidade de cadastro para util compartilhado, reduzindo acoplamento no módulo sem alterar comportamento.

## 1.9.645
- **Assinaturas**: Aplicado hook compartilhado de seleção em massa no `SignatureModule`, reduzindo duplicação de estado sem alterar comportamento.

## 1.9.644
- **Assinaturas**: Extraído o refresh silencioso para hook compartilhado e aplicado no `SignatureModule`, reduzindo duplicação sem alterar comportamento.

## 1.9.643
- **Clientes**: Extraído o estado de seleção em massa para hook compartilhado, reduzindo complexidade do módulo sem alterar comportamento.

## 1.9.642
- **Clientes**: Extraída a lógica de detecção de duplicidade para util compartilhado, reduzindo acoplamento no módulo sem alterar o comportamento da tela.

## 1.9.641
- **Busca**: Criado util compartilhado para normalização sem acento e comparação padronizada de termos de pesquisa.
- **Busca**: Padronizada a busca sem acento nos módulos e serviços principais, incluindo clientes, colaboradores, assinaturas, processos, prazos, chat e referências do feed.

## 1.9.640
- **Busca**: Corrigida a busca de clientes sem acento no autocomplete e na tela de clientes, evitando que o filtro do banco barrasse resultados como `mario` para `Mário`.

## 1.9.639
- **Busca**: Ajustadas buscas principais por nome para funcionarem sem depender de acentos.
- **Busca**: Clientes, colaboradores, assinaturas e sugestão rápida de clientes em processos agora aceitam buscas como `Joao` e `João`.

## 1.9.638
- **Clientes**: Adicionada detecção de contatos possivelmente duplicados com motivo claro por nome, telefone e CPF.
- **Clientes**: Novo aviso com quantidade de grupos duplicados e ações para selecionar duplicados ou mesclar todos.
- **Clientes**: Implementada mesclagem inteligente de contatos, preenchendo campos vazios do principal com dados dos demais e inativando os registros mesclados.

## 1.9.637
- **Assinaturas**: Atualização automática da lista ajustada para ocorrer em segundo plano, sem reflash visual.
- **Assinaturas**: Separada a carga inicial do refresh silencioso em eventos do Realtime, foco da aba e polling leve.

## 1.9.636
- **Assinaturas**: Reforçada a atualização automática dos cards com `Realtime` + refresh agendado para evitar status preso em `1/2` e `50%`.
- **Assinaturas**: Adicionado polling leve e refresh ao voltar foco/visibilidade da aba na tela de assinaturas.

## 1.9.635
- **Assinaturas**: Removido o QR Code do card principal de assinatura no relatório PDF para deixar o layout mais limpo.
- **Assinaturas**: Área da assinatura ampliada para melhorar a leitura do traço e o destaque visual.

## 1.9.634
- **Assinaturas**: Corrigido Realtime para documentos criados, agora monitorando também a tabela `generated_documents`.
- **Assinaturas**: Novos documentos gerados passam a aparecer automaticamente na lista sem precisar atualizar a página.

## 1.9.633
- **Assinaturas**: QR Code do relatório de assinaturas redesenhado com visual inspirado no relatório selfie.
- **Assinaturas**: QR Code aumentado e mantido abaixo da assinatura para melhor leitura e validação.
- **Assinaturas**: Card do QR ganhou destaque visual maior com título e legenda de validação.

## 1.9.632
- **Assinaturas**: Implementado Supabase Realtime para atualização automática da lista de documentos.
- **Assinaturas**: Lista atualiza em tempo real quando documentos são criados, assinados ou concluídos.
- **Assinaturas**: Não é mais necessário atualizar a página (F5) para ver mudanças.

## 1.9.631
- **Assinaturas**: Redesign completo do relatório PDF com visual premium e moderno.
- **Assinaturas**: Cards de assinatura com sombra sutil, barra superior verde e badge de status.
- **Assinaturas**: Histórico redesenhado com cards individuais por evento e badges coloridos por tipo de ação.
- **Assinaturas**: Corrigida sobreposição de timestamp e texto no histórico (layout em blocos separados).

## 1.9.630
- **Assinaturas**: Corrigida sobreposição de linhas no histórico do relatório PDF (espaçamento aumentado).
- **Assinaturas**: QR Code agora é exibido no rodapé/footer de todas as páginas do documento.
- **Assinaturas**: QR Code reposicionado abaixo da assinatura no card do signatário (não sobrepõe mais).

## 1.9.629
- **Assinaturas**: Relatório PDF reorganizado para ficar mais bonito e organizado.
- **Assinaturas**: QR Code reposicionado abaixo da assinatura no card do signatário.
- **Assinaturas**: Corrigidas sobreposições de data/hora e do histórico no relatório de assinaturas.

## 1.9.628
- **Assinaturas**: Campo de assinatura refinado novamente para ficar mais largo, mais horizontal e com leitura mais limpa no designer.
- **Assinaturas**: Reduzida a altura visual do card e simplificado o conteúdo interno para evitar aparência apertada/confusa.

## 1.9.627
- **Assinaturas**: Card do campo de assinatura redesenhado com visual mais bonito, premium e mais largo no designer.
- **Assinaturas**: Melhorado o layout horizontal do campo com badge lateral, tipografia mais elegante e destaque visual superior.

## 1.9.626
- **Assinaturas**: Corrigido reset global do módulo ao adicionar ou arrastar campos no wizard de posicionamento.
- **Assinaturas**: `loadData` foi estabilizado para não ser recriado por mudanças do contexto de toast durante a edição.
- **Assinaturas**: O loading global do módulo não interrompe mais o wizard quando você está posicionando campos.

## 1.9.625
- **Assinaturas**: SOLUÇÃO DEFINITIVA para eliminar recarregamentos/flickers ao adicionar ou arrastar campos de assinatura.
- **Assinaturas**: PDF agora renderiza em escala fixa (1.0) e zoom é aplicado via CSS transform, evitando reload do documento.
- **Assinaturas**: Auto-fit aplicado apenas UMA VEZ no carregamento inicial, eliminando loops de re-render.
- **Assinaturas**: Removido ResizeObserver que causava instabilidade durante interação com campos.

## 1.9.624
- **Assinaturas**: Implementado "Design Galático" nos campos de assinatura, com efeitos de brilho (shimmer), profundidade 3D e animações interativas.
- **Assinaturas**: Eliminado recarregamento indesejado da página ao clicar para posicionar campos (reforço de preventDefault e stopPropagation).
- **Assinaturas**: Estabilizado ResizeObserver do visualizador de documentos para evitar oscilações visuais no designer.

## 1.9.623
- **Assinaturas**: Corrigido o bloco do QR Code principal da primeira página do relatório para exibição íntegra e legível.
- **Assinaturas**: Corrigida a composição do PDF consolidado para preservar assinaturas anteriores ao entrar uma nova assinatura.

## 1.9.622
- **Assinaturas**: Restaurado e aprimorado o QR Code de verificação na primeira página do relatório de assinatura, com bloco visual destacado para autenticação rápida.

## 1.9.621
- **Assinaturas**: Corrigido o relatório de autenticidade/PDF para incluir todos os signatários já assinados, com seus dados, assinaturas e selfies.
- **Assinaturas**: Corrigida a seleção do PDF assinado exibido/baixado para usar o signatário assinado mais recente, evitando abrir o arquivo antigo do primeiro assinante.

## 1.9.620
- **Assinaturas**: Corrigido o vínculo dos campos de assinatura com o signatário criado, priorizando `order`/índice estável para evitar que a assinatura de um signatário apareça no campo de outro.

## 1.9.619
- **Assinaturas**: Corrigida a geração do `public_token` dos signatários para usar UUID válido, compatível com a coluna `uuid` do banco.

## 1.9.618
- **Assinaturas**: Corrigido loop infinito de renderização adicionando ref `documentLoadedRef` para evitar chamadas repetidas de `loadDocumentPreview` e simplificando dependências do useEffect.

## 1.9.617
- **Assinaturas**: Corrigido loop infinito de renderização causado por função `loadDocumentPreview` recriada a cada render. Convertida para `useCallback` e removida das dependências do useEffect.

## 1.9.616
- **Assinaturas**: Corrigido loop infinito de renderização no designer de assinatura causado por useLayoutEffect sem dependências.

## 1.9.615
- **Assinaturas**: Corrigida a duplicação de campo ao arrastar e soltar no designer de assinatura, bloqueando o clique residual após o drag.
- **Assinaturas**: Ajustado o clique no canvas para não reposicionar/criar campo enquanto um arraste estiver em andamento.

## 1.9.614
- **Assinaturas**: Corrigido o wizard de posicionamento para evitar recarregamentos/submits acidentais ao clicar em campos e controles.
- **Assinaturas**: Ajustado o posicionamento dos campos para centralizar no ponto clicado e manter a assinatura no local marcado.
- **Assinaturas**: Garantida a geração de link público individual por signatário, melhorando o fluxo de multiassinatura.

## 1.9.589
- **Prazos**: Em meses anteriores, a listagem/tabela de prazos em aberto é ocultada e são exibidos apenas os prazos concluídos do período como histórico. Para o mês atual e futuros, todos os prazos relevantes continuam sendo exibidos.


## 1.9.588
- **Financeiro**: Corrigida a contabilização de valores recebidos no módulo financeiro. Agora, os valores pagos são contabilizados no mês em que a baixa foi efetivamente realizada (data de pagamento), e não mais no mês do vencimento original.


## 1.9.586
- **Chat**: Ajustado tamanho do card de Ã¡udio para nÃ£o ficar compacto. Definida largura mÃ­nima responsiva (260px mobile / 320px desktop) mantendo visual limpo com player mais confortÃ¡vel.

## 1.9.585
- **Chat**: No card de Ã¡udio, removida a exibiÃ§Ã£o do nome e tamanho do arquivo (ex.: `audio_*.webm` e `KB`). Agora o card mostra apenas Ã­cone + player de Ã¡udio, mantendo visual limpo.

## 1.9.584
- **Chat**: Removido texto "Ã�udio" do preview de mensagens. Agora exibe apenas o emoji ðŸŽ¤ para mensagens de Ã¡udio, mantendo visual limpo e minimalista.

## 1.9.583
- **Chat**: Adicionado fundo exato do WhatsApp na Ã¡rea de conversa. Pattern SVG com cores #ece5dd e #e9dfd9, tamanho 536x113px, repetiÃ§Ã£o centralizada para visual idÃªntico ao app original.

## 1.9.582
- **Chat**: Adicionado fundo exato do WhatsApp na Ã¡rea de conversa. Pattern SVG com cores #ece5dd e #e9dfd9, tamanho 536x113px, repetiÃ§Ã£o centralizada para visual idÃªntico ao app original.

## 1.9.581
- **Chat**: Redesign completo para estilo WhatsApp. Cores verde/teal (#25d366), mensagens enviadas com fundo verde claro (#dcf8c6), recebidas com fundo branco, layout limpo e pattern de fundo sutil na Ã¡rea de mensagens.

## 1.9.580
- **Tarefas**: Adicionada animaÃ§Ã£o no botÃ£o "Adicionar" com loading spinner e prevenÃ§Ã£o de mÃºltiplos cliques. BotÃ£o muda para verde durante o processo com texto "Adicionando...".

## 1.9.579
- **Tarefas**: Removido do menu lateral (nav). MÃ³dulo continua acessÃ­vel apenas atravÃ©s do botÃ£o no header principal com contador de tarefas pendentes.

## 1.9.578
- **Tarefas**: Removido completamente o header do mÃ³dulo. Agora exibe apenas o formulÃ¡rio de adicionar tarefas e a lista, sem tÃ­tulo ou descriÃ§Ã£o no mÃ³dulo (mantido apenas no navbar).

## 1.9.577
- **Tarefas**: Removido tÃ­tulo duplicado "Tarefas" do mÃ³dulo (mantido apenas no navbar). Mantida apenas descriÃ§Ã£o "Gerencie suas tarefas e lembretes".

## 1.9.576
- **Chat**: Redesign visual completo para estilo limpo e consistente com o sistema. Removidos efeitos glass pesados, padronizados fundos/bordas em slate, lista de conversas refinada e composer reorganizado com melhor hierarquia visual.

## 1.9.575
- **Chat**: Removido tÃ­tulo duplicado "Chat da Equipe" do mÃ³dulo (mantido apenas no navbar). Cores ajustadas para seguir padrÃ£o indigo do sistema em vez de gradientes purple.

## 1.9.574
- **Chat**: Aplicado tema glassmorphism premium com painÃ©is translÃºcidos, efeito backdrop-filter, gradientes indigo/purple, bordas suaves e sombras modernas.

## 1.9.571
- **Prazos**: Corrigido filtro mensal para prazos concluÃ­dos. Agora sÃ£o contabilizados no mÃªs em que foram finalizados, nÃ£o no mÃªs de vencimento original.

## 1.9.570
- **Prazos**: Filtros AvanÃ§ados movidos para a mesma linha da toolbar com botÃ£o dropdown. Texto oculto em telas menores (apenas Ã­cone).

## 1.9.569
- **Prazos**: Filtros AvanÃ§ados integrados diretamente na toolbar principal com expansÃ£o/recolhimento, seguindo design moderno.

## 1.9.568
- **Prazos**: Toolbar compactada em uma Ãºnica linha seguindo design moderno. Seletor de mÃªs movido para ao lado dos botÃµes de visualizaÃ§Ã£o (Lista/Kanban/CalendÃ¡rio) dentro do mÃ³dulo.

## 1.9.567
- **Prazos**: Removidos tÃ­tulos duplicados do mÃ³dulo (mantidos apenas no navbar). Seletor de mÃªs movido para o cabeÃ§alho ao lado do calendÃ¡rio, visÃ­vel apenas no mÃ³dulo Prazos.

## 1.9.566
- **Requerimentos**: Header da barra de controle refinado com visual mais limpo, melhor hierarquia, espaÃ§amento consistente e botÃµes/chips mais harmonizados.

## 1.9.565
- **Requerimentos / MS**: Corrigido erro 400 ao gerar MS. Removida verificaÃ§Ã£o desnecessÃ¡ria de bucket via client (bucket jÃ¡ existe e estÃ¡ configurado no Supabase).

## 1.9.564
- **Requerimentos / MS**: Criado modal simples de seleÃ§Ã£o de template ao clicar em "Gerar MS". Agora basta clicar no modelo desejado para gerar automaticamente, sem precisar abrir o modal completo de gerenciamento.

## 1.9.563
- **Requerimentos / MS**: Ao enviar template MS, o sistema agora preserva o nome original do arquivo (sem a extensÃ£o .docx) em vez de adicionar data automaticamente.

## 1.9.562
- **Requerimentos**: Corrigido erro de import do Ã­cone Download do lucide-react.

## 1.9.561
- **Requerimentos / MS**: Adicionado botÃ£o **Baixar** no modal de templates MS para download do modelo hospedado.
- **Requerimentos / MS**: Ao clicar em "Gerar MS", agora abre o modal para **selecionar o modelo** antes de gerar. BotÃ£o **Gerar MS** disponÃ­vel no modal quando hÃ¡ requerimento selecionado.

## 1.9.560
- **Requerimentos**: Corrigido botÃ£o "Gerenciar MS" que estava tentando navegar para mÃ³dulo inexistente. Agora abre diretamente o modal de gerenciamento de templates MS.

## 1.9.559
- **Requerimentos**: Barra de filtros e aÃ§Ãµes alinhada e refinada, com chips mais compactos, espaÃ§amento consistente e melhor equilÃ­brio visual entre status e botÃµes de aÃ§Ã£o.

## 1.9.558
- **Requerimentos / MS**: No modal "Template MS", a lista agora exibe apenas modelos do contexto **MS (Requerimentos)**. Adicionada aÃ§Ã£o **Remover** para excluir o modelo MS selecionado.

## 1.9.557
- **Requerimentos**: Barra superior reorganizada e compactada sem scroll lateral, com chips de status menores em quebra de linha, melhor espaÃ§amento visual e botÃ£o **Gerenciar MS** fixo na Ã¡rea de aÃ§Ãµes.

## 1.9.556
- **Requerimentos**: BotÃµes de filtro reduzidos (text-[10px], px-1.5 py-0.5) para eliminar scroll lateral. Labels encurtados removendo "Aguardando". Adicionado botÃ£o "Gerenciar MS" para navegaÃ§Ã£o ao mÃ³dulo de gerenciamento.

## 1.9.555
- **Requerimentos**: Removido header duplicado do mÃ³dulo (mantido apenas tÃ­tulo no nav). Interface mais limpa sem repetiÃ§Ã£o de "Sistema de Requerimentos" e "Gerencie requerimentos administrativos do INSS".

## 1.9.554
- **Requerimentos**: Removido header duplicado do mÃ³dulo (mantido apenas tÃ­tulo no nav). Interface mais limpa sem repetiÃ§Ã£o de "Sistema de Requerimentos" e "Gerencie requerimentos administrativos do INSS".

## 1.9.553
- **Assinaturas**: Modo cards atualizado para visual estilo pasta, com aba superior, Ã­cone de pasta e cartÃµes com identidade visual mais documental.

## 1.9.552
- **Assinaturas**: Modo cards completamente redesenhado com layout moderno. Grid responsiva (xl:grid-cols-4), header com Ã­cone e percentual, conteÃºdo organizado, footer com status e progresso visual melhorado.

## 1.9.551
- **Assinaturas**: Cards da lista simplificados para melhor UX. Removida complexidade desnecessÃ¡ria, layout mais limpo com cards compactos e informaÃ§Ãµes essenciais apenas.

## 1.9.550
- **Assinaturas**: Cards da lista completamente redesenhados com layout moderno. Melhor hierarquia visual, organizaÃ§Ã£o de informaÃ§Ãµes, badges compactos, progress bar integrada e botÃ£o "Ver detalhes" explÃ­cito.

## 1.9.549
- **Assinaturas**: Removida barra header vazia onde estava o botÃ£o Novo documento. Interface mais limpa com apenas a toolbar principal contendo filtros e aÃ§Ãµes.

## 1.9.548
- **Assinaturas**: BotÃ£o "Novo documento" reposicionado ao lado do botÃ£o "PÃºblico" no mÃ³dulo. Removido do navigation para evitar duplicaÃ§Ã£o.

## 1.9.547
- **Assinaturas**: Corrigido erro "Rendered more hooks than during the previous render" movendo useEffect para o topo do componente. Hooks devem sempre ser chamados na mesma ordem.

## 1.9.546
- **Assinaturas**: BotÃ£o "Novo documento" integrado ao navigation ao lado do perfil. Aparece apenas quando mÃ³dulo Assinaturas estÃ¡ ativo, com acesso direto ao wizard de upload via DOM.

## 1.9.545
- **Assinaturas**: Removido header duplicado do mÃ³dulo (mantido apenas tÃ­tulo no nav). Interface mais limpa sem repetiÃ§Ã£o de "Assinatura Digital" e "Envie documentos e acompanhe o progresso das assinaturas".

## 1.9.544
- **Documentos**: Removido header duplicado do mÃ³dulo (mantido apenas tÃ­tulo no nav). Interface mais limpa sem repetiÃ§Ã£o de "Modelos de documentos" e "Gerencie templates e documentos".

## 1.9.543
- **Processos**: Adicionado botÃ£o X no header do modal de exportaÃ§Ã£o para fechar, seguindo padrÃ£o da Agenda. Header agora com layout flex e botÃ£o de fechar no canto superior direito.

## 1.9.542
- **Processos**: Ajustado layout do modal de exportaÃ§Ã£o para espelhar a estrutura da Agenda. BotÃµes "Cancelar" e "Exportar Excel" movidos para dentro do mesmo container interno do conteÃºdo, eliminando diferenÃ§a visual de espaÃ§amento/alinhamento.

## 1.9.541
- **Processos**: BotÃ£o "Exportar Excel" corrigido para usar disabled:opacity-50 em vez de bg-gray-400, mantendo o gradiente verde esmeralda visÃ­vel mesmo quando desabilitado, exatamente igual ao da Agenda.

## 1.9.540
- **Processos**: Corrigidos botÃµes do modal de exportaÃ§Ã£o para ficar idÃªnticos aos da Agenda. Removidas classes duplicadas e ajustado estado disabled para consistÃªncia visual.

## 1.9.539
- **Processos**: Modal de exportaÃ§Ã£o redesenhado seguindo padrÃ£o visual da Agenda. Labels com emojis, uppercase tracking, border-2, cores consistentes, botÃµes com gradiente verde esmeralda e hover effects com transform.

## 1.9.538
- **Processos**: ExportaÃ§Ã£o profissional com modal de filtros avanÃ§ados. BotÃ£o "Exportar" agora abre modal com opÃ§Ãµes: filtro por status, tipo de processo, advogado responsÃ¡vel, perÃ­odo (data inicial/final), ordenaÃ§Ã£o (mais recente/mais antigo). PrÃ©via em tempo real de quantos processos serÃ£o exportados. NÃ£o baixa automaticamente - usuÃ¡rio configura filtros antes.

## 1.9.537
- **Processos**: ExportaÃ§Ã£o Excel completamente melhorada. Adicionadas colunas: "Tipo de Processo", "Status do Processo", numeraÃ§Ã£o, DJEN Sincronizado, DJEN Tem Dados, Ãšltima Sync DJEN. Processos ordenados por data de atualizaÃ§Ã£o (mais recente primeiro). Nome do arquivo inclui filtro de status aplicado e timestamp completo. Exporta apenas processos filtrados.

## 1.9.536
- **Processos**: Badge "CRON ATIVO (03h)" movido para ao lado do botÃ£o "Mapa de Fases" no mÃ³dulo. Corrigida detecÃ§Ã£o de status de processos - Recurso agora tem prioridade sobre InstruÃ§Ã£o, incluindo termos como "sessÃ£o de julgamento", "turma recursal", "tribunal" e "recurso inominado".

## 1.9.535
- **Processos**: Restaurada seÃ§Ã£o expandida "Aguardando ConfecÃ§Ã£o" com formulÃ¡rio inline e lista de clientes. Removido botÃ£o "AGUARDANDO CONFECÃ‡ÃƒO" do nav principal.

## 1.9.534
- **Processos**: Removido tÃ­tulo duplicado do mÃ³dulo (mantido apenas no nav). Badge "CRON ATIVO (03h)" e botÃ£o "AGUARDANDO CONFECÃ‡ÃƒO" movidos para o nav principal, visÃ­veis apenas quando mÃ³dulo Processos estÃ¡ ativo.

## 1.9.533
- **Processos**: MÃ³dulo reorganizado com design mais limpo e moderno. Removido monitor de cron detalhado (substituÃ­do por badge compacto), removida seÃ§Ã£o expandida "Aguardando ConfecÃ§Ã£o", cards de estatÃ­sticas redesenhados com layout mais compacto e visual.

## 1.9.532
- **Processos**: Removida sincronizaÃ§Ã£o DJEN via navegador. Agora a sincronizaÃ§Ã£o Ã© realizada **exclusivamente via Edge Function** (cron do Supabase). Removidos: hook `useDjenSync`, funÃ§Ã£o `handleSyncAllDjen`, estados `syncingDjen` e `syncResult`, e UI de resultado de sincronizaÃ§Ã£o.

## 1.9.531
- **Processos**: Corrigido erro "Token invÃ¡lido" no cron **Update Process Status (03h)**. ValidaÃ§Ã£o de token desabilitada na Edge Function `update-process-status` para permitir execuÃ§Ã£o via cron do Supabase (mesmo padrÃ£o do `run-djen-sync`).

## 1.9.530
- **IntimaÃ§Ãµes**: Card de monitoramento **Run DJEN Sync (07h e 19h)** movido para o mÃ³dulo de IntimaÃ§Ãµes, com status, horÃ¡rio da Ãºltima execuÃ§Ã£o, encontradas e salvas.
- **Processos**: Removida a exibiÃ§Ã£o do bloco de intimaÃ§Ãµes do monitor de cron, mantendo apenas o card **Update Process Status (03h)**.

## 1.9.529
- **Processos**: Painel de monitoramento de cron dividido em dois blocos separados: **Update Process Status (03h)** e **Run DJEN Sync (07h e 19h)**, com status, Ãºltima execuÃ§Ã£o, contadores e erros por rotina.
- **Processos**: Edge Function `update-process-status` agora registra execuÃ§Ã£o em `djen_sync_history` (`source: process_status_cron`, `trigger_type: update_process_status`) para exibiÃ§Ã£o fiel no mÃ³dulo.

## 1.9.528
- **Processos**: Painel de status DJEN redesenhado com contadores em tempo real (processos, sincronizados, pendentes, encontradas, salvas). Exibe horÃ¡rio da cron com tempo relativo. Mostra erro da Ãºltima execuÃ§Ã£o se houver. Removidos botÃµes manuais "Sync DJEN" e "Testar Sync" (sincronizaÃ§Ã£o agora Ã© 100% automÃ¡tica via cron: 03h status, 07h/19h intimaÃ§Ãµes). Redeploy da Edge Function `run-djen-sync` corrigindo validaÃ§Ã£o de token.

## 1.9.527
- **Processos**: Adicionado timer de Ãºltima atualizaÃ§Ã£o do registro no modal de detalhes do processo. Exibe Ã­cone de relÃ³gio com tempo relativo (ex: "Atualizado hÃ¡ 2h") abaixo da informaÃ§Ã£o de sincronizaÃ§Ã£o DJEN.

## 1.9.526
- **Processos**: Adicionado tempo da Ãºltima sincronizaÃ§Ã£o DJEN. Exibe "hÃ¡ X horas", "ontem", "hÃ¡ X dias" ou data completa nos cards (lista, Kanban e detalhes). Permite identificar rapidamente quando cada processo foi sincronizado pela Ãºltima vez com o DiÃ¡rio de JustiÃ§a.

## 1.9.525
- **Processos**: Corrigida sincronizaÃ§Ã£o automÃ¡tica com DJEN. O hook `useDjenSync` existia mas nÃ£o estava sendo usado no ProcessesModule. Agora a sincronizaÃ§Ã£o automÃ¡tica estÃ¡ ativa: executa 5 segundos apÃ³s carregar o mÃ³dulo e depois a cada 1 hora, mantendo os dados dos processos atualizados automaticamente.

## 1.9.524
- **PetiÃ§Ãµes**: Melhorada animaÃ§Ã£o de loading ao formatar com IA. Design mais elegante com overlay menos transparente, card sÃ³lido, Ã­cone com gradiente laranja e anÃ©is de onda animados. Feedback visual mais claro e profissional durante o processamento.

## 1.9.523
- **PetiÃ§Ãµes**: Nova funcionalidade "Formatar com IA" no menu de contexto do editor. Funciona com QUALQUER tipo de texto selecionado: qualificaÃ§Ãµes, endereÃ§os, textos jurÃ­dicos, listas, etc. A IA detecta automaticamente o tipo de texto e aplica a formataÃ§Ã£o apropriada. Inclui correÃ§Ã£o ortogrÃ¡fica completa, remoÃ§Ã£o de espaÃ§os extras, correÃ§Ã£o de pontuaÃ§Ã£o, padronizaÃ§Ã£o de CPF/CEP, formataÃ§Ã£o de datas e uso de linguagem jurÃ­dica formal. Para qualificaÃ§Ãµes, preserva negrito no nome. Usa modelos econÃ´micos (Groq Llama 3.3 como principal, OpenAI GPT-4o-mini como fallback). Corrigido delay ao vincular cliente para garantir que o auto-save funcione corretamente.

## 1.9.522
- **PetiÃ§Ãµes**: Corrigido bug onde ao inserir bloco e depois vincular cliente, o botÃ£o Salvar nÃ£o funcionava. Causa: estado `saving` era compartilhado entre salvar documento e operaÃ§Ãµes de modal (criar tipo padrÃ£o, salvar bloco), bloqueando o botÃ£o. SoluÃ§Ã£o: separado em `savingDoc` (exclusivo do documento) e `saving` (modais/blocos). TambÃ©m corrigida closure desatualizada do `selectedClient` no auto-save apÃ³s vincular cliente.

## 1.9.521
- **Sistema**: AtualizaÃ§Ã£o de versÃµes de componentes e incremento da versÃ£o do sistema com registro no changelog.

## 1.9.520
- **Leads**: Corrigido modal de detalhes para seguir design padrÃ£o do sistema (faixa laranja, fundo branco e estilos consistentes).

## 1.9.519
- **Requerimentos**: Corrigido tempo em anÃ¡lise zerado ao editar requerimento (mantido cÃ¡lculo baseado na data de entrada original).

## 1.9.518
- **Requerimentos**: Adicionado badge "MS" nos requerimentos que possuem processo de Mandado de SeguranÃ§a vinculado.

## 1.9.517
- **Requerimentos**: Corrigida a data de entrada no documento MS gerado para evitar deslocamento por fuso horÃ¡rio.

## 1.9.516
- **Requerimentos**: Corrigida a data de entrada no modal de ediÃ§Ã£o/visualizaÃ§Ã£o e na geraÃ§Ã£o do MS para evitar deslocamento por fuso horÃ¡rio.

## 1.9.478
- **Chat**: Impedida a criaÃ§Ã£o de mÃºltiplas conversas (DM) com a mesma pessoa. Ao iniciar chat, o sistema reutiliza a conversa existente.

## 1.9.477
- **Chat (Mobile)**: Melhorada a usabilidade no celular com ajustes no composer (input e botÃµes) e correÃ§Ã£o de altura usando `100dvh` para evitar problemas de viewport.

## 1.9.476
- **Chat (Mobile)**: Implementada responsividade completa para dispositivos mÃ³veis. Adicionada navegaÃ§Ã£o entre lista de conversas e chat ativo, botÃ£o de voltar e ajustes de layout para telas pequenas.

## 1.9.475
- **Feed (Layout)**: Corrigido o comportamento "sticky" das sidebars laterais para seguir o padrÃ£o do Facebook. Agora as sidebars rolam junto com o feed atÃ© o final do seu conteÃºdo e permanecem fixas, evitando espaÃ§os vazios indesejados.

## 1.9.474
- **Feed (Layout)**: Ajustado comportamento das sidebars laterais para seguir o padrÃ£o do Facebook - rolam atÃ© o fim do conteÃºdo e permanecem fixas, sem criar espaÃ§os vazios.

## 1.9.473
- **Feed (Layout)**: Corrigido layout das sidebars com `items-start` no grid container - sidebars ficam alinhadas ao topo e param quando o conteÃºdo acaba.

## 1.9.472
- **Feed (Layout)**: Corrigido layout das sidebars com `items-start` no grid container - sidebars ficam alinhadas ao topo e param quando o conteÃºdo acaba.

## 1.9.471
- **Feed (Layout)**: Removido sticky das sidebars - agora usam `self-start` para ficarem alinhadas ao topo e pararem quando o conteÃºdo acabar. Feed central Ã© o Ãºnico eixo de rolagem.

## 1.9.470
- **Feed (Layout)**: Widgets laterais agora ficam fixos no topo com altura mÃ¡xima (100vh - 2rem) e scroll interno prÃ³prio - evita Ã¡reas vazias e mantÃ©m foco no feed central.

## 1.9.469
- **Feed (Layout)**: Implementado comportamento correto de rolagem dos widgets laterais - rolam atÃ© o fim do conteÃºdo e depois ficam fixos, evitando Ã¡reas vazias e poluiÃ§Ã£o visual.

## 1.9.468
- **Feed (Header)**: Adicionado cargo/funÃ§Ã£o do usuÃ¡rio e badge na mesma linha do nome - layout mais informativo estilo Instagram/Facebook.

## 1.9.467
- **Feed (Badges)**: Badge de administrador agora mais destacado com gradiente vibrante (amber â†’ orange â†’ red), sombra forte e ring ao redor para diferenciar dos outros badges.

## 1.9.466
- **Feed (Posts)**: Redesign completo dos posts estilo Instagram/Facebook - header limpo com avatar, nome e tempo; contadores de likes/comentÃ¡rios separados; botÃµes de aÃ§Ã£o centralizados e maiores.

## 1.9.465
- **Feed (Artigo)**: Redesenhado card de artigo com visual minimalista e elegante - removido gradiente, design limpo estilo Medium/LinkedIn.

## 1.9.464
- **Feed (Artigo)**: Layout do post de artigo institucional redesenhado com visual mais profissional - header com gradiente laranja, Ã­cone destacado, corpo com melhor espaÃ§amento e footer com informaÃ§Ãµes.

## 1.9.463
- **Feed (UI)**: Removido botÃ£o "Ver todos" da barra de aÃ§Ãµes - contador de comentÃ¡rios agora aparece no botÃ£o "Comentar".
- **PostModal (ComentÃ¡rios)**: Adicionado suporte a menÃ§Ãµes (@) nos comentÃ¡rios do single post com dropdown de seleÃ§Ã£o de usuÃ¡rios.

## 1.9.462
- **Feed (ComentÃ¡rios)**: Corrigido dropdown de menÃ§Ãµes (@) nos comentÃ¡rios inline - agora funciona igual ao composer de posts.

## 1.9.461
- **Feed (Single Post)**: Corrigido hover das menÃ§Ãµes (@Nome) no PostModal (agora ficam azuis/sublinhadas ao passar o mouse).

## 1.9.460
- **Feed (Single Post)**: MenÃ§Ãµes (@Nome) no PostModal voltaram a ter comportamento de link (hover) e navegam para o perfil.

## 1.9.459
- **Feed (Single Post)**: Cards de preview no PostModal agora exibem as informaÃ§Ãµes completas (layout igual ao Feed).

## 1.9.458
- **Feed (Single Post)**: Ajustada cor das menÃ§Ãµes no PostModal para nÃ£o deixar o conteÃºdo azul.

## 1.9.457
- **Feed (Single Post)**: PostModal agora exibe tags (#), cards de preview e enquetes corretamente ao abrir um post individual.

## 1.9.456
- **NotificaÃ§Ãµes (Feed)**: Clique em notificaÃ§Ã£o de menÃ§Ã£o/curtida/comentÃ¡rio agora abre o post especÃ­fico (single post) no Feed.

## 1.9.455
- **Dashboard (PermissÃµes)**: Widgets/contadores/atalhos agora respeitam permissÃµes do cargo (ex.: Auxiliar nÃ£o vÃª Financeiro/IntimaÃ§Ãµes/Requerimentos se nÃ£o tiver acesso).

## 1.9.454
- **Feed (UI/UX)**: Composer reorganizado: dropdown de visibilidade (PÃºblico/Equipe/Privado) movido para a linha principal de aÃ§Ãµes e botÃ£o "Publicar" alinhado Ã  direita.

## 1.9.453
- **Feed (Fix)**: Corrigido erro ao postar foto com `file_type` undefined (adicionado optional chaining).

## 1.9.452
- **Feed (UI/UX)**: Corrigido z-index do emoji picker e dropdown de visibilidade para aparecerem acima do menu de navegaÃ§Ã£o.

## 1.9.451
- **Feed (UI/UX)**: BotÃ£o "Publicar" movido para a linha dos Ã­cones de aÃ§Ãµes, otimizando espaÃ§o e deixando o layout mais compacto.

## 1.9.450
- **Feed (UI/UX)**: BotÃ£o "Agendar" movido para a linha dos Ã­cones de aÃ§Ãµes, economizando espaÃ§o e deixando a barra mais compacta.

## 1.9.449
- **Feed (UI/UX)**: BotÃµes de visibilidade (PÃºblico/Equipe/Privado) unificados em Ãºnico botÃ£o com dropdown para seleÃ§Ã£o.

## 1.9.448
- **Feed (UI/UX)**: Barra do composer simplificada (aÃ§Ãµes/visibilidade/agendar) para um visual mais minimalista: botÃµes compactos (Ã­cone), cores neutras e menos ruÃ­do visual.

## 1.9.447
- **Feed (Performance)**: Carregamento verdadeiramente em segundo plano: `loadDashboardData` e `loadFeedPosts` agora usam `requestIdleCallback`/`setTimeout` para renderizar layout primeiro; enquetes e preferÃªncias tambÃ©m carregam em background.

## 1.9.446
- **Feed (UI)**: Removida mensagem/banner de "atualizando em segundo plano".

## 1.9.445
- **Feed (Performance)**: Carregamento nÃ£o bloqueante (sem tela inteira de loading), banner discreto de atualizaÃ§Ã£o em background e carregamento de perfis sob demanda (menÃ§Ãµes/audiÃªncia) para reduzir tempo inicial.

## 1.9.444
- **Feed (UI/UX)**: Avatar/foto do usuÃ¡rio agora usa renderizaÃ§Ã£o via `<img>` (mesmo padrÃ£o do Nav) para carregamento mais rÃ¡pido e consistente.

## 1.9.443
- **IntimaÃ§Ãµes (UI/UX)**: Pacote de melhorias: indicadores visuais de vinculaÃ§Ã£o (Vinc/Sem VÃ­nc), filtros por urgÃªncia e estado de vÃ­nculo, busca por nÂº de processo normalizado (ignora `.`/`-), aÃ§Ãµes em lote (vincular em lote, exportar selecionadas, marcar todas como lidas).

## 1.9.442
- **IntimaÃ§Ãµes (DJEN)**: VinculaÃ§Ã£o automÃ¡tica de intimaÃ§Ãµes sem vÃ­nculo (match por nÃºmero do processo ignorando `.`/`-` e por nomes das partes, incluindo fallback pelo texto da intimaÃ§Ã£o).

## 1.9.441
- **IntimaÃ§Ãµes (UI)**: OtimizaÃ§Ã£o da Ã¡rea de visualizaÃ§Ã£o: header/filtros mais compactos para maximizar espaÃ§o (~95% de view para conteÃºdo).

## 1.9.440
- **IntimaÃ§Ãµes (UI)**: Na visualizaÃ§Ã£o agrupada por processo, o texto da intimaÃ§Ã£o agora ocupa largura total no desktop (aÃ§Ãµes movidas para abaixo do texto).

## 1.9.439
- **IntimaÃ§Ãµes (UI)**: Refinos de design para um visual mais corporativo (seleÃ§Ã£o em azul, cards agrupados com destaque discreto e chips/labels mais neutros).

## 1.9.438
- **IntimaÃ§Ãµes (UI)**: BotÃµes de aÃ§Ã£o ajustados para ficarem lado a lado e cards/Ã¡reas de anÃ¡lise com visual mais neutro e profissional (menos cores fortes).

## 1.9.437
- **IntimaÃ§Ãµes (UI)**: Corrigido erro de runtime ao abrir o mÃ³dulo apÃ³s adicionar botÃµes no topo (import do Ã­cone `Settings`).
- **Dashboard**: Removidos logs de debug no console (cache/eventos) para reduzir ruÃ­do durante o desenvolvimento.

## 1.9.436
- **IntimaÃ§Ãµes (UI)**: Barra superior do desktop melhorada com botÃµes rÃ¡pidos (NÃ£o lidas/Lidas/Todas e perÃ­odo 30/60/90), e painel "Mais filtros" para aÃ§Ãµes avanÃ§adas.

## 1.9.435
- **IntimaÃ§Ãµes (UI)**: Filtros/controles do topo agora ficam colapsados por padrÃ£o tambÃ©m no desktop, liberando mais espaÃ§o para visualizar as intimaÃ§Ãµes.

## 1.9.434
- **Dashboard / Agenda**: Corrigido o filtro/ordenaÃ§Ã£o e marcaÃ§Ã£o de "Hoje" para compromissos com `start_at` em formato de data (ex.: `YYYY-MM-DD`) que eram interpretados em UTC e podiam sumir no fuso local.

## 1.9.433
- **Feed**: CorreÃ§Ã£o de estrutura JSX e ajustes de build/TypeScript apÃ³s remoÃ§Ã£o das aÃ§Ãµes/comentÃ¡rios, eliminando erro 500 no carregamento do mÃ³dulo.
- **Feed / NavegaÃ§Ã£o**: Ajustado import do FeedPage para usar o casing correto (`./Feed`) e correÃ§Ãµes auxiliares de build.

## 1.9.432
- **Feed (Evento)**: PublicaÃ§Ã£o de eventos agora cria um compromisso real na Agenda e gera post com preview clicÃ¡vel.
- **Feed (Artigo)**: Novo modo de post institucional com formulÃ¡rio dedicado e renderizaÃ§Ã£o formatada (tÃ­tulo/categoria/conteÃºdo).

## 1.9.426
- **Feed / Enquetes**: Widget "Ãšltima Enquete" agora busca a enquete mais recente diretamente da tabela `feed_polls` (nÃ£o depende de flags no post).
- **Feed / Enquetes**: Debug do widget ajustado para nÃ£o imprimir payloads grandes (ex.: avatar base64).
- **Feed**: CorreÃ§Ã£o de violaÃ§Ã£o das Rules of Hooks ao remover `useMemo` de dentro de `renderWidget` ("ConexÃµes em Destaque").

## 1.9.431
- **Feed (UI)**: Removidos botÃµes "Compartilhar" e "Salvar" dos posts. Agora sÃ³ mantÃ©m "Curtir" e "Comentar".

## 1.9.430
- **Feed (Enquetes)**: Corrigido renderizaÃ§Ã£o de enquetes nos posts individuais (modal PostModal). Agora enquetes aparecem corretamente ao abrir um post.

## 1.9.429
- **Feed (Layout)**: Widget "ConexÃµes em Destaque" movido para a sidebar esquerda para equilibrar layout.
- **Feed (Atividade)**: Widget "Atividade da Equipe" agora mostra os Ãºltimos 4 posts (em vez de 5).

## 1.9.428
- **Feed (MÃ©tricas)**: Widget "MÃ©tricas do Feed" agora mostra apenas posts, curtidas e comentÃ¡rios do usuÃ¡rio logado (rÃ³tulo "Minhas").

## 1.9.427
- **Feed (Layout)**: Ajuste de largura para ficar consistente com os demais mÃ³dulos (remoÃ§Ã£o de `max-w` internos que limitavam o conteÃºdo).

## 1.9.407
- **Feed Redesign**: ImplementaÃ§Ã£o completa do feed estilo LinkedIn/Facebook
  - **Layout 3 colunas**: Sidebar esquerda, feed central, sidebar direita com widgets arrastÃ¡veis
  - **Novos Widgets**: SugestÃµes de Pessoas, TendÃªncias por Tags, PrÃ³ximos Eventos
  - **Social Interactions**: Reactions (Curtir/Amei/Haha), Compartilhar, Salvar posts
  - **Skeleton Loaders**: AnimaÃ§Ãµes suaves de carregamento para posts
  - **Composer Aprimorado**: Placeholder dinÃ¢mico, preview de anexos com hover effects
  - **Visual Moderno**: Cards refinados, animaÃ§Ãµes suaves, shadows gradient
  - **Drag-and-Drop**: Widgets reorganizÃ¡veis entre sidebars
  - **Tags Filter**: Filtrar feed por tags atravÃ©s do widget de tendÃªncias

## 1.9.406
- **Feed**: ImplementaÃ§Ã£o inicial layout 3 colunas e widgets bÃ¡sicos

## 1.9.405
- **Feed**: Removidos os widgets do Dashboard do mÃ³dulo Feed (Feed fica apenas social).

## 1.9.404
- **Requerimentos (Mobile)**: Ã�rea superior (aÃ§Ãµes/abas/filtros) agora Ã© retrÃ¡til, mantendo "Novo Requerimento" sempre visÃ­vel.

## 1.9.403
- **Assinaturas (Mobile)**: Toolbar responsiva sem overflow.
  - Tabs com scroll horizontal
  - Busca em largura total
  - AÃ§Ãµes com quebra de linha

## 1.9.402
- **Dashboard (Mobile)**: Header reorganizado para remover a â€œbarra pretaâ€� e melhorar a legibilidade.
  - Nome + botÃ£o "Novo Cliente" na mesma linha sem esticar largura
  - Avisos/alertas abaixo como chips com texto + contador (inclui Financeiro atrasado)

## 1.9.401
- **Dashboard / Tarefas**: Ajustes de responsividade.
  - Header: alertas urgentes ao lado do "Novo Cliente" com texto + contador
  - EstatÃ­sticas: preservado layout do desktop; grid 2x2 apenas no mobile
  - **TasksModule**: formulÃ¡rio/filtros/lista responsivos no mobile

## 1.9.400
- **Dashboard**: Layout responsivo mobile-first refatorado.
  - Header compacto: saudaÃ§Ã£o + botÃ£o "Novo Cliente" (apenas Ã­cone no mobile)
  - EstatÃ­sticas em grid 2x2 no mobile (flex-wrap no desktop)
  - Widgets com padding/gaps reduzidos no mobile
  - Itens de agenda/tarefas/prazos mais compactos
  - Modais com backdrop escuro e botÃµes full-width no mobile
  - Corrigido bug do botÃ£o "Novo Cliente" mostrando "+ +"

## 1.9.399
- **Dashboard**: Corrigido backdrop dos modais para usar bg-transparent e forÃ§ar fundo branco com !bg-white no modo claro (removido backdrop escuro).

## 1.9.398
- **Dashboard**: Corrigido backdrop dos modais para usar bg-black/50 no modo claro (estava muito escuro com bg-slate-900/70).

## 1.9.397
- **Dashboard**: Modais de detalhes (Compromisso/IntimaÃ§Ã£o) adequados ao padrÃ£o do tema (overlay + blur, container com ring/shadow, fita laranja e header/footer padronizados).

## 1.9.396
- **Dashboard**: Emoji de mÃ£o acenando (ðŸ‘‹) agora com animaÃ§Ã£o de movimento de um lado para o outro (como acenando).
  - AnimaÃ§Ã£o CSS personalizada com rotaÃ§Ã£o suave (0Â° â†’ 20Â° â†’ -10Â° â†’ 0Â°)
  - Origem da transformaÃ§Ã£o ajustada para ponto de rotaÃ§Ã£o no pulso
  - DuraÃ§Ã£o de 1 segundo com repetiÃ§Ã£o infinita

## 1.9.395
- **Dashboard**: Emoji de mÃ£o acenando (ðŸ‘‹) agora com animaÃ§Ã£o de movimento.

## 1.9.394
- **Dashboard**: SaudaÃ§Ã£o com emoji de mÃ£o acenando (ðŸ‘‹) ao lado do nome do usuÃ¡rio.

## 1.9.393
- **Dashboard**: Ã�cone de mÃ£o acenando adicionado ao lado do nome do usuÃ¡rio no header.

## 1.9.392
- **Dashboard**: Widget "IntimaÃ§Ãµes" melhorado - agora mostra tipo (badge), nÃºmero do processo, vara/Ã³rgÃ£o, e partes (Autor/RÃ©u).

## 1.9.391
- **Dashboard**: Widgets "IntimaÃ§Ãµes", "Aguardando" e "Requerimentos" redesenhados - grid de 3 colunas, layout consistente com outros widgets.

## 1.9.390
- **Dashboard**: "IntimaÃ§Ãµes" ajustado para mostrar 5 intimaÃ§Ãµes em vez de 3.

## 1.9.389
- **Dashboard**: BotÃ£o "Criar Compromisso" adicionado ao estado vazio da Agenda.

## 1.9.388
- **Dashboard**: "Agenda" agora mostra 4 compromissos em vez de 2.

## 1.9.387
- **Dashboard**: "Agenda" ajustada para ficar com altura mais prÃ³xima dos demais widgets (layout mais compacto).

## 1.9.386
- **Dashboard**: Widget "Agenda" compactado para altura igual aos outros widgets.

## 1.9.385
- **Dashboard**: Widget "Tarefas" movido para abaixo da "Agenda".

## 1.9.384
- **Dashboard**: Widget "Prazos" movido para abaixo do Financeiro na coluna direita.

## 1.9.383
- **Dashboard**: BotÃµes de alerta no header (Prazos/IntimaÃ§Ãµes) redesenhados para estilo mais clean (chip com badge) e altura consistente.

## 1.9.382
- **Dashboard**: Widgets "Prazos" e "IntimaÃ§Ãµes" redesenhados - layout mais limpo, espaÃ§amento melhorado e tipografia aprimorada.

## 1.9.381
- **Dashboard**: BotÃ£o "Processo" reposicionado para ficar ao lado de "Requerimento" - melhor agrupamento lÃ³gico.

## 1.9.380
- **Dashboard**: BotÃ£o "Pagamento" adicionado de volta - agora abre modal de novo acordo no mÃ³dulo Financeiro.

## 1.9.379
- **Dashboard**: "AÃ§Ãµes RÃ¡pidas" limpo - removidos botÃµes "Acordo", "Pagamento" e "Alerta" que nÃ£o tinham mÃ³dulos correspondentes.

## 1.9.378
- **Dashboard**: "AÃ§Ãµes RÃ¡pidas" ajustado - tÃ­tulo movido para cima dos botÃµes, liberando mais espaÃ§o para os 9 botÃµes em 2 linhas.

## 1.9.377
- **Dashboard**: "AÃ§Ãµes RÃ¡pidas" reformulado para layout em 2 linhas com flex-wrap - botÃµes menores e mais organizados.

## 1.9.376
- **Dashboard**: "AÃ§Ãµes RÃ¡pidas" simplificado (UI mais clean) - removidas animaÃ§Ãµes/CSS injetado e botÃµes em estilo pill com scroll horizontal.

## 1.9.375
- **Dashboard**: "AÃ§Ãµes RÃ¡pidas" otimizado com animaÃ§Ãµes suaves, efeitos hover avanÃ§ados, bordas dinÃ¢micas e scrollbar customizado invisÃ­vel.

## 1.9.374
- **Dashboard**: "AÃ§Ãµes RÃ¡pidas" expandido com 9 opÃ§Ãµes: Cliente, Processo, Prazo, Tarefa, Compromisso, Requerimento, Acordo, Pagamento e Alerta.

## 1.9.373
- **Dashboard**: BotÃµes de "AÃ§Ãµes RÃ¡pidas" movidos para o lado do tÃ­tulo - layout mais compacto e eficiente.

## 1.9.372
- **Dashboard**: Componente "AÃ§Ãµes RÃ¡pidas" otimizado para layout de linha Ãºnica com scroll horizontal.

## 1.9.371
- **Dashboard**: Widget "IntimaÃ§Ãµes" otimizado para layout mais compacto - padding reduzido, Ã­cones menores e espaÃ§amento apertado.

## 1.9.370
- **Dashboard**: Widget "AÃ§Ãµes RÃ¡pidas" movido para cima do Financeiro e otimizado para layout de linha Ãºnica.

## 1.9.369
- **Dashboard**: BotÃµes de alerta redesenhados - agora maiores com gradientes, Ã­cones em containers, sombras e tipografia aprimorada.

## 1.9.368
- **Dashboard**: BotÃµes de alerta movidos para o header ao lado do botÃ£o "Novo Cliente" - layout mais compacto e acessÃ­vel.

## 1.9.367
- **Dashboard**: Header aprimorado com UI/UX moderna - estatÃ­sticas clicÃ¡veis com Ã­cones, efeitos hover, gradientes e layout centralizado responsivo.

## 1.9.366
- **Dashboard**: Otimizado layout do header - estatÃ­sticas compactas agora ficam na mesma linha da saudaÃ§Ã£o, removendo cards grandes duplicados.

## 1.9.365
- **Dashboard**: Corrigida extraÃ§Ã£o do primeiro nome do usuÃ¡rio - agora mostra apenas "Pedro" em vez do nome completo.

## 1.9.364
- **Dashboard**: Header agora mostra apenas o primeiro nome do usuÃ¡rio com Ã­cone ao lado (ex: "ðŸ‘¤ Pedro").

## 1.9.363
- **Dashboard**: Header personalizado - agora mostra saudaÃ§Ã£o ("Boa noite") no subtÃ­tulo e nome do usuÃ¡rio no tÃ­tulo principal.

## 1.9.362
- **Dashboard**: Removido widget "Processos em Andamento" (redundante).
- **Dashboard**: Widget IntimaÃ§Ãµes agora mostra resumo do processo (nÃºmero + partes: polo ativo Ã— polo passivo).
- **Dashboard**: Widget Prazos agora exibe badge de prioridade (alta/mÃ©dia/normal) ou dias restantes se urgente.

## 1.9.361
- **Dashboard**: Coluna direita do bloco "Agenda + Financeiro" agora empilha **Financeiro** + **AÃ§Ãµes rÃ¡pidas** para equilibrar a altura com a Agenda.

## 1.9.360
- **Dashboard**: Redesign dos cards de IntimaÃ§Ãµes, Processos Aguardando, Requerimentos e Em Andamento com estilo consistente.
- **Dashboard**: Card Financeiro redesenhado - mais compacto, sem espaÃ§o vazio, altura automÃ¡tica (`h-fit`).

## 1.9.359
- **Dashboard**: Redesign completo com estÃ©tica moderna e hierarquia visual melhorada.
  - Header minimalista com saudaÃ§Ã£o e botÃ£o de aÃ§Ã£o
  - Cards de estatÃ­sticas com design limpo e interativo (hover effects)
  - Alertas urgentes em formato de badges discretos
  - SeÃ§Ãµes de Agenda, Prazos e Tarefas com layout consistente
  - Melhor espaÃ§amento e tipografia

## 1.9.358
- **Dashboard**: Corrigido erro `QuotaExceededError` quando localStorage estÃ¡ cheio - agora limpa caches antigos automaticamente.

## 1.9.357
- **Dashboard**: Restaurado dashboard antigo como tela inicial (visÃ£o geral do escritÃ³rio com mÃ©tricas e estatÃ­sticas).
- **Feed**: Movido para mÃ³dulo separado, acessÃ­vel via menu de navegaÃ§Ã£o.

## 1.9.356
- **Editor de PetiÃ§Ãµes**: Removido SpellChecker do Syncfusion (requer backend dedicado). Use o corretor ortogrÃ¡fico nativo do navegador (Chrome/Edge/Firefox jÃ¡ possuem correÃ§Ã£o pt-BR integrada).

## 1.9.355
- **Editor de PetiÃ§Ãµes**: Corrigido erro "Inject SpellCheck module" - mÃ³dulo SpellChecker agora Ã© injetado corretamente no DocumentEditorContainerComponent.

## 1.9.354
- **Editor de PetiÃ§Ãµes**: Ativado corretor ortogrÃ¡fico com sugestÃµes (pt-BR) no Syncfusion, com toggle "RevisÃ£o" para ligar/desligar.

## 1.9.353
- **Feed**: UI/UX dos cards de preview melhorado (visual clean, sem gradientes fortes, melhor hierarquia e legibilidade), mantendo o comportamento de abrir o modal de detalhes.

## 1.9.352
- **Feed**: Cards de preview agora abrem o modal de detalhes do registro (via `entityId`/`mode: details`) em vez de levar para a lista geral do mÃ³dulo. Agenda e Financeiro agora suportam deep-link por ID.

## 1.9.351
- **Feed**: Redesign completo com visual limpo e profissional. Avatar fallback usa cor neutra (slate). Cards de preview com bordas sutis e fundo branco/slate (sem gradientes saturados). Tags com cores mais discretas.

## 1.9.350
- **Feed**: Avatar agora usa a mesma origem do Nav/Perfil (prioriza `profiles.avatar_url` com fallback via `user_metadata`), evitando foto vazia.

## 1.9.349
- **IntimaÃ§Ãµes (Mobile)**: SeÃ§Ã£o expandida melhorada (AnÃ¡lise IA + aÃ§Ãµes) com layout mais limpo, remoÃ§Ã£o de botÃµes duplicados e aÃ§Ãµes organizadas em grid.

## 1.9.348
- **IntimaÃ§Ãµes (Mobile)**: Painel de filtros e aÃ§Ãµes agora Ã© expansÃ­vel/retrÃ¡til no mobile (busca fica sempre visÃ­vel; selects e botÃµes ficam recolhÃ­veis para economizar espaÃ§o).

## 1.9.347
- **IntimaÃ§Ãµes (Mobile)**: Na lista agrupada por processo, os botÃµes de aÃ§Ã£o agora quebram para baixo no mobile quando a intimaÃ§Ã£o estÃ¡ expandida, evitando que o texto fique espremido e quebre palavra por palavra.

## 1.9.346
- **IntimaÃ§Ãµes (Mobile)**: Ajustado layout responsivo do mÃ³dulo de IntimaÃ§Ãµes DJEN para evitar overflow em telas pequenas. Busca agora ocupa linha prÃ³pria; filtros e botÃµes em grid responsivo (2 colunas no mobile, flex no desktop). Dropdowns (Limpar/Exportar/ConfiguraÃ§Ãµes) agora abrem em largura total no mobile para nÃ£o cortar conteÃºdo. Estado vazio compactado com Ã­cones e textos menores. BotÃµes com textos abreviados no mobile (Filtros/Limpar/Exportar/ConfiguraÃ§Ãµes).

## 1.9.340
- **Perfil (Mobile)**: Ajustado layout do perfil para telas pequenas (banner, avatar, botÃµes e abas com scroll horizontal), evitando sobreposiÃ§Ã£o com o widget flutuante.

## 1.9.343
- **Perfil (Mobile)**: Sidebar "Contato Profissional" agora fica oculto no mobile quando as abas estÃ£o fechadas; aparece apenas ao expandir ou em perfis de outros usuÃ¡rios.

## 1.9.344
- **Perfil (Mobile)**: "Contato Profissional" foi movido para dentro do painel expandÃ­vel (mesmo botÃ£o de ver Feed/Atividade/Sobre), e a sidebar fica apenas no desktop.

## 1.9.345
- **Perfil (Mobile)**: Barra de aÃ§Ãµes dos posts (Curtir/Comentar/contagens) ajustada para ficar em uma Ãºnica linha no mobile.

## 1.9.342
- **Perfil (Mobile)**: Abas Feed/Atividade/Sobre agora ficam ocultas por padrÃ£o no mobile; aparecem apenas ao clicar em "Ver Feed, Atividade e Sobre".

## 1.9.341
- **Chat (Mobile)**: BotÃ£o flutuante de Mensagens agora fica compacto no mobile (apenas Ã­cone + badge), evitando cobrir conteÃºdo das pÃ¡ginas.

## 1.9.325
- **Feed (Agenda JurÃ­dica)**: Widget agora exibe a data (dd/mm) nos compromissos.

## 1.9.326
- **Feed (Agenda JurÃ­dica)**: Compromissos de hoje agora aparecem com destaque de cor no badge.

## 1.9.338
- **Feed (MenÃ§Ãµes)**: Corrigido bug onde texto apÃ³s o nome mencionado ficava azul; agora apenas o nome exato do perfil Ã© destacado e notificaÃ§Ãµes sÃ£o enviadas corretamente.

## 1.9.337
- **Feed (Composer)**: Corrigido bug de inserÃ§Ã£o de menÃ§Ãµes e tags que descartava texto digitado apÃ³s a query.

## 1.9.336
- **Feed (Mobile)**: Barra de indicadores e filtros de tags escondidos no mobile; corrigido nome do autor bugado/cortado nos posts.

## 1.9.335
- **Feed (UI)**: Removidos ajustes especÃ­ficos de mobile na barra de indicadores e nos filtros (voltando layout/tamanhos padrÃ£o).

## 1.9.334
- **Feed (Mobile)**: BotÃµes de visibilidade (PÃºblico/Equipe/Privado) e agendamento (relÃ³gio) reposicionados para a barra de aÃ§Ãµes ao lado do botÃ£o "+".

## 1.9.333
- **Feed (Mobile)**: Barra de aÃ§Ãµes do composer organizada e expansÃ­vel no mobile; filtro "Todas AtualizaÃ§Ãµes" removido.

## 1.9.332
- **Feed (Mobile)**: Visibilidade (PÃºblico/Equipe/Privado) unificada em um Ãºnico botÃ£o no mobile e botÃ£o Agendar exibindo apenas o Ã­cone.

## 1.9.331
- **Feed (Responsivo)**: Indicadores mais compactos no mobile (faixa horizontal) e controles de visibilidade/agendar em uma linha.

## 1.9.330
- **Feed (Responsivo)**: Barra de indicadores ajustada para encaixar no mobile (grid) e `scrollbar-hide` reforÃ§ado para evitar scrollbar visÃ­vel.

## 1.9.329
- **Feed (Responsivo)**: Filtros do feed compactados no mobile (tamanho de botÃµes/Ã­cones e espaÃ§amentos).

## 1.9.328
- **Feed (Responsivo)**: Barra de indicadores e controles do composer ajustados para melhor encaixe no mobile (scroll e layout sem overflow).

## 1.9.327
- **Feed (Responsivo)**: Ajustes de layout para melhorar visualizaÃ§Ã£o em mobile/tablet (espaÃ§amentos, alinhamento e prevenÃ§Ã£o de overflow).

## 1.9.324
- **Feed Social (Admin)**: Administradores agora podem remover permanentemente posts banidos.
- **Feed Social (ModeraÃ§Ã£o)**: OpÃ§Ã£o "Remover Post" aparece apenas para posts banidos e apenas para administradores.
- **Feed Social (SeguranÃ§a)**: ConfirmaÃ§Ã£o explÃ­cita antes de remover post banido permanentemente.

## 1.9.323
- **Feed Social (Banimento)**: Posts banidos nÃ£o podem mais ser editados ou excluÃ­dos pelo autor.
- **Feed Social (SeguranÃ§a)**: RestriÃ§Ã£o de aÃ§Ãµes em posts banidos para preservar o registro de moderaÃ§Ã£o.

## 1.9.322
- **Feed Social (Banimento)**: Posts banidos agora ocultam completamente todo o conteÃºdo (texto, enquetes, imagens e previews de dados).
- **Feed Social (Modal)**: Modal de detalhes do post tambÃ©m exibe mensagem de conteÃºdo removido para posts banidos.
- **Feed Social (UI)**: Design melhorado da mensagem de post banido com Ã­cone e informaÃ§Ãµes do administrador.

## 1.9.321
- **Feed Social (CorreÃ§Ã£o)**: Corrigida polÃ­tica RLS que impedia administradores de banir posts de outros usuÃ¡rios.
- **Feed Social (UI/UX)**: Melhorias visuais no design do feed e criador de posts.

## 1.9.320
- **Feed Social (UI/UX)**: Design premium dos filtros com gradientes e sombras.
- **Feed Social (UI/UX)**: Cards de posts com sombras suaves e transiÃ§Ãµes elegantes.
- **Feed Social (UI/UX)**: Header do post redesenhado com avatar maior e layout mais organizado.
- **Feed Social (UI/UX)**: BotÃµes de curtir/comentar com estados visuais melhorados.
- **Feed Social (UI/UX)**: SeÃ§Ã£o de comentÃ¡rios com design mais moderno e espaÃ§amento adequado.
- **Feed Social (UI/UX)**: Ã�cones de reaÃ§Ã£o com gradientes coloridos.

## 1.9.319
- **Feed Social (Post Modal)**: Carregamento instantÃ¢neo - usa dados do feed jÃ¡ carregado em vez de nova requisiÃ§Ã£o.
- **Feed Social (Post Modal)**: ComentÃ¡rios carregam em paralelo sem bloquear exibiÃ§Ã£o do post.

## 1.9.318
- **Feed Social (Banimento)**: Administradores podem banir posts de outros usuÃ¡rios.
- **Feed Social (Banimento)**: Posts banidos ficam com blur e exibem "Post Banido por [nome do admin]".
- **Feed Social (Banimento)**: Admin pode desbanir posts previamente banidos.
- **Feed Social (Banimento)**: Menu de aÃ§Ãµes do post agora aparece para admin em todos os posts.

## 1.9.317
- **Feed Social (Post Modal)**: Corrigido fundo preto durante carregamento do modal - agora sempre branco.

## 1.9.316
- **Feed Social (Post Modal)**: Corrigidas cores do modal para sempre exibir fundo branco e textos escuros.
- **Feed Social (Post Modal)**: Clique no tempo da publicaÃ§Ã£o (ex: "9m", "2h") agora abre o modal do post.
- **Feed Social (Post Modal)**: Cores dos comentÃ¡rios e input corrigidas para tema claro.

## 1.9.315
- **Feed Social (NotificaÃ§Ãµes)**: Evita notificaÃ§Ã£o duplicada quando usuÃ¡rio Ã© mencionado em comentÃ¡rio do prÃ³prio post.
- **Feed Social (NotificaÃ§Ãµes)**: Se o autor do post Ã© mencionado, recebe apenas "comentou sua publicaÃ§Ã£o" (nÃ£o mais "mencionou vocÃª" tambÃ©m).

## 1.9.314
- **Feed Social (Post Modal)**: Novo modal de visualizaÃ§Ã£o de post individual estilo Facebook.
- **Feed Social (Post Modal)**: Ao clicar em notificaÃ§Ã£o de menÃ§Ã£o/curtida/comentÃ¡rio, abre o post em modal dedicado.
- **Feed Social (Post Modal)**: BotÃ£o "Voltar ao Feed" para retornar Ã  visualizaÃ§Ã£o completa.
- **Feed Social (Post Modal)**: Exibe autor, conteÃºdo, imagens, curtidas, comentÃ¡rios e permite interagir.
- **Feed Social (Post Modal)**: MenÃ§Ãµes clicÃ¡veis que levam ao perfil do usuÃ¡rio.

## 1.9.313
- **Feed Social (MenÃ§Ãµes)**: Corrigido clique em nome mencionado para navegar ao perfil do usuÃ¡rio.
- **Feed Social (MenÃ§Ãµes)**: Melhorada busca flexÃ­vel de perfis (comparaÃ§Ã£o parcial de nomes).
- **Feed Social (MenÃ§Ãµes)**: Adicionados logs de debug para diagnÃ³stico de notificaÃ§Ãµes.

## 1.9.312
- **Feed Social (MenÃ§Ãµes)**: Nomes mencionados com @ agora ficam azuis e clicÃ¡veis (levam ao perfil do usuÃ¡rio).
- **Feed Social (MenÃ§Ãµes)**: UsuÃ¡rios mencionados em comentÃ¡rios agora recebem notificaÃ§Ã£o corretamente.
- **Feed Social (MenÃ§Ãµes)**: Corrigida renderizaÃ§Ã£o de menÃ§Ãµes em todos os componentes (Dashboard, UserProfilePage, FeedWidget).

## 1.9.311
- **Feed Social (ComentÃ¡rios)**: Dropdown de menÃ§Ãµes (@) agora aparece corretamente ao digitar @.
- **Feed Social (ComentÃ¡rios)**: UsuÃ¡rios mencionados com @ agora recebem notificaÃ§Ã£o.

## 1.9.310
- **Feed Social (ComentÃ¡rios)**: Dropdown de menÃ§Ãµes (@) agora aparece abaixo do input, nÃ£o mais escondido/cortado.

## 1.9.309
- **Feed Social (ComentÃ¡rios)**: Clique em "X comentÃ¡rios" agora expande/mostra os comentÃ¡rios abaixo do post.

## 1.9.308
- **Feed Social (Enquetes)**: Exibe quem votou (modal), tempo de expiraÃ§Ã£o corrigido (sem "Agora") e auto-encerramento quando todos os participantes votarem.
- **Feed Social (ComentÃ¡rios)**: Dropdown de menÃ§Ãµes (@) nÃ£o fica mais escondido/cortado.

## 1.9.307
- **Feed Social**: ApÃ³s publicar uma enquete, o criador agora fecha automaticamente, limpa os campos e exibe confirmaÃ§Ã£o. BotÃ£o Publicar sÃ³ habilita com enquete vÃ¡lida.

## 1.9.306
- **Feed Social**: Avatar do usuÃ¡rio no composer/comentÃ¡rios agora prioriza foto real do perfil e faz fallback para a foto do login (evita Ã­cone genÃ©rico).

## 1.9.305
- **Feed Social**: Adicionada funcionalidade de menÃ§Ãµes (@) nos comentÃ¡rios dos posts.

## 1.9.304
- **Dashboard**: Ajustado visual do card "Aguardando ConfecÃ§Ã£o" para manter consistÃªncia com os demais widgets.

## 1.9.303
- **Dashboard**: Card "Aguardando ConfecÃ§Ã£o" redesenhado com visual premium: header com gradiente, cards internos com sombras e hover effects, Ã­cones com gradiente.

## 1.9.302
- **Feed Social**: Modal de editar post agora inclui opÃ§Ãµes de visibilidade (PÃºblico/Equipe/Privado) e seleÃ§Ã£o de destinatÃ¡rios.

## 1.9.301
- **Feed Social**: Posts privados nÃ£o notificam mais mencionados que nÃ£o estÃ£o nos destinatÃ¡rios.
- **Feed Social**: Corrigida RLS para que posts privados/equipe sÃ³ apareÃ§am para destinatÃ¡rios selecionados (nÃ£o mais para mencionados).

## 1.9.300
- **Feed Social**: Corrigido bug onde menÃ§Ã£o (@) e tag (#) eram inseridas no final do texto em vez da posiÃ§Ã£o do cursor.
- **Financeiro**: Acordos encerrados agora mostram corretamente "ENCERRADO" em vez de "A SALDAR" ou "PARCIAL".

## 1.9.299
- **Feed Social**: Visibilidade "Privado" e "Equipe" agora exigem seleÃ§Ã£o de destinatÃ¡rios (pessoas especÃ­ficas e/ou departamentos via Cargo). Controle por `allowed_user_ids` e `allowed_roles`.

## 1.9.298
- **Feed Social**: UI do composer no Perfil atualizada com visibilidade em tabs e agendamento.

## 1.9.297
- **Feed Social**: UI/UX do composer reorganizada em 2 linhas. Visibilidade em formato de tabs (PÃºblico/Equipe/Privado). ReferÃªncias de entidades (clientes, processos, etc.) renderizadas com cores e clicÃ¡veis.

## 1.9.296
- **Feed Social**: Optimistic updates para likes (feedback instantÃ¢neo). Melhor fluidez na interaÃ§Ã£o.

## 1.9.295
- **Feed Social**: ComentÃ¡rios expandidos automaticamente quando post Ã© aberto via menÃ§Ã£o (@).

## 1.9.294
- **Feed Social**: Adicionada visibilidade de posts (pÃºblico/privado/equipe) e agendamento de publicaÃ§Ãµes.

## 1.9.293
- **Performance**: Corrigido loop/recarregamento que podia manter "Carregando publicaÃ§Ãµes..." indefinidamente no Feed.

## 1.9.292
- **Performance**: Corrigido loading de publicaÃ§Ãµes - nÃ£o mostra 'Carregando...' se jÃ¡ tem posts do cache.

## 1.9.291
- **Performance**: PublicaÃ§Ãµes do Feed carregadas do cache instantaneamente. AtualizaÃ§Ã£o em background sem bloquear UI. Enquetes carregadas em paralelo.

## 1.9.290
- **Performance**: Carregamento instantÃ¢neo do Feed e mÃ³dulos. Cache carregado sincronamente no inÃ­cio, sem loading visÃ­vel. AtualizaÃ§Ã£o de dados em background.

## 1.9.289
- **PermissÃµes**: Eventos do calendÃ¡rio e widget de agenda agora filtrados por permissÃ£o do mÃ³dulo de origem (ex: pagamentos sÃ³ aparecem se tiver acesso ao financeiro, audiÃªncias sÃ³ se tiver acesso a processos).

## 1.9.288
- **Performance**: Corrigida lentidÃ£o crÃ­tica (30s+) no carregamento de pÃ¡ginas. FunÃ§Ãµes de permissÃ£o agora memoizadas com useCallback/useMemo e guard de permissÃµes com proteÃ§Ã£o contra loops.

## 1.9.287
- **PermissÃµes**: Menu/Feed agora respeitam `can_view` (permite ver) e a navegaÃ§Ã£o Ã© bloqueada quando o usuÃ¡rio nÃ£o possui permissÃ£o de visualizaÃ§Ã£o do mÃ³dulo.
- **Header**: Busca de colaboradores no campo de busca. Digite @nome para buscar membros da equipe. Clique para navegar ao perfil do colaborador.

## 1.9.286
- **Feed**: Widgets da coluna direita (incluindo "Prazos") agora aparecem tambÃ©m em telas menores (fora do breakpoint XL), garantindo visibilidade para Administrador.

## 1.9.285
- **Feed**: Widget "Prazos" agora mostra os 5 prÃ³ximos prazos por ordem de vencimento (nÃ£o apenas urgentes).

## 1.9.284
- **Dashboard**: Adicionado widget "Prazos Urgentes" na sidebar direita (abaixo do SaÃºde Financeira). Exibe prazos com vencimento em atÃ© 3 dias, com indicaÃ§Ã£o de atrasado/dias restantes.
- **Dashboard**: Barra de indicadores substituÃ­da por mÃ©tricas reais: Clientes, Processos, Requerimentos, Prazos, Tarefas (sem percentuais fictÃ­cios).
- **App**: Renomeado "Dashboard" para "Feed" no menu lateral e no tÃ­tulo do header.

## 1.9.283
- **UserProfilePage**: ComentÃ¡rios agora aparecem inline abaixo do post (igual ao Dashboard), sem abrir modal. Inclui aÃ§Ã£o "Responder" que preenche o input com @nome e atualiza contador apÃ³s comentar.

## 1.9.282
- **NotificationBell**: Corrigido clique em notificaÃ§Ãµes de feed (curtida/comentÃ¡rio/menÃ§Ã£o) para navegar atÃ© o post com scroll automÃ¡tico.
- **Dashboard**: Imagens agora exibidas estilo Instagram - ocupam toda a largura do post, sem thumbnails pequenos. Grid para mÃºltiplas imagens com overlay "+N" para mais de 4.
- **Dashboard**: Adicionado botÃ£o "Responder" em comentÃ¡rios que preenche o input com @nome do autor.
- **Dashboard**: Avatar e nome do comentÃ¡rio agora sÃ£o clicÃ¡veis para navegar ao perfil.

## 1.9.281
- **Dashboard**: Corrigido import de `UserPlus` que causava erro de referÃªncia.
- **Migration**: Criada migration `20250110_add_feed_notification_types.sql` para adicionar tipos `feed_like` e `feed_comment` ao enum `user_notification_type` no banco de dados.

## 1.9.280
- **Dashboard**: NotificaÃ§Ãµes automÃ¡ticas para o autor do post quando alguÃ©m curtir ou comentar. Tipos `feed_like` e `feed_comment` adicionados.
- **NotificationPanel**: Categorias `feed_like` (Ã­cone coraÃ§Ã£o vermelho) e `feed_comment` (Ã­cone balÃ£o azul) para exibiÃ§Ã£o das notificaÃ§Ãµes de feed.

## 1.9.279
- **Dashboard**: Barra de estatÃ­sticas compacta horizontal (ATIVOS, HORAS, LEADS, URGENTE, RECEBIDO) substituindo os cards grandes. Ocupa menos altura e mostra mais informaÃ§Ãµes.

## 1.9.278
- **Dashboard**: ComentÃ¡rios agora aparecem inline abaixo do post (estilo Facebook/Instagram) em vez de modal. Input para comentar com placeholder "Comente como [nome]...".
- **Dashboard**: Galeria de imagens reduzida para estilo Instagram (menor, fundo escuro, sem header/footer grandes).
- **Dashboard**: Agenda JurÃ­dica agora traduz tipos de evento (paymentâ†’Pagamento, hearingâ†’AudiÃªncia, deadlineâ†’Prazo, meetingâ†’ReuniÃ£o, taskâ†’Tarefa).
- **Dashboard**: Avatar com novo tamanho 'xs' para comentÃ¡rios compactos.

## 1.9.277
- **Dashboard & UserProfilePage**: Sistema completo de comentÃ¡rios implementado. Modal de comentÃ¡rios agora exibe os comentÃ¡rios com conteÃºdo, nome do autor, data/hora e avatar. Input para criar novos comentÃ¡rios com Enter para enviar. Contadores de comentÃ¡rios atualizados em tempo real apÃ³s criar comentÃ¡rio.
- **NotificationPanel**: Adicionadas categorias 'feed' e 'mention' ao categoryConfig para suporte a notificaÃ§Ãµes de feed/menÃ§Ãµes.

## 1.9.276
- **Dashboard**: Alinhado feed 100% com UserProfilePage. BotÃ£o "Comentar" agora abre modal com lista de quem comentou (igual ao perfil). Adicionados contadores clicÃ¡veis de curtidas/comentÃ¡rios. Modal de interaÃ§Ã£o (curtidas/comentÃ¡rios) implementado no Dashboard.

## 1.9.275
- **NotificationsModuleNew & Dashboard**: Corrigido navegaÃ§Ã£o de notificaÃ§Ã£o de menÃ§Ã£o/postagem. Clique na notificaÃ§Ã£o agora abre o Dashboard e rola suavemente atÃ© o post correto com destaque visual (ring-2 ring-blue-500).

## 1.9.274
- **UserProfilePage & Dashboard**: Implementado modal de galeria de imagens com fundo claro do tema (bg-slate-100/95) para visualizaÃ§Ã£o de anexos. Clique na imagem abre galeria com navegaÃ§Ã£o anterior/prÃ³xima e contador de imagens.

## 1.9.273
- **UserProfilePage**: Corrigido botÃ£o "Comentar" para abrir modal com a lista de quem comentou.

## 1.9.272
- **UserProfilePage**: Badges/tags com visual mais suave e preview Financeiro agora exibe detalhes reais do acordo (cliente, descriÃ§Ã£o, total, parcelas e status) quando houver referÃªncia financeira.

## 1.9.271
- **UserProfilePage**: Implementado modal para mostrar quem curtiu e quem comentou (clique nos contadores para ver lista de usuÃ¡rios com avatar e nome).

## 1.9.270
- **UserProfilePage**: Cards de posts na aba "Atividade" ajustados para um visual mais minimalista (menos sombra/padding e previews em caixa leve com barra lateral).

## 1.9.269
- **UserProfilePage**: Removida a seÃ§Ã£o "Performance/AvaliaÃ§Ã£o" (4.9 avaliaÃ§Ãµes) do perfil.

## 1.9.268
- **UserProfilePage**: Adicionadas aÃ§Ãµes do post (curtir/comentar) e carregamento de `liked_by_me` no perfil, igual ao feed.

## 1.9.267
- **UserProfilePage**: Box de criaÃ§Ã£o de post do perfil agora Ã© idÃªntico ao Dashboard (barra Mencionar/Tag/Foto/Emoji/Enquete, anexos, dropdowns e criador de enquete).

## 1.9.266
- **UserProfilePage**: Corrigido header do post para ficar idÃªntico ao Dashboard: nome clicÃ¡vel para abrir perfil, menu de aÃ§Ãµes (editar/excluir) para autor, e uso de availableTags.

## 1.9.265
- **UserProfilePage**: Posts na aba "Atividade" agora exibem badges de tags e cards de preview (`preview_data`) iguais ao feed (inclui cartÃ£o rosa de Assinatura).
- **UserProfilePage/App**: NavegaÃ§Ã£o dos cards de preview no perfil agora abre o mÃ³dulo correspondente com parÃ¢metros.

## 1.9.264
- **UserProfilePage**: BotÃ£o "Mensagem" agora abre o Chat flutuante direto na conversa (DM) com o usuÃ¡rio do perfil.
- **UserProfilePage**: BotÃ£o "Editar Perfil" agora abre a aba "Dados Pessoais".
- **UserProfilePage**: Removido botÃ£o "Compartilhar perfil".
- **ChatFloatingWidget**: Suporte ao evento `CHAT_WIDGET_OPEN_DM` para abrir/criar DM via evento global.

## 1.9.263
- **UserProfilePage**: Adicionada funcionalidade de criar posts diretamente do perfil (igual ao feed).
- **UserProfilePage**: Box de criaÃ§Ã£o de post com avatar, textarea e botÃ£o publicar (visÃ­vel apenas no prÃ³prio perfil).

## 1.9.262
- **UserProfilePage**: Tab "EstatÃ­sticas" agora exibe dados reais do sistema (clientes, processos, tarefas, compromissos, intimaÃ§Ãµes).
- **UserProfilePage**: EstatÃ­sticas divididas em "Feed & Engajamento" e "Dados do EscritÃ³rio".
- **App**: Clique no perfil do usuÃ¡rio agora abre a pÃ¡gina de perfil (UserProfilePage) em vez do modal (ProfileModal).
- **App**: Menu mobile tambÃ©m navega para a pÃ¡gina de perfil.

## 1.9.261
- **UserProfilePage**: Adicionadas tabs de configuraÃ§Ãµes (Dados Pessoais, SeguranÃ§a, EstatÃ­sticas) visÃ­veis apenas para o prÃ³prio perfil.
- **UserProfilePage**: Tab "Dados Pessoais" com formulÃ¡rio completo (nome, email, CPF, telefone, OAB, biografia).
- **UserProfilePage**: Tab "SeguranÃ§a" com alteraÃ§Ã£o de senha e detalhes da conta.
- **UserProfilePage**: Tab "EstatÃ­sticas" com cards coloridos (publicaÃ§Ãµes, curtidas, comentÃ¡rios, avaliaÃ§Ã£o).
- **UserProfilePage**: Tabs com Ã­cones e design responsivo (overflow-x-auto para mobile).

## 1.9.260
- **UserProfilePage**: Adicionado modal de seleÃ§Ã£o de capas predefinidas (10 opÃ§Ãµes jurÃ­dicas).
- **UserProfilePage**: BotÃ£o "Editar capa" agora abre modal com preview das capas disponÃ­veis.
- **UserProfilePage**: Indicador visual (CheckCircle) para a capa atualmente selecionada.
- **UserProfilePage**: Corrigido problema de src vazio em anexos de imagem.

## 1.9.259
- **UserProfilePage**: Removida a exibiÃ§Ã£o da OAB no header (abaixo do nome) para evitar quebra/ruÃ­do visual; OAB permanece apenas no card de contato.

## 1.9.258
- **UserProfilePage**: Design premium com capa gradiente azul/Ã­ndigo.
- **UserProfilePage**: Foto de perfil quadrada (128px) com borda, sombra e botÃ£o de ediÃ§Ã£o integrado.
- **UserProfilePage**: Sidebar com seÃ§Ã£o "Contato Profissional" (cargo, OAB, e-mail, telefone, localizaÃ§Ã£o) com Ã­cones coloridos.
- **UserProfilePage**: Sidebar com seÃ§Ã£o "Performance" (publicaÃ§Ãµes, curtidas, avaliaÃ§Ã£o) com grÃ¡ficos circulares.
- **UserProfilePage**: Tabs redesenhadas com estilo minimalista (Atividade, Sobre).
- **UserProfilePage**: Layout responsivo com grid 12 colunas (sidebar 4, main 8).
- **UserProfilePage**: Suporte a dark mode completo.

## 1.9.257
- **Perfil**: TÃ­tulo "Perfil do UsuÃ¡rio" agora aparece no header/nav.
- **Perfil**: Foto de perfil maior (w-32/40 em vez de w-28/36).
- **Perfil**: Cards de posts com sombra mais visÃ­vel (shadow-md + hover:shadow-lg).

## 1.9.256
- **Perfil**: Capa com mÃ¡scara/overlay reforÃ§ado para melhor contraste.
- **Perfil**: Avatar agora usa imagem inteira (sem corte) dentro do cÃ­rculo.
- **Perfil**: Cards de InformaÃ§Ãµes/EstatÃ­sticas mais compactos e com menos arredondamento.

## 1.9.255
- **Perfil**: Banners jurÃ­dicos (biblioteca, tribunal, escritÃ³rio, etc) disponÃ­veis.
- **Perfil**: Banner padrÃ£o jurÃ­dico exibido quando usuÃ¡rio nÃ£o selecionou nenhum.
- **Perfil**: EstÃ©tica melhorada com avatar maior com borda branca, capa maior com overlay, cards com headers coloridos e Ã­cones em cÃ­rculos coloridos.
- **Perfil**: Adicionado campo CPF nas informaÃ§Ãµes do perfil.

## 1.9.254
- **Feed**: Adicionado card de preview indigo para `#Documento` no post.

## 1.9.253
- **Feed**: Clique na menÃ§Ã£o `@nome` agora navega para a pÃ¡gina de perfil da pessoa mencionada.
- **Perfil**: Layout mais compacto (capa menor, avatar menor, nome menor).

## 1.9.252
- **Feed**: Adicionadas tags `#Assinatura` e `#Requerimento` com busca, preview e cards coloridos.
- **Feed**: Foto anexada no post agora exibe em tamanho maior (max-h-80) em vez de miniatura 28x28.
- **Feed**: Cards de preview agora passam `selectedId` para navegaÃ§Ã£o direta ao registro especÃ­fico.

## 1.9.251
- **Feed**: `#PetiÃ§Ã£o` agora busca na tabela `saved_petitions` (petiÃ§Ãµes salvas/recentes) em vez de `petition_documents` (templates).

## 1.9.250
- **Feed**: `#PetiÃ§Ã£o` agora exibe `title` (nome amigÃ¡vel) em vez de `file_name` (arquivo .html), com fallback para nome sem extensÃ£o.
- **Feed**: Adicionado card de preview cyan para `#PetiÃ§Ã£o` no post (igual aos outros cards de preview).

## 1.9.249
- **Feed**: `#PetiÃ§Ã£o` agora exibe o nome correto (prioriza `file_name`, fallback para `title`) e a busca considera `file_name` ou `title`.

## 1.9.248
- **Feed**: `#PetiÃ§Ã£o` â€” adicionada policy de SELECT em `petition_documents` (RLS) para permitir listagem no frontend.
- **Feed**: Melhorado diagnÃ³stico de erros â€” logs do Supabase para `#PetiÃ§Ã£o` e `#Documento` (evita falha silenciosa).

## 1.9.247
- **Feed**: Criada tag `#PetiÃ§Ã£o` para buscar petiÃ§Ãµes na tabela `petition_documents` (3 registros).

## 1.9.246
- **Feed**: Corrigido tag `#Documento` para usar tabela `generated_petition_documents` (onde hÃ¡ registros) em vez de `generated_documents` (vazia).

## 1.9.245
- **Feed**: Adicionado campo de busca no dropdown de registros da tag `#Cliente`.

## 1.9.244
- **Feed**: TraduÃ§Ã£o de `event_type` no `#Agenda` (hearing â†’ audiÃªncia, meeting â†’ reuniÃ£o, etc.).

## 1.9.243
- **Feed**: Corrigido "Invalid Date" no dropdown do `#Prazo` (formataÃ§Ã£o segura para `due_date`).
- **Feed**: Tag `#AudiÃªncia` ajustada para `#Agenda` (calendÃ¡rio de compromissos).

## 1.9.242
- **Feed**: ReferÃªncias financeiras (`#financeiro`) agora sÃ£o azuis e clicÃ¡veis para abrir o modal do acordo.

## 1.9.241
- **Feed**: Corrigido erro 400 no `#financeiro` â€” coluna `total_amount` nÃ£o existe, corrigido para `total_value`.

## 1.9.240
- **Feed**: Corrigido erro 400 no autocomplete/preview da tag `#financeiro` removendo embed PostgREST e buscando clientes em batch.

## 1.9.239
- **Feed**: Corrigido erro 400 ao carregar registros da tag `#financeiro` (embed PostgREST agreements â†’ clients ajustado para o constraint correto).

## 1.9.238
- **Enquete**: SeleÃ§Ã£o de participantes agora usa checkboxes (1 a 1) em vez de select multiple.
- **Enquete**: Design melhorado â€” removido roxo, agora usa azul/cinza mais bonito.

## 1.9.237
- **NotificaÃ§Ãµes**: CriaÃ§Ã£o de notificaÃ§Ãµes agora usa RPC `create_user_notification` (bypass RLS) para corrigir erro 403 ao notificar menÃ§Ãµes.

## 1.9.236
- **Feed**: Removido feed realtime temporariamente para corrigir erro de cache do Vite.

## 1.9.235
- **Feed**: Criada migration para corrigir RLS de notificaÃ§Ãµes (permitir criar notificaÃ§Ãµes para outros usuÃ¡rios).

## 1.9.234
- **Feed**: Implementado feed realtime - posts atualizam automaticamente quando outros usuÃ¡rios publicam.
- **Feed**: Criada migration para adicionar tipo 'mention' ao enum de notificaÃ§Ãµes.

## 1.9.233
- **Feed**: Corrigido regex de menÃ§Ãµes para suportar caracteres acentuados (Ãª, Ã£, Ã§, etc) em nomes completos.
- **Feed**: Corrigido sistema de notificaÃ§Ãµes para menÃ§Ãµes - agora usa `user_id` corretamente.

## 1.9.232
- **Feed**: Corrigido regex de menÃ§Ãµes para parar no final do nome (\b) - texto apÃ³s @nome nÃ£o fica mais azul.

## 1.9.231
- **Feed**: Corrigido erro "Edit2 is not defined" usando Ã­cone Pencil jÃ¡ importado.

## 1.9.230
- **Feed**: Adicionado indicador visual "editado" (Ã­cone + texto) quando um post foi modificado.

## 1.9.229
- **Feed**: Adicionado mÃ©todo `updatePost` no serviÃ§o `feedPostsService` para permitir ediÃ§Ã£o de posts.

## 1.9.228
- **Dashboard**: Corrigido erro "activeClients is not defined" nos cards de estatÃ­sticas.

## 1.9.227
- **Feed**: Corrigido bug onde editar post inline tambÃ©m editava o composer (estados separados).
- **Feed**: Corrigido erro "Cannot access 'availableTags' before initialization".

## 1.9.226
- **Feed**: Editor inline agora suporta **@** (menÃ§Ãµes) e **#** (tags) com dropdowns.
- **Feed**: Editor inline mudado de azul para **cinza** (slate-50/200/700).

## 1.9.225
- **Feed**: EdiÃ§Ã£o de posts agora Ã© **inline** â€” edita diretamente no prÃ³prio post, nÃ£o no composer.
- **Feed**: Editor inline com textarea, botÃµes Cancelar/Salvar e visual destacado (fundo indigo).

## 1.9.224
- **Enquetes**: Agora permite votar em **mÃºltiplas opÃ§Ãµes** (checkboxes em vez de radio).
- **Criador de Enquete**: UI/UX completamente redesenhado:
  - Header com Ã­cone em gradiente e descriÃ§Ã£o
  - Input de pergunta com placeholder mais claro
  - Contador de opÃ§Ãµes (x/6)
  - BotÃµes de remover opÃ§Ã£o aparecem apenas no hover
  - Checkbox "Permitir mÃºltiplas" com visual moderno
  - ConfiguraÃ§Ãµes organizadas em grid
  - Indicador de participantes selecionados
  - Gradientes mais vibrantes (indigo â†’ purple â†’ pink)
  - Sombras e bordas mais refinadas

## 1.9.223
- **PÃ¡gina de Perfil do UsuÃ¡rio** (estilo Facebook):
  - Foto de capa personalizÃ¡vel com upload
  - Avatar grande com upload
  - InformaÃ§Ãµes do perfil (cargo, OAB, email, telefone, localizaÃ§Ã£o)
  - Abas "PublicaÃ§Ãµes" e "Sobre"
  - EstatÃ­sticas de posts e curtidas
  - Exibe apenas posts do usuÃ¡rio selecionado
- **Badges Especiais**: Advogado (azul), Administrador (laranja), EstagiÃ¡rio (verde) exibidos nos posts.
- **Feed**: Clicar no nome/avatar do autor abre a pÃ¡gina de perfil.
- **Database**: MigraÃ§Ã£o `add_profile_cover_and_badge` adicionando campos `cover_url`, `badge`, `location`, `joined_at` na tabela `profiles`.
- **Tipo Profile**: Atualizado com novos campos `cover_url`, `badge`, `location`, `joined_at`.
- **NavegaÃ§Ã£o**: Adicionado mÃ³dulo `'perfil'` ao `ModuleName`.

## 1.9.222
- **Feed**: SubstituÃ­do `confirm()` do navegador por modal customizado (`useDeleteConfirm`) para excluir posts.
- **Dashboard**: Ajustada largura e espaÃ§amento para igualar aos outros mÃ³dulos (`space-y-4`, grid responsivo).
- **Dashboard**: Corrigido posicionamento sticky dos sidebars (`top-4` em vez de `top-24`).
- **Fix**: Corrigido erro `setNewPostContent is not defined` (jÃ¡ estava corrigido, era cache do navegador).

## 1.9.221
- **Enquetes**: Sistema completo de enquetes no feed com:
  - CriaÃ§Ã£o de enquetes com pergunta e atÃ© 6 opÃ§Ãµes
  - Tempo de expiraÃ§Ã£o configurÃ¡vel (1h, 6h, 24h, 3 dias, 7 dias ou sem expiraÃ§Ã£o)
  - SeleÃ§Ã£o de participantes especÃ­ficos (ou todos podem votar)
  - NotificaÃ§Ã£o automÃ¡tica aos participantes selecionados
  - VotaÃ§Ã£o com barra de progresso visual e percentuais
  - Indicador de voto do usuÃ¡rio e status de expiraÃ§Ã£o
- **Feed**: Corrigido layout cortado nos dropdowns de menÃ§Ã£o e tags (`overflow-visible`).
- **Design Premium**: Melhorias visuais no composer e posts:
  - Gradientes sutis no fundo do composer
  - Indicador de status online no avatar
  - Textarea com foco mais elegante (sombra azul)
  - BotÃ£o Publicar com gradiente e efeito hover elevado
  - Posts com sombras mais modernas e hover suave
  - Bordas mais arredondadas (rounded-2xl)

## 1.9.220
- **Feed**: autor pode **editar** e **excluir** seus prÃ³prios posts (menu dropdown no Ã­cone de 3 pontos).
- **Feed**: removido botÃ£o "Compartilhar" dos posts.
- **Feed**: menÃ§Ãµes `@nome` aparecem em **azul** e clicÃ¡veis no texto do post.
- **Feed**: notificaÃ§Ãµes de menÃ§Ã£o agora sÃ£o salvas no **banco de dados** (tabela `user_notifications`) â€” o usuÃ¡rio mencionado recebe a notificaÃ§Ã£o.
- **Feed**: corrigido erro 404 `financial_agreements` â†’ tabela correta Ã© `agreements`.
- **Feed**: adicionado tipo `'mention'` ao `UserNotificationType`.

## 1.9.219
- **Feed**: corrigido nome/role do autor nos posts â€” agora busca perfil opcionalmente (se existir, mostra nome real; senÃ£o, mostra "UsuÃ¡rio").
- **Feed**: `hydrateAuthors` busca perfis em batch para melhor performance.

## 1.9.218
- **Feed**: corrigido erro de foreign key constraint â€” removidas dependÃªncias de `profiles` (feed funciona mesmo sem perfil criado).
- **Database**: migration `remove_feed_posts_profile_fk` aplicada via MCP.

## 1.9.217
- **Feed**: **Foto** e **Emoji** funcionam no composer â€” emoji picker com 32 emojis e upload de imagem via Supabase Storage (bucket `anexos_chat`) com preview antes de publicar.
- **Feed**: imagens anexadas aparecem nos posts (usando `signedUrl` temporÃ¡rio).
- **Feed**: `feed_posts.attachments` (jsonb) salva metadados dos anexos; `feedPostsService.uploadAttachment` faz o upload.
- **Database**: migration `20250110_feed_posts.sql` idempotente (`DROP POLICY/TRIGGER IF EXISTS`) â€” pode rodar quantas vezes quiser.

## 1.9.216
- **Feed**: componente `FeedWidget` reutilizÃ¡vel criado para usar em todos os mÃ³dulos.
- **Feed**: suporte a modo compacto para sidebars e modo completo para pÃ¡ginas.
- **Feed**: filtro por contexto do mÃ³dulo (posts relacionados a clientes, processos, etc).

## 1.9.215
- **Feed**: tabelas `feed_posts`, `feed_post_likes`, `feed_post_comments` criadas no Supabase via MCP.
- **Feed**: **notificaÃ§Ãµes de menÃ§Ãµes** - quando vocÃª menciona alguÃ©m (@usuario), a pessoa recebe uma notificaÃ§Ã£o.
- **NotificaÃ§Ãµes**: novas categorias `mention` e `feed` adicionadas ao sistema de notificaÃ§Ãµes.

## 1.9.214
- **Feed**: ao clicar em uma tag (`#financeiro`, `#cliente`, etc), agora mostra **lista de registros reais** do sistema.
- **Feed**: ao selecionar um registro, insere **texto formatado automaticamente** no post (ex: "acordo financeiro do cliente ROBERTO, valor R$ 1.500,00 (3x de R$ 500,00)").
- **Feed**: registros incluem acordos financeiros, compromissos da agenda, clientes, processos, prazos e documentos.

## 1.9.213
- **Feed**: sistema de **tags integradas** com dados reais do sistema (`#financeiro`, `#cliente`, `#processo`, `#prazo`, `#agenda`).
- **Feed**: posts salvos no **banco de dados** (tabela `feed_posts`) com likes e comentÃ¡rios.
- **Feed**: **cards de preview** coloridos mostrando dados reais (resumo financeiro, cliente, processo, prazo, agenda).
- **Feed**: botÃ£o **Publicar** funcional com loading e salvamento no banco.
- **Feed**: sistema de **likes** com contagem e estado visual.
- **Database**: novas tabelas `feed_posts`, `feed_post_likes`, `feed_post_comments` com RLS.
- **Dashboard**: corrigido espaÃ§o em branco lateral em telas largas (quando a sidebar direita estÃ¡ oculta). O feed central agora expande para ocupar as colunas disponÃ­veis.

## 1.9.212
- **Dashboard**: cards de estatÃ­sticas de volta ao **topo** do feed (antes do campo de postar).

## 1.9.211
- **Dashboard**: campo de **postagem** movido para o **topo** do feed.
- **Dashboard**: cards de estatÃ­sticas mais **compactos** (padding/typography/gap menores).

## 1.9.210
- **Dashboard**: cards de estatÃ­sticas (Clientes, Processos, Prazos, Tarefas) reduzidos de tamanho (padding menor, texto menor).
- **Dashboard**: widget **Aguardando ConfecÃ§Ã£o** redesenhado (layout mais clean, sem caixa de scroll) com **nomes** e contador `+N`.

## 1.9.209
- **Dashboard**: widget **Aguardando ConfecÃ§Ã£o** melhorado para mostrar nomes dos clientes/beneficiÃ¡rios com design bonito.
- **Dashboard**: itens do widget Aguardando ConfecÃ§Ã£o agora mostram Ã­cones, gradientes e hover effects.

## 1.9.208
- **Dashboard**: widget **Aguardando ConfecÃ§Ã£o** melhorado para mostrar nomes dos clientes/beneficiÃ¡rios com design bonito.
- **Dashboard**: itens do widget Aguardando ConfecÃ§Ã£o agora mostram Ã­cones, gradientes e hover effects.

## 1.9.207
- **Dashboard**: corrigido widget **Financeiro** para facilitar o arrastar (removido indicador duplicado).
- **Dashboard**: tratamento de erro de **quota do localStorage** com fallback para cache reduzido.

## 1.9.206
- **Dashboard**: preferÃªncias de widgets agora sÃ£o salvas no **banco de dados** (tabela `dashboard_preferences`) por usuÃ¡rio.
- **Dashboard**: organizaÃ§Ã£o dos widgets persiste entre dispositivos e sessÃµes.
- **Database**: nova tabela `dashboard_preferences` com RLS para salvar preferÃªncias personalizadas por usuÃ¡rio.

## 1.9.205
- **Dashboard**: widgets agora podem ser **trocados entre sidebars** (esquerda â†” direita) via drag-and-drop.
- **Dashboard**: sidebar fica destacada (fundo azul claro) ao arrastar widget sobre ela.
- **Dashboard**: ordem dos widgets persistida separadamente para cada sidebar no localStorage.

## 1.9.204
- **Build**: habilitado suporte a import com extensÃ£o `.tsx` para evitar conflito de resoluÃ§Ã£o `Dashboard`/`dashboard` no Windows.
- **Dashboard**: corrigido widget **Financeiro** que estava cortado/bugado na sidebar direita (layout compacto).
- **Dashboard**: feed estilo **Facebook** com suporte a **menÃ§Ãµes** (@usuario) e **tags** (#financeiro, #processo, #prazo, etc).
- **Dashboard**: indicadores visuais de **drag-and-drop** nos widgets (Ã­cone de arrastar ao passar o mouse).
- **Dashboard**: widgets da sidebar esquerda mais **compactos** para melhor visualizaÃ§Ã£o.
- **Dashboard**: barra de tags interativas para filtrar o feed por categoria.

## 1.9.203
- **Dashboard/Build**: corrigidos conflitos de import (Dashboard/dashboard) e ajustes de parÃ¢metros para abrir Processos/Requerimentos jÃ¡ filtrados em **Aguardando ConfecÃ§Ã£o**.

## 1.9.202
- **Dashboard**: widgets de **Aguardando ConfecÃ§Ã£o** para Processos e Requerimentos (com contagem e navegaÃ§Ã£o filtrada) + correÃ§Ã£o de hover (Tailwind) nos cards.

## 1.9.201
- **Dashboard**: removidos card de perfil e conteÃºdos duplicados; financeiro fica apenas no sidebar (layout mais estilo Facebook).

## 1.9.200
- **Dashboard**: removidos itens nÃ£o usados (aÃ§Ãµes/filtros/Ã¡reas/premium), adicionado widget **Financeiro** e menÃ§Ã£o **#financeiro** no feed.

## 1.9.199
- **Dashboard**: novo layout estilo rede social com 3 colunas (sidebar esquerda com agenda/tarefas/DJEN, feed central com posts/atualizaÃ§Ãµes, sidebar direita com perfil/navegaÃ§Ã£o).

## 1.9.198
- **Chat**: corrigido crash "Rendered fewer hooks than expected" no widget flutuante.

## 1.9.197
- **NotificaÃ§Ãµes**: intimaÃ§Ãµes liberadas apenas para cargos **Administrador** e **Advogado** (demais perfis nÃ£o veem/contam/recebem).

## 1.9.196
- **NotificaÃ§Ãµes**: intimaÃ§Ãµes agora respeitam permissÃµes (perfis sem `intimacoes` nÃ£o veem/contam/recebem popup no sino).

## 1.9.195
- **Chat**: widget flutuante: avatar do remetente em imagens agora Ã© detectado por **mimeType** (nÃ£o depende sÃ³ do preview).

## 1.9.194
- **Chat**: widget flutuante: launcher exibe **avatar de quem enviou a imagem** na notificaÃ§Ã£o.

## 1.9.193
- **Chat**: widget flutuante: badge de **nÃ£o lidas** agora Ã© reidratado no refresh (persistÃªncia local + merge com banco).

## 1.9.192
- **PetiÃ§Ãµes/Chat**: launcher combinado: segmento **Editor** com a mesma cor de **Mensagens**, mantendo apenas o **divisor laranja**.

## 1.9.191
- **PetiÃ§Ãµes/Chat**: editor minimizado: botÃ£o **nÃ£o sobrepÃµe** o chat; launcher combinado **Mensagens + Editor** com divisÃ³ria laranja.

## 1.9.190
- **Chat**: widget flutuante: modal com **altura fixa** (sem contrair/expandir) durante o carregamento.

## 1.9.189
- **Chat**: widget flutuante: removido **maxHeight fixo** do container de mensagens para evitar contraÃ§Ã£o ao carregar.

## 1.9.188
- **Chat**: widget flutuante: input mantÃ©m **foco automÃ¡tico** apÃ³s enviar mensagem.

## 1.9.187
- **Chat**: widget flutuante: header com **largura fixa** para evitar encolhimento ao truncar nomes longos.

## 1.9.186
- **Chat**: widget flutuante: anexos (ex.: **PDF**) agora abrem via link assinado no mini-chat.

## 1.9.185
- **Chat**: corrigido bug onde imagem/mensagem recÃ©m-enviada **sumia** apÃ³s alguns segundos (listagem agora traz as **Ãºltimas** mensagens).

## 1.9.184
- **Chat**: widget flutuante: ajuste de **design/layout** (alinhamento do nome + badge verificado e toast).

## 1.9.183
- **Chat**: widget flutuante: corrigida inconsistÃªncia do **badge de nÃ£o lidas** (total vs por conversa).

## 1.9.182
- **Chat**: correÃ§Ã£o de status "visto por Ãºltimo" (evita erro quando `last_seen_at` Ã© nulo).

## 1.9.181
- **Chat**: imagens/anexos: clique no preview para **ampliar** (lightbox) no mÃ³dulo Chat e no mini-chat do widget.

## 1.9.180
- **Chat**: widget flutuante: badge **verificado** (Administrador **gold** e Advogado **azul**).

## 1.9.179
- **Chat**: widget flutuante: correÃ§Ã£o de status **Online/Offline** (evita "falso offline") usando Presence em tempo real.

## 1.9.178
- **Chat**: widget flutuante (mini-chat): adicionado envio de **Ã¡udio**, **anexos** e **emojis**.

## 1.9.177
- **Chat**: widget flutuante: ajustada **altura** do painel/mini-chat para nÃ£o ficar muito alto.

## 1.9.176
- **Chat**: widget flutuante: indicador de **nÃ£o lido por conversa** (badge na lista) e limpeza ao abrir.

## 1.9.175
- **Chat**: widget flutuante: correÃ§Ã£o do **toast** (avatar/preview) para renderizar no local correto e notificaÃ§Ã£o com **som**.

## 1.9.174
- **Chat**: widget flutuante: corrigido **toast** (avatar/nome/preview) e melhora do **som** de notificaÃ§Ã£o apÃ³s primeira interaÃ§Ã£o do usuÃ¡rio.

## 1.9.173
- **Chat**: widget flutuante: **som** e **toast** de notificaÃ§Ã£o (avatar + preview) ao receber novas mensagens.

## 1.9.172
- **Chat**: widget flutuante (mini-chat): corrigida **notificaÃ§Ã£o** mantendo subscription de mensagens estÃ¡vel (evita perder eventos ao abrir/fechar).

## 1.9.171
- **Chat**: widget flutuante (mini-chat): corrigida **notificaÃ§Ã£o/badge** ao receber novas mensagens e ajuste para **marcar como lido** ao abrir a conversa pelo widget.

## 1.9.170
- **Chat**: widget flutuante (mini-chat): **preview de foto/anexo**, correÃ§Ã£o de **scroll lateral** e conversa abrindo **no final**.

## 1.9.169
- **Chat**: widget flutuante de Mensagens agora Ã© um **mini-chat** (abre conversa dentro do widget com mensagens e envio).

## 1.9.168
- **Chat**: widget flutuante de Mensagens com **botÃ£o fixo** (nÃ£o desloca para a esquerda ao abrir o painel).

## 1.9.167
- **Chat**: novo **widget flutuante de Mensagens** fora do mÃ³dulo Chat (badge de nÃ£o-lidas + lista rÃ¡pida) com atalho para abrir conversas.

## 1.9.166
- **Chat**: corrigido indicador **"digitando..."** (Presence) reutilizando o mesmo channel em vez de criar um novo a cada digitaÃ§Ã£o.

## 1.9.165
- **Chat**: corrigidas policies (RLS) do Supabase Storage para permitir upload no bucket `anexos_chat` (anexos e Ã¡udio).
- **Chat**: mensagens de **imagem** agora mostram **preview** no chat (via signed URL).

## 1.9.164
- **Chat**: envio de **mensagens de Ã¡udio** via MediaRecorder API.
- **Chat**: Ã¡udios armazenados no bucket `anexos_chat` com validade de 6 meses.
- **Chat**: player de Ã¡udio nativo nas mensagens com controls.

## 1.9.163
- **Chat**: indicador **"digitando..."** em tempo real via Supabase Presence.
- **Chat**: mostrar **"visto por Ãºltimo"** no header quando usuÃ¡rio estÃ¡ offline.

## 1.9.162
- **Chat**: e-mail substituÃ­do por **badge de funÃ§Ã£o (role)** no header, lista de contatos e drawer.

## 1.9.161
- **Chat**: suporte a **anexos** (upload no bucket `anexos_chat`) com download por link temporÃ¡rio.
- **Chat**: anexos com **validade de 6 meses** (apÃ³s expirar, download fica indisponÃ­vel).
- **Chat**: botÃ£o de **emoji** para inserir rapidamente no campo de mensagem.

## 1.9.160
- **Chat**: modal **Nova Conversa** padronizado no estilo do CRM (header, botÃ£o X visÃ­vel e layout mais limpo).
- **Chat**: removidos tons `amber` residuais no modal (evita fundo â€œbegeâ€� nos itens e spinner alinhado ao tema).

## 1.9.159
- **Chat**: esquema de cores profissional (indigo/slate) aplicado em todo o mÃ³dulo.

## 1.9.158
- **Chat**: cores do sistema (laranja/amber) aplicadas em todo o mÃ³dulo.
- **Chat**: traduÃ§Ã£o completa para portuguÃªs (todos os textos em inglÃªs removidos).
- **Chat**: modal **Nova Conversa** redesenhado com faixa laranja e botÃ£o X visÃ­vel.
- **Chat**: botÃ£o de 3 pontos removido, substituÃ­do por toggle de notificaÃ§Ã£o sonora.
- **Chat**: altura ajustada para `calc(100vh - 7rem)` eliminando scroll residual.

## 1.9.157
- **Chat**: correÃ§Ã£o definitiva da altura usando `calc(100vh - 5rem)` para ocupar exatamente a viewport disponÃ­vel sem gerar scroll no body.

## 1.9.156
- **Chat**: mÃ³dulo agora ocupa **altura total** (layout em tela cheia) e o rodapÃ© (Â©/versÃ£o/AlteraÃ§Ãµes) foi removido **apenas** no Chat.
- **Chat**: modal **Nova Conversa** redesenhado com visual mais profissional (header com gradiente, busca aprimorada e lista de contatos mais elegante).

## 1.9.122
- **Central de NotificaÃ§Ãµes**: agregadas pendÃªncias do **Financeiro** (parcelas vencidas) com filtro por tipo e navegaÃ§Ã£o para o mÃ³dulo.

## 1.9.121
- **Central de NotificaÃ§Ãµes**: agora agrega tambÃ©m **Assinaturas pendentes** e **notificaÃ§Ãµes do sistema (user_notifications)**, permitindo navegaÃ§Ã£o direta para os mÃ³dulos relacionados.
- **Central de NotificaÃ§Ãµes (DJEN)**: marcar intimaÃ§Ãµes como lidas na Central passa a ser **somente local**, sem alterar o status crÃ­tico no mÃ³dulo/serviÃ§o de IntimaÃ§Ãµes.

## 1.9.120
- **Central de NotificaÃ§Ãµes**: correÃ§Ã£o de JSX (remoÃ§Ã£o de fechamento extra) apÃ³s ajustes de padronizaÃ§Ã£o visual.

## 1.9.119
- **Central de NotificaÃ§Ãµes**: correÃ§Ã£o de estrutura/JSX apÃ³s a padronizaÃ§Ã£o do layout (evita falhas de renderizaÃ§Ã£o/compilaÃ§Ã£o).

## 1.9.118
- **Central de NotificaÃ§Ãµes**: padronizaÃ§Ã£o do layout para ficar consistente com os demais mÃ³dulos (header/toolbar em cards padrÃ£o do sistema, espaÃ§amentos e estilos de inputs/botÃµes).

## 1.9.117
- **Central de NotificaÃ§Ãµes**: refinamento visual inspirado em portais institucionais (header com gradiente + cards com blur, filtros mais consistentes), destaque melhor para **nÃ£o lidas/urgentes**, e **paginaÃ§Ã£o funcional** com contagem real de itens.

## 1.9.116
- **Central de NotificaÃ§Ãµes**: reorganizaÃ§Ã£o completa do layout (header/estatÃ­sticas/filtros/lista) com visual mais limpo e consistente, melhoria de legibilidade no dark mode e correÃ§Ã£o de navegaÃ§Ã£o ao clicar (agora direciona para **IntimaÃ§Ãµes** e **Agenda** corretamente).

## 1.9.115
- **Agenda (Eventos)**: corrigido campo **Tipo** no modal de evento â€” em vez de exibir o valor tÃ©cnico (`hearing`), agora exibe **AudiÃªncia** (e demais tipos com rÃ³tulo amigÃ¡vel).

## 1.9.114
- **Processos (AudiÃªncia/DistribuiÃ§Ã£o)**: corrigida inconsistÃªncia de data exibindo **-1 dia** em "Detalhes do Processo" (erro de timezone ao interpretar strings `YYYY-MM-DD`/ISO). Agora a UI formata datas *date-only* sem conversÃ£o de fuso, garantindo que a data salva e a data exibida sejam iguais.

## 1.9.113
- **Documentos (GeraÃ§Ã£o)**: corrigido problema onde apenas o documento principal era gerado, **sem os anexos**. Agora ao gerar um documento de um modelo que possui anexos (template_files), todos os anexos sÃ£o processados (variÃ¡veis substituÃ­das) e incluÃ­dos:
  - **Baixar Word**: se houver anexos, baixa um **ZIP** com o documento principal + anexos
  - **Baixar PDF**: se houver anexos, **mescla todos** em um Ãºnico PDF
  - **Enviar para Assinatura**: anexos jÃ¡ eram enviados corretamente (sem alteraÃ§Ã£o)
  - Modal de opÃ§Ãµes agora exibe a lista de anexos incluÃ­dos

## 1.9.112
- **Assinatura (Kit Consumidor / Preencher)**: agora o preenchimento do formulÃ¡rio pÃºblico Ã© **salvo automaticamente em cache local (localStorage)** por token â€” se a pÃ¡gina recarregar/cair, o cliente nÃ£o perde as informaÃ§Ãµes. O cache Ã© limpo automaticamente apÃ³s enviar e gerar o link de assinatura.

## 1.9.111
- **Assinatura (Kit Consumidor / Preencher)**: corrigido loop de validaÃ§Ã£o de endereÃ§o â€” quando o CEP Ã© reconhecido e confirmado pelo usuÃ¡rio, os campos **EndereÃ§o** e **Bairro** (preenchidos pelo ViaCEP) nÃ£o sÃ£o mais considerados "faltantes". Agora o formulÃ¡rio avanÃ§a corretamente para o prÃ³ximo passo.

## 1.9.110
- **Assinatura (Kit Consumidor / Preencher)**: corrigido fluxo de validaÃ§Ã£o do formulÃ¡rio pÃºblico â€” quando houver campos obrigatÃ³rios faltando, o sistema volta para a primeira etapa pendente (evitando ficar preso em **"Gerando documento..."**). Melhorias na validaÃ§Ã£o de **CEP/endereÃ§o**.

## 1.9.109
- **Peticionamento (Modelo PadrÃ£o do Modelo)**: corrigido o salvamento/visualizaÃ§Ã£o do **documento padrÃ£o** da PetiÃ§Ã£o PadrÃ£o â€” apÃ³s vincular, a UI agora sincroniza a lista de modelos (incluindo o seletor hierÃ¡rquico Ã�rea â†’ Modelos).

## 1.9.108
- **Peticionamento (Blocos por Modelo)**: no modal **"Novo/Editar Bloco"**, adicionado campo **"Modelo (PetiÃ§Ã£o PadrÃ£o)"** para cadastrar o bloco diretamente em um modelo especÃ­fico. Ao criar/editar dentro do contexto de um modelo, o vÃ­nculo Ã© aplicado automaticamente e a listagem Ã© recarregada conforme o escopo.

## 1.9.107
- **Peticionamento (Seletor Ã�rea/Modelo)**: seletor do topo agora Ã© **hierÃ¡rquico** (Ã�rea â†’ Modelos) com subnÃ­veis e permite **entrar direto em um modelo**. Lista de modelos passa a atualizar automaticamente ao criar/editar/excluir (sem precisar recarregar a pÃ¡gina).

## 1.9.106
- **Peticionamento (Modelos / PetiÃ§Ãµes PadrÃµes)**: adicionada navegaÃ§Ã£o por **Modelos** na sidebar de **Blocos** â€” ao selecionar um modelo (ex.: PrevidenciÃ¡rio â†’ AuxÃ­lio-acidente), a listagem passa a exibir **somente os blocos do modelo**, com opÃ§Ã£o de voltar para a visÃ£o por **Ã�rea**.

## 1.9.105
- **Peticionamento (Biblioteca de Textos)**: ao usar **Escopo: Global** no modal **"Adicionar Bloco"**, cada resultado agora exibe a **Ã�rea JurÃ­dica de origem** (badge), facilitando identificar de onde o bloco estÃ¡ sendo puxado.

## 1.9.104
- **Peticionamento (Biblioteca de Textos)**: melhorado o **UI/UX** do modal **"Adicionar Bloco"** â€” seletor de **Escopo** reposicionado para **acima da busca** e redesenhado como um controle segmentado mais limpo.

## 1.9.103
- **Peticionamento (Biblioteca de Textos)**: no modal **"Adicionar Bloco"**, adicionada opÃ§Ã£o de **busca global** com seletor de escopo (**PetiÃ§Ã£o / Ã�rea / Global**) e carregamento automÃ¡tico conforme o escopo.

## 1.9.102
- **Peticionamento (PetiÃ§Ãµes PadrÃµes)**: ao atualizar a pÃ¡gina, o editor agora **mantÃ©m a Ã�rea JurÃ­dica e PetiÃ§Ã£o PadrÃ£o selecionadas** (persistÃªncia em cache local). Corrigido tambÃ©m o fluxo de **vincular documento prÃ©-pronto (SFDT)** na petiÃ§Ã£o padrÃ£o, atualizando imediatamente a lista/seleÃ§Ã£o.

## 1.9.101
- **Peticionamento (PetiÃ§Ãµes PadrÃµes)**: novo sistema de **PetiÃ§Ãµes PadrÃµes** por Ã¡rea jurÃ­dica â€” permite criar tipos de petiÃ§Ã£o (ex: AuxÃ­lio-acidente, BPC, Aposentadoria) e vincular blocos especÃ­ficos a cada tipo. Seletor de petiÃ§Ã£o padrÃ£o no header do editor. Filtro de blocos por escopo: **PetiÃ§Ã£o** (blocos do tipo selecionado), **Ã�rea** (blocos da Ã¡rea jurÃ­dica) ou **Global** (todos os blocos). Possibilidade de vincular um **documento prÃ©-pronto (SFDT)** que serÃ¡ carregado automaticamente ao selecionar o tipo.

## 1.9.100
- **Peticionamento (Categorias de Blocos)**: corrigido erro **400** ao salvar "Configurar categorias" (upsert nÃ£o envia mais `id` invÃ¡lido/indefinido).

## 1.9.99
- **Peticionamento (Editor Syncfusion)**: interface do editor (toolbar/menus) agora em **portuguÃªs (pt-BR)**.

## 1.9.98
- **Peticionamento (Ã�reas JurÃ­dicas)**: blocos antigos foram **vinculados ao Trabalhista** (migraÃ§Ã£o de backfill) e a listagem agora Ã© **filtrada estritamente pela Ã¡rea selecionada** (ex.: ao escolher **CÃ­vel**, nÃ£o exibe blocos de Trabalhista).

## 1.9.97
- **Peticionamento (Ã�reas JurÃ­dicas)**: novo sistema de **cadastro de Ã�reas JurÃ­dicas** (Trabalhista, CÃ­vel, Penal, etc.) â€” permite criar, editar e gerenciar Ã¡reas livremente. Seletor de Ã¡rea no header do editor com cor de identificaÃ§Ã£o. Blocos existentes permanecem intactos (sem Ã¡rea = disponÃ­veis para todas).

## 1.9.96
- **Peticionamento (Offline)**: ao ficar **sem conexÃ£o**, o editor agora exibe uma **tela de bloqueio (overlay)** informando que o peticionamento Ã© 100% online, impedindo ediÃ§Ãµes atÃ© reconectar (com aÃ§Ãµes "Verificar conexÃ£o" e "Recarregar").

## 1.9.95
- **Financeiro (Acordos)**: no **Resumo do Acordo**, removido **"Valor LÃ­quido Cliente"** quando o tipo de honorÃ¡rio Ã© **fixo**, pois nÃ£o se aplica nesse contexto.

## 1.9.94
- **Financeiro (Acordos)**: corrigido exibiÃ§Ã£o de honorÃ¡rios nas parcelas â€” quando honorÃ¡rios sÃ£o **fixos**, agora mostra o valor total (nÃ£o dividido) e oculta "Valor Cliente" por parcela, pois nÃ£o se aplica nesse contexto.

## 1.9.93
- **Assinaturas (ADM)**: redesign completo da toolbar â€” filtros de status em formato de **tabs**, busca centralizada, botÃµes de aÃ§Ã£o agrupados Ã  direita, painel de **autenticaÃ§Ã£o pÃºblica** com Ã­cone Globe e toggles inline, layout mais limpo e intuitivo.

## 1.9.92
- **Assinatura PÃºblica**: painel de **modos de autenticaÃ§Ã£o** no ADM ficou mais compacto e agora **salva automaticamente** ao alternar **Google**, **E-mail (OTP)** e **Telefone (OTP)**, liberando mais espaÃ§o na listagem de documentos.

## 1.9.91
- **Assinatura PÃºblica**: adicionada opÃ§Ã£o no mÃ³dulo de Assinatura (ADM) para ativar/desativar os modos de autenticaÃ§Ã£o **Google**, **E-mail (OTP)** e **Telefone (OTP)**. A pÃ¡gina pÃºblica passa a respeitar essa configuraÃ§Ã£o e remove automaticamente opÃ§Ãµes desativadas.

## 1.9.90
- **Build**: corrigido erro de compilaÃ§Ã£o `formatDateTime` nÃ£o definido em ProcessesModule.tsx. Adicionada funÃ§Ã£o local `formatDateTime` para exibir data/hora nas notas do processo.

## 1.9.89
- **Assinatura PÃºblica**: corrigido bloqueio de CORS/preflight ao chamar Edge Function `public-sign-document` (headers `Access-Control-Allow-Methods` e resposta `OPTIONS` com HTTP 200). ObservaÃ§Ã£o: a funÃ§Ã£o deve ser deployada com `--no-verify-jwt` para funcionar sem sessÃ£o.

## 1.9.88
- **Assinatura PÃºblica**: corrigido erro de RLS (401) ao assinar documento em pÃ¡gina pÃºblica. Criada Edge Function `public-sign-document` que executa com service role, evitando problemas de permissÃ£o quando nÃ£o hÃ¡ sessÃ£o autenticada.

## 1.9.87
- **PetiÃ§Ãµes (Recentes)**: texto do loading ajustado para **"Carregando..."**.
- **PetiÃ§Ãµes (Blocos)**: botÃ£o **"Adicionar no documento"** no **Visualizar Bloco** ajustado para o **tema laranja** do sistema.

## 1.9.86
- **PetiÃ§Ãµes (Recentes)**: adicionado loading **"Procurando..."** enquanto carrega a lista de petiÃ§Ãµes salvas.

## 1.9.85
- **PetiÃ§Ãµes (Blocos)**: botÃ£o **Editar** no **Visualizar Bloco** agora segue o **tema laranja** do sistema.

## 1.9.84
- **PetiÃ§Ãµes (Blocos)**: clique no bloco na **sidebar** agora abre **Visualizar Bloco** (em vez de inserir direto).

## 1.9.83
- **PetiÃ§Ãµes (Blocos)**: adicionado botÃ£o **Editar** no modal **Visualizar Bloco**.

## 1.9.82
- **PetiÃ§Ãµes (Mobile)**: item **PetiÃ§Ãµes** no menu mobile agora mostra aviso de indisponibilidade em vez de abrir o editor.
- **Editor de PetiÃ§Ãµes (Widget)**: widget minimizado oculto no mobile.

## 1.9.81
- **Editor de PetiÃ§Ãµes (Widget)**: ajustes de tamanho/legibilidade no modo minimizado (Ã­cone e texto menores).

## 1.9.80
- **Editor de PetiÃ§Ãµes (Widget)**: modo minimizado com label "Editor" para facilitar identificaÃ§Ã£o.

## 1.9.79
- **Editor de PetiÃ§Ãµes (Widget)**: refinamento visual do botÃ£o minimizado (tamanho, sombra e glow).

## 1.9.78
- **Editor de PetiÃ§Ãµes (Widget)**: botÃ£o minimizado agora Ã© **minimalista** (sÃ³ Ã­cone, sem texto) para ocupar menos espaÃ§o visual.

## 1.9.77
- **Editor de PetiÃ§Ãµes (Widget)**: botÃ£o minimizado redesenhado com **visual mais moderno** (destaque, sombra, borda e microinteraÃ§Ãµes) para facilitar encontrar e reabrir o editor.

## 1.9.76
- **PetiÃ§Ãµes (Blocos)**: ao clicar em **â€œAdicionar no documentoâ€�** no Visualizar Bloco, o sistema agora **fecha automaticamente o modal de busca**.

## 1.9.75
- **PetiÃ§Ãµes (Blocos)**: ao abrir **Visualizar Bloco** a partir da busca, o modal de busca agora **permanece aberto**. Fechar o Visualizar Bloco **nÃ£o fecha** a busca.

## 1.9.74
- **PetiÃ§Ãµes (Editor)**: item **â€œInserir blocoâ€�** do menu de contexto agora aparece com **destaque laranja forte por padrÃ£o**.

## 1.9.73
- **PetiÃ§Ãµes (Editor)**: ajuste no menu de contexto para **manter â€œAdicionar blocoâ€� sempre visÃ­vel**, ficando **desabilitado quando nÃ£o houver seleÃ§Ã£o** (preserva a ordem dos itens).

## 1.9.72
- **PetiÃ§Ãµes (Editor)**: menu de contexto (clique direito) com **ordem ajustada**: **Inserir bloco** (1Âº), **Adicionar bloco** (2Âº), **Buscar empresa** (3Âº). TambÃ©m foi adicionado **hover laranja** nos itens.

## 1.9.71
- **PetiÃ§Ãµes (Editor)**: ao **carregar/importar um documento (DOCX/SFDT)** o sistema agora **captura e salva automaticamente a fonte (nome e tamanho)** como padrÃ£o, mantendo consistÃªncia de formataÃ§Ã£o nas prÃ³ximas inserÃ§Ãµes/digitaÃ§Ã£o.

## 1.9.70
- **PetiÃ§Ãµes (Cadastro de Bloco)**: nova opÃ§Ã£o **"Atualizar bloco existente"** ao criar um bloco, permitindo escolher um bloco alvo e salvar como atualizaÃ§Ã£o (evita duplicar blocos repetidos).

## 1.9.69
- **PetiÃ§Ãµes (Cadastro de Bloco)**: tags agora sÃ£o **quebradas automaticamente por espaÃ§o** ao clicar **Adicionar/Enter** e conectores (de/da/do/etc.) sÃ£o ignorados, sem precisar clicar em botÃ£o extra.

## 1.9.68
- **PetiÃ§Ãµes (Cadastro de Bloco)**: campo de tags agora **quebra frases automaticamente** (botÃ£o â€œQuebrar frasesâ€�) para criar vÃ¡rias tags de uma vez, facilitando cadastrar blocos com mÃºltiplos temas.

## 1.9.67
- **PetiÃ§Ãµes (Adicionar Bloco)**: busca com **fuzzy mais forte** (tolerÃ¢ncia a mÃºltiplos erros/typos) e ordenaÃ§Ã£o baseada nos melhores termos, para continuar sugerindo blocos mesmo com digitaÃ§Ã£o bem errada.

## 1.9.66
- **PetiÃ§Ãµes (Adicionar Bloco)**: busca mais **tolerante** a termos digitados errado/extra (ignora palavras muito curtas e conectivos comuns e permite 1 termo falhar quando a busca tem vÃ¡rios termos), evitando â€œNenhum bloco encontradoâ€� por ruÃ­do.

## 1.9.65
- **PetiÃ§Ãµes (Adicionar Bloco)**: resultados com **prÃ©via maior do conteÃºdo** (mais linhas/caracteres) e lista com **scroll**, facilitando explorar o texto antes de inserir.

## 1.9.64
- **PetiÃ§Ãµes (Adicionar Bloco)**: modal **mais largo** e tags com visual melhor (chips mais legÃ­veis, truncamento e indicador `+N`).

## 1.9.63
- **PetiÃ§Ãµes (Adicionar Bloco)**: ajuste de **relevÃ¢ncia** na busca priorizando **tags** (sem deixar de considerar o **conteÃºdo** e o **tÃ­tulo**) para resultados mais assertivos.

## 1.9.62
- **PetiÃ§Ãµes (Adicionar Bloco)**: busca e listagem de blocos **mais rÃ¡pida** com debounce e indexaÃ§Ã£o/cache de texto (evita reprocessar SFDT a cada tecla), melhorando a responsividade do modal de busca e da sidebar.

## 1.9.61
- **Processos (Mapa de Fases)**: adicionada visÃ£o em formato de **mapa** por etapas (ex.: ConciliaÃ§Ã£o, InstruÃ§Ã£o, etc.). Ao clicar em uma fase, o sistema lista os processos daquela etapa com busca e atalhos para abrir detalhes/timeline.

## 1.9.60
- **Processos (Timeline Geral)**: adicionada **Linha do Tempo Geral** (feed unificado) para buscar publicaÃ§Ãµes/movimentaÃ§Ãµes dos processos sincronizadas do DJEN, com busca por cliente/nÃºmero/Ã³rgÃ£o/texto e atalho para abrir o processo ou a timeline completa.

## 1.9.59
- **NotificaÃ§Ãµes (Assinatura)**: corrigida duplicaÃ§Ã£o de notificaÃ§Ãµes/popups de assinatura; agora a assinatura gera **apenas 1 notificaÃ§Ã£o** (documento totalmente assinado), com dedupe por `request_id`.
- **Database (Trigger)**: trigger `notify_on_signature` tornado **idempotente** para evitar inserts duplicados ao concluir assinatura.
- **Build**: corrigido erro TypeScript (`TS18047: x is possibly 'null'`) no `PetitionEditorModule.tsx`.

## 1.9.58
- **Assinatura (PDF)**: atualizado o texto da **validade jurÃ­dica** (MP 2.200-2/2001) na pÃ¡gina de registro de assinatura do PDF, com redaÃ§Ã£o mais completa e formal.

## 1.9.57
- **Assinatura (OTP por E-mail)**: padronizadas as cores do fluxo (botÃµes e destaques) para o **tema laranja** do projeto.

## 1.9.56
- **Assinatura (OTP por E-mail)**: melhorado o **template do e-mail** (layout mais compatÃ­vel com clientes como Gmail/Outlook) e padronizado para as **cores do projeto**.
- **Assinatura (OTP por E-mail)**: melhorias visuais no modal de autenticaÃ§Ã£o (animaÃ§Ãµes/feedback de envio e validaÃ§Ã£o).

## 1.9.55
- **Assinatura (OTP por E-mail)**: ajustadas as Edge Functions para **nÃ£o retornarem status HTTP de erro** (sempre `200` com `{ success: false, error }`), evitando o erro genÃ©rico "Edge Function returned a non-2xx status code" no frontend.

## 1.9.54
- **Assinatura (OTP por E-mail)**: corrigida a etapa **â€œContinuar com E-mailâ€�** que ficava em branco no modal; incluÃ­da a renderizaÃ§Ã£o da etapa `email_otp`.

## 1.9.53
- **Assinatura (CÃ³digo por E-mail)**: adicionado novo mÃ©todo de autenticaÃ§Ã£o por **cÃ³digo via e-mail (OTP)** usando SMTP (Hostinger), com Edge Functions `email-send-otp` / `email-verify-otp` e persistÃªncia em `signature_email_otps`.

## 1.9.52
- **Preencher (ValidaÃ§Ã£o Telefone/WhatsApp)**: o campo de telefone/WhatsApp agora exige **11 dÃ­gitos** (DDD + 9) e nÃ£o permite avanÃ§ar com 10 dÃ­gitos.

## 1.9.51
- **Processos (Timeline Profissional)**: redesign completo da linha do tempo inline com cards individuais, layout limpo e espaÃ§ado, Ã­cones maiores, melhor hierarquia visual, badges refinados e botÃ£o de detalhes mais claro.

## 1.9.50
- **IntimaÃ§Ãµes (IA via Cron)**: desativada a anÃ¡lise de IA no frontend; o mÃ³dulo agora apenas exibe anÃ¡lises **salvas no banco** (geradas via Edge/Cron), evitando consumo repetido ao abrir.

## 1.9.49
- **Processos (IA Persistente)**: Edge Function `analyze-intimations` agora salva a anÃ¡lise tambÃ©m em `djen_comunicacoes.ai_analysis`, permitindo que a timeline consuma a anÃ¡lise do banco e reanalise **apenas** quando chegar nova movimentaÃ§Ã£o.

## 1.9.48
- **Processos (Timeline Inline)**: melhorias na linha do tempo no card: exibe **data completa + hora**, **Ã³rgÃ£o/tribunal**, permite **expandir detalhes** e inclui **botÃ£o de atualizar**; layout refinado e classes Tailwind ajustadas para evitar falhas de build.

## 1.9.47
- **Processos (Edge Function)**: nova Edge Function `update-process-status` para atualizaÃ§Ã£o automÃ¡tica de status dos processos via cron, sem necessidade de abrir o navegador.
- **Processos (Timeline Inline)**: linha do tempo agora Ã© exibida diretamente no card do processo (expansÃ­vel/recolhÃ­vel), sem necessidade de abrir modal.
- **Processos (Alerta Inteligente)**: sistema detecta e alerta quando um processo arquivado ainda possui prazos pendentes, exibindo notificaÃ§Ã£o visual no mÃ³dulo.
- **Processos (Timeline Desktop)**: ao clicar na linha da tabela, a timeline expande abaixo da linha ao invÃ©s de abrir modal.

## 1.9.45
- **Peticionamento (Blocos)**: removida a **numeraÃ§Ã£o automÃ¡tica** na listagem de blocos.

## 1.9.44
- **Peticionamento (Busca de Blocos)**: resultados agora exibem **todas as tags** e uma **porcentagem de match**; ao clicar em um item, abre o **View do bloco** com a opÃ§Ã£o **Adicionar no documento** (nÃ£o insere automaticamente).

## 1.9.43
- **Peticionamento (Busca de Blocos)**: busca refinada no modal (ignora stopwords como "de/da/do", suporta frase exata com aspas e aplica filtro/ranking mais estrito priorizando tÃ­tulo/tags, reduzindo resultados genÃ©ricos).

## 1.9.42
- **Peticionamento (PrÃ©-visualizaÃ§Ã£o de Blocos)**: container do `docx-preview` agora permanece montado durante o carregamento (com overlay), evitando fallback e garantindo renderizaÃ§Ã£o correta por **parÃ¡grafos/pÃ¡ginas**.

## 1.9.41
- **Peticionamento (PrÃ©-visualizaÃ§Ã£o de Blocos)**: ajustado CSS do `docx-preview` no modo *view* para restaurar **quebras de linha** e **espaÃ§amento entre parÃ¡grafos**, evitando texto "colado".

## 1.9.40
- **Peticionamento (PrÃ©-visualizaÃ§Ã£o de Blocos)**: visualizaÃ§Ã£o agora renderiza o conteÃºdo via **DOCX (gerado a partir do SFDT) + docx-preview**, garantindo exibiÃ§Ã£o do documento no modo *view* sem travar na geraÃ§Ã£o de PDF.

## 1.9.39
- **Peticionamento (PrÃ©-visualizaÃ§Ã£o de Blocos)**: tentativa inicial de renderizaÃ§Ã£o via PDF gerado a partir do SFDT.

## 1.9.38
- **Peticionamento (Editor de Blocos)**: botÃ£o de editar bloco reexibido na lista lateral (Ã­cone lÃ¡pis).
- **Peticionamento (Editor de Blocos)**: reforÃ§o visual A4 no modal (largura total, folha centralizada, sombra/borda) e altura do editor ampliada para 520px.
- **Peticionamento (Syncfusion)**: margens mÃ­nimas com dimensÃµes A4 aplicadas ao editor do modal para manter proporÃ§Ã£o real de pÃ¡gina.

## 1.9.36
- **Peticionamento (Editor de Blocos)**: restauradas declaraÃ§Ãµes de estado/refs do modal de blocos (corrige build e exibiÃ§Ã£o do editor).
- **Peticionamento (Syncfusion)**: corrigido ajuste de layout que usava `pageWidth` como string, evitando falha silenciosa na inicializaÃ§Ã£o do editor.

## 1.9.35
- **Peticionamento (Editor de Blocos)**: corrigido problema de largura reduzida do editor SFDT no modal. Removido layout grid que limitava a largura e adicionados CSS mais fortes para garantir 100% de ocupaÃ§Ã£o do espaÃ§o disponÃ­vel.

## 1.9.34
- **Peticionamento (Editor de Blocos)**: corrigido problema de largura reduzida do editor SFDT no modal. Agora o editor ocupa 100% da largura disponÃ­vel, eliminando o espaÃ§o em branco Ã  direita.

## 1.9.33
- **Peticionamento (Editor de Blocos)**: corrigido carregamento do conteÃºdo SFDT no modal de ediÃ§Ã£o de blocos. Agora o conteÃºdo Ã© carregado automaticamente quando o modal abre.
- **Peticionamento (PrÃ©-visualizaÃ§Ã£o)**: melhorada extraÃ§Ã£o de texto SFDT com suporte a quebras de parÃ¡grafo e fallback mais robusto.

## 1.9.32
- **Peticionamento (Tags Inteligentes)**: reformulada lÃ³gica de sugestÃ£o para ser estritamente baseada em termos jurÃ­dicos. O sistema agora ignora palavras aleatÃ³rias e foca em uma base de dados de mais de 100 termos e expressÃµes jurÃ­dicas (ex: "nexo causal", "estabilidade gestante", "litispendencia").
- **Peticionamento (SincronizaÃ§Ã£o)**: implementada detecÃ§Ã£o de mudanÃ§as no editor de blocos em tempo real, permitindo que as sugestÃµes de tags se adaptem instantaneamente ao texto que estÃ¡ sendo digitado.

## 1.9.31
- **Peticionamento (Tags Inteligentes)**: sistema de sugestÃ£o de tags agora Ã© 100% dinÃ¢mico, analisando o tÃ­tulo e conteÃºdo do bloco em tempo real para sugerir termos jurÃ­dicos relevantes.
- **Peticionamento (Editor de Blocos)**: corrigido problema onde o conteÃºdo aparecia espremido/com wrap excessivo nos modais; implementado `ResizeObserver` e ajuste automÃ¡tico de margens para garantir 100% de largura.
- **Peticionamento (PrÃ©-visualizaÃ§Ã£o)**: melhorada a extraÃ§Ã£o de texto de arquivos SFDT (Syncfusion) para evitar a mensagem "PrÃ©-visualizaÃ§Ã£o indisponÃ­vel".
- **Database**: migration para garantir a existÃªncia da coluna `order` na tabela `petition_blocks`, resolvendo erros 400 na API.

## 1.9.30
- **Peticionamento (Supabase/Erros)**: corrigido acesso ao usuÃ¡rio no service (getUser async) e leitura do modelo padrÃ£o com `maybeSingle()` para evitar 406 quando nÃ£o hÃ¡ registro; melhorada detecÃ§Ã£o de ausÃªncia da coluna `document_type` para evitar 400 repetidos.

## 1.9.29
- **Peticionamento (Modelo PadrÃ£o)**: migrado do localStorage para Supabase; agora o modelo Ã© salvo no banco e sincronizado entre dispositivos, com fallback para localStorage em caso de falha.
- **Database**: adicionada tabela `petition_default_templates` com RLS para armazenar modelo padrÃ£o por usuÃ¡rio.

## 1.9.27
- **Peticionamento (OtimizaÃ§Ã£o Supabase)**: salvamento instantÃ¢neo limitado (throttle) para evitar mÃºltiplos saves durante digitaÃ§Ã£o e refresh das petiÃ§Ãµes via realtime com debounce para reduzir leituras.

## 1.9.26
- **Peticionamento (Header)**: removido indicador visual do auto-salvamento e estabilizado layout para nÃ£o deslocar o chip do cliente quando o status "Atualizado" muda.
- **Build**: restaurado `package.json` (arquivo estava vazio), evitando quebra do projeto.

## 1.9.23
- **Peticionamento (HistÃ³rico/Recentes)**: abrir documento com 1 clique e indicador de carregamento "Abrindo..." com bloqueio durante a abertura.

## 1.9.22
- **Peticionamento (Online-only)**: editor passa para modo leitura quando offline e bloqueia salvamentos/ediÃ§Ãµes; adicionada proteÃ§Ã£o contra perda por navegaÃ§Ã£o (alerta ao sair e salvamento best-effort ao ocultar/fechar a aba).

## 1.9.21
- **Peticionamento (Salvamento)**: adicionado salvamento instantÃ¢neo (debounce) e autosave contÃ­nuo, com proteÃ§Ã£o para nÃ£o salvar durante carregamento e bloqueio de mÃºltiplos cliques ao abrir petiÃ§Ãµes (estado "Abrindo...").

## 1.9.20
- **Peticionamento (Auto-salvamento)**: corrigido bug onde o indicador ficava em "Auto-salvando em 30s" e nÃ£o executava o salvamento automÃ¡tico (timer estabilizado com refs e execuÃ§Ã£o via handler Ãºnico).

## 1.9.19
- **Peticionamento (Auto-salvamento)**: implementado salvamento automÃ¡tico a cada 30 segundos quando hÃ¡ alteraÃ§Ãµes nÃ£o salvas e cliente selecionado. Indicador visual mostra contador regressivo ("Auto-salvando em Xs") e status em tempo real.

## 1.9.18
- **Assinaturas â†” Requerimentos**: correÃ§Ã£o do vÃ­nculo automÃ¡tico do requerimento criado via assinatura (persistÃªncia do `signature_id` atÃ© o momento do salvar), garantindo exibiÃ§Ã£o do badge "Requerimento Criado".

## 1.9.17
- **Assinaturas â†” Requerimentos**: integraÃ§Ã£o automÃ¡tica - ao criar requerimento a partir da assinatura, o badge "Requerimento Criado" agora aparece automaticamente no card.

## 1.9.16
- **Assinaturas (Cards)**: indicadores visuais para processo e requerimento criados a partir da assinatura (badges coloridos nos cards).

## 1.9.15
- **Assinaturas (Detalhes)**: botÃµes "Abrir processo" e "Requerimento" agora em estilo de texto (sem fundo), com Ã­cones e hover effects, seguindo o padrÃ£o de links estilizados.

## 1.9.14
- **Assinaturas (Detalhes)**: botÃµes "Criar processo" e "Requerimento" agora mais compactos (padding reduzido, fonte menor e Ã­cones ajustados).

## 1.9.13
- **Assinaturas (Detalhes)**: ajuste fino nos botÃµes "Criar processo" e "Requerimento" para fundo mais claro (neutral-700), com bordas definidas e Ã­cones brancos, melhorando a definiÃ§Ã£o visual.

## 1.9.11
- **Assinaturas (Detalhes)**: fidelizaÃ§Ã£o total do design dos botÃµes "Criar processo" e "Requerimento" (fundo dark #333333, Ã­cones brancos e ajuste de pesos de fonte).

## 1.9.10
- **Assinaturas (Detalhes)**: refinamento final do design dos botÃµes de aÃ§Ã£o (Top e Bottom), garantindo que todos utilizem cantos `rounded-xl`, cores vibrantes e o novo padrÃ£o visual dark para aÃ§Ãµes secundÃ¡rias.

## 1.9.09
- **Assinaturas (Detalhes)**: botÃµes "Processo" e "Requerimento" agora utilizam fundo escuro e texto branco, seguindo o novo padrÃ£o visual de destaque secundÃ¡rio.

## 1.9.08
- **Assinaturas (Detalhes)**: refinamento do design das aÃ§Ãµes de Processo e Requerimento (botÃµes lado a lado com estilo modernizado).

## 1.9.07
- **Assinaturas (Detalhes)**: modal de detalhes mais compacto e aÃ§Ãµes de Processo/Requerimento reposicionadas abaixo dos botÃµes principais (mais discretas).

## 1.9.06
- **Assinaturas (Estabilidade)**: corrigido erro que quebrava o mÃ³dulo de Assinaturas (referÃªncia a `detailsRequest` antes da inicializaÃ§Ã£o).

## 1.9.05
- **Assinaturas (Detalhes)**: botÃ£o "Processo" agora abre fluxo de criaÃ§Ã£o quando nÃ£o hÃ¡ processo vinculado (status "Aguardando ConfecÃ§Ã£o" com seleÃ§Ã£o de Ã¡rea).

## 1.9.04
- **Assinaturas (Detalhes)**: quando nÃ£o hÃ¡ processo vinculado, agora permite selecionar a Ã¡rea e criar um Processo com status "Aguardando ConfecÃ§Ã£o".

## 1.9.03
- **Assinaturas (Detalhes)**: corrigido botÃ£o "Abrir processo" (fallback por nÃºmero do processo) e ajustes no layout dos botÃµes.

## 1.9.02
- **Assinaturas (Detalhes)**: apÃ³s assinar, adicionados atalhos para abrir o Processo vinculado e iniciar um Requerimento Administrativo (a confeccionar).

## 1.9.01
- **Assinatura (Login Google)**: ajustado selo "Recomendado" para nÃ£o sobrepor o botÃ£o do Google.

## 1.9.00
- **Assinatura (Login Google)**: adicionado selo "Recomendado" na opÃ§Ã£o "Fazer Login com o Google".

## 1.8.99
- **Assinatura (PDF)**: ajustada escala da assinatura para 1.5x (meio termo entre muito pequena e muito grande).

## 1.8.98
- **Assinatura (DOCX)**: corrigido problema onde documentos DOCX assinados mostravam apenas o relatÃ³rio de assinatura; agora gera o documento completo com a assinatura.

## 1.8.97
- **Assinatura (PDF)**: corrigido tamanho excessivo da assinatura no documento final; removida escala 2x que causava assinaturas muito grandes.

## 1.8.96
- **Editor de PetiÃ§Ãµes (Recentes)**: adicionado botÃ£o de excluir em cada item da lista de Recentes com confirmaÃ§Ã£o via modal de cÃ¡lculo.
- **Clientes (Detalhes)**: adicionada seÃ§Ã£o "PetiÃ§Ãµes vinculadas" com opÃ§Ã£o de abrir e excluir petiÃ§Ãµes do cliente.

## 1.8.95
- **Editor de PetiÃ§Ãµes (Documento padrÃ£o)**: melhoria na persistÃªncia; quando o navegador nÃ£o consegue salvar (armazenamento cheio), o sistema avisa e mantÃ©m fallback em memÃ³ria para a sessÃ£o.

## 1.8.94
- **Editor de PetiÃ§Ãµes (Documento padrÃ£o)**: ao importar um arquivo Word, o documento passa a ser salvo como "Documento padrÃ£o", permitindo que "Novo â†’ Documento padrÃ£o" carregue o template selecionado.

## 1.8.93
- **Clientes (Detalhes)**: seÃ§Ã£o "Documentos/Contratos assinados" agora exibe item "Vinculado" e organiza documentos em "Assinados" e "Gerados", com mensagem de vazio exibida abaixo.

## 1.8.92
- **Editor de PetiÃ§Ãµes (Tela Inicial)**: corrigido o atalho "Novo â†’ Documento padrÃ£o" para carregar o template cadastrado (aguarda editor estar pronto e evita falha silenciosa).

## 1.8.91
- **Editor de PetiÃ§Ãµes (Tela Inicial)**: ajuste na exibiÃ§Ã£o do nome do usuÃ¡rio para capitalizaÃ§Ã£o correta (ex.: "Pedro" em vez de "pedro").

## 1.8.90
- **Editor de PetiÃ§Ãµes (Salvamento)**: salvamento (manual e automÃ¡tico) permitido apenas com cliente vinculado; documentos antigos sem vÃ­nculo sÃ£o removidos automaticamente.
- **Editor de PetiÃ§Ãµes (Tela Inicial)**: botÃ£o "Documento padrÃ£o" em "Novo" volta a carregar corretamente o template.
- **Editor de PetiÃ§Ãµes (Tela Inicial)**: saudaÃ§Ã£o passa a exibir o nome do usuÃ¡rio logado.

## 1.8.89
- **Editor de PetiÃ§Ãµes (Recentes)**: corrigido bug onde mÃºltiplos cliques ao abrir um documento recente podiam carregar vazio e disparar salvamento automÃ¡tico em branco.
- **Editor de PetiÃ§Ãµes (Tela Inicial)**: renomeado atalho "Modelo" para "Documento padrÃ£o".

## 1.8.88
- **Editor de PetiÃ§Ãµes (Tela Inicial)**: adicionados atalhos "Modelo" e "Importar arquivo" em "Novo".
- **Editor de PetiÃ§Ãµes (Recentes)**: confirmaÃ§Ã£o de exclusÃ£o agora mostra detalhes (documento/cliente/total) como nos demais mÃ³dulos.

## 1.8.87
- **Editor de PetiÃ§Ãµes (Tela Inicial)**: exibe nome do usuÃ¡rio logado (sem e-mail), adiciona botÃµes de minimizar/fechar (widget) e mostra Recentes com arquivo + cliente vinculado.

## 1.8.86
- **Editor de PetiÃ§Ãµes (Salvamento)**: documentos passam a ser salvos apenas quando hÃ¡ cliente vinculado (autosave e salvar manual).
- **Editor de PetiÃ§Ãµes (Recentes)**: adicionada aÃ§Ã£o para excluir todos os documentos salvos e listagem de recentes agora considera apenas itens com cliente.

## 1.8.85
- **Editor de PetiÃ§Ãµes (UI)**: tela inicial (abertura) remodelada em estilo Word (Novo/Recentes) e exibiÃ§Ã£o do nome do usuÃ¡rio.

## 1.8.84
- **Editor de PetiÃ§Ãµes (Blocos)**: cabeÃ§alho agora Ã© inserido sem numeraÃ§Ã£o (sem prefixo "1 - "), mantendo o cabeÃ§alho limpo.

## 1.8.83
- **Editor de PetiÃ§Ãµes (Blocos)**: corrigido erro 400 ao listar blocos no Supabase (coluna `order` agora Ã© referenciada corretamente na ordenaÃ§Ã£o).
- **Editor de PetiÃ§Ãµes (Syncfusion)**: mitigados crashes/intermitÃªncias do ruler/selection quando o documento ainda nÃ£o estÃ¡ inicializado.
- **Editor de PetiÃ§Ãµes (Blocos/Performance)**: placeholders do cliente passam a ser processados antes da inserÃ§Ã£o (sem `replaceAll` no editor principal), reduzindo travamento/lag apÃ³s inserir bloco.

## 1.8.82
- **Editor de PetiÃ§Ãµes (Performance)**: soluÃ§Ã£o definitiva para o travamento de digitaÃ§Ã£o apÃ³s inserir bloco. Agora os dados do cliente (placeholders) sÃ£o substituÃ­dos diretamente no cÃ³digo (SFDT) antes da colagem, eliminando 12 operaÃ§Ãµes pesadas de substituiÃ§Ã£o no editor que congelavam a interface.
- **Editor de PetiÃ§Ãµes (UI)**: reforÃ§ado estado editÃ¡vel e atualizaÃ§Ã£o de layout (repaint) no foco do editor.

## 1.8.81
- **Editor de PetiÃ§Ãµes (Blocos)**: simplificado mecanismo de foco apÃ³s inserir bloco para resolver bug de ediÃ§Ã£o travada (focusIn + moveToDocumentEnd).

## 1.8.80
- **Editor de PetiÃ§Ãµes (Blocos)**: foco do editor agora forÃ§a atualizaÃ§Ã£o/repaint do viewer apÃ³s inserir bloco, evitando precisar rolar a pÃ¡gina para o texto digitado aparecer.

## 1.8.79
- **Editor de PetiÃ§Ãµes (Blocos)**: corrigido travamento/atraso de digitaÃ§Ã£o apÃ³s inserir bloco, executando as substituiÃ§Ãµes (placeholders do cliente) de forma assÃ­ncrona e fatiada.

## 1.8.78
- **Editor de PetiÃ§Ãµes (Blocos)**: numeraÃ§Ã£o automÃ¡tica (1 - , 2 - , etc.) agora Ã© inserida antes do conteÃºdo do bloco.
- **Editor de PetiÃ§Ãµes (Blocos)**: corrigido bug de digitaÃ§Ã£o travada/lenta apÃ³s inserir bloco (foco melhorado com mÃºltiplas tentativas).

## 1.8.77
- **Editor de PetiÃ§Ãµes (Blocos)**: numeraÃ§Ã£o/ordem dos blocos voltou a aparecer na lista.
- **Editor de PetiÃ§Ãµes (Blocos)**: apÃ³s inserir um bloco, o foco retorna ao editor para permitir ediÃ§Ã£o imediata.

## 1.8.76
- **Editor de PetiÃ§Ãµes (Toolbar)**: removido item `Break` da toolbar.

## 1.8.75
- **Editor de PetiÃ§Ãµes (Toolbar/Layout)**: toolbar volta com itens de aÃ§Ã£o (header/footer/page setup/page number/TOC/bookmark/break) e agora nÃ£o quebra linha; usa scroll horizontal interno para preservar a altura e aumentar a Ã¡rea de ediÃ§Ã£o.

## 1.8.74
- **Editor de PetiÃ§Ãµes (Toolbar/Layout)**: removida a formataÃ§Ã£o de texto da toolbar (mantida apenas no painel lateral TEXT) e toolbar enxugada para evitar empurrar/afastar o documento.

## 1.8.73
- **Editor de PetiÃ§Ãµes (Toolbar/Layout)**: removidos itens nÃ£o essenciais da toolbar (page setup/number, comentÃ¡rios, track changes, restrict editing, campos, bookmark/TOC etc.) para reduzir largura e evitar que o documento seja empurrado/afastado.

## 1.8.72
- **Editor de PetiÃ§Ãµes (Toolbar)**: corrigido crash do Syncfusion ao adicionar botÃµes de formataÃ§Ã£o; itens de formataÃ§Ã£o agora sÃ£o botÃµes custom com aÃ§Ã£o via `toolbarClick` (negrito/itÃ¡lico/sublinhado e alinhamento).

## 1.8.71
- **Editor de PetiÃ§Ãµes (Toolbar)**: adicionadas opÃ§Ãµes de formataÃ§Ã£o diretamente na barra superior (negrito/itÃ¡lico/sublinhado, fonte/tamanho, cor/highlight, alinhamento, listas, indentaÃ§Ã£o e espaÃ§amento).

## 1.8.70
- **Editor de PetiÃ§Ãµes (UI)**: toolbar ultra-compacta (altura 22px, Ã­cones 12px, padding mÃ­nimo) para caber em 100% de zoom sem precisar reduzir.

## 1.8.69
- **Editor de PetiÃ§Ãµes (UI)**: toolbar superior compactada (aprox. metade) com botÃµes menores e labels ocultos (mantendo Ã­cones), para caber melhor em 100% de zoom.

## 1.8.68
- **Editor de PetiÃ§Ãµes (UI)**: toolbar superior do editor (Syncfusion) ajustada para nÃ£o compactar em 100% de zoom, permitindo quebra em mÃºltiplas linhas (wrap) e altura automÃ¡tica.

## 1.8.67
- **Editor de PetiÃ§Ãµes (UI)**: painel de formataÃ§Ã£o (TEXT) agora possui modo colapsado (aba fina), expandindo ao passar o mouse e com botÃ£o para fixar aberto/fechado.

## 1.8.66
- **Editor de PetiÃ§Ãµes (UI)**: painel de formataÃ§Ã£o (TEXT) reduzido ainda mais para caber melhor em 100% de zoom (padrÃ£o ~180px, mÃ­nimo 160px).

## 1.8.65
- **Editor de PetiÃ§Ãµes (UI)**: ajustados os limites do painel de formataÃ§Ã£o (TEXT) para manter "metade" da largura com usabilidade (padrÃ£o ~220px, mÃ­nimo 180px) e evitar painel estreito demais.

## 1.8.64
- **Editor de PetiÃ§Ãµes (UI)**: painel de formataÃ§Ã£o (TEXT) reduzido para aproximadamente metade da largura para melhorar a visualizaÃ§Ã£o da folha em 100% de zoom.
- **Editor de PetiÃ§Ãµes (UI)**: reset do tamanho antigo do painel (chave do `localStorage` atualizada) para garantir que a nova largura padrÃ£o seja aplicada.

## 1.8.63
- **Editor de PetiÃ§Ãµes (Layout 100% Zoom - CorreÃ§Ã£o Definitiva)**: reescrito CSS do editor com estrutura flexbox correta para funcionar em 100% de zoom:
  - **DiagnÃ³stico**: O problema era causado por `min-width` implÃ­cito nos containers flex do Syncfusion e o Navigation Pane ativo criando gap Ã  esquerda
  - **SoluÃ§Ã£o**: 
    - Wrapper com `flex: 1 1 0%` e `min-width: 0` para permitir encolhimento
    - Container principal com `max-width: 100%` e `overflow: hidden`
    - Viewer com `flex: 1 1 auto` e `min-width: 0` para caber no espaÃ§o disponÃ­vel
    - Properties Pane com largura responsiva (320px â†’ 260px conforme resoluÃ§Ã£o)
    - Navigation Pane desabilitado via prop e CSS
  - **Resultado**: Editor totalmente utilizÃ¡vel em 100% zoom sem scroll horizontal, com folha centralizada e painel TEXT sempre acessÃ­vel
  - Testado para resoluÃ§Ãµes: 1366px, 1440px, 1920px

## 1.8.62
- **Editor de PetiÃ§Ãµes (Layout Definitivo 100% Zoom)**: corrigido conflito de CSS com layout nativo do Syncfusion. O editor agora funciona perfeitamente em 100% de zoom sem hacks:
  - Folha alinhada naturalmente Ã  esquerda (prÃ³xima ao painel de blocos)
  - Painel de formataÃ§Ã£o (TEXT) sempre visÃ­vel e acessÃ­vel Ã  direita
  - Sem scroll horizontal desnecessÃ¡rio
  - Responsividade automÃ¡tica para diferentes resoluÃ§Ãµes (1366/1440/1920px)
  - CSS limpo que respeita o gerenciamento de layout interno do Syncfusion

## 1.8.59
- **Editor de PetiÃ§Ãµes (Layout Final)**: corrigida usabilidade em 100% zoom. A folha agora fica alinhada Ã  esquerda (perto dos blocos) e o painel de formataÃ§Ã£o (TEXT) permanece fixo e visÃ­vel Ã  direita, sem ser empurrado para fora da tela.

## 1.8.58
- **Editor de PetiÃ§Ãµes (Layout/Zoom 100%)**: ajustado flex do Syncfusion para manter painel de formataÃ§Ã£o acessÃ­vel em 100% e aproximar a folha do painel de blocos (sem precisar reduzir zoom).

## 1.8.57
- **Editor de PetiÃ§Ãµes (Layout/Usabilidade)**: removidos overrides de CSS que desbalanceavam a visualizaÃ§Ã£o em 100% e garantido painel de formataÃ§Ã£o do Syncfusion visÃ­vel (fonte, tamanho, etc).

## 1.8.56
- **Editor de PetiÃ§Ãµes (Layout)**: folha alinhada Ã  esquerda (junto ao painel de blocos) + painel de formataÃ§Ã£o (fonte, tamanho, etc) visÃ­vel Ã  direita.

## 1.8.55
- **Editor de PetiÃ§Ãµes (UI)**: restaurado painel de formataÃ§Ã£o (Properties Pane) do Syncfusion no lado direito apÃ³s ajuste de alinhamento da folha.

## 1.8.54
- **Editor de PetiÃ§Ãµes (Layout)**: ajuste fino para ficar exatamente como antes (folha mais prÃ³xima do painel, removida centralizaÃ§Ã£o excessiva do canvas).

## 1.8.53
- **Editor de PetiÃ§Ãµes (Layout)**: ajustado alinhamento da folha no Syncfusion para ficar mais Ã  direita (mais prÃ³ximo do painel lateral), reduzindo espaÃ§o vazio.

## 1.8.52
- **Editor de PetiÃ§Ãµes**: corrigido erro "Editor nÃ£o disponÃ­vel" ao carregar petiÃ§Ã£o da tela inicial (agora carrega conteÃºdo apÃ³s editor estar pronto).

## 1.8.51
- **Editor de PetiÃ§Ãµes**: corrigidos erros de compilaÃ§Ã£o e restauradas funÃ§Ãµes essenciais (savePetition, loadPetition, newPetition, insertBlock, deleteBlock, saveBlock, exportToWord, handleImportTemplate).
- **Editor de PetiÃ§Ãµes - Realtime**: lista "Recentes" atualiza automaticamente a cada 15s (tick) e via Supabase Realtime (postgres_changes).
- **Editor de PetiÃ§Ãµes - Save**: update otimista ao salvar - lista "Recentes" reflete imediatamente sem precisar F5.

## 1.8.50
- **Editor de PetiÃ§Ãµes - Blocos**: corrigida numeraÃ§Ã£o automÃ¡tica "N â€“" ao inserir blocos (agora incrementa corretamente: 1, 2, 3... e reseta ao criar/carregar documento).

## 1.8.49
- **Editor de PetiÃ§Ãµes - Blocos**: inserÃ§Ã£o de blocos agora respeita a posiÃ§Ã£o atual do cursor (nÃ£o altera seleÃ§Ã£o ao calcular numeraÃ§Ã£o e nÃ£o forÃ§a mover o cursor para o fim).

## 1.8.48
- **Editor de PetiÃ§Ãµes - Blocos**: numeraÃ§Ã£o automÃ¡tica "N â€“" ao inserir blocos agora ignora a categoria "cabecalho".

## 1.8.47
- **Editor de PetiÃ§Ãµes - Blocos**: ao inserir um bloco no editor, agora Ã© adicionado automaticamente um prefixo com numeraÃ§Ã£o no formato "N â€“" (ex.: "1 â€“ ", "2 â€“ ").

## 1.8.46
- **Editor de PetiÃ§Ãµes - Blocos (Tags)**: tags ficaram mais inteligentes, priorizando expressÃµes jurÃ­dicas (ex.: "acumulo de funcao", "aviso previo cumprido") e melhorando o fallback quando IA nÃ£o retornar boas tags.

## 1.8.45
- **Editor de PetiÃ§Ãµes - Blocos**: reduzidas requisiÃ§Ãµes 400 repetidas quando `document_type` ainda nÃ£o existe no banco (service desativa automaticamente o uso do filtro apÃ³s detectar PGRST204).

## 1.8.44
- **Editor de PetiÃ§Ãµes - Blocos**: `createBlock` agora tem fallback quando a coluna `document_type` ainda nÃ£o existe no banco (evita erro PGRST204/400 e permite criar blocos atÃ© aplicar a migration).

## 1.8.43
- **Editor de PetiÃ§Ãµes - Blocos (Sidebar)**: categorias agora iniciam recolhidas (fechadas) por padrÃ£o.

## 1.8.42
- **Editor de PetiÃ§Ãµes - Categorias de Blocos**: corrigida migration de categorias (erro SQL 42601 por conflito de dollar-quote em `DO $$`).
- **Editor de PetiÃ§Ãµes - UX**: confirmaÃ§Ãµes de "alteraÃ§Ãµes nÃ£o salvas" agora informam qual documento/cliente estÃ¡ pendente antes de continuar.

## 1.8.41
- **Editor de PetiÃ§Ãµes - Categorias de Blocos**: categorias agora sÃ£o configurÃ¡veis por tipo de documento (petiÃ§Ã£o/contestaÃ§Ã£o/impugnaÃ§Ã£o/recurso), com persistÃªncia no banco.
- **Editor de PetiÃ§Ãµes - Categorias de Blocos**: adicionada tela/modal "Configurar categorias" para editar nomes e ordem das seÃ§Ãµes exibidas na sidebar.
- **Editor de PetiÃ§Ãµes - Categorias de Blocos**: removida restriÃ§Ã£o rÃ­gida (CHECK) de `petition_blocks.category` para permitir categorias diferentes por tipo.

## 1.8.40
- **Editor de PetiÃ§Ãµes - Blocos**: blocos agora sÃ£o separados por tipo de documento (petiÃ§Ã£o/contestaÃ§Ã£o/impugnaÃ§Ã£o/recurso) via campo `document_type` e filtro na interface.

## 1.8.39
- **Editor de PetiÃ§Ãµes - Blocos (Sidebar)**: busca "Buscar bloco..." agora filtra por tags/tÃ­tulo/conteÃºdo e aceita mÃºltiplos termos separados por vÃ­rgula.
- **Editor de PetiÃ§Ãµes - Blocos (Sidebar)**: tags do bloco passam a ser exibidas abaixo do tÃ­tulo.

## 1.8.38
- **Editor de PetiÃ§Ãµes - Blocos**: corrigido modal "Visualizar ConteÃºdo" (evita tela em branco aguardando o editor inicializar e usando fallback para texto quando necessÃ¡rio).
- **Editor de PetiÃ§Ãµes - Blocos**: tags agora aparecem na lista de blocos e sÃ£o derivadas automaticamente para blocos antigos sem tags persistidas.
- **Editor de PetiÃ§Ãµes - Blocos**: fallback de palavras-chave melhorado quando IA estiver indisponÃ­vel (extraÃ§Ã£o bÃ¡sica a partir de tÃ­tulo+conteÃºdo).

## 1.8.37
- **Editor de PetiÃ§Ãµes - Blocos**: adicionadas palavras-chave (tags) automÃ¡ticas para facilitar encontrar blocos por contexto (ex.: "horas extras, rescisÃ£o indireta"), com geraÃ§Ã£o via IA quando habilitada e fallback heurÃ­stico.
- **Editor de PetiÃ§Ãµes - Blocos**: busca agora considera tÃ­tulo + conteÃºdo + tags e aceita mÃºltiplos termos separados por vÃ­rgula.

## 1.8.36
- **Editor de PetiÃ§Ãµes - Blocos/Clientes**: seÃ§Ã£o "qualificaÃ§Ã£o" foi renomeada na interface para "DAS QUESTÃ•ES INICIAIS".

## 1.8.35
- **Editor de PetiÃ§Ãµes - Blocos**: melhorada performance apÃ³s inserir bloco formatado (placeholders sÃ£o substituÃ­dos no fragmento antes de colar, evitando replaceAll global que gerava lentidÃ£o).

## 1.8.34
- **Editor de PetiÃ§Ãµes - Blocos**: inserÃ§Ã£o de blocos volta a preservar formataÃ§Ã£o usando conversÃ£o segura de SFDT para fragmento antes de colar no editor (fallback para texto quando necessÃ¡rio).

## 1.8.33
- **Editor de PetiÃ§Ãµes - EndereÃ§amento**: ao selecionar/inserir qualificaÃ§Ã£o do cliente, preenche automaticamente "DA COMARCA DE" com cidade-UF quando estiver em branco.

## 1.8.32
- **Editor de PetiÃ§Ãµes - Buscar Empresa (CNPJ)**: ao inserir no editor, o nome da empresa (fantasia/razÃ£o social) Ã© aplicado em negrito real.

## 1.8.31
- **Editor de PetiÃ§Ãµes - Buscar Empresa (CNPJ)**: qualificaÃ§Ã£o ajustada (e-mail em minÃºsculo, telefones deduplicados e rÃ³tulo 'telefones' quando houver mais de um).

## 1.8.30
- **Editor de PetiÃ§Ãµes - Buscar Empresa (CNPJ)**: consulta BrasilAPI + OpenCNPJ e usa IA para compilar/normalizar os dados (ex.: e-mail pode vir de uma fonte e nÃ£o da outra).

## 1.8.29
- **Editor de PetiÃ§Ãµes - Clientes**: qualificaÃ§Ã£o agora insere o nome do cliente em negrito real (sem '**' literal).

## 1.8.28
- **Editor de PetiÃ§Ãµes - Blocos**: endurecida extraÃ§Ã£o de texto do SFDT (inclui 'tlp') para evitar inserÃ§Ã£o de JSON/SFDT cru no editor.
- **Editor de PetiÃ§Ãµes - Blocos**: modal 'Visualizar ConteÃºdo' evita exibir JSON cru e mostra mensagem quando nÃ£o for possÃ­vel gerar preview.

## 1.8.27
- **Editor de PetiÃ§Ãµes - Blocos**: melhorada extraÃ§Ã£o de texto de SFDT (inclui chave 'tlp') para evitar inserÃ§Ã£o de JSON cru.
- **Editor de PetiÃ§Ãµes - Blocos**: modal 'Visualizar ConteÃºdo' exibe mensagem quando nÃ£o for possÃ­vel gerar preview.

## 1.8.26
- **Editor de PetiÃ§Ãµes - Blocos**: corrigido bug crÃ­tico onde pasteSfdt corrompia o estado do editor Syncfusion causando erros em cascata. Agora blocos sÃ£o inseridos como texto puro para maior estabilidade.

## 1.8.25
- **Editor de PetiÃ§Ãµes - Blocos**: corrigido bug onde bloco era inserido no topo do documento em vez de na posiÃ§Ã£o do cursor.
- **Editor de PetiÃ§Ãµes - Blocos**: melhorado foco no elemento editÃ¡vel apÃ³s inserir bloco para permitir digitaÃ§Ã£o imediata.

## 1.8.24
- **Editor de PetiÃ§Ãµes - Blocos/Clientes**: corrigido bug onde texto digitado ficava em buffer invisÃ­vel e sÃ³ aparecia apÃ³s colar (forÃ§ado resize do editor para re-render).

## 1.8.23
- **Editor de PetiÃ§Ãµes - Blocos/Clientes**: corrigido bug onde apÃ³s inserir bloco o editor aceitava colar mas nÃ£o aceitava digitaÃ§Ã£o direta (forÃ§ado foco no elemento editÃ¡vel interno).

## 1.8.22
- **Editor de PetiÃ§Ãµes - Blocos/Clientes**: apÃ³s inserir bloco ou qualificaÃ§Ã£o, o cursor Ã© movido para o final do conteÃºdo inserido, permitindo digitar imediatamente.

## 1.8.21
- **Editor de PetiÃ§Ãµes - Blocos/Clientes**: apÃ³s inserir bloco ou qualificaÃ§Ã£o do cliente, o foco volta automaticamente para o editor para permitir ediÃ§Ã£o imediata.

## 1.8.20
- **Editor de PetiÃ§Ãµes - Blocos**: modal 'Visualizar ConteÃºdo' agora exibe fallback em texto quando o Syncfusion renderiza em branco.

## 1.8.19
- **Editor de PetiÃ§Ãµes - Blocos**: melhorada extraÃ§Ã£o de texto do SFDT para preview no modal 'Adicionar Bloco'.
- **Editor de PetiÃ§Ãµes - Blocos**: corrigido modal 'Visualizar ConteÃºdo' abrindo em branco (fallback para texto quando necessÃ¡rio).

## 1.8.18
- **Editor de PetiÃ§Ãµes - Toolbar**: botÃ£o de abrir/fechar painel agora usa Ã­cones de painel (mais distinto do botÃ£o de voltar).
- **Editor de PetiÃ§Ãµes - Blocos**: corrigido preview no modal 'Adicionar Bloco' para evitar exibir SFDT/JSON cru.

## 1.8.17
- **Editor de PetiÃ§Ãµes - UI**: corrigido problema onde a interface do Syncfusion estava sobrepondo a toolbar e a sidebar (Blocos/Clientes).

## 1.8.16
- **Editor de PetiÃ§Ãµes - Tela inicial**: adicionado botÃ£o 'Excluir temporÃ¡rios' para deletar em lote petiÃ§Ãµes sem vinculaÃ§Ã£o com cliente, com confirmaÃ§Ã£o e feedback.

## 1.8.15
- **Editor de PetiÃ§Ãµes - Tela inicial**: adicionado botÃ£o de deletar (lixeira) na lista de documentos recentes, com confirmaÃ§Ã£o e efeito hover.

## 1.8.14
- **Editor de PetiÃ§Ãµes - Auto-save**: salvamento automÃ¡tico agora sÃ³ ocorre quando a petiÃ§Ã£o estÃ¡ vinculada a um cliente.
- **Editor de PetiÃ§Ãµes - Sidebar**: removida a aba "Salvos".
- **Editor de PetiÃ§Ãµes - Toolbar**: botÃµes de minimizar/fechar do widget movidos para o lado direito.

## 1.8.13
- **Editor de PetiÃ§Ãµes - Toolbar**: adicionado botÃ£o 'Voltar para a tela inicial' com Ã­cone ArrowLeft para retornar Ã  start screen (com aviso se houver alteraÃ§Ãµes nÃ£o salvas).

## 1.8.12
- **Editor de PetiÃ§Ãµes - Tela inicial**: botÃ£o X agora fecha o editor inteiro (widget), nÃ£o apenas a tela inicial.

## 1.8.11
- **Editor de PetiÃ§Ãµes - Tela inicial**: adicionado botÃ£o X ao lado de "Ir para o editor" para fechar a tela inicial.

## 1.8.10
- **Editor de PetiÃ§Ãµes - Widget Flutuante**: ao minimizar, o editor agora permanece montado (oculto) para preservar o documento aberto; ao reabrir pelo botÃ£o flutuante, retorna ao mesmo documento em vez de voltar para a tela inicial.

## 1.8.9
- **Editor de PetiÃ§Ãµes - Widget Flutuante**: removido o painel flutuante de controles (minimizar/fechar) no canto superior direito para evitar sobreposiÃ§Ã£o na interface; controles permanecem na toolbar do editor.

## 1.8.8
- **Editor de PetiÃ§Ãµes - Tela inicial**: ao criar "Documento em branco" ou aplicar "Modelo padrÃ£o", mantÃ©m o cliente vinculado quando o editor Ã© aberto a partir de um cliente.
- **Editor de PetiÃ§Ãµes - Widget Flutuante**: ajustado espaÃ§amento da tela inicial para nÃ£o ficar por baixo dos botÃµes de minimizar/fechar.

## 1.8.7
- **Editor de PetiÃ§Ãµes - Widget Flutuante**: removida a barra superior do widget (nav), mantendo apenas botÃµes flutuantes de minimizar/fechar.
- **Editor de PetiÃ§Ãµes**: adicionada tela inicial estilo Word ao abrir o editor (modelos + recentes), para iniciar documento em branco, aplicar modelo padrÃ£o ou abrir recente.

## 1.8.6
- **Editor de PetiÃ§Ãµes - Widget Flutuante**: header agora exibe "Ãšltima atualizaÃ§Ã£o" (hÃ¡ X) e "Cliente vinculado" do documento aberto.
- **Editor de PetiÃ§Ãµes - Lista de Salvos**: documentos agora mostram tempo relativo de modificaÃ§Ã£o (hÃ¡ X) e cliente vinculado.

## 1.8.5
- **Editor de PetiÃ§Ãµes - Widget Flutuante**: corrigido minimizar para ocultar totalmente o overlay, mantendo apenas o botÃ£o flutuante "Editor de PetiÃ§Ãµes".

## 1.8.4
- **Editor de PetiÃ§Ãµes - Widget Flutuante**: o editor agora funciona como um widget flutuante global que pode ser aberto de qualquer mÃ³dulo sem trocar de rota.
- **Editor de PetiÃ§Ãµes - PersistÃªncia**: estado do widget (aberto/minimizado) e contexto do documento sÃ£o persistidos em localStorage, restaurando automaticamente apÃ³s refresh da pÃ¡gina.
- **Editor de PetiÃ§Ãµes - IntegraÃ§Ã£o com Clientes**: botÃ£o "Nova PetiÃ§Ã£o" adicionado nas aÃ§Ãµes rÃ¡pidas da ficha do cliente, abrindo o editor jÃ¡ vinculado ao cliente selecionado.
- **Editor de PetiÃ§Ãµes - Minimizar**: ao minimizar, o editor vira um botÃ£o flutuante no canto inferior direito, permitindo continuar trabalhando em outros mÃ³dulos.
- **UX**: sidebar nÃ£o mais oculta ao abrir o editor; navegaÃ§Ã£o permanece visÃ­vel e funcional.

## 1.8.3
- **Editor de PetiÃ§Ãµes**: corrigido erro de build causado por JSX corrompido/duplicado na seÃ§Ã£o dos modais (Empresa/Blocos).
- **Editor de PetiÃ§Ãµes**: modais de Empresa/Busca de Bloco/Editor de Bloco reestruturados e estabilizados para evitar conflitos com CSS global (botÃµes e layout).

## 1.8.2
- **Editor de PetiÃ§Ãµes**: busca de empresa por CNPJ agora usa BrasilAPI (dados completos) + OpenCNPJ (complemento, como e-mail) e refina a qualificaÃ§Ã£o via IA quando configurada.

## 1.8.1
- **Editor de PetiÃ§Ãµes**: modais alinhados ao tema do sistema (faixa laranja no topo, tipografia e botÃµes em gradiente).

## 1.8.0
- **Editor de PetiÃ§Ãµes**: modais de "Buscar Empresa" e "Adicionar Bloco" adequados ao tema do sistema (header/footer, botÃµes e inputs padronizados).
- **Editor de PetiÃ§Ãµes**: corrigido render do modal de busca de blocos (empty state vs lista de resultados).

## 1.7.9
- **Editor de PetiÃ§Ãµes**: qualificaÃ§Ã£o de empresa (CNPJ) agora identifica tipo de logradouro (Rua/Avenida/etc.) e ajusta o texto automaticamente ("na Rua...", "na Avenida...").

## 1.7.8
- **Editor de PetiÃ§Ãµes**: qualificaÃ§Ã£o de empresa (CNPJ) agora usa logradouro completo (ex.: "Avenida") e melhor formataÃ§Ã£o de cidade/CEP.
- **Editor de PetiÃ§Ãµes**: corrigido erro de auto-save em `saved_petitions` (406 / "Cannot coerce...") tornando o update tolerante quando o retorno nÃ£o vem como objeto Ãºnico.

## 1.7.7
- **Editor de PetiÃ§Ãµes**: adicionada opÃ§Ã£o "Buscar empresa..." no menu de contexto (CNPJ) que consulta `api.opencnpj.org`, formata a qualificaÃ§Ã£o e insere no cursor.

## 1.7.6
- **Editor de PetiÃ§Ãµes**: correÃ§Ã£o de timing na inicializaÃ§Ã£o do Syncfusion para garantir carregamento automÃ¡tico do modelo padrÃ£o (fila de aÃ§Ãµes antes do `created`).

## 1.7.5
- **Editor de PetiÃ§Ãµes**: ao abrir o mÃ³dulo, o modelo padrÃ£o (DOCX) Ã© carregado automaticamente (sem sobrescrever petiÃ§Ãµes jÃ¡ carregadas).

## 1.7.4
- **Editor de PetiÃ§Ãµes**: adicionado modelo padrÃ£o (DOCX) com logo/rodapÃ©: ao importar em "Modelo" o arquivo Ã© salvo como padrÃ£o e pode ser aplicado via botÃ£o "PadrÃ£o".

## 1.7.3
- **Editor de PetiÃ§Ãµes**: view de bloco ajustado para modo leitura (Syncfusion) escondendo barra inferior de pÃ¡gina/zoom.

## 1.7.2
- **Editor de PetiÃ§Ãµes**: visualizaÃ§Ã£o de conteÃºdo do bloco agora usa Syncfusion (renderizaÃ§Ã£o SFDT) em modo somente leitura.

## 1.7.1
- **Editor de PetiÃ§Ãµes**: adicionada opÃ§Ã£o de visualizar o conteÃºdo do bloco (modal read-only) diretamente na lista da sidebar.

## 1.7.0
- **Editor de PetiÃ§Ãµes**: corrigido colar do Microsoft Word (evitava atualizar e colava conteÃºdo antigo) desabilitando `enableLocalPaste`/`LocalClipboard` para forÃ§ar uso do clipboard do sistema.

## 1.6.9
- **Editor de PetiÃ§Ãµes**: atalho `Alt+EspaÃ§o` abre busca de blocos.
- **Editor de PetiÃ§Ãµes**: busca de blocos agora Ã© tolerante a erro de digitaÃ§Ã£o (fuzzy) e ordena por relevÃ¢ncia (prioriza tÃ­tulo).

## 1.6.8
- **Editor de PetiÃ§Ãµes**: adicionada opÃ§Ã£o de excluir bloco diretamente na lista da sidebar.

## 1.6.7
- **Editor de PetiÃ§Ãµes**: corrigido colar conteÃºdo externo (Ctrl+V) no Syncfusion garantindo `id` Ãºnico por instÃ¢ncia de editor (evita conflitos entre editor principal e modal).

## 1.6.6
- **Editor de PetiÃ§Ãµes**: sidebar de Blocos organizado por seÃ§Ã£o (hierarquia) em ordem fixa (Trabalhista) e ignorando categorias legadas.
- **Database**: categorias legadas em `petition_blocks` normalizadas para `outros` e constraint de `category` restrito apenas Ã s seÃ§Ãµes trabalhistas do app.

## 1.6.5
- **Editor de PetiÃ§Ãµes**: inserÃ§Ã£o de bloco na petiÃ§Ã£o agora preserva formataÃ§Ã£o (usa `pasteSfdt`) e evita colar o SFDT (JSON) como texto; placeholders do cliente sÃ£o substituÃ­dos via `replaceAll`.

## 1.6.4
- **Database**: corrigido erro `23514` no insert de blocos ajustando o constraint `petition_blocks_category_check` para aceitar as categorias do app (e manter compatibilidade com valores legados).

## 1.6.3
- **Database**: alinhado schema de `petition_blocks` com o app (renomeia coluna `name` -> `title` quando necessÃ¡rio).
- **Database**: corrigido erro de RLS ao inserir blocos (`new row violates row-level security policy`) criando policies permissivas para usuÃ¡rios `authenticated`.

## 1.6.2
- **Database**: corrigido erro `PGRST204: Could not find the 'is_active' column` adicionando colunas faltantes (`is_active`, `is_default`, `order`, `tags`, `category`) na tabela `petition_blocks`.

## 1.6.1
- **Editor de PetiÃ§Ãµes**: modal de Bloco agora forÃ§a margens mÃ­nimas apÃ³s colar conteÃºdo (`applyMinimalMargins`), garantindo que o texto ocupe a largura total do editor.

## 1.6.0
- **Editor de PetiÃ§Ãµes**: modal de Bloco agora ocupa largura total no editor (margens mÃ­nimas + `FitPageWidth`, reaplicado apÃ³s mudanÃ§as no documento).

## 1.5.9
- **Editor de PetiÃ§Ãµes**: corrigido bug de visualizaÃ§Ã£o no modal de Bloco (agora usa `layoutType="Continuous"` para exibir apenas Ã¡rea de texto, sem visual de pÃ¡gina A4).

## 1.5.8
- **Editor de PetiÃ§Ãµes**: ao cadastrar seleÃ§Ã£o como bloco, o SFDT da seleÃ§Ã£o Ã© capturado no clique do menu de contexto e enviado para o modal, evitando perda de seleÃ§Ã£o e preservando formataÃ§Ã£o.

## 1.5.7
- **Editor de PetiÃ§Ãµes**: melhoria de confiabilidade ao cadastrar seleÃ§Ã£o como bloco (foco no editor do modal + pequeno delay antes de `paste(sfdt)` para preservar formataÃ§Ã£o).

## 1.5.6
- **Editor de PetiÃ§Ãµes**: ao cadastrar seleÃ§Ã£o como bloco, preserva formataÃ§Ã£o inserindo o SFDT da seleÃ§Ã£o via `editor.paste(sfdt)` (fragmento), sem depender de clipboard.
- **Editor de PetiÃ§Ãµes**: modal de Bloco estabilizado (altura mÃ¡xima + scroll interno; rÃ©gua/painel de navegaÃ§Ã£o ocultos no editor do modal).

## 1.5.5
- **Editor de PetiÃ§Ãµes**: corrigido modal de Bloco nÃ£o puxando conteÃºdo da seleÃ§Ã£o (agora usa `getSelectionSfdt()` em vez de clipboard).
- **Editor de PetiÃ§Ãµes**: visual do modal de Bloco melhorado (toolbar escondida, layout mais limpo, espaÃ§amentos ajustados).

## 1.5.4
- **Editor de PetiÃ§Ãµes**: correÃ§Ã£o de dependÃªncia do useEffect para inicializaÃ§Ã£o do modal de Bloco.

## 1.5.3
- **Editor de PetiÃ§Ãµes**: modal de Bloco ajustado (mais largo e menos alto).
- **Editor de PetiÃ§Ãµes**: corrigida oscilaÃ§Ã£o/loop que ficava alterando estado de Undo no modal (inicializaÃ§Ã£o do editor ocorre 1x por abertura).
- **Editor de PetiÃ§Ãµes**: melhoria no copiar/colar da seleÃ§Ã£o para o modal (tentativa via APIs `selection` e `editor` do Syncfusion; mantÃ©m botÃ£o "Colar com formataÃ§Ã£o" quando necessÃ¡rio).

## 1.5.2
- **Editor de PetiÃ§Ãµes**: interface padronizada para "Blocos" (remoÃ§Ã£o de textos residuais de "ClÃ¡usulas").
- **Editor de PetiÃ§Ãµes**: cadastro/ediÃ§Ã£o de bloco agora usa **Syncfusion** no modal e salva conteÃºdo em **SFDT**.
- **Editor de PetiÃ§Ãµes**: ao cadastrar seleÃ§Ã£o como bloco, o sistema tenta colar com formataÃ§Ã£o; se o navegador bloquear a colagem automÃ¡tica, exibe botÃ£o "Colar com formataÃ§Ã£o".

## 1.5.1
- **Editor de PetiÃ§Ãµes**: migration de renomeaÃ§Ã£o para "blocos" agora garante que a tabela `petition_blocks` tenha a coluna `"order"`, corrigindo erro `petition_blocks.order does not exist` ao listar.

## 1.5.0
- **BREAKING CHANGE**: RenomeaÃ§Ã£o de "ClÃ¡usula" para "Bloco" em todo o sistema:
  - Tipos: `PetitionClause` â†’ `PetitionBlock`, `ClauseCategory` â†’ `BlockCategory`
  - Service: `listClauses()` â†’ `listBlocks()`, `createClause()` â†’ `createBlock()`, etc.
  - Tabela no banco: `petition_clauses` â†’ `petition_blocks`
  - Coluna: `clauses_used` â†’ `blocks_used` na tabela `saved_petitions`
  - Labels e textos de interface atualizados
- **Editor de PetiÃ§Ãµes**: removido campo "FormataÃ§Ã£o" do cadastro de bloco (formataÃ§Ã£o agora Ã© gerenciada pelo Syncfusion SFDT)
- **Editor de PetiÃ§Ãµes**: menu de contexto atualizado com novos textos ("Inserir bloco...", "Cadastrar seleÃ§Ã£o como bloco...")
- **Migration**: arquivo `20251229_rename_clauses_to_blocks.sql` criado para atualizar o banco de dados

## 1.4.9
- **Editor de PetiÃ§Ãµes**: menu de contexto do Syncfusion agora inclui aÃ§Ãµes do sistema:
  - Inserir clÃ¡usula (abre a busca de clÃ¡usulas)
  - Cadastrar seleÃ§Ã£o como clÃ¡usula (abre o cadastro jÃ¡ preenchido com o texto selecionado)

## 1.4.8
- **Editor de PetiÃ§Ãµes**: redimensionamento do painel de propriedades tambÃ©m pode ser feito arrastando pelo cabeÃ§alho "TEXT".

## 1.4.7
- **Editor de PetiÃ§Ãµes**: painel de propriedades do Syncfusion agora Ã© redimensionÃ¡vel por arraste e a largura fica persistida localmente.

## 1.4.6
- **Editor de PetiÃ§Ãµes**: layout ajustado para a folha ocupar toda a Ã¡rea disponÃ­vel, removendo o fundo ao redor e escalando a rÃ©gua com a largura.

## 1.4.5
- **Syncfusion**: licenciamento simplificado via `.env` (`VITE_SYNCFUSION_LICENSE_KEY`) registrado no `main.tsx`.

## 1.4.4
- **Syncfusion**: ajuste final no licenciamento via Supabase (Edge Function `syncfusion-license`), evitando warning de TypeScript no workspace.

## 1.4.3
- **Syncfusion**: licenciamento via Supabase (Edge Function `syncfusion-license` + `registerLicense()` no PetitionEditor).

## 1.4.2
- **Syncfusion**: registro da licenÃ§a no `main.tsx` via `registerLicense()` (lendo `VITE_SYNCFUSION_LICENSE_KEY`).

## 1.4.1
- **Editor de PetiÃ§Ãµes**: atualizaÃ§Ã£o das dependÃªncias Syncfusion para `32.1.19`.

## 1.4.0
- **Editor de PetiÃ§Ãµes**: substituiÃ§Ã£o completa do Quill pelo **Syncfusion DocumentEditor** para fidelidade 100% com formataÃ§Ã£o DOCX.
  - Novo componente `SyncfusionEditor.tsx` encapsulando o DocumentEditorContainerComponent.
  - Toolbar nativa do Syncfusion com todas as opÃ§Ãµes de formataÃ§Ã£o Word.
  - Import/export de arquivos DOCX via `serviceUrl` configurÃ¡vel (`VITE_SYNC_FUSION`).
  - Salvar petiÃ§Ãµes em formato SFDT (nativo Syncfusion) com compatibilidade para petiÃ§Ãµes antigas.
  - CSS do Syncfusion importado globalmente em `index.css`.
  - Sidebar e splitter mantidos para clÃ¡usulas, clientes e petiÃ§Ãµes salvas.

## 1.3.66
- **NotificaÃ§Ãµes**: correÃ§Ã£o definitiva de responsividade no dropdown (mobile fixed, desktop absolute) e ajustes de layout no mÃ³dulo completo para evitar overflow em telas pequenas.

## 1.3.65
- **Editor de PetiÃ§Ãµes**: adicionada opÃ§Ã£o de altura da linha (line-height) na toolbar.

## 1.3.64
- **Editor de PetiÃ§Ãµes**: sidebar agora Ã© redimensionÃ¡vel via arraste (splitter) e a largura escolhida Ã© persistida localmente.

## 1.3.63
- **Editor de PetiÃ§Ãµes**: layout ajustado para a folha ocupar toda a Ã¡rea disponÃ­vel, removendo o fundo ao redor e escalando a rÃ©gua com a largura.

## 1.3.62
- **Editor de PetiÃ§Ãµes**: corrigido editor em branco causado por CSP (`unsafe-eval`) removendo imports estÃ¡ticos de libs DOCX e carregando-as somente via import dinÃ¢mico quando necessÃ¡rio.

## 1.3.61
- **Editor de PetiÃ§Ãµes**: formataÃ§Ã£o ajustada para a rÃ©gua (4cm = recuo da primeira linha; 6cm = recuo do bloco para citaÃ§Ã£o) e alinhamento do bloco Ã© normalizado ao aplicar formataÃ§Ãµes.

## 1.3.60
- **Editor de PetiÃ§Ãµes**: inserÃ§Ã£o de clÃ¡usulas/qualificaÃ§Ã£o agora usa texto puro (com normalizaÃ§Ã£o de espaÃ§os/quebras) e aplica formataÃ§Ã£o por linha, garantindo parÃ¡grafo/citaÃ§Ã£o/tÃ­tulo conforme o padrÃ£o do editor.

## 1.3.59
- **Editor de PetiÃ§Ãµes**: inicializaÃ§Ã£o do editor mais resiliente (try/catch, `enable(true)` e `tabIndex`), exibindo erro quando o Quill nÃ£o inicializa e evitando editor â€œmortoâ€� sem digitaÃ§Ã£o/inserÃ§Ã£o.

## 1.3.58
- **Editor de PetiÃ§Ãµes**: inicializaÃ§Ã£o do Quill mais robusta (recria a instÃ¢ncia quando o container anterior sai do DOM), corrigindo casos em que o editor aparecia mas nÃ£o permitia digitar/inserir.

## 1.3.57
- **Editor de PetiÃ§Ãµes**: editor agora permanece sempre em modal (portal) e o toggle de tela cheia altera apenas o layout, evitando remount do Quill que travava digitaÃ§Ã£o/inserÃ§Ã£o.

## 1.3.56
- **Editor de PetiÃ§Ãµes**: corrigido bug crÃ­tico onde minimizar quebrava o editor e impedia digitaÃ§Ã£o/inserÃ§Ã£o.
- **Editor de PetiÃ§Ãµes**: atalho Shift nÃ£o interfere mais ao digitar (sÃ³ dispara quando Shift Ã© pressionado sozinho).
- **Editor de PetiÃ§Ãµes**: auto-save agora cria a petiÃ§Ã£o automaticamente no primeiro texto digitado.
- **Editor de PetiÃ§Ãµes**: carregamento de petiÃ§Ãµes mais robusto (aceita `content_delta` como JSON ou string JSON).

## 1.3.55
- **Editor de PetiÃ§Ãµes**: modal fullscreen (sem menu/nav) com botÃµes minimizar/maximizar/fechar.
- **Editor de PetiÃ§Ãµes**: salvamento instantÃ¢neo (debounce 2s) ao digitar.
- **Editor de PetiÃ§Ãµes**: atalhos de teclado - Shift 1x = parÃ¡grafo 4cm, Shift 2x = citaÃ§Ã£o, Ctrl+S = salvar.
- **Editor de PetiÃ§Ãµes**: foco automÃ¡tico no editor ao abrir.
- **Editor de PetiÃ§Ãµes**: upload de fonte customizada (.ttf, .otf, .woff, .woff2).
- **Editor de PetiÃ§Ãµes**: dica de atalhos visÃ­vel na interface.

## 1.3.54
- **Editor de PetiÃ§Ãµes**: corrigido erro `Parchment.Attributor.Class is not a constructor` que impedia o editor de inicializar.

## 1.3.53
- **Editor de PetiÃ§Ãµes**: ao importar modelo `.docx`, opÃ§Ã£o de carregar o conteÃºdo do arquivo diretamente no editor.

## 1.3.52
- **Editor de PetiÃ§Ãµes**: validaÃ§Ã£o imediata ao importar modelo `.docx` e mensagem de erro mais clara quando o template nÃ£o contÃ©m `[[CONTEUDO]]`.

## 1.3.51
- **Editor de PetiÃ§Ãµes**: header do app agora exibe tÃ­tulo/descriÃ§Ã£o do mÃ³dulo PetiÃ§Ãµes.
- **Editor de PetiÃ§Ãµes**: formataÃ§Ã£o padrÃ£o ajustada para o modelo (parÃ¡grafo sem recuo; estilo 4cm opcional via botÃ£o).

## 1.3.50
- **Editor de PetiÃ§Ãµes**: menu do sistema restaurado (header/rodapÃ©), mantendo apenas o nav lateral oculto.
- **Editor de PetiÃ§Ãµes**: ajustes de formataÃ§Ã£o para o padrÃ£o do modelo (tÃ­tulo sublinhado/centralizado; citaÃ§Ã£o centralizada em caixa alta).

## 1.3.49
- **Editor de PetiÃ§Ãµes**: migraÃ§Ã£o para Quill (core) para maior estabilidade e ediÃ§Ã£o fluida.
  - Remove `contentEditable`/`document.execCommand` e passa a usar Quill como fonte de verdade
  - Salvamento/auto-save agora persiste `content` (HTML) + `content_delta` (Quill Delta)
  - Carregamento restaura preferencialmente via `content_delta` (fallback para HTML)
  - InserÃ§Ã£o de clÃ¡usulas/qualificaÃ§Ã£o de cliente no cursor via Quill

## 1.3.48
- **Editor de PetiÃ§Ãµes**: modo tela cheia para peticionar mais rÃ¡pido.
  - Oculta menu lateral (nav) no mÃ³dulo PetiÃ§Ãµes
  - Oculta header e rodapÃ© do app no mÃ³dulo PetiÃ§Ãµes
  - Editor passa a ocupar 100% da tela

## 1.3.47
- **Editor de PetiÃ§Ãµes**: melhorias visuais e funcionais.
  - RÃ©gua estilo Word com marcaÃ§Ãµes em centÃ­metros (0-21cm)
  - Indicadores de recuo (parÃ¡grafo 4cm, citaÃ§Ã£o 6cm) na rÃ©gua
  - BotÃ£o "PDF" separado para exportar petiÃ§Ã£o em PDF
  - BotÃ£o "Imprimir" para impressÃ£o direta
  - Auto-save a cada 1 minuto (antes era 30 segundos)
  - VinculaÃ§Ã£o com cliente mantida (aba Clientes na sidebar)

## 1.3.46
- **Editor de PetiÃ§Ãµes**: exportaÃ§Ã£o DOCX real com preservaÃ§Ã£o do modelo.
  - Importar modelo `.docx` e exportar preenchendo `[[CONTEUDO]]` via `docxtemplater`
  - Preserva cabeÃ§alho, rodapÃ© e logo do modelo no Word
  - NormalizaÃ§Ã£o do editor para manter estrutura em parÃ¡grafos (`<p>`) e evitar perda de formataÃ§Ã£o ao salvar

## 1.3.45
- **Editor de PetiÃ§Ãµes**: ajustes para preservar formataÃ§Ã£o no Word.
  - ExportaÃ§Ã£o/ImpressÃ£o: troca de recuo para `margin-left` (compatibilidade melhor com Word)
  - CSS do export corrigido para usar `margin-left`/`margin-bottom` explÃ­citos (evita interpretaÃ§Ã£o incorreta)

## 1.3.44
- **Editor de PetiÃ§Ãµes**: correÃ§Ã£o do recuo padrÃ£o e adiÃ§Ã£o de rÃ©gua.
  - Recuo do parÃ¡grafo/citaÃ§Ã£o agora considera a margem da folha (evita â€œficar como citaÃ§Ã£oâ€�)
  - Enter apÃ³s citaÃ§Ã£o/tÃ­tulo/subtÃ­tulo volta para parÃ¡grafo padrÃ£o
  - RÃ©gua visual na folha A4 (margem 3cm, parÃ¡grafo 4cm, citaÃ§Ã£o 6cm)

## 1.3.43
- **Editor de PetiÃ§Ãµes**: correÃ§Ã£o dos modais que nÃ£o cabiam na tela.
  - Modal de clÃ¡usula: scroll no backdrop, header/footer sticky, textarea reduzido
  - Modal de busca: altura mÃ¡xima 50vh, scroll interno

## 1.3.42
- **Editor de PetiÃ§Ãµes Trabalhistas v4**: novas funcionalidades e melhorias.
  - Texto padrÃ£o inicial: cabeÃ§alho TRT + qualificaÃ§Ã£o do reclamante + reclamada
  - BotÃ£o "Modelo": importar modelo Word (.doc/.docx) com logo e rodapÃ©
  - BotÃ£o "Word": exportar documento formatado
  - Menu de contexto (botÃ£o direito) melhorado:
    - "Adicionar clÃ¡usula": abre modal de busca com todas as clÃ¡usulas
    - "Salvar como clÃ¡usula": salva texto selecionado como nova clÃ¡usula
  - Modal de busca de clÃ¡usulas com filtro por tÃ­tulo/conteÃºdo
  - Dados do advogado prÃ©-configurados no texto padrÃ£o

## 1.3.41
- **Editor de PetiÃ§Ãµes Trabalhistas v3**: melhorias significativas na toolbar e funcionalidades.
  - Toolbar completa estilo Word: fonte, tamanho, negrito, itÃ¡lico, sublinhado, tachado, subscrito, sobrescrito
  - Cores de texto e destaque (highlight)
  - Alinhamento: esquerda, centro, direita, justificado (padrÃ£o)
  - Listas com marcadores e numeradas
  - FormataÃ§Ã£o de parÃ¡grafo: 4cm, 6cm (citaÃ§Ã£o), tÃ­tulo, subtÃ­tulo, normal
  - Menu de contexto (botÃ£o direito): salvar seleÃ§Ã£o como clÃ¡usula
  - Auto-save a cada 30 segundos quando hÃ¡ alteraÃ§Ãµes
  - Indicador de status de salvamento (Ãºltima vez salvo / nÃ£o salvo)
  - VinculaÃ§Ã£o com cliente: aba "Clientes" na sidebar
  - QualificaÃ§Ã£o automÃ¡tica do cliente (nome, CPF, RG, nacionalidade, estado civil, profissÃ£o, endereÃ§o)
  - VariÃ¡veis de cliente nas clÃ¡usulas: [[NOME_CLIENTE]], [[CPF]], [[RG]], etc.
  - SubstituiÃ§Ã£o automÃ¡tica de variÃ¡veis ao inserir clÃ¡usula com cliente selecionado

## 1.3.40
- **Editor de PetiÃ§Ãµes Trabalhistas v2**: redesenhado para tela cheia com editor de texto livre.
  - Editor ocupa pÃ¡gina inteira sem header (folha A4 visual)
  - Texto livre (nÃ£o mais baseado em blocos) - ediÃ§Ã£o fluida como Word
  - FormataÃ§Ã£o Word preservada: ParÃ¡grafo (4cm), CitaÃ§Ã£o (6cm), TÃ­tulo, SubtÃ­tulo
  - Toolbar com negrito, itÃ¡lico, sublinhado e botÃµes de formataÃ§Ã£o
  - Sidebar retrÃ¡til com clÃ¡usulas organizadas por categoria
  - ClÃ¡usulas inseridas na posiÃ§Ã£o do cursor
  - ExportaÃ§Ã£o DOC e PDF/ImpressÃ£o com formataÃ§Ã£o correta
  - Migration executada via MCP Supabase

## 1.3.39
- **Editor de PetiÃ§Ãµes Trabalhistas**: novo mÃ³dulo isolado para criaÃ§Ã£o de petiÃ§Ãµes com clÃ¡usulas reutilizÃ¡veis.
  - ClÃ¡usulas organizadas por categoria (CabeÃ§alho, QualificaÃ§Ã£o, Fatos, Direito, Pedidos, Encerramento)
  - FormataÃ§Ã£o especÃ­fica: ParÃ¡grafo (4cm), CitaÃ§Ã£o (6cm), TÃ­tulo, SubtÃ­tulo
  - ClÃ¡usulas padrÃ£o prÃ©-cadastradas para petiÃ§Ãµes trabalhistas
  - Editor visual com drag-and-drop de blocos
  - ExportaÃ§Ã£o para DOC e PDF/ImpressÃ£o
  - Salvar e carregar petiÃ§Ãµes
  - Gerenciamento completo de clÃ¡usulas (criar, editar, excluir, definir padrÃ£o)
  - MÃ³dulo completamente isolado (pode ser removido sem afetar outros mÃ³dulos)

## 1.3.38
- Documentos: adicionado campo de busca para filtrar modelos no seletor de templates (inclui PetiÃ§Ãµes PadrÃµes e Novo Documento) para facilitar quando houver muitos arquivos/modelos.

## 1.3.37
- Cache/SincronizaÃ§Ã£o: implementado sistema de eventos globais para invalidaÃ§Ã£o de cache e sincronizaÃ§Ã£o de clientes. Clientes criados, atualizados ou excluÃ­dos agora sÃ£o refletidos imediatamente em todos os mÃ³dulos (Dashboard, Clientes, Processos, Financeiro) sem necessidade de atualizar a pÃ¡gina.
- Documentos: corrigido campo nome do modal "Adicionar Template" que nÃ£o era limpo ao abrir o modal.

## 1.3.36
- Cache/SincronizaÃ§Ã£o: clientes criados, atualizados ou excluÃ­dos agora sÃ£o refletidos imediatamente em todos os mÃ³dulos (Dashboard, Clientes, Processos, Financeiro) sem necessidade de atualizar a pÃ¡gina. Implementado sistema de eventos globais para invalidaÃ§Ã£o de cache e sincronizaÃ§Ã£o de estado entre componentes.

## 1.3.35
- Documentos: PetiÃ§Ãµes PadrÃµes â€” adequaÃ§Ã£o completa ao padrÃ£o visual do CRM (header branco, botÃµes laranja, cards de stats, remoÃ§Ã£o de gradientes escuros) para consistÃªncia com os demais mÃ³dulos.

## 1.3.34
- Documentos: PetiÃ§Ãµes PadrÃµes â€” ajustes de tema (cores/bordas/inputs/botÃµes) e suporte a dark mode (incluindo modais de criar/editar, campos e visualizaÃ§Ã£o).

## 1.3.33
- Documentos: corrigido dropdown de seleÃ§Ã£o de cliente (autocomplete) que podia ficar cortado/atrÃ¡s do rodapÃ© ou de containers com overflow; lista agora abre em overlay (portal) com posicionamento inteligente.

## 1.3.32
- Performance: prÃ©-carregamento (prefetch) em background dos mÃ³dulos principais apÃ³s login para navegaÃ§Ã£o mais rÃ¡pida e reduÃ§Ã£o do tempo de carregamento ao abrir mÃ³dulos.

## 1.3.31
- DocumentaÃ§Ã£o: redesign da superpÃ¡gina para o padrÃ£o visual do sistema (layout limpo/profissional, sem gradientes chamativos e sem aparÃªncia de template), mantendo sidebar, busca e seÃ§Ãµes.

## 1.3.30
- DocumentaÃ§Ã£o: nova superpÃ¡gina de documentaÃ§Ã£o premium com design moderno, sidebar de navegaÃ§Ã£o, seÃ§Ãµes organizadas (InÃ­cio, Guia do Sistema, Changelog, FAQ), busca integrada e layout responsivo.

## 1.3.29
- Autenticidade/VerificaÃ§Ã£o: exibiÃ§Ã£o do contato do signatÃ¡rio agora prioriza o e-mail/telefone realmente usado na autenticaÃ§Ã£o (Google/telefone), evitando mostrar e-mail interno `public+...@crm.local`.

## 1.3.28
- Assinatura (selfie): anti-falso-negativo â€” se a IA reclamar apenas de â€œclareza/borrÃ£o/iluminaÃ§Ã£oâ€� mas nÃ£o indicar ausÃªncia de rosto/obstruÃ§Ã£o/borrÃ£o severo, a foto Ã© aceita.

## 1.3.27
- Assinatura (selfie): critÃ©rios da IA ajustados para nÃ£o reprovar por iluminaÃ§Ã£o; reprova apenas por ausÃªncia de rosto, obstruÃ§Ã£o no rosto ou foto muito borrada.

## 1.3.26
- Assinatura PÃºblica: validaÃ§Ã£o de selfie com IA agora bloqueia envio quando a foto estiver sem rosto visÃ­vel/nÃ­tido e exibe o motivo.
- Edge Function: `analyze-facial-photo` agora aceita validaÃ§Ã£o via `token` pÃºblico (sem login) com checagem no backend.

## 1.3.25
- Assinatura EletrÃ´nica: validaÃ§Ã£o de foto facial com IA (OpenAI Vision) - verifica nitidez, iluminaÃ§Ã£o e visibilidade do rosto.
- Se a foto nÃ£o passar na validaÃ§Ã£o, exibe mensagem e pede para tirar nova foto.
- OpÃ§Ã£o "Usar mesmo assim" para casos excepcionais.

## 1.3.24
- NotificaÃ§Ãµes: suporte a notificaÃ§Ã£o do navegador ao receber notificaÃ§Ãµes via Realtime (quando o usuÃ¡rio conceder permissÃ£o).
- NotificaÃ§Ãµes: clique na notificaÃ§Ã£o de assinatura abre diretamente o mÃ³dulo Assinaturas no modal de detalhes.

## 1.3.23
- NotificaÃ§Ãµes: popups na tela agora ficam fixos atÃ© o usuÃ¡rio fechar (sem expirar automaticamente).
- NotificaÃ§Ãµes: redesign das notificaÃ§Ãµes de assinatura (badge + progresso + cores) no popup e no dropdown.

## 1.3.22
- NotificaÃ§Ãµes: `analyze-intimations` agora cria notificaÃ§Ã£o para todas as novas intimaÃ§Ãµes analisadas (nÃ£o apenas urgentes).
- NotificaÃ§Ãµes: tÃ­tulo da intimaÃ§Ã£o agora reflete a urgÃªncia (ðŸ“„/ðŸ“‹/âš ï¸�/ðŸš¨).
- NotificaÃ§Ãµes: `NotificationBell` com Realtime mais robusto em ambiente dev (evita duplicidade no React StrictMode).

## 1.3.21
- NotificaÃ§Ãµes: integraÃ§Ã£o de Requerimentos (alertas de MS/tempo em anÃ¡lise) via `notification-scheduler`.
- NotificaÃ§Ãµes: `user_notifications` agora suporta `requirement_id` e tipo `requirement_alert`.
- NotificaÃ§Ãµes: clique no sino/popup abre diretamente Requerimentos quando o alerta for de requerimento.
- NotificaÃ§Ãµes: scheduler agora respeita `notify_days_before` (prazos) e `notify_minutes_before` (agenda) e usa deduplicaÃ§Ã£o por `dedupe_key`.
- NotificaÃ§Ãµes: correÃ§Ã£o de seleÃ§Ã£o de usuÃ¡rios ativos via `profiles.is_active`/`profiles.user_id`.

## 1.3.20
- NotificaÃ§Ãµes: popup na tela agora permanece por 60 minutos (com botÃ£o de fechar).
- NotificaÃ§Ãµes: mÃºltiplos popups empilhados (um em cima do outro) no canto da tela.

## 1.3.19
- NotificaÃ§Ãµes: popup na tela estilo Facebook/Instagram quando chega notificaÃ§Ã£o via Realtime.
- NotificaÃ§Ãµes: intimaÃ§Ãµes agora exibem partes (nomes/polo) e resumo/assunto para maior precisÃ£o.
- NotificaÃ§Ãµes: assinaturas digitais disparam popup realtime quando alguÃ©m assina documento.
- NotificaÃ§Ãµes: barra de progresso visual no popup (6 segundos para fechar automaticamente).

## 1.3.18
- Clientes: seÃ§Ã£o "Documentos/Contratos assinados" nos detalhes do cliente (lista documentos assinados via mÃ³dulo de Assinatura Digital, com acesso ao PDF assinado).

## 1.3.17
- NotificaÃ§Ãµes: geraÃ§Ã£o quase realtime de notificaÃ§Ãµes de intimaÃ§Ãµes (run-djen-sync chama analyze-intimations ao salvar novas intimaÃ§Ãµes).
- NotificaÃ§Ãµes: dropdown do sino exibe apenas nÃ£o lidas (ao marcar como lida, some da lista).

## 1.3.16
- NotificaÃ§Ãµes: Edge Function `analyze-intimations` para anÃ¡lise automÃ¡tica de intimaÃ§Ãµes via cron.
- NotificaÃ§Ãµes: cron job executa a cada 30 minutos para analisar novas intimaÃ§Ãµes.
- NotificaÃ§Ãµes: intimaÃ§Ãµes urgentes (alta/crÃ­tica) geram notificaÃ§Ã£o automÃ¡tica.
- NotificaÃ§Ãµes: usa Groq AI como provider principal, OpenAI como fallback.

## 1.3.15
- NotificaÃ§Ãµes: ao marcar intimaÃ§Ã£o como lida, notificaÃ§Ã£o correspondente Ã© marcada como lida automaticamente.
- NotificaÃ§Ãµes: dropdown mostra apenas notificaÃ§Ãµes nÃ£o lidas (lidas somem da lista).

## 1.3.14
- NotificaÃ§Ãµes: sistema de lembretes automÃ¡ticos via Edge Function (cron).
- NotificaÃ§Ãµes: lembrete de prazo 1-3 dias antes do vencimento.
- NotificaÃ§Ãµes: lembrete de compromisso 1 dia antes.
- NotificaÃ§Ãµes: alerta de intimaÃ§Ã£o urgente (anÃ¡lise IA).
- NotificaÃ§Ãµes: alerta de assinatura pendente hÃ¡ mais de 1 dia.
- NotificaÃ§Ãµes: trigger automÃ¡tico quando cliente assina documento.
- NotificaÃ§Ãµes: cron jobs executam a cada hora e Ã s 8h da manhÃ£.
- NotificaÃ§Ãµes: deduplicaÃ§Ã£o para evitar notificaÃ§Ãµes repetidas em 24h.

## 1.3.13
- NotificaÃ§Ãµes: integraÃ§Ã£o completa em todo o sistema.
- NotificaÃ§Ãµes: prazos criados geram notificaÃ§Ã£o (urgente se â‰¤3 dias ou prioridade alta).
- NotificaÃ§Ãµes: compromissos criados geram notificaÃ§Ã£o com data/hora.
- NotificaÃ§Ãµes: assinaturas digitais geram notificaÃ§Ã£o quando cliente assina.
- NotificaÃ§Ãµes: processos criados geram notificaÃ§Ã£o com nÃºmero e cliente.
- NotificaÃ§Ãµes: Ã­cone de caneta (PenTool) para assinaturas digitais.

## 1.3.12
- NotificaÃ§Ãµes: cria notificaÃ§Ã£o para TODAS as intimaÃ§Ãµes (nÃ£o apenas urgentes).
- NotificaÃ§Ãµes: badges de tribunal e urgÃªncia (ALTA, CRÃ�TICA) nas notificaÃ§Ãµes.
- NotificaÃ§Ãµes: Ã­cone diferenciado para intimaÃ§Ãµes urgentes (triÃ¢ngulo vermelho).
- NotificaÃ§Ãµes: cor de fundo do Ã­cone baseada na urgÃªncia.
- NotificaÃ§Ãµes: mensagem com resumo da anÃ¡lise de IA.

## 1.3.11
- NotificaÃ§Ãµes: suporte a Realtime (notificaÃ§Ãµes instantÃ¢neas via WebSocket).
- NotificaÃ§Ãµes: som toca automaticamente ao receber nova notificaÃ§Ã£o.
- NotificaÃ§Ãµes: habilitado Realtime na tabela user_notifications.

## 1.3.10
- NotificaÃ§Ãµes: corrigido RLS policy para permitir INSERT/UPDATE/DELETE na tabela user_notifications.

## 1.3.9
- NotificaÃ§Ãµes: novo sistema estilo Facebook/Instagram com dropdown moderno.
- NotificaÃ§Ãµes: som de alerta usando Web Audio API (pode ser ativado/desativado).
- NotificaÃ§Ãµes: badge com contador animado (pulse) no Ã­cone do sino.
- NotificaÃ§Ãµes: tempo relativo (agora, 5m, 2h, 3d).
- NotificaÃ§Ãµes: aÃ§Ãµes rÃ¡pidas (marcar como lida, deletar) ao passar o mouse.
- NotificaÃ§Ãµes: botÃ£o para marcar todas como lidas.
- NotificaÃ§Ãµes: polling automÃ¡tico a cada 30 segundos.

## 1.3.8
- NotificaÃ§Ãµes: corrigido erro 400 ao criar notificaÃ§Ãµes de intimaÃ§Ã£o urgente (mapeia `intimation_urgent` para `intimation_new` e registra `urgent: true` no metadata).

## 1.3.7
- IntimaÃ§Ãµes DJEN: layout unificado em barra Ãºnica (header + filtros + aÃ§Ãµes).
- IntimaÃ§Ãµes DJEN: indicadores inline (total, nÃ£o lidas, urgÃªncia).
- IntimaÃ§Ãµes DJEN: botÃµes de aÃ§Ã£o apenas com Ã­cones (Filtros, HistÃ³rico, Exportar, Config).
- IntimaÃ§Ãµes DJEN: exibiÃ§Ã£o dos nomes das partes (destinatÃ¡rios ou extraÃ­dos do texto).
- IntimaÃ§Ãµes DJEN: fallback de extraÃ§Ã£o de partes do texto quando nÃ£o hÃ¡ destinatÃ¡rios cadastrados.
- IntimaÃ§Ãµes DJEN: vinculaÃ§Ã£o automÃ¡tica quando nome da parte = nome do cliente cadastrado (match 100%).
- IntimaÃ§Ãµes DJEN: prioridade de visualizaÃ§Ã£o para as intimaÃ§Ãµes.

## 1.3.6
- IntimaÃ§Ãµes DJEN: anÃ¡lise automÃ¡tica de IA agora Ã© disparada quando novas intimaÃ§Ãµes chegam via realtime.

## 1.3.5
- IntimaÃ§Ãµes DJEN: toast de realtime agora mostra a quantidade de novas intimaÃ§Ãµes recebidas (inserts agrupados em lote).

## 1.3.4
- Edge Function run-djen-sync: removido limite de 10 processos - agora busca TODOS os processos cadastrados.

## 1.3.3
- Database: habilitado Realtime (postgres_changes) para tabela `djen_comunicacoes` - agora a lista atualiza automaticamente ao chegar nova intimaÃ§Ã£o.

## 1.3.2
- IntimaÃ§Ãµes DJEN: busca agora considera tambÃ©m o nÃºmero do processo cadastrado (process_code) e agrupamento prioriza process_code quando houver vÃ­nculo.

## 1.3.1
- IntimaÃ§Ãµes DJEN: atualizaÃ§Ã£o automÃ¡tica da lista e notificaÃ§Ã£o quando chegar nova intimaÃ§Ã£o (realtime).

## 1.3.0
- IntimaÃ§Ãµes DJEN: perÃ­odo de busca alterado para 7 dias (Edge Function + sync manual).
- Edge Function run-djen-sync: extrai nÃºmero do processo do texto quando nÃ£o vem da API.
- Edge Function run-djen-sync: vinculaÃ§Ã£o automÃ¡tica com processos cadastrados melhorada.
- Deletadas intimaÃ§Ãµes antigas do banco (desde 11/12).

## 1.2.9
- Database: coluna `numero_processo` em `djen_comunicacoes` agora Ã© nullable (API do DJEN nem sempre retorna esse campo).

## 1.2.8
- Edge Function run-djen-sync: corrigido insert em `djen_comunicacoes` preenchendo campos obrigatÃ³rios (`djen_id` e `hash`) e melhorados logs de erro para diagnosticar falhas (evita "saved=0" silencioso).

## 1.2.7
- IntimaÃ§Ãµes DJEN: corrigido "Ãšltima atualizaÃ§Ã£o" para exibir a sincronizaÃ§Ã£o mais recente (nÃ£o a primeira).
- Edge Function run-djen-sync: corrigido nome da tabela `djen_comunicacoes_local` â†’ `djen_comunicacoes`.
- Corrigido nome da tabela em `processTimeline.service.ts`.

## 1.2.6
- IntimaÃ§Ãµes DJEN: melhorias visuais no header e aÃ§Ãµes (layout mais premium).
- IntimaÃ§Ãµes DJEN: perÃ­odo de busca do DJEN ampliado para 15 dias (cron/Edge Function e sincronizaÃ§Ã£o manual).

## 1.2.5
- IntimaÃ§Ãµes DJEN: "Ãšltima atualizaÃ§Ã£o" agora Ã© baseada exclusivamente no histÃ³rico do cron (`djen_sync_history`).
- DJEN cron: Edge Function `run-djen-sync` registra execuÃ§Ã£o bloqueada (token invÃ¡lido) no `djen_sync_history`.

## 1.2.4
- IntimaÃ§Ãµes DJEN: sincronizaÃ§Ã£o manual agora registra na tabela `djen_sync_history` do Supabase.
- IntimaÃ§Ãµes DJEN: adicionados mÃ©todos `logSync` e `updateSync` no service de status.

## 1.2.3
- IntimaÃ§Ãµes DJEN: criada migration para tabela `djen_sync_history` com polÃ­ticas RLS corretas.
- IntimaÃ§Ãµes DJEN: corrigido service para nÃ£o lanÃ§ar exceÃ§Ã£o quando tabela nÃ£o existe.

## 1.2.2
- Modelos de Documentos: scroll automÃ¡tico ao selecionar categoria, modelo e cliente na aba Gerar.

## 1.2.1
- Modelos de Documentos: repaginaÃ§Ã£o do layout geral do mÃ³dulo mantendo abas (Gerar/Gerenciar), com header premium e contadores.
- Modelos de Documentos: aba Gerenciar com filtros e aÃ§Ã£o "Novo Modelo" em layout mais limpo.

## 1.2.0
- PetiÃ§Ãµes PadrÃµes: novo layout da aba "Gerar Documento" com fluxo em 3 passos (Categoria â†’ Modelo â†’ Cliente).
- PetiÃ§Ãµes PadrÃµes: seleÃ§Ã£o visual de categorias com contagem de modelos disponÃ­veis.
- PetiÃ§Ãµes PadrÃµes: indicador de progresso (steps) no topo do formulÃ¡rio.
- PetiÃ§Ãµes PadrÃµes: animaÃ§Ãµes suaves ao revelar cada etapa.
- PetiÃ§Ãµes PadrÃµes: header com gradiente e design mais moderno.
- PetiÃ§Ãµes PadrÃµes: campos personalizados agora aparecem em grid 2 colunas.

## 1.1.99
- PetiÃ§Ãµes PadrÃµes: normalizaÃ§Ã£o automÃ¡tica de pontuaÃ§Ã£o para evitar vÃ­rgulas duplicadas quando campos opcionais (ex: complemento) estÃ£o vazios.

## 1.1.98
- PetiÃ§Ãµes PadrÃµes: cidade agora Ã© formatada em Title Case (ex: "VÃ¡rzea Grande") e UF em maiÃºsculo (ex: "MT") na geraÃ§Ã£o de documentos.

## 1.1.97
- PetiÃ§Ãµes PadrÃµes: invertida ordem das abas - "Gerar Documento" agora Ã© a primeira aba (padrÃ£o).

## 1.1.96
- PetiÃ§Ãµes PadrÃµes: adicionada funÃ§Ã£o de substituir template DOCX no modal de ediÃ§Ã£o.
- PetiÃ§Ãµes PadrÃµes: UI melhorada para mostrar arquivo atual e botÃ£o "Substituir" quando jÃ¡ existe um template.
- PetiÃ§Ãµes PadrÃµes: aviso visual quando o arquivo serÃ¡ substituÃ­do.

## 1.1.95
- PetiÃ§Ãµes PadrÃµes: corrigido conflito entre [[ESTADO]] (UF) e [[ESTADO CIVIL]] - agora cidade e UF mantÃªm capitalizaÃ§Ã£o original.
- PetiÃ§Ãµes PadrÃµes: adicionado placeholder [[UF]] como alternativa para estado.

## 1.1.94
- PetiÃ§Ãµes PadrÃµes: CPF agora Ã© formatado com mÃ¡scara (000.000.000-00).
- PetiÃ§Ãµes PadrÃµes: CEP agora Ã© formatado com mÃ¡scara (00000-000).
- PetiÃ§Ãµes PadrÃµes: nacionalidade, estado civil e profissÃ£o agora sÃ£o exibidos em minÃºsculo.

## 1.1.93
- PetiÃ§Ãµes PadrÃµes: placeholders do cliente agora funcionam igual ao mÃ³dulo Documentos (com variaÃ§Ãµes: maiÃºsculo, minÃºsculo, com/sem acento, com espaÃ§o ou underscore).
- PetiÃ§Ãµes PadrÃµes: adicionado placeholder [[ENDERECO_COMPLETO]] com endereÃ§o formatado.
- PetiÃ§Ãµes PadrÃµes: corrigido problema de campos do cliente vindo "undefined".

## 1.1.92
- PetiÃ§Ãµes PadrÃµes: arquivos DOCX agora sÃ£o processados automaticamente com substituiÃ§Ã£o de placeholders (nÃ£o pede mais para editar manualmente).
- PetiÃ§Ãµes PadrÃµes: usa docxtemplater para gerar documento DOCX com todos os campos preenchidos.

## 1.1.91
- PetiÃ§Ãµes PadrÃµes: campo tipo "date" agora abre calendÃ¡rio nativo do navegador.
- PetiÃ§Ãµes PadrÃµes: campos personalizados agora sÃ£o renderizados conforme seu tipo (date, textarea, select, number, currency).
- PetiÃ§Ãµes PadrÃµes: geraÃ§Ã£o de documento agora aplica corretamente os valores dos campos personalizados.
- PetiÃ§Ãµes PadrÃµes: datas sÃ£o formatadas para DD/MM/YYYY e moedas para R$ X.XXX,XX no documento gerado.

## 1.1.90
- PetiÃ§Ãµes PadrÃµes: adicionada opÃ§Ã£o de editar campo personalizado no modal de campos.

## 1.1.89
- PetiÃ§Ãµes PadrÃµes: modais (Nova/Editar, Campos, Visualizar) agora respeitam o tema e nÃ£o ficam pretos no modo claro.

## 1.1.88
- Documentos: templates marcados como petiÃ§Ãµes/requerimentos nÃ£o aparecem mais na aba "Gerenciar templates" (ficam apenas na aba "PetiÃ§Ãµes PadrÃµes").

## 1.1.87
- **SubmÃ³dulo PetiÃ§Ãµes PadrÃµes**: Nova aba no mÃ³dulo de Documentos para gerenciar petiÃ§Ãµes e requerimentos padrÃµes.
  - CRUD completo de petiÃ§Ãµes com categorias (Requerimento Administrativo, PetiÃ§Ã£o Inicial, Recurso, ContestaÃ§Ã£o, Outros)
  - Upload de arquivos DOCX ou criaÃ§Ã£o de templates em texto com placeholders
  - Campos personalizados por petiÃ§Ã£o (texto, nÃºmero, data, seleÃ§Ã£o, moeda, CPF, telefone, CEP)
  - GeraÃ§Ã£o de documentos com substituiÃ§Ã£o automÃ¡tica de dados do cliente
  - HistÃ³rico de documentos gerados
- Arquivos criados:
  - `src/components/StandardPetitionsModule.tsx` - Componente de UI completo
  - `src/services/standardPetition.service.ts` - Service com CRUD
  - `src/types/standardPetition.types.ts` - Tipos TypeScript
  - `supabase/migrations/20251227_standard_petitions.sql` - Migration do banco

## 1.1.86
- Processos: exibida a Ãºltima atualizaÃ§Ã£o do cron DJEN no header (data/hora, status, encontrados/salvos).

## 1.1.85
- MÃ³dulo IntimaÃ§Ãµes: banner "Atualizando dados em segundo plano..." agora sÃ³ aparece apÃ³s o primeiro carregamento completo (nÃ£o aparece ao entrar no mÃ³dulo).

## 1.1.84
- MÃ³dulo IntimaÃ§Ãµes: nÃ£o exibe mais o banner "Atualizando dados em segundo plano..." no carregamento inicial.

## 1.1.83
- **MÃ³dulo IntimaÃ§Ãµes**: Removida anÃ¡lise automÃ¡tica de IA ao abrir o mÃ³dulo (agora sÃ³ via cron)
- **UI Melhorada**: Header redesenhado com card de "Ãšltima atualizaÃ§Ã£o" mostrando:
  - Data e hora da Ãºltima execuÃ§Ã£o do cron
  - Status (Sucesso/Erro/Executando) com badge colorido
  - Quantidade de intimaÃ§Ãµes encontradas e salvas
- Removida mensagem "Atualizando em segundo plano" desnecessÃ¡ria

## 1.1.82
- **Cron 2x/dia**: Alterado de 1x para 2x por dia (7h e 19h)
- **MÃ³dulo IntimaÃ§Ãµes**: Removida sincronizaÃ§Ã£o automÃ¡tica ao abrir o mÃ³dulo (agora sÃ³ via cron ou botÃ£o manual)
- **Edge Function**: Logs detalhados da execuÃ§Ã£o do cron com ID Ãºnico de execuÃ§Ã£o, etapas numeradas e duraÃ§Ã£o total
- Header atualizado: "SincronizaÃ§Ã£o automÃ¡tica: 2x/dia (7h e 19h) via cron Supabase"

## 1.1.81
- **Cron DJEN Completo**: Edge Function `run-djen-sync` agora atualiza **status do processo automaticamente** quando salva nova intimaÃ§Ã£o vinculada.
  - Detecta status baseado no texto: citaÃ§Ã£o, conciliaÃ§Ã£o, contestaÃ§Ã£o, instruÃ§Ã£o, sentenÃ§a, recurso, cumprimento, arquivado
  - Atualiza flags `djen_synced`, `djen_last_sync`, `djen_has_data` no processo
- **Linha do Tempo do Processo**: agora busca do **banco local** (`djen_comunicacoes_local`) com anÃ¡lise IA jÃ¡ pronta pelo cron.
  - Abre instantaneamente sem precisar chamar OpenAI/Groq novamente
  - Fallback para DJEN direto se nÃ£o houver dados no banco
  - Novo mÃ©todo `fetchTimelineFromDatabase` no `processTimeline.service.ts`
- Fluxo completo: Cron diÃ¡rio â†’ Sincroniza DJEN â†’ Salva intimaÃ§Ãµes â†’ Analisa IA â†’ Atualiza processo â†’ Timeline pronta

## 1.1.80
- Edge Function `run-djen-sync`: agora executa **anÃ¡lise automÃ¡tica de IA** apÃ³s sincronizar intimaÃ§Ãµes do DJEN.
  - Busca atÃ© 50 intimaÃ§Ãµes sem anÃ¡lise
  - Chama OpenAI (gpt-4o-mini) para extrair: resumo, urgÃªncia, prazo, pontos-chave
  - Salva anÃ¡lise no campo `ai_analysis` da tabela `djen_comunicacoes_local`
  - Delay de 1.5s entre anÃ¡lises para respeitar rate limit
  - Requer `OPENAI_API_KEY` configurada nos secrets do Supabase
- Cron diÃ¡rio unificado: sincronizaÃ§Ã£o DJEN + anÃ¡lise IA em uma Ãºnica chamada

## 1.1.79
- Linha do Tempo (Processos): modal mais organizado e com visual mais premium:
  - Header com aÃ§Ã£o de atualizar e melhor alinhamento/spacing
  - Layout em 2 colunas com sidebar mais limpa e componentes com bordas arredondadas
  - Cards de eventos com hierarquia visual melhor e expansÃ£o mais legÃ­vel
- Linha do Tempo (Processos): correÃ§Ã£o de seguranÃ§a no filtro/busca quando `description` vem vazio.

## 1.1.78
- Linha do Tempo (Processos): redesign ultra-minimalista:
  - Sem cards, bordas ou sombras - apenas texto e espaÃ§o
  - Timeline dot mÃ­nimo (2px)
  - Data e tipo em linha Ãºnica discreta
  - TÃ­tulo como elemento principal
  - AÃ§Ãµes aparecem apenas quando expandido
  - ConteÃºdo expandido limpo e compacto

## 1.1.77
- Linha do Tempo (Processos): redesign completo dos cards com UI/UX mais limpo e humano:
  - Tipografia mais leve e hierarquia visual clara
  - Badges removidos, substituÃ­dos por texto sutil
  - Indicadores de urgÃªncia discretos (apenas quando necessÃ¡rio)
  - BotÃµes de aÃ§Ã£o como links minimalistas
  - Cards com bordas arredondadas e sombras suaves
  - EspaÃ§amento respirado e cores neutras

## 1.1.76
- Linha do Tempo (Processos): reduzida poluiÃ§Ã£o visual nos cards (badges mais discretos/compactos e aÃ§Ãµes em botÃµes outline menores).

## 1.1.75
- Processos: status do processo agora Ã© persistido **obrigatoriamente** conforme o subestÃ¡gio do mapa exibido na Linha do Tempo (ex.: ConciliaÃ§Ã£o/ContestaÃ§Ã£o/Recurso), garantindo consistÃªncia entre modal e lista.
- Build: correÃ§Ãµes de TypeScript para compatibilidade de tipos em Perfil/Requerimentos.

## 1.1.74
- Processos: ajustada ordem de prioridade na detecÃ§Ã£o automÃ¡tica de status. Agora "ConciliaÃ§Ã£o" tem prioridade sobre "ContestaÃ§Ã£o" e a detecÃ§Ã£o de ContestaÃ§Ã£o exige termos mais especÃ­ficos (evitando falsos positivos como "solicitou retificaÃ§Ã£o").

## 1.1.73
- Processos: adicionados **sub-estÃ¡gios** ao status do processo: CitaÃ§Ã£o, ConciliaÃ§Ã£o, ContestaÃ§Ã£o, InstruÃ§Ã£o e Recurso.
- IA agora detecta e atualiza automaticamente para o sub-estÃ¡gio correto baseado nos eventos da timeline.
- Novos badges coloridos para cada sub-estÃ¡gio na lista de processos.
- Migration SQL incluÃ­da para atualizar constraint do banco de dados.

## 1.1.72
- Processos: melhorada detecÃ§Ã£o de status pela IA. Agora prioriza os **eventos mais recentes** (Ãºltimos 5) e exige termos mais especÃ­ficos para "Arquivado" (ex.: "arquivamento definitivo", "autos arquivados"). Eventos como DecisÃ£o, IntimaÃ§Ã£o e CitaÃ§Ã£o agora corretamente detectam status "Em Andamento".

## 1.1.71
- Processos: corrigida lÃ³gica de atualizaÃ§Ã£o automÃ¡tica de status pela IA. Agora a anÃ¡lise pode **corrigir** status incorretos (ex.: "Arquivado" â†’ "Em Andamento"), nÃ£o apenas avanÃ§ar na hierarquia.

## 1.1.70
- Processos: corrigido status exibido no front apÃ³s anÃ¡lise/sincronizaÃ§Ã£o (DJEN/IA). Agora a atualizaÃ§Ã£o de status passa por `processService.updateStatus`, garantindo invalidaÃ§Ã£o de cache e recarregamento correto.

## 1.1.69
- Financeiro: separadores brilhantes agora aparecem entre parcelas no modo escuro quando existe mais de uma parcela.
- Linha discreta `via-white/15` com fade nas extremidades adiciona leitura entre cards.

## 1.1.68
- Financeiro: cartÃ£o de parcelas em atraso no dark mode agora usa gradiente vinho (#3f0b1d â†’ #09090b) alinhado ao tema.
- Badges/pÃ­lulas receberam `dark:bg-[#4c0e1f]` e texto claro para leitura segura.
- Indicador numÃ©rico usa `dark:bg-[#fb7185]` para manter o status visual.

## 1.1.67
- Financeiro: melhorado contraste do card vermelho (parcelas em atraso) no modo escuro.
- Fundo alterado de `dark:from-rose-500/15` para `dark:from-rose-500/30` com fundo zinc-800.
- Bordas e badges ajustados para melhor legibilidade em dark mode.

## 1.1.66
- Perfil: mÃ©tricas da aba "MÃ©tricas" com contraste alto (cards brancos, texto escuro).
- Corrigidas cores dos Ã­cones e labels para garantir visibilidade das estatÃ­sticas.
- Melhorias de acessibilidade e legibilidade no dashboard do perfil.

## 1.1.64
- Requerimentos/MS: textos oficiais atualizados para BPC LOAS.
- MS agora imprime:
  - "BenefÃ­cio de PrestaÃ§Ã£o Continuada (BPC/LOAS) Ã  Pessoa com DeficiÃªncia"
  - "BenefÃ­cio de PrestaÃ§Ã£o Continuada (BPC/LOAS) â€“ Idoso"
- Adequado para padrÃ£o do MinistÃ©rio da SaÃºde.

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
- Requerimentos/MS: saÃ­da do campo "Tipo/benefÃ­cio" ajustada para exibir descriÃ§Ãµes oficiais do BPC LOAS.
- MS agora imprime:
  - "BENEFÃ�CIO ASSISTENCIAL AO PORTADOR DE DEFICIÃŠNCIA"
  - "BenefÃ­cio de PrestaÃ§Ã£o Continuada-BPC LOAS IDOSO"
- Corrigido erro de constraint do banco removendo tipo legado.

## 1.1.60
- Requerimentos: template MS atualizado para novos tipos BPC LOAS.
- Placeholder [[BENEFICIO]] agora exibe labels corretos:
  - "BPC LOAS - DeficiÃªncia"
  - "BPC LOAS - Idoso"
- Adequado para saÃ­da no MinistÃ©rio da SaÃºde.

## 1.1.61
- Requerimentos/MS: saÃ­da do campo "Tipo/benefÃ­cio" ajustada para exibir descriÃ§Ãµes oficiais do BPC LOAS.
- Compatibilidade com registros antigos: tipo legado "bpc_loas" agora sai como "BENEFÃ�CIO ASSISTENCIAL AO PORTADOR DE DEFICIÃŠNCIA".

## 1.1.59
- Requerimentos: adequaÃ§Ã£o para BPC LOAS do MS.
- Separado BPC LOAS em duas categorias:
  - BPC LOAS - DeficiÃªncia
  - BPC LOAS - Idoso
- Atualizados tipos e labels para adequaÃ§Ã£o legal.
- BenefÃ­cios agora classificados corretamente para MS.

## 1.1.58
- Requerimentos: animaÃ§Ãµes premium nos Ã­cones de status.
- AnimaÃ§Ãµes pulse e bounce com drop-shadow para destaque.
- Aplicado tanto nas abas superiores quanto na tabela.
- Corrigidos erros TypeScript em Ã­cones Lucide.

## 1.1.57
- Requerimentos: removido loader fixo do status "Em AnÃ¡lise".
- Loader aparece apenas durante atualizaÃ§Ã£o de status.
- Status "Em AnÃ¡lise" agora exibe apenas Ã­cone Activity estÃ¡tico.

## 1.1.56
- Requerimentos: animaÃ§Ãµes adicionadas nos Ã­cones de status.
- Em ExigÃªncia: animate-pulse (Ã¢mbar)
- Aguardando PerÃ­cia: animate-bounce (ciano)
- Aguardando ConfecÃ§Ã£o: animate-pulse (Ã­ndigo)
- Deferidos: animate-pulse (verde)
- Em AnÃ¡lise: sem animaÃ§Ã£o (apenas loader)

## 1.1.55
- Requerimentos: Ã­cones restaurados na tabela de status.
- Ã�cones temÃ¡ticos agora visÃ­veis ao lado do select.
- Mantida identificaÃ§Ã£o visual clara dos status.

## 1.1.54
- Requerimentos: removido Ã­cone duplicado na tabela de status.
- Mantido apenas Ã­cone nas abas superiores para evitar poluiÃ§Ã£o visual.
- Layout mais limpo e profissional.

## 1.1.53
- Requerimentos: Ã­cones adicionados ao dropdown de status na tabela.
- Ã�cones temÃ¡ticos agora visÃ­veis ao lado de cada status.
- Melhor identificaÃ§Ã£o visual dos requerimentos.

## 1.1.52
- Requerimentos: redesign profissional das animaÃ§Ãµes de status.
- Removidas animaÃ§Ãµes complexas e gradientes excessivos.
- Visual limpo com cores sÃ³lidas e Ã­cones simples.
- Corrigidos bugs de renderizaÃ§Ã£o e TypeScript.
- Abas de status com hover suave e escala sutil.
- Dropdowns simplificados sem animaÃ§Ãµes que causavam bugs.

## 1.1.51
- Requerimentos: novas animaÃ§Ãµes e Ã­cones temÃ¡ticos para status.
- Em AnÃ¡lise: Ã­cone Activity com animaÃ§Ã£o pulse (1.6s).
- Aguardando PerÃ­cia: Ã­cone Microscope com animaÃ§Ã£o bounce (2.4s).
- Gradientes modernos em badges (amberâ†’orange, cyanâ†’blue, etc.).
- AnimaÃ§Ãµes mais suaves com shadow-lg e ring effects.
- Ã�cones mÃ©dicos e grÃ¡ficos para melhor identificaÃ§Ã£o visual.

## 1.1.50
- Requerimentos: visÃ£o geral reorganizada com cartÃµes e listas estruturadas.
- Layout limpo usando rounded-2xl, shadow-sm e divide-y para separar informaÃ§Ãµes.
- Corrigido erro de sintaxe (className sem =) e import Search adicionado.
- Visual mais profissional e menos poluÃ­do na aba de visÃ£o geral.

## 1.1.49
- Requerimentos: removida linha vertical que dividia as colunas do modal.
- Layout agora sem separador visual entre colunas esquerda e direita.
- Visual mais limpo e unificado entre informaÃ§Ãµes do cliente e do requerimento.
- EspaÃ§amento natural do grid jÃ¡ separa o conteÃºdo adequadamente.

## 1.1.48
- Requerimentos: removidas informaÃ§Ãµes duplicadas do header do modal.
- Header agora exibe apenas nome do beneficiÃ¡rio e protocolo.
- CPF e benefÃ­cio removidos do topo para evitar duplicaÃ§Ã£o.
- InformaÃ§Ãµes completas ficam apenas na visÃ£o geral.

## 1.1.47
- Requerimentos: removidas listas da visÃ£o geral, agora usa apenas separadores.
- Layout limpo com linhas horizontais (h-px) entre informaÃ§Ãµes.
- Separadores contextuais: Ã¢mbar para exigÃªncia, ciano para perÃ­cias.
- Visual mais limpo e organizado sem bordas em cada item.

## 1.1.46
- Requerimentos: colunas da visÃ£o geral invertidas.
- Coluna esquerda: informaÃ§Ãµes do cliente e processos vinculados.
- Coluna direita: informaÃ§Ãµes do requerimento (data, telefone, senha, protocolo, benefÃ­cio).
- Layout mais intuitivo com informaÃ§Ãµes do cliente em primeiro lugar.

## 1.1.45
- Requerimentos: adicionado separador visual entre colunas da visÃ£o geral.
- Linha vertical sutil (w-px) entre as duas colunas em desktop.
- Separador oculto em mobile (hidden lg:block) para manter layout responsivo.
- Melhora visual na distinÃ§Ã£o entre informaÃ§Ãµes do requerimento e do cliente.

## 1.1.44
- Requerimentos: visÃ£o geral organizada em duas colunas lado a lado.
- Coluna esquerda: informaÃ§Ãµes do requerimento (data, telefone, senha, protocolo, benefÃ­cio).
- Coluna direita: informaÃ§Ãµes do cliente (nome, CPF, telefone, benefÃ­cio) e processos vinculados.
- Layout responsivo com grid-cols-1 lg:grid-cols-2 para melhor aproveitamento de espaÃ§o.

## 1.1.43
- Requerimentos: visÃ£o geral organizada em layout linear (sem blocos).
- InformaÃ§Ãµes exibidas em formato de lista com bordas separadoras.
- Processos vinculados em cards simplificados e alinhados verticalmente.
- Layout mais limpo e fÃ¡cil de escanear visualmente.

## 1.1.42
- Requerimentos: modal de detalhes padronizado para seguir layout do sistema.
- Header agora usa faixa laranja e estrutura consistente com outros modais.
- BotÃ£o fechar movido para direita com estilo padrÃ£o do sistema.
- SubtÃ­tulo "Detalhes do Requerimento" e informaÃ§Ãµes reorganizadas.

## 1.1.41
- Requerimentos: layout da aba Notas invertido (conteÃºdo acima, input abaixo).
- Melhoria na UX para seguir padrÃ£o de apps de mensagens (conteÃºdo primeiro, campo de digitaÃ§Ã£o embaixo).

## 1.1.40
- Requerimentos: notas agora exibidas em ordem inversa (mais recentes primeiro).
- Melhoria na experiÃªncia de leitura ao ver as notas mais recentes no topo.

## 1.1.39
- Requerimentos: ObservaÃ§Ãµes movidas para uma aba dedicada ao lado de Notas no modal.
- Nova aba destaca o texto interno com Ã­cone NotebookPen e blocos organizados.
- Removido submenu anterior das observaÃ§Ãµes na aba VisÃ£o Geral para reduzir ruÃ­do.
- Mostra tambÃ©m a Ãºltima atualizaÃ§Ã£o do requerimento dentro da aba ObservaÃ§Ãµes.

## 1.1.38
- Requerimentos: visÃ£o geral do modal reorganizada com layout mais limpo.
- InformaÃ§Ãµes divididas em seÃ§Ãµes: "InformaÃ§Ãµes Principais" e "Processos Vinculados".
- ObservaÃ§Ãµes movidas para submenu com botÃ£o Exibir/Ocultar.
- BotÃ£o de observaÃ§Ãµes com Ã­cones Eye/EyeOff e estado showObservations.
- Layout mais espaÃ§ado com space-y-6 entre seÃ§Ãµes principais.
- TÃ­tulos de seÃ§Ã£o com text-sm font-semibold para melhor hierarquia.
- ObservaÃ§Ãµes em container destacado com background quando expandidas.
- Melhor organizaÃ§Ã£o visual e UX na aba "VisÃ£o Geral".

## 1.1.37
- Requerimentos: botÃµes do header de documentos (Ver docs/Gerar MS) refinados para visual mais premium e consistente.

## 1.1.36
- Requerimentos: modal de detalhes otimizado para ficar menos carregado (Notas/Status/Documentos recolhÃ­veis + composer de notas mais compacto).

## 1.1.35
- Requerimentos: HistÃ³rico de Notas agora permite registrar nova nota no estilo comentÃ¡rios (Instagram-like), com campo de texto e botÃ£o publicar.

## 1.1.34
- Requerimentos: melhorado destaque/visibilidade do botÃ£o "Gerar MS" na seÃ§Ã£o de documentos.

## 1.1.33
- Requerimentos: corrigido erro de interface que impedia abrir detalhes (Ã­cone Eye ausente).
- Requerimentos: histÃ³rico de notas ajustado para comentÃ¡rios estilo Instagram com avatar/foto, usuÃ¡rio, data/hora e resposta.

## 1.1.32
- Requerimentos: histÃ³rico de notas reformulado para estilo de chat (Instagram-like) com foto, nome, data e respostas.
- Requerimentos: botÃµes de aÃ§Ã£o do modal de detalhes reorganizados para melhor usabilidade e hierarquia visual.
- Requerimentos: botÃ£o "Gerar MS" agora possui fundo preto para destaque.

## 1.1.31
- Requerimentos: melhorado layout visual do modal de detalhes com seÃ§Ãµes agrupadas e Ã­cones.
- Requerimentos: organizadas informaÃ§Ãµes em cards com gradientes e cores distintas por categoria.
- Requerimentos: adicionados Ã­cones contextuais para melhor identificaÃ§Ã£o visual dos campos.
- Requerimentos: melhorada UX com layout responsivo e suporte a dark mode aprimorado.

## 1.1.30
- Requerimentos: histÃ³rico de status (auditoria) no modal de detalhes.
- Requerimentos: alertas de MS por nÃ­vel (30/60/90+) e filtro "Somente risco MS (90+)".
- Requerimentos: aÃ§Ãµes rÃ¡pidas no detalhe (voltar p/ Em anÃ¡lise, prazo de exigÃªncia, agendar perÃ­cia).

## 1.1.29
- Requerimentos: apÃ³s passar a Ãºltima perÃ­cia, o status retorna automaticamente para "Em anÃ¡lise".

## 1.1.28
- Requerimentos: modal "Registrar prazo para exigÃªncia" ajustado para fundo branco claro com faixa laranja.

## 1.1.27
- Requerimentos: tempo em anÃ¡lise (MS) agora considera a Ãºltima entrada em "Em anÃ¡lise" (reinicia ao reentrar).
- Agenda: log de exclusÃµes agrupado por dia (Hoje/Ontem/Data) para melhor leitura.

## 1.1.26
- Agenda: removida opÃ§Ã£o de limpar log; exibiÃ§Ã£o limitada aos Ãºltimos 30 dias.
- Requerimentos: agendar perÃ­cia mÃ©dica/social agora cria apenas compromisso na Agenda (sem prazo).

## 1.1.25
- Agenda: removida a opÃ§Ã£o de adicionar manualmente exclusÃµes no log (mantido apenas registro automÃ¡tico).

## 1.1.24
- Agenda: log de exclusÃµes agora permite adicionar manualmente exclusÃµes feitas anteriormente (ex.: hoje antes do log existir).

## 1.1.23
- Agenda: log persistente de exclusÃµes de compromissos com botÃ£o "Log" ao lado de "Filtros".

## 1.1.22
- Requerimentos: correÃ§Ã£o de layout para remover espaÃ§o vazio Ã  direita apÃ³s a coluna AÃ‡Ã•ES (tabela ocupa 100% do container).

## 1.0.97
- ExibiÃ§Ã£o padrÃ£o do mÃ³dulo de Assinaturas alterada para blocos (grid), mantendo a preferÃªncia do usuÃ¡rio no armazenamento local.

## 1.0.96
- CorreÃ§Ã£o robusta na geraÃ§Ã£o de URLs assinadas para imagens de selfie/assinatura no modal de detalhes, evitando erros 400 com tratamento especÃ­fico por bucket e logs detalhados para diagnÃ³stico.

## 1.0.95
- CorreÃ§Ã£o na geraÃ§Ã£o de URLs assinadas do modal de detalhes (normaliza caminhos vindos com prefixo do bucket, evitando erro 400 ao exibir selfie/assinatura no Supabase Storage).

## 1.0.94
- Ajuste no modal de detalhes do mÃ³dulo de Assinaturas para organizar os botÃµes de aÃ§Ã£o no desktop (Ver assinado / Baixar documento lado a lado e Excluir separado), evitando empilhamento.

## 1.0.93
- Ajuste no layout do modal de detalhes do mÃ³dulo de Assinaturas no desktop, organizando os botÃµes de aÃ§Ã£o em grid responsivo para evitar empilhamento e desconfiguraÃ§Ã£o.

## 1.0.92
- VersÃ£o anterior.

## Releases

### 1.9.399
- **Dashboard**: Corrigido backdrop dos modais para usar bg-transparent e forÃ§ar fundo branco com !bg-white no modo claro (removido backdrop escuro).

### 1.9.398
- **Dashboard**: Corrigido backdrop dos modais para usar bg-black/50 no modo claro (estava muito escuro com bg-slate-900/70).

### 1.9.397
- **Dashboard**: Modais de detalhes (Compromisso/IntimaÃ§Ã£o) adequados ao padrÃ£o do tema (overlay + blur, container com ring/shadow, fita laranja e header/footer padronizados).

### 1.9.287
- **PermissÃµes**: Menu/Feed agora respeitam `can_view` (permite ver) e a navegaÃ§Ã£o Ã© bloqueada quando o usuÃ¡rio nÃ£o possui permissÃ£o de visualizaÃ§Ã£o do mÃ³dulo.

### 1.9.286
- **Feed**: Widgets da coluna direita (incluindo "Prazos") agora aparecem tambÃ©m em telas menores (fora do breakpoint XL), garantindo visibilidade para Administrador.

### 1.9.285
- **Feed**: Widget "Prazos" agora mostra os 5 prÃ³ximos prazos por ordem de vencimento (nÃ£o apenas urgentes).

### 1.9.284
- **Dashboard**: Adicionado widget "Prazos Urgentes" na sidebar direita (abaixo do SaÃºde Financeira). Exibe prazos com vencimento em atÃ© 3 dias, com indicaÃ§Ã£o de atrasado/dias restantes.
- **Dashboard**: Barra de indicadores substituÃ­da por mÃ©tricas reais: Clientes, Processos, Requerimentos, Prazos, Tarefas (sem percentuais fictÃ­cios).
- **App**: Renomeado "Dashboard" para "Feed" no menu lateral e no tÃ­tulo do header.

### 1.9.42
- **Peticionamento (PrÃ©-visualizaÃ§Ã£o de Blocos)**: container do `docx-preview` agora permanece montado durante o carregamento (com overlay), evitando fallback e garantindo renderizaÃ§Ã£o correta por **parÃ¡grafos/pÃ¡ginas**.


