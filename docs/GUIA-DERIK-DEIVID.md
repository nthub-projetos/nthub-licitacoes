# Guia de desenvolvimento — Derik e Deivid

Este guia explica como instalar o NTHUB Licitações no Windows, executar o projeto no próprio computador e enviar alterações para revisão por Pull Request (PR).

Repositório: https://github.com/nthub-projetos/nthub-licitacoes

Cada desenvolvedor terá seu próprio banco e seus próprios arquivos. A instalação local começa com as empresas cadastradas e um administrador local; ela não copia as oportunidades, os usuários nem os históricos do servidor. As contas de teste do servidor não são criadas automaticamente no computador de vocês.

## 1. Aceitar o convite

Entre no GitHub com a conta que recebeu o convite e aceite o acesso ao repositório. Depois, abra o link acima e confira se consegue visualizar os arquivos.

Se aparecer “Repository not found” ou erro 403, confirme a conta conectada e peça ao administrador para conferir o convite e a permissão de escrita.

## 2. Instalar os programas

Instale:

- Git para Windows: https://git-scm.com/downloads/win
- Node.js **24**, que atende à versão usada pelo projeto: https://nodejs.org/en/download
- Docker Desktop: https://www.docker.com/products/docker-desktop/
- Um editor, por exemplo VS Code: https://code.visualstudio.com/

No Docker Desktop, utilize o backend WSL 2. Se o instalador solicitar WSL, virtualização ou reinicialização, conclua essas etapas antes de continuar. Se for necessário instalar o WSL, abra PowerShell como administrador, execute `wsl --install`, reinicie e conclua a configuração solicitada.

Abra o Docker Desktop e aguarde o mecanismo iniciar. Feche e abra novamente o PowerShell após as instalações.

Confira:

```powershell
git --version
node --version
npm --version
docker --version
docker compose version
docker info
```

O Node deve mostrar `v24.x.x`. O `docker info` deve conseguir consultar o mecanismo do Docker.

Instale a versão de pnpm definida no projeto:

```powershell
npm install --global pnpm@11.25.0
pnpm --version
```

Se o PowerShell bloquear scripts como `npm.ps1` ou `pnpm.ps1`, use `npm.cmd` e `pnpm.cmd` nos comandos equivalentes deste guia. Exemplo: `pnpm.cmd install --frozen-lockfile`.

## 3. Configurar a identificação do Git

Cada um deve informar seu próprio nome e um e-mail associado à própria conta do GitHub. Pode ser o e-mail privado `noreply` disponibilizado pelo GitHub em Settings → Emails.

Derik, substituindo o e-mail de exemplo pelo e-mail associado ao seu GitHub:

```powershell
git config --global user.name "Derik Pimentel"
git config --global user.email "SEU_EMAIL_DO_GITHUB"
```

Deivid, substituindo o e-mail de exemplo pelo e-mail associado ao seu GitHub:

```powershell
git config --global user.name "Deivid Santos"
git config --global user.email "SEU_EMAIL_DO_GITHUB"
```

Confira:

```powershell
git config --global --get user.name
git config --global --get user.email
```

Essa identificação registra a autoria dos commits; ela não faz login no GitHub.

## 4. Baixar o projeto

No PowerShell:

```powershell
New-Item -ItemType Directory -Force "$HOME\Projetos" | Out-Null
cd "$HOME\Projetos"
git clone https://github.com/nthub-projetos/nthub-licitacoes.git
cd nthub-licitacoes
```

Se o Git pedir autenticação, conclua o login no navegador com a conta convidada. A senha comum do GitHub não serve como senha para operações Git por HTTPS.

Para abrir no VS Code, se o comando estiver disponível:

```powershell
code .
```

## 5. Instalar as dependências e preparar o ambiente

Dentro da pasta do projeto:

```powershell
pnpm install --frozen-lockfile
pnpm setup:local
```

O segundo comando cria o `.env`, gera uma senha aleatória para o administrador local, uma chave de criptografia e as configurações do armazenamento local. Também prepara a captura de e-mails pelo Mailpit. Configurações já preenchidas são preservadas.

Abra o arquivo para consultar as configurações:

```powershell
notepad .env
```

O login local usa estes campos:

```dotenv
ADMIN_EMAIL=admin@safe.local
ADMIN_PASSWORD=senha_gerada_pelo_setup
```

`senha_gerada_pelo_setup` é apenas uma explicação: **mantenha o valor real que o comando gerou no arquivo**. Se quiser escolher outra senha, altere `ADMIN_PASSWORD` antes do primeiro `db:seed`, usando pelo menos 12 caracteres.

O `db:seed` preserva senhas de contas já existentes. Alterar o `.env` depois da criação do usuário não troca sua senha no banco.

Não use o `.env` do servidor. As credenciais locais são independentes. Não envie `.env`, senhas, chaves, backups ou arquivos de dados para o GitHub; essas pastas e arquivos já são ignorados pelo projeto.

### Gemini e e-mail

Deixe `GEMINI_API_KEY` vazio para desenvolver sem consumir a API de IA. Para testar análise com IA, obtenha uma chave autorizada e configure-a somente no `.env` local. A análise depende de solicitação manual no portal.

Mantenha o SMTP local gerado pelo setup. Os e-mails ficam em http://127.0.0.1:8025 e não são enviados para destinatários externos. Não é necessário configurar a senha do Gmail do sistema.

## 6. Subir os serviços e criar o banco

Com o Docker Desktop aberto:

```powershell
docker compose up -d
docker compose ps
```

Esse comando inicia PostgreSQL, Redis, Garage (arquivos) e Mailpit (e-mails). Aguarde o PostgreSQL ficar saudável (`healthy`). Caso ainda esteja iniciando, execute novamente `docker compose ps` após alguns segundos.

Depois:

```powershell
pnpm db:migrate
pnpm db:seed
```

O primeiro prepara as tabelas; o segundo cadastra a estrutura inicial, as empresas NTHUB, Safe, DBSeller e IA Tecnologia e o administrador local.

## 7. Executar a aplicação

No primeiro terminal, dentro da pasta do projeto:

```powershell
cd "$HOME\Projetos\nthub-licitacoes"
pnpm dev
```

Deixe esse terminal aberto. Ele executa a API e a interface.

Abra um **segundo terminal**:

```powershell
cd "$HOME\Projetos\nthub-licitacoes"
pnpm worker
```

Deixe esse terminal aberto também. O worker executa os trabalhos em segundo plano, incluindo as coletas solicitadas no portal.

Acessos locais:

| Serviço | Endereço |
| --- | --- |
| Portal | http://127.0.0.1:5173 |
| Documentação da API | http://127.0.0.1:3001/docs |
| E-mails capturados | http://127.0.0.1:8025 |

Entre no portal com `ADMIN_EMAIL` e a senha real de `ADMIN_PASSWORD` do seu `.env`.

A NTHUB é o ambiente de gestão. Para trabalhar no CRM, selecione Safe, DBSeller ou IA Tecnologia. A base começa sem as oportunidades do servidor; utilize as fontes do portal para coletar dados quando precisar. Coletas dependem da disponibilidade e dos limites do PNCP/Compras.gov.br.

## 8. Parar e iniciar em outro dia

Para parar API/interface e worker, pressione `Ctrl+C` em cada terminal.

Para parar os serviços Docker do projeto, preservando os dados:

```powershell
docker compose stop
```

No próximo dia, abra o Docker Desktop e execute:

```powershell
cd "$HOME\Projetos\nthub-licitacoes"
docker compose up -d
pnpm dev
```

Em outro terminal:

```powershell
cd "$HOME\Projetos\nthub-licitacoes"
pnpm worker
```

Não é necessário clonar, executar o setup ou recriar o banco toda vez. Não use `docker compose down -v`: a opção `-v` remove os volumes com os dados locais.

## 9. Criar uma branch para cada alteração

Antes de começar uma nova tarefa, com o trabalho anterior salvo em commit ou concluído:

```powershell
cd "$HOME\Projetos\nthub-licitacoes"
git status
git switch main
git pull --ff-only origin main
```

Se `git status` mostrar alterações pendentes, resolva-as na branch em que foram feitas antes de trocar de branch. Não descarte arquivos apenas para conseguir continuar.

