<script setup lang="ts">
const props = withDefaults(defineProps<{
  count: number
  noun: string
  qualifier?: string
  secondaryCount?: number
  secondaryLabel?: string
}>(), {
  qualifier: '',
  secondaryLabel: ''
})

const primaryLabel = computed(() => `${props.count} ${props.qualifier ? `${props.qualifier} ` : ''}${props.count === 1 ? props.noun : `${props.noun}s`}`)
</script>

<template>
  <span class="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
    <span>{{ primaryLabel }}</span>
    <span v-if="secondaryCount !== undefined" class="font-normal text-muted">· {{ secondaryCount }} {{ secondaryLabel }}</span>
  </span>
</template>
