# Operação do portal NTHUB

## Instalação e atualização

Node 24+, pnpm 11 e Docker Desktop. Preserve `.env` e `.runtime/garage.toml`: contêm segredos e nunca entram no Git.

```powershell
pnpm install --frozen-lockfile
pnpm setup:local
docker compose up -d
pnpm db:migrate
pnpm db:seed
pnpm dev
# Outro terminal
pnpm worker
```

O seed mantém senhas, decisões e critérios já editados. O administrador é `ADMIN_EMAIL`; a senha existente permanece no `.env`. Apenas esse usuário é criado pelo bootstrap. CNPJs ficam pendentes.

## Uso

Escolha a empresa no seletor. A matriz NTHUB tem painel consolidado e cadastro de empresas. Cada empresa operacional possui marca, critérios, funcionários, oportunidades, propostas, contatos, tarefas, alertas e auditoria próprios. A NTHUB funciona como ambiente de gestão, sem CRM, com indicadores consolidados e filtro por empresa. Um edital público pode gerar oportunidades independentes em empresas diferentes.

Em **Empresa e critérios**, edite termos positivos, negativos, termos obrigatórios alternativos, UF, valores e prazos. **Reclassificar catálogo** reaplica as regras e preserva decisões existentes. O catálogo é compartilhado; nenhuma proposta, documento interno, comentário ou decisão é compartilhada por isso.

Em **Funcionários**, cadastre nome, e-mail e perfil. O convite retorna um link de uso único por 48 horas, para entrega pelo administrador ao funcionário. O sistema não envia esse link automaticamente. Um e-mail existente no grupo pode receber mais vínculos sem trocar a senha. Somente o administrador do grupo pode criar gestores e reemitir convites. Suspender vínculo remove acesso à empresa imediatamente. Perfis: gestor administra seu ambiente; analista opera oportunidades e propostas; leitor consulta. Não há funcionários fictícios no seed.

Em **Configurações → Fontes e coletas**, configure agendamento por empresa ou sincronize manualmente o PNCP. Worker e Redis precisam permanecer ativos. Execuções e falhas aparecem no painel; a retomada usa checkpoint de página. Anexos e itens são buscados automaticamente na fonte. Ausência ou formato não suportado aparece como pendência; nunca é convertido em dado inventado.

Dentro do cartão da oportunidade, use **Registrar proposta** para informar seu valor e observações. Cada criação e atualização é registrada na linha do tempo com autor, data, valor daquele momento e valor anterior quando houver. Não existe campo de valor contratado nesse fluxo, nem aba Participações. Os dados antigos de propostas e arquivos foram preservados; o módulo independente Documentos foi retirado da navegação. Os editais e anexos oficiais continuam disponíveis na oportunidade.

## Infraestrutura e integrações

Originais novos usam armazenamento S3 compatível; documentos legados no PostgreSQL continuam legíveis. O ambiente local usa Garage em nó único, sem redundância. SMTP local usa Mailpit: http://127.0.0.1:8025. Mensagens ficam capturadas localmente, sem entrega externa. Alertas por e-mail dependem de adesão em **Notificações**. Para produção configure SMTP aprovado.

Tokens de API têm empresa fixa, escopos e revogação. O token é mostrado uma única vez. API em `/api/v1`; OpenAPI em `/api/v1/openapi.json` e `/docs`. Mutações exigem `X-NTHub-Request: 1`. Sessão pode selecionar empresa autorizada por `X-Company-Id`; credenciais de integração não podem alternar empresa.

Webhooks exigem HTTPS e hostname explicitamente permitido em `WEBHOOK_ALLOWED_HOSTS`. Segredos ficam cifrados com `DATA_ENCRYPTION_KEY` de 32 bytes em base64. Valide assinatura HMAC SHA256 de `timestamp.body` em `X-NTHUB-Signature` (prefixo `sha256=`), com `X-NTHUB-Timestamp`; recuse timestamps antigos e deduplique por `X-NTHUB-Delivery`. O tipo vem em `X-NTHUB-Event`.

