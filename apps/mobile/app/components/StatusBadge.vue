<script setup lang="ts">
import type { StatusColor } from '~/utils/presentation'

withDefaults(defineProps<{
  label: string
  icon: string
  color?: StatusColor
}>(), {
  color: 'neutral'
})
</script>

<template>
  <UBadge :color="color" variant="subtle" class="w-fit shrink-0 justify-self-start gap-1.5">
    <UIcon :name="icon" class="size-3.5" />
    {{ label }}
  </UBadge>
</template>
