import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import { useEfsStore } from './store/efs'

const app = createApp(App)

// Vuetify
// NOTE: Need to include all used vuetify components here... hmm...
// https://stackoverflow.com/questions/73767137/vite-vuetify-plugin-doesnt-load-components-listed-in-external-libraries
// https://github.com/vuetifyjs/vuetify-loader/issues/269
import { createVuetify } from "vuetify"
import * as components from "vuetify/components"
import * as directives from "vuetify/directives"
import "@mdi/font/css/materialdesignicons.css"
import "vuetify/styles"
import "./styles/main.css"

const vuetify = createVuetify({ components, directives })
app.use(vuetify)


app.use(createPinia())
app.use(router)

app.mount('#app')

import { constants } from "@vatefs/common"
console.log("EFS version", constants.version)

const efs = useEfsStore()
;(window as any).efs = efs
