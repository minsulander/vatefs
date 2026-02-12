I want to make the EuroScope plugin actually start the backend. For testing, let's implement a EuroScope command, ".efs start" that checks if "C:\Program Files\VATEFS\efs.exe" exists and, if so, starts it, and keeps track of the process. Another command ".efs stop" kills the process. We should also kill the process when EuroScope quits (probably the plugin destructor?).                               

...

Now let's add optional arguments to the ".efs start" command. ".efs start log" starts the backend and redirects stdout and stderr to a file "VatEFS.log" in the plugin directory (same as settings file/dll file itself), ".efs start msg" redirects stdout and stderr to EuroSope messages, using DebugMessage(thecontent, "EFS backend").                                                                           
