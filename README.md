# DSH WebTokens — Desktop 0.2.2-rc.1 适配版

将已登录的 Chrome DeepSeek 网页接入 DeepSeek Harness Desktop 的“DeepSeek 网页”模型。

本分支版本 `0.2.16-desktop.1`，仅面向 Desktop `0.2.2-rc.1`。Chrome 扩展协议保持 `0.2.19`。

请先阅读 [完整安装、分析、验证和回滚说明](DESKTOP.md)。

安装：退出 Desktop，在解压目录运行：

```bash
node scripts/install-desktop.mjs /usr/local/bin/dsh
```

安装器需要 Node.js >=24.9.0，并使用 Desktop 自带命令安装交付的 tgz。它会备份完整 profile，失败时尝试回滚。然后在 Chrome 加载打印出的 `web-bridge/chrome` 目录，再启动 Desktop。

适配已通过官方 0.2.2-rc.1 核心包的运行时测试，并已在真实 macOS Desktop 0.2.2-rc.1 + Chrome 上完成 DESKTOP.md 第 7 步验收（macOS 27.2、Chrome 156.0.8078.81）：简单消息发送与回复正常，测试项目中读取文件、写入文件、检查副本全部通过。仅验证 macOS Desktop 0.2.2-rc.1。不要恢复之前导致崩溃的旧 profile。

目录页生成的 `dsh plugin --profile web add <tgz>` 安装命令不受支持：安装需要先备份完整 profile、移除旧桥接包并生成配对文件，单条 `plugin add` 命令做不到，只能用 `node scripts/install-desktop.mjs`。不要用原 Web 安装命令替换本流程。

项目和工具结果会发送到 DeepSeek 网页；配对 token、profile 备份和日志属于本机文件，不要上传公开仓库。
