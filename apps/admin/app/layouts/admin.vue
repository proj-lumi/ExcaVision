<script setup lang="ts">
import { REQUEST_TYPE_LABELS } from "~/types/mock";

const route = useRoute();
const supabase = useSupabaseClient();
const toast = useAppToast();
const logoutOpen = ref(false);
const loggingOut = ref(false);
const { data, current_profile, load, startRealtime, stopRealtime } = useAdminStore();
onMounted(async () => {
  await load();
  startRealtime();
});
onBeforeUnmount(() => { void stopRealtime(); });

function navClass(active: boolean) {
  return active
    ? "text-primary before:bg-primary/10"
    : "hover:text-primary hover:before:bg-primary/10";
}

const navigation = computed(() => {
  const requestsActive = route.path.startsWith("/requests");
  const unitsCatalogueActive = route.path === "/units";
  const sitesActive = route.path.startsWith("/sites") || /^\/units\/[^/]+$/.test(route.path);
  const nodesActive = route.path.startsWith("/nodes");
  const settingsActive = route.path.startsWith("/settings");

  return [[
    { label: "Work queue", icon: "i-lucide-inbox", to: "/requests", active: requestsActive, class: navClass(requestsActive) },
    { label: "Sites", icon: "i-lucide-map-pin", to: "/sites", active: sitesActive, class: navClass(sitesActive) },
    { label: "Units", icon: "i-lucide-layers-3", to: "/units", active: unitsCatalogueActive, class: navClass(unitsCatalogueActive) },
    { label: "Nodes", icon: "i-lucide-cpu", to: "/nodes", active: nodesActive, class: navClass(nodesActive) },
    { label: "Settings", icon: "i-lucide-settings", to: "/settings", active: settingsActive, class: navClass(settingsActive) },
  ]];
});

const reduceMotion = useState("admin-reduce-motion", () => false);

const detailSite = computed(() => {
  if (!/^\/sites\/[^/]+$/.test(route.path)) return undefined;
  return data.value.sites.find((site) => site.slug === String(route.params.id) && !site.archived_at);
});
const detailUnit = computed(() => {
  if (!/^\/units\/[^/]+$/.test(route.path)) return undefined;
  return data.value.units.find((unit) => unit.slug === String(route.params.id) && !unit.archived_at);
});
const detailRequest = computed(() => {
  if (!/^\/setup\/[^/]+$/.test(route.path)) return undefined;
  return data.value.service_requests.find((request) => request.id === String(route.params.id));
});
const showDetailToolbar = computed(() => /^\/(sites|units|setup)\/[^/]+$/.test(route.path));
const detailBackTo = computed(() => {
  if (detailRequest.value) return "/requests";
  if (detailUnit.value) return route.hash.startsWith("#node-") ? "/nodes" : "/units";
  return "/sites";
});
const detailBackLabel = computed(() => {
  if (detailRequest.value) return "Back to work queue";
  if (detailUnit.value) return route.hash.startsWith("#node-") ? "Back to nodes" : "Back to units";
  return "Back to sites";
});
const detailBreadcrumbs = computed(() => {
  if (detailRequest.value) {
    return [{ label: "Work queue", to: "/requests" }, { label: REQUEST_TYPE_LABELS[detailRequest.value.request_type] }];
  }
  if (detailUnit.value) {
    return route.hash.startsWith("#node-")
      ? [{ label: "Nodes", to: "/nodes" }, { label: detailUnit.value.name }]
      : [{ label: "Units", to: "/units" }, { label: detailUnit.value.name }];
  }
  return [{ label: "Sites", to: "/sites" }, { label: detailSite.value?.name ?? "Site" }];
});
const detailStatusKind = computed(() => detailUnit.value ? "unit" as const : "access" as const);
const detailStatusValue = computed(() => detailUnit.value?.status ?? detailSite.value?.invitation_status);

async function logout() {
  if (loggingOut.value) return;
  loggingOut.value = true;
  try {
    await supabase.auth.signOut();
    logoutOpen.value = false;
    toast.add({ title: "Signed out", color: "success" });
    await navigateTo("/login", { replace: true });
  } finally {
    loggingOut.value = false;
  }
}
</script>

<template>
  <UDashboardGroup :class="['admin-shell', reduceMotion ? '[&_*]:animate-none [&_*]:transition-none' : '']">
    <UDashboardSidebar :min-size="14" :default-size="16" :max-size="18" :resizable="false">
      <template #header>
        <NuxtLink to="/requests" class="flex min-h-10 items-center gap-2 px-3 text-highlighted no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
          <img src="/logo.svg" alt="ExcaVision" width="32" height="32" class="size-8 shrink-0" />
          <strong class="min-w-0 truncate text-base font-semibold tracking-[-0.03em]">ExcaVision</strong>
        </NuxtLink>
      </template>
      <UNavigationMenu :items="navigation" orientation="vertical" tooltip popover :ui="{ link: 'text-sm', linkLeadingIcon: 'size-4 group-hover:text-primary', linkLabel: 'group-hover:text-primary' }" />
      <template #footer>
        <UButton color="neutral" variant="ghost" icon="i-lucide-log-out" label="Log out" block class="admin-accent-control justify-start" @click="logoutOpen = true" />
      </template>
    </UDashboardSidebar>
    <UDashboardPanel :ui="{ body: 'gap-0 p-0 sm:gap-0 sm:p-0' }">
      <template #header>
        <header class="shrink-0">
          <UDashboardNavbar>
            <template #right>
              <NuxtLink to="/settings" class="flex min-w-0 items-center gap-2 text-highlighted no-underline hover:text-primary">
                <UIcon name="i-lucide-user-round" class="size-4 shrink-0 text-primary" />
                <span class="max-w-[45vw] truncate text-sm font-medium sm:max-w-72 lg:max-w-96">{{ current_profile?.full_name ?? "Admin" }}</span>
              </NuxtLink>
            </template>
          </UDashboardNavbar>
          <div v-if="showDetailToolbar" class="flex min-h-12 min-w-0 items-center gap-2 border-b border-default bg-default px-3 sm:px-4">
            <UButton :to="detailBackTo" color="neutral" variant="ghost" icon="i-lucide-arrow-left" :aria-label="detailBackLabel" class="admin-accent-control min-h-9 min-w-9 shrink-0 justify-center" />
            <UBreadcrumb :items="detailBreadcrumbs" class="min-w-0 flex-1" />
            <AdminStatusBadge v-if="detailStatusValue" :kind="detailStatusKind" :value="detailStatusValue" />
          </div>
        </header>
      </template>
      <template #body><main class="mx-auto grid w-full max-w-[1440px] min-w-0 gap-3 p-3 sm:p-4"><slot /></main></template>
    </UDashboardPanel>
  </UDashboardGroup>
  <UModal v-model:open="logoutOpen" title="Log out">
    <template #body><p class="text-sm text-toned">Log out of ExcaVision Admin?</p></template>
    <template #footer><div class="flex w-full justify-end gap-2"><UButton color="neutral" variant="outline" label="Cancel" class="admin-accent-control" :disabled="loggingOut" @click="logoutOpen = false" /><UButton color="error" icon="i-lucide-log-out" :label="loggingOut ? 'Logging out…' : 'Log out'" :loading="loggingOut" :disabled="loggingOut" @click="logout" /></div></template>
  </UModal>
</template>
