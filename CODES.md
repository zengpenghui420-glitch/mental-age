# 验证码说明（心理年龄测试）

## 订单号

- 只接受 `P` + 18 位数字。重复块、逐位 ±1 的序列，以及 19 位号码，都提示「订单号格式不对」，不会开始测验。
- 格式通过后立即开始。页面不向 `*.vercel.app` 发订单请求，也不读写 Mantle 的 `orders/`。
- 第一次开始提示「验证成功，还可以测 2 次」。重新测试把提示改为「还可以测 1 次」，再改为「这是最后一次」。刷新、继续这一次、恢复结果和查看上次结果不改变这条提示。
- 同一订单号在这三次提示之后仍然可以进入，提示改为「验证成功」。
- 订单号不是访问码，不会写入 vault 的 `mental` 码。

## 已发出的访问码

- 格式：`MA` + 4 位字符，字符表 `ABCDEFGHJKMNPQRSTUVWXYZ23456789`（无 I/L/O/0/1）
- 示例形态：`MAXXXX`（此处不公布可售卖码）
- 每码最多使用 **3** 次（跨设备共享计数，由 vault 扣次）
- 核销仍是原来的 vault `POST /redeem`（quiz `mental`）。本测验没有 Mantle 集合，vault 没有这枚码时不会改去 Mantle
- **重新测试**：清除会话解锁后需再次输入码并 redeem，会再扣 1 次
- **查看上次结果**：只读本机 `localStorage`，不扣次
- 本仓库**不**存放可卖验证码明文

造码（本机 companion，勿把码写进 git）：

```bash
/workspace/quiz-code-api/scripts/mint.sh mental <CODE> 3
```

或见 `tools/mint.sh` 说明。
