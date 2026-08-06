// ===========================================================================
// iac-platform — MỘT pipeline dùng chung cho MỌI dự án × môi trường × cloud
//
//   MODE=infra → Terraform plan/apply cho (PROJECT × ENV × CLOUD)
//   MODE=app   → build + scan + sign + cập nhật manifest → ArgoCD deploy
//
// Yêu cầu Jenkins:
//   - Plugin: hashicorp-vault-plugin (+ pipeline), credentials-binding
//   - Credential AppRole: vault-approle-jenkins (policy: techshop-ci + postgres)
//   - Global Vault config: URL + engineVersion + CA đã import JVM truststore
// ===========================================================================
pipeline {
    agent any

    triggers { githubPush() }

    parameters {
        choice(name: 'PROJECT', choices: ['techshop'], description: 'Project (thêm qua scripts/new-project.sh, rồi thêm vào đây)')
        choice(name: 'ENV', choices: ['dev', 'stg', 'prd'], description: 'Environment')
        choice(name: 'CLOUD', choices: ['aws', 'gcp'], description: 'Cloud provider')
        choice(name: 'MODE', choices: ['infra', 'app'], description: 'infra: Terraform provision | app: build + deploy')
        choice(name: 'INFRA_ACTION', choices: ['plan', 'apply'], description: 'infra mode: plan hay apply')
        string(name: 'APP_BRANCH', defaultValue: 'main', description: 'Branch repo app để build (app mode)')
        string(name: 'DEPLOY_BRANCH', defaultValue: 'main', description: 'Branch GitOps (iac-platform) ArgoCD track')
        booleanParam(name: 'SKIP_BUILD', defaultValue: false, description: 'Skip docker build (app mode)')
        booleanParam(name: 'ROTATE_DB_PASSWORD', defaultValue: false, description: 'Rotate DB password theo secret/postgres')
    }

    environment {
        REGISTRY_BASE = 'docker.io/<your-user>'
        // Secret từ Vault qua plugin (AppRole) — mask tự động
        GITHUB_TOKEN = vault path: 'secret/ci/github', key: 'token'
        DOCKER_USER  = vault path: 'secret/ci/dockerhub', key: 'username'
        DOCKER_PAT   = vault path: 'secret/ci/dockerhub', key: 'token'
        DB_PASSWORD  = vault path: 'secret/postgres', key: 'password'
    }

    stages {
        // ── Resolve biến chung ──
        stage('Resolve') {
            steps { script {
                env.APP = params.PROJECT
                env.IMAGE_TAG = "${params.PROJECT}-${params.ENV}-${BUILD_NUMBER}"
                echo "→ PROJECT=${params.PROJECT} ENV=${params.ENV} CLOUD=${params.CLOUD} MODE=${params.MODE}"
                echo "→ IMAGE_TAG=${env.IMAGE_TAG}"
            } }
        }

        // ── Secret từ Vault (kiểm tra fail sớm) ──
        stage('Fetch Secrets') {
            steps { script {
                def required = ['GITHUB_TOKEN', 'DOCKER_USER', 'DOCKER_PAT']
                def secrets = [GITHUB_TOKEN: env.GITHUB_TOKEN, DOCKER_USER: env.DOCKER_USER, DOCKER_PAT: env.DOCKER_PAT]
                required.each { v -> if (!secrets[v] || secrets[v].trim().isEmpty()) error "Thiếu secret ${v} từ Vault" }
                echo '>>> Secret nạp từ Vault (AppRole)'
            } }
        }

        // ── MODE=infra: Terraform theo (project × env × cloud) ──
        stage('Infra: Terraform') {
            when { expression { params.MODE == 'infra' } }
            steps {
                dir("terraform/environments/${params.PROJECT}/${params.ENV}/${params.CLOUD}") {
                    sh 'terraform init -reconfigure -input=false'
                    sh 'terraform plan -input=false -out=tfplan'
                    script {
                        if (params.INFRA_ACTION == 'apply') {
                            sh 'terraform apply -auto-approve tfplan'
                        } else {
                            echo '>>> INFRA_ACTION=plan — dừng tại plan (không apply)'
                        }
                    }
                }
            }
        }

        // ── MODE=app: clone + build image theo PROJECT ──
        stage('App: Build') {
            when { expression { params.MODE == 'app' && !params.SKIP_BUILD } }
            steps {
                dir('app-source') {
                    sh "git clone --branch '${params.APP_BRANCH}' 'https://github.com/<your-org>/${params.PROJECT}.git' ."
                    sh """
                        set -e
                        echo \$DOCKER_PAT | docker login -u \$DOCKER_USER --password-stdin
                        docker build -f backend/Dockerfile \\
                          -t ${REGISTRY_BASE}/${params.PROJECT}-backend:${IMAGE_TAG} \\
                          -t ${REGISTRY_BASE}/${params.PROJECT}-backend:${params.ENV} .
                        docker push ${REGISTRY_BASE}/${params.PROJECT}-backend:${IMAGE_TAG}
                    """
                }
            }
        }

        // ── MODE=app: scan + sign (Trivy / Syft / Cosign) ──
        stage('App: Scan & Sign') {
            when { expression { params.MODE == 'app' && !params.SKIP_BUILD } }
            steps {
                dir('app-source') {
                    sh 'trivy image ${REGISTRY_BASE}/${params.PROJECT}-backend:${IMAGE_TAG} --severity CRITICAL,HIGH --exit-code 0 || true'
                    sh 'syft ${REGISTRY_BASE}/${params.PROJECT}-backend:${IMAGE_TAG} -o spdx-json=sbom.spdx.json || true'
                    // key cosign từ Vault (đọc trong environment) — tuỳ chỉnh theo setup
                    sh 'cosign sign --yes --key <path-cosign-key> ${REGISTRY_BASE}/${params.PROJECT}-backend:${IMAGE_TAG} || true'
                }
            }
        }

        // ── MODE=app: cập nhật manifest GitOps → ArgoCD ──
        stage('App: Commit manifest') {
            when { expression { params.MODE == 'app' } }
            steps {
                dir('iac-platform') {
                    checkout scm
                    script {
                        def f = "helm/${params.PROJECT}/env/values-${params.ENV}.yaml"
                        sh "sed -i 's|image: .*|image: ${REGISTRY_BASE}/${params.PROJECT}-backend:${IMAGE_TAG}|' ${f}"
                        sh """
                            git config user.email 'ci@local'
                            git config user.name 'ci'
                            git add ${f}
                            git diff --cached --quiet || {
                              git commit -m 'deploy ${params.PROJECT} ${IMAGE_TAG} [skip ci]'
                              git push origin HEAD:${params.DEPLOY_BRANCH}
                            }
                        """
                    }
                }
            }
        }

        // ── Rotate DB password (dùng chung, theo secret/postgres) ──
        stage('Rotate DB Password') {
            when { expression { params.ROTATE_DB_PASSWORD } }
            steps { script {
                sh """
                    set -e
                    echo "ALTER USER postgres WITH PASSWORD '${DB_PASSWORD}';" | \\
                      kubectl exec -i -n ${params.PROJECT}-${params.ENV} pod/postgres-0 -- psql -U postgres -d shopdb
                    kubectl -n ${params.PROJECT}-${params.ENV} patch rollout backend --type merge \\
                      -p '{"spec":{"restartAt":"$(date -Iseconds)"}}'
                """
            } }
        }
    }

    post {
        success { echo "✅ iac-platform: ${params.MODE} ${params.PROJECT}/${params.ENV}/${params.CLOUD} @ ${env.IMAGE_TAG}" }
        failure { echo "❌ CI thất bại" }
        always { cleanWs() }
    }
}
