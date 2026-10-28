#include "plugin.h"
#include "Version.h"
#include "local-ip.h"

#include "json.hpp"
#include <algorithm>
#include <chrono>
#include <cstring>
#include <ctime>
#include <format>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>
#include <windows.h>
#include <shlwapi.h>
// #include <winsock2.h>
// #include <ws2tcpip.h>

#pragma comment(lib, "ws2_32.lib")
#pragma comment(lib, "Shlwapi.lib")

// Convert an ANSI code page string (from EuroScope) to UTF-8 (for JSON).
// For example, the middle dot '·' is 0xB7 in Windows-1252 but must become 0xC2 0xB7 in UTF-8.
static std::string AnsiToUtf8(const char *ansi)
{
    if (!ansi || !*ansi) return ansi ? "" : "";
    int wideLen = MultiByteToWideChar(CP_ACP, 0, ansi, -1, NULL, 0);
    if (wideLen == 0) return ansi;
    std::wstring wide(wideLen, 0);
    MultiByteToWideChar(CP_ACP, 0, ansi, -1, &wide[0], wideLen);
    int utf8Len = WideCharToMultiByte(CP_UTF8, 0, wide.c_str(), -1, NULL, 0, NULL, NULL);
    if (utf8Len == 0) return ansi;
    std::string utf8(utf8Len, 0);
    WideCharToMultiByte(CP_UTF8, 0, wide.c_str(), -1, &utf8[0], utf8Len, NULL, NULL);
    if (!utf8.empty() && utf8.back() == '\0') utf8.pop_back();
    return utf8;
}

/** ICAO SSR: exactly four digits 0–7 (reject interim junk like "9875"). */
static bool IsValidOctalSquawk(const char *squawk)
{
    if (!squawk || strlen(squawk) != 4) return false;
    for (int i = 0; i < 4; ++i) {
        if (squawk[i] < '0' || squawk[i] > '7') return false;
    }
    return true;
}

/**
 * Ground-state tokens — both modes for READ:
 *   Native ES / GRpluginSettings "actual" names: LINEUP, TAXI, DEPA, PUSH, STUP, …
 *   Legacy GRP display aliases (if still present in scratch): xLU, TXO, S/P, …
 *
 * WRITE uses native ES names only — GNG display labels are overridden by
 * GRpluginSettings.txt; flashing S/P/TXO does not set GetGroundState().
 */
static bool IsGroundStateToken(const std::string &scratch)
{
    return scratch == "LINEUP" || scratch == "ONFREQ" || scratch == "DE-ICE" ||
           scratch == "TAXI" || scratch == "TXIN" || scratch == "DEPA" ||
           scratch == "PUSH" || scratch == "STUP" || scratch == "ARR" ||
           scratch == "PARK" || scratch == "NSTS" || scratch == "NOSTATE" ||
           scratch == "xLU" || scratch == "XLU" || scratch == "xTO" || scratch == "XTO" ||
           scratch == "TXO" || scratch == "TXI" || scratch == "FRQ" || scratch == "RDY" ||
           scratch == "S/U" || scratch == "S/P" || scratch == "PRK";
}

/**
 * Canonical VatEFS → token written to ES scratch.
 * Prefer native ES names (PUSH/STUP/TAXI/LINEUP/…) — matches what ES reports
 * in groundstate when set from the client; GRP aliases (S/P, TXO) do not stick.
 */
static std::string ToEsGroundStateWriteToken(const std::string &state)
{
    // Map legacy GRP aliases → native if backend ever sends them
    if (state == "xLU" || state == "XLU") return "LINEUP";
    if (state == "xTO" || state == "XTO") return "DEPA";
    if (state == "TXO") return "TAXI";
    if (state == "TXI") return "TXIN";
    if (state == "FRQ") return "ONFREQ";
    if (state == "RDY") return "DE-ICE";
    if (state == "S/U") return "STUP";
    if (state == "S/P") return "PUSH";
    if (state == "PRK") return "PARK";
    // Canonical / already-native passthrough
    return state;
}

/** Precise scratch tokens that refine coarse GetGroundState() PUSH/TAXI/DEPA. */
static bool IsPreciseGroundStateToken(const std::string &token)
{
    return token == "xLU" || token == "XLU" || token == "xTO" || token == "XTO" ||
           token == "TXO" || token == "TXI" || token == "FRQ" || token == "RDY" ||
           token == "S/U" || token == "S/P" || token == "PRK" ||
           token == "LINEUP" || token == "ONFREQ" || token == "DE-ICE" ||
           token == "STUP" || token == "TXIN" || token == "DEPA" ||
           token == "NSTS" || token == "NOSTATE";
}

/**
 * Emit groundstate for backend.
 * Prefer precise scratch (LINEUP/xLU/…) over coarse GetGroundState() TAXI/PUSH.
 */
static void SetJsonGroundstateFromFpOrScratch(
    nlohmann::json &message,
    EuroScopePlugIn::CFlightPlan FlightPlan)
{
    const char *gs = FlightPlan.GetGroundState();
    std::string gsStr = gs ? gs : "";
    const char *scratch = FlightPlan.GetControllerAssignedData().GetScratchPadString();
    std::string scratchStr = scratch ? scratch : "";

    if (IsPreciseGroundStateToken(scratchStr)) {
        message["groundstate"] = scratchStr;
        return;
    }
    if (gsStr.empty() && IsGroundStateToken(scratchStr)) {
        message["groundstate"] = scratchStr;
        return;
    }
    message["groundstate"] = gsStr;
}

