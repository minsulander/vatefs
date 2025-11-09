// Composables
import { createRouter, createWebHistory, createWebHashHistory } from "vue-router"

const routes = [
    {
        path: "/",
        name: "home",
        component: () => import("@/views/HomeView.vue"),
    },
    {
        path: "/home",
        name: "Home",
        component: () => import("@/views/HomeView.vue"),
    },
    {
        path: "/:pathMatch(.*)*",
        name: "notfound",
        component: () => import("@/views/HomeView.vue"),
    },
]

const router = (window as any).electron
    ? createRouter({
          history: createWebHashHistory(),
          routes,
      })
    : createRouter({
          history: createWebHistory(import.meta.env.BASE_URL),
          routes,
      })

let first = true
router.beforeEach((to, from, next) => {
    const lastRoute = localStorage.getItem("efs/route")
    if (from.hash && !to.hash) {
        to.hash = from.hash
        next(to)
    } else if (from.query && from.query.federation && (!to.query || !to.query.federation)) {
        to.query = { ...to.query, federation: from.query.federation }
        next(to)
    } else if ((!to.name || to.name == "home") && lastRoute && lastRoute != "home" && lastRoute != "Home" && first) {
        next({ name: lastRoute })
    } else next()
    first = false
})

router.afterEach((to, from) => {
    if (to.name && typeof(to.name) === "string") localStorage.setItem("efs/route", to.name)
})
export default router
