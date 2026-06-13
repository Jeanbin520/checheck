# 公益站签到助手

[简体中文](README.md) | [English](README.en.md)

一个 Chrome Manifest V3 扩展，用于管理少量支持的公益站点，并在侧边栏中执行每日一键签到。

本扩展主要面向基于 `new-api` 的公益站点，以及使用 LinuxDO OAuth 登录的站点。它提供预设站点、一键签到、运行日志和基于适配器的站点自动化流程。

## 功能特性

- 基于 Chrome MV3 的浏览器扩展。
- 使用侧边栏作为主要操作界面。
- 支持对已保存站点执行一键签到。
- 内置预设站点，也可以添加检测到的站点。
- 使用站点专属适配器提升自动化稳定性。
- 提供 `new-api` 通用 fallback 适配器。
- 支持部分站点的 LinuxDO OAuth 登录流程。
- 运行日志保存在本地，便于排查签到过程。
- 可配置签到成功后的标签页延迟关闭时间。

## 当前支持站点

预设站点包括：

- AnyRouter：`https://anyrouter.top/`
- 木鸢公益：`https://muyuan.do/`
- 烁：`https://elysiver.h-e.top/`
- CHY 公益站：`https://chybenzun.top/`

当前适配器包括：

- `anyrouter`：AnyRouter 的 LinuxDO OAuth 登录与签到流程。
- `muyuan`：登录、公告关闭、协议勾选、LinuxDO 授权、设置页导航和签到流程。
- `elysiver`：个人/设置页面流程，支持 LinuxDO OAuth 和精确匹配“立即签到”按钮。
- `chybenzun`：基于资料页和接口的签到流程，支持登录状态、已签到状态和 Turnstile 要求检测。
- `new-api-default`：通用 fallback 适配器，用于查找常见签到按钮或链接。

## 项目结构

```text
.
|-- adapters/              # 站点专属和通用 fallback 签到适配器
|-- background/            # MV3 service worker 与签到执行引擎
|-- content/               # 页面检测 content script
|-- icons/                 # 扩展图标
|-- lib/                   # 存储封装和预设站点定义
|-- popup/                 # 侧边栏 HTML、CSS 和 JavaScript
`-- manifest.json          # Chrome 扩展清单
```

## 安装方式

本项目目前没有构建步骤、包管理配置或自动化测试工具。

本地运行方式：

1. 在 Chrome 中打开 `chrome://extensions/`。
2. 开启 **开发者模式**。
3. 点击 **加载已解压的扩展程序**。
4. 选择本项目目录。
5. 打开扩展侧边栏。
6. 添加预设站点并执行签到。

## 开发说明

本扩展使用原生 JavaScript、HTML 和 CSS 编写，直接调用 Chrome 扩展 API，包括 `chrome.storage`、`chrome.tabs`、`chrome.scripting` 和 side panel API。

适配器在 `adapters/registry.js` 中注册。若要支持新的站点，请在 `adapters/` 下新增适配器，实现站点匹配和签到逻辑。如果该适配器需要优先于通用 fallback，请在注册顺序中放在 `new-api-default` 之前。

对于依赖自动化的站点，应优先使用 DOM、URL 和接口状态判断，而不是依赖静态 HTML。许多目标站点是客户端渲染应用，页面结构和按钮文案可能会变化。

## 隐私说明

站点配置、签到状态和运行日志都通过 Chrome storage 保存在本地。项目不包含后端服务。

## 项目状态

这是一个用于每日公益站签到的个人工具项目。由于目标站点和 OAuth 页面可能发生变化，涉及自动化流程的适配器在更新后建议进行手动验证。
