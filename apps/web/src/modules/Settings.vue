<script setup lang="ts">
import { computed, defineAsyncComponent, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { UserContext } from '@nthub/contracts';
import { hasPermission } from '@nthub/contracts';
import { api } from '../api';
const props = defineProps<{ me: UserContext }>(),
  emit = defineEmits<{ refresh: [] }>();
const Administration = defineAsyncComponent(
  () => import('./Administration.vue'),
);
const route = useRoute(),
  router = useRouter(),
  error = ref(''),
  events = ref<
    {
      action: string;
      createdAt: string;
      userName: string | null;
      details: Record<string, unknown>;
    }[]
  >([]);
const tabs = computed(() => [
  ...(hasPermission(props.me, 'sources:read')
    ? [{ id: 'sources', name: 'Fontes e coletas' }]
    : []),
  ...(hasPermission(props.me, 'integrations:read')
    ? [{ id: 'integrations', name: 'Integrações' }]
    : []),
  ...(hasPermission(props.me, 'audit:read')
    ? [{ id: 'audit', name: 'Atividades' }]
    : []),
]);
const tab = computed(() =>
  tabs.value.some((t) => t.id === route.query.tab)
    ? String(route.query.tab)
    : (tabs.value[0]?.id ?? ''),
);
async function audit() {
  error.value = '';
  try {
    events.value = await api('/audit');
  } catch (e) {
    error.value =
      e instanceof Error ? e.message : 'Falha ao consultar atividades.';
  }
}
watch(
  tab,
  () => {
    if (tab.value === 'audit') void audit();
  },
  { immediate: true },
);
const date = (v: string) =>
  new Date(v).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
</script>
<template>
  <section class="settings-module">
    <div class="page-heading">
      <div>
        <span class="eyebrow">{{ me.company.shortName }} · ADMINISTRAÇÃO</span>
        <h1>Configurações</h1>
        <p>Fontes, integrações e atividades do ambiente em um só lugar.</p>
      </div>
    </div>
    <nav class="settings-tabs" aria-label="Seções de configurações">
      <button
        v-for="entry in tabs"
        :key="entry.id"
        :class="{ chosen: tab === entry.id }"
        :aria-pressed="tab === entry.id"
        @click="router.replace({ path: '/settings', query: { tab: entry.id } })"
      >
        {{ entry.name }}
      </button>
    </nav>
    <Administration
      v-if="tab !== 'audit' && !(me.company.isParent && tab === 'sources')"
      :key="me.companyId + tab"
      :me="me"
      :section="tab"
      @refresh="emit('refresh')"
    />
    <section v-else-if="me.company.isParent && tab === 'sources'" class="panel">
      <h2>Fontes por empresa</h2>
      <p>
        A NTHUB acompanha os indicadores do grupo. Selecione uma empresa
        operacional no seletor de ambiente para configurar suas fontes e
        coletas.
      </p>
    </section>
    <section v-else class="panel">
      <div class="section-title">
        <h2>Atividades</h2>
        <button class="secondary" @click="audit">Atualizar atividades</button>
      </div>
      <p v-if="error" class="error banner" role="alert">{{ error }}</p>
      <p v-if="!events.length" class="muted">
        Nenhuma atividade registrada neste ambiente.
      </p>
      <article v-for="(event, index) in events" :key="index" class="audit-row">
        <div>
          <strong>{{ event.action }}</strong><small
            >{{ event.userName || 'Sistema' }} ·
            {{ date(event.createdAt) }}</small
          >
        </div>
      </article>
    </section>
  </section>
</template>