Crie uma branch com um nome descritivo. Derik, por exemplo:

```powershell
git switch -c derik/melhoria-crm
```

Deivid, por exemplo:

```powershell
git switch -c deivid/ajuste-indicadores
```

Cada um trabalha em sua própria branch. Não façam alterações diretamente na `main` e não compartilhem uma branch para trabalhos independentes.

Ao atualizar o código local, dependências ou estrutura de banco podem mudar. Com os processos de desenvolvimento parados, execute conforme necessário:

```powershell
pnpm install --frozen-lockfile
docker compose up -d
pnpm db:migrate
```

Depois reinicie `pnpm dev` e `pnpm worker`.

## 10. Fazer as alterações e validar

Edite os arquivos e confira o resultado no navegador. Estrutura principal:

- `apps/web`: interface Vue.
- `apps/api`: API, regras de negócio e worker.
- `packages/contracts`: contratos e definições compartilhadas.
- `docs`: documentação.
- `deploy/ubuntu`: instalação e atualização no servidor.

Antes de enviar, mantenha os serviços Docker ativos e rode no terminal da raiz do projeto:

```powershell
pnpm typecheck
pnpm test
pnpm build
```

Os testes utilizam o PostgreSQL/Redis configurados no `.env` local e não consomem créditos de Gemini. Execute-os somente na sua base de desenvolvimento.

Se algum comando falhar, corrija o problema antes de solicitar aprovação. Teste também o comportamento alterado no navegador; para mudanças visuais, anexe uma captura ao PR.

## 11. Criar o commit e enviar a branch

Confira as alterações:

```powershell
git status
git diff
```

Adicione somente os arquivos da tarefa. Você pode indicar os caminhos individualmente com `git add caminho/do/arquivo`. Se todos os arquivos alterados pertencem à tarefa:

```powershell
git add .
git diff --cached
```

Confira se o conteúdo está correto e sem credenciais. Depois:

```powershell
git commit -m "Melhora movimentação dos cards do CRM"
git push -u origin HEAD
```

Adapte a mensagem ao trabalho realizado. O primeiro `push` pode solicitar autenticação no navegador.

## 12. Abrir o Pull Request

1. Abra https://github.com/nthub-projetos/nthub-licitacoes.
2. Após o push, clique em **Compare & pull request**. Se o botão não aparecer, abra **Pull requests → New pull request**.
3. Selecione **base: main** e **compare: sua branch**.
4. Confira a lista de commits e o diff: o PR deve conter somente a tarefa proposta.
5. Escreva um título claro e preencha a descrição com o modelo abaixo.
6. Selecione o responsável pela revisão em **Reviewers**, quando disponível.
7. Clique em **Create pull request**. Se ainda estiver incompleto, use **Draft pull request** e marque como pronto quando terminar.

Modelo de descrição:

```markdown
## O que mudou
- Descreva o comportamento alterado.

## Como testar
1. Acesse a tela ...
2. Execute a ação ...
3. Confira o resultado ...

## Validação
- [ ] pnpm typecheck
- [ ] pnpm test
- [ ] pnpm build
- [ ] Teste manual do fluxo alterado

## Capturas
Anexe imagens quando houver alteração visual.

## Banco ou configuração
Informe se exige migração ou nova variável de ambiente, sem incluir segredos.
```

Marque somente as verificações que realmente passaram.

## 13. Corrigir após a revisão

Se forem solicitados ajustes, continue na mesma branch, faça as correções e valide novamente:

```powershell
git add .
git diff --cached
git commit -m "Ajusta pontos solicitados na revisão"
git push
```

O PR existente recebe os novos commits automaticamente. Não é necessário abrir outro PR para corrigir a mesma tarefa. Responda aos comentários explicando o que foi ajustado.

Se novos commits invalidarem uma aprovação anterior, solicite nova revisão.

## 14. Atualizar a branch com mudanças da main

Se a `main` avançou durante seu trabalho, salve suas alterações em commit e, estando na sua branch, execute:

```powershell
git fetch origin
git merge origin/main
```

