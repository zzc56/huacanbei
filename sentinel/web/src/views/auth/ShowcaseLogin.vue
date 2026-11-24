<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import AccountDialog from './AccountDialog.vue';

const dialog = ref<InstanceType<typeof AccountDialog> | null>(null);
const query = new URLSearchParams(window.location.search);
const landing = document.getElementById('root');
const page = document.documentElement;
let navigationTimer: number | undefined;

function onLandingClick(event: MouseEvent) {
  if (event.defaultPrevented || event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const target = event.target;
  if (!(target instanceof Element) || !target.closest('a.shift-link[href="?login=1"]')) return;
  event.preventDefault();
  void dialog.value?.open();
}

function enterDashboard() {
  if (navigationTimer !== undefined) return;
  const destination = `${import.meta.env.BASE_URL}#/?mode=live`;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    dialog.value?.close();
    window.location.assign(destination);
    return;
  }

  page.dataset.loginTransition = 'departing';
  navigationTimer = window.setTimeout(() => {
    try {
      sessionStorage.setItem('sentinel-login-transition', String(Date.now()));
    } catch {
      // Navigation still works when tab storage is unavailable.
    }
    dialog.value?.close();
    window.location.assign(destination);
  }, 150);
}

function resetTransition() {
  window.clearTimeout(navigationTimer);
  navigationTimer = undefined;
  delete page.dataset.loginTransition;
}

function onPageShow(event: PageTransitionEvent) {
  if (event.persisted) resetTransition();
}

onMounted(() => {
  landing?.addEventListener('click', onLandingClick, true);
  window.addEventListener('pageshow', onPageShow);
  if (query.get('login') === '1') void dialog.value?.open(query.get('mode') === 'register' ? 'register' : 'login');
});

onBeforeUnmount(() => {
  landing?.removeEventListener('click', onLandingClick, true);
  window.removeEventListener('pageshow', onPageShow);
  resetTransition();
});
</script>

<template>
  <AccountDialog ref="dialog" @authenticated="enterDashboard" />
</template>
