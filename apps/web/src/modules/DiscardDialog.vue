<script setup lang="ts">
import { onMounted, ref } from 'vue';
defineProps<{ busy: boolean; error: string }>();
const emit = defineEmits<{ confirm: [reason: string]; cancel: [] }>();
const reason = ref(''),
  field = ref<HTMLTextAreaElement | null>(null);
onMounted(() => field.value?.focus());
</script>
<template>
  <Teleport to="body"
    ><div class="discard-backdrop" @keydown.esc.stop="!busy && emit('cancel')">
      <form
        class="discard-dialog panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="discard-title"
        @submit.prevent="emit('confirm', reason.trim())"
      >
        <h2 id="discard-title">Descartar oportunidade</h2>
        <p>
          Ela será movida para a área de descartadas e seu valor ficará fora do
          pipeline estimado.
        </p>
        <label
          >Justificativa do descarte<textarea
            ref="field"
            v-model="reason"
            required
            maxlength="3000"
            rows="4"
            placeholder="Explique por que a empresa não seguirá com esta oportunidade."
            :disabled="busy"
          />
        </label>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <div class="inline-actions">
          <button
            type="button"
            class="secondary"
            :disabled="busy"
            @click="emit('cancel')"
          >
            Cancelar</button
          ><button class="primary" :disabled="busy || !reason.trim()">
            {{ busy ? 'Descartando…' : 'Confirmar descarte' }}
          </button>
        </div>
      </form>
    </div></Teleport
  >
</template>
<style scoped>
.discard-backdrop {
  position: fixed;
  inset: 0;
  background: #050b18aa;
  z-index: 1200;
  display: grid;
  place-items: center;
  padding: 20px;
}
.discard-dialog {
  width: min(100%, 520px);
  max-height: 90dvh;
  overflow: auto;
  margin: 0;
}
.discard-dialog h2 {
  margin-top: 0;
}
.discard-dialog p {
  color: var(--muted);
  line-height: 1.6;
  font-size: 13px;
}
.discard-dialog label {
  display: grid;
  gap: 10px;
  margin: 20px 0;
}
.discard-dialog textarea {
  width: 100%;
  resize: vertical;
}
.discard-dialog .inline-actions {
  justify-content: flex-end;
}
</style>
