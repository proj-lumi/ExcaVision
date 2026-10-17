<script setup lang="ts">
definePageMeta({ layout: "customer" });
useSeoMeta({ title: "Settings" });

const colorMode = useColorMode();
const preferences = useAccessibilityPreferences();
const { data, updateProfile } = useCustomerStore();
const { status: pushStatus, busy: pushBusy, refreshStatus: refreshPushStatus, enable: enablePush, disable: disablePush } = usePushNotifications();
const supabase = useSupabaseClient();
const toast = useAppToast();
const profileOpen = ref(false);
const passwordOpen = ref(false);
const profile = reactive({ full_name: "", email: "", phone: "", company_name: "" });
const profileErrors = reactive({ full_name: "", email: "", phone: "" });
const currentPassword = ref("");
const newPassword = ref("");
const confirmPassword = ref("");
const themeItems = [
  { label: "System", value: "system", icon: "i-lucide-monitor" },
  { label: "Light", value: "light", icon: "i-lucide-sun" },
  { label: "Dark", value: "dark", icon: "i-lucide-moon" },
];
const profileSaving = ref(false);
const passwordSaving = ref(false);
const loggingOut = ref(false);
const passwordVisibility = reactive({ current: false, next: false, confirm: false });
const passwordCanSubmit = computed(() => currentPassword.value.length > 0 && newPassword.value.length >= 8 && newPassword.value === confirmPassword.value);
const pushStatusLabel = computed(() => {
  // While the change is in flight the switch follows the operator's intent, and
  // the label says what is happening instead of showing a stale state.
  if (pushBusy.value) return pendingPush.value === false ? "Turning off…" : "Turning on…";
  return ({
    checking: "Checking…",
    unsupported: "Unsupported",
    blocked: "Blocked",
    disabled: "Off",
    enabled: "On",
    unavailable: "Unavailable",
  })[pushStatus.value];
});
const canChangePush = computed(() => !["checking", "unsupported", "unavailable", "blocked"].includes(pushStatus.value));
// Requested state, shown immediately: enabling asks the browser for permission
// and registers a subscription, which is not instant.
const pendingPush = ref<boolean | null>(null);
const pushSwitchValue = computed(() => pendingPush.value ?? pushStatus.value === "enabled");
function reconcilePushSubscription() { void refreshPushStatus(); }
onMounted(() => {
  reconcilePushSubscription();
  window.addEventListener("excavision-push-subscription-changed", reconcilePushSubscription);
});
onBeforeUnmount(() => window.removeEventListener("excavision-push-subscription-changed", reconcilePushSubscription));

function openProfile() {
  if (!data.value) return;
  Object.assign(profile, {
    full_name: data.value.profile.full_name,
    email: data.value.profile.email,
    phone: data.value.profile.phone,
    company_name: data.value.profile.company_name,
  });
  Object.assign(profileErrors, { full_name: "", email: "", phone: "" });
  profileOpen.value = true;
}
async function saveProfile() {
  if (profileSaving.value) return;
  profileErrors.full_name = profile.full_name.trim().length >= 1 && profile.full_name.trim().length <= 80 ? "" : "Enter a name from 1 to 80 characters.";
  profileErrors.email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email.trim()) ? "" : "Enter a valid email address.";
  profile.phone = profile.phone.replace(/\D/g, "");
  profileErrors.phone = /^09\d{9}$/.test(profile.phone) ? "" : "Use an 11-digit Philippine mobile number beginning with 09.";
  if (Object.values(profileErrors).some(Boolean)) return;
  profileSaving.value = true;
  try {
    const result = await updateProfile({
      full_name: profile.full_name.trim(),
      email: profile.email.trim().toLowerCase(),
      phone: profile.phone,
      company_name: profile.company_name.trim(),
    });
    if (!result.ok) {
      toast.add({ title: "Profile not saved", description: result.message, color: "error" });
      return;
    }
    profileOpen.value = false;
    toast.add({ title: "Profile saved", color: "success" });
  } finally {
    profileSaving.value = false;
  }
}
async function updatePushNotifications(enabled: boolean) {
  if (enabled === (pushStatus.value === "enabled")) return;
  pendingPush.value = enabled;
  try {
    const result = enabled ? await enablePush() : await disablePush();
    toast.add({ title: result.ok ? result.message : "Notifications not changed", description: result.ok ? undefined : result.message, color: result.ok ? "success" : "error" });
  } finally {
    // Drop the intent so the switch reflects the real subscription state again.
    pendingPush.value = null;
  }
}
async function logout() {
  if (loggingOut.value) return;
  loggingOut.value = true;
  try {
    await supabase.auth.signOut();
    await navigateTo("/login", { replace: true });
  } finally {
    loggingOut.value = false;
  }
}
async function savePassword() {
  if (passwordSaving.value || !passwordCanSubmit.value) return;
  passwordSaving.value = true;
  try {
    const { error: reauthError } = await supabase.auth.signInWithPassword({
      email: data.value?.profile.email ?? "",
      password: currentPassword.value,
    });
    if (reauthError) {
      toast.add({ title: "Password not changed", description: "Current password is incorrect.", color: "error" });
      return;
    }
    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword.value });
    if (updateError) {
      toast.add({ title: "Password not changed", description: updateError.message, color: "error" });
      return;
    }
    currentPassword.value = "";
    newPassword.value = "";
    confirmPassword.value = "";
    passwordOpen.value = false;
    toast.add({ title: "Password updated", color: "success" });
  } finally {
    passwordSaving.value = false;
  }
}
</script>