namespace VatEFS
{

extern "C" IMAGE_DOS_HEADER __ImageBase;
char DllPathFile[_MAX_PATH];

VatEFSPlugin::VatEFSPlugin()
: CPlugIn(EuroScopePlugIn::COMPATIBILITY_CODE, PLUGIN_NAME, PLUGIN_VERSION, PLUGIN_AUTHOR, PLUGIN_LICENSE)
{
    disabled = true; // ... until connected - see OnTimer
    debug = false;
    pendingFullRefresh = false;
    fullRefreshNotBefore = 0;
    udpReceiveSocket = nullptr;
    winsockInitialized = false;
    backendProcess = nullptr;
    backendOutputRead = nullptr;
    backendLogFile = nullptr;
    backendAutoRestartUsed = false;

    GetModuleFileNameA(HINSTANCE(&__ImageBase), DllPathFile, sizeof(DllPathFile));
    std::string settingsPath = DllPathFile;
    settingsPath.resize(settingsPath.size() - strlen("VatEFS.dll"));
    settingsPath += "VatEFSPlugin.txt";
    std::ifstream settingsFile(settingsPath);
    if (settingsFile.is_open()) {
        std::string line;
        while (std::getline(settingsFile, line)) {
            if (line.empty()) continue;
            for (auto &c : line)
                c = (char)std::tolower(c);
            if (line == "debug")
                debug = true;
            else
                DisplayMessage("Unknown setting: " + line);
        }
    }
    DebugMessage("Version " + std::string(PLUGIN_VERSION));
}

VatEFSPlugin::~VatEFSPlugin()
{
    // Kill the backend process if we started it
    if (backendProcess != nullptr) {
        DWORD exitCode = 0;
        if (GetExitCodeProcess((HANDLE)backendProcess, &exitCode) && exitCode == STILL_ACTIVE) {
            TerminateProcess((HANDLE)backendProcess, 0);
            WaitForSingleObject((HANDLE)backendProcess, 5000);
        }
        CloseHandle((HANDLE)backendProcess);
        backendProcess = nullptr;
    }
    CleanupBackendHandles();
    CleanupUdpReceiveSocket();
    CleanupWinsock();
}

void VatEFSPlugin::OnFlightPlanFlightPlanDataUpdate(EuroScopePlugIn::CFlightPlan FlightPlan)
{
    try {
        if (disabled || !FilterFlightPlan(FlightPlan)) return;

        std::string callsign = FlightPlan.GetCallsign();
        if (callsign.empty() || callsign.length() > 20) {
            DisplayMessage("OnFlightPlanFlightPlanDataUpdate: Invalid callsign");
            return;
        }

        EuroScopePlugIn::CFlightPlanData fpData = FlightPlan.GetFlightPlanData();
        if (!fpData.IsReceived()) {
            DebugMessage("Invalid flight plan data");
            return;
        }

        nlohmann::json message = nlohmann::json::object();
        message["type"] = "flightPlanDataUpdate";
        SetJsonIfValidUtf8(message, "callsign", callsign.c_str());

        std::stringstream out;
        out << "FlightPlanDataUpdate " << callsign;

        // Safe state checks
        int state = FlightPlan.GetState();
        int fpstate = FlightPlan.GetFPState();
        if (state >= 0 && state <= 10 && fpstate >= 0 && fpstate <= 10) {
            out << " state " << state << " fpstate " << fpstate;
        }

        if (FlightPlan.GetSimulated()) out << " simulated";

        AppendOwnershipFields(message, FlightPlan, &out);
        const char *nextController = FlightPlan.GetCoordinatedNextController();
        if (nextController && strlen(nextController) < 20) {
            if (strlen(nextController) > 0) out << " nextController " << nextController;
            SetJsonIfValidUtf8(message, "nextController", nextController);
            auto nextCon = ControllerSelect(nextController);
            if (nextCon.IsValid())
                message["nextControllerFrequency"] = nextCon.GetPrimaryFrequency();
            else
                message["nextControllerFrequency"] = 0;
        }

        const char *aircraftType = fpData.GetAircraftFPType();
        if (aircraftType && strlen(aircraftType) > 0 && strlen(aircraftType) < 20) {
            SetJsonIfValidUtf8(message, "aircraftType", aircraftType);
        }
        SetJsonIfValidUtf8(message, "wakeTurbulence", (std::string("") + fpData.GetAircraftWtc()).c_str());
        // Unextracted AC info — ICAO (B738/M-VW/C) or FAA (PC24/G); always send (even "")
        {
            const char *acInfo = fpData.GetAircraftInfo();
            if (acInfo && strlen(acInfo) < 120) {
                message["aircraftInfo"] = *acInfo ? AnsiToUtf8(acInfo) : "";
                if (*acInfo) out << " acInfo " << acInfo;
            } else {
                message["aircraftInfo"] = "";
            }
        }
        // FAA-style nav capability letter (same codes as TYPE/G suffix) + RVSM flag
        {
            char cap = fpData.GetCapibilities();
            char capStr[2] = {cap == 0 ? '?' : cap, '\0'};
            SetJsonIfValidUtf8(message, "capabilities", capStr);
            message["rvsm"] = (bool)fpData.IsRvsm();
            out << " cap " << capStr << (fpData.IsRvsm() ? " RVSM" : "");
        }
        // Engine type for SLOW/low-speed: P/T = propeller, J = jet, E = electric, ? = unknown
        {
            char eng = fpData.GetEngineType();
            char engStr[2] = {eng == 0 ? '?' : eng, '\0'};
            SetJsonIfValidUtf8(message, "engineType", engStr);
        }

        const char *origin = fpData.GetOrigin();
        if (origin && strlen(origin) < 10) SetJsonIfValidUtf8(message, "origin", origin);
        const char *destination = fpData.GetDestination();
        if (destination && strlen(destination) < 10)
            SetJsonIfValidUtf8(message, "destination", destination);
        const char *alternate = fpData.GetAlternate();
        if (alternate && strlen(alternate) < 10)
            SetJsonIfValidUtf8(message, "alternate", alternate);
        SetJsonIfValidUtf8(message, "flightRules", fpData.GetPlanType());
        {
            char comm = fpData.GetCommunicationType();
            char commStr[2] = {comm == 0 ? '0' : comm, '\0'};
            SetJsonIfValidUtf8(message, "communicationType", commStr);
        }
        // Swedish L/U·TXO etc. often only in scratch — fall back when GetGroundState empty
        SetJsonGroundstateFromFpOrScratch(message, FlightPlan);
        message["clearance"] = (bool)FlightPlan.GetClearenceFlag();

        const char *route = fpData.GetRoute();
        if (route && *route && strlen(route) < 1000)
            message["route"] = AnsiToUtf8(route);

        // Filed cruise TAS (FPL) — shown on paper DEP strips (e.g. N0430)
        {
            int tas = fpData.GetTrueAirspeed();
            if (tas > 0 && tas < 1000) {
                out << " tas " << tas;
                message["tas"] = tas;
            }
        }

        // Filed cruise altitude (FPL item 15) — RFL fallback when CAD final is unset
        {
            int altitude = fpData.GetFinalAltitude();
            if (altitude > 0 && altitude <= 100000) {
                out << " altitude " << altitude;
                message["altitude"] = altitude;
            }
        }

        // FPL item 18 remarks (for CALLSIGN/CS/C/S telephony parsing)
        const char *fplRemarks = fpData.GetRemarks();
        if (fplRemarks && strlen(fplRemarks) < 1000)
            message["fplRemarks"] = *fplRemarks ? AnsiToUtf8(fplRemarks) : "";

        const char *arrRwy = fpData.GetArrivalRwy();
        const char *starName = fpData.GetStarName();
        const char *depRwy = fpData.GetDepartureRwy();
        const char *sidName = fpData.GetSidName();

        if (arrRwy && *arrRwy && strlen(arrRwy) < 5) SetJsonIfValidUtf8(message, "arrRwy", arrRwy);
        if (starName && *starName && strlen(starName) < 50)
            message["star"] = AnsiToUtf8(starName);
        // Always send depRwy (empty when cleared) so FPR SID preview stays in sync with ES
        if (depRwy && *depRwy && strlen(depRwy) < 5) {
            message["depRwy"] = AnsiToUtf8(depRwy);
            out << " depRwy " << depRwy;
        } else {
            message["depRwy"] = "";
            out << " depRwy (none)";
        }
        // Always send sid (empty when cleared) so the backend can drop a stale GetSid()
        if (sidName && *sidName && strlen(sidName) < 50) {
            message["sid"] = AnsiToUtf8(sidName);
            out << " sid " << sidName;
        } else {
            message["sid"] = "";
            out << " sid (none)";
        }

        const char *eobtRaw = fpData.GetEstimatedDepartureTime();
        if (eobtRaw && eobtRaw[0] != '\0') {
            // EuroScope returns uncompiled EOBT which is often < 4 digits (e.g. "945").
            // Pad/truncate to HHmm so the backend always receives a usable value.
            std::string eobtDigits;
            for (const char *p = eobtRaw; *p; ++p) {
                if (*p >= '0' && *p <= '9') eobtDigits.push_back(*p);
            }
            if (!eobtDigits.empty()) {
                if (eobtDigits.size() > 4) eobtDigits = eobtDigits.substr(0, 4);
                while (eobtDigits.size() < 4) eobtDigits.insert(eobtDigits.begin(), '0');
                out << " eobt " << eobtDigits;
                message["eobt"] = eobtDigits;
            }
        }

        // Filed EET (FPL item 15) — HHmm from enroute hours/minutes
        {
            const char *eh = fpData.GetEnrouteHours();
            const char *em = fpData.GetEnrouteMinutes();
            std::string hh, mm;
            if (eh) {
                for (const char *p = eh; *p; ++p)
                    if (*p >= '0' && *p <= '9') hh.push_back(*p);
            }
            if (em) {
                for (const char *p = em; *p; ++p)
                    if (*p >= '0' && *p <= '9') mm.push_back(*p);
            }
            if (!hh.empty() || !mm.empty()) {
                while (hh.size() < 2) hh.insert(hh.begin(), '0');
                if (hh.size() > 2) hh = hh.substr(hh.size() - 2);
                while (mm.size() < 2) mm.insert(mm.begin(), '0');
                if (mm.size() > 2) mm = mm.substr(0, 2);
                std::string filedEet = hh + mm;
                out << " filedEet " << filedEet;
                message["filedEet"] = filedEet;
            }
        }

        // Endurance (FPL item 19 E/) — for SUP field
        {
            const char *fh = fpData.GetFuelHours();
            const char *fm = fpData.GetFuelMinutes();
            std::string hh, mm;
            if (fh) {
                for (const char *p = fh; *p; ++p)
                    if (*p >= '0' && *p <= '9') hh.push_back(*p);
            }
            if (fm) {
                for (const char *p = fm; *p; ++p)
                    if (*p >= '0' && *p <= '9') mm.push_back(*p);
            }
            if (!hh.empty() || !mm.empty()) {
                while (hh.size() < 2) hh.insert(hh.begin(), '0');
                if (hh.size() > 2) hh = hh.substr(hh.size() - 2);
                while (mm.size() < 2) mm.insert(mm.begin(), '0');
                if (mm.size() > 2) mm = mm.substr(0, 2);
                std::string endurance = hh + mm;
                out << " endurance " << endurance;
                message["endurance"] = endurance;
            }
        }

        // Pilot name (FPL item 19 C/) — statistics / FP when available
        {
            const char *pilot = FlightPlan.GetPilotName();
            if (pilot && *pilot && strlen(pilot) < 80) {
                message["pilotName"] = AnsiToUtf8(pilot);
                out << " pilot " << pilot;
            }
        }

        // Prediction points ≈ minutes remaining — used as ETB approximation
        int ete = FlightPlan.GetPositionPredictions().GetPointsNumber();
        if (ete >= 0 && ete <= 3600) { // Reasonable ETE range
            out << " ete " << ete;
            message["ete"] = ete;
        }

        // Minutes until entry into my sectors (0 = inside, -1 = never) — TopSky ETN
        int sectorEntryMin = FlightPlan.GetSectorEntryMinutes();
        if (sectorEntryMin >= 0) {
            out << " etn " << sectorEntryMin;
            message["sectorEntryMin"] = sectorEntryMin;
        }

        // SID/route changes can recalculate COPX / XFL without a CAD callback
        AppendXfl(message, FlightPlan, &out);

        DebugMessage(out.str());
        PostJson(message, "OnFlightPlanFlightPlanDataUpdate");
        fplPushedCallsigns.insert(callsign);
    } catch (const std::exception &e) {
        DisplayMessage(std::string("OnFlightPlanFlightPlanDataUpdate exception: ") + e.what());
    } catch (...) {
        DisplayMessage("OnFlightPlanFlightPlanDataUpdate: Unknown exception");
    }
}

void VatEFSPlugin::EnsureFlightPlanPushed(EuroScopePlugIn::CFlightPlan FlightPlan)
{
    if (!FlightPlan.IsValid()) return;
    const char *csRaw = FlightPlan.GetCallsign();
    if (!csRaw || csRaw[0] == '\0') return;
    std::string cs = csRaw;
    if (fplPushedCallsigns.count(cs)) return;
    OnFlightPlanFlightPlanDataUpdate(FlightPlan);
}

void VatEFSPlugin::AppendBasicFlightPlanFields(nlohmann::json &message,
                                               EuroScopePlugIn::CFlightPlan FlightPlan)
{
    try {
        if (!FlightPlan.IsValid()) return;
        EuroScopePlugIn::CFlightPlanData fpData = FlightPlan.GetFlightPlanData();
        if (!fpData.IsReceived()) return;
        const char *origin = fpData.GetOrigin();
        if (origin && strlen(origin) > 0 && strlen(origin) < 10)
            SetJsonIfValidUtf8(message, "origin", origin);
        const char *destination = fpData.GetDestination();
        if (destination && strlen(destination) > 0 && strlen(destination) < 10)
            SetJsonIfValidUtf8(message, "destination", destination);
        const char *alternate = fpData.GetAlternate();
        if (alternate && strlen(alternate) > 0 && strlen(alternate) < 10)
            SetJsonIfValidUtf8(message, "alternate", alternate);
        const char *aircraftType = fpData.GetAircraftFPType();
        if (aircraftType && strlen(aircraftType) > 0 && strlen(aircraftType) < 20)
            SetJsonIfValidUtf8(message, "aircraftType", aircraftType);
    } catch (...) {
    }
}

void VatEFSPlugin::OnFlightPlanControllerAssignedDataUpdate(EuroScopePlugIn::CFlightPlan FlightPlan, int DataType)
{
    try {
        if (disabled || !FilterFlightPlan(FlightPlan)) return;

        // CAD often arrives before / without a separate FPL callback (e.g. FP GET).
        EnsureFlightPlanPushed(FlightPlan);

        std::string callsign = FlightPlan.GetCallsign();
        if (callsign.empty() || callsign.length() > 20) {
            DisplayMessage("OnFlightPlanControllerAssignedDataUpdate: Invalid callsign");
            return;
        }

        if (DataType < EuroScopePlugIn::CTR_DATA_TYPE_SQUAWK || DataType > EuroScopePlugIn::CTR_DATA_TYPE_DIRECT_TO) {
            DebugMessage("Invalid DataType received: " + std::to_string(DataType));
            return;
        }

        std::stringstream out;
        out << "ControllerAssignedDataUpdate " << callsign;

        nlohmann::json message = nlohmann::json::object();
        message["type"] = "controllerAssignedDataUpdate";
        SetJsonIfValidUtf8(message, "callsign", callsign.c_str());

        AppendOwnershipFields(message, FlightPlan, &out);

        const EuroScopePlugIn::CFlightPlanControllerAssignedData ctrData =
        FlightPlan.GetControllerAssignedData();

        // Always attach XFL — COPX exit level has no dedicated CTR_DATA_TYPE
        AppendXfl(message, FlightPlan, &out);
        // Advance outbound cycle before overwriting snapshot. Cycle posts accept/refuse
        // edges itself (once per Initiate). Sticky ACCEPTED after same-level re-request
        // is not a new accept.
        {
            const std::string newSnap = MakeXflSnapshot(FlightPlan);
            auto xflIt = lastXflSnapshot.find(callsign);
            const std::string prevSnap =
                (xflIt != lastXflSnapshot.end()) ? xflIt->second : "";
            auto cycleIt = outboundCoordCycles.find(callsign);
            if (cycleIt != outboundCoordCycles.end() &&
                (cycleIt->second.active ||
                 (cycleIt->second.refuseLatched && !cycleIt->second.refuseNotified))) {
                UpdateOutboundCoordCycle(callsign, FlightPlan);
            }
            // Sync sticky flags with cycle outcome. Critical: AppendXfl may still report
            // REQUESTED_BY_ME after ACC accept (next-ctrl ACCEPTED only) — must not
            // re-post exitCoordOutbound:true after the cycle already cleared pink.
            // Also never force pink when live ES already cleared to NONE (2→1 accept).
            if (cycleIt != outboundCoordCycles.end()) {
                const bool liveOutbound =
                    message.contains("exitCoordOutbound") &&
                    message["exitCoordOutbound"].is_boolean() &&
                    message["exitCoordOutbound"].get<bool>();
                // Do NOT re-emit exitCoordRefused after refuseNotified — UpdateOutbound
                // posts the refuse edge once; re-sticking on every CAD (move/action/
                // groundstate) revives amber after DepC / Accept cleared it.
                if (cycleIt->second.acceptNotified || cycleIt->second.refuseNotified ||
                    cycleIt->second.cancelledNotified || !cycleIt->second.active) {
                    message["exitCoordOutbound"] = false;
                } else if (cycleIt->second.active && !cycleIt->second.refuseLatched &&
                           liveOutbound) {
                    // Cycle still open AND ES still shows REQUESTED_BY_ME — keep pink.
                    message["exitCoordOutbound"] = true;
                    message["exitCoordRefused"] = false;
                } else {
                    // Cycle open but live already NONE — do not re-stick pink; Update
                    // (this tick or next) owns accept/refuse PostJson.
                    message["exitCoordOutbound"] = false;
                }
                // Reinforce EST on CAD follow-up after outboundCoordAccept (coo only —
                // do not re-send exitCoordAccepted or accept sound spam).
                if (cycleIt->second.acceptNotified) {
                    message["coo"] = true;
                    message["exitCoordRefused"] = false;
                }
            } else if (!prevSnap.empty() && prevSnap != newSnap &&
                       ShouldAutoEstOnXflTransition(prevSnap, newSnap)) {
                // No VatEFS Initiate cycle (ES-native outbound) — legacy edge accept.
                SetEstCoo(callsign, true);
                lastEstCooSnapshot[callsign] = "1";
                message["coo"] = true;
                message["exitCoordAccepted"] = true;
                message["exitCoordRefused"] = false;
                message["exitCoordOutbound"] = false;
                DebugMessage(std::string("CAD XFL transition auto DepC ") + callsign);
            }
            lastXflSnapshot[callsign] = newSnap;
        }

        switch (DataType) {
        case EuroScopePlugIn::CTR_DATA_TYPE_SQUAWK: {
            const char *squawk = ctrData.GetSquawk();
            if (IsValidOctalSquawk(squawk)) {
                out << " squawk " << squawk;
                SetJsonIfValidUtf8(message, "squawk", squawk);
            }
            break;
        }
        case EuroScopePlugIn::CTR_DATA_TYPE_FINAL_ALTITUDE: {
            // Prefer FP+override (GetFinalAltitude on FP); CAD-only override is often 0
            int rfl = FlightPlan.GetFinalAltitude();
            if (rfl > 0 && rfl <= 100000) {
                out << " rfl " << rfl;
                message["rfl"] = rfl;
            }
            break;
        }
        case EuroScopePlugIn::CTR_DATA_TYPE_TEMPORARY_ALTITUDE: {
            int cfl = ctrData.GetClearedAltitude();
            out << " cfl " << cfl;
            message["cfl"] = cfl;
            // 0 - no cleared level (use the final instead of)
            // 1 - cleared for ILS approach
            // 2 - cleared for visual approach
            if (cfl == 1 || cfl == 2) {
                message["ahdg"] = 0;
                message["direct"] = "";
            }
            break;
        }
        case EuroScopePlugIn::CTR_DATA_TYPE_COMMUNICATION_TYPE: {
            char comm = ctrData.GetCommunicationType();
            out << " comm " << comm;
            // Printable single char (0 → '0') so JSON/UTF-8 helpers accept it
            char commStr[2] = {comm == 0 ? '0' : comm, '\0'};
            SetJsonIfValidUtf8(message, "communicationType", commStr);
            break;
        }
        case EuroScopePlugIn::CTR_DATA_TYPE_SCRATCH_PAD_STRING: {
            const char *scratchStr = ctrData.GetScratchPadString();
            if (!scratchStr) return;

            // Limit scratch pad string length
            if (strlen(scratchStr) > 50) {
                DebugMessage("Scratch pad string too long: " + std::string(scratchStr));
                return;
            }

            std::string scratch = scratchStr;
            out << " scratch " << scratch;

            // GS tokens (GRP xLU/TXO/… and canonical LINEUP/TAXI/…)
            if (IsGroundStateToken(scratch)) {
                SetJsonIfValidUtf8(message, "groundstate", scratch.c_str());
            } else if (scratch == "NOSTATE") {
                // Swedish clear-ground-state token — treat as empty GS for the backend
                SetJsonIfValidUtf8(message, "groundstate", "");
                SetJsonIfValidUtf8(message, "scratch", scratch.c_str());
            } else if (scratch.find("GRP/S/") != std::string::npos && scratch.length() > 6) {
                // GRP/S/<stand> — handoff/list stand broadcast
                SetJsonIfValidUtf8(message, "stand", scratch.substr(6).c_str());
            } else if (scratch.rfind("GRP/M/", 0) == 0) {
                // GRP/M/<airport>/<stand> — Ground Radar move-to-stand (e.g. GRP/M/ESSA/F34)
                const size_t lastSlash = scratch.find_last_of('/');
                if (lastSlash != std::string::npos && lastSlash + 1 < scratch.size()) {
                    SetJsonIfValidUtf8(message, "stand", scratch.substr(lastSlash + 1).c_str());
                } else {
                    SetJsonIfValidUtf8(message, "scratch", scratch.c_str());
                }
            } else {
                SetJsonIfValidUtf8(message, "scratch", scratch.c_str());
            }
            // Scratch pad inputs noticed in the wild (if we ever want to
            // reverse-engineer/understand some TopSky plugin features): /PRESHDG/ /ASP=/ /ASP+/
            // /ASP-/ /ES /C_FLAG_ACK/ /C_FLAG_RESET/ MISAP_ /ROF/SAS525/ESMM_5_CTR
            // /LAM/ROF/ESMM_5_CTR
            // /ROF/RYR6Q/EKCH_F_APP
            // VatEFS ESSA ground: /EFSROF/SAS926/ESSA_G_GND (not TopSky)
            // /COB
            // /PLU
            // /TIT
            // /OPTEXT2_REQ/ESMM_7_CTR/LHA3218/NC M7
            // /SBY/RTI/EDDB_S_APP/S290+
            // /ACP/RTI/EDDB_S_APP
            // SAS88J controller ESMM_2_CTR scratch /RTI/DLH6RA/ESMM_2_CTR/S074-
            // DLH6RA controller EKDK_CTR scratch /SBY/RTI/ESMM_2_CTR/S074-
            // DLH6RA controller EKDK_CTR scratch /ACP/RTI/ESMM_2_CTR
            // DLH6RA controller EKDK_CTR mach 74
            // DLH6RA controller EKDK_CTR scratch /ASP-/
            // /OPTEXT2_REQ/ESSA_M_APP/NRD1121/"NORTH RIDER"
            // /FTEXT/L0
            // /HOLD/ERNOV/
            // /XHOLD/ERNOV/
            // /HOLD//0
            // /ARC+/
            // /ACK_STAR/RISMA3S
            // /OPTEXT/TEST
            // /OPTEXT/
            // /CAT2/
            // /CAT3/
            // ON_CONTACT+
            // ON_CONTACT-
            break;
        }
        case EuroScopePlugIn::CTR_DATA_TYPE_GROUND_STATE:
            out << " groundstate " << FlightPlan.GetGroundState();
            SetJsonGroundstateFromFpOrScratch(message, FlightPlan);
            break;
        case EuroScopePlugIn::CTR_DATA_TYPE_CLEARENCE_FLAG:
            out << " clearance " << FlightPlan.GetClearenceFlag();
            message["clearance"] = (bool)FlightPlan.GetClearenceFlag();
            break;
        case EuroScopePlugIn::CTR_DATA_TYPE_DEPARTURE_SEQUENCE:
            out << " dsq"; // TODO where dis dsq?
            break;
        case EuroScopePlugIn::CTR_DATA_TYPE_SPEED: {
            int speed = ctrData.GetAssignedSpeed();
            if (speed >= 0 && speed <= 1500) { // Reasonable speed range
                out << " asp " << speed;
                message["asp"] = speed;
            }
            break;
        }
        case EuroScopePlugIn::CTR_DATA_TYPE_MACH: {
            double mach = ctrData.GetAssignedMach();
            if (mach >= 0.0 && mach <= 10.0) { // Reasonable mach range
                out << " mach " << mach;
                message["mach"] = mach;
            }
            break;
        }
        case EuroScopePlugIn::CTR_DATA_TYPE_RATE: {
            int rate = ctrData.GetAssignedRate();
            if (rate >= -50000 && rate <= 50000) { // Reasonable rate range
                out << " arc " << rate;
                message["arc"] = rate;
            }
            break;
        }
        case EuroScopePlugIn::CTR_DATA_TYPE_HEADING: {
            int heading = ctrData.GetAssignedHeading();
            if (heading >= 0 && heading <= 360) { // Valid heading range
                out << " ahdg " << heading;
                message["ahdg"] = heading;
                // Real AHD clears DCT. ahdg=0 (e.g. after FPR/DCT) must NOT wipe direct —
                // that race cleared strip.direct so CLR showed nothing under SID/DCT.
                if (heading > 0) {
                    message["direct"] = "";
                } else {
                    const char *directTo = ctrData.GetDirectToPointName();
                    const std::string d = directTo ? directTo : "";
                    if (d.size() < 50) {
                        message["direct"] = d;
                        if (!d.empty()) out << " direct " << d;
                    }
                }
            }
            break;
        }
        case EuroScopePlugIn::CTR_DATA_TYPE_DIRECT_TO: {
            const char *directTo = ctrData.GetDirectToPointName();
            const std::string d = directTo ? directTo : "";
            if (d.size() < 50) {
                out << " direct " << (d.empty() ? "(clear)" : d);
                // Always publish — empty clears strip SID/DCT display
                message["direct"] = d;
                if (!d.empty()) message["ahdg"] = 0;
            }
            break;
        }
        default:
            out << " unknown data type " << DataType;
            break;
        }
        // Belt-and-suspenders: backend can create a strip from CAD alone if FPL was lost
        AppendBasicFlightPlanFields(message, FlightPlan);
        // for (int i = 0; i < 9; i++) {
        //     const char* annotation = ctrData.GetFlightStripAnnotation(i);
        //     if (annotation && strlen(annotation) > 0 && strlen(annotation) < 50) { // Reasonable length limit
        //         out << " a" << i << " " << annotation;
        //     }
        // }
        DebugMessage(out.str());
        PostJson(message, "OnFlightPlanControllerAssignedDataUpdate");
    } catch (const std::exception &e) {
        DisplayMessage(std::string("OnFlightPlanControllerAssignedDataUpdate exception: ") + e.what());
    } catch (...) {
        DisplayMessage("OnFlightPlanControllerAssignedDataUpdate: Unknown exception");
    }
}

void VatEFSPlugin::OnFlightPlanDisconnect(EuroScopePlugIn::CFlightPlan FlightPlan)
{
    if (disabled || !FilterFlightPlan(FlightPlan)) return;
    std::stringstream out;
    out << "FlightPlanDisconnect " << FlightPlan.GetCallsign();
    DebugMessage(out.str());
    const char *cs = FlightPlan.GetCallsign();
    if (cs && cs[0] != '\0') {
        lastOwnershipSnapshot.erase(cs);
        lastHoldShortSnapshot.erase(cs);
        lastCtlSnapshot.erase(cs);
        lastVchRequestSnapshot.erase(cs);
        lastEfsGaSnapshot.erase(cs);
        lastGrpStandSnapshot.erase(cs);
        fplPushedCallsigns.erase(cs);
    }
    nlohmann::json message = nlohmann::json::object();
    message["type"] = "flightPlanDisconnect";
    SetJsonIfValidUtf8(message, "callsign", FlightPlan.GetCallsign());
    PostJson(message, "OnFlightPlanDisconnect");
}

void VatEFSPlugin::OnFlightPlanFlightStripPushed(EuroScopePlugIn::CFlightPlan FlightPlan,
                                                 const char *sSenderController,
                                                 const char *sTargetController)
{
    if (disabled || !FilterFlightPlan(FlightPlan)) return;
    std::stringstream out;
    out << "FlightPlanFlightStripPushed " << FlightPlan.GetCallsign();
    if (sSenderController && strlen(sSenderController) > 0 && strlen(sSenderController) < 20)
        out << " sender " << sSenderController;
    if (sTargetController && strlen(sTargetController) > 0 && strlen(sTargetController) < 20)
        out << " target " << sTargetController;
    DebugMessage(out.str());
    nlohmann::json message = nlohmann::json::object();
    message["type"] = "flightPlanFlightStripPushed";
    SetJsonIfValidUtf8(message, "callsign", FlightPlan.GetCallsign());
    if (sSenderController && strlen(sSenderController) > 0 && strlen(sSenderController) < 20)
        SetJsonIfValidUtf8(message, "sender", sSenderController);
    if (sTargetController && strlen(sTargetController) > 0 && strlen(sTargetController) < 20)
        SetJsonIfValidUtf8(message, "target", sTargetController);
    PostJson(message, "OnFlightPlanFlightStripPushed");
    // The above message gets sent repeatedly from GND -> TWR... not sure when this is supposed to happen,
    // but it isn't just on transfer...
    OnFlightPlanFlightPlanDataUpdate(FlightPlan);
}

void VatEFSPlugin::OnControllerPositionUpdate(EuroScopePlugIn::CController Controller)
{
    if (disabled) return;
    nlohmann::json message = nlohmann::json::object();
    message["type"] = "controllerPositionUpdate";
    SetJsonIfValidUtf8(message, "callsign", Controller.GetCallsign());
    SetJsonIfValidUtf8(message, "position", Controller.GetPositionId());
    SetJsonWithUtf8Replace(message, "name", Controller.GetFullName());
    message["frequency"] = Controller.GetPrimaryFrequency();
    message["rating"] = Controller.GetRating();
    message["facility"] = Controller.GetFacility();
    SetJsonIfValidUtf8(message, "sector", Controller.GetSectorFileName());
    message["controller"] = Controller.IsController();
    const char *myCallsign = Controller.GetCallsign();
    const char *selfCallsign = ControllerMyself().GetCallsign();
    if (myCallsign && selfCallsign && IsValidUtf8(myCallsign) && IsValidUtf8(selfCallsign))
        message["me"] = (std::string(myCallsign) == std::string(selfCallsign));
    PostJson(message, "OnControllerPositionUpdate");
}

void VatEFSPlugin::OnControllerDisconnect(EuroScopePlugIn::CController Controller)
{
    if (disabled) return;
    std::stringstream out;
    out << "ControllerDisconnect " << Controller.GetCallsign();
    DebugMessage(out.str());
    nlohmann::json message = nlohmann::json::object();
    message["type"] = "controllerDisconnect";
    SetJsonIfValidUtf8(message, "callsign", Controller.GetCallsign());
    PostJson(message, "OnControllerDisconnect");
}

void VatEFSPlugin::OnRadarTargetPositionUpdate(EuroScopePlugIn::CRadarTarget RadarTarget)
{
    if (disabled || !RadarTarget.IsValid()) return;
    // std::stringstream out;
    // out << "RadarTargetPositionUpdate " << RadarTarget.GetCallsign();
    // DebugMessage(out.str());
    nlohmann::json message = nlohmann::json::object();
    message["type"] = "radarTargetPositionUpdate";
    SetJsonIfValidUtf8(message, "callsign", RadarTarget.GetCallsign());
    message["verticalSpeed"] = RadarTarget.GetVerticalSpeed();
    message["groundSpeed"] = RadarTarget.GetGS();
    auto position = RadarTarget.GetPosition();
    if (position.IsValid()) {
        message["latitude"] = position.GetPosition().m_Latitude;
        message["longitude"] = position.GetPosition().m_Longitude;
        message["altitude"] = position.GetPressureAltitude();
        // message["headingMagnetic"] = position.GetReportedHeading();
        message["heading"] = position.GetReportedHeadingTrueNorth();
        const char *squawk = position.GetSquawk();
        if (IsValidOctalSquawk(squawk)) {
            SetJsonIfValidUtf8(message, "squawk", squawk);
        }
        // message["modec"] = position.GetTransponderC();
        // message["ident"] = position.GetTransponderI();
    }
    auto fp = RadarTarget.GetCorrelatedFlightPlan();
    if (fp.IsValid()) {
        // Ownership is polled separately (PollOwnershipChanges) — do not attach it here.
        // Radar ticks can lag behind handoff accept/refuse and would overwrite fresher ownership.
        const char *nextController = fp.GetCoordinatedNextController();
        if (nextController && strlen(nextController) < 20) {
            SetJsonIfValidUtf8(message, "nextController", nextController);
            auto nextCon = ControllerSelect(nextController);
            if (nextCon.IsValid())
                message["nextControllerFrequency"] = nextCon.GetPrimaryFrequency();
            else
                message["nextControllerFrequency"] = 0;
        }
        int ete = fp.GetPositionPredictions().GetPointsNumber();
        if (ete >= 0 && ete <= 3600) { // Reasonable ETE range
            message["ete"] = ete;
        }
        int sectorEntryMin = fp.GetSectorEntryMinutes();
        if (sectorEntryMin >= 0) {
            message["sectorEntryMin"] = sectorEntryMin;
        }
        // Dense poll while an outbound Initiate cycle is open — REFUSED can last <1s.
        const char *csRaw = RadarTarget.GetCallsign();
        if (csRaw && csRaw[0] != '\0') {
            std::string cs = csRaw;
            for (auto &c : cs)
                c = (char)std::toupper((unsigned char)c);
            auto it = outboundCoordCycles.find(cs);
            if (it != outboundCoordCycles.end() &&
                (it->second.active ||
                 (it->second.refuseLatched && !it->second.refuseNotified)))
                UpdateOutboundCoordCycle(cs, fp);
        }
    }
    PostJson(message, "OnRadarTargetPositionUpdate");
}

EuroScopePlugIn::CRadarScreen *VatEFSPlugin::OnRadarScreenCreated(const char *sDisplayName,
                                                                  bool NeedRadarContent,
                                                                  bool GeoReferenced,
                                                                  bool CanBeSaved,
                                                                  bool CanBeCreated)
{
    std::stringstream out;
    out << "RadarScreenCreated " << sDisplayName << " " << NeedRadarContent << " " << GeoReferenced << " " << CanBeSaved << " " << CanBeCreated;
    DebugMessage(out.str());
    auto dummyRadarScreen = new DummyRadarScreen(this);
    dummyRadarScreens.push_back(dummyRadarScreen);
    return dummyRadarScreen;
}

bool VatEFSPlugin::OnCompileCommand(const char *commandLine)
{
    std::string command = commandLine;
    if (command.length() < 5 || command.compare(0, 5, ".efs ") != 0) return false;
    std::string rest = command.substr(5);

    // First word is subcommand
    std::string::size_type subEnd = rest.find(' ');
    std::string subcommand = (subEnd == std::string::npos) ? rest : rest.substr(0, subEnd);

    if (subcommand == "debug") {
        DisplayMessage("Debug mode enabled");
        debug = true;
        return true;
    } else if (subcommand == "assume") {
        std::string remainder = (subEnd == std::string::npos) ? "" : rest.substr(subEnd + 1);
        std::string callsign = remainder;
        std::string::size_type space = remainder.find(' ');
        if (space != std::string::npos) callsign = remainder.substr(0, space);
        for (auto &c : callsign)
            c = (char)std::toupper((unsigned char)c);
        if (callsign.empty()) {
            DisplayMessage("Usage: .efs assume CALLSIGN");
            return false;
        }
        auto fp = FlightPlanSelect(callsign.c_str());
        if (!fp.IsValid()) {
            DisplayMessage("Flight plan not found: " + callsign);
            return false;
        }
        const char *handoffTarget = fp.GetHandoffTargetControllerCallsign();
        const char *trackingCallsign = fp.GetTrackingControllerCallsign();
        bool handoffToMe = handoffTarget && handoffTarget[0] != '\0' && ControllerMyself().IsValid() &&
                           strcmp(handoffTarget, ControllerMyself().GetCallsign()) == 0;
        bool untracked = !trackingCallsign || trackingCallsign[0] == '\0';
        bool trackedByMe = fp.GetTrackingControllerIsMe();
        bool outgoingHandoff = trackedByMe && handoffTarget && handoffTarget[0] != '\0' && !handoffToMe;
        if (handoffToMe) {
            fp.AcceptHandoff();
            DisplayMessage("Accepted handoff for " + callsign);
            OnFlightPlanFlightPlanDataUpdate(fp);
            return true;
        }
        if (outgoingHandoff) {
            // Re-assume cancels a pending outbound handoff we initiated
            bool ok = fp.StartTracking();
            if (ok) {
                DisplayMessage("Cancelled handoff for " + callsign);
                OnFlightPlanFlightPlanDataUpdate(fp);
            } else
                DisplayMessage("Failed to cancel handoff for " + callsign);
            return true;
        }
        if (untracked) {
            bool ok = fp.StartTracking();
            if (ok) {
                DisplayMessage("Started tracking " + callsign);
                OnFlightPlanFlightPlanDataUpdate(fp);
            } else
                DisplayMessage("Failed to start tracking " + callsign);
            return true;
        }
        DisplayMessage(callsign + " is already tracked by " + std::string(trackingCallsign));
        return true;
    } else if (subcommand == "transfer") {
        std::string remainder = (subEnd == std::string::npos) ? "" : rest.substr(subEnd + 1);
        std::string callsign = remainder;
        std::string::size_type space = remainder.find(' ');
        if (space != std::string::npos) callsign = remainder.substr(0, space);
        for (auto &c : callsign)
            c = (char)std::toupper((unsigned char)c);
        if (callsign.empty()) {
            DisplayMessage("Usage: .efs transfer CALLSIGN");
            return false;
        }
        auto fp = FlightPlanSelect(callsign.c_str());
        if (!fp.IsValid()) {
            DisplayMessage("Flight plan not found: " + callsign);
            return false;
        }
        const char *nextCtr = fp.GetCoordinatedNextController();
        bool hasNext = nextCtr && nextCtr[0] != '\0';
        if (hasNext) {
            bool ok = fp.InitiateHandoff(nextCtr);
            if (ok) {
                DisplayMessage("Handoff initiated to " + std::string(nextCtr) + " for " + callsign);
                OnFlightPlanFlightPlanDataUpdate(fp);
            } else
                DisplayMessage("Failed to initiate handoff for " + callsign);
        } else {
            bool ok = fp.EndTracking();
            if (ok) {
                DisplayMessage("Ended tracking " + callsign);
                OnFlightPlanFlightPlanDataUpdate(fp);
            } else
                DisplayMessage("Failed to end tracking " + callsign);
        }
        return true;
    } else if (subcommand == "scratch" || subcommand == "scratmp") {
        std::string remainder = (subEnd == std::string::npos) ? "" : rest.substr(subEnd + 1);
        std::string callsign;
        std::string content;
        std::string::size_type callEnd = remainder.find(' ');
        if (callEnd == std::string::npos) {
            callsign = remainder;
        } else {
            callsign = remainder.substr(0, callEnd);
            content = remainder.substr(callEnd + 1);
        }
        bool resetAfterSet = (subcommand == "scratmp");
        bool success = UpdateScratchPad(callsign, content, resetAfterSet);
        if (!success)
            DisplayMessage("Failed to set scratch pad for " + callsign);
        else
            DisplayMessage("Scratch pad set for " + callsign + ": " + content);
        return true;
    } else if (subcommand == "apl") {
        std::string remainder = (subEnd == std::string::npos) ? "" : rest.substr(subEnd + 1);
        std::string callsign = remainder;
        std::string::size_type space = remainder.find(' ');
        if (space != std::string::npos) callsign = remainder.substr(0, space);
        for (auto &c : callsign)
            c = (char)std::toupper((unsigned char)c);
        if (callsign.empty()) {
            DisplayMessage("Usage: .efs apl CALLSIGN");
            return false;
        }

        // First check if there's a radar target for this callsign
        auto rt = RadarTargetSelect(callsign.c_str());

        // Try to get the existing flight plan
        auto fp = FlightPlanSelect(callsign.c_str());
        if (!fp.IsValid()) {
            if (!rt.IsValid()) {
                DisplayMessage("No flight plan or radar target found for " + callsign);
                return false;
            }
            // There's a radar target but no flight plan - try to get the correlated FP
            fp = rt.GetCorrelatedFlightPlan();
            if (!fp.IsValid()) {
                DisplayMessage("Radar target found but no flight plan for " + callsign + ". Cannot create APL.");
                return false;
            }
        }

        auto fpData = fp.GetFlightPlanData();

        // Set minimal flight plan data for an abbreviated flight plan
        // Only set fields that are currently empty
        const char *planType = fpData.GetPlanType();
        if (!planType || !*planType || *planType == ' ') {
            fpData.SetPlanType("I");
        }
        const char *origin = fpData.GetOrigin();
        if (!origin || !*origin) {
            fpData.SetOrigin("ZZZZ");
        }
        const char *destination = fpData.GetDestination();
        if (!destination || !*destination) {
            fpData.SetDestination("ZZZZ");
        }

        bool amended = fpData.AmendFlightPlan();
        if (!amended) {
            DisplayMessage("Failed to amend flight plan for " + callsign);
            return false;
        }

        // Correlate with radar target if we have one and they're not already correlated
        if (rt.IsValid()) {
            auto existingRt = fp.GetCorrelatedRadarTarget();
            if (!existingRt.IsValid()) {
                bool correlated = fp.CorrelateWithRadarTarget(rt);
                if (correlated)
                    DisplayMessage("APL created and correlated for " + callsign);
                else
                    DisplayMessage("APL created but correlation failed for " + callsign);
            } else {
                DisplayMessage("APL created for " + callsign + " (already correlated)");
            }
        } else {
            DisplayMessage("APL created for " + callsign + " (no radar target to correlate)");
        }
        return true;
    } else if (subcommand == "atyp") {
        // .efs atyp CALLSIGN AIRCRAFTTYPE  — set aircraft type on an existing flight plan
        std::string remainder = (subEnd == std::string::npos) ? "" : rest.substr(subEnd + 1);
        std::string callsign;
        std::string acType;
        std::string::size_type space = remainder.find(' ');
        if (space != std::string::npos) {
            callsign = remainder.substr(0, space);
            acType   = remainder.substr(space + 1);
        } else {
            callsign = remainder;
        }
        for (auto &c : callsign) c = (char)std::toupper((unsigned char)c);
        for (auto &c : acType)   c = (char)std::toupper((unsigned char)c);
        // Trim trailing whitespace from acType
        while (!acType.empty() && (acType.back() == ' ' || acType.back() == '\r' || acType.back() == '\n'))
            acType.pop_back();

        if (callsign.empty() || acType.empty()) {
            DisplayMessage("Usage: .efs atyp CALLSIGN TYPE  (e.g. .efs atyp SEGBY C172)");
            return false;
        }

        auto fp = FlightPlanSelect(callsign.c_str());
        if (!fp.IsValid()) {
            auto rt = RadarTargetSelect(callsign.c_str());
            if (rt.IsValid()) fp = rt.GetCorrelatedFlightPlan();
        }
        if (!fp.IsValid()) {
            DisplayMessage("atyp: No flight plan found for " + callsign);
            return false;
        }

        std::string aircraftInfoStr = acType + "/L";
        DisplayMessage("atyp: Setting aircraft info to '" + aircraftInfoStr + "' for " + callsign);

        // Read back what EuroScope currently has before amending
        {
            auto fpd = fp.GetFlightPlanData();
            const char *current = fpd.GetAircraftInfo();
            DisplayMessage("atyp: Current AircraftInfo='" + std::string(current ? current : "(null)") + "'");
        }

        // First amendment
        {
            auto fpd = fp.GetFlightPlanData();
            fpd.SetAircraftInfo(aircraftInfoStr.c_str());
            bool ok = fpd.AmendFlightPlan();
            DisplayMessage(std::string("atyp: First amendment ") + (ok ? "OK" : "FAILED"));
        }

        // Second amendment via fresh select
        {
            auto fp2 = FlightPlanSelect(callsign.c_str());
            if (fp2.IsValid()) {
                auto fpd2 = fp2.GetFlightPlanData();
                const char *after = fpd2.GetAircraftInfo();
                DisplayMessage("atyp: After 1st amend AircraftInfo='" + std::string(after ? after : "(null)") + "'");
                fpd2.SetAircraftInfo(aircraftInfoStr.c_str());
                bool ok2 = fpd2.AmendFlightPlan();
                DisplayMessage(std::string("atyp: Second amendment ") + (ok2 ? "OK" : "FAILED"));
            }
        }

        // Read back final value
        {
            auto fp3 = FlightPlanSelect(callsign.c_str());
            if (fp3.IsValid()) {
                auto fpd3 = fp3.GetFlightPlanData();
                const char *final = fpd3.GetAircraftInfo();
                DisplayMessage("atyp: Final AircraftInfo='" + std::string(final ? final : "(null)") + "'");
            }
        }
        return true;
    } else if (subcommand == "refresh") {
        Refresh();
        // Ask peer EFS backends (via VatIRIS sync) to re-write CLR/CFL/CTL/etc for
        // traffic they track — late joiners need those network writes in their ES.
        {
            nlohmann::json req = nlohmann::json::object();
            req["type"] = "efsRefreshRequest";
            PostJson(req, "OnCompileCommand");
        }
        DisplayMessage("Refreshed local ES data; asked peer EFS users to reassert assumed flags");
        return true;
    } else if (subcommand == "start") {
        backendAutoRestartUsed = false;
        StartBackend();
        return true;
    } else if (subcommand == "stop") {
        StopBackend();
        return true;
    } else if (subcommand == "status") {
        if (backendProcess == nullptr) {
            DisplayMessage("Backend is not running");
        } else {
            DWORD exitCode = 0;
            if (GetExitCodeProcess((HANDLE)backendProcess, &exitCode) && exitCode == STILL_ACTIVE)
                DisplayMessage("Backend is running");
            else
                DisplayMessage("Backend process has exited");
        }
        return true;
    } else if (subcommand == "cid") {
        // Open VATSIM CID dialog in EFS UI (for scribble sync auth)
        nlohmann::json message = nlohmann::json::object();
        message["type"] = "efsCidCommand";
        PostJson(message, "OnCompileCommand");
        DisplayMessage("Opening VATSIM CID dialog in VatEFS");
        return true;
    }
    return false;
}

/**
 * Ground Radar plugin (this ESAA build) keeps the assigned stand in tag item 2
 * ("Arrival stand") — STD on ARR lists and gate on DEP lists. VatEFS previously
 * learned it only from the GRP/S scratch broadcast (handoff) and skipped
 * departures to non-ES destinations (e.g. ESSA→EFHK), so position detection
 * could stick a neighbouring stand (FIN4AW F36L vs GRP F34).
 *
 * Offsets below were taken from GRplugin.dll loaded with ESAA (image base
 * 0x10000000): EuroScopePlugInInit stores the CPlugIn* at RVA 0x2701C4, and
 * OnGetTagItem is vtable slot 13. A fault disables the poll; scratch GRP/S
 * and GRP/M still update the stand when seen live.
 */
static const DWORD GRP_PLUGIN_INSTANCE_RVA = 0x2701C4;
static const int GRP_ONGETTAGITEM_SLOT = 13;
static const int GRP_ARRIVAL_STAND_ITEM = 2;

static bool PtrInImage(unsigned char *base, DWORD imageSize, const void *p)
{
    auto a = reinterpret_cast<const unsigned char *>(p);
    return a >= base && a < base + imageSize;
}

/** SEH wrapper. CFlightPlan/CRadarTarget are a single pointer passed by value. */
static void QueryGrpArrivalStandRaw(void *self, void *fn, void *fpWord, void *rtWord, int tagData,
                                     char out[16], bool *ok)
{
    *ok = false;
    out[0] = '\0';
    if (!self || !fn) return;
    using Fn = void (__thiscall *)(void *, void *, void *, int, int, char *, int *, COLORREF *, double *);
    int color = 0;
    COLORREF rgb = 0;
    double font = 0;
    __try {
        auto call = reinterpret_cast<Fn>(fn);
        call(self, fpWord, rtWord, GRP_ARRIVAL_STAND_ITEM, tagData, out, &color, &rgb, &font);
        out[15] = '\0';
        *ok = true;
    } __except (EXCEPTION_EXECUTE_HANDLER) {
        out[0] = '\0';
        *ok = false;
    }
}

static bool ResolveGrpArrivalStandFn(void **outSelf, void **outFn)
{
    HMODULE mod = GetModuleHandleA("GRplugin.dll");
    if (!mod) return false;
    auto base = reinterpret_cast<unsigned char *>(mod);
    auto dos = reinterpret_cast<IMAGE_DOS_HEADER *>(base);
    if (dos->e_magic != IMAGE_DOS_SIGNATURE) return false;
    auto nt = reinterpret_cast<IMAGE_NT_HEADERS *>(base + dos->e_lfanew);
    if (nt->Signature != IMAGE_NT_SIGNATURE) return false;
    const DWORD imageSize = nt->OptionalHeader.SizeOfImage;
    if (GRP_PLUGIN_INSTANCE_RVA + sizeof(void *) > imageSize) return false;

    void *self = nullptr;
    void **vt = nullptr;
    void *fn = nullptr;
    __try {
        self = *reinterpret_cast<void **>(base + GRP_PLUGIN_INSTANCE_RVA);
        if (!self) return false;
        vt = *reinterpret_cast<void ***>(self);
        if (!vt) return false;
        fn = vt[GRP_ONGETTAGITEM_SLOT];
    } __except (EXCEPTION_EXECUTE_HANDLER) {
        return false;
    }
    if (!PtrInImage(base, imageSize, vt) || !PtrInImage(base, imageSize, fn)) return false;
    *outSelf = self;
    *outFn = fn;
    return true;
}

/** Alphanumeric gate id (F36L, 16, R9C). Reject empty and prose. */
static std::string NormalizeGrpStandToken(const char *raw)
{
    if (!raw || !raw[0]) return "";
    std::string s;
    for (const char *p = raw; *p && s.size() < 6; ++p) {
        unsigned char c = static_cast<unsigned char>(*p);
        if (c == ' ' || c == '\t') {
            if (!s.empty()) break;
            continue;
        }
        if (c >= 'a' && c <= 'z') c = static_cast<unsigned char>(c - 'a' + 'A');
        if (!((c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9'))) return "";
        s.push_back(static_cast<char>(c));
    }
    bool digit = false;
    for (char c : s)
        if (c >= '0' && c <= '9') digit = true;
    if (!digit || s.empty() || s.size() > 6) return "";
    return s;
}

void VatEFSPlugin::PollGrpArrivalStands()
{
    if (grpStandPollFailed) return;
    static_assert(sizeof(EuroScopePlugIn::CFlightPlan) == sizeof(void *), "CFlightPlan layout");
    static_assert(sizeof(EuroScopePlugIn::CRadarTarget) == sizeof(void *), "CRadarTarget layout");

    void *self = nullptr;
    void *fn = nullptr;
    if (!ResolveGrpArrivalStandFn(&self, &fn)) return;

    for (EuroScopePlugIn::CFlightPlan fp = FlightPlanSelectFirst(); fp.IsValid();
         fp = FlightPlanSelectNext(fp)) {
        if (!FilterFlightPlan(fp)) continue;
        const char *cs = fp.GetCallsign();
        if (!cs || cs[0] == '\0') continue;
        EuroScopePlugIn::CFlightPlanData fpData = fp.GetFlightPlanData();
        const char *dest = fpData.GetDestination();
        const char *origin = fpData.GetOrigin();
        const bool destEs = dest && strncmp(dest, "ES", 2) == 0;
        const bool originEs = origin && strncmp(origin, "ES", 2) == 0;
        // Arrivals (ADES ES*) and departures/locals (ADEP ES*) — gate lives in same tag
        if (!destEs && !originEs) continue;

        EuroScopePlugIn::CRadarTarget rt = fp.GetCorrelatedRadarTarget();
        void *fpWord = nullptr;
        void *rtWord = nullptr;
        static_assert(sizeof(fp) == sizeof(fpWord), "pass CFlightPlan as one pointer");
        static_assert(sizeof(rt) == sizeof(rtWord), "pass CRadarTarget as one pointer");
        memcpy(&fpWord, &fp, sizeof(fpWord));
        memcpy(&rtWord, &rt, sizeof(rtWord));
        const int tagData = rt.IsValid() ? EuroScopePlugIn::TAG_DATA_CORRELATED
                                          : EuroScopePlugIn::TAG_DATA_FLIGHT_PLAN_TRACK;
        char item[16] = {};
        bool ok = false;
        QueryGrpArrivalStandRaw(self, fn, fpWord, rtWord, tagData, item, &ok);
        if (!ok) {
            grpStandPollFailed = true;
            DebugMessage("GRP arrival stand poll disabled after a fault");
            return;
        }
        const std::string stand = NormalizeGrpStandToken(item);
        if (stand.empty()) continue;
        auto it = lastGrpStandSnapshot.find(cs);
        if (it != lastGrpStandSnapshot.end() && it->second == stand) continue;
        lastGrpStandSnapshot[cs] = stand;

        nlohmann::json message = nlohmann::json::object();
        message["type"] = "controllerAssignedDataUpdate";
        SetJsonIfValidUtf8(message, "callsign", cs);
        SetJsonIfValidUtf8(message, "arrivalStand", stand.c_str());
        PostJson(message, "PollGrpArrivalStands");
    }
}

void VatEFSPlugin::OnTimer(int counter)
{
    try {
        // Poll backend stdout/stderr pipe (msg mode) — runs regardless of connection state
        PollBackendOutput();

        // Check backend health every ~10 seconds
        if (counter % 10 == 0 && backendProcess != nullptr) {
            DWORD exitCode = 0;
            if (!GetExitCodeProcess((HANDLE)backendProcess, &exitCode) || exitCode != STILL_ACTIVE) {
                CloseHandle((HANDLE)backendProcess);
                backendProcess = nullptr;
                CleanupBackendHandles();
                if (!backendAutoRestartUsed) {
                    backendAutoRestartUsed = true;
                    DisplayMessage("Backend has exited unexpectedly, attempting restart...");
                    StartBackend();
                } else {
                    DisplayMessage("Backend has exited again. Use .efs start to restart manually.");
                }
            }
        }

        if (disabled && (GetConnectionType() == EuroScopePlugIn::CONNECTION_TYPE_DIRECT ||
                         GetConnectionType() == EuroScopePlugIn::CONNECTION_TYPE_SWEATBOX ||
                         GetConnectionType() == EuroScopePlugIn::CONNECTION_TYPE_PLAYBACK)) {
            disabled = false;
            DebugMessage("EFS updates enabled");
            enabledTime = std::time(NULL);
            // Initialize Winsock and UDP receive socket
            InitializeWinsock();
            InitializeUdpReceiveSocket();
            nlohmann::json message = nlohmann::json::object();
            message["type"] = "connectionTypeUpdate";
            message["connectionType"] = GetConnectionType();
            PostJson(message, "OnTimer");
        } else if (!disabled && GetConnectionType() != EuroScopePlugIn::CONNECTION_TYPE_DIRECT &&
                   GetConnectionType() != EuroScopePlugIn::CONNECTION_TYPE_PLAYBACK &&
                   GetConnectionType() != EuroScopePlugIn::CONNECTION_TYPE_SWEATBOX) {
            disabled = true;
            pendingFullRefresh = false;
            DebugMessage("EFS updates disabled");
            nlohmann::json message = nlohmann::json::object();
            message["type"] = "connectionTypeUpdate";
            message["connectionType"] = GetConnectionType();
            PostJson(message, "OnTimer");
            // Cleanup UDP receive socket
            CleanupUdpReceiveSocket();
            CleanupWinsock();
            return;
        } else if (disabled) {
            return;
        }

        // Retry bind if a prior attempt failed (e.g. second EuroScope held 17772)
        if (udpReceiveSocket == nullptr) {
            InitializeUdpReceiveSocket();
        }

        // Receive UDP messages (non-blocking)
        ReceiveUdpMessages();

        if (std::time(NULL) - enabledTime < 10) return;
        if (pendingFullRefresh && std::time(NULL) >= fullRefreshNotBefore) {
            pendingFullRefresh = false;
            DisplayMessage("Dumping flight plans, clearance, and CDM to EFS (after start)");
            Refresh();
        }
        if (counter % 5 == 0) UpdateMyself();
        // Ownership (assume / transfer / accept / refuse) often has no ES callback — poll every tick.
        PollOwnershipChanges();
        // VCH H/S (ann 4) + CTL (ann 3) + EFSGA (5) + DepC (6) — no CAD DataType callback.
        PollVchAnnotationChanges();
        // GRP arrival-list stand is assigned before the handoff scratch broadcast.
        PollGrpArrivalStands();
        // ES XFL / COPX / DirectTo — ACC coordination often has no CAD callback.
        PollXflChanges();
        // CDM plugin rewrites CDM_data_*.txt atomically-ish; poll every second.
        // Heartbeat every 5s refreshes backend local-prefer TTL without re-sending all times
        // (avoids locking in a corrupt mid-write read for untouched callsigns).
        PollCdmDataFiles(counter % 5 == 0);
    } catch (const std::exception &e) {
        DisplayMessage(std::string("OnTimer exception: ") + e.what());
    } catch (...) {
        DisplayMessage("OnTimer: Unknown exception");
    }
}

namespace {
std::string NormalizeCdmHhmm(const std::string &raw)
{
    std::string digits;
    for (char c : raw) {
        if (c >= '0' && c <= '9') digits.push_back(c);
    }
    // Reject non-time garbage (and refuse HHMMSS truncation of odd lengths)
    if (digits.size() != 3 && digits.size() != 4 && digits.size() != 6) return "";
    if (digits.size() == 3) digits.insert(digits.begin(), '0');
    if (digits.size() == 6) digits = digits.substr(0, 4);
    if (digits.size() != 4) return "";
    int h = (digits[0] - '0') * 10 + (digits[1] - '0');
    int m = (digits[2] - '0') * 10 + (digits[3] - '0');
    if (h > 23 || m > 59) return "";
    return digits;
}

bool IsValidCdmCallsign(const std::string &cs)
{
    if (cs.size() < 2 || cs.size() > 10) return false;
    for (char c : cs) {
        if (!((c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9'))) return false;
    }
    // Must contain at least one letter (reject pure numeric garbage from torn lines)
    bool hasLetter = false;
    for (char c : cs) {
        if (c >= 'A' && c <= 'Z') { hasLetter = true; break; }
    }
    return hasLetter;
}

/** Read file twice; only accept if size+mtime stable and contents identical (CDM rewrite race). */
bool ReadCdmFileStable(const std::string &path, std::string &out)
{
    for (int attempt = 0; attempt < 4; attempt++) {
        WIN32_FILE_ATTRIBUTE_DATA attr1{};
        if (!GetFileAttributesExA(path.c_str(), GetFileExInfoStandard, &attr1)) return false;

        std::ifstream in(path, std::ios::binary);
        if (!in.is_open()) return false;
        std::string content((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
        in.close();

        WIN32_FILE_ATTRIBUTE_DATA attr2{};
        if (!GetFileAttributesExA(path.c_str(), GetFileExInfoStandard, &attr2)) return false;

        const bool sameMeta =
            attr1.nFileSizeLow == attr2.nFileSizeLow &&
            attr1.nFileSizeHigh == attr2.nFileSizeHigh &&
            attr1.ftLastWriteTime.dwLowDateTime == attr2.ftLastWriteTime.dwLowDateTime &&
            attr1.ftLastWriteTime.dwHighDateTime == attr2.ftLastWriteTime.dwHighDateTime;

        if (sameMeta) {
            // Second full read must match (torn content with unchanged mtime is rare but possible)
            std::ifstream in2(path, std::ios::binary);
            if (!in2.is_open()) return false;
            std::string content2((std::istreambuf_iterator<char>(in2)), std::istreambuf_iterator<char>());
            if (content == content2) {
                out = std::move(content);
                return true;
            }
        }
        Sleep(15);
    }
    return false;
}
} // namespace

/**
 * CDM slash-fields in EuroScope strip annotation 0:
 * ASRT/TSAC/TOBT/TSAT/TTOT/deIce/ecfmpId/manualCtot/CTOC/setBy/
 */
static std::vector<std::string> SplitCdmAnnotation(const char *ann)
{
    std::vector<std::string> parts;
    if (!ann) ann = "";
    std::string cur;
    for (const char *p = ann; ; ++p) {
        if (*p == '/' || *p == '\0') {
            parts.push_back(cur);
            cur.clear();
            if (*p == '\0') break;
        } else {
            cur.push_back(*p);
        }
    }
    return parts;
}

static std::string JoinCdmAnnotation(const std::vector<std::string> &parts)
{
    std::string out;
    for (std::size_t i = 0; i < parts.size(); i++) {
        if (i > 0) out.push_back('/');
        out += parts[i];
    }
    return out;
}

std::string VatEFSPlugin::GetCdmTobtSetBy(const std::string &callsign)
{
    try {
        EuroScopePlugIn::CFlightPlan fp = FlightPlanSelect(callsign.c_str());
        if (!fp.IsValid()) return "";
        const char *ann = fp.GetControllerAssignedData().GetFlightStripAnnotation(0);
        auto parts = SplitCdmAnnotation(ann);
        if (parts.size() <= 9) return "";
        std::string s = parts[9];
        while (!s.empty() && (s.back() == ' ' || s.back() == '\t')) s.pop_back();
        while (!s.empty() && (s.front() == ' ' || s.front() == '\t')) s.erase(s.begin());
        if (s.empty()) return "";
        char c = (char)std::toupper((unsigned char)s[0]);
        if (c == 'A' || c == 'P') return std::string(1, c);
    } catch (...) {
    }
    return "";
}

std::string VatEFSPlugin::GetCdmAsrt(const std::string &callsign)
{
    try {
        EuroScopePlugIn::CFlightPlan fp = FlightPlanSelect(callsign.c_str());
        if (!fp.IsValid()) return "";
        const char *ann = fp.GetControllerAssignedData().GetFlightStripAnnotation(0);
        auto parts = SplitCdmAnnotation(ann);
        if (parts.empty()) return "";
        std::string s = parts[0];
        while (!s.empty() && (s.back() == ' ' || s.back() == '\t')) s.pop_back();
        while (!s.empty() && (s.front() == ' ' || s.front() == '\t')) s.erase(s.begin());
        // ASRT is HHMM (CDM GetActualTime)
        std::string digits;
        for (char c : s) {
            if (c >= '0' && c <= '9') digits.push_back(c);
        }
        if (digits.size() == 3) digits = "0" + digits;
        if (digits.size() >= 4) return digits.substr(0, 4);
    } catch (...) {
    }
    return "";
}

std::string VatEFSPlugin::GetCdmTsac(const std::string &callsign)
{
    try {
        EuroScopePlugIn::CFlightPlan fp = FlightPlanSelect(callsign.c_str());
        if (!fp.IsValid()) return "";
        const char *ann = fp.GetControllerAssignedData().GetFlightStripAnnotation(0);
        auto parts = SplitCdmAnnotation(ann);
        // ASRT/TSAC/TOBT/TSAT/... — field 1 = TSAC
        if (parts.size() <= 1) return "";
        return NormalizeCdmHhmm(parts[1]);
    } catch (...) {
    }
    return "";
}

std::string VatEFSPlugin::GetCdmTobt(const std::string &callsign)
{
    try {
        EuroScopePlugIn::CFlightPlan fp = FlightPlanSelect(callsign.c_str());
        if (!fp.IsValid()) return "";
        const char *ann = fp.GetControllerAssignedData().GetFlightStripAnnotation(0);
        auto parts = SplitCdmAnnotation(ann);
        // ASRT/TSAC/TOBT/TSAT/... — field 2 = TOBT
        if (parts.size() <= 2) return "";
        return NormalizeCdmHhmm(parts[2]);
    } catch (...) {
    }
    return "";
}

std::string VatEFSPlugin::GetCdmTsat(const std::string &callsign)
{
    try {
        EuroScopePlugIn::CFlightPlan fp = FlightPlanSelect(callsign.c_str());
        if (!fp.IsValid()) return "";
        const char *ann = fp.GetControllerAssignedData().GetFlightStripAnnotation(0);
        auto parts = SplitCdmAnnotation(ann);
        // ASRT/TSAC/TOBT/TSAT/... — field 3 is what EuroScope CDM displays
        if (parts.size() <= 3) return "";
        return NormalizeCdmHhmm(parts[3]);
    } catch (...) {
    }
    return "";
}

std::string VatEFSPlugin::GetCdmTtot(const std::string &callsign)
{
    try {
        EuroScopePlugIn::CFlightPlan fp = FlightPlanSelect(callsign.c_str());
        if (!fp.IsValid()) return "";
        const char *ann = fp.GetControllerAssignedData().GetFlightStripAnnotation(0);
        auto parts = SplitCdmAnnotation(ann);
        // ASRT/TSAC/TOBT/TSAT/TTOT/... — field 4 = TTOT
        if (parts.size() <= 4) return "";
        return NormalizeCdmHhmm(parts[4]);
    } catch (...) {
    }
    return "";
}

std::string VatEFSPlugin::GetCdmCtoc(const std::string &callsign)
{
    try {
        EuroScopePlugIn::CFlightPlan fp = FlightPlanSelect(callsign.c_str());
        if (!fp.IsValid()) return "";
        const char *ann = fp.GetControllerAssignedData().GetFlightStripAnnotation(0);
        auto parts = SplitCdmAnnotation(ann);
        // .../manualCtot/CTOC/setBy/ — field 8 = CTOC
        if (parts.size() <= 8) return "";
        return NormalizeCdmHhmm(parts[8]);
    } catch (...) {
    }
    return "";
}

bool VatEFSPlugin::SetCdmStripFields(const std::string &callsign, const std::map<int, std::string> &fields)
{
    try {
        EuroScopePlugIn::CFlightPlan fp = FlightPlanSelect(callsign.c_str());
        if (!fp.IsValid()) return false;
        auto cad = fp.GetControllerAssignedData();
        const char *ann = cad.GetFlightStripAnnotation(0);
        auto parts = SplitCdmAnnotation((ann && *ann) ? ann : "///////////");
        // Ensure slots 0..9 exist (CDM layout)
        while (parts.size() < 10) parts.push_back("");
        for (const auto &kv : fields) {
            if (kv.first < 0) continue;
            while ((int)parts.size() <= kv.first) parts.push_back("");
            parts[kv.first] = kv.second;
        }
        std::string finalString = JoinCdmAnnotation(parts);
        return cad.SetFlightStripAnnotation(0, finalString.c_str());
    } catch (...) {
        return false;
    }
}

/** Directory where CDM writes CDM_data_*.txt (next to CDM.dll, not VatEFS.dll). */
static bool ResolveCdmDataDirectory(char *dir, size_t dirSize)
{
    if (!dir || dirSize == 0) return false;
    dir[0] = '\0';

    // Preferred: folder of the loaded CDM plugin (same place CDM_data_*.txt is written)
    HMODULE hCdm = GetModuleHandleA("CDM.dll");
    if (hCdm) {
        if (GetModuleFileNameA(hCdm, dir, (DWORD)dirSize) != 0) {
            PathRemoveFileSpecA(dir);
            std::string probe = std::string(dir) + "\\CDM_data_*.txt";
            WIN32_FIND_DATAA fd{};
            HANDLE hFind = FindFirstFileA(probe.c_str(), &fd);
            if (hFind != INVALID_HANDLE_VALUE) {
                FindClose(hFind);
                return true;
            }
        }
    }

    // Fallback: %APPDATA%\EuroScope\*\Plugins (sector package layout)
    char appdata[MAX_PATH]{};
    if (GetEnvironmentVariableA("APPDATA", appdata, MAX_PATH) > 0) {
        std::string esRoot = std::string(appdata) + "\\EuroScope";
        std::string pat = esRoot + "\\*";
        WIN32_FIND_DATAA fd{};
        HANDLE hFind = FindFirstFileA(pat.c_str(), &fd);
        if (hFind != INVALID_HANDLE_VALUE) {
            do {
                if (!(fd.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY)) continue;
                if (fd.cFileName[0] == '.') continue;
                std::string plugins = esRoot + "\\" + fd.cFileName + "\\Plugins";
                std::string probe = plugins + "\\CDM_data_*.txt";
                WIN32_FIND_DATAA fd2{};
                HANDLE hFind2 = FindFirstFileA(probe.c_str(), &fd2);
                if (hFind2 != INVALID_HANDLE_VALUE) {
                    FindClose(hFind2);
                    FindClose(hFind);
                    strncpy_s(dir, dirSize, plugins.c_str(), _TRUNCATE);
                    return true;
                }
            } while (FindNextFileA(hFind, &fd));
            FindClose(hFind);
        }
    }

    // Last resort: next to VatEFS.dll (only works if co-located with CDM)
    strncpy_s(dir, dirSize, DllPathFile, _TRUNCATE);
    PathRemoveFileSpecA(dir);
    return dir[0] != '\0';
}

void VatEFSPlugin::PollCdmDataFiles(bool sendHeartbeat)
{
    try {
        std::map<std::string, std::string> snapshot;
        nlohmann::json flights = nlohmann::json::array();
        bool readOk = true;

        char dir[_MAX_PATH];
        if (ResolveCdmDataDirectory(dir, sizeof(dir))) {
            static std::string lastCdmDirLogged;
            if (lastCdmDirLogged != dir) {
                lastCdmDirLogged = dir;
                DebugMessage(std::string("CDM_data dir: ") + dir);
            }

            std::string pattern = std::string(dir) + "\\CDM_data_*.txt";
            WIN32_FIND_DATAA fd{};
            HANDLE hFind = FindFirstFileA(pattern.c_str(), &fd);
            if (hFind != INVALID_HANDLE_VALUE) {
        do {
            if (fd.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) continue;
            std::string path = std::string(dir) + "\\" + fd.cFileName;
            // Airport from CDM_data_ESSA.txt
            std::string airport;
            {
                std::string name = fd.cFileName;
                const std::string prefix = "CDM_data_";
                const std::string suffix = ".txt";
                if (name.size() > prefix.size() + suffix.size() &&
                    name.compare(0, prefix.size(), prefix) == 0 &&
                    name.compare(name.size() - suffix.size(), suffix.size(), suffix) == 0) {
                    airport = name.substr(prefix.size(), name.size() - prefix.size() - suffix.size());
                }
            }

            std::string content;
            if (!ReadCdmFileStable(path, content)) {
                // Mid-write — skip this entire poll; keep previous snapshot
                readOk = false;
                break;
            }

            std::size_t start = 0;
            while (start < content.size()) {
                std::size_t end = content.find_first_of("\r\n", start);
                if (end == std::string::npos) end = content.size();
                std::string line = content.substr(start, end - start);
                start = content.find_first_not_of("\r\n", end);
                if (start == std::string::npos) start = content.size();

                if (line.empty()) continue;
                // Ignore incomplete last line without trailing newline during torn reads
                // (stable read should already reject; keep as safety)
                // CALLSIGN,TOBT,TSAT,TTOT,CTOT,reason,
                std::vector<std::string> fields;
                {
                    std::string cur;
                    for (char c : line) {
                        if (c == ',') {
                            fields.push_back(cur);
                            cur.clear();
                        } else {
                            cur.push_back(c);
                        }
                    }
                    fields.push_back(cur);
                }
                if (fields.size() < 5) continue;
                std::string callsign = fields[0];
                for (auto &c : callsign) c = (char)std::toupper((unsigned char)c);
                if (!IsValidCdmCallsign(callsign)) continue;

                std::string tobt = NormalizeCdmHhmm(fields[1]);
                std::string tsat = NormalizeCdmHhmm(fields[2]);
                std::string ttot = NormalizeCdmHhmm(fields[3]);
                std::string ctot = NormalizeCdmHhmm(fields[4]);

                std::string reason = fields.size() > 5 ? fields[5] : "";
                if (reason == "flowRestriction") reason.clear();
                // TOBT-SET-BY / ASRT / TSAC / TSAT / CTOC from CDM strip annotation
                std::string setBy = GetCdmTobtSetBy(callsign);
                std::string asrt = GetCdmAsrt(callsign);
                std::string tsac = GetCdmTsac(callsign);
                std::string ctoc = GetCdmCtoc(callsign);
                // Annotation fills gaps / leads file (CDM_data often lags strip times)
                if (tobt.empty()) {
                    std::string annTobt = GetCdmTobt(callsign);
                    if (!annTobt.empty()) tobt = annTobt;
                }
                std::string annTsat = GetCdmTsat(callsign);
                if (!annTsat.empty()) tsat = annTsat;
                if (ttot.empty()) {
                    std::string annTtot = GetCdmTtot(callsign);
                    if (!annTtot.empty()) ttot = annTtot;
                }

                // Accept row with times or annotation-only CDM (TSAC/ASRT/CTOC)
                if (tobt.empty() && tsat.empty() && tsac.empty() && asrt.empty() &&
                    ctoc.empty() && setBy.empty()) {
                    continue;
                }

                std::string key = tobt + "|" + tsat + "|" + ttot + "|" + ctot + "|" + reason + "|" + setBy + "|" + asrt + "|" + tsac + "|" + ctoc;
                snapshot[callsign] = key;
                auto prev = lastCdmFileSnapshot.find(callsign);
                if (prev != lastCdmFileSnapshot.end() && prev->second == key) continue;

                DebugMessage("cdmLocal " + callsign + " TOBT=" + tobt + " TSAT=" + (tsat.empty() ? "-" : tsat) +
                             " setBy=" + (setBy.empty() ? "-" : setBy) +
                             " ASRT=" + (asrt.empty() ? "-" : asrt) +
                             " TSAC=" + (tsac.empty() ? "-" : tsac) +
                             " CTOC=" + (ctoc.empty() ? "-" : ctoc));

                nlohmann::json f = nlohmann::json::object();
                f["callsign"] = callsign;
                if (!airport.empty()) f["airport"] = airport;
                if (!tobt.empty()) f["tobt"] = tobt;
                if (!tsat.empty()) f["tsat"] = tsat;
                if (!ttot.empty()) f["ttot"] = ttot;
                if (!ctot.empty()) f["ctot"] = ctot;
                if (!reason.empty()) f["ctotReason"] = reason;
                // Always include so backend can clear when CDM blank (TOBT==EOBT)
                f["tobtSetBy"] = setBy;
                f["asrt"] = asrt;
                f["tsac"] = tsac;
                f["ctoc"] = ctoc;
                flights.push_back(f);
            }
        } while (FindNextFileA(hFind, &fd));
        FindClose(hFind);
            }
        }

        if (!readOk) {
            // Do not swap snapshot or apply partial/torn data
            return;
        }

        // CDM_data_*.txt often omits flights that still have strip annotation times
        // (TSAT/TSAC/ASRT/CTOC). Scan ESSA deps so EFS sees what EuroScope shows.
        for (EuroScopePlugIn::CFlightPlan fp = FlightPlanSelectFirst(); fp.IsValid();
             fp = FlightPlanSelectNext(fp)) {
            if (!FilterFlightPlan(fp)) continue;
            const char *csRaw = fp.GetCallsign();
            if (!csRaw || !csRaw[0]) continue;
            std::string callsign = csRaw;
            for (auto &c : callsign) c = (char)std::toupper((unsigned char)c);
            if (!IsValidCdmCallsign(callsign)) continue;
            if (snapshot.find(callsign) != snapshot.end()) continue; // already from file

            const char *origin = fp.GetFlightPlanData().GetOrigin();
            if (!origin || _stricmp(origin, "ESSA") != 0) continue;

            std::string tobt = GetCdmTobt(callsign);
            std::string tsat = GetCdmTsat(callsign);
            std::string ttot = GetCdmTtot(callsign);
            std::string setBy = GetCdmTobtSetBy(callsign);
            std::string asrt = GetCdmAsrt(callsign);
            std::string tsac = GetCdmTsac(callsign);
            std::string ctoc = GetCdmCtoc(callsign);
            if (tobt.empty() && tsat.empty() && tsac.empty() && asrt.empty() &&
                ctoc.empty() && setBy.empty()) {
                continue;
            }

            std::string key = tobt + "|" + tsat + "|" + ttot + "|||" + setBy + "|" + asrt + "|" + tsac + "|" + ctoc;
            snapshot[callsign] = key;
            auto prev = lastCdmFileSnapshot.find(callsign);
            if (prev != lastCdmFileSnapshot.end() && prev->second == key) continue;

            DebugMessage("cdmAnn " + callsign + " TOBT=" + (tobt.empty() ? "-" : tobt) +
                         " TSAT=" + (tsat.empty() ? "-" : tsat) +
                         " setBy=" + (setBy.empty() ? "-" : setBy) +
                         " ASRT=" + (asrt.empty() ? "-" : asrt) +
                         " TSAC=" + (tsac.empty() ? "-" : tsac) +
                         " CTOC=" + (ctoc.empty() ? "-" : ctoc));

            nlohmann::json f = nlohmann::json::object();
            f["callsign"] = callsign;
            f["airport"] = "ESSA";
            if (!tobt.empty()) f["tobt"] = tobt;
            if (!tsat.empty()) f["tsat"] = tsat;
            if (!ttot.empty()) f["ttot"] = ttot;
            f["tobtSetBy"] = setBy;
            f["asrt"] = asrt;
            f["tsac"] = tsac;
            f["ctoc"] = ctoc;
            flights.push_back(f);
        }

        lastCdmFileSnapshot.swap(snapshot);

        if (!flights.empty()) {
            nlohmann::json message = nlohmann::json::object();
            message["type"] = "cdmLocalUpdate";
            message["flights"] = flights;
            PostJson(message, "PollCdmDataFiles");
        } else if (sendHeartbeat) {
            nlohmann::json message = nlohmann::json::object();
            message["type"] = "cdmLocalHeartbeat";
            PostJson(message, "PollCdmDataFiles");
        }
    } catch (const std::exception &e) {
        DebugMessage(std::string("PollCdmDataFiles: ") + e.what());
    } catch (...) {
        DebugMessage("PollCdmDataFiles: Unknown exception");
    }
}

void VatEFSPlugin::UpdateMyself()
{
    try {
        EuroScopePlugIn::CController me = ControllerMyself();
        if (!me.IsValid()) {
            DebugMessage("UpdateMyself: Controller not valid");
            return;
        }

        std::string callsign = me.GetCallsign();
        if (callsign.empty() || callsign.length() > 20) {
            DebugMessage("UpdateMyself: Invalid callsign");
            return;
        }

        nlohmann::json message = nlohmann::json::object();
        message["type"] = "myselfUpdate";
        SetJsonIfValidUtf8(message, "callsign", callsign.c_str());
        SetJsonWithUtf8Replace(message, "name", me.GetFullName());
        message["frequency"] = me.GetPrimaryFrequency();
        message["rating"] = me.GetRating();
        message["facility"] = me.GetFacility();
        SetJsonIfValidUtf8(message, "sector", me.GetSectorFileName());
        SetJsonIfValidUtf8(message, "position", me.GetPositionId());
        message["controller"] = me.IsController();
        message["pluginVersion"] = PLUGIN_VERSION;

        // Limit the size of the rwyconfig structure
        message["rwyconfig"] = nlohmann::json::object();

        SelectActiveSectorfile();

        // Safe airport iteration with count limit
        int airportCount = 0;
        const int MAX_AIRPORTS = 1000;
        for (EuroScopePlugIn::CSectorElement airport =
             SectorFileElementSelectFirst(EuroScopePlugIn::SECTOR_ELEMENT_AIRPORT);
             airport.IsValid() && airportCount < MAX_AIRPORTS;
             airport = SectorFileElementSelectNext(airport, EuroScopePlugIn::SECTOR_ELEMENT_AIRPORT)) {

            airportCount++;
            const char *airportName = airport.GetName();
            if (!airportName || !*airportName || strlen(airportName) > 10) continue;
            if (!IsValidUtf8(airportName)) continue;

            std::string airportStr = airportName;
            airportStr.erase(std::remove_if(airportStr.begin(), airportStr.end(), ::isspace),
                             airportStr.end());
            if (airportStr.empty()) continue;

            if (airport.IsElementActive(false)) message["rwyconfig"][airportStr]["arr"] = true;
            if (airport.IsElementActive(true)) message["rwyconfig"][airportStr]["dep"] = true;
        }

        // Safe runway iteration with count limit
        int runwayCount = 0;
        const int MAX_RUNWAYS = 1000;
        EuroScopePlugIn::CSectorElement runway =
        SectorFileElementSelectFirst(EuroScopePlugIn::SECTOR_ELEMENT_RUNWAY);
        if (!runway.IsValid()) {
            return;
        }

        do {
            runwayCount++;
            const char *airportName = runway.GetAirportName();
            if (!airportName || !*airportName || strlen(airportName) > 10) continue;
            if (!IsValidUtf8(airportName)) continue;

            std::string airport = airportName;
            airport.erase(std::remove_if(airport.begin(), airport.end(), ::isspace), airport.end());
            if (airport.empty()) continue;

            const char *rwyName0 = runway.GetRunwayName(0);
            const char *rwyName1 = runway.GetRunwayName(1);

            // Validate runway names
            if (rwyName0 && *rwyName0 && strlen(rwyName0) <= 5 && IsValidUtf8(rwyName0)) {
                if (runway.IsElementActive(false, 0))
                    message["rwyconfig"][airport][rwyName0]["arr"] = true;
                if (runway.IsElementActive(true, 0))
                    message["rwyconfig"][airport][rwyName0]["dep"] = true;
            }

            if (rwyName1 && *rwyName1 && strlen(rwyName1) <= 5 && IsValidUtf8(rwyName1)) {
                if (runway.IsElementActive(false, 1))
                    message["rwyconfig"][airport][rwyName1]["arr"] = true;
                if (runway.IsElementActive(true, 1))
                    message["rwyconfig"][airport][rwyName1]["dep"] = true;
            }

            runway = SectorFileElementSelectNext(runway, EuroScopePlugIn::SECTOR_ELEMENT_RUNWAY);
        } while (runway.IsValid() && runwayCount < MAX_RUNWAYS);

        PostJson(message, "UpdateMyself");
    } catch (const std::exception &e) {
        DisplayMessage(std::string("UpdateMyself exception: ") + e.what());
    } catch (...) {
        DisplayMessage("UpdateMyself: Unknown exception");
    }
}

/**
 * StartTracking when the FP is untracked so scratch / CLR writes stick.
 * Does not steal another controller's track. Returns false only when
 * StartTracking was needed and failed.
 */
bool VatEFSPlugin::EnsureTrackingIfUntracked(EuroScopePlugIn::CFlightPlan &fp,
                                             const std::string &callsign)
{
    if (!fp.IsValid())
        return false;
    const char *trackingCallsign = fp.GetTrackingControllerCallsign();
    const char *trackingId = fp.GetTrackingControllerId();
    bool untracked =
        (!trackingCallsign || trackingCallsign[0] == '\0') &&
        (!trackingId || trackingId[0] == '\0');
    if (!untracked)
        return true;
    bool ok = fp.StartTracking();
    if (!ok) {
        DisplayMessage("EnsureTracking: Failed to start tracking " + callsign);
        return false;
    }
    DebugMessage("EnsureTracking: Started tracking " + callsign);
    return true;
}

bool VatEFSPlugin::UpdateScratchPad(const std::string &inCallsign, const std::string &content, const bool resetAfterSet)
{
    try {
        std::string callsign = inCallsign;
        for (auto &c : callsign)
            c = (char)std::toupper((unsigned char)c);
        auto fp = FlightPlanSelect(callsign.c_str());
        if (!fp.IsValid()) {
            DisplayMessage("Flight plan not found: " + callsign);
            return false;
        }
        std::string originalScratch;
        if (resetAfterSet) {
            const char *p = fp.GetControllerAssignedData().GetScratchPadString();
            originalScratch = p ? p : "";
        }
        bool success = fp.GetControllerAssignedData().SetScratchPadString(content.c_str());
        if (success && resetAfterSet) {
            success = fp.GetControllerAssignedData().SetScratchPadString(originalScratch.c_str());
            if (!success) DisplayMessage("Failed to reset scratch pad for " + callsign);
        }
        return success;
    } catch (const std::exception &e) {
        DisplayMessage(std::string("UpdateScratchPad exception: ") + e.what());
    } catch (...) {
        DisplayMessage("UpdateScratchPad: Unknown exception");
    }
    return false;
}

bool VatEFSPlugin::SendRof(const std::string &targetCallsign, bool efsNative)
{
    const char *tag = efsNative ? "efsRof" : "rof";
    auto postResult = [this, efsNative, tag](const std::string &callsign, bool ok,
                                              const std::string &error = "") {
        nlohmann::json result = nlohmann::json::object();
        result["type"] = "rofResult";
        result["callsign"] = callsign;
        result["ok"] = ok;
        result["mode"] = efsNative ? "efs" : "topsky";
        if (!ok && !error.empty()) result["error"] = error;
        PostJson(result, tag);
    };

    try {
        std::string target = targetCallsign;
        for (auto &c : target)
            c = (char)std::toupper((unsigned char)c);
        if (target.empty()) {
            const std::string err = "Invalid callsign";
            DisplayMessage(std::string(tag) + ": " + err);
            postResult(target, false, err);
            return false;
        }
        auto myself = ControllerMyself();
        if (!myself.IsValid()) {
            const std::string err = "Not logged in as controller";
            DisplayMessage(std::string(tag) + ": " + err);
            postResult(target, false, err);
            return false;
        }
        // TopSky: /ROF/TARGET/REQUESTER (sector-sequence validated — broken on ESSA ground).
        // EFS:    /EFSROF/TARGET/REQUESTER (peer VatEFS backends consume; TopSky ignores).
        // Backend clears the vehicle scratch after a short delay.
        const std::string scratch =
            (efsNative ? std::string("/EFSROF/") : std::string("/ROF/")) + target + "/" +
            myself.GetCallsign();

        std::vector<std::string> vehicles;
        // Prefer aircraft we track (observed TopSky / EFS scratch vehicle)
        for (auto fp = FlightPlanSelectFirst(); fp.IsValid(); fp = FlightPlanSelectNext(fp)) {
            if (!fp.GetTrackingControllerIsMe()) continue;
            const char *cs = fp.GetCallsign();
            if (!cs || !cs[0]) continue;
            std::string v = cs;
            for (auto &c : v)
                c = (char)std::toupper((unsigned char)c);
            if (v != target) vehicles.push_back(v);
        }
        // Then the target itself (works if we can write its scratch)
        vehicles.push_back(target);
        // Finally any other FP that accepts a scratch write
        for (auto fp = FlightPlanSelectFirst(); fp.IsValid(); fp = FlightPlanSelectNext(fp)) {
            const char *cs = fp.GetCallsign();
            if (!cs || !cs[0]) continue;
            std::string v = cs;
            for (auto &c : v)
                c = (char)std::toupper((unsigned char)c);
            if (v == target) continue;
            bool already = false;
            for (const auto &e : vehicles)
                if (e == v) {
                    already = true;
                    break;
                }
            if (!already) vehicles.push_back(v);
        }

        for (const auto &vehicle : vehicles) {
            auto fp = FlightPlanSelect(vehicle.c_str());
            if (!fp.IsValid()) continue;
            if (fp.GetControllerAssignedData().SetScratchPadString(scratch.c_str())) {
                DebugMessage(std::string(efsNative ? "EFS ROF" : "ROF") + " sent for " + target +
                             " via " + vehicle + ": " + scratch);
                nlohmann::json result = nlohmann::json::object();
                result["type"] = "rofResult";
                result["callsign"] = target;
                result["ok"] = true;
                result["mode"] = efsNative ? "efs" : "topsky";
                result["vehicle"] = vehicle;
                PostJson(result, tag);
                return true;
            }
        }

        const std::string err = "Assume at least one aircraft first (needs a writable scratch vehicle)";
        DisplayMessage(std::string(tag) + ": Failed to send — " + err);
        postResult(target, false, err);
        return false;
    } catch (const std::exception &e) {
        const std::string err = std::string("Exception: ") + e.what();
        DisplayMessage(std::string(tag) + " " + err);
        postResult(targetCallsign, false, err);
    } catch (...) {
        const std::string err = "Unknown exception";
        DisplayMessage(std::string(tag) + ": " + err);
        postResult(targetCallsign, false, err);
    }
    return false;
}

/**
 * Brittle EuroScope .contactme via keyboard (no SDK send-PM / ExecuteCommand):
 *   ESC → type callsign → ASEL → HOME → ASEL
 *
 * Default ASEL key is numpad PLUS (VK_ADD). Must use real VKs/scancodes — UNICODE
 * insertion puts glyphs in the cmdline so VK_ADD becomes a literal '+' (shows as
 * +CALLSIGN+). Requires EuroScope foreground focus (EFS click steals it).
 */
static bool SendVkTap(WORD vk, bool extended = false)
{
    const WORD scan = (WORD)MapVirtualKeyW(vk, MAPVK_VK_TO_VSC);
    INPUT inputs[2] = {};
    inputs[0].type = INPUT_KEYBOARD;
    inputs[0].ki.wVk = vk;
    inputs[0].ki.wScan = scan;
    if (extended)
        inputs[0].ki.dwFlags |= KEYEVENTF_EXTENDEDKEY;
    inputs[1] = inputs[0];
    inputs[1].ki.dwFlags |= KEYEVENTF_KEYUP;
    return SendInput(2, inputs, sizeof(INPUT)) == 2;
}

/** Type one ASCII char via VkKeyScan (so ES sees real keydowns, not UNICODE inserts). */
static bool SendCharTap(char ch)
{
    const SHORT mapped = VkKeyScanA(ch);
    if (mapped == -1)
        return false;
    const WORD vk = LOBYTE(mapped);
    const BYTE mods = HIBYTE(mapped);
    INPUT seq[8] = {};
    int n = 0;
    auto push = [&](WORD key, bool up) {
        seq[n].type = INPUT_KEYBOARD;
        seq[n].ki.wVk = key;
        seq[n].ki.wScan = (WORD)MapVirtualKeyW(key, MAPVK_VK_TO_VSC);
        seq[n].ki.dwFlags = up ? KEYEVENTF_KEYUP : 0;
        ++n;
    };
    if (mods & 1)
        push(VK_SHIFT, false);
    if (mods & 2)
        push(VK_CONTROL, false);
    if (mods & 4)
        push(VK_MENU, false);
    push(vk, false);
    push(vk, true);
    if (mods & 4)
        push(VK_MENU, true);
    if (mods & 2)
        push(VK_CONTROL, true);
    if (mods & 1)
        push(VK_SHIFT, true);
    return SendInput(n, seq, sizeof(INPUT)) == (UINT)n;
}

static bool SendAsciiText(const std::string &text)
{
    for (char ch : text) {
        if (!SendCharTap(ch))
            return false;
        Sleep(15);
    }
    return true;
}

static BOOL CALLBACK FindEuroScopeHwnd(HWND hwnd, LPARAM lParam)
{
    if (!IsWindowVisible(hwnd))
        return TRUE;
    char title[512] = {};
    GetWindowTextA(hwnd, title, sizeof(title) - 1);
    if (title[0] && strstr(title, "EuroScope")) {
        *reinterpret_cast<HWND *>(lParam) = hwnd;
        return FALSE;
    }
    return TRUE;
}

static void FocusEuroScopeWindow()
{
    HWND hwnd = nullptr;
    EnumWindows(FindEuroScopeHwnd, reinterpret_cast<LPARAM>(&hwnd));
    if (!hwnd)
        return;
    DWORD foreTid = GetWindowThreadProcessId(GetForegroundWindow(), nullptr);
    DWORD esTid = GetWindowThreadProcessId(hwnd, nullptr);
    if (foreTid && esTid && foreTid != esTid)
        AttachThreadInput(foreTid, esTid, TRUE);
    SetForegroundWindow(hwnd);
    BringWindowToTop(hwnd);
    if (foreTid && esTid && foreTid != esTid)
        AttachThreadInput(foreTid, esTid, FALSE);
    Sleep(80);
}

/** True when the foreground window title contains "EuroScope". */
static bool IsEuroScopeForeground()
{
    HWND fg = GetForegroundWindow();
    if (!fg)
        return false;
    char title[512] = {};
    GetWindowTextA(fg, title, sizeof(title) - 1);
    return title[0] && strstr(title, "EuroScope") != nullptr;
}

void VatEFSPlugin::PostPmResult(const std::string &kind, const std::string &callsign, bool ok,
                                const std::string &error)
{
    nlohmann::json result = nlohmann::json::object();
    result["type"] = "pmResult";
    result["kind"] = kind;
    result["callsign"] = callsign;
    result["ok"] = ok;
    if (!ok && !error.empty())
        result["error"] = error;
    PostJson(result, kind);
}

bool VatEFSPlugin::SendContactMe(const std::string &targetCallsign)
{
    const char *kind = "contactme";
    try {
        std::string target = targetCallsign;
        for (auto &c : target)
            c = (char)std::toupper((unsigned char)c);
        if (target.empty()) {
            DisplayMessage("contactme: Invalid callsign");
            PostPmResult(kind, target, false, "Invalid callsign");
            return false;
        }

        auto fp = FlightPlanSelect(target.c_str());
        auto rt = RadarTargetSelect(target.c_str());
        if (!fp.IsValid() && !rt.IsValid()) {
            DisplayMessage("contactme: No flight plan or radar target for " + target);
            PostPmResult(kind, target, false, "No flight plan or radar target");
            return false;
        }

        FocusEuroScopeWindow();
        if (!IsEuroScopeForeground()) {
            const std::string err = "EuroScope must be in focus";
            DisplayMessage("contactme: " + err + " for " + target);
            PostPmResult(kind, target, false, err);
            return false;
        }

        // ESC (clear cmdline) → callsign → ASEL (numpad +) → HOME → ASEL
        if (!SendVkTap(VK_ESCAPE)) {
            DisplayMessage("contactme: SendInput(ESC) failed for " + target);
            PostPmResult(kind, target, false, "SendInput(ESC) failed");
            return false;
        }
        Sleep(60);
        if (!SendAsciiText(target)) {
            DisplayMessage("contactme: SendInput(callsign) failed for " + target);
            PostPmResult(kind, target, false, "SendInput(callsign) failed");
            return false;
        }
        Sleep(60);
        if (!SendVkTap(VK_ADD)) { // default ASEL = numpad +
            DisplayMessage("contactme: SendInput(ASEL) failed for " + target);
            PostPmResult(kind, target, false, "SendInput(ASEL) failed");
            return false;
        }
        Sleep(60);
        if (!SendVkTap(VK_HOME, true)) {
            DisplayMessage("contactme: SendInput(HOME) failed for " + target);
            PostPmResult(kind, target, false, "SendInput(HOME) failed");
            return false;
        }
        Sleep(60);
        if (!SendVkTap(VK_ADD)) {
            DisplayMessage("contactme: SendInput(ASEL#2) failed for " + target);
            PostPmResult(kind, target, false, "SendInput(ASEL#2) failed");
            return false;
        }

        // Re-check focus after typing — keys may have gone elsewhere
        if (!IsEuroScopeForeground()) {
            const std::string err = "EuroScope must be in focus";
            DisplayMessage("contactme: " + err + " for " + target);
            PostPmResult(kind, target, false, err);
            return false;
        }

        DebugMessage("contactme: ESC + " + target + " + ASEL + HOME + ASEL");
        PostPmResult(kind, target, true);
        return true;
    } catch (const std::exception &e) {
        DisplayMessage(std::string("contactme exception: ") + e.what());
        PostPmResult(kind, targetCallsign, false, e.what());
    } catch (...) {
        DisplayMessage("contactme: Unknown exception");
        PostPmResult(kind, targetCallsign, false, "Unknown exception");
    }
    return false;
}

/** Type UTF-8 as UNICODE key events (CDM PM text has URL / brackets). */
static bool SendUnicodeText(const std::string &utf8)
{
    if (utf8.empty())
        return true;
    int wlen = MultiByteToWideChar(CP_UTF8, 0, utf8.c_str(), -1, nullptr, 0);
    if (wlen <= 1)
        return false;
    std::vector<wchar_t> wbuf(static_cast<size_t>(wlen));
    MultiByteToWideChar(CP_UTF8, 0, utf8.c_str(), -1, wbuf.data(), wlen);
    for (int i = 0; i < wlen - 1; ++i) {
        INPUT in[2] = {};
        in[0].type = INPUT_KEYBOARD;
        in[0].ki.wScan = wbuf[static_cast<size_t>(i)];
        in[0].ki.dwFlags = KEYEVENTF_UNICODE;
        in[1] = in[0];
        in[1].ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;
        if (SendInput(2, in, sizeof(INPUT)) != 2)
            return false;
    }
    return true;
}

bool VatEFSPlugin::SendCdmPrivateMessage(const std::string &targetCallsign,
                                         const std::string &messageText)
{
    const char *kind = "cdmPm";
    try {
        std::string target = targetCallsign;
        for (auto &c : target)
            c = (char)std::toupper((unsigned char)c);
        if (target.empty()) {
            DisplayMessage("cdmPm: Invalid callsign");
            PostPmResult(kind, target, false, "Invalid callsign");
            return false;
        }
        if (messageText.empty()) {
            DisplayMessage("cdmPm: Empty message text");
            PostPmResult(kind, target, false, "Empty message text");
            return false;
        }

        auto fp = FlightPlanSelect(target.c_str());
        auto rt = RadarTargetSelect(target.c_str());
        if (!fp.IsValid() && !rt.IsValid()) {
            DisplayMessage("cdmPm: No flight plan or radar target for " + target);
            PostPmResult(kind, target, false, "No flight plan or radar target");
            return false;
        }

        FocusEuroScopeWindow();
        if (!IsEuroScopeForeground()) {
            const std::string err = "EuroScope must be in focus";
            DisplayMessage("cdmPm: " + err + " for " + target);
            PostPmResult(kind, target, false, err);
            return false;
        }

        // Match CDM plugin: OEM_PLUS + ESC clears cmdline, then `.msg CS text` + Enter
        if (!SendVkTap(VK_OEM_PLUS)) {
            DisplayMessage("cdmPm: SendInput(OEM_PLUS) failed for " + target);
            PostPmResult(kind, target, false, "SendInput(OEM_PLUS) failed");
            return false;
        }
        Sleep(40);
        if (!SendVkTap(VK_ESCAPE)) {
            DisplayMessage("cdmPm: SendInput(ESC) failed for " + target);
            PostPmResult(kind, target, false, "SendInput(ESC) failed");
            return false;
        }
        Sleep(60);

        const std::string cmdline = ".msg " + target + " " + messageText;
        if (!SendUnicodeText(cmdline)) {
            DisplayMessage("cdmPm: SendInput(text) failed for " + target);
            PostPmResult(kind, target, false, "SendInput(text) failed");
            return false;
        }
        Sleep(40);
        if (!SendVkTap(VK_RETURN)) {
            DisplayMessage("cdmPm: SendInput(ENTER) failed for " + target);
            PostPmResult(kind, target, false, "SendInput(ENTER) failed");
            return false;
        }

        if (!IsEuroScopeForeground()) {
            const std::string err = "EuroScope must be in focus";
            DisplayMessage("cdmPm: " + err + " for " + target);
            PostPmResult(kind, target, false, err);
            return false;
        }

        DebugMessage("cdmPm: .msg " + target + " (+" + std::to_string(messageText.size()) + " chars)");
        PostPmResult(kind, target, true);
        return true;
    } catch (const std::exception &e) {
        DisplayMessage(std::string("cdmPm exception: ") + e.what());
        PostPmResult(kind, targetCallsign, false, e.what());
    } catch (...) {
        DisplayMessage("cdmPm: Unknown exception");
        PostPmResult(kind, targetCallsign, false, "Unknown exception");
    }
    return false;
}

bool VatEFSPlugin::SendInitiateCoordination(const std::string &callsign, int altitudeFeet,
                                            const std::string &point,
                                            const std::string &targetController)
{
    try {
        std::string cs = callsign;
        for (auto &c : cs)
            c = (char)std::toupper((unsigned char)c);
        auto fp = FlightPlanSelect(cs.c_str());
        if (!fp.IsValid()) {
            DisplayMessage("initiateCoordination: No FP for " + cs);
            return false;
        }

        // Require a real XFL (feet). Altitude 0 ⇒ ES sends point-only coordination.
        int alt = altitudeFeet;
        if (alt <= 0) {
            try {
                alt = fp.GetExitCoordinationAltitude();
            } catch (...) {
                alt = 0;
            }
        }
        if (alt < 0 || alt > 100000)
            alt = 0;
        if (alt <= 0) {
            DisplayMessage("initiateCoordination: No XFL altitude for " + cs);
            return false;
        }

        // Same-level re-request: nudge ±1 ft so accept vs refuse is distinguishable.
        // Lists/EFS show XFL in hundreds of feet (FL90), so 9000 vs 9001 is invisible.
        // Accept path: 2→1 with live XFL == nudged → EST; refuse: XFL reverts → mismatch.
        int currentXfl = 0;
        try {
            currentXfl = fp.GetExitCoordinationAltitude();
        } catch (...) {
            currentXfl = 0;
        }
        if (currentXfl > 0 && currentXfl == alt) {
            const int original = alt;
            int nudged = currentXfl + 1;
            if (nudged == currentXfl || nudged <= 0 || nudged > 100000)
                nudged = currentXfl - 1;
            if (nudged > 0 && nudged <= 100000 && nudged != currentXfl) {
                alt = nudged;
                DisplayMessage("same-level nudge " + std::to_string(original) + "→" +
                               std::to_string(alt));
                DebugMessage("initiateCoordination: same-level nudge " + cs + " " +
                             std::to_string(original) + "→" + std::to_string(alt));
            }
        }

        // LOP DCT fallback point (e.g. MIKNA) — never prefer ESE COPX (BEDOS) here.
        std::string lopPt = point;
        for (auto &c : lopPt)
            c = (char)std::toupper((unsigned char)c);

        std::string target = targetController;
        for (auto &c : target)
            c = (char)std::toupper((unsigned char)c);
        if (target.empty()) {
            const char *next = fp.GetCoordinatedNextController();
            if (next && next[0] != '\0')
                target = next;
        }
        if (target.empty()) {
            // Prefer an online CTR/FSS as ACC coordination target
            for (EuroScopePlugIn::CController c = ControllerSelectFirst(); c.IsValid();
                 c = ControllerSelectNext(c)) {
                if (!c.IsController())
                    continue;
                const char *pos = c.GetPositionId();
                const char *csn = c.GetCallsign();
                if (!csn || csn[0] == '\0')
                    continue;
                std::string call = csn;
                bool ctrish = false;
                if (pos && (strstr(pos, "CTR") || strstr(pos, "FSS")))
                    ctrish = true;
                if (call.find("_CTR") != std::string::npos || call.find("_FSS") != std::string::npos)
                    ctrish = true;
                if (!ctrish)
                    continue;
                // Skip ourselves
                if (ControllerMyself().IsValid() &&
                    strcmp(csn, ControllerMyself().GetCallsign()) == 0)
                    continue;
                target = call;
                break;
            }
        }
        if (target.empty()) {
            DisplayMessage("initiateCoordination: No target controller for " + cs);
            return false;
        }

        // Capture sticky ACCEPTED *before* Initiate — same-level re-request often leaves
        // ES ACCEPTED with no REQUESTED_BY_ME; must not auto-EST that as a new accept.
        using EuroScopePlugIn::COORDINATION_STATE_ACCEPTED;
        using EuroScopePlugIn::COORDINATION_STATE_MANUAL_ACCEPTED;
        bool stickyAcceptedBefore = false;
        try {
            const int preAlt = fp.GetExitCoordinationAltitudeState();
            const int preName = fp.GetExitCoordinationNameState();
            const int preNext = fp.GetCoordinatedNextControllerState();
            stickyAcceptedBefore =
                preAlt == COORDINATION_STATE_ACCEPTED ||
                preAlt == COORDINATION_STATE_MANUAL_ACCEPTED ||
                preName == COORDINATION_STATE_ACCEPTED ||
                preName == COORDINATION_STATE_MANUAL_ACCEPTED ||
                preNext == COORDINATION_STATE_ACCEPTED ||
                preNext == COORDINATION_STATE_MANUAL_ACCEPTED;
        } catch (...) {
        }

        // (3) Try XFL-only: empty point + altitude (undocumented; may be refused).
        bool ok = false;
        if (fp.InitiateCoordination(target.c_str(), "", alt)) {
            DebugMessage("initiateCoordination: " + cs + " → " + target +
                         " XFL-only alt=" + std::to_string(alt));
            DisplayMessage("XFL coord: " + cs + " → " + target + " (no COPX) " +
                           std::to_string(alt));
            ok = true;
        } else {
            DebugMessage("initiateCoordination: empty-point XFL refused for " + cs);

            // (1) Fall back: LOP DCT point (MIKNA/…) + XFL — not ESE COPX/BEDOS.
            if (lopPt.empty()) {
                DisplayMessage("initiateCoordination: XFL-only refused; no LOP point for " + cs);
                return false;
            }
            if (!fp.InitiateCoordination(target.c_str(), lopPt.c_str(), alt)) {
                DisplayMessage("initiateCoordination: ES refused for " + cs + " → " + target +
                               " @" + lopPt + " " + std::to_string(alt));
                return false;
            }

            DebugMessage("initiateCoordination: " + cs + " → " + target + " @" + lopPt +
                         " (LOP) alt=" + std::to_string(alt));
            DisplayMessage("XFL coord: " + cs + " → " + target + " " + lopPt + " " +
                           std::to_string(alt));
            ok = true;
        }

        // Fresh outbound cycle: reset accept/refuse edges even if XFL already equals
        // the previously accepted level (ES may leave state at ACCEPTED / no-op).
        BeginOutboundCoordCycle(cs, alt, lopPt, fp, stickyAcceptedBefore);
        // If ES already ACCEPTED (sticky same-level), resolve immediately so we do not
        // leave forced exitCoordOutbound / "Outbound XFL coordination pending" UI.
        UpdateOutboundCoordCycle(cs, fp);
        nlohmann::json message = nlohmann::json::object();
        message["type"] = "controllerAssignedDataUpdate";
        SetJsonIfValidUtf8(message, "callsign", cs.c_str());
        AppendXfl(message, fp);
        auto cycleIt = outboundCoordCycles.find(cs);
        const bool cycleStillOpen =
            cycleIt != outboundCoordCycles.end() && cycleIt->second.active &&
            !cycleIt->second.refuseLatched && !cycleIt->second.acceptNotified;
        // Force pink outbound only while waiting — not when cycle already closed on ACCEPTED.
        message["exitCoordOutbound"] = cycleStillOpen;
        message["exitCoordRefused"] = false;
        // Never echo accept on Initiate (sticky ACCEPTED ≠ new accept sound).
        lastXflSnapshot[cs] = MakeXflSnapshot(fp);
        PostJson(message, "initiateCoordination");
        return ok;
    } catch (const std::exception &e) {
        DisplayMessage(std::string("initiateCoordination exception: ") + e.what());
    } catch (...) {
        DisplayMessage("initiateCoordination: Unknown exception");
    }
    return false;
}

bool VatEFSPlugin::SendAcceptCoordination(const std::string &callsign)
{
    try {
        std::string cs = callsign;
        for (auto &c : cs)
            c = (char)std::toupper((unsigned char)c);
        auto fp = FlightPlanSelect(cs.c_str());
        if (!fp.IsValid()) {
            DisplayMessage("acceptCoordination: No FP for " + cs);
            return false;
        }

        // Accept always clears REQUESTED_BY_OTHER (inbound). Never set EST here —
        // EST is only for ACC accepting our outbound DEP (REQUESTED_BY_ME → accepted),
        // handled in PollXflChanges / CAD via ShouldAutoEstOnXflTransition.
        fp.AcceptCoordination();
        DebugMessage(std::string("acceptCoordination: ") + cs + " [inbound — no DepC]");
        // Inbound Accept (e.g. ESMS ACC 4000 counter) closes any stale outbound refuse
        // latch so later CAD/Poll cannot revive amber.
        {
            auto cit = outboundCoordCycles.find(cs);
            if (cit != outboundCoordCycles.end()) {
                cit->second.active = false;
                cit->second.refuseLatched = false;
                cit->second.refuseNotified = false;
                cit->second.cancelledNotified = true;
            }
        }
        nlohmann::json message = nlohmann::json::object();
        message["type"] = "controllerAssignedDataUpdate";
        SetJsonIfValidUtf8(message, "callsign", cs.c_str());
        AppendXfl(message, fp);
        message["exitCoordRefused"] = false;
        message["exitCoordOutbound"] = false;
        lastXflSnapshot[cs] = MakeXflSnapshot(fp);
        PostJson(message, "acceptCoordination");
        return true;
    } catch (const std::exception &e) {
        DisplayMessage(std::string("acceptCoordination exception: ") + e.what());
    } catch (...) {
        DisplayMessage("acceptCoordination: Unknown exception");
    }
    return false;
}

bool VatEFSPlugin::SendRefuseCoordination(const std::string &callsign)
{
    try {
        std::string cs = callsign;
        for (auto &c : cs)
            c = (char)std::toupper((unsigned char)c);
        auto fp = FlightPlanSelect(cs.c_str());
        if (!fp.IsValid()) {
            DisplayMessage("refuseCoordination: No FP for " + cs);
            return false;
        }
        fp.RefuseCoordination();
        DebugMessage("refuseCoordination: " + cs);
        nlohmann::json message = nlohmann::json::object();
        message["type"] = "controllerAssignedDataUpdate";
        SetJsonIfValidUtf8(message, "callsign", cs.c_str());
        AppendXfl(message, fp);
        lastXflSnapshot[cs] = MakeXflSnapshot(fp);
        PostJson(message, "refuseCoordination");
        return true;
    } catch (const std::exception &e) {
        DisplayMessage(std::string("refuseCoordination exception: ") + e.what());
    } catch (...) {
        DisplayMessage("refuseCoordination: Unknown exception");
    }
    return false;
}

void VatEFSPlugin::Refresh()
{
    // Force a full CDM push — PollCdmDataFiles normally skips unchanged rows, so a
    // mid-session .efs start would otherwise miss ASRT/TSAC/CTOC/TOBT.
    lastCdmFileSnapshot.clear();

    for (EuroScopePlugIn::CFlightPlan FlightPlan = FlightPlanSelectFirst(); FlightPlan.IsValid();
         FlightPlan = FlightPlanSelectNext(FlightPlan)) {
        OnFlightPlanFlightPlanDataUpdate(FlightPlan);

        auto ctrData = FlightPlan.GetControllerAssignedData();
        nlohmann::json message = nlohmann::json::object();
        message["type"] = "controllerAssignedDataUpdate";
        SetJsonIfValidUtf8(message, "callsign", FlightPlan.GetCallsign());
        const char *squawk = ctrData.GetSquawk();
        if (IsValidOctalSquawk(squawk)) {
            SetJsonIfValidUtf8(message, "squawk", squawk);
        }
        int rfl = FlightPlan.GetFinalAltitude();
        if (rfl > 0 && rfl <= 100000) {
            message["rfl"] = rfl;
        }
        int cfl = ctrData.GetClearedAltitude();
        message["cfl"] = cfl;
        if (cfl == 1 || cfl == 2) {
            message["ahdg"] = 0;
            message["direct"] = "";
        }
        AppendXfl(message, FlightPlan);
        {
            const char *cs = FlightPlan.GetCallsign();
            if (cs && cs[0] != '\0')
                lastXflSnapshot[cs] = MakeXflSnapshot(FlightPlan);
        }
        SetJsonIfValidUtf8(message, "scratch", ctrData.GetScratchPadString());
        // VCH HS (ann 4) + CTL (ann 3) + REQ (ann 2) + EFS soft G/A (ann 5) + DepC (ann 6)
        {
            const char *cs = FlightPlan.GetCallsign();
            std::string hs;
            bool ctl = false;
            bool efsGa = false;
            bool est = false;
            std::string vchReq;
            if (cs && cs[0] != '\0') {
                hs = GetHoldShort(cs);
                ctl = GetVchCtl(cs);
                efsGa = GetEfsGoAround(cs);
                est = GetEstCoo(cs);
                vchReq = GetVchRequest(cs);
                lastHoldShortSnapshot[cs] = hs;
                lastCtlSnapshot[cs] = ctl ? "1" : "0";
                lastEfsGaSnapshot[cs] = efsGa ? "1" : "0";
                lastEstCooSnapshot[cs] = est ? "1" : "0";
                lastVchRequestSnapshot[cs] = vchReq;
            }
            message["hs"] = hs;
            message["clearedToLand"] = ctl;
            message["efsGoAround"] = efsGa;
            message["coo"] = est;
            message["vchRequest"] = vchReq;
        }
        SetJsonGroundstateFromFpOrScratch(message, FlightPlan);
        message["clearance"] = (bool)FlightPlan.GetClearenceFlag();
        int speed = ctrData.GetAssignedSpeed();
        if (speed >= 0 && speed <= 1500) { // Reasonable speed range
            message["asp"] = speed;
        }
        double mach = ctrData.GetAssignedMach();
        if (mach >= 0.0 && mach <= 10.0) { // Reasonable mach range
            message["mach"] = mach;
        }
        int rate = ctrData.GetAssignedRate();
        if (rate >= -50000 && rate <= 50000) { // Reasonable rate range
            message["arc"] = rate;
        }
        int heading = ctrData.GetAssignedHeading();
        if (heading >= 0 && heading <= 360) { // Valid heading range
            message["ahdg"] = heading;
        }
        const char *directTo = ctrData.GetDirectToPointName();
        const std::string directStr = directTo ? directTo : "";
        if (directStr.size() < 50) {
            message["direct"] = directStr;
            if (!directStr.empty()) message["ahdg"] = 0;
        } else if (heading > 0) {
            message["direct"] = "";
        }
        PostJson(message, "Refresh");
    }
    for (EuroScopePlugIn::CRadarTarget RadarTarget = RadarTargetSelectFirst();
         RadarTarget.IsValid(); RadarTarget = RadarTargetSelectNext(RadarTarget)) {
        OnRadarTargetPositionUpdate(RadarTarget);
    }
    for (EuroScopePlugIn::CController Controller = ControllerSelectFirst(); Controller.IsValid();
         Controller = ControllerSelectNext(Controller)) {
        OnControllerPositionUpdate(Controller);
    }

    // Push every CDM row + strip annotation (ASRT/TSAC/CTOC/setBy) now that FPs exist
    PollCdmDataFiles(true);
}

void VatEFSPlugin::DebugMessage(const std::string &message, const std::string &sender)
{
    if (debug) DisplayMessage(message, sender);
}

void VatEFSPlugin::DisplayMessage(const std::string &message, const std::string &sender)
{
    DisplayUserMessage(PLUGIN_NAME, sender.c_str(), message.c_str(), true, false, false, false, false);
}

bool VatEFSPlugin::FilterFlightPlan(EuroScopePlugIn::CFlightPlan FlightPlan)
{
    try {
        if (!FlightPlan.IsValid()) return false;

        EuroScopePlugIn::CFlightPlanData fpData = FlightPlan.GetFlightPlanData();
        if (!fpData.IsReceived()) return false;

        const char *origin = fpData.GetOrigin();
        const char *destination = fpData.GetDestination();
        if (!origin || !destination || !*origin || !*destination) return false;

        // Safe string comparison with length check
        if (strlen(origin) < 2 || strlen(destination) < 2) return false;
        if (strncmp(origin, "ES", 2) != 0 && strncmp(destination, "ES", 2) != 0) return false;

        return true;
    } catch (...) {
        DisplayMessage("FilterFlightPlan: Exception occurred");
        return false;
    }
}

void VatEFSPlugin::InitializeWinsock()
{
    if (winsockInitialized) return;

    try {
        WSADATA wsaData;
        int result = WSAStartup(MAKEWORD(2, 2), &wsaData);
        if (result != 0) {
            DisplayMessage("WSAStartup failed: " + std::to_string(result));
            return;
        }
        winsockInitialized = true;
        DebugMessage("Winsock initialized");
    } catch (...) {
        DisplayMessage("InitializeWinsock: Unknown exception");
    }
}

void VatEFSPlugin::CleanupWinsock()
{
    if (winsockInitialized) {
        WSACleanup();
        winsockInitialized = false;
        DebugMessage("Winsock cleaned up");
    }
}

void VatEFSPlugin::InitializeUdpReceiveSocket()
{
    if (udpReceiveSocket != nullptr) return;

    try {
        if (!winsockInitialized) {
            DisplayMessage("Cannot initialize UDP socket: Winsock not initialized");
            return;
        }

        // Create UDP socket
        SOCKET sock = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
        if (sock == INVALID_SOCKET) {
            DisplayMessage("UDP socket creation failed: " + std::to_string(WSAGetLastError()));
            return;
        }

        // Set socket to non-blocking mode
        u_long mode = 1;
        if (ioctlsocket(sock, FIONBIO, &mode) == SOCKET_ERROR) {
            DisplayMessage("Failed to set UDP socket to non-blocking: " + std::to_string(WSAGetLastError()));
            closesocket(sock);
            return;
        }

        // Set up local address (127.0.0.1:17772)
        sockaddr_in localAddr;
        memset(&localAddr, 0, sizeof(localAddr));
        localAddr.sin_family = AF_INET;
        localAddr.sin_port = htons(17772);
        localAddr.sin_addr.s_addr = inet_addr("127.0.0.1");

        // Bind socket (17772 = receive from backend). 10048 = another ES/VatEFS already bound.
        if (bind(sock, (sockaddr *)&localAddr, sizeof(localAddr)) == SOCKET_ERROR) {
            const int err = WSAGetLastError();
            if (err == 10048) {
                DisplayMessage(
                    "UDP 17772 in use (another EuroScope/VatEFS?) - EFS commands half-duplex until free");
            } else {
                DisplayMessage("UDP bind failed: " + std::to_string(err));
            }
            closesocket(sock);
            return;
        }

        udpReceiveSocket = reinterpret_cast<void *>(sock);
        DebugMessage("UDP receive socket initialized on port 17772");
    } catch (...) {
        DisplayMessage("InitializeUdpReceiveSocket: Unknown exception");
    }
}

void VatEFSPlugin::CleanupUdpReceiveSocket()
{
    if (udpReceiveSocket != nullptr) {
        SOCKET sock = reinterpret_cast<SOCKET>(udpReceiveSocket);
        closesocket(sock);
        udpReceiveSocket = nullptr;
        DebugMessage("UDP receive socket cleaned up");
    }
}

// Convert a UTF-8 string to the local ANSI code page (e.g., Windows-1252).
// EuroScope expects ANSI strings, but JSON payloads arrive as UTF-8.
// For example, the middle dot '·' (U+00B7) is 0xC2 0xB7 in UTF-8 but 0xB7 in Latin-1/Windows-1252.
static std::string Utf8ToAnsi(const std::string &utf8)
{
    if (utf8.empty()) return utf8;
    int wideLen = MultiByteToWideChar(CP_UTF8, 0, utf8.c_str(), -1, NULL, 0);
    if (wideLen == 0) return utf8;
    std::wstring wide(wideLen, 0);
    MultiByteToWideChar(CP_UTF8, 0, utf8.c_str(), -1, &wide[0], wideLen);
    int ansiLen = WideCharToMultiByte(CP_ACP, 0, wide.c_str(), -1, NULL, 0, NULL, NULL);
    if (ansiLen == 0) return utf8;
    std::string ansi(ansiLen, 0);
    WideCharToMultiByte(CP_ACP, 0, wide.c_str(), -1, &ansi[0], ansiLen, NULL, NULL);
    if (!ansi.empty() && ansi.back() == '\0') ansi.pop_back();
    return ansi;
}

// Check if a string matches the pilot-filed SID pattern:
// 5 uppercase letters + 1 digit + 1 uppercase letter (e.g., VADIN3J)
static bool IsSidPattern(const std::string &s)
{
    if (s.length() != 7) return false;
    for (int i = 0; i < 5; i++) {
        if (!std::isupper((unsigned char)s[i])) return false;
    }
    if (!std::isdigit((unsigned char)s[5])) return false;
    if (!std::isupper((unsigned char)s[6])) return false;
    return true;
}

void VatEFSPlugin::EnqueueRouteExpand(const std::string &callsign)
{
    if (callsign.empty()) return;
    for (const auto &queued : routeExpandQueue) {
        if (queued == callsign) return;
    }
    routeExpandQueue.push_back(callsign);
}

void VatEFSPlugin::ExpandOneQueuedRoute()
{
    if (routeExpandQueue.empty()) return;
    const std::string callsign = routeExpandQueue.front();
    routeExpandQueue.erase(routeExpandQueue.begin());
    try {
        auto fp = FlightPlanSelect(callsign.c_str());
        if (!fp.IsValid()) {
            DebugMessage("expandRoute: no flight plan for " + callsign);
            return;
        }
        EuroScopePlugIn::CFlightPlanExtractedRoute extracted = fp.GetExtractedRoute();
        const int n = extracted.GetPointsNumber();
        std::string joined;
        if (n > 0 && n < 256) {
            for (int i = 0; i < n; ++i) {
                const char *name = extracted.GetPointName(i);
                if (!name || !*name || strlen(name) >= 16) continue;
                if (!joined.empty()) joined.push_back(' ');
                joined += AnsiToUtf8(name);
            }
        }
        nlohmann::json message = nlohmann::json::object();
        message["type"] = "flightPlanDataUpdate";
        message["callsign"] = callsign;
        message["extractedRoute"] = joined.size() < 2000 ? joined : joined.substr(0, 2000);
        PostJson(message, "expandRoute");
        DebugMessage("expandRoute: " + callsign + " (" + std::to_string(n) + " points)");
    } catch (const std::exception &e) {
        DisplayMessage(std::string("expandRoute exception: ") + e.what());
    } catch (...) {
        DisplayMessage("expandRoute: Unknown exception");
    }
}

void VatEFSPlugin::ReceiveUdpMessages()
{
    if (udpReceiveSocket == nullptr) return;

    try {
        SOCKET sock = reinterpret_cast<SOCKET>(udpReceiveSocket);
        char buffer[4096];
        // Drain the socket so a burst of expandRoute requests cannot sit in
        // front of assume/scratch. Expansion itself is one callsign per tick.
        int drained = 0;
        while (drained < 256) {
        sockaddr_in fromAddr;
        int fromAddrLen = sizeof(fromAddr);

        // Try to receive (non-blocking, so it returns immediately if no data)
        int recvResult = recvfrom(sock, buffer, sizeof(buffer) - 1, 0, (sockaddr *)&fromAddr, &fromAddrLen);

        if (recvResult == SOCKET_ERROR) {
            int error = WSAGetLastError();
            if (error == WSAEWOULDBLOCK || error == WSAECONNRESET) {
                // No data available or connection reset, this is normal
                break;
            } else {
                // Real error occurred
                DisplayMessage("UDP receive error: " + std::to_string(error));
                break;
            }
        }
        if (recvResult <= 0) break;
        drained++;

        if (recvResult > 0) {
            buffer[recvResult] = '\0';

            if (buffer[0] == '{') {
                nlohmann::json message = nlohmann::json::parse(buffer);
                if (message["type"] == "setGroundState") {
                    auto callsign = message["callsign"].get<std::string>();
                    for (auto &c : callsign)
                        c = (char)std::toupper((unsigned char)c);
                    auto state = message["state"].get<std::string>();
                    // Empty / NOSTATE clears ground state via scratch (ES rejects empty GS)
                    const bool clearGs = state.empty() || state == "NOSTATE";
                    // Native ES tokens (PUSH/TAXI/LINEUP/…) — not GRP display aliases (S/P/TXO)
                    const std::string scratchState =
                        clearGs ? "NOSTATE" : ToEsGroundStateWriteToken(state);
                    DebugMessage("setGroundState: " + callsign + " " +
                                 (clearGs ? "(clear)" : scratchState));
                    if (callsign.empty()) {
                        DisplayMessage("setGroundState: Invalid callsign");
                    } else {
                        auto fp = FlightPlanSelect(callsign.c_str());
                        // Untracked: StartTracking first so PUSH/TAXI scratch sticks
                        if (fp.IsValid() && !EnsureTrackingIfUntracked(fp, callsign)) {
                            DisplayMessage("setGroundState: Failed for " + callsign);
                        } else if (UpdateScratchPad(callsign, scratchState, true)) {
                            // Echo immediately — CAD often lags after scratch flash
                            nlohmann::json echo = nlohmann::json::object();
                            echo["type"] = "controllerAssignedDataUpdate";
                            echo["callsign"] = callsign;
                            echo["groundstate"] = clearGs ? "" : scratchState;
                            PostJson(echo, "setGroundState");
                        } else {
                            DisplayMessage("setGroundState: Failed for " + callsign);
                        }
                    }
                } else if (message["type"] == "setClearedToLand") {
                    // VCH CTL — strip annotation 3
                    auto callsign = message["callsign"].get<std::string>();
                    for (auto &c : callsign)
                        c = (char)std::toupper((unsigned char)c);
                    if (callsign.empty()) {
                        DisplayMessage("setClearedToLand: Invalid callsign");
                    } else if (!SetVchCtl(callsign, true)) {
                        DisplayMessage("setClearedToLand: Failed for " + callsign);
                    } else {
                        lastCtlSnapshot[callsign] = "1";
                        DebugMessage("setClearedToLand: " + callsign + " -> CTL (VCH)");
                        nlohmann::json echo = nlohmann::json::object();
                        echo["type"] = "controllerAssignedDataUpdate";
                        echo["callsign"] = callsign;
                        echo["clearedToLand"] = true;
                        PostJson(echo, "setClearedToLand");
                    }
                } else if (message["type"] == "unsetClearedToLand") {
                    auto callsign = message["callsign"].get<std::string>();
                    for (auto &c : callsign)
                        c = (char)std::toupper((unsigned char)c);
                    if (callsign.empty()) {
                        DisplayMessage("unsetClearedToLand: Invalid callsign");
                    } else if (!SetVchCtl(callsign, false)) {
                        DisplayMessage("unsetClearedToLand: Failed for " + callsign);
                    } else {
                        lastCtlSnapshot[callsign] = "0";
                        DebugMessage("unsetClearedToLand: " + callsign + " (VCH)");
                        nlohmann::json echo = nlohmann::json::object();
                        echo["type"] = "controllerAssignedDataUpdate";
                        echo["callsign"] = callsign;
                        echo["clearedToLand"] = false;
                        PostJson(echo, "unsetClearedToLand");
                    }
                } else if (message["type"] == "goaround") {
                    auto callsign = message["callsign"].get<std::string>();
                    for (auto &c : callsign)
                        c = (char)std::toupper((unsigned char)c);
                    if (!callsign.empty()) {
                        // Clear VCH CTL so list + EFS stay in sync on go-around
                        if (SetVchCtl(callsign, false)) {
                            lastCtlSnapshot[callsign] = "0";
                            nlohmann::json echo = nlohmann::json::object();
                            echo["type"] = "controllerAssignedDataUpdate";
                            echo["callsign"] = callsign;
                            echo["clearedToLand"] = false;
                            PostJson(echo, "goaround");
                        }
                        UpdateScratchPad(callsign, "MISAP_", false);
                    } else {
                        DisplayMessage("goaround: Invalid callsign");
                    }
                } else if (message["type"] == "setEfsGoAround") {
                    // EFS soft G/A — annotation 5 (syncs to other EFS; not TopSky MISAP_)
                    auto callsign = message["callsign"].get<std::string>();
                    for (auto &c : callsign)
                        c = (char)std::toupper((unsigned char)c);
                    if (callsign.empty()) {
                        DisplayMessage("setEfsGoAround: Invalid callsign");
                    } else if (!SetEfsGoAround(callsign, true)) {
                        DisplayMessage("setEfsGoAround: Failed for " + callsign);
                    } else {
                        lastEfsGaSnapshot[callsign] = "1";
                        // Keep VCH CTL if already set — soft G/A must not clear it
                        DebugMessage("setEfsGoAround: " + callsign + " -> EFSGA");
                        nlohmann::json echo = nlohmann::json::object();
                        echo["type"] = "controllerAssignedDataUpdate";
                        echo["callsign"] = callsign;
                        echo["efsGoAround"] = true;
                        PostJson(echo, "setEfsGoAround");
                    }
                } else if (message["type"] == "unsetEfsGoAround") {
                    auto callsign = message["callsign"].get<std::string>();
                    for (auto &c : callsign)
                        c = (char)std::toupper((unsigned char)c);
                    if (callsign.empty()) {
                        DisplayMessage("unsetEfsGoAround: Invalid callsign");
                    } else if (!SetEfsGoAround(callsign, false)) {
                        DisplayMessage("unsetEfsGoAround: Failed for " + callsign);
                    } else {
                        lastEfsGaSnapshot[callsign] = "0";
                        DebugMessage("unsetEfsGoAround: " + callsign);
                        nlohmann::json echo = nlohmann::json::object();
                        echo["type"] = "controllerAssignedDataUpdate";
                        echo["callsign"] = callsign;
                        echo["efsGoAround"] = false;
                        PostJson(echo, "unsetEfsGoAround");
                    }
                } else if (message["type"] == "rof") {
                    auto callsign = message["callsign"].get<std::string>();
                    if (!SendRof(callsign, false)) {
                        // SendRof already displayed a specific error
                    }
                } else if (message["type"] == "efsRof") {
                    // ESSA ground DEL/GND/TWR — custom EFS ROF (no TopSky sector sequence)
                    auto callsign = message["callsign"].get<std::string>();
                    if (!SendRof(callsign, true)) {
                        // SendRof already displayed a specific error
                    }
                } else if (message["type"] == "contactme") {
                    // Brittle ES .contactme — see SendContactMe()
                    auto callsign = message["callsign"].get<std::string>();
                    if (!SendContactMe(callsign)) {
                        // SendContactMe already displayed a specific error
                    }
                } else if (message["type"] == "cdmPm") {
                    // Brittle CDM flow PM — see SendCdmPrivateMessage()
                    auto callsign = message["callsign"].get<std::string>();
                    auto text = message.value("text", std::string());
                    if (!SendCdmPrivateMessage(callsign, text)) {
                        // SendCdmPrivateMessage already displayed a specific error
                    }
                } else if (message["type"] == "clearScratchpad") {
                    auto callsign = message["callsign"].get<std::string>();
                    if (!callsign.empty()) {
                        UpdateScratchPad(callsign, "", false);
                    } else {
                        DisplayMessage("clearScratchpad: Invalid callsign");
                    }
                } else if (message["type"] == "setScratch") {
                    auto callsign = message["callsign"].get<std::string>();
                    auto value = message["value"].get<std::string>();
                    if (!callsign.empty()) {
                        UpdateScratchPad(callsign, value, false);
                    } else {
                        DisplayMessage("setScratch: Invalid callsign");
                    }
                } else if (message["type"] == "setScratchTmp") {
                    // Transient TopSky token (e.g. /APPTYPE/CAT3/) — set then restore previous scratch
                    auto callsign = message["callsign"].get<std::string>();
                    auto value = message["value"].get<std::string>();
                    if (!callsign.empty()) {
                        bool ok = UpdateScratchPad(callsign, value, true);
                        if (!ok) DisplayMessage("setScratchTmp: Failed for " + callsign);
                        else DebugMessage("setScratchTmp: " + callsign + " -> " + value);
                    } else {
                        DisplayMessage("setScratchTmp: Invalid callsign");
                    }
                } else if (message["type"] == "setHs") {
                    // VCH hold short — strip annotation 4 (max 5 chars)
                    auto callsign = message["callsign"].get<std::string>();
                    auto value = message.contains("value") && message["value"].is_string()
                                     ? message["value"].get<std::string>()
                                     : "";
                    for (auto &c : callsign)
                        c = (char)std::toupper((unsigned char)c);
                    for (auto &c : value)
                        c = (char)std::toupper((unsigned char)c);
                    if (value.size() > 5) value.resize(5);
                    if (callsign.empty()) {
                        DisplayMessage("setHs: Invalid callsign");
                    } else if (!SetHoldShort(callsign, value)) {
                        DisplayMessage("setHs: Failed for " + callsign);
                    } else {
                        lastHoldShortSnapshot[callsign] = value;
                        DebugMessage("setHs: " + callsign + " -> " + (value.empty() ? "(clear)" : value));
                        nlohmann::json echo = nlohmann::json::object();
                        echo["type"] = "controllerAssignedDataUpdate";
                        echo["callsign"] = callsign;
                        echo["hs"] = value;
                        PostJson(echo, "setHs");
                    }
                } else if (message["type"] == "setCoo") {
                    // Departure Coordination — strip annotation 6 ("DepC")
                    auto callsign = message["callsign"].get<std::string>();
                    bool coo = message.contains("coo") && message["coo"].is_boolean()
                                   ? message["coo"].get<bool>()
                                   : false;
                    for (auto &c : callsign)
                        c = (char)std::toupper((unsigned char)c);
                    if (callsign.empty()) {
                        DisplayMessage("setCoo: Invalid callsign");
                    } else if (!SetEstCoo(callsign, coo)) {
                        DisplayMessage("setCoo: Failed for " + callsign);
                    } else {
                        lastEstCooSnapshot[callsign] = coo ? "1" : "0";
                        DebugMessage(std::string("setCoo: ") + callsign + " -> " +
                                     (coo ? "DepC" : "(clear)"));
                        // DepC clears amber — drop refuse latch so CAD cannot revive it.
                        if (coo) {
                            auto cit = outboundCoordCycles.find(callsign);
                            if (cit != outboundCoordCycles.end()) {
                                cit->second.refuseLatched = false;
                                cit->second.refuseNotified = false;
                                cit->second.active = false;
                                cit->second.cancelledNotified = true;
                            }
                        }
                        nlohmann::json echo = nlohmann::json::object();
                        echo["type"] = "controllerAssignedDataUpdate";
                        echo["callsign"] = callsign;
                        echo["coo"] = coo;
                        if (coo)
                            echo["exitCoordRefused"] = false;
                        PostJson(echo, "setCoo");
                    }
                } else if (message["type"] == "initiateCoordination") {
                    // COPX/XFL exit coordination only — never clearance / EST
                    auto callsign = message["callsign"].get<std::string>();
                    for (auto &c : callsign)
                        c = (char)std::toupper((unsigned char)c);
                    int altitude = 0;
                    if (message.contains("altitude") && message["altitude"].is_number())
                        altitude = message["altitude"].get<int>();
                    std::string point;
                    if (message.contains("point") && message["point"].is_string())
                        point = message["point"].get<std::string>();
                    std::string target;
                    if (message.contains("targetController") && message["targetController"].is_string())
                        target = message["targetController"].get<std::string>();
                    if (callsign.empty()) {
                        DisplayMessage("initiateCoordination: Invalid callsign");
                    } else if (!SendInitiateCoordination(callsign, altitude, point, target)) {
                        // SendInitiateCoordination already DisplayMessage'd
                    }
                } else if (message["type"] == "acceptCoordination") {
                    auto callsign = message["callsign"].get<std::string>();
                    for (auto &c : callsign)
                        c = (char)std::toupper((unsigned char)c);
                    if (callsign.empty()) {
                        DisplayMessage("acceptCoordination: Invalid callsign");
                    } else if (!SendAcceptCoordination(callsign)) {
                        // SendAcceptCoordination already DisplayMessage'd
                    }
                } else if (message["type"] == "refuseCoordination") {
                    auto callsign = message["callsign"].get<std::string>();
                    for (auto &c : callsign)
                        c = (char)std::toupper((unsigned char)c);
                    if (callsign.empty()) {
                        DisplayMessage("refuseCoordination: Invalid callsign");
                    } else if (!SendRefuseCoordination(callsign)) {
                        // SendRefuseCoordination already DisplayMessage'd
                    }
                } else if (message["type"] == "expandRoute") {
                    // Enqueue only. GetExtractedRoute runs once per timer tick.
                    auto callsign = message["callsign"].get<std::string>();
                    for (auto &c : callsign)
                        c = (char)std::toupper((unsigned char)c);
                    EnqueueRouteExpand(callsign);
                } else if (message["type"] == "refresh") {
                    Refresh();
                } else if (message["type"] == "assume") {
                    auto callsign = message["callsign"].get<std::string>();
                    for (auto &c : callsign)
                        c = (char)std::toupper((unsigned char)c);
                    if (!callsign.empty()) {
                        auto fp = FlightPlanSelect(callsign.c_str());
                        if (fp.IsValid()) {
                            const char *handoffTarget = fp.GetHandoffTargetControllerCallsign();
                            const char *trackingCallsign = fp.GetTrackingControllerCallsign();
                            const char *trackingId = fp.GetTrackingControllerId();
                            bool handoffToMe =
                            handoffTarget && handoffTarget[0] != '\0' && ControllerMyself().IsValid() &&
                            strcmp(handoffTarget, ControllerMyself().GetCallsign()) == 0;
                            // SI alone counts as tracked (callsign often blank at TWR)
                            bool untracked =
                                (!trackingCallsign || trackingCallsign[0] == '\0') &&
                                (!trackingId || trackingId[0] == '\0');
                            bool trackedByMe = fp.GetTrackingControllerIsMe();
                            bool outgoingHandoff = trackedByMe && handoffTarget && handoffTarget[0] != '\0' && !handoffToMe;
                            auto postOwnershipEcho = [&]() {
                                nlohmann::json echo = nlohmann::json::object();
                                echo["type"] = "ownershipUpdate";
                                echo["callsign"] = callsign;
                                echo["ok"] = true;
                                AppendOwnershipFields(echo, fp);
                                echo["trackedByMe"] = fp.GetTrackingControllerIsMe();
                                echo["fpState"] = fp.GetState();
                                PostJson(echo, "assume");
                            };
                            if (handoffToMe) {
                                fp.AcceptHandoff();
                                DebugMessage("Accepted handoff for " + callsign);
                                OnFlightPlanFlightPlanDataUpdate(fp);
                                postOwnershipEcho();
                            } else if (outgoingHandoff) {
                                bool ok = fp.StartTracking();
                                if (ok) {
                                    DebugMessage("Cancelled handoff for " + callsign);
                                    OnFlightPlanFlightPlanDataUpdate(fp);
                                    postOwnershipEcho();
                                } else
                                    DisplayMessage("Failed to cancel handoff for " + callsign);
                            } else if (untracked) {
                                bool ok = fp.StartTracking();
                                if (ok) {
                                    DebugMessage("Started tracking " + callsign);
                                    OnFlightPlanFlightPlanDataUpdate(fp);
                                    postOwnershipEcho();
                                } else
                                    DisplayMessage("assume: Failed to start tracking " + callsign);
                            } else {
                                DisplayMessage(callsign + " already tracked by " +
                                               std::string(trackingCallsign && trackingCallsign[0]
                                                               ? trackingCallsign
                                                               : (trackingId ? trackingId : "?")));
                            }
                        } else {
                            DisplayMessage("assume: Flight plan not found: " + callsign);
                        }
                    } else {
                        DisplayMessage("assume: Empty callsign");
                    }
                } else if (message["type"] == "transfer") {
                    auto callsign = message["callsign"].get<std::string>();
                    for (auto &c : callsign)
                        c = (char)std::toupper((unsigned char)c);
                    if (!callsign.empty()) {
                        auto fp = FlightPlanSelect(callsign.c_str());
                        if (fp.IsValid()) {
                            // Prefer coordinated next controller; fall back to targetCallsign from backend
                            std::string targetStr;
                            const char *nextCtr = fp.GetCoordinatedNextController();
                            if (message.contains("targetCallsign")) {
                                targetStr = message["targetCallsign"].get<std::string>();
                            } else if (nextCtr && nextCtr[0] != '\0') {
                                targetStr = nextCtr;
                            }
                            if (!targetStr.empty()) {
                                bool ok = fp.InitiateHandoff(targetStr.c_str());
                                if (ok) {
                                    DebugMessage("Handoff initiated to " + targetStr + " for " + callsign);
                                    OnFlightPlanFlightPlanDataUpdate(fp);
                                } else
                                    DisplayMessage("Failed to initiate handoff to " + targetStr + " for " + callsign);
                            } else {
                                bool ok = fp.EndTracking();
                                if (ok) {
                                    DebugMessage("Ended tracking " + callsign);
                                    OnFlightPlanFlightPlanDataUpdate(fp);
                                } else
                                    DisplayMessage("Failed to end tracking " + callsign);
                            }
                        } else {
                            DisplayMessage("transfer: Flight plan not found: " + callsign);
                        }
                    } else {
                        DisplayMessage("transfer: Empty callsign");
                    }
                } else if (message["type"] == "refuse") {
                    auto callsign = message["callsign"].get<std::string>();
                    for (auto &c : callsign)
                        c = (char)std::toupper((unsigned char)c);
                    if (!callsign.empty()) {
                        auto fp = FlightPlanSelect(callsign.c_str());
                        if (fp.IsValid()) {
                            const char *handoffTarget = fp.GetHandoffTargetControllerCallsign();
                            bool handoffToMe =
                                handoffTarget && handoffTarget[0] != '\0' && ControllerMyself().IsValid() &&
                                strcmp(handoffTarget, ControllerMyself().GetCallsign()) == 0;
                            if (handoffToMe) {
                                fp.RefuseHandoff();
                                DebugMessage("Refused handoff for " + callsign);
                                OnFlightPlanFlightPlanDataUpdate(fp);
                            } else {
                                DisplayMessage("refuse: No inbound handoff for " + callsign);
                            }
                        } else {
                            DisplayMessage("refuse: Flight plan not found: " + callsign);
                        }
                    } else {
                        DisplayMessage("refuse: Empty callsign");
                    }
                } else if (message["type"] == "release") {
                    auto callsign = message["callsign"].get<std::string>();
                    for (auto &c : callsign)
                        c = (char)std::toupper((unsigned char)c);
                    if (!callsign.empty()) {
                        auto fp = FlightPlanSelect(callsign.c_str());
                        if (fp.IsValid()) {
                            bool ok = fp.EndTracking();
                            if (ok) {
                                DebugMessage("Released (end tracking) " + callsign);
                                OnFlightPlanFlightPlanDataUpdate(fp);
                            } else
                                DisplayMessage("Failed to release " + callsign);
                        } else {
                            DebugMessage("release: Flight plan not found: " + callsign);
                        }
                    }
                } else if (message["type"] == "resetSquawk") {
                    auto callsign = message["callsign"].get<std::string>();
                    DebugMessage("resetSquawk: " + callsign);
                    if (dummyRadarScreens.size() > 0) {
                        dummyRadarScreens[0]->AllocateSSR(callsign.c_str());
                    } else {
                        DisplayMessage(
                        "To reset squawk the EFS plugin must be allowed to draw on radar screen.");
                        DisplayMessage("Please allow it in OTHER SET / Plug-ins ... menu.");
                    }
                } else if (message["type"] == "toggleClearanceFlag") {
                    auto callsign = message["callsign"].get<std::string>();
                    for (auto &c : callsign)
                        c = (char)std::toupper((unsigned char)c);
                    if (dummyRadarScreens.size() > 0) {
                        auto fp = FlightPlanSelect(callsign.c_str());
                        // Untracked: StartTracking first so CLR flag sticks
                        if (fp.IsValid())
                            EnsureTrackingIfUntracked(fp, callsign);
                        // Honor desired when present — bare toggle flips even when already correct
                        if (message.contains("desired") && !message["desired"].is_null()) {
                            bool desired = message["desired"].get<bool>();
                            bool force = message.contains("force") && !message["force"].is_null() &&
                                         message["force"].get<bool>();
                            if (force)
                                dummyRadarScreens[0]->ForceClearanceFlag(callsign.c_str(), desired);
                            else
                                dummyRadarScreens[0]->SetClearanceFlag(callsign.c_str(), desired);
                        } else {
                            dummyRadarScreens[0]->ToggleClearanceFlag(callsign.c_str());
                        }
                    } else {
                        DisplayMessage("To toggle clearance flag, the EFS plugin must be allowed "
                                       "to draw on radar screen.");
                        DisplayMessage("Please allow it in OTHER SET / Plug-ins ... menu.");
                    }
                } else if (message["type"] == "assignDepartureRunway") {
                    auto callsign = message["callsign"].get<std::string>();
                    auto runway = message["runway"].get<std::string>();
                    DebugMessage("assignDepartureRunway: " + callsign + " -> " + (runway.empty() ? "(clear)" : runway));
                    for (auto &c : callsign)
                        c = (char)std::toupper((unsigned char)c);
                    auto fp = FlightPlanSelect(callsign.c_str());
                    if (!fp.IsValid()) {
                        DisplayMessage("assignDepartureRunway: Flight plan not found: " + callsign);
                    } else {
                        auto fpData = fp.GetFlightPlanData();
                        const char *routeStr = fpData.GetRoute();
                        std::string route = routeStr ? routeStr : "";
                        const char *origin = fpData.GetOrigin();
                        std::string departureAirport = origin ? origin : "";

                        std::string firstTerm;
                        std::string restOfRoute;
                        auto spacePos = route.find(' ');
                        if (spacePos != std::string::npos) {
                            firstTerm = route.substr(0, spacePos);
                            restOfRoute = route.substr(spacePos + 1);
                        } else {
                            firstTerm = route;
                        }

                        std::string newRoute;
                        bool amend = false;
                        auto slashPos = firstTerm.find('/');
                        if (runway.empty()) {
                            // Clear dep runway: drop SID/rwy or ADEP/rwy prefix
                            if (slashPos != std::string::npos) {
                                newRoute = restOfRoute;
                                amend = true;
                            } else {
                                DebugMessage("assignDepartureRunway: clear skipped (no rwy prefix)");
                            }
                        } else if (departureAirport.empty()) {
                            DisplayMessage("assignDepartureRunway: No origin airport");
                        } else {
                            // Always ADEP/rwy at start of FPL (replaces SID/rwy or prior ADEP/rwy)
                            std::string body = route;
                            if (slashPos != std::string::npos) {
                                body = restOfRoute;
                            } else if (IsSidPattern(firstTerm)) {
                                body = restOfRoute;
                            }
                            newRoute = departureAirport + "/" + runway;
                            if (!body.empty()) newRoute += " " + body;
                            amend = true;
                        }
                        if (amend) {
                            std::string ansiRoute = Utf8ToAnsi(newRoute);
                            DebugMessage("assignDepartureRunway: new route: " + ansiRoute);
                            fpData.SetRoute(ansiRoute.c_str());
                            fpData.AmendFlightPlan();
                        }
                    }
                } else if (message["type"] == "assignSid") {
                    auto callsign = message["callsign"].get<std::string>();
                    auto sid = message["sid"].get<std::string>();
                    DebugMessage("assignSid: " + callsign + " -> " + (sid.empty() ? "(clear)" : sid));
                    for (auto &c : callsign)
                        c = (char)std::toupper((unsigned char)c);
                    auto fp = FlightPlanSelect(callsign.c_str());
                    if (!fp.IsValid()) {
                        DisplayMessage("assignSid: Flight plan not found: " + callsign);
                    } else {
                        auto fpData = fp.GetFlightPlanData();
                        const char *routeStr = fpData.GetRoute();
                        std::string route = routeStr ? routeStr : "";
                        const char *depRwy = fpData.GetDepartureRwy();
                        std::string currentRwy = depRwy ? depRwy : "";
                        const char *origin = fpData.GetOrigin();
                        std::string adep = origin ? origin : "";

                        std::string firstTerm;
                        std::string restOfRoute;
                        auto spacePos = route.find(' ');
                        if (spacePos != std::string::npos) {
                            firstTerm = route.substr(0, spacePos);
                            restOfRoute = route.substr(spacePos + 1);
                        } else {
                            firstTerm = route;
                        }

                        auto isAirportIcao = [](const std::string &s) {
                            if (s.size() != 4) return false;
                            for (char c : s)
                                if (!std::isupper((unsigned char)c)) return false;
                            return true;
                        };

                        std::string newRoute;
                        bool amend = false;
                        auto slashPos = firstTerm.find('/');
                        if (sid.empty()) {
                            // Clear SID: SID/rwy → drop prefix (rest of route).
                            // ADEP/rwy only forces RWY (no SID) — still drop it on clear.
                            if (slashPos != std::string::npos) {
                                std::string prefix = firstTerm.substr(0, slashPos);
                                std::string existingRwy = firstTerm.substr(slashPos + 1);
                                if (isAirportIcao(prefix)) {
                                    // ADEP/rwy — not a SID; clear means remove the prefix
                                    newRoute = restOfRoute;
                                    amend = true;
                                    DebugMessage("assignSid: clear dropped ADEP/rwy " + firstTerm);
                                } else if (!adep.empty() && !existingRwy.empty()) {
                                    std::string rwy = existingRwy;
                                    if (!currentRwy.empty() && existingRwy != currentRwy) {
                                        rwy = currentRwy;
                                    }
                                    newRoute = adep + "/" + rwy;
                                    if (!restOfRoute.empty()) newRoute += " " + restOfRoute;
                                    amend = true;
                                } else if (!restOfRoute.empty()) {
                                    newRoute = restOfRoute;
                                    amend = true;
                                }
                            } else if (!firstTerm.empty() && !isAirportIcao(firstTerm)
                                       && (IsSidPattern(firstTerm)
                                           || firstTerm.find('*') != std::string::npos
                                           || firstTerm.find('.') != std::string::npos
                                           || std::any_of(firstTerm.begin(), firstTerm.end(), [](unsigned char c) {
                                                  return !std::isalnum(c);
                                              }))) {
                                // Bare SID / track term — replace with ADEP/rwy
                                if (!adep.empty() && !currentRwy.empty()) {
                                    newRoute = adep + "/" + currentRwy;
                                    if (!restOfRoute.empty()) newRoute += " " + restOfRoute;
                                    amend = true;
                                } else if (!restOfRoute.empty()) {
                                    newRoute = restOfRoute;
                                    amend = true;
                                }
                            } else {
                                DebugMessage("assignSid: clear skipped (no SID prefix)");
                            }
                        } else if (slashPos != std::string::npos) {
                            // Already has SID/rwy or airport/rwy prefix - keep runway, change SID
                            std::string existingRwy = firstTerm.substr(slashPos + 1);
                            newRoute = sid + "/" + existingRwy;
                            if (!restOfRoute.empty()) newRoute += " " + restOfRoute;
                            amend = true;
                        } else if (IsSidPattern(firstTerm)) {
                            // Pilot-filed SID - replace with new SID/runway
                            newRoute = sid + "/" + currentRwy;
                            if (!restOfRoute.empty()) newRoute += " " + restOfRoute;
                            amend = true;
                        } else {
                            // No prefix - prepend SID/runway before the full original route
                            newRoute = sid + "/" + currentRwy;
                            if (!route.empty()) newRoute += " " + route;
                            amend = true;
                        }
                        if (amend) {
                            std::string ansiRoute = Utf8ToAnsi(newRoute);
                            DebugMessage("assignSid: new route: " + ansiRoute);
                            fpData.SetRoute(ansiRoute.c_str());
                            fpData.AmendFlightPlan();
                        }
                    }
                } else if (message["type"] == "assignArrivalRunway") {
                    auto callsign = message["callsign"].get<std::string>();
                    auto runway = message["runway"].get<std::string>();
                    DebugMessage("assignArrivalRunway: " + callsign + " -> " + (runway.empty() ? "(clear)" : runway));
                    for (auto &c : callsign)
                        c = (char)std::toupper((unsigned char)c);
                    auto fp = FlightPlanSelect(callsign.c_str());
                    if (!fp.IsValid()) {
                        DisplayMessage("assignArrivalRunway: Flight plan not found: " + callsign);
                    } else {
                        auto fpData = fp.GetFlightPlanData();
                        const char *routeStr = fpData.GetRoute();
                        std::string route = routeStr ? routeStr : "";
                        const char *dest = fpData.GetDestination();
                        std::string arrivalAirport = dest ? dest : "";

                        // Extract the last term and the rest of the route before it
                        std::string lastTerm;
                        std::string routeBeforeLast;
                        auto lastSpacePos = route.rfind(' ');
                        if (lastSpacePos != std::string::npos) {
                            lastTerm = route.substr(lastSpacePos + 1);
                            routeBeforeLast = route.substr(0, lastSpacePos);
                        } else {
                            lastTerm = route;
                        }

                        std::string newRoute;
                        bool amend = false;
                        auto slashPos = lastTerm.find('/');
                        if (runway.empty()) {
                            // Clear arr runway: drop STAR/rwy or ADES/rwy suffix
                            if (slashPos != std::string::npos) {
                                newRoute = routeBeforeLast;
                                amend = true;
                            } else {
                                DebugMessage("assignArrivalRunway: clear skipped (no rwy suffix)");
                            }
                        } else if (arrivalAirport.empty()) {
                            DisplayMessage("assignArrivalRunway: No destination airport");
                        } else {
                            // Always ADES/rwy at end of FPL (replaces STAR/rwy or prior ADES/rwy)
                            std::string body = route;
                            if (slashPos != std::string::npos) {
                                body = routeBeforeLast;
                            }
                            newRoute = body;
                            if (!newRoute.empty()) newRoute += " ";
                            newRoute += arrivalAirport + "/" + runway;
                            amend = true;
                        }
                        if (amend) {
                            std::string ansiRoute = Utf8ToAnsi(newRoute);
                            DebugMessage("assignArrivalRunway: new route: " + ansiRoute);
                            fpData.SetRoute(ansiRoute.c_str());
                            fpData.AmendFlightPlan();
                        }
                    }
                } else if (message["type"] == "assignHeading") {
                    auto callsign = message["callsign"].get<std::string>();
                    auto heading = message["heading"].get<int>();
                    DebugMessage("assignHeading: " + callsign + " -> " + std::to_string(heading));
                    for (auto &c : callsign)
                        c = (char)std::toupper((unsigned char)c);
                    auto fp = FlightPlanSelect(callsign.c_str());
                    if (!fp.IsValid()) {
                        DisplayMessage("assignHeading: Flight plan not found: " + callsign);
                    } else {
                        auto cad = fp.GetControllerAssignedData();
                        // AHD and DCT are mutually exclusive — clear DCT when setting a heading.
                        if (heading > 0) {
                            cad.SetDirectToPointName("");
                        }
                        bool ok = cad.SetAssignedHeading(heading);
                        if (!ok) DisplayMessage("assignHeading: Failed for " + callsign);
                    }
                } else if (message["type"] == "assignDirect") {
                    // DCT / FPR: update FLEG like ES COPX / "clear direct".
                    // Set: flash fix via scratch (VOR/NDB/FIX → DCT, updates next route).
                    // Clear: clear DirectTo and flash empty scratch so FLEG drops the DCT.
                    // Do NOT zero AHD when clearing DCT — backend clears DCT right after
                    // assignHeading, and wiping AHD made the strip/TopSky heading vanish.
                    auto callsign = message["callsign"].get<std::string>();
                    auto point = message["point"].get<std::string>();
                    DebugMessage("assignDirect: " + callsign + " -> " + (point.empty() ? "(clear)" : point));
                    for (auto &c : callsign)
                        c = (char)std::toupper((unsigned char)c);
                    for (auto &c : point)
                        c = (char)std::toupper((unsigned char)c);
                    auto fp = FlightPlanSelect(callsign.c_str());
                    if (!fp.IsValid()) {
                        DisplayMessage("assignDirect: Flight plan not found: " + callsign);
                    } else {
                        auto cad = fp.GetControllerAssignedData();
                        // Setting a DCT point clears AHD. Clearing DCT leaves AHD alone
                        // unless empty SetDirectToPointName fails (common) — then pulse AHD
                        // so ES drops DCT via the same mutual exclusion as assignHeading.
                        if (!point.empty()) {
                            cad.SetAssignedHeading(0);
                        }
                        bool ok = cad.SetDirectToPointName(point.c_str());
                        if (point.empty()) {
                            const char *cur = cad.GetDirectToPointName();
                            bool cleared = !cur || cur[0] == '\0';
                            if (!cleared) {
                                // Empty DirectTo clear rejected while DCT is set — AHD pulse
                                const int prevHdg = cad.GetAssignedHeading();
                                const int pulse = prevHdg > 0 ? prevHdg : 360;
                                if (cad.SetAssignedHeading(pulse)) {
                                    cad.SetDirectToPointName("");
                                    cad.SetAssignedHeading(prevHdg > 0 ? prevHdg : 0);
                                    cur = cad.GetDirectToPointName();
                                    cleared = !cur || cur[0] == '\0';
                                    if (cleared) {
                                        DebugMessage("assignDirect: clear via AHD pulse for " +
                                                     callsign);
                                        ok = true;
                                    }
                                }
                            } else if (!ok) {
                                DebugMessage("assignDirect: clear — already empty in ES");
                                ok = true;
                            }
                            if (!cleared) {
                                DisplayMessage("assignDirect: SetDirectToPointName failed for " +
                                               callsign);
                            }
                        } else if (!ok) {
                            DisplayMessage("assignDirect: SetDirectToPointName failed for " +
                                           callsign);
                        }
                        // Scratch flash: waypoint for set, empty for clear (ES clear-direct)
                        const std::string flash = point;
                        if (!UpdateScratchPad(callsign, flash, true)) {
                            DisplayMessage("assignDirect: scratch flash failed for " + callsign);
                        } else {
                            DebugMessage(point.empty()
                                             ? "assignDirect: clear direct (scratch flash)"
                                             : "assignDirect: FLEG via scratch " + point);
                        }
                        if (point.empty()) {
                            // Push FP + CAD so EFS picks up GetSid / cleared direct
                            auto fp2 = FlightPlanSelect(callsign.c_str());
                            if (fp2.IsValid()) {
                                OnFlightPlanFlightPlanDataUpdate(fp2);
                                OnFlightPlanControllerAssignedDataUpdate(
                                    fp2, EuroScopePlugIn::CTR_DATA_TYPE_DIRECT_TO);
                                const char *sidName = fp2.GetFlightPlanData().GetSidName();
                                DebugMessage(std::string("assignDirect: clear — ES GetSid ") +
                                             (sidName && *sidName ? sidName : "(none)"));
                            }
                        }
                    }
                } else if (message["type"] == "assignCfl") {
                    auto callsign = message["callsign"].get<std::string>();
                    auto altitude = message["altitude"].get<int>();
                    DebugMessage("assignCfl: " + callsign + " -> " + std::to_string(altitude));
                    for (auto &c : callsign)
                        c = (char)std::toupper((unsigned char)c);
                    auto fp = FlightPlanSelect(callsign.c_str());
                    if (!fp.IsValid()) {
                        DisplayMessage("assignCfl: Flight plan not found: " + callsign);
                    } else {
                        bool ok = fp.GetControllerAssignedData().SetClearedAltitude(altitude);
                        if (!ok) DisplayMessage("assignCfl: Failed for " + callsign);
                    }
                } else if (message["type"] == "setEobt") {
                    auto callsign = message["callsign"].get<std::string>();
                    auto eobt = message["eobt"].get<std::string>();
                    DebugMessage("setEobt: " + callsign + " -> " + eobt);
                    for (auto &c : callsign)
                        c = (char)std::toupper((unsigned char)c);
                    if (callsign.empty() || eobt.size() != 4) {
                        DisplayMessage("setEobt: Invalid callsign or eobt");
                    } else {
                        auto fp = FlightPlanSelect(callsign.c_str());
                        if (!fp.IsValid()) {
                            DisplayMessage("setEobt: Flight plan not found: " + callsign);
                        } else {
                            auto fpData = fp.GetFlightPlanData();
                            fpData.SetEstimatedDepartureTime(eobt.c_str());
                            bool amended = fpData.AmendFlightPlan();
                            if (!amended) {
                                DisplayMessage("setEobt: Failed to amend for " + callsign);
                            } else {
                                DebugMessage("setEobt: Amended " + callsign + " EOBT=" + eobt);
                                OnFlightPlanFlightPlanDataUpdate(fp);
                            }
                        }
                    }
                } else if (message["type"] == "setAsrt") {
                    // Ready Startup / ASRT — annotation field 0 (HHMM or empty to clear)
                    auto callsign = message["callsign"].get<std::string>();
                    auto asrt = message.contains("asrt") && message["asrt"].is_string()
                                    ? message["asrt"].get<std::string>()
                                    : "";
                    for (auto &c : callsign)
                        c = (char)std::toupper((unsigned char)c);
                    // Normalize to HHMM or empty
                    std::string digits;
                    for (char c : asrt) {
                        if (c >= '0' && c <= '9') digits.push_back(c);
                    }
                    if (digits.size() == 3) digits = "0" + digits;
                    if (digits.size() > 4) digits = digits.substr(0, 4);
                    if (!digits.empty() && digits.size() != 4) {
                        DisplayMessage("setAsrt: Invalid asrt for " + callsign);
                    } else {
                        std::map<int, std::string> fields;
                        fields[0] = digits;
                        if (!SetCdmStripFields(callsign, fields)) {
                            DisplayMessage("setAsrt: Failed for " + callsign);
                        } else {
                            DebugMessage("setAsrt: " + callsign + " -> " + (digits.empty() ? "(clear)" : digits));
                            lastCdmFileSnapshot.erase(callsign);
                            nlohmann::json f = nlohmann::json::object();
                            f["callsign"] = callsign;
                            f["asrt"] = digits;
                            nlohmann::json echo = nlohmann::json::object();
                            echo["type"] = "cdmLocalUpdate";
                            echo["flights"] = nlohmann::json::array({f});
                            PostJson(echo, "setAsrt");
                        }
                    }
                } else if (message["type"] == "setTsac") {
                    // TSAC — annotation field 1 (HHMM or empty to clear)
                    auto callsign = message["callsign"].get<std::string>();
                    auto tsac = message.contains("tsac") && message["tsac"].is_string()
                                    ? message["tsac"].get<std::string>()
                                    : "";
                    for (auto &c : callsign)
                        c = (char)std::toupper((unsigned char)c);
                    std::string digits = NormalizeCdmHhmm(tsac);
                    if (!tsac.empty() && digits.empty()) {
                        DisplayMessage("setTsac: Invalid tsac for " + callsign);
                    } else {
                        std::map<int, std::string> fields;
                        fields[1] = digits;
                        if (!SetCdmStripFields(callsign, fields)) {
                            DisplayMessage("setTsac: Failed for " + callsign);
                        } else {
                            DebugMessage("setTsac: " + callsign + " -> " + (digits.empty() ? "(clear)" : digits));
                            lastCdmFileSnapshot.erase(callsign);
                            nlohmann::json f = nlohmann::json::object();
                            f["callsign"] = callsign;
                            f["tsac"] = digits;
                            nlohmann::json echo = nlohmann::json::object();
                            echo["type"] = "cdmLocalUpdate";
                            echo["flights"] = nlohmann::json::array({f});
                            PostJson(echo, "setTsac");
                        }
                    }
                } else if (message["type"] == "setCtoc") {
                    // CTOC — annotation field 8 (HHMM or empty to clear)
                    auto callsign = message["callsign"].get<std::string>();
                    auto ctoc = message.contains("ctoc") && message["ctoc"].is_string()
                                    ? message["ctoc"].get<std::string>()
                                    : "";
                    for (auto &c : callsign)
                        c = (char)std::toupper((unsigned char)c);
                    std::string digits = NormalizeCdmHhmm(ctoc);
                    if (!ctoc.empty() && digits.empty()) {
                        DisplayMessage("setCtoc: Invalid ctoc for " + callsign);
                    } else {
                        std::map<int, std::string> fields;
                        fields[8] = digits;
                        if (!SetCdmStripFields(callsign, fields)) {
                            DisplayMessage("setCtoc: Failed for " + callsign);
                        } else {
                            DebugMessage("setCtoc: " + callsign + " -> " + (digits.empty() ? "(clear)" : digits));
                            lastCdmFileSnapshot.erase(callsign);
                            nlohmann::json f = nlohmann::json::object();
                            f["callsign"] = callsign;
                            f["ctoc"] = digits;
                            nlohmann::json echo = nlohmann::json::object();
                            echo["type"] = "cdmLocalUpdate";
                            echo["flights"] = nlohmann::json::array({f});
                            PostJson(echo, "setCtoc");
                        }
                    }
                } else if (message["type"] == "setTobt") {
                    // ES-first: write CDM annotation (TOBT/setBy), echo to EFS immediately.
                    // CDM master / backend then syncs vIFF — avoids ES↔EFS desync.
                    // Fields: 2=TOBT, 9=setBy (A/P)
                    auto callsign = message["callsign"].get<std::string>();
                    auto tobt = message["tobt"].get<std::string>();
                    std::string setBy = "A";
                    if (message.contains("setBy") && message["setBy"].is_string()) {
                        setBy = message["setBy"].get<std::string>();
                    }
                    for (auto &c : callsign)
                        c = (char)std::toupper((unsigned char)c);
                    if (!setBy.empty())
                        setBy[0] = (char)std::toupper((unsigned char)setBy[0]);
                    DebugMessage("setTobt: " + callsign + " -> " + tobt + " setBy=" + setBy);
                    if (callsign.empty() || tobt.size() != 4) {
                        DisplayMessage("setTobt: Invalid callsign or tobt");
                    } else {
                        std::map<int, std::string> fields;
                        fields[2] = tobt;
                        if (setBy == "A" || setBy == "P") fields[9] = setBy;
                        if (!SetCdmStripFields(callsign, fields)) {
                            DisplayMessage("setTobt: Failed for " + callsign);
                        } else {
                            DebugMessage("setTobt: Updated CDM annotation for " + callsign);
                            // Force next CDM_data poll to re-read this callsign
                            lastCdmFileSnapshot.erase(callsign);
                            // Immediate EFS update (don't wait for CDM_data_*.txt rewrite)
                            nlohmann::json f = nlohmann::json::object();
                            f["callsign"] = callsign;
                            f["tobt"] = tobt;
                            f["tobtSetBy"] = (setBy == "A" || setBy == "P") ? setBy : "";
                            try {
                                auto fp = FlightPlanSelect(callsign.c_str());
                                if (fp.IsValid()) {
                                    const char *ann = fp.GetControllerAssignedData().GetFlightStripAnnotation(0);
                                    auto parts = SplitCdmAnnotation(ann);
                                    if (parts.size() > 3) {
                                        std::string tsat = NormalizeCdmHhmm(parts[3]);
                                        if (!tsat.empty()) f["tsat"] = tsat;
                                    }
                                }
                            } catch (...) {
                            }
                            nlohmann::json echo = nlohmann::json::object();
                            echo["type"] = "cdmLocalUpdate";
                            echo["flights"] = nlohmann::json::array({f});
                            PostJson(echo, "setTobt");
                        }
                    }
                } else if (message["type"] == "createFlightPlan") {
                    auto callsign = message["callsign"].get<std::string>();
                    auto stripType = message["stripType"].get<std::string>();
                    auto origin = message["origin"].get<std::string>();
                    auto destination = message["destination"].get<std::string>();
                    auto aircraftType = message["aircraftType"].get<std::string>();
                    auto flightRules = message["flightRules"].get<std::string>();

                    for (auto &c : callsign)
                        c = (char)std::toupper((unsigned char)c);

                    // Try to find existing flight plan, or correlate via radar target
                    auto rt = RadarTargetSelect(callsign.c_str());
                    auto fp = FlightPlanSelect(callsign.c_str());
                    bool hadExistingFP = fp.IsValid();

                    if (!fp.IsValid() && rt.IsValid()) {
                        fp = rt.GetCorrelatedFlightPlan();
                    }

                    if (fp.IsValid()) {
                        // Build EOBT string (current UTC HHmm)
                        char eobt[5] = {};
                        {
                            std::time_t now = std::time(nullptr);
                            std::tm utc{};
                            gmtime_s(&utc, &now);
                            std::snprintf(eobt, sizeof(eobt), "%02d%02d", utc.tm_hour, utc.tm_min);
                        }

                        // Build aircraft info string in the format EuroScope's AP info field accepts: TYPE/WTC.
                        // Always assume Light WTC for manually-created VFR strips.
                        std::string aircraftInfoStr;
                        if (!aircraftType.empty() && aircraftType != "UNKN") {
                            aircraftInfoStr = aircraftType + "/L";
                        }

                        // Helper lambda: apply all fields to a given fpData object
                        auto applyFields = [&](EuroScopePlugIn::CFlightPlanData &fpd) {
                            fpd.SetPlanType(flightRules.c_str());
                            fpd.SetEstimatedDepartureTime(eobt);
                            if (!aircraftInfoStr.empty()) {
                                fpd.SetAircraftInfo(aircraftInfoStr.c_str());
                            }
                            if (stripType == "vfrDep") {
                                fpd.SetOrigin(origin.c_str());
                                const char *dest = fpd.GetDestination();
                                if (!dest || !*dest) {
                                    fpd.SetDestination("ZZZZ");
                                }
                            } else if (stripType == "vfrArr") {
                                fpd.SetDestination(destination.c_str());
                                const char *org = fpd.GetOrigin();
                                if (!org || !*org) {
                                    fpd.SetOrigin("ZZZZ");
                                }
                            } else if (stripType == "cross") {
                                const char *org = fpd.GetOrigin();
                                if (!org || !*org) {
                                    fpd.SetOrigin("ZZZZ");
                                }
                                const char *dest = fpd.GetDestination();
                                if (!dest || !*dest) {
                                    fpd.SetDestination("ZZZZ");
                                }
                            }
                        };

                        // First amendment — may use a correlated (not yet directly selectable) FP
                        auto fpData = fp.GetFlightPlanData();
                        applyFields(fpData);
                        bool amended = fpData.AmendFlightPlan();

                        if (!amended) {
                            DisplayMessage("createFlightPlan: Failed to amend for " + callsign);
                        } else {
                            DebugMessage("createFlightPlan: Amended " + stripType + " for " + callsign);

                            // Correlate with radar target if we have one and FP was new
                            if (rt.IsValid() && !hadExistingFP) {
                                auto existingRt = fp.GetCorrelatedRadarTarget();
                                if (!existingRt.IsValid()) {
                                    fp.CorrelateWithRadarTarget(rt);
                                }
                            }

                            // Second amendment via a direct FlightPlanSelect.
                            // EuroScope sometimes does not fire OnFlightPlanFlightPlanDataUpdate
                            // on the first amendment when the FP was obtained via radar-target
                            // correlation. Re-selecting and amending again reliably triggers the
                            // callback so the backend receives the update.
                            auto fp2 = FlightPlanSelect(callsign.c_str());
                            if (fp2.IsValid()) {
                                auto fpData2 = fp2.GetFlightPlanData();
                                applyFields(fpData2);
                                fpData2.AmendFlightPlan();
                                DebugMessage("createFlightPlan: Second amendment done for " + callsign);
                            }
                        }
                    } else {
                        DebugMessage("createFlightPlan: No flight plan or radar target for " + callsign + ", cannot amend");
                    }
                } else if (message["type"] == "amendFlightPlan") {
                    auto callsign = message["callsign"].get<std::string>();
                    for (auto &c : callsign)
                        c = (char)std::toupper((unsigned char)c);
                    DebugMessage("amendFlightPlan: " + callsign);
                    auto fp = FlightPlanSelect(callsign.c_str());
                    if (!fp.IsValid()) {
                        DisplayMessage("amendFlightPlan: Flight plan not found: " + callsign);
                    } else {
                        auto fpData = fp.GetFlightPlanData();
                        bool dirty = false;

                        auto jsonStr = [&](const char *key) -> std::string {
                            if (!message.contains(key) || message[key].is_null()) return "";
                            if (message[key].is_string()) return message[key].get<std::string>();
                            if (message[key].is_number()) return std::to_string(message[key].get<int>());
                            return "";
                        };
                        auto hasKey = [&](const char *key) -> bool {
                            return message.contains(key) && !message[key].is_null();
                        };
                        auto parseFeet = [&](const nlohmann::json &v) -> int {
                            if (v.is_number_integer() || v.is_number_unsigned()) {
                                int n = v.get<int>();
                                if (n > 0 && n < 1000) return n * 100;
                                return n;
                            }
                            if (!v.is_string()) return -1;
                            std::string s = v.get<std::string>();
                            for (auto &c : s) c = (char)std::toupper((unsigned char)c);
                            std::string digits;
                            char prefix = 0;
                            for (char c : s) {
                                if (c == 'F' || c == 'A' || c == 'L') {
                                    if (!prefix && digits.empty()) {
                                        if (c != 'L') prefix = c;
                                    }
                                    continue;
                                }
                                if (c >= '0' && c <= '9') digits.push_back(c);
                            }
                            if (digits.empty()) return -1;
                            int n = std::atoi(digits.c_str());
                            if (prefix == 'F' || (prefix == 0 && n < 1000 && digits.size() <= 3))
                                return n * 100;
                            if (prefix == 'A') return n * 100;
                            return n;
                        };
                        auto upsertRemarkToken = [](std::string remarks, const std::string &token,
                                                   const std::string &value) -> std::string {
                            // Remove existing TOKEN/… then append TOKEN/value (or just strip if value empty)
                            std::string upper = remarks;
                            for (auto &c : upper) c = (char)std::toupper((unsigned char)c);
                            std::string needle = token + "/";
                            for (auto &c : needle) c = (char)std::toupper((unsigned char)c);
                            size_t pos = 0;
                            while ((pos = upper.find(needle, pos)) != std::string::npos) {
                                size_t start = pos;
                                size_t end = start + needle.size();
                                while (end < remarks.size() && remarks[end] != ' ' && remarks[end] != '\n')
                                    ++end;
                                remarks.erase(start, end - start);
                                upper.erase(start, end - start);
                                while (!remarks.empty() && start < remarks.size() && remarks[start] == ' ')
                                    remarks.erase(start, 1);
                                if (start > 0 && start <= remarks.size() && remarks[start - 1] == ' ' &&
                                    (start == remarks.size() || remarks[start] == ' ')) {
                                    remarks.erase(start - 1, 1);
                                    if (start > 0) --start;
                                }
                                pos = start;
                                upper = remarks;
                                for (auto &c : upper) c = (char)std::toupper((unsigned char)c);
                            }
                            while (!remarks.empty() && remarks.back() == ' ') remarks.pop_back();
                            if (!value.empty()) {
                                if (!remarks.empty()) remarks.push_back(' ');
                                remarks += token + "/" + value;
                            }
                            return remarks;
                        };

                        if (hasKey("flightRules")) {
                            std::string fr = jsonStr("flightRules");
                            if (!fr.empty()) {
                                fr[0] = (char)std::toupper((unsigned char)fr[0]);
                                fpData.SetPlanType(fr.substr(0, 1).c_str());
                                dirty = true;
                            }
                        }

                        // Aircraft info: prefer FAA letter, else ICAO [N/]TYPE/WTC-EQUIP/SUR
                        {
                            std::string type = jsonStr("aircraftType");
                            std::string wtc = jsonStr("wakeTurbulence");
                            std::string faa = jsonStr("faaEquipment");
                            std::string equip = jsonStr("equipment");
                            std::string surv = jsonStr("surveillance");
                            int nrac = 1;
                            if (hasKey("numberOfAircraft")) {
                                if (message["numberOfAircraft"].is_number())
                                    nrac = message["numberOfAircraft"].get<int>();
                                else {
                                    try { nrac = std::stoi(jsonStr("numberOfAircraft")); } catch (...) { nrac = 1; }
                                }
                                if (nrac < 1) nrac = 1;
                                if (nrac > 99) nrac = 99;
                            } else {
                                // Preserve existing leading NUMBER/ from current AircraftInfo
                                const char *curInfo = fpData.GetAircraftInfo();
                                if (curInfo && curInfo[0] >= '1' && curInfo[0] <= '9') {
                                    int n = 0;
                                    for (const char *p = curInfo; *p >= '0' && *p <= '9'; ++p)
                                        n = n * 10 + (*p - '0');
                                    if (n >= 1 && n <= 99) nrac = n;
                                }
                            }
                            bool touchAc =
                                hasKey("aircraftType") || hasKey("wakeTurbulence") ||
                                hasKey("faaEquipment") || hasKey("equipment") || hasKey("surveillance") ||
                                hasKey("numberOfAircraft");
                            if (touchAc) {
                                if (type.empty()) {
                                    const char *cur = fpData.GetAircraftFPType();
                                    if (cur && *cur) type = cur;
                                }
                                if (type.empty()) type = "ZZZZ";
                                for (auto &c : type) c = (char)std::toupper((unsigned char)c);
                                for (auto &c : wtc) c = (char)std::toupper((unsigned char)c);
                                for (auto &c : faa) c = (char)std::toupper((unsigned char)c);
                                for (auto &c : equip) c = (char)std::toupper((unsigned char)c);
                                for (auto &c : surv) c = (char)std::toupper((unsigned char)c);

                                std::string info;
                                if (hasKey("faaEquipment") && faa.size() == 1) {
                                    info = type + "/" + faa;
                                } else if (!equip.empty() || !surv.empty() || hasKey("equipment") ||
                                           hasKey("surveillance") || !wtc.empty()) {
                                    if (wtc.empty()) {
                                        char wc = fpData.GetAircraftWtc();
                                        if (wc && wc != '?') wtc = std::string(1, wc);
                                        else wtc = "M";
                                    }
                                    // When only NRAC changes, keep existing equip/sur from AircraftInfo if possible
                                    if (equip.empty() || surv.empty()) {
                                        const char *curInfo = fpData.GetAircraftInfo();
                                        std::string raw = curInfo ? curInfo : "";
                                        // Strip leading NUMBER/
                                        if (!raw.empty() && raw[0] >= '0' && raw[0] <= '9') {
                                            size_t sl = raw.find('/');
                                            if (sl != std::string::npos) raw = raw.substr(sl + 1);
                                        }
                                        // TYPE/WTC-EQUIP/SUR
                                        size_t dash = raw.find('-');
                                        size_t lastSlash = raw.rfind('/');
                                        if (dash != std::string::npos && lastSlash != std::string::npos &&
                                            lastSlash > dash) {
                                            if (equip.empty())
                                                equip = raw.substr(dash + 1, lastSlash - dash - 1);
                                            if (surv.empty())
                                                surv = raw.substr(lastSlash + 1);
                                        }
                                    }
                                    if (equip.empty()) equip = "S";
                                    if (surv.empty()) surv = "C";
                                    info = type + "/" + wtc.substr(0, 1) + "-" + equip + "/" + surv;
                                } else if (hasKey("aircraftType") || hasKey("wakeTurbulence") ||
                                           hasKey("numberOfAircraft")) {
                                    // Type/WTC only — keep existing capabilities letter if present
                                    char cap = fpData.GetCapibilities();
                                    if (wtc.empty()) {
                                        char wc = fpData.GetAircraftWtc();
                                        if (wc && wc != '?') wtc = std::string(1, wc);
                                    }
                                    if (cap && cap != '?' && wtc.empty()) {
                                        info = type + "/" + std::string(1, (char)std::toupper((unsigned char)cap));
                                    } else if (!wtc.empty()) {
                                        info = type + "/" + wtc.substr(0, 1);
                                    } else {
                                        info = type;
                                    }
                                }
                                if (!info.empty()) {
                                    // ICAO field 9 number of aircraft — only when > 1
                                    if (nrac > 1)
                                        info = std::to_string(nrac) + "/" + info;
                                    fpData.SetAircraftInfo(info.c_str());
                                    dirty = true;
                                }
                            }
                        }

                        if (hasKey("origin")) {
                            std::string v = jsonStr("origin");
                            for (auto &c : v) c = (char)std::toupper((unsigned char)c);
                            fpData.SetOrigin(v.c_str());
                            dirty = true;
                        }
                        if (hasKey("destination")) {
                            std::string v = jsonStr("destination");
                            for (auto &c : v) c = (char)std::toupper((unsigned char)c);
                            fpData.SetDestination(v.c_str());
                            dirty = true;
                        }
                        if (hasKey("alternate")) {
                            std::string v = jsonStr("alternate");
                            for (auto &c : v) c = (char)std::toupper((unsigned char)c);
                            fpData.SetAlternate(v.c_str());
                            dirty = true;
                        }
                        if (hasKey("eobt")) {
                            std::string eobt = jsonStr("eobt");
                            std::string digits;
                            for (char c : eobt)
                                if (c >= '0' && c <= '9') digits.push_back(c);
                            if (digits.size() == 3) digits = "0" + digits;
                            if (digits.size() > 4) digits = digits.substr(0, 4);
                            if (digits.size() == 4 || digits.empty()) {
                                fpData.SetEstimatedDepartureTime(digits.c_str());
                                dirty = true;
                            }
                        }
                        if (hasKey("tas")) {
                            std::string tas = jsonStr("tas");
                            std::string digits;
                            for (char c : tas) {
                                if (c >= '0' && c <= '9') digits.push_back(c);
                            }
                            if (!digits.empty()) {
                                fpData.SetTrueAirspeed(std::atoi(digits.c_str()));
                                dirty = true;
                            }
                        }
                        if (hasKey("rfl")) {
                            int feet = parseFeet(message["rfl"]);
                            if (feet > 0) {
                                fpData.SetFinalAltitude(feet);
                                dirty = true;
                            }
                        }
                        if (hasKey("eet")) {
                            std::string eet = jsonStr("eet");
                            std::string digits;
                            for (char c : eet)
                                if (c >= '0' && c <= '9') digits.push_back(c);
                            if (digits.size() == 3) digits = "0" + digits;
                            if (digits.size() == 4) {
                                fpData.SetEnrouteHours(digits.substr(0, 2).c_str());
                                fpData.SetEnrouteMinutes(digits.substr(2, 2).c_str());
                                dirty = true;
                            }
                        }
                        if (hasKey("route")) {
                            std::string route = Utf8ToAnsi(jsonStr("route"));
                            fpData.SetRoute(route.c_str());
                            dirty = true;
                        }

                        // Remarks + RALT + DOF + SUP fuel
                        {
                            std::string remarks;
                            if (hasKey("fplRemarks")) {
                                remarks = Utf8ToAnsi(jsonStr("fplRemarks"));
                            } else {
                                const char *cur = fpData.GetRemarks();
                                if (cur) remarks = cur;
                            }
                            bool remarksDirty = hasKey("fplRemarks");
                            if (hasKey("alternate2")) {
                                std::string a2 = jsonStr("alternate2");
                                for (auto &c : a2) c = (char)std::toupper((unsigned char)c);
                                remarks = upsertRemarkToken(remarks, "RALT", a2);
                                remarksDirty = true;
                            }
                            if (hasKey("eobd")) {
                                std::string dof = jsonStr("eobd");
                                std::string digits;
                                for (char c : dof)
                                    if (c >= '0' && c <= '9') digits.push_back(c);
                                if (digits.size() > 6) digits = digits.substr(digits.size() - 6);
                                remarks = upsertRemarkToken(remarks, "DOF", digits);
                                remarksDirty = true;
                            }
                            if (hasKey("supl")) {
                                std::string supl = jsonStr("supl");
                                // E/HHmm → fuel hours/minutes
                                size_t ep = supl.find("E/");
                                if (ep == std::string::npos) ep = supl.find("e/");
                                if (ep != std::string::npos) {
                                    std::string digits;
                                    for (size_t i = ep + 2; i < supl.size() && digits.size() < 4; ++i) {
                                        if (supl[i] >= '0' && supl[i] <= '9') digits.push_back(supl[i]);
                                        else if (!digits.empty()) break;
                                    }
                                    if (digits.size() == 3) digits = "0" + digits;
                                    if (digits.size() == 4) {
                                        fpData.SetFuelHours(digits.substr(0, 2).c_str());
                                        fpData.SetFuelMinutes(digits.substr(2, 2).c_str());
                                        dirty = true;
                                    }
                                }
                                // C/name → keep in remarks (no SetPilotName API)
                                size_t cp = supl.find("C/");
                                if (cp == std::string::npos) cp = supl.find("c/");
                                if (cp != std::string::npos) {
                                    size_t start = cp + 2;
                                    size_t end = start;
                                    while (end < supl.size()) {
                                        if (end + 1 < supl.size() && supl[end] == ' ' &&
                                            ((supl[end + 1] >= 'A' && supl[end + 1] <= 'Z') ||
                                             (supl[end + 1] >= 'a' && supl[end + 1] <= 'z')) &&
                                            end + 2 < supl.size() && supl[end + 2] == '/')
                                            break;
                                        ++end;
                                    }
                                    while (end > start && supl[end - 1] == ' ') --end;
                                    std::string pic = Utf8ToAnsi(supl.substr(start, end - start));
                                    remarks = upsertRemarkToken(remarks, "C", pic);
                                    remarksDirty = true;
                                }
                            }
                            if (remarksDirty) {
                                fpData.SetRemarks(remarks.c_str());
                                dirty = true;
                            }
                        }

                        if (dirty) {
                            bool amended = fpData.AmendFlightPlan();
                            if (!amended) {
                                DisplayMessage("amendFlightPlan: Failed to amend for " + callsign);
                            } else {
                                DebugMessage("amendFlightPlan: Amended FP for " + callsign);
                                OnFlightPlanFlightPlanDataUpdate(fp);
                            }
                        }

                        // CAD fields (squawk / CFL) — separate from FP amend
                        auto cad = fp.GetControllerAssignedData();
                        bool cadDirty = false;
                        if (hasKey("squawk")) {
                            std::string sq = jsonStr("squawk");
                            std::string digits;
                            for (char c : sq)
                                if (c >= '0' && c <= '7') digits.push_back(c);
                            if (digits.size() > 4) digits = digits.substr(0, 4);
                            if (digits.size() == 4 || digits.empty()) {
                                cad.SetSquawk(digits.c_str());
                                cadDirty = true;
                            }
                        }
                        if (hasKey("cfl")) {
                            int feet = parseFeet(message["cfl"]);
                            if (feet > 0) {
                                cad.SetClearedAltitude(feet);
                                cadDirty = true;
                            }
                        }
                        if (cadDirty) {
                            // EuroScope fires OnFlightPlanControllerAssignedDataUpdate for SetSquawk / SetClearedAltitude
                            DebugMessage("amendFlightPlan: Updated CAD for " + callsign);
                        }
                    }
                } else {
                    DisplayMessage("Unknown message type: " + message["type"].get<std::string>());
                }
            }
        }
        }
        ExpandOneQueuedRoute();
    } catch (const std::exception &e) {
        DisplayMessage(std::string("ReceiveUdpMessages exception: ") + e.what());
    } catch (...) {
        DisplayMessage("ReceiveUdpMessages: Unknown exception");
    }
}

bool VatEFSPlugin::IsValidUtf8(const char *str)
{
    if (!str) return true; // null: caller typically skips
    const unsigned char *p = reinterpret_cast<const unsigned char *>(str);
    while (*p) {
        unsigned char c = *p++;
        if (c <= 0x7F) continue;
        if (c >= 0xC2 && c <= 0xDF) {
            if ((*p++ & 0xC0) != 0x80) return false;
            continue;
        }
        if (c >= 0xE0 && c <= 0xEF) {
            if ((*p & 0xC0) != 0x80) return false;
            p++;
            if ((*p++ & 0xC0) != 0x80) return false;
            continue;
        }
        if (c >= 0xF0 && c <= 0xF4) {
            if ((*p & 0xC0) != 0x80) return false;
            p++;
            if ((*p & 0xC0) != 0x80) return false;
            p++;
            if ((*p++ & 0xC0) != 0x80) return false;
            continue;
        }
        return false; // invalid lead byte (0x80-0xBF, 0xC0-0xC1, 0xF5-0xFF)
    }
    return true;
}

std::string VatEFSPlugin::SanitizeUtf8(const char *str)
{
    if (!str) return "";
    std::string result;
    result.reserve(static_cast<size_t>(strlen(str)));
    const unsigned char *p = reinterpret_cast<const unsigned char *>(str);
    std::string seq;
    int expectedContinuations = 0;

    while (true) {
        unsigned char c = *p;
        if (expectedContinuations > 0) {
            if (c && (c & 0xC0) == 0x80) {
                seq += static_cast<char>(c);
                p++;
                expectedContinuations--;
                if (expectedContinuations == 0) {
                    result += seq;
                    seq.clear();
                }
                continue;
            }
            for (size_t i = 0; i < seq.size(); i++)
                result += '?';
            seq.clear();
            expectedContinuations = 0;
            if (!c) break;
            continue;
        }
        if (!c) break;
        if (c <= 0x7F) {
            result += static_cast<char>(c);
            p++;
            continue;
        }
        if (c >= 0xC2 && c <= 0xDF) {
            seq = static_cast<char>(c);
            expectedContinuations = 1;
            p++;
            continue;
        }
        if (c >= 0xE0 && c <= 0xEF) {
            seq = static_cast<char>(c);
            expectedContinuations = 2;
            p++;
            continue;
        }
        if (c >= 0xF0 && c <= 0xF4) {
            seq = static_cast<char>(c);
            expectedContinuations = 3;
            p++;
            continue;
        }
        result += '?';
        p++;
    }
    for (size_t i = 0; i < seq.size(); i++)
        result += '?';
    return result;
}

void VatEFSPlugin::AppendOwnershipFields(nlohmann::json &message, EuroScopePlugIn::CFlightPlan FlightPlan,
                                         std::stringstream *out)
{
    auto resolveSi = [this](const char *esId, const char *callsign) -> std::string {
        // Prefer EuroScope tracking/handoff position ID; fall back to ControllerSelect
        if (esId && esId[0] != '\0' && strlen(esId) < 10 && IsValidUtf8(esId)) {
            return esId;
        }
        if (callsign && callsign[0] != '\0' && strlen(callsign) < 20) {
            auto con = ControllerSelect(callsign);
            if (con.IsValid()) {
                const char *posId = con.GetPositionId();
                if (posId && posId[0] != '\0' && strlen(posId) < 10 && IsValidUtf8(posId)) {
                    return posId;
                }
            }
        }
        return "";
    };

    // Always emit ownership keys (including "") so clears propagate — omitting keys leaves stale backend state
    // (e.g. downstream accept clears handoff but nullptr would otherwise keep transferPending: out).
    // ES often omits tracking callsign while still providing position ID — resolve callsign from SI.
    auto resolveCallsignFromSi = [this](const char *posId) -> std::string {
        if (!posId || posId[0] == '\0' || strlen(posId) >= 10 || !IsValidUtf8(posId)) return "";
        auto con = ControllerSelectByPositionId(posId);
        if (!con.IsValid()) return "";
        const char *cs = con.GetCallsign();
        if (!cs || cs[0] == '\0' || strlen(cs) >= 20 || !IsValidUtf8(cs)) return "";
        return cs;
    };

    const char *trackingController = FlightPlan.GetTrackingControllerCallsign();
    const char *trackingIdRaw = FlightPlan.GetTrackingControllerId();
    std::string trackingStr;
    if (trackingController && trackingController[0] != '\0' && strlen(trackingController) < 20 &&
        IsValidUtf8(trackingController)) {
        trackingStr = trackingController;
    }
    std::string si = resolveSi(trackingIdRaw, trackingStr.c_str());
    if (trackingStr.empty() && !si.empty()) {
        trackingStr = resolveCallsignFromSi(si.c_str());
    }
    // trackedByMe + SI but still no callsign: keep SI so backend can mark ownedByOther
    message["controller"] = trackingStr;
    message["controllerId"] = si;
    if (out && !trackingStr.empty()) *out << " controller " << trackingStr;
    if (out && !si.empty()) *out << " controllerId " << si;

    const char *handoffTarget = FlightPlan.GetHandoffTargetControllerCallsign();
    const char *handoffIdRaw = FlightPlan.GetHandoffTargetControllerId();
    std::string handoffStr;
    if (handoffTarget && handoffTarget[0] != '\0' && strlen(handoffTarget) < 20 && IsValidUtf8(handoffTarget)) {
        handoffStr = handoffTarget;
    }
    std::string hoSi = resolveSi(handoffIdRaw, handoffStr.c_str());
    if (handoffStr.empty() && !hoSi.empty()) {
        handoffStr = resolveCallsignFromSi(hoSi.c_str());
    }
    message["handoffTargetController"] = handoffStr;
    message["handoffTargetControllerId"] = hoSi;
    if (out && !handoffStr.empty()) *out << " handoffTargetController " << handoffStr;
    if (out && !hoSi.empty()) *out << " handoffTargetControllerId " << hoSi;

    const char *cs = FlightPlan.GetCallsign();
    if (cs && cs[0] != '\0') {
        int state = FlightPlan.GetState();
        bool trackedByMe = FlightPlan.GetTrackingControllerIsMe();
        // Include SI — tracking callsign is often blank at TWR while APP owns via position ID
        lastOwnershipSnapshot[cs] = trackingStr + "|" + si + "|" + handoffStr + "|" + hoSi + "|" +
                                    std::to_string(state) + "|" + (trackedByMe ? "1" : "0");
    }
}

void VatEFSPlugin::PollOwnershipChanges()
{
    for (EuroScopePlugIn::CFlightPlan fp = FlightPlanSelectFirst(); fp.IsValid(); fp = FlightPlanSelectNext(fp)) {
        if (!FilterFlightPlan(fp)) continue;

        const char *cs = fp.GetCallsign();
        if (!cs || cs[0] == '\0') continue;

        auto it = lastOwnershipSnapshot.find(cs);
        std::string prev = (it != lastOwnershipSnapshot.end()) ? it->second : "";

        // Resolve via AppendOwnershipFields (fills SI when tracking callsign is blank at TWR)
        nlohmann::json message = nlohmann::json::object();
        message["type"] = "ownershipUpdate";
        SetJsonIfValidUtf8(message, "callsign", cs);
        message["fpState"] = fp.GetState();
        message["trackedByMe"] = fp.GetTrackingControllerIsMe();
        AppendOwnershipFields(message, fp);

        std::string next = lastOwnershipSnapshot.count(cs) ? lastOwnershipSnapshot[cs] : "";
        if (prev == next) continue;

        DebugMessage(std::string("Ownership change detected for ") + cs + ": " +
                     (prev.empty() ? "(none)" : prev) + " -> " + next);
        PostJson(message, "PollOwnershipChanges");
    }
}

/** VCH TAG_STRIP_ANNO_HOS — flight strip annotation index 4 */
std::string VatEFSPlugin::GetHoldShort(const std::string &callsign)
{
    try {
        auto fp = FlightPlanSelect(callsign.c_str());
        if (!fp.IsValid()) return "";
        const char *ann = fp.GetControllerAssignedData().GetFlightStripAnnotation(4);
        if (!ann || ann[0] == '\0') return "";
        std::string hp = ann;
        if (hp.size() > 5) hp.resize(5);
        for (auto &c : hp) c = (char)std::toupper((unsigned char)c);
        return hp;
    } catch (...) {
        return "";
    }
}

bool VatEFSPlugin::SetHoldShort(const std::string &callsign, const std::string &holdShort)
{
    try {
        auto fp = FlightPlanSelect(callsign.c_str());
        if (!fp.IsValid()) return false;
        std::string hp = holdShort;
        if (hp.size() > 5) hp.resize(5);
        for (auto &c : hp) c = (char)std::toupper((unsigned char)c);
        return fp.GetControllerAssignedData().SetFlightStripAnnotation(4, hp.c_str());
    } catch (...) {
        return false;
    }
}

/** VCH TAG_STRIP_ANNO_CTL — flight strip annotation index 3 */
bool VatEFSPlugin::GetVchCtl(const std::string &callsign)
{
    try {
        auto fp = FlightPlanSelect(callsign.c_str());
        if (!fp.IsValid()) return false;
        const char *ann = fp.GetControllerAssignedData().GetFlightStripAnnotation(3);
        return ann && strcmp(ann, "CTL") == 0;
    } catch (...) {
        return false;
    }
}

/** True if c is a VCH pending-request type letter (clearance/push/startup/taxi/dep). */
static bool IsVchRequestType(char c)
{
    char t = (char)std::toupper((unsigned char)c);
    return t == 'C' || t == 'P' || t == 'S' || t == 'T' || t == 'D';
}

/**
 * Extract VCH request type from a raw string.
 * Accepts "P", "P1234567" (type+time), and tag-style "R1P" / "P1" (letter anywhere).
 */
static std::string ParseVchRequestType(const char *raw)
{
    if (!raw || raw[0] == '\0') return "";
    // Prefer first char when it is already a type (common ES annotation form)
    if (IsVchRequestType(raw[0])) {
        return std::string(1, (char)std::toupper((unsigned char)raw[0]));
    }
    for (const char *p = raw; *p; ++p) {
        if (IsVchRequestType(*p)) {
            return std::string(1, (char)std::toupper((unsigned char)*p));
        }
    }
    return "";
}

/**
 * VCH pending request (C/P/S/T/D).
 * Sources (first hit wins):
 *  1) Strip annotation 2 — legacy VCH / forks that still write TAG_STRIP_ANNO_REQ
 *  2) FPL remarks `/VCH/REQ/P…/REQ/VCH/` — VCH 0.8 sync-via-remarks form
 *
 * Upstream VCH currently keeps requests in-process only (ann/remarks writes
 * commented out), so REQ PUSH stays empty until a VCH build exports the request.
 */
std::string VatEFSPlugin::GetVchRequest(const std::string &callsign)
{
    try {
        auto fp = FlightPlanSelect(callsign.c_str());
        if (!fp.IsValid()) return "";

        const char *ann = fp.GetControllerAssignedData().GetFlightStripAnnotation(2);
        std::string fromAnn = ParseVchRequestType(ann);
        if (!fromAnn.empty()) return fromAnn;

        const char *rmk = fp.GetFlightPlanData().GetRemarks();
        if (rmk && rmk[0] != '\0') {
            std::string buf = rmk;
            const std::string open = "/VCH/REQ/";
            const std::string close = "/REQ/VCH/";
            size_t a = buf.find(open);
            size_t b = buf.find(close);
            if (a != std::string::npos && b != std::string::npos && b > a) {
                size_t start = a + open.size();
                std::string body = buf.substr(start, b - start);
                std::string fromRmk = ParseVchRequestType(body.c_str());
                if (!fromRmk.empty()) return fromRmk;
            }
        }
        return "";
    } catch (...) {
        return "";
    }
}

bool VatEFSPlugin::SetVchCtl(const std::string &callsign, bool clearedToLand)
{
    try {
        auto fp = FlightPlanSelect(callsign.c_str());
        if (!fp.IsValid()) return false;
        return fp.GetControllerAssignedData().SetFlightStripAnnotation(
            3, clearedToLand ? "CTL" : "");
    } catch (...) {
        return false;
    }
}

/** EFS soft G/A — strip annotation index 5 ("EFSGA"); syncs via ES, not TopSky */
bool VatEFSPlugin::GetEfsGoAround(const std::string &callsign)
{
    try {
        auto fp = FlightPlanSelect(callsign.c_str());
        if (!fp.IsValid()) return false;
        const char *ann = fp.GetControllerAssignedData().GetFlightStripAnnotation(5);
        return ann && strcmp(ann, "EFSGA") == 0;
    } catch (...) {
        return false;
    }
}

bool VatEFSPlugin::SetEfsGoAround(const std::string &callsign, bool goAround)
{
    try {
        auto fp = FlightPlanSelect(callsign.c_str());
        if (!fp.IsValid()) return false;
        return fp.GetControllerAssignedData().SetFlightStripAnnotation(
            5, goAround ? "EFSGA" : "");
    } catch (...) {
        return false;
    }
}

/** Departure Coordination — strip annotation index 6 ("DepC"; legacy "EST"); syncs via ES */
bool VatEFSPlugin::GetEstCoo(const std::string &callsign)
{
    try {
        auto fp = FlightPlanSelect(callsign.c_str());
        if (!fp.IsValid()) return false;
        const char *ann = fp.GetControllerAssignedData().GetFlightStripAnnotation(6);
        // DepC = current; EST = legacy strips still sync as coo=true
        return ann && (strcmp(ann, "DepC") == 0 || strcmp(ann, "EST") == 0);
    } catch (...) {
        return false;
    }
}

bool VatEFSPlugin::SetEstCoo(const std::string &callsign, bool est)
{
    try {
        auto fp = FlightPlanSelect(callsign.c_str());
        if (!fp.IsValid()) return false;
        return fp.GetControllerAssignedData().SetFlightStripAnnotation(
            6, est ? "DepC" : "");
    } catch (...) {
        return false;
    }
}

void VatEFSPlugin::PollVchAnnotationChanges()
{
    for (EuroScopePlugIn::CFlightPlan fp = FlightPlanSelectFirst(); fp.IsValid();
         fp = FlightPlanSelectNext(fp)) {
        if (!FilterFlightPlan(fp)) continue;
        const char *csRaw = fp.GetCallsign();
        if (!csRaw || csRaw[0] == '\0') continue;
        std::string cs = csRaw;
        std::string hs = GetHoldShort(cs);
        bool ctl = GetVchCtl(cs);
        std::string ctlSnap = ctl ? "1" : "0";
        bool efsGa = GetEfsGoAround(cs);
        std::string efsGaSnap = efsGa ? "1" : "0";
        bool est = GetEstCoo(cs);
        std::string estSnap = est ? "1" : "0";
        std::string vchReq = GetVchRequest(cs);

        bool hsChanged = true;
        auto hsIt = lastHoldShortSnapshot.find(cs);
        if (hsIt != lastHoldShortSnapshot.end() && hsIt->second == hs) hsChanged = false;

        bool ctlChanged = true;
        auto ctlIt = lastCtlSnapshot.find(cs);
        if (ctlIt != lastCtlSnapshot.end() && ctlIt->second == ctlSnap) ctlChanged = false;

        bool efsGaChanged = true;
        auto efsGaIt = lastEfsGaSnapshot.find(cs);
        if (efsGaIt != lastEfsGaSnapshot.end() && efsGaIt->second == efsGaSnap) efsGaChanged = false;

        bool estChanged = true;
        auto estIt = lastEstCooSnapshot.find(cs);
        if (estIt != lastEstCooSnapshot.end() && estIt->second == estSnap) estChanged = false;

        bool vchReqChanged = true;
        auto vchReqIt = lastVchRequestSnapshot.find(cs);
        if (vchReqIt != lastVchRequestSnapshot.end() && vchReqIt->second == vchReq) vchReqChanged = false;

        if (!hsChanged && !ctlChanged && !efsGaChanged && !estChanged && !vchReqChanged) continue;

        EnsureFlightPlanPushed(fp);

        nlohmann::json message = nlohmann::json::object();
        message["type"] = "controllerAssignedDataUpdate";
        SetJsonIfValidUtf8(message, "callsign", cs.c_str());
        AppendBasicFlightPlanFields(message, fp);
        if (hsChanged) {
            DebugMessage(std::string("HoldShort change ") + cs + ": " +
                         (hsIt != lastHoldShortSnapshot.end() ? hsIt->second : "(none)") + " -> " +
                         (hs.empty() ? "(clear)" : hs));
            lastHoldShortSnapshot[cs] = hs;
            message["hs"] = hs;
        }
        if (ctlChanged) {
            DebugMessage(std::string("CTL change ") + cs + ": " +
                         (ctlIt != lastCtlSnapshot.end() ? ctlIt->second : "(none)") + " -> " +
                         ctlSnap + " (VCH)");
            lastCtlSnapshot[cs] = ctlSnap;
            message["clearedToLand"] = ctl;
        }
        if (efsGaChanged) {
            DebugMessage(std::string("EFSGA change ") + cs + ": " +
                         (efsGaIt != lastEfsGaSnapshot.end() ? efsGaIt->second : "(none)") +
                         " -> " + efsGaSnap);
            lastEfsGaSnapshot[cs] = efsGaSnap;
            message["efsGoAround"] = efsGa;
        }
        if (estChanged) {
            DebugMessage(std::string("DepC change ") + cs + ": " +
                         (estIt != lastEstCooSnapshot.end() ? estIt->second : "(none)") +
                         " -> " + estSnap + " (ann 6)");
            lastEstCooSnapshot[cs] = estSnap;
            message["coo"] = est;
        }
        if (vchReqChanged) {
            DebugMessage(std::string("VCH REQ change ") + cs + ": " +
                         (vchReqIt != lastVchRequestSnapshot.end() ? vchReqIt->second : "(none)") +
                         " -> " + (vchReq.empty() ? "(clear)" : vchReq));
            lastVchRequestSnapshot[cs] = vchReq;
            message["vchRequest"] = vchReq;
        }
        PostJson(message, "PollVchAnnotationChanges");
    }
}

void VatEFSPlugin::AppendXfl(nlohmann::json &message, EuroScopePlugIn::CFlightPlan FlightPlan,
                             std::stringstream *out)
{
    int xfl = 0;
    try {
        if (FlightPlan.IsValid())
            xfl = FlightPlan.GetExitCoordinationAltitude();
    } catch (...) {
        xfl = 0;
    }
    if (xfl < 0 || xfl > 100000) xfl = 0;
    message["xfl"] = xfl;
    if (out) *out << " xfl " << xfl;
    AppendExitCoordProposal(message, FlightPlan);
}

void VatEFSPlugin::AppendExitCoordProposal(nlohmann::json &message,
                                           EuroScopePlugIn::CFlightPlan FlightPlan)
{
    using EuroScopePlugIn::COORDINATION_STATE_REQUESTED_BY_ME;
    using EuroScopePlugIn::COORDINATION_STATE_REQUESTED_BY_OTHER;
    using EuroScopePlugIn::COORDINATION_STATE_REFUSED;

    // Exit = DEP COPX/XFL; entry = ARR COPN/PEL. Map both onto the same strip fields.
    // Next-controller state is part of InitiateCoordination — ACC often accepts there.
    int exitAltState = 0;
    int exitNameState = 0;
    int entryAltState = 0;
    int entryPointState = 0;
    int nextCtrlState = 0;
    try {
        if (FlightPlan.IsValid())
            exitAltState = FlightPlan.GetExitCoordinationAltitudeState();
    } catch (...) {
        exitAltState = 0;
    }
    try {
        if (FlightPlan.IsValid())
            exitNameState = FlightPlan.GetExitCoordinationNameState();
    } catch (...) {
        exitNameState = 0;
    }
    try {
        if (FlightPlan.IsValid())
            entryAltState = FlightPlan.GetEntryCoordinationAltitudeState();
    } catch (...) {
        entryAltState = 0;
    }
    try {
        if (FlightPlan.IsValid())
            entryPointState = FlightPlan.GetEntryCoordinationPointState();
    } catch (...) {
        entryPointState = 0;
    }
    try {
        if (FlightPlan.IsValid())
            nextCtrlState = FlightPlan.GetCoordinatedNextControllerState();
    } catch (...) {
        nextCtrlState = 0;
    }

    const bool exitPendingOther =
        exitAltState == COORDINATION_STATE_REQUESTED_BY_OTHER ||
        exitNameState == COORDINATION_STATE_REQUESTED_BY_OTHER;
    const bool entryPendingOther =
        entryAltState == COORDINATION_STATE_REQUESTED_BY_OTHER ||
        entryPointState == COORDINATION_STATE_REQUESTED_BY_OTHER;
    const bool pendingOther = exitPendingOther || entryPendingOther;
    const bool pendingMe =
        exitAltState == COORDINATION_STATE_REQUESTED_BY_ME ||
        exitNameState == COORDINATION_STATE_REQUESTED_BY_ME ||
        entryAltState == COORDINATION_STATE_REQUESTED_BY_ME ||
        entryPointState == COORDINATION_STATE_REQUESTED_BY_ME ||
        nextCtrlState == COORDINATION_STATE_REQUESTED_BY_ME;
    const bool refused =
        exitAltState == COORDINATION_STATE_REFUSED ||
        exitNameState == COORDINATION_STATE_REFUSED ||
        entryAltState == COORDINATION_STATE_REFUSED ||
        entryPointState == COORDINATION_STATE_REFUSED ||
        nextCtrlState == COORDINATION_STATE_REFUSED;
    // Always set so backend can clear sticky state when ACC withdraws / accept
    message["exitCoordPending"] = pendingOther;
    message["exitCoordOutbound"] = pendingMe;
    // Live REFUSED state (sticky edge also set in PollXflChanges)
    if (refused)
        message["exitCoordRefused"] = true;
    if (!pendingOther) {
        message["exitCoordPoint"] = "";
        message["exitCoordAltitude"] = 0;
        return;
    }

    // Prefer exit proposal details when both are pending (DEP counter-proposal);
    // otherwise use entry (ARR inbound PEL/COPN).
    const bool useEntry = entryPendingOther && !exitPendingOther;
    std::string point;
    try {
        if (FlightPlan.IsValid()) {
            const char *p = useEntry ? FlightPlan.GetEntryCoordinationPointName()
                                     : FlightPlan.GetExitCoordinationPointName();
            if (p && p[0] != '\0' && strlen(p) < 50)
                point = p;
        }
    } catch (...) {
    }
    message["exitCoordPoint"] = point;

    int xfl = 0;
    try {
        if (FlightPlan.IsValid())
            xfl = useEntry ? FlightPlan.GetEntryCoordinationAltitude()
                           : FlightPlan.GetExitCoordinationAltitude();
    } catch (...) {
        xfl = 0;
    }
    if (xfl < 0 || xfl > 100000) xfl = 0;
    message["exitCoordAltitude"] = xfl;
}

std::string VatEFSPlugin::MakeXflSnapshot(EuroScopePlugIn::CFlightPlan FlightPlan)
{
    int xfl = 0;
    try {
        if (FlightPlan.IsValid())
            xfl = FlightPlan.GetExitCoordinationAltitude();
    } catch (...) {
        xfl = 0;
    }
    if (xfl < 0 || xfl > 100000) xfl = 0;

    std::string copx;
    try {
        if (FlightPlan.IsValid()) {
            const char *p = FlightPlan.GetExitCoordinationPointName();
            if (p && p[0] != '\0' && strlen(p) < 50)
                copx = p;
        }
    } catch (...) {
    }

    std::string direct;
    try {
        if (FlightPlan.IsValid()) {
            auto ctr = FlightPlan.GetControllerAssignedData();
            const char *d = ctr.GetDirectToPointName();
            if (d && strlen(d) < 50)
                direct = d;
        }
    } catch (...) {
    }

    int exitAltState = 0;
    int exitNameState = 0;
    int entryAltState = 0;
    int entryPointState = 0;
    int nextCtrlState = 0;
    int entryAlt = 0;
    std::string entryPt;
    try {
        if (FlightPlan.IsValid())
            exitAltState = FlightPlan.GetExitCoordinationAltitudeState();
    } catch (...) {
    }
    try {
        if (FlightPlan.IsValid())
            exitNameState = FlightPlan.GetExitCoordinationNameState();
    } catch (...) {
    }
    try {
        if (FlightPlan.IsValid())
            entryAltState = FlightPlan.GetEntryCoordinationAltitudeState();
    } catch (...) {
    }
    try {
        if (FlightPlan.IsValid())
            entryPointState = FlightPlan.GetEntryCoordinationPointState();
    } catch (...) {
    }
    try {
        if (FlightPlan.IsValid())
            nextCtrlState = FlightPlan.GetCoordinatedNextControllerState();
    } catch (...) {
    }
    try {
        if (FlightPlan.IsValid()) {
            entryAlt = FlightPlan.GetEntryCoordinationAltitude();
            if (entryAlt < 0 || entryAlt > 100000) entryAlt = 0;
        }
    } catch (...) {
    }
    try {
        if (FlightPlan.IsValid()) {
            const char *p = FlightPlan.GetEntryCoordinationPointName();
            if (p && p[0] != '\0' && strlen(p) < 50)
                entryPt = p;
        }
    } catch (...) {
    }

    return std::to_string(xfl) + "|" + copx + "|" + direct + "|" +
           std::to_string(exitAltState) + "|" + std::to_string(exitNameState) + "|" +
           std::to_string(entryAltState) + "|" + std::to_string(entryPointState) + "|" +
           std::to_string(entryAlt) + "|" + entryPt + "|" + std::to_string(nextCtrlState);
}

bool VatEFSPlugin::ShouldAutoEstOnXflTransition(const std::string &prev, const std::string &snap)
{
    using EuroScopePlugIn::COORDINATION_STATE_ACCEPTED;
    using EuroScopePlugIn::COORDINATION_STATE_MANUAL_ACCEPTED;
    using EuroScopePlugIn::COORDINATION_STATE_REQUESTED_BY_ME;

    if (prev.empty() || snap.empty() || prev == snap)
        return false;

    auto splitPipe = [](const std::string &s) {
        std::vector<std::string> parts;
        std::string cur;
        for (char ch : s) {
            if (ch == '|') {
                parts.push_back(cur);
                cur.clear();
            } else {
                cur.push_back(ch);
            }
        }
        parts.push_back(cur);
        return parts;
    };

    auto prevParts = splitPipe(prev);
    auto snapParts = splitPipe(snap);
    if (prevParts.size() < 5 || snapParts.size() < 5)
        return false;

    const int prevExitAlt = atoi(prevParts[3].c_str());
    const int prevExitName = atoi(prevParts[4].c_str());
    const int prevNextCtrl = prevParts.size() >= 10 ? atoi(prevParts[9].c_str()) : 0;
    const int exitAltState = atoi(snapParts[3].c_str());
    const int exitNameState = atoi(snapParts[4].c_str());
    const int nextCtrlState = snapParts.size() >= 10 ? atoi(snapParts[9].c_str()) : 0;

    // Only our outbound exit (DEP) request — never inbound OTHER (we AcceptCoordination).
    // Next-controller REQUESTED_BY_ME is part of InitiateCoordination.
    const bool wasExitOutbound =
        prevExitAlt == COORDINATION_STATE_REQUESTED_BY_ME ||
        prevExitName == COORDINATION_STATE_REQUESTED_BY_ME ||
        prevNextCtrl == COORDINATION_STATE_REQUESTED_BY_ME;
    if (!wasExitOutbound)
        return false;

    // Explicit accept only. REQUESTED_BY_ME → NONE cannot distinguish refuse vs cancel
    // (ACC refuse may clear to NONE without lingering in REFUSED), so do not auto-EST.
    // Sticky ACCEPTED → ACCEPTED (same-level re-Initiate no-op) never reaches here (prev==snap).
    // Real ACC often accepts via GetCoordinatedNextControllerState only.
    return exitAltState == COORDINATION_STATE_ACCEPTED ||
           exitAltState == COORDINATION_STATE_MANUAL_ACCEPTED ||
           exitNameState == COORDINATION_STATE_ACCEPTED ||
           exitNameState == COORDINATION_STATE_MANUAL_ACCEPTED ||
           nextCtrlState == COORDINATION_STATE_ACCEPTED ||
           nextCtrlState == COORDINATION_STATE_MANUAL_ACCEPTED;
}

void VatEFSPlugin::BeginOutboundCoordCycle(const std::string &cs, int altFt,
                                           const std::string &point,
                                           EuroScopePlugIn::CFlightPlan fp,
                                           bool stickyAcceptedBeforeInitiate)
{
    using EuroScopePlugIn::COORDINATION_STATE_REQUESTED_BY_ME;

    OutboundCoordCycle cycle;
    cycle.active = true;
    cycle.requestedAltFt = altFt;
    cycle.requestedPoint = point;
    cycle.sawRequestedByMe = false;
    cycle.stickyAcceptedBeforeInitiate = stickyAcceptedBeforeInitiate;
    cycle.acceptNotified = false;
    cycle.refuseLatched = false;
    cycle.refuseNotified = false;
    cycle.cancelledNotified = false;
    cycle.startedAt = std::time(nullptr);
    cycle.lastExitAltState = 0;
    cycle.lastExitNameState = 0;
    cycle.lastNextCtrlState = 0;
    try {
        if (fp.IsValid())
            cycle.lastExitAltState = fp.GetExitCoordinationAltitudeState();
    } catch (...) {
    }
    try {
        if (fp.IsValid())
            cycle.lastExitNameState = fp.GetExitCoordinationNameState();
    } catch (...) {
    }
    try {
        if (fp.IsValid())
            cycle.lastNextCtrlState = fp.GetCoordinatedNextControllerState();
    } catch (...) {
    }
    // If ES already shows REQUESTED_BY_ME after Initiate, count it for this cycle.
    // Sticky ACCEPTED from before Initiate is NOT progress (same-level no-op).
    if (cycle.lastExitAltState == COORDINATION_STATE_REQUESTED_BY_ME ||
        cycle.lastExitNameState == COORDINATION_STATE_REQUESTED_BY_ME ||
        cycle.lastNextCtrlState == COORDINATION_STATE_REQUESTED_BY_ME) {
        cycle.sawRequestedByMe = true;
    }
    outboundCoordCycles[cs] = cycle;
    DebugMessage(std::string("outbound coord cycle begin ") + cs + " alt=" +
                 std::to_string(altFt) + " states alt/name/next=" +
                 std::to_string(cycle.lastExitAltState) + "/" +
                 std::to_string(cycle.lastExitNameState) + "/" +
                 std::to_string(cycle.lastNextCtrlState) +
                 (cycle.sawRequestedByMe ? " [already REQUESTED_BY_ME]" : "") +
                 (cycle.stickyAcceptedBeforeInitiate ? " [sticky ACCEPTED before Initiate]"
                                                     : " [fresh / not sticky]"));
    DisplayMessage("XFL cycle begin " + cs + " alt/name/next=" +
                   std::to_string(cycle.lastExitAltState) + "/" +
                   std::to_string(cycle.lastExitNameState) + "/" +
                   std::to_string(cycle.lastNextCtrlState));
}

bool VatEFSPlugin::UpdateOutboundCoordCycle(const std::string &cs,
                                            EuroScopePlugIn::CFlightPlan fp)
{
    using EuroScopePlugIn::COORDINATION_STATE_ACCEPTED;
    using EuroScopePlugIn::COORDINATION_STATE_MANUAL_ACCEPTED;
    using EuroScopePlugIn::COORDINATION_STATE_NONE;
    using EuroScopePlugIn::COORDINATION_STATE_REFUSED;
    using EuroScopePlugIn::COORDINATION_STATE_REQUESTED_BY_ME;
    using EuroScopePlugIn::COORDINATION_STATE_REQUESTED_BY_OTHER;

    auto it = outboundCoordCycles.find(cs);
    if (it == outboundCoordCycles.end())
        return false;
    OutboundCoordCycle &cycle = it->second;
    // Keep latching refuse while active; after resolve still allow one refuse notify.
    if (!cycle.active && !(cycle.refuseLatched && !cycle.refuseNotified))
        return false;

    int exitAltState = 0;
    int exitNameState = 0;
    int nextCtrlState = 0;
    int liveXfl = 0;
    try {
        if (fp.IsValid())
            exitAltState = fp.GetExitCoordinationAltitudeState();
    } catch (...) {
    }
    try {
        if (fp.IsValid())
            exitNameState = fp.GetExitCoordinationNameState();
    } catch (...) {
    }
    try {
        if (fp.IsValid())
            nextCtrlState = fp.GetCoordinatedNextControllerState();
    } catch (...) {
    }
    try {
        if (fp.IsValid())
            liveXfl = fp.GetExitCoordinationAltitude();
    } catch (...) {
        liveXfl = 0;
    }
    if (liveXfl < 0 || liveXfl > 100000)
        liveXfl = 0;

    const bool prevMe = cycle.lastExitAltState == COORDINATION_STATE_REQUESTED_BY_ME ||
                        cycle.lastExitNameState == COORDINATION_STATE_REQUESTED_BY_ME ||
                        cycle.lastNextCtrlState == COORDINATION_STATE_REQUESTED_BY_ME;
    const bool nowMe = exitAltState == COORDINATION_STATE_REQUESTED_BY_ME ||
                       exitNameState == COORDINATION_STATE_REQUESTED_BY_ME ||
                       nextCtrlState == COORDINATION_STATE_REQUESTED_BY_ME;
    // Real ACC (e.g. ESOS_3_CTR) often accepts via next-controller state only while
    // exit alt/name stay REQUESTED_BY_ME or drop to NONE.
    const bool nowAccepted =
        exitAltState == COORDINATION_STATE_ACCEPTED ||
        exitAltState == COORDINATION_STATE_MANUAL_ACCEPTED ||
        exitNameState == COORDINATION_STATE_ACCEPTED ||
        exitNameState == COORDINATION_STATE_MANUAL_ACCEPTED ||
        nextCtrlState == COORDINATION_STATE_ACCEPTED ||
        nextCtrlState == COORDINATION_STATE_MANUAL_ACCEPTED;
    const bool nowRefused = exitAltState == COORDINATION_STATE_REFUSED ||
                            exitNameState == COORDINATION_STATE_REFUSED ||
                            nextCtrlState == COORDINATION_STATE_REFUSED;
    const bool nowPendingOther =
        exitAltState == COORDINATION_STATE_REQUESTED_BY_OTHER ||
        exitNameState == COORDINATION_STATE_REQUESTED_BY_OTHER;

    // Temporary debug: log every state change while cycle open (ACC accept diagnosis).
    if (cycle.active &&
        (exitAltState != cycle.lastExitAltState || exitNameState != cycle.lastExitNameState ||
         nextCtrlState != cycle.lastNextCtrlState)) {
        const std::string line =
            "XFL cycle " + cs + " alt/name/next " + std::to_string(cycle.lastExitAltState) +
            "/" + std::to_string(cycle.lastExitNameState) + "/" +
            std::to_string(cycle.lastNextCtrlState) + " -> " + std::to_string(exitAltState) +
            "/" + std::to_string(exitNameState) + "/" + std::to_string(nextCtrlState) +
            (nowAccepted ? " [ACCEPTED]" : "") + (nowRefused ? " [REFUSED]" : "") +
            (nowMe ? " [ME]" : "") + (nowPendingOther ? " [OTHER]" : "");
        DebugMessage(line);
        DisplayMessage(line);
    }

    // Catch REQUESTED_BY_ME → ACCEPTED between polls (prev tick or this tick).
    if (nowMe || prevMe)
        cycle.sawRequestedByMe = true;

    // Latch REFUSED on any tick during this cycle (XFL value may be unchanged).
    // Same-level refuse often flashes REFUSED(5) briefly then NONE(1) with XFL still
    // matching — without this latch, 2→1+match would falsely ACCEPT. Dense callers:
    // PollXflChanges (OnTimer ~1s), OnRadarTargetPositionUpdate, CAD.
    // Skip latch when ACC already countered (REQUESTED_BY_OTHER) — ESMS 1000→4000
    // must not become amber refuse before pink inbound Accept.
    const bool wasRefused = cycle.lastExitAltState == COORDINATION_STATE_REFUSED ||
                            cycle.lastExitNameState == COORDINATION_STATE_REFUSED ||
                            cycle.lastNextCtrlState == COORDINATION_STATE_REFUSED;
    if ((nowRefused || wasRefused) && !cycle.refuseLatched && !nowPendingOther) {
        cycle.refuseLatched = true;
        DebugMessage(std::string("outbound coord REFUSED latch ") + cs +
                     (nowRefused ? " [live]" : " [prev tick]") +
                     (cycle.sawRequestedByMe ? "" : " [no prior REQUESTED_BY_ME]"));
        if (nowRefused)
            DisplayMessage(std::string("VatEFS: REFUSED latched for ") + cs);
    }

    bool posted = false;

    // ACC counter-proposal while our Initiate is open (ESMS: TWR 1000 → ACC 4000).
    // Close outbound without refuse; AppendXfl / pending OTHER drives pink inbound.
    if (cycle.active && nowPendingOther && !cycle.acceptNotified && !cycle.refuseNotified) {
        cycle.active = false;
        cycle.refuseLatched = false;
        cycle.cancelledNotified = true;
        nlohmann::json message = nlohmann::json::object();
        message["type"] = "controllerAssignedDataUpdate";
        SetJsonIfValidUtf8(message, "callsign", cs.c_str());
        AppendXfl(message, fp);
        message["exitCoordOutbound"] = false;
        message["exitCoordRefused"] = false;
        lastXflSnapshot[cs] = MakeXflSnapshot(fp);
        PostJson(message, "outboundCoordCounter");
        DebugMessage(std::string("outbound coord ACC counter (OTHER) ") + cs +
                     " XFL=" + std::to_string(liveXfl) + " — no refuse");
        DisplayMessage(std::string("VatEFS: ACC counter-proposal ") + cs +
                       " XFL=" + std::to_string(liveXfl));
        posted = true;
    }

    // Close cycle on ACCEPTED always — never leave forced outbound-pending UI when ES
    // already reports accept (exit alt/name OR next controller — ACC often next only).
    // Full EST + accept sound on real accept: REQUESTED_BY_ME this cycle, non-sticky
    // Initiate, or a *per-channel* rising edge to ACCEPTED. Do not use "any channel was
    // ACCEPTED" — sticky exit-alt ACCEPTED would hide next-ctrl NONE→ACCEPTED (real ACC
    // path, often without REQUESTED_BY_ME).
    auto isAcceptedState = [](int s) {
        return s == COORDINATION_STATE_ACCEPTED || s == COORDINATION_STATE_MANUAL_ACCEPTED;
    };
    const bool risingExitAlt =
        isAcceptedState(exitAltState) && !isAcceptedState(cycle.lastExitAltState);
    const bool risingExitName =
        isAcceptedState(exitNameState) && !isAcceptedState(cycle.lastExitNameState);
    const bool risingNextCtrl =
        isAcceptedState(nextCtrlState) && !isAcceptedState(cycle.lastNextCtrlState);
    const bool risingAccepted = risingExitAlt || risingExitName || risingNextCtrl;
    // Next-ctrl ACCEPTED after Initiate is always a real ACC accept → EST (no sawRequestedByMe).
    const bool doAcceptEst = cycle.sawRequestedByMe ||
                             !cycle.stickyAcceptedBeforeInitiate || risingAccepted ||
                             risingNextCtrl;
    if (!posted && cycle.active && nowAccepted && !cycle.acceptNotified &&
        !cycle.refuseLatched) {
        cycle.active = false;
        nlohmann::json message = nlohmann::json::object();
        message["type"] = "controllerAssignedDataUpdate";
        SetJsonIfValidUtf8(message, "callsign", cs.c_str());
        AppendXfl(message, fp);
        // Always clear sticky pink — AppendXfl may still see REQUESTED_BY_ME on alt.
        message["exitCoordOutbound"] = false;
        message["exitCoordRefused"] = false;
        lastXflSnapshot[cs] = MakeXflSnapshot(fp);

        if (doAcceptEst) {
            cycle.acceptNotified = true;
            // Always latch EST snapshot before UDP so PollVch cannot wipe coo:true
            // if SetFlightStripAnnotation fails or lags.
            const bool estOk = SetEstCoo(cs, true);
            lastEstCooSnapshot[cs] = "1";
            message["coo"] = true;
            message["exitCoordAccepted"] = true;
            PostJson(message, "outboundCoordAccept");
            DebugMessage(std::string("outbound coord ACCEPT auto-DepC ") + cs + " exitAlt=" +
                         std::to_string(exitAltState) + " exitName=" +
                         std::to_string(exitNameState) + " next=" +
                         std::to_string(nextCtrlState) +
                         (cycle.sawRequestedByMe ? " [saw REQUESTED_BY_ME]" : "") +
                         (risingNextCtrl ? " [rising next-ctrl]" : "") +
                         (risingAccepted && !risingNextCtrl ? " [rising ACCEPTED]" : "") +
                         (!cycle.stickyAcceptedBeforeInitiate ? " [open cycle]" : "") +
                         (estOk ? " [ann6 ok]" : " [ann6 FAIL]"));
            DisplayMessage(std::string("VatEFS: Departure Coordination set for ") + cs +
                           " (coord accepted)" +
                           (estOk ? "" : " — ann6 write failed"));
        } else {
            // Sticky same-level: ES stayed ACCEPTED without REQUESTED_BY_ME / rising edge.
            // Clear pending UI immediately; do not spam accept sound.
            // If EST missing and live XFL matches what we asked, set EST quietly.
            cycle.cancelledNotified = true; // treat as resolved clear (no accept sound)
            const bool xflMatches =
                cycle.requestedAltFt > 0 && liveXfl == cycle.requestedAltFt;
            if (xflMatches && !GetEstCoo(cs)) {
                SetEstCoo(cs, true);
                lastEstCooSnapshot[cs] = "1";
                message["coo"] = true;
            }
            PostJson(message, "outboundCoordNoop");
            DebugMessage(std::string("outbound coord sticky ACCEPTED clear ") + cs +
                         " (never REQUESTED_BY_ME; XFL " + std::to_string(liveXfl) +
                         (xflMatches ? " matches" : " differs") + ")");
            DisplayMessage("XFL coord: " + cs +
                           " — already accepted (same level); cleared pending");
        }
        posted = true;
    } else if (!posted && cycle.refuseLatched && !cycle.refuseNotified) {
        // Refuse feedback even if EST already set from a prior accepted cycle.
        // Keep EST checkmark; amber XFL via exitCoordRefused.
        // Backend refuse sound: rising exitCoordRefused while flight.exitCoordOutbound
        // still true from Initiate — must set outbound false AFTER refuse in same
        // packet (outbound:true would clear refused in applyExitCoordProposal).
        // If ACC already countered (OTHER), drop the latch — not a hard refuse.
        if (nowPendingOther) {
            cycle.refuseLatched = false;
            cycle.active = false;
            cycle.cancelledNotified = true;
            nlohmann::json message = nlohmann::json::object();
            message["type"] = "controllerAssignedDataUpdate";
            SetJsonIfValidUtf8(message, "callsign", cs.c_str());
            AppendXfl(message, fp);
            message["exitCoordOutbound"] = false;
            message["exitCoordRefused"] = false;
            lastXflSnapshot[cs] = MakeXflSnapshot(fp);
            PostJson(message, "outboundCoordCounterAfterRefuse");
            DebugMessage(std::string("outbound coord REFUSE latch dropped (OTHER) ") + cs);
            posted = true;
        } else {
            cycle.refuseNotified = true;
            cycle.active = false;
            nlohmann::json message = nlohmann::json::object();
            message["type"] = "controllerAssignedDataUpdate";
            SetJsonIfValidUtf8(message, "callsign", cs.c_str());
            AppendXfl(message, fp);
            message["exitCoordRefused"] = true;
            message["exitCoordOutbound"] = false;
            // Do not clear coo / EST
            lastXflSnapshot[cs] = MakeXflSnapshot(fp);
            PostJson(message, "outboundCoordRefuse");
            DebugMessage(std::string("outbound coord REFUSE cycle ") + cs + " next=" +
                         std::to_string(nextCtrlState));
            DisplayMessage(std::string("VatEFS: coord refused ") + cs + " (REFUSED state)");
            posted = true;
        }
    } else if (!posted && cycle.active && cycle.sawRequestedByMe && !nowMe &&
               !nowAccepted && !nowRefused && !nowPendingOther && !cycle.acceptNotified &&
               !cycle.refuseLatched && !cycle.cancelledNotified) {
        // Real ACC (e.g. ESMM_K_CTR) often never shows ACCEPTED(4)/REFUSED(5):
        // REQUESTED_BY_ME(2) → NONE(1) with XFL == requestedAltFt = accept; else refuse.
        // Same-level re-requests use ±1 ft nudge so refuse (revert) ≠ accept (keep nudged).
        // refuseLatched still blocks this branch if REFUSED(5) was seen.
        // Do not use bare anyNone when OTHER is pending (handled above) — a lone NONE
        // on next-ctrl while exit is OTHER used to false-refuse ESMS 1000→4000.
        const bool meToNoneAlt =
            cycle.lastExitAltState == COORDINATION_STATE_REQUESTED_BY_ME &&
            exitAltState == COORDINATION_STATE_NONE;
        const bool meToNoneNext =
            cycle.lastNextCtrlState == COORDINATION_STATE_REQUESTED_BY_ME &&
            nextCtrlState == COORDINATION_STATE_NONE;
        const bool meToNoneName =
            cycle.lastExitNameState == COORDINATION_STATE_REQUESTED_BY_ME &&
            exitNameState == COORDINATION_STATE_NONE;
        // Only resolve when a ME channel actually cleared to NONE (not "any channel NONE").
        if (meToNoneAlt || meToNoneNext || meToNoneName) {
            const bool xflMatches =
                cycle.requestedAltFt > 0 && liveXfl == cycle.requestedAltFt;
            cycle.active = false;
            nlohmann::json message = nlohmann::json::object();
            message["type"] = "controllerAssignedDataUpdate";
            SetJsonIfValidUtf8(message, "callsign", cs.c_str());
            AppendXfl(message, fp);
            // Always clear sticky pink — AppendXfl may still see stale REQUESTED_BY_ME.
            message["exitCoordOutbound"] = false;
            lastXflSnapshot[cs] = MakeXflSnapshot(fp);

            if (xflMatches) {
                // No REFUSED latched this cycle → treat as ACCEPT (real ACC silent accept).
                cycle.acceptNotified = true;
                const bool estOk = SetEstCoo(cs, true);
                lastEstCooSnapshot[cs] = "1";
                message["coo"] = true;
                message["exitCoordAccepted"] = true;
                message["exitCoordRefused"] = false;
                PostJson(message, "outboundCoordAcceptNone");
                DebugMessage(std::string("outbound coord ACCEPT via NONE clear ") + cs +
                             " XFL=" + std::to_string(liveXfl) + " (matched requested " +
                             std::to_string(cycle.requestedAltFt) + "; no REFUSED latched)" +
                             (estOk ? " [ann6 ok]" : " [ann6 FAIL]"));
                DisplayMessage(std::string("VatEFS: Departure Coordination set for ") + cs +
                               " (accept 2→1 XFL match)" +
                               (estOk ? "" : " — ann6 write failed"));
            } else {
                cycle.refuseLatched = true;
                cycle.refuseNotified = true;
                message["exitCoordRefused"] = true;
                PostJson(message, "outboundCoordRefuseNone");
                DebugMessage(std::string("outbound coord REFUSE via NONE clear ") + cs +
                             " XFL " + std::to_string(cycle.requestedAltFt) + "→" +
                             std::to_string(liveXfl));
                DisplayMessage(std::string("VatEFS: coord refused ") + cs + " (2→1 XFL " +
                               std::to_string(cycle.requestedAltFt) + "→" +
                               std::to_string(liveXfl) + ")");
            }
            posted = true;
        }
    }

    cycle.lastExitAltState = exitAltState;
    cycle.lastExitNameState = exitNameState;
    cycle.lastNextCtrlState = nextCtrlState;
    return posted;
}

void VatEFSPlugin::PollXflChanges()
{
    using EuroScopePlugIn::COORDINATION_STATE_ACCEPTED;
    using EuroScopePlugIn::COORDINATION_STATE_MANUAL_ACCEPTED;
    using EuroScopePlugIn::COORDINATION_STATE_REFUSED;
    using EuroScopePlugIn::COORDINATION_STATE_REQUESTED_BY_ME;
    using EuroScopePlugIn::COORDINATION_STATE_REQUESTED_BY_OTHER;

    for (EuroScopePlugIn::CFlightPlan fp = FlightPlanSelectFirst(); fp.IsValid();
         fp = FlightPlanSelectNext(fp)) {
        if (!FilterFlightPlan(fp)) continue;
        const char *csRaw = fp.GetCallsign();
        if (!csRaw || csRaw[0] == '\0') continue;
        std::string cs = csRaw;

        // Always advance active outbound cycles (even if snapshot unchanged) so a
        // one-tick REFUSED / next-ctrl ACCEPTED / NONE cancel can fire.
        auto cycleIt = outboundCoordCycles.find(cs);
        if (cycleIt != outboundCoordCycles.end() &&
            (cycleIt->second.active ||
             (cycleIt->second.refuseLatched && !cycleIt->second.refuseNotified))) {
            UpdateOutboundCoordCycle(cs, fp);
        }

        const std::string snap = MakeXflSnapshot(fp);
        auto it = lastXflSnapshot.find(cs);
        const std::string prev = (it != lastXflSnapshot.end()) ? it->second : "";
        if (prev == snap)
            continue;

        nlohmann::json probe = nlohmann::json::object();
        AppendXfl(probe, fp);
        const int xfl = probe.value("xfl", 0);

        auto splitPipe = [](const std::string &s) {
            std::vector<std::string> parts;
            std::string cur;
            for (char ch : s) {
                if (ch == '|') {
                    parts.push_back(cur);
                    cur.clear();
                } else {
                    cur.push_back(ch);
                }
            }
            parts.push_back(cur);
            return parts;
        };

        // prev: xfl|copx|direct|exitAlt|exitName|entryAlt|entryPt|entryAltFt|entryPt|nextCtrl
        std::string prevDirect;
        int prevExitAlt = 0, prevExitName = 0, prevEntryAlt = 0, prevEntryPt = 0;
        int prevNextCtrl = 0;
        if (!prev.empty()) {
            auto parts = splitPipe(prev);
            if (parts.size() >= 3)
                prevDirect = parts[2];
            if (parts.size() >= 4)
                prevExitAlt = atoi(parts[3].c_str());
            if (parts.size() >= 5)
                prevExitName = atoi(parts[4].c_str());
            if (parts.size() >= 6)
                prevEntryAlt = atoi(parts[5].c_str());
            if (parts.size() >= 7)
                prevEntryPt = atoi(parts[6].c_str());
            if (parts.size() >= 10)
                prevNextCtrl = atoi(parts[9].c_str());
        }

        auto parts = splitPipe(snap);
        std::string direct = parts.size() >= 3 ? parts[2] : "";
        const bool directChanged = (prevDirect != direct);

        int exitAltState = 0, exitNameState = 0, entryAltState = 0, entryPointState = 0;
        int nextCtrlState = 0;
        try {
            exitAltState = fp.GetExitCoordinationAltitudeState();
        } catch (...) {
        }
        try {
            exitNameState = fp.GetExitCoordinationNameState();
        } catch (...) {
        }
        try {
            entryAltState = fp.GetEntryCoordinationAltitudeState();
        } catch (...) {
        }
        try {
            entryPointState = fp.GetEntryCoordinationPointState();
        } catch (...) {
        }
        try {
            nextCtrlState = fp.GetCoordinatedNextControllerState();
        } catch (...) {
        }

        const bool wasEntryPending =
            prevEntryAlt == COORDINATION_STATE_REQUESTED_BY_ME ||
            prevEntryAlt == COORDINATION_STATE_REQUESTED_BY_OTHER ||
            prevEntryPt == COORDINATION_STATE_REQUESTED_BY_ME ||
            prevEntryPt == COORDINATION_STATE_REQUESTED_BY_OTHER;
        const bool nowEntryAccepted =
            entryAltState == COORDINATION_STATE_ACCEPTED ||
            entryAltState == COORDINATION_STATE_MANUAL_ACCEPTED ||
            entryPointState == COORDINATION_STATE_ACCEPTED ||
            entryPointState == COORDINATION_STATE_MANUAL_ACCEPTED;
        // VatEFS Initiate cycles own accept/refuse edges. Legacy path only when no cycle.
        const bool hasCycle = outboundCoordCycles.count(cs) != 0 &&
                              (outboundCoordCycles[cs].active ||
                               outboundCoordCycles[cs].acceptNotified ||
                               outboundCoordCycles[cs].refuseLatched ||
                               outboundCoordCycles[cs].cancelledNotified);
        const bool autoEst =
            !hasCycle && ShouldAutoEstOnXflTransition(prev, snap);
        const bool entryAccepted =
            !prev.empty() && wasEntryPending && nowEntryAccepted && !autoEst;
        // Legacy refuse only without an active/recent Initiate cycle
        const bool wasOutbound =
            prevExitAlt == COORDINATION_STATE_REQUESTED_BY_ME ||
            prevExitName == COORDINATION_STATE_REQUESTED_BY_ME ||
            prevEntryAlt == COORDINATION_STATE_REQUESTED_BY_ME ||
            prevEntryPt == COORDINATION_STATE_REQUESTED_BY_ME ||
            prevNextCtrl == COORDINATION_STATE_REQUESTED_BY_ME;
        const bool nowRefused =
            exitAltState == COORDINATION_STATE_REFUSED ||
            exitNameState == COORDINATION_STATE_REFUSED ||
            entryAltState == COORDINATION_STATE_REFUSED ||
            entryPointState == COORDINATION_STATE_REFUSED ||
            nextCtrlState == COORDINATION_STATE_REFUSED;
        const bool outboundRefused =
            !hasCycle && !prev.empty() && wasOutbound && nowRefused && !autoEst;
        const bool nowOutbound =
            exitAltState == COORDINATION_STATE_REQUESTED_BY_ME ||
            exitNameState == COORDINATION_STATE_REQUESTED_BY_ME ||
            entryAltState == COORDINATION_STATE_REQUESTED_BY_ME ||
            entryPointState == COORDINATION_STATE_REQUESTED_BY_ME ||
            nextCtrlState == COORDINATION_STATE_REQUESTED_BY_ME;
        const bool outboundRetrigger = !prev.empty() && !wasOutbound && nowOutbound;

        DebugMessage(std::string("XFL/COPX/COPN/DCT change ") + cs + ": " +
                     (prev.empty() ? "(none)" : prev) + " -> " + snap +
                     (autoEst ? " [auto DepC]" : "") +
                     (entryAccepted ? " [entry accept]" : "") +
                     (outboundRefused ? " [refused]" : "") +
                     (outboundRetrigger ? " [re-request]" : ""));
        lastXflSnapshot[cs] = snap;

        if (autoEst) {
            const bool estOk = SetEstCoo(cs, true);
            lastEstCooSnapshot[cs] = "1";
            DisplayMessage(std::string("VatEFS: Departure Coordination set for ") + cs +
                           " (coord accepted)" +
                           (estOk ? "" : " — ann6 write failed"));
        }

        nlohmann::json message = nlohmann::json::object();
        message["type"] = "controllerAssignedDataUpdate";
        SetJsonIfValidUtf8(message, "callsign", cs.c_str());
        message["xfl"] = xfl;
        AppendExitCoordProposal(message, fp);
        // Sync with Initiate cycle: force pink only while ES still shows REQUESTED_BY_ME.
        // Never re-stick pink after 2→1 NONE clear (would leave sticky outbound until reload).
        if (cycleIt != outboundCoordCycles.end()) {
            if (cycleIt->second.acceptNotified || cycleIt->second.refuseNotified ||
                cycleIt->second.cancelledNotified || !cycleIt->second.active) {
                message["exitCoordOutbound"] = false;
            } else if (cycleIt->second.active && !cycleIt->second.refuseLatched &&
                       nowOutbound) {
                message["exitCoordOutbound"] = true;
                message["exitCoordRefused"] = false;
            } else {
                message["exitCoordOutbound"] = false;
            }
            // Never re-stick exitCoordRefused after refuseNotified — same as CAD path.
            // UpdateOutboundCoordCycle owns the single refuse edge PostJson.
            // coo only — exitCoordAccepted already posted by UpdateOutboundCoordCycle
            if (cycleIt->second.acceptNotified) {
                message["coo"] = true;
                message["exitCoordRefused"] = false;
            }
        }
        // Only touch strip.direct when ES DirectTo actually changed (else we'd wipe LOP DCT
        // with empty or with ESE COPX on every XFL-only tick).
        if (directChanged) {
            message["direct"] = direct;
            if (!direct.empty())
                message["ahdg"] = 0;
        }
        if (autoEst) {
            message["coo"] = true;
            message["exitCoordAccepted"] = true;
            message["exitCoordRefused"] = false;
            message["exitCoordOutbound"] = false;
        } else if (entryAccepted) {
            message["exitCoordRefused"] = false;
        } else if (outboundRefused) {
            message["exitCoordRefused"] = true;
        } else if (outboundRetrigger) {
            message["exitCoordRefused"] = false;
        }
        PostJson(message, "PollXflChanges");
    }
}

void VatEFSPlugin::SetJsonIfValidUtf8(nlohmann::json &j, const char *key, const char *value)
{
    if (value) {
        if (IsValidUtf8(value)) {
            j[key] = value;
        } else {
            DebugMessage("SetJsonIfValidUtf8: Invalid UTF-8 string in key " + std::string(key));
        }
    }
}

void VatEFSPlugin::SetJsonWithUtf8Replace(nlohmann::json &j, const char *key, const char *value)
{
    if (value) {
        j[key] = SanitizeUtf8(value);
    }
}

void VatEFSPlugin::PostJson(const nlohmann::json &jsonData, const char *whereaboutsInDaCode)
{
    std::stringstream err;
    SOCKET sock = INVALID_SOCKET;

    try {
        // Initialize Winsock
        WSADATA wsaData;
        int result = WSAStartup(MAKEWORD(2, 2), &wsaData);
        if (result != 0) {
            err << "WSAStartup failed: " << result;
            connectionError = err.str();
            return;
        }

        // Create UDP socket
        sock = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
        if (sock == INVALID_SOCKET) {
            err << "Socket creation failed: " << WSAGetLastError();
            connectionError = err.str();
            WSACleanup();
            return;
        }

        // Set up destination address (127.0.0.1:17771)
        sockaddr_in destAddr;
        memset(&destAddr, 0, sizeof(destAddr));
        destAddr.sin_family = AF_INET;
        destAddr.sin_port = htons(17771);
        destAddr.sin_addr.s_addr = inet_addr("127.0.0.1");

        // Convert JSON to single-line string
        std::string jsonString = jsonData.dump() + "\n";

        // Send UDP packet
        int sendResult = sendto(sock, jsonString.c_str(), static_cast<int>(jsonString.length()), 0,
                                (sockaddr *)&destAddr, sizeof(destAddr));
        if (sendResult == SOCKET_ERROR) {
            err << "Send failed: " << WSAGetLastError();
            connectionError = err.str();
            closesocket(sock);
            WSACleanup();
            return;
        }

        closesocket(sock);
        WSACleanup();
        connectionError = "";
        // DisplayMessage(std::string("Sent UDP ") + std::to_string(jsonString.length()));
    } catch (const std::exception &e) {
        connectionError = "Exception in PostJson at " + std::string(whereaboutsInDaCode) + ": " + e.what();
        if (sock != INVALID_SOCKET) {
            closesocket(sock);
            WSACleanup();
        }
    } catch (...) {
        connectionError = "Unknown exception in PostJson at " + std::string(whereaboutsInDaCode);
        if (sock != INVALID_SOCKET) {
            closesocket(sock);
            WSACleanup();
        }
    }
    if (!connectionError.empty()) {
        DisplayMessage(std::string("PostJson: ") + connectionError);
    }
}


void VatEFSPlugin::CleanupBackendHandles()
{
    if (backendOutputRead != nullptr) {
        CloseHandle((HANDLE)backendOutputRead);
        backendOutputRead = nullptr;
    }
    if (backendLogFile != nullptr) {
        CloseHandle((HANDLE)backendLogFile);
        backendLogFile = nullptr;
    }
    backendLineBuf.clear();
}

void VatEFSPlugin::PollBackendOutput()
{
    if (backendOutputRead == nullptr) return;

    char buf[4096];
    for (;;) {
        DWORD avail = 0;
        if (!PeekNamedPipe((HANDLE)backendOutputRead, NULL, 0, NULL, &avail, NULL) || avail == 0)
            break;
        DWORD bytesRead = 0;
        DWORD toRead = (avail < sizeof(buf)) ? avail : sizeof(buf);
        if (!ReadFile((HANDLE)backendOutputRead, buf, toRead, &bytesRead, NULL) || bytesRead == 0)
            break;

        // Write raw data to log file
        if (backendLogFile != nullptr) {
            DWORD written = 0;
            WriteFile((HANDLE)backendLogFile, buf, bytesRead, &written, NULL);
        }

        // If debug, also emit complete lines to EuroScope messages
        if (debug) {
            backendLineBuf.append(buf, bytesRead);
            std::string::size_type pos;
            while ((pos = backendLineBuf.find('\n')) != std::string::npos) {
                std::string line = backendLineBuf.substr(0, pos);
                if (!line.empty() && line.back() == '\r') line.pop_back();
                backendLineBuf.erase(0, pos + 1);
                if (!line.empty())
                    DebugMessage(line, "EFS backend");
            }
        }
    }
}

static bool IsSessionVatEfsLogName(const char *name)
{
    // VatEFS-YYMMDD-HHMM.log
    static const char prefix[] = "VatEFS-";
    const size_t prefixLen = sizeof(prefix) - 1;
    if (strncmp(name, prefix, prefixLen) != 0) return false;
    for (int i = 0; i < 6; ++i) {
        if (name[prefixLen + i] < '0' || name[prefixLen + i] > '9') return false;
    }
    if (name[prefixLen + 6] != '-') return false;
    for (int i = 0; i < 4; ++i) {
        if (name[prefixLen + 7 + i] < '0' || name[prefixLen + 7 + i] > '9') return false;
    }
    return strcmp(name + prefixLen + 11, ".log") == 0;
}

/** Directory EuroScope logs live in. Falls back to the plugin directory. */
static std::string VatEfsLogDirectory()
{
    const char *appdata = getenv("APPDATA");
    if (appdata && appdata[0] != '\0')
        return std::string(appdata) + "\\EuroScope";

    std::string dir = DllPathFile;
    const size_t dllLen = strlen("VatEFS.dll");
    if (dir.size() >= dllLen)
        dir.resize(dir.size() - dllLen);
    while (!dir.empty() && (dir.back() == '\\' || dir.back() == '/'))
        dir.pop_back();
    return dir;
}

/** Drop session logs beyond the five newest (by date+time in the name). */
static void PruneVatEfsLogs(const std::string &dir)
{
    static constexpr size_t kKeep = 5;
    const std::string pattern = dir + "\\VatEFS-??????-????.log";
    WIN32_FIND_DATAA fd;
    HANDLE h = FindFirstFileA(pattern.c_str(), &fd);
    if (h == INVALID_HANDLE_VALUE) return;

    std::vector<std::string> names;
    do {
        if (fd.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) continue;
        if (!IsSessionVatEfsLogName(fd.cFileName)) continue;
        names.emplace_back(fd.cFileName);
    } while (FindNextFileA(h, &fd));
    FindClose(h);

    std::sort(names.begin(), names.end(), [](const std::string &a, const std::string &b) {
        return a > b;
    });
    for (size_t i = kKeep; i < names.size(); ++i)
        DeleteFileA((dir + "\\" + names[i]).c_str());
}

void VatEFSPlugin::StartBackend()
{
    if (backendProcess != nullptr) {
        DWORD exitCode = 0;
        if (GetExitCodeProcess((HANDLE)backendProcess, &exitCode) && exitCode == STILL_ACTIVE) {
            // Stop the running backend before restarting
            PollBackendOutput();
            TerminateProcess((HANDLE)backendProcess, 0);
            // Don't sit on EuroScope's thread for the old 5s join. TerminateProcess
            // is already requested; a short wait is enough for the listen ports to drop.
            WaitForSingleObject((HANDLE)backendProcess, 300);
        }
        CloseHandle((HANDLE)backendProcess);
        backendProcess = nullptr;
        CleanupBackendHandles();
    }

    const char *exePath = "C:\\Program Files\\VATEFS\\efs.exe";
    DWORD attrib = GetFileAttributesA(exePath);
    if (attrib == INVALID_FILE_ATTRIBUTES) {
        DisplayMessage("Backend not found: " + std::string(exePath));
        return;
    }

    // One file per backend session, next to EuroScope's own logs. Older
    // sessions are dropped so only the five newest remain.
    SYSTEMTIME st;
    GetLocalTime(&st);
    char sessionName[32];
    sprintf_s(sessionName, "VatEFS-%02u%02u%02u-%02u%02u.log",
              st.wYear % 100, st.wMonth, st.wDay, st.wHour, st.wMinute);
    const std::string logDir = VatEfsLogDirectory();
    const std::string logPath = logDir + "\\" + sessionName;

    // CREATE_NEW keeps a prior same-minute session; fall back to append if
    // .efs start is hit again within the same minute.
    HANDLE hLog = CreateFileA(logPath.c_str(), GENERIC_WRITE, FILE_SHARE_READ, NULL,
                              CREATE_NEW, FILE_ATTRIBUTE_NORMAL, NULL);
    if (hLog == INVALID_HANDLE_VALUE && GetLastError() == ERROR_FILE_EXISTS) {
        hLog = CreateFileA(logPath.c_str(), FILE_APPEND_DATA, FILE_SHARE_READ, NULL,
                           OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
    }
    if (hLog == INVALID_HANDLE_VALUE) {
        DisplayMessage("Failed to create log file: " + logPath +
                       " (error " + std::to_string(GetLastError()) + ")");
        return;
    }
    backendLogFile = hLog;
    PruneVatEfsLogs(logDir);

    // Session banner before backend stdout — plugin version is known here;
    // backend version is logged as soon as efs.exe starts.
    {
        char ts[16];
        sprintf_s(ts, "[%02u:%02u:%02u] ", st.wHour, st.wMinute, st.wSecond);
        const std::string banner =
            std::string(ts) + "=== VatEFS session start ===\r\n" +
            ts + "EuroScope plugin version: " + PLUGIN_VERSION + "\r\n" +
            ts + "Log file: " + logPath + "\r\n";
        DWORD written = 0;
        WriteFile(hLog, banner.c_str(), (DWORD)banner.size(), &written, NULL);
    }

    // Create pipe to capture stdout/stderr
    SECURITY_ATTRIBUTES sa = {};
    sa.nLength = sizeof(sa);
    sa.bInheritHandle = TRUE;

    HANDLE hRead = NULL, hWrite = NULL;
    if (!CreatePipe(&hRead, &hWrite, &sa, 0)) {
        DisplayMessage("Failed to create pipe (error " + std::to_string(GetLastError()) + ")");
        CleanupBackendHandles();
        return;
    }
    // The read end should not be inherited by the child
    SetHandleInformation(hRead, HANDLE_FLAG_INHERIT, 0);
    backendOutputRead = hRead;

    STARTUPINFOA si = {};
    si.cb = sizeof(si);
    si.dwFlags = STARTF_USESTDHANDLES;
    si.hStdOutput = hWrite;
    si.hStdError = hWrite;
    si.hStdInput = GetStdHandle(STD_INPUT_HANDLE);

    PROCESS_INFORMATION pi = {};
    BOOL ok = CreateProcessA(exePath, NULL, NULL, NULL, TRUE, CREATE_NO_WINDOW, NULL, NULL, &si, &pi);

    // Close the write end of the pipe in the parent — the child has its own copy
    CloseHandle(hWrite);

    if (!ok) {
        DisplayMessage("Failed to start backend (error " + std::to_string(GetLastError()) + ")");
        CleanupBackendHandles();
        return;
    }

    CloseHandle(pi.hThread);
    backendProcess = pi.hProcess;

    // Backend is empty; ES will not re-fire status changes for aircraft already online.
    // Dump FPs + clearance + CDM shortly after bind (and after the 10s settle if needed).
    pendingFullRefresh = true;
    fullRefreshNotBefore = std::time(NULL) + 2;

    std::string startMsg = "Backend started, logging to " + logPath;
    std::string localIp = GetLocalIpAddress();
    if (!localIp.empty())
        startMsg += " | EFS accessible at http://" + localIp + ":17770/";
    DisplayMessage(startMsg);
}

void VatEFSPlugin::StopBackend()
{
    if (backendProcess == nullptr) {
        DisplayMessage("Backend is not running");
        return;
    }

    // Drain any remaining pipe output before stopping
    PollBackendOutput();

    DWORD exitCode = 0;
    if (GetExitCodeProcess((HANDLE)backendProcess, &exitCode) && exitCode != STILL_ACTIVE) {
        CloseHandle((HANDLE)backendProcess);
        backendProcess = nullptr;
        CleanupBackendHandles();
        DisplayMessage("Backend had already exited");
        return;
    }

    TerminateProcess((HANDLE)backendProcess, 0);
    WaitForSingleObject((HANDLE)backendProcess, 5000);
    CloseHandle((HANDLE)backendProcess);
    backendProcess = nullptr;
    CleanupBackendHandles();
    DisplayMessage("Backend stopped");
}


DummyRadarScreen::DummyRadarScreen(VatEFSPlugin *plugin) : CRadarScreen()
{
    this->plugin = plugin;
}

void DummyRadarScreen::OnAsrContentToBeClosed()
{
    plugin->dummyRadarScreens.erase(std::remove(plugin->dummyRadarScreens.begin(),
                                                plugin->dummyRadarScreens.end(), this),
                                    plugin->dummyRadarScreens.end());
    delete this;
}

void DummyRadarScreen::AllocateSSR(const char *inCallsign)
{
    std::string callsign = inCallsign;
    for (auto &c : callsign)
        c = (char)std::toupper((unsigned char)c);
    // Make sure the correct aircraft is selected before calling 'StartTagFunction'
    plugin->SetASELAircraft(GetPlugIn()->FlightPlanSelect(callsign.c_str()));
    StartTagFunction(callsign.c_str(), NULL, EuroScopePlugIn::TAG_ITEM_TYPE_CALLSIGN,
                     callsign.c_str(), TOPSKY_PLUGIN_NAME, TOPSKY_SSR_FUNCTION_ID, POINT(), RECT());
}

void DummyRadarScreen::ToggleClearanceFlag(const char *inCallsign)
{
    std::string callsign = inCallsign;
    for (auto &c : callsign)
        c = (char)std::toupper((unsigned char)c);
    plugin->SetASELAircraft(GetPlugIn()->FlightPlanSelect(callsign.c_str()));
    StartTagFunction(callsign.c_str(), NULL, EuroScopePlugIn::TAG_ITEM_TYPE_CLEARENCE, "1", NULL,
                     EuroScopePlugIn::TAG_ITEM_FUNCTION_SET_CLEARED_FLAG, POINT(), RECT());
}

void DummyRadarScreen::SetClearanceFlag(const char *inCallsign, bool desired)
{
    std::string callsign = inCallsign;
    for (auto &c : callsign)
        c = (char)std::toupper((unsigned char)c);
    auto fp = GetPlugIn()->FlightPlanSelect(callsign.c_str());
    if (!fp.IsValid())
        return;
    // ES has no absolute set — only toggle. Skip when already at desired.
    if ((bool)fp.GetClearenceFlag() == desired)
        return;
    ToggleClearanceFlag(callsign.c_str());
}

void DummyRadarScreen::ForceClearanceFlag(const char *inCallsign, bool desired)
{
    std::string callsign = inCallsign;
    for (auto &c : callsign)
        c = (char)std::toupper((unsigned char)c);
    auto fp = GetPlugIn()->FlightPlanSelect(callsign.c_str());
    if (!fp.IsValid())
        return;
    // ES has no absolute set — only toggle. When already correct, flip-flop so the
    // network rebroadcasts CLR to late-joining controllers (.efs refresh peer reassert).
    if ((bool)fp.GetClearenceFlag() != desired) {
        ToggleClearanceFlag(callsign.c_str());
        return;
    }
    ToggleClearanceFlag(callsign.c_str());
    ToggleClearanceFlag(callsign.c_str());
}

} // namespace VatEFS
