<template>
  <ClearanceDialog v-model="clncDialogOpen" :strip="strip" />
  <FlightplanDialog v-model="fplDialogOpen" :strip="strip" />
  <DepCoordDialog
    v-model="depCoordDialogOpen"
    :strip="strip"
    :assumed-before-open="depCoordAssumedBeforeOpen"
  />
  <AtdDialog v-model="atdDialogOpen" :strip="strip" @confirm="onAtdDialogConfirm" />
  <TsacDialog
    v-model="tsacDialogOpen"
    :strip="strip"
    :initial="tsacDialogInitial"
  />
  <CoordProposalDialog v-model="coordProposalDialogOpen" :strip="strip" />
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

  <TobtMenu
    v-model="tobtMenuOpen"
    :strip="strip"
    :target="menuPosition"
    :kind="timeMenuKind"
    :z-index="overlayMenuZ"
  />

  <v-menu v-model="menuOpen" :target="menuPosition" location="end" :z-index="overlayMenuZ" :close-on-content-click="true">
    <div class="efs-popup-menu" @click.stop>
      <div class="efs-popup-header">{{ strip.callsign }}</div>
      <div class="efs-popup-list">
        <button v-if="isDeparture && canEditAssignedData && !isPaperEmptyFlightHolder" type="button" class="efs-popup-item" @click="onClncMenuClick">Clearance</button>
        <button v-if="!isLocalOnlyStrip" type="button" class="efs-popup-item" @click="onFplClick">Flightplan</button>
        <button
          v-if="canShowContactMe"
          type="button"
          class="efs-popup-item"
          @click="onContactMeClick"
          title="EuroScope .contactme (needs ES window focus)"
        >Contact me</button>
        <button
          v-if="canAssumeFromMenu"
          type="button"
          class="efs-popup-item"
          @click="onAssumeClick"
        >Assume</button>
        <button v-if="strip.transferPending === 'in' && !isLocalOnlyStrip && store.isController" type="button" class="efs-popup-item" @click="onRefuseClick">Refuse</button>
        <button v-if="strip.isAssumed && !isLocalOnlyStrip" type="button" class="efs-popup-item" @click="onReleaseClick">Release</button>
        <button
          v-if="strip.isAssumed && !isLocalOnlyStrip && store.controllers.length > 0"
          type="button"
          class="efs-popup-item"
          @click.stop="transferMenuOpen = true"
        >Transfer to…</button>
        <button
          v-if="!isLocalOnlyStrip && canEditAssignedData"
          type="button"
          class="efs-popup-item"
          @click.stop="groundStateMenuOpen = true"
        >State: {{ groundStateLabel }}</button>
        <button
          v-if="canOpenReadyTobt"
          type="button"
          class="efs-popup-item"
          @click="openTobtMenuFromContext"
        >Ready TOBT…</button>
        <button
          v-if="canSendCdmPm"
          type="button"
          class="efs-popup-item"
          :class="{ selected: strip.cdmInformed }"
          :title="cdmPmMenuTitle"
          @click="onSendCdmPmClick"
        >{{ cdmPmMenuLabel }}</button>
        <button v-if="canSendRea" type="button" class="efs-popup-item" @click="onSendReaClick">Set REA</button>
        <button v-if="canClearRea" type="button" class="efs-popup-item" @click="onClearReaClick">Remove REA</button>
        <button
          v-if="canCompactStrip && !isLargeView"
          type="button"
          class="efs-popup-item"
          @click.stop="sizeMenuOpen = true"
        >Size…</button>
        <button
          v-if="store.isPaperLook && canDragStrip && !isLargeView"
          type="button"
          class="efs-popup-item"
          @click.stop="klackMenuOpen = true"
        >Klack…</button>
        <button
          v-if="showSaabCockEdges"
          type="button"
          class="efs-popup-item"
          @click.stop="klackMenuOpen = true"
        >Cock…</button>
        <button type="button" class="efs-popup-item" @click="onDeleteClick">Delete</button>
      </div>
    </div>

    <v-menu v-model="klackMenuOpen" :target="menuPosition" location="end" :z-index="overlayMenuZ + 1" :close-on-content-click="true">
      <div class="efs-popup-menu" @click.stop>
        <div class="efs-popup-header">{{ store.isPaperLook ? 'Klack' : 'Cock' }}</div>
        <div class="efs-popup-list">
          <button type="button" class="efs-popup-item" @click="onKlackMenu('right')">RIGHT</button>
          <button type="button" class="efs-popup-item" @click="onKlackMenu('left')">LEFT</button>
          <button
            v-if="strip.klack"
            type="button"
            class="efs-popup-item"
            @click="onKlackMenu(null)"
          >{{ store.isPaperLook ? 'Reset Klack' : 'Reset Cock' }}</button>
        </div>
      </div>
    </v-menu>

  <!-- Nested so an outside click closes this menu and the strip menu together -->
  <v-menu v-model="sizeMenuOpen" submenu :target="menuPosition" location="end" offset="150" :z-index="overlayMenuZ" :close-on-content-click="true">
    <div class="efs-popup-menu" @click.stop>
      <div class="efs-popup-header">Size</div>
      <div class="efs-popup-list">
        <button
          type="button"
          class="efs-popup-item"
          :class="{ selected: isSizeExpanded }"
          @click="onSizeExpanded"
        >Expanded</button>
        <button
          type="button"
          class="efs-popup-item"
          :class="{ selected: !isCompact && !isSizeExpanded }"
          @click="onSizeNormal"
        >Normal</button>
        <button
          type="button"
          class="efs-popup-item"
          :class="{ selected: isCompact }"
          @click="onSizeCompact"
        >Compact</button>
      </div>
    </div>
  </v-menu>

  <!-- Ground state submenu -->
  <v-menu v-model="groundStateMenuOpen" submenu :target="menuPosition" location="end" offset="150" :z-index="overlayMenuZ" :close-on-content-click="true">
    <div class="efs-popup-menu" @click.stop>
      <div class="efs-popup-header">State</div>
      <div class="efs-popup-list">
        <button
          v-for="gs in groundStateOptions"
          :key="gs.action"
          type="button"
          class="efs-popup-item"
          :class="{ selected: gs.groundstate === (strip.groundstate ?? '') && !gs.extra }"
          @click="onGroundStateClick(gs.action)"
        ><span class="gs-code">{{ gs.code }}</span> {{ gs.label }}</button>
      </div>
    </div>
  </v-menu>

  <!-- Transfer submenu -->
  <v-menu v-model="transferMenuOpen" submenu :target="menuPosition" location="end" offset="150" :z-index="overlayMenuZ" :close-on-content-click="true">
    <div class="efs-popup-menu" @click.stop>
      <div class="efs-popup-header">Transfer</div>
      <div class="efs-popup-list">
        <button
          v-for="ctrl in store.controllers"
          :key="ctrl.callsign"
          type="button"
          class="efs-popup-item efs-popup-item--stack"
          @click="onTransferClick(ctrl.callsign)"
        >
          <span class="efs-popup-item-title">
            <template v-if="ctrl.positionId">{{ ctrl.positionId }} · </template>{{ ctrl.callsign }}
          </span>
          <span class="efs-popup-item-sub transfer-freq">{{ ctrl.frequency }}</span>
        </button>
      </div>
    </div>
  </v-menu>

  <!-- POB entry (RTC V/Z) -->
  <v-menu v-model="pobMenuOpen" submenu :target="menuPosition" location="end" :z-index="overlayMenuZ" :close-on-content-click="false">
    <div class="efs-popup-menu" @click.stop>
      <div class="efs-popup-header">POB</div>
      <div class="efs-popup-search">
        <input
          ref="pobInputEl"
          v-model="pobEditText"
          class="efs-popup-search-input"
          type="text"
          inputmode="numeric"
          maxlength="3"
          placeholder="000"
          @keydown.enter.prevent="onPobConfirm"
          @keydown.escape.prevent="pobMenuOpen = false"
        />
      </div>
      <div class="efs-popup-list">
        <button type="button" class="efs-popup-item" @click="onPobConfirm">Set</button>
        <button v-if="strip.pob" type="button" class="efs-popup-item" @click="onPobClear">Clear</button>
      </div>
    </div>
  </v-menu>
  </v-menu>

  <!-- TSAC menu (within TSAT window) -->
  <v-menu v-model="tsacMenuOpen" :target="menuPosition" location="end" :z-index="overlayMenuZ" :close-on-content-click="true">
    <div class="efs-popup-menu" @click.stop>
      <div class="efs-popup-header">TSAC</div>
      <div class="efs-popup-list">
        <button type="button" class="efs-popup-item" @click="onEditTsacMenuClick">Edit TSAC</button>
        <button v-if="canClearTsac" type="button" class="efs-popup-item" @click="onRemoveTsacMenuClick">Remove TSAC</button>
      </div>
    </div>
  </v-menu>

  <!-- CTOT menu (reason + CTOC + REA + CDM PM) -->
  <v-menu v-model="ctotMenuOpen" :target="menuPosition" location="end" :z-index="overlayMenuZ" :close-on-content-click="true">
    <div class="efs-popup-menu" @click.stop>
      <div class="efs-popup-header">CTOT</div>
      <div class="efs-popup-subheader">{{ strip.ctotReason || 'No regulation reason' }}</div>
      <div
        v-if="canEditCtoc || canClearCtoc || canSendRea || canClearRea || canSendCdmPm"
        class="efs-popup-list"
      >
        <button v-if="canEditCtoc" type="button" class="efs-popup-item" @click="onSetCtocMenuClick">Set CTOC</button>
        <button v-if="canClearCtoc" type="button" class="efs-popup-item" @click="onClearCtocMenuClick">Remove CTOC</button>
        <button v-if="canSendRea" type="button" class="efs-popup-item" @click="onSendReaClick">Set REA</button>
        <button v-if="canClearRea" type="button" class="efs-popup-item" @click="onClearReaClick">Remove REA</button>
        <button
          v-if="canSendCdmPm"
          type="button"
          class="efs-popup-item"
          :class="{ selected: strip.cdmInformed }"
          :title="cdmPmMenuTitle"
          @click="onSendCdmPmClick"
        >{{ cdmPmMenuLabel }}</button>
      </div>
    </div>
  </v-menu>

  <!-- REA badge menu (above TOBT when no CTOT) -->
  <v-menu v-model="reaMenuOpen" :target="menuPosition" location="end" :z-index="overlayMenuZ" :close-on-content-click="true">
    <div class="efs-popup-menu" @click.stop>
      <div class="efs-popup-header">REA</div>
      <div class="efs-popup-list">
        <button v-if="canClearRea" type="button" class="efs-popup-item" @click="onClearReaClick">Remove REA</button>
      </div>
    </div>
  </v-menu>

  <SidRouteMenu v-model="sidRouteMenuOpen" :strip="strip" :target="menuPosition" :z-index="overlayMenuZ" />
  <RwyMenu v-model="rwyMenuOpen" :strip="strip" :target="menuPosition" :z-index="overlayMenuZ" />
  <CflMenu v-model="cflMenuOpen" :strip="strip" :target="menuPosition" :z-index="overlayMenuZ" />
  <XflMenu v-model="xflMenuOpen" :strip="strip" :target="menuPosition" :z-index="overlayMenuZ" />
  <AhdMenu v-model="ahdMenuOpen" :strip="strip" :target="menuPosition" :z-index="overlayMenuZ" />

  <div
    ref="stripHostEl"
    class="strip-host"
    :class="{
      'strip-host--paper': store.isPaperLook && (!isNote || isPaperEmptyFlightHolder) && !isVehicle,
      'strip-host--cocked': !store.isPaperLook && (!!strip.klack || klackPulling),
      'strip-host--saab-cock': showSaabCockEdges,
      'strip-host--klack-instant': klackInstant,
    }"
    :style="{ ...klackHostStyle, ...cockHostStyle }"
  >
    <div
      v-if="klackPulling"
      class="klack-drop-layer"
      aria-hidden="true"
    >
      <div
        class="klack-drop-slot klack-drop-slot--left"
        :class="{ active: klackPullTarget === 'left' }"
      />
      <div
        class="klack-drop-slot klack-drop-slot--flush"
        :class="{ active: klackPullTarget === null }"
      />
      <div
        class="klack-drop-slot klack-drop-slot--right"
        :class="{ active: klackPullTarget === 'right' }"
      />
    </div>
    <!--
      SAAB cock hits live on the host (not inside .flight-strip) so they sit on the
      type-coloured CSS border — overflow:hidden on the strip would clip them.
    -->
    <button
      v-if="showSaabCockEdges"
      type="button"
      class="strip-cock-hit strip-cock-hit--left"
      title="Cock left"
      aria-label="Cock left"
      @pointerdown.stop
      @click.stop="onCockEdgeClick('left')"
    />
    <button
      v-if="showSaabCockEdges"
      type="button"
      class="strip-cock-hit strip-cock-hit--right"
      title="Cock right"
      aria-label="Cock right"
      @pointerdown.stop
      @click.stop="onCockEdgeClick('right')"
    />
  <div ref="stripElement" class="flight-strip"
    :class="[stripTypeClass, {
      dragging: isDragging,
      'is-bottom': strip.bottom,
      'strip-note-layout': isNote && !isPaperEmptyFlightHolder,
      'strip-vehicle-layout': isVehicle,
      'look-essa': isVehicle && store.essaRolesMode,
      'look-paper': store.isPaperLook && (!isNote || isPaperEmptyFlightHolder) && !isVehicle,
      'paper-info-holder': store.isPaperLook && isPaperInfoHolder,
      'paper-empty-frame': store.isPaperLook && paperInfoKind === 'empty_frame',
      'paper-empty-arr': store.isPaperLook && paperInfoKind === 'empty_arr',
      'paper-empty-dep': store.isPaperLook && paperInfoKind === 'empty_dep',
      'auto-move-hidden': isAutoMoving,
      'print-anim-hidden': isPrinting,
      'layout-arr': isArrLayout,
      'layout-dep':
        (!isNote && !isVehicle && !isArrLayout) ||
        paperInfoKind === 'empty_dep' ||
        paperInfoKind === 'empty_frame',
      'top-expanded': topExpanded && !isCompactBay,
      'bottom-expanded': bottomExpanded && !isCompactBay,
      'is-large-view': isLargeView,
      'strip-compact': isCompactBay,
      'dimmed-data': dimmedData,
      'no-drag': !canDragStrip && !isLargeView,
      'rtc-layout': store.multiAirport,
      'klack-left': !klackPulling && strip.klack === 'left',
      'klack-right': !klackPulling && strip.klack === 'right',
      'klack-pulling': klackPulling,
      'klack-instant': klackInstant,
    }]"
    :style="klackPullStyle"
    :data-strip-id="strip.id"
    :draggable="canDragStrip && !usesCombinedStripPointer && !klackGestureActive ? true : false"
    @pointerdown="onPaperPointerDown"
    @pointermove="onPaperPointerMove"
    @pointerup="onPaperPointerUp"
    @pointercancel="onPaperPointerUp"
    @dragstart="onDragStart"
    @dragend="onDragEnd"
    @touchstart="onDragAreaTouchStart"
    @touchmove.prevent="onDragAreaTouchMove"
    @touchend="onDragAreaTouchEnd"
    @touchcancel="onDragAreaTouchCancel"
    @contextmenu.prevent="onContextMenu"
    @click="onStripClick">

    <!-- PAPER INFO / plain empty (red-black, no grid) — framed blanks use flight grid below -->
    <template v-if="isNote && paperInfoKind && !isPaperEmptyFlightHolder">
      <div
        class="paper-info-body"
        :class="`paper-info-${paperInfoKind}`"
        @click.stop="onNoteClick"
        @touchend="onNoteTouch"
      >
        <div v-if="paperInfoKind === 'hinder'" class="paper-info-full fit-font">HINDER</div>
        <div v-else-if="paperInfoKind === 'bogsering'" class="paper-info-panel paper-info-bogsering-text fit-font">Bogsering</div>
        <div v-else-if="paperInfoKind === 'snorojning'" class="paper-info-panel paper-info-panel-2 fit-font">
          <span>Snöröjning</span>
          <span>Pågår -&gt;</span>
        </div>
        <div v-else-if="paperInfoKind === 'prel_rojning'" class="paper-info-panel paper-info-panel-2 fit-font">
          <span>Prel nästa</span>
          <span>röjning -&gt;</span>
        </div>
        <!-- empty: blank paper body for scribbles -->
        <svg
          v-if="showStripScribbles"
          class="strip-scribble-layer"
          :viewBox="scribbleBandViewBox('body')"
          preserveAspectRatio="none"
        >
          <polyline
            v-for="(stroke, i) in stripScribbles"
            :key="'pi' + i"
            class="strip-scribble-stroke"
            :points="stroke.points"
            :stroke="scribbleStrokeHex(stroke.color)"
            fill="none"
            vector-effect="non-scaling-stroke"
            :stroke-width="bayScribbleStrokeWidth"
          />
          <polyline
            v-if="activeScribbleStroke"
            class="strip-scribble-stroke"
            :points="activeScribbleStroke"
            :stroke="scribbleStrokeHex(activeScribbleColor)"
            fill="none"
            vector-effect="non-scaling-stroke"
            :stroke-width="bayScribbleStrokeWidth"
          />
        </svg>
      </div>
      <!-- Paper: delete via drag to trash — no X -->
      <div v-if="!isLargeView && !store.isPaperLook" class="note-actions">
        <StripCloseButton @click="onNoteClose" />
      </div>
    </template>

    <!-- NOTE STRIP (scribble-only — tap opens zoom pen; ARR/DEP blanks use paper grid below) -->
    <template v-else-if="isNote && !isPaperEmptyFlightHolder">
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
            :points="stroke.points"
            :stroke="scribbleStrokeHex(stroke.color)"
            fill="none"
            vector-effect="non-scaling-stroke"
            :stroke-width="bayScribbleStrokeWidth"
          />
          <polyline
            v-if="activeScribbleStroke"
            class="strip-scribble-stroke"
            :points="activeScribbleStroke"
            :stroke="scribbleStrokeHex(activeScribbleColor)"
            fill="none"
            vector-effect="non-scaling-stroke"
            :stroke-width="bayScribbleStrokeWidth"
          />
        </svg>
        <span v-else class="note-display note-empty">Click to scribble...</span>
      </div>
      <div v-if="!isLargeView && !store.isPaperLook" class="note-actions">
        <StripCloseButton @click="onNoteClose" />
      </div>
    </template>

    <!-- VEHICLE STRIP (local C/S · HP · STD — no EuroScope) -->
    <template v-else-if="isVehicle">
      <div class="vehicle-body" @click="onVehicleBodyClick">
        <svg
          v-if="showStripScribbles"
          class="strip-scribble-layer"
          :viewBox="scribbleBandViewBox('body')"
          preserveAspectRatio="none"
        >
          <polyline
            v-for="(stroke, i) in stripScribbles"
            :key="'v' + i"
            class="strip-scribble-stroke"
            :points="stroke.points"
            :stroke="scribbleStrokeHex(stroke.color)"
            fill="none"
            vector-effect="non-scaling-stroke"
            :stroke-width="bayScribbleStrokeWidth"
          />
          <polyline
            v-if="activeScribbleStroke"
            class="strip-scribble-stroke"
            :points="activeScribbleStroke"
            :stroke="scribbleStrokeHex(activeScribbleColor)"
            fill="none"
            vector-effect="non-scaling-stroke"
            :stroke-width="bayScribbleStrokeWidth"
          />
        </svg>
        <div class="vehicle-cs">{{ strip.callsign?.trim() }}</div>
        <div class="vehicle-fields">
          <div
            class="vehicle-cell editable"
            :class="{
              ghost: !strip.hp?.trim() && vehicleEditField !== 'hp',
              editing: vehicleEditField === 'hp',
            }"
            title="Holding point"
            @click.stop="onVehicleFieldClick('hp')"
          >
            <input
              v-if="vehicleEditField === 'hp'"
              ref="vehicleHpInput"
              v-model="vehicleEditText"
              class="vehicle-input"
              maxlength="8"
              @blur="commitVehicleEdit"
              @keydown.enter="commitVehicleEdit"
              @keydown.escape="cancelVehicleEdit"
              @click.stop
            />
            <template v-else>{{ strip.hp || 'HP' }}</template>
          </div>
          <!-- RTC: HP only (no HS/STD sibling — matches flight strips) -->
          <div
            v-if="!store.multiAirport"
            class="vehicle-cell editable"
            :class="{
              ghost: !strip.std?.trim() && vehicleEditField !== 'std',
              editing: vehicleEditField === 'std',
            }"
            title="Stand"
            @click.stop="onVehicleFieldClick('std')"
          >
            <input
              v-if="vehicleEditField === 'std'"
              ref="vehicleStdInput"
              v-model="vehicleEditText"
              class="vehicle-input"
              maxlength="8"
              @blur="commitVehicleEdit"
              @keydown.enter="commitVehicleEdit"
              @keydown.escape="cancelVehicleEdit"
              @click.stop
            />
            <template v-else>{{ strip.std || 'STD' }}</template>
          </div>
        </div>
      </div>
      <div class="strip-actions vehicle-term-actions">
        <button
          type="button"
          class="action-button"
          title="Terminate"
          @click.stop="onVehicleTerm"
        >
          <span class="action-text">TERM</span>
        </button>
      </div>
    </template>

    <!-- Paper FPS strip (ESGG) — VatFSP field grid in SAAB outer size -->
    <template v-else-if="store.isPaperLook || isPaperEmptyFlightHolder">
      <div class="paper-with-actions">
      <div
        class="paper-flight"
        :class="isArrLayout ? 'paper-flight-arr' : 'paper-flight-dep'"
        @click.stop="isPaperEmptyFlightHolder ? onNoteClick() : undefined"
        @touchend="isPaperEmptyFlightHolder ? onNoteTouch($event) : undefined"
      >
        <svg
          v-if="showStripScribbles"
          class="strip-scribble-layer"
          :viewBox="scribbleBandViewBox('body')"
          preserveAspectRatio="none"
        >
          <polyline
            v-for="(stroke, i) in stripScribbles"
            :key="'p' + i"
            class="strip-scribble-stroke"
            :points="stroke.points"
            :stroke="scribbleStrokeHex(stroke.color)"
            fill="none"
            vector-effect="non-scaling-stroke"
            :stroke-width="bayScribbleStrokeWidth"
          />
          <polyline
            v-if="activeScribbleStroke"
            class="strip-scribble-stroke"
            :points="activeScribbleStroke"
            :stroke="scribbleStrokeHex(activeScribbleColor)"
            fill="none"
            vector-effect="non-scaling-stroke"
            :stroke-width="bayScribbleStrokeWidth"
          />
        </svg>

        <div class="paper-grid">
          <!-- Left: 4 equal rows — C/S · TAS (empty ARR) · FRUL+ATYP+WTC · ASSR -->
          <div class="pg-left pg-vline" :class="isArrLayout ? 'pg-left-arr' : 'pg-left-dep'">
            <div
              class="pg-cs"
              :title="callsignBoxTitle"
              @click.stop="onCallsignClick"
              @contextmenu.stop.prevent="onContextMenu"
              @touchend="onCallsignTouch"
            >
              <span
                class="pg-cs-text"
                :class="{
                  'callsign-no-match': strip.hasMatchingFlight === false,
                  'callsign-transfer-pending': isTransferIn || isTransferOut,
                }"
              >{{ strip.callsign }}<span v-if="strip.communicationSuffix" class="comm-suffix">{{ strip.communicationSuffix }}</span></span>
            </div>
            <div
              class="pg-tas"
              :class="{ ghost: !paperTas, 'pg-tas-empty': isArrLayout }"
              :title="isArrLayout ? undefined : paperTip('TAS', 'Filed TAS')"
            >{{ isArrLayout ? '' : paperTas }}</div>
            <div class="pg-meta">
              <span class="pg-frul">{{ isPaperEmptyFlightHolder ? '' : (strip.flightRules || 'I') }}</span>
              <span class="pg-atyp-wtc" :class="{ ghost: !strip.aircraftType?.trim() }">{{ strip.aircraftType?.trim() || '' }}<template v-if="!isPaperEmptyFlightHolder && strip.wakeTurbulence && strip.aircraftType?.trim()"> <span
                  class="pg-wtc"
                  :class="{ 'pg-wtc-circled': wtcPaperCircled, 'pg-wtc-yellow': wtcYellowHighlight }"
                ><svg
                    v-if="wtcPaperCircled"
                    class="pg-wtc-scribble"
                    viewBox="0 0 32 32"
                    aria-hidden="true"
                  >
                    <!-- Red kulspetspenna: single wobbly pass, slightly open -->
                    <path
                      class="pg-wtc-pen"
                      d="M17.1 5.4
                         C22.6 4.6 27.2 8.1 27.9 13.2
                         C28.8 18.9 25.1 24.8 19.6 26.6
                         C14.8 28.2 9.2 26.4 6.1 22.3
                         C3.2 18.5 3.4 12.9 6.8 9.4
                         C9.8 6.3 14.2 5.1 17.8 5.8
                         C20.4 6.4 22.8 8.2 24.1 10.6"
                      fill="none"
                    />
                  </svg>{{ strip.wakeTurbulence }}</span></template></span>
            </div>
            <!-- Bottom cell of col 1 (ASSR); left half = rising / clickzone -->
            <div
              class="pg-assr"
              :class="{ ghost: !strip.squawk }"
              :title="paperAssrTitle"
            >
              <button
                v-if="paperShowXferDiagClickspot"
                type="button"
                class="pg-xfer-diag-hit"
                :title="paperXferDiagTitle"
                @click.stop="onPaperXferDiagClick"
              />
              <span class="pg-assr-val">{{ strip.squawk || '' }}</span>
            </div>
          </div>

          <!-- Time col 2: EOBT/ETA top · DEP bottom: CTO | ATD -->
          <div class="pg-time pg-mid-rule pg-vline">
            <div
              class="pg-time-eobt"
              :class="{ ghost: !paperPrimaryTime }"
              :title="isArrLayout ? 'ETA' : 'EOBT'"
            >{{ paperPrimaryTime }}</div>
            <div
              v-if="!isArrLayout"
              class="pg-time-bot"
              :class="{ 'pg-time-bot--ctot': !!paperCtotSlotMm }"
            >
              <!-- CTOT present: left = CTOT−5 (mm, red); red scribble on col midline; right = CFTO|ATD -->
              <div
                v-if="paperCtotSlotMm"
                class="pg-ctot-slot"
                :title="paperTip('CTOT−5', 'CTOT minus 5 minutes')"
              >
                <span class="pg-atd-val pg-ctot-slot-val">{{ paperCtotSlotMm }}</span>
              </div>
              <svg
                v-if="paperCtotSlotMm"
                class="pg-ctot-split"
                viewBox="0 0 8 28"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <!-- Scribbled red vertical split — centered on column 2 mid -->
                <path
                  class="pg-wtc-pen pg-ctot-split-pen"
                  d="M4.2 1.5
                     C3.4 5.5 4.8 9.2 3.9 13.5
                     C3.2 17.2 4.6 21.5 3.8 26.5"
                  fill="none"
                />
              </svg>
              <div class="pg-time-bot-cfto">
                <button
                  type="button"
                  class="pg-cto-check"
                  data-paper-flag="cfto"
                  :class="{ checked: paperCto, disabled: !canUsePaperClickspots }"
                  :disabled="!canUsePaperClickspots"
                  :title="paperTip('CTO', 'Cleared for takeoff')"
                  @click.stop="onPaperCtoClick"
                >
                  <svg
                    v-if="paperCto && !hasShapeMatchedCtoScribble"
                    class="pg-cto-line pg-cfto-line"
                    viewBox="0 0 32 16"
                    aria-hidden="true"
                  >
                    <!-- CFTO: short horizontal kulspetspenna (same weight as WTC) -->
                    <path
                      class="pg-wtc-pen pg-wtc-pen-blue pg-cfto-pen"
                      d="M2 8.3
                         C10 7.7 18 8.5 28 8"
                      fill="none"
                    />
                  </svg>
                </button>
                <div class="pg-atd-cell" :title="paperTip('ATD', 'Actual time of departure')">
                  <span v-if="paperShowAtd" class="pg-atd-val">{{ paperAtd }}</span>
                </div>
              </div>
            </div>
            <!-- ARR col 2 bottom: CTL (left) | ATA (right, same style as ATD) -->
            <div v-else class="pg-time-bot">
              <button
                type="button"
                class="pg-cto-check"
                data-paper-flag="ctl"
                :class="{ checked: paperCtl, disabled: !canUsePaperClickspots }"
                :disabled="!canUsePaperClickspots"
                :title="paperTip('CTL', 'Cleared to land')"
                @click.stop="onPaperCtlClick"
              >
                <svg
                  v-if="paperCtl && !hasShapeMatchedCtlScribble"
                  class="pg-ctl-l"
                  viewBox="0 0 24 28"
                  aria-hidden="true"
                >
                  <!-- CTL: scribbled L (same pen weight as red WTC) -->
                  <path
                    class="pg-wtc-pen pg-wtc-pen-blue pg-ctl-pen"
                    d="M8 3.5
                       C7.4 8.5 8.6 14.5 7.9 21.5
                       C8.1 23.2 9.5 23.8 12 23.6
                       C15.5 23.3 18.5 24.1 21 23.5"
                    fill="none"
                  />
                </svg>
              </button>
              <div class="pg-atd-cell" :title="paperTip('ATA', 'Actual time of arrival')">
                <span v-if="paperShowAta" class="pg-atd-val">{{ paperAta }}</span>
              </div>
            </div>
          </div>

          <!-- DEP: SID in bottom half · ARR: empty col 3 (stand only via GRP scribble) -->
          <div
            v-if="!isArrLayout"
            class="pg-sid pg-vline"
            :class="{
              ghost: !store.displaySidForStrip(strip),
              editable: canEditAssignedData,
              'sid-mdi-box': essaEastSidBox,
            }"
            :title="paperTip(sidCellLabel, `Departure route / ${sidCellLabel}`)"
            @click.stop="onSidClick"
          >
            <span class="pg-sid-val">{{ store.displaySidForStrip(strip) || '' }}</span>
          </div>
          <div v-else class="pg-sid pg-vline pg-sid-arr-empty">
            <!-- ARR col 3 bottom: go-around arrow (soft GA / MISAP) -->
            <div
              class="pg-goa-zone"
              data-paper-flag="goa"
              :class="{ 'pg-goa-hit': hasGoaScribble }"
              :title="paperTip('G/A', 'Go-around')"
              @click.stop="hasGoaScribble ? onPaperGoaScribbleClear() : undefined"
            >
              <svg
                v-if="paperShowGoaArrow && !hasGoaScribble"
                class="pg-goa-arrow"
                viewBox="0 0 56 28"
                aria-hidden="true"
              >
                <!-- Blue kulspetspenna go-around: shallow symmetric U; chevron along exit ↗ -->
                <path
                  class="pg-wtc-pen pg-wtc-pen-blue pg-goa-pen"
                  d="M5 15
                     C15 22.5 22 24 28 24
                     C34 24 41 22.5 51 15
                     M47.5 12.8 L55 11.2 L52 18.2"
                  fill="none"
                />
              </svg>
            </div>
          </div>

          <!-- ADEP / ADES — cols 4–5 mid rule; DEP top: clearance read / readback (CLR) -->
          <div class="pg-adep pg-mid-rule" :class="{ 'pg-adep-dep': !isArrLayout }">
            <button
              v-if="!isArrLayout"
              type="button"
              class="pg-clr-check"
              :class="{
                checked: paperLeftMarkOn || paperShowDclRead,
                disabled: !canUsePaperClickspots,
                'pg-clr-dcl': paperShowDclRead,
              }"
              :disabled="!canUsePaperClickspots"
              :title="paperShowDclRead ? paperTip('DCL', 'DCL sent') : paperTip('CLR read', 'CLR read')"
              @click.stop="onPaperClearanceReadClick"
            >
              <span v-if="paperShowDclRead" class="pg-dcl-mark">DCL</span>
              <svg
                v-else-if="paperLeftMarkOn && !hasClrReadScribble"
                class="pg-clr-mark"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path d="M4 13.5 L10 19.5 L20.5 5.5" />
              </svg>
            </button>
            <!-- ARR: keep top half empty so ICAO+RWY stay on bottom row -->
            <div v-else class="pg-ad-top" aria-hidden="true" />
            <!-- Bottom row: non-std DEP RWY top-justified + ADEP -->
            <div class="pg-ad-bot">
              <span
                v-if="paperNonStdRwyAboveAdep"
                class="pg-rwy-scribble"
                :title="rwyCellTitle"
              >{{ paperNonStdRwyAboveAdep }}</span>
              <div
                class="pg-ad-code"
                :class="{ ghost: !strip.adep || strip.adep === '????' || strip.adep === 'ZZZZ' }"
                :title="paperTip('ADEP', strip.adepName || 'ADEP')"
              >{{ strip.adep && strip.adep !== '????' ? strip.adep : '' }}</div>
            </div>
          </div>
          <div class="pg-ades pg-mid-rule pg-vline" :class="{ 'pg-ades-dep': !isArrLayout }">
            <button
              v-if="!isArrLayout"
              type="button"
              class="pg-clr-check"
              :class="{ checked: paperClearanceReadback, disabled: !canUsePaperClickspots }"
              :disabled="!canUsePaperClickspots"
              :title="paperTip('CLR correct', 'CLR correct (readback)')"
              @click.stop="onPaperClearanceReadbackClick"
            >
              <svg
                v-if="paperClearanceReadback && !hasClrCorrectScribble"
                class="pg-clr-mark"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path d="M4 13.5 L10 19.5 L20.5 5.5" />
              </svg>
            </button>
            <div v-else class="pg-ad-top" aria-hidden="true" />
            <!-- Bottom row: non-std ARR RWY top-justified + ADES -->
            <div class="pg-ad-bot">
              <span
                v-if="paperNonStdRwyAboveAdes"
                class="pg-rwy-scribble"
                :title="rwyCellTitle"
              >{{ paperNonStdRwyAboveAdes }}</span>
              <div
                class="pg-ad-code"
                :class="{ ghost: !strip.ades || strip.ades === '????' || strip.ades === 'ZZZZ' }"
                :title="paperTip('ADES', strip.adesName || 'ADES')"
              >{{ strip.ades && strip.ades !== '????' ? strip.ades : '' }}</div>
            </div>
          </div>

          <!--
            DEP cols 6–7 as 4 equal bands (mid-line between 2|3):
            1–2 REA (col6, auto on ready) / CTOT (col7) · 3 FPL · 4 ATIS+QNH / CRZ
          -->
          <div v-if="!isArrLayout" class="pg-rte-rfl pg-mid-rule">
            <div class="pg-rea-zone" title="REA">
              <span v-if="paperShowRea" class="pg-rea">
                <svg class="pg-rea-scribble" viewBox="0 0 32 32" aria-hidden="true">
                  <path
                    class="pg-wtc-pen"
                    d="M17.1 5.4
                       C22.6 4.6 27.2 8.1 27.9 13.2
                       C28.8 18.9 25.1 24.8 19.6 26.6
                       C14.8 28.2 9.2 26.4 6.1 22.3
                       C3.2 18.5 3.4 12.9 6.8 9.4
                       C9.8 6.3 14.2 5.1 17.8 5.8
                       C20.4 6.4 22.8 8.2 24.1 10.6"
                    fill="none"
                  />
                </svg>
                Rea
              </span>
            </div>
            <div
              class="pg-fpl"
              :class="{ ghost: !paperFplRoute }"
              :title="paperTip('FPL', strip.route || 'FPL')"
            >{{ paperFplRoute }}</div>
            <button
              type="button"
              class="pg-atis-qnh"
              :class="{ 'has-stamp': !!paperAtisQnhStamp }"
              :title="paperTip('ATIS/QNH', 'Stamp ATIS + QNH')"
              :disabled="!canStampAtisQnh && !paperAtisQnhStamp"
              @click.stop="onPaperAtisQnhClick"
            >
              <span v-if="paperAtisQnhStamp" class="pg-atis-qnh-val">{{ paperAtisQnhStamp }}</span>
            </button>
          </div>
          <div v-else class="pg-rte-rfl pg-rte-rfl-arr pg-mid-rule" />

          <div v-if="!isArrLayout" class="pg-ctot">
            <div class="pg-ctot-top" :class="{ ghost: !paperCtot }" title="CTOT">
              <span v-if="paperCtot" class="pg-ctot-val">
                <svg class="pg-ctot-scribble" viewBox="0 0 48 32" aria-hidden="true">
                  <path
                    class="pg-wtc-pen"
                    d="M10.5 6.2
                       C18.2 3.8 30.5 3.6 38.2 6.5
                       C44.1 8.8 46.2 14.2 45.4 19.1
                       C44.4 25.2 38.1 28.8 30.2 29.4
                       C21.8 30.0 12.6 28.2 7.4 23.6
                       C3.2 19.9 2.8 13.8 6.6 9.6
                       C9.4 6.5 14.8 5.2 20.2 5.8
                       C26.8 6.6 33.4 9.2 37.6 12.8"
                    fill="none"
                  />
                </svg>
                {{ paperCtot }}
              </span>
            </div>
            <div class="pg-band" />
            <div
              class="pg-crz"
              :class="{ ghost: !paperCrz }"
              :title="paperTip('CRZ', 'Cruise level')"
            >{{ paperCrz }}</div>
          </div>
          <div v-else class="pg-ctot pg-arr-eobt" :class="{ ghost: !paperEobt }" title="EOBT">
            {{ paperEobt }}
          </div>
        </div>

        <!-- GRP stand — felt-tip annotation, far right middle (stand only here on paper) -->
        <div
          v-if="strip.stand"
          class="pg-grp-stand"
          :class="{ 'pg-grp-stand--dep': !isArrLayout }"
          :title="paperTip('Stand', 'GRP stand')"
        >{{ strip.stand }}</div>
      </div>
      </div>
    </template>

    <!-- SAAB-style strip -->
    <template v-else>
      <!-- Top menu: fully hidden until ▲ opens it; collapse arrow lives here when open -->
      <div v-if="topExpanded && !isCompactBay" class="strip-expander strip-expander-top" @click.stop>
        <button
          type="button"
          class="ctrl-arrow expander-arrow mirrored"
          :class="topArrowClass"
          :title="topArrowTitle"
          @click.stop="onCollapseTopExpander"
        ><span class="arrow-glyph">▲</span></button>
        <div class="exp-chips">
          <!-- ARR: ATIS/MET + QNH only; DEP chips below -->
          <template v-if="!isArrLayout">
            <button type="button" class="exp-chip" :class="{ 'exp-rea': isRea }" @click.stop="onExpRea">REA</button>
            <button type="button" class="exp-chip inert" disabled>SIG</button>
          </template>
          <button
            v-if="store.multiAirport && currentAtisLetter"
            type="button"
            class="exp-chip"
            :class="{ 'exp-qnh-ok': atisGivenMatches, 'exp-qnh-stale': atisStale }"
            :disabled="!canStampAtisQnh && !atisGivenMatches && !atisStale"
            :title="atisChipTitle"
            @click.stop="onExpAtis"
          >ATIS {{ currentAtisLetter }}</button>
          <button
            v-if="store.multiAirport"
            type="button"
            class="exp-chip"
            :class="{ 'exp-qnh-ok': !!strip.weatherGiven }"
            title="TopSky WEATHER manual alert"
            @click.stop="onExpMet"
          >MET</button>
          <button
            type="button"
            class="exp-chip"
            :class="{ 'exp-qnh-ok': qnhGivenMatches, 'exp-qnh-stale': qnhStale }"
            :disabled="!canSetQnh && !qnhGivenMatches && !qnhStale"
            :title="qnhChipTitle"
            @click.stop="onExpQnh"
          >QNH</button>
          <template v-if="!isArrLayout">
            <button
              v-if="!store.multiAirport"
              type="button"
              class="exp-chip"
              :class="{ active: hasSlowFlag }"
              @click.stop="onExpSlow"
            >SLOW</button>
            <button
              v-if="!store.multiAirport"
              type="button"
              class="exp-chip"
              :class="{ active: hasUrnavRemark }"
              @click.stop="onExpUrnav"
            >URNAV</button>
            <button
              type="button"
              class="exp-chip"
              :class="{ active: hasVectRemarkFlag }"
              @click.stop="onExpVect"
            >VECT</button>
            <button
              type="button"
              class="exp-chip"
              :class="clrChipClass"
              :title="clrChipLabel === 'DCL' ? 'Data-link clearance' : 'Clearance'"
              @click.stop="onClncMenuClick"
            >{{ clrChipLabel }}</button>
          </template>
        </div>
        <!-- DEP|POB (dep/local) or ARR|POB (arr — ARR greyed placeholder for layout parity) -->
        <div class="exp-dep-pob">
          <button
            v-if="!isArrLayout"
            type="button"
            class="exp-chip exp-dep-btn"
            :class="{ 'exp-dep-green': isDepDeparted }"
            :disabled="!canEditAssignedData"
            title="DEP — enter ATD then cleared for takeoff"
            @click.stop="onExpDep"
          >DEP</button>
          <button
            v-else
            type="button"
            class="exp-chip exp-arr-btn inert"
            disabled
            title="ARR"
          >ARR</button>
          <button
            type="button"
            class="exp-chip exp-pob-btn"
            :disabled="!canEditPob"
            :title="canEditPob ? (strip.pob ? `POB ${strip.pob}` : 'Persons on board') : 'POB (RTC V/Z only)'"
            @click.stop="onExpPob"
          >POB</button>
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
            :points="stroke.points"
            :stroke="scribbleStrokeHex(stroke.color)"
            fill="none"
            vector-effect="non-scaling-stroke"
            :stroke-width="bayScribbleStrokeWidth"
          />
          <polyline
            v-if="activeScribbleStroke"
            class="strip-scribble-stroke"
            :points="activeScribbleStroke"
            :stroke="scribbleStrokeHex(activeScribbleColor)"
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
            :points="stroke.points"
            :stroke="scribbleStrokeHex(stroke.color)"
            fill="none"
            vector-effect="non-scaling-stroke"
            :stroke-width="bayScribbleStrokeWidth"
          />
          <polyline
            v-if="activeScribbleStroke"
            class="strip-scribble-stroke"
            :points="activeScribbleStroke"
            :stroke="scribbleStrokeHex(activeScribbleColor)"
            fill="none"
            vector-effect="non-scaling-stroke"
            :stroke-width="bayScribbleStrokeWidth"
          />
        </svg>
        <!-- Left 3×3: col1 ▲/FRUL/▼ · col2 ATYP · col3 WTC · times span col2–3
             Compact: gutter (arrow width) + stacked times; same total left width -->
        <div class="strip-left" :class="{ 'wtc-hl': wtcRtcBorder, 'strip-left-compact': isCompactBay }">
          <button
            v-if="isCompactBay"
            type="button"
            class="compact-gutter"
            title="Normal size"
            @click.stop="onSizeNormal"
          >
            <!-- Match ▲/▼ highlight (REA green / QNH·TSAC stale amber) on restore clickzone -->
            <span
              class="compact-gutter-half compact-gutter-top"
              :class="topArrowClass"
              :title="topArrowTitle !== 'Top menu' && topArrowTitle !== 'Close top menu' ? topArrowTitle : undefined"
            />
            <span
              class="compact-gutter-half compact-gutter-bot"
              :class="{ 'arrow-stale': showTsacStaleArrow }"
              :title="showTsacStaleArrow ? 'TSAT changed - expand strip to confirm TSAC' : undefined"
            />
          </button>
          <button
            v-else-if="!topExpanded"
            type="button"
            class="ctrl-arrow strip-left-up"
            :class="topArrowClass"
            :title="topArrowTitle"
            @click.stop="onExpandTopExpander"
          ><span class="arrow-glyph">▲</span></button>
          <!-- P/A (tobtSetBy) or red S (CDM PM pending) between FRUL and ▲ when expanded -->
          <span
            v-else-if="showTobtSetBy"
            class="tobt-setby strip-left-up"
            :class="{ 'tobt-setby-p': strip.tobtSetBy === 'P' }"
            :title="tobtSetByTitle"
          >{{ strip.tobtSetBy }}</span>
          <button
            v-else-if="showCdmPmPending"
            type="button"
            class="tobt-setby tobt-setby-pm strip-left-up"
            title="Send CDM flow PM (needs ES window focus)"
            @click.stop="onSendCdmPmClick"
          >S</button>
          <div
            v-if="showPrimaryTime"
            class="strip-time strip-time-top fit-font"
            :class="{ ghost: !primaryTimeValue, 'time-changed': tobtChanged }"
            :title="primaryTimeLabelTitle"
            @click.stop="onPrimaryTimeClick"
          >
            <!-- REA is indicated only by the REA chip in the top expander — never in the TB field -->
            <span v-if="primaryTimeLabel" class="strip-time-lbl">{{ primaryTimeLabel }}</span>
            <span class="strip-time-val">{{ primaryTimeValue || '----' }}</span>
          </div>

          <template v-if="!isCompactBay">
            <span
              class="ctrl-ident fit-font"
              title="Toggle menus"
              @click.stop="onFrulClick"
            >{{ strip.flightRules || 'I' }}</span>
            <span
              class="atyp-box fit-font"
              :class="{
                boxed: atypThickBorder,
                plain: !atypThickBorder && !atypYellowHighlight,
                'atyp-yellow': atypYellowHighlight,
                ghost: !strip.aircraftType?.trim(),
              }"
              title="Compact size"
              @click.stop="onSizeCompact"
            >{{ strip.aircraftType?.trim() || 'ATYP' }}</span>
            <span
              class="wtc-box fit-font"
              :class="{
                boxed: wtcRtcBorder,
                plain: !wtcRtcBorder && !wtcYellowHighlight,
                'wtc-yellow': wtcYellowHighlight,
              }"
              title="Compact size"
              @click.stop="onSizeCompact"
            >{{ strip.wakeTurbulence }}</span>

            <!-- ▼ when collapsed; TSAC (like P/A) between FRUL and ▼ when bottom expander open -->
            <button
              v-if="!bottomExpanded"
              type="button"
              class="ctrl-arrow strip-left-dn"
              :class="{ 'arrow-stale': showTsacStaleArrow }"
              :title="showTsacStaleArrow ? 'TSAT changed - open bottom menu and click TSAC box' : 'Bottom menu'"
              @click.stop="onExpandBottomExpander"
            ><span class="arrow-glyph">▼</span></button>
            <button
              v-else-if="showTsacBox"
              type="button"
              class="tsac-box strip-left-dn"
              :class="tsacBoxClass"
              :title="tsacTooltip"
              @click.stop="onTsacClick($event)"
            />
          </template>
          <div
            class="strip-time strip-time-bot fit-font"
            :class="[
              {
                ghost: !secondaryTimeValue && !faceAssr,
                'has-face-assr': !!faceAssr,
                'time-ctot': secondaryTimeKind === 'ctot' || secondaryTimeKind === 'scl',
                'time-fls': secondaryTimeKind === 'fls',
                'time-cdm-sts':
                  secondaryTimeKind === 'srm' || secondaryTimeKind === 'slc',
                'squawk-empty':
                  secondaryTimeKind === 'assr' &&
                  !displayAssr &&
                  (ssrCoordActive || strip.canResetSquawk),
                'squawk-resettable':
                  secondaryTimeKind === 'assr' &&
                  !!displayAssr &&
                  (ssrCoordActive || strip.canResetSquawk),
              },
              secondaryTimeKind === 'tsat' ? tsatColorClass : undefined,
            ]"
            :title="secondaryTimeTitle"
            @click.stop="onSecondaryTimeClick"
            @dblclick.stop="onSecondaryTimeDblClick"
          >
            <template v-if="secondaryTimeKind === 'assr' && assrEditing">
              <input
                ref="assrEditInput"
                v-model="assrEditText"
                class="assr-edit-input"
                type="text"
                inputmode="numeric"
                maxlength="4"
                @click.stop
                @blur="onAssrEditBlur"
                @keydown.enter="onAssrEditBlur"
                @keydown.escape="onAssrEditCancel"
              />
            </template>
            <template v-else>
              <span v-if="secondaryTimeLabel" class="strip-time-lbl">{{ secondaryTimeLabel }}</span>
              <span class="strip-time-val">{{
                secondaryTimeValue ||
                (faceAssr || secondaryTimeKind === 'none' ? '' : '----')
              }}</span>
              <span v-if="faceAssr" class="strip-time-assr">{{ faceAssr }}</span>
            </template>
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
          <div
            v-if="showXflCell"
            class="cell cell-xfl"
            :class="{
              'fit-font': !showArrCoordPendingC,
              ghost: !showArrCoordPendingC && !displayXfl,
              editable:
                (canEditAssignedData && isRtcCoordUi && !isArrLayout) ||
                showArrCoordPendingC,
              proposal: showArrCoordPendingC,
              'clr-pending-hl':
                !showArrCoordPendingC &&
                unclearedFieldHighlight &&
                !!displayXfl &&
                !xflCoordPink &&
                !xflCoordAmber,
              'xfl-coord-pink': xflCoordPink || showArrCoordPendingC,
              'xfl-coord-amber': !showArrCoordPendingC && xflCoordAmber,
            }"
            :title="xflCellTitle"
            @click.stop="onXflClick"
          >{{ showArrCoordPendingC ? 'C' : displayXfl || levelCellPlaceholder }}</div>
          <div
            v-if="showCooCell"
            class="cell cell-coo"
            :class="{
              ghost: !strip.coo && !showEstCoordC,
              editable: canEditAssignedData || showEstCoordC,
              proposal: showEstCoordC,
              'coo-coord-pink': showEstCoordC,
            }"
            :title="cooCellTitle"
            @pointerdown.stop="onCooPointerDown"
            @pointerup.stop="onCooPointerUp"
            @pointercancel.stop="onCooPointerCancel"
            @pointerleave="onCooPointerUp"
            @click.stop="onCooClick"
            @contextmenu.prevent.stop="onCooContextMenu"
          >{{ showEstCoordC ? 'C' : strip.coo ? '✓' : 'C' }}</div>
          <div
            v-if="!isCompactBay && !store.multiAirport"
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
            v-if="!isCompactBay"
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
            <div v-if="!isCompactBay" class="cell cell-cto" :class="{ 'has-ctot': !!triangleTimeText }">
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
                <!-- Landing △ — wide base (top), tip down; box size unchanged -->
                <path d="M0.6 0.8 H23.4 Q24.8 0.8 23.5 2.6 L13.1 21.2 Q12 23.4 10.9 21.2 L0.5 2.6 Q-0.8 0.8 0.6 0.8 Z" />
              </svg>
              <span v-if="triangleTimeText" class="cto-ctot ata">{{ triangleTimeText }}</span>
            </div>
            <!-- Compact G/A: CFL replaces STD; otherwise stand -->
            <div
              v-if="compactArrGoAround"
              class="cell cell-std cell-cfl fit-font"
              :class="{
                ghost: !displayCfl,
                'clr-pending-hl': unclearedFieldHighlight && !!displayCfl,
                editable: canEditAssignedData,
                'arr-cfl-ghost': !displayCfl,
              }"
              title="Cleared flight level"
              @click.stop="onCflClick"
            >{{ displayCfl || 'CFL' }}</div>
            <div v-else class="cell cell-std fit-font" :class="{ ghost: !strip.stand }">{{ strip.stand || 'STD' }}</div>
          </template>
          <template v-else>
            <!-- Compact: CFTO/ATD △ replaces STD (CTOT stays in ASSR slot) -->
            <div
              v-if="compactShowDepTriangle"
              class="cell cell-std cell-cto cell-compact-cto"
            >
              <svg
                viewBox="0 0 24 24"
                preserveAspectRatio="none"
                class="clearance-triangle takeoff mini"
                :class="{
                  active: strip.clearedForTakeoff && !strip.atd,
                  'green-border': !!strip.atd,
                }"
                aria-hidden="true"
              >
                <path d="M0.6 23.2 H23.4 Q24.8 23.2 23.5 21.4 L13.1 2.8 Q12 0.6 10.9 2.8 L0.5 21.4 Q-0.8 23.2 0.6 23.2 Z" />
              </svg>
            </div>
            <div v-else class="cell cell-std fit-font" :class="{ ghost: !strip.stand }">{{ strip.stand || 'STD' }}</div>
            <div
              v-if="!isCompactBay"
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
                <!-- Takeoff △ — wide base (bottom), tip up; box size unchanged -->
                <path d="M0.6 23.2 H23.4 Q24.8 23.2 23.5 21.4 L13.1 2.8 Q12 0.6 10.9 2.8 L0.5 21.4 Q-0.8 23.2 0.6 23.2 Z" />
              </svg>
              <span
                v-if="triangleTimeText"
                class="cto-ctot"
                :class="{ atd: !!strip.atd, scl: !strip.atd && showCtotCancelled }"
              >{{ triangleTimeText }}</span>
            </div>
          </template>
          <div
            v-if="!isCompactBay && !hideArrGroundAssignFields"
            class="cell cell-cfl fit-font"
            :class="{
              ghost: !displayCfl,
              'clr-pending-hl': unclearedFieldHighlight && !!displayCfl,
              editable: canEditAssignedData,
              'arr-cfl-ghost': isArrLayout && !displayCfl,
            }"
            title="Cleared flight level"
            @click.stop="onCflClick"
          >{{ displayCfl || 'CFL' }}</div>
          <!-- Compact ARR G/A: editable AHD; otherwise empty spacer (no ghost). Compact DEP / full-height unchanged. -->
          <div
            v-if="compactArrGoAround"
            class="cell cell-ahd fit-font"
            :class="{
              ghost: !strip.assignedHeading,
              'clr-pending-hl': unclearedFieldHighlight && !!strip.assignedHeading,
              editable: canEditAssignedData,
            }"
            title="Assigned heading"
            @click.stop="onAhdClick"
          >{{ strip.assignedHeading || 'AHD' }}</div>
          <div
            v-else-if="isCompactBay && isArrLayout"
            class="cell cell-ahd cell-compact-spacer"
            aria-hidden="true"
          />
          <div
            v-else-if="isCompactBay || !hideArrGroundAssignFields"
            class="cell cell-ahd fit-font"
            :class="{
              ghost: !strip.assignedHeading,
              'clr-pending-hl': unclearedFieldHighlight && !!strip.assignedHeading,
              editable: canEditAssignedData,
            }"
            title="Assigned heading"
            @click.stop="onAhdClick"
          >{{ strip.assignedHeading || 'AHD' }}</div>
          <div
            v-if="isCompactBay && isArrLayout"
            class="cell cell-sid cell-compact-spacer"
            aria-hidden="true"
          />
          <div
            v-else-if="!isArrLayout"
            class="cell cell-sid fit-font"
            :class="{
              ghost: !store.displaySidForStrip(strip),
              'sid-highlight': sidHighlight,
              'sid-mdi-box': essaEastSidBox,
              editable: canEditAssignedData,
            }"
            :title="`Departure route / ${sidCellLabel}`"
            @click.stop="onSidClick"
          >{{ store.displaySidForStrip(strip) || sidCellLabel }}</div>
          <!-- RTC ARR: empty framed SID slot (no data / no edit) -->
          <div
            v-else-if="!isCompactBay && store.multiAirport && !hideArrGroundAssignFields"
            class="cell cell-sid cell-sid-arr-empty"
            aria-hidden="true"
          />
        </div>

        <div v-if="store.isController" class="strip-actions" :class="{ 'multi-action': effectiveActionCount > 1 }">
          <button
            v-for="action in displayActions"
            :key="action"
            class="action-button"
            :class="[
              actionButtonClass(action),
              {
                'fit-font': isCompactBay,
                'action-ack-clr': isCompactBay && action === 'CLNC' && showAckClrLabel,
                'action-start-up': action === 'STUP' && store.essaRolesMode,
              },
            ]"
            :title="action === 'CONTACTME' ? 'EuroScope .contactme (needs ES window focus)' : undefined"
            @click.stop="() => onActionClick(action)"
            @touchend.stop="(e) => onActionTouch(e, action)"
          >
            <span class="action-text">{{ actionLabel(action) }}</span>
            <span v-if="(action === 'XFER' || action === 'READY') && strip.xferFrequency" class="action-freq">{{ strip.xferFrequency }}</span>
          </button>
        </div>
      </div>

      <!-- Bottom: [▼ TSAC? RMK FPL][ASSR | ADES | remarks under CFL→][TMA] -->
      <div v-if="bottomExpanded && !isCompactBay" class="strip-expander strip-expander-bottom" @click.stop>
        <div class="exp-bottom-left">
          <button
            type="button"
            class="ctrl-arrow expander-arrow mirrored"
            :class="{ 'arrow-stale': showTsacStaleArrow }"
            :title="showTsacStaleArrow ? 'TSAT changed - click TSAC box to update' : 'Close bottom menu'"
            @click.stop="onCollapseBottomExpander"
          ><span class="arrow-glyph">▼</span></button>
          <button type="button" class="exp-chip" @click.stop="onRemarksClick">RMK</button>
          <button type="button" class="exp-chip" @click.stop="onFplClick">FPL</button>
        </div>
        <div class="exp-bottom-main" :class="isArrLayout ? 'exp-bottom-main-arr' : 'exp-bottom-main-dep'">
          <span
            v-if="showBottomExpAssr"
            class="exp-assr"
            :class="{
              ghost: !displayAssr,
              'squawk-empty': !displayAssr && (ssrCoordActive || strip.canResetSquawk),
              'squawk-resettable': !!displayAssr && (ssrCoordActive || strip.canResetSquawk),
            }"
            :title="assrTitle"
            @click.stop="onAssrClick"
            @dblclick.stop="onAssrDblClick"
          >
            <input
              v-if="assrEditing"
              ref="assrEditInput"
              v-model="assrEditText"
              class="assr-edit-input"
              type="text"
              inputmode="numeric"
              maxlength="4"
              @click.stop
              @blur="onAssrEditBlur"
              @keydown.enter="onAssrEditBlur"
              @keydown.escape="onAssrEditCancel"
            />
            <template v-else>{{ displayAssr || '----' }}</template>
          </span>
          <span
            class="exp-ades"
            :class="{ ghost: !strip.ades || strip.ades === '????' || strip.ades === 'ZZZZ' }"
            :title="strip.adesName ? `${strip.ades} - ${strip.adesName}` : 'ADES'"
          >{{ strip.ades && strip.ades !== '????' ? strip.ades : '----' }}</span>
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
        >
          <span class="exp-tma-exit-text">{{ tmaExitPoint || '----' }}</span>
        </span>
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
            :points="stroke.points"
            :stroke="scribbleStrokeHex(stroke.color)"
            fill="none"
            vector-effect="non-scaling-stroke"
            :stroke-width="bayScribbleStrokeWidth"
          />
          <polyline
            v-if="activeScribbleStroke"
            class="strip-scribble-stroke"
            :points="activeScribbleStroke"
            :stroke="scribbleStrokeHex(activeScribbleColor)"
            fill="none"
            vector-effect="non-scaling-stroke"
            :stroke-width="bayScribbleStrokeWidth"
          />
        </svg>
      </div>
    </template>
  </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onUpdated, onUnmounted, watch } from 'vue'
