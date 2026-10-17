<script setup lang="ts">
import type { HealthStatus, ReadingStatus } from '~/types/mock'
import { healthIcon, readingIcon, statusColor } from '~/utils/presentation'

defineProps<{
  health: HealthStatus
  reading: ReadingStatus
}>()
</script>

<template>
  <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
    <div class="flex min-w-0 items-center gap-2">
      <span class="shrink-0 text-xs text-muted">Health</span>
      <StatusBadge :label="health" :icon="healthIcon(health)" :color="statusColor(health)" />
    </div>
    <div class="flex min-w-0 items-center gap-2">
      <span class="shrink-0 text-xs text-muted">Reading</span>
      <StatusBadge :label="reading" :icon="readingIcon(reading)" :color="statusColor(reading)" />
    </div>
  </div>
</template>
