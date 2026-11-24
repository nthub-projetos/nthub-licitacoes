<script setup lang="ts">
import {
  computed,
  onMounted,
  onUnmounted,
  ref,
  nextTick,
  watch,
  defineAsyncComponent,
} from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  LayoutDashboard,
  Search,
  Building2,
  History,
  LogOut,
  ArrowUpRight,
  RefreshCw,
  FileText,
  Sparkles,
  X,
  ChevronRight,
  ShieldCheck,
  Plus,
  Inbox,
  Sun,
  Moon,
  ArrowRight,
  Database,
  ScanLine,
  CircleCheck,
  Radio,
  Users,
  BriefcaseBusiness,
  Bell,
  ClipboardList,
  ChartColumn,
  Network,
  UserRound,
  Settings2,
} from 'lucide-vue-next';
import type {
  CatalogQuery,
  CatalogSummary,
  Opportunity,
  Status,
  OpportunityContent,
  SourceDocument,
  UserContext,
} from '@nthub/contracts';
import { hasPermission } from '@nthub/contracts';
import { api, setApiCompany } from './api';
import PasswordRecovery from './modules/PasswordRecovery.vue';
const catalogQuery = ref<Partial<CatalogQuery>>({ page: 1, pageSize: 50 });
const catalog = ref<{
  total: number;
  page: number;
  pageSize: number;
  summary: CatalogSummary;
} | null>(null);
const catalogLoading = ref(false);
async function changeCatalog(value: Partial<CatalogQuery>) {
  catalogQuery.value = value;
  await run(load);
}
const recoveryMode = ref<'forgot' | 'required' | null>(null);
const Permissions = defineAsyncComponent(
  () => import('./modules/Permissions.vue'),
);
const Settings = defineAsyncComponent(() => import('./modules/Settings.vue'));
const GroupDashboard = defineAsyncComponent(
  () => import('./modules/GroupDashboard.vue'),
);
const DiscardDialog = defineAsyncComponent(
  () => import('./modules/DiscardDialog.vue'),
);
const discardId = ref<string | null>(null),
  discardBusy = ref(false),
  discardError = ref('');
function requestDiscard(id: string) {
  discardId.value = id;
  discardError.value = '';
}
async function confirmDiscard(reason: string) {
  if (!discardId.value || !reason.trim()) return;
  discardBusy.value = true;
  discardError.value = '';
  try {
    await api('/opportunities/' + discardId.value + '/status', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'discarded', reason }),
    });
    discardId.value = null;
    await load();
  } catch (e) {
    discardError.value =
      e instanceof Error ? e.message : 'Falha ao descartar oportunidade.';
  } finally {
    discardBusy.value = false;
  }
}
const Crm = defineAsyncComponent(() => import('./modules/Crm.vue'));
const AdherenceBreakdown = defineAsyncComponent(
  () => import('./modules/AdherenceBreakdown.vue'),
);
const crmUpdatedAt = ref<string | null>(null);
const Administration = defineAsyncComponent(
  () => import('./modules/Administration.vue'),
);
const Operations = defineAsyncComponent(
  () => import('./modules/Operations.vue'),
);
const Invitation = defineAsyncComponent(
  () => import('./modules/Invitation.vue'),
);
const OpportunityTools = defineAsyncComponent(
  () => import('./modules/OpportunityTools.vue'),
);
import { useTheme } from './theme';
const { isDark, toggleTheme } = useTheme();
const route = useRoute(),
  router = useRouter();
const oidcAvailable = ref(false);
const savedSearches = ref<
  { id: string; name: string; filters: { query: string; status: string } }[]
>([]);
const searchName = ref('');
async function saveSearch() {
  await run(async () => {
    await api('/saved-searches', {
      method: 'POST',
      body: JSON.stringify({
        name: searchName.value,
        filters: { query: search.value, status: filter.value },
      }),
    });
    searchName.value = '';
    savedSearches.value = await api('/saved-searches');
  });
}
async function removeSearch(id: string) {
  await run(async () => {
    await api('/saved-searches/' + id, { method: 'DELETE' });
    savedSearches.value = savedSearches.value.filter((s) => s.id !== id);
  });
}
const me = ref<UserContext | null>(null),
  ready = ref(false),
  email = ref('admin@safe.local'),
  password = ref(''),
  error = ref(''),
  notice = ref(''),
  busy = ref(false),
  processing = ref(false),
  items = ref<Opportunity[]>([]),
  search = ref(''),
  filter = ref('all'),
  selected = ref<Opportunity | null>(null),
  syncOpen = ref(false),
  audit = ref<{ action: string; createdAt: string; resourceId: string }[]>([]);
