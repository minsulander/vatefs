#!/bin/bash -e

# https://nodejs.org/api/single-executable-applications.html

if [ -z "$(node --version | grep -e v2[24])" ]; then
    echo "Need node v22 or v24"
    exit 1
fi

cd "$(dirname $0)/.."

if [ ! -f "dist/server.js" ]; then
    echo "First one must npm run build"
    exit 1
fi

echo -n 'const { createRequire } = require("node:module"); require = createRequire(__filename); ' > dist/sea-server.js
cat dist/server.js >> dist/sea-server.js

node --experimental-sea-config sea-config.json

rm -f dist/sea-server.js

executable=efs

if [ "$(uname)" == "Darwin" ]; then
    cp ../scripts/macos/node dist/$executable
elif [ "$(uname -o)" == "Msys" ]; then
    node -e "require('fs').copyFileSync(process.execPath, 'dist/"$executable".exe')" 
else
    cp $(command -v node) dist/$executable
    cp ../scripts/linux-arm64/node dist/$executable-arm64
fi

if [ "$(uname)" == "Darwin" ]; then
    codesign --remove-signature dist/$executable
fi

if [ "$(uname -o)" == "Msys" ]; then
    export PATH="/c/Program Files (x86)/Windows Kits/10/App Certification Kit/:$PATH"
    signtool remove -s dist/$executable.exe 
fi

if [ "$(uname)" == "Darwin" ]; then
    npx postject dist/$executable NODE_SEA_BLOB dist/sea-prep.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 --macho-segment-name NODE_SEA
elif [ "$(uname -o)" == "Msys" ]; then
    npx postject dist/$executable.exe NODE_SEA_BLOB dist/sea-prep.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
else
    npx postject dist/$executable NODE_SEA_BLOB dist/sea-prep.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
    npx postject dist/$executable-arm64 NODE_SEA_BLOB dist/sea-prep.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
fi

rm -f dist/sea-prep.blob

if [ "$(uname)" == "Darwin" ]; then
    codesign --sign - dist/$executable
fi
# if windows: (but not really)
# signtool sign /fd SHA256 dist/$executable.exe  
