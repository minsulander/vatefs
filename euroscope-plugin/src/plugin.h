#pragma once

#pragma warning(push, 0)
#include "EuroScopePlugIn.h"
#pragma warning(pop)

#include "json.hpp"
#include <string>

namespace VatEFS
{

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
    bool FilterFlightPlan(EuroScopePlugIn::CFlightPlan FlightPlan);

    bool disabled;
    bool debug;
    std::time_t enabledTime;
    void* udpReceiveSocket; // SOCKET (using void* to avoid including winsock2.h in header)
    bool winsockInitialized;
    std::string connectionError;
    std::vector<DummyRadarScreen *> dummyRadarScreens;

    void InitializeWinsock();
    void CleanupWinsock();
    void InitializeUdpReceiveSocket();
    void CleanupUdpReceiveSocket();
    void ReceiveUdpMessages();
    void PostJson(const nlohmann::json& jsonData, const char *whereaboutsInDaCode);

    static bool IsValidUtf8(const char* str);
    void SetJsonIfValidUtf8(nlohmann::json& j, const char* key, const char* value);
};

class DummyRadarScreen : public EuroScopePlugIn::CRadarScreen
{
    public:
    DummyRadarScreen(VatEFSPlugin *plugin);

    void OnAsrContentToBeClosed ( void );
    void DoStuff();
    void AllocateSSR(const char *callsign);

    private:
    VatEFSPlugin *plugin;
};

} // namespace VatEFS