const companyName = computed(
  () => me.value?.company.shortName || me.value?.company.name || 'empresa',
);
const can = (key: string) => !!me.value && hasPermission(me.value, key);
const canWrite = computed(() => can('opportunities:write'));
const canAnalyze = computed(() => can('intelligence:run') && canWrite.value);
const canManage = computed(
  () => me.value?.isGroupAdmin || me.value?.role === 'company_manager',
);
const navEntries = computed(() =>
  [
    ...(me.value?.company.isParent
      ? []
      : [
          { path: 'crm', name: 'CRM', icon: BriefcaseBusiness, main: true },
          {
            path: 'overview',
            name: 'Visão geral',
            icon: LayoutDashboard,
            main: true,
          },
          {
            path: 'opportunities',
            name: 'Oportunidades',
            icon: Search,
            main: true,
          },
        ]),
    ...(me.value?.isGroupAdmin
      ? [
          {
            path: 'group',
            name: 'Indicadores do grupo',
            icon: ChartColumn,
            main: !!me.value?.company.isParent,
          },
          {
            path: 'companies',
            name: 'Empresas',
            icon: Building2,
            main: !!me.value?.company.isParent,
          },
        ]
      : []),
    { path: 'notifications', name: 'Notificações', icon: Bell, main: true },
    {
      path: 'company',
      name: me.value?.company.isParent
        ? 'Cadastro NTHUB'
        : 'Empresa e critérios',
      icon: Settings2,
      main: false,
    },
    { path: 'members', name: 'Funcionários', icon: Users, main: false },
    ...(me.value?.isGroupAdmin
      ? [
          {
            path: 'permissions',
            name: 'Permissões',
            icon: ShieldCheck,
            main: false,
          },
        ]
      : []),
    { path: 'tasks', name: 'Tarefas', icon: ClipboardList, main: false },
    ...(!me.value?.company.isParent
      ? [
          {
            path: 'reports',
            name: 'Indicadores',
            icon: ChartColumn,
            main: false,
          },
        ]
      : []),
    {
      path: 'settings',
      name: 'Configurações',
      icon: Settings2,
      main: !!me.value?.company.isParent,
    },
    { path: 'account', name: 'Minha conta', icon: UserRound, main: false },
  ].filter((entry) => {
    const required: Record<string, string> = {
      crm: 'opportunities:read',
      overview: 'opportunities:read',
      opportunities: 'opportunities:read',
      company: 'company:read',
      members: 'members:read',
      tasks: 'tasks:read',
      reports: 'analytics:read',
      notifications: 'notifications:read',
      account: 'profile:read',
    };
    if (entry.path === 'settings')
      return ['sources:read', 'integrations:read', 'audit:read'].some(can);
    const key = required[entry.path];
    return !key || can(key);
  }),
);
const administrationViews = ['companies', 'company', 'members', 'account'];
const operationViews = ['tasks', 'notifications', 'reports'];
async function refreshContext() {
  const current = me.value?.companyId;
  const context = await api<UserContext>('/me');
  if (current && context.companyId !== current) return;
  me.value = context;
  setApiCompany(context.companyId);
  await load();
}
async function switchCompany(id: string) {
  if (!me.value || busy.value) return;
  await run(async () => {
    await api('/companies/switch', {
      method: 'POST',
      body: JSON.stringify({ companyId: id }),
    });
    setApiCompany(id);
    selected.value = null;
    content.value = null;
    items.value = [];
    catalogQuery.value = { page: 1, pageSize: 50 };
    catalog.value = null;
    audit.value = [];
    search.value = '';
    filter.value = 'all';
    if (timer) clearTimeout(timer);
    processing.value = false;
    me.value = await api<UserContext>('/me');
    await router.replace(me.value.company.isParent ? '/group' : '/crm');
    await load();
  });
}
async function openById(id: string) {
  const item = await api<Opportunity>('/opportunities/' + id);
  if (item) await openOpportunity(item);
  else error.value = 'Oportunidade não encontrada no ambiente atual.';
}
function sessionEnded() {
  setApiCompany(null);
  me.value = null;
  items.value = [];
  selected.value = null;
}
const content = ref<OpportunityContent | null>(null);
const detailLoading = ref(false);
const documentPages = ref<{ page: number; text: string }[]>([]);
const viewedDocument = ref<SourceDocument | null>(null);
const documentView = ref<'text' | 'original'>('text');
const processingLabels: Record<string, string> = {
  pending: 'Aguardando coleta',
  queued: 'Na fila de coleta',
  processing: 'Buscando documentos e informações…',
  ready: 'Informações atualizadas',
  partial: 'Coleta com pendências',
  failed: 'Falha ao consultar a fonte',
};
const extractionLabels: Record<string, string> = {
  ready: 'Texto disponível',
  needs_ocr: 'Leitura visual pendente',
  archive: 'Pacote de anexos',
  failed: 'Falha na leitura',
  unsupported: 'Arquivo original disponível',
};
const currentAnalysis = computed(() => content.value?.analysis || null);
const sourceLabels: Record<string, string> = {
  numeroControlePNCP: 'Identificador PNCP',
  numeroCompra: 'Número da contratação',
  anoCompra: 'Ano',
  processo: 'Processo',
  objetoCompra: 'Objeto completo',
  informacaoComplementar: 'Informações complementares',
  modalidadeNome: 'Modalidade',
  modoDisputaNome: 'Modo de disputa',
  situacaoCompraNome: 'Situação na fonte',
  dataPublicacaoPncp: 'Publicação no PNCP',
  dataAberturaProposta: 'Abertura de propostas',
  dataEncerramentoProposta: 'Encerramento de propostas',
  valorTotalEstimado: 'Valor total estimado',
  valorTotalHomologado: 'Valor homologado',
  srp: 'Registro de preços',
  cnpj: 'CNPJ',
  razaoSocial: 'Razão social',
  nomeUnidade: 'Unidade responsável',
  orgaoEntidade: 'Órgão',
  unidadeOrgao: 'Unidade',
  ufSigla: 'UF',
  municipioNome: 'Município',
  amparoLegal: 'Amparo legal',
  linkSistemaOrigem: 'Sistema de origem',
  linkProcessoEletronico: 'Processo eletrônico',
};
function flattenSource(
  value: unknown,
  prefix = '',
): { label: string; value: string }[] {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.entries(value).flatMap(([key, val]) =>
      flattenSource(
        val,
        [prefix, sourceLabels[key] || key.replace(/([a-z])([A-Z])/g, '$1 $2')]
          .filter(Boolean)
          .join(' · '),
      ),
    );
  }
  return [
    {
      label: prefix,
      value:
        value == null
          ? 'Não informado na fonte'
          : typeof value === 'boolean'
            ? value
              ? 'Sim'
              : 'Não'
            : Array.isArray(value)
              ? value.join(', ')
              : String(value),
    },
  ];
}
const sourceInfo = computed(() => flattenSource(content.value?.source || {}));
async function loadContent(id: string) {
  const result = await api<OpportunityContent>(
    '/opportunities/' + id + '/content',
  );
  if (selected.value?.id === id) content.value = result;
}
async function openOpportunity(item: Opportunity) {
  selected.value = item;
  content.value = null;
  viewedDocument.value = null;
  documentPages.value = [];
  detailLoading.value = true;
  await run(async () => {
    try {
      await loadContent(item.id);
    } finally {
      detailLoading.value = false;
    }
  });
}
async function refreshSource() {
  if (!selected.value || !canWrite.value) return;
  await run(async () => {
    const job = await api<{ jobId: string }>(
      '/opportunities/' + selected.value!.id + '/refresh',
      { method: 'POST' },
    );
    await loadContent(selected.value!.id);
    await watchJob(job.jobId);
  });
}
async function viewDocument(doc: SourceDocument, page?: number) {
  viewedDocument.value = doc;
  documentPages.value = [];
  documentView.value = 'text';
  await run(async () => {
    const response = await api<{ pages: { page: number; text: string }[] }>(
      '/documents/' + doc.id + '/text',
    );
    if (viewedDocument.value?.id === doc.id)
      documentPages.value = response.pages;
    await nextTick();
    if (page)
      document
        .querySelector(`[data-doc-page="${page}"]`)
        ?.scrollIntoView({ block: 'start' });
  });
}
async function viewEvidence(id: string | undefined, page: number) {
  const doc = content.value?.documents.find((d) => d.id === id);
  if (doc) await viewDocument(doc, page);
}
const workspaceDate = new Intl.DateTimeFormat('pt-BR', {
  day: 'numeric',
  month: 'long',
  timeZone: 'America/Sao_Paulo',
}).format(new Date());
const collectedDocuments = computed(() =>
  items.value.reduce((total, item) => total + item.documentCount, 0),
);
const preparedAnalyses = computed(
  () => items.value.filter((item) => item.analysis).length,
);
const lastSync = computed(
  () =>
    items.value
      .map((item) => item.syncedAt)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) || null,
);
let previousFocus: HTMLElement | null = null;
let previousOverflow = '';
watch(
  () => Boolean(selected.value || syncOpen.value),
  async (open) => {
    if (open) {
      previousFocus =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      await nextTick();
      document
        .querySelector<HTMLElement>(
          '[role="dialog"] button:not([disabled]),[role="dialog"] input',
        )
        ?.focus({ preventScroll: true });
    } else {
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus({ preventScroll: true });
    }
  },
);
function dialogKeys(event: KeyboardEvent) {
  if (!selected.value && !syncOpen.value) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    selected.value = null;
    syncOpen.value = false;
    return;
  }
  if (event.key !== 'Tab') return;
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
  const controls = Array.from(
    dialog?.querySelectorAll<HTMLElement>(
      'button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),[tabindex="0"]',
    ) || [],
  ).filter((element) => element.getClientRects().length);
  const first = controls[0],
    last = controls.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}
