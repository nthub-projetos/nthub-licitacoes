import type { ProcessingIssue } from '@nthub/contracts';
export function processingIssues(
  state: string,
  docs: { extractionStatus: string }[],
): ProcessingIssue[] {
  const issues: ProcessingIssue[] = [];
  if (['pending', 'queued', 'processing'].includes(state))
    issues.push({
      kind: 'pending',
      title: 'Coleta aguardando ou em processamento',
      action:
        'Acompanhe a execução em Fontes e coletas. Não é necessário solicitar IA.',
    });
  if (state === 'failed' || docs.some((d) => d.extractionStatus === 'failed'))
    issues.push({
      kind: 'failed',
      title: 'Falha na consulta ou leitura de arquivos',
      action:
        'Use Reprocessar coleta. O processamento será repetido sem executar IA.',
    });
  if (docs.some((d) => d.extractionStatus === 'needs_ocr'))
    issues.push({
      kind: 'needs_ocr',
      title: 'PDF digitalizado aguardando leitura',
      action:
        'Consulte o original ou solicite Analisar com IA para executar OCR e análise.',
    });
  if (docs.some((d) => d.extractionStatus === 'unsupported'))
    issues.push({
      kind: 'unsupported',
      title: 'Arquivo disponível sem leitura automática',
      action:
        'Baixe o original para conferir. Repetir a coleta não adiciona suporte ao formato.',
    });
  if (
    !docs.length &&
    !['pending', 'queued', 'processing', 'failed'].includes(state)
  )
    issues.push({
      kind: 'missing',
      title: 'A fonte ainda não disponibilizou anexos',
      action:
        'Consulte a página oficial ou atualize as informações posteriormente.',
    });
  return issues;
}
