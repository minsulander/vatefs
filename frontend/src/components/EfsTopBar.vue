<template>
  <div class="efs-top-bar text-body-2 text-grey">
      <!-- Left arrow: trash (recover / drop-to-delete) -->
      <button
        type="button"
        class="top-menu-btn top-trash-btn efs-trash-drop"
        :class="{ 'drag-over': trashDragOver }"
        title="Trash — open recover · drop strip to delete"
        @click="trashOpen = true"
        @dragover.prevent="onTrashDragOver"
        @dragenter.prevent="onTrashDragEnter"
        @dragleave="onTrashDragLeave"
        @drop.prevent="onTrashDrop"
      >
        <span class="top-menu-tri" aria-hidden="true" />
      </button>
      <TrashDialog v-model="trashOpen" />
      <v-btn
        variant="text"
        icon="mdi-cog"
        class="text-grey top-settings-btn"
        to="/settings"
        title="Settings"
      />

      <!-- ESGG paper: RWY + covering roles (auto) -->
      <div v-if="efs.esggRolesMode" class="top-status-cluster">
        <span
          class="essa-status-btn esgg-rwy-label"
          :title="esggRwyTitle"
        >{{ esggRwyLabel }}</span>
        <span
          class="essa-status-btn esgg-roles-readonly"
          :title="esggRolesStatusTitle"
        >Roles: {{ esggRolesLabel }}</span>
      </div>

      <!-- ESSA status indicators (also editable via menu) -->
      <div v-if="efs.essaRolesMode" class="top-status-cluster">
        <button
          type="button"
          class="essa-status-btn"
          :class="{ 'is-manual': efs.essaRwyConfigManual }"
          :title="essaRwyStatusTitle"
          @click="essaRwyDialog = true"
          @mouseenter="onEssaRwyHoverEnter"
          @mouseleave="onEssaRwyHoverLeave"
        >
          {{ essaRwyLabel || 'RWY: -' }}
        </button>
        <button
          type="button"
          class="essa-status-btn"
          :class="{ 'is-manual': efs.essaRolesManual }"
          :title="essaRolesStatusTitle"
          @click="openEssaRolesDialog"
        >
          Roles: {{ essaRolesLabel }}
        </button>
      </div>

      <Teleport to="body">
        <div
          v-if="essaRwyQuickrefVisible && essaRwyQuickrefUrl"
          class="essa-rwy-quickref"
          :style="{ top: essaRwyQuickrefStyle.top, left: essaRwyQuickrefStyle.left }"
        >
          <img
            :src="essaRwyQuickrefUrl"
            :alt="essaRwyLabel || 'RWY quickref'"
            class="essa-rwy-quickref-img"
            :style="{
              maxWidth: essaRwyQuickrefStyle.maxWidth,
              maxHeight: essaRwyQuickrefStyle.maxHeight,
            }"
          />
        </div>
      </Teleport>
      <v-dialog v-model="essaRwyDialog" max-width="440" scrim content-class="essa-rwy-dialog-wrap">
        <div class="essa-rwy-menu" @click.stop>
          <div class="essa-rwy-header">RWY CONFIG</div>
          <div v-if="essaRwyEsHint" class="essa-rwy-es">ES: {{ essaRwyEsHint }}</div>
          <div class="essa-rwy-list essa-rwy-list-cols">
            <button
              v-for="row in essaRwyOptions"
              :key="row.id"
              type="button"
              class="essa-rwy-item"
              :class="{
                selected: row.id === draftEssaRwyId,
                'es-match': row.matchesEs,
                'auto-pref': row.autoPreferred,
              }"
              @click="draftEssaRwyId = row.id"
            >
              <span class="essa-rwy-id">{{ row.id }}</span>
              <span class="essa-rwy-detail" :title="row.pdfName">{{ row.pdfName }}</span>
              <span v-if="row.autoPreferred" class="essa-rwy-auto-tag">AUTO</span>
            </button>
          </div>
          <div class="essa-rwy-actions">
            <button type="button" class="essa-rwy-action" @click="essaRwyDialog = false">CANCEL</button>
            <button type="button" class="essa-rwy-action" @click="onEssaRwyAuto">AUTO</button>
            <button type="button" class="essa-rwy-action essa-rwy-action-ok" @click="onEssaRwyOk">OK</button>
          </div>
        </div>
      </v-dialog>
      <v-dialog v-model="essaRolesDialog" max-width="360" scrim content-class="essa-roles-dialog-wrap">
        <div class="efs-popup-menu efs-popup-menu--wide" @click.stop>
          <div class="efs-popup-header">Roles</div>
          <div class="efs-popup-section">TWR</div>
          <div class="efs-popup-list">
            <label
              v-for="role in essaTwrRoles"
              :key="role"
              class="efs-popup-item efs-popup-item--start"
              :class="{ selected: draftEssaRoles.includes(role) }"
            >
              <input v-model="draftEssaRoles" type="checkbox" :value="role" class="essa-role-check" />
              <span>{{ role }}</span>
            </label>
          </div>
          <div class="efs-popup-section">GND</div>
          <div class="efs-popup-list">
            <label
              v-for="role in essaGndRoles"
              :key="role"
              class="efs-popup-item efs-popup-item--start"
              :class="{ selected: draftEssaRoles.includes(role) }"
            >
              <input v-model="draftEssaRoles" type="checkbox" :value="role" class="essa-role-check" />
              <span>{{ role }}</span>
            </label>
          </div>
          <div class="efs-popup-section">CD</div>
          <div class="efs-popup-list">
            <label
              v-for="role in essaCdRoles"
              :key="role"
              class="efs-popup-item efs-popup-item--start"
              :class="{ selected: draftEssaRoles.includes(role) }"
            >
              <input v-model="draftEssaRoles" type="checkbox" :value="role" class="essa-role-check" />
              <span>{{ role }}</span>
            </label>
          </div>
          <div class="essa-roles-actions">
            <button type="button" class="efs-popup-footer essa-roles-action" @click="essaRolesDialog = false">Cancel</button>
            <button type="button" class="efs-popup-footer essa-roles-action" @click="onEssaRolesAuto">Auto</button>
            <button type="button" class="efs-popup-footer essa-roles-action" @click="onEssaRolesOk">OK</button>
          </div>
        </div>
      </v-dialog>
      <!-- Airports (+ ATIS/QNH when several): classic 1RWY/2RWY / RTC (hidden ESSA roles + paper) -->
      <template v-if="!efs.essaRolesMode && !efs.isPaperLook">
      <span
        v-for="info in atisDisplayItems"
        :key="info.airport"
        class="ml-3 airport-atis"
        :class="{
          'airport-atis--idle': info.idle,
          'airport-atis--open': !info.idle && efs.multiAirport,
          'airport-atis--selected': efs.pendingIdleSwap === info.airport,
          'airport-atis--new': info.newlyActive,
        }"
        :title="airportTitle(info)"
        @click.stop="onAirportClick(info)"
      >
        <span class="airport-icao" :class="info.idle ? 'text-grey' : 'text-grey-darken-1'">{{ info.airport }}</span>
        <!-- Several airports: ATIS + RWY + QNH beside each ICAO. Single: ICAO (+ RWY) only; ATIS/QNH on right. -->
        <template v-if="showLeftAtisQnh">
          <template v-if="info.split">
            <span class="text-amber ml-1" v-if="info.arrAtis">{{ info.arrAtis }}</span>
            <span class="text-grey-darken-2 ml-1" v-if="info.arrRunways">{{ info.arrRunways }}</span>
            <span class="text-cyan ml-1" v-if="info.depAtis">{{ info.depAtis }}</span>
            <span class="text-grey-darken-2 ml-1" v-if="info.depRunways">{{ info.depRunways }}</span>
          </template>
          <template v-else>
            <span class="text-amber ml-1" v-if="info.atis">{{ info.atis }}</span>
            <span class="text-grey-darken-2 ml-1" v-if="info.runways">{{ info.runways }}</span>
          </template>
          <span class="text-grey ml-1" v-if="info.qnh">{{ info.qnh }}</span>
        </template>
        <template v-else>
          <template v-if="info.split">
            <span class="text-grey-darken-2 ml-1" v-if="info.arrRunways">{{ info.arrRunways }}</span>
            <span class="text-grey-darken-2 ml-1" v-if="info.depRunways">{{ info.depRunways }}</span>
          </template>
          <span v-else-if="info.runways" class="text-grey-darken-2 ml-1">{{ info.runways }}</span>
        </template>
      </span>
      <!-- Fallback: show airports without ATIS data (non-MULTIAPT) -->
      <span v-if="atisDisplayItems.length === 0 && efs.displayAirports.length > 0" class="text-grey-darken-1 ml-2">
        {{ efs.displayAirports.join(' ') }}
      </span>
      <span v-if="efs.multiAirport && efs.pendingIdleSwap" class="idle-hint ml-2">
        → click a column for {{ efs.pendingIdleSwap }}
      </span>
      </template>
      <div v-if="showDclControls" class="top-status-cluster">
        <v-btn
          variant="text"
          size="small"
          class="dcl-btn"
          :class="{
            'text-grey': !dclConnected,
            'text-green': dclConnected,
            'text-red': efs.dclStatus === 'error',
          }"
          :title="dclTooltip"
          @click="onDclClick"
        >
          {{ dclConnected ? 'DCL' : 'DCL: Voice' }}
        </v-btn>
        <span
          v-if="dclAirportTaken"
          class="dcl-other-status text-green"
          :title="dclOtherTooltip"
        >OTHER</span>
        <v-menu v-if="dclConnected" location="bottom" offset="4">
          <template v-slot:activator="{ props }">
            <v-btn
              variant="text"
              size="small"
              class="dcl-mode-btn text-grey"
              v-bind="props"
              :title="`DCL mode: ${efs.dclMode.toUpperCase()}`"
            >
              {{ efs.dclMode.toUpperCase() }}
              <v-icon end size="x-small">mdi-chevron-down</v-icon>
            </v-btn>
          </template>
          <div class="efs-popup-menu" @click.stop>
            <div class="efs-popup-header">DCL mode</div>
            <div class="efs-popup-list">
              <button
                v-for="mode in dclModes"
                :key="mode.value"
                type="button"
                class="efs-popup-item"
                :class="{ selected: mode.value === efs.dclMode }"
                @click="efs.dclSetMode(mode.value)"
              >{{ mode.label }}</button>
            </div>
          </div>
        </v-menu>
        <span
          v-if="efs.esggRolesMode"
          class="essa-status-btn esgg-rwy-label"
          :title="esggRwyTitle"
        >{{ esggRwyLabel }}</span>
      </div>
      <v-spacer />
      <!-- Config selector (chevron only — name lives in the menu) -->
      <v-menu
        v-if="efs.availableConfigs.length > 1"
        v-model="configMenuOpen"
        offset-y
        :close-on-content-click="false"
      >
        <template v-slot:activator="{ props }">
          <v-btn
            variant="text"
            size="small"
            class="text-grey top-config-btn"
            v-bind="props"
            title="Switch configuration"
            aria-label="Switch configuration"
          >
            <v-icon size="x-small">mdi-chevron-down</v-icon>
          </v-btn>
        </template>
        <div class="efs-popup-menu efs-popup-menu--wide" @click.stop>
          <div class="efs-popup-header">Configuration</div>
          <div class="efs-popup-list">
            <button
              v-for="config in efs.availableConfigs"
              :key="config.file"
              type="button"
              class="efs-popup-item"
              :class="{ selected: config.file === efs.activeConfig }"
              @click="onConfigClick(config.file)"
            >
              <span class="efs-popup-item-title">{{ config.name }}</span>
              <span
                v-if="isRtcConfig(config) && config.file === efs.activeConfig"
                class="column-count-ctrl"
                @click.stop
              >
                <button
                  type="button"
                  class="column-count-btn"
                  :disabled="!efs.multiAirport || efs.columnCount <= 1"
                  title="Fewer columns"
                  @click="efs.adjustColumnCount(-1)"
                >−</button>
                <span class="column-count-label" :title="`${efs.columnCount} columns`">{{ efs.columnCount }}</span>
                <button
                  type="button"
                  class="column-count-btn"
                  :disabled="!efs.multiAirport || efs.columnCount >= 6"
                  title="More columns"
                  @click="efs.adjustColumnCount(1)"
                >+</button>
              </span>
              <span
                v-else-if="isEsggPaperConfig(config) && config.file === efs.activeConfig"
                class="column-count-ctrl"
                title="Columns visible on screen (scroll for the rest)"
                @click.stop
              >
                <button
                  type="button"
                  class="column-count-btn"
                  :disabled="efs.esggVisibleColumns <= 2"
                  title="Fewer columns on screen"
                  @click="efs.adjustEsggVisibleColumns(-1)"
                >−</button>
                <span
                  class="column-count-label"
                  :title="`${efs.esggVisibleColumns} visible`"
                >{{ efs.esggVisibleColumns }}</span>
                <button
                  type="button"
                  class="column-count-btn"
                  :disabled="efs.esggVisibleColumns >= 5"
                  title="More columns on screen"
                  @click="efs.adjustEsggVisibleColumns(1)"
                >+</button>
              </span>
            </button>
          </div>
        </div>
      </v-menu>

      <!-- Right chrome (L→R): SEP/DLV/GAP (ESSA) · ATIS · QNH · OK/OFF · Fullscreen -->
      <div class="top-right-chrome">
        <!-- SEP/DLV/DEP GAP — ESSA roles; TWR can edit, GND/CD view-only -->
        <div
          v-if="efs.essaRolesMode"
          class="top-sep-group"
          :title="canEditSepIndicators ? 'Separation (TWR: click to cycle; ends with auto)' : 'Separation (information only — managed by TWR)'"
        >
          <div
            class="top-sep-cell"
            :class="{ 'is-editable': canEditSepIndicators, 'is-overridden': efs.isEssaSepOverrideActive('sep') }"
            @click="onSepFieldClick('sep')"
          >
            <span class="top-sep-lbl">SEP</span>
            <span class="top-sep-val">{{ sepIndicators.sep || '—' }}</span>
          </div>
          <div
            class="top-sep-cell"
            :class="{ 'is-editable': canEditSepIndicators, 'is-overridden': efs.isEssaSepOverrideActive('dlv') }"
            title="Delivery separation APP→TWR"
            @click="onSepFieldClick('dlv')"
          >
            <span class="top-sep-lbl">DLV</span>
            <span class="top-sep-val">{{ sepIndicators.dlv || '—' }}</span>
          </div>
          <div
            class="top-sep-cell"
            :class="{ 'is-editable': canEditSepIndicators, 'is-overridden': efs.isEssaSepOverrideActive('depGap') }"
            @click="onSepFieldClick('depGap')"
          >
            <span class="top-sep-lbl">DEP GAP</span>
            <span class="top-sep-val">{{ sepIndicators.depGap || '—' }}</span>
          </div>
        </div>

        <!-- ATIS / QNH right: single-airport classic, ESSA, paper (multi → left / bay headers) -->
        <template v-if="showRightAtisQnh">
          <div
            v-if="topAtisEntries.length"
            class="top-atis"
            :class="{ 'is-changed': topAtisChanged }"
            :title="topAtisTitle"
          >
            <span class="top-atis-lbl">ATIS</span>
            <span
              v-for="(entry, i) in topAtisEntries"
              :key="`${entry.kind}-${entry.letter}-${i}`"
              class="top-atis-letter"
              :class="{
                'is-changed': topAtisChanged,
                'is-arr': !topAtisChanged && entry.kind === 'arr',
                'is-dep': !topAtisChanged && entry.kind === 'dep',
              }"
            >{{ entry.letter }}</span>
          </div>

          <button
            v-if="topQnh != null"
            type="button"
            class="top-qnh"
            :class="{ 'is-changed': topQnhChanged }"
            :title="topQnhTitle"
            @pointerdown="onTopQnhPointerDown"
            @pointerup="onTopQnhPointerUp"
            @pointerleave="onTopQnhPointerCancel"
            @pointercancel="onTopQnhPointerCancel"
            @click="onTopQnhClick"
          >
            <span class="top-qnh-val">{{ topQnh }}</span><span class="top-qnh-unit"> hpa</span>
          </button>
        </template>

        <div
          ref="connBtnWrap"
          class="top-conn-wrap"
          @mouseenter="onConnBtnEnter"
          @mouseleave="onConnBtnLeave"
        >
          <button
            type="button"
            class="top-conn-btn"
            :class="{
              'is-ok': connOk,
              'is-off': !connOk,
              'is-icon': showConnReloadIcon,
            }"
            :title="connTitle"
            @click="onConnReload"
          >
            <v-icon v-if="showConnReloadIcon" :size="connIconSize" aria-hidden="true">mdi-autorenew</v-icon>
            <span v-else class="top-conn-label">{{ connOk ? 'OK' : 'ERR' }}</span>
          </button>
        </div>
        <Teleport to="body">
          <div
            v-if="connStatusOpen"
            class="efs-popup-menu top-conn-status"
            :style="connStatusStyle"
            @mouseenter="onConnStatusEnter"
            @mouseleave="onConnStatusLeave"
            @click.stop
          >
            <div class="efs-popup-header">Status</div>
            <div class="top-conn-cols">
              <div class="top-conn-col">
                <div class="efs-popup-section">Versions</div>
                <div class="efs-popup-item efs-popup-item--stack is-disabled">
                  <span class="efs-popup-item-title">VatEFS</span>
                  <span class="efs-popup-item-sub">{{ efs.backendVersion || '-' }}</span>
                </div>
                <div class="efs-popup-item efs-popup-item--stack is-disabled">
                  <span class="efs-popup-item-title">ES plugin (loaded)</span>
                  <span
                    class="efs-popup-item-sub"
                    :class="{ 'conn-err': !efs.pluginConnected || !efs.pluginVersion }"
                  >{{ efs.pluginConnected && efs.pluginVersion ? efs.pluginVersion : 'Not loaded' }}</span>
                </div>

                <div class="efs-popup-section">Network</div>
                <div class="efs-popup-item efs-popup-item--stack is-disabled">
                  <span class="efs-popup-item-title">Backend</span>
                  <span
                    class="efs-popup-item-sub"
                    :class="{ 'conn-err': !efs.connected }"
                  >{{ efs.connected ? 'Connected' : 'Not connected' }}</span>
                </div>
                <div
                  v-for="row in networkFeedRows"
                  :key="row.key"
                  class="efs-popup-item efs-popup-item--stack is-disabled"
                >
                  <span class="efs-popup-item-title">{{ row.title }}</span>
                  <span
                    class="efs-popup-item-sub"
                    :class="{ 'conn-err': !row.ok }"
                  >{{ row.detail }}</span>
                </div>
              </div>

              <div class="top-conn-col">
                <div class="efs-popup-section">Session</div>
                <div class="efs-popup-item efs-popup-item--stack is-disabled">
                  <span class="efs-popup-item-title">Active position</span>
                  <span class="efs-popup-item-sub">{{ efs.myCallsign || '-' }}</span>
                </div>
                <div class="efs-popup-item efs-popup-item--stack is-disabled">
                  <span class="efs-popup-item-title">Detected SI</span>
                  <span class="efs-popup-item-sub">{{ detectedSiLabel }}</span>
                </div>
                <div v-if="efs.myRole" class="efs-popup-item efs-popup-item--stack is-disabled">
                  <span class="efs-popup-item-title">Role</span>
                  <span class="efs-popup-item-sub">{{ efs.myRole }}</span>
                </div>
                <div class="efs-popup-item efs-popup-item--stack is-disabled">
                  <span class="efs-popup-item-title">airports</span>
                  <span class="efs-popup-item-sub">{{ menuAirportsLabel }}</span>
                </div>
                <div class="efs-popup-item efs-popup-item--stack is-disabled">
                  <span class="efs-popup-item-title">ES selected RWYs</span>
                  <span class="efs-popup-item-sub">{{ menuEsRwysLabel }}</span>
                </div>

                <div class="efs-popup-section">Parsing</div>
                <div
                  v-for="row in parsingFeedRows"
                  :key="row.key"
                  class="efs-popup-item efs-popup-item--stack is-disabled"
                >
                  <span class="efs-popup-item-title">{{ row.title }}</span>
                  <span
                    class="efs-popup-item-sub"
                    :class="{
                      'conn-err': !row.ok,
                      'conn-path': row.key === 'euroscopeDir' || row.key === 'cdmLocal',
                    }"
                  >{{ row.detail }}</span>
                </div>
              </div>
            </div>
            <button
              type="button"
              class="efs-popup-item top-conn-reload-btn"
              :disabled="feedsReloading"
              @click="onReloadFeeds"
            >
              {{ feedsReloading ? 'Reloading…' : 'Reload all' }}
            </button>
          </div>
        </Teleport>

        <!-- ESSA / OTHER: right arrow catalog. Else fullscreen. -->
        <v-menu
          v-if="efs.workspaceMode"
          v-model="rightMenuOpen"
          location="bottom end"
          offset="4"
        >
          <template #activator="{ props: menuProps }">
            <button
              type="button"
              class="top-menu-btn top-fs-btn"
              :class="{ 'is-open': rightMenuOpen }"
              title="Catalog"
              v-bind="menuProps"
            >
              <span class="top-menu-tri top-menu-tri--right" aria-hidden="true" />
            </button>
          </template>
          <div
            class="efs-popup-menu efs-popup-menu--wide efs-popup-menu--bay-fill"
            :style="catalogMaxHStyle"
            @click.stop
          >
            <div class="efs-popup-list">
              <button
                type="button"
                class="efs-popup-item"
                @click="onRightHandover"
              >
                Handover Assistant
              </button>
              <!-- ESSA: saved layouts dialog -->
              <button
                v-if="efs.essaRolesMode"
                type="button"
                class="efs-popup-item efs-popup-item--start"
                @click="onRightLayouts"
              >
                <span>Layout</span>
                <span
                  class="column-count-ctrl"
                  title="Number of bays"
                  @click.stop
                  @pointerdown.stop
                >
                  <button
                    type="button"
                    class="column-count-btn"
                    :disabled="ws.columnCount.value <= 1"
                    title="Fewer bays"
                    @click="ws.adjustColumnCount(-1, efs.layout)"
                  >−</button>
                  <span
                    class="column-count-label"
                    :title="`${ws.columnCount.value} bays`"
                  >{{ ws.columnCount.value }}</span>
                  <button
                    type="button"
                    class="column-count-btn"
                    :disabled="ws.columnCount.value >= 6"
                    title="More bays"
                    @click="ws.adjustColumnCount(1, efs.layout)"
                  >+</button>
                </span>
              </button>
              <!-- OTHER: same Layout dialog as ESSA (profiles + saved) -->
              <button
                v-if="efs.saabLayoutsMode"
                type="button"
                class="efs-popup-item efs-popup-item--start"
                @click="onRightLayouts"
              >
                <span>Layout</span>
                <span
                  class="column-count-ctrl"
                  title="Number of bays"
                  @click.stop
                  @pointerdown.stop
                >
                  <button
                    type="button"
                    class="column-count-btn"
                    :disabled="ws.columnCount.value <= 1"
                    title="Fewer bays"
                    @click="ws.adjustColumnCount(-1, efs.layout)"
                  >−</button>
                  <span
                    class="column-count-label"
                    :title="`${ws.columnCount.value} bays`"
                  >{{ ws.columnCount.value }}</span>
                  <button
                    type="button"
                    class="column-count-btn"
                    :disabled="ws.columnCount.value >= 6"
                    title="More bays"
                    @click="ws.adjustColumnCount(1, efs.layout)"
                  >+</button>
                </span>
              </button>
              <!-- ESSA-only info strips -->
              <template v-if="efs.essaRolesMode">
                <template v-for="folder in infoCatalogFolders" :key="folder.id">
                  <button
                    type="button"
                    class="efs-popup-section efs-popup-folder"
                    :aria-expanded="!!catalogInfoFolderOpen[folder.id]"
                    @click.stop="toggleInfoFolder(folder.id)"
                  >
                    <span>{{ folder.label }}</span>
                    <span
                      class="efs-popup-folder-chevron"
                      :class="{ 'is-open': catalogInfoFolderOpen[folder.id] }"
                      aria-hidden="true"
                    />
                  </button>
                  <template v-if="catalogInfoFolderOpen[folder.id]">
                    <button
                      v-for="entry in folder.items"
                      :key="`${entry.kind}:${entry.forceKey}`"
                      type="button"
                      class="efs-popup-item"
                      :class="{ 'is-disabled': entry.shown || !entry.available }"
                      :disabled="entry.shown || !entry.available"
                      @click="onShowInfoStrip(entry)"
                    >{{ entry.label }}</button>
                  </template>
                </template>
              </template>
              <template v-if="showRwyFlagTable">
                <button
                  type="button"
                  class="efs-popup-section efs-popup-folder"
                  :aria-expanded="!!catalogInfoFolderOpen.rwyClosed"
                  @click.stop="toggleInfoFolder('rwyClosed')"
                >
                  <span>Runway closed</span>
                  <span
                    class="efs-popup-folder-chevron"
                    :class="{ 'is-open': catalogInfoFolderOpen.rwyClosed }"
                    aria-hidden="true"
                  />
                </button>
                <template v-if="catalogInfoFolderOpen.rwyClosed">
                  <button
                    v-for="row in rwyFlagRows"
                    :key="'clsd-' + row.sectionId"
                    type="button"
                    class="efs-popup-item"
                    :class="{ 'is-disabled': row.closed }"
                    :disabled="row.closed"
                    @click="onShowRwyFlag(row.sectionId, 'rwyClosed')"
                  >{{ row.label }}</button>
                </template>
                <button
                  type="button"
                  class="efs-popup-section efs-popup-folder"
                  :aria-expanded="!!catalogInfoFolderOpen.rwyVehicle"
                  @click.stop="toggleInfoFolder('rwyVehicle')"
                >
                  <span>Runway vehicle</span>
                  <span
                    class="efs-popup-folder-chevron"
                    :class="{ 'is-open': catalogInfoFolderOpen.rwyVehicle }"
                    aria-hidden="true"
                  />
                </button>
                <template v-if="catalogInfoFolderOpen.rwyVehicle">
                  <button
                    v-for="row in rwyFlagRows"
                    :key="'occ-' + row.sectionId"
                    type="button"
                    class="efs-popup-item"
                    :class="{ 'is-disabled': row.occupied }"
                    :disabled="row.occupied"
                    @click="onShowRwyFlag(row.sectionId, 'rwyOccupied')"
                  >{{ row.label }}</button>
                </template>
              </template>
              <button
                type="button"
                class="efs-popup-section efs-popup-folder"
                :aria-expanded="catalogSectionsOpen"
                @click.stop="catalogSectionsOpen = !catalogSectionsOpen"
              >
                <span>Sections</span>
                <span
                  class="efs-popup-folder-chevron"
                  :class="{ 'is-open': catalogSectionsOpen }"
                  aria-hidden="true"
                />
              </button>
              <template v-if="catalogSectionsOpen">
                <button
                  type="button"
                  class="efs-popup-item"
                  @click="onAddEmptyHeader"
                >Empty divider</button>
                <button
                  v-for="sec in sectionCatalog"
                  :key="`${sec.sectionId}::${sec.title}`"
                  type="button"
                  class="efs-popup-item"
                  :class="[
                    catalogSectionTintClass(sec),
                    { 'is-disabled': sec.present },
                  ]"
                  :disabled="sec.present"
                  :draggable="!sec.present"
                  @click="onAddSection(sec)"
                  @dragstart="onCatalogSectionDragStart($event, sec)"
                >{{ sec.title }}</button>
              </template>
            </div>
          </div>
        </v-menu>
        <button
          v-else-if="!isStandalone"
          type="button"
          class="top-menu-btn top-fs-btn"
          :class="{ 'is-fullscreen': fullscreen }"
          :title="fullscreen ? 'Exit fullscreen' : 'Fullscreen'"
          @click="fullscreen ? exitFullScreen() : requestFullScreen()"
        >
          <v-icon :size="fsIconSize" aria-hidden="true">
            {{ fullscreen ? 'mdi-fullscreen-exit' : 'mdi-fullscreen' }}
          </v-icon>
        </button>
      </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from "vue"
