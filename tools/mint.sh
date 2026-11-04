#!/usr/bin/env bash
# 心理年龄测试（mental）造码说明 — 本脚本不直接连公网造码。
# 使用 companion vault 脚本：
#
#   /workspace/quiz-code-api/scripts/mint.sh mental <CODE> 3
#
# 规则：前缀 MA + 4 位（字符表 ABCDEFGHJKMNPQRSTUVWXYZ23456789），每码 3 次。
# 切勿把可卖码写入本仓库。
set -euo pipefail
echo "Use: /workspace/quiz-code-api/scripts/mint.sh mental <CODE> 3" >&2
echo "Prefix MA + 4 chars from ABCDEFGHJKMNPQRSTUVWXYZ23456789; max 3 uses." >&2
exit 0
