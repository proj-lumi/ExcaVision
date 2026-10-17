<script setup lang="ts">
import type { Site } from "~/types/mock";

const props = withDefaults(defineProps<{ site: Site | null; successToast?: boolean }>(), { successToast: true });
const emit = defineEmits<{ sent: [] }>();
const isOpen = defineModel<boolean>("open", { default: false });
const { data, inviteCustomer } = useAdminStore();
const toast = useAppToast();
const sent = ref(false);
const sending = ref(false);
const localInboxUrl = ref("");
const form = reactive({ full_name: "", email: "", phone: "", company_name: "" });
const errors = reactive({ full_name: "", email: "", phone: "" });
const customer = computed(() => data.value.profiles.find((profile) => profile.id === props.site?.customer_id));
const sourceRequest = computed(() => data.value.service_requests.find((request) => request.id === props.site?.source_request_id));
const activated = computed(() => props.site?.invitation_status === "activated");

watch(isOpen, (open) => {
  if (!open || !props.site) return;
  Object.assign(form, {
    full_name: customer.value?.full_name ?? sourceRequest.value?.requester_name ?? "",
    email: customer.value?.email ?? sourceRequest.value?.contact_email ?? "",
    phone: customer.value?.phone ?? sourceRequest.value?.contact_phone ?? "",
    company_name: customer.value?.company_name ?? sourceRequest.value?.company_name ?? props.site.company_name,
  });
  Object.assign(errors, { full_name: "", email: "", phone: "" });
  sent.value = false;
  localInboxUrl.value = "";
});
async function save() {
  if (sending.value) return;
  if (activated.value) { toast.add({ title: "Invitation unavailable", description: "This customer has already activated their account.", color: "error" }); return; }
  Object.assign(errors, { full_name: "", email: "", phone: "" });
  const phone = normalizedPhone(form.phone);
  form.phone = phone;
  if (!validName(form.full_name)) errors.full_name = "Enter a name from 1 to 80 characters.";
  if (!EMAIL_PATTERN.test(form.email.trim())) errors.email = "Enter a valid email address.";
  if (!PH_PHONE_PATTERN.test(phone)) errors.phone = "Use an 11-digit Philippine mobile number beginning with 09.";
  if (Object.values(errors).some(Boolean) || !props.site) return;
  sending.value = true;
  try {
    const result = await inviteCustomer(props.site.id, {
      full_name: form.full_name.trim(),
      email: form.email.trim().toLowerCase(),
      phone,
      company_name: form.company_name.trim(),
    });
    if (!result.ok) { toast.add({ title: "Invitation not sent", description: result.message, color: "error" }); return; }
    sent.value = true;
    localInboxUrl.value = result.value?.local_inbox_url ?? "";
    if (props.successToast) toast.add({ title: "Invitation sent", description: `Access was linked to ${form.email.trim().toLowerCase()}.`, color: "success" });
    emit("sent");
  } finally {
    sending.value = false;
  }
}
</script>

<template>
  <UModal v-model:open="isOpen" :title="activated ? 'Account activated' : sent ? 'Invitation ready' : site?.invitation_status === 'invited' ? 'Resend invitation' : 'Invite user'" :description="site?.name">
    <template #body><UAlert v-if="activated" color="success" variant="subtle" icon="i-lucide-user-check" title="Customer account activated" description="This customer has set their password credentials and cannot be reinvited." /><div v-else-if="sent" class="grid gap-3"><UAlert color="success" variant="subtle" icon="i-lucide-mail-check" title="Invitation sent" :description="`${form.email} is linked to ${site?.name}.`" /><UButton v-if="localInboxUrl" :to="localInboxUrl" target="_blank" color="neutral" variant="outline" icon="i-lucide-mail-open" label="Inbox" class="admin-accent-control justify-self-start" /></div><div v-else class="grid gap-4"><div class="rounded-md border-s-2 border-primary bg-primary/5 px-3 py-2 text-sm"><span class="block text-xs text-muted">Site</span><span class="text-highlighted">{{ site?.name }}</span></div><UFormField label="Full name" required :error="errors.full_name || undefined"><UInput v-model="form.full_name" maxlength="80" placeholder="Enter full name" size="lg" class="w-full" /></UFormField><UFormField label="Company (Optional)"><UInput v-model="form.company_name" maxlength="120" placeholder="Enter company name" size="lg" class="w-full" /></UFormField><UFormField label="Email" required :error="errors.email || undefined"><UInput v-model="form.email" type="email" placeholder="you@example.com" size="lg" class="w-full" /></UFormField><UFormField label="Phone" required :error="errors.phone || undefined"><UInput v-model="form.phone" inputmode="numeric" maxlength="11" placeholder="09xxxxxxxxx" size="lg" class="w-full" /></UFormField></div></template>
    <template #footer><div class="flex w-full justify-end gap-2"><UButton v-if="activated" label="Done" class="min-h-12" @click="isOpen = false" /><UButton v-else-if="!sent" color="neutral" variant="outline" label="Cancel" class="admin-accent-control min-h-12" :disabled="sending" @click="isOpen = false" /><UButton v-if="!activated && !sent" icon="i-lucide-send" :label="sending ? 'Sending…' : site?.invitation_status === 'invited' ? 'Resend' : 'Send'" :loading="sending" :disabled="sending" class="min-h-12" @click="save" /><UButton v-if="!activated && sent" label="Done" class="min-h-12" @click="isOpen = false" /></div></template>
  </UModal>
</template>