const today = new Date().toLocaleDateString('en-CA', {
  timeZone: 'America/Sao_Paulo',
});
const syncSource = ref<'pncp' | 'compras'>('pncp');
const since = ref(today),
  until = ref(today),
  uf = ref(''),
  modality = ref(6);
const labels: Record<Status, string> = {
  new: 'Nova',
  review: 'Em análise',
  selected: 'Selecionada',
  discarded: 'Descartada',
  submitted: 'Proposta enviada',
  won: 'Vencida',
  lost: 'Perdida',
};
const view = computed(() => String(route.params.view || 'crm'));
watch(view, () => {
  catalogQuery.value = { page: 1, pageSize: 50 };
  if (me.value) void run(load);
});
watch(
  [() => route.params.view, () => me.value?.companyId],
  () => {
    if (!me.value) return;
    const current = String(route.params.view || '');
    if (['sources', 'integrations', 'audit'].includes(current)) {
      void router.replace({ path: '/settings', query: { tab: current } });
      return;
    }
    if (
      current &&
      current !== 'no-access' &&
      !['sources', 'integrations', 'audit', 'bids', 'files'].includes(
        current,
      ) &&
      !navEntries.value.some((e) => e.path === current)
    ) {
      void router.replace('/' + (navEntries.value[0]?.path ?? 'no-access'));
      return;
    }
    if (
      ['bids', 'files'].includes(current) ||
      !current ||
      (me.value.company.isParent &&
        ['crm', 'overview', 'opportunities', 'reports'].includes(current))
    )
      void router.replace(me.value.company.isParent ? '/group' : '/crm');
  },
  { immediate: true },
);

const filtered = computed(() =>
  items.value.filter(
    (i) =>
      (filter.value === 'all' || i.status === filter.value) &&
      [i.title, i.agency, i.city, i.uf]
        .join(' ')
        .toLocaleLowerCase()
        .includes(search.value.toLocaleLowerCase()),
  ),
);
const active = computed(() =>
  items.value.filter(
    (i) =>
      !['discarded', 'won', 'lost'].includes(i.status) &&
      i.deadline &&
      Date.parse(i.deadline) >= Date.now(),
  ),
);
const expiring = computed(() =>
  active.value.filter(
    (i) =>
      i.deadline &&
      Date.parse(i.deadline) > Date.now() &&
      Date.parse(i.deadline) < Date.now() + 7 * 86400000,
  ),
);
const money = (v: string | null, precision = 2) =>
  v
    ? new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
        minimumFractionDigits: 2,
        maximumFractionDigits: precision,
      }).format(Number(v))
    : 'Não informado';
const date = (v: string | null) =>
  v
    ? new Date(v).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
    : 'Não informado';
