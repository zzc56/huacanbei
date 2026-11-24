<script setup lang="ts">
import { nextTick, ref } from 'vue';
import LoginForm from './LoginForm.vue';

const emit = defineEmits<{ authenticated: [] }>();
const dialog = ref<HTMLDialogElement | null>(null);
const mode = ref<'login' | 'register'>('login');
const visible = ref(false);

async function open(initialMode: 'login' | 'register' = 'login') {
  if (visible.value) return;
  mode.value = initialMode;
  visible.value = true;
  await nextTick();
  dialog.value?.showModal();
}

function close() {
  dialog.value?.close();
}

defineExpose({ open, close });
</script>

<template>
  <Teleport to="body">
    <dialog ref="dialog" class="showcase-auth-dialog" aria-label="登录或注册" @click.self="close" @close="visible = false">
      <div class="account-panel">
        <button class="account-close" type="button" aria-label="关闭登录窗口" @click="close">×</button>
        <LoginForm v-if="visible" :initial-mode="mode" @authenticated="emit('authenticated')" />
      </div>
    </dialog>
  </Teleport>
</template>

<style scoped>
.showcase-auth-dialog {
  position: fixed;
  inset: 0;
  width: min(460px, calc(100% - 32px));
  max-height: calc(100dvh - 32px);
  margin: auto;
  padding: 0;
  overflow: auto;
  border: 0;
  border-radius: 18px;
  color: #eef7fc;
  background: #111d27;
  box-shadow: 0 22px 70px #03080bb3;
}
.showcase-auth-dialog::backdrop { background: #071016b8; }
.showcase-auth-dialog,
.showcase-auth-dialog::backdrop { transition: opacity 150ms ease-in; }
:global(html[data-login-transition='departing'] .showcase-auth-dialog),
:global(html[data-login-transition='departing'] .showcase-auth-dialog::backdrop) {
  opacity: 0;
  pointer-events: none;
}
.account-panel { position: relative; }
.account-close {
  position: absolute;
  z-index: 2;
  top: 6px;
  right: 7px;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: #adc4d5;
  cursor: pointer;
  font-size: 25px;
  line-height: 1;
}
.account-close:hover { color: #fff; background: #ffffff18; }
:global(html:has(.showcase-auth-dialog[open])) { overflow: hidden; }
</style>