import { useEfsStore } from "../store/efs"
import { useEfsChromeScaleValue } from "@/composables/useEfsUiScale"
import type { ConfigInfo, DclMode } from "@vatefs/common"
import {
  ESSA_RWY_COMBINATIONS,
  formatEssaRwyConfigLabel,
  formatEssaRwyPdfName,
  findMatchingEssaRwyConfigs,
  resolveEssaRwyConfigId,
  essaRwyQuickrefImageUrl,
} from "@vatefs/common"
import { getWorkspace } from "@/workspace"
import { useInfoStripMenu } from "@/composables/useInfoStrips"
import {
  useRwyFlagMenu,
  setRwyFlagActive,
  type RwyFlagKind,
} from "@/composables/useRunwayFlagStrips"
import TrashDialog from "./TrashDialog.vue"

const efs = useEfsStore()
const ws = getWorkspace()
const chromeScale = useEfsChromeScaleValue()
const fsIconSize = computed(() => Math.max(16, Math.round(20 * chromeScale.value)))
const trashOpen = ref(false)
const trashDragOver = ref(false)
const rightMenuOpen = ref(false)
/** Info strip / RWY / Sections folders — closed each time the catalog opens. */
const catalogSectionsOpen = ref(false)
const catalogInfoFolderOpen = ref<Record<string, boolean>>({})
/** Max height for top-right catalog = bay body height; scrollbar only if content overflows. */
const catalogMaxHPx = ref(0)
const catalogMaxHStyle = computed(() =>
  catalogMaxHPx.value > 0
    ? { '--efs-popup-bay-fill-max-h': `${catalogMaxHPx.value}px` }
    : undefined,
)
const infoMenu = useInfoStripMenu()
const infoCatalogFolders = computed(() => infoMenu.folders.value)
const {
  showTable: showRwyFlagTable,
  rows: rwyFlagRows,
} = useRwyFlagMenu()
const sectionCatalog = computed(() =>
  ws.catalogSections(efs.layout, efs.essaRoles, {
    mode: efs.saabLayoutsMode && !efs.essaRolesMode ? 'saab' : 'essa',
  }),
)