Se houver conflitos, abra os arquivos indicados pelo Git, resolva o conteúdo final e remova os marcadores `<<<<<<<`, `=======` e `>>>>>>>`. Depois:

```powershell
git add .
git diff --cached
git commit
```

O `git commit` de conclusão só é necessário se o merge ficou pendente de resolução. Valide novamente e envie:

```powershell
pnpm typecheck
pnpm test
pnpm build
git push
```

Se não conseguir resolver o conflito com segurança, peça ajuda. Para cancelar um merge ainda em andamento e voltar ao estado anterior, use `git merge --abort`. Este fluxo não precisa de `push --force`.

## 15. Depois que o PR for integrado

O responsável revisa, aprova e faz o merge conforme as regras da `main`. Após a confirmação do merge:

```powershell
git switch main
git pull --ff-only origin main
pnpm install --frozen-lockfile
pnpm db:migrate
```

Mantenha o Docker ativo para a migração. Para a próxima tarefa, crie outra branch a partir dessa `main` atualizada.

O merge atualiza o GitHub. **A publicação no servidor é manual**, realizada pelo responsável no Ubuntu:

```bash
cd ~/nthub-teste-pacote/nthub-licitacoes
bash deploy/ubuntu/update.sh
```

Derik e Deivid não precisam acessar o servidor para desenvolver ou abrir PRs.

## 16. Problemas frequentes

### “pnpm não é reconhecido”

Reabra o terminal e confira a instalação de Node/npm. Execute novamente `npm install --global pnpm@11.25.0`. Se houver bloqueio de script no PowerShell, use `npm.cmd` e `pnpm.cmd`.

### Docker não conecta ou “engine is not running”

Abra o Docker Desktop, aguarde a inicialização e confira `docker info`. Verifique a configuração WSL 2 solicitada pelo instalador.

### Porta ocupada

O ambiente usa 5432 (PostgreSQL), 6379 (Redis), 9000 (arquivos), 1025/8025 (e-mails), 3001 (API) e 5173 (interface). Se alguma já estiver ocupada, identifique o serviço antes de interrompê-lo. Peça ajuda para ajustar as portas e as URLs correspondentes; não pare aplicações de terceiros sem verificar.

### Erro de conexão com banco ou Redis

Na raiz do projeto:

```powershell
docker compose ps
docker compose logs --tail=80 postgres redis
```

Confirme que `pnpm setup:local` foi executado e que o PostgreSQL está saudável antes de migrar.

### Falha de arquivos ou e-mails

```powershell
docker compose logs --tail=80 objectstore mailpit
```

Confira o `.env` local sem compartilhar seu conteúdo completo.

### Login local não funciona

Confira `ADMIN_EMAIL` e `ADMIN_PASSWORD` no `.env` usado no primeiro seed. A senha do servidor é independente. Se a conta já existia, o seed não substitui a senha antiga.

### Erro 403 no push

Verifique a conta autenticada no Git e se o convite foi aceito com permissão de escrita. Confira o destino:

```powershell
git remote -v
```

Ele deve apontar para `https://github.com/nthub-projetos/nthub-licitacoes.git`. Se o Git estiver usando outra conta, ajuste a credencial do GitHub no Gerenciador de Credenciais do Windows e autentique novamente com a conta convidada. Confira o impacto em outros projetos que usam a mesma credencial antes de removê-la.

### Push direto na main foi bloqueado

Esse bloqueio faz parte do fluxo de revisão. Envie sua branch e abra um PR. Se fez commits locais na `main` por engano, crie uma branch para preservá-los e envie-a:

```powershell
git switch -c seu-nome/descricao-da-alteracao
git push -u origin HEAD
```

Depois peça orientação para realinhar sua `main` local sem perder trabalho.

## Checklist de entrega

- Branch própria criada a partir da `main` atualizada.
- Alteração testada localmente.
- Typecheck, testes e build aprovados.
- Nenhuma senha, chave ou arquivo de dados incluído.
- PR apontando para `main`, com descrição e instruções de teste.
- Revisão solicitada; ajustes enviados no mesmo PR.

Fluxo: **atualizar main → criar branch → desenvolver → validar → commit → push → PR → revisão → merge → publicação manual pelo responsável**.
