<script setup lang="ts">
import type { ServiceRequest } from "~/types/mock";

const props = defineProps<{ request: ServiceRequest | null }>();
const isOpen = defineModel<boolean>("open", { default: false });
const emit = defineEmits<{ created: [siteSlug: string] }>();
const { createSiteFromRequest } = useAdminStore();
const toast = useAppToast();
const siteName = ref("");
const nameError = ref("");
const saving = ref(false);
const sourceError = computed(() => {
  const request = props.request;
  if (!request) return "Request data is unavailable.";
  if (!validName(request.requester_name)) return "The request has no valid contact name.";
  if (!EMAIL_PATTERN.test(request.contact_email.trim())) return "The request has an invalid email address.";
  if (!PH_PHONE_PATTERN.test(normalizedPhone(request.contact_phone))) return "The request has an invalid Philippine phone number.";
  if (!validPhilippinesCoordinates(request.latitude, request.longitude)) return "The request coordinates are outside the Philippines.";
  return "";
});

watch(isOpen, (open) => { if (open) { siteName.value = props.request?.site_name ?? ""; nameError.value = ""; } });
async function save() {
  if (saving.value) return;
  nameError.value = validName(siteName.value) ? "" : "Enter a site name from 1 to 80 characters.";
  if (nameError.value || sourceError.value || !props.request) return;
  saving.value = true;
  try {
    const result = await createSiteFromRequest(props.request.id, siteName.value);
    if (!result.ok || !result.value) { toast.add({ title: "Site not created", description: result.ok ? "Site data is unavailable." : result.message, color: "error" }); return; }
    isOpen.value = false;
    toast.add({ title: "Site created", color: "success" });
    emit("created", result.value.slug);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <UModal v-model:open="isOpen" title="Create site" :description="request?.site_name">
    <template #body><div v-if="request" class="grid gap-4"><UAlert v-if="sourceError" color="error" variant="subtle" icon="i-lucide-circle-alert" title="Request information needs correction" :description="sourceError" /><UFormField label="Site name" required :error="nameError || undefined"><UInput v-model="siteName" maxlength="80" size="xl" class="w-full hover:bg-primary/10 focus-within:ring-primary/60" /></UFormField><div class="grid gap-3 rounded-md bg-default p-3 text-sm ring ring-default sm:grid-cols-2"><div><span class="block text-xs text-muted">Contact</span><span class="text-highlighted">{{ request.requester_name }}</span><span class="block text-muted">{{ request.contact_email }} · {{ request.contact_phone }}</span></div><div><span class="block text-xs text-muted">Company</span><span class="text-highlighted">{{ request.company_name || "Not provided" }}</span></div><div class="sm:col-span-2"><span class="block text-xs text-muted">Location</span><span class="text-highlighted">{{ request.address_label }}</span><span class="block tabular-nums text-muted">{{ request.latitude.toFixed(5) }}, {{ request.longitude.toFixed(5) }}</span></div></div></div></template>
    <template #footer><div class="flex w-full justify-end gap-2"><UButton color="neutral" variant="outline" label="Cancel" class="admin-accent-control min-h-12" :disabled="saving" @click="isOpen = false" /><UButton :label="saving ? 'Creating site…' : 'Create site'" :loading="saving" :disabled="Boolean(sourceError) || saving" class="min-h-12" @click="save" /></div></template>
  </UModal>
</template>
