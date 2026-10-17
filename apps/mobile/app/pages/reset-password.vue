<script setup lang="ts">
definePageMeta({ layout: "auth" });
useSeoMeta({ title: "Reset password" });

const supabase = useSupabaseClient();
const newPassword = ref("");
const confirmPassword = ref("");
const error = ref("");
const submitting = ref(false);
const showPassword = ref(false);
const showConfirmPassword = ref(false);
const ready = ref(false);
const complete = ref(false);
const canSubmit = computed(() => newPassword.value.length >= 8 && newPassword.value === confirmPassword.value);

onMounted(async () => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) error.value = "This reset link is invalid or has expired.";
  else ready.value = true;
});

async function updatePassword() {
  if (submitting.value || !canSubmit.value) return;
  error.value = "";
  submitting.value = true;
  const { error: updateError } = await supabase.auth.updateUser({ password: newPassword.value });
  submitting.value = false;
  if (updateError) { error.value = updateError.message; return; }
  complete.value = true;
}
</script>

<template>
  <div v-if="complete" class="grid gap-4 text-center">
    <h1 class="text-lg font-semibold text-highlighted">Password updated</h1>
    <p class="text-sm text-muted">Password updated.</p>
    <NuxtLink to="/login" class="text-sm font-medium text-primary hover:text-primary/75">Back to login</NuxtLink>
  </div>
  <form v-else-if="ready" class="grid gap-4" @submit.prevent="updatePassword">
    <div><h1 class="text-lg font-semibold text-highlighted">Set a new password</h1><p class="mt-1 text-sm text-muted">8 characters minimum.</p></div>
    <UFormField label="New password" required><UInput v-model="newPassword" :type="showPassword ? 'text' : 'password'" autocomplete="new-password" size="lg" class="w-full"><template #trailing><UButton type="button" color="neutral" variant="ghost" size="xs" square :icon="showPassword ? 'i-lucide-eye-off' : 'i-lucide-eye'" :aria-label="showPassword ? 'Hide password' : 'Show password'" :title="showPassword ? 'Hide password' : 'Show password'" @click="showPassword = !showPassword" /></template></UInput></UFormField>
    <UFormField label="Confirm password" required :error="confirmPassword.length > 0 && newPassword !== confirmPassword ? 'Passwords do not match.' : undefined"><UInput v-model="confirmPassword" :type="showConfirmPassword ? 'text' : 'password'" autocomplete="new-password" size="lg" class="w-full"><template #trailing><UButton type="button" color="neutral" variant="ghost" size="xs" square :icon="showConfirmPassword ? 'i-lucide-eye-off' : 'i-lucide-eye'" :aria-label="showConfirmPassword ? 'Hide confirmation password' : 'Show confirmation password'" :title="showConfirmPassword ? 'Hide confirmation password' : 'Show confirmation password'" @click="showConfirmPassword = !showConfirmPassword" /></template></UInput></UFormField>
    <p v-if="error" role="alert" class="text-sm text-error">{{ error }}</p>
    <UButton type="submit" block size="lg" :label="submitting ? 'Updating…' : 'Update'" :loading="submitting" :disabled="!canSubmit || submitting" />
  </form>
  <div v-else class="grid gap-4 text-center"><h1 class="text-lg font-semibold text-highlighted">Link unavailable</h1><p class="text-sm text-error">{{ error || "Checking your reset link…" }}</p><NuxtLink v-if="error" to="/forgot-password" class="text-sm font-medium text-primary hover:text-primary/75">Request link</NuxtLink></div>
</template>
