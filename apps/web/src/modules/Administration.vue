<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';
import {
  Building2,
  Users,
  Plus,
  Save,
  RefreshCw,
  ArrowUpRight,
  ShieldCheck,
  KeyRound,
  Copy,
  FileText,
  Settings2,
} from 'lucide-vue-next';
import type { Company, Member, UserContext } from '@nthub/contracts';
import { hasPermission } from '@nthub/contracts';
import { api } from '../api';
const props = defineProps<{ me: UserContext; section: string }>();
const emit = defineEmits<{ refresh: []; switch: [id: string]; logout: [] }>();
const busy = ref(false),
  error = ref(''),
  notice = ref('');
const canManage = computed(() =>
  hasPermission(
    props.me,
    props.section === 'members'
      ? 'members:manage'
      : props.section === 'integrations'
        ? 'integrations:manage'
        : props.section === 'sources'
          ? 'sources:manage'
          : 'company:manage',
  ),
);
const headings: Record<string, [string, string]> = {
  group: [
    'Visão do grupo',
    'Uma visão consolidada das empresas NTHUB, com autonomia em cada operação.',
  ],
  companies: [
    'Empresas do grupo',
    'Cadastros, identidades e critérios de cada negócio.',
  ],
  company: [
    'Empresa e critérios',
    'Configure o perfil utilizado para encontrar as oportunidades da sua empresa.',
  ],
  members: [
    'Funcionários e acessos',
    'Cada vínculo tem um perfil próprio. A autorização é aplicada no servidor.',
  ],
  sources: [
    'Fontes e coletas',
    'Configure a coleta oficial e acompanhe o processamento.',
  ],
  integrations: [
    'Integrações',
    'Credenciais por empresa, eventos assinados e serviços corporativos.',
  ],
  account: ['Minha conta', 'Seus dados pessoais e a segurança do seu acesso.'],
};
const heading = computed(
  () => headings[props.section] || ['Administração', ''],
);
const companies = ref<Company[]>([]),
  members = ref<Member[]>([]);
const editor = ref(false),
  form = ref<Company | null>(null),
  terms = ref(''),
  excluded = ref(''),
  requiredTerms = ref(''),
  ufs = ref(''),
  minimum = ref(''),
  maximum = ref('');
const memberForm = reactive({ name: '', email: '', role: 'analyst' }),
  invitation = ref('');
type Schedule = {
  sources: ('pncp' | 'compras')[];
  enabled: boolean;
  intervalMinutes: number;
  modalities: number[];
  ufs: string[];
  lookbackDays: number;
  nextRunAt: string | null;
};
const schedule = ref<Schedule>({
    sources: ['pncp', 'compras'],
    enabled: false,
    intervalMinutes: 360,
    modalities: [4, 6, 8],
    ufs: [],
    lookbackDays: 2,
    nextRunAt: null,
  }),
  scheduleUfs = ref('');
const syncIntervals = [
  { minutes: 60, label: 'A cada hora' },
  { minutes: 120, label: 'A cada 2 horas' },
  { minutes: 180, label: 'A cada 3 horas' },
  { minutes: 360, label: 'A cada 6 horas' },
  { minutes: 720, label: 'A cada 12 horas' },
  { minutes: 1440, label: 'Diariamente' },
  { minutes: 10080, label: 'Semanalmente' },
];
const customSyncInterval = ref(false);
const syncIntervalChoice = computed({
  get: () =>
    customSyncInterval.value ||
    !syncIntervals.some((i) => i.minutes === schedule.value.intervalMinutes)
      ? 'custom'
      : String(schedule.value.intervalMinutes),
  set: (value: string) => {
    customSyncInterval.value = value === 'custom';
    if (value !== 'custom') schedule.value.intervalMinutes = Number(value);
  },
});

type Run = {
  source: string;
  id: string;
  status: string;
  recordsProcessed: number;
  opportunitiesProcessed: number;
  startedAt: string;
  error: string | null;
};
type Job = {
  id: string;
  type: string;
  state: string;
  attempt: number;
  error: string | null;
  createdAt: string;
};
const runs = ref<Run[]>([]),
  jobs = ref<Job[]>([]);
type Token = {
  id: string;
  name: string;
  scopes: string[];
  active: boolean;
  expiresAt: string;
};
type Hook = {
  id: string;
  name: string;
  url: string;
  events: string[];
  active: boolean;
};
type Delivery = {
  id: string;
  eventType: string;
  status: string;
  attempts: number;
  error: string | null;
};
const tokens = ref<Token[]>([]),
  hooks = ref<Hook[]>([]),
  deliveries = ref<Delivery[]>([]);
