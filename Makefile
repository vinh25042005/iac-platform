# iac-platform — Makefile
# Tiện ích vận hành. VD: make new-project PROJ=techshop CLOUD=aws
SHELL := /bin/bash
PROJ ?= techshop
CLOUD ?= aws
ENV ?= stg

.PHONY: help new-project plan apply init

help: ## Liệt kê lệnh
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

new-project: ## Sinh dự án mới: make new-project PROJ=<name> CLOUD=<aws|gcp>
	./scripts/new-project.sh $(PROJ) $(CLOUD)

plan: ## Terraform plan cho (PROJ, ENV, CLOUD)
	cd terraform/environments/$(PROJ)/$(ENV)/$(CLOUD) && terraform init -reconfigure -input=false && terraform plan -input=false

apply: ## Terraform apply cho (PROJ, ENV, CLOUD)
	cd terraform/environments/$(PROJ)/$(ENV)/$(CLOUD) && terraform init -reconfigure -input=false && terraform plan -input=false -out=tfplan && terraform apply -auto-approve tfplan

init: ## Khởi tạo remote state cho env mới
	./scripts/env-init.sh $(PROJ) $(ENV) $(CLOUD)