<template>
  <div class="settings-page">
    <h1 class="text-lg font-semibold text-highlighted">Settings</h1>
    <UCard class="settings-card">
      <template #header><h2 class="settings-card-title">Account</h2></template>
      <div v-if="data" class="settings-account">
        <p class="font-medium text-highlighted">{{ data.profile.full_name }}</p>
        <p class="text-muted">{{ data.profile.email }}</p>
      </div>
      <div>
        <button type="button" class="settings-row settings-action" @click="openProfile"><UIcon name="i-lucide-user-round" class="settings-icon" /><span class="settings-row-copy"><span class="settings-row-title">Profile</span><span class="settings-row-description">Name, company, phone</span></span><UIcon name="i-lucide-chevron-right" class="settings-row-end" /></button>
        <button type="button" class="settings-row settings-action" @click="passwordOpen = true"><UIcon name="i-lucide-lock-keyhole" class="settings-icon" /><span class="settings-row-copy"><span class="settings-row-title">Password</span><span class="settings-row-description">Change sign-in password</span></span><UIcon name="i-lucide-chevron-right" class="settings-row-end" /></button>
        <button type="button" class="settings-row settings-action" :disabled="loggingOut" :aria-busy="loggingOut" @click="logout"><UIcon :name="loggingOut ? 'i-lucide-loader-circle' : 'i-lucide-log-out'" class="settings-icon settings-icon-muted" :class="loggingOut ? 'animate-spin' : ''" /><span class="settings-row-copy"><span class="settings-row-title">{{ loggingOut ? "Logging out…" : "Log out" }}</span></span><UIcon name="i-lucide-chevron-right" class="settings-row-end" /></button>
      </div>
    </UCard>

    <UCard class="settings-card">
      <template #header><h2 class="settings-card-title">Monitoring alerts</h2></template>
      <div class="settings-row"><UIcon name="i-lucide-bell" class="settings-icon" /><span class="settings-row-copy"><span class="settings-row-title">Push notifications</span><span v-if="pushStatus === 'blocked'" class="settings-row-description">Allow notifications in your browser settings.</span></span><span v-if="pushStatus === 'blocked'" class="settings-row-status text-warning">Blocked</span><span v-else-if="!canChangePush" class="settings-row-status">{{ pushStatusLabel }}</span><USwitch v-else :model-value="pushSwitchValue" :loading="pushBusy" size="xl" :disabled="pushBusy" aria-label="Monitoring alerts" @update:model-value="updatePushNotifications" /></div>
    </UCard>

    <UCard v-if="data" class="settings-card">
      <template #header><h2 class="settings-card-title">Site</h2></template>
      <dl class="settings-info-list">
        <div><dt>Name</dt><dd>{{ data.site.name }}</dd></div>
        <div><dt>Address</dt><dd>{{ data.site.address_label }}</dd></div>
      </dl>
    </UCard>

    <UCard class="settings-card">
      <template #header><h2 class="settings-card-title">Preferences</h2></template>
      <div class="grid gap-3">
        <div><p class="mb-2 text-xs font-medium text-muted">Theme</p><div class="grid grid-cols-3 gap-2"><UButton v-for="theme in themeItems" :key="theme.value" :icon="theme.icon" :label="theme.label" :color="colorMode.preference === theme.value ? 'primary' : 'neutral'" :variant="colorMode.preference === theme.value ? 'soft' : 'outline'" size="sm" class="justify-center hover:bg-primary/10 hover:border-primary/60 hover:text-primary" @click="colorMode.preference = theme.value" /></div></div>
        <div class="settings-row"><UIcon name="i-lucide-maximize-2" class="settings-icon" /><span class="settings-row-copy"><span class="settings-row-title">Larger tilt readings</span></span><USwitch v-model="preferences.large_telemetry" size="xl" aria-label="Larger tilt readings" /></div>
        <div class="settings-row"><UIcon name="i-lucide-move" class="settings-icon" /><span class="settings-row-copy"><span class="settings-row-title">Reduce motion</span></span><USwitch v-model="preferences.reduce_motion" size="xl" aria-label="Reduce motion" /></div>
      </div>
    </UCard>

    <UModal v-model:open="profileOpen" title="Profile"><template #body><div class="grid gap-4"><UFormField label="Full name" required :error="profileErrors.full_name || undefined"><UInput v-model="profile.full_name" maxlength="80" placeholder="Enter full name" size="lg" class="w-full" /></UFormField><UFormField label="Company (Optional)"><UInput v-model="profile.company_name" maxlength="120" placeholder="Enter company name" size="lg" class="w-full" /></UFormField><UFormField label="Email"><UInput :model-value="profile.email" type="email" icon="i-lucide-lock-keyhole" disabled size="lg" class="w-full" /></UFormField><UFormField label="Phone" required :error="profileErrors.phone || undefined"><UInput v-model="profile.phone" inputmode="numeric" maxlength="11" placeholder="09xxxxxxxxx" size="lg" class="w-full" /></UFormField></div></template><template #footer><div class="flex w-full justify-end gap-2"><UButton color="neutral" variant="outline" size="lg" label="Cancel" class="min-h-11" :disabled="profileSaving" @click="profileOpen = false" /><UButton size="lg" :label="profileSaving ? 'Saving…' : 'Save'" :loading="profileSaving" :disabled="profileSaving" class="min-h-11" @click="saveProfile" /></div></template></UModal>

    <UModal v-model:open="passwordOpen" title="Change password"><template #body><div class="grid gap-4"><UFormField label="Current password" required><UInput v-model="currentPassword" :type="passwordVisibility.current ? 'text' : 'password'" size="lg" class="w-full"><template #trailing><UButton type="button" color="neutral" variant="ghost" size="xs" square :icon="passwordVisibility.current ? 'i-lucide-eye-off' : 'i-lucide-eye'" :aria-label="passwordVisibility.current ? 'Hide current password' : 'Show current password'" :title="passwordVisibility.current ? 'Hide current password' : 'Show current password'" @click="passwordVisibility.current = !passwordVisibility.current" /></template></UInput></UFormField><UFormField label="New password" required help="Use at least 8 characters."><UInput v-model="newPassword" :type="passwordVisibility.next ? 'text' : 'password'" size="lg" class="w-full"><template #trailing><UButton type="button" color="neutral" variant="ghost" size="xs" square :icon="passwordVisibility.next ? 'i-lucide-eye-off' : 'i-lucide-eye'" :aria-label="passwordVisibility.next ? 'Hide new password' : 'Show new password'" :title="passwordVisibility.next ? 'Hide new password' : 'Show new password'" @click="passwordVisibility.next = !passwordVisibility.next" /></template></UInput></UFormField><UFormField label="Confirm new password" required :error="confirmPassword.length > 0 && newPassword !== confirmPassword ? 'Passwords do not match.' : undefined"><UInput v-model="confirmPassword" :type="passwordVisibility.confirm ? 'text' : 'password'" size="lg" class="w-full"><template #trailing><UButton type="button" color="neutral" variant="ghost" size="xs" square :icon="passwordVisibility.confirm ? 'i-lucide-eye-off' : 'i-lucide-eye'" :aria-label="passwordVisibility.confirm ? 'Hide confirmation password' : 'Show confirmation password'" :title="passwordVisibility.confirm ? 'Hide confirmation password' : 'Show confirmation password'" @click="passwordVisibility.confirm = !passwordVisibility.confirm" /></template></UInput></UFormField></div></template><template #footer><div class="flex w-full justify-end gap-2"><UButton color="neutral" variant="outline" size="lg" label="Cancel" class="min-h-11" :disabled="passwordSaving" @click="passwordOpen = false" /><UButton size="lg" :label="passwordSaving ? 'Updating…' : 'Update'" :loading="passwordSaving" :disabled="!passwordCanSubmit || passwordSaving" class="min-h-11" @click="savePassword" /></div></template></UModal>
  </div>
</template>
