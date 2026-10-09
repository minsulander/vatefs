<template>
  <ClearanceDialog v-model="clncDialogOpen" :strip="strip" />
  <FlightplanDialog v-model="fplDialogOpen" :strip="strip" />
  <StripZoomOverlay
    v-if="!isLargeView"
    v-model="largeViewOpen"
    :strip="strip"
    :bay-id="bayId"
    :section-id="sectionId"
    :anchor-rect="largeViewAnchor"
  />

  <v-dialog v-model="deleteDialogOpen" max-width="300" content-class="delete-dialog-wrapper">
    <div class="delete-dialog">
      <div class="delete-dialog-text">Delete strip for flight {{ strip.callsign }}?</div>
      <div class="delete-dialog-actions">
        <button class="delete-dialog-btn delete-dialog-cancel" @click="deleteDialogOpen = false">Cancel</button>
        <button class="delete-dialog-btn delete-dialog-confirm" @click="onDeleteConfirm">DELETE</button>
      </div>
    </div>
  </v-dialog>

  <v-menu v-model="menuOpen" :target="menuPosition" location="end" :z-index="overlayMenuZ" :close-on-content-click="true">
    <v-list density="compact" class="strip-context-menu">
      <v-list-item v-if="isDeparture && canEditAssignedData" @click="onClncMenuClick">
        <v-list-item-title>Clearance</v-list-item-title>
      </v-list-item>
      <v-list-item v-if="!isNote" @click="onFplClick">
        <v-list-item-title>Flightplan</v-list-item-title>
      </v-list-item>
      <v-list-item v-if="strip.transferPending === 'out' && !isNote && store.isController" @click="onAssumeClick">
        <v-list-item-title>Assume</v-list-item-title>
      </v-list-item>
      <v-list-item v-if="strip.transferPending === 'in' && !isNote && store.isController" @click="onRefuseClick">
        <v-list-item-title>Refuse</v-list-item-title>
      </v-list-item>
      <v-list-item v-if="strip.isAssumed && !isNote" @click="onReleaseClick">
        <v-list-item-title>Release</v-list-item-title>
      </v-list-item>
      <template v-if="strip.isAssumed && !isNote && store.controllers.length > 0">
        <v-list-item @click.stop="transferMenuOpen = true">
          <v-list-item-title>
            Transfer to...
            <v-icon size="small" class="ml-1">mdi-chevron-right</v-icon>
          </v-list-item-title>
        </v-list-item>
      </template>
      <v-list-item v-if="!isNote && canEditAssignedData" @click.stop="groundStateMenuOpen = true">
        <v-list-item-title>
          State: {{ groundStateLabel }}
          <v-icon size="small" class="ml-1">mdi-chevron-right</v-icon>
        </v-list-item-title>
      </v-list-item>
      <v-list-item v-if="!isNote && canEditAssignedData" @click="onRemarksMenuClick">
        <v-list-item-title>Remarks</v-list-item-title>
      </v-list-item>
      <v-list-item v-if="canSendRea" @click="onSendReaClick">
        <v-list-item-title>Set REA</v-list-item-title>
      </v-list-item>
      <v-list-item v-if="canClearRea" @click="onClearReaClick">
        <v-list-item-title>Remove REA</v-list-item-title>
      </v-list-item>
      <v-list-item @click="onDeleteClick">
        <v-list-item-title>Delete</v-list-item-title>
      </v-list-item>
    </v-list>
  </v-menu>

  <!-- TSAC menu (within TSAT window) -->
  <v-menu v-model="tsacMenuOpen" :target="menuPosition" location="end" :z-index="overlayMenuZ" :close-on-content-click="true">
    <v-list density="compact" class="strip-context-menu ctot-menu">
      <v-list-item @click="onEditTsacMenuClick">
        <v-list-item-title>Edit TSAC</v-list-item-title>
      </v-list-item>
      <v-list-item v-if="canClearTsac" @click="onRemoveTsacMenuClick">
        <v-list-item-title>Remove TSAC</v-list-item-title>
      </v-list-item>
    </v-list>
  </v-menu>

  <!-- CTOT menu (reason + CTOC + REA) -->
  <v-menu v-model="ctotMenuOpen" :target="menuPosition" location="end" :z-index="overlayMenuZ" :close-on-content-click="true">
    <v-list density="compact" class="strip-context-menu ctot-menu">
      <v-list-item class="ctot-reason-item" disabled>
        <v-list-item-title class="ctot-reason-title">
          {{ strip.ctotReason || 'No regulation reason' }}
        </v-list-item-title>
      </v-list-item>
      <v-divider v-if="canEditCtoc || canClearCtoc || canSendRea || canClearRea" />
      <v-list-item v-if="canEditCtoc" @click="onSetCtocMenuClick">
        <v-list-item-title>Set CTOC</v-list-item-title>
      </v-list-item>
      <v-list-item v-if="canClearCtoc" @click="onClearCtocMenuClick">
        <v-list-item-title>Remove CTOC</v-list-item-title>
      </v-list-item>
      <v-list-item v-if="canSendRea" @click="onSendReaClick">
        <v-list-item-title>Set REA</v-list-item-title>
      </v-list-item>
      <v-list-item v-if="canClearRea" @click="onClearReaClick">
        <v-list-item-title>Remove REA</v-list-item-title>
      </v-list-item>
    </v-list>
  </v-menu>

  <!-- REA badge menu (above TOBT when no CTOT) -->
  <v-menu v-model="reaMenuOpen" :target="menuPosition" location="end" :z-index="overlayMenuZ" :close-on-content-click="true">
    <v-list density="compact" class="strip-context-menu ctot-menu">
      <v-list-item v-if="canClearRea" @click="onClearReaClick">
        <v-list-item-title>Remove REA</v-list-item-title>
      </v-list-item>
    </v-list>
  </v-menu>

  <!-- Ground state submenu -->
  <v-menu v-model="groundStateMenuOpen" :target="menuPosition" location="end" offset="150" :z-index="overlayMenuZ" :close-on-content-click="true">
    <v-list density="compact" class="strip-context-menu groundstate-submenu">
      <v-list-item
        v-for="gs in groundStateOptions"
        :key="gs.action"
        :class="{ 'v-list-item--active': gs.groundstate === (strip.groundstate ?? '') && !gs.extra }"
        @click="onGroundStateClick(gs.action)"
      >
        <v-list-item-title><span class="gs-code">{{ gs.code }}</span> {{ gs.label }}</v-list-item-title>
      </v-list-item>
    </v-list>
  </v-menu>

  <!-- Transfer submenu -->
  <v-menu v-model="transferMenuOpen" :target="menuPosition" location="end" offset="150" :z-index="overlayMenuZ" :close-on-content-click="true">
    <v-list density="compact" class="strip-context-menu transfer-submenu">
      <v-list-item
        v-for="ctrl in store.controllers"
        :key="ctrl.callsign"
        @click="onTransferClick(ctrl.callsign)"
      >
        <v-list-item-title>{{ ctrl.callsign }} <span class="transfer-freq">{{ ctrl.frequency }}</span></v-list-item-title>
      </v-list-item>
    </v-list>
  </v-menu>

  <SidRouteMenu v-model="sidRouteMenuOpen" :strip="strip" :target="menuPosition" :z-index="overlayMenuZ" />
  <RwyMenu v-model="rwyMenuOpen" :strip="strip" :target="menuPosition" :z-index="overlayMenuZ" />
  <CflMenu v-model="cflMenuOpen" :strip="strip" :target="menuPosition" :z-index="overlayMenuZ" />

  <div ref="stripElement" class="flight-strip"
    :class="[stripTypeClass, {
      dragging: isDragging,
      'is-bottom': strip.bottom,
      'strip-note-layout': isNote,
      'auto-move-hidden': isAutoMoving,
      'layout-arr': isArrLayout,
      'layout-dep': !isNote && !isArrLayout,
      'top-expanded': topExpanded,
      'bottom-expanded': bottomExpanded,
      'is-large-view': isLargeView,
      'dimmed-data': dimmedData,
    }]"
    :data-strip-id="strip.id"
    :draggable="!isLargeView"
    @dragstart="onDragStart"
    @dragend="onDragEnd"
    @touchstart="onDragAreaTouchStart"
    @touchmove.prevent="onDragAreaTouchMove"
    @touchend="onDragAreaTouchEnd"
    @touchcancel="onDragAreaTouchCancel"
    @contextmenu.prevent="onContextMenu"
    @click="onStripClick">

    <!-- NOTE STRIP (scribble-only — tap opens zoom pen) -->
    <template v-if="isNote">
      <div class="note-content" @click.stop="onNoteClick" @touchend="onNoteTouch">
        <svg
          v-if="showStripScribbles"
          class="strip-scribble-layer"
          :viewBox="scribbleBandViewBox('body')"
          preserveAspectRatio="none"
        >
          <polyline
            v-for="(stroke, i) in stripScribbles"
            :key="'n' + i"
            class="strip-scribble-stroke"
            :points="stroke"
            fill="none"
            vector-effect="non-scaling-stroke"
            :stroke-width="bayScribbleStrokeWidth"
          />
          <polyline
            v-if="activeScribbleStroke"
            class="strip-scribble-stroke"
            :points="activeScribbleStroke"
            fill="none"
            vector-effect="non-scaling-stroke"
            :stroke-width="bayScribbleStrokeWidth"
          />
        </svg>
        <span v-else class="note-display note-empty">Click to scribble...</span>
      </div>
      <div v-if="!isLargeView" class="note-actions">
        <StripCloseButton @click="onNoteClose" />
      </div>
    </template>

    <!-- SAAB-style strip -->
    <template v-else>
      <!-- Top menu: fully hidden until ▲ opens it; collapse arrow lives here when open -->
      <div v-if="topExpanded" class="strip-expander strip-expander-top" @click.stop>
        <button
          type="button"
          class="ctrl-arrow expander-arrow mirrored"
          :class="topArrowClass"
          :title="topArrowTitle"
          @click.stop="topExpanded = false"
        ><span class="arrow-glyph">▲</span></button>
        <div class="exp-chips">
          <button type="button" class="exp-chip" :class="{ 'exp-rea': isRea }" @click.stop="onExpRea">REA</button>
          <button type="button" class="exp-chip inert" disabled>SIG</button>
          <button
            type="button"
            class="exp-chip"
            :class="{ 'exp-qnh-ok': qnhGivenMatches, 'exp-qnh-stale': qnhStale }"
            :disabled="!canSetQnh"
            @click.stop="onExpQnh"
          >QNH</button>
          <button
            type="button"
            class="exp-chip"
            :class="{ active: hasSlowFlag }"
            @click.stop="onExpSlow"
          >SLOW</button>
          <button
            type="button"
            class="exp-chip"
            :class="{ active: hasUrnavRemark }"
            @click.stop="onExpUrnav"
          >URNAV</button>
          <button
            type="button"
            class="exp-chip"
            :class="{ active: hasVectRemark }"
            @click.stop="onExpVect"
          >VECT</button>
          <button type="button" class="exp-chip" :class="dclChipClass" @click.stop="onClncMenuClick">DCL</button>
        </div>
        <svg
          v-if="showStripScribbles"
          class="strip-scribble-layer"
          :viewBox="scribbleBandViewBox('top')"
          preserveAspectRatio="none"
        >
          <polyline
            v-for="(stroke, i) in stripScribbles"
            :key="'t' + i"
            class="strip-scribble-stroke"
            :points="stroke"
            fill="none"
            vector-effect="non-scaling-stroke"
            :stroke-width="bayScribbleStrokeWidth"
          />
          <polyline
            v-if="activeScribbleStroke"
            class="strip-scribble-stroke"
            :points="activeScribbleStroke"
            fill="none"
            vector-effect="non-scaling-stroke"
            :stroke-width="bayScribbleStrokeWidth"
          />
        </svg>
      </div>

      <!-- ARR / DEP body: shared 3-row left + 2-row main + action -->
      <div class="strip-grid" :class="isArrLayout ? 'strip-grid-arr' : 'strip-grid-dep'">
        <svg
          v-if="showStripScribbles"
          class="strip-scribble-layer"
          :viewBox="scribbleBandViewBox('body')"
          preserveAspectRatio="none"
        >
          <polyline
            v-for="(stroke, i) in stripScribbles"
            :key="'b' + i"
            class="strip-scribble-stroke"
            :points="stroke"
            fill="none"
            vector-effect="non-scaling-stroke"
            :stroke-width="bayScribbleStrokeWidth"
          />
          <polyline
            v-if="activeScribbleStroke"
            class="strip-scribble-stroke"
            :points="activeScribbleStroke"
            fill="none"
            vector-effect="non-scaling-stroke"
            :stroke-width="bayScribbleStrokeWidth"
          />
        </svg>
        <!-- Left 3×3: col1 ▲/FRUL/▼ · col2 ATYP · col3 WTC · times span col2–3 -->
        <div class="strip-left" :class="{ 'wtc-hl': wtcHighlight }">
          <button
            v-if="!topExpanded"
            type="button"
            class="ctrl-arrow strip-left-up"
            :class="topArrowClass"
            :title="topArrowTitle"
            @click.stop="topExpanded = true"
          ><span class="arrow-glyph">▲</span></button>
          <div
            class="strip-time strip-time-top fit-font"
            :class="{ ghost: !primaryTimeValue, 'time-fls': isFls, 'time-changed': tobtChanged }"
            :title="primaryTimeLabelTitle"
            @click.stop="onPrimaryTimeClick"
          >
            <template v-if="timeEditing">
              <input
                ref="timeEditInput"
                v-model="timeEditText"
                class="eobt-edit-input"
                type="text"
                inputmode="numeric"
                maxlength="4"
                @click.stop
                @blur="onTimeEditBlur"
                @keydown.enter="onTimeEditBlur"
                @keydown.escape="onTimeEditCancel"
              />
            </template>
            <template v-else>
              <span v-if="networkStatusBadge && !showCtot" class="time-sts-label" :class="networkStatusClass" @click.stop="onReaBadgeClick">{{ networkStatusBadge }}</span>
              <span v-if="primaryTimeLabel" class="strip-time-lbl">{{ primaryTimeLabel }}</span>
              <span class="strip-time-val">{{ primaryTimeValue || '----' }}</span>
            </template>
          </div>

          <span class="ctrl-ident fit-font">{{ strip.flightRules || 'I' }}</span>
          <span class="atyp-box fit-font">{{ strip.aircraftType }}</span>
          <span class="wtc-box fit-font" :class="{ boxed: wtcHighlight, plain: !wtcHighlight }">{{ strip.wakeTurbulence }}</span>

          <button
            v-if="!bottomExpanded"
            type="button"
            class="ctrl-arrow strip-left-dn"
            :class="{ 'arrow-stale': tsacStale }"
            :title="tsacStale ? 'TSAT changed — click TSAT to update TSAC' : 'Bottom menu'"
            @click.stop="bottomExpanded = true"
          ><span class="arrow-glyph">▼</span></button>
          <div
            class="strip-time strip-time-bot fit-font"
            :class="[
              {
                ghost: !secondaryTimeValue,
                'time-ctot': secondaryTimeKind === 'ctot' || secondaryTimeKind === 'scl',
                'squawk-empty': secondaryTimeKind === 'assr' && !strip.squawk && strip.canResetSquawk,
                'squawk-resettable':
                  secondaryTimeKind === 'assr' && !!strip.squawk && strip.canResetSquawk,
              },
              secondaryTimeKind === 'tsat' ? tsatColorClass : undefined,
            ]"
            :title="secondaryTimeTitle"
            @click.stop="onSecondaryTimeClick"
            @dblclick.stop="onSecondaryTimeDblClick"
          >
            <span v-if="secondaryTimeLabel" class="strip-time-lbl">{{ secondaryTimeLabel }}</span>
            <span class="strip-time-val">{{ secondaryTimeValue || '----' }}</span>
          </div>
        </div>

        <!-- Main: fixed columns; C/S font shrinks to fit cols 1–2 -->
        <div class="strip-main">
          <div
            ref="callsignBoxEl"
            class="callsign-box"
            :title="callsignBoxTitle"
            @click.stop="onCallsignClick"
            @contextmenu.stop.prevent="onContextMenu"
            @touchend="onCallsignTouch"
          >
            <span
              ref="callsignTextEl"
              class="callsign"
              :class="{
                'callsign-no-match': strip.hasMatchingFlight === false,
                'callsign-transfer-pending': isTransferIn || isTransferOut,
              }"
              :style="{ fontSize: callsignFontPx + 'px' }"
            >{{ strip.callsign }}<span v-if="strip.communicationSuffix" class="comm-suffix">{{ strip.communicationSuffix }}</span>
              <span v-if="showOwnerSi" class="owner-si" :class="ownerSiClass" :title="ownerSiTitle">{{ ownerSiText }}</span>
            </span>
          </div>
          <div v-if="!isArrLayout" class="cell cell-xfl ghost fit-font">XFL</div>
          <div
            class="cell cell-hs"
            :class="{
              ghost: !strip.hs && !hsEditing,
              'fit-font': !hsEditing,
              'hs-editing': hsEditing,
              editable: canEditAssignedData,
            }"
            title="Hold short (VCH H/S)"
            @click.stop="onHsClick"
          >
            <input
              v-if="hsEditing"
              ref="hsInput"
              class="hs-edit-input"
              type="text"
              maxlength="5"
              :value="hsEditText"
              @click.stop
              @input="onHsInput"
              @blur="onHsEditBlur"
              @keydown.enter="onHsEditBlur"
              @keydown.escape="onHsEditCancel"
            />
            <template v-else>{{ strip.hs || 'HS' }}</template>
          </div>
          <div
            class="cell cell-hp"
            :class="{
              ghost: !strip.hp && !hpEditing,
              'fit-font': !hpEditing,
              'hp-editing': hpEditing,
              editable: canEditAssignedData,
            }"
            title="Holding point (scratchpad /)"
            @click.stop="onHpClick"
          >
            <input
              v-if="hpEditing"
              ref="hpInput"
              class="hp-edit-input"
              type="text"
              maxlength="8"
              :value="hpEditText"
              @click.stop
              @input="onHpInput"
              @blur="onHpEditBlur"
              @keydown.enter="onHpEditBlur"
              @keydown.escape="onHpEditCancel"
            />
            <template v-else>{{ strip.hp || 'HP' }}</template>
          </div>
          <div
            class="cell cell-rwy fit-font"
            :class="{ ghost: !strip.runway, 'rwy-nonstandard': rwyNonStandard, editable: canEditAssignedData }"
            :title="rwyCellTitle"
            @click.stop="onRwyClick"
          >{{ strip.runway || 'RWY' }}</div>

          <template v-if="isArrLayout">
            <div class="cell cell-cto" :class="{ 'has-ctot': !!triangleTimeText }">
              <svg
                viewBox="0 0 24 24"
                preserveAspectRatio="none"
                class="clearance-triangle landing mini"
                :class="{
                  active: showArrCtlTriangle,
                  'green-border': arrTriangleGreenOutline,
                }"
                aria-hidden="true"
              >
                <!-- Landing △ with rounded corners — fills viewBox nearly edge-to-edge -->
                <path d="M2.5 0.8 H21.5 Q23.6 0.8 22.2 3.2 L13.2 21.2 Q12 23.4 10.8 21.2 L1.8 3.2 Q0.4 0.8 2.5 0.8 Z" />
              </svg>
              <span v-if="triangleTimeText" class="cto-ctot">{{ triangleTimeText }}</span>
            </div>
            <div class="cell cell-std fit-font" :class="{ ghost: !strip.stand }">{{ strip.stand || 'STD' }}</div>
          </template>
          <template v-else>
            <div class="cell cell-std fit-font" :class="{ ghost: !strip.stand }">{{ strip.stand || 'STD' }}</div>
            <div
              class="cell cell-cto"
              :class="{ 'has-ctot': !!triangleTimeText || !!depArrowCtot }"
              @click.stop="onDepArrowCtotClick"
            >
              <svg
                viewBox="0 0 24 24"
                preserveAspectRatio="none"
                class="clearance-triangle takeoff mini"
                :class="{
                  active: strip.clearedForTakeoff && !strip.atd,
                  'green-border': !!strip.atd,
                  'ctot-border': !!depArrowCtot && !strip.atd,
                }"
                aria-hidden="true"
              >
                <!-- Takeoff △ with rounded corners — fills viewBox nearly edge-to-edge -->
                <path d="M2.5 23.2 H21.5 Q23.6 23.2 22.2 20.8 L13.2 2.8 Q12 0.6 10.8 2.8 L1.8 20.8 Q0.4 23.2 2.5 23.2 Z" />
              </svg>
              <span
                v-if="triangleTimeText"
                class="cto-ctot"
                :class="{ scl: !strip.atd && showCtotCancelled }"
              >{{ triangleTimeText }}</span>
            </div>
          </template>
          <div
            class="cell cell-cfl fit-font"
            :class="{ ghost: !displayCfl, 'cfl-preview': cflPreviewPending, editable: canEditAssignedData }"
            title="Cleared flight level"
            @click.stop="onCflClick"
          >{{ displayCfl || 'CFL' }}</div>
          <div class="cell cell-ahd fit-font" :class="{ ghost: !strip.assignedHeading }">{{ strip.assignedHeading || 'AHD' }}</div>
          <div
            v-if="!isArrLayout"
            class="cell cell-sid fit-font"
            :class="{
              ghost: !store.displaySidForStrip(strip),
              'sid-highlight': sidHighlight || sidPreviewPending,
              editable: canEditAssignedData,
            }"
            title="Departure route / SID"
            @click.stop="onSidClick"
          >
            {{ store.displaySidForStrip(strip) || 'SID' }}
          </div>
        </div>

        <div v-if="store.isController" class="strip-actions" :class="{ 'multi-action': effectiveActionCount > 1 }">
          <button
            v-for="action in (strip.actions || [])"
            :key="action"
            class="action-button"
            :class="actionButtonClass(action)"
            @click.stop="() => onActionClick(action)"
            @touchend.stop="(e) => onActionTouch(e, action)"
          >
            <span class="action-text">{{ actionLabel(action) }}</span>
            <span v-if="(action === 'XFER' || action === 'READY') && strip.xferFrequency" class="action-freq">{{ strip.xferFrequency }}</span>
          </button>
        </div>
      </div>

      <!-- Bottom: [▼ RMK FPL][ASSR ADEP | remarks under CFL→][TMA] -->
      <div v-if="bottomExpanded" class="strip-expander strip-expander-bottom" @click.stop>
        <div class="exp-bottom-left">
          <button
            type="button"
            class="ctrl-arrow expander-arrow mirrored"
            :class="{ 'arrow-stale': tsacStale }"
            :title="tsacStale ? 'TSAT changed — click TSAT to update TSAC' : 'Close bottom menu'"
            @click.stop="bottomExpanded = false"
          ><span class="arrow-glyph">▼</span></button>
          <button type="button" class="exp-chip" @click.stop="onRemarksClick">RMK</button>
          <button type="button" class="exp-chip" @click.stop="onFplClick">FPL</button>
        </div>
        <div class="exp-bottom-main" :class="isArrLayout ? 'exp-bottom-main-arr' : 'exp-bottom-main-dep'">
          <div class="exp-pre-rmk">
            <span
              class="exp-assr"
              :class="{
                ghost: !strip.squawk,
                'squawk-empty': !strip.squawk && strip.canResetSquawk,
                'squawk-resettable': !!strip.squawk && strip.canResetSquawk,
              }"
              :title="assrTitle"
              @click.stop="onAssrClick"
              @dblclick.stop="onAssrDblClick"
            >{{ strip.squawk || '----' }}</span>
            <span
              class="exp-ades"
              :class="{ ghost: !strip.ades || strip.ades === '????' || strip.ades === 'ZZZZ' }"
              :title="strip.adesName ? `${strip.ades} — ${strip.adesName}` : 'ADES'"
            >{{ strip.ades && strip.ades !== '????' ? strip.ades : '----' }}</span>
          </div>
          <div class="exp-rmk" :class="{ ghost: !strip.remarks?.trim() }" @click.stop="onRemarksClick">
            <input
              v-if="remarksEditing"
              ref="remarksInput"
              v-model="remarksText"
              class="remarks-input"
              placeholder="RMK"
              @click.stop
              @input="onRemarksInput"
              @blur="onRemarksBlur"
              @keydown.enter="onRemarksBlur"
              @keydown.escape="onRemarksCancel"
            />
            <span v-else class="exp-rmk-text">{{ strip.remarks?.trim() || '' }}</span>
          </div>
        </div>
        <span
          class="exp-tma-exit"
          :class="{ ghost: !tmaExitPoint }"
          :title="tmaExitPoint ? `TMA exit ${tmaExitPoint}` : 'TMA exit'"
        >{{ tmaExitPoint || '----' }}</span>
        <svg
          v-if="showStripScribbles"
          class="strip-scribble-layer"
          :viewBox="scribbleBandViewBox('bottom')"
          preserveAspectRatio="none"
        >
          <polyline
            v-for="(stroke, i) in stripScribbles"
            :key="'bot' + i"
            class="strip-scribble-stroke"
            :points="stroke"
            fill="none"
            vector-effect="non-scaling-stroke"
            :stroke-width="bayScribbleStrokeWidth"
          />
          <polyline
            v-if="activeScribbleStroke"
            class="strip-scribble-stroke"
            :points="activeScribbleStroke"
            fill="none"
            vector-effect="non-scaling-stroke"
            :stroke-width="bayScribbleStrokeWidth"
          />
        </svg>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onUpdated, onUnmounted, watch } from 'vue'
