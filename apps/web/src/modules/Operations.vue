<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import {
  Plus,
  Save,
  FileText,
  Download,
  Check,
  ArrowUpRight,
  Bell,
  ClipboardList,
  BarChart3,
} from 'lucide-vue-next';
import type {
  Member,
  Notification,
  Opportunity,
  UserContext,
  WorkTask,
} from '@nthub/contracts';
import { hasPermission } from '@nthub/contracts';
import { api } from '../api';
const props = defineProps<{
  me: UserContext;
  section: string;
  opportunities: Opportunity[];
}>();
const emit = defineEmits<{ refresh: []; open: [id: string] }>();
const busy = ref(false),
  error = ref(''),
  notice = ref('');
const canWrite = computed(() => hasPermission(props.me, 'tasks:write'));
const canManage = computed(
  () => props.me.isGroupAdmin || props.me.role === 'company_manager',
);
const headings: Record<string, [string, string]> = {
  tasks: [
    'Tarefas e prazos',
    'Transforme cada decisão em próximos passos claros.',
  ],
  notifications: [
    'Notificações',
    'Novas oportunidades, análises e lembretes de prazo.',
  ],
  reports: ['Indicadores', 'Acompanhe o funil e os resultados da operação.'],
};
const heading = computed(() => headings[props.section] || ['Operação', '']);
const tasks = ref<WorkTask[]>([]),
  members = ref<Member[]>([]),
  notifications = ref<Notification[]>([]);
const taskForm = reactive({
  title: '',
  opportunityId: '',
  assignedUserId: '',
  dueAt: '',
});
const preferences = reactive({
  emailEnabled: false,
  leadDays: [1, 3, 7] as number[],
});
type Metrics = {
  opportunities: number;
  active: number;
  review: number;
  selected: number;
  won: number;
  lost: number;
  estimatedPipeline: string;
  upcomingDeadlines: number;
  byStatus: { status: string; count: number }[];
  byUf: { uf: string; count: number }[];
};
const metrics = ref<Metrics | null>(null);
const statusLabels: Record<string, string> = {
  new: 'Novas',
  review: 'Em análise',
  selected: 'Selecionadas',
  discarded: 'Descartadas',
  submitted: 'Propostas enviadas',
  won: 'Vencidas',
  lost: 'Perdidas',
};
const money = (value: string | null) =>
  value == null
    ? 'Não informado'
    : new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
      }).format(Number(value));
const date = (value: string | null) =>
  value
    ? new Date(value).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
    : 'Não definido';
