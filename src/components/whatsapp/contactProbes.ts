// "Este número tem WhatsApp? qual é a cara dele?" — a pergunta, feita uma vez só.
//
// O painel "Nova conversa" já fazia essa pergunta, mas com a fila DELE: uma
// lista de centenas de linhas rolando, sondada conforme aparece na tela. O
// CARTÃO DE CONTATO recebido tem o problema oposto — um punhado de números
// espalhados pela thread, cada um dentro de uma bolha que monta e desmonta
// sozinha conforme a conversa rola.
//
// Por isso a fila aqui é do MÓDULO, e não de um componente: a resposta sobre um
// número vale para toda a tela e para o resto da sessão. Duas bolhas com o
// mesmo contato perguntam uma vez; a bolha que sai da tela e volta não pergunta
// de novo; e as perguntas que nascem no mesmo instante viajam juntas, num lote
// só, em vez de virar uma ida à Evolution por bolha (é a mesma Edge Function
// com cache em `whatsapp_contact_probes` — ver `whatsapp-contact-probe`).
import { useEffect, useState } from 'react';
import { whatsappService, normalizePhone } from '../../services/whatsapp.service';
import type { WhatsAppContactProbe } from '../../types/whatsapp.types';

/** Quantos números cabem numa pergunta (o teto é o da Edge Function). */
const LOTE = 24;
/** Janela para juntar as perguntas que nascem quase ao mesmo tempo. */
const AGRUPAR_MS = 120;

const respostas = new Map<string, WhatsAppContactProbe>();
/** Números já perguntados — inclusive os que voltaram sem resposta. */
const perguntados = new Set<string>();
const fila = new Set<string>();
const ouvintes = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;

function avisar() { for (const fn of ouvintes) fn(); }

async function escoar() {
  timer = null;
  const lote = [...fila].slice(0, LOTE);
  if (lote.length === 0) return;
  for (const p of lote) fila.delete(p);
  // Falha de rede não é erro da bolha: `probeContacts` devolve lista vazia, o
  // cartão fica sem rosto e a conversa segue. O que NÃO se faz é tentar de novo
  // em laço — daí o número continuar em `perguntados` mesmo sem resposta.
  const resultado = await whatsappService.probeContacts(lote, null);
  for (const r of resultado) respostas.set(r.phone, r);
  if (resultado.length > 0) avisar();
  if (fila.size > 0) void escoar();
}

function pedir(phone: string) {
  const norm = normalizePhone(phone);
  if (!norm || perguntados.has(norm)) return;
  perguntados.add(norm);
  fila.add(norm);
  if (!timer) timer = setTimeout(() => { void escoar(); }, AGRUPAR_MS);
}

/**
 * O que já se sabe sobre estes números, perguntando o que ainda falta.
 *
 * Devolve um mapa por telefone NORMALIZADO. Enquanto a resposta não chega o
 * mapa vem vazio, e a tela mostra o que sempre mostrou — o rosto entra depois,
 * sem segurar a bolha.
 */
export function useContactProbes(phones: string[]): Map<string, WhatsAppContactProbe> {
  // Uma string estável evita reperguntar a cada render por causa do array novo.
  const chave = phones.join(',');
  const [, forcar] = useState(0);

  useEffect(() => {
    const ouvinte = () => forcar(n => n + 1);
    ouvintes.add(ouvinte);
    for (const p of chave.split(',')) if (p) pedir(p);
    return () => { ouvintes.delete(ouvinte); };
  }, [chave]);

  const mapa = new Map<string, WhatsAppContactProbe>();
  for (const p of phones) {
    const norm = normalizePhone(p);
    const r = norm ? respostas.get(norm) : undefined;
    if (r) mapa.set(norm, r);
  }
  return mapa;
}
