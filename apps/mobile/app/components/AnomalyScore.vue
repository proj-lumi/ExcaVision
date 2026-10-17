<script setup lang="ts">
const props = defineProps<{
  score: number
}>()

const radius = 24
const circumference = 2 * Math.PI * radius
const normalizedScore = computed(() => Math.max(0, Math.min(1, props.score)))
const percentage = computed(() => Math.round(normalizedScore.value * 100))
const dashOffset = computed(() => circumference * (1 - normalizedScore.value))
</script>

<template>
  <div class="flex min-w-0 items-center gap-3" role="img" :aria-label="`How unusual this reading is: ${percentage} percent`">
    <div class="relative size-16 shrink-0">
      <svg viewBox="0 0 64 64" class="size-full -rotate-90" aria-hidden="true">
        <circle cx="32" cy="32" :r="radius" fill="none" stroke="currentColor" stroke-width="5" class="text-warning/20" />
        <circle
          cx="32"
          cy="32"
          :r="radius"
          fill="none"
          stroke="currentColor"
          stroke-width="5"
          stroke-linecap="round"
          class="text-warning"
          :stroke-dasharray="circumference"
          :stroke-dashoffset="dashOffset"
        />
      </svg>
      <strong class="absolute inset-0 grid place-items-center font-mono text-sm font-semibold tabular-nums text-warning">
        {{ percentage }}%
      </strong>
    </div>
    <div class="min-w-0">
      <p class="text-xs font-medium text-muted">How unusual</p>
      <p class="mt-1 text-sm font-medium text-highlighted">Above normal</p>
    </div>
  </div>
</template>
