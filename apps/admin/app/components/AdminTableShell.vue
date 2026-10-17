<template>
  <div class="overflow-hidden rounded-lg bg-elevated ring ring-accented dark:ring-2 dark:ring-slate-600/80">
    <div v-if="$slots.toolbar" class="border-b border-default p-2.5"><slot name="toolbar" /></div>
    <div class="w-full overflow-x-auto"><slot /></div>
    <div v-if="$slots.footer" class="flex items-center justify-between gap-3 border-t border-default px-3 py-2 text-xs text-muted"><slot name="footer" /></div>
  </div>
</template>
