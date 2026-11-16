export const permissionCatalog = [
  ['opportunities:read', 'CRM e oportunidades', 'Visualizar oportunidades'],
  [
    'opportunities:write',
    'CRM e oportunidades',
    'Editar etapas, contatos e comentários',
  ],
  [
    'opportunities:transfer',
    'CRM e oportunidades',
    'Transferir oportunidades entre empresas',
  ],
  ['intelligence:run', 'CRM e oportunidades', 'Solicitar análise por IA'],
  ['documents:read', 'CRM e oportunidades', 'Ler editais e anexos'],
  ['documents:write', 'CRM e oportunidades', 'Atualizar documentos do edital'],
  ['bids:read', 'Propostas', 'Visualizar propostas'],
  ['bids:write', 'Propostas', 'Cadastrar e editar propostas'],
  ['tasks:read', 'Tarefas', 'Visualizar tarefas'],
  ['tasks:write', 'Tarefas', 'Cadastrar e editar tarefas'],
  ['analytics:read', 'Indicadores', 'Consultar indicadores da empresa'],
  ['exports:read', 'Indicadores', 'Exportar informações'],
  ['company:read', 'Empresa', 'Consultar cadastro da empresa'],
  ['company:manage', 'Empresa', 'Editar cadastro e critérios de pesquisa'],
  ['members:read', 'Funcionários', 'Consultar funcionários'],
  ['members:manage', 'Funcionários', 'Cadastrar e gerenciar funcionários'],
  ['sources:read', 'Configurações', 'Consultar fontes e coletas'],
  ['sources:sync', 'Configurações', 'Sincronizar fontes'],
  ['sources:manage', 'Configurações', 'Configurar fontes e agendamentos'],
  ['integrations:read', 'Configurações', 'Consultar integrações'],
  ['integrations:manage', 'Configurações', 'Gerenciar integrações'],
  ['audit:read', 'Configurações', 'Consultar atividades'],
  ['notifications:read', 'Pessoal', 'Consultar notificações'],
  ['notifications:write', 'Pessoal', 'Marcar notificações como lidas'],
  ['searches:read', 'Pessoal', 'Consultar pesquisas salvas'],
  ['searches:write', 'Pessoal', 'Gerenciar pesquisas salvas'],
  ['profile:read', 'Pessoal', 'Consultar a própria conta'],
  ['profile:write', 'Pessoal', 'Editar a própria conta'],
] as const;
export const permissionKeys = permissionCatalog.map(([key]) => key);
export const builtinProfiles = [
  { id: 'company_manager', name: 'Gestor da empresa' },
  { id: 'analyst', name: 'Analista' },
  { id: 'viewer', name: 'Leitor / auditor' },
] as const;
export function defaultPermissions(role?: string): string[] {
  if (role === 'group_admin' || role === 'company_manager')
    return [...permissionKeys];
  if (role === 'analyst')
    return permissionKeys.filter(
      (p) => !p.endsWith(':manage') && p !== 'integrations:read',
    );
  if (role === 'viewer')
    return permissionKeys.filter(
      (p) =>
        p.endsWith(':read') ||
        ['notifications:write', 'searches:write', 'profile:write'].includes(p),
    );
  return [];
}
export function effectivePermissions(
  role: string | undefined,
  profile: string[] | null,
  overrides: Record<string, boolean> = {},
): string[] {
  const allowed = new Set(profile ?? defaultPermissions(role));
  for (const [key, enabled] of Object.entries(overrides)) {
    if (!permissionKeys.includes(key as (typeof permissionKeys)[number]))
      continue;
    if (enabled) allowed.add(key);
    else allowed.delete(key);
  }
  return [...allowed];
}
export function hasPermission(
  context: { isGroupAdmin?: boolean; role?: string; permissions?: string[] },
  key: string,
): boolean {
  return (
    !!context.isGroupAdmin ||
    context.role === 'group_admin' ||
    (context.permissions ?? defaultPermissions(context.role)).includes(key)
  );
}