const integrationStatus = ref<{
  smtpConfigured: boolean;
  storageConfigured: boolean;
  oidcConfigured: boolean;
  webhookHosts: string[];
  geminiConfigured: boolean;
} | null>(null);
const credential = ref(''),
  credentialLabel = ref('');
const tokenForm = reactive({
  name: '',
  scopes: ['opportunities:read', 'documents:read', 'analytics:read'],
  expiresAt: new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10),
});
const hookForm = reactive({
  name: '',
  url: '',
  events: ['opportunity.created'],
});
const scopeOptions = [
  'opportunities:read',
  'opportunities:write',
  'documents:read',
  'bids:read',
  'bids:write',
  'tasks:read',
  'tasks:write',
  'analytics:read',
  'sources:read',
  'sources:sync',
  'company:read',
];
const eventOptions = [
  'opportunity.created',
  'opportunity.status_changed',
  'bid.changed',
  'analysis.completed',
];
const account = reactive({
  name: props.me.name || '',
  currentPassword: '',
  newPassword: '',
  confirmation: '',
});
const money = (value: string) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
    Number(value),
  );
const date = (value: string | null) =>
  value
    ? new Date(value).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
    : '—';
const roles: Record<string, string> = {
  group_admin: 'Administrador do grupo',
  company_manager: 'Gestor da empresa',
  analyst: 'Analista',
  viewer: 'Leitor / auditor',
};
const stateLabel: Record<string, string> = {
  completed: 'Concluído',
  delayed: 'Aguardando liberação da fonte',
  failed: 'Com falha',
  active: 'Em execução',
  running: 'Em execução',
  waiting: 'Na fila',
  delivered: 'Entregue',
  pending: 'Pendente',
  sending: 'Enviando',
};
async function run(fn: () => Promise<void>) {
  busy.value = true;
  error.value = '';
  try {
    await fn();
  } catch (e) {
    error.value =
      e instanceof Error ? e.message : 'Não foi possível concluir a operação.';
  } finally {
    busy.value = false;
  }
}
function editCompany(company: Company) {
  form.value = JSON.parse(JSON.stringify(company));
  terms.value = company.capabilities.join('\n');
  excluded.value = company.searchSettings.excludedKeywords.join('\n');
  requiredTerms.value = company.searchSettings.requiredKeywords.join('\n');
  ufs.value = company.searchSettings.ufs.join(', ');
  minimum.value =
    company.searchSettings.minimumValue == null
      ? ''
      : String(company.searchSettings.minimumValue);
  maximum.value =
    company.searchSettings.maximumValue == null
      ? ''
      : String(company.searchSettings.maximumValue);
  editor.value = true;
}
function newCompany() {
  editCompany({
    id: '',
    name: '',
    shortName: '',
    description: '',
    cnpj: null,
    website: null,
    logoUrl: null,
    capabilities: [],
    searchSettings: {
      requiredKeywords: [],
      excludedKeywords: [],
      ufs: [],
      minimumValue: null,
      maximumValue: null,
      matchMode: 'any',
      includeExpired: false,
    },
    isParent: false,
    active: true,
    role: 'group_admin',
  });
}
const lines = (text: string) => [
  ...new Set(
    text
      .split(/[\n;]/)
      .map((v) => v.trim())
      .filter(Boolean),
  ),
];
async function loadCompanies() {
  companies.value = await api<Company[]>(
    props.me.isGroupAdmin ? '/companies/admin' : '/companies',
  );
}
async function saveCompany() {
  if (!form.value) return;
  await run(async () => {
    const c = form.value!;
    const payload = {
      ...c,
      cnpj: c.cnpj?.replace(/\D/g, '') || null,
      website: c.website || null,
      capabilities: lines(terms.value),
      searchSettings: {
        ...c.searchSettings,
        requiredKeywords: lines(requiredTerms.value),
        excludedKeywords: lines(excluded.value),
        ufs: ufs.value
          .toUpperCase()
          .split(/[\s,;]+/)
          .filter(Boolean),
        minimumValue: minimum.value === '' ? null : Number(minimum.value),
        maximumValue: maximum.value === '' ? null : Number(maximum.value),
      },
    };
    if (c.id)
      await api('/companies/' + c.id, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
    else {
      const created = await api<{ id: string }>('/companies', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      c.id = created.id;
    }
    notice.value =
      'Cadastro e critérios salvos. Reclassifique o catálogo para aplicar os novos termos às licitações já coletadas.';
    await loadCompanies();
    emit('refresh');
  });
}
async function uploadLogo(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file || !form.value?.id) return;
  await run(async () => {
    const body = new FormData();
    body.append('file', file);
    await api('/companies/' + form.value!.id + '/logo', {
      method: 'POST',
      body,
    });
    await loadCompanies();
    const updated = companies.value.find((c) => c.id === form.value!.id);
    if (updated) form.value!.logoUrl = updated.logoUrl;
    notice.value = 'Logo atualizada.';
    emit('refresh');
  });
}
async function loadMembers() {
  members.value = await api<Member[]>('/members');
}
async function createMember() {
  await run(async () => {
    const result = await api<{ invitationPath: string | null }>('/members', {
      method: 'POST',
      body: JSON.stringify(memberForm),
    });
    invitation.value = result.invitationPath
      ? location.origin + result.invitationPath
      : '';
    notice.value = result.invitationPath
      ? 'Funcionário cadastrado. Compartilhe o convite de ativação de uso único, válido por 48 horas.'
      : 'Funcionário vinculado. Ele utilizará o acesso que já possui.';
    memberForm.name = '';
    memberForm.email = '';
    await loadMembers();
  });
}
async function updateMember(member: Member, active = member.active) {
  await run(async () => {
    await api('/members/' + member.id, {
      method: 'PATCH',
      body: JSON.stringify({ role: member.role, active }),
    });
    await loadMembers();
    notice.value = 'Acesso atualizado. A alteração vale imediatamente.';
  });
}
async function inviteMember(member: Member) {
  await run(async () => {
    const result = await api<{ invitationPath: string }>(
      '/members/' + member.id + '/invitation',
      { method: 'POST' },
    );
    invitation.value = location.origin + result.invitationPath;
    notice.value =
      'Novo convite criado. Os convites anteriores foram invalidados.';
  });
}
async function loadRuns() {
  const results = await Promise.all([
    api<Run[]>('/sources/runs'),
    api<Job[]>('/sources/jobs'),
  ]);
  runs.value = results[0];
  jobs.value = results[1];
}
async function saveSchedule() {
  await run(async () => {
    await api('/sources/schedule', {
      method: 'PUT',
      body: JSON.stringify({
        ...schedule.value,
        ufs: scheduleUfs.value
          .toUpperCase()
          .split(/[\s,;]+/)
          .filter(Boolean),
      }),
    });
    notice.value =
      'Agendamento salvo. A coleta é executada pelo worker, inclusive com o portal fechado.';
    schedule.value = await api('/sources/schedule');
  });
}
async function rematch() {
  await run(async () => {
    await api('/sources/rematch', { method: 'POST' });
    notice.value =
      'Reclassificação agendada para o ambiente atual. As decisões da equipe serão preservadas.';
    await loadRuns();
  });
}
async function retry(job: Job) {
  await run(async () => {
    await api('/sources/jobs/' + job.id + '/retry', { method: 'POST' });
    notice.value = 'Trabalho reenviado para a fila.';
    await loadRuns();
  });
}
async function loadIntegrations() {
  const data = await Promise.all([
    api<Token[]>('/integrations/tokens'),
    api<Hook[]>('/integrations/webhooks'),
    api<Delivery[]>('/integrations/deliveries'),
    api<typeof integrationStatus.value>('/integrations/status'),
  ]);
  tokens.value = data[0];
  hooks.value = data[1];
  deliveries.value = data[2];
  integrationStatus.value = data[3];
}
async function createToken() {
  await run(async () => {
    const result = await api<{ token: string }>('/integrations/tokens', {
      method: 'POST',
      body: JSON.stringify({
        ...tokenForm,
        expiresAt: new Date(
          tokenForm.expiresAt + 'T23:59:59-03:00',
        ).toISOString(),
      }),
    });
    credential.value = result.token;
    credentialLabel.value = 'Credencial de API · exibida somente agora';
    tokenForm.name = '';
    await loadIntegrations();
  });
}
async function revokeToken(token: Token) {
  await run(async () => {
    await api('/integrations/tokens/' + token.id + '/revoke', {
      method: 'PATCH',
    });
    await loadIntegrations();
  });
}
async function createHook() {
  await run(async () => {
    const result = await api<{ secret: string }>('/integrations/webhooks', {
      method: 'POST',
      body: JSON.stringify(hookForm),
    });
    credential.value = result.secret;
    credentialLabel.value = 'Segredo de assinatura · exibido somente agora';
    hookForm.name = '';
    hookForm.url = '';
    await loadIntegrations();
  });
}
async function toggleHook(hook: Hook) {
  await run(async () => {
    await api('/integrations/webhooks/' + hook.id, {
      method: 'PATCH',
      body: JSON.stringify({ active: !hook.active }),
    });
    await loadIntegrations();
  });
}
async function retryDelivery(delivery: Delivery) {
  await run(async () => {
    await api('/integrations/deliveries/' + delivery.id + '/retry', {
      method: 'POST',
    });
    notice.value = 'Reenvio agendado.';
    await loadIntegrations();
  });
}
async function copy(value: string) {
  await run(async () => {
    await navigator.clipboard.writeText(value);
    notice.value = 'Copiado.';
  });
}
async function saveProfile() {
  await run(async () => {
    await api('/profile', {
      method: 'PATCH',
      body: JSON.stringify({ name: account.name }),
    });
    notice.value = 'Nome atualizado.';
    emit('refresh');
  });
}
async function changePassword() {
  await run(async () => {
    if (account.newPassword !== account.confirmation)
      throw new Error('As senhas não coincidem.');
    await api('/profile/password', {
      method: 'POST',
      body: JSON.stringify(account),
    });
    account.currentPassword = '';
    account.newPassword = '';
    account.confirmation = '';
    emit('logout');
  });
}
let poll: ReturnType<typeof setInterval> | undefined;
onMounted(
  () =>
    void run(async () => {
      if (['company', 'companies'].includes(props.section)) {
        await loadCompanies();
        if (props.section === 'company') editCompany(props.me.company);
      }
      if (props.section === 'members') await loadMembers();
      if (props.section === 'sources') {
        schedule.value = await api('/sources/schedule');
        scheduleUfs.value = schedule.value.ufs.join(', ');
        await loadRuns();
        poll = setInterval(() => void loadRuns().catch(() => {}), 6000);
      }
      if (props.section === 'integrations') await loadIntegrations();
    }),
);
onUnmounted(() => clearInterval(poll));
</script>
<template>
  <div class="admin-console">
    <div class="page-heading">
      <div>
        <span class="eyebrow">{{
          me.isGroupAdmin
            ? 'NTHUB · ADMINISTRAÇÃO'
            : me.company.shortName.toUpperCase()
        }}</span>
        <h1>{{ heading[0] }}</h1>
        <p>{{ heading[1] }}</p>
      </div>
      <button
        v-if="section === 'companies' && me.isGroupAdmin"
        class="primary"
        @click="newCompany"
      >
        <Plus :size="16" /> Nova empresa
      </button>
    </div>
    <p v-if="error" class="error banner" role="alert">{{ error }}</p>
    <p v-if="notice" class="notice banner" role="status">
      {{ notice
      }}<button @click="notice = ''" aria-label="Fechar aviso">×</button>
    </p>
    <template v-if="section === 'companies'"
      ><div class="company-grid">
        <article
          v-for="company in companies"
          :key="company.id"
          class="company-card"
        >
          <div class="company-card-heading">
            <div class="company-logo-tile">
              <img
                v-if="company.logoUrl"
                :src="company.logoUrl"
                :alt="company.shortName"
              />
            </div>
            <span class="tag">{{
              company.isParent ? 'MATRIZ' : company.active ? 'ATIVA' : 'INATIVA'
            }}</span>
          </div>
          <h2>{{ company.name }}</h2>
          <p>{{ company.description }}</p>
          <small
            >{{ company.capabilities.length }} palavras-chave · CNPJ
            {{ company.cnpj || 'pendente' }}</small
          >
          <div class="inline-actions">
            <button class="secondary" @click="editCompany(company)">
              <Settings2 :size="15" /> Editar cadastro</button
            ><button
              class="text-button"
              @click="emit('switch', company.id)"
              :disabled="!company.active"
            >
              Acessar <ArrowUpRight :size="14" />
            </button>
          </div>
        </article></div
    ></template>
    <form
      v-if="editor && form && ['company', 'companies'].includes(section)"
      class="panel settings-form"
      @submit.prevent="saveCompany"
    >
      <div class="section-title">
        <div>
          <span class="eyebrow">{{
            form.id ? 'CADASTRO DA EMPRESA' : 'NOVA EMPRESA'
          }}</span>
          <h2>{{ form.name || 'Dados da empresa' }}</h2>
        </div>
        <img
          v-if="form.logoUrl"
          :src="form.logoUrl"
          :alt="form.shortName"
          class="editor-company-logo"
        />
      </div>
      <fieldset :disabled="!canManage || busy">
        <div class="form-grid">
          <label
            >Nome da empresa<input
              v-model="form.name"
              required
              maxlength="180" /></label
          ><label
            >Nome curto<input
              v-model="form.shortName"
              required
              maxlength="50" /></label
          ><label
            >CNPJ (opcional)<input
              v-model="form.cnpj"
              inputmode="numeric"
              placeholder="Preencher posteriormente" /></label
          ><label
            >Site oficial (opcional)<input
              v-model="form.website"
              type="url"
              placeholder="https://"
          /></label>
        </div>
        <label
          >Áreas de atuação<textarea
            v-model="form.description"
            rows="3"
            maxlength="3000"
          />
        </label>
        <div v-if="form.id" class="logo-upload">
          <label
            >Logo da empresa · PNG até 2 MB<input
              type="file"
              accept="image/png"
              @change="uploadLogo"
          /></label>
        </div>
        <h3>Critérios de pesquisa</h3>
        <p class="muted">
          Uma expressão por linha. As oportunidades e decisões pertencem
          exclusivamente a este ambiente.
        </p>
        <div class="form-grid">
          <label
            >Palavras-chave de interesse<textarea
              v-model="terms"
              rows="7"
              placeholder="Uma expressão por linha"
            /></label
          ><label
            >Termos de exclusão<textarea
              v-model="excluded"
              rows="7"
              placeholder="Descartar resultados que contenham estes termos"
            /></label
          ><label
            >Exigir pelo menos um destes termos<textarea
              v-model="requiredTerms"
              rows="3"
              placeholder="Ex.: locação; aluguel; outsourcing"
            /></label
          ><label
            >Combinação das palavras-chave<select
              v-model="form.searchSettings.matchMode"
            >
              <option value="any">Qualquer palavra-chave</option>
              <option value="all">Todas as palavras-chave</option>
            </select></label
          ><label
            >UFs de interesse (vazio = todas)<input
              v-model="ufs"
              placeholder="SP, RJ, MG" /></label
          ><label
            >Valor mínimo estimado<input
              v-model="minimum"
              type="number"
              min="0"
              step="0.01" /></label
          ><label
            >Valor máximo estimado<input
              v-model="maximum"
              type="number"
              min="0"
              step="0.01"
          /></label>
        </div>
        <label class="check-label"
          ><input
            v-model="form.searchSettings.includeExpired"
            type="checkbox"
          />
          Incluir oportunidades com prazo encerrado</label
        ><label v-if="me.isGroupAdmin && !form.isParent" class="check-label"
          ><input v-model="form.active" type="checkbox" /> Empresa ativa</label
        >
        <div class="inline-actions">
          <button class="primary" :disabled="busy">
            <Save :size="16" /> Salvar empresa</button
          ><button
            v-if="form.id === me.companyId"
            type="button"
            class="secondary"
            @click="rematch"
            :disabled="busy"
          >
            <RefreshCw :size="15" /> Reclassificar catálogo existente
          </button>
        </div>
      </fieldset>
    </form>
    <p
      v-if="section === 'members' && me.isGroupAdmin"
      class="permissions-member-link"
    >
      Perfis personalizados e ajustes individuais ficam em
      <RouterLink to="/permissions">Permissões</RouterLink>.
    </p>
    <template v-if="section === 'members'"
      ><form
        v-if="canManage"
        class="panel settings-form"
        @submit.prevent="createMember"
      >
        <h2>Cadastrar funcionário neste ambiente</h2>
        <p>
          O funcionário define sua senha ao aceitar o convite. Para vincular
          alguém que já possui acesso, informe o mesmo e-mail.
        </p>
        <div class="form-grid">
          <label
            >Nome<input
              v-model="memberForm.name"
              required
              maxlength="120" /></label
          ><label
            >E-mail corporativo<input
              v-model="memberForm.email"
              type="email"
              required /></label
          ><label
            >Perfil na {{ me.company.shortName
            }}<select v-model="memberForm.role">
              <option value="analyst">Analista</option>
              <option value="viewer">Leitor / auditor</option>
              <option v-if="me.isGroupAdmin" value="company_manager">
                Gestor da empresa
              </option>
            </select></label
          >
        </div>
        <button class="primary" :disabled="busy">
          <Plus :size="16" /> Cadastrar e gerar convite
        </button>
      </form>
      <div v-if="invitation" class="panel secret-panel">
        <h3>Convite de ativação · uso único</h3>
        <p>
          Compartilhe somente com o funcionário indicado. Validade de 48 horas.
        </p>
        <textarea readonly :value="invitation" rows="3" /><button
          class="secondary"
          @click="copy(invitation)"
        >
          <Copy :size="15" /> Copiar convite
        </button>
      </div>
      <section class="panel">
        <h2>Acessos à {{ me.company.shortName }}</h2>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>FUNCIONÁRIO</th>
                <th>PERFIL</th>
                <th>SITUAÇÃO</th>
                <th>AÇÕES</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="member in members" :key="member.id">
                <td>
                  <strong>{{ member.name || member.email }}</strong><small>{{
                    member.email
                  }}</small>
                </td>
                <td>
                  <select
                    v-if="
                      canManage &&
                      member.role !== 'group_admin' &&
                      !member.permissionProfileId
                    "
                    v-model="member.role"
                    @change="updateMember(member)"
                    :disabled="busy"
                  >
                    <option value="analyst">Analista</option>
                    <option value="viewer">Leitor / auditor</option>
                    <option
                      v-if="
                        me.isGroupAdmin || member.role === 'company_manager'
                      "
                      value="company_manager"
                    >
                      Gestor da empresa
                    </option></select
                  ><span v-else>{{
                    member.permissionProfileName || roles[member.role]
                  }}</span>
                </td>
                <td>
                  <span
                    class="status"
                    :class="member.active ? 'new' : 'discarded'"
                    >{{ member.active ? 'Ativo' : 'Acesso suspenso' }}</span
                  >
                </td>
                <td>
                  <div
                    v-if="canManage && member.role !== 'group_admin'"
                    class="inline-actions"
                  >
                    <button
                      class="text-button"
                      @click="updateMember(member, !member.active)"
                      :disabled="busy"
                    >
                      {{
                        member.active ? 'Suspender' : 'Reativar'
                      }}</button><button
                      v-if="me.isGroupAdmin && member.active"
                      class="text-button"
                      @click="inviteMember(member)"
                      :disabled="busy"
                    >
                      Novo convite
                    </button>
                  </div>
                  <span v-else class="muted">{{
                    member.role === 'group_admin'
                      ? 'Acesso a todo o grupo'
                      : 'Somente consulta'
                  }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="permission-guide">
          <p>
            <strong>Gestor:</strong> configura a empresa, gerencia equipe e
            acompanha a operação.
          </p>
          <p>
            <strong>Analista:</strong> classifica oportunidades, trabalha nas
            participações e nos documentos.
          </p>
          <p>
            <strong>Leitor / auditor:</strong> consulta os recursos autorizados
            e a trilha de atividades.
          </p>
        </div>
      </section></template
    >
    <template v-if="section === 'sources'"
      ><form class="panel settings-form" @submit.prevent="saveSchedule">
        <h2>Coleta automática das fontes oficiais</h2>
        <p>
          O agendamento é independente da tela aberta. Os critérios de pesquisa
          são os da empresa selecionada.
        </p>
        <fieldset :disabled="!canManage || busy">
          <label class="check-label"
            ><input v-model="schedule.enabled" type="checkbox" /> Ativar coleta
            recorrente</label
          >
          <div class="check-group">
            <label class="check-label"
              ><input
                v-model="schedule.sources"
                type="checkbox"
                value="pncp"
              />PNCP</label
            ><label class="check-label"
              ><input
                v-model="schedule.sources"
                type="checkbox"
                value="compras"
              />Compras.gov.br · Lei 14.133</label
            >
          </div>
          <p class="muted">
            As empresas compartilham cache de 5 minutos e limites de consulta.
            Respostas 429 pausam a fonte e retomam a mesma página
            automaticamente.
          </p>
          <div class="form-grid">
            <label
              >Sincronizar a cada<select v-model="syncIntervalChoice">
                <option
                  v-for="interval in syncIntervals"
                  :key="interval.minutes"
                  :value="String(interval.minutes)"
                >
                  {{ interval.label }}
                </option>
                <option value="custom">Intervalo personalizado</option>
              </select></label
            >
            <label v-if="syncIntervalChoice === 'custom'"
              >Intervalo em minutos<input
                v-model.number="schedule.intervalMinutes"
                type="number"
                min="60"
                max="10080"
                step="1"
                required
                aria-describedby="sync-interval-help"
            /></label>
            <label
              >Janela de reconciliação<select v-model="schedule.lookbackDays">
                <option v-for="day in [1, 2, 3, 7, 14]" :key="day" :value="day">
                  Últimos {{ day }} dias
                </option>
              </select></label
            ><label
              >UFs (vazio = todas)<input
                v-model="scheduleUfs"
                placeholder="SP, RJ"
            /></label>
          </div>
          <p id="sync-interval-help" class="muted">
            Escolha de 60 minutos a 7 dias. O agendamento continua funcionando
            com o portal fechado; a análise por IA só acontece quando
            solicitada.
          </p>
          <div class="check-group">
            <label
              v-for="modality in [
                { id: 6, name: 'Pregão eletrônico' },
                { id: 4, name: 'Concorrência eletrônica' },
                { id: 8, name: 'Dispensa' },
                { id: 7, name: 'Pregão presencial' },
              ]"
              :key="modality.id"
              class="check-label"
              ><input
                v-model="schedule.modalities"
                type="checkbox"
                :value="modality.id"
              />{{ modality.name }}</label
            >
          </div>
          <div class="inline-actions">
            <button class="primary">
              <Save :size="16" /> Salvar agendamento</button
            ><button type="button" class="secondary" @click="rematch">
              <RefreshCw :size="16" /> Reclassificar catálogo
            </button>
          </div>
        </fieldset>
        <small class="muted">{{
          schedule.enabled
            ? 'Próxima execução: ' + date(schedule.nextRunAt)
            : 'Sincronização automática desativada. Ative a coleta recorrente e salve para começar.'
        }}</small>
      </form>
      <section class="panel">
        <div class="section-title">
          <h2>Histórico de coletas</h2>
          <button class="text-button" @click="run(loadRuns)">
            <RefreshCw :size="15" /> Atualizar
          </button>
        </div>
        <div v-if="!runs.length" class="empty compact-empty">
          <h3>Nenhuma coleta registrada neste ambiente</h3>
          <p>Sincronize uma fonte ou ative o agendamento para começar.</p>
        </div>
        <div v-else class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>INÍCIO</th>
                <th>FONTE</th>
                <th>SITUAÇÃO</th>
                <th>REGISTROS</th>
                <th>OPORTUNIDADES</th>
                <th>OBSERVAÇÃO</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in runs" :key="item.id">
                <td>{{ date(item.startedAt) }}</td>
                <td>
                  {{ item.source === 'compras' ? 'Compras.gov.br' : 'PNCP' }}
                </td>
                <td>{{ stateLabel[item.status] || item.status }}</td>
                <td>{{ item.recordsProcessed }}</td>
                <td>{{ item.opportunitiesProcessed }}</td>
                <td>{{ item.error || '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
      <section class="panel">
        <h2>Processamento e fila de falhas</h2>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>TRABALHO</th>
                <th>ESTADO</th>
                <th>TENTATIVA</th>
                <th>DETALHE</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="job in jobs" :key="job.id">
                <td>
                  {{ job.type }}<small>{{ date(job.createdAt) }}</small>
                </td>
                <td>{{ stateLabel[job.state] || job.state }}</td>
                <td>{{ job.attempt }}</td>
                <td>{{ job.error || '—' }}</td>
                <td>
                  <button
                    v-if="canManage && job.state === 'failed'"
                    class="secondary"
                    @click="retry(job)"
                    :disabled="busy"
                  >
                    Reprocessar
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
          <p v-if="!jobs.length" class="muted">Nenhum trabalho registrado.</p>
        </div>
      </section></template
    >
    <template v-if="section === 'integrations' && canManage"
      ><div v-if="integrationStatus" class="service-grid">
        <article
          v-for="item in [
            { name: 'Gemini', ready: integrationStatus.geminiConfigured },
            { name: 'E-mail SMTP', ready: integrationStatus.smtpConfigured },
            {
              name: 'Armazenamento S3',
              ready: integrationStatus.storageConfigured,
            },
            {
              name: 'SSO corporativo',
              ready: integrationStatus.oidcConfigured,
            },
          ]"
          :key="item.name"
        >
          <ShieldCheck :size="18" /><strong>{{ item.name }}</strong
          ><span>{{
            item.ready ? 'Configurado' : 'Aguardando configuração'
          }}</span>
        </article>
      </div>
      <div v-if="credential" class="panel secret-panel">
        <h3>{{ credentialLabel }}</h3>
        <p>
          Guarde este segredo no sistema autorizado. Ele não será exibido
          novamente.
        </p>
        <textarea readonly :value="credential" rows="3" />
        <div class="inline-actions">
          <button class="secondary" @click="copy(credential)">
            <Copy :size="15" /> Copiar</button
          ><button class="text-button" @click="credential = ''">
            Já guardei
          </button>
        </div>
      </div>
      <form class="panel settings-form" @submit.prevent="createToken">
        <h2>Nova credencial de API</h2>
        <div class="form-grid">
          <label
            >Identificação<input
              v-model="tokenForm.name"
              required
              placeholder="Sistema corporativo" /></label
          ><label
            >Validade<input v-model="tokenForm.expiresAt" type="date" required
          /></label>
        </div>
        <fieldset class="scope-options">
          <legend>Escopos permitidos</legend>
          <label v-for="scope in scopeOptions" :key="scope" class="check-label"
            ><input
              v-model="tokenForm.scopes"
              type="checkbox"
              :value="scope"
            />{{ scope }}</label
          >
        </fieldset>
        <button class="primary" :disabled="busy">
          <KeyRound :size="16" /> Gerar credencial desta empresa
        </button>
        <p class="muted">
          API documentada em
          <a href="/docs" target="_blank" rel="noopener">OpenAPI</a>. Utilize
          somente os escopos necessários.
        </p>
      </form>
      <section class="panel">
        <h2>Credenciais emitidas</h2>
        <article v-for="token in tokens" :key="token.id" class="list-row">
          <div>
            <strong>{{ token.name }}</strong><small
              >{{ token.scopes.join(' · ') }} · expira
              {{ date(token.expiresAt) }}</small
            >
          </div>
          <button
            class="secondary"
            @click="revokeToken(token)"
            :disabled="busy || !token.active"
          >
            {{ token.active ? 'Revogar' : 'Revogada' }}
          </button>
        </article>
        <p v-if="!tokens.length" class="muted">
          Nenhuma credencial de integração emitida.
        </p>
      </section>
      <form class="panel settings-form" @submit.prevent="createHook">
        <h2>Eventos para sistemas do grupo</h2>
        <p>
          Webhooks são assinados e enviados somente a destinos HTTPS
          autorizados.
        </p>
        <p class="muted">
          Hosts autorizados:
          {{
            integrationStatus?.webhookHosts.join(', ') ||
            'nenhum; configure o ambiente antes de cadastrar um destino'
          }}.
        </p>
        <div class="form-grid">
          <label>Nome<input v-model="hookForm.name" required /></label
          ><label
            >URL HTTPS<input
              v-model="hookForm.url"
              type="url"
              required
              placeholder="https://sistema.exemplo.com/eventos"
          /></label>
        </div>
        <div class="check-group">
          <label v-for="event in eventOptions" :key="event" class="check-label"
            ><input
              v-model="hookForm.events"
              type="checkbox"
              :value="event"
            />{{ event }}</label
          >
        </div>
        <button class="primary" :disabled="busy">Cadastrar webhook</button>
      </form>
      <section class="panel">
        <h2>Webhooks cadastrados</h2>
        <article v-for="hook in hooks" :key="hook.id" class="list-row">
          <div>
            <strong>{{ hook.name }}</strong><small>{{ hook.url }}</small
            ><small>{{ hook.events.join(' · ') }}</small>
          </div>
          <button class="secondary" @click="toggleHook(hook)" :disabled="busy">
            {{ hook.active ? 'Desativar' : 'Ativar' }}
          </button>
        </article>
        <p v-if="!hooks.length" class="muted">Nenhum webhook cadastrado.</p>
        <h3>Últimas entregas</h3>
        <article
          v-for="delivery in deliveries"
          :key="delivery.id"
          class="list-row"
        >
          <div>
            <strong
              >{{ delivery.eventType }} ·
              {{ stateLabel[delivery.status] || delivery.status }}</strong
            ><small
              >{{ delivery.attempts }} tentativas ·
              {{ delivery.error || 'sem erros' }}</small
            >
          </div>
          <button
            v-if="delivery.status === 'failed'"
            class="secondary"
            @click="retryDelivery(delivery)"
            :disabled="busy"
          >
            Reenviar
          </button>
        </article>
      </section></template
    >
    <template v-if="section === 'account'"
      ><form class="panel settings-form" @submit.prevent="saveProfile">
        <h2>Dados do acesso</h2>
        <label
          >Nome<input v-model="account.name" required maxlength="120" /></label
        ><label>E-mail<input :value="me.email" type="email" readonly /></label>
        <p>{{ roles[me.role] }} · {{ me.company.name }}</p>
        <button class="primary" :disabled="busy">Salvar nome</button>
      </form>
      <form class="panel settings-form" @submit.prevent="changePassword">
        <h2>Alterar senha</h2>
        <p>
          Após a alteração, todas as sessões serão encerradas. Utilize pelo
          menos 12 caracteres.
        </p>
        <label
          >Senha atual<input
            v-model="account.currentPassword"
            type="password"
            autocomplete="current-password"
            required
        /></label>
        <div class="form-grid">
          <label
            >Nova senha<input
              v-model="account.newPassword"
              type="password"
              autocomplete="new-password"
              minlength="12"
              required /></label
          ><label
            >Confirme a nova senha<input
              v-model="account.confirmation"
              type="password"
              autocomplete="new-password"
              minlength="12"
              required
          /></label>
        </div>
        <button class="primary" :disabled="busy">
          Alterar senha e encerrar sessões
        </button>
      </form></template
    >
  </div>
</template>
