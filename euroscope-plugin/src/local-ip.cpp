// Kept out of plugin.cpp: including <iphlpapi.h> next to the EuroScope SDK
// headers breaks their DummyRadarScreen parse.

#include <winsock2.h>
#include <ws2tcpip.h>
#include <iphlpapi.h>

#include <cstdio>
#include <memory>
#include <string>

#pragma comment(lib, "iphlpapi.lib")

#include "local-ip.h"

static int ScoreLanOctet(unsigned char a, unsigned char b)
{
    if (a == 192 && b == 168) return 3;
    if (a == 10) return 2;
    if (a == 172 && b >= 16 && b <= 31) return 1;
    return 0;
}

std::string GetLocalIpAddress()
{
    ULONG size = 16 * 1024;
    std::unique_ptr<unsigned char[]> buf;
    ULONG ret = ERROR_BUFFER_OVERFLOW;
    for (int attempt = 0; attempt < 3 && ret == ERROR_BUFFER_OVERFLOW; ++attempt) {
        buf = std::make_unique<unsigned char[]>(size);
        auto addrs = reinterpret_cast<IP_ADAPTER_ADDRESSES *>(buf.get());
        ret = GetAdaptersAddresses(
            AF_INET,
            GAA_FLAG_SKIP_ANYCAST | GAA_FLAG_SKIP_MULTICAST | GAA_FLAG_SKIP_DNS_SERVER,
            nullptr,
            addrs,
            &size);
    }
    if (ret != NO_ERROR || !buf) return "";

    std::string best;
    int bestScore = -1;
    auto addrs = reinterpret_cast<IP_ADAPTER_ADDRESSES *>(buf.get());
    for (auto *adapter = addrs; adapter; adapter = adapter->Next) {
        if (adapter->OperStatus != IfOperStatusUp) continue;
        if (adapter->IfType == IF_TYPE_SOFTWARE_LOOPBACK) continue;
        for (auto *unicast = adapter->FirstUnicastAddress; unicast; unicast = unicast->Next) {
            if (!unicast->Address.lpSockaddr || unicast->Address.lpSockaddr->sa_family != AF_INET)
                continue;
            auto *sin = reinterpret_cast<sockaddr_in *>(unicast->Address.lpSockaddr);
            auto *octets = reinterpret_cast<unsigned char *>(&sin->sin_addr.s_addr);
            if (octets[0] == 127) continue;
            if (octets[0] == 169 && octets[1] == 254) continue;
            const int score = ScoreLanOctet(octets[0], octets[1]);
            if (score > bestScore) {
                bestScore = score;
                char text[16];
                snprintf(text, sizeof(text), "%u.%u.%u.%u",
                         octets[0], octets[1], octets[2], octets[3]);
                best = text;
            }
        }
    }
    return best;
}
