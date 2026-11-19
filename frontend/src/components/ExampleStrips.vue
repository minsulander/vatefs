<script setup lang="ts">
import type { FlightStrip } from '@vatefs/common'
import FlightStripView from '@/components/FlightStrip.vue'

const emit = defineEmits<{ close: [] }>()

const shared = {
  callsign: 'MAGG41',
  aircraftType: 'SB39',
  wakeTurbulence: 'M',
  flightRules: 'I',
  flightCategory: 'M',
  tas: 'N0400',
  eobt: '1025',
  squawk: '2415',
  adep: 'ESGG',
  ades: 'ESSA',
  adepName: 'Göteborg/Landvetter',
  adesName: 'Stockholm/Arlanda',
  sid: 'MOXAM1A',
  tmaExit: 'MOXAM',
  route: 'MOXAM N623',
  rfl: 'FL430',
  stripType: 'departure',
  bayId: 'example',
  sectionId: 'example',
  position: 0,
  bottom: false,
} satisfies Partial<FlightStrip>

const esgg: FlightStrip = { ...shared, id: 'example-esgg' }
const generic: FlightStrip = { ...shared, id: 'example-std', oat: true, ctot: '1140' }
</script>

<template>
  <div class="examples" @click.self="emit('close')">
    <div class="examples-card">
      <header>
        <h1>Exempelremsor</h1>
        <button type="button" @click="emit('close')">Stäng</button>
      </header>
      <p>
        Samma flygning. MAGG41 är militär IFR med <code>RMK/OAT</code>.
        FRUL är <strong>I</strong>. Den generiska remsan har en OAT-stjärna uppe till vänster i den högra rutans nedre del.
      </p>
      <section>
        <h2>ESGG</h2>
        <div class="examples-strip">
          <FlightStripView :strip="esgg" bay-id="example" section-id="example" force-look="paper" />
        </div>
      </section>
      <section>
        <h2>Generisk pappersremsa</h2>
        <div class="examples-strip">
          <FlightStripView :strip="generic" bay-id="example" section-id="example" force-look="std" />
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.examples {
  position: fixed;
  inset: 0;
  z-index: 80;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  overflow: auto;
  padding: 32px 16px;
}
.examples-card {
  width: min(1040px, 100%);
  background: #d9d3c7;
  color: #111;
  border-radius: 8px;
  padding: 16px 20px 28px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
h1, h2 {
  margin: 0;
  font-family: "Segoe UI", sans-serif;
}
h2 {
  margin: 18px 0 8px;
  font-size: 15px;
}
p {
  margin: 8px 0 0;
  font-family: "Segoe UI", sans-serif;
  font-size: 14px;
}
button {
  border: 1px solid #333;
  background: #fff;
  padding: 4px 12px;
  cursor: pointer;
}
.examples-strip {
  --bay-scale: 2.2;
  --strip-scale: 2.2;
  width: 100%;
  background: #8d8d8d;
  padding: 16px 8px;
}
</style>
