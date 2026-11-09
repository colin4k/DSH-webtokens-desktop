# Desktop 0.2.2-rc.1 适配说明

适配版：`dsh-web-bridge 0.2.16-desktop.1`。Chrome 扩展协议版本仍为 `0.2.19`。

## 安装（macOS）

1. 保持已经恢复正常的 Desktop profile，不要恢复之前导致启动失败的 profile。
2. 通过 ⌘Q 完全退出 DeepSeek Harness。确认桌面应用菜单“管理 dsh 命令”已经安装其命令。
3. 解压交付的 ZIP，在解压后的 `DSH-webtokens` 目录打开终端。需要 Node.js >=24.9.0。
4. 执行：

```bash
node scripts/install-desktop.mjs /usr/local/bin/dsh
```

脚本先确认 DSH 版本，再备份完整 Desktop profile，移除已安装的旧桥接包，通过 Desktop 自带的 CLI 安装 `dist` 中的 tgz，并生成配对文件。安装失败会尝试恢复安装前的 profile，同时保留失败现场。

默认 Chrome 目录：`/Users/colin/.dsh/profiles/desktop/web-bridge/chrome`。以脚本实际打印的目录为准；脚本通过 Desktop 命令获取路径，支持自定义 `DSH_HOME`。

5. Chrome 打开 `chrome://extensions`，移除旧桥接扩展，加载上述目录。
6. 在 Chrome 登录 `https://chat.deepseek.com/`，重新打开 Desktop，模型菜单选择“DeepSeek 网页”。
7. 先发简单消息，再在一个测试项目中测试读取文件、写入文件、检查副本。真实网页、Electron 壳和用户本机环境仍需做这一轮验收。

普通更新仍需退出 Desktop，运行安装脚本，再重新加载 Chrome 扩展。不要用 npm 安装的 `dsh` 管理 Desktop。

## 连接诊断

Desktop 正在运行时，不要通过 `dsh plugin ... exec` 执行 doctor，因为该入口会获取 profile 包管理锁。可以从解压的源码目录直接运行独立诊断命令：

```bash
node bin/dsh-web-bridge.mjs doctor --profile-dir "$HOME/.dsh/profiles/desktop"
```

正常应有 `server: true`、`paired: true`、`connected: true`。自定义 `DSH_HOME` 时换成实际 profile 目录。doctor 不打印密钥。

## 回滚

完全退出 Desktop，执行安装脚本输出的回滚命令，例如：

```bash
node scripts/rollback-desktop.mjs "/Users/colin/.dsh/profiles/desktop.before-web-bridge-实际时间戳"
```

回滚保存当前 profile 再恢复完整备份，不删除项目文件。Chrome 桥接扩展应同时停用。备份包含本机配对密钥和配置，不要公开上传。

## 代码分析与改动

| 问题 | 分析与修改 |
|---|---|
| 旧核心依赖污染 profile | 原包普通依赖 `dsh-llm 0.1.5-rc.2`、Schemastery 3.18.2；其传递依赖可能优先于 Desktop 运行时解析。改为 peerDependencies，只从 Desktop 复用核心；开发测试才安装 0.2.2-rc.1 核心包。生产 tgz 普通依赖仅 AJV。 |
| 缺少版本边界 | 根包和嵌套清单声明 `engines.dsh: 0.2.2-rc.1`，其他 DSH 版本会被兼容性检查拒绝，不要求用户绕过检查。 |
| 安装时还没有 token | 原 bundle 从环境变量读取 token，未配对就尝试启动。改为从 `profileContext.dir/web-bridge/token` 读取；未配对只记录提示，不注册不可用模型，不阻断设置读取。 |
| 配置变更过多 | 新 setup 只准备配对和扩展文件；不再追加 token/config 到 `cordis.patch.yml`。若有旧 setup 标记块，先备份原文件，再仅移除该块；其他 patch 不变。 |
| CLI 返回 0 但未执行 | 入口比较 argv 和模块路径的原始字符串，会受符号链接影响。改为比较 realpath，增加 symlink 回归测试。 |
| 3081 冲突 | 启动 broker 失败时记录错误并停止该桥接，不注册失效适配器；设置服务仍可调用。 |
| Chrome 配对文件缺失 | 捕获配置 fetch/JSON/格式错误，在扩展状态中给出 setup 指引，避免顶层未处理 Promise rejection。 |
| UI 是否改成 desktop 平台 | 不改。Desktop 本身加载共享 Web 客户端；原 client 的 `platform: web`、ModuleLoader 和认证的同源路由适用于该设计。不是把字符串改成 desktop 就能完成适配。 |

原崩溃报告没有 RPC 业务错误正文，因此这些改动解决已确认的结构性兼容风险，不能证明用户那一次崩溃只有某一个原因。

## 验证范围

已在 Node 24 / Linux 下用官方发布的 `0.2.2-rc.1` 包验证：

- 真实 Loader、profile 配置合成、ConfigEditor、Settings、SettingsController、LlmRuntime 一起启动。
- 未配对时设置读取仍正常；已配对能发现模型、执行新版 `prepareCall` 和标题流。
- 通过模拟 Chrome worker 的认证 HTTP 请求完成工具调用和最终回复回传。
- 端口冲突不影响设置读取；setup 符号链接入口、旧配置迁移和幂等性。
- 原有协议、正文保真、工具参数校验、取消、上下文续接、面板回归。

没有运行 macOS Electron 应用、真实 DeepSeek 登录或真实网页 DOM 端到端验收；不宣称已在用户 Mac 上实测成功。安装脚本保留备份和回滚。

## 源码依据

插件基线：`colin4k/DSH-webtokens`，提交 `261eba8bb66d524835c1700838cdb22d107cafd3`。

Harness：官方 tag `dsh-v0.2.2-rc.1`，提交 `66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`。

- [Desktop 的安装归属与 CLI](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.1/apps/desktop/README.zh.md)
- [profile 包解析与初始化](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.1/packages/boot/app-boot/src/profile.ts)
- [Desktop welcome settings RPC](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.1/apps/desktop/src/welcome-backend.ts)
- [新版 LlmAdapter / LlmRuntime](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.1/packages/llm/llm/src/index.ts)

## 开发与打包

```bash
npm ci --ignore-scripts
npm test
npm run verify:source
mkdir -p dist
npm pack --pack-destination dist
```

补丁基于上述插件提交。先在干净 checkout 执行 `git apply --check DSH-webtokens-Desktop-0.2.2-rc.1.patch`，再应用；不要在已修改的目录盲目覆盖。开发用 npm lock 和 pnpm lock 均随适配源码提供。生产用户直接使用交付的 tgz，无需安装开发依赖。