import {
  DEFAULT_TRANSITION_ALTITUDE_FT,
  extractTmaExitPoint,
  formatEfsLevel,
  formatStripAltitude,
  formatTrackSidDisplay,
  getEssaRwyCombination,
  hasSlowRemark,
  hasVectRemark,
  isHeavyAsLeaderAircraftType,
  isThickAtypBorderAircraftType,
  isIfrSidEligible,
  isLocalInboundPresentation,
  isTrackSidName,
  isOffExitVectorSid,
  needsEssaEastSidBox,
  normalizeEssaRwy,
  requiresAccCoordination,
  sidFieldLabel,
  withPobInRemarks,
  withSlowRemark,
  withVectRemark,
} from '@vatefs/common'
import type { FlightStrip } from '@/types/efs'
import { useEfsStore } from '@/store/efs'
import { STRIP_FLIP_DURATION_MS, markStripDragEnded } from '@/composables/useStripOrderFlip'
import {
  afterLayoutSettle,
  driveAnimationWallClock,
  type WallClockAnimHandle,
} from '@/composables/wallClockAnimation'
import {
  claimStripContextMenu,
  releaseStripContextMenu,
} from '@/composables/stripContextMenuShared'
import { getTouchDragInstance } from '@/composables/useTouchDrag'
import { paperKlackPullBayIds } from '@/composables/paperKlack'
import { insertIndexAtClientY } from '@/composables/dropPlacement'
import {
  SCRIBBLE_INK_HEX,
  elementToScribbleRect,
  hasClrScribble,
  hasShapeMatchedPaperScribble,
  pushRisingDiagonalLeftCol,
  removeClrScribbles,
  removeScribblesOverlappingRect,
  scribbleBandViewBox,
  scribbleStrokeWidthCss,
  useStripScribbles,
  type ScribbleInk,
} from '@/composables/useStripScribbles'
import {
  applySpawnExpanderDefaults,
  collapseExpandersOnLeaveCdAllOrTsat,
  collapseStripExpanders,
  useStripExpanders,
} from '@/composables/useStripExpanders'
import { adoptManualStripFitBaseline } from '@/composables/useAutoFitStripSize'
import { useStripSizeMode } from '@/composables/useStripSizeMode'
import { useZoomStripScalePercent } from '@/composables/useStripZoomScale'
import ClearanceDialog from './ClearanceDialog.vue'
import DepCoordDialog from './DepCoordDialog.vue'
import AtdDialog from './AtdDialog.vue'
import TsacDialog from './TsacDialog.vue'
import CoordProposalDialog from './CoordProposalDialog.vue'
import FlightplanDialog from './FlightplanDialog.vue'
import SidRouteMenu from './SidRouteMenu.vue'
import RwyMenu from './RwyMenu.vue'
import CflMenu from './CflMenu.vue'
import XflMenu from './XflMenu.vue'
import TobtMenu, { type TobtMenuKind } from './TobtMenu.vue'
import AhdMenu from './AhdMenu.vue'
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
    /** Ink colour for the live zoom stroke */
    activeScribbleColor?: ScribbleInk
  }>(),
  { isLargeView: false, activeScribbleStroke: null, activeScribbleColor: 'blue' },
)

const emit = defineEmits<{
  'close-large-view': []
}>()

const store = useEfsStore()
const zoomStripScalePercent = useZoomStripScalePercent()
const stripElement = ref<HTMLElement | null>(null)
const isDragging = ref(false)
const stripIdRef = computed(() => props.strip.id)
const {
  strokes: stripScribbles,
  hasClrReadScribble,
  hasClrCorrectScribble,
  hasCtoScribble,
  hasCtlScribble,
  hasGoaScribble,
  atdScribbleCount,
} = useStripScribbles(stripIdRef)
const { topExpanded, bottomExpanded } = useStripExpanders(stripIdRef)
const { isCompact } = useStripSizeMode(stripIdRef)
// IFR DEP spawn: both expanders open (once per strip id) — skipped in CD/TSAT/PUSH
applySpawnExpanderDefaults(props.strip.id, {
  ifrDeparture:
    (props.strip.stripType === 'departure' || props.strip.stripType === 'local') &&
    props.strip.flightRules !== 'V' &&
    props.strip.flightRules !== 'Z',
  sectionId: props.sectionId,
})

