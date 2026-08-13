# jurius.com.br - Sistema de Gestão para Escritórios de Advocacia

Sistema completo de CRM desenvolvido especificamente para escritórios de advocacia, com foco em gestão de clientes, processos e agenda.

Documentação operacional: [Manual dos agentes de IA do WhatsApp](docs/WHATSAPP_AI_AGENTS.md).

## 🚀 Funcionalidades

### Módulo de Clientes (Implementado)
- ✅ Cadastro completo de clientes (Pessoa Física e Jurídica)
- ✅ Listagem com filtros avançados
- ✅ Busca por nome, CPF/CNPJ ou email
- ✅ Visualização detalhada de informações
- ✅ Edição e atualização de dados
- ✅ Gestão de status (Ativo, Inativo, Suspenso)
- ✅ Dashboard com estatísticas
- ✅ Interface moderna e responsiva

### Módulos Futuros
- 🔄 Gestão de Processos
- 🔄 Agenda e Compromissos
- 🔄 Documentos e Contratos
- 🔄 Financeiro

## 🛠️ Tecnologias Utilizadas

### Backend
- **Supabase** - Backend as a Service (PostgreSQL + API REST)
- **TypeScript** - Linguagem de programação
- **Node.js** - Runtime JavaScript

### Frontend
- **React 19** - Biblioteca UI
- **TypeScript** - Tipagem estática
- **Vite** - Build tool e dev server
- **TailwindCSS** - Framework CSS
- **Lucide React** - Ícones

## 📦 Instalação

### Pré-requisitos
- Node.js 18+ instalado
- Conta no Supabase (já configurada)

### Passos

1. **Instalar dependências**
```bash
npm install
```

2. **Configurar variáveis de ambiente** (Opcional)
As credenciais do Supabase já estão configuradas em `src/config/supabase.ts`

3. **Iniciar o servidor de desenvolvimento**
```bash
npm run dev
```

O sistema estará disponível em `http://localhost:3000`

## 🗄️ Estrutura do Banco de Dados

### Tabela: clients

| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | UUID | Identificador único |
| full_name | TEXT | Nome completo / Razão social |
| cpf_cnpj | VARCHAR(18) | CPF ou CNPJ |
| rg | VARCHAR(20) | RG (apenas PF) |
| birth_date | DATE | Data de nascimento |
| nationality | VARCHAR(50) | Nacionalidade |
| marital_status | VARCHAR(20) | Estado civil |
| profession | VARCHAR(100) | Profissão |
| client_type | VARCHAR(20) | pessoa_fisica ou pessoa_juridica |
| email | TEXT | Email |
| phone | VARCHAR(20) | Telefone fixo |
| mobile | VARCHAR(20) | Celular |
| address_* | TEXT/VARCHAR | Campos de endereço |
| notes | TEXT | Observações |
| status | VARCHAR(20) | ativo, inativo ou suspenso |
| created_at | TIMESTAMP | Data de criação |
| updated_at | TIMESTAMP | Data de atualização |

## 📁 Estrutura do Projeto

```
crm/
├── src/
│   ├── components/          # Componentes React
│   │   ├── ClientsModule.tsx
│   │   ├── ClientList.tsx
│   │   ├── ClientForm.tsx
│   │   └── ClientDetails.tsx
│   ├── config/              # Configurações
│   │   └── supabase.ts
│   ├── services/            # Serviços/API
│   │   └── client.service.ts
│   ├── types/               # Tipos TypeScript
│   │   └── client.types.ts
│   ├── App.tsx              # Componente principal
│   ├── main.tsx             # Entry point
│   ├── index.css            # Estilos globais
│   └── example.ts           # Testes da API
├── index.html
├── vite.config.ts
├── tailwind.config.js
├── tsconfig.json
└── package.json
```

## 🎯 Scripts Disponíveis

```bash
# Iniciar servidor de desenvolvimento
npm run dev

# Build para produção
npm run build

# Preview da build de produção
npm run preview

# Testar API (sem interface)
npm run test-api
```

## 💡 Como Usar

### Adicionar um Novo Cliente

1. Acesse o módulo "Clientes"
2. Clique em "Novo Cliente"
3. Selecione o tipo (Pessoa Física ou Jurídica)
4. Preencha os dados obrigatórios (marcados com *)
5. Clique em "Salvar Cliente"

### Buscar Clientes

- Use a barra de busca para procurar por nome, CPF/CNPJ ou email
- Filtre por status (Ativo, Inativo, Suspenso)
- Filtre por tipo (Pessoa Física ou Jurídica)

### Visualizar Detalhes

- Clique no ícone de olho (👁️) na lista de clientes
- Visualize todas as informações cadastradas
- Edite clicando no botão "Editar Cliente"

## 🔐 Segurança

- Row Level Security (RLS) habilitado no Supabase
- Validação de dados no frontend e backend
- CPF/CNPJ único por cliente
- Soft delete (clientes são marcados como inativos, não deletados)

## 📊 Dashboard

O dashboard exibe:
- Total de clientes cadastrados
- Clientes ativos
- Quantidade de Pessoas Físicas
- Quantidade de Pessoas Jurídicas

## 🎨 Interface

- Design moderno e profissional
- Totalmente responsivo (mobile, tablet, desktop)
- Cores personalizadas para escritórios de advocacia
- Ícones intuitivos
- Feedback visual para todas as ações

## 🚧 Desenvolvimento Futuro

- [ ] Módulo de Processos
- [ ] Módulo de Agenda
- [ ] Módulo Financeiro
- [ ] Relatórios e Estatísticas
- [ ] Exportação de dados (PDF, Excel)
- [ ] Sistema de notificações
- [ ] Autenticação de usuários
- [ ] Permissões e roles

## 📝 Licença

ISC

## 👨‍💻 Autor

Sistema desenvolvido para escritórios de advocacia profissionais.

---

**jurius.com.br** - Gestão Inteligente para Advogados Profissionais
