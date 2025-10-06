/**
 * Exemplo de uso do módulo de Clientes - Advogado\Web
 */
import { clientService } from './services/client.service.js';
import type { CreateClientDTO } from './types/client.types.js';

async function main() {
  console.log('\n🏛️  === ADVOGADO\\WEB - Sistema de Gestão de Clientes ===\n');

  try {
    // 1. Criar um novo cliente (Pessoa Física)
    console.log('📝 Criando novo cliente (Pessoa Física)...');
    const newClient: CreateClientDTO = {
      full_name: 'João da Silva Santos',
      cpf_cnpj: '123.456.789-00',
      rg: '12.345.678-9',
      birth_date: '1985-05-15',
      nationality: 'Brasileira',
      marital_status: 'casado',
      profession: 'Empresário',
      client_type: 'pessoa_fisica',
      email: 'joao.silva@email.com',
      phone: '(65) 3322-1100',
      mobile: '(65) 99999-8888',
      address_street: 'Rua das Flores',
      address_number: '123',
      address_complement: 'Apto 45',
      address_neighborhood: 'Centro',
      address_city: 'Cuiabá',
      address_state: 'MT',
      address_zip_code: '78000-000',
      notes: 'Cliente indicado pelo Dr. Pedro',
      status: 'ativo'
    };

    const createdClient = await clientService.createClient(newClient);
    console.log('✅ Cliente criado com sucesso!');
    console.log(`   ID: ${createdClient.id}`);
    console.log(`   Nome: ${createdClient.full_name}`);

    // 2. Criar um cliente Pessoa Jurídica
    console.log('\n📝 Criando novo cliente (Pessoa Jurídica)...');
    const companyClient: CreateClientDTO = {
      full_name: 'Empresa XYZ Ltda',
      cpf_cnpj: '12.345.678/0001-90',
      client_type: 'pessoa_juridica',
      email: 'contato@empresaxyz.com.br',
      phone: '(65) 3333-4444',
      mobile: '(65) 98888-7777',
      address_street: 'Av. Principal',
      address_number: '500',
      address_neighborhood: 'Jardim América',
      address_city: 'Cuiabá',
      address_state: 'MT',
      address_zip_code: '78050-000',
      notes: 'Empresa de tecnologia',
      status: 'ativo'
    };

    const createdCompany = await clientService.createClient(companyClient);
    console.log('✅ Cliente (PJ) criado com sucesso!');
    console.log(`   ID: ${createdCompany.id}`);
    console.log(`   Razão Social: ${createdCompany.full_name}`);

    // 3. Listar todos os clientes
    console.log('\n📋 Listando todos os clientes...');
    const allClients = await clientService.listClients();
    console.log(`✅ Total de clientes: ${allClients.length}`);
    allClients.forEach((client, index) => {
      console.log(`   ${index + 1}. ${client.full_name} (${client.client_type}) - ${client.status}`);
    });

    // 4. Buscar cliente por ID
    console.log(`\n🔍 Buscando cliente por ID: ${createdClient.id}`);
    const foundClient = await clientService.getClientById(createdClient.id);
    if (foundClient) {
      console.log('✅ Cliente encontrado:');
      console.log(`   Nome: ${foundClient.full_name}`);
      console.log(`   Email: ${foundClient.email}`);
      console.log(`   Telefone: ${foundClient.mobile}`);
    }

    // 5. Atualizar cliente
    console.log('\n✏️  Atualizando dados do cliente...');
    const updatedClient = await clientService.updateClient(createdClient.id, {
      mobile: '(65) 99888-7766',
      notes: 'Cliente VIP - Atualizado em ' + new Date().toLocaleDateString('pt-BR')
    });
    console.log('✅ Cliente atualizado com sucesso!');
    console.log(`   Novo telefone: ${updatedClient.mobile}`);

    // 6. Filtrar clientes por tipo
    console.log('\n🔍 Filtrando clientes por tipo (pessoa_fisica)...');
    const pessoaFisica = await clientService.listClients({ client_type: 'pessoa_fisica' });
    console.log(`✅ Clientes Pessoa Física: ${pessoaFisica.length}`);

    // 7. Buscar por texto
    console.log('\n🔍 Buscando clientes com "Silva"...');
    const searchResults = await clientService.listClients({ search: 'Silva' });
    console.log(`✅ Resultados encontrados: ${searchResults.length}`);

    // 8. Contar clientes ativos
    console.log('\n📊 Contando clientes ativos...');
    const activeCount = await clientService.countClients({ status: 'ativo' });
    console.log(`✅ Total de clientes ativos: ${activeCount}`);

    console.log('\n✅ === Testes concluídos com sucesso! ===\n');

  } catch (error) {
    console.error('\n❌ Erro durante a execução:', error);
    throw error;
  }
}

// Executar o exemplo
main().catch(console.error);
