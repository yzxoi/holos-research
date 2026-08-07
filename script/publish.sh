#!/usr/bin/env bash
# holos-research v1.0.0 — 远程发布脚本（需用户手动执行，因 GitHub 远程写操作不在 agent 权限内）
#
# 作用：创建公共插件仓库 → 推送代码 → 创建 GitHub Release v1.0.0（含 tarball + 签名）→
#       向官方 SII-Holos/synergy-plugins 注册表开 PR。
#
# 前置：gh 已登录（gh auth status）、本目录为 holos-research 插件仓库（git main 分支）。
# 用法：bash script/publish.sh
set -euo pipefail

REPO="yzxoi/holos-research"
VERSION="1.0.0"
TARBALL="holos-research-1.0.0.synergy-plugin.tgz"
SIG="${TARBALL}.sig"
REGISTRY_ENTRY=".release/registry-entry-holos-research.json"
REGISTRY_REPO="https://github.com/SII-Holos/synergy-plugins.git"

echo "==> 1/4 创建公共仓库 ${REPO}（如已存在会跳过）"
gh repo create "${REPO}" --public --source . --push \
  --description "Synergy Plugin API 4 — structured research management: state machines, adversarial review, embedded Monitor panel" \
  || echo "    (仓库可能已存在，继续)"

echo "==> 2/4 确保 main 分支已推送"
git push -u origin main

echo "==> 3/4 创建 GitHub Release v${VERSION}（含 tarball + Ed25519 签名）"
gh release create "v${VERSION}" "${TARBALL}" "${SIG}" \
  --repo "${REPO}" \
  --title "holos-research v${VERSION}" \
  --notes-file RELEASE_NOTES.md

echo "==> 4/4 向官方注册表 ${REGISTRY_REPO} 开 PR"
REG_DIR="$(mktemp -d)"
git clone --depth 1 "${REGISTRY_REPO}" "${REG_DIR}"
cp "${REGISTRY_ENTRY}" "${REG_DIR}/plugins/holos-research.json"
(cd "${REG_DIR}" && git checkout -b publish/holos-research-1.0.0 \
  && git add plugins/holos-research.json \
  && git commit -m "add holos-research 1.0.0 (API4)" \
  && git push -u origin publish/holos-research-1.0.0 \
  && gh pr create \
      --base main \
      --head publish/holos-research-1.0.0 \
      --title "Add holos-research 1.0.0 to the Official Plugin Registry" \
      --body-file "/dev/stdin" <<'EOF'
Adds **holos-research** v1.0.0 to the official Synergy Plugin Market registry — a Plugin API 4 plugin for structured research management (15 tools, 4 agents, 17 skills, 9 monitor operations, embedded Solid Monitor workbench panel; workspace.read/write only).

- Plugin id: `holos-research` · Version: 1.0.0 · API 4.0 · compatibility `synergy >= 3.0.11`
- Repo: https://github.com/yzxoi/holos-research
- Artifact: holos-research-1.0.0.synergy-plugin.tgz (+ .sig), Ed25519 signer 483a6c48d867e72b6d48158918da77237e15b3d0e6d9f4f6ae8393cd198280ee
- Integrity: sha256-46e04957fa75487ee7abe83820c210fa49f8c1abc00d37711d625f1f87752521
- Verified via `synergy-plugin build/validate --runtime-discovery/pack` + 688 tests + isolated-instance E2E
EOF
)
rm -rf "${REG_DIR}"

echo "==> 完成。检查上面的 PR 链接并等待维护者 review。"
