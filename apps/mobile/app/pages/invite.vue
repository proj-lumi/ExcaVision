<script setup lang="ts">
definePageMeta({ layout: "auth" });
useSeoMeta({ title: "Set up your account" });

const supabase = useSupabaseClient();
const route = useRoute();
const router = useRouter();

const email = ref(typeof route.query.email === "string" ? route.query.email : "");
const tokenHash = ref(typeof route.query.token_hash === "string" ? route.query.token_hash : "");
const accessToken = ref(typeof route.query.access_token === "string" ? route.query.access_token : "");
const refreshToken = ref(typeof route.query.refresh_token === "string" ? route.query.refresh_token : "");
const password = ref("");
const confirmPassword = ref("");
const error = ref("");
const submitting = ref(false);
const showPassword = ref(false);
const showConfirmPassword = ref(false);
const stage = ref<"verify" | "collect-email" | "set-password" | "invalid">("invalid");

onMounted(() => {
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  accessToken.value ||= hashParams.get("access_token") ?? "";
  refreshToken.value ||= hashParams.get("refresh_token") ?? "";
  tokenHash.value ||= hashParams.get("token_hash") ?? "";
  email.value ||= hashParams.get("email") ?? "";

  if (accessToken.value && refreshToken.value) stage.value = "verify";
  else if (tokenHash.value) stage.value = email.value ? "verify" : "collect-email";
  else stage.value = "invalid";
  if (stage.value === "verify") void verifyToken();
});

async function verifyToken() {
  submitting.value = true;
  error.value = "";
  const result = accessToken.value && refreshToken.value
    ? await supabase.auth.setSession({ access_token: accessToken.value, refresh_token: refreshToken.value })
    : await supabase.auth.verifyOtp({ type: "invite", email: email.value.trim(), token_hash: tokenHash.value });
  submitting.value = false;
  if (result.error) {
    error.value = result.error.message;
    stage.value = tokenHash.value ? "collect-email" : "invalid";
    return;
  }
  stage.value = "set-password";
  await router.replace("/invite");
}

async function activate() {
  if (password.value.length < 8) { error.value = "Use at least 8 characters."; return; }
  if (password.value !== confirmPassword.value) { error.value = "Passwords do not match."; return; }
  submitting.value = true;
  error.value = "";
  const { error: passwordError } = await supabase.auth.updateUser({ password: password.value });
  if (passwordError) { error.value = passwordError.message; submitting.value = false; return; }
  const { error: activateError } = await supabase.rpc("activate_customer");
  submitting.value = false;
  if (activateError) { error.value = activateError.message; return; }
  stage.value = "verify";
  await router.replace("/");
}
</script>

<template>
  <div class="grid gap-6">
    <UAlert v-if="stage === 'invalid'" color="error" variant="subtle" icon="i-lucide-circle-alert" title="Invalid invitation link" description="Ask an ExcaVision administrator to resend your invitation." />

    <div v-else-if="stage === 'verify'" class="grid place-items-center gap-3 py-6 text-center">
      <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-primary" />
      <p class="text-sm text-muted">Verifying your invitation…</p>
    </div>

    <form v-else-if="stage === 'collect-email'" class="grid gap-5" @submit.prevent="verifyToken">
      <div>
        <h1 class="text-lg font-semibold text-highlighted">Confirm your email</h1>
        <p class="mt-1 text-sm text-muted">Enter the email address this invitation was sent to.</p>
      </div>
      <UFormField label="Email" required>
        <UInput v-model="email" type="email" autocomplete="email" placeholder="you@example.com" size="xl" class="w-full" />
      </UFormField>
      <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-circle-alert" :description="error" />
      <UButton type="submit" block size="xl" label="Verify" :loading="submitting" class="min-h-12" :disabled="!email.trim()" />
    </form>

    <form v-else class="grid gap-5" @submit.prevent="activate">
      <div>
        <h1 class="text-lg font-semibold text-highlighted">Create your password</h1>
        <p class="mt-1 text-sm text-muted">Set a password to finish activating your account.</p>
      </div>
      <UFormField label="Password" required help="Use at least 8 characters.">
        <UInput v-model="password" :type="showPassword ? 'text' : 'password'" autocomplete="new-password" placeholder="Create a password" size="xl" class="w-full"><template #trailing><UButton type="button" color="neutral" variant="ghost" size="xs" square :icon="showPassword ? 'i-lucide-eye-off' : 'i-lucide-eye'" :aria-label="showPassword ? 'Hide password' : 'Show password'" :title="showPassword ? 'Hide password' : 'Show password'" @click="showPassword = !showPassword" /></template></UInput>
      </UFormField>
      <UFormField label="Confirm password" required :error="confirmPassword.length > 0 && password !== confirmPassword ? 'Passwords do not match.' : undefined">
        <UInput v-model="confirmPassword" :type="showConfirmPassword ? 'text' : 'password'" autocomplete="new-password" placeholder="Re-enter your password" size="xl" class="w-full"><template #trailing><UButton type="button" color="neutral" variant="ghost" size="xs" square :icon="showConfirmPassword ? 'i-lucide-eye-off' : 'i-lucide-eye'" :aria-label="showConfirmPassword ? 'Hide confirmation password' : 'Show confirmation password'" :title="showConfirmPassword ? 'Hide confirmation password' : 'Show confirmation password'" @click="showConfirmPassword = !showConfirmPassword" /></template></UInput>
      </UFormField>
      <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-circle-alert" :description="error" />
      <UButton type="submit" block size="xl" label="Activate" :loading="submitting" class="min-h-12" :disabled="!password.length || !confirmPassword.length" />
    </form>
  </div>
</template>
