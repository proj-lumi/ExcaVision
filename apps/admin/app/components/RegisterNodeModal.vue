<script setup lang="ts">
const props = defineProps<{ unitId?: string }>();
const isOpen = defineModel<boolean>("open", { default: false });
const emit = defineEmits<{ saved: [] }>();
const { registerNode, assignNode } = useAdminStore();
const toast = useAppToast();
const mac = ref("");
const error = ref("");
const saved = ref(false);
const saving = ref(false);

watch(isOpen, (open) => {
  if (!open) return;
  mac.value = "";
  error.value = "";
  saved.value = false;
});

function normalize() {
  mac.value = normalizedMac(mac.value);
}

async function save() {
  if (saving.value) return;
  normalize();
  error.value = MAC_PATTERN.test(mac.value) ? "" : "Enter a valid Mac address.";
  if (error.value) return;
  saving.value = true;
  try {
    const result = await registerNode(mac.value);
    if (!result.ok) {
      error.value = result.message;
      return;
    }
    if (props.unitId && result.value?.node?.id) {
      const assigned = await assignNode(result.value.node.id, props.unitId);
      if (!assigned.ok) {
        error.value = `Node registered, but could not be assigned: ${assigned.message}`;
        return;
      }
    }
    saved.value = true;
    emit("saved");
    toast.add({ title: props.unitId ? "Node added" : "Node registered", color: "success" });
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <UModal v-model:open="isOpen" :title="props.unitId ? 'Register and assign node' : 'Register node'">
    <template #body>
      <UFormField v-if="!saved" label="MAC address" required :error="error || undefined">
        <UInput v-model="mac" maxlength="17" placeholder="4C:C3:82:C4:58:9C" size="lg" class="w-full" @blur="normalize" />
      </UFormField>
      <UAlert v-else color="success" variant="subtle" icon="i-lucide-circle-check" title="Registered" description="No device key is needed." />
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="outline" :label="saved ? 'Close' : 'Cancel'" class="admin-accent-control min-h-12" :disabled="saving" @click="isOpen = false" />
        <UButton v-if="!saved" :label="saving ? 'Saving…' : 'Register'" :loading="saving" :disabled="saving" class="min-h-12" @click="save" />
      </div>
    </template>
  </UModal>
</template>
