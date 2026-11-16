# Recuperação de uma atualização manual

Esta pasta é privada: contém credenciais, banco e a configuração anterior do NTHUB. Não envie ao GitHub.

- `BACKUP-CONCLUIDO.txt` só existe depois de concluir o dump e conferir seu catálogo. Sem esse arquivo, não considere o dump válido.
- `database.dump` inclui usuários, históricos e documentos guardados no PostgreSQL desta instalação.
- `.env` e `compose-resolved.yaml` preservam configuração e credenciais anteriores.
- `previous-images.yaml` referencia as imagens Docker anteriores, mantidas com tags próprias.
- Os arquivos de revisão identificam o checkout e a versão que estava sendo publicada. Na primeira adoção do GitHub, a revisão da instalação antiga pode ser desconhecida; as imagens anteriores continuam identificadas.

## Antes de uma migração

O atualizador tenta retomar as imagens anteriores automaticamente se a falha ocorreu após a pausa, mas antes de iniciar a migração.

## Depois de iniciar uma migração

O NTHUB fica pausado se a publicação falhar. Confira os logs e a compatibilidade do banco antes de reiniciar uma imagem antiga. Voltar somente o código não desfaz uma migração.

Não use o instalador inicial nem o arquivo `backup/database.dump` do ZIP para recuperar uma atualização: isso voltaria à cópia original e perderia alterações posteriores.

Uma recuperação completa deve restaurar o `database.dump` **desta pasta** em um banco temporário do próprio projeto NTHUB, conferir os dados e então trocar o banco de destino, mantendo o banco com falha para análise. Revise também trabalhos pendentes da fila para não repetir e-mails ou análises. Essa restauração é uma decisão manual: pode descartar alterações feitas após o ponto do backup.

Não remova volumes, imagens `previous-*` ou esta pasta até confirmar a atualização e guardar o backup fora do servidor.
