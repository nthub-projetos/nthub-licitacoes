<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { Plus, ShieldCheck, Save, Copy, Users } from 'lucide-vue-next';
import type { UserContext, CompanyRole } from '@nthub/contracts';
import { api } from '../api';
const props = defineProps<{ me: UserContext }>();
type Profile = {
  id: string;
  name: string;
  description: string;
  permissions: string[];
  builtin: boolean;
};
type Member = {
  id: string;
  name: string;
  email: string;
  role: CompanyRole;
  profileId: string | null;
  overrides: Record<string, boolean>;
  active: boolean;
};
type Catalog = { key: string; group: string; label: string };
const data = ref<{
  profiles: Profile[];
  members: Member[];
  catalog: Catalog[];
}>({ profiles: [], members: [], catalog: [] });
const tab = ref('profiles'),
  busy = ref(false),
  error = ref(''),
  notice = ref(''),
  editing = ref(false),
  memberId = ref('');
const form = reactive({
  id: '',
  name: '',
  description: '',
  permissions: [] as string[],
});
const access = reactive({
  profile: 'viewer',
  overrides: {} as Record<string, boolean>,
});
const groups = computed(() => [
  ...new Set(data.value.catalog.map((p) => p.group)),
]);
const selectedMember = computed(() =>
  data.value.members.find((m) => m.id === memberId.value),
);
const selectedProfile = computed(() =>
  data.value.profiles.find((p) => p.id === access.profile),
);
const effective = computed(() =>
  data.value.catalog.filter(
    (p) =>
      access.overrides[p.key] ??
      selectedProfile.value?.permissions.includes(p.key),
  ),
);
async function load() {
  data.value = await api('/permissions');
}
async function run(fn: () => Promise<void>) {
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    await fn();
  } catch (e) {
    error.value =
      e instanceof Error ? e.message : 'Falha ao salvar permissões.';
  } finally {
    busy.value = false;
  }
}
onMounted(() => run(load));
function edit(p?: Profile, copy = false) {
  form.id = p && !copy && !p.builtin ? p.id : '';
  form.name = p ? (copy || p.builtin ? p.name + ' · cópia' : p.name) : '';
  form.description = p?.description ?? '';
  form.permissions = [...(p?.permissions ?? [])];
  editing.value = true;
  notice.value = '';
  error.value = '';
}
function toggleGroup(group: string, checked: boolean) {
  const keys = data.value.catalog
    .filter((p) => p.group === group)
    .map((p) => p.key);
  form.permissions = checked
    ? [...new Set([...form.permissions, ...keys])]
    : form.permissions.filter((p) => !keys.includes(p));
}
async function saveProfile() {
  await run(async () => {
    await api('/permissions/profiles' + (form.id ? '/' + form.id : ''), {
      method: form.id ? 'PATCH' : 'POST',
      body: JSON.stringify({
        name: form.name,
        description: form.description,
        permissions: form.permissions,
      }),
    });
    await load();
    editing.value = false;
    notice.value =
      'Perfil salvo. Os acessos vinculados já usam estas permissões.';
  });
}
function selectMember() {
  const member = selectedMember.value;
  if (!member) return;
  access.profile = member.profileId ?? member.role;
  access.overrides = { ...member.overrides };
  notice.value = '';
  error.value = '';
}
function override(key: string, value: string) {
  if (value === 'inherit') delete access.overrides[key];
  else access.overrides[key] = value === 'allow';
}
async function saveAccess() {
  if (!selectedMember.value) return;
  await run(async () => {
    await api('/permissions/members/' + memberId.value, {
      method: 'PUT',
      body: JSON.stringify({
        role: selectedProfile.value?.builtin ? access.profile : 'viewer',
        profileId: selectedProfile.value?.builtin ? null : access.profile,
        overrides: access.overrides,
      }),
    });
    await load();
    notice.value = 'Permissões do funcionário atualizadas nesta empresa.';
  });
}
</script>
<template>
  <section class="permissions-page">
    <div class="page-heading">
      <div>
        <span class="eyebrow"
          >{{ me.company.shortName }} · CONTROLE DE ACESSO</span
        >
        <h1>Permissões</h1>
        <p>
          Defina perfis e ajuste o acesso de cada funcionário neste ambiente.
        </p>
      </div>
      <button v-if="tab === 'profiles'" class="primary" @click="edit()">
        <Plus :size="16" /> Novo perfil
      </button>
    </div>
    <div class="permissions-scope">
      <ShieldCheck :size="20" />
      <div>
        <strong>Acessos por empresa</strong>
        <p>
          Alterações valem apenas para {{ me.company.shortName }}. O
          administrador NTHUB mantém acesso integral ao grupo.
        </p>
      </div>
    </div>
    <p v-if="error" class="error banner" role="alert">{{ error }}</p>
    <p v-if="notice" class="notice banner" role="status">{{ notice }}</p>
    <nav class="settings-tabs" aria-label="Seções de permissões">
      <button
        :class="{ chosen: tab === 'profiles' }"
        :aria-pressed="tab === 'profiles'"
        @click="tab = 'profiles'"
      >
        Perfis de acesso</button
      ><button
        :class="{ chosen: tab === 'members' }"
        :aria-pressed="tab === 'members'"
        @click="
          tab = 'members';
          editing = false;
        "
      >
        Por funcionário
      </button>
    </nav>
    <template v-if="tab === 'profiles'">
      <form
        v-if="editing"
        class="panel permission-editor"
        @submit.prevent="saveProfile"
      >
        <div class="permission-editor-heading">
          <div>
            <h2>{{ form.id ? 'Editar perfil' : 'Novo perfil' }}</h2>
            <p>Marque as ações permitidas. As demais ficam bloqueadas.</p>
          </div>
          <span class="permission-count"
            >{{ form.permissions.length }} de
            {{ data.catalog.length }} permissões</span
          >
        </div>
        <div class="form-grid">
          <label
            >Nome do perfil<input
              v-model="form.name"
              required
              minlength="2"
              maxlength="80"
              placeholder="Ex.: Comercial, Operador de CRM" /></label
          ><label
            >Descrição<input
              v-model="form.description"
              maxlength="400"
              placeholder="Responsabilidades deste perfil"
          /></label>
        </div>
        <div class="permission-groups">
          <fieldset v-for="group in groups" :key="group">
            <legend>{{ group }}</legend>
            <label class="permission-check permission-check-all"
              ><input
                type="checkbox"
                :checked="
                  data.catalog
                    .filter((p) => p.group === group)
                    .every((p) => form.permissions.includes(p.key))
                "
                @change="
                  toggleGroup(
                    group,
                    ($event.target as HTMLInputElement).checked,
                  )
                "
              />Selecionar seção</label
            ><label
              v-for="p in data.catalog.filter((p) => p.group === group)"
              :key="p.key"
              class="permission-check"
              ><input
                v-model="form.permissions"
                type="checkbox"
                :value="p.key"
              />{{ p.label }}</label
            >
          </fieldset>
        </div>
        <div class="permission-actions">
          <button
            type="button"
            class="secondary"
            :disabled="busy"
            @click="editing = false"
          >
            Cancelar</button
          ><button class="primary" :disabled="busy">
            <Save :size="16" />{{ busy ? 'Salvando…' : 'Salvar perfil' }}
          </button>
        </div>
      </form>
      <div v-else class="permission-profile-grid">
        <article
          v-for="p in data.profiles"
          :key="p.id"
          class="panel permission-profile"
        >
          <div class="permission-profile-title">
            <ShieldCheck :size="20" /><span>{{
              p.builtin ? 'Padrão' : 'Personalizado'
            }}</span>
          </div>
          <h2>{{ p.name }}</h2>
          <p>
            {{ p.description || 'Perfil personalizado para esta empresa.' }}
          </p>
          <strong>{{ p.permissions.length }} permissões</strong>
          <div class="permission-actions">
            <button v-if="!p.builtin" class="secondary" @click="edit(p)">
              Editar perfil</button
            ><button class="text-button" @click="edit(p, true)">
              <Copy :size="15" />Criar cópia
            </button>
          </div>
        </article>
      </div>
    </template>
    <section v-else class="panel permission-editor">
      <template v-if="data.members.length"
        ><label class="permission-member-picker"
          >Funcionário<select v-model="memberId" @change="selectMember">
            <option value="" disabled>Selecione um funcionário</option>
            <option v-for="m in data.members" :key="m.id" :value="m.id">
              {{ m.name || m.email }} · {{ m.active ? 'Ativo' : 'Inativo' }}
            </option>
          </select></label
        >
        <template v-if="selectedMember"
          ><div class="permission-member-heading">
            <div>
              <h2>{{ selectedMember.name || selectedMember.email }}</h2>
              <p>{{ selectedMember.email }}</p>
            </div>
            <span class="permission-count"
              >{{ effective.length }} permissões efetivas</span
            >
          </div>
          <label class="permission-member-picker"
            >Perfil de acesso<select v-model="access.profile">
              <option v-for="p in data.profiles" :key="p.id" :value="p.id">
                {{ p.name }}
              </option>
            </select></label
          >
          <div class="permission-individual-heading">
            <div>
              <h3>Ajustes individuais</h3>
              <p>
                Herdar segue o perfil. Permitir e bloquear têm prioridade sobre
                ele.
              </p>
            </div>
            <button
              type="button"
              class="text-button"
              @click="access.overrides = {}"
            >
              Restaurar herança
            </button>
          </div>
          <div class="permission-overrides">
            <section v-for="group in groups" :key="group">
              <h3>{{ group }}</h3>
              <div
                v-for="p in data.catalog.filter((p) => p.group === group)"
                :key="p.key"
                class="permission-override"
              >
                <div>
                  <label :for="'permission-' + p.key">{{ p.label }}</label
                  ><small
                    :class="{ allowed: effective.some((e) => e.key === p.key) }"
                    >{{
                      effective.some((e) => e.key === p.key)
                        ? 'Permitido'
                        : 'Bloqueado'
                    }}</small
                  >
                </div>
                <select
                  :id="'permission-' + p.key"
                  :value="
                    p.key in access.overrides
                      ? access.overrides[p.key]
                        ? 'allow'
                        : 'deny'
                      : 'inherit'
                  "
                  @change="
                    override(p.key, ($event.target as HTMLSelectElement).value)
                  "
                >
                  <option value="inherit">Herdar do perfil</option>
                  <option value="allow">Permitir</option>
                  <option value="deny">Bloquear</option>
                </select>
              </div>
            </section>
          </div>
          <div class="permission-actions">
            <button class="primary" :disabled="busy" @click="saveAccess">
              <Save :size="16" />{{ busy ? 'Salvando…' : 'Salvar permissões' }}
            </button>
          </div>
        </template></template
      >
      <div v-else class="permission-empty">
        <Users :size="28" />
        <h2>Nenhum funcionário vinculado</h2>
        <p>
          Cadastre um funcionário nesta empresa para definir o perfil e os
          acessos individuais.
        </p>
        <RouterLink class="primary" to="/members"
          >Cadastrar funcionário</RouterLink
        >
      </div>
    </section>
  </section>
</template>
