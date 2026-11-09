# Desktop 适配验证记录

目标：官方 `dsh-v0.2.2-rc.1` / Node 24。适配版本 `0.2.16-desktop.1`。

`npm test` 覆盖原有协议和网页脚本回归，以及新增的真实运行时启动、设置读取、LLM prepareCall、认证 worker 工具调用/最终文本回传、端口冲突、setup 符号链接、旧配置迁移和安装失败回滚。

生产包验证：使用 pnpm 11.28.5，在 `nodeLinker: hoisted`、`autoInstallPeers: false` 的隔离 profile 中安装 tgz。实际仅安装桥接和 AJV 依赖，不安装任何 Harness 核心包。再通过官方 createRuntimeResolution / PluginPackages 的真实解析机制启动生产包，验证设置读取和模型发现。

开发验证生产包：先在临时 profile 中用上述 pnpm 设置安装 dist 下的 tgz，再在源码目录运行：

```bash
node scripts/verify-packed-runtime.mjs /临时/profile/绝对路径
```

该命令仅针对测试 profile，会写入测试 bundle，绝不能指向用户 Desktop profile。

`npm run verify:source` 检查 SOURCE.json 的未修改基线文件，以及 ADAPTATION.json 中明确列出的改动文件。

限制：没有执行 macOS Electron 主窗口、真实 Chrome/DeepSeek 登录和真实网页端到端测试。仍需按 DESKTOP.md 在用户 Mac 上验收。模拟 worker 证明的是运行时与传输协议互通，不代表真实网页永远保持相同 DOM。
