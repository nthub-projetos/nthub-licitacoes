<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import type { UserContext } from '@nthub/contracts';
import { api } from '../api';
defineProps<{ me: UserContext }>();
const emit = defineEmits<{ switch: [id: string] }>();
type Company = {
  id: string;
  name: string;
  shortName: string;
  logoUrl: string | null;
  active: boolean;
  opportunities: number;
  activeOpportunities: number;
};
type Report = {
  companies: Company[];
  totals: {
    opportunities: number;
    uniqueProcurements: number;
    active: number;
    new: number;
    review: number;
    selected: number;
    submitted: number;
    won: number;
    lost: number;
    discarded: number;
    estimatedPipeline: string;
    expired: number;
    unknownDeadline: number;
    expiredPipeline: string;
    discardedPipeline: string;
    upcomingDeadlines: number;
    proposalCount: number;
    proposalValue: string;
  };
  byStatus: { status: string; count: number }[];
  byUf: { uf: string; count: number }[];
};
const company = ref(''),
  data = ref<Report | null>(null),
  error = ref(''),
  busy = ref(false);
let revision = 0;
async function load() {
  const request = ++revision;
  busy.value = true;
  error.value = '';
  try {
    const report = await api<Report>(
      '/analytics/group' + (company.value ? '?companyId=' + company.value : ''),
    );
    if (request === revision) data.value = report;
  } catch (e) {
    if (request === revision)
      error.value =
        e instanceof Error ? e.message : 'Falha ao consultar indicadores.';
  } finally {
    if (request === revision) busy.value = false;
  }
}
const labels: Record<string, string> = {
  new: 'Novas',
  review: 'Em análise',
  selected: 'Selecionadas',
  submitted: 'Proposta enviada',
  won: 'Vencidas',
  lost: 'Perdidas',
  discarded: 'Descartadas',
};
const companies = computed(
  () =>
    data.value?.companies.filter(
      (c) => !company.value || c.id === company.value,
    ) || [],
);
const money = (v: string) =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  }).format(Number(v));
watch(company, () => void load());
onMounted(() => void load());
</script>
<template>
  <section class="group-dashboard">
    <div class="page-heading">
      <div>
        <span class="eyebrow">NTHUB · GESTÃO DO GRUPO</span>
        <h1>Indicadores do grupo</h1>
        <p>
          Acompanhe as empresas operacionais em conjunto ou filtre uma empresa.
        </p>
      </div>
      <button class="secondary" :disabled="busy" @click="load">
        Atualizar indicadores
      </button>
    </div>
    <p v-if="error" class="error banner" role="alert">{{ error }}</p>
    <label class="group-company-filter"
      >Filtrar indicadores por empresa<select v-model="company">
        <option value="">Todas as empresas</option>
        <option v-for="c in data?.companies || []" :key="c.id" :value="c.id">
          {{ c.shortName }}{{ c.active ? '' : ' (inativa)' }}
        </option>
      </select></label
    ><template v-if="data"
      ><div class="group-summary">
        <article>
          <span>Oportunidades ativas</span
          ><strong>{{ data.totals.active }}</strong>
        </article>
        <article>
          <span>Licitações únicas</span
          ><strong>{{ data.totals.uniqueProcurements }}</strong>
        </article>
        <article>
          <span>Vencidas</span><strong>{{ data.totals.won }}</strong>
        </article>
        <article>
          <span>Prazos nos próximos 7 dias</span
          ><strong>{{ data.totals.upcomingDeadlines }}</strong>
        </article>
      </div>
      <section class="panel discarded-pipeline-card">
        <p class="notice">
          {{ data.totals.expired }} oportunidades abertas com prazo encerrado ·
          {{ data.totals.unknownDeadline }} sem prazo informado. Fora do
          pipeline com prazo vigente.
        </p>
        <p>
          Valor com prazo encerrado: {{ money(data.totals.expiredPipeline) }}
        </p>
        <span class="eyebrow">OPORTUNIDADES DESCARTADAS</span>
        <h2>Pipeline de valor descartado</h2>
        <strong class="pipeline-value">{{
          money(data.totals.discardedPipeline)
        }}</strong>
        <p class="muted">
          {{ data.totals.discarded }} oportunidades · valores estimados,
          separados do pipeline ativo.
        </p>
      </section>
      <div class="report-grid">
        <section class="panel">
          <h2>Funil consolidado</h2>
          <div
            v-for="item in data.byStatus"
            :key="item.status"
            class="metric-bar"
          >
            <div>
              <span>{{ labels[item.status] || item.status }}</span><strong>{{
                item.count
              }}</strong>
            </div>
            <meter
              :value="item.count"
              :max="Math.max(1, data.totals.opportunities)"
              :aria-label="labels[item.status]"
            />
          </div>
          <p v-if="!data.byStatus.length" class="muted">
            Nenhuma oportunidade neste filtro.
          </p>
        </section>
        <section class="panel">
          <h2>Valores em acompanhamento</h2>
          <p class="muted">Estimativa publicada das oportunidades ativas</p>
          <strong class="pipeline-value">{{
            money(data.totals.estimatedPipeline)
          }}</strong>
          <p class="muted">
            Propostas mais recentes por oportunidade ·
            {{ data.totals.proposalCount }}
          </p>
          <strong class="pipeline-value">{{
            money(data.totals.proposalValue)
          }}</strong>
          <p class="muted">
            São valores estimados e propostos, sem representar receita
            contratada.
          </p>
        </section>
      </div>
      <div class="company-grid">
        <article v-for="c in companies" :key="c.id" class="panel company-card">
          <img
            v-if="c.logoUrl"
            :src="c.logoUrl"
            :alt="c.name"
            class="company-card-logo"
          />
          <h2>{{ c.name }}</h2>
          <p>
            {{ c.activeOpportunities }} ativas ·
            {{ c.opportunities }} oportunidades no total
          </p>
          <button
            v-if="c.active"
            class="secondary"
            @click="emit('switch', c.id)"
          >
            Acessar empresa
          </button>
        </article>
      </div></template
    >
  </section>
</template>