/** SAAB flight strips that support half-height compact mode. */
const canCompactStrip = computed(() => {
  if (store.isPaperLook) return false
  const t = props.strip.stripType
  return t === 'departure' || t === 'arrival' || t === 'local' || t === 'vfr'
})

/** Bay half-height layout — never applied inside zoom overlay (zoom stays normal height). */
const isCompactBay = computed(
  () => canCompactStrip.value && isCompact.value && !props.isLargeView,
)

/** Context-menu “Expanded”: both expanders open on a normal-height strip. */
const isSizeExpanded = computed(
  () => !isCompact.value && topExpanded.value && bottomExpanded.value,
)

const showStripScribbles = computed(
  () =>
    !isCompactBay.value &&
    (stripScribbles.value.length > 0 || !!props.activeScribbleStroke),
)

/** SAAB look always draws black; paper uses per-stroke blue/red. */
function scribbleStrokeHex(color: ScribbleInk | undefined): string {
  if (!store.isPaperLook) return SCRIBBLE_INK_HEX.black
  return SCRIBBLE_INK_HEX[color ?? 'blue']
}

// Fly-across animation for auto-moved strips (duration shared with section FLIP)
const AUTO_MOVE_DURATION = STRIP_FLIP_DURATION_MS

// Reactive: store marks the id before the strip map update so the destination
// instance is hidden on first paint (and stays hidden if the instance is reused).
const isAutoMoving = computed(() => store.autoMovingStripIds.has(props.strip.id))
const isPrinting = computed(() => store.printingStripIds.has(props.strip.id))

/** True while this instance owns the body-level fly-clone (not the origin unmount). */
let autoMoveCloneOwned = false
let autoMoveCloneEl: HTMLElement | null = null
let autoMoveSettleCancel: (() => void) | null = null
let autoMoveAnimHandle: WallClockAnimHandle | null = null

/** Paper print: BR-corner reveal then fly to bay slot. */
let printAnimOwned = false
let printAnimCloneEl: HTMLElement | null = null
let printAnimSlotEl: HTMLElement | null = null
let printSettleCancel: (() => void) | null = null
let printAnimHandle: WallClockAnimHandle | null = null

function finishAutoMove() {
  autoMoveSettleCancel?.()
  autoMoveSettleCancel = null
  autoMoveAnimHandle?.cancel()
  autoMoveAnimHandle = null
  autoMoveCloneOwned = false
  autoMoveCloneEl = null
  store.endAutoMove(props.strip.id)
}

function finishPrintAnim() {
  printSettleCancel?.()
  printSettleCancel = null
  printAnimHandle?.cancel()
  printAnimHandle = null
  printAnimOwned = false
  printAnimCloneEl?.remove()
  printAnimSlotEl?.remove()
  printAnimCloneEl = null
  printAnimSlotEl = null
  store.endPrintAnim(props.strip.id)
}

function tryAutoMoveAnimation() {
  // Zoom overlay shares strip id — only the bay instance owns the fly-clone.
  if (props.isLargeView) return
  if (autoMoveCloneOwned) return

  const data = store.autoMoveData.get(props.strip.id)
  if (!data) return
  store.autoMoveData.delete(props.strip.id)

  const el = stripElement.value
  if (!el) {
    finishAutoMove()
    return
  }

  const { rect: oldRect, clone } = data
  autoMoveCloneOwned = true
  autoMoveCloneEl = clone

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
  // Cloned node may carry auto-move-hidden from a prior frame — force visible
  clone.classList.remove('auto-move-hidden')
  clone.style.opacity = '1'
  clone.style.visibility = 'visible'
  document.body.appendChild(clone)

  // Double rAF when painting; wall-clock fallback so hidden tabs still measure + fly
  autoMoveSettleCancel = afterLayoutSettle(() => {
    autoMoveSettleCancel = null
    if (!autoMoveCloneOwned || !stripElement.value) {
      clone.remove()
      if (autoMoveCloneOwned) finishAutoMove()
      return
    }
    const newRect = stripElement.value.getBoundingClientRect()

    // Skip if no visible movement
    if (Math.abs(oldRect.left - newRect.left) < 1 && Math.abs(oldRect.top - newRect.top) < 1) {
      clone.remove()
      finishAutoMove()
      return
    }

    const anim = clone.animate(
      [
        { left: `${oldRect.left}px`, top: `${oldRect.top}px` },
        { left: `${newRect.left}px`, top: `${newRect.top}px` },
      ],
      {
        duration: AUTO_MOVE_DURATION,
        easing: 'ease-in-out',
        fill: 'forwards',
      },
    )

    autoMoveAnimHandle = driveAnimationWallClock(anim, AUTO_MOVE_DURATION, () => {
      autoMoveAnimHandle = null
      clone.remove()
      finishAutoMove()
    })
  })
}

function tryPrintAnimation() {
  if (props.isLargeView) return
  if (printAnimOwned) return
  if (!store.printingStripIds.has(props.strip.id)) return

  const el = stripElement.value
  // Not mounted yet / zero-size (e.g. off-scroll bay): don't leave strip forever hidden
  if (!el) {
    finishPrintAnim()
    return
  }

  printAnimOwned = true

  printSettleCancel = afterLayoutSettle(() => {
    printSettleCancel = null
    if (!printAnimOwned || !stripElement.value) {
      finishPrintAnim()
      return
    }

    const destEl = stripElement.value
    const destRect = destEl.getBoundingClientRect()
    const w = destRect.width
    const h = destRect.height
    if (w < 2 || h < 2) {
      finishPrintAnim()
      return
    }

    const clone = destEl.cloneNode(true) as HTMLElement
    clone.classList.remove('print-anim-hidden', 'auto-move-hidden')
    clone.removeAttribute('data-strip-id')
    clone.style.opacity = '1'
    clone.style.visibility = 'visible'
    clone.style.pointerEvents = 'none'
    clone.style.margin = '0'
    clone.style.transition = 'none'
    clone.style.boxSizing = 'border-box'

    const pad = 12
    const bar = document.querySelector('.efs-bottom-bar') as HTMLElement | null
    const barTop = bar?.getBoundingClientRect().top ?? window.innerHeight
    const startLeft = Math.max(pad, window.innerWidth - w - pad)
    const startTop = Math.max(pad, barTop - h - pad)

    const slot = document.createElement('div')
    slot.style.cssText = [
      'position:fixed',
      `left:${startLeft}px`,
      `top:${startTop}px`,
      `width:${w}px`,
      `height:${h}px`,
      'overflow:hidden',
      'z-index:9999',
      'pointer-events:none',
    ].join(';')

    clone.style.position = 'absolute'
    clone.style.left = '0'
    clone.style.top = '0'
    clone.style.width = `${w}px`
    clone.style.height = `${h}px`
    /* Feed out along strip length (from printer on the right) */
    clone.style.transform = 'translateX(100%)'

    slot.appendChild(clone)
    document.body.appendChild(slot)
    printAnimCloneEl = clone
    printAnimSlotEl = slot

    const printMs = store.getPrintAnimDurationMs(props.strip.id)

    const printAnim = clone.animate(
      [{ transform: 'translateX(100%)' }, { transform: 'translateX(0)' }],
      { duration: printMs, easing: 'linear', fill: 'forwards' },
    )

    const startFly = () => {
      if (!printAnimOwned) return

      // Lift clone to body at printer position, then fly to bay slot
      clone.style.position = 'fixed'
      clone.style.left = `${startLeft}px`
      clone.style.top = `${startTop}px`
      clone.style.transform = ''
      clone.style.zIndex = '9999'
      document.body.appendChild(clone)
      slot.remove()
      printAnimSlotEl = null

      const live = stripElement.value?.getBoundingClientRect()
      const toLeft = live?.left ?? destRect.left
      const toTop = live?.top ?? destRect.top

      const fly = clone.animate(
        [
          { left: `${startLeft}px`, top: `${startTop}px` },
          { left: `${toLeft}px`, top: `${toTop}px` },
        ],
        { duration: AUTO_MOVE_DURATION, easing: 'ease-in-out', fill: 'forwards' },
      )

      printAnimHandle = driveAnimationWallClock(fly, AUTO_MOVE_DURATION, () => {
        printAnimHandle = null
        finishPrintAnim()
      })
    }

    printAnimHandle = driveAnimationWallClock(printAnim, printMs, () => {
      printAnimHandle = null
      startFly()
    })
  })
}

// Strip may be remounted (new parent section) or updated in place
onMounted(() => {
  tryAutoMoveAnimation()
  tryPrintAnimation()
})
onUpdated(() => {
  tryAutoMoveAnimation()
  tryPrintAnimation()
})

// Context menu state
const menuOpen = ref(false)
const menuPosition = ref<[number, number]>([0, 0])
/** Above StripZoomOverlay (2400) when this strip is the zoomed instance */
const overlayMenuZ = computed(() => (props.isLargeView ? 2600 : 2000))
const sidRouteMenuOpen = ref(false)
const rwyMenuOpen = ref(false)
const cflMenuOpen = ref(false)
const xflMenuOpen = ref(false)
const ahdMenuOpen = ref(false)
const transferMenuOpen = ref(false)
const groundStateMenuOpen = ref(false)
const sizeMenuOpen = ref(false)
const klackMenuOpen = ref(false)
const pobMenuOpen = ref(false)
const pobEditText = ref('')
const pobInputEl = ref<HTMLInputElement | null>(null)
const ctotMenuOpen = ref(false)
const tsacMenuOpen = ref(false)
const tsacDialogOpen = ref(false)
const tsacDialogInitial = ref('')
const reaMenuOpen = ref(false)

function closeStripContextMenu() {
  menuOpen.value = false
  sizeMenuOpen.value = false
  klackMenuOpen.value = false
  groundStateMenuOpen.value = false
  transferMenuOpen.value = false
  pobMenuOpen.value = false
}

function onKlackMenu(klack: 'left' | 'right' | null) {
  menuOpen.value = false
  klackMenuOpen.value = false
  store.setKlack(props.strip.id, klack)
}

/** SAAB: type-coloured side frame is the cock hit target. */
const showSaabCockEdges = computed(
  () =>
    !store.isPaperLook &&
    !props.isLargeView &&
    props.strip.stripType !== 'note' &&
    props.strip.stripType !== 'vehicle',
)

/**
 * Click left/right frame (always via flush — drag may left↔right in one gesture):
 * - Already cocked → either edge resets to flush
 * - Flush → cock that side
 */
function onCockEdgeClick(side: 'left' | 'right') {
  if (!showSaabCockEdges.value) return
  if (props.strip.klack) {
    store.setKlack(props.strip.id, null)
    return
  }
  store.setKlack(props.strip.id, side)
}

/**
 * Combined pointer drag (paper + SAAB): one bay-move drag for every direction.
 * Cock from horizontal offset when the strip stays in the same slot; any real
 * relocate flushes. Mostly-horizontal same-bay drops skip moveStrip so
 * flush→cock is reliable (index jitter must not eat the cock).
 * HTML5 drag is off while this mode is active.
 */
const usesCombinedStripPointer = computed(
  () =>
    !props.isLargeView &&
    canDragStrip.value &&
    (store.isPaperLook || showSaabCockEdges.value),
)
const KLACK_BASE_PX = 28
const PAPER_ARM_PX = 8
/** Max |dy| for treating a same-bay drop as cock-only (no relocate). */
const COCK_ONLY_MAX_DY_PX = 28
const klackGestureActive = ref(false)
/** Kept false — no separate in-flow pull; template classes stay inert. */
const klackPulling = ref(false)
const klackPullTarget = ref<'left' | 'right' | null>(null)
const klackAmtPx = ref(KLACK_BASE_PX)
/** Skip cock slide when klack is applied from a drag (click still animates). */
const klackInstant = ref(false)
const stripHostEl = ref<HTMLElement | null>(null)
let paperPointerId: number | null = null
let paperStartX = 0
let paperStartY = 0
let klackBaseX = 0
let paperBayDragging = false
let dragOriginBayId = ''
let dragOriginSectionId = ''
let dragOriginBottom = false
let dragOriginPosition = 0
let dragLastClientX = 0
let dragLastClientY = 0

function setKlackPullBayActive(active: boolean) {
  const bayId = props.bayId || props.strip.bayId
  if (!bayId) return
  if (active) paperKlackPullBayIds.add(bayId)
  else paperKlackPullBayIds.delete(bayId)
}

/**
 * Sideways snap distance.
 * SAAB cock: strip margin-x + half bay gutter → outer edge sits mid bay-border.
 * Paper klack: fixed design offset × bay/strip scale.
 */
function readKlackAmtPx(): number {
  const el = stripElement.value || stripHostEl.value
  if (!el) return KLACK_BASE_PX
  const styles = getComputedStyle(el)
  if (!store.isPaperLook) {
    const gutterRaw = styles.getPropertyValue('--efs-bay-gutter').trim()
    const gutter = parseFloat(gutterRaw) || 8
    const marginRaw = styles.getPropertyValue('--cock-strip-margin-x').trim()
    const margin = parseFloat(marginRaw) || 4
    return margin + gutter / 2
  }
  const bay = parseFloat(styles.getPropertyValue('--bay-scale')) || 0
  const stripSc = parseFloat(styles.getPropertyValue('--strip-scale')) || 0
  return KLACK_BASE_PX * (bay || stripSc || 1)
}

function klackSnapTarget(x: number): 'left' | 'right' | null {
  const amt = klackAmtPx.value
  if (x <= -amt * 0.45) return 'left'
  if (x >= amt * 0.45) return 'right'
  return null
}

function klackSnapX(target: 'left' | 'right' | null): number {
  if (target === 'left') return -klackAmtPx.value
  if (target === 'right') return klackAmtPx.value
  return 0
}

function captureDragOrigin() {
  dragOriginBayId = props.strip.bayId
  dragOriginSectionId = props.strip.sectionId
  dragOriginBottom = !!props.strip.bottom
  dragOriginPosition = props.strip.position
}

/** Offset from flush (start cock + pointer delta); range allows left↔right in one drag. */
function klackOffsetFromPointer(): number {
  const dx = dragLastClientX - paperStartX
  const max = klackAmtPx.value * 2.2
  return Math.max(-max, Math.min(max, klackBaseX + dx))
}

function cockTargetFromDragDx(): 'left' | 'right' | null {
  return klackSnapTarget(klackOffsetFromPointer())
}

function setKlackInstant(stripId: string, next: 'left' | 'right' | null) {
  const strip = store.strips.get(stripId)
  if (!strip) return
  const cur = strip.klack === 'left' || strip.klack === 'right' ? strip.klack : null
  if (next === cur) return
  klackInstant.value = true
  store.setKlack(stripId, next)
  nextTick(() => {
    requestAnimationFrame(() => {
      klackInstant.value = false
    })
  })
}

/** True when pointer stayed nearly level — cock without trusting drop index. */
function isCockOnlyGesture(): boolean {
  const dx = Math.abs(dragLastClientX - paperStartX)
  const dy = Math.abs(dragLastClientY - paperStartY)
  return dx >= PAPER_ARM_PX && dy <= COCK_ONLY_MAX_DY_PX && dx > dy
}

function applyCockAfterUnifiedDrop(stripId: string, forcedSameSpot?: boolean) {
  const strip = store.strips.get(stripId)
  if (!strip) return
  const sameSpot =
    forcedSameSpot ||
    (strip.bayId === dragOriginBayId &&
      strip.sectionId === dragOriginSectionId &&
      !!strip.bottom === dragOriginBottom &&
      strip.position === dragOriginPosition)
  setKlackInstant(stripId, sameSpot ? cockTargetFromDragDx() : null)
}

const klackPullStyle = computed(() => undefined)

const klackHostStyle = computed(() => {
  if (!store.isPaperLook && !showSaabCockEdges.value && !props.strip.klack) return undefined
  return {
    '--klack-amt': `${klackAmtPx.value || KLACK_BASE_PX}px`,
  }
})

function pointerAsTouch(e: PointerEvent): Touch {
  return { clientX: e.clientX, clientY: e.clientY } as Touch
}

