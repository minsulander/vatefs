VatEFS — Electronic Flight Strips for VATSIM (ESAA)

INSTALL / FIRST USE
===================

1. Install this package (default location: C:\Program Files\VatEFS).
   The installer adds a Windows Firewall rule so other devices (e.g. iPads)
   can reach the EFS backend on TCP port 17770.

2. In EuroScope:
   - OTHER SET → Plug-ins… → Load → select
     C:\Program Files\VatEFS\VatEFS.dll
   - Allow the plugin to draw on the relevant radar screen(s)
     (same “Allow to draw” list as other plugins).

3. Connect to VATSIM, then in the EuroScope chat type:
     .efs start
   VatEFS prints a message with a URL (LAN IP and port 17770).

4. Open that URL in a browser on this PC or another device on the same network.
   On the EuroScope PC you can also use:
     http://localhost:17770/

5. Keep EuroScope running while you use the strips. Closing EuroScope (or
   stopping the plugin) stops the backend.

UPDATING
========

Install a newer .msi over the existing install (or uninstall first from
Windows Apps & features). Reload the plugin in EuroScope if the DLL was locked.

SUPPORT
=======

https://github.com/minsulander/vatefs
