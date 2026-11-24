<script setup lang="ts">
import { ref } from 'vue';
import { api } from '../api';
const props = defineProps<{ required: boolean; initialEmail: string }>();
const emit = defineEmits<{ back: []; complete: [] }>();
const email = ref(props.initialEmail),
  password = ref(''),
  confirmation = ref('');
const busy = ref(false),
  error = ref(''),
  message = ref('');
async function submit() {
  error.value = '';
  if (props.required && password.value !== confirmation.value) {
    error.value = 'As senhas não coincidem.';
    return;
  }
  busy.value = true;
  try {
    if (props.required) {
      await api('/auth/password-reset/complete', {
        method: 'POST',
        body: JSON.stringify({
          newPassword: password.value,
          confirmPassword: confirmation.value,
        }),
      });
      password.value = confirmation.value = '';
      emit('complete');
    } else {
      const result = await api<{ message: string }>('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: email.value.trim() }),
      });
      message.value = result.message;
    }
  } catch (e) {
    error.value =
      e instanceof Error
        ? e.message
        : 'Não foi possível concluir. Tente novamente.';
  } finally {
    busy.value = false;
  }
}
async function back() {
  if (props.required) {
    busy.value = true;
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch {
      error.value = 'Não foi possível sair. Tente novamente.';
      return;
    } finally {
      busy.value = false;
    }
  }
  emit('back');
}
</script>

<template>
  <form class="login-form" @submit.prevent="submit">
    <span class="eyebrow">SEGURANÇA DA CONTA</span>
    <h2>{{ required ? 'Crie sua nova senha' : 'Redefinir senha' }}</h2>
    <p>
      {{
        required
          ? 'Antes de acessar o portal, escolha uma nova senha com pelo menos 12 caracteres. Você tem 15 minutos para concluir.'
          : 'Informe o e-mail cadastrado. Enviaremos uma senha temporária válida por 30 minutos para você entrar e escolher uma nova.'
      }}
    </p>
    <template v-if="required">
      <label
        >Nova senha<input
          v-model="password"
          type="password"
          autocomplete="new-password"
          minlength="12"
          maxlength="256"
          required
      /></label>
      <label
        >Confirmar nova senha<input
          v-model="confirmation"
          type="password"
          autocomplete="new-password"
          minlength="12"
          maxlength="256"
          required
      /></label>
    </template>
    <label v-else
      >E-mail cadastrado<input
        v-model="email"
        type="email"
        autocomplete="email"
        maxlength="254"
        required
    /></label>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="message" class="notice" role="status">{{ message }}</p>
    <button class="primary" :disabled="busy">
      {{
        busy
          ? 'Aguarde…'
          : required
            ? 'Salvar nova senha'
            : 'Enviar senha temporária'
      }}
    </button>
    <button type="button" class="secondary" :disabled="busy" @click="back">
      {{ required ? 'Sair e voltar ao login' : 'Voltar ao login' }}
    </button>
  </form>
</template>