function finishPaperBayDrop() {
  const stripId = props.strip.id
  const result = touchDrag.endDrag()

  if (result.isTrashDrop && result.data) {
    store.deleteStrip(result.data.stripId)
    isDragging.value = false
    markStripDragEnded()
    paperBayDragging = false
    setKlackPullBayActive(false)
    return
  }

  // Level sideways drag in the home bay → cock only (ignore insert-index jitter)
  if (result.dropTarget && result.data && isCockOnlyGesture()) {
    const sectionEl = result.dropTarget.closest('.efs-section')
    const bayEl = sectionEl?.closest('.efs-bay')
    const targetBayId =
      sectionEl?.getAttribute('data-efs-bay-id') || bayEl?.getAttribute('data-bay-id')
    const matchAttr = sectionEl?.getAttribute('data-efs-match-sections')
    const matchIds = (matchAttr || sectionEl?.getAttribute('data-efs-section-id') || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    const sameHome =
      !!targetBayId &&
      targetBayId === dragOriginBayId &&
      matchIds.includes(dragOriginSectionId) &&
      !!result.isBottomDrop === dragOriginBottom
    if (sameHome) {
      setKlackInstant(stripId, cockTargetFromDragDx())
      isDragging.value = false
      markStripDragEnded()
      paperBayDragging = false
      setKlackPullBayActive(false)
      return
    }
  }

  if (result.dropTarget && result.data) {
    const sectionEl = result.dropTarget.closest('.efs-section')
    const bayEl = sectionEl?.closest('.efs-bay')
    // Prefer server bay/section (workspace columns use ws-col-* on data-bay-id)
    const targetBayId =
      sectionEl?.getAttribute('data-efs-bay-id') || bayEl?.getAttribute('data-bay-id')
    const modeSectionId =
      sectionEl?.getAttribute('data-efs-section-id') ||
      sectionEl?.getAttribute('data-section-id')
    // Workspace header id (push_back / start_up) — drop intent for GS
    const dropHeaderId =
      sectionEl?.getAttribute('data-efs-drop-section-id') || modeSectionId
    const matchAttr = sectionEl?.getAttribute('data-efs-match-sections')
    const matchIds = (matchAttr || modeSectionId || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    const stripForDrop = store.strips.get(result.data.stripId)
    const pushDropHeader =
      dropHeaderId === 'push_back' ||
      dropHeaderId === 'start_up' ||
      dropHeaderId === 'push_start' ||
      (!!dropHeaderId && dropHeaderId.endsWith('_push_start'))
    const membershipSec = pushDropHeader
      ? dropHeaderId
      : stripForDrop && matchIds.includes(stripForDrop.sectionId)
        ? stripForDrop.sectionId
        : modeSectionId
    if (modeSectionId && targetBayId && membershipSec) {
      if (result.isBottomDrop) {
        store.moveStripToBottom(
          result.data.stripId,
          targetBayId,
          membershipSec,
          result.dropPosition,
        )
      } else {
        handleTouchDropWithGaps(
          result.data,
          targetBayId,
          membershipSec,
          result.dropTarget,
          result.draggedStripTop,
          result.touchY,
          {
            modeSectionId,
            matchSectionIds: matchIds.length > 0 ? matchIds : undefined,
          },
        )
      }
    }
    applyCockAfterUnifiedDrop(stripId)
  } else {
    // Cancelled / no target — still home → cock from horizontal offset
    applyCockAfterUnifiedDrop(stripId, true)
  }
  isDragging.value = false
  markStripDragEnded()
  paperBayDragging = false
  setKlackPullBayActive(false)
}

function beginUnifiedBayDrag(pointer: Touch) {
  if (paperBayDragging || isDragging.value) return
  captureDragOrigin()
  paperBayDragging = true
  klackGestureActive.value = true
  isDragging.value = true
  klackAmtPx.value = readKlackAmtPx()
  klackPullTarget.value = cockTargetFromDragDx()
  nextTick(() => {
    if (!stripElement.value || !paperBayDragging) return
    const rect = stripElement.value.getBoundingClientRect()
    touchDrag.startDrag(
      stripElement.value,
      {
        stripId: props.strip.id,
        bayId: props.bayId,
        sectionId: props.sectionId,
        isBottom: props.strip.bottom,
        originalTop: rect.top,
        originalBottom: rect.bottom,
        stripHeight: rect.height,
        dragOffsetY: pointer.clientY - rect.top,
      },
      pointer,
    )
  })
}

function onPaperPointerDown(e: PointerEvent) {
  if (!usesCombinedStripPointer.value) return
  if (e.button !== 0) return
  if (e.pointerType === 'touch') return // touch uses long-press path + move below
  const t = e.target as HTMLElement | null
  if (
    t?.closest('button') ||
    t?.closest('input') ||
    t?.closest('textarea') ||
    t?.closest('a')
  ) {
    return
  }
  paperPointerId = e.pointerId
  paperStartX = e.clientX
  paperStartY = e.clientY
  dragLastClientX = e.clientX
  dragLastClientY = e.clientY
  klackAmtPx.value = readKlackAmtPx()
  klackBaseX = klackSnapX(props.strip.klack ?? null)
  klackPullTarget.value = props.strip.klack ?? null
  klackGestureActive.value = false
  klackPulling.value = false
  paperBayDragging = false
  // Do NOT setPointerCapture here — it retargets click away from C/S (zoom) / cells.
}

function capturePaperPointer(pointerId: number) {
  try {
    stripElement.value?.setPointerCapture(pointerId)
  } catch {
    /* ignore */
  }
}

function onPaperPointerMove(e: PointerEvent) {
  if (paperPointerId !== e.pointerId) return
  if (!usesCombinedStripPointer.value && !paperBayDragging) return

  dragLastClientX = e.clientX
  dragLastClientY = e.clientY
  klackPullTarget.value = cockTargetFromDragDx()

  if (paperBayDragging) {
    touchDrag.moveDrag(pointerAsTouch(e))
    return
  }

  const dx = e.clientX - paperStartX
  const dy = e.clientY - paperStartY
  if (Math.abs(dx) < PAPER_ARM_PX && Math.abs(dy) < PAPER_ARM_PX) return

  // Any direction past arm → one unified bay drag
  capturePaperPointer(e.pointerId)
  beginUnifiedBayDrag(pointerAsTouch(e))
  e.preventDefault()
}

function onPaperPointerUp(e: PointerEvent) {
  if (paperPointerId !== e.pointerId) return
  try {
    stripElement.value?.releasePointerCapture(e.pointerId)
  } catch {
    /* ignore */
  }
  paperPointerId = null
  dragLastClientX = e.clientX
  dragLastClientY = e.clientY

  if (paperBayDragging) {
    finishPaperBayDrop()
  }

  window.setTimeout(() => {
    klackGestureActive.value = false
  }, 0)
}

watch(menuOpen, (open) => {
  if (open) claimStripContextMenu(closeStripContextMenu)
  else releaseStripContextMenu(closeStripContextMenu)
})

watch(pobMenuOpen, (open) => {
  if (open) {
    pobEditText.value = props.strip.pob || ''
    nextTick(() => pobInputEl.value?.focus())
  }
})

onUnmounted(() => {
  releaseStripContextMenu(closeStripContextMenu)
  setKlackPullBayActive(false)
})

const sidCellLabel = computed(() =>
  sidFieldLabel(props.strip.adep, store.multiAirport),
)

/** CFTO / ATD / DEPA — green frame on top-expander DEP (not ▲ highlight). */
const isDepDeparted = computed(
  () =>
    !!props.strip.clearedForTakeoff ||
    !!props.strip.atd ||
    (props.strip.groundstate || '').toUpperCase() === 'DEPA',
)

// Ground state: DEP/local flow then ARR flow (NSTS → … → DEPA | ARR → TXIN → PARK)
const groundStateOptions = [
  { code: '---', label: 'No State', action: 'NOGS', groundstate: '' },
  { code: 'FRQ', label: 'On Freq', action: 'FRQ', groundstate: 'ONFREQ' },
  { code: 'RDY', label: 'De-ice', action: 'DEICE', groundstate: 'DE-ICE' },
  { code: 'S/U', label: 'Startup', action: 'STUP', groundstate: 'STUP' },
  { code: 'S/P', label: 'Push', action: 'PUSH', groundstate: 'PUSH' },
  { code: 'TXO', label: 'Taxi Out', action: 'TXO', groundstate: 'TAXI' },
  { code: 'L/U', label: 'Lineup', action: 'LU', groundstate: 'LINEUP' },
  { code: 'CTO', label: 'Takeoff', action: 'CTO', groundstate: 'DEPA' },
  // ARR = ES native "Arriving" (ADC sector list), not "has landed"
  { code: 'ARR', label: 'Arriving', action: 'ARR', groundstate: 'ARR' },
  { code: 'CTL', label: 'Cleared to Land', action: 'CTL_GS', groundstate: 'ARR', extra: true },
  { code: 'TXI', label: 'Taxi In', action: 'TXI', groundstate: 'TXIN' },
  { code: 'PRK', label: 'Parked', action: 'PARK', groundstate: 'PARK' },
]

const groundStateLabel = computed(() => {
  const gs = props.strip.groundstate ?? ''
  const match = groundStateOptions.find(o => o.groundstate === gs && !o.extra)
  return match ? match.code : gs || '---'
})

// Dialog state
const clncDialogOpen = ref(false)
const depCoordDialogOpen = ref(false)
/** ASSUME was sent in openDepCoordDialog() immediately before opening DEP COORD. */
const depCoordAssumedBeforeOpen = ref(false)
const atdDialogOpen = ref(false)
const coordProposalDialogOpen = ref(false)
const fplDialogOpen = ref(false)
const deleteDialogOpen = ref(false)
const largeViewOpen = ref(false)
const largeViewAnchor = ref<{ left: number; top: number; width: number; height: number } | null>(null)

function openLargeView() {
  closeAssignmentMenus()
  const el = stripElement.value
  if (el) {
    const r = el.getBoundingClientRect()
    largeViewAnchor.value = { left: r.left, top: r.top, width: r.width, height: r.height }
  } else {
    largeViewAnchor.value = null
  }
  largeViewOpen.value = true
}

function onSizeExpanded() {
  menuOpen.value = false
  if (props.isLargeView) return
  isCompact.value = false
  topExpanded.value = true
  bottomExpanded.value = true
  adoptManualStripFitBaseline(props.strip.id)
  nextTick(() => scheduleStripScale(true))
}

function onSizeNormal() {
  menuOpen.value = false
  isCompact.value = false
  collapseStripExpanders(props.strip.id)
  adoptManualStripFitBaseline(props.strip.id)
  nextTick(() => scheduleStripScale(true))
}

function onSizeCompact() {
  menuOpen.value = false
  if (!canCompactStrip.value || props.isLargeView) return
  collapseStripExpanders(props.strip.id)
  isCompact.value = true
  adoptManualStripFitBaseline(props.strip.id)
  nextTick(() => scheduleStripScale(true))
}

function onExpandTopExpander() {
  topExpanded.value = true
  adoptManualStripFitBaseline(props.strip.id)
}

function onCollapseTopExpander() {
  topExpanded.value = false
  adoptManualStripFitBaseline(props.strip.id)
}

function onExpandBottomExpander() {
  bottomExpanded.value = true
  adoptManualStripFitBaseline(props.strip.id)
}

function onCollapseBottomExpander() {
  bottomExpanded.value = false
  adoptManualStripFitBaseline(props.strip.id)
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
/** Host hit width = strip --frame-side (8px × strip-scale). */
const cockHostStyle = computed(() => {
  if (!showSaabCockEdges.value) return undefined
  const s = stripScale.value > 0 ? stripScale.value : 1
  return { '--cock-frame-side': `${8 * s}px` } as Record<string, string>
})
const bayScribbleStrokeWidth = computed(() => scribbleStrokeWidthCss(stripScale.value))
const callsignBoxEl = ref<HTMLElement | null>(null)
const callsignTextEl = ref<HTMLElement | null>(null)
const callsignFontPx = ref(CALLSIGN_FONT_MAX)
let stripScaleRaf = 0
let stripResizeObs: ResizeObserver | null = null
/** Last width used for --strip-scale (zoom / legacy; bay strips use --bay-scale). */
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
  // Compact action .fit-font may leave inline sizes — clear when back to normal
  if (!isCompactBay.value) {
    root.querySelectorAll<HTMLElement>('.strip-actions .action-button').forEach((el) => {
      el.style.fontSize = ''
    })
  }
  root.querySelectorAll<HTMLElement>('.fit-font').forEach((el) => {
    fitFontToBox(el, FIT_FONT_MIN)
  })
}

function quantizeStripScale(raw: number, max: number): number {
  const clamped = Math.max(0.55, Math.min(max, raw))
  // 0.02 steps — enough for Size %, kills subpixel width flicker
  return Math.round(clamped * 50) / 50
}

function readBayScaleForStrip(el: HTMLElement): number {
  // Prefer the bay node — klack position:fixed must not rely on strip inheritance quirks
  const bayEl = el.closest('.efs-bay')
  const raw = getComputedStyle(bayEl ?? el).getPropertyValue('--bay-scale').trim()
  return parseFloat(raw) || 1
}

function updateStripScale(force = false) {
  const el = stripElement.value
  if (!el) return

  // Zoom overlay: use deterministic --zoom-strip-scale from panel width (no RO dither)
  if (props.isLargeView) {
    const fromPanel = parseFloat(
      getComputedStyle(el).getPropertyValue('--zoom-strip-scale').trim(),
    )
    const w = el.clientWidth
    const raw =
      Number.isFinite(fromPanel) && fromPanel > 0
        ? fromPanel
        : w > 0
          ? w / STRIP_REF_WIDTH_PX
          : 0
    if (raw <= 0) return
    const s = quantizeStripScale(raw, 5)
    if (!force && s === stripScale.value) {
      if (w > 0) lastStripScaleWidth = w
      return
    }
    if (w > 0) lastStripScaleWidth = w
    stripScale.value = s
    el.style.setProperty('--strip-scale', String(s))
    fitAllBoxFonts()
    return
  }

  /*
   * Bay strips (paper + SAAB): fonts/height follow --bay-scale only.
   * Never write inline --strip-scale from strip width — cock/klack column bleed
   * and scrollbar chatter must not change aspect ratio.
   */
  const s = quantizeStripScale(readBayScaleForStrip(el), 2.2)
  if (el.style.getPropertyValue('--strip-scale')) {
    el.style.removeProperty('--strip-scale')
  }
  if (!force && s === stripScale.value) return
  stripScale.value = s
  el.querySelectorAll<HTMLElement>('.fit-font').forEach((node) => {
    node.style.fontSize = ''
  })
  if (callsignTextEl.value) callsignTextEl.value.style.fontSize = ''
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
  // Zoom scale is panel-driven; bay strips follow --bay-scale on the bay node
  if (props.isLargeView) return
  const bayEl = el.closest('.efs-bay')
  stripResizeObs = new ResizeObserver(() => {
    scheduleStripScale()
  })
  stripResizeObs.observe(bayEl ?? el)
}

// Note / vehicle strip state (local-only — not EuroScope-linked)
const isNote = computed(() => props.strip.stripType === 'note')
const paperInfoKind = computed(() => props.strip.paperInfoKind)
/** Plain empty + HINDER / Bogsering / Snöröjning (+ prel) — red/black rails, no flight grid */
const isPaperInfoHolder = computed(() => {
  const k = paperInfoKind.value
  return (
    k === 'empty' ||
    k === 'hinder' ||
    k === 'bogsering' ||
    k === 'snorojning' ||
    k === 'prel_rojning'
  )
})
/** Framed blanks with FPS box/grid (`empty` plain cream is NOT included) */
const isPaperEmptyFlightHolder = computed(() => {
  const k = paperInfoKind.value
  return k === 'empty_frame' || k === 'empty_arr' || k === 'empty_dep'
})
const isVehicle = computed(() => props.strip.stripType === 'vehicle')

/** HHmm digits for paper FPS print style (no colon). */
function formatPaperHhmm(hhmm: string | undefined): string {
  if (!hhmm) return ''
  const digits = hhmm.replace(/\D/g, '')
  if (digits.length < 3) return ''
  return digits.length === 3 ? digits.padStart(4, '0') : digits.slice(0, 4)
}

const paperEobt = computed(() => formatPaperHhmm(props.strip.eobt))
const paperPrimaryTime = computed(() =>
  isArrLayout.value ? formatPaperHhmm(props.strip.eta) : formatPaperHhmm(props.strip.eobt),
)
/** DEP col 2 bottom-left: cleared for takeoff (DEPA; paper keeps it after ATD) */
const paperCto = computed(() => !!props.strip.clearedForTakeoff)
/** ARR col 2 bottom-left: cleared to land */
const paperCtl = computed(() => !!props.strip.clearedToLand)
/** Hide generated mark only when freehand ink matched the shape (mismatched ink must not hide the flag). */
const hasShapeMatchedCtoScribble = computed(() =>
  hasShapeMatchedPaperScribble(props.strip.id, 'cto'),
)
const hasShapeMatchedCtlScribble = computed(() =>
  hasShapeMatchedPaperScribble(props.strip.id, 'ctl'),
)
/** Paper ATD/ATA: minutes only (mm), not hhmm */
function formatPaperMm(hhmm: string | undefined): string {
  if (!hhmm) return ''
  const digits = hhmm.replace(/\D/g, '')
  if (digits.length < 2) return ''
  return digits.slice(-2)
}
const paperAtd = computed(() => formatPaperMm(props.strip.atd))
const paperAta = computed(() => formatPaperMm(props.strip.ata))
/**
 * CTOT−5 minutes as mm (e.g. CTOT 2229 → 24). Shown left of CFTO/ATD when CTOT set.
 */
function formatCtotMinus5Mm(hhmm: string | undefined): string {
  if (!hhmm) return ''
  const digits = hhmm.replace(/\D/g, '')
  if (digits.length < 3) return ''
  const padded = digits.length === 3 ? digits.padStart(4, '0') : digits.slice(0, 4)
  let h = parseInt(padded.slice(0, 2), 10)
  let m = parseInt(padded.slice(2, 4), 10)
  if (!Number.isFinite(h) || !Number.isFinite(m) || h > 23 || m > 59) return ''
  m -= 5
  if (m < 0) {
    m += 60
    h = (h + 23) % 24
  }
  return String(m).padStart(2, '0')
}
const paperCtotSlotMm = computed(() =>
  isArrLayout.value ? '' : formatCtotMinus5Mm(props.strip.ctot),
)
/** Hide EFS auto ATD/ATA when the cell already has freehand ink */
const paperShowAtd = computed(
  () => !!paperAtd.value && atdScribbleCount.value === 0,
)
const paperShowAta = computed(
  () => !!paperAta.value && atdScribbleCount.value === 0,
)

/** IFR ARR go-around: show col-3 arrow when MA / soft GA (hide if freehand ink) */
const paperShowGoaArrow = computed(
  () =>
    isArrLayout.value &&
    !!props.strip.missedApproach &&
    isIfrSidEligible(props.strip.flightRules),
)

/** Paper ESGG: CLR / CTL / CTO / ATIS clickspots — locked when another controller owns. */
const canUsePaperClickspots = computed(
  () =>
    store.isPaperLook &&
    store.isController &&
    !isPaperEmptyFlightHolder.value &&
    store.allowMoveOwnedStrip(props.strip),
)

function onPaperCtoClick() {
  if (isArrLayout.value || isPaperEmptyFlightHolder.value) return
  if (!canUsePaperClickspots.value) return
  // Ink present: always clear scribble; only revert CTO if the flag was actually set
  if (hasCtoScribble.value) {
    removeClrScribbles(props.strip.id, 'cto')
    if (paperCto.value) store.sendStripAction(props.strip.id, 'LU')
    return
  }
  // Toggle: off → CTO (DEPA), on → LU (LINEUP) — line follows clearedForTakeoff
  store.sendStripAction(props.strip.id, paperCto.value ? 'LU' : 'CTO')
}

function onPaperCtlClick() {
  if (!isArrLayout.value || isPaperEmptyFlightHolder.value) return
  if (!canUsePaperClickspots.value) return
  // Ink present: always clear scribble; only unset CTL if the flag was actually set
  if (hasCtlScribble.value) {
    removeClrScribbles(props.strip.id, 'ctl')
    if (paperCtl.value) store.sendStripAction(props.strip.id, 'unsetCTL')
    return
  }
  store.sendStripAction(props.strip.id, paperCtl.value ? 'unsetCTL' : 'CTL')
}

/** Clear G/A hotspot ink (mismatched shapes never set softGA; click still erases). */
function onPaperGoaScribbleClear() {
  if (!hasGoaScribble.value) return
  removeClrScribbles(props.strip.id, 'goa')
}

/** UTFLYGNING / soft G/A — same conditions as zoom rising-/ tag */
const paperCanXferAppDiag = computed(() => {
  if (!store.isPaperLook || isPaperEmptyFlightHolder.value) return false
  if (!store.isController || !store.allowMoveOwnedStrip(props.strip)) return false
  if (isTransferIn.value) return false
  const sec = props.sectionId || props.strip.sectionId
  return (
    !!props.strip.missedApproach ||
    sec === 'ctr_dep' ||
    sec.endsWith('_ctr_dep')
  )
})

/** Bottom cell left-half clickspot: refuse inbound, XFER APP, cancel outbound, or clear ink */
const paperShowXferDiagClickspot = computed(() => {
  if (!store.isPaperLook || isPaperEmptyFlightHolder.value || !store.isController) return false
  const id = props.strip.id
  // Keep clickzone while tagged ink is present so mismatched shapes can still be cleared
  if (hasClrScribble(id, 'xfer-app') || hasClrScribble(id, 'xfer-refuse')) return true
  if (isTransferIn.value) return true
  return paperCanXferAppDiag.value
})

const paperXferDiagTitle = computed(() => {
  if (isTransferIn.value) return paperTip('REFUSE', 'Refuse inbound transfer')
  if (isTransferOut.value && hasClrScribble(props.strip.id, 'xfer-app')) {
    return paperTip('ASSUME', 'Cancel outbound transfer')
  }
  return paperTip('XFER', 'Transfer to APP')
})

/** Click left half of bottom col-1 cell — rising diagonal / (refuse, XFER APP, or re-assume) */
function onPaperXferDiagClick() {
  if (!store.isPaperLook || isPaperEmptyFlightHolder.value || !store.isController) return
  const id = props.strip.id

  // Ink present: always clear; re-assume only if outbound was pending
  if (hasClrScribble(id, 'xfer-app')) {
    removeClrScribbles(id, 'xfer-app')
    if (isTransferOut.value) store.sendStripAction(id, 'ASSUME')
    return
  }
  if (hasClrScribble(id, 'xfer-refuse')) {
    removeClrScribbles(id, 'xfer-refuse')
    return
  }

  if (isTransferIn.value) {
    pushRisingDiagonalLeftCol(id, 'blue', 'xfer-refuse')
    store.sendStripAction(id, 'REFUSE')
    return
  }

  if (!paperCanXferAppDiag.value) return
  pushRisingDiagonalLeftCol(id, 'blue', 'xfer-app')
  store.sendStripAction(id, 'XFER')
}
const paperCtot = computed(() => {
  if (showCtotCancelled.value) return 'SCL'
  if (!props.strip.ctot) return ''
  return formatPaperHhmm(props.strip.ctot)
})
/** DEP col 6 bottom: filed FPL route (may overflow into CTOT column) */
const paperFplRoute = computed(() => {
  if (isArrLayout.value) return ''
  return (props.strip.route || '').trim().toUpperCase()
})
/** DEP col 7 bottom: cruise level — Axxx ≤ TA, Fxxx > TA */
const paperCrz = computed(() => {
  if (isArrLayout.value) return ''
  return formatEfsLevel(props.strip.rfl, DEFAULT_TRANSITION_ALTITUDE_FT)
})
/** Filed TAS (N0448) for paper DEP — from strip.tas or FPL route (incl. FIX/N0446F390) */
const paperTas = computed(() => {
  if (isArrLayout.value) return ''
  if (props.strip.tas) return props.strip.tas
  const m = (props.strip.route || '')
    .toUpperCase()
    .match(/(?:^|[\s/])([NKM]\d{3,4})[FASM]\d{3,4}\b/)
  return m?.[1] || ''
})

/** Paper tooltips: short field names in ESGG / paper mode */
function paperTip(shortLabel: string, longLabel: string): string {
  return store.isPaperLook ? shortLabel : longLabel
}

/** Paper col 4 — CLR read (also on when readback or ES CLR; unsetting in CLEARED clears ES CLR) */
const paperClearanceRead = computed(
  () => !!(props.strip.clearance || props.strip.clearanceReadback || props.strip.clearanceRead),
)
/** Left check is hidden after DCL dismiss until the next explicit read click. */
const paperLeftMarkOn = computed(
  () => paperClearanceRead.value && !props.strip.paperClrReadSuppressed,
)
/** Paper col 5 — CLR correct (sets ES CLR; also on when ES CLR) */
const paperClearanceReadback = computed(
  () => !!(props.strip.clearance || props.strip.clearanceReadback),
)
/**
 * ESGG paper: after DCL send (and while DONE/WILCO), show felt "DCL" in CLR read
 * instead of the checkmark. Freehand clr-read ink wins if present.
 */
const paperShowDclRead = computed(() => {
  if (isArrLayout.value || hasClrReadScribble.value) return false
  if (props.strip.paperClrReadSuppressed || props.strip.dclDismissed) return false
  const s = props.strip.dclStatus
  if (s === 'SENT' || s === 'DONE' || s === 'WILCO') return true
  return !!props.strip.syncedDclMark
})

/** True while we auto-opened CLR for a paper DCL REQUEST (dismiss on auto/semi send). */
const dclDialogAutoOpened = ref(false)

/**
 * Paper has no CLNC action key — on DCL REQUEST, open Clearance so manual/semi
 * can Send. Auto/semi that auto-sends → SENT closes the flash dialog.
 */
watch(
  () => props.strip.dclStatus,
  (status, prev) => {
    if (!store.isPaperLook || isArrLayout.value || isPaperEmptyFlightHolder.value) return
    if (!canEditAssignedData.value || props.strip.ownedByOther) return

    if (status === 'REQUEST' && prev !== 'REQUEST') {
      clncDialogOpen.value = true
      dclDialogAutoOpened.value = true
      return
    }
    // Auto/semi auto-send succeeded — don't leave a SENT dialog flash open
    if (
      status === 'SENT' &&
      dclDialogAutoOpened.value &&
      (store.dclMode === 'auto' || store.dclMode === 'semi')
    ) {
      clncDialogOpen.value = false
      dclDialogAutoOpened.value = false
      return
    }
    if (status !== 'REQUEST') {
      dclDialogAutoOpened.value = false
    }
  },
)

function onPaperClearanceReadClick() {
  if (isArrLayout.value || isPaperEmptyFlightHolder.value) return
  if (!canUsePaperClickspots.value) return
  // Ink present: click clears scribble; clear local read only (don't nuke ES CLR)
  if (hasClrReadScribble.value) {
    removeClrScribbles(props.strip.id, 'clr-read')
    const localReadOnly =
      !!props.strip.clearanceRead && !props.strip.clearance && !props.strip.clearanceReadback
    if (localReadOnly) {
      store.sendStripAction(props.strip.id, 'toggleClearanceRead')
    }
    return
  }
  // DCL ink: first click clears it (right box stays). Next click adds the normal read check.
  if (paperShowDclRead.value) {
    store.sendStripAction(props.strip.id, 'dismissPaperDcl')
    return
  }
  if (props.strip.paperClrReadSuppressed) {
    store.sendStripAction(props.strip.id, 'restorePaperClrRead')
    return
  }
  store.sendStripAction(props.strip.id, 'toggleClearanceRead')
}

function onPaperClearanceReadbackClick() {
  if (isArrLayout.value || isPaperEmptyFlightHolder.value) return
  if (!canUsePaperClickspots.value) return
  if (hasClrCorrectScribble.value) {
    removeClrScribbles(props.strip.id, 'clr-correct')
    if (paperClearanceReadback.value) {
      store.sendStripAction(props.strip.id, 'toggleClearanceReadback')
    }
    return
  }
  store.sendStripAction(props.strip.id, 'toggleClearanceReadback')
}

/** Drop tagged CLR / CTO / CTL / G/A ink when flags clear elsewhere (drag / SID-SSR / ES). */
watch(
  () =>
    [
      props.strip.id,
      !!(props.strip.clearance || props.strip.clearanceReadback || props.strip.clearanceRead),
      !!(props.strip.clearance || props.strip.clearanceReadback),
      !!props.strip.clearedForTakeoff,
      !!props.strip.clearedToLand,
      !!props.strip.missedApproach,
    ] as const,
  ([id, readOn, correctOn, ctoOn, ctlOn, goaOn], prev) => {
    if (!prev) return
    const [prevId, prevRead, prevCorrect, prevCto, prevCtl, prevGoa] = prev
    if (id !== prevId) return
    if (prevRead && !readOn) removeClrScribbles(id, 'clr-read')
    if (prevCorrect && !correctOn) removeClrScribbles(id, 'clr-correct')
    if (prevCto && !ctoOn) removeClrScribbles(id, 'cto')
    if (prevCtl && !ctlOn) removeClrScribbles(id, 'ctl')
    if (prevGoa && !goaOn) removeClrScribbles(id, 'goa')
  },
)

const isLocalOnlyStrip = computed(() => isNote.value || isVehicle.value)
const isTransferIn = computed(() => !isLocalOnlyStrip.value && props.strip.transferPending === 'in')
const isTransferOut = computed(() => !isLocalOnlyStrip.value && props.strip.transferPending === 'out')

type VehicleField = 'hp' | 'std'
const vehicleEditField = ref<VehicleField | null>(null)
const vehicleEditText = ref('')
const vehicleHpInput = ref<HTMLInputElement | null>(null)
const vehicleStdInput = ref<HTMLInputElement | null>(null)

function startVehicleEdit(field: VehicleField) {
  vehicleEditField.value = field
  vehicleEditText.value = field === 'hp' ? props.strip.hp || '' : props.strip.std || ''
  nextTick(() => {
    const el = field === 'hp' ? vehicleHpInput.value : vehicleStdInput.value
    el?.focus()
    el?.select()
  })
}

function commitVehicleEdit() {
  const field = vehicleEditField.value
  if (!field) return
  const text = vehicleEditText.value
  vehicleEditField.value = null
  store.updateVehicleStrip(props.strip.id, field, text)
}

function cancelVehicleEdit() {
  vehicleEditField.value = null
}

/** Empty body / padding opens zoomed strip (bay) or closes it (zoom). */
function onVehicleBodyClick() {
  if (vehicleEditField.value) return
  if (props.isLargeView) {
    emit('close-large-view')
    return
  }
  openLargeView()
}

/** HP/STD editable on bay and in zoom (aircraft-style). */
function onVehicleFieldClick(field: 'hp' | 'std') {
  startVehicleEdit(field)
}

/**
 * Partial data dim (not classic full-strip opacity):
 * placeholder grey on data cells; callsign + nonstandard RWY stay full.
 * — ESSA INBOUND / backend `dimmed`
 * — Assumed by another controller (e.g. ACC) anywhere
 * Pending inbound transfer stays full brightness.
 */
const dimmedData = computed(() => {
  if (props.strip.transferPending === 'in') return false
  if (props.strip.ownedByOther) return true
  if (props.strip.dimmed) return true
  const id = (props.sectionId || props.strip.sectionId || '').toLowerCase()
  return id === 'inbound' || id === 'inbound_gnd' || id.endsWith('_inbound')
})
/** Assigned data (CFL/SID/RWY/scratch/…) — only when untracked or assumed by me */
const canEditAssignedData = computed(
  () => store.isController && !props.strip.ownedByOther,
)

/** POB: RTC only + V/Z flight rules. */
const canEditPob = computed(
  () =>
    store.multiAirport &&
    canEditAssignedData.value &&
    (props.strip.flightRules === 'V' || props.strip.flightRules === 'Z'),
)

function onExpDep() {
  if (!canEditAssignedData.value) return
  // Open ATD dialog first; CTO/DEPA only on confirm (cancel leaves strip unchanged)
  atdDialogOpen.value = true
}

/** After ATD OK: apply existing DEP/CTO (groundstate DEPA / CFTO). */
function onAtdDialogConfirm(_atd: string) {
  store.sendStripAction(props.strip.id, 'CTO')
}

function onExpPob() {
  if (!canEditPob.value) return
  const el = stripElement.value?.querySelector('.exp-pob-btn') as HTMLElement | null
  if (el) {
    const r = el.getBoundingClientRect()
    menuPosition.value = [r.left, r.bottom]
  }
  pobMenuOpen.value = true
}

async function fetchFplRemarks(): Promise<string> {
  try {
    const res = await fetch(`/api/flight/${encodeURIComponent(props.strip.callsign)}`)
    if (!res.ok) return ''
    const data = (await res.json()) as { fplRemarks?: string }
    return data.fplRemarks || ''
  } catch {
    return ''
  }
}

async function onPobConfirm() {
  const digits = pobEditText.value.replace(/\D/g, '').slice(0, 3)
  if (!digits) {
    await onPobClear()
    return
  }
  const current = await fetchFplRemarks()
  store.amendFlightPlan(props.strip.id, { fplRemarks: withPobInRemarks(current, digits) })
  pobMenuOpen.value = false
}

async function onPobClear() {
  const current = await fetchFplRemarks()
  store.amendFlightPlan(props.strip.id, { fplRemarks: withPobInRemarks(current, null) })
  pobMenuOpen.value = false
}

/** Context menu ASSUME — untracked / inbound handoff only (not when already assumed by me) */
const canAssumeFromMenu = computed(
  () =>
    store.isController &&
    !isLocalOnlyStrip.value &&
    !props.strip.isAssumed &&
    !store.isStripOwnedByOther(props.strip),
)

/**
 * Contact me — setting on, untracked arrivals only.
 * Hidden when this controller or someone else already has the aircraft assumed.
 */
const canShowContactMe = computed(
  () =>
    store.contactMeEnabled &&
    store.isController &&
    !isLocalOnlyStrip.value &&
    !isPaperEmptyFlightHolder.value &&
    props.strip.stripType === 'arrival' &&
    !props.strip.isAssumed &&
    !props.strip.ownedByOther,
)

/**
 * SAAB RTO: press sends LINEUP (undo CFTO) and replaces the key with TAXI OUT / TAXI IN.
 * Keep choice open after CFTO clears; close when TXO/TXI chosen or strip changes.
 */
const rtoChoiceOpen = ref(false)
watch(
  () => props.strip.id,
  () => {
    rtoChoiceOpen.value = false
  },
)
watch(
  () => props.strip.groundstate,
  (gs) => {
    // Choice is only while still lined up after RTO; taxi/other GS closes it
    if (rtoChoiceOpen.value && gs !== 'LINEUP' && gs !== 'DEPA') {
      rtoChoiceOpen.value = false
    }
  },
)

/**
 * Visible action keys: strip.actions plus CONTACTME paired with ASSUME on non-assumed arrivals.
 * Also ensures ASSUME when the context menu would offer it (empty/missing actions).
 */
const displayActions = computed(() => {
  let actions = [...(props.strip.actions || [])]
  if (!canShowContactMe.value) {
    actions = actions.filter((a) => a !== 'CONTACTME')
  }
  if (canAssumeFromMenu.value && !actions.includes('ASSUME')) {
    actions = [...actions, 'ASSUME']
  }
  if (canShowContactMe.value && actions.includes('ASSUME') && !actions.includes('CONTACTME')) {
    const i = actions.indexOf('ASSUME')
    actions = [...actions]
    actions.splice(i + 1, 0, 'CONTACTME')
  }
  // RTO press replaces RTO with TAXI OUT / TAXI IN (same strip action row)
  if (rtoChoiceOpen.value) {
    return ['TXO', 'TXI']
  }
  return actions
})

/**
 * Drag: notes/vehicles always; own/untracked flights when controller.
 * Other-assumed flights locked — paper exception: incoming transfer to me only.
 */
const canDragStrip = computed(() => {
  if (props.isLargeView) return false
  if (isLocalOnlyStrip.value) return true
  if (!store.isController) return false
  return store.allowMoveOwnedStrip(props.strip)
})

/**
 * Uncleared dep fields (XFL/CFL/AHD/SID) — amber when a value is present and
 * departure clearance is not yet given. Arrivals never use the DEP clearance flag.
 */
const unclearedFieldHighlight = computed(() => {
  if (!isDeparture.value) return false
  return !props.strip.clearance
})

/**
 * Amber SID:
 * - No clearance yet (any shown SID)
 * - After clearance: still amber for VFR / track·SLOW / radar-vector ve SIDs
 */
const sidHighlight = computed(() => {
  const raw = (props.strip.sid || '').trim()
  const shown = store.displaySidForStrip(props.strip)
  if (!shown) return false
  if (unclearedFieldHighlight.value) return true
  if (props.strip.flightRules === 'V' || /^VFR/i.test(raw)) return true
  // Off-exit radar-vector (ARS6E·KOGAV / "ARS 6E veKOGAV") — same orange as SLOW.
  // Same-exit ARS6E·ARS displays as "ARS 6E" and must not amber.
  if (isOffExitVectorSid(raw) || /[A-Z]{2,}\s+\d+[A-Z]+\s+ve[A-Z]{2,}/i.test(shown)) return true
  if (isTrackSidName(raw) || formatTrackSidDisplay(raw)) return true
  // Formatted SLOW display: 120veBABAP / 010·240veNOSLI
  if (/\d{3}(·\d{3})?ve[A-Z]{2,}/i.test(shown)) return true
  return false
})

/**
 * ESSA: black SID box when preferred APP/DEP sector is DEP-E or ARR-E.
 */
const essaEastSidBox = computed(() => needsEssaEastSidBox(props.strip.appDepNextSector))

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
/** Local outbound = DEP layout; local inbound/return = ARR layout (SAS181). */
const isLocalInbound = computed(() => isLocalInboundPresentation(props.strip))
const isDeparture = computed(
  () =>
    props.strip.stripType === 'departure' ||
    (props.strip.stripType === 'local' && !isLocalInbound.value) ||
    paperInfoKind.value === 'empty_dep',
)
const isArrLayout = computed(
  () =>
    props.strip.stripType === 'arrival' ||
    isLocalInbound.value ||
    paperInfoKind.value === 'empty_arr',
)
/** Arrival on ground: hide CFL/AHD cells (cleared to land / taxi-in). */
const hideArrGroundAssignFields = computed(() => {
  if (!isArrLayout.value) return false
  if (props.strip.ata) return true
  if (props.strip.airborne === false) return true
  const gs = (props.strip.groundstate || '').toUpperCase()
  return gs === 'TXIN' || gs === 'PARK' || gs === 'TAXI'
})

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

/**
 * Paper: assigned RWY not in ES selected dep/arr list → blue felt label.
 * DEP/local → above ADEP; ARR → above ADES.
 */
const paperNonStdRwyLabel = computed(() => {
  if (!store.isPaperLook || isPaperEmptyFlightHolder.value) return ''
  if (!rwyNonStandard.value) return ''
  const rwy = (props.strip.runway || '').trim()
  return rwy || ''
})
const paperNonStdRwyAboveAdep = computed(() =>
  !isArrLayout.value && paperNonStdRwyLabel.value ? paperNonStdRwyLabel.value : '',
)
const paperNonStdRwyAboveAdes = computed(() =>
  isArrLayout.value && paperNonStdRwyLabel.value ? paperNonStdRwyLabel.value : '',
)

const rwyCellTitle = computed(() => {
  const base = isArrLayout.value ? 'Arrival runway' : 'Departure runway'
  return rwyNonStandard.value ? `${base} (non-standard)` : base
})

/** B757 / Tu204 family — WTC M on strip, treated as H when leading. */
const heavyAsLeaderType = computed(() =>
  isHeavyAsLeaderAircraftType(props.strip.aircraftType),
)

/**
 * RTC only: thick WTC cell border when wake is not Medium.
 * (M stays plain; B757/Tu204 use yellow instead — see wtcYellowHighlight.)
 */
const wtcRtcBorder = computed(() => {
  if (!store.multiAirport) return false
  const w = props.strip.wakeTurbulence
  return !!w && w !== 'M'
})

/** Paper look: red kulspetspenna circle around non-M WTC (unchanged ESGG cue). */
const wtcPaperCircled = computed(() => {
  if (!store.isPaperLook) return false
  const w = props.strip.wakeTurbulence
  return !!w && w !== 'M'
})

/**
 * SAAB / paper look (all views): yellow WTC cell for B757 & Tu204 family.
 * Letter stays "M"; fill matches non-standard RWY (#fddf5f).
 */
const wtcYellowHighlight = computed(
  () => store.isPaperLook && heavyAsLeaderType.value,
)

/**
 * Thick ATYP frame for slow aircraft — DEP only, not in RTC
 * (RTC suppresses ATYP frames except B757/Tu204 yellow + heavy thick border).
 */
const atypSlowFrame = computed(
  () =>
    !store.multiAirport &&
    !!props.strip.isSlow &&
    !isArrLayout.value &&
    !isLocalOnlyStrip.value,
)

/**
 * Always thick ATYP border for super/heavy types (A388/A124/B748/…).
 * Global wherever the digital ATYP cell exists (SAAB + RTC); not yellow fill.
 */
const atypHeavyThickFrame = computed(() =>
  isThickAtypBorderAircraftType(props.strip.aircraftType),
)

/** Thick ATYP border: slow-DEP frame and/or heavy take-off types. */
const atypThickBorder = computed(() => atypSlowFrame.value || atypHeavyThickFrame.value)

/** RTC only: yellow ATYP for B757 / Tu204 (same heavy-as-leader set). */
const atypYellowHighlight = computed(
  () => store.multiAirport && heavyAsLeaderType.value,
)
/**
 * RTC coordination UI only (`multiAirport` / multiairport.yml).
 * ESSA SAAB and ESGG paper must not get XFL edit / EST / pink pending.
 */
const isRtcCoordUi = computed(() => store.multiAirport)

/** Prefer ACC-proposed XFL while inbound pending; else EuroScope / SID preview. */
const displayXfl = computed(() => {
  if (
    isRtcCoordUi.value &&
    props.strip.exitCoordPending &&
    props.strip.exitCoordAltitude
  ) {
    return (
      formatStripAltitude(props.strip.exitCoordAltitude, DEFAULT_TRANSITION_ALTITUDE_FT) ?? ''
    )
  }
  return store.displayXflForStrip(props.strip)
})
const displayCfl = computed(() => store.displayCflForStrip(props.strip))

/** RTC: pink XFL for outbound REQUESTED_BY_ME or inbound REQUESTED_BY_OTHER. */
const xflCoordPink = computed(
  () =>
    isRtcCoordUi.value &&
    !!(props.strip.exitCoordPending || props.strip.exitCoordOutbound),
)

/**
 * RTC: amber XFL after ACC refused our outbound request.
 * Lower priority than pink; overrides CLR-pending amber even when clearance set.
 */
const xflCoordAmber = computed(
  () =>
    isRtcCoordUi.value &&
    !xflCoordPink.value &&
    !!props.strip.exitCoordRefused,
)

/**
 * RTC DEP/local: pink C on EST for inbound REQUESTED_BY_OTHER.
 * EST is force-shown while pending even when coordination-exempt.
 * ARR uses pink C in the PEL slot instead (see showArrCoordPendingC).
 */
const showEstCoordC = computed(
  () =>
    isRtcCoordUi.value &&
    !isArrLayout.value &&
    !!props.strip.exitCoordPending,
)

/**
 * RTC ARR only: pink C in the PEL grid slot (same cell-xfl area as DEP XFL)
 * for inbound ACC proposal. Accept/Refuse only — no send / XflMenu / DepCoord.
 */
const showArrCoordPendingC = computed(
  () => isRtcCoordUi.value && isArrLayout.value && !!props.strip.exitCoordPending,
)

/** DEP: always show XFL (non-compact). ARR: only the pending pink-C PEL slot on RTC. */
const showXflCell = computed(() => {
  if (isCompactBay.value) return false
  if (isArrLayout.value) return showArrCoordPendingC.value
  return true
})

/** Strip level cell label: XFL (DEP) vs PEL (ARR). */
const levelCellPlaceholder = computed(() => (isArrLayout.value ? 'PEL' : 'XFL'))

const xflCellTitle = computed(() => {
  if (isArrLayout.value) {
    if (showArrCoordPendingC.value) {
      return 'ACC PEL proposal — click to Accept/Reject'
    }
    return 'EuroScope PEL'
  }
  if (!isRtcCoordUi.value) return 'EuroScope XFL'
  if (props.strip.exitCoordPending) {
    return 'ACC XFL proposal — click to Accept/Reject'
  }
  if (props.strip.exitCoordOutbound) {
    return 'Outbound XFL coordination pending'
  }
  if (props.strip.exitCoordRefused) {
    return 'Outbound XFL coordination refused — set Departure Coordination or re-coordinate'
  }
  return 'EuroScope XFL — click to request exit coordination'
})
/**
 * Top-expander CLR chip colors.
 * Green = clearance flag only (never Hoppie-online, never arrow-rea).
 * DCL request/error still surface on the chip for active Hoppie flows.
 */
const clrChipClass = computed(() => {
  const s = props.strip.dclStatus
  if (s === 'REQUEST') return 'dcl-request'
  if (s === 'INVALID' || s === 'UNABLE' || s === 'REJECTED') return 'dcl-err'
  if (s === 'SENT' || s === 'DONE' || s === 'WILCO') return 'exp-clr-ok'
  if (props.strip.clearance) return 'exp-clr-ok'
  return ''
})

/** ESSA: show DCL when Hoppie flow is active or pilot is online on Hoppie. */
const hoppieOnlineForClr = ref(false)
let hoppieOnlineCheckSeq = 0

const showEssaDclLabel = computed(() => {
  if (!store.essaRolesMode) return false
  const s = props.strip.dclStatus
  if (
    s === 'REQUEST' ||
    s === 'SENT' ||
    s === 'DONE' ||
    s === 'WILCO' ||
    s === 'INVALID' ||
    s === 'UNABLE' ||
    s === 'REJECTED'
  ) {
    return true
  }
  return store.dclStatus === 'connected' && hoppieOnlineForClr.value
})

const clrChipLabel = computed(() => (showEssaDclLabel.value ? 'DCL' : 'CLR'))

async function refreshHoppieOnlineForClr() {
  const seq = ++hoppieOnlineCheckSeq
  if (!store.essaRolesMode || store.dclStatus !== 'connected') {
    hoppieOnlineForClr.value = false
    return
  }
  const status = props.strip.dclStatus
  if (status === 'REQUEST' || status === 'SENT' || status === 'DONE' || status === 'WILCO') {
    // Label already DCL from status — skip network check
    return
  }
  try {
    const res = await fetch(`/api/hoppie/online/${encodeURIComponent(props.strip.callsign)}`)
    if (!res.ok || seq !== hoppieOnlineCheckSeq) return
    const data = (await res.json()) as { online?: boolean }
    if (seq !== hoppieOnlineCheckSeq) return
    hoppieOnlineForClr.value = !!data.online
  } catch {
    if (seq === hoppieOnlineCheckSeq) hoppieOnlineForClr.value = false
  }
}

watch(
  () =>
    [
      topExpanded.value,
      store.essaRolesMode,
      store.dclStatus,
      props.strip.callsign,
      props.strip.dclStatus,
    ] as const,
  ([expanded]) => {
    if (!store.essaRolesMode) {
      hoppieOnlineForClr.value = false
      return
    }
    // Top-expander CLR chip only. The big CLNC key stays ACK CLR / CLR.
    if (expanded) void refreshHoppieOnlineForClr()
    else hoppieOnlineForClr.value = false
  },
)

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

/** Current ATIS letter for stamp (prefer DEP, then single, then ARR) */
/** ESGG paper: single ATIS only (no ARR/DEP fallback) */
const currentAtisLetter = computed(() => {
  const apt = qnhAirport.value
  if (!apt) return undefined
  const info = store.atisInfo.find((a) => a.airport === apt)
  if (!info) return undefined
  const letter = (info.atis || '').trim().toUpperCase()
  return letter || undefined
})

/** Amber only when acknowledged value differs from current (changed since last click). */
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

/**
 * ATIS amber when the stamped letter/QNH pair no longer matches current
 * (changed since last ATIS click). Not amber for QNH-only stamps.
 */
const atisStale = computed(() => {
  const given = (props.strip.atisGiven || '').trim().toUpperCase()
  if (!given) return false
  const cur = currentAtisLetter.value
  const letterChanged = !!cur && given !== cur
  return letterChanged || qnhStale.value
})

/** Green ATIS: both letter and QNH still match what was acknowledged. */
const atisGivenMatches = computed(() => {
  const letter = (props.strip.atisGiven || '').trim().toUpperCase()
  const curLetter = currentAtisLetter.value
  return !!letter && !!curLetter && letter === curLetter && qnhGivenMatches.value
})

const canSetQnh = computed(() =>
  canEditAssignedData.value && currentQnh.value != null
)

/** Paper col 6 bottom: ATIS letter + last QNH digit (1036 → A6). No change highlight. */
const paperAtisQnhStamp = computed(() => {
  const qnh = props.strip.qnhGiven
  if (qnh == null || !Number.isFinite(qnh)) return ''
  const digit = String(Math.abs(Math.round(qnh)) % 10)
  const letter = (props.strip.atisGiven || '').trim().toUpperCase()
  return letter ? `${letter}${digit}` : digit
})

const canStampAtisQnh = computed(
  () =>
    canEditAssignedData.value &&
    currentQnh.value != null &&
    !!currentAtisLetter.value,
)

const atisChipTitle = computed(() => {
  if (atisStale.value) {
    return `ATIS changed (${props.strip.atisGiven} → ${currentAtisLetter.value}) — click to acknowledge`
  }
  if (atisGivenMatches.value) return `ATIS ${currentAtisLetter.value} given — click to clear`
  return `ATIS ${currentAtisLetter.value || ''}`
})

const qnhChipTitle = computed(() => {
  if (qnhStale.value) {
    return `QNH changed (${props.strip.qnhGiven} → ${currentQnh.value}) — click to acknowledge`
  }
  if (qnhGivenMatches.value) return `QNH ${currentQnh.value} given — click to clear`
  return currentQnh.value != null ? `QNH ${currentQnh.value}` : 'QNH'
})

function onPaperAtisQnhClick() {
  if (isArrLayout.value || isPaperEmptyFlightHolder.value) return
  if (!canUsePaperClickspots.value || !canEditAssignedData.value) return
  const curQnh = currentQnh.value
  const curAtis = currentAtisLetter.value
  // Green (both match) → white (clear)
  if (
    props.strip.qnhGiven != null &&
    curQnh != null &&
    props.strip.qnhGiven === curQnh &&
    (props.strip.atisGiven || '').trim().toUpperCase() === (curAtis || '')
  ) {
    store.setQnhGiven(props.strip.id, null)
    return
  }
  // Amber or white → green (acknowledge current)
  if (curQnh == null || !curAtis) return
  store.setQnhGiven(props.strip.id, curQnh, curAtis)
}

/** Top ▲: QNH/ATIS stale (orange) overrides REA (green) */
const topArrowClass = computed(() => {
  if (qnhStale.value || atisStale.value) return { 'arrow-stale': true }
  if (isRea.value) return { 'arrow-rea': true }
  return {}
})

const topArrowTitle = computed(() => {
  if (qnhStale.value) {
    return `QNH changed (${props.strip.qnhGiven} → ${currentQnh.value}) - open menu & press QNH`
  }
  if (atisStale.value) {
    return `ATIS changed (${props.strip.atisGiven} → ${currentAtisLetter.value}) - open menu & press ATIS`
  }
  if (isRea.value) return 'REA set'
  return topExpanded.value ? 'Close top menu' : 'Top menu'
})

function onFrulClick() {
  if (topExpanded.value || bottomExpanded.value) {
    topExpanded.value = false
    bottomExpanded.value = false
  } else {
    topExpanded.value = true
    bottomExpanded.value = true
  }
  adoptManualStripFitBaseline(props.strip.id)
}

const callsignBoxTitle = computed(() => {
  const rtf = props.strip.rtfCallsign
  const mode = props.isLargeView
    ? 'Close zoomed strip (right-click for menu)'
    : 'Zoom strip (right-click for menu)'
  return rtf ? `${rtf} - ${mode}` : mode
})

/**
 * QNH key: green → white (clear); amber/white → green (ack current).
 * Amber only when qnhGiven differs from current QNH.
 */
function onExpQnh() {
  if (!canEditAssignedData.value) return
  if (qnhGivenMatches.value) {
    store.setQnhGiven(props.strip.id, null)
    return
  }
  if (currentQnh.value == null) return
  store.setQnhGiven(props.strip.id, currentQnh.value)
}

/**
 * ATIS key: green → white; amber/white → green (stamp letter + QNH).
 * Amber when ATIS letter (or QNH) changed since last ack.
 */
function onExpAtis() {
  if (!canEditAssignedData.value) return
  if (atisGivenMatches.value) {
    store.setQnhGiven(props.strip.id, null)
    return
  }
  if (currentQnh.value == null || !currentAtisLetter.value) return
  store.setQnhGiven(props.strip.id, currentQnh.value, currentAtisLetter.value)
}

/** RTC: TopSky WEATHER manual alert (ARR + DEP); UI green via weatherGiven */
function onExpMet() {
  if (!canEditAssignedData.value) return
  store.sendStripAction(props.strip.id, 'WEATHER')
}

/** SLOW chip highlight = remarks flag only (slow ATYP is framed separately on DEP). */
const hasSlowFlag = computed(() => hasSlowRemark(props.strip.remarks))

async function onExpSlow() {
  if (!canEditAssignedData.value) return
  // V / Z: no SLOW SID rules / auto flag
  if (!isIfrSidEligible(props.strip.flightRules)) return
  // Toggle remarks token
  const enable = !hasSlowRemark(props.strip.remarks)
  if (enable) {
    // Recompute preferred track SID even if letter SID/rwy already in FPL
    await store.preferSidForStrip(props.strip.id, true, { ignoreForcedRoute: true })
    // Assign track SID first — AmendFlightPlan often clears scratch, so set SLOW after
    store.updateRemarks(props.strip.id, withSlowRemark(props.strip.remarks, true))
  } else {
    store.updateRemarks(props.strip.id, withSlowRemark(props.strip.remarks, false))
    // Drop track SID and switch preferred to letter-group (non-slow) selection
    store.clearTrackSidForStrip(props.strip.id)
    await store.preferSidForStrip(props.strip.id, false, { ignoreForcedRoute: true })
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
const hasVectRemarkFlag = computed(() => hasVectRemark(props.strip.remarks))

function onExpVect() {
  if (!canEditAssignedData.value) return
  store.updateRemarks(props.strip.id, withVectRemark(props.strip.remarks, !hasVectRemarkFlag.value))
}
const effectiveActionCount = computed(() => displayActions.value.length)

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

function clearScribblesInCell(sel: string): boolean {
  const root = stripElement.value
  if (!root || store.isPaperLook) return false
  const el = root.querySelector(sel) as HTMLElement | null
  if (!el) return false
  const rect = elementToScribbleRect(el, root)
  if (!rect) return false
  const n = removeScribblesOverlappingRect(props.strip.id, rect, 0.25)
  if (n > 0) {
    store.syncStripScribbles(props.strip.id)
    return true
  }
  return false
}

/** APP/DEP (not remote-tower _R_APP / _R_CTR) — same idea as backend isAppOrDepCallsign. */
function isAppOrDepCallsign(callsign?: string | null): boolean {
  const cs = (callsign || '').trim().toUpperCase()
  if (!cs) return false
  if (cs.endsWith('_DEP')) return true
  if (cs.endsWith('_R_APP') || cs.endsWith('_R_CTR')) return false
  if (cs.endsWith('_APP')) return true
  return false
}

/** Clear scribbled HS/HP (text fields are cleared on airborne / APP/DEP transfer). */
function clearHsHpScribbles() {
  if (store.isPaperLook) return
  const clearedHs = clearScribblesInCell('.cell-hs')
  const clearedHp = clearScribblesInCell('.cell-hp')
  if (clearedHs || clearedHp) {
    // sync already done per cell; no-op if both empty
  }
}

// Text HS/HP clear on airborne / APP/DEP XFER — clear matching scribbles too
watch(
  () =>
    ({
      airborne: !!props.strip.airborne,
      pending: props.strip.transferPending,
      target: props.strip.transferCallsign,
    }) as const,
  (cur, prev) => {
    if (store.isPaperLook) return
    const becameAirborne = cur.airborne && !prev?.airborne
    const xferToAppDep =
      cur.pending === 'out' &&
      isAppOrDepCallsign(cur.target) &&
      (prev?.pending !== 'out' || !isAppOrDepCallsign(prev?.target))
    if (becameAirborne || xferToAppDep) {
      nextTick(() => clearHsHpScribbles())
    }
  },
)

function onHsClick() {
  if (clearScribblesInCell('.cell-hs')) return
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
  if (clearScribblesInCell('.cell-hp')) return
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

/**
 * RTC DEP/local EST cell only (not ARR — inbound ARR uses pink C on PEL).
 * Ground IFR when ADEP needs ACC coordination, or inbound pending.
 * Never ESSA (not multiAirport) or paper look.
 */
const showCooCell = computed(() => {
  if (!isRtcCoordUi.value) return false
  if (isCompactBay.value || isArrLayout.value) return false
  if (props.strip.airborne) return false
  if (!isIfrSidEligible(props.strip.flightRules)) return false
  const t = props.strip.stripType
  if (t !== 'departure' && t !== 'local') return false
  // Inbound ACC proposal: always show EST so pink C / Accept-Reject has a home
  // (even when ADEP/exit is coordination-exempt, e.g. some ESNU TMA exits).
  if (props.strip.exitCoordPending) return true
  return requiresAccCoordination(props.strip.adep, tmaExitPoint.value)
})

/** ESSB/ESMS invert EST gestures: short → DEP COORD, long → toggle EST. */
function isEssbEsmsAdep(): boolean {
  const adep = (props.strip.adep || '').toUpperCase()
  return adep === 'ESSB' || adep === 'ESMS'
}

/**
 * Open DEP COORD. If the strip is not assumed by me and we can assume,
 * send ASSUME first (same path as the ASSUME button), then open.
 * If owned by another controller and we cannot assume, do not open.
 */
function openDepCoordDialog() {
  let assumedBeforeOpen = false
  if (canAssumeFromMenu.value) {
    store.sendStripAction(props.strip.id, 'ASSUME')
    assumedBeforeOpen = true
  } else if (store.isStripOwnedByOther(props.strip)) {
    return
  }
  depCoordAssumedBeforeOpen.value = assumedBeforeOpen
  depCoordDialogOpen.value = true
}

const cooCellTitle = computed(() => {
  if (props.strip.exitCoordPending) {
    if (isEssbEsmsAdep()) {
      return 'ACC coordination proposal — click to Accept/Reject · hold: Departure Coordination · right-click: Departure Coordination'
    }
    return 'ACC coordination proposal — click to Accept/Reject · hold/right-click: Departure Coordination'
  }
  if (isEssbEsmsAdep()) {
    return 'Left-click: XFL coordination to ACC · Hold: Departure Coordination · Right-click: Departure Coordination'
  }
  return 'Left-click: Departure Coordination · Hold/right-click: XFL coordination to ACC'
})

/**
 * ~600ms hold on EST.
 * Default airports: DEP COORD (same as right-click); suppress following click toggle.
 * ESSB/ESMS: toggle EST instead; suppress following click DEP COORD.
 */
const EST_LONG_HOLD_MS = 600
let estLongPressTimer: number | null = null
let estLongHeld = false

function clearEstLongPress() {
  if (estLongPressTimer != null) {
    clearTimeout(estLongPressTimer)
    estLongPressTimer = null
  }
}

function onCooPointerDown(e: PointerEvent) {
  if (e.button != null && e.button !== 0) return
  if (!canEditAssignedData.value || !showCooCell.value) return
  estLongHeld = false
  clearEstLongPress()
  estLongPressTimer = window.setTimeout(() => {
    estLongPressTimer = null
    estLongHeld = true
    if (isEssbEsmsAdep()) {
      store.setCoo(props.strip.id, !props.strip.coo)
    } else {
      openDepCoordDialog()
    }
  }, EST_LONG_HOLD_MS)
}

function onCooPointerUp() {
  clearEstLongPress()
}

function onCooPointerCancel() {
  clearEstLongPress()
  estLongHeld = false
}

function onCooClick() {
  if (estLongHeld) {
    estLongHeld = false
    return
  }
  if (!showCooCell.value) return
  // Inbound ACC proposal Accept/Reject — all airports (incl. ESSB/ESMS)
  if (props.strip.exitCoordPending) {
    if (!store.isController) return
    coordProposalDialogOpen.value = true
    return
  }
  if (!canEditAssignedData.value) return
  if (isEssbEsmsAdep()) {
    openDepCoordDialog()
    return
  }
  store.setCoo(props.strip.id, !props.strip.coo)
}

/** Right-click EST → DEP COORD (all airports, incl. ESSB/ESMS). */
function onCooContextMenu() {
  if (!canEditAssignedData.value || !showCooCell.value) return
  clearEstLongPress()
  estLongHeld = false
  openDepCoordDialog()
}

onUnmounted(() => {
  clearEstLongPress()
  estLongHeld = false
})

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

function onVehicleTerm() {
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

/** Newly created notes / vehicles open zoomed view once the bay strip mounts. */
function tryOpenPendingNoteScribble() {
  if ((!isNote.value && !isVehicle.value) || props.isLargeView) return
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
  isDeparture.value
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
 * ESSA DEP exception: TTOT stays visible from PUSH&START through taxi/runway.
 * Arrivals keep ETA on taxi_arr / inbound.
 */
const showPrimaryTime = computed(() => {
  if (!sectionIdMatches(props.strip.sectionId, TAXI_ONWARD_SECTIONS)) return true
  // ESSA: top window switches to TTOT at PUSH&START — keep showing in taxi+
  if (isEssaDep.value && isPushStartOrLater.value && !props.strip.clearedForTakeoff) {
    return true
  }
  // Outbound dep/local: no EOBT from taxi onward (CTOT shown separately)
  if (isDeparture.value) {
    return false
  }
  // Arrivals / inbound local: keep ETA unless CTOT somehow applies
  return !(showCtot.value)
})

/**
 * Parse vIFF/CDM network status for strip UI.
 * Shown: REA (badge above CTOT/TOBT); FLS / SRM / SLC replace the TSAT slot
 * (below ATYP) — FLS alternates with subtype reason. COMPLY/AIRB/DES/SAM ignored.
 */
function parseCdmSts(sts: string | undefined): {
  kind: 'rea' | 'fls' | 'srm' | 'slc'
  raw: string
  flsType?: string
  badge: string
} | null {
  if (!sts) return null
  const raw = sts.trim().toUpperCase()
  if (!raw) return null
  if (raw === 'REA') return { kind: 'rea', raw, badge: 'REA' }
  if (raw === 'SRM') return { kind: 'srm', raw, badge: 'SRM' }
  if (raw === 'SLC' || raw === 'SCL') return { kind: 'slc', raw, badge: 'SLC' }

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
function flsTooltip(_raw: string, flsType?: string): string {
  const subtypeHelp: Record<string, string> = {
    NRA: 'Flight Suspended - Not Reported As Airborne.',
    CDM: 'Flight Suspended - Triggered by CDM.',
    MR: 'Flight Suspended - Mandatory Route.',
    GS: 'Flight Suspended - Ground Stop.',
    P: 'Flight Suspended - Prohibit.',
  }
  if (flsType) {
    return subtypeHelp[flsType] || `Flight Suspended - ${flsType}.`
  }
  return 'Flight Suspended.'
}

const cdmStatus = computed(() =>
  isDepartingIfr.value ? parseCdmSts(props.strip.cdmSts) : null
)

const isFls = computed(() => cdmStatus.value?.kind === 'fls')
const isSrm = computed(() => cdmStatus.value?.kind === 'srm')
const isSlcSts = computed(() => cdmStatus.value?.kind === 'slc')
const isRea = computed(() => cdmStatus.value?.kind === 'rea')
/** FLS replaces TSAT while TOBT (TB) is still primary */
const flsReplacesTsat = computed(
  () => showCdm.value && !isPushStartOrLater.value && isFls.value,
)
/**
 * SRM / SLC replace the below-ATYP slot only after TB → TT
 * (PUSH&START onward, until CFTO).
 */
const srmSlcInSecondary = computed(
  () =>
    isEssaDep.value &&
    isDepartingIfr.value &&
    isPushStartOrLater.value &&
    !props.strip.clearedForTakeoff &&
    (isSrm.value || isSlcSts.value),
)

/**
 * Paper col 6 top: scribbled "Rea" only when vIFF REA is set (same as ESSA CDM path).
 * Display-only — no clickspot. Not tied to DE-ICE / READY / GS menu.
 */
const paperShowRea = computed(() => !isArrLayout.value && isRea.value)

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

/** Set REA anytime on CDM deps — not gated on CTOT presence or TOBT≠EOBT. */
const canSendRea = computed(() =>
  canEditAssignedData.value && showCdm.value && !isFls.value && !isRea.value
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
type SecondaryTimeKind = 'tsat' | 'ctot' | 'scl' | 'assr' | 'fls' | 'srm' | 'slc' | 'none'

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
  if (isDeparture.value) {
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

/** Short label: TB / TT / EB / ETA (FLS/SRM/SLC use the TSAT slot below ATYP) */
const primaryTimeLabel = computed(() => {
  switch (primaryTimeKind.value) {
    case 'tobt': return 'TB'
    case 'ttot': return 'TT'
    case 'eobt': return 'EB'
    case 'eta': return '' // ARR: time only, no "ETA" prefix
    default: return ''
  }
})

/** CTOT / SCL inside dep arrow (hidden when ATD set or CTO filled) */
const depArrowCtot = computed(() => {
  if (isArrLayout.value || props.strip.atd || !showCtot.value || props.strip.clearedForTakeoff) return ''
  if (showCtotCancelled.value) return 'SCL'
  return formatHhmmColon(props.strip.ctot)
})

/**
 * Bottom time window (below ATYP):
 * - ESSA IFR DEP + TB: FLS (alt. reason) replaces TSAT; else TSAT
 * - ESSA IFR DEP + TT (PUSH&START+): SRM / SLC only (never ASSR)
 * - Compact DEP: CTOT/SCL in that slot when present
 * - ARR / other airports: ASSR (squawk)
 * CTOT regulation reason (mostPenalisingRegulation) is menu-only — not shown here.
 */
const secondaryTimeKind = computed((): SecondaryTimeKind => {
  if (isArrLayout.value) return 'assr'
  if (isEssaDep.value && !isPushStartOrLater.value) {
    if (flsReplacesTsat.value) return 'fls'
    return 'tsat'
  }
  if (srmSlcInSecondary.value) {
    if (isSrm.value) return 'srm'
    if (isSlcSts.value) return 'slc'
  }
  // Compact: CTOT/SCL in ASSR slot (triangle only for CFTO/ATD green)
  if (isCompactBay.value && depArrowCtot.value) {
    return depArrowCtot.value === 'SCL' ? 'scl' : 'ctot'
  }
  // ESSA IFR DEP: no squawk in the below-ATYP box (ASSR stays in expander / face)
  if (isDepartingIfr.value && CDM_AIRPORTS.has(props.strip.adep)) {
    return 'none'
  }
  return 'assr'
})

/** Time shown in triangle: ATD (dep) / ATA (arr) / else CTOT on dep — hidden in compact */
const triangleTimeText = computed(() => {
  if (isCompactBay.value) return '' // ATA/ATD indicated by outline only
  if (isArrLayout.value) {
    return props.strip.ata ? formatHhmmColon(props.strip.ata) : ''
  }
  if (props.strip.atd) return formatHhmmColon(props.strip.atd)
  return depArrowCtot.value
})

/** Compact DEP: green takeoff △ in STD slot when CFTO or ATD (not CTOT-only). */
const compactShowDepTriangle = computed(
  () =>
    isCompactBay.value &&
    !isArrLayout.value &&
    (!!props.strip.clearedForTakeoff || !!props.strip.atd),
)

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

/** Compact ARR missed approach (G/A): CFL in STD slot + AHD; no landing △. */
const compactArrGoAround = computed(
  () => isCompactBay.value && isArrLayout.value && !!props.strip.missedApproach,
)

function onDepArrowCtotClick(event: MouseEvent) {
  if (props.strip.atd || !depArrowCtot.value) return
  onCtotClick(event)
}

/** FLS in TSAT slot: alternate "FLS" ↔ subtype reason (2s), CDM-only */
const flsTsatDisplay = computed(() => {
  const type = cdmStatus.value?.flsType
  if (!type) return 'FLS'
  const phase = Math.floor(nowUtcMs.value / 2000) % 2
  return phase === 0 ? 'FLS' : type
})

const secondaryTimeValue = computed(() => {
  switch (secondaryTimeKind.value) {
    case 'tsat':
      return formatHhmmColon(props.strip.tsat)
    case 'ctot':
      return formatHhmmColon(props.strip.ctot)
    case 'scl':
      return 'SCL'
    case 'fls':
      return flsTsatDisplay.value
    case 'srm':
      return 'SRM'
    case 'slc':
      return 'SLC'
    case 'assr':
      return displayAssr.value
    default:
      return ''
  }
})

const secondaryTimeLabel = computed(() => {
  switch (secondaryTimeKind.value) {
    case 'tsat': return secondaryTimeValue.value ? 'TS' : ''
    case 'ctot': return 'CT' // compact: CT 20:55 (same short style as TS/TB)
    case 'scl': return 'CT'
    case 'fls':
    case 'srm':
    case 'slc':
      return '' // status fills the value alone (replaces TSAT)
    case 'assr': return '' // squawk only, no "ASSR" prefix
    default: return ''
  }
})

const secondaryTimeTitle = computed(() => {
  if (secondaryTimeKind.value === 'tsat') {
    const tsat = displayTsat.value
    return tsat ? `TSAT ${tsat}` : 'TSAT'
  }
  if (secondaryTimeKind.value === 'fls') {
    return flsTooltip(cdmStatus.value?.raw || 'FLS', cdmStatus.value?.flsType)
  }
  if (secondaryTimeKind.value === 'srm') {
    return 'SRM — Slot Revision Message (CTOT revised)'
  }
  if (secondaryTimeKind.value === 'slc') {
    return 'SLC — Slot Cancellation Message. (CTOT not applicable anymore)'
  }
  if (secondaryTimeKind.value === 'assr') return assrTitle.value
  if (secondaryTimeKind.value === 'ctot' || secondaryTimeKind.value === 'scl') return ctocTooltip.value
  return undefined
})

const ssrCoordActive = computed(() => store.isSsrCoordinationActive(props.strip))
const displayAssr = computed(() => store.displayAssrForStrip(props.strip))
/**
 * RTC face squawk when the bottom slot is TSAT/CTOT (ESSA CDM) and this airport
 * is not in verbal-ACC manual SSR. Otherwise the assigned ES code has nowhere to show.
 */
const faceAssr = computed(() => {
  if (!store.multiAirport) return ''
  if (secondaryTimeKind.value === 'assr') return ''
  if (ssrCoordActive.value) return ''
  return displayAssr.value
})

/** RTC: ASSR lives in the main strip only — never duplicate in bottom expander */
const showBottomExpAssr = computed(() => !store.multiAirport)

const assrEditing = ref(false)
const assrEditText = ref('')
const assrEditInput = ref<HTMLInputElement | null>(null)

const assrTitle = computed(() => {
  if (ssrCoordActive.value) {
    const shown = displayAssr.value
    return shown
      ? `ASSR ${shown} (manual) - double-click for TopSky / ES`
      : 'ASSR - click to enter (manual) · double-click TopSky'
  }
  if (!props.strip.canResetSquawk) {
    return props.strip.squawk ? `ASSR ${props.strip.squawk}` : 'ASSR'
  }
  if (!props.strip.squawk) return 'ASSR - click for new code'
  return `ASSR ${props.strip.squawk} - double-click for new code`
})

/** Paper FPS: short ASSR tooltip only */
const paperAssrTitle = computed(() => (store.isPaperLook ? 'ASSR' : assrTitle.value))

function startAssrManualEdit() {
  assrEditText.value = displayAssr.value || ''
  assrEditing.value = true
  nextTick(() => {
    assrEditInput.value?.focus()
    assrEditInput.value?.select()
  })
}

function onAssrEditBlur() {
  if (!assrEditing.value) return
  const digits = assrEditText.value.replace(/\D/g, '').slice(0, 4)
  assrEditing.value = false
  // Local/manual only — never assignSquawk / resetSquawk
  store.setManualSsr(props.strip.id, digits)
}

function onAssrEditCancel() {
  assrEditing.value = false
}

function onAssrClick() {
  if (ssrCoordActive.value) {
    startAssrManualEdit()
    return
  }
  if (!props.strip.canResetSquawk) return
  if (!props.strip.squawk) onResetSquawk()
}

function onAssrDblClick() {
  if (ssrCoordActive.value) {
    assrEditing.value = false
    store.overrideSsrCoordination(props.strip.id)
    if (!props.strip.squawk && props.strip.canResetSquawk) onResetSquawk()
    return
  }
  if (!props.strip.canResetSquawk) return
  if (props.strip.squawk) onResetSquawk()
}

function onSecondaryTimeClick(event: MouseEvent) {
  switch (secondaryTimeKind.value) {
    case 'assr':
      onAssrClick()
      break
    case 'tsat':
      // TSAT text is display-only — TSAC set/options are on the TSAC box only
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

const canEditPrimaryTime = computed(
  () =>
    canEditAssignedData.value &&
    (primaryTimeKind.value === 'tobt' ||
      (primaryTimeKind.value === 'eobt' && !store.isPaperLook)),
)

/** ESSA CDM TOBT entry / Ready TOBT click menu (incl. FLS / suspended) */
const canOpenReadyTobt = computed(
  () =>
    canEditAssignedData.value &&
    showCdm.value &&
    primaryTimeKind.value === 'tobt',
)

/** Send CDM flow PM (same eligibility as Ready TOBT) */
const canSendCdmPm = computed(
  () =>
    canEditAssignedData.value &&
    showCdm.value &&
    !isLocalOnlyStrip.value &&
    !isPaperEmptyFlightHolder.value,
)

const cdmPmMenuLabel = computed(() =>
  props.strip.cdmInformed ? 'Resend CDM PM ✓' : 'Send CDM PM',
)
const cdmPmMenuTitle = computed(() =>
  props.strip.cdmInformed
    ? 'vIFF CDM PM already sent — click to resend (needs ES window focus)'
    : 'EuroScope .msg CDM flow PM (needs ES window focus)',
)

/**
 * Red S in TOBT setBy slot (top expander open only — see template v-else-if).
 * Hidden when: informed; TOBT not shown; ATC/Ready TOBT (setBy A); pilot setBy P (green P wins).
 */
const showCdmPmPending = computed(
  () =>
    showCdm.value &&
    showPrimaryTime.value &&
    primaryTimeKind.value === 'tobt' &&
    !props.strip.cdmInformed &&
    props.strip.tobtSetBy !== 'A' &&
    props.strip.tobtSetBy !== 'P',
)

/** SAAB only — EOBT click menu (Set / Ready EOBT); not paper */
const canOpenEobtMenu = computed(
  () =>
    canEditAssignedData.value &&
    !store.isPaperLook &&
    !isLocalOnlyStrip.value &&
    primaryTimeKind.value === 'eobt' &&
    showPrimaryTime.value,
)

const tobtMenuOpen = ref(false)
const timeMenuKind = ref<TobtMenuKind>('tobt')

function openTobtMenu(event?: MouseEvent) {
  menuOpen.value = false
  if (!canOpenReadyTobt.value) return
  if (event) menuPosition.value = [event.clientX, event.clientY]
  timeMenuKind.value = 'tobt'
  tobtMenuOpen.value = true
}

function openTobtMenuFromContext() {
  openTobtMenu()
}

function onSendCdmPmClick() {
  menuOpen.value = false
  ctotMenuOpen.value = false
  if (!canSendCdmPm.value) return
  store.sendStripAction(props.strip.id, 'CDM_PM')
}

function openEobtMenu(event?: MouseEvent) {
  menuOpen.value = false
  if (!canOpenEobtMenu.value) return
  if (event) menuPosition.value = [event.clientX, event.clientY]
  timeMenuKind.value = 'eobt'
  tobtMenuOpen.value = true
}

function openEobtMenuFromContext() {
  openEobtMenu()
}

const showTobtSetBy = computed(() => {
  // P/A is "TOBT by" — only while TB is primary; hide after TB→TT (PUSH&START+)
  if (!showCdm.value || isFls.value || primaryTimeKind.value !== 'tobt') return false
  if (props.strip.tobtSetBy === 'P') return true
  if (props.strip.tobtSetBy === 'A') return store.showTobtSetByA
  return false
})

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
    displayXfl.value,
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

/**
 * Auto-fit toggles compact via setStripSizeMode (no menu handler) — bay width
 * is unchanged so ResizeObserver won't fire. Refit .fit-font (SID etc.) after
 * the compact grid lays out. Manual Size menu already calls scheduleStripScale.
 */
watch(isCompactBay, () => {
  nextTick(() => scheduleStripScale(true))
})

/** Zoom Size % → panel width / --zoom-strip-scale (RO disabled in large view) */
watch(zoomStripScalePercent, () => {
  if (!props.isLargeView) return
  nextTick(() => scheduleStripScale(true))
})

/** Collapse expanders when transfer is initiated or peer assumes. */
watch(
  () => [props.strip.transferPending, props.strip.ownedByOther] as const,
  ([pending, ownedByOther], prev) => {
    const [prevPending, prevOwned] = prev ?? [undefined, undefined]
    if (
      (pending === 'out' && prevPending !== 'out') ||
      (ownedByOther && !prevOwned)
    ) {
      collapseStripExpanders(props.strip.id)
    }
  },
)

/**
 * Backup when the same FlightStrip instance stays mounted (e.g. zoom overlay).
 * Cross-section moves remount the bay strip — store handleStripMessage /
 * moveStrip* call collapseExpandersOnLeaveCdAllOrTsat for those.
 */
watch(
  () => props.strip.sectionId,
  (sectionId, prevSectionId) => {
    collapseExpandersOnLeaveCdAllOrTsat(props.strip.id, prevSectionId, sectionId)
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
  // Don't clearHtml5DragImage here — drop unmounts the source before dragend;
  // removing the drag image early makes Edge show a blank strip ghost again.
  // Only the destination instance that started the clone should clear — never the origin
  // unmount (that would unhide the destination mid-flight).
  if (autoMoveCloneOwned) {
    autoMoveCloneEl?.remove()
    finishAutoMove()
  }
  if (printAnimOwned) {
    finishPrintAnim()
  }
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

/** Same as orange-filled TSAC box: set, and outside ±5 min of live TSAT */
const tsacStale = computed(() => {
  const tsac = normalizeHhmmDisplay(props.strip.tsac)
  if (!tsac) return false
  return !isTsacGreen.value
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

/**
 * TSAC confirmation box: only with bottom expander open + CD ALL / TSAT.
 * Never on compact half-height strips (expanders hidden; left column is gutter+times).
 * Show when TSAT is known (editable) or TSAC is already set (even if TSAT briefly missing).
 */
const showTsacBox = computed(
  () =>
    !isCompactBay.value &&
    bottomExpanded.value &&
    showTsacCtoc.value &&
    showCdm.value &&
    secondaryTimeKind.value === 'tsat' &&
    (!!displayTsat.value || !!normalizeHhmmDisplay(props.strip.tsac)),
)

/** Orange ▼ only while collapsed, and only when the TSAC box would be orange-filled */
const showTsacStaleArrow = computed(
  () =>
    !bottomExpanded.value &&
    showTsacCtoc.value &&
    showCdm.value &&
    secondaryTimeKind.value === 'tsat' &&
    tsacStale.value,
)

/** empty border | green fill (±5) | orange fill (mismatch) */
const tsacBoxClass = computed(() => {
  const tsac = normalizeHhmmDisplay(props.strip.tsac)
  if (!tsac) return { 'tsac-empty': true }
  const delta = hhmmAbsDeltaMinutes(displayTsat.value, tsac)
  if (delta != null && delta <= 5) return { 'tsac-match': true }
  return { 'tsac-mismatch': true }
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
  if (tsac && tsat && tsac === tsat) return `TSAC ${tsac} - click for options`
  if (tsacStale.value) return `TSAC ${tsac} - TSAT now ${tsat}; click to update`
  if (canEditTsac.value) return 'Click to set TSAC (communicated TSAT)'
  return 'TSAC'
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
  tsacDialogInitial.value =
    normalizeHhmmDisplay(props.strip.tsac) || displayTsat.value || ''
  tsacDialogOpen.value = true
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
 * TSAT colours (UTC / Zulu) for the ±5 min startup window (inclusive):
 * - green: TSAT-5:00 … TSAT+5:00
 * - yellow (flash if enabled): last full minute of the window — TSAT+5:00 … TSAT+6:00
 * - red (no strikethrough): after window — TSAT+6:00 …
 * - no colour before TSAT-5
 *
 * Example TSAT 1220 → green through 1224z, yellow all of 1225z, red from 1226z.
 * Example TSAT 1146 → green through 1150z, yellow all of 1151z, red from 1152z.
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

  // Past inclusive ±5 window: expired TSAT (red)
  if (deltaSec >= 6 * 60) return { 'tsat-expired': true }
  // Last full minute of ±5 window (e.g. TSAT 1220 → yellow all of 1225z)
  if (deltaSec >= 5 * 60 && deltaSec < 6 * 60) {
    return store.flashTsatWindow ? { 'tsat-flash': true } : { 'tsat-warning': true }
  }
  // Inside TSAT±5 (before last minute): green
  if (deltaSec >= -5 * 60 && deltaSec < 5 * 60) return { 'tsat-window': true }

  return {}
})

function onPrimaryTimeClick(event?: MouseEvent) {
  if (!canEditPrimaryTime.value) return
  if (primaryTimeKind.value === 'tobt') {
    openTobtMenu(event)
    return
  }
  if (primaryTimeKind.value === 'eobt') {
    openEobtMenu(event)
  }
}

/** Quick Ready TOBT = now (kept for programmatic callers). */
function onReadyTobtClick() {
  if (!canOpenReadyTobt.value) return
  store.viffReadyTobt(props.strip.id)
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

/**
 * Instant / On assume: label CLNC as ACK CLR (voice-ack sets clearance flag).
 * Manual: open CLR dialog as usual.
 * Hoppie / dclStatus never renames this key (top expander chip still shows DCL).
 */
const showAckClrLabel = computed(
  () => store.autoLopSsr === 'instant' || store.autoLopSsr === 'assume',
)

/** Strip label for action codes (internal codes unchanged for rules/handlers). */
function actionLabel(action: string): string {
  // Compact + two keys: shorten ASSUME / LINE UP; single key keeps full text
  const compactPair = isCompactBay.value && effectiveActionCount.value > 1
  switch (action) {
    case 'CLNC':
      return showAckClrLabel.value ? 'ACK CLR' : 'CLR'
    case 'TXO':
      if (rtoChoiceOpen.value) return compactPair ? 'OUT' : 'TAXI OUT'
      return 'TAXI'
    case 'TXI':
      if (rtoChoiceOpen.value) return compactPair ? 'IN' : 'TAXI IN'
      return 'TAXI'
    case 'TAXI': return 'TAXI'
    case 'LU': return compactPair ? 'L/U' : 'LINE UP'
    case 'ASSUME': return compactPair ? 'ASSU' : 'ASSUME'
    case 'CONTACTME': return compactPair ? 'C ME' : 'C ME'
    case 'CTO': return 'CFTO'
    case 'RTO': return 'RTO'
    case 'XFER': return 'TRANS'
    case 'PARK': return 'TERM'
    case 'GOA': return 'G/A'
    case 'STUP':
      // ESSA: two lines in the 48px action key (see .action-start-up)
      return store.essaRolesMode ? 'START\nUP' : 'S/U'
    case 'PUSH': return 'PUSH'
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

  // DCL status coloring for CLNC button (green while SENT or DONE/WILCO confirmed)
  if (action === 'CLNC') {
    const status = props.strip.dclStatus
    classes['action-dcl-request'] = status === 'REQUEST'
    classes['action-dcl-error'] = status === 'INVALID' || status === 'UNABLE' || status === 'REJECTED'
    classes['action-dcl-sent'] = status === 'SENT' || status === 'DONE' || status === 'WILCO'
  }

  return classes
}

// Mouse/pointer drag handlers (desktop)
function onDragStart(event: DragEvent) {
  if (klackGestureActive.value) {
    event.preventDefault()
    return
  }
  if (!canDragStrip.value) {
    event.preventDefault()
    return
  }
  const dragTarget = event.target as HTMLElement | null
  if (
    dragTarget?.closest('.strip-close-btn') ||
    dragTarget?.closest('.note-actions') ||
    dragTarget?.closest('.vehicle-term-actions')
  ) {
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
  markStripDragEnded()
}

// Touch drag handlers for drag areas (strip-left)
function onDragAreaTouchStart(event: TouchEvent) {
  if (!canDragStrip.value) return
  if (event.touches.length !== 1) return

  // Don't start drag when touching interactive editors/menus (callsign is OK — same as desktop)
  const target = event.target as HTMLElement
  if (
    target.closest('.action-button') ||
    target.closest('.squawk-empty') ||
    target.closest('.strip-close-btn') ||
    target.closest('.note-actions') ||
    target.closest('.vehicle-term-actions') ||
    target.closest('.exp-chip') ||
    target.closest('.ctrl-arrow') ||
    target.closest('.pg-clr-check') ||
    target.closest('.pg-cto-check') ||
    target.closest('.pg-atis-qnh') ||
    target.closest('.remarks-input') ||
    target.closest('.assr-edit-input') ||
    target.closest('.hp-edit-input') ||
    target.closest('.hs-edit-input') ||
    target.closest('.cell-hp') ||
    target.closest('.cell-hs') ||
    target.closest('.cell-coo') ||
    target.closest('.cell-xfl') ||
    target.closest('.cell-sid') ||
    target.closest('.cell-rwy') ||
    target.closest('.cell-cfl') ||
    target.closest('.cell-ahd') ||
    target.closest('.atyp-box') ||
    target.closest('.wtc-box') ||
    target.closest('.compact-gutter')
  ) return

  touchStarted = true

  const touch = event.touches[0]
  if (touch) {
    paperStartX = touch.clientX
    paperStartY = touch.clientY
    dragLastClientX = touch.clientX
    dragLastClientY = touch.clientY
    klackAmtPx.value = readKlackAmtPx()
    klackBaseX = klackSnapX(props.strip.klack ?? null)
    klackPullTarget.value = props.strip.klack ?? null
  }

  longPressTimer = window.setTimeout(() => {
    if (touchStarted && stripElement.value && touch && !isDragging.value) {
      event.preventDefault()
      beginUnifiedBayDrag(touch)
    }
  }, LONG_PRESS_DELAY)
}

function onDragAreaTouchMove(event: TouchEvent) {
  if (!touchStarted) return
  const touch = event.touches[0]
  if (!touch) return

  dragLastClientX = touch.clientX
  dragLastClientY = touch.clientY
  klackPullTarget.value = cockTargetFromDragDx()

  // Early arm (before long-press) → same unified bay drag as pointer
  if (usesCombinedStripPointer.value && !isDragging.value && !paperBayDragging) {
    const dx = touch.clientX - paperStartX
    const dy = touch.clientY - paperStartY
    if (Math.abs(dx) >= PAPER_ARM_PX || Math.abs(dy) >= PAPER_ARM_PX) {
      if (longPressTimer) {
        clearTimeout(longPressTimer)
        longPressTimer = null
      }
      beginUnifiedBayDrag(touch)
      return
    }
  }

  if (isDragging.value || paperBayDragging) {
    touchDrag.moveDrag(touch)
  }
}

function onDragAreaTouchEnd(event: TouchEvent) {
  if (longPressTimer) {
    clearTimeout(longPressTimer)
    longPressTimer = null
  }

  const touch = event.changedTouches[0]
  if (touch) {
    dragLastClientX = touch.clientX
    dragLastClientY = touch.clientY
  }

  if (isDragging.value || paperBayDragging) {
    finishPaperBayDrop()
    klackGestureActive.value = false
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
  touchY: number,
  opts?: { modeSectionId?: string; matchSectionIds?: string[] },
) {
  const { stripId, bayId: sourceBayId, sectionId: sourceSectionId, originalTop, originalBottom, stripHeight, dragOffsetY } = data
  const modeSectionId = opts?.modeSectionId || targetSectionId
  const matchIds = opts?.matchSectionIds
  const modeToggle = store.isModeToggleSectionId(modeSectionId)

  // Find the top-strips-container within the drop target
  const container = dropTarget.querySelector('.top-strips-container') || dropTarget
  if (!container) {
    if (modeToggle) {
      store.commitManualTopOrder(targetBayId, modeSectionId, [stripId], {
        movedStripId: stripId,
        membershipSectionId: targetSectionId,
      })
    } else {
      store.moveStripToSection(stripId, targetBayId, targetSectionId, 0)
    }
    return
  }

  // If section is auto time-sorted, align store positions to what the user sees
  if (!modeToggle) {
    store.syncTimeSortSectionFromDom(targetBayId, targetSectionId, container, matchIds)
  }

  // Same header: drag payload uses effective bay/section; matchIds cover merged DEP
  const sameHeader =
    sourceBayId === targetBayId &&
    !data.isBottom &&
    (sourceSectionId === targetSectionId ||
      sourceSectionId === modeSectionId ||
      (!!matchIds && matchIds.includes(sourceSectionId)))
  const isSameSection = sameHeader
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

  const placeAt = (insertPosition: number) => {
    if (modeToggle) {
      const others = allStripElements
        .map((el) => el.getAttribute('data-strip-id'))
        .filter((id): id is string => !!id && id !== stripId)
      const at = Math.max(0, Math.min(insertPosition, others.length))
      const ordered = [...others]
      ordered.splice(at, 0, stripId)
      store.commitManualTopOrder(targetBayId, modeSectionId, ordered, {
        movedStripId: stripId,
        membershipSectionId: targetSectionId,
      })
      return
    }
    store.moveStripToSection(stripId, targetBayId, targetSectionId, insertPosition)
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
    const currentGapSize = store.getGapAtIndex(targetBayId, modeSectionId, gapIndex)

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
    store.removeGapAtIndex(targetBayId, modeSectionId, gapIndex)

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

    placeAt(insertPosition)

    // Re-add the gap at the correct position with the new size
    if (newGapSize >= store.GAP_BUFFER) {
      if (dropOnTopHalf) {
        store.setGapAtIndex(targetBayId, modeSectionId, insertPosition + 1, newGapSize)
      } else {
        store.setGapAtIndex(targetBayId, modeSectionId, insertPosition, newGapSize)
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

  // Same midpoint test as the placement line (index among strips excluding the drag source).
  const insertAt = insertIndexAtClientY(stripElements, touchY)
  if (insertAt < stripElements.length) {
    position = insertAt
    droppedBelowLastStrip = false
  }

  // Handle same-section gap adjustments
  if (isSameSection && draggedIndex !== -1) {
    const currentGap = store.getGapAtIndex(targetBayId, modeSectionId, draggedIndex)

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
          store.setGapAtIndex(targetBayId, modeSectionId, draggedIndex, newGap)
          return
        }

        // Dragging up = decrease gap
        if (stripTopY < originalTop && currentGap > 0) {
          const delta = originalTop - stripTopY
          store.setGapAtIndex(targetBayId, modeSectionId, draggedIndex, Math.max(0, currentGap - delta))
          return
        }
      }

      // Dropped within original bounds - no change
      return
    }
  }

  placeAt(position)

  // Create gap if dropped below last strip with enough distance
  if (droppedBelowLastStrip && distanceBelowLastStrip >= store.GAP_BUFFER) {
    const gapSize = isSameSection
      ? distanceBelowLastStrip + draggedStripHeight
      : distanceBelowLastStrip
    store.setGapAtIndex(targetBayId, modeSectionId, position, gapSize)
  }

  // Create gap if dropped into empty section below the buffer distance
  if (droppedIntoEmptySection) {
    store.setGapAtIndex(targetBayId, modeSectionId, 0, distanceFromTop)
  }
}

function onDragAreaTouchCancel() {
  if (longPressTimer) {
    clearTimeout(longPressTimer)
    longPressTimer = null
  }

  if (isDragging.value || paperBayDragging) {
    const stripId = props.strip.id
    touchDrag.cancelDrag()
    isDragging.value = false
    paperBayDragging = false
    klackGestureActive.value = false
    applyCockAfterUnifiedDrop(stripId, true)
  }

  touchStarted = false
}

// Action button handlers
function onActionClick(action: string) {
  if (action === 'CLNC') {
    if (!canEditAssignedData.value) return
    // Auto-prep mode: always ACK CLR (voice ack → clearance flag), never open CLR dialog
    if (showAckClrLabel.value) {
      store.sendStripAction(props.strip.id, 'toggleClearanceFlag')
      return
    }
    clncDialogOpen.value = true
    return
  }
  // SAAB RTO: undo CFTO → LINEUP, then replace key with TAXI OUT / TAXI IN
  if (action === 'RTO') {
    rtoChoiceOpen.value = true
    store.sendStripAction(props.strip.id, 'RTO')
    return
  }
  if (action === 'TXO' || action === 'TXI') {
    rtoChoiceOpen.value = false
  }
  store.sendStripAction(props.strip.id, action)
}

function onActionTouch(event: TouchEvent, action: string) {
  event.preventDefault()
  if (action === 'CLNC') {
    if (!canEditAssignedData.value) return
    if (showAckClrLabel.value) {
      store.sendStripAction(props.strip.id, 'toggleClearanceFlag')
      return
    }
    clncDialogOpen.value = true
    return
  }
  if (action === 'RTO') {
    rtoChoiceOpen.value = true
    store.sendStripAction(props.strip.id, 'RTO')
    return
  }
  if (action === 'TXO' || action === 'TXI') {
    rtoChoiceOpen.value = false
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
  xflMenuOpen.value = false
  claimStripContextMenu(closeStripContextMenu)
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
  tobtMenuOpen.value = false
  groundStateMenuOpen.value = false
  transferMenuOpen.value = false
  sidRouteMenuOpen.value = false
  rwyMenuOpen.value = false
  cflMenuOpen.value = false
  xflMenuOpen.value = false
  ahdMenuOpen.value = false
}

function onSidClick(event: MouseEvent) {
  if (!canEditAssignedData.value || isArrLayout.value || isPaperEmptyFlightHolder.value) return
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

/**
 * RTC level cell click.
 * ARR (PEL): inbound pending → CoordProposalDialog only (no send / XflMenu).
 * DEP (XFL): pending → Accept/Reject; else XflMenu outbound initiate.
 * Pending Accept/Reject overrides ownedByOther (C only — rest of strip stays locked).
 */
function onXflClick(event: MouseEvent) {
  if (!isRtcCoordUi.value || isNote.value) return
  if (props.strip.exitCoordPending) {
    if (!store.isController) return
    closeAssignmentMenus()
    coordProposalDialogOpen.value = true
    return
  }
  if (!canEditAssignedData.value) return
  // ARR: Accept/Refuse only — never open XflMenu or initiate outbound
  if (isArrLayout.value) return
  menuPosition.value = menuCoordsFromEvent(event)
  closeAssignmentMenus()
  xflMenuOpen.value = true
}

function onAhdClick(event: MouseEvent) {
  // Arrivals (RTC ARR/CTR) use AHD for radar vectors — same as CFL
  if (!canEditAssignedData.value || isNote.value) return
  menuPosition.value = menuCoordsFromEvent(event)
  closeAssignmentMenus()
  ahdMenuOpen.value = true
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

/** Brittle: plugin ESC → callsign → ASEL → HOME → ASEL → EuroScope .contactme */
function onContactMeClick() {
  menuOpen.value = false
  if (isLocalOnlyStrip.value) return
  store.sendStripAction(props.strip.id, 'CONTACTME')
}

function onClncMenuClick() {
  if (!canEditAssignedData.value) return
  clncDialogOpen.value = true
  menuOpen.value = false
}

function onDeleteClick() {
  menuOpen.value = false
  if (isLocalOnlyStrip.value) {
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

/** ASSUME (untracked / inbound handoff) or re-assume to cancel outbound handoff */
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
  /* Shared OK green — CLR chip + TSAC fill/border (midpoint of former #66bb6a / #00a000) */
  --strip-ok-green: #33ae35;
  --strip-ok-green-border: #27852a;
  /*
   * Design ref 400px → body 50px. Bay strips lock --strip-scale to --bay-scale
   * (column width) so cock/klack never changes fonts or aspect; zoom sets inline.
   */
  --strip-scale: var(--bay-scale, 1);
  --frame-side: calc(8px * var(--strip-scale));
  --frame-tb: calc(var(--frame-side) / 4);
  /* Body height at design width; two rows fill strip, no gap between rows */
  --strip-body-h: calc(50px * var(--bay-scale, var(--strip-scale)));
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
  /* Raised key chrome — soft BR shade; scales with fonts/aspect (1K + zoom) */
  --strip-key-shadow:
    calc(1px * var(--strip-scale)) calc(1px * var(--strip-scale)) 0 #aaa,
    calc(1px * var(--strip-scale)) calc(2px * var(--strip-scale)) 0 rgba(0, 0, 0, 0.10);
  /* Room inside the blue/type border for key box-shadow (matches max shadow offset) */
  --strip-key-shadow-pad-x: calc(2px * var(--strip-scale));
  --strip-key-shadow-pad-y: calc(2px * var(--strip-scale));
  /* Non-scaling SVG strokes / hairline borders — thicken with --strip-scale */
  --strip-hairline: calc(1px * var(--strip-scale));
  /*
   * CLR △ stroke weight (SAAB): design unit × --strip-stroke-scale × --strip-scale.
   * Design units are half the prior tuned px (1 / 1.35 / 2.0 / 1.15), so scale 2.0
   * reproduced that look; 1.75 is the new factor (not an extra multiply on those px).
   * Independent of zoom Size %.
   */
  --strip-stroke-scale: 1.75;
  --strip-triangle-stroke: calc(0.5px * var(--strip-scale) * var(--strip-stroke-scale));
  --strip-triangle-stroke-ctot: calc(0.675px * var(--strip-scale) * var(--strip-stroke-scale));
  --strip-triangle-stroke-green: calc(1px * var(--strip-scale) * var(--strip-stroke-scale));
  --strip-triangle-stroke-active: calc(0.575px * var(--strip-scale) * var(--strip-stroke-scale));
  /* CLR △ box fill — slightly inset so the shape sits inside the cell */
  --strip-triangle-size: 0.9;
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
  margin: 2px 4px;
  cursor: grab;
  font-size: var(--fs-base);
  font-family: system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  box-sizing: border-box;
  /* Clip key shadows at the padding edge so they never paint over the type border */
  overflow: hidden;
}

.strip-departure { --strip-type: #3a72d4; }
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

/* ── Paper FPS flight strips (ESGG) — cream body, VatFSP grid in SAAB size ── */
.flight-strip.look-paper {
  /*
   * Same 400×50 design ratio as SAAB. Height + fonts follow --bay-scale (bay width)
   * so strips match paper section headers; JS also locks --strip-scale to bay-scale
   * so klack width chatter cannot shrink fonts mid-gesture.
   */
  --strip-scale: var(--bay-scale, 1);
  --strip-body-h: calc(50px * var(--bay-scale, var(--strip-scale)));
  /* Size to body — do not stretch with a tall strip-host (klack placeholder / flex) */
  height: max-content;
  flex-grow: 0;
  align-self: flex-start;
  background: #fff;
  font-family: "Microsoft Sans Serif", "Segoe UI", Arial, Helvetica, sans-serif;
  /* Let WTC scribble circle paint past the letter box (bay + zoom) */
  overflow: visible;
  /* Side inset unchanged; vertical gap from bay flex `gap` / padding */
  margin: 0 calc(4px * var(--strip-scale));
  /* Soft drop under strip onto tan bay floor */
  box-shadow:
    0 calc(1px * var(--strip-scale)) calc(2px * var(--strip-scale)) rgba(0, 0, 0, 0.28),
    0 calc(2px * var(--strip-scale)) calc(3px * var(--strip-scale)) rgba(0, 0, 0, 0.2);
}
.flight-strip.paper-info-holder {
  height: max-content;
  flex-grow: 0;
  align-self: flex-start;
}

/*
 * Paper cells: hover must not paint a fill (borders are background-image gradients —
 * resetting `background` on :hover would erase them). Cursor may still change.
 */
.flight-strip.look-paper .paper-flight button:hover,
.flight-strip.look-paper .paper-flight button:focus,
.flight-strip.look-paper .paper-flight button:active {
  background-color: transparent;
  filter: none;
  opacity: 1;
  outline: none;
  box-shadow: none;
}
.flight-strip.look-paper .paper-flight button,
.flight-strip.look-paper .paper-flight [class^="pg-"],
.flight-strip.look-paper .paper-flight [class*=" pg-"] {
  -webkit-tap-highlight-color: transparent;
}
.flight-strip.look-paper .pg-clr-check:hover {
  background-color: transparent;
}
.flight-strip.look-paper.is-large-view {
  /* Zoom has no --bay-scale — height from panel width / --strip-scale (SAAB ratio) */
  --strip-body-h: calc(50px * var(--strip-scale));
  overflow: visible;
  /* Beat .look-paper side margins so zoom fills the panel */
  margin: 0;
  width: 100%;
}

/* Flight holders: blue DEP, yellow ARR (bay headers = black; info strips = red/black) */
.flight-strip.look-paper.strip-departure,
.flight-strip.look-paper.strip-vfr,
.flight-strip.look-paper.paper-empty-dep {
  --strip-type: #3a72d4;
  border-color: #3a72d4;
}
.flight-strip.look-paper.strip-arrival,
.flight-strip.look-paper.paper-empty-arr {
  --strip-type: #daa520;
  border-color: #daa520;
}

/* Blank ARR/DEP note holders: yellow/blue type frame + paper flight grid */
.flight-strip.look-paper.paper-empty-arr,
.flight-strip.look-paper.paper-empty-dep {
  --strip-body-h: calc(50px * var(--bay-scale, var(--strip-scale)));
  /* Override .strip-note thin edge — use full type frame */
  border-width: var(--frame-tb) var(--frame-side);
  background: #fff;
  margin: 0 calc(4px * var(--strip-scale));
  box-shadow:
    0 calc(1px * var(--strip-scale)) calc(2px * var(--strip-scale)) rgba(0, 0, 0, 0.28),
    0 calc(2px * var(--strip-scale)) calc(3px * var(--strip-scale)) rgba(0, 0, 0, 0.2);
}

/*
 * Empty / empty_frame / HINDER / Bogsering / Snöröjning holder,
 * plus paper local / cross (no purple — red rails + black TB):
 * red rails full height (incl. corners); black top/bottom only between the rails
 * so they meet on a vertical edge (no CSS border corner miter / join line).
 * empty_frame also gets look-paper + paper flight grid inside.
 */
.flight-strip.paper-info-holder,
.flight-strip.look-paper.paper-empty-frame,
.flight-strip.look-paper.strip-local,
.flight-strip.look-paper.strip-cross {
  --strip-type: #c62828;
  --strip-body-h: calc(50px * var(--bay-scale, var(--strip-scale)));
  border-style: solid;
  border-width: var(--frame-tb) var(--frame-side);
  border-color: transparent;
  background-color: #fff;
  margin: 0 calc(4px * var(--strip-scale));
  box-shadow:
    0 calc(1px * var(--strip-scale)) calc(2px * var(--strip-scale)) rgba(0, 0, 0, 0.28),
    0 calc(2px * var(--strip-scale)) calc(3px * var(--strip-scale)) rgba(0, 0, 0, 0.2);
  background-image:
    linear-gradient(#c62828, #c62828),
    linear-gradient(#c62828, #c62828),
    linear-gradient(#111, #111),
    linear-gradient(#111, #111);
  background-size:
    var(--frame-side) 100%,
    var(--frame-side) 100%,
    calc(100% - 2 * var(--frame-side)) var(--frame-tb),
    calc(100% - 2 * var(--frame-side)) var(--frame-tb);
  background-position:
    left top,
    right top,
    top left var(--frame-side),
    bottom left var(--frame-side);
  background-repeat: no-repeat;
  background-origin: border-box;
  background-clip: border-box;
}

/* Paper body height shell (no SAAB action keys — assume via pin drag / ES) */
.paper-with-actions {
  display: flex;
  flex-direction: row;
  align-items: stretch;
  flex: 1;
  min-width: 0;
  height: var(--strip-body-h);
  min-height: var(--strip-body-h);
  max-height: var(--strip-body-h);
}

.paper-flight {
  /* Sans with open zeros (no slash) — match prior FPS print look */
  --pg-print: "Microsoft Sans Serif", "Segoe UI", Arial, Helvetica, sans-serif;
  --pg-print-narrow: "Arial Narrow", "Segoe UI Condensed", "Microsoft Sans Serif", Arial, sans-serif;
  /* Thick marker / felt-tip hand style for GRP stand */
  --pg-felt: "Segoe Print", "Comic Sans MS", "Chalkboard SE", "Bradley Hand", cursive;
  --pg-sub-fs: calc(10px * var(--strip-scale));
  /* Track strip scale so bay (small) vs zoom (large) stay the same visual weight */
  --pg-line: calc(1px * var(--strip-scale));
  position: relative;
  display: flex;
  flex-direction: row;
  align-items: stretch;
  flex: 1;
  min-width: 0;
  /*
   * Stretch to the strip body. height:100% does not resolve in the zoom
   * overlay, so blank strips collapsed to a thin band of grid lines and
   * scribbles could not use the white area below.
   */
  align-self: stretch;
  height: auto;
  min-height: 0;
  max-height: none;
  background: #fff;
  color: #000;
  /* Clip FPL route (etc.) at inner edge of colour frame — may still span into CTOT col */
  overflow: hidden;
  font-family: var(--pg-print);
}

/* GRP stand — large felt-tip, vertically centered on the far right */
.pg-grp-stand {
  position: absolute;
  right: calc(3px * var(--strip-scale));
  top: 50%;
  transform: translateY(-50%) rotate(-3deg);
  z-index: 4;
  pointer-events: none;
  max-width: 42%;
  overflow: visible;
  font-family: var(--pg-felt);
  font-size: calc(22px * var(--strip-scale));
  font-weight: 700;
  line-height: 0.9;
  letter-spacing: 0.01em;
  text-transform: uppercase;
  color: #000;
  /* Slight ink bleed / marker weight */
  -webkit-text-stroke: calc(0.35px * var(--strip-scale)) #000;
  paint-order: stroke fill;
  text-shadow:
    calc(0.4px * var(--strip-scale)) 0 0 #000,
    0 calc(0.4px * var(--strip-scale)) 0 #000;
  white-space: nowrap;
}

/* DEP: top half of last column so it clears the route string (same size as ARR) */
.pg-grp-stand--dep {
  top: 26%;
}

.paper-grid {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  display: grid;
  /* Borders nudged left vs VatFSP — give cols 6–7 (RTE/RFL + CTOT/CRZ) more room */
  grid-template-columns:
    minmax(0, 1.9fr)
    minmax(0, 0.9fr)
    minmax(0, 1.9fr)
    minmax(0, 0.9fr)
    minmax(0, 0.9fr)
    minmax(0, 1.0fr)
    minmax(0, 1.75fr);
  grid-template-rows: 1fr 1fr;
  grid-template-areas:
    "left time sid  adep ades rte ctot"
    "left time sid  adep ades rte ctot";
}

.pg-left {
  grid-area: left;
  display: grid;
  /* Four cells: C/S · TAS · FRUL+ATYP+WTC · ASSR (bottom = diagonal clickzone) */
  grid-template-rows: 1.3fr 1fr 1fr 1fr;
  min-width: 0;
  min-height: 0;
  overflow: visible;
  padding:
    calc(1px * var(--strip-scale))
    calc(3px * var(--strip-scale))
    calc(1px * var(--strip-scale))
    calc(5px * var(--strip-scale));
}

.pg-cs {
  display: flex;
  align-items: flex-start;
  justify-content: flex-start;
  min-width: 0;
  min-height: 0;
  overflow: visible;
  padding-top: 0;
  padding-left: calc(3px * var(--strip-scale));
  margin-top: calc(-1px * var(--strip-scale));
  cursor: pointer;
  /* Callsign may paint over lower rows */
  z-index: 2;
}

.pg-cs-text {
  font-family: var(--pg-print-narrow);
  font-weight: 600;
  font-stretch: condensed;
  font-size: calc(16px * var(--strip-scale));
  letter-spacing: -0.03em;
  line-height: 1;
  white-space: nowrap;
  overflow: visible;
  color: #000;
  text-transform: uppercase;
}

.pg-tas,
.pg-meta,
.pg-assr {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  min-width: 0;
  min-height: 0;
  font-family: var(--pg-print);
  font-size: var(--pg-sub-fs);
  font-weight: 700;
  line-height: 1;
  box-sizing: border-box;
  color: #000;
  text-align: right;
  text-transform: uppercase;
  letter-spacing: 0.01em;
  padding-right: calc(2px * var(--strip-scale));
}

/* Sit on bottom of row — same band as EOBT/ETA (top half, bottom-right) */
.pg-tas {
  align-items: flex-end;
  padding-bottom: calc(1px * var(--strip-scale));
  font-size: var(--pg-sub-fs);
  letter-spacing: 0.04em;
}

.pg-meta {
  gap: calc(5px * var(--strip-scale)); /* FRUL ↔ ATYP+WTC only */
  overflow: visible;
}

.pg-frul {
  font-family: "Times New Roman", Times, serif;
  font-weight: 700;
  font-size: inherit;
  line-height: inherit;
}

/*
 * Normal text flow: "A320 H" — one U+0020 between ATYP and WTC.
 * Inline (not flex) so bay/zoom scale the space the same way.
 */
.pg-atyp-wtc {
  position: relative;
  display: inline;
  font-size: inherit;
  font-weight: 700;
  letter-spacing: 0;
  line-height: inherit;
  white-space: pre;
  overflow: visible;
  z-index: 2;
}

.pg-wtc {
  position: relative;
  display: inline-block;
  margin: 0;
  padding: 0;
  font-size: inherit;
  font-weight: 700;
  line-height: 1;
  color: #000;
  letter-spacing: 0;
  vertical-align: baseline;
}
/* B757 / Tu204: WTC letter stays M; yellow fill = heavy-as-leader (same as non-std RWY) */
.pg-wtc.pg-wtc-yellow {
  padding: 0 0.12em;
  background: #fddf5f;
  box-shadow: inset 0 0 0 1px #c9a82a;
}

.pg-wtc-scribble {
  position: absolute;
  /* Absolute so bay/zoom layout stay identical */
  inset: -100%;
  width: 300%;
  height: 300%;
  pointer-events: none;
  overflow: visible;
  z-index: 3;
}

/* Ballpoint (kulspetspenna) — pronounced red scribble */
.pg-wtc-pen {
  stroke: #c62828;
  stroke-width: 1.25;
  stroke-opacity: 1;
  stroke-linecap: round;
  stroke-linejoin: round;
  fill: none;
}

.pg-wtc-pen.pg-wtc-pen-blue {
  stroke: #1565c0;
  stroke-width: 1.35;
  stroke-opacity: 0.9;
}

/* CFTO mark: short horizontal; stroke weight ≈ red WTC on-screen */
.pg-cfto-line {
  width: calc(15px * var(--strip-scale));
  height: calc(10px * var(--strip-scale));
}
.pg-cfto-pen.pg-wtc-pen-blue {
  /* 1.25 in WTC’s oversized viewBox ≈ ~2 here */
  stroke-width: 2;
  stroke-opacity: 1;
}

/* CTL mark: scribbled L — larger + bolder than CFTO dash */
.pg-ctl-l {
  width: calc(14px * var(--strip-scale));
  height: calc(17px * var(--strip-scale));
  overflow: visible;
}
.pg-ctl-pen.pg-wtc-pen-blue {
  stroke-width: 2.6;
  stroke-opacity: 1;
}

.pg-assr {
  position: relative;
  letter-spacing: 0.06em;
}

.pg-assr-val {
  position: relative;
  z-index: 0;
}

/* Left half of bottom col-1 cell — rising / (refuse or APP XFER) */
.pg-xfer-diag-hit {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 50%;
  z-index: 1;
  margin: 0;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
}

/*
 * All cell lines — same linear-gradient paint + --pg-line in the thin axis
 * (solid height/width bars rasterize differently from gradient vlines).
 */
.pg-vline {
  background-image: linear-gradient(#000, #000);
  background-size: var(--pg-line) 100%;
  background-position: 100% 0;
  background-repeat: no-repeat;
}

/* Mid horizontal (cols 2, 4, 5, 6) — full-cell overlay, line at true 50% */
.pg-mid-rule {
  position: relative;
}
.pg-mid-rule::before {
  content: '';
  position: absolute;
  inset: 0;
  background-image: linear-gradient(#000, #000);
  background-size: 100% var(--pg-line);
  background-position: center;
  background-repeat: no-repeat;
  pointer-events: none;
  z-index: 1;
}

/* Mid + full-height right edge */
.pg-mid-rule.pg-vline {
  background-image: linear-gradient(#000, #000);
  background-size: var(--pg-line) 100%;
  background-position: 100% 0;
  background-repeat: no-repeat;
}

.pg-time {
  grid-area: time;
  position: relative;
  box-sizing: border-box;
  display: grid;
  grid-template-rows: 1fr 1fr;
  /* Symmetric vertical pad so mid-line matches cols 4–5 */
  padding: 0;
  font-family: var(--pg-print);
  font-size: var(--pg-sub-fs);
  font-weight: 700;
  letter-spacing: 0.04em;
  line-height: 1;
  min-width: 0;
  min-height: 0;
}

.pg-time-eobt {
  grid-row: 1;
  align-self: end;
  justify-self: end;
  padding: 0 calc(5px * var(--strip-scale)) calc(1px * var(--strip-scale))
    calc(2px * var(--strip-scale));
  color: #000;
  position: relative;
  z-index: 2;
}

/*
 * Col 2 bottom: always two equal halves.
 * ARR: CTL | ATA · DEP: .pg-time-bot-cfto spans full (CFTO|ATD) · DEP+CTOT: slot | CFTO|ATD
 */
.pg-time-bot {
  grid-row: 2;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
  position: relative;
  z-index: 2;
  align-items: stretch;
  column-gap: 0;
}

/* DEP without CTOT: CFTO|ATD wrapper is the only child — span both halves */
.pg-time-bot:not(.pg-time-bot--ctot) > .pg-time-bot-cfto {
  grid-column: 1 / -1;
}

/* DEP+CTOT: narrower CTOT−5 slot → more room for CFTO|ATD */
.pg-time-bot--ctot {
  grid-template-columns: minmax(0, 0.4fr) minmax(0, 0.6fr);
}

.pg-time-bot-cfto {
  display: grid;
  grid-template-columns: 1fr 1fr;
  min-width: 0;
  min-height: 0;
}

.pg-ctot-slot {
  display: flex;
  align-items: center;
  justify-content: center;
  align-self: stretch;
  justify-self: stretch;
  width: 100%;
  min-width: 0;
  min-height: 0;
  /* Tight to black col edge (left) and mid scribble (right) */
  padding: 0 calc(2px * var(--strip-scale)) 0 calc(1px * var(--strip-scale));
  box-sizing: border-box;
}

/* Beat .pg-atd-val blue — CTOT−5 is red felt like the split line */
.pg-atd-val.pg-ctot-slot-val {
  width: auto;
  height: auto;
  max-width: 100%;
  color: #c62828;
  -webkit-text-stroke: calc(0.15px * var(--strip-scale)) #c62828;
  transform: rotate(-4deg);
  transform-origin: center center;
}

.pg-ctot-split {
  position: absolute;
  /* Align with CTOT−5 | CFTO boundary (.pg-time-bot--ctot 0.4fr / 0.6fr) */
  left: 40%;
  top: 0;
  bottom: 0;
  width: calc(5px * var(--strip-scale));
  height: 100%;
  min-height: calc(12px * var(--strip-scale));
  transform: translateX(-50%);
  overflow: visible;
  pointer-events: none;
  z-index: 3;
}

.pg-ctot-split-pen {
  stroke: #c62828;
  stroke-width: 1.85;
  stroke-opacity: 1;
}

/* Tight fit when CTOT split takes half the column */
.pg-time-bot--ctot .pg-atd-val {
  font-size: calc(11px * var(--strip-scale));
}
.pg-time-bot--ctot .pg-cto-check {
  /* Reach left toward CTOT split; leave a hair of gap */
  justify-content: flex-start;
  padding: 0 0 0 calc(1px * var(--strip-scale));
}
.pg-time-bot--ctot .pg-atd-cell {
  padding: 0;
}
/* Mid-length dash toward the red split; ATD keeps the right half */
.pg-time-bot--ctot .pg-cfto-line {
  width: calc(10px * var(--strip-scale));
  height: calc(8px * var(--strip-scale));
}
/*
 * Wider box raises stroke scale; keep on-screen weight ≈ .pg-ctot-split-pen.
 */
.pg-time-bot--ctot .pg-cfto-pen.pg-wtc-pen-blue {
  stroke-width: 3.7;
}

.pg-cto-check {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  min-height: 0;
  margin: 0;
  padding: 0 calc(2px * var(--strip-scale));
  border: none;
  background: transparent;
  cursor: pointer;
  color: #000;
  appearance: none;
  -webkit-appearance: none;
}

.pg-cto-check:disabled,
.pg-cto-check.disabled,
.pg-clr-check:disabled,
.pg-clr-check.disabled {
  cursor: default;
  pointer-events: none;
}

.pg-cto-line {
  width: calc(22px * var(--strip-scale));
  height: calc(10px * var(--strip-scale));
  overflow: visible;
}

.pg-atd-cell {
  display: flex;
  align-items: center;
  justify-content: center;
  align-self: stretch;
  justify-self: stretch;
  width: 100%;
  min-width: 0;
  min-height: 0;
  padding: 0 calc(2px * var(--strip-scale)) 0 0;
  box-sizing: border-box;
}

.pg-atd-val {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  /* Same hand/scribble face as GRP stand — blue kulspetspenna */
  font-family: var(--pg-felt);
  font-size: calc(14px * var(--strip-scale));
  font-weight: 700;
  letter-spacing: 0.01em;
  line-height: 0.9;
  color: #1565c0;
  transform: rotate(-4deg);
  -webkit-text-stroke: calc(0.2px * var(--strip-scale)) #1565c0;
  paint-order: stroke fill;
}

.pg-sid {
  grid-area: sid;
  display: grid;
  grid-template-rows: 1fr 1fr;
  align-items: center;
  justify-items: center;
  padding: 0 calc(2px * var(--strip-scale));
  cursor: pointer;
}
/* ESSA preferred DEP-E / ARR-E — black SID box on paper look (scales with strip) */
.pg-sid.sid-mdi-box:not(.ghost) {
  box-shadow: inset 0 0 0 calc(2px * var(--strip-scale, 1)) #111;
}

.pg-sid-val {
  grid-row: 2;
  min-width: 0;
  max-width: 100%;
  /* Match .pg-cs-text */
  font-family: var(--pg-print-narrow);
  font-weight: 600;
  font-stretch: condensed;
  font-size: calc(16px * var(--strip-scale));
  letter-spacing: -0.03em;
  line-height: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: #000;
  text-transform: uppercase;
  text-align: center;
}

.pg-sid-arr-empty {
  /* ARR col 3 — G/A arrow zone at bottom; stand via GRP scribble on far right */
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  align-items: stretch;
  pointer-events: none;
}

.pg-goa-zone {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 50%;
  min-height: 0;
  pointer-events: none;
}

.pg-goa-zone.pg-goa-hit {
  pointer-events: auto;
  cursor: pointer;
}

.pg-goa-arrow {
  width: calc(36px * var(--strip-scale));
  height: calc(18px * var(--strip-scale));
  overflow: visible;
}

.pg-goa-pen.pg-wtc-pen-blue {
  stroke-width: 2.4;
  stroke-opacity: 1;
}

.pg-adep,
.pg-ades {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: stretch;
  min-width: 0;
  min-height: 0;
  font-family: var(--pg-print);
  font-size: calc(10px * var(--strip-scale));
  font-weight: 700;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}

.pg-adep { grid-area: adep; }
.pg-ades { grid-area: ades; }

.pg-clr-check {
  flex: 1 1 0;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 0;
  margin: 0;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  color: #000;
  appearance: none;
  -webkit-appearance: none;
}

/* Blå kulspetspenna check */
.pg-clr-mark {
  width: calc(20px * var(--strip-scale));
  height: calc(20px * var(--strip-scale));
  overflow: visible;
}

.pg-clr-mark path {
  fill: none;
  stroke: #1565c0;
  stroke-width: 1.15;
  stroke-opacity: 0.95;
  stroke-linecap: round;
  stroke-linejoin: round;
}

/* DCL send — felt "DCL" in CLR read (same hand as ATD / GRP stand) */
.pg-dcl-mark {
  display: block;
  font-family: var(--pg-felt);
  font-size: calc(13px * var(--strip-scale));
  font-weight: 700;
  letter-spacing: 0.02em;
  line-height: 1;
  color: #1565c0;
  transform: rotate(-6deg);
  -webkit-text-stroke: calc(0.2px * var(--strip-scale)) #1565c0;
  paint-order: stroke fill;
  pointer-events: none;
  user-select: none;
}

/* ARR top half spacer (DEP uses .pg-clr-check) — keeps ICAO on bottom row */
.pg-ad-top {
  flex: 1 1 0;
  min-height: 0;
}

/* Bottom row of ADEP/ADES: RWY top-justified, ICAO bottom */
.pg-ad-bot {
  flex: 1 1 0;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  min-width: 0;
  min-height: 0;
  position: relative;
}

.pg-ad-code {
  flex: 1 1 0;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  min-height: 0;
  padding-bottom: calc(1px * var(--strip-scale));
}

/* Non-active RWY — blue felt, same bottom row as ADEP/ADES, top of that row */
.pg-rwy-scribble {
  flex: 0 0 auto;
  align-self: center;
  z-index: 2;
  pointer-events: none;
  user-select: none;
  margin-top: calc(1px * var(--strip-scale));
  font-family: var(--pg-felt);
  font-size: calc(11px * var(--strip-scale));
  font-weight: 700;
  letter-spacing: 0.01em;
  line-height: 1;
  color: #1565c0;
  text-transform: uppercase;
  transform: rotate(-5deg);
  -webkit-text-stroke: calc(0.2px * var(--strip-scale)) #1565c0;
  paint-order: stroke fill;
  white-space: nowrap;
}
/* Half-height right edge (cols 4 & 6) — same gradient paint as full vlines */
.pg-adep::after,
.pg-rte-rfl::after {
  content: '';
  position: absolute;
  top: 0;
  right: 0;
  width: var(--pg-line);
  height: 50%;
  background-image: linear-gradient(#000, #000);
  background-size: var(--pg-line) 100%;
  background-position: 0 0;
  background-repeat: no-repeat;
  pointer-events: none;
}

.pg-rte-rfl {
  grid-area: rte;
  position: relative;
  display: grid;
  /* 4 bands: mid-line sits between 2 and 3 */
  grid-template-rows: 1fr 1fr 1fr 1fr;
  min-width: 0;
  overflow: visible;
  z-index: 2;
}

.pg-band {
  min-height: 0;
  min-width: 0;
}

/* Col 6 bands 1–2: REA scribble (display-only; auto on ready) */
.pg-rea-zone {
  grid-row: 1 / 3;
  display: flex;
  align-items: flex-start;
  justify-content: flex-start;
  min-height: 0;
  min-width: 0;
  padding: calc(1px * var(--strip-scale)) calc(2px * var(--strip-scale)) 0;
  pointer-events: none;
}

.pg-fpl {
  /* Band 3 — upper part of lower half; may spill into col 7 */
  display: flex;
  align-items: flex-end;
  min-height: 0;
  padding: 0 calc(2px * var(--strip-scale)) 0;
  font-family: var(--pg-print);
  font-size: calc(9px * var(--strip-scale));
  font-weight: 700;
  letter-spacing: 0.01em;
  white-space: nowrap;
  overflow: visible;
  text-transform: uppercase;
  line-height: 1;
  position: relative;
  z-index: 2;
}

/* Col 6 band 4: ATIS + QNH stamp clickspot */
.pg-atis-qnh {
  grid-row: 4;
  display: flex;
  align-items: flex-end;
  justify-content: flex-start;
  min-height: 0;
  min-width: 0;
  margin: 0;
  padding: 0 calc(2px * var(--strip-scale)) calc(1px * var(--strip-scale));
  border: none;
  background: transparent;
  cursor: pointer;
  color: #000;
  appearance: none;
  -webkit-appearance: none;
  font: inherit;
  text-align: left;
}

.pg-atis-qnh:disabled {
  cursor: default;
}

.pg-atis-qnh-val {
  position: relative;
  display: inline-block;
  font-family: var(--pg-print);
  font-size: calc(9px * var(--strip-scale));
  font-weight: 700;
  letter-spacing: 0.02em;
  line-height: 1;
  text-transform: uppercase;
  color: #000;
}

.pg-ctot {
  grid-area: ctot;
  display: grid;
  grid-template-rows: 1fr 1fr 1fr 1fr;
  min-width: 0;
  min-height: 0;
  font-family: var(--pg-print);
  font-size: calc(11px * var(--strip-scale));
  font-weight: 700;
  letter-spacing: 0.03em;
  position: relative;
  z-index: 3;
  overflow: visible;
}

.pg-ctot-top {
  /* Bands 1–2 (upper half) — plain print, no click */
  grid-row: 1 / 3;
  display: flex;
  align-items: flex-start;
  justify-content: flex-start;
  min-height: 0;
  padding: calc(2px * var(--strip-scale)) calc(2px * var(--strip-scale)) 0;
  font-size: calc(9px * var(--strip-scale));
  font-weight: 700;
  letter-spacing: 0.01em;
  line-height: 1;
}

.pg-ctot-val {
  position: relative;
  display: inline-block;
  line-height: 1;
}

.pg-ctot-scribble {
  position: absolute;
  inset: -55% -35%;
  width: 170%;
  height: 210%;
  pointer-events: none;
  overflow: visible;
  z-index: 3;
}

.pg-crz {
  /* Band 4 — bottom row; same type size as FPL route */
  grid-row: 4;
  display: flex;
  align-items: flex-end;
  justify-content: flex-start;
  min-height: 0;
  padding: 0 calc(2px * var(--strip-scale)) calc(1px * var(--strip-scale));
  font-family: var(--pg-print);
  font-size: calc(9px * var(--strip-scale));
  font-weight: 700;
  letter-spacing: 0.01em;
  line-height: 1;
  text-transform: uppercase;
}

/* ARR: EOBT in lower half */
.pg-arr-eobt {
  display: flex;
  align-items: flex-end;
  justify-content: flex-start;
  padding: 0 calc(2px * var(--strip-scale)) calc(1px * var(--strip-scale));
}

.pg-rea {
  position: relative;
  display: inline-block;
  font-family: var(--pg-print);
  font-size: calc(9px * var(--strip-scale));
  font-weight: 700;
  color: #000;
  line-height: 1;
  letter-spacing: 0.02em;
  text-transform: none;
}

.pg-rea-scribble {
  position: absolute;
  inset: -100%;
  width: 300%;
  height: 300%;
  pointer-events: none;
  overflow: visible;
  z-index: 3;
}

.paper-flight .ghost {
  color: #bbb;
  font-weight: 500;
}

/* Paper FPS blank / info strips */
.paper-info-body {
  position: relative;
  flex: 1;
  min-width: 0;
  height: var(--strip-body-h);
  min-height: var(--strip-body-h);
  max-height: var(--strip-body-h);
  display: flex;
  align-items: stretch;
  background: #f7f4ee;
  overflow: hidden;
}

.paper-info-empty {
  background: #f7f4ee;
}

.paper-info-hinder {
  background: #d32f2f;
}

.paper-info-full {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  color: #fff;
  font-weight: 800;
  /* Cap below full-box fit — HINDER reads better a notch smaller */
  font-size: calc(26px * var(--strip-scale));
  letter-spacing: 0.06em;
  line-height: 1;
  font-family: Arial, Helvetica, sans-serif;
}

.paper-info-panel {
  display: flex;
  align-items: center;
  justify-content: center;
  align-self: stretch;
  width: 42%;
  max-width: 42%;
  min-width: 0;
  min-height: 0;
  height: 100%;
  padding: 0 calc(4px * var(--strip-scale));
  overflow: hidden;
  color: #fff;
  font-weight: 700;
  /* Start large; .fit-font shrinks to the panel (two-line strips) */
  font-size: calc(36px * var(--strip-scale));
  line-height: 1.05;
  font-family: Arial, Helvetica, sans-serif;
  box-sizing: border-box;
}

.paper-info-bogsering-text {
  font-size: calc(25px * var(--strip-scale));
}

.paper-info-panel-2 {
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  font-size: calc(22px * var(--strip-scale));
  line-height: 1.1;
}

.paper-info-bogsering .paper-info-panel {
  background: #d32f2f;
}

.paper-info-snorojning .paper-info-panel {
  background: #d32f2f;
}

.paper-info-prel_rojning .paper-info-panel {
  background: #2e5a3c;
}

.paper-info-bogsering,
.paper-info-snorojning,
.paper-info-prel_rojning {
  background: #fff;
}

/* Vehicle strips: red type frame (paper, RTC, other SAAB). ESSA roles config is dark grey. */
.strip-vehicle {
  --strip-type: #c62828;
}
.strip-vehicle.look-essa {
  --strip-type: #2a2a2a;
}

.flight-strip.dragging {
  opacity: 0.4;
  cursor: grabbing;
}

.flight-strip.no-drag {
  cursor: default;
  -webkit-user-drag: none;
  user-select: none;
}

.flight-strip.is-large-view {
  width: 100%;
  margin: 0;
  cursor: default;
}

/* Host keeps drop slots outside the strip's overflow:hidden frame */
.strip-host {
  position: relative;
  width: 100%;
  min-width: 0;
  /* Never flex-stretch taller than the strip — that left empty frame above/below the grid */
  align-self: flex-start;
  flex-grow: 0;
  height: max-content;
}
.strip-host--paper,
.strip-host--cocked {
  overflow: visible;
}
/* Klacked/cocked strip stays under same-column headers; column raise handles neighbour bays */
.strip-host--paper:has(.klack-left),
.strip-host--paper:has(.klack-right),
.strip-host--paper:has(.klack-pulling),
.strip-host--cocked {
  position: relative;
  z-index: 1;
}
.klack-drop-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 1;
}
/*
 * Klack snap targets — teal like .drop-placement-line.
 * Left slot: only far-left “[”; right slot: only far-right “]”; flush: no brackets.
 */
.klack-drop-slot {
  --klack-bracket: rgb(0, 150, 180);
  --klack-bracket-glow: rgba(0, 150, 180, 0.45);
  position: absolute;
  inset: 0;
  border: none;
  background: transparent;
  opacity: 0.35;
  box-sizing: border-box;
}
.klack-drop-slot--left {
  transform: translateX(calc(-1 * var(--klack-amt, 28px)));
}
.klack-drop-slot--left::before {
  content: '';
  position: absolute;
  top: 1px;
  bottom: 1px;
  left: 2px;
  width: 10px;
  box-sizing: border-box;
  border-color: var(--klack-bracket);
  border-style: solid;
  border-width: 3px 0 3px 3px;
  border-radius: 1px 0 0 1px;
  filter: drop-shadow(0 0 0.5px var(--klack-bracket-glow));
}
.klack-drop-slot--right {
  transform: translateX(var(--klack-amt, 28px));
}
.klack-drop-slot--right::after {
  content: '';
  position: absolute;
  top: 1px;
  bottom: 1px;
  right: 2px;
  width: 10px;
  box-sizing: border-box;
  border-color: var(--klack-bracket);
  border-style: solid;
  border-width: 3px 3px 3px 0;
  border-radius: 0 1px 1px 0;
  filter: drop-shadow(0 0 0.5px var(--klack-bracket-glow));
}
.klack-drop-slot--flush {
  /* Home / no-klack target — no bracket chrome */
  opacity: 0;
}
.klack-drop-slot.active {
  opacity: 1;
}
.klack-drop-slot--flush.active {
  opacity: 0;
}

/* Paper klack: fixed design offset × scale */
.flight-strip.look-paper {
  transition: transform 160ms ease-out;
}
.flight-strip.look-paper.dragging,
.flight-strip.look-paper.klack-instant {
  transition: none;
}
.flight-strip.look-paper.klack-right {
  transform: translateX(calc(28px * var(--bay-scale, var(--strip-scale))));
}
.flight-strip.look-paper.klack-left {
  transform: translateX(calc(-28px * var(--bay-scale, var(--strip-scale))));
}
.flight-strip.look-paper.klack-pulling {
  /* transform from klackPullStyle while dragging sideways */
  z-index: 1;
}

/*
 * SAAB cock: shift so the strip's outer edge sits at the mid-point of the
 * inter-bay gutter (--efs-bay-gutter), layered over that border (column raise).
 * Amount = strip side margin + half gutter.
 */
.strip-host--saab-cock {
  --cock-strip-margin-x: 4px;
  --cock-strip-margin-y: 2px;
  --saab-cock-amt: calc(
    var(--cock-strip-margin-x) + var(--efs-bay-gutter, 8px) / 2
  );
}
/* Short slide on click-to-cock / uncock — not while dragging or after a drag drop */
.flight-strip:not(.look-paper) {
  transition: transform 160ms ease-out;
}
.flight-strip:not(.look-paper).dragging,
.flight-strip:not(.look-paper).klack-instant {
  transition: none;
}
.flight-strip:not(.look-paper).klack-right {
  transform: translateX(var(--saab-cock-amt, 8px));
  z-index: 2;
}
.flight-strip:not(.look-paper).klack-left {
  transform: translateX(calc(-1 * var(--saab-cock-amt, 8px)));
  z-index: 2;
}
.flight-strip:not(.look-paper).klack-pulling {
  z-index: 2;
}
.strip-cock-hit {
  position: absolute;
  top: var(--cock-strip-margin-y);
  bottom: var(--cock-strip-margin-y);
  width: var(--cock-frame-side, 8px);
  z-index: 12;
  margin: 0;
  padding: 0;
  border: none;
  border-radius: 0;
  background: transparent;
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
  pointer-events: auto;
  touch-action: manipulation;
  transition: transform 160ms ease-out;
}
.strip-host--saab-cock:has(.dragging) .strip-cock-hit,
.strip-host--klack-instant .strip-cock-hit {
  transition: none;
}
.strip-cock-hit--left {
  left: var(--cock-strip-margin-x);
}
.strip-cock-hit--right {
  right: var(--cock-strip-margin-x);
}
/* No border wash — clickability is cursor only */
.strip-cock-hit:hover,
.strip-cock-hit:focus {
  background: transparent;
  outline: none;
}
/* When cocked, hits move with the strip (same mid-gutter offset) */
.strip-host--saab-cock:has(.klack-left) .strip-cock-hit {
  transform: translateX(calc(-1 * var(--saab-cock-amt, 8px)));
}
.strip-host--saab-cock:has(.klack-right) .strip-cock-hit {
  transform: translateX(var(--saab-cock-amt, 8px));
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
  /* stroke colour set per-polyline (blue/red kulspetspenna) */
  stroke-linecap: round;
  stroke-linejoin: round;
  /* Thickness in CSS px — avoids X/Y stretch from non-square strip viewBox */
  vector-effect: non-scaling-stroke;
}

/* Destination placeholder while fly-clone is in flight — must not paint */
.flight-strip.auto-move-hidden,
.flight-strip.print-anim-hidden {
  opacity: 0;
  visibility: hidden;
}

.strip-note-layout,
.strip-vehicle-layout {
  flex-direction: row;
  align-items: stretch;
  height: var(--strip-body-h);
  min-height: var(--strip-body-h);
  max-height: var(--strip-body-h);
}

.vehicle-body {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: row;
  align-items: center;
  height: 100%;
  overflow: hidden;
  cursor: pointer;
}

.vehicle-cs {
  flex: 1 1 auto;
  min-width: 0;
  height: 100%;
  display: flex;
  align-items: center;
  box-sizing: border-box;
  padding: calc(10px * var(--strip-scale, 1)) 0 calc(10px * var(--strip-scale, 1))
    calc(12px * var(--strip-scale, 1));
  font-size: calc(var(--fs-cs) * 0.62);
  font-weight: 700;
  letter-spacing: 0.02em;
  line-height: 1;
  color: #1a1a1a;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  user-select: none;
  pointer-events: none;
}

.vehicle-fields {
  flex: 0 0 auto;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: flex-end;
  gap: calc(2px * var(--strip-scale, 1));
  padding: 0 calc(2px * var(--strip-scale, 1));
  box-sizing: border-box;
}

/* Match flight-strip HP/STD cell width (--hp-col); square, vertically centered */
.vehicle-cell {
  position: relative;
  flex: 0 0 var(--hp-col);
  width: var(--hp-col);
  height: var(--hp-col);
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  font-size: var(--fs-ghost);
  font-weight: 700;
  color: #1a1a1a;
  cursor: pointer;
  user-select: none;
  overflow: hidden;
}

.vehicle-cell.editable {
  cursor: text;
}

.vehicle-cell::after {
  content: '';
  position: absolute;
  inset: var(--frame-visual-pad-y) 0;
  border: 1px solid #d8d8d8;
  box-sizing: border-box;
  pointer-events: none;
}

.vehicle-cell:not(.ghost) {
  font-size: var(--fs-data);
}

.vehicle-cell.ghost {
  color: #b0b0b0;
}

.vehicle-cell.editing {
  overflow: visible;
}

.vehicle-cell.editing::after {
  border-color: #666;
}

.vehicle-input {
  position: relative;
  z-index: 2;
  display: block;
  width: 100%;
  min-width: 0;
  height: 100%;
  margin: 0;
  padding: 0 2px;
  border: none;
  outline: none;
  background: transparent;
  text-align: center;
  font: inherit;
  font-size: var(--fs-data);
  font-weight: 700;
  color: #1a1a1a;
  box-sizing: border-box;
}

.vehicle-term-actions {
  flex: 0 0 auto;
  margin: 0 var(--strip-key-shadow-pad-x) var(--strip-key-shadow-pad-y) 0;
  cursor: default;
  touch-action: manipulation;
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
  padding: calc(1px * var(--strip-scale)) var(--strip-key-shadow-pad-x) var(--strip-key-shadow-pad-y) 0;
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
  /* Left pad matches strip-left arrow inset so collapse ▲/▼ lines up with body arrows.
   * Extra bottom/right pad so key box-shadows stay inside the type frame. */
  padding: calc(2px * var(--strip-scale)) calc(6px * var(--strip-scale)) calc(4px * var(--strip-scale)) 1px;
  overflow: hidden;
  box-sizing: border-box;
}
/* Top: DEP|POB flush to action-key right edge (same pad-x as strip-grid / action keys) */
.strip-expander-top {
  padding-right: var(--strip-key-shadow-pad-x);
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
/* Top expander: DEP|POB fill action-key width, 50/50 — independent of ▲ highlight */
.exp-dep-pob {
  display: flex;
  flex-direction: row;
  align-items: stretch;
  width: var(--actions-w);
  min-width: var(--actions-w);
  max-width: var(--actions-w);
  height: var(--ctrl-arrow-h);
  max-height: var(--ctrl-arrow-h);
  flex-shrink: 0;
  gap: 0;
  box-sizing: border-box;
}
.exp-dep-pob .exp-chip {
  flex: 1 1 0;
  min-width: 0;
  width: auto;
  padding: 0;
  font-size: var(--fs-action-sm);
}
.exp-dep-pob .exp-dep-btn.exp-dep-green {
  box-shadow: inset 0 0 0 calc(2px * var(--strip-scale)) #12b33a, var(--strip-key-shadow);
  border-color: #0a8a2a;
}
.exp-dep-pob .exp-chip:disabled {
  opacity: 0.45;
  cursor: default;
}
/* Bottom: [▼ RMK FPL | …][ASSR | ADES | remarks under CFL→][TMA] */
.strip-expander-bottom {
  display: grid;
  grid-template-columns: auto 1fr var(--actions-w);
  align-items: center;
  gap: 0;
  /* Lock to chip/arrow row — native <input> must not grow strip height */
  height: calc(var(--ctrl-arrow-h) + 6px * var(--strip-scale));
  min-height: calc(var(--ctrl-arrow-h) + 6px * var(--strip-scale));
  max-height: calc(var(--ctrl-arrow-h) + 6px * var(--strip-scale));
  padding: calc(2px * var(--strip-scale)) calc(3px * var(--strip-scale)) calc(4px * var(--strip-scale)) 1px;
  box-sizing: border-box;
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
/* Match strip-main column tracks so RMK starts under CFL (AHD track = col 4) */
.exp-bottom-main-dep {
  /* SAAB ESSA DEP: keep AHD at 0.72fr (shared with EST/coo). RTC overrides to 0.36fr. */
  grid-template-columns: 0.72fr 0.92fr 0.68fr 0.72fr 0.87fr var(--hp-col) var(--hp-col) var(--rwy-col);
}
.exp-bottom-main-arr {
  grid-template-columns: 0.92fr 0.72fr 0.68fr 0.72fr 0.87fr var(--hp-col) var(--hp-col) var(--rwy-col);
}
/* Under STD (col1) / CTO (col2): ASSR · ADES — own tracks so 4-letter ICAO fits.
   RMK starts under CFL (col3) through end of main (up to TMA exit column). */
.exp-assr {
  grid-column: 1;
  display: flex;
  align-items: center;
  min-width: 0;
  padding: 0 calc(2px * var(--strip-scale));
  box-sizing: border-box;
}
.exp-ades {
  grid-column: 2;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  min-width: 0;
  /* Wide glyphs (W) — keep full ICAO visible in the CTO track */
  overflow: visible;
  padding: 0 calc(2px * var(--strip-scale));
  box-sizing: border-box;
  margin-left: 0;
}
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
  height: 100%;
  max-height: 100%;
  margin: 0;
  padding: 0;
  border: none;
  background: transparent;
  box-sizing: border-box;
  font-size: var(--fs-time);
  font-weight: 500;
  font-family: inherit;
  color: #000;
  letter-spacing: 0;
  line-height: 1.1;
  text-transform: uppercase;
  outline: none;
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
/* Collapse arrow in expander — strip-bg fill + light raised shade */
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
  border: var(--strip-hairline) solid #c8c8c8;
  background: #ebebeb;
  box-shadow: var(--strip-key-shadow);
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
.strip-expander .expander-arrow:hover { background: #e0e0e0; }
.strip-expander .expander-arrow:active { background: #d4d4d4; }
.strip-expander .expander-arrow.mirrored .arrow-glyph {
  transform: scaleX(1.45) scaleY(-1);
}
/* Extender action chips — same soft chrome as action keys / expander arrows */
.exp-chip {
  height: var(--ctrl-arrow-h);
  max-height: var(--ctrl-arrow-h);
  padding: 0 calc(6px * var(--strip-scale));
  box-sizing: border-box;
  display: grid;
  place-items: center;
  border: var(--strip-hairline) solid #c8c8c8;
  border-radius: 0;
  background: #ebebeb;
  box-shadow: var(--strip-key-shadow);
  color: #000;
  font-size: var(--fs-action-sm);
  font-weight: 700;
  letter-spacing: 0.3px;
  line-height: 1;
  cursor: pointer;
  text-transform: uppercase;
  flex-shrink: 0;
}
/* Hover/active only for plain chips — do not wash out green/orange/DCL/CLR highlights */
.exp-chip:hover:not(:disabled):not(.exp-rea):not(.exp-qnh-ok):not(.exp-qnh-stale):not(.active):not(.dcl-request):not(.exp-clr-ok):not(.dcl-err) {
  background: #e0e0e0;
}
.exp-chip:active:not(:disabled):not(.exp-rea):not(.exp-qnh-ok):not(.exp-qnh-stale):not(.active):not(.dcl-request):not(.exp-clr-ok):not(.dcl-err) {
  background: #d4d4d4;
}
.exp-chip:disabled { opacity: 0.55; cursor: default; }
.exp-chip.active { background: var(--strip-amber); color: #fff; }
.exp-chip.exp-rea { background: #12b33a; color: #fff; border-color: #0a8a2a; }
.exp-chip.exp-qnh-ok { background: #12b33a; color: #fff; border-color: #0a8a2a; }
.exp-chip.exp-qnh-stale { background: var(--strip-amber); color: #fff; border-color: #b06a00; }
.exp-chip.inert { opacity: 0.55; cursor: default; }
.exp-chip.dcl-request { background: #fdd835; color: #000; }
/* Clearance green / amber / error — white text on highlight (chip + ▲ arrows already white) */
.exp-chip.exp-clr-ok { background: var(--strip-ok-green); color: #fff; }
.exp-chip.dcl-err { background: #e53935; color: #fff; }
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
  max-height: 100%;
  margin: 0;
  padding: 0;
  border: none;
  background: transparent;
  box-sizing: border-box;
  font-size: var(--fs-time);
  font-weight: 500;
  font-family: inherit;
  color: #000;
  letter-spacing: 0;
  line-height: 1.1;
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
  border: 1px solid #c8c8c8;
  background: #ebebeb;
  box-shadow: var(--strip-key-shadow);
  font-size: 9px;
  line-height: 1;
  cursor: pointer;
  color: #111;
}
.ctrl-arrow:hover { background: #e0e0e0; }
.ctrl-arrow:active { background: #d4d4d4; }
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
 * INBOUND / other-owned / dimmed: data → placeholder grey.
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
.flight-strip.dimmed-data .strip-main .cell-rwy.rwy-nonstandard,
.flight-strip.dimmed-data .strip-left .atyp-box.atyp-yellow,
.flight-strip.dimmed-data .strip-left .wtc-box.wtc-yellow {
  color: #000 !important;
}
/* Inbound pink C: keep full pink even when strip data is dimmed / ownedByOther */
.flight-strip.dimmed-data .strip-main .cell.proposal,
.flight-strip.dimmed-data .strip-main .cell.xfl-coord-pink.proposal,
.flight-strip.dimmed-data .strip-main .cell.coo-coord-pink {
  color: #dc7cae !important;
}
.cell-cfl.arr-cfl-ghost {
  color: #b0b0b0 !important;
  -webkit-text-fill-color: #b0b0b0 !important;
}
.callsign {
  font-size: var(--fs-cs);
  font-weight: 700;
  color: #000;
  letter-spacing: 0.3px;
  line-height: 1.15;
  cursor: pointer;
}
.callsign-no-match { color: #999; }
.comm-suffix { font-size: 0.7em; color: #b45309; margin-left: 1px; }
.owner-si { font-size: 0.62em; font-weight: 700; color: #003399; margin-left: 0.25em; }
/* Callsign: JS sets px to fit box; max tracks --strip-scale */
.strip-main .callsign-box {
  grid-area: cs;
  /* Below CLR △ so tip can paint over the C/S row edge; clicks on △ hit .cell-cto */
  position: relative;
  z-index: 0;
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

/* Shared ARR/DEP body — fixed height; pad BR so key shadows fit inside type frame */
.strip-grid {
  position: relative;
  display: grid;
  grid-template-columns: auto 1fr auto;
  height: var(--strip-body-h);
  min-height: var(--strip-body-h);
  max-height: var(--strip-body-h);
  overflow: hidden;
  padding: 0 var(--strip-key-shadow-pad-x) var(--strip-key-shadow-pad-y) 0;
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
/* TSAC: mirrors tobt-setby (P/A) in the dn cell — between FRUL and bottom expander ▼ */
.tsac-box.strip-left-dn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: calc(12px * var(--strip-scale, 1));
  height: calc(12px * var(--strip-scale, 1));
  min-width: calc(12px * var(--strip-scale, 1));
  min-height: calc(12px * var(--strip-scale, 1));
  margin: 0;
  padding: 0;
  border-radius: 1px;
  box-sizing: border-box;
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
  /* Same place-self as .tobt-setby / .strip-left-dn arrows */
  justify-self: center;
  align-self: center;
}
.tsac-box.tsac-empty {
  background: transparent;
  border: 2px solid var(--strip-ok-green);
}
.tsac-box.tsac-match {
  background: var(--strip-ok-green);
  border: 1px solid var(--strip-ok-green-border);
}
.tsac-box.tsac-mismatch {
  background: #e67e22;
  border: 1px solid #c45f0a;
}
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
  justify-self: end;
  align-self: stretch;
  width: 70%;
  justify-content: center;
  margin: 1px 0;
  padding: 0;
  font-size: var(--fs-left);
  line-height: 1;
  cursor: pointer;
  user-select: none;
}
.strip-left .atyp-box {
  grid-area: atyp;
  padding: 0 calc(2px * var(--strip-scale));
  font-size: var(--fs-left-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}
.strip-left .wtc-box {
  grid-area: wtc;
  padding: 0 calc(2px * var(--strip-scale));
  font-size: var(--fs-left-sm);
  overflow: hidden;
  cursor: pointer;
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
/* B757 / Tu204 WTC yellow (paper look also uses .pg-wtc-yellow; digital if ever enabled) */
.strip-left .wtc-box.wtc-yellow {
  background: #fddf5f;
  border: 1px solid #c9a82a;
  margin: 1px;
}
/* Slow ATYP (DEP) + heavy types (A388/A124/…): thick frame like non-M WTC */
.strip-left .atyp-box.plain {
  border: 1px solid #d8d8d8;
  padding: 0 calc(2px * var(--strip-scale));
}
.strip-left .atyp-box.boxed {
  border: 2px solid #111;
  margin: 0;
}
/* RTC: yellow ATYP for B757 / Tu204 heavy-as-leader types */
.strip-left .atyp-box.atyp-yellow {
  background: #fddf5f;
  border: 1px solid #c9a82a;
  margin: 1px;
}
/* Expander arrows: compact key; strip-bg fill + light raised shade */
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
  border: var(--strip-hairline) solid #c8c8c8;
  background: #ebebeb;
  box-shadow: var(--strip-key-shadow);
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
.strip-left .ctrl-arrow:hover { background: #e0e0e0; }
.strip-left .ctrl-arrow:active { background: #d4d4d4; }
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
  flex-shrink: 0;
  min-width: 0;
  overflow: visible;
  text-overflow: clip;
  color: #000;
  white-space: nowrap;
}
/* RTC: ES squawk under TSAT/CTOT when that slot is not already ASSR */
.strip-time.has-face-assr {
  flex-direction: column;
  gap: 0;
  line-height: 1;
}
.strip-time-assr {
  font-size: 0.85em;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: #000;
  line-height: 1;
}
/* CTOT and cancelled CTOT (SLC/SCL) — bold + amber */
.strip-time.time-ctot,
.strip-time.time-ctot .strip-time-lbl,
.strip-time.time-ctot .strip-time-val {
  font-weight: 700;
  color: #d97706;
}
/* FLS in TSAT slot — red */
.strip-time.time-fls,
.strip-time.time-fls .strip-time-lbl,
.strip-time.time-fls .strip-time-val {
  font-weight: 700;
  color: #c00000;
}
.time-fls, .label-fls { color: #c00000; }
/* SRM / SLC in TSAT slot — black, bolder than TB (500) */
.strip-time.time-cdm-sts,
.strip-time.time-cdm-sts .strip-time-lbl,
.strip-time.time-cdm-sts .strip-time-val {
  font-weight: 700;
  color: #000;
}
.tsat-mini { color: #00a000; }
/* TSAT window: green in ±5; yellow last minute; red after expiry */
.strip-time.tsat-window,
.strip-time.tsat-window .strip-time-lbl,
.strip-time.tsat-window .strip-time-val {
  color: #00a000;
}
.strip-time.tsat-warning,
.strip-time.tsat-warning .strip-time-lbl,
.strip-time.tsat-warning .strip-time-val {
  color: #d4a000;
}
.strip-time.tsat-flash,
.strip-time.tsat-flash .strip-time-lbl,
.strip-time.tsat-flash .strip-time-val {
  animation: tsat-flash-anim 0.7s step-end infinite;
}
@keyframes tsat-flash-anim {
  0%, 49% { color: #00a000; }
  50%, 100% { color: #d4a000; }
}
.strip-time.tsat-expired,
.strip-time.tsat-expired .strip-time-lbl,
.strip-time.tsat-expired .strip-time-val {
  color: #c00000;
  /* Red only — no strikethrough (QA: LRI161) */
}
.tobt-setby {
  display: flex;
  align-items: center;
  justify-content: center;
  /* Match TB time text (strip-time uses --fs-time + weight 500) */
  font-size: var(--fs-time);
  font-weight: 500;
  line-height: 1;
  color: #000;
  user-select: none;
}
.tobt-setby-p {
  color: #12b33a;
}
/* Red S — CDM flow PM not sent; fill ▲ cell so it is clickable */
button.tobt-setby-pm {
  width: calc(100% - 2px);
  height: var(--ctrl-arrow-h);
  max-height: var(--ctrl-arrow-h);
  min-height: 0;
  margin: 0;
  padding: 0;
  border: none;
  border-radius: 0;
  appearance: none;
  -webkit-appearance: none;
  background: transparent;
  box-shadow: none;
  color: #c00000;
  font: inherit;
  font-size: var(--fs-time);
  font-weight: 700;
  line-height: 1;
  cursor: pointer;
}
button.tobt-setby-pm:hover {
  background: rgba(192, 0, 0, 0.08);
}
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
  /*
   * SAAB ESSA DEP (default): col 4 is AHD (bottom) + EST/coo (top).
   * Keep 0.72fr so AHD matches pre-DepC width. RTC narrows this track for EST only
   * (RTC AHD sits in the RWY column, so that override is safe).
   */
  grid-template-columns: 0.72fr 0.92fr 0.68fr 0.72fr 0.87fr var(--hp-col) var(--hp-col) var(--rwy-col);
  grid-template-areas:
    'cs  cs  xfl coo .   hs  hp  rwy'
    'std cto cfl ahd sid sid sid sid';
}
.strip-grid-arr .strip-main {
  grid-template-columns: 0.92fr 0.72fr 0.68fr 0.72fr 0.87fr var(--hp-col) var(--hp-col) var(--rwy-col);
  grid-template-areas:
    'cs  cs  .   .   .   hs  hp  rwy'
    'cto std cfl ahd .   .   .   .';
}
/* RTC: no HS (ESSA-only); STD|triangle; SID|AHD; SID framed; PEL slot = xfl area (pink C when pending) */
.flight-strip.rtc-layout .strip-grid-arr .strip-main {
  grid-template-columns: 0.72fr 0.92fr 0.68fr 0.72fr 0.87fr var(--hp-col) var(--rwy-col);
  grid-template-areas:
    'cs  cs  xfl .   .   hp  rwy'
    'std cto cfl sid sid sid ahd';
}
.flight-strip.rtc-layout .exp-bottom-main-arr {
  grid-template-columns: 0.72fr 0.92fr 0.68fr 0.72fr 0.87fr var(--hp-col) var(--rwy-col);
}
.flight-strip.rtc-layout .exp-bottom-main-dep {
  /* RTC: EST/coo half-width track (AHD is in RWY col, not here) */
  grid-template-columns: 0.72fr 0.92fr 0.68fr 0.36fr 0.87fr var(--hp-col) var(--rwy-col);
}
.flight-strip.rtc-layout .strip-grid-dep .strip-main {
  /* RTC: EST/coo ~half; AHD uses RWY column — leave 0.36fr */
  grid-template-columns: 0.72fr 0.92fr 0.68fr 0.36fr 0.87fr var(--hp-col) var(--rwy-col);
  grid-template-areas:
    'cs  cs  xfl coo .   hp  rwy'
    'std cto cfl sid sid sid ahd';
}

/* ── Compact half-height SAAB (ARR + DEP share columns) ── */
.flight-strip.strip-compact {
  --strip-body-h: calc(25px * var(--bay-scale, var(--strip-scale)));
  /*
   * HP/RWY tracks are derived from body height. Freeze them to the full-strip
   * (50×scale) sizes so fr columns — especially C/S — match normal width.
   */
  --hp-col: calc(25px * var(--strip-scale) + 4px * var(--strip-scale));
  --rwy-col: calc(var(--hp-col) + 12px * var(--strip-scale));
}
.flight-strip.strip-compact .strip-left.strip-left-compact {
  --strip-left-arrow: var(--left-arrow-w);
  grid-template-columns: var(--left-arrow-w) calc(var(--left-atyp-w) + var(--left-wtc-w));
  grid-template-rows: 1fr 1fr;
  grid-template-areas:
    'gutter timeT'
    'gutter timeB';
}
.flight-strip.strip-compact .compact-gutter {
  grid-area: gutter;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
  align-self: stretch;
  justify-self: stretch;
  overflow: hidden;
}
.flight-strip.strip-compact .compact-gutter-half {
  flex: 1 1 0;
  min-height: 0;
  width: 100%;
  box-sizing: border-box;
}
.flight-strip.strip-compact .compact-gutter:hover .compact-gutter-half:not(.arrow-rea):not(.arrow-stale) {
  background: rgba(0, 0, 0, 0.04);
}
/* Same fills as expander ▲/▼ keys */
.flight-strip.strip-compact .compact-gutter-half.arrow-rea {
  background: #12b33a;
}
.flight-strip.strip-compact .compact-gutter-half.arrow-stale {
  background: var(--strip-amber);
}
/*
 * Compact main: same column tracks as normal DEP so C/S (span 2) and RWY
 * match normal strip width; ARR uses the same tracks (AHD/SID empty).
 */
.flight-strip.strip-compact .strip-grid-dep .strip-main,
.flight-strip.strip-compact .strip-grid-arr .strip-main {
  grid-template-rows: 1fr;
  /* minmax(0,…) so △ / text cannot widen fr tracks and squeeze C/S */
  grid-template-columns:
    minmax(0, 0.72fr) minmax(0, 0.92fr) minmax(0, 0.68fr) minmax(0, 0.72fr)
    minmax(0, 0.87fr) var(--hp-col) var(--hp-col) var(--rwy-col);
  grid-template-areas: 'cs cs std ahd sid sid sid rwy';
}
.flight-strip.strip-compact.rtc-layout .strip-grid-dep .strip-main,
.flight-strip.strip-compact.rtc-layout .strip-grid-arr .strip-main {
  grid-template-rows: 1fr;
  grid-template-columns:
    minmax(0, 0.72fr) minmax(0, 0.92fr) minmax(0, 0.68fr) minmax(0, 0.72fr)
    minmax(0, 0.87fr) var(--hp-col) var(--rwy-col);
  grid-template-areas: 'cs cs std ahd sid sid rwy';
}
.flight-strip.strip-compact .strip-main .callsign-box {
  grid-area: cs;
  align-self: stretch;
}
.flight-strip.strip-compact .strip-main .cell-std { grid-area: std; }
.flight-strip.strip-compact .strip-main .cell-ahd { grid-area: ahd; }
.flight-strip.strip-compact .strip-main .cell-sid { grid-area: sid; }
.flight-strip.strip-compact .strip-main .cell-rwy { grid-area: rwy; }
.flight-strip.strip-compact .cell-compact-spacer {
  pointer-events: none;
  border: none !important;
  outline: none !important;
  margin: 0;
  background: transparent;
}
/* Compact CTL/CFTO △ — square in cell, no frame, must not inflate grid tracks */
.flight-strip.strip-compact .cell-compact-cto {
  position: relative;
  display: flex !important;
  align-items: center;
  justify-content: center;
  border: none !important;
  outline: none !important;
  margin: 0 !important;
  padding: 0 !important;
  overflow: hidden;
  pointer-events: none;
  background: transparent;
  min-width: 0;
  max-width: 100%;
  z-index: 0;
}
.flight-strip.strip-compact .cell-compact-cto::after {
  content: none !important;
  display: none !important;
}
.flight-strip.strip-compact .cell-compact-cto .clearance-triangle,
.flight-strip.strip-compact .cell-compact-cto .clearance-triangle.mini {
  position: relative !important;
  left: auto !important;
  right: auto !important;
  top: auto !important;
  display: block;
  flex: 0 0 auto;
  /*
   * Same proportions as normal CTO cell: ~0.92fr wide × half body tall
   * (≈1.8∶1 at design scale). Cap by cell so tracks stay stable.
   * --strip-triangle-size keeps the same inset as the full strip CLR △.
   */
  --compact-cto-h: calc((var(--strip-body-h) - 6px) * var(--strip-triangle-size));
  --compact-cto-aspect: 1.8;
  width: min(
    calc(100% * var(--strip-triangle-size)),
    calc(var(--compact-cto-h) * var(--compact-cto-aspect))
  ) !important;
  height: auto !important;
  aspect-ratio: 1.8 / 1;
  max-height: var(--compact-cto-h);
  max-width: calc(100% * var(--strip-triangle-size));
  margin: 0 !important;
  padding: 0 !important;
  transform: none !important;
  box-sizing: border-box;
}
.flight-strip.strip-compact .strip-left .atyp-box,
.flight-strip.strip-compact .strip-left .wtc-box {
  cursor: pointer;
}
.flight-strip.rtc-layout .strip-main .cell-sid {
  position: relative;
  margin: 0 var(--frame-inset-x) var(--frame-inset-y-outer);
  outline: none !important;
}
.flight-strip.rtc-layout .strip-main .cell-sid::after {
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
/*
 * Framed data boxes: layout margins keep cell size/placement.
 * ::after draws the visible frame with extra vertical padding inside the cell.
 */
.strip-main .cell-xfl,
.strip-main .cell-coo,
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
.strip-main .cell-coo::after,
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
.cell-xfl.editable {
  cursor: pointer;
}
.cell-xfl:not(.ghost) {
  font-size: var(--fs-mid);
}
/* RTC: pink XFL while outbound/inbound coordination pending (same pink as ROF) */
.cell-xfl.xfl-coord-pink {
  color: #dc7cae;
  font-weight: 800;
}
/* RTC: amber XFL after ACC refused our outbound request (overrides CLR highlight) */
.cell-xfl.xfl-coord-amber {
  color: var(--strip-amber);
  font-weight: 800;
}
/* Pink C proposal: no cell frame (ARR PEL C / DEP EST C) */
.strip-main .cell-xfl.proposal::after,
.strip-main .cell-coo.proposal::after {
  content: none;
  border: none;
}
.cell-xfl.proposal,
.cell-coo.proposal {
  cursor: pointer;
}
/* ARR PEL pink C: match DEP EST C (--fs-data / 800); skip .fit-font while showing C */
.cell-xfl.proposal {
  font-size: var(--fs-data);
  font-weight: 800;
}
.cell-coo {
  grid-area: coo;
  font-size: var(--fs-ghost);
  font-weight: 700;
  border: none !important;
  line-height: 1;
}
.cell-coo.editable {
  cursor: pointer;
}
.cell-coo:not(.ghost) {
  font-size: var(--fs-data);
}
/* RTC: pink C on EST for inbound ACC proposal */
.cell-coo.coo-coord-pink {
  color: #dc7cae;
  font-size: var(--fs-data);
  font-weight: 800;
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
  background: #fddf5f;
  border-color: #c9a82a;
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
/* .cell.cell-cto — beat later .cell { overflow:hidden } so △ tip/stroke aren't clipped */
.cell.cell-cto {
  grid-area: cto;
  position: relative;
  display: block !important;
  border: none !important;
  background: transparent;
  padding: 0 !important;
  /* Bleed into neighbours so the contour meets STD/CFL frames */
  margin: 0 -1px !important;
  /*
   * Visible: takeoff △ apex + non-scaling stroke must not be clipped at the
   * cell edge (hidden + upward nudge previously ate the tip under C/S).
   */
  overflow: visible;
  align-self: stretch;
  justify-self: stretch;
  min-width: 0;
  min-height: 0;
  /* Above C/S so tip paints over the row seam and receives clicks there */
  z-index: 2;
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
  left: 50%;
  right: auto;
  top: 50%;
  display: block;
  width: calc(100% * var(--strip-triangle-size)) !important;
  height: calc(100% * var(--strip-triangle-size)) !important;
  margin: 0;
  padding: 0;
  border: none;
  /* Inactive: dim frame (same as all data boxes); round joins */
  fill: none;
  stroke: #d8d8d8;
  stroke-width: var(--strip-triangle-stroke);
  stroke-linejoin: round;
  stroke-linecap: round;
  overflow: visible;
  /* True center — no upward nudge (that pushed the tip into the clip edge) */
  transform: translate(-50%, -50%);
}
.cell-cto .clearance-triangle:not(.active) path {
  /* Screen-px stroke (not stretched by preserveAspectRatio=none); width tracks --strip-scale */
  vector-effect: non-scaling-stroke;
}
/* CTOT present: mid-grey outline (less dim than empty; thinner than ATD/ATA) */
.cell-cto .clearance-triangle.ctot-border:not(.active) {
  stroke: #888;
  stroke-width: var(--strip-triangle-stroke-ctot);
}
/* ATD / ATA: thicker green outline (departed / arrived) */
.cell-cto .clearance-triangle.green-border:not(.active) {
  stroke: #008001;
  stroke-width: var(--strip-triangle-stroke-green);
}
/* ATA sits in landing △ (point down) — high in the wide upper mass; +8pp with ATD */
.cell-cto .clearance-triangle.landing ~ .cto-ctot {
  transform: translateY(-22%);
  font-size: calc(8.5px * var(--strip-scale));
}
/* Takeoff △ time (CTOT / ATD) — same slot in lower mass */
.cell-cto .clearance-triangle.takeoff ~ .cto-ctot {
  transform: translateY(22%);
  font-size: calc(9px * var(--strip-scale));
}
.cell-cto .clearance-triangle.active {
  fill: #008001;
  stroke: #008001;
  stroke-width: var(--strip-triangle-stroke-active);
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
.cell-cfl:not(.ghost) {
  font-size: var(--fs-mid);
}
.cell-ahd.editable {
  cursor: pointer;
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
/* ESSA preferred DEP-E / ARR-E — black frame only; cell size stays put.
   Non-RTC SID has no databox margin, so the frame is inset to the same
   outer edge as STD/CFL/AHD/RWY. */
.cell-sid.sid-mdi-box:not(.ghost) {
  position: relative;
  box-shadow: none;
}
.strip-main .cell-sid.sid-mdi-box:not(.ghost)::after {
  content: '';
  position: absolute;
  left: var(--frame-inset-x);
  right: var(--frame-inset-x);
  /* Two-thirds of the way from the shared databox inset to the cell edge */
  top: calc(var(--frame-visual-pad-y) / 3);
  bottom: calc((var(--frame-inset-y-outer) + var(--frame-visual-pad-y)) / 3);
  border: calc(2px * var(--strip-scale, 1)) solid #111;
  box-sizing: border-box;
  pointer-events: none;
}
/* RTC SID is already margin-inset like the other databoxes */
.flight-strip.rtc-layout .strip-main .cell-sid.sid-mdi-box:not(.ghost)::after {
  left: 0;
  right: 0;
  top: calc(var(--frame-visual-pad-y) / 3);
  bottom: calc(var(--frame-visual-pad-y) / 3);
  border: calc(2px * var(--strip-scale, 1)) solid #111;
}
/* Uncleared XFL/CFL/AHD/SID (value present) — same amber as pending transfer */
.cell-xfl.clr-pending-hl:not(.ghost),
.cell-cfl.clr-pending-hl:not(.ghost),
.cell-ahd.clr-pending-hl:not(.ghost),
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
.assr-edit-input {
  display: block;
  width: 100%;
  min-width: 0;
  margin: 0;
  border: 1px solid #666;
  background: #fff;
  color: #000;
  caret-color: #000;
  -webkit-text-fill-color: #000;
  font-family: inherit;
  font-size: var(--fs-time);
  font-weight: 700;
  line-height: 1.2;
  text-align: center;
  text-transform: uppercase;
  padding: 0 calc(2px * var(--strip-scale));
  box-sizing: border-box;
  outline: none;
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

/* Actions — strip-bg fill + same raised shade as .ctrl-arrow / .exp-chip */
.strip-actions {
  display: flex;
  flex-direction: column;
  justify-content: stretch;
  align-items: stretch;
  gap: 0;
  background: #ebebeb;
  border: var(--strip-hairline) solid #c8c8c8;
  box-shadow: var(--strip-key-shadow);
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
  background: #ebebeb;
  color: #000;
  font-size: var(--fs-action);
  font-weight: 700;
  letter-spacing: 0.3px;
  text-transform: uppercase;
  text-align: center;
  cursor: pointer;
  padding: calc(2px * var(--strip-scale)) calc(3px * var(--strip-scale));
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  line-height: 1.1;
  box-sizing: border-box;
}
/* Two (or more) actions: hairline separator, no gap */
.strip-actions.multi-action .action-button:not(:last-child) {
  border-bottom: 1px solid #c8c8c8;
}
/*
 * Compact action keys: keep normal --fs-action when it fits (e.g. TAXI/CFTO/ASSUME);
 * labels stay one row; .fit-font shrinks only on overflow. ACK CLR starts smaller.
 */
.flight-strip.strip-compact .action-button {
  padding: 0 calc(1px * var(--strip-scale));
  letter-spacing: 0.1px;
  line-height: 1.05;
  overflow: hidden;
}
.flight-strip.strip-compact .action-text {
  white-space: nowrap;
}
.flight-strip.strip-compact .action-button.action-ack-clr {
  font-size: calc(7.5px * var(--strip-scale));
  letter-spacing: 0;
}
.flight-strip.strip-compact .action-button.action-ack-clr .action-text {
  white-space: normal; /* ACK / CLR may stack */
}
.action-button.action-start-up .action-text,
.flight-strip.strip-compact .action-button.action-start-up .action-text {
  white-space: pre-line; /* START\nUP stack in 48px key */
  line-height: 1.05;
  max-width: 100%;
}
.flight-strip.strip-compact .action-freq {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* Compact: two actions side-by-side (first/top action on the left) */
.flight-strip.strip-compact .strip-actions.multi-action {
  flex-direction: row;
}
.flight-strip.strip-compact .strip-actions.multi-action .action-button {
  flex: 1 1 0;
  min-width: 0;
  width: auto;
  height: 100%;
}
.flight-strip.strip-compact .strip-actions.multi-action .action-button:not(:last-child) {
  border-bottom: none;
  border-right: 1px solid #c8c8c8;
}
.action-button:hover { background: #e0e0e0; }
.action-button:active { background: #d4d4d4; }
.action-text {
  display: block;
  width: 100%;
  text-align: center;
}
.action-freq {
  /* Same size as TRANS / READY label on the action key */
  font-size: var(--fs-action);
  font-weight: 700;
  text-align: center;
  margin-top: calc(2px * var(--strip-scale));
}
.action-button.action-highlight,
.action-button.action-clnc-highlight {
  background: var(--strip-amber) !important;
}
/* Amber action-key text (inbound ASSUME / highlighted TRANS) — strip-bg fill, amber label */
.action-button.action-key-amber {
  background: #ebebeb !important;
  color: var(--strip-amber) !important;
}
.action-button.action-key-amber .action-text,
.action-button.action-key-amber .action-freq {
  color: var(--strip-amber) !important;
}
/* DCL status — coloured label on strip-bg key (not filled button) */
.action-button.action-dcl-sent {
  background: #ebebeb !important;
  color: #2e7d32 !important;
}
.action-button.action-dcl-sent .action-text {
  color: #2e7d32 !important;
}
.action-button.action-dcl-request {
  background: #ebebeb !important;
  color: #f9a825 !important;
}
.action-button.action-dcl-request .action-text {
  color: #f9a825 !important;
}
.action-button.action-dcl-error {
  background: #ebebeb !important;
  color: #e53935 !important;
}
.action-button.action-dcl-error .action-text {
  color: #e53935 !important;
}
/* Pink ROF label on strip-bg key — not filled pink background */
.action-button.action-rof-pink {
  background: #ebebeb !important;
  color: #dc7cae !important;
}
.action-button.action-rof-pink .action-text,
.action-button.action-rof-pink .action-freq {
  color: #dc7cae !important;
}

.gs-code {
  display: inline-block;
  min-width: 2.2em;
  font-weight: 800;
  letter-spacing: 0.04em;
}
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