SSO OIDC é opcional. Configure emissor HTTPS, client ID, segredo, organização aprovada e callback `APP_URL/api/v1/auth/oidc/callback`. Exige usuário ativo previamente cadastrado, e-mail verificado, vínculo autorizado, PKCE, nonce, estado de uso único vinculado ao navegador e identidade emissor/subject persistida. Não há cadastro público. Sem provedor aprovado, login corporativo permanece oculto. A integração real exige teste com o IdP da empresa.

## Produção e recuperação

Não exponha o Vite nem portas de PostgreSQL/Redis/S3/Mailpit à internet. Compile `pnpm build`; publique `apps/web/dist` em servidor HTTPS com fallback para index.html e encaminhe `/api` e `/docs` à API em loopback. Execute API e worker com supervisor e variáveis do cofre. Use `NODE_ENV=production`, `APP_URL` HTTPS, banco/Redis privados e S3 gerenciado redundante. Valide cookies Secure, domínio, limites do proxy e SMTP real antes da abertura externa.

Backup: suspenda worker e mutações; gere dump PostgreSQL em formato custom, snapshot/export consistente do bucket S3 e cópia cifrada de `.env`/chave de cifra/configuração do armazenamento. Guarde fora do equipamento e verifique retenção. Redis é fila, não substitui o outbox persistido. Uma restauração precisa recuperar banco e objetos da mesma janela e revalidar jobs antes de retomar o worker. `scripts/backup-db.ps1` gera dump e valida restauração em banco temporário, sem alterar o banco principal. Não inclui bucket: faça snapshot correspondente pelo fornecedor S3.

## Cobertura e limites

Implementados: multiempresa/RBAC, cadastro e convite, critérios por empresa, PNCP, checkpoints/versões, outbox/worker, originais PDF/TXT/CSV/ZIP, OCR Gemini, análise com referências validadas, atribuições/comentários, propostas/resultados, documentos/tarefas, notificações, agendamento, indicadores/exportação, auditoria, tokens/webhooks, OpenAPI e login OIDC opcional.

Dependem de configuração externa: domínio/TLS, IdP, SMTP de produção, infraestrutura redundante e retenção de backups. Fontes regionais/PCA e conectores adicionais exigem escopo de cobertura próprio. DOCX/planilhas não têm extração textual automática neste incremento; originais continuam disponíveis. A página OCR se baseia em transcrição e demanda conferência humana. A IA não decide habilitação jurídica nem garante conformidade. O catálogo inicial limita a listagem a mil oportunidades; indicadores consolidados consultam toda a base. Esses limites devem ser tratados antes de ampliar cobertura e volume.


## PNCP e Compras.gov.br: sincronização e limites

Em **Sincronizar fontes**, selecione PNCP ou Compras.gov.br. O novo conector usa a API oficial `dadosabertos.compras.gov.br`, módulo de contratações da Lei 14.133. O agendamento por empresa permite marcar uma ou ambas as fontes. A cobertura inicial do Compras.gov.br não inclui o módulo de licitações legadas.

Os códigos de modalidade do SIASG/Compras diferem dos códigos PNCP; o conector converte os códigos e confere a modalidade PNCP recebida. Pregões, concorrências, dispensa e inexigibilidade possuem mapeamento; outras modalidades geram mensagem explícita. Registros excluídos são filtrados. A consulta usa o início do dia seguinte como limite final e confere a data de publicação retornada, para incluir o dia final inteiro sem importar publicações fora do período.

O mesmo número de controle PNCP mantém uma contratação no catálogo e registra proveniência das duas fontes. Cada empresa mantém sua própria oportunidade e decisão. Os dados brutos de cada fonte são preservados em `procurement_sources`; anexos e itens continuam sendo consultados pelo identificador PNCP oficial. Portanto, o Compras.gov.br amplia a entrada de dados estruturados, mas documentos ainda dependem da disponibilização e dos limites do PNCP. Não são feitas consultas autenticadas ao ambiente de disputa nem envio de lances.

