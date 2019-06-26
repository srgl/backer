PLUGIN_NAME = ${npm_package_author_name}/${npm_package_name}
PLUGIN_TAG = ${npm_package_version}

rootfs:
	@rm -rf ./plugin
	@docker build -t ${PLUGIN_NAME}:rootfs .
	@mkdir -p ./plugin/rootfs
	@docker create --name tmp ${PLUGIN_NAME}:rootfs
	@docker export tmp | tar -x -C ./plugin/rootfs
	@cp config.json ./plugin/
	@docker rm -vf tmp

build: rootfs
	@docker plugin rm -f ${PLUGIN_NAME} || true
	@docker plugin create ${PLUGIN_NAME} ./plugin
	@docker plugin enable ${PLUGIN_NAME} --timeout 120

build_tag: rootfs
	@docker plugin rm -f ${PLUGIN_NAME}:${PLUGIN_TAG} || true
	@docker plugin create ${PLUGIN_NAME}:${PLUGIN_TAG} ./plugin
	@docker plugin enable ${PLUGIN_NAME}:${PLUGIN_TAG} --timeout 120

push: build build_tag
	@docker plugin push ${PLUGIN_NAME}:${PLUGIN_TAG}
	@docker plugin push ${PLUGIN_NAME}
