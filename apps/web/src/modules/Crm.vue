<script setup lang="ts">
import { computed, ref, nextTick, onUnmounted, onMounted, watch } from 'vue';
import {
  Search,
  RefreshCw,
  ArrowUpRight,
  Clock3,
  UserRound,
} from 'lucide-vue-next';
import type { Opportunity, Status, UserContext } from '@nthub/contracts';
import type { CatalogQuery, CatalogSummary } from '@nthub/contracts';
import { hasPermission } from '@nthub/contracts';
import { api } from '../api';
import Sortable from 'sortablejs';
const props = defineProps<{
  me: UserContext;
  opportunities: Opportunity[];
  updatedAt: string | null;
  catalog: {
    total: number;
    page: number;
    pageSize: number;
    summary: CatalogSummary;
  } | null;
  loading: boolean;
}>();
const emit = defineEmits<{
  open: [id: string];
  refresh: [];
  sync: [];
  discard: [id: string];
  query: [value: Partial<CatalogQuery>];
}>();
const board = ref<HTMLElement | null>(null),
  optimistic = ref<Record<string, Status>>({}),
  dropTarget = ref<Status | null>(null),
  pointerMotion = ref(false);
const displayed = computed(() =>
  props.opportunities.map((o) => ({
    ...o,
    status: optimistic.value[o.id] ?? o.status,
  })),
);
watch(
  () => props.opportunities,
  (rows) => {
    for (const item of rows) {
      if (optimistic.value[item.id] === item.status)
        delete optimistic.value[item.id];
    }
  },
);
const animations = new Set<Animation>();
const flights = new Set<() => void>();
let dragOffset = { x: 0, y: 0 };
let dropOrigin: DOMRect | null = null;
onUnmounted(() => {
  animations.forEach((a) => a.cancel());
  flights.forEach((cleanup) => cleanup());
  animations.clear();
});
function positions() {
  return new Map(
    Array.from(
      board.value?.querySelectorAll<HTMLElement>('[data-card-id]') ?? [],
    ).map((el) => [el.dataset.cardId!, el.getBoundingClientRect()]),
  );
}
async function moveLayout(
  before: Map<string, DOMRect>,
  enabled: boolean,
  movingId?: string,
  origin?: DOMRect | null,
) {
  await nextTick();
  if (!enabled || matchMedia('(prefers-reduced-motion: reduce)').matches)
    return;
  animations.forEach((a) => a.cancel());
  animations.clear();
  flights.forEach((cleanup) => cleanup());
  const easing =
    getComputedStyle(board.value!).getPropertyValue('--ease-press').trim() ||
    'ease-out';
  for (const el of board.value?.querySelectorAll<HTMLElement>(
    '[data-card-id]',
  ) ?? []) {
    const old =
      el.dataset.cardId === movingId
        ? (origin ?? before.get(el.dataset.cardId!))
        : before.get(el.dataset.cardId!);
    if (!old) continue;
    const now = el.getBoundingClientRect(),
      x = old.left - now.left,
      y = old.top - now.top;
    if (Math.abs(x) < 1 && Math.abs(y) < 1) continue;
    if (el.dataset.cardId === movingId) {
      // Lift the moving card above every column, then settle at its destination.
      // A drop starts at the pointer's last position, never back in the old column.
      const copy = el.cloneNode(true) as HTMLElement;
      copy.setAttribute('aria-hidden', 'true');
      copy.removeAttribute('data-card-id');
      copy.removeAttribute('draggable');
      copy.classList.remove('crm-card-dragging', 'crm-card-saving');
      Object.assign(copy.style, {
        position: 'fixed',
        left: now.left + 'px',
        top: now.top + 'px',
        width: now.width + 'px',
        height: now.height + 'px',
        margin: '0',
        pointerEvents: 'none',
        zIndex: '1100',
        transformOrigin: 'center',
        boxShadow: '0 12px 28px #00000026',
      });
      const visibility = el.style.visibility;
      el.style.visibility = 'hidden';
      document.body.append(copy);
      const cleanup = () => {
        copy.remove();
        el.style.visibility = visibility;
        flights.delete(cleanup);
      };
      flights.add(cleanup);
      const animation = copy.animate(
        [
          {
            transform: `translate(${x}px,${y}px) scale(1.025) rotate(3deg)`,
            opacity: 0.96,
          },
          { transform: 'translate(0,0) scale(1) rotate(0deg)', opacity: 1 },
        ],
        { duration: 280, easing },
      );
      animations.add(animation);
      const finish = () => {
        cleanup();
        animations.delete(animation);
      };
      animation.onfinish = finish;
      animation.oncancel = finish;
    } else {
      const animation = el.animate(
        [
          { transform: `translate(${x}px,${y}px)` },
          { transform: 'translate(0,0)' },
        ],
        { duration: 200, easing },
      );
      animations.add(animation);
      animation.onfinish = () => animations.delete(animation);
    }
  }
}
function endDrag() {
  dragging.value = null;
  dropTarget.value = null;
}
const sortables: Sortable[] = [];
const visualOrder = ref<Record<string, string[]>>({});
try {
  visualOrder.value = JSON.parse(
    localStorage.getItem('crm-order-' + props.me.companyId) || '{}',
  );
} catch {}
function cardsFor(stage: Status) {
  const order = visualOrder.value[stage] ?? [];
  const rank = (id: string) => {
    const i = order.indexOf(id);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  return filtered.value
    .filter((o) => o.status === stage)
    .sort((a, b) => rank(a.id) - rank(b.id));
}
let dragNext: ChildNode | null = null;
function setupSorting() {
  sortables.splice(0).forEach((s) => s.destroy());
  for (const list of board.value?.querySelectorAll<HTMLElement>(
    '.crm-card-list',
  ) ?? []) {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    sortables.push(
      Sortable.create(list, {
        group: 'crm-' + props.me.companyId,
        draggable: '.crm-card',
        dataIdAttr: 'data-card-id',
        disabled: !canWrite.value || !!pending.value || props.loading,
        animation: reduced ? 0 : 180,
        easing: 'cubic-bezier(0.23, 1, 0.32, 1)',
        forceFallback: true,
        fallbackOnBody: true,
        fallbackTolerance: 6,
        delay: 120,
        delayOnTouchOnly: true,
        touchStartThreshold: 8,
        ghostClass: 'crm-trello-placeholder',
        chosenClass: 'crm-trello-chosen',
        fallbackClass: 'crm-trello-fallback',
        filter: '.crm-card-actions, select, input, textarea, a',
        preventOnFilter: false,
        scroll: true,
        scrollSensitivity: 70,
        scrollSpeed: 12,
        emptyInsertThreshold: 36,
        onStart(event) {
          dragging.value = event.item.dataset.cardId ?? null;
          pointerMotion.value = true;
          dragNext = event.item.nextSibling;
        },
        onMove(event) {
          dropTarget.value = event.to.dataset.stage as Status;
          return !pending.value;
        },
        onEnd(event) {
          const id = event.item.dataset.cardId,
            stage = event.to.dataset.stage as Status;
          const floating = document.querySelector<HTMLElement>(
            '.crm-trello-fallback',
          );
          const origin =
            floating?.getBoundingClientRect() ??
            event.item.getBoundingClientRect();
          const order = Array.from(
            event.to.querySelectorAll<HTMLElement>('[data-card-id]'),
          ).map((el) => el.dataset.cardId!);
          // Return the DOM to Vue before changing the reactive model.
          event.from.insertBefore(
            event.item,
            dragNext?.parentNode === event.from ? dragNext : null,
          );
          endDrag();
          if (!id) return;
          visualOrder.value = { ...visualOrder.value, [stage]: order };
          try {
            localStorage.setItem(
              'crm-order-' + props.me.companyId,
              JSON.stringify(visualOrder.value),
            );
          } catch {}
          dropOrigin = origin;
          void move(id, stage, true);
        },
      }),
    );
  }
}
onMounted(setupSorting);
onUnmounted(() => sortables.forEach((s) => s.destroy()));
const query = ref(''),
  stage = ref('all'),
  area = ref('pipeline'),
  pending = ref<string | null>(null),
  error = ref(''),
  notice = ref(''),
  dragging = ref<string | null>(null);
const stages: { id: Status; label: string; hint: string }[] = [
  { id: 'new', label: 'Novas', hint: 'Identificadas pelas fontes oficiais' },
  {
    id: 'review',
    label: 'Em análise',
    hint: 'Conferência de edital e aderência',
  },
  { id: 'selected', label: 'Selecionadas', hint: 'Preparação da participação' },
  {
    id: 'submitted',
    label: 'Proposta enviada',
    hint: 'Acompanhamento da disputa',
  },
  { id: 'won', label: 'Vencidas', hint: 'Resultado favorável registrado' },
  { id: 'lost', label: 'Perdidas', hint: 'Resultado encerrado' },
  { id: 'discarded', label: 'Descartadas', hint: 'Fora do radar da equipe' },
];
const canWrite = computed(() => hasPermission(props.me, 'opportunities:write'));
const canSync = computed(() => hasPermission(props.me, 'sources:sync'));
watch([() => area.value, () => stage.value], () => nextTick(setupSorting));
watch([canWrite, pending, () => props.loading], () =>
  sortables.forEach((s) =>
    s.option('disabled', !canWrite.value || !!pending.value || props.loading),
  ),
);
const filtered = computed(() => displayed.value);
const deadlineFilter = ref('all'),
  processingFilter = ref('all');
let filterTimer: ReturnType<typeof setTimeout> | undefined;
function searchPage(page = 1) {
  emit('query', {
    search: query.value,
    stage: stage.value as CatalogQuery['stage'],
    area: area.value as CatalogQuery['area'],
    deadline: deadlineFilter.value as CatalogQuery['deadline'],
    processing: processingFilter.value as CatalogQuery['processing'],
    page,
    pageSize: 50,
  });
}
watch([query, stage, area, deadlineFilter, processingFilter], () => {
  clearTimeout(filterTimer);
  filterTimer = setTimeout(() => searchPage(), 300);
});
onUnmounted(() => clearTimeout(filterTimer));
const visibleStages = computed(() =>
  stages.filter((s) =>
    area.value === 'discarded'
      ? s.id === 'discarded'
      : s.id !== 'discarded' && (stage.value === 'all' || stage.value === s.id),
  ),
);
const active = computed(() =>
  displayed.value.filter(
    (o) => !['won', 'lost', 'discarded'].includes(o.status),
  ),
);
const money = (value: string | null) =>
  value === null
    ? 'Valor não informado'
    : new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
        maximumFractionDigits: 0,
      }).format(Number(value));
