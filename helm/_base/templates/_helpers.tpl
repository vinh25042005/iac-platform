{{/*
  base.fullname — tên dự án dùng làm prefix mọi resource (mặc định = release name)
*/}}
{{- define "base.fullname" -}}
{{- .Values.global.project | default .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
  base.namespace — namespace của app (mặc định <project>-<env>)
*/}}
{{- define "base.namespace" -}}
{{- .Values.namespace.name | default (printf "%s-%s" (include "base.fullname" .) .Values.env) -}}
{{- end -}}

{{/*
  base.vaultRole — Vault k8s auth role (mặc định = project)
*/}}
{{- define "base.vaultRole" -}}
{{- .Values.vault.role | default (include "base.fullname" .) -}}
{{- end -}}

{{/*
  base.image.backend / base.image.frontend — nếu values.images.<comp> rỗng thì
  dùng convention: <repo>/<project>-<comp>:<tag>
*/}}
{{- define "base.image.backend" -}}
{{- if .Values.images.backend -}}
{{- .Values.images.backend -}}
{{- else -}}
{{- printf "%s/%s-backend:%s" .Values.images.repo (include "base.fullname" .) .Values.images.tag -}}
{{- end -}}
{{- end -}}

{{- define "base.image.frontend" -}}
{{- if .Values.images.frontend -}}
{{- .Values.images.frontend -}}
{{- else -}}
{{- printf "%s/%s-frontend:%s" .Values.images.repo (include "base.fullname" .) .Values.images.tag -}}
{{- end -}}
{{- end -}}

{{/*
  base.ingressName — mặc định <project>-ingress
*/}}
{{- define "base.ingressName" -}}
{{- .Values.ingress.name | default (printf "%s-ingress" (include "base.fullname" .)) -}}
{{- end -}}

{{/*
  base.tlsSecret — mặc định <project>-tls
*/}}
{{- define "base.tlsSecret" -}}
{{- .Values.ingress.tlsSecret | default (printf "%s-tls" (include "base.fullname" .)) -}}
{{- end -}}

{{/*
  base.storageClass — StorageClass cho postgres:
    aws → <project>-ssm-waitforfirstconsumer (Terraform tạo, WaitForFirstConsumer)
    gcp → standard-rwo (mặc định GKE)
*/}}
{{- define "base.storageClass" -}}
{{- if .Values.postgres.storage.className -}}
{{- .Values.postgres.storage.className -}}
{{- else if eq .Values.global.cloud "gcp" -}}
{{- "standard-rwo" -}}
{{- else -}}
{{- printf "%s-ssm-waitforfirstconsumer" (include "base.fullname" .) -}}
{{- end -}}
{{- end -}}
