type PushStatus = "checking" | "unsupported" | "blocked" | "disabled" | "enabled" | "unavailable";

function supportsPush() {
  return import.meta.client
    && "serviceWorker" in navigator
    && "PushManager" in window
    && "Notification" in window;
}

function applicationServerKey(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const decoded = atob(padded);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

export function usePushNotifications() {
  const supabase = useSupabaseClient();
  const config = useRuntimeConfig();
  const status = useState<PushStatus>("excavision-push-status", () => "checking");
  const busy = useState("excavision-push-busy", () => false);
  const vapidKey = config.public.vapidKey as string;

  async function registration() {
    const existing = await navigator.serviceWorker.getRegistration();
    return existing ?? navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" });
  }

  async function refreshStatus() {
    if (!supportsPush()) {
      status.value = "unsupported";
      return;
    }
    if (!vapidKey) {
      status.value = "unavailable";
      return;
    }
    if (Notification.permission === "denied") {
      status.value = "blocked";
      return;
    }
    const subscription = await (await registration()).pushManager.getSubscription();
    status.value = subscription ? "enabled" : "disabled";
  }

  async function enable() {
    if (busy.value || !supportsPush() || !vapidKey) return { ok: false, message: "Push notifications are unavailable." };
    busy.value = true;
    try {
      const permission = Notification.permission === "default"
        ? await Notification.requestPermission()
        : Notification.permission;
      if (permission !== "granted") {
        status.value = permission === "denied" ? "blocked" : "disabled";
        return { ok: false, message: "Notification permission was not granted." };
      }

      const worker = await registration();
      const subscription = await worker.pushManager.getSubscription()
        ?? await worker.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationServerKey(vapidKey),
        });
      const subscriptionJson = subscription.toJSON();
      if (!subscriptionJson.endpoint || !subscriptionJson.keys?.p256dh || !subscriptionJson.keys.auth) {
        throw new Error("The browser returned an incomplete push subscription.");
      }
      const { error } = await supabase.functions.invoke("push-subscriptions", {
        body: { subscription: subscriptionJson },
      });
      if (error) throw error;
      status.value = "enabled";
      return { ok: true, message: "Notifications enabled." };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Notifications could not be enabled.";
      await refreshStatus();
      return { ok: false, message };
    } finally {
      busy.value = false;
    }
  }

  async function disable() {
    if (busy.value || !supportsPush()) return { ok: false, message: "Push notifications are unavailable." };
    busy.value = true;
    try {
      const subscription = await (await registration()).pushManager.getSubscription();
      if (!subscription) {
        status.value = "disabled";
        return { ok: true, message: "Notifications are already off." };
      }
      const { error } = await supabase.functions.invoke("push-subscriptions", {
        method: "DELETE",
        body: { subscription: subscription.toJSON() },
      });
      if (error) throw error;
      await subscription.unsubscribe();
      status.value = "disabled";
      return { ok: true, message: "Notifications turned off." };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Notifications could not be turned off.";
      await refreshStatus();
      return { ok: false, message };
    } finally {
      busy.value = false;
    }
  }

  return { status: readonly(status), busy: readonly(busy), refreshStatus, enable, disable };
}
