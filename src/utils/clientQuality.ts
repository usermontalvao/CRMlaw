import type { Client } from '../types/client.types';

const isBlank = (value?: string | null) => !value || !String(value).trim();

export const OUTDATED_THRESHOLD_DAYS = 180;

export const isOutdatedClientRecord = (client: Client) => {
  if (!client.updated_at) return true;
  const updatedAt = new Date(client.updated_at);
  if (Number.isNaN(updatedAt.getTime())) return true;
  const threshold = Date.now() - OUTDATED_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;
  return updatedAt.getTime() < threshold;
};

export const getClientMissingFields = (client: Client): string[] => {
  const missing: string[] = [];

  if (isBlank(client.full_name)) missing.push('Nome completo');
  if (isBlank(client.cpf_cnpj)) missing.push('CPF/CNPJ');
  if (isBlank(client.marital_status)) missing.push('Estado civil');
  if (isBlank(client.profession)) missing.push('Profissão');
  if (isBlank(client.address_street)) missing.push('Logradouro');
  if (isBlank(client.address_number)) missing.push('Número');
  if (isBlank(client.address_city)) missing.push('Cidade');
  if (isBlank(client.address_state)) missing.push('Estado');
  if (isBlank(client.address_zip_code)) missing.push('CEP');

  return missing;
};
