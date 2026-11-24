# NTHUB · Licitações

Portal multiempresa em TypeScript: Fastify, Vue 3, PostgreSQL, BullMQ/Redis e Gemini. NTHUB é a matriz; Safe Conversão Digital, DBSeller Sistemas Integrados e IA Tecnologia possuem ambientes próprios, logos e critérios. Apenas o administrador do grupo é criado; funcionários são cadastrados pelo módulo de convites.

## Iniciar

Para instalar no Windows e colaborar por Pull Request, siga o [guia de desenvolvimento para Derik e Deivid](docs/GUIA-DERIK-DEIVID.md).

Node 24+, pnpm 11, Docker Desktop.

```powershell
pnpm install
pnpm setup:local
docker compose up -d
pnpm db:migrate
pnpm db:seed
pnpm dev
# Outro terminal
pnpm worker
```

Portal: http://127.0.0.1:5173. Login e senha definidos em `.env`; o bootstrap preserva contas existentes. Configure Gemini somente no backend. Não publique segredos com prefixo VITE_.

## Validação

```powershell
pnpm typecheck
pnpm test
pnpm build
```

Os testes usam PostgreSQL/Redis locais, fixtures isoladas e mocks das fontes/Gemini. Não consomem créditos. Testam RBAC, isolamento entre empresas/grupos, convites, propostas, coleta idempotente, critérios, arquivos e evidências.

Instruções completas, perfis, implantação, backups e limites: [Operação](docs/OPERACAO.md).

O catálogo integra PNCP e Compras.gov.br (Lei 14.133), com deduplicação por número de controle. Consultas compartilham cache e limites entre empresas; erros 429 geram espera automática com Retry-After e retomada de checkpoint. Documentos e itens são obtidos automaticamente do PNCP; upload de edital não faz parte do fluxo normal. A IA fundamenta achados em trechos identificados por documento/página, com revisão humana. Novos originais podem usar S3 compatível (Garage local); legados no banco continuam acessíveis.

CRM por empresa em `/crm`, atualizado a cada quatro segundos, com etapas, responsáveis e acesso aos documentos da oportunidade. A aderência v2 apresenta critérios, justificativas e cobertura; pendências de comprovação mantêm o resultado geral inconclusivo.

A NTHUB é o ambiente de gestão, com indicadores consolidados filtráveis. Fontes, integrações e atividades ficam em Configurações. Propostas e contatos pertencem à linha do tempo de cada oportunidade. A IA, inclusive OCR Gemini, só roda por solicitação manual no portal; as coletas não consomem tokens de IA.
