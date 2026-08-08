-- Pré-cadastro: nome de exibição + telefone de quem falou no WhatsApp e ainda
-- não é cliente. Mora em `clients` de propósito — prazos, agenda, documentos,
-- links com acompanhamento e assinaturas são todos chaveados por clients.id, e
-- uma tabela paralela obrigaria a duplicar esse encanamento inteiro. A linha
-- existe para pendurar trabalho; o que a distingue é só esta coluna, que a tira
-- da lista de clientes, da busca global e das estatísticas.
-- Virar cliente é apagar a marca: nada precisa ser movido de lugar.
alter table public.clients
  add column if not exists is_pre_cadastro boolean not null default false;

comment on column public.clients.is_pre_cadastro is
  'Pré-cadastro criado no atendimento (nome + telefone). Não conta como cliente: fica fora da lista, da busca e das estatísticas do módulo Clientes até ser promovido.';

-- Só os pré-cadastros são consultados por esta coluna; índice parcial basta.
create index if not exists idx_clients_pre_cadastro
  on public.clients (is_pre_cadastro)
  where is_pre_cadastro;