function toggleInfoFolder(id: string) {
  catalogInfoFolderOpen.value = {
    ...catalogInfoFolderOpen.value,
    [id]: !catalogInfoFolderOpen.value[id],
  }
}

function onShowRwyFlag(sectionId: string, kind: RwyFlagKind) {
  setRwyFlagActive(kind, sectionId, true)
  rightMenuOpen.value = false
}

function refreshCatalogMaxHeight() {
  const bay = document.querySelector('.efs-bay-content') as HTMLElement | null
  const h = bay?.getBoundingClientRect().height
  catalogMaxHPx.value = h && h > 80 ? Math.floor(h) : Math.max(200, window.innerHeight - 96)
}

watch(rightMenuOpen, async (open) => {
  if (!open) return
  catalogSectionsOpen.value = false
  catalogInfoFolderOpen.value = {}
  await nextTick()
  refreshCatalogMaxHeight()
})

function onTrashDragOver() {
  trashDragOver.value = true
}
function onTrashDragEnter() {
  trashDragOver.value = true
}
function onTrashDragLeave(e: DragEvent) {
  const related = e.relatedTarget as Node | null
  const btn = e.currentTarget as HTMLElement
  if (related && btn.contains(related)) return
  trashDragOver.value = false
}
function onTrashDrop(e: DragEvent) {
  trashDragOver.value = false
  const raw = e.dataTransfer?.getData('application/json')
  if (!raw) return
  try {
    const data = JSON.parse(raw) as { stripId?: string }
    if (data.stripId) efs.deleteStrip(data.stripId)
  } catch {
    /* ignore */
  }
}
function onRightHandover() {
  rightMenuOpen.value = false
  efs.openHandoverAssistant({ reason: 'menu' })
}
function onRightLayouts() {
  rightMenuOpen.value = false
  ws.openLayoutMenu()
}
function onShowInfoStrip(entry: Parameters<typeof infoMenu.showEntry>[0]) {
  if (!entry.available || entry.shown) return
  infoMenu.showEntry(entry)
  rightMenuOpen.value = false
}
function onAddEmptyHeader() {
  ws.addEmptyHeader(Math.max(0, ws.columnCount.value - 1))
  rightMenuOpen.value = false
}
function onAddSection(sec: { sectionId: string; title: string; present?: boolean }) {
  if (sec.present) return
  ws.addSectionFromCatalog(sec.sectionId, sec.title, 0, efs.layout)
  if (efs.saabLayoutsMode) {
    // Synthetic CTR header — ensure strip targets, not a server "ctr" section
    if (sec.sectionId === 'ctr' && sec.title === 'CTR') {
      efs.saabEnsureSection('ctr_arr', 'CTR')
      efs.saabEnsureSection('ctr_dep', 'CTR')
    } else {
      efs.saabEnsureSection(sec.sectionId, sec.title)
      // DEP covers pending_dep + cleared; TMA / CTR covers ctr*
      if (sec.sectionId === 'pending_dep' && sec.title === 'DEP') {
        efs.saabEnsureSection('cleared', 'DEP')
      }
      if (sec.sectionId === 'ctr_arr' && sec.title === 'TMA / CTR') {
        efs.saabEnsureSection('ctr_dep', 'TMA / CTR')
        efs.saabEnsureSection('tma', 'TMA / CTR')
      }
      if (sec.sectionId === 'tma' && sec.title === 'TMA') {
        efs.saabEnsureSection('tma', 'TMA')
      }
      if (sec.sectionId === 'pending_dep' && sec.title === 'PENDING CLR') {
        efs.saabEnsureSection('pending_dep', 'PENDING CLR')
      }
      if (sec.sectionId === 'cleared' && sec.title === 'CLEARED') {
        efs.saabEnsureSection('cleared', 'CLEARED')
      }
    }
  }
  rightMenuOpen.value = false
}

