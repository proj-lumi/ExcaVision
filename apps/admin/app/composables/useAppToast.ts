import type { Toast } from "@nuxt/ui/runtime/composables/useToast.js";

/**
 * Every toast in the app goes through here.
 *
 * Nuxt UI stores the auto-dismiss duration on each toast. Callers that omit it
 * leave the toast without a reliable timer, which is why toasts used to sit on
 * screen indefinitely. This wrapper applies one duration and one behaviour so
 * every project shows the same thing: top-right, progress bar, five seconds.
 */
const TOAST_DURATION_MS = 5000;

export function useAppToast(): {
  add: (toast: Partial<Toast>) => Toast;
  update: (id: string | number, toast: Omit<Partial<Toast>, "id">) => void;
  remove: (id: string | number) => void;
  clear: () => void;
} {
  const toast = useToast();

  return {
    add: (options: Partial<Toast>) => toast.add({ duration: TOAST_DURATION_MS, ...options }),
    update: toast.update,
    remove: toast.remove,
    clear: toast.clear,
  };
}