async function run(fn: () => Promise<void>) {
  busy.value = true;
  error.value = '';
  try {
    await fn();
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Falha na operação.';
  } finally {
    busy.value = false;
  }
}
async function load() {
  if (props.section === 'tasks') {
    const data = await Promise.all([
      api<WorkTask[]>('/tasks'),
      hasPermission(props.me, 'members:read')
        ? api<Member[]>('/members')
        : Promise.resolve([]),
    ]);
    tasks.value = data[0];
    members.value = data[1];
  }
  if (props.section === 'notifications') {
    notifications.value = await api('/notifications');
    Object.assign(preferences, await api('/notifications/preferences'));
  }
  if (props.section === 'reports')
    metrics.value = await api('/analytics/overview');
}
async function saveTask() {
  await run(async () => {
    await api('/tasks', {
      method: 'POST',
      body: JSON.stringify({
        ...taskForm,
        opportunityId: taskForm.opportunityId || null,
        assignedUserId: taskForm.assignedUserId || null,
        dueAt: taskForm.dueAt
          ? new Date(taskForm.dueAt + ':00-03:00').toISOString()
          : null,
      }),
    });
    Object.assign(taskForm, {
      title: '',
      opportunityId: '',
      assignedUserId: '',
      dueAt: '',
    });
    notice.value = 'Tarefa criada.';
    await load();
  });
}
async function toggleTask(task: WorkTask) {
  await run(async () => {
    await api('/tasks/' + task.id, {
      method: 'PATCH',
      body: JSON.stringify({
        status: task.status === 'done' ? 'pending' : 'done',
      }),
    });
    await load();
  });
}
async function markRead(item: Notification) {
  await run(async () => {
    await api('/notifications/' + item.id + '/read', { method: 'POST' });
    await load();
    emit('refresh');
  });
}
async function savePreferences() {
  await run(async () => {
    await api('/notifications/preferences', {
      method: 'PUT',
      body: JSON.stringify(preferences),
    });
    notice.value = 'Preferências salvas para este ambiente.';
  });
}
const completed = computed(
  () => tasks.value.filter((task) => task.status === 'done').length,
);
const maxUf = computed(() =>
  Math.max(1, ...(metrics.value?.byUf.map((item) => item.count) || [])),
);
onMounted(() => void run(load));
</script>
<template>
  <div class="operations-console">
    <div class="page-heading">
      <div>
        <span class="eyebrow"
          >{{ me.company.shortName.toUpperCase() }} · OPERAÇÃO</span
        >
        <h1>{{ heading[0] }}</h1>
        <p>{{ heading[1] }}</p>
      </div>
      <a
        v-if="section === 'reports'"
        class="secondary"
        :href="'/api/v1/exports/opportunities.csv?company=' + me.companyId"
        ><Download :size="16" /> Exportar oportunidades</a
      >
    </div>
    <p v-if="error" class="error banner" role="alert">{{ error }}</p>
    <p v-if="notice" class="notice banner" role="status">{{ notice }}</p>
    <template v-if="section === 'tasks'"
      ><form
        v-if="canWrite"
        class="panel settings-form"
        @submit.prevent="saveTask"
      >
        <h2>Nova tarefa</h2>
        <div class="form-grid">
          <label
            >Título<input
              v-model="taskForm.title"
              required
              maxlength="300" /></label
          ><label
            >Prazo · horário de Brasília<input
              v-model="taskForm.dueAt"
              type="datetime-local" /></label
          ><label
            >Oportunidade (opcional)<select v-model="taskForm.opportunityId">
              <option value="">Tarefa da empresa</option>
              <option v-for="op in opportunities" :key="op.id" :value="op.id">
                {{ op.title.slice(0, 130) }}
              </option>
            </select></label
          ><label
            >Responsável<select v-model="taskForm.assignedUserId">
              <option value="">Sem responsável</option>
              <option
                v-for="member in members.filter(
                  (m) => m.active && (canManage || m.id === me.userId),
                )"
                :key="member.id"
                :value="member.id"
              >
                {{ member.name || member.email }}
              </option>
            </select></label
          >
        </div>
        <button class="primary" :disabled="busy">
          <Plus :size="16" /> Criar tarefa
        </button>
      </form>
      <section class="panel">
        <div class="section-title">
          <h2>Plano de trabalho</h2>
          <span class="tag"
            >{{ completed }} de {{ tasks.length }} concluídas</span
          >
        </div>
        <p v-if="!tasks.length" class="muted">
          Nenhuma tarefa cadastrada neste ambiente.
        </p>
        <article
          v-for="task in tasks"
          :key="task.id"
          class="list-row task-row"
          :class="{ done: task.status === 'done' }"
        >
          <button
            v-if="canWrite"
            class="task-check"
            @click="toggleTask(task)"
            :aria-label="
              task.status === 'done'
                ? 'Reabrir ' + task.title
                : 'Concluir ' + task.title
            "
            :disabled="
              busy ||
              (!canManage &&
                Boolean(task.assignedUserId) &&
                task.assignedUserId !== me.userId)
            "
          >
            <Check v-if="task.status === 'done'" :size="16" />
          </button>
          <div>
            <strong>{{ task.title }}</strong><small
              >{{ task.assignedName || 'Sem responsável' }} · prazo
              {{ date(task.dueAt) }}</small
            >
          </div>
          <button
            v-if="task.opportunityId"
            class="text-button"
            @click="emit('open', task.opportunityId)"
          >
            Ver oportunidade
          </button>
        </article>
      </section></template
    >
    <template v-if="section === 'notifications'"
      ><form class="panel settings-form" @submit.prevent="savePreferences">
        <h2>Seus alertas na {{ me.company.shortName }}</h2>
        <label class="check-label"
          ><input v-model="preferences.emailEnabled" type="checkbox" /> Receber
          alertas também por e-mail</label
        >
        <fieldset class="check-group">
          <legend>Lembrar antes do encerramento</legend>
          <label
            v-for="days in [0, 1, 2, 3, 7, 15, 30]"
            :key="days"
            class="check-label"
            ><input
              v-model="preferences.leadDays"
              type="checkbox"
              :value="days"
            />{{ days === 0 ? 'No último dia' : days + ' dia(s)' }}</label
          >
        </fieldset>
        <button class="primary" :disabled="busy">Salvar preferências</button>
      </form>
      <section class="panel">
        <div v-if="!notifications.length" class="empty">
          <Bell :size="30" />
          <h3>Você está em dia</h3>
          <p>Os alertas deste ambiente aparecerão aqui.</p>
        </div>
        <article
          v-for="item in notifications"
          :key="item.id"
          class="notification-card"
          :class="{ unread: !item.read }"
        >
          <div class="notification-icon"><Bell :size="17" /></div>
          <div>
            <small>{{ date(item.createdAt) }}</small>
            <h3>{{ item.title }}</h3>
            <p>{{ item.body }}</p>
            <div class="inline-actions">
              <button
                v-if="item.opportunityId"
                class="text-button"
                @click="emit('open', item.opportunityId)"
              >
                Ver oportunidade <ArrowUpRight :size="14" /></button
              ><button
                v-if="!item.read"
                class="text-button"
                @click="markRead(item)"
                :disabled="busy"
              >
                Marcar como lida</button
              ><span v-else class="muted">Lida</span>
            </div>
          </div>
        </article>
      </section></template
    >
    <template v-if="section === 'reports' && metrics"
      ><div class="group-summary">
        <article>
          <span>Oportunidades ativas</span><strong>{{ metrics.active }}</strong>
        </article>
        <article>
          <span>Selecionadas</span><strong>{{ metrics.selected }}</strong>
        </article>
        <article>
          <span>Oportunidades vencidas</span><strong>{{ metrics.won }}</strong>
        </article>
        <article>
          <span>Prazos nos próximos 7 dias</span
          ><strong>{{ metrics.upcomingDeadlines }}</strong>
        </article>
      </div>
      <div class="report-grid">
        <section class="panel">
          <span class="eyebrow">FUNIL DA EMPRESA</span>
          <h2>Distribuição por status</h2>
          <div
            v-for="item in metrics.byStatus"
            :key="item.status"
            class="metric-bar"
          >
            <div>
              <span>{{
                statusLabels[item.status] || item.status
              }}</span><strong>{{ item.count }}</strong>
            </div>
            <meter
              :value="item.count"
              :max="Math.max(1, metrics.opportunities)"
              :aria-label="statusLabels[item.status]"
            />
          </div>
          <p v-if="!metrics.byStatus.length" class="muted">
            Nenhuma oportunidade coletada.
          </p>
        </section>
        <section class="panel">
          <span class="eyebrow">COBERTURA</span>
          <h2>Oportunidades por UF</h2>
          <div v-for="item in metrics.byUf" :key="item.uf" class="metric-bar">
            <div>
              <span>{{ item.uf }}</span><strong>{{ item.count }}</strong>
            </div>
            <meter
              :value="item.count"
              :max="maxUf"
              :aria-label="'Oportunidades em ' + item.uf"
            />
          </div>
          <p v-if="!metrics.byUf.length" class="muted">
            Os dados serão calculados a partir da coleta.
          </p>
        </section>
      </div>
      <section class="panel">
        <h2>Valor estimado em acompanhamento</h2>
        <strong class="pipeline-value">{{
          money(metrics.estimatedPipeline)
        }}</strong>
        <p>
          Somatório das estimativas das oportunidades ativas. Não representa
          receita nem contrato garantido.
        </p>
      </section></template
    >
  </div>
</template>
