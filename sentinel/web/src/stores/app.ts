import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useAppStore = defineStore('app', () => {
  const toastMessage = ref<string | null>(null);
  let timer: ReturnType<typeof setTimeout> | null = null;

  function showToast(msg: string, duration = 2600): void {
    toastMessage.value = msg;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      toastMessage.value = null;
    }, duration);
  }

  return { toastMessage, showToast };
});
