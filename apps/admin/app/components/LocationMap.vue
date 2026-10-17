<script setup lang="ts">
const props = defineProps<{ latitude: number; longitude: number; label: string }>();
const embedUrl = computed(() => {
  const delta = 0.008;
  const bbox = [props.longitude - delta, props.latitude - delta, props.longitude + delta, props.latitude + delta].join(",");
  return `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${props.latitude}%2C${props.longitude}`;
});

function openInMaps() {
  if (!import.meta.client) return;
  const userAgent = navigator.userAgent;
  const encodedLabel = encodeURIComponent(props.label);
  const coordinates = `${props.latitude},${props.longitude}`;
  if (/Android/i.test(userAgent)) {
    window.location.href = `geo:0,0?q=${coordinates}(${encodedLabel})`;
    return;
  }
  if (/iPhone|iPad|iPod|Macintosh/i.test(userAgent)) {
    window.location.href = `https://maps.apple.com/?ll=${coordinates}&q=${encodedLabel}`;
    return;
  }
  window.open(`https://www.openstreetmap.org/?mlat=${props.latitude}&mlon=${props.longitude}#map=16/${props.latitude}/${props.longitude}`, "_blank", "noopener,noreferrer");
}
</script>

<template>
  <div class="w-full min-w-0 max-w-full overflow-x-hidden rounded-lg bg-default ring ring-default">
    <iframe :src="embedUrl" :title="`Pinned location for ${label}`" loading="lazy" class="block h-64 w-full max-w-full border-0" />
    <div class="flex min-w-0 max-w-full flex-col gap-3 border-t border-default p-3 sm:flex-row sm:items-center sm:justify-between"><div class="w-full min-w-0 max-w-full flex-1 sm:w-0"><p class="max-w-full break-words text-sm font-medium text-highlighted">{{ label }}</p><p class="mt-1 max-w-full break-words text-xs tabular-nums text-muted">{{ latitude.toFixed(5) }}, {{ longitude.toFixed(5) }} · OpenStreetMap</p></div><UButton color="neutral" variant="outline" size="sm" icon="i-lucide-navigation" label="Maps" class="admin-accent-control shrink-0" @click="openInMaps" /></div>
  </div>
</template>
