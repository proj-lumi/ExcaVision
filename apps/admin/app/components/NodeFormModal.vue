<script setup lang="ts">
const props = defineProps<{ unitId: string }>();
const isOpen = defineModel<boolean>("open", { default: false });
const emit = defineEmits<{ saved: [] }>();
const { data, assignNode } = useAdminStore();
const toast = useAppToast();
const selectedNodeId = ref("");
const saving = ref(false);
const unit = computed(() => data.value.units.find((item) => item.id === props.unitId && !item.archived_at));
const unassignedNodes = computed(() => data.value.nodes.filter((node) => node.status === "unassigned"));
const nodeItems = computed(() => unassignedNodes.value.map((node) => ({ label: node.mac_address, value: node.id })));
const nextPosition = computed(() => data.value.nodes.filter((node) => node.unit_id === props.unitId && node.status === "assigned").length + 1);

watch(isOpen, (open) => {
  if (open) selectedNodeId.value = "";
});

async function save() {
  if (saving.value || !selectedNodeId.value) return;
  saving.value = true;
  try {
    const result = await assignNode(selectedNodeId.value, props.unitId);
    if (!result.ok) {
      toast.add({ title: "Node not assigned", description: result.message, color: "error" });
      return;
    }
    isOpen.value = false;
    emit("saved");
    toast.add({ title: "Node assigned", color: "success" });
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <UModal v-model:open="isOpen" title="Assign node">
    <template #body>
      <div class="grid gap-4">
        <div class="grid grid-cols-2 gap-3 rounded-md border-s-2 border-primary bg-primary/5 px-3 py-2 text-sm">
          <div><span class="block text-xs text-muted">Unit</span><span class="text-highlighted">{{ unit?.name }}</span></div>
          <div><span class="block text-xs text-muted">Position</span><span class="text-highlighted">Node {{ nextPosition }}</span></div>
        </div>
        <UFormField v-if="unassignedNodes.length" label="Unassigned node" required>
          <USelect
            v-model="selectedNodeId"
            :items="nodeItems"
            value-key="value"
            placeholder="Select a node"
            size="xl"
            class="w-full hover:bg-primary/10 focus-within:ring-primary/60"
            :ui="{ item: 'data-highlighted:not-data-disabled:before:bg-primary/10 data-highlighted:not-data-disabled:text-primary' }"
          />
        </UFormField>
        <UEmpty v-else icon="i-lucide-cpu" title="No unassigned nodes" class="min-h-36" />
      </div>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="outline" label="Cancel" class="admin-accent-control min-h-12" :disabled="saving" @click="isOpen = false" />
        <UButton :label="saving ? 'Assigning…' : 'Assign'" :loading="saving" :disabled="!selectedNodeId || saving" class="min-h-12" @click="save" />
      </div>
    </template>
  </UModal>
</template>
