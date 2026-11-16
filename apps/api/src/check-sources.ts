import { randomUUID } from 'node:crypto';
import { queue } from './core/queue.js';
import { httpStore } from './modules/sources/http-store.js';
import { sourceJson } from './modules/sources/http.js';
import { comprasPage } from './modules/sources/compras.js';
import { syncSchema } from '@nthub/contracts';
try {
  const probe = 'check-' + randomUUID();
  if (
    (await httpStore.reserve(probe, 2000)) !== 0 ||
    (await httpStore.reserve(probe, 2000)) <= 0
  )
    throw new Error('Controle compartilhado de frequência falhou.');
  await httpStore.cooldown(probe, 10000);
  if ((await httpStore.reserve(probe, 2000)) < 9000)
    throw new Error('Pausa compartilhada não preservada.');
  console.log('Controle de frequência e cooldown verificados no Redis.');
  const date =
    process.argv[2] ||
    new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const opts = syncSchema.parse({ since: date, until: date, modality: 6 });
  for (const source of ['pncp', 'compras']) {
    try {
      const batch =
        source === 'compras'
          ? await comprasPage({ ...opts, source: 'compras' }, 1)
          : await sourceJson(
              'https://pncp.gov.br/api/consulta/v1/contratacoes/publicacao?' +
                new URLSearchParams({
                  dataInicial: date.replaceAll('-', ''),
                  dataFinal: date.replaceAll('-', ''),
                  codigoModalidadeContratacao: '6',
                  pagina: '1',
                  tamanhoPagina: '50',
                }),
            );
      console.log(
        source +
          ': resposta válida; registros na primeira página = ' +
          (Array.isArray(batch)
            ? batch.length
            : (batch as { data: unknown[] }).data.length),
      );
    } catch (error) {
      console.error(
        source +
          ': ' +
          (error instanceof Error ? error.message : 'Falha na consulta.'),
      );
      process.exitCode = 1;
    }
  }
} finally {
  await queue.close();
}
