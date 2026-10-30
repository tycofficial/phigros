# 独立研究分支文件清单

以下文件可放入独立 `replay-research` 分支，无 npm 依赖，不接主站：

```text
README.md
PORTABLE.md
EVIDENCE.md
RETRIBUTION-EVIDENCE.md
package.json
luminescence.mjs
retribution-hp.mjs
run-trace.mjs
tests/luminescence.test.mjs
tests/retribution-hp.test.mjs
traces/success.json
traces/stage1-failure.json
traces/stage2-failure.json
```

运行 `npm test` 和 `npm run demo`。历史修改版控制研究只证明文档明确列出的范围，不代表当前 4.x 官方重演已实现。代码输出的演出/协程请求不是真实保存或主线解锁。

`evidence/`、`tools/` 和绝对 `/workspace/` 路径指本地研究证据，不在上述可移植文件内。不要把 so、APK、metadata、jar、.NET 或资源 bundle 上传到研究分支。可重取来源、范围请求、恢复工具版本与输入哈希见 EVIDENCE.md。

本地反汇编包括直接字节和本轮恢复的方法符号；核对用 SHA-256：

```text
216a93e5b412dcf071c5cb4093603caf7ad9890aa0d427e37cbf294ba6d42a7d  evidence/luminescence-arm64.asm
9f0114ec53fd05748d935daccdae8d7aae5547df9913b2e1a78e9b0cd0ef985a  evidence/retribution-arm64.asm
```
