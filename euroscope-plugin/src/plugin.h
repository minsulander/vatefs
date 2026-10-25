#pragma once

#pragma warning(push, 0)
#include "EuroScopePlugIn.h"
#pragma warning(pop)

#include "json.hpp"
#include <ctime>
#include <map>
#include <set>
#include <string>
#include <vector>

namespace VatEFS
{

constexpr const char *TOPSKY_PLUGIN_NAME = "TopSky plugin";
constexpr const int TOPSKY_SSR_FUNCTION_ID = 667;

// Dummy radar screen class because we need it to access TopSky functions
class DummyRadarScreen;

class VatEFSPlugin : public EuroScopePlugIn::CPlugIn
{
    public:
    VatEFSPlugin();
    ~VatEFSPlugin();

    void OnFlightPlanFlightPlanDataUpdate(EuroScopePlugIn::CFlightPlan FlightPlan);
    void OnFlightPlanControllerAssignedDataUpdate(EuroScopePlugIn::CFlightPlan FlightPlan, int DataType);
    void OnFlightPlanDisconnect(EuroScopePlugIn::CFlightPlan FlightPlan);
    void OnFlightPlanFlightStripPushed(EuroScopePlugIn::CFlightPlan FlightPlan, const char * sSenderController, const char * sTargetController);
    void OnControllerPositionUpdate (EuroScopePlugIn::CController Controller);
    void OnControllerDisconnect (EuroScopePlugIn::CController Controller);
    void OnRadarTargetPositionUpdate (EuroScopePlugIn::CRadarTarget RadarTarget);
    EuroScopePlugIn::CRadarScreen *OnRadarScreenCreated ( const char * sDisplayName,
        bool NeedRadarContent,
        bool GeoReferenced,
        bool CanBeSaved,
        bool CanBeCreated );

    bool OnCompileCommand(const char *commandLine);
    void OnTimer(int counter);


    private:
    friend class DummyRadarScreen;

    void UpdateMyself();
    void DebugMessage(const std::string &message, const std::string &sender = "EFS");
    void DisplayMessage(const std::string &message, const std::string &sender = "EFS");
    bool UpdateScratchPad(const std::string &callsign, const std::string &content, const bool resetAfterSet = false);
    /**
     * Send ROF for target callsign on a writable FP scratchpad.
     * efsNative=false → TopSky `/ROF/TARGET/MYSELF` (sector-sequence validated).
     * efsNative=true  → EFS `/EFSROF/TARGET/MYSELF` (no TopSky; ESSA ground DEL/GND/TWR).
     */
    bool SendRof(const std::string &targetCallsign, bool efsNative = false);
    /**
     * Brittle: ESC → type callsign → ASEL (numpad +) → HOME → ASEL (.contactme PM).
     * No SDK send-PM API. Requires EuroScope window focus; remapped ASEL keys break this;
     * some ES versions may still need TAG hover for HOME.
     */
    bool SendContactMe(const std::string &targetCallsign);
    /**
     * EuroScope XFL exit coordination (InitiateCoordination).
     * Tries empty point + altitude first; falls back to LOP DCT point + altitude.
     * Same-level re-request (requested == live exit XFL): send ±1 ft nudge; store nudged
     * value on the outbound cycle for 2→1 accept/refuse matching. Does not use ESE COPX;
     * does not touch clearance / EST. Each successful call starts a fresh outbound cycle.
     */
    bool SendInitiateCoordination(const std::string &callsign, int altitudeFeet,
                                  const std::string &point, const std::string &targetController);
    void Refresh();
    bool FilterFlightPlan(EuroScopePlugIn::CFlightPlan FlightPlan);
    /** Poll tracking/handoff ownership and push UDP when ES state changes without a callback */
    void PollOwnershipChanges();
    /** Poll VCH + EFS annotations (H/S=4, CTL=3, EFSGA=5, DepC=6) — ES has no CAD DataType for annotations */
    void PollVchAnnotationChanges();
    /**
     * Ground Radar "Arrival stand" list item. The scratch GRP/S broadcast that sets
     * flight.stand is sent on handoff; the list already has the stand before that.
     */
    void PollGrpArrivalStands();
    /**
     * Poll exit (COPX/XFL) + entry (COPN/PEL) coordination + DirectTo.
     * ACC coordination replies often change these without a CAD callback.
     */
    void PollXflChanges();
    /** Append ES exit coordination altitude (XFL) to a CAD/FP JSON message */
    static void AppendXfl(nlohmann::json &message, EuroScopePlugIn::CFlightPlan FlightPlan,
                          std::stringstream *out = nullptr);
    /**
     * Coordination pending flags for RTC UI (same JSON fields for exit + entry):
     * - exitCoordPending (REQUESTED_BY_OTHER on exit OR entry) + Point / Altitude
     * - exitCoordOutbound (REQUESTED_BY_ME on exit OR entry OR next controller)
     * - exitCoordRefused only on explicit COORDINATION_STATE_REFUSED (not NONE after accept)
     * Arrivals use GetEntryCoordination*; departures use GetExitCoordination* plus
     * GetCoordinatedNextControllerState (ACC accept often updates next-ctrl only).
     * Always sets pending/outbound booleans (false clears backend sticky state).
     */
    static void AppendExitCoordProposal(nlohmann::json &message,
                                        EuroScopePlugIn::CFlightPlan FlightPlan);
    /**
     * Snapshot for PollXflChanges:
     * xfl|copx|direct|exitAlt|exitName|entryAlt|entryPoint|entryAltFt|entryPt|nextCtrl
     */
    static std::string MakeXflSnapshot(EuroScopePlugIn::CFlightPlan FlightPlan);
    /**
     * True when prev→snap is an exit (DEP) coordination accept that should set EST.
     * Explicit ACCEPTED / MANUAL_ACCEPTED on exit alt/name OR next controller after
     * REQUESTED_BY_ME. REQUESTED_BY_ME → NONE is unknown/cancelled (not accept);
     * refuse is COORDINATION_STATE_REFUSED (handled separately). Never entry-only / ARR.
     * Same-level re-request: sticky ACCEPTED without a fresh REQUESTED_BY_ME is NOT accept.
     */
    static bool ShouldAutoEstOnXflTransition(const std::string &prev, const std::string &snap);

