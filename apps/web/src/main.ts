import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { createRouter, createWebHistory } from 'vue-router';
import App from './App.vue';
import './style.css';
import './design.css';
import './management.css';
import './workflow.css';
const router = createRouter({
  history: createWebHistory(),
  routes: [{ path: '/:view?', component: App }],
});
createApp(App).use(createPinia()).use(router).mount('#app');
