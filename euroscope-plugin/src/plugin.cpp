#include "plugin.h"
#include "Version.h"

#include "json.hpp"
#include <chrono>
#include <format>
#include <fstream>
#include <sstream>
#include <string>
#include <windows.h>
// #include <winsock2.h>
// #include <ws2tcpip.h>

#pragma comment(lib, "ws2_32.lib")

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

        const char *trackingController = FlightPlan.GetTrackingControllerCallsign();
        if (trackingController && strlen(trackingController) < 20) {
            out << " controller " << trackingController;
            SetJsonIfValidUtf8(message, "controller", trackingController);
        }
        const char *handoffTargetController = FlightPlan.GetHandoffTargetControllerCallsign();
        if (handoffTargetController && strlen(handoffTargetController) < 20) {
            out << " handoffTargetController " << handoffTargetController;
            SetJsonIfValidUtf8(message, "handoffTargetController", handoffTargetController);
        }
        const char *nextController = FlightPlan.GetCoordinatedNextController();
        if (nextController && strlen(nextController) < 20) {
            out << " nextController " << nextController;
            SetJsonIfValidUtf8(message, "nextController", nextController);
        }

        const char *aircraftType = fpData.GetAircraftFPType();
        if (aircraftType && strlen(aircraftType) > 0 && strlen(aircraftType) < 20) {
            SetJsonIfValidUtf8(message, "aircraftType", aircraftType);
        }
        SetJsonIfValidUtf8(message, "wakeTurbulence", (std::string("") + fpData.GetAircraftWtc()).c_str());

        const char *origin = fpData.GetOrigin();
        if (origin && strlen(origin) < 10) SetJsonIfValidUtf8(message, "origin", origin);
        const char *destination = fpData.GetDestination();
        if (destination && strlen(destination) < 10) SetJsonIfValidUtf8(message, "destination", destination);
        const char *alternate = fpData.GetAlternate();
        if (alternate && strlen(alternate) < 10) SetJsonIfValidUtf8(message, "alternate", alternate);
        SetJsonIfValidUtf8(message, "flightRules", fpData.GetPlanType());
        SetJsonIfValidUtf8(message, "communicationType", (std::string("") + fpData.GetCommunicationType()).c_str());
        // TODO check this is set correctly, compare controllerAssignedDataUpdate, ensure it doesn't overwrite the custom groundstates
        SetJsonIfValidUtf8(message, "groundstate", FlightPlan.GetGroundState());
        message["clearance"] = (bool)FlightPlan.GetClearenceFlag();

        const char *arrRwy = fpData.GetArrivalRwy();
        const char *starName = fpData.GetStarName();
        const char *depRwy = fpData.GetDepartureRwy();
        const char *sidName = fpData.GetSidName();

        if (arrRwy && *arrRwy && strlen(arrRwy) < 5) SetJsonIfValidUtf8(message, "arrRwy", arrRwy);
        if (starName && *starName && strlen(starName) < 10) SetJsonIfValidUtf8(message, "star", starName);
        if (depRwy && *depRwy && strlen(depRwy) < 5) SetJsonIfValidUtf8(message, "depRwy", depRwy);
        if (sidName && *sidName && strlen(sidName) < 10) SetJsonIfValidUtf8(message, "sid", sidName);


        // int ete = FlightPlan.GetPositionPredictions().GetPointsNumber();
        // if (ete >= 0 && ete <= 1000) { // Reasonable ETE range
        //     out << " ete " << ete;
        // }


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

        const char *controllerCallsign = FlightPlan.GetTrackingControllerCallsign();
        if (controllerCallsign && strlen(controllerCallsign) > 0 && strlen(controllerCallsign) < 20) {
            SetJsonIfValidUtf8(message, "controller", controllerCallsign);
            out << " controller " << controllerCallsign;
        }

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
    message["gs"] = RadarTarget.GetGS();
    auto position = RadarTarget.GetPosition();
    if (position.IsValid()) {
        message["latitude"] = position.GetPosition().m_Latitude;
        message["longitude"] = position.GetPosition().m_Longitude;
        message["altitude"] = position.GetPressureAltitude();
        // message["headingMagnetic"] = position.GetReportedHeading();
        message["heading"] = position.GetReportedHeadingTrueNorth();
        SetJsonIfValidUtf8(message, "squawk", position.GetSquawk());
        //message["modec"] = position.GetTransponderC();
        //message["ident"] = position.GetTransponderI();
    }
    auto fp = RadarTarget.GetCorrelatedFlightPlan();
    if (fp.IsValid()) {
        const char *trackingCallsign = fp.GetTrackingControllerCallsign();
        if (trackingCallsign && strlen(trackingCallsign) < 20) {
            SetJsonIfValidUtf8(message, "controller", trackingCallsign);
        }
        const char *handoffTargetController = fp.GetHandoffTargetControllerCallsign();
        if (handoffTargetController && strlen(handoffTargetController) < 20) {
            SetJsonIfValidUtf8(message, "handoffTargetController", handoffTargetController);
        }
        const char *nextController = fp.GetCoordinatedNextController();
        if (nextController && strlen(nextController) < 20) {
            SetJsonIfValidUtf8(message, "nextController", nextController);
        }
    }
    PostJson(message, "OnRadarTargetPositionUpdate");
}

