import { createRouter, createWebHistory } from 'vue-router'

import Dashboard from '@/views/Dashboard.vue'
const Hazard = () => import('@/views/hazard/index.vue')
const HazardDetail = () => import('@/views/hazard/detail.vue')
const Deformation = () => import('@/views/deformation/index.vue')
const Crack = () => import('@/views/crack/index.vue')
const Tilt = () => import('@/views/tilt/index.vue')
const RainGauge = () => import('@/views/rain_gauge/index.vue')
const Threshold = () => import('@/views/threshold/index.vue')
const Alarm = () => import('@/views/alarm/index.vue')
const Evacuation = () => import('@/views/evacuation/index.vue')
const Patrol = () => import('@/views/patrol/index.vue')
const Engineering = () => import('@/views/engineering/index.vue')
const Acceptance = () => import('@/views/acceptance/index.vue')
const Rectification = () => import('@/views/rectification/index.vue')
const Drill = () => import('@/views/drill/index.vue')
const Device = () => import('@/views/device/index.vue')
const Report = () => import('@/views/report/index.vue')
const Propaganda = () => import('@/views/propaganda/index.vue')
const Contract = () => import('@/views/contract/index.vue')
const Training = () => import('@/views/training/index.vue')

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'dashboard', component: Dashboard },
    { path: '/hazard', name: 'hazard', component: Hazard },
    { path: '/hazard/:id', name: 'hazard-detail', component: HazardDetail },
    { path: '/deformation', name: 'deformation', component: Deformation },
    { path: '/crack', name: 'crack', component: Crack },
    { path: '/tilt', name: 'tilt', component: Tilt },
    { path: '/rain_gauge', name: 'rain_gauge', component: RainGauge },
    { path: '/threshold', name: 'threshold', component: Threshold },
    { path: '/alarm', name: 'alarm', component: Alarm },
    { path: '/evacuation', name: 'evacuation', component: Evacuation },
    { path: '/patrol', name: 'patrol', component: Patrol },
    { path: '/engineering', name: 'engineering', component: Engineering },
    { path: '/acceptance', name: 'acceptance', component: Acceptance },
    { path: '/rectification', name: 'rectification', component: Rectification },
    { path: '/drill', name: 'drill', component: Drill },
    { path: '/device', name: 'device', component: Device },
    { path: '/report', name: 'report', component: Report },
    { path: '/propaganda', name: 'propaganda', component: Propaganda },
    { path: '/contract', name: 'contract', component: Contract },
    { path: '/training', name: 'training', component: Training },
  ],
})

export default router
