#!/bin/bash -e

cd "$(dirname $0)/.."

cd common
npm install
npm run build

cd ../backend
npm install
npm run build
scripts/build_sea.sh

cd ../frontend
npm install
npm run build
cd ..

euroscope-plugin/scripts/build.sh
