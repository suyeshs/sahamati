PORTAL := $(abspath $(dir $(firstword $(MAKEFILE_LIST))))
DEPLOY_TARGET := $(abspath $(PORTAL)/../../cloud/public/docs)

.PHONY: install collect serve build clean

install:
	python3 -m pip install -r requirements.txt

collect:
	python3 scripts/collect_docs.py

serve: collect
	mkdocs serve -a 127.0.0.1:8765

build: collect
	mkdocs build --clean
	@mkdir -p "$(DEPLOY_TARGET)"
	@rm -rf "$(DEPLOY_TARGET)"/*
	@cp -R site/. "$(DEPLOY_TARGET)/"
	@echo "built -> $(DEPLOY_TARGET)"

# Strict variant: fails on any link/file warning.  Use for CI or pre-release.
build-strict: collect
	mkdocs build --clean --strict
	@mkdir -p "$(DEPLOY_TARGET)"
	@rm -rf "$(DEPLOY_TARGET)"/*
	@cp -R site/. "$(DEPLOY_TARGET)/"
	@echo "built (strict) -> $(DEPLOY_TARGET)"

clean:
	rm -rf site docs mkdocs.yml "$(DEPLOY_TARGET)"
