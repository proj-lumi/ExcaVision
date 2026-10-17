<script setup lang="ts">
defineProps<{
  clearVisible?: boolean;
}>();

defineEmits<{ clear: [] }>();
</script>

<template>
  <div class="flex w-full min-w-0 rounded-lg border border-accented bg-muted/95 px-2 py-2" aria-label="Filters">
    <div class="flex w-full min-w-0 flex-wrap items-center gap-1.5 sm:flex-nowrap">
      <slot />
      <UButton v-if="clearVisible" color="neutral" variant="ghost" size="sm" icon="i-lucide-filter-x" label="Clear" class="admin-accent-control shrink-0" @click="$emit('clear')" />
    </div>
  </div>
</template>