EuroScopePlugIn::CRadarScreen *VatEFSPlugin::OnRadarScreenCreated(const char *sDisplayName, bool NeedRadarContent, bool GeoReferenced, bool CanBeSaved, bool CanBeCreated)
{
    DebugMessage("RadarScreenCreated " + std::string(sDisplayName));
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
        if (handoffToMe) {
            fp.AcceptHandoff();
            DisplayMessage("Accepted handoff for " + callsign);
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
        for (auto &c : callsign)
            c = (char)std::toupper((unsigned char)c);
        auto fp = FlightPlanSelect(callsign.c_str());
        if (!fp.IsValid()) {
            DisplayMessage("Flight plan not found: " + callsign);
            return false;
        }
        bool resetAfterSet = (subcommand == "scratmp");
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
        if (!success)
            DisplayMessage("Failed to set scratch pad for " + callsign);
        else
            DisplayMessage("Scratch pad set for " + callsign + ": " + content);
        return true;
    } else if (subcommand == "ssr") {
        if (dummyRadarScreens.size() > 0) dummyRadarScreens[0]->DoStuff();
        else DisplayMessage("DummyRadarScreen not created");
        std::string remainder = (subEnd == std::string::npos) ? "" : rest.substr(subEnd + 1);
        std::string callsign = remainder;
        std::string::size_type space = remainder.find(' ');
        if (space != std::string::npos) callsign = remainder.substr(0, space);
        for (auto &c : callsign)
            c = (char)std::toupper((unsigned char)c);
        if (callsign.empty()) {
            DisplayMessage("Usage: .efs ssr CALLSIGN");
            return false;
        }
        // auto fp = FlightPlanSelect(callsign.c_str());
        // if (!fp.IsValid()) {
        //     DisplayMessage("Flight plan not found: " + callsign);
        //     return false;
        // }
        if (dummyRadarScreens.size() > 0) {
            dummyRadarScreens[0]->AllocateSSR(callsign.c_str());
        } else {
            DisplayMessage("DummyRadarScreen not created");
        }
        return true;
    } else if (subcommand == "refresh") {
		for ( EuroScopePlugIn::CFlightPlan FlightPlan = FlightPlanSelectFirst(); FlightPlan.IsValid(); FlightPlan = FlightPlanSelectNext(FlightPlan)) {
            OnFlightPlanFlightPlanDataUpdate(FlightPlan);
        }
        for ( EuroScopePlugIn::CRadarTarget RadarTarget = RadarTargetSelectFirst(); RadarTarget.IsValid(); RadarTarget = RadarTargetSelectNext(RadarTarget)) {
            OnRadarTargetPositionUpdate(RadarTarget);
        }
        DisplayMessage("Refreshed all flight plans and radar targets");
        return true;
    }
    return false;
}

void VatEFSPlugin::OnTimer(int counter)
{
    try {
        if (disabled && (GetConnectionType() == EuroScopePlugIn::CONNECTION_TYPE_DIRECT ||
                         GetConnectionType() == EuroScopePlugIn::CONNECTION_TYPE_PLAYBACK)) {
            disabled = false;
            DebugMessage("EFS updates enabled");
            enabledTime = std::time(NULL);
            // Initialize Winsock and UDP receive socket
            InitializeWinsock();
            InitializeUdpReceiveSocket();
        } else if (!disabled && GetConnectionType() != EuroScopePlugIn::CONNECTION_TYPE_DIRECT &&
                   GetConnectionType() != EuroScopePlugIn::CONNECTION_TYPE_PLAYBACK) {
            disabled = true;
            DebugMessage("EFS updates disabled");

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
    } catch (const std::exception &e) {
        DisplayMessage(std::string("OnTimer exception: ") + e.what());
    } catch (...) {
        DisplayMessage("OnTimer: Unknown exception");
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
            // Null-terminate the received data
            buffer[recvResult] = '\0';

            // Display the received message
            std::string message = "UDP received: ";
            message += std::string(buffer, recvResult);
            DisplayMessage(message);
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
        if (c <= 0x7F)
            continue;
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
            for (size_t i = 0; i < seq.size(); i++) result += '?';
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
    for (size_t i = 0; i < seq.size(); i++) result += '?';
    return result;
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


DummyRadarScreen::DummyRadarScreen(VatEFSPlugin *plugin)
: CRadarScreen()
{
    this->plugin = plugin;
}

void DummyRadarScreen::OnAsrContentToBeClosed()
{
    plugin->dummyRadarScreens.erase(std::remove(plugin->dummyRadarScreens.begin(), plugin->dummyRadarScreens.end(), this), plugin->dummyRadarScreens.end());
    delete this;
}

void DummyRadarScreen::DoStuff()
{
    plugin->DebugMessage("DummyRadarScreen::DoStuff");
}

void DummyRadarScreen::AllocateSSR(const char *callsign)
{
    plugin->DebugMessage("DummyRadarScreen::AllocateSSR " + std::string(callsign));
    plugin->SetASELAircraft(GetPlugIn()->FlightPlanSelect(callsign));  // make sure the correct aircraft is selected before calling 'StartTagFunction'
    StartTagFunction(callsign, NULL, EuroScopePlugIn::TAG_ITEM_TYPE_CALLSIGN, callsign, "TopSky plugin", 667, POINT(), RECT());
    plugin->DebugMessage("did it work?");
    //StartTagFunction("TopSky", 667, ssrCallsign.c_str());
}

} // namespace VatEFS
