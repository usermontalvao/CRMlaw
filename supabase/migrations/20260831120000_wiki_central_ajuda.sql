-- Central de ajuda do CRM: categorias e artigos estruturados.
-- A equipe autenticada pode ler; a escrita fica reservada a migrations/service_role.

create table public.wiki_categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text not null check (length(trim(name)) between 2 and 80),
  description text not null default '',
  icon_key text not null default 'start',
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.wiki_articles (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.wiki_categories(id) on delete restrict,
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  title text not null check (length(trim(title)) between 4 and 180),
  summary text not null check (length(trim(summary)) between 10 and 500),
  audience text not null default 'Equipe do escritório',
  difficulty text not null default 'Iniciante',
  estimated_minutes integer not null default 10 check (estimated_minutes between 1 and 240),
  tags text[] not null default '{}',
  body jsonb not null check (jsonb_typeof(body) = 'object'),
  sort_order integer not null default 0,
  is_published boolean not null default false,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index wiki_articles_category_order_idx
  on public.wiki_articles (category_id, sort_order)
  where is_published is true;

create index wiki_articles_tags_idx on public.wiki_articles using gin (tags);

alter table public.wiki_categories enable row level security;
alter table public.wiki_articles enable row level security;

revoke all on table public.wiki_categories from public, anon, authenticated;
revoke all on table public.wiki_articles from public, anon, authenticated;
grant select on table public.wiki_categories to authenticated;
grant select on table public.wiki_articles to authenticated;
grant select, insert, update, delete on table public.wiki_categories to service_role;
grant select, insert, update, delete on table public.wiki_articles to service_role;

create policy wiki_categories_equipe_le
  on public.wiki_categories for select to authenticated
  using ((select auth.uid()) is not null and (select public.is_office_staff()));

create policy wiki_articles_equipe_le_publicados
  on public.wiki_articles for select to authenticated
  using (
    (select auth.uid()) is not null
    and (select public.is_office_staff())
    and is_published is true
  );

comment on table public.wiki_categories is
  'Assuntos da Central de ajuda do CRM. Leitura exclusiva da equipe interna autenticada.';
comment on table public.wiki_articles is
  'Manuais estruturados em JSON seguro para renderização no CRM. Sem HTML executável.';
comment on column public.wiki_articles.body is
  'Formato v1: introduction, prerequisites e sections com steps, commands, checklist, notes e links.';

insert into public.wiki_categories (id, slug, name, description, icon_key, sort_order) values
  ('10000000-0000-4000-8000-000000000001', 'primeiros-passos', 'Primeiros passos', 'Por onde começar e o que preparar antes da instalação.', 'start', 10),
  ('10000000-0000-4000-8000-000000000002', 'rede-e-acesso', 'Rede e acesso', 'Cloudflare Zero Trust, WARP e acesso privado ao escritório.', 'network', 20),
  ('10000000-0000-4000-8000-000000000003', 'certificado-e-pje', 'Certificado e PJe', 'VirtualHere, SafeSign, PJeOffice Pro e certificado A3.', 'certificate', 30),
  ('10000000-0000-4000-8000-000000000004', 'rotinas', 'Rotinas', 'Procedimentos de uso diário e liberação do token.', 'routine', 40),
  ('10000000-0000-4000-8000-000000000005', 'solucao-de-problemas', 'Solução de problemas', 'Diagnóstico explicado para os erros mais frequentes.', 'troubleshooting', 50),
  ('10000000-0000-4000-8000-000000000006', 'seguranca', 'Segurança', 'Regras para proteger o PIN, a chave privada e o servidor.', 'security', 60)
on conflict (slug) do update set
  name = excluded.name,
  description = excluded.description,
  icon_key = excluded.icon_key,
  sort_order = excluded.sort_order,
  is_active = true,
  updated_at = now();

insert into public.wiki_articles (
  id, category_id, slug, title, summary, audience, difficulty,
  estimated_minutes, tags, body, sort_order, is_published, published_at
) values (
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'comece-aqui-token-remoto',
  'Comece aqui: o que instalar para usar o token remoto',
  'Uma visão simples do processo inteiro, com a ordem correta das instalações e uma lista do que precisa estar pronto.',
  'Todos os usuários', 'Iniciante', 8,
  array['começar', 'token', 'certificado', 'checklist', 'ordem de instalação'],
  $json${
    "version": 1,
    "introduction": "Se esta é a primeira vez que você vai usar o certificado remoto, comece por este manual. Você não precisa entender redes ou servidores: siga a ordem indicada e só avance quando a confirmação verde de cada etapa aparecer.",
    "prerequisites": [
      "Um computador com Windows 10/11 ou macOS 12 ou mais recente.",
      "Permissão para instalar programas no computador.",
      "Acesso ao e-mail autorizado no Cloudflare. No MVP: pedro@advcuiaba.com.",
      "Chrome instalado e acesso ao CRM Jurius.",
      "O token precisa estar fisicamente conectado no servidor do escritório."
    ],
    "sections": [
      {
        "id": "entenda-o-fluxo",
        "title": "Entenda o fluxo em linguagem simples",
        "paragraphs": [
          "O token não sai do escritório. O Cloudflare cria uma passagem privada entre o seu computador e o servidor. O VirtualHere usa essa passagem para apresentar o token como uma conexão USB local. SafeSign lê o certificado e o PJeOffice entrega a assinatura ao PJe.",
          "A ordem é importante: primeiro a rede WARP, depois o VirtualHere, depois o SafeSign e por último o PJeOffice."
        ],
        "checklist": [
          "Cloudflare One Client/WARP conectado à equipe equipe-jurius.",
          "VirtualHere Client mostrando Jurius Token Office.",
          "SafeSign TokenAdmin mostrando o certificado.",
          "PJeOffice Pro aberto e reconhecendo o certificado.",
          "Extensão Jurius mostrando rede e servidor online."
        ]
      },
      {
        "id": "ordem-correta",
        "title": "Siga esta ordem",
        "steps": [
          {"title": "Instale o Cloudflare One Client", "description": "Ele também é chamado de WARP. É o programa que dá acesso à rede privada do escritório.", "action": "Abra o manual Instalar Cloudflare One Client (WARP) e escolha as instruções do seu sistema.", "expected": "O aplicativo exibirá Connected/Conectado e a equipe equipe-jurius."},
          {"title": "Instale o VirtualHere Client", "description": "É o programa que fará o token USB aparecer no seu computador.", "action": "Adicione o hub 10.254.75.75:7575 em USB Servers → Specify Hubs.", "expected": "A lista mostrará Jurius Token Office e StarSign CUT S."},
          {"title": "Instale o SafeSign", "description": "É o driver/gerenciador do certificado GD Burti.", "action": "Depois de conectar o token no VirtualHere, abra o SafeSign TokenAdmin.", "expected": "O certificado e a validade aparecerão no TokenAdmin."},
          {"title": "Instale o PJeOffice Pro", "description": "É o aplicativo oficial que conversa com o PJe e faz a assinatura.", "action": "Abra o PJeOffice somente depois que o token estiver conectado.", "expected": "O certificado aparecerá nas configurações do PJeOffice."},
          {"title": "Faça o teste no PJe", "description": "Abra o PJe no Chrome e escolha Certificado Digital.", "action": "Use um ambiente ou documento de homologação antes de uma assinatura real.", "expected": "O PJe solicitará o certificado e depois o PIN em uma janela do SafeSign/PJeOffice."}
        ]
      },
      {
        "id": "regras-importantes",
        "title": "Regras importantes",
        "notes": [
          {"type": "danger", "title": "Nunca informe o PIN dentro do CRM ou da extensão", "text": "O PIN só deve ser digitado em uma janela nativa do SafeSign ou do PJeOffice. A extensão não armazena PIN."},
          {"type": "warning", "title": "Um computador por vez", "text": "O token é físico. Quando terminar, clique em Liberar token para que a próxima pessoa consiga utilizá-lo."},
          {"type": "info", "title": "Sua Internet normal não passa pelo escritório", "text": "O WARP foi configurado para encaminhar somente o endereço 10.254.75.75/32. Sites, vídeos e demais serviços continuam usando sua conexão normal."}
        ]
      }
    ]
  }$json$::jsonb,
  10, true, now()
)
on conflict (slug) do update set
  category_id = excluded.category_id, title = excluded.title, summary = excluded.summary,
  audience = excluded.audience, difficulty = excluded.difficulty,
  estimated_minutes = excluded.estimated_minutes, tags = excluded.tags,
  body = excluded.body, sort_order = excluded.sort_order,
  is_published = true, published_at = coalesce(public.wiki_articles.published_at, now()), updated_at = now();

insert into public.wiki_articles (
  id, category_id, slug, title, summary, audience, difficulty,
  estimated_minutes, tags, body, sort_order, is_published, published_at
) values (
  '20000000-0000-4000-8000-000000000006',
  '10000000-0000-4000-8000-000000000004',
  'usar-assinar-liberar-token',
  'Uso diário: conectar, assinar e liberar o token',
  'A rotina curta para usar o certificado com segurança e deixá-lo disponível para a próxima pessoa.',
  'Todos os usuários', 'Iniciante', 7,
  array['rotina', 'conectar token', 'liberar token', 'pje', 'pin'],
  $json${
    "version": 1,
    "introduction": "Depois que os programas estiverem instalados, o uso diário é simples. Siga sempre esta ordem para evitar que o PJeOffice seja aberto antes do certificado aparecer.",
    "prerequisites": [
      "Cloudflare One Client, VirtualHere Client, SafeSign e PJeOffice Pro já instalados.",
      "Extensão Jurius instalada no Chrome.",
      "Token disponível e conectado fisicamente no escritório."
    ],
    "sections": [
      {
        "id": "conectar",
        "title": "Conecte o token",
        "steps": [
          {"title": "Ligue o WARP", "description": "Clique no ícone da Cloudflare e deixe o estado como Connected/Conectado.", "action": "Se pedir nova autenticação, use seu e-mail autorizado.", "expected": "A extensão Jurius mostrará Rede do escritório: Conectada."},
          {"title": "Abra os programas locais", "description": "Abra VirtualHere Client e depois o PJeOffice Pro. O SafeSign pode ficar em segundo plano.", "action": "Não digite PIN nesta etapa.", "expected": "Servidor USB aparece online e PJeOffice aparece ativo na extensão."},
          {"title": "Abra a extensão Jurius", "description": "Clique no ícone da extensão do Chrome e aguarde a verificação.", "action": "Confira Rede conectada, Servidor online e Token disponível. Clique uma vez em Conectar token.", "expected": "O estado muda para Token GD Burti: Neste PC."}
        ]
      },
      {
        "id": "assinar",
        "title": "Use o certificado no PJe",
        "steps": [
          {"title": "Abra o PJe", "description": "Entre no site oficial do tribunal e acione o login ou assinatura por Certificado Digital.", "action": "Selecione o certificado do titular correto.", "expected": "A janela segura do SafeSign/PJeOffice solicitará o PIN."},
          {"title": "Digite o PIN", "description": "Confira o nome do aplicativo antes de digitar.", "action": "Digite o PIN somente na janela nativa do SafeSign ou PJeOffice. Nunca escreva no CRM, extensão, WhatsApp ou navegador.", "expected": "O PJe conclui o login/assinatura e exibe a confirmação."},
          {"title": "Renove se a operação demorar", "description": "A reserva padrão dura cinco minutos para evitar esquecimento.", "action": "Se ainda estiver trabalhando e o tempo estiver terminando, clique em Renovar na extensão.", "expected": "O contador volta ao início sem desconectar o token."}
        ]
      },
      {
        "id": "liberar",
        "title": "Libere para a próxima pessoa",
        "steps": [
          {"title": "Confirme o fim da assinatura", "description": "Espere o PJe mostrar que o documento foi assinado ou protocolado.", "action": "Não libere enquanto a janela do PIN ou o envio ainda estiver em andamento.", "expected": "O PJe mostra sucesso e não há operação pendente."},
          {"title": "Clique em Liberar token", "description": "Abra a extensão Jurius.", "action": "Clique em Liberar token e aguarde a atualização.", "expected": "O estado muda de Neste PC para Disponível."}
        ],
        "notes": [
          {"type": "success", "title": "Pronto para outra pessoa", "text": "Assim que o estado ficar Disponível, outro computador autorizado poderá clicar em Conectar token."},
          {"type": "warning", "title": "Não feche o computador no meio da assinatura", "text": "Se precisar sair, termine ou cancele o fluxo do PJe, libere o token e só depois feche a tampa ou desligue o computador."}
        ]
      }
    ]
  }$json$::jsonb,
  60, true, now()
)
on conflict (slug) do update set
  category_id = excluded.category_id, title = excluded.title, summary = excluded.summary,
  audience = excluded.audience, difficulty = excluded.difficulty,
  estimated_minutes = excluded.estimated_minutes, tags = excluded.tags,
  body = excluded.body, sort_order = excluded.sort_order,
  is_published = true, published_at = coalesce(public.wiki_articles.published_at, now()), updated_at = now();

insert into public.wiki_articles (
  id, category_id, slug, title, summary, audience, difficulty,
  estimated_minutes, tags, body, sort_order, is_published, published_at
) values (
  '20000000-0000-4000-8000-000000000007',
  '10000000-0000-4000-8000-000000000005',
  'corrigir-problemas-token-remoto',
  'Resolver problemas do WARP, VirtualHere, SafeSign e PJeOffice',
  'Diagnóstico em ordem: descubra exatamente em qual etapa a conexão parou antes de reinstalar programas.',
  'Usuários e suporte', 'Iniciante', 18,
  array['erro', 'offline', 'trial expired', 'em uso', 'warp', 'safesign', 'pjeoffice'],
  $json${
    "version": 1,
    "introduction": "Não reinstale tudo de uma vez. Comece pela rede e avance na ordem. Quando uma etapa falhar, corrija somente ela e repita o teste.",
    "prerequisites": ["Anote a mensagem exata do erro.", "Se possível, tire uma captura de tela.", "Não faça várias tentativas de PIN."],
    "sections": [
      {
        "id": "rede",
        "title": "1º teste: a rede privada funciona?",
        "steps": [
          {"title": "Confira o WARP", "description": "Abra o Cloudflare One Client.", "action": "Confirme Connected/Conectado e equipe-jurius. Se estiver desconectado, ligue novamente.", "expected": "A extensão mostra Rede do escritório: Conectada."},
          {"title": "Teste a porta", "description": "Use o comando do seu sistema abaixo.", "action": "Se o resultado falhar, não mexa no SafeSign ou PJeOffice ainda; o problema está antes deles.", "expected": "A porta 7575 responde com sucesso."}
        ],
        "commands": [
          {"label": "Windows — PowerShell", "value": "Test-NetConnection -ComputerName 10.254.75.75 -Port 7575", "expected": "TcpTestSucceeded : True"},
          {"label": "Mac — Terminal", "value": "nc -vz 10.254.75.75 7575", "expected": "succeeded ou open"}
        ],
        "notes": [
          {"type": "warning", "title": "Enrollment request is invalid", "text": "O administrador deve associar a policy de Device Enrollment e incluir o e-mail exato. Não tente criar uma equipe diferente."},
          {"type": "warning", "title": "WARP conectado, mas porta fechada", "text": "O administrador deve verificar rota CIDR 10.254.75.75/32, Split Tunnel, tunnel Healthy, firewall e VirtualHere Listening."}
        ]
      },
      {
        "id": "virtualhere",
        "title": "2º teste: o VirtualHere vê o token?",
        "steps": [
          {"title": "Confira o servidor", "description": "Abra VirtualHere Client e expanda USB Servers.", "action": "Se Jurius Token Office não aparecer, adicione 10.254.75.75:7575 em Specify Hubs.", "expected": "Jurius Token Office aparece com ponto verde."},
          {"title": "Confira StarSign CUT S", "description": "Expanda o servidor.", "action": "Se não aparecer, o administrador deve verificar se o token continua fisicamente conectado e se lsusb mostra 1059:0019.", "expected": "StarSign CUT S aparece na lista."},
          {"title": "Veja se está em uso", "description": "Uma indicação In use by another user significa que outro computador possui o USB.", "action": "Peça para a pessoa clicar em Liberar token ou aguarde a reserva expirar.", "expected": "O dispositivo volta a ficar disponível."}
        ],
        "notes": [
          {"type": "warning", "title": "This server trial has expired", "text": "O administrador precisa recriar a stack sem NetworkInterface/TCPPort avançados ou instalar uma licença válida do VirtualHere."}
        ]
      },
      {
        "id": "safesign",
        "title": "3º teste: o SafeSign lê o certificado?",
        "steps": [
          {"title": "Conecte no VirtualHere", "description": "O USB precisa estar marcado como usado neste computador.", "action": "Feche e abra novamente o SafeSign TokenAdmin depois da conexão.", "expected": "TokenAdmin mostra o certificado."},
          {"title": "Confira o middleware", "description": "Se o token aparece como USB, mas não no TokenAdmin, o driver pode ser incompatível.", "action": "Confirme versão do Windows/macOS, arquitetura e pacote SafeSign fornecido pela certificadora.", "expected": "Nome, titular e validade aparecem no TokenAdmin."}
        ],
        "notes": [{"type": "danger", "title": "Não formate o token", "text": "Inicializar ou formatar pode apagar o certificado. Não use essas opções como tentativa de correção."}]
      },
      {
        "id": "pjeoffice",
        "title": "4º teste: o PJeOffice encontra o certificado?",
        "steps": [
          {"title": "Valide primeiro no TokenAdmin", "description": "Se o SafeSign não vê, o PJeOffice também não verá.", "action": "Só avance quando o certificado aparecer no TokenAdmin.", "expected": "SafeSign validado."},
          {"title": "Reabra o PJeOffice", "description": "O PJeOffice pode ter sido aberto antes do token.", "action": "Encerre completamente o PJeOffice, conecte o token e abra o PJeOffice novamente.", "expected": "O certificado aparece nas configurações."},
          {"title": "Recarregue o PJe", "description": "Depois que o PJeOffice reconhecer, volte ao Chrome.", "action": "Recarregue a página do PJe e clique novamente em Certificado Digital.", "expected": "A lista de certificados e a janela de PIN aparecem."}
        ]
      }
    ]
  }$json$::jsonb,
  70, true, now()
)
on conflict (slug) do update set
  category_id = excluded.category_id, title = excluded.title, summary = excluded.summary,
  audience = excluded.audience, difficulty = excluded.difficulty,
  estimated_minutes = excluded.estimated_minutes, tags = excluded.tags,
  body = excluded.body, sort_order = excluded.sort_order,
  is_published = true, published_at = coalesce(public.wiki_articles.published_at, now()), updated_at = now();

insert into public.wiki_articles (
  id, category_id, slug, title, summary, audience, difficulty,
  estimated_minutes, tags, body, sort_order, is_published, published_at
) values (
  '20000000-0000-4000-8000-000000000008',
  '10000000-0000-4000-8000-000000000002',
  'administrar-servidor-cloudflare-token',
  'Administrador: servidor Linux, Portainer e Cloudflare Zero Trust',
  'Implantação e validação da infraestrutura privada que entrega o token aos computadores autorizados.',
  'Administradores de TI', 'Avançado', 35,
  array['servidor', 'linux', 'portainer', 'docker', 'cloudflare zero trust', 'rota cidr', 'firewall'],
  $json${
    "version": 1,
    "introduction": "Este manual é para quem administra o servidor. Usuários comuns não precisam executar estes comandos. A porta 7575 jamais deve ser publicada na Internet.",
    "prerequisites": ["Acesso ao Portainer do escritório.", "Acesso administrativo ao Cloudflare Zero Trust.", "Token conectado fisicamente no Linux.", "Repositório do Token Bridge disponível no Git."],
    "sections": [
      {
        "id": "usb",
        "title": "Confirme o token no Linux",
        "commands": [{"label": "Servidor Linux", "value": "lsusb", "expected": "ID 1059:0019 Giesecke & Devrient GmbH StarSign CUT S"}],
        "notes": [{"type": "warning", "title": "VID/PID exato", "text": "A variável deve ser VH_ALLOWED_DEVICES=1059/0019. Não use o exemplo fictício 1234/abcd e não omita o zero inicial."}]
      },
      {
        "id": "portainer",
        "title": "Implante a stack no Portainer",
        "steps": [
          {"title": "Crie a stack pelo Git", "description": "No Portainer, abra Stacks → Add stack e selecione o repositório do Token Bridge.", "action": "Use docker-compose.yml como Compose path, pois o arquivo está na raiz do projeto.", "expected": "O Portainer consegue carregar e validar o compose."},
          {"title": "Cadastre as variáveis", "description": "Informe VH_ALLOWED_DEVICES=1059/0019. Se o profile cloudflared for usado, grave CLOUDFLARE_TUNNEL_TOKEN somente no Portainer.", "action": "Nunca faça commit do token do Cloudflare.", "expected": "A stack inicia sem usar valores fictícios."},
          {"title": "Verifique os serviços", "description": "Aguarde network-init e virtualhere.", "action": "Confira saúde e logs dos containers jurius-token-network-init e jurius-token-virtualhere.", "expected": "Os logs mostram Listening at TCP port 7575, Found [1059:0019] e VirtualHere USB Server is running."}
        ]
      },
      {
        "id": "cloudflare-admin",
        "title": "Configure o Cloudflare Zero Trust",
        "links": [
          {"label": "Abrir Cloudflare Zero Trust", "href": "https://one.dash.cloudflare.com/", "description": "Painel administrativo"},
          {"label": "Manual oficial de rota CIDR", "href": "https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/private-net/cloudflared/connect-cidr/", "description": "Cloudflare Tunnel private network"},
          {"label": "Manual oficial de matrícula", "href": "https://developers.cloudflare.com/cloudflare-one/team-and-resources/devices/cloudflare-one-client/deployment/device-enrollment/", "description": "Device enrollment policies"}
        ],
        "steps": [
          {"title": "Confirme o Tunnel", "description": "No painel Zero Trust, abra Networks → Tunnels e localize o túnel do escritório.", "action": "O connector precisa estar Healthy antes de criar a rota.", "expected": "Status Healthy com conexão recente."},
          {"title": "Crie a rota privada", "description": "Em Networks → Routes → CIDR, crie 10.254.75.75/32 e selecione o túnel do escritório e a rede virtual padrão.", "action": "Anuncie somente o /32, não a rede inteira.", "expected": "A rota aparece ativa e associada ao túnel correto."},
          {"title": "Configure Split Tunnel", "description": "No perfil WARP aplicado à equipe, use Include para 10.254.75.75/32.", "action": "Confirme que o perfil foi realmente atribuído aos usuários de teste.", "expected": "Somente o destino do token usa WARP."},
          {"title": "Associe a policy de matrícula", "description": "Em Device enrollment permissions, crie uma policy Allow e associe-a ao enrollment.", "action": "Inclua pedro@advcuiaba.com no MVP ou um grupo gerenciado. Não use connection_rules de RDP.", "expected": "O computador conclui a matrícula sem Enrollment request is invalid."},
          {"title": "Restrinja a rede", "description": "Crie uma policy de rede permitindo somente usuários/dispositivos autorizados para destino 10.254.75.75, TCP, porta 7575.", "action": "Abaixo dela, bloqueie o mesmo destino para os demais usuários.", "expected": "Somente a equipe autorizada alcança a porta."}
        ]
      },
      {
        "id": "firewall",
        "title": "Confirme que não existe exposição pública",
        "commands": [{"label": "Servidor Linux", "value": "ip address show jurius-token\nnft list table inet jurius_token\nss -lntp | grep ':7575'", "expected": "IP 10.254.75.75/32 presente; loopback permitido; demais interfaces bloqueadas."}],
        "checklist": ["Nenhum ports: 7575 no Docker Compose.", "Nenhum port-forward 7575 no roteador.", "Nenhum Public Hostname tcp://10.254.75.75:7575.", "Teste funciona com WARP ligado e falha com WARP desligado."]
      }
    ]
  }$json$::jsonb,
  80, true, now()
)
on conflict (slug) do update set
  category_id = excluded.category_id, title = excluded.title, summary = excluded.summary,
  audience = excluded.audience, difficulty = excluded.difficulty,
  estimated_minutes = excluded.estimated_minutes, tags = excluded.tags,
  body = excluded.body, sort_order = excluded.sort_order,
  is_published = true, published_at = coalesce(public.wiki_articles.published_at, now()), updated_at = now();

insert into public.wiki_articles (
  id, category_id, slug, title, summary, audience, difficulty,
  estimated_minutes, tags, body, sort_order, is_published, published_at
) values (
  '20000000-0000-4000-8000-000000000009',
  '10000000-0000-4000-8000-000000000006',
  'seguranca-certificado-a3-remoto',
  'Segurança do certificado A3 remoto',
  'O que a solução protege, o que nunca deve ser armazenado e quais configurações são proibidas.',
  'Todos os usuários', 'Iniciante', 10,
  array['segurança', 'pin', 'chave privada', 'pfx', 'firewall', 'acesso'],
  $json${
    "version": 1,
    "introduction": "A segurança depende de manter a chave dentro do token, restringir a rede e controlar o tempo de uso. Nenhuma conveniência justifica copiar o PIN ou publicar o VirtualHere.",
    "sections": [
      {
        "id": "nunca-fazer",
        "title": "Nunca faça isto",
        "notes": [
          {"type": "danger", "title": "Não extraia a chave privada", "text": "Não converta o certificado A3 em PFX e não tente copiar o conteúdo criptográfico do token."},
          {"type": "danger", "title": "Não armazene o PIN", "text": "Não salve no CRM, extensão, navegador, companion, servidor, arquivo, planilha ou gerenciador compartilhado."},
          {"type": "danger", "title": "Não publique a porta 7575", "text": "Sem Public Hostname, sem port-forward e sem ports no Compose. O tráfego deve existir somente na rota privada WARP."},
          {"type": "danger", "title": "Não formate o token", "text": "Opções de inicialização ou formatação podem apagar o certificado e exigir nova emissão."}
        ]
      },
      {
        "id": "controles",
        "title": "Controles obrigatórios",
        "checklist": [
          "Rota Cloudflare limitada a 10.254.75.75/32.",
          "Policy de rede limitada a TCP/7575 e usuários autorizados.",
          "Firewall do Linux aceitando a porta apenas pelo loopback.",
          "VirtualHere permitindo somente 1059/0019.",
          "Reserva temporária e botão Liberar token.",
          "WARP, VirtualHere, SafeSign e PJeOffice atualizados.",
          "Teste regular comprovando que a porta falha fora do WARP."
        ]
      },
      {
        "id": "pin",
        "title": "Como reconhecer uma solicitação legítima de PIN",
        "steps": [
          {"title": "Confira a janela", "description": "Ela deve pertencer ao SafeSign/TokenAdmin ou ao PJeOffice Pro.", "action": "Se o campo estiver dentro de uma página do navegador, extensão ou CRM, não digite.", "expected": "O nome do aplicativo aparece na barra/título da janela nativa."},
          {"title": "Confira o momento", "description": "O PIN só é esperado quando você escolhe o certificado para autenticar ou assinar.", "action": "Se aparecer fora desse momento, cancele e peça suporte.", "expected": "A solicitação corresponde a uma ação que você acabou de iniciar."},
          {"title": "Evite bloqueio", "description": "Se não tiver certeza do PIN, pare.", "action": "Não faça tentativas sequenciais. Procure o responsável pelo certificado.", "expected": "O token permanece desbloqueado."}
        ]
      }
    ]
  }$json$::jsonb,
  90, true, now()
)
on conflict (slug) do update set
  category_id = excluded.category_id, title = excluded.title, summary = excluded.summary,
  audience = excluded.audience, difficulty = excluded.difficulty,
  estimated_minutes = excluded.estimated_minutes, tags = excluded.tags,
  body = excluded.body, sort_order = excluded.sort_order,
  is_published = true, published_at = coalesce(public.wiki_articles.published_at, now()), updated_at = now();

insert into public.wiki_articles (
  id, category_id, slug, title, summary, audience, difficulty,
  estimated_minutes, tags, body, sort_order, is_published, published_at
) values (
  '20000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000003',
  'instalar-configurar-virtualhere-client',
  'Instalar o VirtualHere e fazer o token aparecer no computador',
  'Guia para Windows e Mac com o endereço correto do servidor, o primeiro teste e a forma segura de liberar o dispositivo.',
  'Usuários do token', 'Iniciante', 15,
  array['virtualhere', 'usb', 'hub', 'windows', 'mac', 'token'],
  $json${
    "version": 1,
    "introduction": "O VirtualHere Client é o programa que transforma o token do escritório em um USB visível no seu computador. Ele só funcionará quando o Cloudflare WARP estiver conectado.",
    "prerequisites": [
      "Cloudflare One Client mostrando Connected/Conectado.",
      "Teste de 10.254.75.75:7575 concluído com sucesso.",
      "Nenhum outro computador usando o token no momento."
    ],
    "sections": [
      {
        "id": "download",
        "title": "Baixe o cliente correto",
        "steps": [
          {"title": "Abra o site oficial", "description": "Use o botão abaixo para acessar a página do fabricante.", "links": [{"label": "Baixar VirtualHere Client", "href": "https://www.virtualhere.com/usb_client_software", "description": "Página oficial para Windows e macOS"}], "expected": "A página exibirá seções separadas para Windows e macOS."},
          {"title": "Escolha sua versão", "description": "Windows comum usa x86_64. Windows ARM usa ARM64. No Mac, use a versão Intel/Apple Silicon indicada para macOS 12 ou posterior.", "action": "Baixe o cliente, não o VirtualHere Server. O servidor já está instalado no escritório.", "expected": "O aplicativo VirtualHere Client ficará disponível no computador."}
        ]
      },
      {
        "id": "primeira-abertura",
        "title": "Abra e autorize o VirtualHere",
        "steps": [
          {"title": "Execute o aplicativo", "description": "No Windows, abra o arquivo baixado. No Mac, mova-o para Aplicativos se solicitado e depois abra.", "action": "Aceite a instalação do driver USB ou das permissões do sistema quando a janela oficial aparecer.", "expected": "Uma janela chamada VirtualHere Client abrirá com o item USB Servers."},
          {"title": "Adicione o servidor do escritório", "description": "Clique com o botão direito em USB Servers. No Mac, use control + clique se não tiver botão direito.", "action": "Escolha Specify Hubs, clique em Add e digite exatamente 10.254.75.75:7575. Confirme com OK.", "expected": "Abaixo de USB Servers aparecerá Jurius Token Office com um ponto verde."},
          {"title": "Localize o token", "description": "Clique na seta ao lado de Jurius Token Office para expandir a lista.", "action": "Procure o dispositivo StarSign CUT S.", "expected": "O nome StarSign CUT S ficará visível e sem mensagem de erro."}
        ],
        "notes": [
          {"type": "danger", "title": "Não use o domínio público como hub", "text": "O endereço correto é 10.254.75.75:7575. token.jurius-api.com é apenas o portal HTTPS de apoio/status e não transporta o USB."}
        ]
      },
      {
        "id": "teste-manual",
        "title": "Faça o primeiro teste manual",
        "steps": [
          {"title": "Conecte o dispositivo", "description": "Clique com o botão direito em StarSign CUT S.", "action": "Escolha Use this device. Aguarde alguns segundos sem clicar novamente.", "expected": "O nome do dispositivo ficará em destaque/uso e o sistema poderá emitir o som de USB conectado."},
          {"title": "Confirme no sistema", "description": "No Windows, abra o Gerenciador de Dispositivos. No Mac, abra Informações do Sistema → USB.", "action": "Procure StarSign, Giesecke & Devrient ou um dispositivo de cartão inteligente/token.", "expected": "O token aparecerá como hardware conectado ao computador."},
          {"title": "Libere depois do teste", "description": "Volte ao VirtualHere e clique com o botão direito no token.", "action": "Escolha Stop using this device.", "expected": "O token voltará a ficar disponível para outro computador."}
        ],
        "notes": [
          {"type": "warning", "title": "Um usuário por vez", "text": "Se aparecer In use by another user, aguarde a pessoa liberar. Não reinicie o servidor durante uma assinatura."},
          {"type": "warning", "title": "This server trial has expired", "text": "Avise o administrador. A stack precisa ser atualizada para não usar parâmetros avançados da edição gratuita ou deve receber uma licença válida conforme os termos do VirtualHere."}
        ]
      },
      {
        "id": "confirmacao",
        "title": "Confirme antes de instalar o SafeSign",
        "checklist": [
          "Jurius Token Office aparece com ponto verde.",
          "StarSign CUT S aparece abaixo do servidor.",
          "Use this device conecta o USB sem erro.",
          "Stop using this device libera o token novamente."
        ]
      }
    ]
  }$json$::jsonb,
  30, true, now()
)
on conflict (slug) do update set
  category_id = excluded.category_id, title = excluded.title, summary = excluded.summary,
  audience = excluded.audience, difficulty = excluded.difficulty,
  estimated_minutes = excluded.estimated_minutes, tags = excluded.tags,
  body = excluded.body, sort_order = excluded.sort_order,
  is_published = true, published_at = coalesce(public.wiki_articles.published_at, now()), updated_at = now();

insert into public.wiki_articles (
  id, category_id, slug, title, summary, audience, difficulty,
  estimated_minutes, tags, body, sort_order, is_published, published_at
) values (
  '20000000-0000-4000-8000-000000000004',
  '10000000-0000-4000-8000-000000000003',
  'instalar-validar-safesign-gd-burti',
  'Instalar o SafeSign e conferir o certificado GD Burti',
  'Como escolher o middleware correto, abrir o TokenAdmin e confirmar o certificado sem arriscar bloqueio do PIN.',
  'Usuários do token', 'Iniciante', 18,
  array['safesign', 'tokenadmin', 'gd burti', 'starsign', 'driver', 'certificado'],
  $json${
    "version": 1,
    "introduction": "SafeSign é o middleware que sabe conversar com o token criptográfico GD Burti. O VirtualHere conecta o USB; o SafeSign interpreta o certificado guardado nele.",
    "prerequisites": [
      "VirtualHere Client instalado e mostrando StarSign CUT S.",
      "Token conectado por Use this device ou pelo botão Conectar token da extensão.",
      "Versão e arquitetura do Windows/macOS conhecidas.",
      "PIN disponível, mas ele não será necessário para apenas visualizar o certificado."
    ],
    "sections": [
      {
        "id": "escolha-driver",
        "title": "Escolha o driver correto",
        "paragraphs": ["A autoridade certificadora que emitiu seu certificado deve fornecer o middleware homologado. Se houver dúvida, confirme com o suporte da certificadora antes de instalar."],
        "steps": [
          {"title": "Abra a página de suporte", "description": "A referência abaixo organiza downloads por modelo de token e sistema operacional.", "links": [{"label": "Drivers SafeSign / GD Burti", "href": "https://suporte.certisign.com.br/duvidas-suporte/downloads/tokens", "description": "Referência por modelo e sistema"}], "expected": "A página exibirá GD Starsign/StarSign Crypto e opções para Windows ou macOS."},
          {"title": "Confirme o sistema", "description": "No Windows, verifique se é 64 bits ou ARM. No Mac, confira a versão do macOS e se o processador é Intel ou Apple Silicon.", "action": "Baixe somente a versão declarada compatível com seu sistema. Em caso de certificado emitido por outra autoridade, prefira o link fornecido por ela.", "expected": "O instalador correto ficará na pasta Downloads."},
          {"title": "Remova conflitos antigos se necessário", "description": "Versões antigas ou middleware de outro token podem causar conflito.", "action": "Só desinstale uma versão anterior se o instalador oficial recomendar ou se o suporte confirmar. Reinicie o computador depois da remoção.", "expected": "Haverá apenas a versão do SafeSign compatível com o token em uso."}
        ]
      },
      {
        "id": "instalacao",
        "title": "Instale o SafeSign",
        "steps": [
          {"title": "Feche os programas de assinatura", "description": "Feche Chrome, PJeOffice Pro e SafeSign TokenAdmin antes de começar.", "action": "O VirtualHere pode permanecer aberto, mas libere o token durante a instalação.", "expected": "Nenhum programa estará usando a biblioteca do certificado."},
          {"title": "Execute o instalador", "description": "Abra o arquivo baixado e siga o assistente.", "action": "No Windows, permita alterações. No Mac, autorize o pacote nas configurações de Privacidade e Segurança se o sistema solicitar.", "expected": "A instalação termina sem erro e o SafeSign TokenAdmin aparece nos aplicativos."},
          {"title": "Reinicie o computador", "description": "Drivers criptográficos costumam ser carregados no início do sistema.", "action": "Salve seu trabalho e reinicie, mesmo que o instalador não obrigue.", "expected": "Após reiniciar, TokenAdmin abre normalmente."}
        ]
      },
      {
        "id": "validacao",
        "title": "Confira o certificado no TokenAdmin",
        "steps": [
          {"title": "Conecte o token remoto", "description": "Ligue o WARP e use o token no VirtualHere.", "action": "Só depois de StarSign CUT S ficar conectado, abra o SafeSign TokenAdmin.", "expected": "TokenAdmin mostrará um token ou cartão no painel."},
          {"title": "Abra os objetos do token", "description": "Expanda o token sem escolher opções de inicialização ou formatação.", "action": "Selecione o certificado e confira nome, CPF/CNPJ, emissor e data de validade.", "expected": "Os dados do titular aparecem e a validade não está vencida."},
          {"title": "Feche sem alterar o token", "description": "Esta etapa é apenas leitura.", "action": "Feche o TokenAdmin. Não altere PIN, não inicialize e não formate o dispositivo.", "expected": "O certificado permanece íntegro e pronto para o PJeOffice."}
        ],
        "notes": [
          {"type": "danger", "title": "Cuidado com o PIN", "text": "Não tente adivinhar. Tokens A3 bloqueiam após um número limitado de tentativas erradas. Visualizar o certificado no TokenAdmin normalmente não exige PIN."}
        ]
      }
    ]
  }$json$::jsonb,
  40, true, now()
)
on conflict (slug) do update set
  category_id = excluded.category_id, title = excluded.title, summary = excluded.summary,
  audience = excluded.audience, difficulty = excluded.difficulty,
  estimated_minutes = excluded.estimated_minutes, tags = excluded.tags,
  body = excluded.body, sort_order = excluded.sort_order,
  is_published = true, published_at = coalesce(public.wiki_articles.published_at, now()), updated_at = now();

insert into public.wiki_articles (
  id, category_id, slug, title, summary, audience, difficulty,
  estimated_minutes, tags, body, sort_order, is_published, published_at
) values (
  '20000000-0000-4000-8000-000000000005',
  '10000000-0000-4000-8000-000000000003',
  'instalar-pjeoffice-pro-testar-pje',
  'Instalar o PJeOffice Pro e fazer a primeira assinatura no PJe',
  'Download oficial, escolha correta para Windows/Mac, ordem de abertura e teste completo com certificado digital.',
  'Usuários do PJe', 'Iniciante', 20,
  array['pjeoffice', 'pje', 'assinatura', 'windows', 'mac', 'certificado digital'],
  $json${
    "version": 1,
    "introduction": "O PJeOffice Pro é o aplicativo oficial que recebe a solicitação do site do PJe e usa o certificado apresentado pelo SafeSign. Ele deve ser aberto depois que o token já estiver conectado.",
    "prerequisites": [
      "WARP conectado e VirtualHere mostrando o token neste computador.",
      "SafeSign TokenAdmin mostrando corretamente o certificado.",
      "Chrome atualizado.",
      "Permissão para instalar aplicativos.",
      "Um ambiente ou documento de homologação para o primeiro teste."
    ],
    "sections": [
      {
        "id": "download",
        "title": "Baixe a versão oficial",
        "steps": [
          {"title": "Abra a página do PJeOffice Pro", "description": "Use somente a página oficial mantida pelo projeto do PJeOffice Pro.", "links": [{"label": "Baixar PJeOffice Pro", "href": "https://pjeoffice.trf3.jus.br/pjeoffice-pro/docs/userguide.html", "description": "Windows, Linux, Mac Intel e Apple Silicon"}], "expected": "A página mostrará uma tabela com instaladores por sistema e arquitetura."},
          {"title": "Escolha a arquitetura", "description": "Windows comum usa 64 bits. No Mac, Intel e Apple Silicon possuem instaladores diferentes.", "action": "No Mac, abra menu Apple → Sobre Este Mac. Se aparecer Apple M1/M2/M3/M4 ou posterior, escolha Apple Silicon; se aparecer Intel, escolha Intel.", "expected": "O instalador correspondente será baixado."}
        ]
      },
      {
        "id": "instalacao",
        "title": "Instale e abra na ordem correta",
        "steps": [
          {"title": "Instale o PJeOffice Pro", "description": "Execute o arquivo baixado e siga o assistente.", "action": "No Windows, autorize alterações. No Mac, mova para Aplicativos e permita a abertura em Privacidade e Segurança se solicitado.", "expected": "O ícone do PJeOffice Pro aparecerá no sistema."},
          {"title": "Conecte o token primeiro", "description": "Ligue WARP, abra VirtualHere e conecte StarSign CUT S.", "action": "Confirme o certificado no TokenAdmin antes de continuar.", "expected": "SafeSign mostra o certificado normalmente."},
          {"title": "Abra o PJeOffice Pro", "description": "Agora abra o PJeOffice e aguarde o ícone aparecer próximo ao relógio ou na barra do Mac.", "action": "Abra as configurações de certificado e procure o certificado do titular.", "expected": "O certificado aparece sem necessidade de instalar Java externo."}
        ],
        "notes": [
          {"type": "info", "title": "Não instale Java para corrigir o PJeOffice Pro", "text": "A versão Pro inclui seu próprio Java homologado. Instalar ou atualizar o Java do sistema normalmente não muda o funcionamento do PJeOffice Pro."}
        ]
      },
      {
        "id": "teste-pje",
        "title": "Faça o primeiro teste no PJe",
        "steps": [
          {"title": "Abra o PJe no Chrome", "description": "Acesse o endereço oficial do tribunal desejado e aguarde a tela de login.", "action": "Mantenha PJeOffice Pro, SafeSign, VirtualHere e WARP abertos.", "expected": "A opção Certificado Digital estará disponível."},
          {"title": "Clique em Certificado Digital", "description": "O navegador tentará conversar com o PJeOffice Pro.", "action": "Se aparecer uma confirmação do PJeOffice, autorize desta vez ou sempre apenas se o domínio for o PJe oficial do tribunal.", "expected": "Uma lista de certificados será apresentada."},
          {"title": "Escolha o certificado", "description": "Confira o nome e o CPF/CNPJ antes de selecionar.", "action": "Selecione o certificado correto e prossiga. Digite o PIN somente na janela do SafeSign/PJeOffice.", "expected": "O PJe concluirá o login ou a assinatura sem erro."},
          {"title": "Teste uma assinatura de homologação", "description": "Antes de protocolar algo real, assine um documento de teste ou use o fluxo de homologação disponível.", "action": "Confirme que a assinatura aparece como válida e que o PJe registra a operação.", "expected": "Documento assinado e confirmação exibida pelo PJe."}
        ]
      },
      {
        "id": "fim-teste",
        "title": "Finalize corretamente",
        "steps": [
          {"title": "Feche o fluxo do PJe", "description": "Confirme que a assinatura terminou e que não há janela de PIN aberta.", "action": "Volte à extensão Jurius e clique em Liberar token.", "expected": "O token volta a aparecer como disponível para a próxima pessoa."}
        ]
      }
    ]
  }$json$::jsonb,
  50, true, now()
)
on conflict (slug) do update set
  category_id = excluded.category_id, title = excluded.title, summary = excluded.summary,
  audience = excluded.audience, difficulty = excluded.difficulty,
  estimated_minutes = excluded.estimated_minutes, tags = excluded.tags,
  body = excluded.body, sort_order = excluded.sort_order,
  is_published = true, published_at = coalesce(public.wiki_articles.published_at, now()), updated_at = now();

insert into public.wiki_articles (
  id, category_id, slug, title, summary, audience, difficulty,
  estimated_minutes, tags, body, sort_order, is_published, published_at
) values (
  '20000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000002',
  'instalar-cloudflare-one-client-warp',
  'Instalar e conectar o Cloudflare One Client (WARP)',
  'Passo a passo completo para Windows e macOS, desde o download até o teste da rota privada do escritório.',
  'Usuários do token', 'Iniciante', 20,
  array['cloudflare', 'zero trust', 'warp', 'windows', 'mac', 'instalação', 'rede privada'],
  $json${
    "version": 1,
    "introduction": "O Cloudflare One Client, anteriormente chamado WARP, cria a conexão privada com o escritório. Instale este programa antes do VirtualHere. Você não precisa configurar IP manualmente no computador.",
    "prerequisites": [
      "Tenha a senha de administrador do Windows ou do Mac para autorizar a instalação.",
      "Confirme que seu e-mail foi autorizado pelo administrador do Cloudflare. No MVP: pedro@advcuiaba.com.",
      "Feche outras VPNs durante o primeiro teste para evitar conflito de rota.",
      "Nome da equipe que será solicitado: equipe-jurius."
    ],
    "sections": [
      {
        "id": "links-oficiais",
        "title": "Abra os links oficiais",
        "paragraphs": ["Use somente os endereços oficiais abaixo. Não baixe instaladores enviados por grupos ou sites desconhecidos."],
        "links": [
          {"label": "Abrir Cloudflare Zero Trust", "href": "https://one.dash.cloudflare.com/", "description": "Painel administrativo oficial"},
          {"label": "Baixar Cloudflare One Client", "href": "https://developers.cloudflare.com/cloudflare-one/team-and-resources/devices/cloudflare-one-client/download/", "description": "Instaladores oficiais para Windows e macOS"},
          {"label": "Manual oficial de instalação", "href": "https://developers.cloudflare.com/cloudflare-one/team-and-resources/devices/cloudflare-one-client/deployment/manual-deployment/", "description": "Documentação da Cloudflare"}
        ]
      },
      {
        "id": "windows",
        "title": "Instalação no Windows",
        "steps": [
          {"title": "Abra a página de download", "description": "Clique em Baixar Cloudflare One Client na seção anterior. Na página, procure o título Windows.", "action": "Na maioria dos computadores, escolha a versão Windows x86-64/AMD64. Escolha ARM64 somente se o Windows informar que o processador é ARM.", "expected": "Um arquivo com extensão .msi será baixado."},
          {"title": "Execute o instalador", "description": "Abra a pasta Downloads e dê dois cliques no arquivo Cloudflare_WARP...msi.", "action": "Se o Windows perguntar se você permite alterações, clique em Sim. Avance com Next/Install e depois Finish.", "expected": "O ícone de nuvem da Cloudflare aparecerá próximo ao relógio. Talvez seja necessário clicar na seta de ícones ocultos."},
          {"title": "Escolha Zero Trust security", "description": "Abra o ícone da Cloudflare. Na primeira tela, selecione Zero Trust security, não a opção de uso pessoal/consumer.", "action": "Quando aparecer Team name ou Nome da equipe, digite exatamente equipe-jurius, sem https, sem espaços e sem /warp.", "expected": "O navegador abrirá uma página em equipe-jurius.cloudflareaccess.com."},
          {"title": "Faça a matrícula", "description": "Na página aberta pelo navegador, escolha o método de autenticação disponível e entre com o e-mail autorizado.", "action": "Use pedro@advcuiaba.com no MVP. Conclua a confirmação e aceite o botão para abrir o Cloudflare One Client novamente.", "expected": "A página exibirá sucesso e o aplicativo mostrará a organização equipe-jurius."},
          {"title": "Ligue a conexão", "description": "No aplicativo da Cloudflare, deixe a chave principal ligada.", "action": "Aguarde alguns segundos sem fechar o aplicativo.", "expected": "O estado mudará para Connected/Conectado."}
        ],
        "commands": [
          {"label": "Teste no PowerShell do Windows", "value": "Test-NetConnection -ComputerName 10.254.75.75 -Port 7575", "expected": "A última linha deve mostrar TcpTestSucceeded : True."}
        ],
        "notes": [
          {"type": "info", "title": "Como abrir o PowerShell", "text": "Clique no menu Iniciar, digite PowerShell e abra Windows PowerShell ou Terminal. Cole o comando e pressione Enter."}
        ]
      },
      {
        "id": "macos",
        "title": "Instalação no macOS",
        "steps": [
          {"title": "Abra a página de download", "description": "Clique em Baixar Cloudflare One Client e procure a seção macOS.", "action": "Baixe a versão estável indicada pela Cloudflare. O instalador é compatível com os Macs suportados pela página.", "expected": "Um arquivo .pkg será salvo em Downloads."},
          {"title": "Instale o aplicativo", "description": "Abra Downloads e dê dois cliques no arquivo .pkg.", "action": "Clique em Continuar e Instalar. Digite a senha do Mac ou use Touch ID quando solicitado. Autorize extensões de rede se o macOS pedir.", "expected": "O ícone da Cloudflare aparecerá na barra superior do Mac."},
          {"title": "Escolha Zero Trust security", "description": "Clique no ícone da Cloudflare e escolha Zero Trust security.", "action": "No campo Team name, digite exatamente equipe-jurius, sem a URL completa.", "expected": "O navegador abrirá equipe-jurius.cloudflareaccess.com."},
          {"title": "Autentique o computador", "description": "Entre usando o e-mail autorizado pela política de matrícula.", "action": "Use pedro@advcuiaba.com no MVP. Ao final, clique em Open Cloudflare One Client/Abrir.", "expected": "O aplicativo mostrará equipe-jurius e a confirmação de matrícula."},
          {"title": "Ligue a conexão", "description": "Ative a chave principal e aguarde.", "action": "Se o macOS pedir nova autorização de VPN/rede, aceite usando a senha ou Touch ID.", "expected": "O estado mudará para Connected/Conectado."}
        ],
        "commands": [
          {"label": "Teste da rota no Terminal do Mac", "value": "route -n get 10.254.75.75\nnc -vz 10.254.75.75 7575", "expected": "O primeiro comando deve mostrar uma interface utun. O segundo deve informar succeeded ou open."}
        ],
        "notes": [
          {"type": "info", "title": "Como abrir o Terminal", "text": "Pressione Command + Espaço, digite Terminal e pressione Enter. Cole os comandos um por vez."}
        ]
      },
      {
        "id": "erros-matricula",
        "title": "Se a matrícula não funcionar",
        "notes": [
          {"type": "warning", "title": "Enrollment request is invalid", "text": "Não é erro de senha do computador. O administrador precisa associar uma política Allow ao Device Enrollment e incluir o e-mail exato usado no login."},
          {"type": "warning", "title": "Nome da equipe não encontrado", "text": "Digite apenas equipe-jurius. Não cole https://equipe-jurius.cloudflareaccess.com/warp no campo Team name."},
          {"type": "danger", "title": "Não crie uma conta pessoal WARP", "text": "O acesso ao token depende do modo Zero Trust e da equipe do escritório. O modo pessoal não recebe a rota 10.254.75.75/32."}
        ]
      },
      {
        "id": "confirmacao-final",
        "title": "Confirmação antes de avançar",
        "checklist": [
          "O aplicativo mostra Connected/Conectado.",
          "A organização exibida é equipe-jurius.",
          "O teste da porta 7575 retorna sucesso.",
          "Com o WARP desligado, o mesmo teste deixa de funcionar.",
          "A navegação comum continua usando a Internet normal do computador."
        ]
      }
    ]
  }$json$::jsonb,
  20, true, now()
)
on conflict (slug) do update set
  category_id = excluded.category_id, title = excluded.title, summary = excluded.summary,
  audience = excluded.audience, difficulty = excluded.difficulty,
  estimated_minutes = excluded.estimated_minutes, tags = excluded.tags,
  body = excluded.body, sort_order = excluded.sort_order,
  is_published = true, published_at = coalesce(public.wiki_articles.published_at, now()), updated_at = now();
