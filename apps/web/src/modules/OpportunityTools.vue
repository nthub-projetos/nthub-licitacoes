<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import type { Member, UserContext } from '@nthub/contracts';
import { hasPermission } from '@nthub/contracts';
import { api } from '../api';
const props = defineProps<{ me: UserContext; opportunityId: string }>();
const emit = defineEmits<{ refresh: []; transferred: [companyId: string] }>();
const transferCompanies = ref<
    { id: string; name: string; shortName: string }[]
  >([]),
  transferCompany = ref(''),
  transferReason = ref('');
const canTransfer = computed(
  () => hasPermission(props.me, 'opportunities:transfer') && writable.value,
);
async function transfer() {
  if (!transferCompany.value || !transferReason.value.trim()) return;
  await run(async () => {
    await api(`/opportunities/${props.opportunityId}/transfer`, {
      method: 'POST',
      body: JSON.stringify({
        companyId: transferCompany.value,
        reason: transferReason.value,
      }),
    });
    emit('transferred', transferCompany.value);
  });
}
type Proposal = {
  id: string;
  title: string;
  proposedValue: string | null;
  status: string;
  protocol: string;
  notes: string;
};
type Contact = {
  id: string;
  name: string;
  role: string;
  email: string | null;
  phone: string;
  notes: string;
};
type Event = {
  id: string;
  kind: string;
  action: string;
  createdAt: string;
  userName: string | null;
  body?: string;
  details: Record<string, any>;
};
type Activity = {
  assignedUserId: string | null;
  decisionReason: string | null;
  timeline: Event[];
  bids: Proposal[];
  contacts: Contact[];
};
const activity = ref<Activity | null>(null),
  members = ref<Member[]>([]),
  busy = ref(false),
  error = ref(''),
  comment = ref(''),
  proposalOpen = ref(false),
  contactOpen = ref(false);
const proposal = reactive({
  id: '',
  title: 'Proposta comercial',
  value: '',
  notes: '',
  status: 'draft',
  protocol: '',
});
const contact = reactive({
  id: '',
  name: '',
  role: '',
  email: '',
  phone: '',
  notes: '',
});
const manager = computed(() => hasPermission(props.me, 'members:manage'));
const proposalWritable = computed(
  () => writable.value && hasPermission(props.me, 'bids:write'),
);
const writable = computed(
  () =>
    hasPermission(props.me, 'opportunities:write') &&
    (manager.value ||
      !activity.value?.assignedUserId ||
      activity.value.assignedUserId === props.me.userId),
);
async function load() {
  const [a, m] = await Promise.all([
    api<Activity>(`/opportunities/${props.opportunityId}/activity`),
    hasPermission(props.me, 'members:read')
      ? api<Member[]>('/members')
      : Promise.resolve([]),
  ]);
  activity.value = a;
  members.value = m;
  if (hasPermission(props.me, 'opportunities:transfer'))
    transferCompanies.value = await api('/opportunities/transfer-destinations');
}
async function run(fn: () => Promise<void>) {
  busy.value = true;
  error.value = '';
  try {
    await fn();
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Não foi possível salvar.';
  } finally {
    busy.value = false;
  }
}
async function assign(e: globalThis.Event) {
  await run(async () => {
    await api(`/opportunities/${props.opportunityId}/assignment`, {
      method: 'PATCH',
      body: JSON.stringify({
        userId: (e.target as HTMLSelectElement).value || null,
      }),
    });
    await load();
    emit('refresh');
  });
}
async function addComment() {
  await run(async () => {
    await api(`/opportunities/${props.opportunityId}/notes`, {
      method: 'POST',
      body: JSON.stringify({ body: comment.value }),
    });
    comment.value = '';
    await load();
  });
}
function editProposal(id?: string) {
  const b = activity.value?.bids.find((b) => b.id === id);
  Object.assign(
    proposal,
    b
      ? {
          id: b.id,
          title: b.title,
          value: b.proposedValue || '',
          notes: b.notes,
          status: b.status,
          protocol: b.protocol,
        }
      : {
          id: '',
          title: 'Proposta comercial',
          value: '',
          notes: '',
          status: 'draft',
          protocol: '',
        },
  );
  proposalOpen.value = true;
}
async function saveProposal() {
  await run(async () => {
    await api('/bids' + (proposal.id ? '/' + proposal.id : ''), {
      method: proposal.id ? 'PATCH' : 'POST',
      body: JSON.stringify({
        opportunityId: props.opportunityId,
        title: proposal.title,
        proposedValue: proposal.value.replace(',', '.'),
        notes: proposal.notes,
        status: proposal.status,
        protocol: proposal.protocol,
      }),
    });
    proposalOpen.value = false;
    await load();
    emit('refresh');
  });
}
function editContact(c?: Contact) {
  Object.assign(
    contact,
    c
      ? { ...c, email: c.email || '' }
      : { id: '', name: '', role: '', email: '', phone: '', notes: '' },
  );
  contactOpen.value = true;
}
async function saveContact() {
  await run(async () => {
    await api(
      `/opportunities/${props.opportunityId}/contacts` +
        (contact.id ? '/' + contact.id : ''),
      {
        method: contact.id ? 'PATCH' : 'POST',
        body: JSON.stringify({ ...contact, email: contact.email || null }),
      },
    );
    contactOpen.value = false;
    await load();
  });
}
const labels: Record<string, string> = {
  'bid:created': 'Proposta registrada',
  'bid:updated': 'Proposta atualizada',
  'contact:created': 'Contato cadastrado',
  'contact:updated': 'Contato atualizado',
  'opportunity:assigned': 'Responsável atualizado',
  'opportunity:transferred': 'Transferência entre empresas',
  'analysis:completed': 'Análise por IA concluída',
  'analysis:requested': 'Análise por IA solicitada pela equipe',
  'source:documents-collected': 'Informações coletadas na fonte',
};
const stages: Record<string, string> = {
  new: 'Nova',
  review: 'Em análise',
  selected: 'Selecionada',
  submitted: 'Proposta enviada',
  won: 'Vencida',
  lost: 'Perdida',
  discarded: 'Descartada',
};
const label = (action: string) =>
  action.startsWith('status:')
    ? 'Etapa alterada para ' + (stages[action.slice(7)] || action.slice(7))
    : labels[action] || action;
