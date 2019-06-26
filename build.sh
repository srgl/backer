#!/bin/bash

rm -rf ./plugin
docker build -t ${npm_package_name}:rootfs .
mkdir -p ./plugin/rootfs
docker create --name tmp ${npm_package_name}:rootfs
docker export tmp | tar -x -C ./plugin/rootfs
cp config.json ./plugin/
docker rm -vf tmp

docker plugin rm -f ${npm_package_name} || true
docker plugin create ${npm_package_name} ./plugin
docker plugin enable ${npm_package_name} --timeout 120