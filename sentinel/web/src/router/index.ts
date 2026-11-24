import { createRouter, createWebHashHistory } from 'vue-router';
import HomePage from '@/views/home/HomePage.vue';
import TechPage from '@/views/tech/TechPage.vue';
import DemoPage from '@/views/demo/DemoPage.vue';
import DataPage from '@/views/data/DataPage.vue';
import TeamPage from '@/views/team/TeamPage.vue';
import RadarPage from '@/views/console/RadarPage.vue';
import VisionPage from '@/views/console/VisionPage.vue';
import FusionPage from '@/views/console/FusionPage.vue';

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/login', name: 'login', component: HomePage },
    { path: '/history', name: 'history', component: HomePage },
    { path: '/live/waiting', redirect: '/?mode=live' },
    { path: '/', name: 'home', component: HomePage },
    { path: '/tech', name: 'tech', component: TechPage },
    { path: '/demo', name: 'demo', component: DemoPage },
    { path: '/data', name: 'data', component: DataPage },
    { path: '/team', name: 'team', component: TeamPage },
    { path: '/console', redirect: '/console/radar' },
    { path: '/console/radar', name: 'console-radar', component: RadarPage },
    { path: '/console/vision', name: 'console-vision', component: VisionPage },
    { path: '/console/fusion', name: 'console-fusion', component: FusionPage }
  ]
});

router.beforeEach(to => {
  if (to.name === 'login') {
    const login = `${import.meta.env.BASE_URL}showcase/index.html?login=1`;
    window.location.replace(to.query.mode === 'register' ? `${login}&mode=register` : login);
    return false;
  }
  if (to.path === '/' && !to.query.mode) {
    window.location.replace(import.meta.env.BASE_URL + 'showcase/index.html');
    return false;
  }
});

export default router;

