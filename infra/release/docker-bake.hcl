variable "REGISTRY" { default = "registry.invalid/atarang" }
variable "VERSION" { default = "development" }
variable "MODEL_ARTIFACT_SHA256" { default = "" }

group "default" { targets = ["web", "api", "worker-cpu", "worker-cuda"] }

target "common" {
  context = "../.."
  platforms = ["linux/amd64"]
  attest = ["type=sbom", "type=provenance,mode=max"]
}

target "web" {
  inherits = ["common"]
  dockerfile = "infra/images/web.Dockerfile"
  tags = ["${REGISTRY}/web:${VERSION}"]
}

target "api" {
  inherits = ["common"]
  dockerfile = "infra/images/api.Dockerfile"
  tags = ["${REGISTRY}/api:${VERSION}"]
}

target "worker-cpu" {
  inherits = ["common"]
  dockerfile = "infra/images/worker-cpu.Dockerfile"
  args = { MODEL_ARTIFACT_SHA256 = "${MODEL_ARTIFACT_SHA256}" }
  tags = ["${REGISTRY}/worker-cpu:${VERSION}"]
}

target "worker-cuda" {
  inherits = ["common"]
  dockerfile = "infra/images/worker-cuda.Dockerfile"
  args = { MODEL_ARTIFACT_SHA256 = "${MODEL_ARTIFACT_SHA256}" }
  tags = ["${REGISTRY}/worker-cuda:${VERSION}"]
}
