import { onActivated, onDeactivated, onMounted, onUnmounted, watch } from "vue";
import { useRoute } from "vue-router";
import { useBackend } from "@/hooks/useBackend";
import { useSubsStore } from "@/store/subs";

export function useSubscriptionStatuses() {
  const store = useSubsStore();
  const { env } = useBackend();
  const route = useRoute();
  let timer: ReturnType<typeof setInterval> | undefined;
  let pending = false;
  const refresh = async () => {
    if (
      pending ||
      document.hidden ||
      route.path !== "/subs" ||
      !env.value.feature?.subscriptionAvailability
    )
      return;
    pending = true;
    try {
      await store.fetchStatuses();
    } catch {
      /* The next visible refresh retries; auth errors use the shared interceptor. */
    } finally {
      pending = false;
    }
  };
  const stop = () => {
    clearInterval(timer);
    timer = undefined;
    document.removeEventListener("visibilitychange", visibilityChanged);
  };
  const visibilityChanged = () => {
    clearInterval(timer);
    timer = undefined;
    if (!document.hidden && route.path === "/subs") {
      void refresh();
      timer = setInterval(refresh, 60000);
    }
  };
  const start = () => {
    stop();
    document.addEventListener("visibilitychange", visibilityChanged);
    visibilityChanged();
  };
  onMounted(start);
  onActivated(start);
  onDeactivated(stop);
  onUnmounted(stop);
  watch(() => env.value.feature?.subscriptionAvailability, refresh);
}
