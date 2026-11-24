import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import router from './router';
import './styles/base.css';

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.mount('#app');

const page = document.documentElement;
if (page.dataset.loginTransition === 'arriving') {
  // Keep the cover in place until the cockpit has had a frame to lay out.
  void router.isReady().then(
    () => requestAnimationFrame(() => requestAnimationFrame(() => delete page.dataset.loginTransition)),
    () => delete page.dataset.loginTransition,
  );
}
