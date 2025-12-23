# Changelog

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