function onCatalogSectionDragStart(
  e: DragEvent,
  sec: { sectionId: string; title: string; present?: boolean },
) {
  if (sec.present) {
    e.preventDefault()
    return
  }
  e.dataTransfer?.setData(
    'application/x-vatefs-catalog-section',
    JSON.stringify({ sectionId: sec.sectionId, title: sec.title }),
  )
  e.dataTransfer!.effectAllowed = 'copy'
}

/** Match ESSA section-header tints (runway red / inbound turquoise). */
function catalogSectionTintClass(sec: { sectionId: string; title: string }): string | undefined {
  const id = sec.sectionId.toLowerCase()
  const title = (sec.title || '').toUpperCase()
  if (
    id.includes('runway') ||
    title === 'RUNWAY' ||
    title.startsWith('RUNWAY ')
  ) {
    return 'efs-popup-item--essa-runway'
  }
  if (
    id === 'inbound' ||
    id.startsWith('inbound_') ||
    id.endsWith('_inbound') ||
    title === 'INBOUND' ||
    title.startsWith('INBOUND ')
  ) {
    return 'efs-popup-item--essa-inbound'
  }
  return undefined
}
const connIconSize = computed(() => Math.max(16, Math.round(18 * chromeScale.value)))
/** OK only when backend WS + EuroScope plugin are both live */
const connOk = computed(() => efs.connected && efs.pluginConnected)
/** Prefer UDP bind conflict detail when plugin feed reports it */
const connTitle = computed(() => {
  if (connOk.value) return 'Connected - click to reload'
  const plugin = efs.feeds?.plugin
  if (plugin && !plugin.ok && plugin.detail?.includes('UDP')) {
    return `${plugin.detail} - click to reload`
  }
  return 'Not fully connected - click to reload'
})

const detectedSiLabel = computed(() => {
  const si = efs.myPositionId
  if (!si) return '-'
  const freq = efs.myFrequency
  if (typeof freq === 'number' && Number.isFinite(freq) && freq > 0) {
    return `${si} (${freq.toFixed(3)})`
  }
  return si
})

const feedsReloading = ref(false)
async function onReloadFeeds() {
  if (feedsReloading.value) return
  feedsReloading.value = true
  efs.reloadAll()
  // Server has no ack; brief UI feedback then clear
  window.setTimeout(() => {
    feedsReloading.value = false
  }, 1500)
}

type FeedRow = { key: string; title: string; ok: boolean; detail: string }

const networkFeedRows = computed((): FeedRow[] => {
  const f = efs.feeds
  const miss = { ok: false, detail: '-' }
  const rows: { key: keyof NonNullable<typeof f>; title: string }[] = [
    { key: 'plugin', title: 'EuroScope plugin' },
    { key: 'hoppie', title: 'Hoppie / DCL' },
    { key: 'viff', title: 'vIFF / CDM' },
    { key: 'atis', title: 'VATSIM ATIS' },
    { key: 'afv', title: 'AFV transceivers' },
    { key: 'irisSync', title: 'IRIS Sync' },
    { key: 'ctr', title: 'CTR / TIZ (LFV)' },
  ]
  return rows.map(({ key, title }) => {
    const item = f?.[key] ?? miss
    return { key, title, ok: item.ok, detail: item.detail }
  })
})

const parsingFeedRows = computed((): FeedRow[] => {
  const f = efs.feeds
  const miss = { ok: false, detail: '-' }
  const rows: { key: keyof NonNullable<typeof f>; title: string }[] = [
    { key: 'euroscopeDir', title: 'ES directory' },
    { key: 'hoppieConfig', title: 'Hoppie config files' },
    { key: 'cdmLocal', title: 'Local CDM data files' },
    { key: 'stands', title: 'GRP stands' },
    { key: 'eseSid', title: 'ESE SIDs / COPX' },
    { key: 'eseAirspace', title: 'ESE airspace' },
    { key: 'topskyAirspace', title: 'TopSkyAirspace' },
  ]
  return rows.map(({ key, title }) => {
    const item = f?.[key] ?? miss
    return { key, title, ok: item.ok, detail: item.detail }
  })
})

const fullscreen = ref(window.innerHeight == screen.height)
const isStandalone = ('standalone' in navigator && (navigator as any).standalone) || window.matchMedia('(display-mode: standalone)').matches
const configMenuOpen = ref(false)

/** Display / picker order: CD → GND-* → TWR-E, TWR-W */
const ESSA_ROLE_ORDER = ['CD', 'GND-E', 'GND-N', 'GND-W', 'TWR-E', 'TWR-W'] as const
const essaCdRoles = ['CD'] as const
const essaGndRoles = ['GND-E', 'GND-N', 'GND-W'] as const
const essaTwrRoles = ['TWR-E', 'TWR-W'] as const
const essaRolesDialog = ref(false)
const draftEssaRoles = ref<string[]>([])

const essaRwyDialog = ref(false)
const draftEssaRwyId = ref<string | null>(null)
/** Minute tick so night/day letter auto-switch updates without ES change */
const essaRwyNowTick = ref(Date.now())
let essaRwyTickTimer: ReturnType<typeof setInterval> | null = null
const essaRwyQuickrefVisible = ref(false)
const essaRwyQuickrefPos = ref({ top: 0, left: 0 })
let essaRwyHoverShowTimer: ReturnType<typeof setTimeout> | null = null

const connStatusOpen = ref(false)
const connBtnHover = ref(false)
const connBtnWrap = ref<HTMLElement | null>(null)
const connStatusPos = ref({ top: 0, left: 0 })
let connStatusHideTimer: ReturnType<typeof setTimeout> | null = null

const showConnReloadIcon = computed(() => connBtnHover.value || connStatusOpen.value)

const connStatusStyle = computed(() => ({
  top: `${connStatusPos.value.top}px`,
  left: `${connStatusPos.value.left}px`,
}))

function placeConnStatus() {
  const el = connBtnWrap.value
  if (!el) return
  const r = el.getBoundingClientRect()
  const width = Math.min(560, window.innerWidth - 8)
  let left = r.right - width
  if (left < 4) left = 4
  connStatusPos.value = { top: r.bottom + 6, left }
}

function openConnStatus() {
  if (connStatusHideTimer) {
    clearTimeout(connStatusHideTimer)
    connStatusHideTimer = null
  }
  placeConnStatus()
  connStatusOpen.value = true
}

function scheduleCloseConnStatus() {
  if (connStatusHideTimer) clearTimeout(connStatusHideTimer)
  connStatusHideTimer = setTimeout(() => {
    connStatusHideTimer = null
    connStatusOpen.value = false
  }, 120)
}

function onConnBtnEnter() {
  connBtnHover.value = true
  openConnStatus()
}

function onConnBtnLeave() {
  connBtnHover.value = false
  scheduleCloseConnStatus()
}

function onConnStatusEnter() {
  openConnStatus()
}

function onConnStatusLeave() {
  scheduleCloseConnStatus()
}

function onConnReload() {
  efs.refresh()
}

const menuAirportsLabel = computed(() => {
  const configured = efs.myAirports.length ? efs.myAirports.join(', ') : '-'
  const es = efs.esAirports.length ? efs.esAirports.join(', ') : null
  if (es && es !== configured) return `${configured} · ES: ${es}`
  return configured
})

