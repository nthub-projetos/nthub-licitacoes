<script setup lang="ts">
import type { Adherence } from '@nthub/contracts';
defineProps<{ assessment: Adherence }>();
const emit = defineEmits<{
  evidence: [documentId: string | undefined, page: number];
}>();
const labels = {
  supported: 'Correspondência integral',
  partial: 'Correspondência parcial',
  unsupported: 'Incompatibilidade demonstrada',
  unknown: 'Pendente de comprovação',
};
</script>
<template>
  <section
    class="adherence-breakdown"
    aria-label="Cálculo de aderência por critério"
  >
    <div class="adherence-result">
      <span class="eyebrow">ADERÊNCIA FUNDAMENTADA</span>
      <h3>
        {{
          assessment.overallScore === null
            ? 'Resultado geral inconclusivo'
            : `Aderência geral: ${assessment.overallScore}/100`
        }}
      </h3>
      <p>{{ assessment.explanation }}</p>
      <div class="adherence-coverage">
        <strong>{{ assessment.coverage }}% do peso avaliado</strong
        ><span v-if="assessment.status === 'inconclusive'"
          >Faixa possível: {{ assessment.lowerBound }}–{{
            assessment.upperBound
          }}/100</span
        >
      </div>
      <small v-if="assessment.status === 'inconclusive'"
        >A faixa é matemática: depende dos critérios ainda pendentes. Não é uma
        previsão de aprovação.</small
      >
    </div>
    <article
      v-for="dimension in assessment.dimensions"
      :key="dimension.id"
      class="adherence-dimension"
    >
      <div class="adherence-dimension-heading">
        <div>
          <h4>{{ dimension.label }}</h4>
          <span
            >Peso {{ dimension.weight }}% · {{ dimension.coverage }}%
            avaliado</span
          >
        </div>
        <strong>{{
          dimension.score === null ? 'Pendente' : `${dimension.score}/100`
        }}</strong>
      </div>
      <details
        v-for="criterion in dimension.criteria"
        :key="criterion.id"
        class="adherence-criterion"
      >
        <summary>
          <span>{{ criterion.title }}</span
          ><small :class="'criterion-' + criterion.status">{{
            labels[criterion.status]
          }}</small>
        </summary>
        <p>{{ criterion.reason }}</p>
        <p v-if="criterion.points !== null">
          <strong>Pontuação do critério: {{ criterion.points }}/100.</strong>
        </p>
        <p v-if="criterion.pendingEvidence" class="notice banner">
          {{ criterion.pendingEvidence }}
        </p>
        <p v-for="basis in criterion.companyBasis" :key="basis">
          <strong>Base empresarial:</strong> {{ basis }}
        </p>
        <blockquote
          v-for="(reference, index) in criterion.evidence"
          :key="index"
        >
          {{ reference.excerpt
          }}<button
            class="text-button"
            @click="emit('evidence', reference.documentId, reference.page)"
          >
            Conferir evidência · página {{ reference.page }}
          </button>
        </blockquote>
      </details>
    </article>
    <small class="muted"
      >Cálculo v2: integral = 100; parcial = 50; incompatibilidade demonstrada =
      0. Pendência não recebe nota. Cada dimensão reparte seu peso igualmente
      entre os critérios. A nota geral só é emitida com todos os critérios
      avaliados.</small
    >
  </section>
</template>
