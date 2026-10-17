<script setup lang="ts">
withDefaults(defineProps<{ rows?: number }>(), { rows: 5 });
</script>

<template>
  <div class="min-h-64 min-w-[720px]" aria-label="Loading records" aria-busy="true">
    <div class="grid grid-cols-[1.2fr_1fr_1.4fr_.7fr_7rem] gap-4 bg-default px-4 py-3"><USkeleton v-for="column in 5" :key="column" class="h-3 w-20" /></div>
    <div class="divide-y divide-default"><div v-for="row in rows" :key="row" class="grid min-h-16 grid-cols-[1.2fr_1fr_1.4fr_.7fr_7rem] items-center gap-4 px-4 py-3"><div class="space-y-2"><USkeleton class="h-4 w-32" /><USkeleton class="h-3 w-20" /></div><USkeleton class="h-4 w-28" /><USkeleton class="h-4 w-44" /><USkeleton class="h-6 w-20 rounded-full" /><div class="flex justify-end gap-2"><USkeleton class="size-10" /><USkeleton class="size-10" /></div></div></div>
  </div>
</template>