import {
  extractTmaExitPoint,
  formatTrackSidDisplay,
  getEssaRwyCombination,
  hasSlowRemark,
  isIfrSidEligible,
  isTrackSidName,
  isVectorSidName,
  normalizeEssaRwy,
  withSlowRemark,
} from '@vatefs/common'
import type { FlightStrip } from '@/types/efs'
import { useEfsStore } from '@/store/efs'
import { getTouchDragInstance } from '@/composables/useTouchDrag'
import {
  scribbleBandViewBox,
  scribbleStrokeWidthCss,
  useStripScribbles,
} from '@/composables/useStripScribbles'
import { useStripExpanders } from '@/composables/useStripExpanders'
import ClearanceDialog from './ClearanceDialog.vue'
import FlightplanDialog from './FlightplanDialog.vue'
import SidRouteMenu from './SidRouteMenu.vue'
import RwyMenu from './RwyMenu.vue'
import CflMenu from './CflMenu.vue'
import StripZoomOverlay from './StripZoomOverlay.vue'
import StripCloseButton from './StripCloseButton.vue'

const props = withDefaults(
  defineProps<{
    strip: FlightStrip
    sectionId: string
    bayId: string
    /** Rendered inside zoom overlay — no drag, callsign closes zoom */
    isLargeView?: boolean
    /** Live stroke while drawing in zoom overlay (canonical points) */
    activeScribbleStroke?: string | null
  }>(),
  { isLargeView: false, activeScribbleStroke: null },
)

const emit = defineEmits<{
  'close-large-view': []
}>()

const store = useEfsStore()
const stripElement = ref<HTMLElement | null>(null)
const isDragging = ref(false)
const stripIdRef = computed(() => props.strip.id)
const { strokes: stripScribbles } = useStripScribbles(stripIdRef)
const { topExpanded, bottomExpanded } = useStripExpanders(stripIdRef)
const showStripScribbles = computed(
  () => stripScribbles.value.length > 0 || !!props.activeScribbleStroke,
)

// Fly-across animation for auto-moved strips
const AUTO_MOVE_DURATION = 500 // ms

// Check synchronously during setup so the strip renders hidden from the first frame (no flash)
const isAutoMoving = ref(store.autoMoveData.has(props.strip.id))

function tryAutoMoveAnimation() {
  const data = store.autoMoveData.get(props.strip.id)
  if (!data) return
  store.autoMoveData.delete(props.strip.id)

  const el = stripElement.value
  if (!el) return

  const { rect: oldRect, clone } = data

  // Position clone at old location as a fixed overlay
  clone.style.position = 'fixed'
  clone.style.left = `${oldRect.left}px`
  clone.style.top = `${oldRect.top}px`
  clone.style.width = `${oldRect.width}px`
  clone.style.height = `${oldRect.height}px`
  clone.style.zIndex = '9999'
  clone.style.pointerEvents = 'none'
  clone.style.margin = '0'
  clone.style.transition = 'none'
  document.body.appendChild(clone)

  // Defer measurement so shifted strips settle first (they arrive as separate WS messages)
  requestAnimationFrame(() => {
    const newRect = el.getBoundingClientRect()

    // Skip if no visible movement
    if (Math.abs(oldRect.left - newRect.left) < 1 && Math.abs(oldRect.top - newRect.top) < 1) {
      clone.remove()
      isAutoMoving.value = false
      return
    }

    const anim = clone.animate([
      { left: `${oldRect.left}px`, top: `${oldRect.top}px` },
      { left: `${newRect.left}px`, top: `${newRect.top}px` }
    ], {
      duration: AUTO_MOVE_DURATION,
      easing: 'ease-in-out',
      fill: 'forwards'
    })

    anim.onfinish = () => {
      clone.remove()
      isAutoMoving.value = false
    }
  })
}

// Strip may be remounted (new parent section) or updated in place
onMounted(tryAutoMoveAnimation)
onUpdated(tryAutoMoveAnimation)

// Context menu state
const menuOpen = ref(false)
const menuPosition = ref<[number, number]>([0, 0])
/** Above StripZoomOverlay (2400) when this strip is the zoomed instance */
const overlayMenuZ = computed(() => (props.isLargeView ? 2600 : 2000))
const sidRouteMenuOpen = ref(false)
const rwyMenuOpen = ref(false)
const cflMenuOpen = ref(false)
const transferMenuOpen = ref(false)
const groundStateMenuOpen = ref(false)
const ctotMenuOpen = ref(false)
const tsacMenuOpen = ref(false)
const reaMenuOpen = ref(false)

// Ground state options: code (shown in menu), label, action (sent to backend), groundstate (for highlighting current)
const groundStateOptions = [
  { code: 'FRQ', label: 'On Freq', action: 'FRQ', groundstate: 'ONFREQ' },
  { code: 'S/U', label: 'Startup', action: 'STUP', groundstate: 'STUP' },
  { code: 'RDY', label: 'De-ice', action: 'DEICE', groundstate: 'DE-ICE' },
  { code: 'S/P', label: 'Push', action: 'PUSH', groundstate: 'PUSH' },
  { code: 'TXO', label: 'Taxi Out', action: 'TXO', groundstate: 'TAXI' },
  { code: 'L/U', label: 'Lineup', action: 'LU', groundstate: 'LINEUP' },
  { code: 'CTO', label: 'Takeoff', action: 'CTO', groundstate: 'DEPA' },
  // ARR = ES native "Arriving" (ADC sector list), not "has landed"
  { code: 'ARR', label: 'Arriving', action: 'ARR', groundstate: 'ARR' },
  { code: 'CTL', label: 'Cleared to Land', action: 'CTL_GS', groundstate: 'ARR', extra: true },
  { code: 'TXI', label: 'Taxi In', action: 'TXI', groundstate: 'TXIN' },
  { code: 'PRK', label: 'Parked', action: 'PARK', groundstate: 'PARK' },
  { code: '---', label: 'No State', action: 'NOGS', groundstate: '' },
]

const groundStateLabel = computed(() => {
  const gs = props.strip.groundstate ?? ''
  const match = groundStateOptions.find(o => o.groundstate === gs && !o.extra)
  return match ? match.code : gs || '---'
})

// Dialog state
const clncDialogOpen = ref(false)
const fplDialogOpen = ref(false)
const deleteDialogOpen = ref(false)
const largeViewOpen = ref(false)
const largeViewAnchor = ref<{ left: number; top: number; width: number; height: number } | null>(null)

function openLargeView() {
  menuOpen.value = false
  ctotMenuOpen.value = false
  tsacMenuOpen.value = false
  reaMenuOpen.value = false
  sidRouteMenuOpen.value = false
  rwyMenuOpen.value = false
  cflMenuOpen.value = false
  groundStateMenuOpen.value = false
  transferMenuOpen.value = false
  const el = stripElement.value
  if (el) {
    const r = el.getBoundingClientRect()
    largeViewAnchor.value = { left: r.left, top: r.top, width: r.width, height: r.height }
  } else {
    largeViewAnchor.value = null
  }
  largeViewOpen.value = true
}

/**
 * Design reference: 400px wide → 50px body (ratio locked via --strip-scale).
 * Fonts use calc(Npx * var(--strip-scale)); .fit-font / C/S shrink further to fit boxes.
 */
const STRIP_REF_WIDTH_PX = 400
const CALLSIGN_FONT_MAX = 26
const CALLSIGN_FONT_MIN = 11
const FIT_FONT_MIN = 7
const stripScale = ref(1)
const bayScribbleStrokeWidth = computed(() => scribbleStrokeWidthCss(stripScale.value))
const callsignBoxEl = ref<HTMLElement | null>(null)
const callsignTextEl = ref<HTMLElement | null>(null)
const callsignFontPx = ref(CALLSIGN_FONT_MAX)
let stripScaleRaf = 0
let stripResizeObs: ResizeObserver | null = null
/** Last width used for --strip-scale (ignore height-only RO chatter). */
let lastStripScaleWidth = 0
/** Overflow slack — subpixel / DPR noise otherwise toggles fit every frame. */
const FIT_OVERFLOW_PX = 1.25

/** True when painted content is wider/taller than the box (flex-safe). */
function contentOverflowsBox(el: HTMLElement): boolean {
  if (el.clientWidth <= 0) return false
  if (
    el.scrollWidth > el.clientWidth + FIT_OVERFLOW_PX ||
    el.scrollHeight > el.clientHeight + FIT_OVERFLOW_PX
  ) {
    return true
  }
  // Flex/grid cells: scrollWidth often equals clientWidth while text still clips.
  try {
    const range = document.createRange()
    range.selectNodeContents(el)
    const rects = range.getClientRects()
    if (!rects.length) return false
    let left = Infinity
    let right = -Infinity
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i]!
      left = Math.min(left, r.left)
      right = Math.max(right, r.right)
    }
    const style = getComputedStyle(el)
    const padX = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0)
    const box = el.getBoundingClientRect()
    return right - left > box.width - padX + FIT_OVERFLOW_PX
  } catch {
    return false
  }
}

/** Shrink an element's font from its CSS size until content fits the box. */
function fitFontToBox(el: HTMLElement, minPx: number) {
  el.style.fontSize = ''
  const maxPx = parseFloat(getComputedStyle(el).fontSize)
  if (!Number.isFinite(maxPx) || maxPx <= 0) return
  // Integer px avoids 0.5px dithering on some displays / touch browsers
  let size = Math.round(maxPx)
  el.style.fontSize = `${size}px`
  const min = Math.min(Math.ceil(minPx * stripScale.value), size)
  for (let i = 0; i < 40 && size > min && contentOverflowsBox(el); i++) {
    size -= 1
    el.style.fontSize = `${size}px`
  }
}

/** Short C/S look oversized at full 26; long ones (EUW9792) keep the headroom. */
function callsignFontMaxFor(callsign: string, suffix?: string): number {
  const n = callsign.length + (suffix?.length ?? 0)
  if (n <= 5) return 20 // e.g. OYBUJ
  if (n <= 6) return 22
  if (n <= 7) return 25
  return CALLSIGN_FONT_MAX
}

