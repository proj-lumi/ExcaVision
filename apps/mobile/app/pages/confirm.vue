<script setup lang="ts">
import type { EmailOtpType } from "@supabase/supabase-js";

definePageMeta({ layout: "auth" });
useSeoMeta({ title: "Confirming link" });

const route = useRoute();
const supabase = useSupabaseClient();
const error = ref("");
const processing = ref(true);

function safeNext(value: unknown) {
  return value === "/reset-password" ? "/reset-password" : "/";
}

onMounted(async () => {
  const tokenHash = typeof route.query.token_hash === "string" ? route.query.token_hash : "";
  const type = typeof route.query.type === "string" ? route.query.type as EmailOtpType : null;
  const code = typeof route.query.code === "string" ? route.query.code : "";
  const next = safeNext(route.query.next);
  const result = tokenHash && type
    ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
    : code
      ? await supabase.auth.exchangeCodeForSession(code)
      : { error: new Error("This link is missing its verification code.") };
  if (result.error) error.value = "This link is invalid or has expired. Request a new one.";
  else await navigateTo(next, { replace: true });
  processing.value = false;
});
</script>

<template>
  <div class="grid gap-4 text-center">
    <div v-if="processing"><h1 class="text-lg font-semibold text-highlighted">Confirming link…</h1><p class="text-sm text-muted">Please wait.</p></div>
    <div v-else-if="error"><h1 class="text-lg font-semibold text-highlighted">Link unavailable</h1><p class="text-sm text-error">{{ error }}</p><NuxtLink to="/forgot-password" class="text-sm font-medium text-primary hover:text-primary/75">Request a new reset link</NuxtLink></div>
  </div>
</template>
