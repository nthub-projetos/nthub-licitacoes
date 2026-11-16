import { z } from 'zod';
import { sourceJson } from './http.js';
import { syncSchema } from '@nthub/contracts';
export const comprasRecordSchema = z
  .object({
    numeroControlePNCP: z.string().regex(/^\d{14}-1-\d+\/\d{4}$/),
    idCompra: z.string().regex(/^\d+$/),
    objetoCompra: z.string(),
    dataPublicacaoPncp: z.string().regex(/^\d{4}-\d{2}-\d{2}T/),
    orgaoEntidadeRazaoSocial: z.string(),
    unidadeOrgaoUfSigla: z.string().nullish(),
    unidadeOrgaoMunicipioNome: z.string().nullish(),
    valorTotalEstimado: z.number().nullish(),
    dataEncerramentoPropostaPncp: z.string().nullish(),
    modalidadeIdPncp: z.number().int(),
    contratacaoExcluida: z.boolean().nullish(),
  })
  .passthrough();
export function comprasQuery(opts: z.infer<typeof syncSchema>, page: number) {
  // Compras/SIASG uses different modality IDs from PNCP. Filter the PNCP ID too.
  const modalities: Record<number, number> = {
    4: 3,
    5: 3,
    6: 5,
    7: 5,
    8: 6,
    9: 7,
  };
  const modality = modalities[opts.modality];
  if (!modality)
    throw new Error(
      'Modalidade ainda não suportada pelo conector Compras.gov.br.',
    );
  const query = new URLSearchParams({
    pagina: String(page),
    tamanhoPagina: '50',
    dataPublicacaoPncpInicial: opts.since,
    dataPublicacaoPncpFinal: new Date(
      Date.parse(opts.until + 'T00:00:00Z') + 86400000,
    )
      .toISOString()
      .slice(0, 10),
    codigoModalidade: String(modality),
    contratacaoExcluida: 'false',
    ...(opts.uf ? { unidadeOrgaoUfSigla: opts.uf } : {}),
  });
  return (
    'https://dadosabertos.compras.gov.br/modulo-contratacoes/1_consultarContratacoes_PNCP_14133?' +
    query
  );
}
export async function comprasPage(
  opts: z.infer<typeof syncSchema>,
  page: number,
) {
  const batch = z
    .object({
      resultado: z.array(comprasRecordSchema),
      totalPaginas: z.number().int().nonnegative(),
    })
    .parse(await sourceJson(comprasQuery(opts, page)));
  return {
    totalPaginas: batch.totalPaginas,
    data: batch.resultado
      .filter(
        (r) =>
          !r.contratacaoExcluida &&
          r.modalidadeIdPncp === opts.modality &&
          r.dataPublicacaoPncp.slice(0, 10) >= opts.since &&
          r.dataPublicacaoPncp.slice(0, 10) <= opts.until,
      )
      .map((r) => ({
        ...r,
        orgaoEntidade: { razaoSocial: r.orgaoEntidadeRazaoSocial },
        unidadeOrgao: {
          ufSigla: r.unidadeOrgaoUfSigla ?? null,
          municipioNome: r.unidadeOrgaoMunicipioNome ?? null,
        },
        dataEncerramentoProposta: r.dataEncerramentoPropostaPncp ?? null,
        linkSistemaOrigem: `https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/public/compras/acompanhamento-compra?compra=${r.idCompra}`,
      })),
  };
}