    /**
     * Per InitiateCoordination outbound cycle. Same-level re-requests often leave ES in
     * ACCEPTED without a clean REQUESTED_BY_ME→ACCEPTED edge — we must not treat that as
     * a new accept, and we must latch any REFUSED tick for this cycle.
     *
     * Always close the cycle (clear forced outbound pending UI) when ES reports
     * ACCEPTED/MANUAL_ACCEPTED (exit alt/name OR next controller).
     *
     * Full SetEstCoo + accept sound when any of:
     * - saw REQUESTED_BY_ME this cycle, or
     * - not sticky before Initiate, or
     * - rising edge on exit alt, exit name, OR next controller to ACCEPTED — real ACC
     *   reply (next-ctrl often NONE→ACCEPTED with no REQUESTED_BY_ME). Per-channel rise
     *   matters: sticky ACCEPTED on exit alt must not hide a next-ctrl accept.
     *
     * Sticky same-level no-op only when every channel stayed ACCEPTED (no per-channel
     * rising edge) and never REQUESTED_BY_ME: clear pending (no accept sound); quiet
     * EST if XFL already matches.
     *
     * Real ACC often never shows ACCEPTED(4)/REFUSED(5) — only REQUESTED_BY_ME(2)→NONE(1):
     * - live XFL still == requestedAltFt → ACCEPT (SetEstCoo + exitCoordAccepted + clear pink)
     * - live XFL changed away from requested → REFUSE (exitCoordRefused + clear pink, no EST)
     *   (only on a ME→NONE channel edge — not "any channel is NONE")
     *
     * REQUESTED_BY_OTHER during an open cycle = ACC counter-proposal (ESMS 1000→4000):
     * close outbound without refuse; pink inbound via AppendExitCoordProposal.
     *
     * exitCoordRefused is posted once on the refuse edge — CAD/Poll must NOT re-emit
     * refuseNotified on every update (would revive amber after DepC / Accept).
     *
     * Same-level re-request nudge: SendInitiateCoordination sends currentXfl+1 (or -1)
     * when the requested level equals the live exit XFL, and stores that nudged value in
     * requestedAltFt. Accept keeps 9001; refuse reverts to 9000 — distinguishable via the
     * match above. First-time / different level: exact requested feet (no nudge).
     * Best-effort: dense poll (OnTimer + radar + CAD) latches any brief REFUSED(5) on
     * alt/name/next; if refuseLatched, NEVER EST on the following NONE clear.
     * Inbound AcceptCoordination / REQUESTED_BY_OTHER never sets EST (except backend
     * ESMS auto-DepC on Accept of 4000).
     */
    struct OutboundCoordCycle {
        bool active = false;
        /** Altitude actually sent to InitiateCoordination (nudged ±1 on same-level re-request). */
        int requestedAltFt = 0;
        std::string requestedPoint;
        /** Observed REQUESTED_BY_ME this cycle (Begin and/or Update). */
        bool sawRequestedByMe = false;
        /**
         * Exit/next was already ACCEPTED/MANUAL_ACCEPTED before InitiateCoordination.
         * Sticky same-level re-request — skip accept-sound/EST only when ES never left
         * ACCEPTED (no rising edge) and we never saw REQUESTED_BY_ME. A later rising
         * ACCEPTED (e.g. next-ctrl after NONE) is a real ACC accept → SetEstCoo.
         */
        bool stickyAcceptedBeforeInitiate = false;
        bool acceptNotified = false;
        /** Latched once REFUSED seen this cycle — survives brief ES clear to NONE. */
        bool refuseLatched = false;
        bool refuseNotified = false;
        /** Cleared pink without EST (REQUESTED_BY_ME → NONE / unknown cancel). */
        bool cancelledNotified = false;
        int lastExitAltState = 0;
        int lastExitNameState = 0;
        int lastNextCtrlState = 0;
        /** Wall time of Initiate (debug / diagnostics). */
        std::time_t startedAt = 0;
    };
    void BeginOutboundCoordCycle(const std::string &cs, int altFt, const std::string &point,
                                 EuroScopePlugIn::CFlightPlan fp,
                                 bool stickyAcceptedBeforeInitiate = false);
    /**
     * Advance one outbound cycle from live ES states. May post UDP (accept/refuse/outbound).
     * Returns true if a coordination edge message was posted.
     */
    bool UpdateOutboundCoordCycle(const std::string &cs, EuroScopePlugIn::CFlightPlan fp);
    bool SendAcceptCoordination(const std::string &callsign);
    bool SendRefuseCoordination(const std::string &callsign);
    std::string GetHoldShort(const std::string &callsign);
    bool SetHoldShort(const std::string &callsign, const std::string &holdShort);
    /** VCH CTL flag — strip annotation 3 ("CTL" or empty) */
    bool GetVchCtl(const std::string &callsign);
    bool SetVchCtl(const std::string &callsign, bool clearedToLand);
    /** EFS soft go-around — strip annotation 5 ("EFSGA" or empty); not TopSky MISAP_ */
    bool GetEfsGoAround(const std::string &callsign);
    bool SetEfsGoAround(const std::string &callsign, bool goAround);
    /** Departure Coordination — strip annotation 6 ("DepC" or empty; reads legacy "EST") */
    bool GetEstCoo(const std::string &callsign);
    bool SetEstCoo(const std::string &callsign, bool est);

