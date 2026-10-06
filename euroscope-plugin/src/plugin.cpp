#include "plugin.h"
#include "Version.h"

#include "json.hpp"
#include <chrono>
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

namespace VatEFS
{

extern "C" IMAGE_DOS_HEADER __ImageBase;
char DllPathFile[_MAX_PATH];

VatEFSPlugin::VatEFSPlugin()
: CPlugIn(EuroScopePlugIn::COMPATIBILITY_CODE, PLUGIN_NAME, PLUGIN_VERSION, PLUGIN_AUTHOR, PLUGIN_LICENSE)
{
    disabled = true; // ... until connected - see OnTimer
    debug = false;
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

        const char *origin = fpData.GetOrigin();
        if (origin && strlen(origin) < 10) SetJsonIfValidUtf8(message, "origin", origin);
        const char *destination = fpData.GetDestination();
        if (destination && strlen(destination) < 10)
            SetJsonIfValidUtf8(message, "destination", destination);
        const char *alternate = fpData.GetAlternate();
        if (alternate && strlen(alternate) < 10)
            SetJsonIfValidUtf8(message, "alternate", alternate);
        SetJsonIfValidUtf8(message, "flightRules", fpData.GetPlanType());
        SetJsonIfValidUtf8(message, "communicationType",
                           (std::string("") + fpData.GetCommunicationType()).c_str());
        // TODO check this is set correctly, compare controllerAssignedDataUpdate, ensure it doesn't overwrite the custom groundstates
        SetJsonIfValidUtf8(message, "groundstate", FlightPlan.GetGroundState());
        message["clearance"] = (bool)FlightPlan.GetClearenceFlag();

        const char *route = fpData.GetRoute();
        if (route && *route && strlen(route) < 1000)
            message["route"] = AnsiToUtf8(route);

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
        if (depRwy && *depRwy && strlen(depRwy) < 5) SetJsonIfValidUtf8(message, "depRwy", depRwy);
        if (sidName && *sidName && strlen(sidName) < 50)
            message["sid"] = AnsiToUtf8(sidName);

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

        int ete = FlightPlan.GetPositionPredictions().GetPointsNumber();
        if (ete >= 0 && ete <= 3600) { // Reasonable ETE range
            out << " ete " << ete;
            message["ete"] = ete;
        }

        DebugMessage(out.str());
        PostJson(message, "OnFlightPlanFlightPlanDataUpdate");
    } catch (const std::exception &e) {
        DisplayMessage(std::string("OnFlightPlanFlightPlanDataUpdate exception: ") + e.what());
    } catch (...) {
        DisplayMessage("OnFlightPlanFlightPlanDataUpdate: Unknown exception");
    }
}

