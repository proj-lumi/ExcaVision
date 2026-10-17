<script setup lang="ts">
defineProps<{
  clearVisible?: boolean
}>()

defineEmits<{
  clear: []
}>()
</script>

<template>
  <div class="sticky top-16 z-10 mt-3 flex w-full max-w-full justify-start rounded-lg border border-accented bg-muted/95 px-2 py-2 backdrop-blur" aria-label="Filters">
    <div class="flex w-full max-w-full flex-wrap items-center justify-start gap-1.5 sm:flex-nowrap">
      <slot />
      <UButton
        v-if="clearVisible"
        color="neutral"
        variant="ghost"
        size="sm"
        icon="i-lucide-filter-x"
        label="Clear filters"
        class="shrink-0 hover:bg-primary/10 hover:text-primary"
        @click="$emit('clear')"
      />
    </div>
  </div>
</template>
