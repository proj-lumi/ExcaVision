<script setup lang="ts">
definePageMeta({ layout: "auth" });
useSeoMeta({ title: "Forgot password" });

const supabase = useSupabaseClient();
const email = ref("");
const error = ref("");
const submitting = ref(false);
const sent = ref(false);

async function requestReset() {
  if (submitting.value) return;
  error.value = "";
  if (!email.value.trim()) { error.value = "Enter your email address."; return; }
  submitting.value = true;
  const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.value.trim(), {
    redirectTo: `${window.location.origin}/confirm?next=/reset-password`,
  });
  submitting.value = false;
  if (resetError) { error.value = resetError.message; return; }
  sent.value = true;
}
</script>

<template>
  <div v-if="sent" class="grid gap-4">
    <h1 class="text-lg font-semibold text-highlighted">Check your email</h1>
    <p class="text-sm text-muted">Check your email if the account exists.</p>
    <NuxtLink to="/login" class="text-center text-sm font-medium text-primary hover:text-primary/75">Back to login</NuxtLink>
  </div>
  <form v-else class="grid gap-4" @submit.prevent="requestReset">
    <div><h1 class="text-lg font-semibold text-highlighted">Forgot password?</h1><p class="mt-1 text-sm text-muted">Enter your email.</p></div>
    <UFormField label="Email" required><UInput v-model="email" type="email" autocomplete="email" placeholder="you@example.com" size="lg" class="w-full" /></UFormField>
    <p v-if="error" role="alert" class="text-sm text-error">{{ error }}</p>
    <UButton type="submit" block size="lg" :label="submitting ? 'Sending…' : 'Send'" :loading="submitting" :disabled="submitting" />
    <NuxtLink to="/login" class="text-center text-sm font-medium text-primary hover:text-primary/75">Back to login</NuxtLink>
  </form>
</template>
