<template>
    <div class="efs-clock">
        <span @click="clickTime" class="efs-clock-time">{{ time }}</span>
        <span v-if="timer" @click="clickTimer" class="efs-clock-timer ml-2">{{ moment(timerElapsed).utc().format("mm:ss") }}</span>
    </div>
</template>

<script setup lang="ts">
import moment from "moment"
import { onMounted, onUnmounted, ref } from "vue"

const time = ref("99:99:99")
const timer = ref(false)
const timerElapsed = ref(0)

let interval: any = undefined

onMounted(() => {
    let lastTime = Date.now()
    interval = setInterval(() => {
        time.value = moment().utc().format("HH:mm:ss")
        const timeSinceLast = Date.now() - lastTime
        lastTime = Date.now()
        if (timer.value) timerElapsed.value += timeSinceLast
    }, 250)
})

onUnmounted(() => {
    clearInterval(interval)
})

function clickTime() {
    timer.value = true
    timerElapsed.value = 0
}

function clickTimer() {
    timer.value = false
    timerElapsed.value = 0
}
</script>

<style scoped>
.efs-clock {
  font-size: calc(13px * var(--efs-scale, 1));
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
}

.efs-clock-time,
.efs-clock-timer {
  cursor: pointer;
}
</style>
