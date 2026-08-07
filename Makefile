# iac-platform — Makefile
# Tiện ích vận hành (AWS-only). VD: make new-project PROJ=techshop
SHELL := /bin/bash
PROJ ?= techshop
ENV ?= stg

.PHONY: help new-project plan apply init

help: ## Liệt kê lệnh
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

new-project: ## Sinh dự án mới: make new-project PROJ=<name>
	./scripts/new-project.sh $(PROJ)

plan: ## Terraform plan cho (PROJ, ENV)
	cd terraform/environments/$(PROJ)/$(ENV) && terraform init -reconfigure -input=false && terraform plan -input=false

apply: ## Terraform apply cho (PROJ, ENV)
	cd terraform/environments/$(PROJ)/$(ENV) && terraform init -reconfigure -input=false && terraform plan -input=false -out=tfplan && terraform apply -auto-approve tfplan

init: ## Khởi tạo state bucket (1 lần setup platform)
	./scripts/env-init.sh
