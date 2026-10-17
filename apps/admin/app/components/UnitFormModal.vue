<script setup lang="ts">
const props = defineProps<{ siteId: string }>();
const isOpen = defineModel<boolean>("open", { default: false });
const emit = defineEmits<{ saved: [] }>();
const { data, addUnit } = useAdminStore();
const toast = useAppToast();
const form = reactive({ name: "" });
const errors = reactive({ name: "" });
const saving = ref(false);
const site = computed(() => data.value.sites.find((item) => item.id === props.siteId));

function reset() {
  Object.assign(form, { name: "" });
  errors.name = "";
}
watch(isOpen, (open) => { if (open) reset(); });
async function save() {
  if (saving.value) return;
  errors.name = "";
  if (!validName(form.name)) errors.name = "Enter a unit name from 1 to 80 characters.";
  else if (data.value.units.some((unit) => unit.site_id === props.siteId && !unit.archived_at && unit.name.trim().toLowerCase() === form.name.trim().toLowerCase())) errors.name = "Use a unique unit name within this site.";
  if (errors.name) return;
  saving.value = true;
  try {
    const result = await addUnit({ site_id: props.siteId, name: form.name.trim() });
    if (!result.ok) { toast.add({ title: "Unit not added", description: result.message, color: "error" }); return; }
    isOpen.value = false;
    emit("saved");
    toast.add({ title: "Unit added", color: "success" });
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <UModal v-model:open="isOpen" title="Add unit">
    <template #body><div class="grid gap-4"><div class="rounded-md border-s-2 border-primary bg-primary/5 px-3 py-2 text-sm text-highlighted"><span class="block text-xs text-muted">Site</span>{{ site?.name }}</div><UFormField label="Unit name" required :error="errors.name || undefined"><UInput v-model="form.name" maxlength="80" placeholder="Enter unit name" size="xl" class="w-full hover:bg-primary/10 focus-within:ring-primary/60" /></UFormField></div></template>
    <template #footer><div class="flex w-full justify-end gap-2"><UButton color="neutral" variant="outline" label="Cancel" class="admin-accent-control min-h-12" :disabled="saving" @click="isOpen = false" /><UButton :label="saving ? 'Adding unit…' : 'Add unit'" :loading="saving" :disabled="saving" class="min-h-12" @click="save" /></div></template>
  </UModal>
</template>
