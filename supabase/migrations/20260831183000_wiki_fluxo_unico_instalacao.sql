-- Transforma a instalação do certificado remoto em um único fluxo contínuo.
-- Os artigos específicos permanecem disponíveis somente como consulta por assunto.

update public.wiki_categories
set
  name = 'Instalação completa',
  description = 'Um único passo a passo, do primeiro download até o teste no PJe.',
  updated_at = now()
where slug = 'primeiros-passos';

update public.wiki_articles
set
  title = 'Instalação completa para acessar o certificado digital A3',
  summary = 'Siga uma única página, na ordem: Cloudflare WARP, VirtualHere, token, SafeSign, PJeOffice e teste final no PJe. Não é necessário abrir outros manuais durante a instalação.',
  audience = 'Usuários de Windows e macOS',
  difficulty = 'Iniciante',
  estimated_minutes = 45,
  tags = array['instalação completa', 'certificado digital', 'token a3', 'windows', 'macos', 'warp', 'virtualhere', 'safesign', 'pjeoffice', 'pje'],
  body = $json${
    "version": 1,
    "introduction": "Este é o único manual que você precisa seguir para preparar um computador novo. Comece no passo 1 e continue nesta mesma página até o teste final no PJe. Os outros conteúdos da Central de ajuda são apenas para consulta ou solução de problemas.",
    "prerequisites": [
      "Use um computador com Windows 10/11 ou macOS 12 ou mais recente.",
      "Tenha a senha de administrador do computador para instalar programas.",
      "Tenha o Google Chrome instalado.",
      "Confirme que o e-mail pedro@advcuiaba.com está autorizado no Cloudflare Zero Trust. Quando outros usuários forem liberados, cada um deverá entrar com o próprio e-mail autorizado.",
      "Confirme com o escritório que o token GD Burti está conectado fisicamente ao servidor Linux.",
      "Não será necessário informar o PIN durante a instalação. O PIN só será pedido no teste final de assinatura."
    ],
    "sections": [
      {
        "id": "instalar-warp",
        "title": "Instale o Cloudflare One Client (WARP)",
        "paragraphs": [
          "O WARP cria a ligação privada com o servidor do escritório. Sem ele, o VirtualHere não consegue alcançar o token. Instale primeiro o WARP e deixe-o conectado durante todo o restante do procedimento."
        ],
        "steps": [
          {
            "title": "Abra a página oficial de download",
            "description": "Use o botão abaixo e procure o instalador do seu sistema operacional.",
            "action": "No Windows comum, baixe Windows x86-64/AMD64, em arquivo .msi. No Mac, baixe o instalador macOS, em arquivo .pkg.",
            "links": [
              {"label": "Baixar Cloudflare One Client", "href": "https://developers.cloudflare.com/cloudflare-one/team-and-resources/devices/cloudflare-one-client/download/", "description": "Página oficial para Windows e macOS"}
            ],
            "expected": "O instalador .msi, no Windows, ou .pkg, no Mac, aparecerá na pasta Downloads."
          },
          {
            "title": "Execute o instalador",
            "description": "Abra o arquivo que acabou de baixar.",
            "action": "Windows: dê dois cliques no .msi, aceite a pergunta de segurança e avance em Install/Finish. Mac: dê dois cliques no .pkg, avance em Continuar/Instalar e autorize com senha ou Touch ID. Se o Mac pedir permissão de VPN ou extensão de rede, aceite.",
            "expected": "O ícone da Cloudflare aparecerá perto do relógio no Windows ou na barra superior do Mac."
          },
          {
            "title": "Vincule o computador ao escritório",
            "description": "Abra o Cloudflare One Client e escolha a modalidade corporativa.",
            "action": "Escolha Zero Trust security. Quando aparecer Team name/Nome da equipe, digite somente equipe-jurius. Não digite https:// e não cole /warp.",
            "expected": "O navegador abrirá uma página da organização equipe-jurius.cloudflareaccess.com."
          },
          {
            "title": "Faça a autenticação",
            "description": "Entre no navegador com o e-mail autorizado pela política de matrícula.",
            "action": "Para o teste atual, use pedro@advcuiaba.com. Conclua a confirmação e permita que o navegador volte a abrir o Cloudflare One Client.",
            "expected": "O aplicativo mostrará a organização equipe-jurius."
          },
          {
            "title": "Ligue a conexão",
            "description": "Ative a chave principal do aplicativo e aguarde alguns segundos.",
            "action": "Deixe o Cloudflare One Client aberto em segundo plano. Se outra VPN estiver ligada e houver erro, desligue a outra VPN durante este teste.",
            "expected": "O estado ficará Connected/Conectado."
          }
        ],
        "notes": [
          {"type": "info", "title": "Sua navegação comum não passa pelo escritório", "text": "A configuração encaminha somente a rede privada necessária ao token. Sites, vídeos e demais acessos continuam usando a Internet normal do computador."},
          {"type": "warning", "title": "Enrollment request is invalid", "text": "Esse erro significa que o e-mail ainda não está associado a uma política Allow de Device Enrollment. O administrador deve liberar o e-mail no painel Zero Trust antes de continuar."}
        ]
      },
      {
        "id": "testar-rede-privada",
        "title": "Confirme que o servidor do token está acessível",
        "paragraphs": [
          "Faça este teste antes de instalar o VirtualHere. Assim você sabe que a rede privada está correta e evita confundir um problema de rede com um problema do token."
        ],
        "steps": [
          {
            "title": "Abra o terminal do seu computador",
            "description": "Windows: abra o menu Iniciar, digite PowerShell e abra o aplicativo. Mac: pressione Command + Espaço, digite Terminal e pressione Enter.",
            "action": "Copie somente o comando indicado para o seu sistema e pressione Enter.",
            "expected": "O teste precisa indicar que a porta TCP 7575 está acessível."
          }
        ],
        "commands": [
          {"label": "Windows — PowerShell", "value": "Test-NetConnection -ComputerName 10.254.75.75 -Port 7575", "expected": "A última linha mostra TcpTestSucceeded : True."},
          {"label": "macOS — Terminal", "value": "nc -vz 10.254.75.75 7575", "expected": "O Terminal mostra succeeded ou open."}
        ],
        "notes": [
          {"type": "warning", "title": "Se o teste falhar, pare aqui", "text": "Confirme que o WARP está Connected e que a equipe exibida é equipe-jurius. Se continuar falhando, o administrador deve verificar a rota privada 10.254.75.75/32 e o túnel do escritório."}
        ]
      },
      {
        "id": "instalar-virtualhere",
        "title": "Instale e configure o VirtualHere Client",
        "paragraphs": [
          "O VirtualHere fará o token físico do escritório aparecer no computador como se estivesse conectado a uma porta USB local."
        ],
        "steps": [
          {
            "title": "Baixe o cliente oficial",
            "description": "Abra a página do VirtualHere e escolha o cliente do seu sistema.",
            "action": "Windows: escolha o cliente 64-bit. Mac com processador Apple M1/M2/M3/M4: escolha Apple Silicon. Mac Intel: escolha Intel 64-bit.",
            "links": [
              {"label": "Baixar VirtualHere Client", "href": "https://www.virtualhere.com/usb_client_software", "description": "Página oficial para Windows e macOS"}
            ],
            "expected": "O programa VirtualHere Client será baixado."
          },
          {
            "title": "Abra e autorize o programa",
            "description": "Execute o VirtualHere Client. No Windows, confirme a pergunta de segurança. No Mac, mova para Aplicativos se solicitado e autorize o componente de sistema/USB.",
            "action": "Se o macOS pedir reinicialização depois de instalar o componente, reinicie, conecte novamente o WARP e reabra o VirtualHere.",
            "expected": "A janela VirtualHere Client exibirá o grupo USB Servers."
          },
          {
            "title": "Adicione o servidor privado",
            "description": "Na janela do VirtualHere, abra USB Servers e use a opção Specify Hubs/Especificar hubs.",
            "action": "Adicione exatamente 10.254.75.75:7575 e confirme. Não use token.jurius-api.com nesse campo: o acesso USB utiliza o endereço privado protegido pelo WARP.",
            "expected": "Aparecerá Jurius Token Office e, abaixo dele, StarSign CUT S."
          }
        ],
        "notes": [
          {"type": "info", "title": "Portal do token", "text": "O endereço token.jurius-api.com é o portal de status e apoio. Ele não substitui o hub privado 10.254.75.75:7575 dentro do VirtualHere."}
        ],
        "links": [
          {"label": "Abrir portal do token", "href": "https://token.jurius-api.com/", "description": "Status e apoio do serviço"}
        ]
      },
      {
        "id": "conectar-token",
        "title": "Conecte o token neste computador",
        "steps": [
          {
            "title": "Localize StarSign CUT S",
            "description": "Expanda Jurius Token Office dentro do VirtualHere Client.",
            "action": "Clique com o botão direito em StarSign CUT S e escolha Use this device/Usar este dispositivo.",
            "expected": "O VirtualHere indicará que o dispositivo está em uso por este computador."
          },
          {
            "title": "Aguarde o sistema reconhecer o USB",
            "description": "Na primeira conexão, Windows ou macOS pode levar alguns segundos para preparar o dispositivo.",
            "action": "Não retire o token do servidor e não feche o WARP ou o VirtualHere.",
            "expected": "O sistema não apresenta erro de USB e StarSign CUT S permanece conectado a este computador."
          }
        ],
        "notes": [
          {"type": "warning", "title": "Somente uma pessoa por vez", "text": "O token é um único dispositivo físico. Se ele estiver sendo usado por outra pessoa, aguarde a liberação. Ao terminar sua assinatura, libere o dispositivo no VirtualHere."},
          {"type": "danger", "title": "Server trial has expired", "text": "Esse aviso é de licença do VirtualHere Server no escritório. Não reinstale o cliente e não altere a rede: o administrador precisa regularizar a licença do servidor."}
        ]
      },
      {
        "id": "instalar-safesign",
        "title": "Instale o SafeSign e confira o certificado",
        "paragraphs": [
          "O SafeSign é o driver que permite ao computador ler o certificado gravado no token GD Burti. Faça esta instalação com o token já conectado pelo VirtualHere."
        ],
        "steps": [
          {
            "title": "Abra a página de drivers",
            "description": "Acesse a página de suporte e procure GD StarSign/StarSign Crypto ou o modelo indicado para o token.",
            "action": "Baixe a versão correspondente ao Windows ou ao macOS. No Mac, confira se o instalador atende Apple Silicon ou Intel conforme o seu computador.",
            "links": [
              {"label": "Baixar SafeSign para o token", "href": "https://suporte.certisign.com.br/duvidas-suporte/downloads/tokens", "description": "Drivers organizados por token e sistema"}
            ],
            "expected": "O instalador do SafeSign será baixado."
          },
          {
            "title": "Instale o SafeSign",
            "description": "Feche o PJeOffice e o Chrome antes de executar o instalador.",
            "action": "Abra o instalador, aceite as permissões e conclua todas as etapas. Reinicie o computador se for solicitado; depois da reinicialização, reconecte o WARP e o token no VirtualHere.",
            "expected": "O aplicativo SafeSign TokenAdmin ficará disponível no computador."
          },
          {
            "title": "Confira o certificado no TokenAdmin",
            "description": "Abra SafeSign TokenAdmin com StarSign CUT S ainda conectado no VirtualHere.",
            "action": "Selecione o token e confira o nome do titular e a data de validade. Não digite o PIN apenas para visualizar essas informações.",
            "expected": "O certificado A3 do titular aparece dentro do SafeSign TokenAdmin."
          }
        ],
        "notes": [
          {"type": "warning", "title": "Se o certificado não aparecer", "text": "Feche o TokenAdmin, libere e conecte novamente StarSign CUT S no VirtualHere e reabra o TokenAdmin. Confirme também que instalou o driver correspondente ao seu sistema e processador."}
        ]
      },
      {
        "id": "instalar-pjeoffice",
        "title": "Instale e abra o PJeOffice Pro",
        "steps": [
          {
            "title": "Baixe o PJeOffice Pro",
            "description": "Abra a página oficial e escolha seu sistema operacional.",
            "action": "Windows: escolha o instalador Windows. Mac: escolha Mac Intel ou Apple Silicon de acordo com o processador do computador.",
            "links": [
              {"label": "Baixar PJeOffice Pro", "href": "https://pjeoffice.trf3.jus.br/pjeoffice-pro/docs/userguide.html", "description": "Página oficial com instaladores"}
            ],
            "expected": "O instalador correto será baixado."
          },
          {
            "title": "Faça a instalação",
            "description": "Execute o arquivo e aceite as permissões solicitadas pelo sistema.",
            "action": "Conclua a instalação e abra o PJeOffice Pro somente depois que o SafeSign já estiver instalado e o token estiver conectado no VirtualHere.",
            "expected": "O ícone do PJeOffice Pro aparecerá perto do relógio no Windows ou na barra superior do Mac."
          },
          {
            "title": "Confirme o certificado",
            "description": "Abra as configurações do PJeOffice Pro e consulte os certificados disponíveis.",
            "action": "Se o certificado não aparecer, feche completamente o PJeOffice, confirme o certificado no SafeSign TokenAdmin e abra o PJeOffice novamente.",
            "expected": "O PJeOffice Pro mostra o mesmo certificado e titular exibidos no SafeSign."
          }
        ]
      },
      {
        "id": "testar-no-pje",
        "title": "Faça o primeiro teste no PJe",
        "paragraphs": [
          "Agora o caminho inteiro está pronto. Faça primeiro um login ou assinatura de teste, de preferência em ambiente de homologação ou em uma operação que possa ser cancelada."
        ],
        "steps": [
          {
            "title": "Confira os quatro programas",
            "description": "Antes de abrir o PJe, confirme a sequência local.",
            "action": "WARP deve estar Connected; VirtualHere deve mostrar StarSign CUT S em uso por você; SafeSign deve mostrar o certificado; PJeOffice Pro deve estar aberto.",
            "expected": "Todos os quatro itens estão ativos e sem mensagem de erro."
          },
          {
            "title": "Abra o PJe no Chrome",
            "description": "Acesse o endereço oficial do tribunal e escolha Certificado Digital.",
            "action": "Se o navegador pedir autorização para abrir o PJeOffice Pro, permita. Selecione o certificado do titular correto.",
            "expected": "Uma janela nativa do SafeSign ou do PJeOffice solicitará o PIN."
          },
          {
            "title": "Digite o PIN somente na janela segura",
            "description": "Confira se a janela pertence ao SafeSign ou ao PJeOffice antes de digitar.",
            "action": "Nunca informe o PIN no CRM, na extensão, em formulário do navegador, mensagem, ligação ou suporte remoto.",
            "expected": "O PJe conclui o login ou a assinatura e mostra a confirmação da operação."
          }
        ],
        "notes": [
          {"type": "success", "title": "Instalação concluída", "text": "Se o PJe concluiu a operação, este computador está preparado para utilizar o certificado remoto."},
          {"type": "danger", "title": "Não repita o PIN várias vezes", "text": "Se o PIN for recusado, pare e confirme o código correto. Tentativas sucessivas podem bloquear o token."}
        ]
      },
      {
        "id": "liberar-token",
        "title": "Libere o token ao terminar",
        "steps": [
          {
            "title": "Espere a confirmação do PJe",
            "description": "Não libere o token enquanto a janela do PIN, a assinatura ou o protocolo ainda estiver em andamento.",
            "action": "Aguarde o PJe mostrar que o login, assinatura ou protocolo foi concluído.",
            "expected": "Não existe mais operação pendente no PJe."
          },
          {
            "title": "Pare de usar o dispositivo",
            "description": "Volte ao VirtualHere Client e clique com o botão direito em StarSign CUT S.",
            "action": "Escolha Stop using this device/Parar de usar este dispositivo. Se a extensão Jurius já oferecer o botão Liberar token, você também poderá usá-lo.",
            "expected": "O token volta a aparecer como disponível para outra pessoa."
          }
        ],
        "notes": [
          {"type": "info", "title": "Nos próximos dias", "text": "A instalação é feita uma vez. No uso diário, basta conectar o WARP, usar o token no VirtualHere, abrir o PJeOffice, assinar e liberar o token ao terminar."}
        ]
      },
      {
        "id": "onde-procurar-ajuda",
        "title": "Se alguma etapa não funcionar",
        "paragraphs": [
          "Pare exatamente na etapa que falhou. Volte à Central de ajuda e pesquise o nome que aparece na tela, como WARP, Enrollment, VirtualHere, trial expired, SafeSign ou PJeOffice. Os tópicos abaixo do fluxo principal servem para diagnóstico; eles não fazem parte da sequência normal de instalação."
        ],
        "checklist": [
          "WARP não conecta: pesquise WARP ou Enrollment.",
          "Porta 7575 falha: pesquise rede privada ou servidor.",
          "Jurius Token Office não aparece: pesquise VirtualHere.",
          "Token está com outra pessoa: aguarde a liberação.",
          "Certificado não aparece: pesquise SafeSign.",
          "PJe não pede o PIN: pesquise PJeOffice."
        ]
      }
    ]
  }$json$::jsonb,
  sort_order = 1,
  updated_at = now()
where slug = 'comece-aqui-token-remoto';

update public.wiki_articles
set
  title = case slug
    when 'instalar-cloudflare-one-client-warp' then 'Cloudflare WARP: referência, reinstalação e erros'
    when 'instalar-configurar-virtualhere-client' then 'VirtualHere: referência, configuração e reconexão'
    when 'instalar-validar-safesign-gd-burti' then 'SafeSign: referência e certificado não reconhecido'
    when 'instalar-pjeoffice-pro-testar-pje' then 'PJeOffice Pro: referência e problemas no PJe'
    else title
  end,
  updated_at = now()
where slug in (
  'instalar-cloudflare-one-client-warp',
  'instalar-configurar-virtualhere-client',
  'instalar-validar-safesign-gd-burti',
  'instalar-pjeoffice-pro-testar-pje'
);
