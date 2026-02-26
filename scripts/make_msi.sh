#!/bin/bash -e
# choco install wixtoolset nssm

[ -z "$VERSION" ] && VERSION=$CI_COMMIT_TAG
[ -z "$VERSION" -a ! -z "$CI_PIPELINE_IID" ] && VERSION=0.0.$CI_PIPELINE_IID
if [ -z "$VERSION" ]; then
    echo "Please set the VERSION environment variable when manually building a release."
    exit 1
fi

cd "$(dirname $0)/.."

if [ -d /c/Program\ Files\ \(x86\)/WiX\ Toolset\ v3.11/bin ]; then
    which heat 2>/dev/null || export PATH=/c/Program\ Files\ \(x86\)/WiX\ Toolset\ v3.11/bin:$PATH
fi
which heat >/dev/null

FILENAME=vatefs-$VERSION.msi

if [ "$VERSION" == "0.0.1" -a ! -z "$CI_PIPELINE_ID" ]; then
    FILENAME=vatefs-$CI_PIPELINE_ID.msi
fi

root=build

rm -rf $root
mkdir -p $root

. scripts/build.sh

cp euroscope-plugin/build/Release/VatEFS.dll $root/
cp -rf backend/dist/efs.exe $root/
rm -rf "$root/public"
mkdir -p "$root/public"
cp -rf frontend/dist/* "$root/public/"
rm -rf "$root/data"
cp -rf data "$root"

rm -f *.wixobj *.generated.wxs

heat dir $root -gg -sfrag -template fragment -srd -cg AllFiles -var var.path -dr INSTALLDIR -out allfiles.generated.wxs
candle -arch x64 -dpath=$root -dProductVersion=$VERSION scripts/*.wxs *.generated.wxs -ext WiXUtilExtension -ext WixFirewallExtension
light *.wixobj -o $FILENAME -cultures:en-US -ext WixUIExtension.dll -ext WiXUtilExtension -ext WixFirewallExtension

rm -f *.wixobj *.generated.wxs *.wixpdb

echo "
So far so good... Now try:

msiexec -i $FILENAME
"