function fitCallsignFont() {
  const box = callsignBoxEl.value
  const text = callsignTextEl.value
  if (!box || !text) return
  const maxPx = callsignFontMaxFor(props.strip.callsign, props.strip.communicationSuffix)
  const max = Math.round(maxPx * stripScale.value)
  const min = Math.ceil(CALLSIGN_FONT_MIN * stripScale.value)
  const style = getComputedStyle(box)
  const padX = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0)
  // Use nearly the full content box — light slack so long C/S stay larger
  const avail = Math.max(0, box.clientWidth - padX)
  const slack = Math.max(FIT_OVERFLOW_PX, 2.5 * stripScale.value)
  let size = max
  text.style.fontSize = `${size}px`
  while (size > min && text.scrollWidth > avail + slack) {
    size -= 1
    text.style.fontSize = `${size}px`
  }
  callsignFontPx.value = size
}

function fitAllBoxFonts() {
  const root = stripElement.value
  if (!root) return
  fitCallsignFont()
  root.querySelectorAll<HTMLElement>('.fit-font').forEach((el) => {
    fitFontToBox(el, FIT_FONT_MIN)
  })
}

function quantizeStripScale(raw: number, max: number): number {
  const clamped = Math.max(0.55, Math.min(max, raw))
  // 0.02 steps — enough for Size %, kills subpixel width flicker
  return Math.round(clamped * 50) / 50
}

/**
 * Section overflow scrollbars typically steal 6–17px of strip width.
 * Ignore those deltas so scale/callsign size stay tied to the real strip box
 * without scrollbar appear/disappear twitching.
 */
const SCROLLBAR_WIDTH_DEADBAND_PX = 18

function updateStripScale(force = false) {
  const el = stripElement.value
  if (!el) return
  const w = el.clientWidth
  if (w <= 0) return
  // Height-only resize (font fit / expanders) must not re-run scale+fit loop
  if (!force && Math.abs(w - lastStripScaleWidth) < 1) return

  // Scrollbar toggle: keep prior design width (do not retune --strip-scale)
  if (
    !force &&
    !props.isLargeView &&
    lastStripScaleWidth > 0 &&
    Math.abs(w - lastStripScaleWidth) <= SCROLLBAR_WIDTH_DEADBAND_PX
  ) {
    return
  }

  const raw = w / STRIP_REF_WIDTH_PX
  // Bay: keep modest. Zoomed view: let scale track width so height grows with Size %.
  const max = props.isLargeView ? 5 : 2.2
  const s = quantizeStripScale(raw, max)
  // Width moved but quantized scale unchanged — update baseline only (skip font-fit churn)
  if (!force && s === stripScale.value) {
    lastStripScaleWidth = w
    return
  }

  lastStripScaleWidth = w
  stripScale.value = s
  el.style.setProperty('--strip-scale', String(s))
  fitAllBoxFonts()
}

function scheduleStripScale(force = false) {
  if (stripScaleRaf) cancelAnimationFrame(stripScaleRaf)
  stripScaleRaf = requestAnimationFrame(() => {
    stripScaleRaf = 0
    updateStripScale(force)
  })
}

function attachStripScaleObserver() {
  stripResizeObs?.disconnect()
  stripResizeObs = null
  const el = stripElement.value
  if (!el || typeof ResizeObserver === 'undefined') return
  stripResizeObs = new ResizeObserver((entries) => {
    const entry = entries[0]
    const w =
      entry?.contentBoxSize?.[0]?.inlineSize ??
      entry?.contentRect?.width ??
      stripElement.value?.clientWidth ??
      0
    // Only react to real width changes — height chatter from font-fit caused flicker
    if (Math.abs(w - lastStripScaleWidth) < 1) return
    if (
      !props.isLargeView &&
      lastStripScaleWidth > 0 &&
      Math.abs(w - lastStripScaleWidth) <= SCROLLBAR_WIDTH_DEADBAND_PX
    ) {
      return
    }
    scheduleStripScale()
  })
  stripResizeObs.observe(el)
}

// Note strip state
const isNote = computed(() => props.strip.stripType === 'note')
const isTransferIn = computed(() => !isNote.value && props.strip.transferPending === 'in')
const isTransferOut = computed(() => !isNote.value && props.strip.transferPending === 'out')

/** INBOUND (and backend `dimmed`): data fields use placeholder grey; C/S + highlighted RWY stay full. */
const dimmedData = computed(() => {
  // Pending transfer in → full brightness (assume/handoff focus)
  if (props.strip.transferPending === 'in') return false
  if (props.strip.dimmed) return true
  const id = (props.sectionId || props.strip.sectionId || '').toLowerCase()
  return id === 'inbound' || id.endsWith('_inbound')
})
/** Assigned data (CFL/SID/RWY/scratch/…) — only when untracked or assumed by me */
const canEditAssignedData = computed(
  () => store.isController && !props.strip.ownedByOther,
)

/** Preferred SID preview not yet assigned via CLR — amber until dialog opens */
const sidPreviewPending = computed(() => store.isPreferredSidPending(props.strip))

/** Preferred CFL preview not yet assigned via CLR */
const cflPreviewPending = computed(() => store.isPreferredCflPending(props.strip))

/** Amber (same as pending transfer) for VFR / track·SLOW / radar-vector ve SIDs */
const sidHighlight = computed(() => {
  const raw = (props.strip.sid || '').trim()
  const shown = store.displaySidForStrip(props.strip)
  if (!shown) return false
  if (props.strip.flightRules === 'V' || /^VFR/i.test(raw)) return true
  // Radar-vector (ARS6E·KOGAV / "ARS 6E veKOGAV") — same orange as SLOW, still not SLOW altitude
  if (isVectorSidName(raw) || /[A-Z]{2,}\s+\d+[A-Z]+\s+ve[A-Z]{2,}/i.test(shown)) return true
  if (isTrackSidName(raw) || formatTrackSidDisplay(raw)) return true
  // Formatted SLOW display: 120veBABAP / 010·240veNOSLI
  if (/\d{3}(·\d{3})?ve[A-Z]{2,}/i.test(shown)) return true
  return false
})
const hasRofRequest = computed(() => !!props.strip.rofRequestCallsign || !!props.strip.rofRequestSi)
/** Inbound: ROF sent to us (we track). Outbound: we sent ROF (pink window). */
const isRofInbound = computed(() => hasRofRequest.value && !!props.strip.isAssumed)
const isRofOutbound = computed(() => hasRofRequest.value && !props.strip.isAssumed)
const isRofActive = computed(() => hasRofRequest.value)
const rofNowMs = ref(Date.now())
/** Inbound alternate window / outbound pink ROF key — until rofFlashUntil */
const isRofFlashing = computed(() => {
  if (!isRofInbound.value && !isRofOutbound.value) return false
  const until = props.strip.rofFlashUntil
  return until != null && rofNowMs.value < until
})
/** true = pink phase for SI/XFER alternate (inbound); outbound ROF key stays solid pink */
const rofFlashPink = ref(true)
let rofAlternateTimer: ReturnType<typeof setInterval> | null = null
let rofClockTimer: ReturnType<typeof setInterval> | null = null
const ROF_ALTERNATE_MS = 1000

watch(isRofFlashing, (flashing) => {
  if (rofAlternateTimer) {
    clearInterval(rofAlternateTimer)
    rofAlternateTimer = null
  }
  if (flashing && isRofInbound.value) {
    // Inbound only: alternate SI/XFER pink ↔ amber
    rofFlashPink.value = true
    rofAlternateTimer = setInterval(() => {
      rofFlashPink.value = !rofFlashPink.value
    }, ROF_ALTERNATE_MS)
  } else if (flashing && isRofOutbound.value) {
    rofFlashPink.value = true
  } else {
    rofFlashPink.value = false
  }
}, { immediate: true })

watch([isRofInbound, isRofOutbound], ([inbound, outbound]) => {
  if (rofClockTimer) {
    clearInterval(rofClockTimer)
    rofClockTimer = null
  }
  if (inbound || outbound) {
    rofNowMs.value = Date.now()
    rofClockTimer = setInterval(() => {
      rofNowMs.value = Date.now()
    }, 500)
  }
}, { immediate: true })

/** Sector ownership / ROF / transfer SI next to callsign — hidden (ROF uses action key) */
const showOwnerSi = computed(() => false)
/**
 * SI label:
 * - transfer in → owner SI (from whom); overrides any ROF alternate
 * - transfer out → transfer SI (to whom)
 * - inbound ROF flashing → pink ROF ↔ →requester SI
 * - inbound ROF after flash → →requester SI
 * - outbound ROF → pink ROF ↔ owner SI
 * (nextSi is XFER-target only — never shown as strip SI)
 */
const ownerSiText = computed(() => {
  if (isTransferIn.value) return props.strip.ownerSi || ''
  if (isTransferOut.value) return props.strip.transferSi || ''
  if (isRofInbound.value) {
    if (isRofFlashing.value && rofFlashPink.value) return 'ROF'
    return props.strip.rofRequestSi || props.strip.rofRequestCallsign || ''
  }
  if (isRofOutbound.value) {
    if (rofFlashPink.value) return 'ROF'
    return props.strip.ownerSi || ''
  }
  return props.strip.ownerSi || ''
})
const ownerSiClass = computed(() => {
  if (isTransferIn.value) return { 'si-transfer-in': true }
  if (isTransferOut.value) return { 'si-transfer-out': true }
  const showingRofText = isRofFlashing.value && rofFlashPink.value
  return {
    'si-rof-request': showingRofText && (isRofInbound.value || isRofOutbound.value),
    // Arrow pointing at requester SI (inbound, when not showing pink ROF)
    'si-rof-target': isRofInbound.value && !showingRofText,
  }
})
const ownerSiTitle = computed(() => {
  const withFreq = (callsign: string | undefined, freq: string | undefined, fallbackSi: string | undefined) => {
    const who = callsign || fallbackSi
    if (!who) return undefined
    return freq ? `${who} ${freq}` : who
  }
  if (isTransferIn.value) {
    const from = withFreq(props.strip.ownerCallsign, props.strip.ownerFrequency, props.strip.ownerSi)
    return from ? `Transfer from ${from}` : 'Incoming transfer'
  }
  if (isTransferOut.value) {
    const target = withFreq(props.strip.transferCallsign, props.strip.transferFrequency, props.strip.transferSi)
    return target ? `Transfer to ${target}` : 'Pending transfer'
  }
  if (isRofActive.value) {
    const from = withFreq(
      props.strip.rofRequestCallsign,
      props.strip.rofRequestFrequency,
      props.strip.rofRequestSi
    )
    if (isRofInbound.value) {
      return from ? `ROF from ${from}` : 'Incoming ROF'
    }
    return from ? `ROF sent (${from})` : 'ROF sent'
  }
  const owner = withFreq(props.strip.ownerCallsign, props.strip.ownerFrequency, props.strip.ownerSi)
  return owner ? `Tracked by ${owner}` : undefined
})
const isDeparture = computed(() => props.strip.stripType === 'departure' || props.strip.stripType === 'local')
const isArrLayout = computed(() => props.strip.stripType === 'arrival')

/** RWY differs from ES active selection and/or selected ESSA config → yellow fill */
const rwyNonStandard = computed(() => {
  const rwy = props.strip.runway
  if (!rwy) return false
  const norm = normalizeEssaRwy(rwy)
  if (!norm) return false

  const airport = (isArrLayout.value ? props.strip.ades : props.strip.adep)?.toUpperCase()
  if (!airport) return false

  const info = store.atisInfo.find((a) => a.airport === airport)
  const esList = (isArrLayout.value ? info?.arrRunways : info?.depRunways) ?? []
  const esNorm = esList.map(normalizeEssaRwy).filter(Boolean)
  const matchesEs = esNorm.length === 0 || esNorm.includes(norm)

  let matchesConfig = true
  if (airport === 'ESSA' && store.essaRwyConfigIdResolved) {
    const combo = getEssaRwyCombination(store.essaRwyConfigIdResolved)
    if (combo) {
      const configList = (isArrLayout.value ? combo.arr : combo.dep).map(normalizeEssaRwy)
      matchesConfig = configList.includes(norm)
      if (!matchesConfig && isArrLayout.value && combo.arrAliases) {
        matchesConfig = combo.arrAliases.some((alias) =>
          alias.map(normalizeEssaRwy).includes(norm),
        )
      }
    }
  }

  return !matchesEs || !matchesConfig
})

const rwyCellTitle = computed(() => {
  const base = isArrLayout.value ? 'Arrival runway' : 'Departure runway'
  return rwyNonStandard.value ? `${base} (non-standard)` : base
})

const wtcHighlight = computed(() => {
  const w = props.strip.wakeTurbulence
  return !!w && w !== 'M'
})
const displayCfl = computed(() => store.displayCflForStrip(props.strip))
const dclChipClass = computed(() => {
  const s = props.strip.dclStatus
  if (s === 'REQUEST') return 'dcl-request'
  if (s === 'SENT' || s === 'DONE' || s === 'WILCO') return 'dcl-ok'
  if (s === 'INVALID' || s === 'UNABLE' || s === 'REJECTED') return 'dcl-err'
  return ''
})

function onExpRea() {
  if (!canEditAssignedData.value) return
  if (canClearRea.value) onClearReaClick()
  else if (canSendRea.value) onSendReaClick()
}

/** Airport used for ATIS QNH on this strip */
const qnhAirport = computed(() =>
  isArrLayout.value ? props.strip.ades : props.strip.adep
)

const currentQnh = computed(() => {
  const apt = qnhAirport.value
  if (!apt) return undefined
  return store.atisInfo.find((a) => a.airport === apt)?.qnh
})

const qnhStale = computed(() => {
  const given = props.strip.qnhGiven
  const cur = currentQnh.value
  return given != null && cur != null && given !== cur
})

const qnhGivenMatches = computed(() => {
  const given = props.strip.qnhGiven
  const cur = currentQnh.value
  return given != null && cur != null && given === cur
})

const canSetQnh = computed(() =>
  canEditAssignedData.value && currentQnh.value != null
)

/** Top ▲: QNH stale (orange) overrides REA (green) */
const topArrowClass = computed(() => {
  if (qnhStale.value) return { 'arrow-stale': true }
  if (isRea.value) return { 'arrow-rea': true }
  return {}
})

const topArrowTitle = computed(() => {
  if (qnhStale.value) {
    return `QNH changed (${props.strip.qnhGiven} → ${currentQnh.value}) — open menu & press QNH`
  }
  if (isRea.value) return 'REA set'
  return topExpanded.value ? 'Close top menu' : 'Top menu'
})

const callsignBoxTitle = computed(() => {
  const rtf = props.strip.rtfCallsign
  const mode = props.isLargeView
    ? 'Close zoomed strip (right-click for menu)'
    : 'Zoom strip (right-click for menu)'
  return rtf ? `${rtf} — ${mode}` : mode
})

function onExpQnh() {
  if (!canSetQnh.value || currentQnh.value == null) return
  store.setQnhGiven(props.strip.id, currentQnh.value)
}

/** SLOW flag: aircraft type and/or SLOW remarks token */
const hasSlowFlag = computed(
  () => !!props.strip.isSlow || hasSlowRemark(props.strip.remarks),
)

async function onExpSlow() {
  if (!canEditAssignedData.value) return
  // V / Z: no SLOW SID rules / auto flag
  if (!isIfrSidEligible(props.strip.flightRules)) return
  // Toggle remarks token; button also lights for isSlow type
  const enable = !hasSlowRemark(props.strip.remarks)
  if (enable) {
    // Assign track SID first — AmendFlightPlan often clears scratch, so set SLOW after
    await store.preferSidForStrip(props.strip.id, true)
    store.updateRemarks(props.strip.id, withSlowRemark(props.strip.remarks, true))
  } else {
    store.updateRemarks(props.strip.id, withSlowRemark(props.strip.remarks, false))
    // Remove SLOW/track SID from the flight plan
    store.clearTrackSidForStrip(props.strip.id)
  }
}

/** Highlight when URNAV appears anywhere in remarks/scratchpad (e.g. .URNAV, FOO URNAV BAR) */
const hasUrnavRemark = computed(() => /URNAV/i.test(props.strip.remarks || ''))

function onExpUrnav() {
  if (!canEditAssignedData.value) return
  const current = props.strip.remarks?.trim() || ''
  if (hasUrnavRemark.value) {
    const next = current
      .replace(/\.?URNAV/gi, '')
      .replace(/\s+/g, ' ')
      .trim()
    store.updateRemarks(props.strip.id, next)
  } else {
    const next = current ? `${current} URNAV` : 'URNAV'
    store.updateRemarks(props.strip.id, next)
  }
}

/** Highlight when VECT appears in remarks/scratchpad */
const hasVectRemark = computed(() => /VECT/i.test(props.strip.remarks || ''))

function onExpVect() {
  if (!canEditAssignedData.value) return
  const current = props.strip.remarks?.trim() || ''
  if (hasVectRemark.value) {
    const next = current
      .replace(/\.?VECT/gi, '')
      .replace(/\s+/g, ' ')
      .trim()
    store.updateRemarks(props.strip.id, next)
  } else {
    const next = current ? `${current} VECT` : 'VECT'
    store.updateRemarks(props.strip.id, next)
  }
}
const effectiveActionCount = computed(() => props.strip.actions?.length ?? 0)

// Remarks state
const remarksEditing = ref(false)
const remarksText = ref('')
const remarksInitialText = ref('')
const remarksDirty = ref(false)
const remarksInput = ref<HTMLInputElement | null>(null)

// Hold short — VCH annotation 4 (max 5)
const hsEditing = ref(false)
const hsEditText = ref('')
const hsInput = ref<HTMLInputElement | null>(null)

function onHsClick() {
  if (!canEditAssignedData.value) return
  if (hsEditing.value) {
    nextTick(() => hsInput.value?.focus())
    return
  }
  hsEditText.value = props.strip.hs?.trim() || ''
  hsEditing.value = true
  nextTick(() => {
    hsInput.value?.focus()
    hsInput.value?.select()
  })
}

function onHsInput(event: Event) {
  const el = event.target as HTMLInputElement
  const cleaned = el.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5)
  hsEditText.value = cleaned
  const pos = Math.min(el.selectionStart ?? cleaned.length, cleaned.length)
  nextTick(() => {
    if (hsInput.value && hsInput.value.value !== cleaned) {
      hsInput.value.value = cleaned
      hsInput.value.setSelectionRange(pos, pos)
    }
  })
}

