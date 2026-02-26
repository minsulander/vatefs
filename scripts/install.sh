#!/bin/bash -e

root="/c/Program Files/VatEFS"
if [ ! -d "$root" ]; then
    echo "First, you must make C:\Program Files\VatEFS directory (as administrator) and give yourself permission"
    exit 1
fi

touch "$root/fil.txt"
rm -f "$root/fil.txt"

cd "$(dirname $0)/.."

. scripts/build.sh

cp backend/dist/efs.exe "$root"
cp euroscope-plugin/build/Release/VatEFS.dll "$root"
rm -rf "$root/public"
mkdir -p "$root/public"
cp -rf frontend/dist/* "$root/public/"

rm -rf "$root/data"
cp -rf data "$root"