const date = (v: string) =>
  new Date(v).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
const money = (v: unknown) =>
  v == null
    ? 'Valor não registrado'
    : new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
      }).format(Number(v));
onMounted(() => void run(load));
</script>
<template>
  <section
    class="op-workflow opportunity-crm-tools"
    aria-label="Contatos, propostas e linha do tempo"
  >
    <p v-if="error" class="error banner" role="alert">{{ error }}</p>
    <template v-if="activity">
      <details v-if="canTransfer" class="contact-section transfer-section">
        <summary>Transferir para outra empresa</summary>
        <p class="muted">
          A oportunidade e seu histórico serão enviados para o CRM da empresa
          escolhida, na etapa Novas. O responsável será removido e uma nova
          análise de aderência dependerá de solicitação. Propostas formalizadas
          permanecem na empresa participante.
        </p>
        <form v-if="transferCompanies.length" @submit.prevent="transfer">
          <label
            >Empresa de destino<select
              v-model="transferCompany"
              required
              :disabled="busy"
            >
              <option value="" disabled>Selecione a empresa</option>
              <option v-for="c in transferCompanies" :key="c.id" :value="c.id">
                {{ c.shortName || c.name }}
              </option>
            </select></label
          ><label
            >Motivo da transferência<textarea
              v-model="transferReason"
              required
              maxlength="3000"
              rows="3"
              :disabled="busy"
              placeholder="Explique por que esta oportunidade se enquadra na outra empresa."
            /></label
          ><button
            class="primary"
            :disabled="busy || !transferCompany || !transferReason.trim()"
          >
            {{ busy ? 'Transferindo…' : 'Transferir oportunidade' }}
          </button>
        </form>
        <p v-else class="muted">
          Nenhuma outra empresa operacional está disponível com permissão de
          transferência.
        </p>
      </details>
      <label
        >Responsável pela oportunidade<select
          :value="activity.assignedUserId || ''"
          :disabled="!manager || busy"
          @change="assign"
        >
          <option value="">Sem responsável</option>
          <option
            v-for="m in members.filter((m) => m.active)"
            :key="m.id"
            :value="m.id"
          >
            {{ m.name || m.email }}
          </option>
        </select></label
      >
      <details class="contact-section">
        <summary>
          Contatos da oportunidade · {{ activity.contacts.length }}
        </summary>
        <p v-if="!activity.contacts.length" class="muted">
          Nenhum contato cadastrado. Você pode incluir os contatos que já
          conhece.
        </p>
        <article v-for="c in activity.contacts" :key="c.id" class="op-contact">
          <strong>{{ c.name }}</strong>
          <p>{{ c.role }}</p>
          <p v-if="c.email">{{ c.email }}</p>
          <p v-if="c.phone">{{ c.phone }}</p>
          <p v-if="c.notes">{{ c.notes }}</p>
          <button
            v-if="writable"
            class="text-button"
            :disabled="busy"
            @click="editContact(c)"
          >
            Editar contato
          </button>
        </article>
        <button v-if="writable" class="secondary" @click="editContact()">
          Cadastrar contato
        </button>
      </details>
      <form
        v-if="contactOpen && writable"
        class="settings-form panel"
        @submit.prevent="saveContact"
      >
        <h3>{{ contact.id ? 'Editar contato' : 'Cadastrar contato' }}</h3>
        <label
          >Nome do contato<input
            v-model="contact.name"
            required
            minlength="2"
            maxlength="150" /></label
        ><label
          >Função / relação<input v-model="contact.role" maxlength="150"
        /></label>
        <div class="form-grid">
          <label
            >E-mail do contato<input
              v-model="contact.email"
              type="email" /></label
          ><label
            >Telefone do contato<input
              v-model="contact.phone"
              type="tel"
              maxlength="60"
          /></label>
        </div>
        <label
          >Observações do contato<textarea
            v-model="contact.notes"
            maxlength="3000"
          />
        </label>
        <div class="inline-actions">
          <button class="primary" :disabled="busy">Salvar contato</button
          ><button type="button" class="secondary" @click="contactOpen = false">
            Cancelar
          </button>
        </div>
      </form>
      <div class="op-timeline-heading">
        <h3>Linha do tempo</h3>
        <button
          v-if="proposalWritable"
          class="secondary"
          @click="editProposal()"
        >
          Registrar proposta
        </button>
      </div>
      <form
        v-if="proposalOpen && proposalWritable"
        class="settings-form panel"
        @submit.prevent="saveProposal"
      >
        <h3>{{ proposal.id ? 'Atualizar proposta' : 'Registrar proposta' }}</h3>
        <label
          >Identificação da proposta<input
            v-model="proposal.title"
            required
            maxlength="250" /></label
        ><label
          >Valor da proposta (R$)<input
            v-model="proposal.value"
            inputmode="decimal"
            pattern="[0-9]+([,.][0-9]{1,2})?"
            placeholder="1500,00"
            required /></label
        ><label
          >Observações da proposta<textarea
            v-model="proposal.notes"
            maxlength="10000"
          /></label
        ><small class="muted"
          >O valor e as alterações ficam registrados na linha do tempo desta
          oportunidade.</small
        >
        <div class="inline-actions">
          <button class="primary" :disabled="busy">Salvar proposta</button
          ><button
            type="button"
            class="secondary"
            @click="proposalOpen = false"
          >
            Cancelar
          </button>
        </div>
      </form>
      <form v-if="writable" class="comment-form" @submit.prevent="addComment">
        <label
          >Comentário / próximo passo<textarea
            v-model="comment"
            rows="3"
            maxlength="10000"
            required
            placeholder="Registre a avaliação, o contato realizado ou o próximo passo."
          /></label
        ><button class="secondary" :disabled="busy">
          Registrar comentário
        </button>
      </form>
      <p v-if="activity.decisionReason" class="muted">
        Motivo da última decisão: {{ activity.decisionReason }}
      </p>
      <div class="op-timeline">
        <article
          v-for="event in activity.timeline"
          :key="event.id"
          class="op-timeline-event"
        >
          <span class="live-dot"></span>
          <div>
            <strong>{{
              event.kind === 'comment' ? 'Comentário' : label(event.action)
            }}</strong><small
              >{{ event.userName || 'Sistema' }} ·
              {{ date(event.createdAt) }}</small
            >
            <p v-if="event.action === 'opportunity:transferred'">
              {{ event.details.fromCompany }} → {{ event.details.toCompany
              }}<br />{{ event.details.reason }}
            </p>
            <p v-if="event.body">{{ event.body }}</p>
            <p
              v-if="event.action === 'status:discarded' && event.details.reason"
            >
              <strong>Justificativa do descarte:</strong>
              {{ event.details.reason }}
            </p>
            <template v-if="event.kind === 'proposal'"
              ><p>{{ event.details.title || 'Proposta' }}</p>
              <p>
                <strong
                  >Valor da proposta:
                  {{ money(event.details.proposedValue) }}</strong
                >
              </p>
              <p v-if="event.details.previousProposedValue != null">
                Valor anterior: {{ money(event.details.previousProposedValue) }}
              </p>
              <p v-if="event.details.notes">{{ event.details.notes }}</p>
              <button
                v-if="
                  proposalWritable &&
                  activity.bids.some((b) => b.id === event.details.bidId)
                "
                class="text-button"
                @click="editProposal(event.details.bidId)"
              >
                Editar proposta atual
              </button></template
            ><template v-if="event.kind === 'contact'"
              ><p>
                {{ event.details.name
                }}<span v-if="event.details.role">
                  · {{ event.details.role }}</span
                >
              </p>
              <p v-if="event.details.email">{{ event.details.email }}</p>
              <p v-if="event.details.phone">
                {{ event.details.phone }}
              </p></template
            >
          </div>
        </article>
      </div>
    </template>
  </section>
</template>