function onHsEditCancel() {
  hsEditing.value = false
}

function onHsEditBlur() {
  if (!hsEditing.value) return
  const value = hsEditText.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5)
  hsEditing.value = false
  if (value !== (props.strip.hs || '')) {
    store.updateHs(props.strip.id, value)
  }
}

// Holding point — scratchpad /TEXT
const hpEditing = ref(false)
const hpEditText = ref('')
const hpInput = ref<HTMLInputElement | null>(null)

function onHpClick() {
  if (!canEditAssignedData.value) return
  if (hpEditing.value) {
    nextTick(() => hpInput.value?.focus())
    return
  }
  hpEditText.value = props.strip.hp?.trim() || ''
  hpEditing.value = true
  nextTick(() => {
    hpInput.value?.focus()
    hpInput.value?.select()
  })
}

function onHpInput(event: Event) {
  const el = event.target as HTMLInputElement
  const cleaned = el.value.toUpperCase().replace(/[^A-Z0-9]/g, '')
  hpEditText.value = cleaned
  const pos = Math.min(el.selectionStart ?? cleaned.length, cleaned.length)
  nextTick(() => {
    if (hpInput.value && hpInput.value.value !== cleaned) {
      hpInput.value.value = cleaned
      hpInput.value.setSelectionRange(pos, pos)
    }
  })
}

function onHpEditCancel() {
  hpEditing.value = false
}

function onHpEditBlur() {
  if (!hpEditing.value) return
  const value = hpEditText.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
  hpEditing.value = false
  if (value !== (props.strip.hp || '')) {
    store.updateHp(props.strip.id, value)
  }
}

/** TMA exit — first FPL point after ADEP/rwy or SID/rwy */
const tmaExitPoint = computed(
  () => props.strip.tmaExit || extractTmaExitPoint(undefined, props.strip.route),
)

function onNoteClick() {
  if (props.isLargeView) {
    emit('close-large-view')
    return
  }
  openLargeView()
}

function onNoteClose() {
  largeViewOpen.value = false
  store.deleteStrip(props.strip.id)
}

function onNoteTouch(event: TouchEvent) {
  if (isDragging.value) return // Let the strip's touchend handler clean up the drag
  // Cancel any pending drag timer that touchstart may have started
  if (longPressTimer) {
    clearTimeout(longPressTimer)
    longPressTimer = null
  }
  touchStarted = false
  event.stopPropagation()
  event.preventDefault()
  onNoteClick()
}

/** Newly created notes open zoom scribble once the bay strip mounts. */
function tryOpenPendingNoteScribble() {
  if (!isNote.value || props.isLargeView) return
  if (!store.consumePendingNoteScribbleOpen(props.strip.id)) return
  nextTick(() => openLargeView())
}
onMounted(tryOpenPendingNoteScribble)
watch(
  () => store.pendingNoteScribbleId,
  (id) => {
    if (id === props.strip.id) tryOpenPendingNoteScribble()
  },
)

// Remarks handlers
function startRemarksEditing() {
  remarksText.value = props.strip.remarks?.trim() || ''
  remarksInitialText.value = remarksText.value
  remarksDirty.value = false
  remarksEditing.value = true
  nextTick(() => {
    remarksInput.value?.focus()
  })
}

function onRemarksClick() {
  if (!canEditAssignedData.value) return
  if (remarksEditing.value) {
    nextTick(() => remarksInput.value?.focus())
    return
  }
  startRemarksEditing()
}

function onRemarksMenuClick() {
  if (!canEditAssignedData.value) return
  menuOpen.value = false
  startRemarksEditing()
}

function onRemarksInput() {
  remarksText.value = remarksText.value.toUpperCase()
  remarksDirty.value = true
}

function onRemarksBlur() {
  remarksEditing.value = false
  if (!remarksDirty.value) return
  const text = remarksText.value.trim()
  if (text !== remarksInitialText.value) {
    store.updateRemarks(props.strip.id, text)
  }
}

function onRemarksCancel() {
  remarksDirty.value = false
  remarksEditing.value = false
}

// Touch drag state
let touchStarted = false
let longPressTimer: number | null = null
const LONG_PRESS_DELAY = 150 // ms before drag starts

const touchDrag = getTouchDragInstance()

const stripTypeClass = computed(() => `strip-${props.strip.stripType}`)

/** CDM (TOBT/TSAT/TTOT) is only available at ESSA */
const CDM_AIRPORTS = new Set(['ESSA'])
/** Single-airport CDM ground sections */
const CDM_SECTIONS_EXACT = new Set(['pending_dep', 'cleared', 'push_start'])
/** TSAC/CTOC clickspots: CD ALL + TSAT only (not PUSH&START) */
const TSAC_CTOC_SECTIONS = new Set(['pending_dep', 'cleared'])
/** PUSH&START bay and later — ESSA top switches TOBT→TTOT; bottom drops TSAT */
const PUSH_START_ONWARD_SECTIONS = new Set([
  'push_start',
  'taxi',
  'taxi_dep',
  'taxi_arr',
  'runway',
  'dep_runway',
  'arr_runway',
  'ctr_dep',
  'rwy',
])
/** Taxi and later — used for non-ESSA primary-time hide (legacy) */
const TAXI_ONWARD_SECTIONS = new Set([
  'taxi',
  'taxi_dep',
  'taxi_arr',
  'runway',
  'dep_runway',
  'arr_runway',
  'ctr_dep',
  'rwy',
])

/** Ground clearance sections where TOBT/TSAT apply (not CTR DEP). */
function isCdmGroundSection(sectionId: string): boolean {
  if (CDM_SECTIONS_EXACT.has(sectionId)) return true
  // RTC columns: bay1_dep / bay1_twy / idle_dep — never ctr_dep
  return /^(bay\d+|idle)_(dep|twy)$/.test(sectionId)
}

function sectionIdMatches(sectionId: string, allowed: Set<string>): boolean {
  if (allowed.has(sectionId)) return true
  // ESSA dynamic pair sections: runway_01L_19R
  if (allowed.has('runway') && sectionId.includes('runway')) return true
  const logical = sectionId.includes('_') ? sectionId.slice(sectionId.lastIndexOf('_') + 1) : sectionId
  return allowed.has(logical)
}

/** In PUSH&START section or later (taxi / runway / CTR DEP). */
const isPushStartOrLater = computed(() =>
  sectionIdMatches(props.strip.sectionId, PUSH_START_ONWARD_SECTIONS) ||
  /^(bay\d+|idle)_twy$/.test(props.strip.sectionId)
)

const isEssaDep = computed(() =>
  CDM_AIRPORTS.has(props.strip.adep) &&
  (props.strip.stripType === 'departure' || props.strip.stripType === 'local')
)

const isDepartingIfr = computed(() =>
  props.strip.stripType === 'departure' &&
  (props.strip.flightRules === 'I' || props.strip.flightRules === 'Y')
)

const showCdm = computed(() =>
  isDepartingIfr.value &&
  CDM_AIRPORTS.has(props.strip.adep) &&
  isCdmGroundSection(props.strip.sectionId) &&
  !props.strip.clearedForTakeoff
)

/** CTR DEP (and multi-airport * _ctr_dep): no CTOT on the strip */
function isCtrDepSection(sectionId: string): boolean {
  if (sectionId === 'ctr_dep') return true
  return sectionId.endsWith('_ctr_dep') || sectionIdMatches(sectionId, new Set(['ctr_dep']))
}

/** CTOT (or SCL after slot cancel) for ground IFR departures — not CTR DEP */
const showCtotCancelled = computed(() =>
  isDepartingIfr.value &&
  !isCtrDepSection(props.strip.sectionId) &&
  !!props.strip.ctotCancelled &&
  !props.strip.ctot &&
  !props.strip.clearedForTakeoff
)
const showCtot = computed(() =>
  isDepartingIfr.value &&
  !isCtrDepSection(props.strip.sectionId) &&
  !props.strip.clearedForTakeoff &&
  (!!props.strip.ctot || showCtotCancelled.value)
)

/**
 * Taxi DEP / runway / CTR DEP onward: never show EOBT/TOBT (CTOT alone if regulated).
 * Arrivals keep ETA on taxi_arr / inbound.
 */
const showPrimaryTime = computed(() => {
  if (!sectionIdMatches(props.strip.sectionId, TAXI_ONWARD_SECTIONS)) return true
  // Departures/local: no EOBT from taxi onward (CTOT shown separately)
  if (props.strip.stripType === 'departure' || props.strip.stripType === 'local') {
    return false
  }
  // Arrivals: keep ETA unless CTOT somehow applies (it shouldn't for arr)
  return !(showCtot.value)
})

/**
 * Parse vIFF/CDM network status for strip UI.
 * Shown: REA (badge), FLS variants (time label + tooltip).
 * Not shown as badge: COMPLY, AIRB, ATC_ACTIV, DES, SAM, SRM, SLC (SCL shown in CTOT slot), etc.
 */
function parseCdmSts(sts: string | undefined): {
  kind: 'rea' | 'fls'
  raw: string
  flsType?: string
  badge: string
} | null {
  if (!sts) return null
  const raw = sts.trim().toUpperCase()
  if (!raw) return null
  if (raw === 'REA') return { kind: 'rea', raw, badge: 'REA' }

  if (raw === 'SUSP' || raw === 'FLS') {
    return { kind: 'fls', raw, badge: 'FLS' }
  }
  const flsPrefix = raw.match(/^FLS[-_/](.+)$/)
  const flsSuffix = raw.match(/^(.+)[-_/]FLS$/)
  if (flsPrefix || flsSuffix || raw.includes('FLS')) {
    const type = (flsPrefix?.[1] || flsSuffix?.[1] || '').replace(/^[-_/]+|[-_/]+$/g, '')
    return {
      kind: 'fls',
      raw,
      flsType: type && type !== 'FLS' ? type : undefined,
      badge: 'FLS',
    }
  }

  return null
}

/** Tooltip text for FLS / FLS-subtype */
function flsTooltip(raw: string, flsType?: string): string {
  const subtypeHelp: Record<string, string> = {
    CDM: 'CDM (TOBT/TSAT related suspension)',
    NRA: 'No Regulation Available / not ready',
    MR: 'Mandatory Route non-compliance',
    GS: 'Ground Stop',
  }
  if (flsType) {
    const help = subtypeHelp[flsType] || flsType
    return `FLS — ${help} (${raw})`
  }
  if (raw === 'SUSP') return 'FLS — Suspended (SUSP)'
  return 'FLS — Flight Suspended'
}

const cdmStatus = computed(() =>
  isDepartingIfr.value ? parseCdmSts(props.strip.cdmSts) : null
)

const isFls = computed(() => cdmStatus.value?.kind === 'fls')
const isRea = computed(() => cdmStatus.value?.kind === 'rea')

/** Badge above CTOT (or primary time if no CTOT). FLS uses primary label instead. */
const networkStatusBadge = computed(() => {
  const sts = cdmStatus.value
  if (!sts || sts.kind === 'fls') return null
  return sts.badge
})

const networkStatusClass = computed(() => {
  const sts = cdmStatus.value
  if (!sts || sts.kind !== 'rea') return {}
  return { 'sts-rea': true }
})

const canSendRea = computed(() =>
  canEditAssignedData.value && showCtot.value && !showCtotCancelled.value && !isRea.value
)

/** REA can appear above TOBT (no CTOT) or CTOT — allow clear in both cases */
const canClearRea = computed(() =>
  canEditAssignedData.value && isRea.value
)

/** UTC clock tick for TSAT window / FLS label blink */
const nowUtcMs = ref(Date.now())
let tsatWindowTimer: ReturnType<typeof setInterval> | undefined

/** Format HHmm → HH:MM for strip time windows */
function formatHhmmColon(hhmm: string | undefined): string {
  if (!hhmm) return ''
  const digits = hhmm.replace(/\D/g, '')
  if (digits.length < 3) return ''
  const n = digits.length === 3 ? digits.padStart(4, '0') : digits.slice(0, 4)
  return `${n.slice(0, 2)}:${n.slice(2, 4)}`
}

type PrimaryTimeKind = 'tobt' | 'ttot' | 'eobt' | 'eta' | 'none'
type SecondaryTimeKind = 'tsat' | 'ctot' | 'scl' | 'assr' | 'none'

/**
 * Top time window:
 * - ESSA DEP: TOBT (TB) until PUSH&START, then TTOT (TT)
 * - ARR: ETA
 * - Other DEP: EOBT (EB), or TOBT (TB) if present
 */
const primaryTimeKind = computed((): PrimaryTimeKind => {
  if (isArrLayout.value) return 'eta'
  if (isEssaDep.value) {
    return isPushStartOrLater.value ? 'ttot' : 'tobt'
  }
  if (props.strip.stripType === 'departure' || props.strip.stripType === 'local') {
    return props.strip.tobt ? 'tobt' : 'eobt'
  }
  return 'eta'
})

const primaryTimeValue = computed(() => {
  switch (primaryTimeKind.value) {
    case 'tobt':
      return formatHhmmColon(props.strip.tobt || props.strip.eobt)
    case 'ttot':
      return formatHhmmColon(props.strip.ttot)
    case 'eobt':
      return formatHhmmColon(props.strip.eobt)
    case 'eta':
      return formatHhmmColon(props.strip.eta)
    default:
      return ''
  }
})

/** Short label: TB / TT / EB / ETA; FLS blinks when applicable */
const primaryTimeLabel = computed(() => {
  if (isFls.value && isEssaDep.value && primaryTimeKind.value === 'tobt') {
    const type = cdmStatus.value?.flsType
    if (type) {
      const phase = Math.floor(nowUtcMs.value / 2000) % 2
      return phase === 0 ? 'FLS' : type
    }
    return 'FLS'
  }
  switch (primaryTimeKind.value) {
    case 'tobt': return 'TB'
    case 'ttot': return 'TT'
    case 'eobt': return 'EB'
    case 'eta': return '' // ARR: time only, no "ETA" prefix
    default: return ''
  }
})

/**
 * Bottom time window:
 * - ESSA DEP: TSAT until PUSH&START; then ASSR (CTOT/SCL live in dep arrow)
 * - ARR / other airports: ASSR (squawk)
 */
const secondaryTimeKind = computed((): SecondaryTimeKind => {
  if (isArrLayout.value) return 'assr'
  if (isEssaDep.value) {
    if (!isPushStartOrLater.value) return 'tsat'
    return 'assr'
  }
  return 'assr'
})

/** CTOT / SCL inside dep arrow (hidden when ATD set or CTO filled) */
const depArrowCtot = computed(() => {
  if (isArrLayout.value || props.strip.atd || !showCtot.value || props.strip.clearedForTakeoff) return ''
  if (showCtotCancelled.value) return 'SCL'
  return formatHhmmColon(props.strip.ctot)
})

/** Time shown in triangle: ATD (dep) / ATA (arr) / else CTOT on dep */
const triangleTimeText = computed(() => {
  if (isArrLayout.value) {
    return props.strip.ata ? formatHhmmColon(props.strip.ata) : ''
  }
  if (props.strip.atd) return formatHhmmColon(props.strip.atd)
  return depArrowCtot.value
})

/** Arrival strip is in a runway section (geo hold / CTL). */
const onRunwaySection = computed(() => {
  const id = (props.sectionId || props.strip.sectionId || '').toLowerCase()
  return id.includes('runway')
})

/**
 * Filled green CTL △: cleared-to-land, or on-runway before ATA.
 * Once ATA is set → framed outline only (not filled).
 */
const showArrCtlTriangle = computed(() => {
  if (!isArrLayout.value || props.strip.missedApproach) return false
  if (props.strip.ata) return false
  if (onRunwaySection.value) return true
  return !!props.strip.clearedToLand && !arrTriangleGreenOutline.value
})

/**
 * Green landing outline when on the ground (ATA / airborne===false).
 * ATA always wins over filled CTL (including still on the runway section).
 * Groundstate ARR means ES "Arriving" (ADC sector list) — valid while still airborne.
 */
const arrTriangleGreenOutline = computed(() => {
  if (!isArrLayout.value) return false
  if (props.strip.missedApproach) return false
  if (props.strip.ata) return true
  if (onRunwaySection.value) return false
  if (props.strip.clearedToLand) return false
  // Still airborne or unknown — ARR alone is not landed
  if (props.strip.airborne !== false) return false
  const gs = props.strip.groundstate ?? ''
  return gs === 'ARR' || gs === 'TXIN' || gs === 'PARK' || !gs
})

function onDepArrowCtotClick(event: MouseEvent) {
  if (props.strip.atd || !depArrowCtot.value) return
  onCtotClick(event)
}

const secondaryTimeValue = computed(() => {
  switch (secondaryTimeKind.value) {
    case 'tsat':
      return formatHhmmColon(props.strip.tsat)
    case 'ctot':
      return formatHhmmColon(props.strip.ctot)
    case 'scl':
      return 'SCL'
    case 'assr':
      return props.strip.squawk || ''
    default:
      return ''
  }
})

const secondaryTimeLabel = computed(() => {
  switch (secondaryTimeKind.value) {
    case 'tsat': return secondaryTimeValue.value ? 'TS' : ''
    case 'ctot': return 'CTOT'
    case 'scl': return 'CTOT'
    case 'assr': return '' // squawk only, no "ASSR" prefix
    default: return ''
  }
})

const secondaryTimeTitle = computed(() => {
  if (secondaryTimeKind.value === 'tsat') return tsacTooltip.value
  if (secondaryTimeKind.value === 'assr') return assrTitle.value
  return undefined
})

const assrTitle = computed(() => {
  if (!props.strip.canResetSquawk) {
    return props.strip.squawk ? `ASSR ${props.strip.squawk}` : 'ASSR'
  }
  if (!props.strip.squawk) return 'ASSR — click for new code'
  return `ASSR ${props.strip.squawk} — double-click for new code`
})

function onAssrClick() {
  if (!props.strip.canResetSquawk) return
  if (!props.strip.squawk) onResetSquawk()
}

