<script setup lang="ts">
definePageMeta({ layout: "admin", title: "Settings" });
useSeoMeta({ title: "Settings" });

const toast = useAppToast();
const colorMode = useColorMode();
const supabase = useSupabaseClient();
const { current_profile, updateProfile } = useAdminStore();
const reduceMotion = useState("admin-reduce-motion", () => false);
const themeOptions = [
  { label: "System", value: "system", icon: "i-lucide-monitor" },
  { label: "Light", value: "light", icon: "i-lucide-sun" },
  { label: "Dark", value: "dark", icon: "i-lucide-moon" },
];
const profileOpen = ref(false);
const passwordOpen = ref(false);
const profile = reactive({ full_name: "", email: "", phone: "" });
const profileErrors = reactive({ full_name: "", phone: "" });
const password = reactive({ current: "", next: "", confirm: "" });
const passwordError = ref("");
const profileSaving = ref(false);
const passwordSaving = ref(false);
const passwordVisibility = reactive({ current: false, next: false, confirm: false });

function openProfile() {
  if (!current_profile.value) return;
  Object.assign(profile, {
    full_name: current_profile.value.full_name,
    email: current_profile.value.email,
    phone: current_profile.value.phone,
  });
  Object.assign(profileErrors, { full_name: "", phone: "" });
  profileOpen.value = true;
}
async function saveProfile() {
  if (profileSaving.value) return;
  profileErrors.full_name = validName(profile.full_name) ? "" : "Enter your name.";
  profile.phone = normalizedPhone(profile.phone);
  profileErrors.phone = PH_PHONE_PATTERN.test(profile.phone) ? "" : "Enter an 11-digit mobile number starting with 09.";
  if (profileErrors.full_name || profileErrors.phone || !current_profile.value) return;
  profileSaving.value = true;
  try {
    const result = await updateProfile(current_profile.value.id, {
      full_name: profile.full_name.trim(),
      email: current_profile.value.email,
      phone: profile.phone,
      company_name: current_profile.value.company_name,
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
function openPassword() {
  Object.assign(password, { current: "", next: "", confirm: "" });
  Object.assign(passwordVisibility, { current: false, next: false, confirm: false });
  passwordError.value = "";
  passwordOpen.value = true;
}
async function savePassword() {
  if (passwordSaving.value) return;
  if (!password.current) { passwordError.value = "Enter your current password."; return; }
  if (password.next.length < 8) { passwordError.value = "Use at least 8 characters."; return; }
  if (password.next !== password.confirm) { passwordError.value = "Passwords do not match."; return; }
  passwordSaving.value = true;
  try {
    const { error: reauthError } = await supabase.auth.signInWithPassword({ email: current_profile.value?.email ?? "", password: password.current });
    if (reauthError) { passwordError.value = "Current password is incorrect."; return; }
    const { error: updateError } = await supabase.auth.updateUser({ password: password.next });
    if (updateError) { passwordError.value = updateError.message; return; }
    passwordOpen.value = false;
    toast.add({ title: "Password updated", color: "success" });
  } finally {
    passwordSaving.value = false;
  }
}
</script>

<template>
  <div class="admin-page">
    <header class="admin-page-header"><h1>Settings</h1></header>
    <div class="settings-page">
      <UCard class="settings-card">
        <template #header><h2 class="settings-card-title">Account</h2></template>
        <div v-if="current_profile" class="settings-account">
          <p class="font-medium text-highlighted">{{ current_profile.full_name }}</p>
          <p class="text-muted">{{ current_profile.email }}</p>
        </div>
        <div>
          <button type="button" class="settings-row settings-action" @click="openProfile"><UIcon name="i-lucide-user-round" class="settings-icon" /><span class="settings-row-copy"><span class="settings-row-title">Profile</span><span class="settings-row-description">Name and phone</span></span><UIcon name="i-lucide-chevron-right" class="settings-row-end" /></button>
          <button type="button" class="settings-row settings-action" @click="openPassword"><UIcon name="i-lucide-lock-keyhole" class="settings-icon" /><span class="settings-row-copy"><span class="settings-row-title">Password</span><span class="settings-row-description">Change sign-in password</span></span><UIcon name="i-lucide-chevron-right" class="settings-row-end" /></button>
        </div>
      </UCard>

      <UCard class="settings-card">
        <template #header><h2 class="settings-card-title">Preferences</h2></template>
        <div class="grid gap-3">
          <div><p class="mb-2 text-xs font-medium text-muted">Theme</p><div class="grid grid-cols-3 gap-2"><UButton v-for="option in themeOptions" :key="option.value" :icon="option.icon" :label="option.label" :color="colorMode.preference === option.value ? 'primary' : 'neutral'" :variant="colorMode.preference === option.value ? 'soft' : 'outline'" size="sm" class="admin-accent-control justify-center" @click="colorMode.preference = option.value" /></div></div>
          <div class="settings-row"><UIcon name="i-lucide-move" class="settings-icon" /><span class="settings-row-copy"><span class="settings-row-title">Reduce motion</span></span><USwitch v-model="reduceMotion" aria-label="Reduce motion" /></div>
        </div>
      </UCard>
    </div>

    <UModal v-model:open="profileOpen" title="Profile">
      <template #body><div class="grid gap-4"><UFormField label="Full name" required :error="profileErrors.full_name || undefined"><UInput v-model="profile.full_name" maxlength="80" placeholder="Enter full name" size="lg" class="w-full" /></UFormField><UFormField label="Email"><UInput :model-value="profile.email" type="email" icon="i-lucide-lock-keyhole" disabled size="lg" class="w-full" /></UFormField><UFormField label="Phone" required :error="profileErrors.phone || undefined"><UInput v-model="profile.phone" inputmode="numeric" maxlength="11" placeholder="09xxxxxxxxx" size="lg" class="w-full" /></UFormField></div></template>
      <template #footer><div class="flex w-full justify-end gap-2"><UButton color="neutral" variant="outline" size="lg" label="Cancel" class="min-h-11" :disabled="profileSaving" @click="profileOpen = false" /><UButton size="lg" :label="profileSaving ? 'Saving…' : 'Save'" :loading="profileSaving" :disabled="profileSaving" class="min-h-11" @click="saveProfile" /></div></template>
    </UModal>

    <UModal v-model:open="passwordOpen" title="Change password">
      <template #body><div class="grid gap-4"><UFormField label="Current password" required><UInput v-model="password.current" :type="passwordVisibility.current ? 'text' : 'password'" size="lg" class="w-full"><template #trailing><UButton type="button" color="neutral" variant="ghost" size="xs" square :icon="passwordVisibility.current ? 'i-lucide-eye-off' : 'i-lucide-eye'" :aria-label="passwordVisibility.current ? 'Hide current password' : 'Show current password'" :title="passwordVisibility.current ? 'Hide current password' : 'Show current password'" @click="passwordVisibility.current = !passwordVisibility.current" /></template></UInput></UFormField><UFormField label="New password" required help="Use at least 8 characters."><UInput v-model="password.next" :type="passwordVisibility.next ? 'text' : 'password'" size="lg" class="w-full"><template #trailing><UButton type="button" color="neutral" variant="ghost" size="xs" square :icon="passwordVisibility.next ? 'i-lucide-eye-off' : 'i-lucide-eye'" :aria-label="passwordVisibility.next ? 'Hide new password' : 'Show new password'" :title="passwordVisibility.next ? 'Hide new password' : 'Show new password'" @click="passwordVisibility.next = !passwordVisibility.next" /></template></UInput></UFormField><UFormField label="Confirm new password" required :error="passwordError || undefined"><UInput v-model="password.confirm" :type="passwordVisibility.confirm ? 'text' : 'password'" size="lg" class="w-full"><template #trailing><UButton type="button" color="neutral" variant="ghost" size="xs" square :icon="passwordVisibility.confirm ? 'i-lucide-eye-off' : 'i-lucide-eye'" :aria-label="passwordVisibility.confirm ? 'Hide confirmation password' : 'Show confirmation password'" :title="passwordVisibility.confirm ? 'Hide confirmation password' : 'Show confirmation password'" @click="passwordVisibility.confirm = !passwordVisibility.confirm" /></template></UInput></UFormField></div></template>
      <template #footer><div class="flex w-full justify-end gap-2"><UButton color="neutral" variant="outline" size="lg" label="Cancel" class="min-h-11" :disabled="passwordSaving" @click="passwordOpen = false" /><UButton size="lg" :label="passwordSaving ? 'Updating…' : 'Update'" :loading="passwordSaving" :disabled="passwordSaving" class="min-h-11" @click="savePassword" /></div></template>
    </UModal>
  </div>
</template>
