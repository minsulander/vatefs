#pragma once

#pragma warning(push, 0)
#include "EuroScopePlugIn.h"
#pragma warning(pop)

#include "json.hpp"
#include <map>
#include <string>

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
    void Refresh();
    bool FilterFlightPlan(EuroScopePlugIn::CFlightPlan FlightPlan);
    /** Poll tracking/handoff ownership and push UDP when ES state changes without a callback */
    void PollOwnershipChanges();

    bool disabled;
    bool debug;
    std::time_t enabledTime;
    void* udpReceiveSocket; // SOCKET (using void* to avoid including winsock2.h in header)
    bool winsockInitialized;
    std::string connectionError;
    std::vector<DummyRadarScreen *> dummyRadarScreens;

    void* backendProcess; // HANDLE to the efs.exe process (void* to avoid windows.h in header)
    void* backendOutputRead; // HANDLE to the read end of stdout/stderr pipe
    void* backendLogFile; // HANDLE to VatEFS.log
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
    /** CDM TSAT — annotation field 3 (HHMM); what ES displays, may lead CDM_data_*.txt */
    std::string GetCdmTsat(const std::string &callsign);
    /** Write CDM slash-fields in annotation 0 (e.g. TOBT=2, setBy=9, ASRT=0) */
    bool SetCdmStripFields(const std::string &callsign, const std::map<int, std::string> &fields);

    // Last snapshot of CDM_data_*.txt lines: callsign -> "tobt|tsat|ttot|ctot|reason|setBy"
    std::map<std::string, std::string> lastCdmFileSnapshot;

    // Last sent tracking|handoff ownership per callsign (detects ES-initiated assume/transfer/accept)
    std::map<std::string, std::string> lastOwnershipSnapshot;

    static bool IsValidUtf8(const char* str);
    static std::string SanitizeUtf8(const char* str);
    void SetJsonIfValidUtf8(nlohmann::json& j, const char* key, const char* value);
    void SetJsonWithUtf8Replace(nlohmann::json& j, const char* key, const char* value);
    /** Append tracking/handoff callsigns + sector indicators (SI) from EuroScope */
    void AppendOwnershipFields(nlohmann::json &message, EuroScopePlugIn::CFlightPlan FlightPlan,
                               std::stringstream *out = nullptr);
};

class DummyRadarScreen : public EuroScopePlugIn::CRadarScreen
{
    public:
    DummyRadarScreen(VatEFSPlugin *plugin);

    void OnAsrContentToBeClosed ( void );
    void AllocateSSR(const char *callsign);
    void ToggleClearanceFlag(const char *callsign);

    private:
    VatEFSPlugin *plugin;
};

} // namespace VatEFS