void VatEFSPlugin::OnFlightPlanControllerAssignedDataUpdate(EuroScopePlugIn::CFlightPlan FlightPlan, int DataType)
{
    try {
        if (disabled || !FilterFlightPlan(FlightPlan)) return;


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

        switch (DataType) {
        case EuroScopePlugIn::CTR_DATA_TYPE_SQUAWK: {
            const char *squawk = ctrData.GetSquawk();
            if (squawk && strlen(squawk) == 4) { // Valid squawk is always 4 digits
                out << " squawk " << squawk;
                SetJsonIfValidUtf8(message, "squawk", squawk);
            }
            break;
        }
        case EuroScopePlugIn::CTR_DATA_TYPE_FINAL_ALTITUDE: {
            int rfl = ctrData.GetFinalAltitude();
            if (rfl >= 0 && rfl <= 100000) { // Reasonable altitude range
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
        case EuroScopePlugIn::CTR_DATA_TYPE_COMMUNICATION_TYPE:
            out << " comm " << ctrData.GetCommunicationType();
            break;
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

            // Safe string comparisons
            if (scratch == "LINEUP" || scratch == "ONFREQ" || scratch == "DE-ICE") {
                SetJsonIfValidUtf8(message, "groundstate", scratch.c_str());
            } else if (scratch == "/EFS/CTL") {
                message["clearedToLand"] = true;
            } else if (scratch == "/EFS/CTL-") {
                message["clearedToLand"] = false;
            } else if (scratch.length() > 6 && scratch.find("GRP/S/") != std::string::npos) {
                // Ensure we have enough characters for substr(6)
                SetJsonIfValidUtf8(message, "stand", scratch.substr(6).c_str());
            } else {
                SetJsonIfValidUtf8(message, "scratch", scratch.c_str());
            }
            // Scratch pad inputs noticed in the wild (if we ever want to
            // reverse-engineer/understand some TopSky plugin features): /PRESHDG/ /ASP=/ /ASP+/
            // /ASP-/ /ES /C_FLAG_ACK/ /C_FLAG_RESET/ MISAP_ /ROF/SAS525/ESMM_5_CTR
            // /LAM/ROF/ESMM_5_CTR
            // /ROF/RYR6Q/EKCH_F_APP
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
            SetJsonIfValidUtf8(message, "groundstate", FlightPlan.GetGroundState());
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
                message["direct"] = "";
            }
            break;
        }
        case EuroScopePlugIn::CTR_DATA_TYPE_DIRECT_TO: {
            const char *directTo = ctrData.GetDirectToPointName();
            if (directTo && strlen(directTo) < 50) { // Reasonable waypoint name length
                out << " direct " << directTo;
                SetJsonIfValidUtf8(message, "direct", directTo);
                if (strlen(directTo) > 0) message["ahdg"] = 0;
            }
            break;
        }
        default:
            out << " unknown data type " << DataType;
            break;
        }
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
        if (squawk && strlen(squawk) == 4) { // Valid squawk is always 4 digits
            SetJsonIfValidUtf8(message, "squawk", squawk);
        }
        // message["modec"] = position.GetTransponderC();
        // message["ident"] = position.GetTransponderI();
    }
    auto fp = RadarTarget.GetCorrelatedFlightPlan();
    if (fp.IsValid()) {
        AppendOwnershipFields(message, fp);
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
            return true;
        }
        if (outgoingHandoff) {
            // Re-assume cancels a pending outbound handoff we initiated
            bool ok = fp.StartTracking();
            if (ok)
                DisplayMessage("Cancelled handoff for " + callsign);
            else
                DisplayMessage("Failed to cancel handoff for " + callsign);
            return true;
        }
        if (untracked) {
            bool ok = fp.StartTracking();
            if (ok)
                DisplayMessage("Started tracking " + callsign);
            else
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
            if (ok)
                DisplayMessage("Handoff initiated to " + std::string(nextCtr) + " for " + callsign);
            else
                DisplayMessage("Failed to initiate handoff for " + callsign);
        } else {
            bool ok = fp.EndTracking();
            if (ok)
                DisplayMessage("Ended tracking " + callsign);
            else
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
        DisplayMessage("Refreshed all flight plans and radar targets");
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
    }
    return false;
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

        // Receive UDP messages (non-blocking)
        ReceiveUdpMessages();

        if (std::time(NULL) - enabledTime < 10) return;
        if (counter % 5 == 0) UpdateMyself();
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
        char dir[_MAX_PATH];
        if (!ResolveCdmDataDirectory(dir, sizeof(dir))) return;

        static std::string lastCdmDirLogged;
        if (lastCdmDirLogged != dir) {
            lastCdmDirLogged = dir;
            DebugMessage(std::string("CDM_data dir: ") + dir);
        }

        std::string pattern = std::string(dir) + "\\CDM_data_*.txt";
        WIN32_FIND_DATAA fd{};
        HANDLE hFind = FindFirstFileA(pattern.c_str(), &fd);
        if (hFind == INVALID_HANDLE_VALUE) return;

        std::map<std::string, std::string> snapshot;
        nlohmann::json flights = nlohmann::json::array();
        bool readOk = true;

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
                // TOBT-SET-BY / ASRT / TSAT from CDM strip annotation (ES display source)
                std::string setBy = GetCdmTobtSetBy(callsign);
                std::string asrt = GetCdmAsrt(callsign);
                // Annotation TSAT leads CDM_data_*.txt (file often has TOBT before TSAT is written)
                std::string annTsat = GetCdmTsat(callsign);
                if (!annTsat.empty()) tsat = annTsat;

                // Require at least TOBT or TSAT to accept the row (reject torn numeric junk)
                if (tobt.empty() && tsat.empty()) continue;

                std::string key = tobt + "|" + tsat + "|" + ttot + "|" + ctot + "|" + reason + "|" + setBy + "|" + asrt;
                snapshot[callsign] = key;
                auto prev = lastCdmFileSnapshot.find(callsign);
                if (prev != lastCdmFileSnapshot.end() && prev->second == key) continue;

                DebugMessage("cdmLocal " + callsign + " TOBT=" + tobt + " TSAT=" + (tsat.empty() ? "-" : tsat) +
                             " setBy=" + (setBy.empty() ? "-" : setBy) +
                             " ASRT=" + (asrt.empty() ? "-" : asrt));

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
                flights.push_back(f);
            }
        } while (FindNextFileA(hFind, &fd));
        FindClose(hFind);

        if (!readOk) {
            // Do not swap snapshot or apply partial/torn data
            return;
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

void VatEFSPlugin::Refresh()
{
    for (EuroScopePlugIn::CFlightPlan FlightPlan = FlightPlanSelectFirst(); FlightPlan.IsValid();
         FlightPlan = FlightPlanSelectNext(FlightPlan)) {
        OnFlightPlanFlightPlanDataUpdate(FlightPlan);

        auto ctrData = FlightPlan.GetControllerAssignedData();
        nlohmann::json message = nlohmann::json::object();
        message["type"] = "controllerAssignedDataUpdate";
        SetJsonIfValidUtf8(message, "callsign", FlightPlan.GetCallsign());
        const char *squawk = ctrData.GetSquawk();
        if (squawk && strlen(squawk) == 4) { // Valid squawk is always 4 digits
            SetJsonIfValidUtf8(message, "squawk", squawk);
        }
        int rfl = ctrData.GetFinalAltitude();
        if (rfl >= 0 && rfl <= 100000) { // Reasonable altitude range
            message["rfl"] = rfl;
        }
        int cfl = ctrData.GetClearedAltitude();
        message["cfl"] = cfl;
        if (cfl == 1 || cfl == 2) {
            message["ahdg"] = 0;
            message["direct"] = "";
        }
        SetJsonIfValidUtf8(message, "scratch", ctrData.GetScratchPadString());
        SetJsonIfValidUtf8(message, "groundstate", FlightPlan.GetGroundState());
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
            message["direct"] = "";
        }
        const char *directTo = ctrData.GetDirectToPointName();
        if (directTo && strlen(directTo) < 50) { // Reasonable waypoint name length
            SetJsonIfValidUtf8(message, "direct", directTo);
            if (strlen(directTo) > 0) message["ahdg"] = 0;
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

        // Bind socket
        if (bind(sock, (sockaddr *)&localAddr, sizeof(localAddr)) == SOCKET_ERROR) {
            DisplayMessage("UDP bind failed: " + std::to_string(WSAGetLastError()));
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

void VatEFSPlugin::ReceiveUdpMessages()
{
    if (udpReceiveSocket == nullptr) return;

    try {
        SOCKET sock = reinterpret_cast<SOCKET>(udpReceiveSocket);
        char buffer[4096];
        sockaddr_in fromAddr;
        int fromAddrLen = sizeof(fromAddr);

        // Try to receive (non-blocking, so it returns immediately if no data)
        int recvResult = recvfrom(sock, buffer, sizeof(buffer) - 1, 0, (sockaddr *)&fromAddr, &fromAddrLen);

        if (recvResult == SOCKET_ERROR) {
            int error = WSAGetLastError();
            if (error == WSAEWOULDBLOCK || error == WSAECONNRESET) {
                // No data available or connection reset, this is normal
                return;
            } else {
                // Real error occurred
                DisplayMessage("UDP receive error: " + std::to_string(error));
                return;
            }
        }

        if (recvResult > 0) {
            buffer[recvResult] = '\0';

            if (buffer[0] == '{') {
                nlohmann::json message = nlohmann::json::parse(buffer);
                if (message["type"] == "setGroundState") {
                    auto callsign = message["callsign"].get<std::string>();
                    auto state = message["state"].get<std::string>();
                    DebugMessage("setGroundState: " + callsign + " " + state);
                    if (!callsign.empty() && !state.empty()) {
                        UpdateScratchPad(callsign, state, true);
                    } else {
                        DisplayMessage("setGroundState: Invalid callsign or state");
                    }
                } else if (message["type"] == "setClearedToLand") {
                    auto callsign = message["callsign"].get<std::string>();
                    if (!callsign.empty()) {
                        UpdateScratchPad(callsign, "/EFS/CTL", true);
                    } else {
                        DisplayMessage("setClearedToLand: Invalid callsign");
                    }
                } else if (message["type"] == "unsetClearedToLand") {
                    auto callsign = message["callsign"].get<std::string>();
                    if (!callsign.empty()) {
                        UpdateScratchPad(callsign, "/EFS/CTL-", true);
                    } else {
                        DisplayMessage("unsetClearedToLand: Invalid callsign");
                    }
                } else if (message["type"] == "goaround") {
                    auto callsign = message["callsign"].get<std::string>();
                    if (!callsign.empty()) {
                        UpdateScratchPad(callsign, "MISAP_", false);
                    } else {
                        DisplayMessage("goaround: Invalid callsign");
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
                            bool handoffToMe =
                            handoffTarget && handoffTarget[0] != '\0' && ControllerMyself().IsValid() &&
                            strcmp(handoffTarget, ControllerMyself().GetCallsign()) == 0;
                            bool untracked = !trackingCallsign || trackingCallsign[0] == '\0';
                            bool trackedByMe = fp.GetTrackingControllerIsMe();
                            bool outgoingHandoff = trackedByMe && handoffTarget && handoffTarget[0] != '\0' && !handoffToMe;
                            if (handoffToMe) {
                                fp.AcceptHandoff();
                                DebugMessage("Accepted handoff for " + callsign);
                                OnFlightPlanFlightPlanDataUpdate(fp);
                            } else if (outgoingHandoff) {
                                // Re-assume cancels a pending outbound handoff we initiated
                                bool ok = fp.StartTracking();
                                if (ok) {
                                    DebugMessage("Cancelled handoff for " + callsign);
                                    OnFlightPlanFlightPlanDataUpdate(fp);
                                } else
                                    DisplayMessage("Failed to cancel handoff for " + callsign);
                            } else if (untracked) {
                                bool ok = fp.StartTracking();
                                if (ok) {
                                    DebugMessage("Started tracking " + callsign);
                                    OnFlightPlanFlightPlanDataUpdate(fp);
                                } else
                                    DisplayMessage("Failed to start tracking " + callsign);
                            } else {
                                DebugMessage(callsign + " already tracked by " + std::string(trackingCallsign));
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
                                if (ok)
                                    DebugMessage("Handoff initiated to " + targetStr + " for " + callsign);
                                else
                                    DisplayMessage("Failed to initiate handoff to " + targetStr + " for " + callsign);
                            } else {
                                bool ok = fp.EndTracking();
                                if (ok)
                                    DebugMessage("Ended tracking " + callsign);
                                else
                                    DisplayMessage("Failed to end tracking " + callsign);
                            }
                        } else {
                            DisplayMessage("transfer: Flight plan not found: " + callsign);
                        }
                    } else {
                        DisplayMessage("transfer: Empty callsign");
                    }
                } else if (message["type"] == "release") {
                    auto callsign = message["callsign"].get<std::string>();
                    for (auto &c : callsign)
                        c = (char)std::toupper((unsigned char)c);
                    if (!callsign.empty()) {
                        auto fp = FlightPlanSelect(callsign.c_str());
                        if (fp.IsValid()) {
                            bool ok = fp.EndTracking();
                            if (ok)
                                DebugMessage("Released (end tracking) " + callsign);
                            else
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
                    if (dummyRadarScreens.size() > 0) {
                        dummyRadarScreens[0]->ToggleClearanceFlag(callsign.c_str());
                    } else {
                        DisplayMessage("To toggle clearance flag, the EFS plugin must be allowed "
                                       "to draw on radar screen.");
                        DisplayMessage("Please allow it in OTHER SET / Plug-ins ... menu.");
                    }
                } else if (message["type"] == "assignDepartureRunway") {
                    auto callsign = message["callsign"].get<std::string>();
                    auto runway = message["runway"].get<std::string>();
                    DebugMessage("assignDepartureRunway: " + callsign + " -> " + runway);
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
                        auto slashPos = firstTerm.find('/');
                        if (slashPos != std::string::npos) {
                            // Already has SID/rwy or airport/rwy prefix - keep prefix, change runway
                            newRoute = firstTerm.substr(0, slashPos) + "/" + runway;
                            if (!restOfRoute.empty()) newRoute += " " + restOfRoute;
                        } else if (IsSidPattern(firstTerm)) {
                            // Pilot-filed SID - remove it, prepend airport/runway
                            newRoute = departureAirport + "/" + runway;
                            if (!restOfRoute.empty()) newRoute += " " + restOfRoute;
                        } else {
                            // No prefix - prepend airport/runway before the full original route
                            newRoute = departureAirport + "/" + runway;
                            if (!route.empty()) newRoute += " " + route;
                        }
                        std::string ansiRoute = Utf8ToAnsi(newRoute);
                        DebugMessage("assignDepartureRunway: new route: " + ansiRoute);
                        fpData.SetRoute(ansiRoute.c_str());
                        fpData.AmendFlightPlan();
                    }
                } else if (message["type"] == "assignSid") {
                    auto callsign = message["callsign"].get<std::string>();
                    auto sid = message["sid"].get<std::string>();
                    DebugMessage("assignSid: " + callsign + " -> " + sid);
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
                        auto slashPos = firstTerm.find('/');
                        if (slashPos != std::string::npos) {
                            // Already has SID/rwy or airport/rwy prefix - keep runway, change SID
                            std::string existingRwy = firstTerm.substr(slashPos + 1);
                            newRoute = sid + "/" + existingRwy;
                            if (!restOfRoute.empty()) newRoute += " " + restOfRoute;
                        } else if (IsSidPattern(firstTerm)) {
                            // Pilot-filed SID - replace with new SID/runway
                            newRoute = sid + "/" + currentRwy;
                            if (!restOfRoute.empty()) newRoute += " " + restOfRoute;
                        } else {
                            // No prefix - prepend SID/runway before the full original route
                            newRoute = sid + "/" + currentRwy;
                            if (!route.empty()) newRoute += " " + route;
                        }
                        std::string ansiRoute = Utf8ToAnsi(newRoute);
                        DebugMessage("assignSid: new route: " + ansiRoute);
                        fpData.SetRoute(ansiRoute.c_str());
                        fpData.AmendFlightPlan();
                    }
                } else if (message["type"] == "assignArrivalRunway") {
                    auto callsign = message["callsign"].get<std::string>();
                    auto runway = message["runway"].get<std::string>();
                    DebugMessage("assignArrivalRunway: " + callsign + " -> " + runway);
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
                        const char *starName = fpData.GetStarName();
                        std::string star = starName ? starName : "";

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

                        std::string suffix;
                        if (!star.empty()) {
                            suffix = star + "/" + runway;
                        } else {
                            suffix = arrivalAirport + "/" + runway;
                        }

                        std::string newRoute;
                        auto slashPos = lastTerm.find('/');
                        if (slashPos != std::string::npos) {
                            // Last term already has STAR/rwy or airport/rwy - replace it
                            newRoute = routeBeforeLast;
                            if (!newRoute.empty()) newRoute += " ";
                            newRoute += suffix;
                        } else {
                            // No suffix - append after the full original route
                            newRoute = route;
                            if (!newRoute.empty()) newRoute += " ";
                            newRoute += suffix;
                        }
                        std::string ansiRoute = Utf8ToAnsi(newRoute);
                        DebugMessage("assignArrivalRunway: new route: " + ansiRoute);
                        fpData.SetRoute(ansiRoute.c_str());
                        fpData.AmendFlightPlan();
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
                        bool ok = fp.GetControllerAssignedData().SetAssignedHeading(heading);
                        if (!ok) DisplayMessage("assignHeading: Failed for " + callsign);
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
                } else {
                    DisplayMessage("Unknown message type: " + message["type"].get<std::string>());
                }
            }
        }
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

    const char *trackingController = FlightPlan.GetTrackingControllerCallsign();
    if (trackingController && strlen(trackingController) < 20) {
        if (out && trackingController[0] != '\0') *out << " controller " << trackingController;
        SetJsonIfValidUtf8(message, "controller", trackingController);
        std::string si = resolveSi(FlightPlan.GetTrackingControllerId(), trackingController);
        SetJsonIfValidUtf8(message, "controllerId", si.c_str());
        if (out && !si.empty()) *out << " controllerId " << si;
    }

    const char *handoffTarget = FlightPlan.GetHandoffTargetControllerCallsign();
    if (handoffTarget && strlen(handoffTarget) < 20) {
        if (out && handoffTarget[0] != '\0') *out << " handoffTargetController " << handoffTarget;
        SetJsonIfValidUtf8(message, "handoffTargetController", handoffTarget);
        std::string hoSi = resolveSi(FlightPlan.GetHandoffTargetControllerId(), handoffTarget);
        SetJsonIfValidUtf8(message, "handoffTargetControllerId", hoSi.c_str());
        if (out && !hoSi.empty()) *out << " handoffTargetControllerId " << hoSi;
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

// Returns the best LAN IPv4 address of this machine using gethostbyname.
// Prefers 192.168.x.x (3) > 10.x.x.x (2) > 172.x.x.x (1) > other (0).
// Skips loopback (127.x.x.x) and link-local (169.254.x.x).
static std::string GetLocalIpAddress()
{
    char hostname[256] = {};
    if (gethostname(hostname, sizeof(hostname)) != 0)
        return "";

    hostent *he = gethostbyname(hostname);
    if (!he || he->h_addrtype != AF_INET)
        return "";

    std::string best;
    int bestScore = -1;

    for (int i = 0; he->h_addr_list[i]; ++i) {
        auto *b = reinterpret_cast<unsigned char *>(he->h_addr_list[i]);
        if (b[0] == 127)                     continue; // loopback
        if (b[0] == 169 && b[1] == 254)      continue; // link-local

        // Prefer 192.168.x.x (3) > 10.x.x.x (2) > 172.x.x.x (1) > other (0)
        int score = b[0] == 192 ? 3 : b[0] == 10 ? 2 : b[0] == 172 ? 1 : 0;
        if (score > bestScore) {
            bestScore = score;
            best = std::to_string(b[0]) + "." + std::to_string(b[1]) + "." +
                   std::to_string(b[2]) + "." + std::to_string(b[3]);
        }
    }
    return best;
}

void VatEFSPlugin::StartBackend()
{
    if (backendProcess != nullptr) {
        DWORD exitCode = 0;
        if (GetExitCodeProcess((HANDLE)backendProcess, &exitCode) && exitCode == STILL_ACTIVE) {
            // Stop the running backend before restarting
            PollBackendOutput();
            TerminateProcess((HANDLE)backendProcess, 0);
            WaitForSingleObject((HANDLE)backendProcess, 5000);
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

    // Open log file in %APPDATA%\EuroScope (writable, next to VatEFSsettings.json)
    std::string logPath;
    const char *appdata = getenv("APPDATA");
    if (appdata && appdata[0] != '\0') {
        logPath = std::string(appdata) + "\\EuroScope\\VatEFS.log";
    } else {
        // Fallback to plugin directory if APPDATA is unavailable
        logPath = DllPathFile;
        logPath.resize(logPath.size() - strlen("VatEFS.dll"));
        logPath += "VatEFS.log";
    }

    HANDLE hLog = CreateFileA(logPath.c_str(), GENERIC_WRITE, FILE_SHARE_READ, NULL,
                              CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
    if (hLog == INVALID_HANDLE_VALUE) {
        DisplayMessage("Failed to create log file: " + logPath +
                       " (error " + std::to_string(GetLastError()) + ")");
        return;
    }
    backendLogFile = hLog;

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

} // namespace VatEFS
