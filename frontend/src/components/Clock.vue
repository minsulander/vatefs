<template>
    <div class="efs-clock">
        <span class="efs-clock-prefix">UTC:</span>
        <span @click="clickTime" class="efs-clock-time">{{ time }}</span>
        <span v-if="timer" @click="clickTimer" class="efs-clock-timer">{{ moment(timerElapsed).utc().format("mm:ss") }}</span>
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
  display: inline-flex;
  align-items: baseline;
  gap: 0.35em;
  font-size: calc(22px * var(--efs-chrome-scale, var(--efs-scale, 1)));
  font-weight: 400;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
  color: #d1d5db;
  white-space: nowrap;
}

.efs-clock-prefix {
  font-weight: 400;
  letter-spacing: 0.04em;
}

.efs-clock-time,
.efs-clock-timer {
  cursor: pointer;
  font-weight: 400;
}

.efs-clock-timer {
  color: #93c5fd;
}
</style>