function onAssrDblClick() {
  if (!props.strip.canResetSquawk) return
  if (props.strip.squawk) onResetSquawk()
}

function onSecondaryTimeClick(event: MouseEvent) {
  switch (secondaryTimeKind.value) {
    case 'assr':
      onAssrClick()
      break
    case 'tsat':
      onTsacClick(event)
      break
    case 'ctot':
    case 'scl':
      onCtotClick(event)
      break
  }
}

function onSecondaryTimeDblClick() {
  if (secondaryTimeKind.value === 'assr') onAssrDblClick()
}

const canEditPrimaryTime = computed(() =>
  canEditAssignedData.value && (isFls.value || primaryTimeKind.value === 'tobt')
)

const showTobtSetBy = computed(() =>
  showCdm.value && !isFls.value && (props.strip.tobtSetBy === 'P' || props.strip.tobtSetBy === 'A')
)

const tobtSetByTitle = computed(() => {
  if (!showTobtSetBy.value) return undefined
  return props.strip.tobtSetBy === 'P' ? 'TOBT set by Pilot' : 'TOBT set by ATC'
})

const primaryTimeLabelTitle = computed(() => {
  if (isFls.value) {
    return flsTooltip(cdmStatus.value?.raw || 'FLS', cdmStatus.value?.flsType)
  }
  return tobtSetByTitle.value
})

/** Brief flash when TOBT/TSAT/CTOT values change (incl. pilot TOBT updates) */
const TIME_CHANGED_FLASH_MS = 5000
const tobtChanged = ref(false)
const tsatChanged = ref(false)
const ctotChanged = ref(false)
let tobtChangedTimer: ReturnType<typeof setTimeout> | undefined
let tsatChangedTimer: ReturnType<typeof setTimeout> | undefined
let ctotChangedTimer: ReturnType<typeof setTimeout> | undefined

function triggerTimeChangedFlash(which: 'tobt' | 'tsat' | 'ctot') {
  if (!store.flashChangedTimes) return
  if (which === 'tobt') {
    tobtChanged.value = true
    if (tobtChangedTimer) clearTimeout(tobtChangedTimer)
    tobtChangedTimer = setTimeout(() => {
      tobtChanged.value = false
      tobtChangedTimer = undefined
    }, TIME_CHANGED_FLASH_MS)
  } else if (which === 'tsat') {
    tsatChanged.value = true
    if (tsatChangedTimer) clearTimeout(tsatChangedTimer)
    tsatChangedTimer = setTimeout(() => {
      tsatChanged.value = false
      tsatChangedTimer = undefined
    }, TIME_CHANGED_FLASH_MS)
  } else {
    ctotChanged.value = true
    if (ctotChangedTimer) clearTimeout(ctotChangedTimer)
    ctotChangedTimer = setTimeout(() => {
      ctotChanged.value = false
      ctotChangedTimer = undefined
    }, TIME_CHANGED_FLASH_MS)
  }
}

onMounted(() => {
  tsatWindowTimer = setInterval(() => {
    nowUtcMs.value = Date.now()
  }, 1000)
  nextTick(() => {
    scheduleStripScale(true)
    attachStripScaleObserver()
  })
})
watch(
  () => [
    props.strip.callsign,
    props.strip.communicationSuffix,
    props.strip.aircraftType,
    props.strip.wakeTurbulence,
    props.strip.stand,
    props.strip.runway,
    props.strip.assignedHeading,
    displayCfl.value,
    store.displaySidForStrip(props.strip),
    ownerSiText.value,
    showOwnerSi.value,
    primaryTimeValue.value,
    secondaryTimeValue.value,
    secondaryTimeKind.value,
  ],
  () => nextTick(() => fitAllBoxFonts()),
)
watch(
  () => props.isLargeView,
  () => {
    lastStripScaleWidth = 0
    nextTick(() => {
      attachStripScaleObserver()
      scheduleStripScale(true)
    })
  },
)

/** Owned by another controller — close any open assigned-data editors */
watch(
  () => props.strip.ownedByOther,
  (ownedByOther) => {
    if (!ownedByOther) return
    closeAssignmentMenus()
    clncDialogOpen.value = false
    remarksEditing.value = false
    hsEditing.value = false
    hpEditing.value = false
  },
)
onUnmounted(() => {
  if (tsatWindowTimer) clearInterval(tsatWindowTimer)
  if (tobtChangedTimer) clearTimeout(tobtChangedTimer)
  if (tsatChangedTimer) clearTimeout(tsatChangedTimer)
  if (ctotChangedTimer) clearTimeout(ctotChangedTimer)
  if (rofAlternateTimer) clearInterval(rofAlternateTimer)
  if (rofClockTimer) clearInterval(rofClockTimer)
  if (stripScaleRaf) cancelAnimationFrame(stripScaleRaf)
  stripResizeObs?.disconnect()
  stripResizeObs = null
  lastStripScaleWidth = 0
})

/** Normalize CDM times (HHMM or HHMMSS) to minutes since midnight */
function hhmmToMinutes(hhmm: string | undefined): number | null {
  if (!hhmm) return null
  const digits = hhmm.replace(/\D/g, '')
  if (digits.length < 3) return null
  const normalized = digits.length === 3 ? digits.padStart(4, '0') : digits.slice(0, 4)
  const h = Number(normalized.slice(0, 2))
  const m = Number(normalized.slice(2, 4))
  if (h > 23 || m > 59) return null
  return h * 60 + m
}

function normalizeHhmmDisplay(hhmm: string | undefined): string {
  if (!hhmm) return ''
  const digits = hhmm.replace(/\D/g, '')
  if (digits.length < 3) return ''
  return digits.length === 3 ? digits.padStart(4, '0') : digits.slice(0, 4)
}

const displayTsat = computed(() => normalizeHhmmDisplay(props.strip.tsat))

/** Absolute minute delta between two HHmm values (0–720, circular UTC). */
function hhmmAbsDeltaMinutes(a: string | undefined, b: string | undefined): number | null {
  const am = hhmmToMinutes(a)
  const bm = hhmmToMinutes(b)
  if (am == null || bm == null) return null
  let d = Math.abs(am - bm)
  if (d > 12 * 60) d = 24 * 60 - d
  return d
}

/** TSAC/CTOC UI only in CD ALL (pending_dep) and TSAT (cleared) — not push_start */
const showTsacCtoc = computed(() =>
  sectionIdMatches(props.strip.sectionId, TSAC_CTOC_SECTIONS)
)

const canEditTsac = computed(() =>
  canEditAssignedData.value && showTsacCtoc.value && showCdm.value && !!displayTsat.value
)

const canClearTsac = computed(() =>
  canEditAssignedData.value && showTsacCtoc.value && !!props.strip.tsac
)

/** TSAC set and within ±5 min of live TSAT — green box; menu on click */
const isTsacGreen = computed(() => {
  const tsac = normalizeHhmmDisplay(props.strip.tsac)
  if (!tsac) return false
  const delta = hhmmAbsDeltaMinutes(displayTsat.value, tsac)
  return delta != null && delta <= 5
})

/** TSAC was set, then live TSAT moved — highlight bottom ▼ until TSAT is clicked again */
const tsacStale = computed(() => {
  const tsac = normalizeHhmmDisplay(props.strip.tsac)
  const tsat = displayTsat.value
  return !!tsac && !!tsat && tsac !== tsat
})

const canEditCtoc = computed(() =>
  canEditAssignedData.value &&
  showTsacCtoc.value &&
  showCtot.value &&
  !showCtotCancelled.value &&
  !!props.strip.ctot
)

const canClearCtoc = computed(() =>
  canEditAssignedData.value &&
  showTsacCtoc.value &&
  showCtot.value &&
  !showCtotCancelled.value &&
  !!props.strip.ctoc
)

/** empty | green (match) | yellow (diverged) */
const tsacBoxClass = computed(() => {
  const tsac = normalizeHhmmDisplay(props.strip.tsac)
  if (!tsac) return { 'cdm-comm-empty': true }
  const delta = hhmmAbsDeltaMinutes(displayTsat.value, tsac)
  if (delta != null && delta <= 5) return { 'cdm-comm-green': true }
  return { 'cdm-comm-yellow': true }
})

/** Signed CTOT − CTOC minutes (circular UTC), or null if no CTOC. */
const ctocDeltaMinutes = computed((): number | null => {
  const ctoc = normalizeHhmmDisplay(props.strip.ctoc)
  if (!ctoc) return null
  const ctot = normalizeHhmmDisplay(props.strip.ctot)
  if (!ctot) return null
  const ctotM = hhmmToMinutes(ctot)
  const ctocM = hhmmToMinutes(ctoc)
  if (ctotM == null || ctocM == null) return null
  let signed = ctotM - ctocM
  if (signed > 12 * 60) signed -= 24 * 60
  if (signed < -12 * 60) signed += 24 * 60
  return signed
})

/** e.g. "+4", "-3", "0" when CTOC set; null → empty checkbox */
const ctocDeltaText = computed((): string | null => {
  const d = ctocDeltaMinutes.value
  if (d == null) {
    // CTOC set but no live CTOT (e.g. SCL) — still show that CTOC exists
    const ctoc = normalizeHhmmDisplay(props.strip.ctoc)
    return ctoc ? 'X' : null
  }
  return d > 0 ? `+${d}` : `${d}`
})

const tsacTooltip = computed(() => {
  const tsac = normalizeHhmmDisplay(props.strip.tsac)
  const tsat = displayTsat.value
  if (tsac && tsat && tsac === tsat) return `TSAC ${tsac} — options`
  if (tsacStale.value) return `TSAC ${tsac} — TSAT now ${tsat}; click to update`
  if (canEditTsac.value) return 'Click to set TSAC (communicated TSAT)'
  return 'TSAT'
})

const ctocTooltip = computed(() => {
  const ctoc = normalizeHhmmDisplay(props.strip.ctoc)
  if (ctoc) {
    const d = ctocDeltaMinutes.value
    if (d != null) {
      const sign = d > 0 ? '+' : ''
      return `CTOC ${ctoc} (${sign}${d})`
    }
    return `CTOC ${ctoc}`
  }
  if (canEditCtoc.value) return 'Set CTOC (communicated CTOT)'
  return props.strip.ctotReason || 'CTOT'
})

function onTsacClick(event?: MouseEvent) {
  if (!canEditTsac.value) return
  const tsat = displayTsat.value
  if (!tsat) return
  const tsac = normalizeHhmmDisplay(props.strip.tsac)
  // Already in sync with live TSAT → Edit / Remove menu
  if (tsac && tsac === tsat) {
    if (event) menuPosition.value = [event.clientX, event.clientY]
    menuOpen.value = false
    ctotMenuOpen.value = false
    reaMenuOpen.value = false
    transferMenuOpen.value = false
    groundStateMenuOpen.value = false
    tsacMenuOpen.value = true
    return
  }
  // Empty or stale: set / refresh TSAC from current TSAT
  store.setTsac(props.strip.id, tsat)
}

function onTsacClear() {
  if (!canClearTsac.value) return
  store.setTsac(props.strip.id, '')
}

function onEditTsacMenuClick() {
  tsacMenuOpen.value = false
  if (!canEditTsac.value) return
  timeEditMode.value = 'tsac'
  timeEditText.value = normalizeHhmmDisplay(props.strip.tsac) || displayTsat.value || ''
  timeEditing.value = true
  nextTick(() => timeEditInput.value?.focus())
}

function onRemoveTsacMenuClick() {
  tsacMenuOpen.value = false
  if (!canClearTsac.value) return
  store.setTsac(props.strip.id, '')
}

function onSetCtocMenuClick() {
  ctotMenuOpen.value = false
  if (!canEditCtoc.value) return
  const ctot = normalizeHhmmDisplay(props.strip.ctot)
  if (!ctot) return
  store.setCtoc(props.strip.id, ctot)
}

function onClearCtocMenuClick() {
  ctotMenuOpen.value = false
  if (!canClearCtoc.value) return
  store.setCtoc(props.strip.id, '')
}

// Non-immediate: flash only on real HHMM→HHMM changes.
// Ignore appear/clear during strip refresh (e.g. REA remove + vIFF poll).
// ATC-set TOBT (setBy A) — no highlight; still flash for pilot (P).
watch(
  () => normalizeHhmmDisplay(props.strip.tobt),
  (next, prev) => {
    if (!next || !prev || next === prev) return
    if (props.strip.tobtSetBy === 'A') return
    triggerTimeChangedFlash('tobt')
  },
)

watch(
  () => displayTsat.value,
  (next, prev) => {
    if (!next || !prev || next === prev) return
    triggerTimeChangedFlash('tsat')
  },
)

watch(
  () => {
    const c = props.strip.ctot || ''
    const digits = c.replace(/\D/g, '')
    if (digits.length < 3) return ''
    return digits.length === 3 ? digits.padStart(4, '0') : digits.slice(0, 4)
  },
  (next, prev) => {
    if (!next || !prev || next === prev) return
    triggerTimeChangedFlash('ctot')
  },
)

/**
 * GNG-style TSAT colours (UTC / Zulu), minute-inclusive:
 * - green: TSAT−5:00 … TSAT+5:00  (startup window)
 * - flash green↔yellow: last clock minute (TSAT+5:00 … TSAT+6:00)
 * - yellow + strikethrough: after window (TSAT+6:00 …)
 * - no colour before TSAT−5
 */
const tsatColorClass = computed(() => {
  if (!showCdm.value || !props.strip.tsat) return {}
  const tsatMin = hhmmToMinutes(props.strip.tsat)
  if (tsatMin == null) return {}

  const now = new Date(nowUtcMs.value)
  const nowMin = now.getUTCHours() * 60 + now.getUTCMinutes()
  const nowSec = nowMin * 60 + now.getUTCSeconds()
  const tsatSec = tsatMin * 60
  let deltaSec = nowSec - tsatSec
  if (deltaSec > 12 * 3600) deltaSec -= 24 * 3600
  if (deltaSec < -12 * 3600) deltaSec += 24 * 3600

  // Past window: expired TSAT
  if (deltaSec >= 6 * 60) return { 'tsat-expired': true }
  // Last clock minute of ±5 window (e.g. TSAT 1052 → flash all of 1057z)
  if (deltaSec >= 5 * 60 && deltaSec < 6 * 60) {
    return store.flashTsatWindow ? { 'tsat-flash': true } : { 'tsat-window': true }
  }
  // Inside TSAT±5 (before last minute): green
  if (deltaSec >= -5 * 60 && deltaSec < 5 * 60) return { 'tsat-window': true }

  return {}
})

const timeEditing = ref(false)
const timeEditMode = ref<'eobt' | 'tobt' | 'tsac'>('eobt')
const timeEditText = ref('')
const timeEditInput = ref<HTMLInputElement | null>(null)

function onPrimaryTimeClick() {
  if (!canEditPrimaryTime.value) return
  if (isFls.value) {
    timeEditMode.value = 'eobt'
    timeEditText.value = props.strip.eobt || ''
  } else if (primaryTimeKind.value === 'tobt') {
    timeEditMode.value = 'tobt'
    timeEditText.value = props.strip.tobt || props.strip.eobt || ''
  } else {
    return
  }
  timeEditing.value = true
  nextTick(() => timeEditInput.value?.focus())
}

function onReadyTobtClick() {
  if (!canEditAssignedData.value || !showCdm.value || isFls.value) return
  timeEditing.value = false
  // Server sets TOBT=now then REA sequentially (avoids REA-only races)
  store.viffReadyTobt(props.strip.id)
}

function onTimeEditCancel() {
  timeEditing.value = false
}

function onTimeEditBlur() {
  if (!timeEditing.value) return
  const value = timeEditText.value.trim()
  const mode = timeEditMode.value
  timeEditing.value = false
  if (!/^\d{4}$/.test(value)) return
  if (mode === 'tobt') {
    if (value !== (props.strip.tobt || props.strip.eobt || '')) {
      store.viffUpdateTobt(props.strip.id, value)
    }
  } else if (mode === 'tsac') {
    if (value !== normalizeHhmmDisplay(props.strip.tsac)) {
      store.setTsac(props.strip.id, value)
    }
  } else if (value !== props.strip.eobt) {
    store.viffUpdateEobt(props.strip.id, value)
  }
}

function onCtotClick(event: MouseEvent) {
  if (!canEditAssignedData.value || !showCtot.value || showCtotCancelled.value) return
  menuPosition.value = [event.clientX, event.clientY]
  menuOpen.value = false
  transferMenuOpen.value = false
  groundStateMenuOpen.value = false
  reaMenuOpen.value = false
  tsacMenuOpen.value = false
  ctotMenuOpen.value = true
}

function onSendReaClick() {
  ctotMenuOpen.value = false
  reaMenuOpen.value = false
  menuOpen.value = false
  if (!canSendRea.value) return
  store.viffRea(props.strip.id, true)
}

function onClearReaClick() {
  ctotMenuOpen.value = false
  reaMenuOpen.value = false
  menuOpen.value = false
  if (!canClearRea.value) return
  store.viffRea(props.strip.id, false)
}

function onReaBadgeClick(event: MouseEvent) {
  if (!canClearRea.value) return
  menuPosition.value = [event.clientX, event.clientY]
  menuOpen.value = false
  transferMenuOpen.value = false
  groundStateMenuOpen.value = false
  // With CTOT, reuse the CTOT menu (reason + Remove REA); otherwise REA-only menu
  if (showCtot.value) {
    reaMenuOpen.value = false
    ctotMenuOpen.value = true
  } else {
    ctotMenuOpen.value = false
    reaMenuOpen.value = true
  }
}

/** Strip label for action codes (internal codes unchanged for rules/handlers). */
function actionLabel(action: string): string {
  switch (action) {
    case 'CLNC': return 'CLR'
    case 'TXO':
    case 'TXI':
    case 'TAXI': return 'TAXI'
    case 'LU': return 'LINE UP'
    case 'CTO': return 'CFTO'
    case 'XFER': return 'TRANS'
    case 'PARK': return 'TERM'
    case 'GOA': return 'G/A'
    default: return action
  }
}