const menuEsRwysLabel = computed(() => {
  const airports =
    efs.esAirports.length > 0
      ? efs.esAirports
      : efs.myAirports.length > 0
        ? efs.myAirports
        : efs.atisInfo.map((a) => a.airport)
  if (airports.length === 0) return '-'
  const parts = airports.map((apt) => {
    const info = efs.atisInfo.find((a) => a.airport === apt)
    if (!info) return `${apt}: -`
    const arr = info.arrRunways?.length ? info.arrRunways.join('/') : '-'
    const dep = info.depRunways?.length ? info.depRunways.join('/') : '-'
    return `${apt} ARR ${arr} / DEP ${dep}`
  })
  return parts.join(' · ')
})

function sortEssaRolesDisplay(roles: string[]): string[] {
  const order = new Map(ESSA_ROLE_ORDER.map((r, i) => [r, i]))
  return [...roles].sort((a, b) => (order.get(a as typeof ESSA_ROLE_ORDER[number]) ?? 99) - (order.get(b as typeof ESSA_ROLE_ORDER[number]) ?? 99))
}

const essaRolesLabel = computed(() => {
  const roles = sortEssaRolesDisplay(efs.essaRoles)
  return roles.length > 0 ? roles.join(', ') : '(none)'
})

const essaRwyStatusTitle = computed(() => {
  const label = essaRwyLabel.value || 'Select RWY config'
  return efs.essaRwyConfigManual ? `${label} (manual override)` : label
})

const essaRolesStatusTitle = computed(() => {
  return efs.essaRolesManual
    ? `ESSA roles (manual override): ${essaRolesLabel.value}`
    : 'ESSA roles (auto)'
})

function sortEsggRolesDisplay(roles: string[]): string[] {
  const order = ['TWR', 'GND', 'CD']
  return [...roles].sort((a, b) => order.indexOf(a) - order.indexOf(b))
}

const esggRolesLabel = computed(() => {
  const roles = sortEsggRolesDisplay(efs.esggRoles)
  return roles.length ? roles.join(', ') : '-'
})

const esggRolesStatusTitle = computed(
  () =>
    `Covering (from your position + who is online below): ${esggRolesLabel.value}`,
)

/** Active ESGG runway(s) from ATIS / rwyconfig — only 03 / 21. */
const esggRwyLabel = computed(() => {
  const info = efs.atisInfo.find((a) => a.airport.toUpperCase() === 'ESGG')
  if (!info) return 'RWY: -'
  const arr = info.arrRunways ?? []
  const dep = info.depRunways ?? []
  const set = new Set<string>()
  for (const r of [...arr, ...dep]) {
    const m = (r || '').trim().toUpperCase().match(/^(\d{1,2})/)
    if (!m) continue
    const n = String(parseInt(m[1]!, 10)).padStart(2, '0')
    if (n === '03' || n === '21') set.add(n)
  }
  if (!set.size) return 'RWY: -'
  return `RWY: ${[...set].join('/')}`
})

const esggRwyTitle = computed(() => esggRwyLabel.value)

/** Active ESSA ARR/DEP from EuroScope (via ATIS/rwyconfig) */
const essaEsRunways = computed(() => {
  const info = efs.atisInfo.find(a => a.airport === 'ESSA') ?? efs.atisInfo[0]
  if (!info) return { arr: [] as string[], dep: [] as string[] }
  return { arr: info.arrRunways ?? [], dep: info.depRunways ?? [] }
})

// When ES runway selection changes, drop manual config and follow ES
watch(
  essaEsRunways,
  ({ arr, dep }) => {
    efs.syncEssaRwyConfigFromEs(arr, dep)
  },
  { deep: true },
)

const essaRwyEsHint = computed(() => {
  const { arr, dep } = essaEsRunways.value
  if (arr.length === 0 && dep.length === 0) return null
  return `ARR ${arr.join('/') || '?'} / DEP ${dep.join('/') || '?'}`
})

/** Config Auto would pick from ES ARR/DEP (+ day/night) — independent of manual draft */
const essaRwyAutoId = computed(() => {
  void essaRwyNowTick.value
  const { arr, dep } = essaEsRunways.value
  return resolveEssaRwyConfigId(arr, dep, new Date(essaRwyNowTick.value), { preferConfigId: efs.essaRwyAutoPreferId })
})

const essaRwyOptions = computed(() => {
  const { arr, dep } = essaEsRunways.value
  const matching = new Set(findMatchingEssaRwyConfigs(arr, dep).map(c => c.id))
  const autoId = essaRwyAutoId.value
  // Document order — do not float selected/ES match to the top
  return ESSA_RWY_COMBINATIONS.map(c => ({
    id: c.id,
    pdfName: formatEssaRwyPdfName(c),
    matchesEs: matching.has(c.id),
    autoPreferred: autoId != null && c.id === autoId,
  }))
})

/** Resolved ESSA config id (manual override or ES + night/day auto) */
const essaRwyConfigIdResolved = computed(() => {
  void essaRwyNowTick.value
  if (efs.essaRwyConfigManual && efs.essaRwyConfigId) return efs.essaRwyConfigId
  const { arr, dep } = essaEsRunways.value
  return resolveEssaRwyConfigId(arr, dep, new Date(essaRwyNowTick.value), { preferConfigId: efs.essaRwyAutoPreferId })
})

/** ESSA RWY config indicator from Appendix A/B + ES runways (+ manual / night auto) */
const essaRwyLabel = computed(() => {
  const { arr, dep } = essaEsRunways.value
  if (arr.length === 0 && dep.length === 0 && !efs.essaRwyConfigManual) return null
  return formatEssaRwyConfigLabel(arr, dep, {
    configId: efs.essaRwyConfigManual
      ? efs.essaRwyConfigId
      : efs.essaRwyAutoPreferId
        ? essaRwyConfigIdResolved.value
        : undefined,
    now: new Date(essaRwyNowTick.value),
  })
})

/** VatIRIS TWR quickref PNG for the active config */
const essaRwyQuickrefUrl = computed(() => {
  const id = essaRwyConfigIdResolved.value
  return id ? essaRwyQuickrefImageUrl(id, 'TWR') : null
})

const essaRwyQuickrefStyle = computed(() => {
  const { top, left } = essaRwyQuickrefPos.value
  return {
    top: `${top}px`,
    left: `${left}px`,
    maxWidth: `calc(100vw - ${left}px - 4px)`,
    maxHeight: `calc(100vh - ${top}px - 4px)`,
  }
})

function onEssaRwyHoverEnter(event: MouseEvent) {
  if (!essaRwyQuickrefUrl.value) return
  const el = event.currentTarget as HTMLElement | null
  if (!el) return
  if (essaRwyHoverShowTimer) clearTimeout(essaRwyHoverShowTimer)
  essaRwyHoverShowTimer = setTimeout(() => {
    essaRwyHoverShowTimer = null
    if (!essaRwyQuickrefUrl.value) return
    const rect = el.getBoundingClientRect()
    essaRwyQuickrefPos.value = { top: rect.top, left: rect.left }
    essaRwyQuickrefVisible.value = true
  }, 500)
}

function onEssaRwyHoverLeave() {
  if (essaRwyHoverShowTimer) {
    clearTimeout(essaRwyHoverShowTimer)
    essaRwyHoverShowTimer = null
  }
  essaRwyQuickrefVisible.value = false
}

watch(essaRolesDialog, (open) => {
  if (open) {
    draftEssaRoles.value = [...efs.essaRoles]
  }
})

watch(essaRwyDialog, (open) => {
  if (open) {
    if (essaRwyHoverShowTimer) {
      clearTimeout(essaRwyHoverShowTimer)
      essaRwyHoverShowTimer = null
    }
    essaRwyQuickrefVisible.value = false
    const { arr, dep } = essaEsRunways.value
    draftEssaRwyId.value =
      efs.essaRwyConfigManual && efs.essaRwyConfigId
        ? efs.essaRwyConfigId
        : resolveEssaRwyConfigId(arr, dep, new Date(essaRwyNowTick.value), { preferConfigId: efs.essaRwyAutoPreferId })
  }
})

function openEssaRolesDialog() {
  // Force-close layout picker without confirming — role change should re-prompt
  ws.layoutDialogOpen.value = false
  essaRolesDialog.value = true
}

function onEssaRolesOk() {
  // Allow layout picker to open even if the role key matches a prior confirmation
  ws.invalidateLayoutPrompt()
  efs.setEssaRoles([...draftEssaRoles.value], true)
  essaRolesDialog.value = false
}

function onEssaRolesAuto() {
  ws.invalidateLayoutPrompt()
  efs.setEssaRoles([], false)
  essaRolesDialog.value = false
}

function onEssaRwyOk() {
  if (draftEssaRwyId.value) {
    efs.setEssaRwyConfig(draftEssaRwyId.value, true)
  }
  essaRwyDialog.value = false
}

function onEssaRwyAuto() {
  efs.setEssaRwyConfig(null, false)
  essaRwyDialog.value = false
}

const dclModes: { label: string; value: DclMode }[] = [
  { label: 'MANUAL', value: 'manual' },
  { label: 'SEMI', value: 'semi' },
  { label: 'AUTO', value: 'auto' },
]

interface AtisDisplayItem {
  airport: string
  split: boolean
  idle: boolean
  newlyActive?: boolean
  atis?: string
  arrAtis?: string
  depAtis?: string
  runways?: string
  arrRunways?: string
  depRunways?: string
  qnh?: string
}

function buildAtisItem(airport: string, idle: boolean): AtisDisplayItem {
  const info = efs.atisInfo.find(a => a.airport === airport)
  const qnh = info?.qnh ? String(info.qnh) : undefined
  const newlyActive = efs.isNewlyActiveAirport(airport)

  if (info && (info.arrAtis || info.depAtis)) {
    return {
      airport,
      idle,
      newlyActive,
      split: true,
      arrAtis: info.arrAtis,
      depAtis: info.depAtis,
      arrRunways: info.arrRunways.join('/'),
      depRunways: info.depRunways.join('/'),
      qnh,
    }
  }

  const allRunways = info
    ? [...new Set([...info.depRunways, ...info.arrRunways])]
    : []
  return {
    airport,
    idle,
    newlyActive,
    split: false,
    atis: info?.atis,
    runways: allRunways.length ? allRunways.join('/') : undefined,
    qnh,
  }
}