    bool disabled;
    bool debug;
    std::time_t enabledTime;
    /** After .efs start: dump all FPs + clearance + CDM (ES does not re-fire on connect) */
    bool pendingFullRefresh;
    /** Earliest time to run pendingFullRefresh (+2s after StartBackend for bind) */
    std::time_t fullRefreshNotBefore;
    /**
     * Callsigns whose airway expansion was requested because a strip spawned
     * (or the filed route changed on an existing strip). One GetExtractedRoute
     * per timer tick — the .efs start dump must not expand every flight plan.
     */
    std::vector<std::string> routeExpandQueue;
    void EnqueueRouteExpand(const std::string &callsign);
    void ExpandOneQueuedRoute();
    void* udpReceiveSocket; // SOCKET (using void* to avoid including winsock2.h in header)
    bool winsockInitialized;
    std::string connectionError;
    std::vector<DummyRadarScreen *> dummyRadarScreens;

    void* backendProcess; // HANDLE to the efs.exe process (void* to avoid windows.h in header)
    void* backendOutputRead; // HANDLE to the read end of stdout/stderr pipe
    void* backendLogFile; // HANDLE to VatEFS-YYMMDD-HHMM.log
    std::string backendLineBuf; // partial line buffer for pipe reads
    bool backendAutoRestartUsed; // true after one automatic restart attempt
    void StartBackend();
    void StopBackend();
    void CleanupBackendHandles();
    void PollBackendOutput();

