<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../api';
const location = window.location;
const token = new URLSearchParams(location.hash.slice(1)).get('token') || '';
const invite = ref<{ name: string; email: string; company: string } | null>(
    null,
  ),
  password = ref(''),
  confirmation = ref(''),
  busy = ref(false),
  error = ref(''),
  done = ref(false);
onMounted(async () => {
  try {
    invite.value = await api('/auth/invitation/inspect', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
  } catch (e) {
    error.value =
      e instanceof Error ? e.message : 'Não foi possível abrir o convite.';
  }
});
async function accept() {
  busy.value = true;
  error.value = '';
  try {
    if (password.value !== confirmation.value)
      throw new Error('As senhas não coincidem.');
    await api('/auth/invitation/accept', {
      method: 'POST',
      body: JSON.stringify({ token, password: password.value }),
    });
    password.value = '';
    confirmation.value = '';
    history.replaceState(null, '', '/accept-invitation');
    await api('/auth/logout', { method: 'POST' });
    done.value = true;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Falha na ativação.';
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <main class="invitation-page">
    <form class="panel settings-form" @submit.prevent="accept">
      <img
        src="/brand/nthub-logo.png"
        alt="NTHUB"
        class="invitation-logo"
      /><span class="eyebrow">ATIVAÇÃO DE ACESSO</span>
      <h1>
        {{ done ? 'Seu acesso está pronto' : 'Bem-vindo ao grupo NTHUB' }}
      </h1>
      <p v-if="error" class="error banner" role="alert">{{ error }}</p>
      <template v-if="invite && !done"
        ><p>
          {{ invite.name }}, você foi convidado para o ambiente
          <strong>{{ invite.company }}</strong>.
        </p>
        <label
          >E-mail<input
            :value="invite.email"
            readonly
            autocomplete="username" /></label
        ><label
          >Defina sua senha<input
            v-model="password"
            type="password"
            autocomplete="new-password"
            minlength="12"
            required /></label
        ><label
          >Confirme a senha<input
            v-model="confirmation"
            type="password"
            autocomplete="new-password"
            minlength="12"
            required /></label
        ><small
          >Utilize pelo menos 12 caracteres. Este convite só pode ser utilizado
          uma vez.</small
        ><button class="primary" :disabled="busy">
          Ativar acesso
        </button></template
      >
      <p v-if="done">Entre com seu e-mail e a senha que acabou de definir.</p>
      <button
        v-if="done"
        type="button"
        class="primary"
        @click="location.assign('/overview')"
      >
        Ir para o acesso
      </button>
    </form>
  </main>
</template>