const atisDisplayItems = computed((): AtisDisplayItem[] => {
  if (efs.multiAirport) {
    // Top bar: column airports + ES-active only (not leftover saved activeAirports)
    const es = new Set(efs.esAirports)
    const open = efs.columnAirports.filter((a): a is string => !!a)
    const visible = new Set(open)
    const idle = efs.activeAirports.filter(
      a => es.has(a) && !visible.has(a) && efs.airportHasTraffic(a),
    )
    const newborn = efs.newlyActiveAirports.filter(
      a => es.has(a) && !visible.has(a) && !idle.includes(a),
    )
    return [
      ...newborn.map(a => buildAtisItem(a, true)),
      ...idle.map(a => buildAtisItem(a, true)),
      ...open.map(a => buildAtisItem(a, false)),
    ]
  }

  // Classic: prefer configured airports; fall back to ATIS feed list
  if (efs.myAirports.length > 0) {
    return efs.myAirports.map((a) => buildAtisItem(a, false))
  }
  return efs.atisInfo.map((info) => buildAtisItem(info.airport, false))
})

/** Count of airports shown in the left airport strip (classic / RTC). */
const classicAirportCount = computed(() => {
  if (efs.multiAirport) {
    return Math.max(1, atisDisplayItems.value.length)
  }
  return Math.max(efs.myAirports.length, atisDisplayItems.value.length, 1)
})

/** Several airports → ATIS/QNH beside each ICAO on the left. */
const showLeftAtisQnh = computed(
  () => efs.multiAirport || classicAirportCount.value > 1,
)

/**
 * Single-airport classic, ESSA roles, paper → ATIS/QNH on the right.
 * Multi / RTC → left (or bay headers), not right.
 */
const showRightAtisQnh = computed(() => {
  if (efs.multiAirport) return false
  if (efs.essaRolesMode || efs.isPaperLook) return true
  return classicAirportCount.value <= 1
})

/** Primary airport for right-bar ATIS / QNH */
const topMetAirport = computed(() => {
  if (efs.essaRolesMode) return 'ESSA'
  return efs.myAirports[0] || efs.atisInfo[0]?.airport || ''
})

const topMetInfo = computed(() => {
  const apt = topMetAirport.value
  if (!apt) return null
  return efs.atisInfo.find((a) => a.airport === apt) ?? null
})

/** TWR role → show ARR+DEP ATIS; otherwise DEP only */
const hasTwrRole = computed(() => {
  if (efs.essaRolesMode) {
    return efs.essaRoles.some((r) => r === 'TWR-E' || r === 'TWR-W' || r.startsWith('TWR'))
  }
  if (efs.esggRolesMode) {
    return efs.esggRoles.includes('TWR')
  }
  return efs.myRole === 'TWR'
})

type TopAtisEntry = { letter: string; kind: 'arr' | 'dep' | 'single' }

const topAtisEntries = computed((): TopAtisEntry[] => {
  const info = topMetInfo.value
  if (!info) return []
  const single = (info.atis || '').trim().toUpperCase()

  // ESGG / paper: single ATIS only (no ARR/DEP split)
  if (efs.isPaperLook) {
    return single ? [{ letter: single, kind: 'single' }] : []
  }

  const arr = (info.arrAtis || '').trim().toUpperCase()
  const dep = (info.depAtis || '').trim().toUpperCase()

  if (hasTwrRole.value) {
    // TWR: colour ARR/DEP only when both letters are present
    if (arr && dep) return [{ letter: arr, kind: 'arr' }, { letter: dep, kind: 'dep' }]
    if (arr) return [{ letter: arr, kind: 'single' }]
    if (dep) return [{ letter: dep, kind: 'single' }]
    return single ? [{ letter: single, kind: 'single' }] : []
  }

  // No TWR: DEP ATIS only — uncoloured
  if (dep) return [{ letter: dep, kind: 'single' }]
  return single ? [{ letter: single, kind: 'single' }] : []
})

const topAtisTitle = computed(() => {
  const info = topMetInfo.value
  if (!info) return 'ATIS'
  if (efs.isPaperLook) {
    return info.atis ? `ATIS ${info.atis}` : 'ATIS'
  }
  if (hasTwrRole.value) {
    const parts: string[] = []
    if (info.arrAtis) parts.push(`ARR ${info.arrAtis}`)
    if (info.depAtis) parts.push(`DEP ${info.depAtis}`)
    if (!parts.length && info.atis) parts.push(info.atis)
    return parts.length ? `ATIS ${parts.join(' · ')}` : 'ATIS'
  }
  return `DEP ATIS ${info.depAtis || info.atis || '-'}`
})

const topQnh = computed(() => {
  const q = topMetInfo.value?.qnh
  return q != null && Number.isFinite(q) ? String(q) : null
})

const topAtisChanged = computed(() => {
  const apt = topMetAirport.value
  return apt ? efs.isAtisLetterChanged(apt) : false
})

const topQnhChanged = computed(() => {
  const apt = topMetAirport.value
  return apt ? efs.isQnhChanged(apt) : false
})

const topQnhTitle = computed(() => {
  const q = topQnh.value
  if (q == null) return 'QNH'
  if (topQnhChanged.value) {
    return `QNH ${q} — click to acknowledge · hold to stamp all strips`
  }
  return `QNH ${q} — hold to stamp all strips`
})

/** Long-hold (~600ms): stamp qnhGiven on every strip for this airport */
const QNH_LONG_HOLD_MS = 600
let topQnhHoldTimer: ReturnType<typeof setTimeout> | null = null
let topQnhLongHeld = false

function clearTopQnhHold() {
  if (topQnhHoldTimer != null) {
    clearTimeout(topQnhHoldTimer)
    topQnhHoldTimer = null
  }
}

function onTopQnhPointerDown(e: PointerEvent) {
  if (e.button != null && e.button !== 0) return
  const apt = topMetAirport.value
  if (!apt || topQnh.value == null) return
  topQnhLongHeld = false
  clearTopQnhHold()
  topQnhHoldTimer = setTimeout(() => {
    topQnhHoldTimer = null
    topQnhLongHeld = true
    efs.stampQnhGivenForAirport(apt)
  }, QNH_LONG_HOLD_MS)
}

function onTopQnhPointerUp() {
  clearTopQnhHold()
}

function onTopQnhPointerCancel() {
  clearTopQnhHold()
  topQnhLongHeld = false
}

function onTopQnhClick() {
  if (topQnhLongHeld) {
    topQnhLongHeld = false
    return
  }
  const apt = topMetAirport.value
  if (!apt || !efs.isQnhChanged(apt)) return
  efs.acknowledgeQnh(apt)
}

/** SEP (ARR SCC/radar) · DLV (APP→TWR) · DEP GAP (single-RWY only) */
const sepIndicators = computed(() => efs.essaSepIndicators)

/** Any TWR role may edit; GND/CD are information-only */
const canEditSepIndicators = computed(() => hasTwrRole.value)

function onSepFieldClick(field: 'sep' | 'dlv' | 'depGap') {
  if (!canEditSepIndicators.value) return
  efs.cycleEssaSepField(field)
}

function isRtcConfig(config: ConfigInfo): boolean {
  return config.name === 'RTC' || config.file.toLowerCase().includes('multiairport')
}

function isEsggPaperConfig(config: ConfigInfo): boolean {
  const f = config.file.toLowerCase()
  const n = config.name.toUpperCase()
  return f.includes('esgg') || n === 'ESGG'
}

function onConfigClick(file: string) {
  const config = efs.availableConfigs.find(c => c.file === file)
  if (!config) return
  if (file !== efs.activeConfig) {
    efs.switchConfig(file)
  }
  // Stay open on RTC / ESGG so column ± buttons remain usable (ESSA bays ± lives next to Layouts)
  if (!isRtcConfig(config) && !isEsggPaperConfig(config)) {
    configMenuOpen.value = false
  }
}

/** ESSA/ESGG: CD in selected roles; other airports: DEL position */
const hasCdRole = computed(() => {
  if (efs.essaRolesMode) return efs.essaRoles.includes('CD')
  if (efs.esggRolesMode) return efs.esggRoles.includes('CD')
  return efs.myRole === 'DEL'
})

const dclConnected = computed(() => efs.dclStatus === 'connected')

/** Another Hoppie station already online as ESSA/ESGG while we are on voice */
const dclAirportTaken = computed(
  () => !dclConnected.value && !!efs.dclAirportStationOnline,
)

/** DCL chrome only for the CD / DEL controller */
const showDclControls = computed(() => hasCdRole.value)

const dclOtherTooltip = computed(() => {
  const apt = efs.dclAirport || 'airport'
  return `${apt} is already online on Hoppie — another controller likely has DCL`
})

const dclTooltip = computed(() => {
  if (!hasCdRole.value) return ''
  if (dclAirportTaken.value) {
    return `${dclOtherTooltip.value}. Click to connect anyway.`
  }
  switch (efs.dclStatus) {
    case 'available': return 'Voice clearance - click to connect DCL'
    case 'connected': return 'DCL connected - click to disconnect'
    case 'error': return `DCL error: ${efs.dclError ?? 'unknown'} - click to retry`
    case 'unavailable': return 'DCL unavailable - voice clearance'
    default: return 'DCL: Voice'
  }
})

function airportTitle(info: AtisDisplayItem): string | undefined {
  if (!efs.multiAirport) return undefined
  if (info.newlyActive) return `${info.airport} newly active`
  if (info.idle) {
    if (efs.pendingIdleSwap === info.airport) return `Click a column to open ${info.airport}`
    return `Select ${info.airport}, then click a column`
  }
  return `Highlight ${info.airport} column`
}

function onAirportClick(info: AtisDisplayItem) {
  if (!efs.multiAirport) return
  if (info.idle) {
    efs.selectIdleForSwap(info.airport)
    return
  }
  efs.flashColumnForAirport(info.airport)
}

function onDclClick() {
  if (!hasCdRole.value) return
  if (efs.dclStatus === 'connected') {
    efs.dclLogout()
  } else if (efs.dclStatus === 'available' || efs.dclStatus === 'error') {
    efs.dclLogin()
  }
}

function requestFullScreen() {
  const element = document.body as any
  var requestMethod =
    element.requestFullScreen ||
    element.webkitRequestFullScreen ||
    element.mozRequestFullScreen ||
    element.msRequestFullScreen

  if (requestMethod) {
    requestMethod.call(element)
    fullscreen.value = true
  }
}