Todas as empresas e processos compartilham limites por host no Redis: intervalo mínimo de 2 segundos no PNCP e 1,5 segundo no Compras.gov.br. Consultas JSON públicas têm cache de 5 minutos e lock de consulta em andamento; dados privados não entram nesse cache. Respostas 429 e 503 aplicam cooldown compartilhado, respeitando Retry-After em segundos ou data HTTP; na ausência de indicação, aguardam 60 segundos. O worker move o trabalho para estado de espera sem consumir tentativas e continua na página salva. Reiniciar uma coleta já concluída não remove decisões.

Um 429 é imposto pela fonte: o sistema não promete eliminá-lo. A interface mostra a espera e retoma automaticamente. O worker precisa continuar ativo. Erros permanentes de dados/autorização não são tratados como sucesso. Na fila, **Reprocessar** permite repetir uma execução antiga que falhou antes dessa correção.

Diagnóstico de leitura, sem gravar licitações ou chamar Gemini:

```powershell
pnpm --filter @nthub/api exec tsx --env-file=../../.env src/check-sources.ts 2026-11-13
```

Referências: [Swagger Compras.gov.br](https://dadosabertos.compras.gov.br/swagger-ui/index.html), [Portal oficial de dados abertos](https://www.gov.br/compras/pt-br/cidadao/portal-de-dados-abertos), [Swagger PNCP](https://pncp.gov.br/api/consulta/swagger-ui/index.html).


## CRM de oportunidades

O caminho `/crm` é o funil operacional de cada empresa operacional e o destino inicial dos ambientes de operação. A matriz mantém a visão consolidada do grupo. As etapas são Novas, Em análise, Selecionadas, Proposta enviada, Vencidas, Perdidas e Descartadas. A coleta insere a oportunidade em Novas antes de baixar ou analisar os anexos. O CRM consulta novas informações a cada quatro segundos enquanto a aba está visível; não é necessário esperar o Gemini terminar.

Use o seletor de etapa de cada cartão ou arraste o cartão entre colunas. O mesmo controle funciona por teclado e em tela de toque. Atribuição de responsável, comentários, evidências, documentos e participação ficam no detalhamento do cartão. Todas as etapas, inclusive Vencidas (licitações ganhas), Perdidas e Descartadas, aparecem no quadro. As mudanças continuam respeitando os perfis, as atribuições e a empresa autorizada, gerando auditoria. A sincronização não altera a decisão tomada pela equipe. O valor de pipeline é uma soma de estimativas publicadas, não receita contratada.

## Aderência v2

A IA identifica requisitos, compara informações empresariais disponíveis e justifica os critérios com citações de documento/página. Não escolhe a nota final. O backend atribui pesos fixos: compatibilidade do objeto 40%, atendimento técnico 35% e comprovação documental 25%. Cada dimensão reparte seu peso igualmente entre os critérios identificados e deduplicados. Correspondência integral vale 100; parcial, 50; incompatibilidade demonstrada, 0. Um critério sem comprovação fica pendente, sem nota.

O resultado geral só recebe uma nota quando todos os critérios foram avaliados. Caso contrário, mostra resultado inconclusivo, cobertura do peso avaliado e faixa matemática mínima/máxima. Essa faixa não estima probabilidade de vitória ou habilitação. A nota parcial de uma dimensão sempre vem acompanhada de sua cobertura. Divergências entre trechos mantêm o critério pendente.

A atuação declarada no cadastro pode fundamentar afinidade com o objeto. Palavras-chave servem para busca e não são comprovação de capacidade técnica. Neste incremento, o perfil empresarial possui atuação declarada; não possui um cadastro de fatos técnicos/documentais verificados. Por isso, as dimensões técnica e documental permanecem pendentes de validação da equipe, mesmo quando o objeto é totalmente compatível. Ter um arquivo cadastrado, por si só, não comprova que ele satisfaz o edital. A API de análise aceita apenas fatos empresariais provenientes do servidor e rejeita IDs/citações inventados.

As análises v1 são preservadas no histórico, mas a interface deixa de exibir sua nota isolada como aderência justificada. A nova versão usa cache próprio (`company-v2-rubric`) por conjunto de documentos, modelo e versão de critérios empresariais. A reanálise substitui a avaliação exibida sem alterar o estágio do CRM. A decisão de participação continua sendo da equipe.


## Fluxo de trabalho atualizado: análise manual e gestão NTHUB

Fontes e coletas, Integrações e Atividades ficam dentro de **Configurações**. URLs antigas redirecionam para a seção correspondente. A NTHUB abre em **Indicadores do grupo**, não apresenta CRM nem navegação operacional de oportunidades. A consulta consolidada exclui a matriz e permite filtrar uma empresa operacional do mesmo grupo. Valores propostos consideram a proposta mais recente por oportunidade, sem somar revisões como se fossem propostas independentes.

O cartão da oportunidade reúne contatos opcionais (nome, função, e-mail, telefone e observações), responsável, comentários e propostas. As alterações de contatos e propostas geram eventos na mesma linha do tempo. As versões de proposta guardam o valor registrado em cada evento. O histórico legado sem valor detalhado é sinalizado como valor não registrado, sem reconstruir um preço antigo a partir do preço atual.

**Nenhuma coleta dispara análise por IA ou OCR com Gemini.** PDFs textuais são extraídos localmente e PDFs digitalizados ficam com leitura pendente. A equipe precisa clicar em **Analisar com IA / Reanalisar com IA**. Somente a solicitação de um usuário autenticado no portal agenda o trabalho com consentimento explícito. Tokens de integração não acionam essa análise. O worker não reprocessa análises ausentes na inicialização; tarefas antigas sem marcador de solicitação são bloqueadas. A chave configurada, por si só, não autoriza chamadas automáticas. Resultados existentes continuam consultáveis e o cache evita reprocessamento idêntico quando possível.


### Perfis e permissões
O administrador do grupo acessa **Permissões** no menu lateral, dentro do ambiente da empresa desejada. Em **Perfis de acesso**, pode criar um perfil, copiar os padrões ou editar os personalizados. Em **Por funcionário**, escolhe um perfil e configura exceções: herdar, permitir ou bloquear. As exceções individuais têm prioridade e são preservadas quando o perfil é editado. Um perfil vazio não concede acesso aos módulos.

Perfis e vínculos são separados por empresa. Somente o administrador do grupo administra permissões; ele mantém o acesso integral. As alterações valem na próxima requisição, inclusive em sessões abertas, e são revalidadas antes de executar trabalhos em segundo plano. O uso da IA tem permissão própria e continua dependendo de solicitação manual. Alterações são registradas em Configurações → Atividades.


### Transferir oportunidades
No card aberto, use **Transferir para outra empresa**, selecione o destino e informe o motivo. É necessário ter a permissão **Transferir oportunidades entre empresas**, edição e acesso nas empresas de origem e destino. A matriz NTHUB não recebe CRM.

A operação move a oportunidade, documentos, contatos, comentários, tarefas e rascunhos, mantendo o histórico. Ela entra em Novas, sem responsável. A análise anterior é preservada como histórico, mas não é uma avaliação válida da nova empresa; a nova análise continua manual. Propostas formalizadas e resultados não podem ser movidos para outra empresa participante. Se o destino já tiver a oportunidade, a transferência é bloqueada. A coleta e a reclassificação respeitam o encaminhamento manual e não recriam o card na origem.

Os cards do CRM respondem imediatamente à troca de etapa. O card passa acima das colunas e se acomoda no destino em 280 ms, partindo da posição em que foi solto; os cards vizinhos se reorganizam em 200 ms, sem esperar a rede, e desfaz a mudança se o servidor rejeitar. A animação é omitida para teclado e preferência de movimento reduzido.


O arraste do CRM usa SortableJS com o card elevado e levemente inclinado, espaço reservado na coluna e reorganização dos vizinhos durante o gesto. A ordem visual escolhida fica salva neste navegador por empresa. O seletor de etapas continua disponível para teclado; movimento reduzido remove inclinação e reorganização animada.
