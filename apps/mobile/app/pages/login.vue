<script setup lang="ts">
definePageMeta({ layout: "auth" });
useSeoMeta({ title: "Log in" });

const supabase = useSupabaseClient();
const email = ref("");
const password = ref("");
const error = ref("");
const submitting = ref(false);
const showPassword = ref(false);
const landingUrl = useRuntimeConfig().public.landingUrl;

async function submitLogin() {
  if (submitting.value) return;
  error.value = "";
  if (!email.value.trim() || !password.value) { error.value = "Enter your email and password."; return; }
  submitting.value = true;
  const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.value.trim(), password: password.value });
  submitting.value = false;
  if (signInError) { error.value = signInError.message; return; }
  await navigateTo("/", { replace: true });
}
</script>

<template>
  <form class="grid gap-4" @submit.prevent="submitLogin">
    <h1 class="text-lg font-semibold text-highlighted">Customer login</h1>
    <UFormField label="Email" required><UInput v-model="email" type="email" autocomplete="email" placeholder="you@example.com" size="lg" class="w-full" /></UFormField>
    <UFormField label="Password" required><UInput v-model="password" :type="showPassword ? 'text' : 'password'" autocomplete="current-password" placeholder="Password" size="lg" class="w-full"><template #trailing><UButton type="button" color="neutral" variant="ghost" size="xs" square :icon="showPassword ? 'i-lucide-eye-off' : 'i-lucide-eye'" :aria-label="showPassword ? 'Hide password' : 'Show password'" :title="showPassword ? 'Hide password' : 'Show password'" @click="showPassword = !showPassword" /></template></UInput></UFormField>
    <NuxtLink to="/forgot-password" class="text-right text-sm font-medium text-primary hover:text-primary/75">Forgot password?</NuxtLink>
    <p v-if="error" role="alert" class="text-sm text-error">{{ error }}</p>
    <UButton type="submit" block size="lg" :label="submitting ? 'Signing in…' : 'Log in'" :loading="submitting" :disabled="submitting" />
    <a :href="`${landingUrl}/#request`" class="text-center text-sm font-medium text-primary hover:text-primary/75">Request installation</a>
  </form>
</template>