// DCL button coloring + action highlight
function actionButtonClass(action: string): Record<string, boolean> {
  const classes: Record<string, boolean> = {}

  // Inbound ROF: XFER alternates amber text ↔ ROF pink for flash window
  if (action === 'XFER' && isRofInbound.value && isRofFlashing.value) {
    if (rofFlashPink.value) classes['action-rof-pink'] = true
    else classes['action-key-amber'] = true
  } else if (props.strip.highlightActions?.includes(action)) {
    // Amber text on grey key (TRANS / TXI / PARK / etc.) — not filled background
    classes['action-key-amber'] = true
  }

  // ASSUME/ROF: condensed text; pending transfer (in or out) → amber ASSUME text
  if (action === 'ASSUME' || action === 'ROF') {
    classes['action-assume'] = true
    if (
      action === 'ASSUME' &&
      (props.strip.transferPending === 'in' || props.strip.transferPending === 'out')
    ) {
      classes['action-key-amber'] = true
      classes['action-highlight'] = false
    }
    // Outbound ROF: solid pink key for 2 min (re-press resets); still pressable
    if (action === 'ROF' && isRofOutbound.value && isRofFlashing.value) {
      classes['action-rof-pink'] = true
    }
  }

  // GOA gets its own colour
  if (action === 'GOA') {
    classes['action-goa'] = true
  }

  // DCL status coloring for CLNC button
  if (action === 'CLNC') {
    const status = props.strip.dclStatus
    classes['action-dcl-request'] = status === 'REQUEST'
    classes['action-dcl-error'] = status === 'INVALID' || status === 'UNABLE' || status === 'REJECTED'
    classes['action-dcl-sent'] = status === 'SENT'
  }

  return classes
}

// Mouse/pointer drag handlers (desktop)
function onDragStart(event: DragEvent) {
  if (props.isLargeView) {
    event.preventDefault()
    return
  }
  const dragTarget = event.target as HTMLElement | null
  if (dragTarget?.closest('.strip-close-btn') || dragTarget?.closest('.note-actions')) {
    event.preventDefault()
    return
  }
  isDragging.value = true
  if (event.dataTransfer && stripElement.value) {
    const rect = stripElement.value.getBoundingClientRect()
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('application/json', JSON.stringify({
      stripId: props.strip.id,
      bayId: props.bayId,
      sectionId: props.sectionId,
      isBottom: props.strip.bottom,
      originalTop: rect.top,
      originalBottom: rect.bottom,
      stripHeight: rect.height,
      dragOffsetY: event.clientY - rect.top // Offset from cursor to strip top
    }))
  }
}

function onDragEnd() {
  isDragging.value = false
}

// Touch drag handlers for drag areas (strip-left)
function onDragAreaTouchStart(event: TouchEvent) {
  if (props.isLargeView) return
  if (event.touches.length !== 1) return

  // Don't start drag when touching interactive editors/menus (callsign is OK — same as desktop)
  const target = event.target as HTMLElement
  if (
    target.closest('.action-button') ||
    target.closest('.squawk-empty') ||
    target.closest('.strip-close-btn') ||
    target.closest('.note-actions') ||
    target.closest('.exp-chip') ||
    target.closest('.ctrl-arrow') ||
    target.closest('.remarks-input') ||
    target.closest('.eobt-edit-input') ||
    target.closest('.hp-edit-input') ||
    target.closest('.hs-edit-input') ||
    target.closest('.cell-hp') ||
    target.closest('.cell-hs') ||
    target.closest('.cell-sid') ||
    target.closest('.cell-rwy') ||
    target.closest('.cell-cfl')
  ) return

  touchStarted = true

  const touch = event.touches[0]

  // Start drag after a short delay to distinguish from scroll
  longPressTimer = window.setTimeout(() => {
    if (touchStarted && stripElement.value && touch) {
      // Prevent context menu by stopping the event chain early
      event.preventDefault()
      isDragging.value = true
      const rect = stripElement.value.getBoundingClientRect()
      touchDrag.startDrag(stripElement.value, {
        stripId: props.strip.id,
        bayId: props.bayId,
        sectionId: props.sectionId,
        isBottom: props.strip.bottom,
        originalTop: rect.top,
        originalBottom: rect.bottom,
        stripHeight: rect.height,
        dragOffsetY: touch.clientY - rect.top
      }, touch)
    }
  }, LONG_PRESS_DELAY)
}

function onDragAreaTouchMove(event: TouchEvent) {
  if (!touchStarted) return

  if (isDragging.value && event.touches.length === 1 && event.touches[0]) {
    touchDrag.moveDrag(event.touches[0])
  }
}

function onDragAreaTouchEnd(event: TouchEvent) {
  if (longPressTimer) {
    clearTimeout(longPressTimer)
    longPressTimer = null
  }

  if (isDragging.value) {
    const result = touchDrag.endDrag()

    if (result.isTrashDrop && result.data) {
      store.deleteStrip(result.data.stripId)
      isDragging.value = false
      touchStarted = false
      return
    }

    if (result.dropTarget && result.data) {
      // Find the section info from the drop target
      const sectionEl = result.dropTarget.closest('.efs-section')
      const bayEl = sectionEl?.closest('.efs-bay')

      if (sectionEl && bayEl) {
        const targetSectionId = sectionEl.getAttribute('data-section-id')
        const targetBayId = bayEl.getAttribute('data-bay-id')

        if (targetSectionId && targetBayId) {
          if (result.isBottomDrop) {
            // Move to bottom strips - no gap logic for bottom strips
            store.moveStripToBottom(
              result.data.stripId,
              targetBayId,
              targetSectionId,
              result.dropPosition
            )
          } else {
            // Apply gap logic (same as desktop onTopDrop)
            handleTouchDropWithGaps(
              result.data,
              targetBayId,
              targetSectionId,
              result.dropTarget,
              result.draggedStripTop,
              result.touchY
            )
          }
        }
      }
    }

    isDragging.value = false
  }

  touchStarted = false
}

// Handle touch drop with full gap logic (mirrors EfsSection.vue onTopDrop)
function handleTouchDropWithGaps(
  data: { stripId: string; bayId: string; sectionId: string; isBottom?: boolean; originalTop?: number; originalBottom?: number; stripHeight?: number; dragOffsetY?: number },
  targetBayId: string,
  targetSectionId: string,
  dropTarget: HTMLElement,
  draggedStripTop: number,
  touchY: number
) {
  const { stripId, bayId: sourceBayId, sectionId: sourceSectionId, originalTop, originalBottom, stripHeight, dragOffsetY } = data

  // Find the top-strips-container within the drop target
  const container = dropTarget.querySelector('.top-strips-container') || dropTarget
  if (!container) {
    store.moveStripToSection(stripId, targetBayId, targetSectionId, 0)
    return
  }

  // If section is auto time-sorted, align store positions to what the user sees
  store.syncTimeSortSectionFromDom(targetBayId, targetSectionId, container)

  // Only consider "same section" if strip is in top zone of same section
  // Strips from bottom zone don't leave a space in top zone, so treat as cross-section move
  const isSameSection = sourceBayId === targetBayId && sourceSectionId === targetSectionId && !data.isBottom
  const allStripElements = Array.from(container.querySelectorAll('.flight-strip'))
  const allGapElements = Array.from(container.querySelectorAll('.strip-gap'))

  const draggedStripHeight = stripHeight || 50

  // Find the dragged strip's current index
  let draggedIndex = -1
  for (let i = 0; i < allStripElements.length; i++) {
    const el = allStripElements[i]
    if (el && el.getAttribute('data-strip-id') === stripId) {
      draggedIndex = i
      break
    }
  }

  // Check if drop happened on a gap
  let droppedOnGap = false
  let gapIndex = -1
  let gapRect: DOMRect | null = null
  let dropOnTopHalf = false

  for (const gapEl of allGapElements) {
    const rect = gapEl.getBoundingClientRect()
    if (touchY >= rect.top && touchY <= rect.bottom) {
      droppedOnGap = true
      gapIndex = parseInt(gapEl.getAttribute('data-gap-index') || '-1')
      gapRect = rect
      dropOnTopHalf = touchY < rect.top + rect.height / 2
      break
    }
  }

  // Handle drop on gap
  if (droppedOnGap && gapIndex !== -1 && gapRect) {
    const currentGapSize = store.getGapAtIndex(targetBayId, targetSectionId, gapIndex)

    // Check if the dragged strip was adjacent to this gap
    const wasAboveGap = isSameSection && draggedIndex === gapIndex - 1
    const wasBelowGap = isSameSection && draggedIndex === gapIndex

    // Calculate new gap size
    let newGapSize: number
    if (wasBelowGap && originalTop !== undefined) {
      // Strip below gap dragged upward - reduce gap by the distance dragged up
      const draggedUpDistance = originalTop - draggedStripTop
      newGapSize = draggedUpDistance > 0 ? Math.max(0, currentGapSize - draggedUpDistance) : currentGapSize
    } else if (wasAboveGap) {
      // Strip above gap dropped on gap - keep gap unchanged
      newGapSize = currentGapSize
    } else {
      // Strip from elsewhere - reduce gap by strip height
      newGapSize = currentGapSize - draggedStripHeight
    }

    // Remove the gap before moving (so adjustGapsForMove doesn't affect it)
    store.removeGapAtIndex(targetBayId, targetSectionId, gapIndex)

    // Determine insert position based on which half of the gap was hit
    let insertPosition: number

    if (dropOnTopHalf) {
      if (isSameSection && draggedIndex < gapIndex) {
        insertPosition = gapIndex - 1
      } else {
        insertPosition = gapIndex
      }
    } else {
      if (isSameSection && draggedIndex < gapIndex) {
        insertPosition = gapIndex - 1
      } else {
        insertPosition = gapIndex
      }
    }

    // Move the strip
    store.moveStripToSection(stripId, targetBayId, targetSectionId, insertPosition)

    // Re-add the gap at the correct position with the new size
    if (newGapSize >= store.GAP_BUFFER) {
      if (dropOnTopHalf) {
        store.setGapAtIndex(targetBayId, targetSectionId, insertPosition + 1, newGapSize)
      } else {
        store.setGapAtIndex(targetBayId, targetSectionId, insertPosition, newGapSize)
      }
    }

    return
  }

  // Calculate position, skipping the dragged strip for same-section moves
  const stripElements = isSameSection
    ? allStripElements.filter(el => el.getAttribute('data-strip-id') !== stripId)
    : allStripElements

  // Find drop position and check if dropping below last strip
  let position = stripElements.length
  let droppedBelowLastStrip = false
  let distanceBelowLastStrip = 0
  let droppedIntoEmptySection = false
  let distanceFromTop = 0

  if (stripElements.length > 0) {
    const lastStrip = stripElements[stripElements.length - 1]
    if (lastStrip) {
      const lastRect = lastStrip.getBoundingClientRect()
      if (draggedStripTop > lastRect.bottom) {
        droppedBelowLastStrip = true
        distanceBelowLastStrip = draggedStripTop - lastRect.bottom
      }
    }
  } else {
    // Empty section - check distance from container top
    const containerRect = container.getBoundingClientRect()
    distanceFromTop = draggedStripTop - containerRect.top
    if (distanceFromTop >= store.GAP_BUFFER) {
      droppedIntoEmptySection = true
    }
  }

  // Find position based on midpoints (using touchY for consistency with desktop using clientY)
  for (let i = 0; i < stripElements.length; i++) {
    const element = stripElements[i]
    if (!element) continue

    const rect = element.getBoundingClientRect()
    const midpoint = rect.top + rect.height / 2

    if (touchY < midpoint) {
      position = i
      droppedBelowLastStrip = false
      break
    }
  }

  // Handle same-section gap adjustments
  if (isSameSection && draggedIndex !== -1) {
    const currentGap = store.getGapAtIndex(targetBayId, targetSectionId, draggedIndex)

    // Check if position is effectively unchanged
    if (position === draggedIndex || (position === draggedIndex + 1 && draggedIndex === stripElements.length)) {
      if (originalTop !== undefined && originalBottom !== undefined) {
        const stripTopY = draggedStripTop

        // Get the position of the strip above
        const prevStripEl = draggedIndex > 0 ? allStripElements[draggedIndex - 1] : null
        const measureFromY = prevStripEl
          ? prevStripEl.getBoundingClientRect().bottom
          : container.getBoundingClientRect().top

        // Dragging down = increase gap (only for last strip)
        if (stripTopY > measureFromY + store.GAP_BUFFER && draggedIndex == stripElements.length) {
          const newGap = stripTopY - measureFromY
          store.setGapAtIndex(targetBayId, targetSectionId, draggedIndex, newGap)
          return
        }

        // Dragging up = decrease gap
        if (stripTopY < originalTop && currentGap > 0) {
          const delta = originalTop - stripTopY
          store.setGapAtIndex(targetBayId, targetSectionId, draggedIndex, Math.max(0, currentGap - delta))
          return
        }
      }

      // Dropped within original bounds - no change
      return
    }
  }

  // Move the strip
  store.moveStripToSection(stripId, targetBayId, targetSectionId, position)

  // Create gap if dropped below last strip with enough distance
  if (droppedBelowLastStrip && distanceBelowLastStrip >= store.GAP_BUFFER) {
    const gapSize = isSameSection
      ? distanceBelowLastStrip + draggedStripHeight
      : distanceBelowLastStrip
    store.setGapAtIndex(targetBayId, targetSectionId, position, gapSize)
  }

  // Create gap if dropped into empty section below the buffer distance
  if (droppedIntoEmptySection) {
    store.setGapAtIndex(targetBayId, targetSectionId, 0, distanceFromTop)
  }
}

function onDragAreaTouchCancel() {
  if (longPressTimer) {
    clearTimeout(longPressTimer)
    longPressTimer = null
  }

  if (isDragging.value) {
    touchDrag.cancelDrag()
    isDragging.value = false
  }

  touchStarted = false
}

// Action button handlers
function onActionClick(action: string) {
  if (action === 'CLNC') {
    if (!canEditAssignedData.value) return
    clncDialogOpen.value = true
    return
  }
  store.sendStripAction(props.strip.id, action)
}

function onActionTouch(event: TouchEvent, action: string) {
  event.preventDefault()
  if (action === 'CLNC') {
    if (!canEditAssignedData.value) return
    clncDialogOpen.value = true
    return
  }
  store.sendStripAction(props.strip.id, action)
}


/** Prevent double TopSky AllocateSSR from click+click on empty ASSR */
let lastAssrResetAt = 0
function onResetSquawk() {
  if (!props.strip.canResetSquawk) return
  const now = Date.now()
  if (now - lastAssrResetAt < 1500) return
  lastAssrResetAt = now
  // Triggers TopSky SSR allocation via plugin — EFS does not invent codes
  store.sendStripAction(props.strip.id, 'resetSquawk')
}

function onStripClick() {
  // Future: open strip detail/edit modal
}

function onContextMenu(event: MouseEvent) {
  menuPosition.value = [event.clientX, event.clientY]
  ctotMenuOpen.value = false
  tsacMenuOpen.value = false
  reaMenuOpen.value = false
  sidRouteMenuOpen.value = false
  rwyMenuOpen.value = false
  cflMenuOpen.value = false
  menuOpen.value = true
}

function onCallsignClick(event: MouseEvent) {
  // Left click only — right click uses contextmenu → classic menu
  if (event.button !== 0) return
  if (props.isLargeView) {
    emit('close-large-view')
    return
  }
  openLargeView()
}

function menuCoordsFromEvent(event: MouseEvent): [number, number] {
  let x = event.clientX
  let y = event.clientY
  // Synthetic / broken events often report 0,0 — anchor to the clicked cell instead
  if ((x === 0 && y === 0) || !Number.isFinite(x) || !Number.isFinite(y)) {
    const el = (event.currentTarget || event.target) as HTMLElement | null
    if (el?.getBoundingClientRect) {
      const r = el.getBoundingClientRect()
      x = r.left + r.width / 2
      y = r.bottom
    }
  }
  return [x, y]
}

function closeAssignmentMenus() {
  menuOpen.value = false
  ctotMenuOpen.value = false
  tsacMenuOpen.value = false
  reaMenuOpen.value = false
  groundStateMenuOpen.value = false
  transferMenuOpen.value = false
  sidRouteMenuOpen.value = false
  rwyMenuOpen.value = false
  cflMenuOpen.value = false
}

function onSidClick(event: MouseEvent) {
  if (!canEditAssignedData.value || isArrLayout.value) return
  menuPosition.value = menuCoordsFromEvent(event)
  closeAssignmentMenus()
  sidRouteMenuOpen.value = true
}

function onRwyClick(event: MouseEvent) {
  if (!canEditAssignedData.value || isNote.value) return
  menuPosition.value = menuCoordsFromEvent(event)
  closeAssignmentMenus()
  rwyMenuOpen.value = true
}

function onCflClick(event: MouseEvent) {
  if (!canEditAssignedData.value || isNote.value) return
  menuPosition.value = menuCoordsFromEvent(event)
  closeAssignmentMenus()
  cflMenuOpen.value = true
}

function onCallsignTouch(event: TouchEvent) {
  // Drag in progress — let strip touchend handle drop (do not stopPropagation)
  if (isDragging.value) return
  // Cancel pending long-press drag; this was a tap → zoom
  if (longPressTimer) {
    clearTimeout(longPressTimer)
    longPressTimer = null
  }
  touchStarted = false
  event.stopPropagation()
  event.preventDefault()
  if (props.isLargeView) {
    emit('close-large-view')
    return
  }
  openLargeView()
}

function onFplClick() {
  fplDialogOpen.value = true
  menuOpen.value = false
}

function onClncMenuClick() {
  if (!canEditAssignedData.value) return
  clncDialogOpen.value = true
  menuOpen.value = false
}

function onDeleteClick() {
  menuOpen.value = false
  if (isNote.value) {
    store.deleteStrip(props.strip.id)
    return
  }
  deleteDialogOpen.value = true
}

