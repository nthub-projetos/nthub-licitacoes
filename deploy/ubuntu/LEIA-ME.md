# NTHUB Licitações — teste no Ubuntu

Pacote privado: contém cópia do banco, documentos e credenciais SMTP/Gemini. Copie somente para o computador intermediário e para o servidor destinado ao teste.

## Copiar e iniciar

No PowerShell do computador intermediário, use o caminho onde o ZIP foi copiado:

```powershell
scp "C:\CAMINHO\nthub-licitacoes-ubuntu.zip" safe@192.168.100.240:~/
ssh safe@192.168.100.240
```

No Ubuntu:

```bash
mkdir -p ~/nthub-teste-pacote
chmod 700 ~/nthub-teste-pacote
unzip -n ~/nthub-licitacoes-ubuntu.zip -d ~/nthub-teste-pacote
cd ~/nthub-teste-pacote/nthub-licitacoes
bash deploy/ubuntu/install.sh
```

Se `docker info` responder permissão negada, execute o último comando como `sudo bash deploy/ubuntu/install.sh`. Se `unzip` não existir: `sudo apt-get update && sudo apt-get install -y unzip`.

O primeiro build requer internet para baixar dependências e imagens. Acompanhe até o script mostrar os serviços saudáveis. Depois acesse **http://192.168.100.240:8088**, usando os mesmos usuários e senhas do ambiente local na data do snapshot.

## Isolamento

- Somente a porta 8088 no endereço 192.168.100.240 é publicada. As portas 80 e 5432 existentes não são alteradas.
- Projeto Docker: `nthub_licitacoes_teste`. Banco, rede e volumes pertencem somente a este projeto.
- O instalador recusa uma porta ocupada por outra aplicação. Nunca apaga ou substitui um banco existente do NTHUB.
- Os documentos são importados para o banco exclusivo do teste; não dependem deste PC Windows nem do S3 local.
- O acesso HTTP foi preparado para teste na rede local, não para publicação na internet.
- Os serviços iniciam novamente após reiniciar o Ubuntu, desde que o Docker esteja ativo.

## Dados copiados

O pacote preserva empresas, logos, usuários, perfis, oportunidades, decisões, propostas, análises e históricos existentes. O resumo fica em `backup/snapshot-info.json`.

Somente na primeira importação da cópia de teste: sessões antigas são encerradas; agendamentos, preferências de e-mail, webhooks e credenciais de integração copiados são pausados. Trabalhos antigos não são repetidos. O SMTP Gmail e o Gemini estão configurados: habilite notificações/agenda no portal quando desejar usá-los neste ambiente. A IA continua manual. Isso não altera a base original do Windows.

## Verificar e acompanhar

Execute sempre a partir da pasta `nthub-licitacoes`:

```bash
docker compose --env-file .env -p nthub_licitacoes_teste -f deploy/ubuntu/compose.yaml ps
curl -f http://192.168.100.240:8088/api/v1/health
docker compose --env-file .env -p nthub_licitacoes_teste -f deploy/ubuntu/compose.yaml logs --tail=100 api worker
```

Para parar **somente o NTHUB**:

```bash
docker compose --env-file .env -p nthub_licitacoes_teste -f deploy/ubuntu/compose.yaml stop
```

Não use `down -v`: os volumes guardam os dados do teste. Para uma atualização posterior, preserve `.env` e volumes; rode novamente o instalador. O snapshot não sobrescreve uma base já inicializada.

Se o portal responder no próprio servidor mas não no computador de teste, verifique a rede e a regra de firewall da porta 8088. O instalador não modifica o firewall nem a aplicação do escritório.


## Acessos adicionais para os testes

Além dos usuários trazidos na cópia, o pacote cria quatro contas, uma única vez:

- Deivid Santos, administrador do grupo: deivid.santos@safeconversaodigital.com.br
- Derik Pimentel, administrador do grupo: derik.pimentel@safeconversaodigital.com.br
- Deivid Santos, analista nas três empresas: deivid.santos+analista@safeconversaodigital.com.br
- Derik Pimentel, analista nas três empresas: derik.pimentel+analista@safeconversaodigital.com.br

As senhas foram entregues separadamente. Os aliases +analista são identificadores de login e não exigem criar outras caixas postais. Nenhum e-mail de convite é enviado. Os administradores acessam a gestão NTHUB e as empresas; os analistas acessam Safe, DBSeller e IA Tecnologia. Os usuários locais originais não foram alterados.
