#!/usr/bin/env bash
# holos-research v1.1.1 — 远程发布脚本（需用户手动执行，因 GitHub 远程写操作不在 agent 权限内）
#
# 作用：创建公共插件仓库 → 推送代码 → 创建 GitHub Release v1.1.1（含 tarball + 签名）→
#       向官方 SII-Holos/synergy-plugins 注册表开 PR → 自动验证并打印全部链接。
#
# 前置：gh 已登录（gh auth status）、网络可达 github.com。
# 用法：bash script/publish.sh
set -euo pipefail

REPO="yzxoi/holos-research"
REPO_URL="git@github.com:${REPO}.git"
VERSION="1.1.1"
TARBALL="holos-research-1.1.1.synergy-plugin.tgz"
SIG="${TARBALL}.sig"
REGISTRY_ENTRY=".release/registry-entry-holos-research.json"
REGISTRY_REPO="SII-Holos/synergy-plugins"
REGISTRY_BRANCH="publish/holos-research-1.1.1"
EXPECTED_SHA256="7d411b1eaa8efe8762bba621a509b242c3ac76195c9f175385661a92ffe63953"

fail() { echo "❌ $*" >&2; exit 1; }

# ── 0/6 预检 ────────────────────────────────────────────────────────────────
echo "==> 0/6 预检"
gh auth status >/dev/null 2>&1 || fail "gh 未登录。请先运行: gh auth login"
[ -f "${TARBALL}" ] || fail "缺少 ${TARBALL}（请先在插件目录运行 bunx synergy-plugin pack）"
[ -f "${SIG}" ] || fail "缺少 ${SIG}（请先运行 bunx synergy-plugin sign ${TARBALL}）"
[ -f "${REGISTRY_ENTRY}" ] || fail "缺少 ${REGISTRY_ENTRY}"
[ -f RELEASE_NOTES.md ] || fail "缺少 RELEASE_NOTES.md"

ACTUAL_SHA256="$(shasum -a 256 "${TARBALL}" | awk '{print $1}')"
[ "${ACTUAL_SHA256}" = "${EXPECTED_SHA256}" ] \
  || fail "tarball 哈希不匹配：期望 ${EXPECTED_SHA256}，实际 ${ACTUAL_SHA256}"

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || fail "当前目录不是 git 仓库"
[ "$(git branch --show-current)" = "main" ] || fail "当前分支不是 main（当前: $(git branch --show-current)）"

# ── 1/6 创建公共仓库（幂等）──────────────────────────────────────────────────
echo "==> 1/6 创建公共仓库 ${REPO}"
if gh repo view "${REPO}" >/dev/null 2>&1; then
  echo "    ✔ 仓库已存在，跳过创建"
else
  gh repo create "${REPO}" --public \
    --description "Synergy Plugin API 4 — structured research management: state machines, adversarial review, embedded Monitor panel"
  echo "    ✔ 仓库已创建"
fi
git remote get-url origin >/dev/null 2>&1 || git remote add origin "${REPO_URL}"

# ── 2/6 推送 main ───────────────────────────────────────────────────────────
echo "==> 2/6 推送 main"
git push -u origin main

echo "==> 3/6 创建 GitHub Release v${VERSION}"
if gh release view "v${VERSION}" --repo "${REPO}" >/dev/null 2>&1; then
  echo "    ✔ Release v${VERSION} 已存在，跳过创建"
else
  gh release create "v${VERSION}" "${TARBALL}" "${SIG}" \
    --repo "${REPO}" \
    --title "holos-research v${VERSION}" \
    --notes-file RELEASE_NOTES.md
  echo "    ✔ Release 已创建"
fi

# ── 4/6 准备官方注册表分支 ──────────────────────────────────────────────────
echo "==> 4/6 向官方注册表 ${REGISTRY_REPO} 准备条目"
REG_DIR="$(mktemp -d)"
trap 'rm -rf "${REG_DIR}"' EXIT
git clone --depth 1 "https://github.com/${REGISTRY_REPO}.git" "${REG_DIR}"
cp "${REGISTRY_ENTRY}" "${REG_DIR}/plugins/holos-research.json"
# 官方 CI 有 registry drift check：新增 plugins/*.json 后必须重建 registry.json
# 并一起提交，否则 PR 会被拒绝（CONTRIBUTING.md: bun run build-registry）。
if (cd "${REG_DIR}" && bun run build-registry >/dev/null 2>&1); then
  echo "    ✔ registry.json 已重建（含 holos-research）"
else
  echo "    ⚠ build-registry 失败，将尝试 bun install 后重试"
  (cd "${REG_DIR}" && bun install >/dev/null 2>&1 && bun run build-registry >/dev/null 2>&1) \
    || fail "registry.json 重建失败——PR 会被 CI drift check 拒绝"
fi
git -C "${REG_DIR}" checkout -b "${REGISTRY_BRANCH}"
git -C "${REG_DIR}" add plugins/holos-research.json registry.json
git -C "${REG_DIR}" commit -m "add holos-research 1.1.1 (API4)"

# ── 5/6 推送注册表分支并开 PR（幂等）────────────────────────────────────────
echo "==> 5/6 推送分支并开 PR"
if gh pr view "${REGISTRY_BRANCH}" --repo "${REGISTRY_REPO}" >/dev/null 2>&1; then
  echo "    ✔ PR 已存在，跳过创建"
else
  git -C "${REG_DIR}" push -u origin "${REGISTRY_BRANCH}"
  gh pr create \
    --repo "${REGISTRY_REPO}" \
    --base main \
    --head "${REGISTRY_BRANCH}" \
    --title "Add holos-research 1.1.1 to the Official Plugin Registry" \
    --body-file "/dev/stdin" <<'EOF'
Adds **holos-research** v1.1.1 to the official Synergy Plugin Market registry — a Plugin API 4 plugin for structured research management (15 tools, 4 agents, 17 skills, 9 monitor operations, embedded Solid Monitor workbench panel; workspace.read/write only).

- Plugin id: `holos-research` · Version: 1.1.1 · API 4.0 · compatibility `synergy >= 3.0.11`
- Repo: https://github.com/yzxoi/holos-research
- Artifact: holos-research-1.1.1.synergy-plugin.tgz (+ .sig), Ed25519 signer 483a6c48d867e72b6d48158918da77237e15b3d0e6d9f4f6ae8393cd198280ee
- Integrity: sha256-7d411b1eaa8efe8762bba621a509b242c3ac76195c9f175385661a92ffe63953
- Verified via `synergy-plugin build/validate --runtime-discovery/pack` + 690 tests + isolated-instance E2E
EOF
  echo "    ✔ PR 已创建"
fi

# ── 6/6 验证 ────────────────────────────────────────────────────────────────
echo "==> 6/6 验证发布产出"
gh repo view "${REPO}" --json name,url,visibility -q '.name + " | " + .url + " | " + .visibility'
gh release view "v${VERSION}" --repo "${REPO}" --json tagName,assets \
  -q '"Release " + .tagName + " | assets: " + ([.assets[].name] | join(", "))'
PR_URL="$(gh pr list --repo "${REGISTRY_REPO}" --head "${REGISTRY_BRANCH}" --state open --json url -q '.[0].url // "NONE"')"
echo "Registry PR: ${PR_URL}"
echo
echo "==> 完成。请将上面的 repo/release/PR 链接发回给 agent 以完成验收。"