const date = (value: string | null) =>
  value ? new Date(value).toLocaleDateString('pt-BR') : 'Sem prazo informado';
const progress: Record<string, string> = {
  pending: 'Aguardando coleta dos documentos',
  queued: 'Coleta ou análise na fila',
  processing: 'Coletando informações',
  partial: 'Informações com pendências',
  failed: 'Coleta com falha',
  ready: 'Documentos disponíveis',
};
async function move(id: string, status: Status, animate = pointerMotion.value) {
  if (!canWrite.value || pending.value || props.loading) return;
  const item = displayed.value.find((o) => o.id === id);
  if (!item || item.status === status) return;
  if (status === 'discarded') {
    emit('discard', id);
    return;
  }
  const oldStatus = item.status;
  const before = positions();
  optimistic.value = { ...optimistic.value, [id]: status };
  const origin = dropOrigin;
  dropOrigin = null;
  void moveLayout(before, animate, id, origin);
  endDrag();
  pending.value = id;
  error.value = '';
  try {
    await api(`/opportunities/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    notice.value = `Oportunidade movida para ${stages.find((s) => s.id === status)?.label}.`;
    optimistic.value = { ...optimistic.value, [id]: status };
    emit('refresh');
  } catch (e) {
    const before = positions();
    optimistic.value = { ...optimistic.value, [id]: oldStatus };
    void moveLayout(before, animate, id);
    error.value =
      e instanceof Error ? e.message : 'Não foi possível mover a oportunidade.';
  } finally {
    pending.value = null;
    dragging.value = null;
  }
}
function changeStage(event: Event, item: Opportunity) {
  const field = event.target as HTMLSelectElement;
  const next = field.value as Status;
  field.value = item.status;
  void move(item.id, next);
}
</script>
<template>
  <section class="crm-page">
    <div class="page-heading">
      <div>
        <span class="eyebrow"
          >{{ me.company.shortName }} · CRM DE LICITAÇÕES</span
        >
        <h1>Seu funil de oportunidades</h1>
        <p>
          As oportunidades entram em Novas assim que são identificadas. A equipe
          conduz os próximos passos.
        </p>
      </div>
      <div class="crm-sync-actions">
        <button class="primary" :disabled="!canSync" @click="emit('sync')">
          <RefreshCw :size="16" />Sincronizar agora
        </button>
        <RouterLink
          v-if="hasPermission(me, 'sources:read')"
          class="text-button"
          to="/settings?tab=sources"
          ><Clock3 :size="15" />Configurar frequência</RouterLink
        >
      </div>
    </div>
    <div class="crm-stats">
      <article>
        <span>Em andamento · prazo vigente</span
        ><strong>{{ catalog?.summary.active ?? 0 }}</strong>
      </article>
      <article>
        <span>Novas identificações</span
        ><strong>{{ catalog?.summary.new ?? 0 }}</strong>
      </article>
      <article>
        <span>Pipeline estimado</span
        ><strong>{{ money(catalog?.summary.estimatedPipeline ?? '0') }}</strong>
      </article>
    </div>
    <p
      class="notice banner"
      v-if="catalog?.summary.expired || catalog?.summary.unknownDeadline"
    >
      {{ catalog?.summary.expired ?? 0 }} oportunidades abertas com prazo
      encerrado · {{ catalog?.summary.unknownDeadline ?? 0 }} sem prazo
      informado. Esses valores não integram o pipeline com prazo vigente. Prazo
      encerrado não significa licitação perdida.
    </p>
    <p class="muted crm-live">
      <span v-if="updatedAt">
        Última atualização:
        {{ new Date(updatedAt).toLocaleTimeString('pt-BR') }}</span
      ><button class="text-button" @click="emit('refresh')">
        Atualizar agora
      </button>
    </p>
    <div v-if="error" class="error banner" role="alert">{{ error }}</div>
    <p v-if="notice" class="sr-only" role="status">{{ notice }}</p>
    <nav class="settings-tabs" aria-label="Áreas do CRM">
      <button
        :class="{ chosen: area === 'pipeline' }"
        :aria-pressed="area === 'pipeline'"
        @click="
          area = 'pipeline';
          stage = 'all';
        "
      >
        Funil de oportunidades</button
      ><button
        :class="{ chosen: area === 'discarded' }"
        :aria-pressed="area === 'discarded'"
        @click="
          area = 'discarded';
          stage = 'all';
        "
      >
        Descartadas ·
        {{ catalog?.summary.discarded ?? 0 }}
      </button>
    </nav>
    <div class="crm-toolbar">
      <label class="search"
        ><Search :size="16" /><input
          v-model="query"
          placeholder="Buscar por objeto, órgão ou responsável"
          aria-label="Buscar no CRM" /></label
      ><label v-if="area === 'pipeline'"
        >Etapa<select v-model="stage">
          <option value="all">Todas as etapas</option>
          <option
            v-for="s in stages.filter((s) => s.id !== 'discarded')"
            :key="s.id"
            :value="s.id"
          >
            {{ s.label }}
          </option>
        </select></label
      >
      <label
        >Prazo<select v-model="deadlineFilter">
          <option value="all">Todos os prazos</option>
          <option value="open">Prazo vigente</option>
          <option value="expired">Prazo encerrado</option>
          <option value="unknown">Sem prazo informado</option>
        </select></label
      >
      <label
        >Processamento<select v-model="processingFilter">
          <option value="all">Todas as situações</option>
          <option value="pending">Na fila / processando</option>
          <option value="failed">Falha — reprocessar</option>
          <option value="needs_ocr">Aguardando OCR</option>
          <option value="unsupported">Sem leitura automática</option>
          <option value="missing">Sem anexos na fonte</option>
          <option value="ready">Documentos disponíveis</option>
        </select></label
      >
    </div>
    <nav
      class="catalog-pagination"
      aria-label="Paginação do CRM"
      :aria-busy="loading"
    >
      <span
        >{{ catalog?.total ?? 0 }} resultados · página
        {{ catalog?.page ?? 1 }} de
        {{
          Math.max(
            1,
            Math.ceil((catalog?.total ?? 0) / (catalog?.pageSize ?? 50)),
          )
        }}
        · contagens das colunas nesta página</span
      >
      <button
        class="secondary"
        :disabled="loading || !catalog || catalog.page <= 1"
        @click="searchPage(catalog!.page - 1)"
      >
        Anterior
      </button>
      <button
        class="secondary"
        :disabled="
          loading ||
          !catalog ||
          catalog.page * catalog.pageSize >= catalog.total
        "
        @click="searchPage(catalog!.page + 1)"
      >
        Próxima
      </button>
    </nav>
    <div
      v-if="!opportunities.length && !loading"
      class="panel empty compact-empty"
    >
      <h2>Nenhuma oportunidade encontrada</h2>
      <p>
        Revise os filtros ou sincronize as fontes. Configure a coleta em
        Configurações → Fontes e coletas. Os editais aparecem aqui antes da
        conclusão da análise.
      </p>
    </div>
    <div
      ref="board"
      class="crm-board"
      @pointerdown.capture="pointerMotion = true"
      @keydown.capture="pointerMotion = false"
      :class="{ 'crm-discarded-area': area === 'discarded' }"
      :aria-label="
        area === 'discarded'
          ? 'Oportunidades descartadas'
          : 'Funil de oportunidades'
      "
    >
      <section
        v-for="column in visibleStages"
        :key="column.id"
        class="crm-column"
        :class="[
          'crm-' + column.id,
          { 'crm-drop-target': dragging && dropTarget === column.id },
        ]"
      >
        <header>
          <div>
            <h2>
              {{ column.label
              }}<span>{{
                filtered.filter((o) => o.status === column.id).length
              }}</span>
            </h2>
            <p>{{ column.hint }}</p>
          </div>
        </header>
        <div class="crm-card-list" :data-stage="column.id">
          <article
            v-for="item in cardsFor(column.id)"
            :key="item.id"
            class="crm-card"
            :data-card-id="item.id"
            :class="{
              'crm-card-dragging': dragging === item.id,
              'crm-card-saving': pending === item.id,
            }"
            :draggable="false"
          >
            <div class="crm-card-top">
              <span>{{
                (item.sources || ['pncp'])
                  .map((s) => (s === 'compras' ? 'Compras.gov.br' : 'PNCP'))
                  .join(' · ')
              }}</span><small>{{ item.uf || 'Brasil' }}</small>
            </div>
            <button class="crm-card-title" @click="emit('open', item.id)">
              {{ item.title }}
            </button>
            <p class="crm-agency">{{ item.agency }}</p>
            <p v-if="item.status === 'discarded'" class="crm-discard-reason">
              <strong>Justificativa do descarte</strong
              >{{
                item.decisionReason ||
                'Descarte anterior sem justificativa registrada.'
              }}
            </p>
            <strong class="crm-value">{{ money(item.value) }}</strong>
            <p class="crm-meta">
              <Clock3 :size="14" />{{ date(item.deadline) }}
            </p>
            <p v-if="item.deadlineState === 'expired'" class="notice">
              Prazo encerrado — conferir prorrogação
            </p>
            <p v-if="item.deadlineState === 'unknown'" class="muted">
              Prazo não informado pela fonte
            </p>
            <p v-if="item.sourceChangedAt" class="notice">
              Edital atualizado — revisar informações
            </p>
            <p class="crm-meta">
              <UserRound :size="14" />{{
                item.assignedName || 'Sem responsável'
              }}
            </p>
            <p class="crm-processing">
              {{ progress[item.processingState] || item.processingState }}
            </p>
            <p v-if="item.analysis?.adherence" class="crm-fit">
              {{
                item.analysis.adherence.overallScore === null
                  ? 'Aderência em validação'
                  : `Aderência ${item.analysis.adherence.overallScore}/100`
              }}<span
                >{{ item.analysis.adherence.coverage }}% do peso avaliado</span
              >
            </p>
            <div class="crm-card-actions">
              <label
                ><span class="sr-only"
                  >Etapa da oportunidade {{ item.agency }}</span
                ><select
                  :value="item.status"
                  :disabled="!canWrite || !!pending || loading"
                  @change="changeStage($event, item)"
                >
                  <option v-for="s in stages" :key="s.id" :value="s.id">
                    {{ s.label }}
                  </option>
                </select></label
              ><button
                class="text-button"
                @click="emit('open', item.id)"
                :aria-label="'Abrir oportunidade de ' + item.agency"
              >
                <ArrowUpRight :size="17" />
              </button>
            </div>
          </article>
          <div
            v-if="!filtered.some((o) => o.status === column.id)"
            class="crm-column-empty"
          >
            {{
              column.id === 'new'
                ? 'Novas identificações aparecerão aqui.'
                : 'Nenhuma oportunidade nesta etapa.'
            }}
          </div>
        </div>
      </section>
    </div>
  </section>
</template>
