# Atualização manual pelo GitHub

Um PR aprovado e mesclado atualiza apenas o GitHub. Não há GitHub Actions, cron ou publicação automática.

## Preparar uma instalação vinda do ZIP

Faça isto **depois** de instalar o ZIP e publicar este código na `main` do repositório. No Ubuntu, como usuário `safe`:

```bash
cd ~
git clone https://github.com/nthub-projetos/nthub-licitacoes.git nthub-licitacoes
cd ~/nthub-licitacoes
cp ~/nthub-teste-pacote/nthub-licitacoes/.env .env
chmod 600 .env
cp -a ~/nthub-teste-pacote/nthub-licitacoes/backup ./backup
bash deploy/ubuntu/update.sh
```

Os comandos não apagam nem sobrescrevem a pasta da instalação inicial. Se `~/nthub-licitacoes` já existir, pare e confira seu conteúdo antes de repetir o clone. Ajuste o caminho de origem se tiver instalado o ZIP em outra pasta.

Em um repositório privado, o GitHub exige autenticação para clonar e buscar. Use uma chave SSH ou o login HTTPS com token; não coloque tokens na URL nem em arquivos versionados. A senha normal do GitHub não serve como token.

O projeto Docker continua sendo `nthub_licitacoes_teste`. Seus volumes existentes são reutilizados mesmo mudando a pasta do código. A aplicação do escritório não é parada. O script usa `sudo docker` se o usuário ainda não tiver permissão direta de Docker; execute o script como `safe`, sem `sudo bash`, para manter o Git no usuário correto.

## Publicar alterações aprovadas

Após o merge dos PRs na `main`, execute apenas:

```bash
cd ~/nthub-licitacoes
bash deploy/ubuntu/update.sh
```

O script verifica a árvore limpa e o histórico, busca a `main`, guarda as imagens anteriores, compila, pausa os serviços do NTHUB, faz o backup privado e migra o banco. Depois inicia a nova versão e verifica a API pelo servidor web. Alterações locais ou histórico divergente interrompem a publicação sem executar `reset`.

O backup fica em `backups/manual-update/DATA/`. `.env`, banco, documentos e backups continuam fora do Git. Não é preciso reenviar o ZIP nas atualizações. A rotina não executa a restauração nem a criação inicial das contas de teste.

Pode haver indisponibilidade entre a pausa e o fim da publicação. Reserve esse intervalo com os usuários. Se o build falhar, a versão que estava rodando permanece disponível. Se uma migração já foi iniciada e ocorrer uma falha, os serviços ficam pausados; consulte `RECUPERACAO.md`.

## Consultar o estado

```bash
docker compose --env-file .env -p nthub_licitacoes_teste -f deploy/ubuntu/compose.yaml ps
docker compose --env-file .env -p nthub_licitacoes_teste -f deploy/ubuntu/compose.yaml logs --tail=100 api worker
cat .runtime/deployed-commit
```

Se o Docker exigir privilégio, use `sudo docker` nesses comandos de consulta.
