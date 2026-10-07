#!/bin/bash -e
cd "$(dirname $0)/.."
export PATH="/c/Program Files/CMake/bin:$PATH"
rm -rf build
mkdir build
cd build

VCVARS="/c/Program Files (x86)/Microsoft Visual Studio/2019/BuildTools/VC/Auxiliary/Build/vcvarsall.bat"
if [ ! -f "$VCVARS" ]; then
    echo "vcvarsall.bat not found at $VCVARS" >&2
    exit 1
fi

# Incomplete VS Build Tools installs are not detected by the VS generator;
# use vcvarsall + NMake so the Win32 MSVC toolchain is available.
# A temp batch file avoids MSYS quoting, which otherwise hands cmd.exe a \"path\".
WIN_VCVARS=$(cygpath -w "$VCVARS")
WIN_BUILD=$(cygpath -w "$PWD")
cat > build-plugin.bat << EOF
call "${WIN_VCVARS}" x86
if errorlevel 1 exit /b 1
cd /d "${WIN_BUILD}"
set "PATH=C:\\Program Files\\CMake\\bin;%PATH%"
cmake -G "NMake Makefiles" -DCMAKE_BUILD_TYPE=Release ..
if errorlevel 1 exit /b 1
cmake --build . --config Release
if errorlevel 1 exit /b 1
EOF
cmd.exe //c "$(cygpath -w "$PWD/build-plugin.bat")"
rm -f build-plugin.bat

# make_msi.sh expects Release/VatEFS.dll (VS multi-config layout)
mkdir -p Release
cp -f VatEFS.dll Release/VatEFS.dll

# if [ -d "$APPDATA/EuroScope/ESAA/Plugins" ]; then
#     cp -f Release/VatEFS.dll "$APPDATA/EuroScope/ESAA/Plugins/"
#     echo "Copied DLL to $APPDATA/EuroScope/ESAA/Plugins"
# fi

if [ -d "/c/Program Files/VatEFS" ]; then
    cp -f Release/VatEFS.dll "/c/Program Files/VatEFS/"
    echo "Copied DLL to /c/Program Files/VatEFS"
fi
