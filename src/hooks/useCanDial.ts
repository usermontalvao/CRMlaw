// A janela do React para a permissão de discar.
//
// A trava de verdade é do `callStore` (ver `placeCall`): é lá que a ligação é
// barrada, aconteça o clique onde acontecer. Este hook existe para o outro
// lado do problema — não mostrar um botão que só vai responder com um erro.
//
// Por que não `usePermissions`: aquele hook é do módulo, guarda o mapa inteiro
// de permissões e é montado pelo App. O telefone precisa da MESMA resposta que
// o store usa para barrar, e precisa dela na barra do topo, na pesquisa global
// e dentro do host das chamadas — três lugares que não compartilham contexto
// nenhum. Um store externo responde aos três com uma consulta só.
import { useEffect, useSyncExternalStore } from 'react';
import {
  dialPermissionSnapshot, ensureDialPermission, subscribeDialPermission,
} from '../services/wacalls/dialPermissionData';

/**
 * Esta pessoa pode ligar pelo CRM?
 *
 * Enquanto a resposta não chega, é `false` — e o botão simplesmente ainda não
 * entrou na barra. O contrário (aparecer e sumir) seria pior: um telefone que
 * pisca na tela e some é lido como defeito, não como permissão.
 */
export function useCanDial(): boolean {
  const estado = useSyncExternalStore(
    subscribeDialPermission,
    dialPermissionSnapshot,
    () => 'unknown' as const,
  );
  useEffect(() => { void ensureDialPermission(); }, []);
  return estado === 'allowed';
}

export default useCanDial;