    void InitializeWinsock();
    void CleanupWinsock();
    void InitializeUdpReceiveSocket();
    void CleanupUdpReceiveSocket();
    void ReceiveUdpMessages();
    void PostJson(const nlohmann::json& jsonData, const char *whereaboutsInDaCode);
    void PollCdmDataFiles(bool sendHeartbeat = false);
    /** CDM plugin stores setBy in strip annotation 0 field 9: ASRT/.../setBy/ */
    std::string GetCdmTobtSetBy(const std::string &callsign);
    /** CDM ASRT / Ready Startup — annotation field 0 (HHMM or empty) */
    std::string GetCdmAsrt(const std::string &callsign);
    /** CDM TSAC — annotation field 1 (HHMM); TSAT communicated to pilot */
    std::string GetCdmTsac(const std::string &callsign);
    /** CDM TOBT — annotation field 2 (HHMM); fills gaps when CDM_data_*.txt omits the flight */
    std::string GetCdmTobt(const std::string &callsign);
    /** CDM TSAT — annotation field 3 (HHMM); what ES displays, may lead CDM_data_*.txt */
    std::string GetCdmTsat(const std::string &callsign);
    /** CDM TTOT — annotation field 4 (HHMM) */
    std::string GetCdmTtot(const std::string &callsign);
    /** CDM CTOC — annotation field 8 (HHMM); CTOT communicated to pilot */
    std::string GetCdmCtoc(const std::string &callsign);
    /** Write CDM slash-fields in annotation 0 (e.g. TOBT=2, setBy=9, ASRT=0) */
    bool SetCdmStripFields(const std::string &callsign, const std::map<int, std::string> &fields);

    // Last snapshot of CDM_data_*.txt lines: callsign -> "tobt|tsat|ttot|ctot|reason|setBy|asrt|tsac|ctoc"
    std::map<std::string, std::string> lastCdmFileSnapshot;

    // Last sent tracking|handoff ownership per callsign (detects ES-initiated assume/transfer/accept)
    std::map<std::string, std::string> lastOwnershipSnapshot;
    // Callsigns for which we have posted a flightPlanDataUpdate (CAD/VCH can arrive first)
    std::set<std::string> fplPushedCallsigns;

    // Last sent VCH hold-short (annotation 4) per callsign
    std::map<std::string, std::string> lastHoldShortSnapshot;
    // Last sent VCH CTL (annotation 3) per callsign — "1" / "0"
    std::map<std::string, std::string> lastCtlSnapshot;
    // Last sent EFS soft G/A (annotation 5) per callsign — "1" / "0"
    std::map<std::string, std::string> lastEfsGaSnapshot;
    // Last sent DepC / Departure Coordination (annotation 6) per callsign — "1" / "0"
    std::map<std::string, std::string> lastEstCooSnapshot;
    // Last sent "xfl|copx|direct|altState|nameState" (ACC coord often skips CAD)
    std::map<std::string, std::string> lastXflSnapshot;
    // Last Ground Radar arrival-stand list value sent per callsign
    std::map<std::string, std::string> lastGrpStandSnapshot;
    // GRP tag query faulted once — stop calling into that DLL
    bool grpStandPollFailed = false;
    // Per-callsign outbound InitiateCoordination cycle (accept/refuse edges once each)
    std::map<std::string, OutboundCoordCycle> outboundCoordCycles;

    static bool IsValidUtf8(const char* str);
    static std::string SanitizeUtf8(const char* str);
    void SetJsonIfValidUtf8(nlohmann::json& j, const char* key, const char* value);
    void SetJsonWithUtf8Replace(nlohmann::json& j, const char* key, const char* value);
    /** Append tracking/handoff callsigns + sector indicators (SI) from EuroScope */
    void AppendOwnershipFields(nlohmann::json &message, EuroScopePlugIn::CFlightPlan FlightPlan,
                               std::stringstream *out = nullptr);
    /**
     * CAD / VCH polls can fire before EuroScope emits OnFlightPlanFlightPlanDataUpdate
     * (e.g. after .getfp). Push a full FPL once so the backend has ADEP/ADES for strips.
     */
    void EnsureFlightPlanPushed(EuroScopePlugIn::CFlightPlan FlightPlan);
    /** Attach ADEP/ADES/ALTN/ATYP when CAD arrives without a prior FPL message. */
    void AppendBasicFlightPlanFields(nlohmann::json &message, EuroScopePlugIn::CFlightPlan FlightPlan);
};

class DummyRadarScreen : public EuroScopePlugIn::CRadarScreen
{
    public:
    DummyRadarScreen(VatEFSPlugin *plugin);

    void OnAsrContentToBeClosed ( void );
    void AllocateSSR(const char *callsign);
    void ToggleClearanceFlag(const char *callsign);
    /** Toggle only if current clearance ≠ desired (ES has no absolute set API). */
    void SetClearanceFlag(const char *callsign, bool desired);
    /**
     * Like SetClearanceFlag, but when already at desired flip-flops once so VATSIM
     * rebroadcasts CLR (peer reassert after `.efs refresh`).
     */
    void ForceClearanceFlag(const char *callsign, bool desired);

    private:
    VatEFSPlugin *plugin;
};

} // namespace VatEFS