let catalogRequest = 0;
async function load() {
  const revision = ++catalogRequest;
  const scope = me.value?.companyId;
  if (!scope) return;
  catalogLoading.value = true;
  const params = new URLSearchParams(
    Object.entries(catalogQuery.value).map(([k, v]) => [k, String(v)]),
  );
  if (view.value !== 'crm') {
    params.set('area', 'all');
    params.set('search', search.value);
    params.set('stage', filter.value);
    params.set('deadline', 'all');
    params.set('processing', 'all');
  } else if (!params.has('area')) params.set('area', 'pipeline');
  try {
    const [result, history, searches] = await Promise.all([
      can('opportunities:read')
        ? api<{
            items: Opportunity[];
            total: number;
            page: number;
            pageSize: number;
            summary: CatalogSummary;
          }>('/opportunities/page?' + params)
        : Promise.resolve(null),
      can('audit:read')
        ? api<typeof audit.value>('/audit')
        : Promise.resolve([]),
      can('searches:read')
        ? api<typeof savedSearches.value>('/saved-searches')
        : Promise.resolve([]),
    ]);
    if (me.value?.companyId !== scope || revision !== catalogRequest) return;
    items.value = result?.items ?? [];
    catalog.value = result;
    crmUpdatedAt.value = new Date().toISOString();
    audit.value = history;
    savedSearches.value = searches;
    if (selected.value) {
      await loadContent(selected.value.id);
      selected.value = await api<Opportunity>(
        '/opportunities/' + selected.value.id,
      );
    }
  } finally {
    if (revision === catalogRequest) catalogLoading.value = false;
  }
}
let searchTimer: ReturnType<typeof setTimeout> | undefined;
watch([search, filter], () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    if (me.value && view.value !== 'crm') {
      catalogQuery.value.page = 1;
      void run(load);
    }
  }, 300);
});
async function run(fn: () => Promise<void>) {
  error.value = '';
  busy.value = true;
  try {
    await fn();
  } catch (e) {
    processing.value = false;
    notice.value = '';
    error.value = e instanceof Error ? e.message : 'Falha inesperada.';
  } finally {
    busy.value = false;
  }
}
async function login() {
  await run(async () => {
    const result = await api<{ passwordChangeRequired: boolean }>(
      '/auth/login',
      {
        method: 'POST',
        body: JSON.stringify({ email: email.value, password: password.value }),
      },
    );
    password.value = '';
    if (result.passwordChangeRequired) {
      setApiCompany(null);
      recoveryMode.value = 'required';
      return;
    }
    me.value = await api<UserContext>('/me');
    setApiCompany(me.value.companyId);
    await router.replace(me.value.company.isParent ? '/group' : '/crm');
    await load();
  });
}
async function logout() {
  if (timer) clearTimeout(timer);
  processing.value = false;
  await run(async () => {
    await api('/auth/logout', { method: 'POST' });
    setApiCompany(null);
    me.value = null;
    items.value = [];
    selected.value = null;
  });
}
let timer: ReturnType<typeof setTimeout> | undefined;
async function watchJob(id: string) {
  const job = await api<{ state: string; error: string | null }>('/jobs/' + id);
  if (job.state === 'failed')
    throw new Error(job.error || 'O processamento falhou.');
  processing.value = true;
  if (job.state === 'completed') {
    processing.value = false;
    notice.value = 'Processamento concluído.';
    await load();
    return;
  }
  notice.value =
    job.state === 'delayed'
      ? job.error ||
        'Aguardando liberação da fonte. A sincronização será retomada automaticamente.'
      : 'Processando em segundo plano…';
  timer = setTimeout(() => void run(() => watchJob(id)), 2500);
}
async function sync() {
  await run(async () => {
    const job = await api<{ jobId: string }>('/sources/sync', {
      method: 'POST',
      body: JSON.stringify({
        source: syncSource.value,
        since: since.value,
        until: until.value,
        modality: modality.value,
        ...(uf.value ? { uf: uf.value.toUpperCase() } : {}),
      }),
    });
    syncOpen.value = false;
    await watchJob(job.jobId);
  });
}
function statusChange(event: Event) {
  const field = event.target as HTMLSelectElement;
  const next = field.value as Status;
  field.value = selected.value?.status ?? 'new';
  void status(next);
}
async function status(value: Status) {
  if (!selected.value || selected.value.status === value) return;
  if (value === 'discarded') {
    requestDiscard(selected.value.id);
    return;
  }
  await run(async () => {
    await api('/opportunities/' + selected.value!.id + '/status', {
      method: 'PATCH',
      body: JSON.stringify({ status: value }),
    });
    await load();
  });
}
async function analyze() {
  if (!selected.value || !canAnalyze.value) return;
  await run(async () => {
    const job = await api<{ jobId: string }>(
      '/opportunities/' + selected.value!.id + '/analyses',
      { method: 'POST' },
    );
    await watchJob(job.jobId);
  });
}
onMounted(async () => {
  window.addEventListener('keydown', dialogKeys);
  api<{ oidc: boolean }>('/auth/options')
    .then((v) => (oidcAvailable.value = v.oidc))
    .catch(() => {});
  try {
    const reset = await api<{ passwordChangeRequired: boolean }>(
      '/auth/password-reset/status',
    );
    if (reset.passwordChangeRequired) {
      recoveryMode.value = 'required';
      return;
    }
    me.value = await api<UserContext>('/me');
    setApiCompany(me.value.companyId);
    await load();
  } catch {
    me.value = null;
  } finally {
    ready.value = true;
  }
});
onUnmounted(() => {
  window.removeEventListener('keydown', dialogKeys);
  document.body.style.overflow = previousOverflow;
  if (timer) clearTimeout(timer);
  clearTimeout(searchTimer);
});
</script>
<template>
  <DiscardDialog
    v-if="discardId"
    :busy="discardBusy"
    :error="discardError"
    @cancel="discardId = null"
    @confirm="confirmDiscard"
  />
  <Invitation v-if="route.params.view === 'accept-invitation'" />
  <div v-else-if="!ready" class="loading">Carregando NTHub…</div>
  <div v-else-if="!me" class="login">
    <button
      class="theme-toggle login-theme"
      @click="toggleTheme"
      :aria-label="isDark ? 'Ativar modo claro' : 'Ativar modo escuro'"
      :aria-pressed="isDark"
    >
      <Sun v-if="isDark" :size="17" /><Moon v-else :size="17" /><span>{{
        isDark ? 'Modo claro' : 'Modo escuro'
      }}</span>
    </button>
    <div class="login-brand">
      <img
        class="brand-logo login-logo"
        src="/brand/nthub-logo.png"
        alt="NTHUB"
        width="1040"
        height="1014"
      />
      <h1>
        O próximo contrato<br />começa com uma<br /><em>boa oportunidade.</em>
      </h1>
      <p>Inteligência em licitações para as empresas do grupo NTHUB.</p>
      <span class="login-footer">NTHub / PORTAL DE LICITAÇÕES</span>
    </div>
    <PasswordRecovery
      v-if="recoveryMode"
      :key="recoveryMode"
      :required="recoveryMode === 'required'"
      :initial-email="email"
      @back="
        recoveryMode = null;
        error = '';
        notice = '';
      "
      @complete="
        recoveryMode = null;
        error = '';
        notice = 'Senha alterada. Entre com sua nova senha.';
      "
    />
    <form v-else @submit.prevent="login" class="login-form">
      <span class="eyebrow">BEM-VINDO AO NTHUB</span>
      <h2>Acesse seu espaço</h2>
      <a
        v-if="oidcAvailable"
        class="button secondary"
        href="/api/v1/auth/oidc/start"
        >Entrar com acesso corporativo</a
      >
      <p>Entre para acessar os ambientes autorizados da sua empresa.</p>
      <label
        >E-mail<input
          v-model="email"
          type="email"
          autocomplete="username"
          required /></label
      ><label
        >Senha<input
          v-model="password"
          type="password"
          autocomplete="current-password"
          required
      /></label>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <p v-if="notice" class="notice" role="status">{{ notice }}</p>
      <button class="primary" :disabled="busy || processing">
        {{ busy ? 'Entrando…' : 'Entrar no portal' }}
        <ArrowUpRight :size="17" />
      </button>
      <button
        type="button"
        class="secondary"
        :disabled="busy"
        @click="
          recoveryMode = 'forgot';
          error = '';
          notice = '';
        "
      >
        Esqueci minha senha
      </button>
      <small
        ><ShieldCheck :size="14" /> Ambiente corporativo · acesso
        restrito</small
      >
    </form>
  </div>
  <div v-else class="shell">
    <aside class="sidebar">
      <RouterLink to="/" class="brand" aria-label="NTHUB Licitações · início"
        ><img
          class="brand-logo"
          src="/brand/nthub-logo.png"
          alt=""
          width="1040"
          height="1014"
        /><span class="brand-copy"
          ><strong>NTHUB</strong><small>LICITAÇÕES</small></span
        ></RouterLink
      >
      <span class="workspace-label">ESPAÇO DE TRABALHO</span>
      <div class="company-switch company-picker">
        <img
          v-if="me.company.logoUrl"
          :src="me.company.logoUrl"
          :alt="me.company.name"
        />
        <div>
          <label for="company-picker">AMBIENTE ATUAL</label
          ><select
            id="company-picker"
            :value="me.companyId"
            @change="switchCompany(($event.target as HTMLSelectElement).value)"
            :disabled="busy"
          >
            <option
              v-for="company in me.companies"
              :key="company.id"
              :value="company.id"
            >
              {{ company.shortName || company.name }}
            </option>
          </select>
        </div>
      </div>
      <span class="workspace-label">OPERAÇÃO E GESTÃO</span>
      <nav>
        <RouterLink
          v-for="entry in navEntries"
          :key="entry.path"
          :to="'/' + entry.path"
          :class="{
            active: view === entry.path,
            'nav-item-main': entry.main,
            'nav-item-extra': !entry.main,
          }"
          :aria-label="entry.name"
          ><component :is="entry.icon" :size="18" />{{ entry.name
          }}<span v-if="entry.path === 'opportunities'" class="nav-count">{{
            catalog?.summary.total ?? 0
          }}</span></RouterLink
        >
      </nav>
      <div class="sidebar-bottom">
        <div class="pilot">
          <span class="live-dot"></span> Ambiente piloto<small
            >Uma nova forma de encontrar<br />oportunidades para a
            {{ companyName }}.</small
          >
        </div>
        <button @click="logout" class="user" aria-label="Sair">
          <div class="avatar user-avatar">
            {{ (me.name || me.email).slice(0, 1).toUpperCase() }}
          </div>
          <div>
            <strong>{{ me.name || 'Minha conta' }}</strong><small>{{
              me.email
            }}</small>
          </div>
          <LogOut :size="16" />
        </button>
      </div>
    </aside>
    <div class="main">
      <header class="topbar">
        <img
          class="mobile-brand"
          :src="me.company.logoUrl || '/brand/nthub-logo.png'"
          :alt="me.company.name"
          width="40"
          height="40"
        />
        <span
          >Licitações <ChevronRight :size="14" />
          <strong class="desktop-company-name">{{
            me.company.name
          }}</strong><label class="mobile-company-select"
            ><span class="sr-only">Empresa atual</span
            ><select
              :value="me.companyId"
              @change="
                switchCompany(($event.target as HTMLSelectElement).value)
              "
            >
              <option
                v-for="company in me.companies"
                :key="company.id"
                :value="company.id"
              >
                {{ company.shortName }}
              </option>
            </select></label
          ></span
        >
        <div class="topbar-actions">
          <label class="mobile-navigation"
            ><span class="sr-only">Navegar para</span
            ><select
              :value="view"
              @change="
                router.push('/' + ($event.target as HTMLSelectElement).value)
              "
            >
              <option
                v-for="entry in navEntries"
                :key="entry.path"
                :value="entry.path"
              >
                {{ entry.name }}
              </option>
            </select></label
          >
          <span class="workspace-date">{{ workspaceDate }}</span>
          <span class="secure"><ShieldCheck :size="15" /> Acesso seguro</span
          ><button
            class="theme-toggle"
            @click="toggleTheme"
            :aria-label="isDark ? 'Ativar modo claro' : 'Ativar modo escuro'"
            :aria-pressed="isDark"
          >
            <Sun v-if="isDark" :size="17" /><Moon v-else :size="17" /><span>{{
              isDark ? 'Modo claro' : 'Modo escuro'
            }}</span>
          </button>
        </div>
      </header>
      <main>
        <div v-if="error" class="error banner" role="alert">
          {{ error
          }}<button @click="error = ''" aria-label="Fechar erro">
            <X :size="16" />
          </button>
        </div>
        <div v-if="notice" class="notice banner" role="status">
          {{ notice
          }}<button @click="notice = ''" aria-label="Fechar aviso">
            <X :size="16" />
          </button>
        </div>
        <Permissions
          v-if="view === 'permissions' && me.isGroupAdmin"
          :key="me.companyId"
          :me="me"
        />
        <section v-if="view === 'no-access'" class="panel">
          <h1>Acesso restrito</h1>
          <p>
            Solicite ao administrador a liberação dos módulos nesta empresa.
          </p>
        </section>
        <GroupDashboard
          v-if="view === 'group' && me.isGroupAdmin"
          :key="me.companyId"
          :me="me"
          @switch="switchCompany"
        />
        <Settings
          v-if="view === 'settings'"
          :key="me.companyId"
          :me="me"
          @refresh="refreshContext"
        />
        <Crm
          v-if="view === 'crm' && !me.company.isParent"
          :key="me.companyId"
          :me="me"
          :opportunities="items"
          :updated-at="crmUpdatedAt"
          :catalog="catalog"
          :loading="catalogLoading"
          @query="changeCatalog"
          @open="openById"
          @refresh="load"
          @discard="requestDiscard"
          @sync="syncOpen = true"
        />
        <nav
          v-if="catalog && view === 'opportunities'"
          class="catalog-pagination"
          aria-label="Paginação das oportunidades"
        >
          <span
            >{{ catalog.total }} resultados · página {{ catalog.page }} de
            {{ Math.max(1, Math.ceil(catalog.total / catalog.pageSize)) }}</span
          >
          <button
            class="secondary"
            :disabled="catalogLoading || catalog.page <= 1"
            @click="changeCatalog({ ...catalogQuery, page: catalog.page - 1 })"
          >
            Anterior
          </button>
          <button
            class="secondary"
            :disabled="
              catalogLoading || catalog.page * catalog.pageSize >= catalog.total
            "
            @click="changeCatalog({ ...catalogQuery, page: catalog.page + 1 })"
          >
            Próxima
          </button>
        </nav>
        <Administration
          v-if="administrationViews.includes(view)"
          :key="me.companyId + view"
          :me="me"
          :section="view"
          @refresh="refreshContext"
          @switch="switchCompany"
          @logout="sessionEnded"
        />
        <Operations
          v-if="operationViews.includes(view)"
          :key="me.companyId + view"
          :me="me"
          :section="view"
          :opportunities="items"
          @refresh="load"
          @open="openById"
        />
        <template v-if="view === 'overview' || view === 'opportunities'"
          ><div class="page-heading">
            <div>
              <span class="eyebrow"
                >{{ companyName.toUpperCase() }} · LICITAÇÕES</span
              >
              <h1>
                {{ view === 'overview' ? 'Visão geral' : 'Oportunidades' }}
              </h1>
              <p>
                {{
                  view === 'overview'
                    ? 'Tudo o que importa para a sua próxima decisão.'
                    : 'Encontre, analise e acompanhe as licitações da sua empresa.'
                }}
              </p>
            </div>
            <button
              class="primary"
              @click="syncOpen = true"
              :disabled="busy || processing || !canWrite"
            >
              <RefreshCw :size="16" /> Sincronizar fontes
            </button>
          </div>
          <div v-if="view === 'overview'" class="overview-brief">
            <section class="brief-main">
              <span class="brief-label"
                ><span class="live-dot"></span> INTELIGÊNCIA PARA O SEU
                NEGÓCIO</span
              >
              <h2>Da informação<br />à próxima <em>oportunidade.</em></h2>
              <p>
                Encontre o que faz sentido para a {{ companyName }}.<br
                  class="desktop-break"
                />
                Editais, documentos e análises no mesmo lugar.
              </p>
              <button class="brief-link" @click="router.push('/opportunities')">
                Explorar oportunidades <ArrowUpRight :size="18" />
              </button>
              <div class="brief-mark" aria-hidden="true">
                <ArrowUpRight :size="120" :stroke-width="1" />
              </div>
              <span class="brief-index" aria-hidden="true"
                >NTHUB / INTELLIGENCE</span
              >
            </section>
            <section class="coverage-card">
              <div class="coverage-heading">
                <span class="eyebrow">NA ORIGEM DOS DADOS</span
                ><span class="source-badge"
                  ><Radio :size="12" /> Fonte oficial</span
                >
              </div>
              <div class="coverage-source">
                <div class="source-monogram">
                  <Database :size="23" :stroke-width="1.5" />
                </div>
                <div>
                  <h3>PNCP + Compras.gov.br</h3>
                  <p>Portal Nacional de Contratações Públicas</p>
                </div>
              </div>
              <div class="coverage-metrics">
                <div>
                  <FileText :size="16" /><span>Anexos disponíveis</span
                  ><strong>{{ collectedDocuments }}</strong>
                </div>
                <div>
                  <Sparkles :size="16" /><span>Análises preparadas</span
                  ><strong>{{ preparedAnalyses }}</strong>
                </div>
              </div>
              <div class="coverage-footer">
                <span class="live-dot"></span
                >{{
                  lastSync
                    ? 'Última atualização · ' + date(lastSync)
                    : 'Pronto para a primeira coleta'
                }}<ShieldCheck :size="14" />
              </div>
            </section>
          </div>
          <div v-if="view === 'overview'" class="stats">
            <article class="stat-active">
              <span>Oportunidades ativas <ArrowUpRight :size="17" /></span
              ><strong>{{
                String(catalog?.summary.active ?? 0).padStart(2, '0')
              }}</strong
              ><small>No radar da {{ companyName }}</small>
            </article>
            <article class="stat-review">
              <span>Em análise <FileText :size="17" /></span
              ><strong>{{
                String(catalog?.summary.review ?? 0).padStart(2, '0')
              }}</strong
              ><small>Em avaliação pela equipe</small>
            </article>
            <article class="stat-selected">
              <span>Selecionadas <ShieldCheck :size="17" /></span
              ><strong>{{
                String(catalog?.summary.selected ?? 0).padStart(2, '0')
              }}</strong
              ><small>Prontas para avançar</small>
            </article>
            <article class="deadline-stat">
              <span>Prazos próximos <History :size="17" /></span
              ><strong>{{
                String(catalog?.summary.upcomingDeadlines ?? 0).padStart(2, '0')
              }}</strong
              ><small>Encerram nos próximos 7 dias</small>
            </article>
          </div>
          <div v-if="view === 'overview'" class="insight">
            <div class="insight-icon"><Sparkles :size="22" /></div>
            <div>
              <strong>Seu edital, com o contexto que importa.</strong>
              <p>
                {{
                  me.geminiConfigured
                    ? 'Editais e anexos são coletados das fontes oficiais. A análise por IA é feita somente quando você solicitar.'
                    : 'Editais, anexos e itens vêm das fontes oficiais. A análise manual depende da configuração do Gemini.'
                }}
              </p>
            </div>
            <span class="tag">GEMINI · EVIDÊNCIAS</span>
          </div>
          <section class="catalog">
            <div class="section-heading">
              <div>
                <h2>
                  {{
                    view === 'overview'
                      ? 'No radar da ' + companyName
                      : 'Catálogo de oportunidades'
                  }}
                  <span class="count">{{ catalog?.total ?? 0 }}</span>
                </h2>
                <p>
                  Licitações identificadas a partir das capacidades da empresa.
                </p>
              </div>
              <button
                v-if="view === 'overview'"
                class="text-button"
                @click="router.push('/opportunities')"
              >
                Ver todas <ArrowUpRight :size="15" />
              </button>
            </div>
            <div class="toolbar">
              <div class="tabs">
                <button
                  :class="{ chosen: filter === 'all' }"
                  @click="filter = 'all'"
                >
                  Todas</button
                ><button
                  :class="{ chosen: filter === 'new' }"
                  @click="filter = 'new'"
                >
                  Novas</button
                ><button
                  :class="{ chosen: filter === 'review' }"
                  @click="filter = 'review'"
                >
                  Em análise</button
                ><button
                  :class="{ chosen: filter === 'selected' }"
                  @click="filter = 'selected'"
                >
                  Selecionadas
                </button>
              </div>
              <label class="search"
                ><Search :size="16" /><input
                  v-model="search"
                  placeholder="Buscar oportunidade…"
                  aria-label="Buscar oportunidade"
              /></label>
            </div>
            <details class="saved-searches">
              <summary>Pesquisas salvas · {{ savedSearches.length }}</summary>
              <div class="form-actions">
                <input
                  v-model="searchName"
                  placeholder="Nome da pesquisa atual"
                  aria-label="Nome da pesquisa"
                  maxlength="100"
                /><button
                  class="secondary"
                  :disabled="busy || searchName.trim().length < 2"
                  @click="saveSearch"
                >
                  Salvar filtros
                </button>
              </div>
              <div
                v-for="saved in savedSearches"
                :key="saved.id"
                class="form-actions"
              >
                <button
                  class="secondary"
                  @click="
                    search = saved.filters.query;
                    filter = saved.filters.status;
                  "
                >
                  {{ saved.name }}</button><button
                  class="text-button"
                  @click="removeSearch(saved.id)"
                >
                  Excluir
                </button>
              </div>
            </details>
            <div v-if="!filtered.length" class="empty">
              <div><Inbox :size="29" /></div>
              <h3>
                {{
                  items.length
                    ? 'Nenhuma oportunidade com esses filtros'
                    : 'Seu próximo contrato pode estar aqui'
                }}
              </h3>
              <p>
                {{
                  items.length
                    ? 'Experimente outro termo ou status.'
                    : 'Sincronize as fontes para encontrar editais relacionados às capacidades cadastradas para a empresa.'
                }}
              </p>
              <button
                v-if="!items.length"
                class="secondary"
                @click="syncOpen = true"
              >
                <Plus :size="16" /> Buscar primeiras oportunidades
              </button>
            </div>
            <div v-else class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>OPORTUNIDADE / ÓRGÃO</th>
                    <th>LOCAL</th>
                    <th>VALOR ESTIMADO</th>
                    <th>PRAZO</th>
                    <th>STATUS</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="item in filtered"
                    :key="item.id"
                    @click="openOpportunity(item)"
                    tabindex="0"
                    @keydown.enter="openOpportunity(item)"
                  >
                    <td class="title-cell">
                      <strong>{{ item.title }}</strong><span class="match">{{
                        (item.sources || ['pncp'])
                          .map((v) =>
                            v === 'compras' ? 'Compras.gov.br' : 'PNCP',
                          )
                          .join(' · ')
                      }}</span
                      ><small>{{ item.agency }}</small
                      ><span class="match">{{
                        item.matches.slice(0, 2).join(' · ')
                      }}</span>
                    </td>
                    <td data-label="LOCAL">
                      {{ item.uf || '—' }}<small>{{ item.city }}</small>
                    </td>
                    <td data-label="VALOR ESTIMADO">{{ money(item.value) }}</td>
                    <td data-label="ENCERRAMENTO">{{ date(item.deadline) }}</td>
                    <td data-label="STATUS">
                      <span class="status" :class="item.status">{{
                        labels[item.status]
                      }}</span>
                    </td>
                    <td><ChevronRight :size="16" /></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div class="catalog-footer">
              <span
                ><span class="live-dot"></span> Fontes oficiais: PNCP e
                Compras.gov.br</span
              ><span>Classificação por palavras-chave · validação humana</span>
            </div>
          </section>
          <div class="bottom-note">
            <ShieldCheck :size="15" /> Os dados e decisões da
            {{ companyName }} ficam restritos ao seu espaço de trabalho.
          </div></template
        >
        <template v-else-if="view === 'audit'"
          ><div class="page-heading">
            <div>
              <span class="eyebrow">RASTREABILIDADE</span>
              <h1>Atividades</h1>
              <p>Histórico de ações no ambiente da {{ companyName }}.</p>
            </div>
          </div>
          <section class="panel">
            <div v-if="!audit.length" class="empty">
              <History :size="28" />
              <h3>Nenhuma atividade registrada</h3>
              <p>
                Sincronizações, documentos, análises e decisões aparecerão aqui.
              </p>
            </div>
            <article
              v-for="a in audit"
              :key="a.createdAt + a.resourceId"
              class="audit-row"
            >
              <History :size="17" /><strong>{{ a.action }}</strong
              ><small
                >{{ date(a.createdAt) }} ·
                {{ new Date(a.createdAt).toLocaleTimeString('pt-BR') }}</small
              >
            </article>
          </section></template
        >
        <footer>
          NTHUB <span>Feito para transformar informação em oportunidade.</span
          ><span>{{ me.company.name }} · Grupo NTHUB</span>
        </footer>
      </main>
    </div>
    <div v-if="syncOpen" class="overlay" @click.self="syncOpen = false">
      <form
        class="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Sincronizar fontes"
        @submit.prevent="sync"
      >
        <p v-if="error" class="error banner" role="alert">{{ error }}</p>
        <button
          type="button"
          class="close"
          @click="syncOpen = false"
          aria-label="Fechar"
        >
          <X /></button
        ><span class="eyebrow">FONTE OFICIAL</span>
        <h2>Sincronizar fontes</h2>
        <p>
          Busque publicações por período. A {{ companyName }} receberá
          oportunidades relacionadas às suas capacidades.
        </p>
        <label
          >Fonte<select v-model="syncSource">
            <option value="pncp">PNCP</option>
            <option value="compras">Compras.gov.br · Lei 14.133</option>
          </select></label
        >
        <label>Data inicial<input v-model="since" type="date" required /></label
        ><label>Data final<input v-model="until" type="date" required /></label
        ><label
          >Modalidade<select v-model="modality">
            <option :value="6">Pregão eletrônico</option>
            <option :value="8">Dispensa de licitação</option>
            <option :value="4">Concorrência eletrônica</option>
            <option :value="7">Pregão presencial</option>
          </select></label
        ><label
          >UF (opcional)<input
            v-model="uf"
            maxlength="2"
            placeholder="Todas as UFs" /></label
        ><small
          >Intervalo máximo: 31 dias. Os resultados dependem da cobertura e
          disponibilidade da fonte selecionada. Limites temporários geram espera
          e retomada automática.</small
        ><button class="primary" :disabled="busy || processing || !canWrite">
          Iniciar sincronização <RefreshCw :size="16" />
        </button>
      </form>
    </div>
    <div v-if="selected" class="overlay" @click.self="selected = null">
      <section
        class="drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Detalhes da oportunidade"
      >
        <p v-if="error" class="error banner" role="alert">{{ error }}</p>
        <p v-if="notice" class="notice banner" role="status">{{ notice }}</p>
        <button
          class="close"
          @click="selected = null"
          aria-label="Fechar oportunidade"
        >
          <X /></button
        ><span class="eyebrow">DETALHES DA OPORTUNIDADE</span>
        <h2>{{ selected.title }}</h2>
        <p>{{ selected.agency }} · {{ selected.city }} / {{ selected.uf }}</p>
        <a
          :href="selected.sourceUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="text-button"
          >Consultar no PNCP <ArrowUpRight :size="16"
        /></a>
        <a
          v-for="origin in content?.origins?.filter(
            (v) => v.source === 'compras',
          ) || []"
          :key="origin.source"
          :href="origin.url"
          target="_blank"
          rel="noopener noreferrer"
          class="text-button"
          >Consultar no Compras.gov.br <ArrowUpRight :size="16"
        /></a>
        <div class="detail-metrics">
          <div>
            <small>VALOR ESTIMADO</small
            ><strong>{{ money(selected.value) }}</strong>
          </div>
          <div>
            <small>ENCERRAMENTO</small
            ><strong>{{ date(selected.deadline) }}</strong>
          </div>
        </div>
        <label
          >Status da oportunidade<select
            :value="selected.status"
            @change="statusChange($event)"
            :disabled="busy || processing || !canWrite"
          >
            <option v-for="(label, key) in labels" :key="key" :value="key">
              {{ label }}
            </option>
          </select></label
        >
        <OpportunityTools
          :key="me.companyId + selected.id"
          :me="me"
          :opportunity-id="selected.id"
          @transferred="
            async (companyId: string) => {
              selected = null;
              notice =
                'Oportunidade transferida para ' +
                (me?.companies.find((c) => c.id === companyId)?.shortName ||
                  'a empresa de destino') +
                '.';
              await load();
            }
          "
          @refresh="load"
        />
        <section class="source-status" aria-live="polite">
          <div>
            <span class="live-dot"></span
            ><strong>{{
              processingLabels[
                content?.processingState || selected.processingState
              ] || 'Consultando fonte'
            }}</strong
            ><small v-if="content?.syncedAt"
              >Última consulta: {{ date(content.syncedAt) }} ·
              {{
                new Date(content.syncedAt).toLocaleTimeString('pt-BR')
              }}</small
            >
          </div>
          <button
            class="secondary"
            @click="refreshSource"
            :disabled="
              busy ||
              !canWrite ||
              processing ||
              ['queued', 'processing'].includes(content?.processingState || '')
            "
          >
            <RefreshCw :size="15" /> Atualizar informações
          </button>
        </section>
        <p v-if="content?.sourceChangedAt" class="notice banner" role="status">
          Edital atualizado na fonte — revise os prazos, valores e documentos.
          Uma nova análise de IA só será feita se você solicitar.
        </p>
        <section
          v-if="content?.issues?.length"
          class="panel processing-issues"
          aria-label="Pendências de processamento"
        >
          <h3>Pendências de processamento</h3>
          <article v-for="issue in content.issues" :key="issue.kind">
            <strong>{{ issue.title }}</strong>
            <p>{{ issue.action }}</p>
            <button
              v-if="issue.kind === 'failed' && canWrite"
              class="secondary"
              :disabled="busy || processing"
              @click="refreshSource"
            >
              Reprocessar coleta
            </button>
            <button
              v-if="
                issue.kind === 'needs_ocr' && canAnalyze && me.geminiConfigured
              "
              class="secondary"
              :disabled="busy || processing"
              @click="analyze"
            >
              Analisar com IA (inclui OCR)
            </button>
            <a
              v-if="['missing', 'unsupported'].includes(issue.kind)"
              :href="selected.sourceUrl"
              target="_blank"
              rel="noopener noreferrer"
              >Consultar fonte oficial</a
            >
          </article>
        </section>
        <p v-if="content?.processingError" class="notice banner source-warning">
          {{ content.processingError }}
        </p>
        <p v-if="detailLoading" role="status">
          Carregando informações da contratação…
        </p>
        <template v-if="content">
          <details class="source-details">
            <summary>Dados completos da contratação</summary>
            <dl class="source-fields">
              <template v-for="(field, index) in sourceInfo" :key="index"
                ><dt>{{ field.label }}</dt>
                <dd>{{ field.value }}</dd></template
              >
            </dl>
          </details>
          <section class="items-section">
            <h3>
              Itens da contratação
              <span class="count">{{ content.items.length }}</span>
            </h3>
            <p class="muted">
              Descrições e valores publicados pelo órgão no PNCP.
            </p>
            <div v-if="content.items.length" class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>ITEM / DESCRIÇÃO</th>
                    <th>QUANTIDADE</th>
                    <th>VALOR UNITÁRIO</th>
                    <th>VALOR TOTAL</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="item in content.items" :key="item.numeroItem">
                    <td>
                      <strong
                        >{{ item.numeroItem }}. {{ item.descricao }}</strong
                      ><small
                        >{{ item.criterioJulgamentoNome }} ·
                        {{ item.situacaoCompraItemNome }}</small
                      >
                    </td>
                    <td>
                      {{ item.quantidade ?? '—'
                      }}<small>{{ item.unidadeMedida }}</small>
                    </td>
                    <td>
                      {{
                        money(
                          item.valorUnitarioEstimado == null
                            ? null
                            : String(item.valorUnitarioEstimado),
                          4,
                        )
                      }}
                    </td>
                    <td>
                      {{
                        money(
                          item.valorTotal == null
                            ? null
                            : String(item.valorTotal),
                        )
                      }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p v-else class="muted">
              {{
                ['queued', 'processing', 'pending'].includes(
                  content.processingState,
                )
                  ? 'Buscando itens na fonte…'
                  : 'Nenhum item foi disponibilizado ou a consulta está pendente.'
              }}
            </p>
          </section>
          <section class="source-documents">
            <h3>
              Edital e anexos
              <span class="count">{{ content.documents.length }}</span>
            </h3>
            <p class="muted">
              Documentos buscados automaticamente na fonte oficial. Você pode
              consultar o texto e o arquivo original aqui.
            </p>
            <article
              v-for="doc in content.documents"
              :key="doc.id"
              class="source-document"
            >
              <FileText :size="22" />
              <div>
                <strong>{{ doc.name }}</strong><small
                  >{{
                    extractionLabels[doc.extractionStatus] ||
                    doc.extractionStatus
                  }}{{
                    doc.pageCount ? ' · ' + doc.pageCount + ' páginas' : ''
                  }}</small
                >
                <p v-if="doc.extractionError">{{ doc.extractionError }}</p>
              </div>
              <button
                class="secondary"
                @click="viewDocument(doc)"
                :disabled="busy"
              >
                Consultar
              </button>
            </article>
            <p v-if="!content.documents.length" class="muted">
              {{
                ['queued', 'processing', 'pending'].includes(
                  content.processingState,
                )
                  ? 'Buscando edital e anexos na fonte oficial…'
                  : 'A fonte ainda não disponibilizou documentos. O sistema poderá tentar novamente.'
              }}
            </p>
          </section>
          <section v-if="viewedDocument" class="document-reader">
            <div class="reader-heading">
              <h3>{{ viewedDocument.name }}</h3>
              <button
                @click="viewedDocument = null"
                aria-label="Fechar documento"
              >
                <X :size="18" />
              </button>
            </div>
            <div class="tabs">
              <button
                :class="{ chosen: documentView === 'text' }"
                @click="documentView = 'text'"
              >
                Texto por página</button
              ><button
                v-if="
                  viewedDocument.downloadable &&
                  viewedDocument.mime === 'application/pdf'
                "
                :class="{ chosen: documentView === 'original' }"
                @click="documentView = 'original'"
              >
                PDF original</button
              ><a
                v-if="viewedDocument.downloadable"
                :href="
                  '/api/v1/documents/' +
                  viewedDocument.id +
                  '/file?company=' +
                  me.companyId
                "
                target="_blank"
                rel="noopener noreferrer"
                class="text-button"
                >Abrir original <ArrowUpRight :size="14"
              /></a>
            </div>
            <iframe
              v-if="documentView === 'original'"
              :src="
                '/api/v1/documents/' +
                viewedDocument.id +
                '/file?company=' +
                me.companyId
              "
              title="Edital original"
              class="pdf-reader"
            ></iframe>
            <div v-else class="document-text">
              <article
                v-for="page in documentPages"
                :key="page.page"
                :data-doc-page="page.page"
              >
                <span class="eyebrow">PÁGINA {{ page.page }}</span>
                <p>{{ page.text || 'Página sem texto extraído.' }}</p>
              </article>
              <p v-if="!documentPages.length" class="muted">
                {{
                  viewedDocument.extractionError ||
                  'Não há texto extraído para este arquivo. Consulte o original disponível.'
                }}
              </p>
            </div>
          </section>
          <section class="analysis">
            <div class="analysis-heading">
              <h3>Análise de aderência à {{ companyName }}</h3>
              <button
                class="primary"
                @click="analyze"
                :disabled="
                  busy ||
                  processing ||
                  !me.geminiConfigured ||
                  !canAnalyze ||
                  !content.documents.some((d) =>
                    ['ready', 'needs_ocr'].includes(d.extractionStatus),
                  )
                "
              >
                <Sparkles :size="16" />
                {{ currentAnalysis ? 'Reanalisar com IA' : 'Analisar com IA' }}
              </button>
            </div>
            <p v-if="!me.geminiConfigured" class="notice banner">
              O edital já está no sistema. Configure o Gemini para poder
              solicitar a análise manualmente.
            </p>
            <p v-else-if="!currentAnalysis" class="muted">
              A IA só será executada se você clicar em Analisar com IA. A coleta
              dos editais não dispara análise nem consome tokens de IA.
            </p>
            <template v-if="currentAnalysis"
              ><span class="eyebrow"
                >ANÁLISE COM EVIDÊNCIAS · {{ date(content.analysisAt) }}</span
              >
              <AdherenceBreakdown
                v-if="currentAnalysis.adherence"
                :assessment="currentAnalysis.adherence"
                @evidence="viewEvidence"
              />
              <p v-else class="notice banner">
                Esta análise anterior não possui cálculo discriminado de
                aderência. Reanalise o edital para obter os critérios e as
                justificativas.
              </p>
              <p class="analysis-summary">{{ currentAnalysis.summary }}</p>
              <template
                v-for="group in ['requirements', 'risks'] as const"
                :key="group"
                ><h3>
                  {{
                    group === 'requirements'
                      ? 'Requisitos identificados'
                      : 'Riscos identificados'
                  }}
                </h3>
                <article
                  v-for="(e, index) in currentAnalysis[group]"
                  :key="index"
                >
                  <strong>{{ e.description }}</strong>
                  <blockquote>
                    “{{ e.excerpt }}”<button
                      class="text-button"
                      @click="viewEvidence(e.documentId, e.page)"
                    >
                      Ver evidência · página {{ e.page }}
                      <ArrowUpRight :size="13" />
                    </button>
                  </blockquote>
                </article>
                <p v-if="!currentAnalysis[group].length" class="muted">
                  Nenhum item com evidência identificado.
                </p></template
              >
              <h3>Informações pendentes</h3>
              <p
                v-for="(missing, index) in currentAnalysis.missingInformation"
                :key="index"
              >
                • {{ missing }}
              </p></template
            ><small class="muted"
              >A análise é acionada por você e pode consumir tokens do Gemini,
              inclusive na leitura de PDFs digitalizados. A pontuação auxilia a
              priorização. A decisão e a conferência de habilitação continuam
              com a equipe {{ companyName }}.</small
            >
          </section>
        </template>
      </section>
    </div>
  </div>
</template>
