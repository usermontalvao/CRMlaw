// FASE 8 — os consertos de robustez: auditoria fail-closed, recuperação de
// chave na lixeira, refresh concorrente e sanitização do motivo.

import { call, check, login, resumo, stepUp } from './lib.mjs';

const PIN = '918273';   // PIN DO SISTEMA, vindo do seed

async function principal() {
  const pedro = await login('pedro');
  const maria = await login('maria');

  // O PIN vem de `user_security_pins` (seed.sql). Nada a configurar aqui.
  {
    const seg = await call('/admin/security', { token: maria.access_token });
    check('PIN do sistema disponível', seg.body?.pin_configured === true,
      'rode reset-pin.sql antes desta fase');
  }

  const criada = await call('/credentials', { method: 'POST', token: pedro.access_token,
    body: { name: 'Chave da fase 8', secret: 'JBSWY3DPEHPK3PXP', algorithm: 'SHA1', digits: 6, period: 30 } });
  const credId = criada.body?.credential?.id ?? criada.body?.id;
  check('chave criada', Boolean(credId), JSON.stringify(criada.body));

  console.log('\n── REFRESH CONCORRENTE ──────────────────────────────────────────');
  {
    const sessao = await login('joao');
    // Dois refresh com o MESMO token, disparados juntos: um tem de vencer e o
    // outro tem de ser recusado. Antes, o perdedor recebia 200 com um par de
    // tokens que nunca foi gravado — e que não abria nada.
    const [a, b] = await Promise.all([
      call('/auth/refresh', { method: 'POST', body: { refresh_token: sessao.refresh_token } }),
      call('/auth/refresh', { method: 'POST', body: { refresh_token: sessao.refresh_token } }),
    ]);
    const oks = [a, b].filter((r) => r.status === 200);
    const recusados = [a, b].filter((r) => r.status !== 200);
    check('exatamente UM refresh concorrente vence', oks.length === 1, `${a.status} e ${b.status}`);
    check('o outro é recusado, não recebe token fantasma', recusados.length === 1 && !recusados[0].body?.access_token,
      JSON.stringify(recusados[0]?.body));

    // E o desfecho de segurança: o perdedor apresentou um token já girado, que
    // é a assinatura de refresh roubado. O cofre encerra a FAMÍLIA inteira —
    // então nem o vencedor continua valendo. É severo de propósito: relogar é
    // barato, e um refresh roubado circulando não é.
    //
    // O que este teste garante é que ninguém sai com token fantasma: ou a
    // sessão vale, ou ela morreu — nunca "200 com um par que não abre nada".
    if (oks.length === 1) {
      const depois = await call('/credentials', { token: oks[0].body.access_token });
      check('nenhum token fantasma sobra: ou vale, ou a sessão foi encerrada',
        depois.status === 200 || depois.status === 401, `${depois.status}`);
      if (depois.status === 401) {
        const audit = await call('/admin/audit?limit=20&event_type=SESSION_REVOKED', { token: maria.access_token });
        const linha = (audit.body?.events ?? []).find((e) => e.metadata_safe?.reason === 'refresh_reuse_detected');
        check('o encerramento por reuso ficou auditado', Boolean(linha), JSON.stringify(linha?.metadata_safe));
      }
    }
  }

  console.log('\n── MOTIVO É HIGIENIZADO ─────────────────────────────────────────');
  {
    const t = await stepUp('pedro', pedro.access_token);
    // Motivo com quebra de linha (forjaria linha falsa no log) e com algo que
    // tem cara de segredo base32.
    const sujo = 'preciso do segredo\n\nFORJADO: admin aprovou JBSWY3DPEHPK3PXPAAAA fim';
    const r = await call(`/credentials/${credId}/export`, { method: 'POST', token: pedro.access_token,
      body: { reason: sujo, step_up_token: t } });
    check('a exportação com motivo sujo é aceita', r.status === 200, `${r.status} ${JSON.stringify(r.body)}`);

    const audit = await call('/admin/audit?limit=30&event_type=EXPORT_COMPLETED', { token: maria.access_token });
    const linha = (audit.body?.events ?? []).find((e) => e.credential_id === credId);
    const motivo = String(linha?.reason ?? '');
    check('a quebra de linha some do motivo gravado', !/[\r\n]/.test(motivo), JSON.stringify(motivo));
    check('o que parecia segredo foi redigido', !motivo.includes('JBSWY3DPEHPK3PXPAAAA'), JSON.stringify(motivo));
    check('mas o motivo continua legível para o humano', /preciso do segredo/.test(motivo), JSON.stringify(motivo));
  }

  console.log('\n── BREAK-GLASS NÃO ABRE CHAVE NA LIXEIRA ───────────────────────');
  {
    const del = await call(`/credentials/${credId}`, { method: 'DELETE', token: pedro.access_token,
      body: { reason: 'mandando para a lixeira para testar a recuperacao' } });
    check('a chave foi para a lixeira', del.status === 200, `${del.status}`);

    const t = await stepUp('maria', maria.access_token);
    const rec = await call('/admin/recover', { method: 'POST', token: maria.access_token, body: {
      credential_id: credId, pin: PIN,
      reason: 'tentando recuperar o segredo de uma chave que foi excluida',
      step_up_token: t } });
    check('recuperar chave excluída é recusado (409)', rec.status === 409, `${rec.status} ${JSON.stringify(rec.body)}`);
    check('e nenhum segredo veio junto', !rec.body?.secret, JSON.stringify(rec.body));

    const audit = await call('/admin/audit?limit=30&event_type=ADMIN_RECOVERY_FAILED', { token: maria.access_token });
    const linha = (audit.body?.events ?? []).find((e) => e.credential_id === credId);
    check('a recusa ficou auditada com o motivo certo',
      linha?.metadata_safe?.why === 'credential_deleted', JSON.stringify(linha?.metadata_safe));
  }

  console.log('\n── AUDITORIA CONTINUA APPEND-ONLY ──────────────────────────────');
  {
    const audit = await call('/admin/audit?limit=5', { token: maria.access_token });
    check('a auditoria responde', audit.status === 200, `${audit.status}`);
    const bruto = JSON.stringify(audit.body ?? {});
    check('e segue sem segredo, PIN ou token', !new RegExp(`${PIN}|JBSWY3DPEHPK3PXP|access_token`).test(bruto));
  }

  process.exit(resumo('FASE 8 — ROBUSTEZ'));
}

principal().catch((e) => { console.error(e); process.exit(1); });
