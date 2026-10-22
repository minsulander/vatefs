#pragma once

#include <string>

// Best LAN IPv4 for the ".efs start" URL. Must not do a DNS lookup —
// gethostbyname(hostname) blocks EuroScope's main thread for the DNS timeout.
std::string GetLocalIpAddress();