function exitFullScreen() {
  if (document.exitFullscreen) {
    document.exitFullscreen()
  } else if ((document as any).webkitExitFullscreen) {
    ; (document as any).webkitExitFullscreen()
  } else if ((document as any).mozCancelFullScreen) {
    ; (document as any).mozCancelFullScreen()
  } else if ((document as any).msExitFullscreen) {
    ; (document as any).msExitFullscreen()
  }
  fullscreen.value = false
}

onMounted(() => {
  window.addEventListener("resize", () => {
    fullscreen.value = !!document.fullscreenElement
  })
  essaRwyTickTimer = setInterval(() => {
    essaRwyNowTick.value = Date.now()
  }, 60_000)
})

onUnmounted(() => {
  if (essaRwyTickTimer) {
    clearInterval(essaRwyTickTimer)
    essaRwyTickTimer = null
  }
  if (essaRwyHoverShowTimer) {
    clearTimeout(essaRwyHoverShowTimer)
    essaRwyHoverShowTimer = null
  }
  if (connStatusHideTimer) {
    clearTimeout(connStatusHideTimer)
    connStatusHideTimer = null
  }
  clearTopQnhHold()
})
</script>

<style scoped>
.efs-top-bar {
  --tb: var(--efs-chrome-scale, var(--efs-scale, 1));
  /* Same in-flow width / padding model as bottom bar */
  width: 100%;
  box-sizing: border-box;
  flex-shrink: 0;
  height: var(--efs-bottom-bar-h, var(--efs-top-bar-h, 40px));
  background: #000000;
  border-bottom: 1px solid #3a3e42;
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  /* Wider gap when the bar has room; tightens on narrow viewports */
  gap: clamp(calc(4px * var(--tb)), 0.7vw, calc(14px * var(--tb)));
  padding: 0 calc(6px * var(--tb));
  font-size: calc(13px * var(--tb)) !important;
  overflow: hidden;
}

/* Prefer chrome-scale compression over flex-squashing text/controls */
.efs-top-bar > :not(.v-spacer) {
  flex-shrink: 0;
}

/* RWY / Roles cluster — roomier spacing when width allows */
.top-status-cluster {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: clamp(calc(8px * var(--tb)), 1.1vw, calc(22px * var(--tb)));
}

.top-menu-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: calc(28px * var(--tb));
  height: calc(28px * var(--tb));
  margin: 0;
  padding: 0;
  border: none;
  border-radius: calc(4px * var(--tb));
  background: var(--efs-bay-bg, #3b3c41);
  color: #d1d5db;
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
}

.top-menu-btn:hover {
  filter: brightness(1.15);
  color: #fff;
}

.top-menu-tri {
  display: block;
  width: 0;
  height: 0;
  border-style: solid;
  /* Point right when closed */
  border-width: calc(5px * var(--tb)) 0 calc(5px * var(--tb)) calc(7px * var(--tb));
  border-color: transparent transparent transparent currentColor;
}

.top-menu-btn.is-open .top-menu-tri {
  /* Point down when open */
  border-width: calc(7px * var(--tb)) calc(5px * var(--tb)) 0 calc(5px * var(--tb));
  border-color: currentColor transparent transparent transparent;
}

.top-menu-tri--right {
  border-width: calc(5px * var(--tb)) 0 calc(5px * var(--tb)) calc(7px * var(--tb));
  border-color: transparent transparent transparent currentColor;
}

.top-trash-btn.drag-over,
.top-trash-btn.trash-receiving {
  color: #f44336;
  outline: 1px solid #f44336;
}

.top-trash-btn.trash-receiving {
  animation: top-trash-receive-pulse 0.45s ease-out;
}

@keyframes top-trash-receive-pulse {
  0% {
    transform: scale(1);
  }
  40% {
    transform: scale(1.12);
  }
  100% {
    transform: scale(1);
  }
}

/* Same chrome as menu arrow — fullscreen icon */
.top-fs-btn :deep(.v-icon) {
  color: inherit;
}

/* Match .top-menu-btn hit box / icon scale */
.efs-top-bar :deep(.top-settings-btn.v-btn) {
  --v-btn-height: calc(28px * var(--tb));
  width: calc(28px * var(--tb));
  height: calc(28px * var(--tb));
  min-width: calc(28px * var(--tb));
}

.efs-top-bar :deep(.top-settings-btn .v-icon) {
  font-size: calc(22px * var(--tb)) !important;
}

.essa-status-btn {
  background: transparent;
  border: 1px solid transparent;
  border-radius: 2px;
  color: #ccc;
  cursor: pointer;
  font: inherit;
  font-size: calc(16px * var(--tb));
  letter-spacing: 0.02em;
  padding: 0 calc(4px * var(--tb));
  white-space: nowrap;
  flex-shrink: 0;
  box-sizing: border-box;
}

.essa-status-btn:hover {
  color: #fff;
}

/* Manual lock — amber text only (no fill/border box) */
.essa-status-btn.is-manual {
  color: #f59e0b;
}

.essa-status-btn.is-manual:hover {
  color: #fbbf24;
}

span.essa-status-btn.esgg-rwy-label,
span.essa-status-btn.esgg-roles-readonly {
  cursor: default;
  pointer-events: none;
}

/* Vuetify buttons in the bar follow chrome scale */
.efs-top-bar :deep(.v-btn) {
  --v-btn-height: calc(24px * var(--tb));
  font-size: calc(12px * var(--tb)) !important;
  letter-spacing: inherit;
}

.efs-top-bar :deep(.v-btn--icon) {
  width: calc(28px * var(--tb));
  height: calc(28px * var(--tb));
}

.efs-top-bar :deep(.v-btn--size-x-small) {
  --v-btn-height: calc(20px * var(--tb));
  width: calc(22px * var(--tb));
  height: calc(22px * var(--tb));
}

.efs-top-bar :deep(.v-icon) {
  font-size: calc(18px * var(--tb)) !important;
  width: 1em;
  height: 1em;
}

.efs-top-bar :deep(.v-btn--size-x-small .v-icon) {
  font-size: calc(14px * var(--tb)) !important;
}
.top-right-chrome {
  display: flex;
  align-items: center;
  gap: calc(8px * var(--tb));
  margin-left: calc(4px * var(--tb));
  flex-shrink: 0;
}

.top-sep-group {
  display: flex;
  align-items: stretch;
  gap: 0;
  border: 1px solid #4a4e54;
  background: var(--efs-bay-bg, #3b3c41);
  border-radius: calc(4px * var(--tb));
  overflow: hidden;
}

.top-sep-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-width: calc(44px * var(--tb));
  padding: calc(2px * var(--tb)) calc(4px * var(--tb));
  border-right: 1px solid #4a4e54;
  box-sizing: border-box;
  user-select: none;
}

.top-sep-cell:last-child {
  border-right: none;
}

.top-sep-cell.is-editable {
  cursor: pointer;
}

.top-sep-cell.is-editable:hover {
  background: rgba(255, 255, 255, 0.06);
}

.top-sep-cell.is-overridden .top-sep-val {
  color: #fbbf24;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.top-sep-lbl {
  font-size: calc(8px * var(--tb));
  font-weight: 700;
  letter-spacing: 0.08em;
  color: #9ca3af;
  line-height: 1.1;
  text-transform: uppercase;
}

.top-sep-val {
  font-size: calc(12px * var(--tb));
  font-weight: 600;
  color: #e5e7eb;
  line-height: 1.2;
  white-space: nowrap;
  min-height: 1.2em;
}

.top-atis {
  display: flex;
  align-items: baseline;
  gap: calc(5px * var(--tb));
  margin: 0 calc(2px * var(--tb));
  padding: 0;
  white-space: nowrap;
  flex-shrink: 0;
}

.top-atis-lbl {
  font-size: calc(10px * var(--tb));
  font-weight: 700;
  letter-spacing: 0.1em;
  color: #9ca3af;
}

.top-atis-letter {
  font-size: calc(24px * var(--tb));
  font-weight: 700;
  line-height: 1;
  color: #f5f5f5;
  letter-spacing: 0.02em;
}

.top-atis-letter.is-arr {
  color: #daa520; /* arrival strip */
}

.top-atis-letter.is-dep {
  color: #3a72d4; /* departure strip */
}

.top-atis-letter.is-changed {
  color: #f59e0b;
}

.top-qnh {
  display: flex;
  align-items: baseline;
  margin: 0 calc(2px * var(--tb));
  padding: 0;
  border: none;
  background: transparent;
  white-space: nowrap;
  color: #e5e7eb;
  flex-shrink: 0;
  cursor: default;
  font: inherit;
  appearance: none;
  -webkit-appearance: none;
}

.top-qnh.is-changed {
  color: #f59e0b;
  cursor: pointer;
}

.top-qnh.is-changed .top-qnh-unit {
  color: #f59e0b;
}

.top-qnh-val {
  font-size: calc(18px * var(--tb));
  font-weight: 400;
  letter-spacing: 0.02em;
}

.top-qnh-unit {
  font-size: calc(13px * var(--tb));
  font-weight: 400;
  color: #9ca3af;
}

.top-conn-wrap {
  position: relative;
  flex-shrink: 0;
}

.top-conn-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  /* Near-square; fixed so icon swap doesn’t resize */
  width: calc(32px * var(--tb));
  min-width: calc(32px * var(--tb));
  height: calc(28px * var(--tb));
  margin: 0;
  padding: 0;
  border: 1px solid #d1d5db;
  border-radius: 0;
  background: transparent;
  color: #f5f5f5;
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
  box-sizing: border-box;
}

.top-conn-label {
  font-size: calc(14px * var(--tb));
  font-weight: 500;
  letter-spacing: 0.04em;
  line-height: 1;
}

.top-conn-btn :deep(.v-icon) {
  color: inherit;
}

.top-conn-btn.is-ok:hover,
.top-conn-btn.is-ok.is-icon {
  background: rgba(255, 255, 255, 0.08);
}

.top-conn-btn.is-off {
  border-color: #b91c1c;
  background: #b91c1c;
  color: #fff;
}

.top-conn-btn.is-off:hover,
.top-conn-btn.is-off.is-icon {
  background: #dc2626;
  border-color: #dc2626;
}

.efs-top-bar :deep(.dcl-btn.v-btn) {
  font-size: calc(16px * var(--tb)) !important;
  font-weight: 600;
}