function onDeleteConfirm() {
  store.deleteStrip(props.strip.id)
  deleteDialogOpen.value = false
}

function onReleaseClick() {
  menuOpen.value = false
  store.releaseStrip(props.strip.id)
}

/** Cancel pending outbound handoff by re-assuming */
function onAssumeClick() {
  menuOpen.value = false
  store.sendStripAction(props.strip.id, 'ASSUME')
}

/** Refuse pending inbound handoff */
function onRefuseClick() {
  menuOpen.value = false
  store.sendStripAction(props.strip.id, 'REFUSE')
}

function onTransferClick(targetCallsign: string) {
  menuOpen.value = false
  transferMenuOpen.value = false
  store.manualTransfer(props.strip.id, targetCallsign)
}

function onGroundStateClick(action: string) {
  menuOpen.value = false
  groundStateMenuOpen.value = false
  store.sendStripAction(props.strip.id, action)
}
</script>

<style scoped>
.flight-strip {
  /* Type frame: sides wider, top/bottom = 1/4 of side width */
  --strip-type: #888;
  /* Amber highlight (transfer C/S, ASSUME text, action keys) — darker for readability */
  --strip-amber: #e08900;
  /* Scale from strip width (JS sets --strip-scale; design ref 400px → body 50px) */
  --strip-scale: 1;
  --frame-side: calc(8px * var(--strip-scale));
  --frame-tb: calc(var(--frame-side) / 4);
  /* Body height at design width; two rows fill strip, no gap between rows */
  --strip-body-h: calc(50px * var(--strip-scale));
  --strip-main-pad-y: 0px;
  /* Layout margins (cell size/placement) */
  --frame-inset-x: calc(3px * var(--strip-scale));
  --frame-inset-y-outer: calc(1px * var(--strip-scale));
  /* Drawn frame only — TB inset inside the cell (lower = taller frame) */
  --frame-visual-pad-y: calc(1.5px * var(--strip-scale));
  --frame-inset: calc(-3px * var(--strip-scale)); /* legacy measure fallback */
  --fs-base: calc(11px * var(--strip-scale));
  --fs-cs: calc(26px * var(--strip-scale));
  --fs-data: calc(16px * var(--strip-scale));
  --fs-data-lg: calc(17px * var(--strip-scale));
  /* STD / XFL / CFL / AHD — slightly smaller than SID/RWY */
  --fs-mid: calc(13px * var(--strip-scale));
  --fs-mid-ghost: calc(11px * var(--strip-scale));
  --fs-ghost: calc(13.5px * var(--strip-scale));
  --fs-left: calc(11px * var(--strip-scale));
  --fs-left-sm: calc(10px * var(--strip-scale));
  --fs-time: calc(10px * var(--strip-scale));
  --fs-action: calc(10px * var(--strip-scale));
  --fs-action-sm: calc(8px * var(--strip-scale));
  --actions-w: calc(48px * var(--strip-scale));
  --left-arrow-w: calc(14px * var(--strip-scale));
  /* Fixed left columns — width = arrow + ATYP + WTC */
  --left-atyp-w: calc(26px * var(--strip-scale));
  --left-wtc-w: calc(14px * var(--strip-scale));
  --strip-left-w: calc(var(--left-arrow-w) + var(--left-atyp-w) + var(--left-wtc-w));
  --ctrl-arrow-h: calc(12px * var(--strip-scale));
  /* HP column ≈ square, slightly wider than one body row */
  /* HS / HP ≈ square; RWY just a bit wider */
  --hp-col: calc(var(--strip-body-h) / 2 + 4px * var(--strip-scale));
  --rwy-col: calc(var(--hp-col) + 12px * var(--strip-scale));
  position: relative;
  display: flex;
  flex-direction: column;
  background: #ebebeb;
  border-style: solid;
  border-color: var(--strip-type);
  border-width: var(--frame-tb) var(--frame-side);
  margin: 1px 4px;
  cursor: grab;
  font-size: var(--fs-base);
  font-family: system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  box-sizing: border-box;
}

