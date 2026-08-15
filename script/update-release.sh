#!/usr/bin/env bash
# holos-research v1.1.1 — 修复后远程更新脚本
#
# 作用：替换 GitHub Release v1.1.1 资产（修复后的 tarball + 新签名）→
#       更新官方 SII-Holos/synergy-plugins PR 分支（新 entry + 重建 registry.json）→
#       自动验证。
#
# 前置：gh 已登录、插件目录为 git main 分支、本目录含修复后的发布材料。
# 用法：bash script/update-release.sh
set -euo pipefail

REPO="yzxoi/holos-research"
REPO_URL="git@github.com:${REPO}.git"
VERSION="1.1.1"
TARBALL="holos-research-1.1.1.synergy-plugin.tgz"
SIG="${TARBALL}.sig"
REGISTRY_ENTRY=".release/registry-entry-holos-research.json"
REGISTRY_REPO="SII-Holos/synergy-plugins"
REGISTRY_BRANCH="publish/holos-research-1.1.1"

fail() { echo "❌ $*" >&2; exit 1; }

echo "==> 1/4 预检"
gh auth status >/dev/null 2>&1 || fail "gh 未登录"
[ -f "${TARBALL}" ] || fail "缺少 ${TARBALL}"
[ -f "${SIG}" ] || fail "缺少 ${SIG}"
[ -f "${REGISTRY_ENTRY}" ] || fail "缺少 ${REGISTRY_ENTRY}"
ACTUAL_SHA256="$(shasum -a 256 "${TARBALL}" | awk '{print $1}')"
ENTRY_INTEGRITY="$(python3 -c "import json; print(json.load(open('${REGISTRY_ENTRY}'))['versions'][0]['integrity'].removeprefix('sha256-'))")"
[ "${ACTUAL_SHA256}" = "${ENTRY_INTEGRITY}" ] || fail "tarball sha256 (${ACTUAL_SHA256}) 与 entry integrity (${ENTRY_INTEGRITY}) 不一致"

echo "==> 2/4 替换 GitHub Release v${VERSION} 资产"
gh release upload "v${VERSION}" "${TARBALL}" "${SIG}" --repo "${REPO}" --clobber
echo "    ✔ 资产已替换"

echo "==> 3/4 更新官方注册表 PR 分支 ${REGISTRY_BRANCH}"
REG_DIR="$(mktemp -d)"
trap 'rm -rf "${REG_DIR}"' EXIT
git clone "https://github.com/${REGISTRY_REPO}.git" "${REG_DIR}"
if ! git -C "${REG_DIR}" ls-remote --exit-code --heads origin "${REGISTRY_BRANCH}" >/dev/null 2>&1; then
  fail "分支 ${REGISTRY_BRANCH} 不存在——请先运行 script/publish.sh"
fi
git -C "${REG_DIR}" fetch origin "${REGISTRY_BRANCH}"
git -C "${REG_DIR}" checkout -B "${REGISTRY_BRANCH}" "origin/${REGISTRY_BRANCH}"
cp "${REGISTRY_ENTRY}" "${REG_DIR}/plugins/holos-research.json"
if (cd "${REG_DIR}" && bun run build-registry >/dev/null 2>&1); then
  echo "    ✔ registry.json 已重建"
else
  (cd "${REG_DIR}" && bun install >/dev/null 2>&1 && bun run build-registry >/dev/null 2>&1) \
    || fail "registry.json 重建失败"
fi
git -C "${REG_DIR}" add plugins/holos-research.json registry.json
if git -C "${REG_DIR}" diff --cached --quiet; then
  echo "    ✔ 无变更（entry/registry 已是最新）"
else
  git -C "${REG_DIR}" commit -m "holos-research 1.0.0: refresh integrity after nested-aux-dir fix"
  git -C "${REG_DIR}" push origin "${REGISTRY_BRANCH}"
  echo "    ✔ 分支已推送"
fi

echo "==> 4/4 验证"
gh release view "v${VERSION}" --repo "${REPO}" --json tagName,assets \
  -q '"Release " + .tagName + " | assets: " + ([.assets[] | .name + " sha256:" + (.digest // "" | sub("sha256:"; ""))] | join(", "))'
PR_URL="$(gh pr view "${REGISTRY_BRANCH}" --repo "${REGISTRY_REPO}" --json url -q '.url // "NONE"')"
echo "Registry PR: ${PR_URL}"
echo
echo "==> 完成。请确认 PR 的 validate check 通过。"