.dcl-other-status {
  font-size: calc(16px * var(--tb, var(--efs-chrome-scale, var(--efs-scale, 1))));
  font-weight: 600;
  letter-spacing: 0.5px;
  line-height: 1;
  margin-left: calc(2px * var(--efs-chrome-scale, var(--efs-scale, 1)));
  user-select: none;
}

.dcl-mode-btn {
  min-width: 0 !important;
  padding: 0 calc(4px * var(--efs-chrome-scale, var(--efs-scale, 1))) !important;
  margin-left: calc(-4px * var(--efs-chrome-scale, var(--efs-scale, 1))) !important;
  font-size: calc(14px * var(--efs-chrome-scale, var(--efs-scale, 1))) !important;
  letter-spacing: 0.5px;
}

.airport-atis--idle,
.airport-atis--open {
  cursor: pointer;
  padding: 0 calc(4px * var(--efs-scale, 1));
  border-radius: 2px;
  border: 1px solid transparent;
}

.airport-atis--idle:hover,
.airport-atis--open:hover {
  background: rgba(255, 255, 255, 0.08);
}

.airport-atis--selected {
  background: rgba(144, 202, 249, 0.2) !important;
  border-color: #90caf9 !important;
}

.airport-atis--selected .airport-icao {
  color: #fff !important;
}

.airport-atis--new {
  animation: airport-new-blink 0.55s ease-in-out 6;
  border-color: #81c784 !important;
  background: rgba(129, 199, 132, 0.18);
}

.airport-atis--new .airport-icao {
  color: #e8f5e9 !important;
  font-weight: 700;
}

@keyframes airport-new-blink {
  0%, 100% {
    background: rgba(129, 199, 132, 0.12);
    box-shadow: none;
  }
  50% {
    background: rgba(129, 199, 132, 0.4);
    box-shadow: 0 0 8px rgba(129, 199, 132, 0.55);
  }
}

.idle-hint {
  color: #aaa;
  font-size: calc(12px * var(--efs-scale, 1));
}

.column-count-ctrl {
  display: inline-flex;
  align-items: center;
  gap: 0;
  margin-left: auto;
  border: 1px solid #666;
  height: calc(22px * var(--efs-scale, 1));
  padding: 0 calc(2px * var(--efs-scale, 1));
  background: #c8c8c8;
}

.column-count-btn {
  margin: 0;
  padding: 0 calc(4px * var(--efs-scale, 1));
  border: none;
  background: transparent;
  color: #000;
  font: inherit;
  font-weight: 800;
  cursor: pointer;
  line-height: 1;
}

.column-count-btn:disabled {
  opacity: 0.35;
  cursor: default;
}

.column-count-label {
  min-width: calc(14px * var(--efs-scale, 1));
  text-align: center;
  font-size: calc(12px * var(--efs-scale, 1));
  font-weight: 700;
  color: #000;
  letter-spacing: 0.04em;
}

/* VatIRIS quickref — anchored at RWY menu row; does not block UI underneath */
.essa-rwy-quickref {
  position: fixed;
  z-index: 2000;
  pointer-events: none;
  line-height: 0;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.55);
}

.essa-rwy-quickref-img {
  display: block;
  width: auto;
  height: auto;
  object-fit: contain;
  background: #1a1a1a;
}

/* RWY config — same visual language as DEP ROUTE */
.essa-rwy-menu {
  --rwy-strip-white: #ebebeb;
  width: 100%;
  background: #d8d8d8;
  border: 1px solid #888;
  border-radius: 0;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
  color: #000;
  font-family: system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  overflow: hidden;
}

.essa-rwy-header {
  padding: calc(6px * var(--efs-scale, 1)) calc(8px * var(--efs-scale, 1)) calc(2px * var(--efs-scale, 1));
  font-size: calc(9px * var(--efs-scale, 1));
  font-weight: 800;
  letter-spacing: 0.12em;
  color: #000;
  text-transform: uppercase;
  text-align: center;
  background: #c0c0c0;
}

.essa-rwy-es {
  padding: 0 calc(8px * var(--efs-scale, 1)) calc(6px * var(--efs-scale, 1));
  font-size: calc(11px * var(--efs-scale, 1));
  font-weight: 800;
  letter-spacing: 0.3px;
  color: #000;
  text-align: center;
  text-transform: uppercase;
  background: #c0c0c0;
  border-bottom: 2px solid #555;
}

.essa-rwy-list {
  display: flex;
  flex-direction: column;
  background: #d8d8d8;
  overflow: visible;
  max-height: none;
}

.essa-rwy-list-cols {
  display: grid;
  grid-template-columns: 1fr 1fr;
}

.essa-rwy-item {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: calc(6px * var(--efs-scale, 1));
  width: 100%;
  margin: 0;
  padding: calc(5px * var(--efs-scale, 1)) calc(8px * var(--efs-scale, 1));
  border: none;
  border-radius: 0;
  border-bottom: 1px solid #888;
  appearance: none;
  -webkit-appearance: none;
  background: #d8d8d8;
  color: #000;
  font-size: calc(10px * var(--efs-scale, 1));
  font-weight: 700;
  letter-spacing: 0.2px;
  text-transform: uppercase;
  text-align: left;
  cursor: pointer;
  line-height: 1.15;
  min-height: calc(28px * var(--efs-scale, 1));
}

.essa-rwy-auto-tag {
  margin-left: auto;
  flex-shrink: 0;
  font-size: calc(8px * var(--efs-scale, 1));
  font-weight: 800;
  letter-spacing: 0.08em;
  color: #1a3a6e;
  background: rgba(26, 58, 110, 0.12);
  border: 1px solid #1a3a6e;
  padding: calc(1px * var(--efs-scale, 1)) calc(4px * var(--efs-scale, 1));
  line-height: 1.2;
}

.essa-rwy-item:hover .essa-rwy-auto-tag {
  color: var(--rwy-strip-white);
  background: rgba(235, 235, 235, 0.15);
  border-color: var(--rwy-strip-white);
}

.essa-rwy-item.selected .essa-rwy-auto-tag {
  color: #1a3a6e;
  background: rgba(26, 58, 110, 0.1);
  border-color: #1a3a6e;
}

.essa-rwy-list-cols .essa-rwy-item:nth-child(odd) {
  border-right: 1px solid #888;
}

.essa-rwy-list-cols .essa-rwy-item:nth-last-child(-n + 2) {
  border-bottom: none;
}

.essa-rwy-id {
  font-weight: 800;
  min-width: 2.2em;
  flex-shrink: 0;
}

.essa-rwy-detail {
  flex: 1 1 auto;
  min-width: 0;
  font-weight: 600;
  opacity: 0.9;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.essa-rwy-item.es-match {
  background: #b8d4a8;
  color: #000;
  box-shadow: inset 0 0 0 1px #7a9a6a;
}

.essa-rwy-item.selected {
  background: var(--rwy-strip-white);
  color: #1a3a6e;
  box-shadow: inset 0 0 0 2px #1a3a6e;
}

.essa-rwy-item.es-match.selected {
  background: #b8d4a8;
  color: #1a3a6e;
  box-shadow: inset 0 0 0 2px #1a3a6e;
}

.essa-rwy-item:hover {
  background: #1a3a6e;
  color: var(--rwy-strip-white);
  box-shadow: inset 0 0 0 2px #000;
  position: relative;
  z-index: 1;
}

.essa-rwy-actions {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  border-top: 3px solid #333;
  background: #a8a8a8;
}

.essa-rwy-action {
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0;
  padding: calc(10px * var(--efs-scale, 1)) calc(6px * var(--efs-scale, 1));
  border: none;
  border-right: 1px solid #777;
  border-radius: 0;
  appearance: none;
  -webkit-appearance: none;
  background: #a8a8a8;
  color: #000;
  font-size: calc(11px * var(--efs-scale, 1));
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  cursor: pointer;
  line-height: 1.1;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.35);
  min-height: calc(32px * var(--efs-scale, 1));
}

.essa-rwy-action:last-child {
  border-right: none;
}

.essa-rwy-action:hover,
.essa-rwy-action-ok:hover {
  background: #1a3a6e;
  color: var(--rwy-strip-white);
  box-shadow: inset 0 0 0 2px #000;
}

.essa-role-check {
  margin: 0 calc(8px * var(--efs-scale, 1)) 0 0;
  accent-color: #1a3a6e;
}

.essa-roles-actions {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  border-top: 3px solid #333;
}

.essa-roles-action {
  border-top: none;
  border-right: 1px solid #777;
  min-height: calc(32px * var(--efs-scale, 1));
}

.essa-roles-action:last-child {
  border-right: none;
}
</style>

<style>
/* Teleported dialog chrome — content-class is outside scoped tree */
.essa-rwy-dialog-wrap,
.essa-roles-dialog-wrap {
  box-shadow: none !important;
  background: transparent !important;
  overflow: visible !important;
}

.top-conn-status {
  --s: var(--efs-chrome-scale, var(--efs-scale, 1));
  position: fixed;
  z-index: 3000;
  min-width: calc(480px * var(--s));
  max-width: min(96vw, calc(560px * var(--s)));
  max-height: none;
  overflow: hidden;
  pointer-events: auto;
}

.top-conn-status .efs-popup-list {
  max-height: none;
  overflow: visible;
}

.top-conn-cols {
  display: grid;
  grid-template-columns: 1fr 1fr;
  align-items: start;
  background: #d8d8d8;
}

.top-conn-col {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.top-conn-col + .top-conn-col {
  border-left: 2px solid #555;
}

.top-conn-col .efs-popup-section:first-child {
  border-top: none;
}

.top-conn-status .efs-popup-item--stack {
  padding: calc(4px * var(--s)) calc(8px * var(--s));
  min-height: 0;
}

.top-conn-status .efs-popup-item-sub {
  white-space: normal;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.top-conn-status .efs-popup-item-sub.conn-path {
  font-family: ui-monospace, "Cascadia Mono", "Segoe UI Mono", Consolas, monospace;
  font-size: calc(9px * var(--s));
  text-transform: none;
}

.top-conn-reload-btn {
  border-top: 2px solid #555 !important;
  background: #c0c0c0 !important;
  font-weight: 800 !important;
  letter-spacing: 0.06em !important;
}

.top-conn-reload-btn:hover:not(:disabled) {
  background: #1a3a6e !important;
}

.top-conn-reload-btn:disabled {
  opacity: 0.65;
  cursor: wait;
}

.top-conn-status .conn-err {
  color: #dc2626;
}
</style>