.strip-departure { --strip-type: #3b7dd8; }
.strip-arrival { --strip-type: #daa520; }
.strip-local { --strip-type: #881fe0; }
.strip-vfr { --strip-type: #3d9e3d; }
.strip-cross { --strip-type: #881fe0; }
/* Note strips: thin neutral edge like info strips (no type-coloured frame) */
.strip-note {
  --strip-type: #9a9a9a;
  border-width: 1px;
  border-color: #9a9a9a;
}

.flight-strip.dragging {
  opacity: 0.4;
  cursor: grabbing;
}

.flight-strip.is-large-view {
  width: 100%;
  margin: 0;
  cursor: default;
}

.strip-scribble-layer {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 6;
  overflow: hidden;
}

.strip-scribble-stroke {
  stroke: #1a1a1a;
  stroke-linecap: round;
  stroke-linejoin: round;
  /* Thickness in CSS px — avoids X/Y stretch from non-square strip viewBox */
  vector-effect: non-scaling-stroke;
}

.flight-strip.auto-move-hidden {
  opacity: 0;
}

.strip-note-layout {
  flex-direction: row;
  align-items: stretch;
  height: var(--strip-body-h);
  min-height: var(--strip-body-h);
  max-height: var(--strip-body-h);
}
.note-content {
  position: relative;
  flex: 1;
  display: flex;
  align-items: center;
  padding: 4px 8px;
  min-width: 0;
  height: 100%;
  overflow: hidden;
}
.note-actions {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: flex-start;
  padding: calc(1px * var(--strip-scale)) calc(1px * var(--strip-scale)) calc(1px * var(--strip-scale)) 0;
  cursor: default;
  touch-action: manipulation;
}
.note-display {
  width: 100%;
  border: none;
  background: transparent;
  font-size: calc(12px * var(--strip-scale));
  outline: none;
  pointer-events: none;
}
.note-empty { color: #999; font-style: italic; }

/* Expanders — only mounted when open; same bg as strip body, no row border */
.strip-expander {
  position: relative;
  display: flex;
  align-items: center;
  gap: calc(4px * var(--strip-scale));
  min-height: var(--ctrl-arrow-h);
  background: transparent;
  border: none;
  /* Left pad matches strip-left arrow inset so collapse ▲/▼ lines up with body arrows */
  padding: calc(2px * var(--strip-scale)) calc(6px * var(--strip-scale)) calc(2px * var(--strip-scale)) 1px;
  overflow: hidden;
  box-sizing: border-box;
}
.strip-expander-top,
.strip-expander-bottom { border: none; }
.exp-chips {
  display: flex;
  align-items: center;
  gap: calc(4px * var(--strip-scale));
  flex: 1;
  min-width: 0;
  overflow: hidden;
}
/* Bottom: [▼ RMK FPL | …][ASSR ADEP | remarks under CFL→][TMA] */
.strip-expander-bottom {
  display: grid;
  grid-template-columns: auto 1fr var(--actions-w);
  align-items: center;
  gap: 0;
  padding: calc(2px * var(--strip-scale)) 0 calc(2px * var(--strip-scale)) 1px;
}
.exp-bottom-left {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: calc(4px * var(--strip-scale));
  width: 100%;
  min-width: 0;
  overflow: hidden;
  box-sizing: border-box;
  padding-left: 0;
}
.exp-bottom-left .expander-arrow {
  width: calc(var(--left-arrow-w) - 2px);
  margin-left: 0;
  flex-shrink: 0;
}
.exp-bottom-left .exp-chip {
  flex-shrink: 0;
}
.exp-bottom-main {
  display: grid;
  align-items: center;
  min-width: 0;
  height: 100%;
  box-sizing: border-box;
}
/* Match strip-main column tracks so RMK starts under CFL */
.exp-bottom-main-dep {
  grid-template-columns: 0.72fr 0.92fr 0.68fr 0.72fr 0.87fr var(--hp-col) var(--hp-col) var(--rwy-col);
}
.exp-bottom-main-arr {
  grid-template-columns: 0.92fr 0.72fr 0.68fr 0.72fr 0.87fr var(--hp-col) var(--hp-col) var(--rwy-col);
}
/* Under STD+CTO (cols 1–2): FPL · ASSR · ADEP — RMK sits to the right of ADEP */
.exp-pre-rmk {
  grid-column: 1 / 3;
  display: flex;
  align-items: center;
  gap: calc(4px * var(--strip-scale));
  min-width: 0;
  overflow: hidden;
  padding: 0 calc(2px * var(--strip-scale));
  box-sizing: border-box;
}
/* CFL is 3rd column — span through end of main (up to TMA exit column) */
.exp-rmk {
  grid-column: 3 / -1;
  display: flex;
  align-items: center;
  min-width: 0;
  height: 100%;
  padding: 0 calc(2px * var(--strip-scale));
  box-sizing: border-box;
  cursor: pointer;
  overflow: hidden;
}
.exp-rmk-text {
  font-size: var(--fs-time);
  font-weight: 500;
  color: #000;
  letter-spacing: 0;
  line-height: 1.1;
  text-transform: uppercase;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  width: 100%;
}
.exp-rmk.ghost .exp-rmk-text {
  color: #c5c5c5 !important;
}
.exp-rmk .remarks-input {
  width: 100%;
  font-size: var(--fs-time);
  font-weight: 500;
  text-transform: uppercase;
}
/* Match left 3-row column text (times / FRUL·ATYP·WTC) */
.exp-assr,
.exp-ades,
.exp-tma-exit {
  font-size: var(--fs-time);
  font-weight: 500;
  color: #000;
  letter-spacing: 0;
  white-space: nowrap;
  line-height: 1.1;
  text-transform: uppercase;
  flex-shrink: 0;
}
.exp-assr.squawk-empty {
  cursor: pointer;
  text-decoration: underline;
}
.exp-ades {
  margin-left: calc(10px * var(--strip-scale));
}
/* Same width as .strip-actions; text centered in the box */
.exp-tma-exit {
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--actions-w);
  min-width: var(--actions-w);
  max-width: var(--actions-w);
  height: 100%;
  box-sizing: border-box;
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  padding: 0;
  margin: 0;
  justify-self: stretch;
}
.exp-assr.ghost,
.exp-ades.ghost,
.exp-tma-exit.ghost {
  color: #c5c5c5 !important;
}
/* Collapse arrow in expander — same size/look as strip-left arrows */
.strip-expander .expander-arrow {
  width: calc(var(--left-arrow-w) - 2px);
  height: var(--ctrl-arrow-h);
  max-height: var(--ctrl-arrow-h);
  flex-shrink: 0;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0;
  border: 1px solid #888;
  background: #d8d8d8;
  color: #000;
  font-size: var(--fs-action-sm);
  font-weight: 700;
  line-height: 0;
  cursor: pointer;
  padding: 0;
}
.strip-expander .expander-arrow .arrow-glyph {
  display: block;
  line-height: 1;
  font-size: 0.85em;
  transform: scaleX(1.45);
}
.strip-expander .expander-arrow:hover { background: #e8e8e8; }
.strip-expander .expander-arrow.mirrored .arrow-glyph {
  transform: scaleX(1.45) scaleY(-1);
}
/* Extender action chips — match arrow / right-side action key look */
.exp-chip {
  height: var(--ctrl-arrow-h);
  max-height: var(--ctrl-arrow-h);
  padding: 0 calc(6px * var(--strip-scale));
  box-sizing: border-box;
  display: grid;
  place-items: center;
  border: 1px solid #888;
  border-radius: 0;
  background: #d8d8d8;
  color: #000;
  font-size: var(--fs-action-sm);
  font-weight: 700;
  letter-spacing: 0.3px;
  line-height: 1;
  cursor: pointer;
  text-transform: uppercase;
  flex-shrink: 0;
}
/* Hover only for plain chips — do not wash out green/orange/DCL highlights */
.exp-chip:hover:not(:disabled):not(.exp-rea):not(.exp-qnh-ok):not(.exp-qnh-stale):not(.active):not(.dcl-request):not(.dcl-ok):not(.dcl-err) {
  background: #e8e8e8;
}
.exp-chip:disabled { opacity: 0.55; cursor: default; }
.exp-chip.active { background: var(--strip-amber); }
.exp-chip.exp-rea { background: #12b33a; color: #fff; border-color: #0a8a2a; }
.exp-chip.exp-qnh-ok { background: #12b33a; color: #fff; border-color: #0a8a2a; }
.exp-chip.exp-qnh-stale { background: var(--strip-amber); color: #fff; border-color: #b06a00; }
.exp-chip.inert { opacity: 0.55; cursor: default; }
.exp-chip.dcl-request { background: #fdd835; }
.exp-chip.dcl-ok { background: #66bb6a; color: #000; }
.exp-chip.dcl-err { background: #e53935; color: #000; }
.exp-remarks {
  font-size: calc(9px * var(--strip-scale));
  color: #2244aa;
  text-transform: uppercase;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.remarks-input {
  flex: 1;
  min-width: 0;
  border: none;
  background: transparent;
  font-size: 10px;
  color: #2244aa;
  text-transform: uppercase;
  outline: none;
}

/* Left ▲ / I / ▼ control column (opens top/bottom menus) */
.strip-ctrl {
  grid-area: ctrl;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: space-between;
  padding: 2px 0;
  border-right: 1px solid #b0b0b0;
}
.ctrl-arrow {
  width: 16px;
  height: 14px;
  padding: 0;
  border: 1px solid #b0b0b0;
  background: #ddd;
  font-size: 9px;
  line-height: 1;
  cursor: pointer;
  color: #111;
}
.ctrl-arrow:hover { background: #eee; }
.ctrl-ident { font-size: 10px; font-weight: 700; line-height: 1; }

/* Shared cells */
/* Empty slots: dim placeholder text only — frames stay full strength */
.ghost {
  color: #c5c5c5 !important;
  font-weight: 500 !important;
}
.strip-main .cell-sid.ghost {
  color: #d2b4b4 !important; /* muted red placeholder */
  font-weight: 500 !important;
}
.strip-time.ghost,
.strip-time.ghost .strip-time-lbl,
.strip-time.ghost .strip-time-val {
  color: #c5c5c5 !important;
  font-weight: 500 !important;
}
.exp-rmk.ghost .exp-rmk-text,
.exp-assr.ghost,
.exp-ades.ghost,
.exp-tma-exit.ghost {
  font-weight: 500 !important;
}

/*
 * INBOUND / dimmed strips: all data → placeholder grey.
 * Exceptions: callsign (and suffix/SI), highlighted (non-standard) RWY.
 */
.flight-strip.dimmed-data .strip-left .ctrl-ident,
.flight-strip.dimmed-data .strip-left .atyp-box,
.flight-strip.dimmed-data .strip-left .wtc-box,
.flight-strip.dimmed-data .strip-time,
.flight-strip.dimmed-data .strip-time .strip-time-lbl,
.flight-strip.dimmed-data .strip-time .strip-time-val,
.flight-strip.dimmed-data .strip-time .time-sts-label,
.flight-strip.dimmed-data .strip-main .cell,
.flight-strip.dimmed-data .strip-main .cell .cto-ctot,
.flight-strip.dimmed-data .strip-expand-top,
.flight-strip.dimmed-data .strip-expand-bottom,
.flight-strip.dimmed-data .exp-rmk,
.flight-strip.dimmed-data .exp-rmk-text,
.flight-strip.dimmed-data .exp-assr,
.flight-strip.dimmed-data .exp-ades,
.flight-strip.dimmed-data .exp-tma-exit {
  color: #c5c5c5 !important;
}
.flight-strip.dimmed-data .strip-main .cell-rwy.rwy-nonstandard {
  color: #000 !important;
}
.callsign {
  font-size: var(--fs-cs);
  font-weight: 700;
  color: #000;
  letter-spacing: 0.3px;
  line-height: 1.15;
  cursor: pointer;
}
.callsign-no-match { color: #999; font-style: italic; }
.comm-suffix { font-size: 0.7em; color: #b45309; margin-left: 1px; }
.owner-si { font-size: 0.62em; font-weight: 700; color: #003399; margin-left: 0.25em; }
/* Callsign: JS sets px to fit box; max tracks --strip-scale */
.strip-main .callsign-box {
  grid-area: cs;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  overflow: hidden;
  border: none;
  box-sizing: border-box;
  /* Tight pad so longer callsigns (EUW9792) can use more of the C/S box */
  padding: 0 calc(3px * var(--strip-scale));
  cursor: pointer;
}
.strip-main .callsign {
  font-weight: 700;
  letter-spacing: 0.02em;
  line-height: 1;
  white-space: nowrap;
  display: inline-block;
  max-width: none;
}
.strip-main .callsign .comm-suffix { font-size: 0.7em; }
.strip-main .callsign .owner-si { font-size: 0.62em; }
/* Pending transfer (in or out): callsign amber — not used for “should TRANS” */
.strip-main .callsign.callsign-transfer-pending {
  color: var(--strip-amber);
}
.owner-si.si-transfer-in { color: #0a7a28; }
.owner-si.si-transfer-out { color: #b05a00; }
.owner-si.si-rof-request, .owner-si.si-rof-target { color: #dc7cae; }

.atyp-box, .wtc-box {
  display: inline-block;
  padding: 0 3px;
  line-height: 1.2;
  font-size: 9px;
  font-weight: 700;
}
.wtc-box.boxed {
  border: 2px solid #111;
}
.wtc-box.plain { border: none; padding-left: 4px; }

.clearance-triangle.mini {
  width: 16px;
  height: 16px;
  fill: #008001;
}

/* Shared ARR/DEP body — fixed height; content must not grow strip */
.strip-grid {
  position: relative;
  display: grid;
  grid-template-columns: auto 1fr auto;
  height: var(--strip-body-h);
  min-height: var(--strip-body-h);
  max-height: var(--strip-body-h);
  overflow: hidden;
  flex-shrink: 0;
  box-sizing: border-box;
  align-items: stretch;
}

/* Left: 3 cols × 3 rows — fixed width so ATYP/times never shrink the block */
.strip-left {
  --strip-left-arrow: var(--left-arrow-w);
  display: grid;
  grid-template-columns: var(--strip-left-arrow) var(--left-atyp-w) var(--left-wtc-w);
  grid-template-rows: 1fr 1fr 1fr;
  grid-template-areas:
    'up   timeT timeT'
    'frul atyp  wtc'
    'dn   timeB timeB';
  width: var(--strip-left-w);
  min-width: var(--strip-left-w);
  max-width: var(--strip-left-w);
  box-sizing: border-box;
  align-items: stretch;
  flex-shrink: 0;
}
.strip-left-up { grid-area: up; place-self: center; }
.strip-left-dn { grid-area: dn; place-self: center; }
/* Middle row only: framed FRUL / ATYP / WTC (dim frames, same as data boxes) */
.strip-left .ctrl-ident,
.strip-left .atyp-box,
.strip-left .wtc-box {
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #d8d8d8;
  outline: none;
  margin: 1px;
  box-sizing: border-box;
  min-width: 0;
  min-height: 0;
  color: #000;
  font-weight: 700;
}
.strip-left .ctrl-ident {
  grid-area: frul;
  justify-content: flex-end;
  padding: 0 calc(2px * var(--strip-scale));
  font-size: var(--fs-left);
  line-height: 1;
}
.strip-left .atyp-box {
  grid-area: atyp;
  padding: 0 calc(2px * var(--strip-scale));
  font-size: var(--fs-left-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.strip-left .wtc-box {
  grid-area: wtc;
  padding: 0 calc(2px * var(--strip-scale));
  font-size: var(--fs-left-sm);
  overflow: hidden;
}
/* Keep middle-row frame even when WTC is plain (M); thick black highlight only on WTC */
.strip-left .wtc-box.plain {
  border: 1px solid #d8d8d8;
  padding: 0 2px;
}
.strip-left .wtc-box.boxed {
  border: 2px solid #111;
  margin: 0;
}
/* Expander arrows: compact key; glyph centered + slightly wider */
.strip-left .ctrl-arrow {
  width: calc(100% - 2px);
  height: var(--ctrl-arrow-h);
  max-height: var(--ctrl-arrow-h);
  min-height: 0;
  place-self: center;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0;
  border: 1px solid #888;
  background: #d8d8d8;
  color: #000;
  font-size: var(--fs-action-sm);
  font-weight: 700;
  line-height: 0;
  cursor: pointer;
  padding: 0;
}
.strip-left .ctrl-arrow .arrow-glyph {
  display: block;
  line-height: 1;
  font-size: 0.85em;
  transform: scaleX(1.45);
}
.strip-left .ctrl-arrow:hover { background: #e8e8e8; }
.strip-left .ctrl-arrow.mirrored .arrow-glyph { transform: scaleX(1.45) scaleY(-1); }
/* REA set — green key, white glyph (top ▲) */
.ctrl-arrow.arrow-rea,
.strip-left .ctrl-arrow.arrow-rea,
.strip-expander .expander-arrow.arrow-rea {
  background: #12b33a !important;
  border-color: #0a8a2a;
  color: #fff;
}
.ctrl-arrow.arrow-rea .arrow-glyph,
.strip-left .ctrl-arrow.arrow-rea .arrow-glyph,
.strip-expander .expander-arrow.arrow-rea .arrow-glyph {
  color: #fff;
}
.ctrl-arrow.arrow-rea:hover,
.strip-left .ctrl-arrow.arrow-rea:hover,
.strip-expander .expander-arrow.arrow-rea:hover {
  background: #1fc44a !important;
}
/* Stale TSAC / QNH — amber key, white glyph (overrides REA on top ▲) */
.ctrl-arrow.arrow-stale,
.strip-left .ctrl-arrow.arrow-stale,
.strip-expander .expander-arrow.arrow-stale {
  background: var(--strip-amber) !important;
  border-color: #b06a00;
  color: #fff;
}
.ctrl-arrow.arrow-stale .arrow-glyph,
.strip-left .ctrl-arrow.arrow-stale .arrow-glyph,
.strip-expander .expander-arrow.arrow-stale .arrow-glyph {
  color: #fff;
}
.ctrl-arrow.arrow-stale:hover,
.strip-left .ctrl-arrow.arrow-stale:hover,
.strip-expander .expander-arrow.arrow-stale:hover {
  background: #f0a020 !important;
}
.strip-time-top { grid-area: timeT; }
.strip-time-bot { grid-area: timeB; }
.strip-time {
  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
  align-items: center;
  justify-content: center;
  gap: 2px;
  min-width: 0;
  max-width: 100%;
  width: 100%;
  padding: 0 2px;
  border: none;
  line-height: 1.1;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  font-size: var(--fs-time);
  font-weight: 500; /* normal — except CTOT / SLC */
  text-align: center;
  box-sizing: border-box;
}
.strip-time-lbl {
  font-size: 1em;
  font-weight: inherit;
  text-transform: uppercase;
  flex-shrink: 0;
  color: #000;
}
.strip-time-val {
  font-size: 1em;
  font-weight: inherit;
  flex-shrink: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  color: #000;
}
/* CTOT and cancelled CTOT (SLC/SCL) — bold + amber */
.strip-time.time-ctot,
.strip-time.time-ctot .strip-time-lbl,
.strip-time.time-ctot .strip-time-val {
  font-weight: 700;
  color: #d97706;
}
.time-fls, .label-fls { color: #c00000; }
.tsat-mini { color: #00a000; }
.time-sts-label { font-size: 0.7em; font-weight: 700; color: #d97706; }

/* Fixed columns; two equal rows fill strip (tiny TB pad), no gap between rows */
.strip-main {
  display: grid;
  grid-template-rows: 1fr 1fr;
  align-content: stretch;
  height: 100%;
  min-height: 0;
  min-width: 0;
  padding: var(--strip-main-pad-y) 0;
  row-gap: 0;
  box-sizing: border-box;
}
.strip-grid-dep .strip-main {
  /* empty col left of HS; RWY slightly wider than HS/HP; XFL/CFL a bit wider */
  grid-template-columns: 0.72fr 0.92fr 0.68fr 0.72fr 0.87fr var(--hp-col) var(--hp-col) var(--rwy-col);
  grid-template-areas:
    'cs  cs  xfl .   .   hs  hp  rwy'
    'std cto cfl ahd sid sid sid sid';
}
.strip-grid-arr .strip-main {
  grid-template-columns: 0.92fr 0.72fr 0.68fr 0.72fr 0.87fr var(--hp-col) var(--hp-col) var(--rwy-col);
  grid-template-areas:
    'cs  cs  .   .   .   hs  hp  rwy'
    'cto std cfl ahd .   .   .   .';
}
/*
 * Framed data boxes: layout margins keep cell size/placement.
 * ::after draws the visible frame with extra vertical padding inside the cell.
 */
.strip-main .cell-xfl,
.strip-main .cell-hs,
.strip-main .cell-hp,
.strip-main .cell-rwy {
  position: relative;
  margin: var(--frame-inset-y-outer) var(--frame-inset-x) 0;
  outline: none !important;
}
.strip-main .cell-std,
.strip-main .cell-cfl,
.strip-main .cell-ahd {
  position: relative;
  margin: 0 var(--frame-inset-x) var(--frame-inset-y-outer);
  outline: none !important;
}
.strip-main .cell-xfl::after,
.strip-main .cell-hs::after,
.strip-main .cell-hp::after,
.strip-main .cell-rwy::after,
.strip-main .cell-std::after,
.strip-main .cell-cfl::after,
.strip-main .cell-ahd::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: var(--frame-visual-pad-y);
  bottom: var(--frame-visual-pad-y);
  border: 1px solid #d8d8d8;
  box-sizing: border-box;
  pointer-events: none;
}

/* Main data fields — bold; sizes track --strip-scale, then .fit-font */
.cell-xfl {
  grid-area: xfl;
  font-size: var(--fs-mid-ghost);
  font-weight: 700;
  border: none !important;
}
.cell-xfl:not(.ghost) {
  font-size: var(--fs-mid);
}
.cell-hs {
  grid-area: hs;
  font-size: var(--fs-ghost);
  font-weight: 700;
  border: none !important;
}
.cell-hs.editable {
  cursor: pointer;
}
.cell-hs:not(.ghost) {
  font-size: var(--fs-data);
}
.cell-hp {
  grid-area: hp;
  font-size: var(--fs-ghost);
  font-weight: 700;
  border: none !important;
}
.cell-hp.editable {
  cursor: pointer;
}
.cell-hp:not(.ghost) {
  font-size: var(--fs-data);
}
.cell-rwy {
  grid-area: rwy;
  font-size: var(--fs-ghost);
  font-weight: 700;
  border: none !important;
}
.cell-rwy.editable {
  cursor: pointer;
}
.cell-rwy:not(.ghost) {
  font-size: var(--fs-data-lg);
}
/* Non-standard RWY — not ES-active and/or outside selected ESSA config */
.strip-main .cell-rwy.rwy-nonstandard {
  color: #000;
  isolation: isolate;
}
.strip-main .cell-rwy.rwy-nonstandard::after {
  background: #e8e84a;
  border-color: #b0b020;
  z-index: -1;
}
.cell-std {
  grid-area: std;
  font-size: var(--fs-mid-ghost);
  font-weight: 700;
  border: none !important;
}
.cell-std:not(.ghost) {
  font-size: var(--fs-mid);
}
.cell-cto {
  grid-area: cto;
  position: relative;
  display: block !important;
  border: none !important;
  background: transparent;
  padding: 0 !important;
  /* Bleed into neighbours so the contour meets STD/CFL frames */
  margin: 0 -1px !important;
  overflow: hidden;
  align-self: stretch;
  justify-self: stretch;
  min-width: 0;
  min-height: 0;
  z-index: 1;
}
.cell-cto.has-ctot { cursor: pointer; }
.cell-cto .cto-ctot {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  font-size: calc(11px * var(--strip-scale));
  font-weight: 700;
  letter-spacing: 0.02em;
  color: #000;
  line-height: 1;
  pointer-events: none;
  white-space: nowrap;
  /* Below geometric center (takeoff △ mass is lower) */
  transform: translateY(18%);
}
.cell-cto .cto-ctot.scl { color: #000; }
.cell-cto .clearance-triangle,
.cell-cto .clearance-triangle.mini {
  position: absolute;
  left: 0;
  right: 0;
  top: 3px;
  display: block;
  width: 100% !important;
  /* Shorter so the 3px upward nudge does not clip the tip */
  height: calc(100% - 3px) !important;
  margin: 0;
  padding: 0;
  border: none;
  /* Inactive: dim frame (same as all data boxes); round joins */
  fill: none;
  stroke: #d8d8d8;
  stroke-width: 1.25;
  stroke-linejoin: round;
  stroke-linecap: round;
  overflow: visible;
  /* Nudge up so base/tip stroke stays inside the strip */
  transform: translateY(-3px);
}
.cell-cto .clearance-triangle:not(.active) path {
  /* Keep outline hairline thin despite preserveAspectRatio=none stretch */
  vector-effect: non-scaling-stroke;
}
/* CTOT present: mid-grey outline (less dim than empty; thinner than ATD/ATA) */
.cell-cto .clearance-triangle.ctot-border:not(.active) {
  stroke: #888;
  stroke-width: 1.75;
}
/* ATD / ATA: thicker green outline (departed / arrived) */
.cell-cto .clearance-triangle.green-border:not(.active) {
  stroke: #008001;
  stroke-width: 2.75;
}
/* ATA sits in landing △ (point down) — slightly above mid, stay inside the outline */
.cell-cto .clearance-triangle.landing ~ .cto-ctot {
  transform: translateY(-27%);
}
.cell-cto .clearance-triangle.active {
  fill: #008001;
  stroke: #008001;
  stroke-width: 1.5;
  stroke-linejoin: round;
  stroke-linecap: round;
}
.cell-cto .clearance-triangle.active path {
  vector-effect: non-scaling-stroke;
}
.cell-cfl {
  grid-area: cfl;
  font-size: var(--fs-mid-ghost);
  font-weight: 700;
  border: none !important;
}
.cell-cfl.editable {
  cursor: pointer;
}
/* Preferred CFL preview (not yet assigned via CLR) */
.cell-cfl.cfl-preview:not(.ghost) {
  color: var(--strip-amber);
}
.cell-cfl:not(.ghost) {
  font-size: var(--fs-mid);
}
.cell-ahd {
  grid-area: ahd;
  font-size: var(--fs-mid-ghost);
  font-weight: 700;
  border: none !important;
}
.cell-ahd:not(.ghost) {
  font-size: var(--fs-mid);
}
.cell-sid {
  grid-area: sid;
  justify-content: center;
  text-align: center;
  padding-left: 0;
  font-size: var(--fs-ghost);
  font-weight: 700;
  color: #b00000;
  border: none !important;
}
.cell-sid.editable {
  cursor: pointer;
}
.cell-sid:not(.ghost) {
  font-size: var(--fs-data-lg);
}
/* VFR / SLOW track / radar-vector ve SID — same amber as pending transfer callsign */
.cell-sid.sid-highlight:not(.ghost) {
  color: var(--strip-amber);
}

.cell {
  display: flex;
  align-items: center;
  justify-content: center;
  border-right: 1px solid #b0b0b0;
  padding: 0 2px;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  box-sizing: border-box;
  font: inherit;
  font-weight: 700;
  background: transparent;
  color: #000;
  margin: 0;
}
.eobt-edit-input {
  width: 100%;
  border: 1px solid #666;
  font-size: var(--fs-base);
  padding: 0 calc(2px * var(--strip-scale));
}
.cell-hs.hs-editing,
.cell-hp.hp-editing {
  overflow: visible;
}
.hs-edit-input,
.hp-edit-input {
  position: relative;
  z-index: 2;
  display: block;
  width: 100%;
  min-width: 0;
  min-height: calc(14px * var(--strip-scale));
  margin: 0;
  border: 1px solid #666;
  background: #fff;
  color: #000;
  caret-color: #000;
  font-family: inherit;
  font-size: var(--fs-mid);
  font-weight: 700;
  line-height: 1.2;
  text-align: center;
  text-transform: uppercase;
  padding: 0 calc(1px * var(--strip-scale));
  box-sizing: border-box;
  outline: none;
  -webkit-text-fill-color: #000;
}

/* Actions — fill right column; label centered in the cell */
.strip-actions {
  display: flex;
  flex-direction: column;
  justify-content: stretch;
  align-items: stretch;
  gap: 0;
  background: #d8d8d8;
  /* Full key frame (same as arrow / extender chips) — was left-only */
  border: 1px solid #888;
  min-width: var(--actions-w);
  width: var(--actions-w);
  height: 100%;
  align-self: stretch;
  box-sizing: border-box;
}
.action-button {
  flex: 1 1 0;
  min-height: 0;
  width: 100%;
  margin: 0;
  border: none;
  border-radius: 0;
  appearance: none;
  -webkit-appearance: none;
  background: #d8d8d8;
  color: #000;
  font-size: var(--fs-action);
  font-weight: 700;
  letter-spacing: 0.3px;
  text-transform: uppercase;
  text-align: center;
  cursor: pointer;
  padding: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  line-height: 1.1;
}
/* Two (or more) actions: hairline separator, no gap */
.strip-actions.multi-action .action-button:not(:last-child) {
  border-bottom: 1px solid #666;
}
.action-button:hover { background: #e8e8e8; }
.action-text {
  display: block;
  width: 100%;
  text-align: center;
}
.action-freq {
  font-size: var(--fs-action-sm);
  font-weight: 600;
  text-align: center;
}
.action-button.action-highlight,
.action-button.action-clnc-highlight {
  background: var(--strip-amber) !important;
}
/* Amber action-key text (inbound ASSUME / highlighted TRANS) — grey fill, amber label */
.action-button.action-key-amber {
  background: #d8d8d8 !important;
  color: var(--strip-amber) !important;
}
.action-button.action-key-amber .action-text,
.action-button.action-key-amber .action-freq {
  color: var(--strip-amber) !important;
}
.action-button.action-dcl-sent {
  background: #66bb6a !important;
  color: #000 !important;
}
.action-button.action-dcl-request {
  background: #fdd835 !important;
  color: #000 !important;
}
.action-button.action-dcl-error {
  background: #e53935 !important;
  color: #000 !important;
}
/* Pink ROF label on grey key — not filled pink background */
.action-button.action-rof-pink {
  background: #d8d8d8 !important;
  color: #dc7cae !important;
}
.action-button.action-rof-pink .action-text,
.action-button.action-rof-pink .action-freq {
  color: #dc7cae !important;
}

/* Context menus (unchanged look) */
.strip-context-menu { font-size: 12px; }
.transfer-freq { color: #888; font-size: 11px; margin-left: 4px; }
.gs-code {
  display: inline-block;
  width: 28px;
  font-weight: bold;
  font-size: 11px;
}
.ctot-reason-title { font-size: 11px; white-space: normal; }
.squawk-empty { cursor: pointer; text-decoration: underline; }
.squawk-resettable { cursor: pointer; }
</style>

<style>
/* Delete confirmation dialog - unscoped because v-dialog teleports */
.delete-dialog-wrapper {
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5) !important;
}

.delete-dialog {
  background: #2a2a2e;
  border: 2px solid #555;
  padding: 0;
}

.delete-dialog-text {
  padding: 16px;
  color: #e0e0e0;
  font-size: 13px;
  font-weight: 600;
  text-align: center;
}

.delete-dialog-actions {
  display: flex;
  border-top: 1px solid #555;
}

.delete-dialog-btn {
  flex: 1;
  padding: 8px 0;
  border: none;
  font-size: 12px;
  font-weight: bold;
  cursor: pointer;
  letter-spacing: 0.5px;
}

.delete-dialog-cancel {
  background: #555;
  color: #ccc;
  border-right: 1px solid #666;
}

.delete-dialog-cancel:hover {
  background: #666;
}

.delete-dialog-confirm {
  background: #c62828;
  color: #fff;
}

.delete-dialog-confirm:hover {
  background: #e53935;
}
</style>
