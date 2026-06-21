# 简词项目开发环境与命令审计

本文记录截至 **2026-06-21（Asia/Shanghai）**，开发 `/Users/areson/workplace/electronic-dictionary` 期间执行的主要命令、安装的依赖、使用的环境变量，以及对项目目录、用户环境和系统环境造成的可观测变化。第 15 节起记录初版审计完成后的后续开发操作。

> 说明：本记录综合了本次开发会话与当前文件系统状态。对于 npm、Rustup、Cargo、Quick Look 等工具内部维护的缓存，无法可靠区分开发前已经存在的内容和本次新增内容，因此相关容量会标注为“当前总量”，不将其全部归因于本项目。

## 1. 结论概览

### 只在当前项目目录生效

- 创建了 Tauri 2 + React + TypeScript + Rust + SQLite 项目源码和配置。
- `npm install` 在项目内创建 `node_modules/` 和 `package-lock.json`。
- 前端构建创建 `dist/`。
- Cargo 创建 `src-tauri/Cargo.lock` 和 `src-tauri/target/`。
- 当前项目构建缓存约占：
  - `node_modules/`：87 MB
  - `dist/`：240 KB
  - `src-tauri/target/`：2.5 GB
  - `src-tauri/resources/`：11 MB

### 用户级全局修改

- 安装 Rustup 和 Rust stable 工具链到：
  - `/Users/areson/.cargo`
  - `/Users/areson/.rustup`
- Rustup 在以下 shell 启动文件中加入 Cargo 环境加载：
  - `/Users/areson/.zshenv`
  - `/Users/areson/.profile`
- PATH 会在新终端启动时加入 `$HOME/.cargo/bin`。
- macOS 应用数据目录已生成：
  - `/Users/areson/Library/Application Support/com.plaindictionary.app`
- npm、Cargo/Rustup 使用了用户级缓存目录，但未安装任何全局 npm 包，也未写入全局 Cargo 镜像配置。

### 仅单次命令生效

- Rustup 和 Cargo 曾临时通过 `rsproxy.cn` 下载组件/依赖。
- `RUSTUP_DIST_SERVER`、`RUSTUP_UPDATE_ROOT`、`CARGO_HOME`、`CARGO_REGISTRIES_*` 均只写在具体命令前，没有通过 `export` 持久化。
- 临时 Cargo 镜像配置保存在 `/tmp/plain-dictionary-cargo/config.toml`，不会在重启后可靠保留。

### 未做的全局修改

- 没有使用 Homebrew 安装或升级软件。
- 没有安装全局 npm 包（没有执行 `npm install -g`）。
- 没有修改 `/Users/areson/.cargo/config.toml` 或 `/Users/areson/.cargo/config`。
- 没有修改系统 WebView、Xcode 或 Xcode Command Line Tools。
- 没有安装 Electron；项目使用 Tauri 2。
- 没有设置永久代理、永久 Rust 镜像或永久 Cargo 镜像。

## 2. 开发前已有环境

以下工具在项目开始时已经存在，本次开发未负责安装：

| 工具 | 当前/观测版本 | 说明 |
| --- | --- | --- |
| macOS | 26.5.1 arm64 | 当前主机系统 |
| Node.js | 25.9.0 | 开始开发时已经可用 |
| npm | 11.12.1 | 开始开发时已经可用 |
| Xcode | 26.5 | Tauri 环境检查时已经安装 |
| Xcode Command Line Tools | 已安装 | 路径为 `/Applications/Xcode.app/Contents/Developer` |

项目开始时执行 `rustc --version` 返回 `command not found`，因此 Rust 工具链是本次开发新增的用户级环境。

## 3. 项目内安装的 npm 依赖

执行：

```bash
npm install
```

该命令读取当前目录的 `package.json`，在当前项目生成：

- `node_modules/`
- `package-lock.json`

没有使用 `-g`，因此这些包不是全局安装。

### 运行依赖

| 包 | 当前解析版本 | 用途 |
| --- | --- | --- |
| `@tauri-apps/api` | 2.11.1 | React 前端调用 Tauri command 和事件 API |
| `react` | 19.2.7 | UI 组件与状态管理 |
| `react-dom` | 19.2.7 | 将 React 应用挂载到 WebView DOM |

### 开发依赖

| 包 | 当前解析版本 | 用途 |
| --- | --- | --- |
| `@tauri-apps/cli` | 2.11.3 | `tauri dev`、`tauri build`、环境检查 |
| `@types/react` | 19.2.17 | React TypeScript 类型 |
| `@types/react-dom` | 19.2.3 | React DOM TypeScript 类型 |
| `@vitejs/plugin-react` | 4.7.0 | Vite React 转换插件 |
| `node-html-parser` | 8.0.1 | 结构化解析 FreeDict StarDict HTML 词条 |
| `typescript` | 5.8.3 | 静态类型检查 |
| `vite` | 6.4.3 | 前端开发服务器和生产构建 |

### npm 用户级缓存

- 当前 `/Users/areson/.npm` 总容量约为 802 MB。
- `npm install` 通常会向该目录写入下载缓存和日志。
- 该目录在开发前可能已有其他项目缓存，因此不能认定 801 MB 全部由本项目产生。
- npm 全局前缀为 `/opt/homebrew`，本次没有向该前缀安装包。

## 4. 项目内 Rust 依赖

Rust 直接依赖声明在 `src-tauri/Cargo.toml`：

| crate | 声明版本 | 用途 |
| --- | --- | --- |
| `tauri` | 2 | 桌面运行时、窗口和 command |
| `serde` | 1 | Rust 结构体序列化，启用 `derive` |
| `serde_json` | 1 | JSON 数据支持 |
| `rusqlite` | 0.32 | SQLite 访问，启用 `bundled` |
| `sha2` | 0.10 | 为正式词库确定性 ID 预留 SHA-256 |
| `hex` | 0.4 | 哈希值十六进制编码 |
| `tauri-build` | 2 | Tauri 构建脚本依赖 |

Cargo 共解析并锁定约 428 个直接与间接依赖，具体精确版本记录在：

```text
src-tauri/Cargo.lock
```

编译产物和增量缓存位于：

```text
src-tauri/target/
```

当前约占 2.5 GB，是项目目录中最大的可再生成内容。

## 5. Rustup 与 Rust 工具链安装

### 下载 Rustup 安装脚本

执行：

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs -o /tmp/rustup-init.sh
```

影响：

- 下载 `/tmp/rustup-init.sh`，当前大小约 29 KB。
- 这是临时文件，不在项目目录内。
- `/tmp` 内容可被系统自动清理。

### 安装 minimal Rust toolchain

执行过：

```bash
sh /tmp/rustup-init.sh -y --profile minimal
```

由于网络与组件落盘问题，该命令经历过失败和重试。一次失败信息为 Cargo 组件下载后的 `.partial` 文件重命名失败，Rustup随后进行了回滚。后续重试成功安装了 Rustup、Rust 编译器与标准库，但 Cargo 组件一度处于“被标记为已安装、实际不可执行”的不一致状态。

### 修复 Cargo 和 Rustfmt

尝试过官方源：

```bash
$HOME/.cargo/bin/rustup component remove cargo
$HOME/.cargo/bin/rustup component add cargo rustfmt
```

官方源下载长时间停滞，随后中止。之后使用一次性镜像变量成功安装：

```bash
RUSTUP_DIST_SERVER=https://rsproxy.cn \
RUSTUP_UPDATE_ROOT=https://rsproxy.cn/rustup \
$HOME/.cargo/bin/rustup component add cargo rustfmt
```

当前 Rust 状态：

```text
toolchain: stable-aarch64-apple-darwin
rustc:     1.96.0 (ac68faa20 2026-05-25)
cargo:     1.96.0 (30a34c682 2026-05-25)
target:    aarch64-apple-darwin
profile:   minimal
```

当前已安装组件：

- `cargo-aarch64-apple-darwin`
- `rust-std-aarch64-apple-darwin`
- `rustc-aarch64-apple-darwin`
- `rustfmt-aarch64-apple-darwin`

### Rustup 创建的用户级目录

| 路径 | 当前总量 | 内容 |
| --- | ---: | --- |
| `/Users/areson/.cargo` | 约 203 MB | Rustup 代理、Cargo 环境脚本、部分 registry/cache |
| `/Users/areson/.rustup` | 约 547 MB | stable 工具链、标准库和组件 |

这些是用户级全局环境，对该用户的所有 Rust 项目生效，不局限于当前目录。

## 6. Shell 和 PATH 的永久变化

Rustup 安装器创建了：

```text
/Users/areson/.cargo/env
```

该脚本会在 PATH 尚未包含 Cargo 时执行：

```bash
export PATH="$HOME/.cargo/bin:$PATH"
```

Rustup 同时在以下文件中加入：

```bash
. "$HOME/.cargo/env"
```

实际文件位置：

- `/Users/areson/.zshenv`
- `/Users/areson/.profile`

这属于持久化的用户级全局修改。打开新的 zsh 或兼容 `.profile` 的 shell 后，`rustc`、`cargo`、`rustup` 会自动进入 PATH。

没有在项目 `.env`、`.env.local` 或 shell 配置中写入其他永久环境变量。

## 7. Cargo 下载源与环境变量

### 尝试过但未持久化的环境变量

曾执行：

```bash
CARGO_REGISTRIES_CRATES_IO_INDEX="sparse+https://rsproxy.cn/index/" \
CARGO_REGISTRIES_CRATES_IO_PROTOCOL=sparse \
cargo test --manifest-path src-tauri/Cargo.toml
```

该方式在当前 Cargo 行为下没有有效替换 crates.io，命令被中止。这两个变量只对该命令进程生效。

### 最终使用的临时 Cargo 配置

创建了：

```text
/tmp/plain-dictionary-cargo/config.toml
```

内容：

```toml
[source.crates-io]
replace-with = "rsproxy-sparse"

[source.rsproxy-sparse]
registry = "sparse+https://rsproxy.cn/index/"

[net]
git-fetch-with-cli = true
```

测试与检查时使用：

```bash
CARGO_HOME=/tmp/plain-dictionary-cargo \
cargo test --manifest-path src-tauri/Cargo.toml

CARGO_HOME=/tmp/plain-dictionary-cargo \
cargo check --manifest-path src-tauri/Cargo.toml
```

影响：

- `CARGO_HOME` 只对对应命令有效，没有永久导出。
- 依赖索引和 crate 源码缓存写入 `/tmp/plain-dictionary-cargo`。
- 当前临时 Cargo 目录约占 192 MB。
- `/Users/areson/.cargo/config` 和 `/Users/areson/.cargo/config.toml` 均不存在，说明没有设置用户级永久 Cargo 镜像。

## 8. 执行过的项目命令

### 环境和项目检查

```bash
node --version
npm --version
rustc --version
cargo --version
npm ls --depth=0
npm run tauri info
```

最初 `rustc`、`cargo` 不可用；安装修复后 Tauri 环境检查能够识别 Rust stable、Xcode、Node 和 npm。

### 前端依赖安装

```bash
npm install
```

第一次在受限网络环境下没有完成，授权网络访问后成功，输出为安装 71 个 npm package。这里的“71”包含直接与间接包，`npm ls --depth=0` 只显示顶层依赖。

### 前端开发和构建

执行/讨论过：

```bash
npm run dev
npm run build
```

- `npm run dev` 只启动 Vite，监听 `http://localhost:1420/`，不创建桌面窗口。
- `npm run build` 执行 `tsc && vite build`，生成 `dist/`。
- `npm run build` 在开发过程中多次执行，最终均通过。

### Tauri 桌面开发

执行过：

```bash
npm run tauri dev
```

该命令内部执行：

1. `npm run dev` 启动 Vite。
2. `cargo run --no-default-features --color always --` 编译并启动桌面后端。
3. Tauri 监听 `src-tauri` 文件变化。

首次启动会更新 Cargo 索引、下载 Rust 间接依赖并编译。终端出现 `Fetch N complete; M pending` 是动态依赖解析/下载进度，pending 数量可能暂时增长。

### Rust 格式化、测试和编译检查

执行过：

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
```

期间处理了以下实际编译问题：

- Tauri 缺少 `src-tauri/icons/icon.png`。
- `get_entry` 中的 `MutexGuard<Connection>` 借用方式不符合编译器要求。

最终结果：

- Rust 单元测试：2 个通过，0 个失败。
- `cargo check`：通过。
- `npm run build`：通过。

### 图标生成

先尝试：

```bash
sips -s format png src-tauri/icons/icon.svg --out src-tauri/icons/icon.png
```

`sips` 无法从 SVG 提取图像，命令失败。之后执行：

```bash
qlmanage -t -s 512 -o /tmp src-tauri/icons/icon.svg
cp /tmp/icon.svg.png src-tauri/icons/icon.png
```

结果：

- 项目内生成 `src-tauri/icons/icon.png`，512×512、RGBA PNG。
- `/tmp/icon.svg.png` 仍可能存在，属于临时文件。
- Quick Look 可能维护自己的系统缓存，但 macOS 没有提供可可靠归因到本次命令的清单。

## 9. 当前项目目录中的新增或生成内容

### 源码与配置

- `package.json`
- `package-lock.json`
- `tsconfig.json`
- `vite.config.ts`
- `index.html`
- `.gitignore`
- `README.md`
- `src/` 下 React/TypeScript/CSS 文件
- `src-tauri/` 下 Rust、Tauri、SQLite seed、capability 和图标文件

### 可再生成目录

| 路径 | 当前容量 | 是否可删除后重建 | 重建命令 |
| --- | ---: | --- | --- |
| `node_modules/` | 约 87 MB | 是 | `npm install` |
| `dist/` | 约 240 KB | 是 | `npm run build` |
| `src-tauri/target/` | 约 2.5 GB | 是 | `cargo check`、`cargo test` 或 `npm run tauri dev` |

### 锁文件

- `package-lock.json`：约 73 KB，应保留并提交，用于固定 npm 依赖版本。
- `src-tauri/Cargo.lock`：约 107 KB，桌面应用项目应保留并提交，用于固定 Rust 依赖版本。

## 10. 项目目录之外的应用数据

应用至少成功启动过一次，Tauri/Rust 初始化逻辑创建了：

```text
/Users/areson/Library/Application Support/com.plaindictionary.app/
├── dictionary.sqlite
├── user.sqlite
├── user.sqlite-shm
└── user.sqlite-wal
```

当前目录在完整词库升级后约为 12 MB，具体大小会随查询历史、收藏和 SQLite WAL 文件变化。

作用：

- `dictionary.sqlite`：当前 FreeDict 完整离线词库，应用运行时只读。
- `user.sqlite`：查询历史、统计、收藏夹和置顶设置。
- `user.sqlite-shm`、`user.sqlite-wal`：SQLite WAL 模式运行文件。

这是用户级、应用专属的持久化数据，不在项目目录内。删除或重新克隆项目不会自动删除这里的数据；重新安装/启动相同 identifier 的应用仍会使用它。

## 11. 网络访问和授权执行

开发过程中访问过或尝试访问：

- npm registry：下载 JavaScript/TypeScript 依赖。
- `https://sh.rustup.rs`：下载 Rustup 安装脚本。
- Rust 官方分发源：下载 Rust stable 组件，部分请求停滞或失败。
- `https://rsproxy.cn`：成功下载 Rustup 组件和 Cargo crate。
- crates.io index：Cargo 官方索引，当前网络下出现 DNS 或连接停滞。

由于工作区采用受限网络/文件权限，以下类型命令经过了提升权限授权：

- npm 网络安装。
- Rustup 脚本下载与执行。
- Rustup 组件下载。
- Cargo crate 下载。
- macOS Quick Look 图标渲染。

这些授权允许对应命令越过工作区沙箱运行，但没有创建常驻后台服务或修改系统安全策略。

## 12. 没有发生的环境变化

为避免误解，以下操作没有执行：

- 没有执行 `brew install`、`brew upgrade` 或修改 Homebrew 配置。
- 没有执行 `npm install -g`。
- 没有修改 Node.js 或 npm 版本。
- 没有安装 Electron 或 Chromium。
- 没有修改 Xcode、Command Line Tools 或 macOS SDK。
- 没有修改 DNS、HTTP 代理、HTTPS 代理或系统网络设置。
- 没有永久设置 rsproxy。
- 没有创建 LaunchAgent、LaunchDaemon、登录启动项或系统服务。
- 没有修改 `/etc`、`/usr/local`、`/opt/homebrew` 中的文件。
- 没有创建 Python 虚拟环境或安装 Python 包。
- 没有运行数据库服务；SQLite 是进程内、文件型数据库。
- 当前目录不是 Git 仓库，因此没有创建提交、分支或 Git 配置。

## 13. 可选清理与回滚

以下命令具有删除作用，**仅在确认不再需要对应内容时执行**。

### 只清理当前项目的可再生成文件

```bash
rm -rf node_modules dist src-tauri/target
```

不会删除源码、锁文件或应用历史数据。以后可以通过 `npm install` 和构建命令重建。

### 清理本次使用的临时文件

```bash
rm -rf /tmp/plain-dictionary-cargo
rm -f /tmp/rustup-init.sh /tmp/icon.svg.png
```

`/tmp` 也可能由 macOS 自动清理。

### 删除应用产生的全部本地数据

```bash
rm -rf "$HOME/Library/Application Support/com.plaindictionary.app"
```

这会永久删除查询历史、统计、收藏夹、置顶设置和已安装词库；下次启动会重新创建用户数据库，并从应用资源恢复完整词库（资源缺失时才回退到种子词库）。

### 卸载本次安装的 Rust 工具链

Rustup 自卸载命令：

```bash
rustup self uninstall
```

该操作会删除 Rustup 管理的工具链和 Cargo/Rustup 文件。卸载后还应检查并按需移除以下文件中的 Cargo 环境加载行：

```text
/Users/areson/.zshenv
/Users/areson/.profile
```

应删除的行是：

```bash
. "$HOME/.cargo/env"
```

不要直接覆盖整个 shell 配置文件；只移除由 Rustup 添加的对应行。

## 14. 当前可复现验证命令

在当前项目目录运行：

```bash
npm install
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
npm run tauri dev
```

如果当前网络无法访问 crates.io，可临时使用单次命令变量或 `/tmp` 配置；不建议在项目 README 中强制所有开发者使用特定镜像。

## 15. 2026-06-21 后续开发概览

初版审计文档生成后，项目继续完成了两类工作：

1. 多轮主窗口、标题栏、统计页、收藏与滚动布局调整。
2. 将 6 条开发种子词库替换为 FreeDict 完整英中词库，并加入可复现构建和自动迁移逻辑。

这些操作没有新增 Homebrew 软件、全局 npm 包、系统服务或永久代理。新增影响主要位于项目目录、npm 用户缓存、`/tmp` 临时目录和应用自己的 `Application Support` 目录。

## 16. 后续 UI 与窗口架构修改

### 主窗口精简

主窗口经过多轮调整，当前状态为：

- 主界面只保留标题栏、查询输入框和释义区域。
- 最近查询从主窗口迁移到管理窗口的统计页。
- 主窗口初始宽度为 307 逻辑像素，最小宽度为 280。
- 主窗口初始和最小高度均为 188 逻辑像素。
- 释义区最小高度为 90px，并使用弹性布局；向下拉伸主窗口时释义区会增长。
- 主窗口整体字体缩小，英文词头和 IPA 在同一行展示。
- 释义字体相对词头放大，释义区域独立纵向滚动并禁止横向滚动。
- 收藏按钮改为五角星；词条存在于任意收藏夹时星标点亮。

### Overlay 标题栏

主窗口曾短暂切换回 macOS 标准原生标题栏，以匹配统计窗口标题样式。由于原生标题栏无法直接容纳 React 的统计和置顶按钮，最终恢复为 Tauri Overlay 标题栏：

- `titleBarStyle`：`Overlay`
- `hiddenTitle`：`true`
- 自绘标题文字：`简词`
- 标题栏右侧保留统计和置顶图标按钮。
- 使用 `getCurrentWindow().startDragging()` 实现标题栏空白区域拖动。
- capability 中重新加入 `core:window:allow-start-dragging`。
- macOS 红黄绿按钮 inset 当前为 `(20, 20)`，上边距与左边距配置值相等。

当前主窗口配置摘要：

```json
{
  "width": 307,
  "height": 188,
  "minWidth": 280,
  "minHeight": 188,
  "titleBarStyle": "Overlay",
  "hiddenTitle": true,
  "trafficLightPosition": { "x": 20, "y": 20 }
}
```

### 管理窗口层级

统计/收藏管理窗口创建时使用主窗口作为 parent：

```rust
WebviewWindowBuilder::new(...)
    .parent(&main_window)?
```

效果：

- macOS 将管理窗口作为主窗口 child。
- Windows 将其视为 owner/owned window 关系。
- 管理窗口始终位于主窗口之上，但不会成为凌驾所有应用的系统全局置顶窗口。

### 最近查询和统计滚动

- 最近查询后端 SQL 改为按 `entry_id` 分组，只保留每个词条最新一次查询。
- 实际旧数据库验证：11 条查询事件、2 个唯一词条，去重后正确返回 2 条。
- 最近查询 UI 从单行横向列表改为自动换行网格，长词允许换行。
- 管理窗口固定为视口高度。
- 查询统计数据列表拥有独立纵向滚动区域。
- 最近查询、统计摘要和底部信息保持固定。
- 统计表头使用 `position: sticky` 吸附在滚动区域顶部。

## 17. 完整离线词库接入

### 原问题确认

应用最初安装的 `dictionary.sqlite` 只有：

```text
English: apple, abandon, book
Chinese: 苹果, 放弃, 书
```

数据库实际统计为 3 个英文词条和 3 个中文词条。因此查询不到其他单词不是搜索逻辑错误，而是开发种子数据规模限制。

### 选择的数据源

接入 FreeDict 发布的 English–Chinese StarDict：

```text
版本：2025.11.23
官方词头数：26,660
上游：Wiktionary / DBnary / WikDict / FreeDict
许可：CC BY-SA 3.0 Unported
```

官方归档地址：

```text
https://download.freedict.org/dictionaries/eng-zho/2025.11.23/freedict-eng-zho-2025.11.23.stardict.tar.xz
```

固定 SHA-512：

```text
059f9aca26fdc3a5a2c0c0e8fc92e111a34bf8fd438f70d267cccf35f5e47a2d45c46650999a1b3a48c3bffc3e16e0db897232128fe822d1bc59cf34f40b395c
```

### 下载和校验命令

执行：

```bash
curl -L --fail --retry 3 \
  https://download.freedict.org/dictionaries/eng-zho/2025.11.23/freedict-eng-zho-2025.11.23.stardict.tar.xz \
  -o /tmp/freedict-eng-zho.tar.xz

curl -L --fail --retry 3 \
  https://download.freedict.org/dictionaries/eng-zho/2025.11.23/freedict-eng-zho-2025.11.23.stardict.tar.xz.sha512 \
  -o /tmp/freedict-eng-zho.tar.xz.sha512

shasum -a 512 /tmp/freedict-eng-zho.tar.xz
cat /tmp/freedict-eng-zho.tar.xz.sha512
```

校验成功，本地计算值与官方 SHA-512 完全一致。

### 解压和字段检查

执行过：

```bash
rm -rf /tmp/freedict-eng-zho
mkdir -p /tmp/freedict-eng-zho
tar -xJf /tmp/freedict-eng-zho.tar.xz -C /tmp/freedict-eng-zho
```

解压内容包括：

- `eng-zho.ifo`
- `eng-zho.idx.gz`
- `eng-zho.dict`
- `COPYING`
- `INSTALL`
- `README`

StarDict `.ifo` 声明 `sametypesequence=h`，词条主体为 HTML。抽样检查确认包含：

- IPA，例如 `computer` → `/kəmˈpjutɚ/`
- 英文词性，例如 `noun`、`verb`、`interjection`
- 中文翻译，例如 `computer` → `电脑`、`计算机`、`電腦`

### 新增本地开发依赖

执行：

```bash
npm install --save-dev node-html-parser
```

当前安装版本：

```text
node-html-parser@8.0.1
```

用途：结构化解析 StarDict 中的 HTML 词条，避免使用正则表达式直接解析嵌套 HTML。

影响范围：

- 仅写入当前项目的 `package.json`、`package-lock.json` 和 `node_modules/`。
- npm 用户缓存可能增加。
- 没有全局安装。
- `node_modules/` 当前总量从约 84 MB 增长到约 87 MB。

### 新增词库构建脚本

新增：

```text
scripts/build-dictionary.mjs
```

新增 npm 命令：

```bash
npm run dictionary:build
```

脚本职责：

1. 下载固定版本 FreeDict StarDict 归档。
2. 验证固定 SHA-512。
3. 调用系统 `tar` 解压 `.tar.xz`。
4. 读取 gzip 压缩的 StarDict index。
5. 按大端序读取词条 offset 和 size。
6. 使用 `node-html-parser` 提取首个 IPA、英文词性和中文翻译。
7. 对英文词头小写标准化，按词性合并并去重释义。
8. 从中文翻译建立“中文词语 → 相关英文词”反向索引。
9. 使用 Node.js 内置 `node:sqlite` 生成 SQLite。
10. 写入来源、版本、构建时间和许可证元数据。
11. 将原始 `COPYING` 许可证复制到 Tauri 资源目录。

开发时也执行过显式源目录构建：

```bash
npm run dictionary:build -- --source /tmp/freedict-eng-zho/eng-zho
```

### 生成结果

生成：

```text
src-tauri/resources/dictionary.sqlite
src-tauri/resources/licenses/FreeDict-eng-zho-COPYING.txt
```

当前资源状态：

| 项目 | 当前值 |
| --- | ---: |
| SQLite 大小 | 约 11 MB |
| 英文词条 | 24,560 |
| 中文反向索引词条 | 17,766 |
| 许可证文件 | 约 22 KB |
| 词库版本 | `freedict-eng-zho-2025.11.23` |
| SQLite 完整性检查 | `ok` |

生成词条少于官方 26,660 词头，是因为构建脚本会排除没有可用中文翻译或无法形成有效词性/释义组的记录。

抽样结果：

| 查询 | IPA / 结果 | 中文释义或相关英文词 |
| --- | --- | --- |
| `computer` | `/kəmˈpjutɚ/`，名词 | 电脑、计算机、電腦 |
| `dictionary` | `/ˈdɪk.ʃə.nə.ɹi/`，名词 | 字典、词典 |
| `hello` | `/hæˈlaʊ/`，感叹词 | 你好、喂 |
| `world` | `/wɜɹld/`，名词 | 世界 |
| `电脑` | 中文反向索引 | calculator、computer |
| `词典` | 中文反向索引 | dictionary、lexicon、thesaurus |

### Tauri 资源打包

`src-tauri/tauri.conf.json` 新增：

```json
"resources": [
  "resources/dictionary.sqlite",
  "resources/licenses/FreeDict-eng-zho-COPYING.txt"
]
```

`.gitignore` 保留通用 `*.sqlite` 忽略规则，但增加：

```gitignore
!src-tauri/resources/dictionary.sqlite
```

因此用户运行时 SQLite 不会被误提交，而正式资源词库可进入版本控制和应用包。

### 启动时自动迁移

Rust 启动逻辑新增：

- 优先从 Tauri resource 目录定位 `resources/dictionary.sqlite`。
- 开发模式下回退到 `CARGO_MANIFEST_DIR/resources/dictionary.sqlite`。
- 比较应用数据目录词库与内置词库的 `dictionary_metadata.version`。
- 版本不同时先复制到 `.sqlite.new` 临时文件，再替换旧词库。
- 完整资源不存在时才使用 `dictionary_seed.sql` 作为开发回退。
- `user.sqlite` 完全不参与替换，查询历史、统计、收藏夹和置顶设置会保留。

当前安装目录已经完成升级：

```text
/Users/areson/Library/Application Support/com.plaindictionary.app/dictionary.sqlite
version: freedict-eng-zho-2025.11.23
English entries: 24,560
Chinese entries: 17,766
```

## 18. 后续执行的验证命令

UI 和词库开发过程中重复执行：

```bash
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
```

最终状态：

- TypeScript 检查通过。
- Vite 生产构建通过。
- `cargo check` 通过。
- Rust 测试从 2 个增加到 3 个，全部通过。
- 新测试要求内置英文词条数量大于 20,000，避免以后误打包开发种子库。
- SQLite `PRAGMA integrity_check` 返回 `ok`。

词库抽样和统计去重还使用过只读 SQLite 命令：

```bash
sqlite3 -readonly src-tauri/resources/dictionary.sqlite "..."
sqlite3 -readonly "$HOME/Library/Application Support/com.plaindictionary.app/user.sqlite" "..."
```

这些命令没有修改数据库。

## 19. 后续环境变量和全局环境影响

### 新增环境变量

本阶段没有新增永久环境变量，也没有修改：

- `~/.zshenv`
- `~/.profile`
- `~/.cargo/config.toml`
- 系统代理或 DNS

FreeDict 下载直接访问官方 HTTPS 地址，没有设置代理变量。

### 用户级缓存变化

- `npm install --save-dev node-html-parser` 可能增加 `/Users/areson/.npm` 缓存。
- Cargo 的重复构建增加 `src-tauri/target`，当前约 2.5 GB。
- 没有新增全局 npm package。
- 没有新增 Rust toolchain 或 Rustup component。

### 应用数据变化

应用数据目录中的 `dictionary.sqlite` 已从 6 条开发数据升级为约 11 MB 完整词库。这是用户级、应用专属的持久化变化，但不是系统级软件安装。

`user.sqlite` 继续保存历史、统计、收藏和设置，其 schema 没有因完整词库接入而改变。

## 20. 后续临时文件和清理

当前可观察到：

| 临时路径 | 当前大小 | 用途 |
| --- | ---: | --- |
| `/tmp/freedict-eng-zho.tar.xz` | 约 1.6 MB | 官方 StarDict 归档 |
| `/tmp/freedict-eng-zho.tar.xz.sha512` | 174 B | 官方校验文件 |
| `/tmp/freedict-eng-zho/` | 约 8 MB | 解压后的 StarDict 数据 |
| `/tmp/plain-dictionary-cargo/` | 约 192 MB | 早期 Cargo 镜像缓存 |

可选清理：

```bash
rm -rf /tmp/freedict-eng-zho
rm -f /tmp/freedict-eng-zho.tar.xz /tmp/freedict-eng-zho.tar.xz.sha512
rm -rf /tmp/plain-dictionary-cargo
```

项目自己的 `.cache/dictionaries/` 被加入 `.gitignore`。直接运行不带 `--source` 的 `npm run dictionary:build` 时，下载归档和解压内容会存放在那里，可随时删除并重新生成。

不要把 `src-tauri/resources/dictionary.sqlite` 当作普通构建缓存删除；它是当前应用打包所需的完整离线词库。若删除，可以通过以下命令重新生成：

```bash
npm run dictionary:build
```

## 21. 更新后的可复现流程

首次准备项目：

```bash
npm install
npm run dictionary:build
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
npm run tauri dev
```

普通 UI 开发不需要每次重建词库：

```bash
npm run tauri dev
```

词库版本或解析逻辑发生变化时才执行：

```bash
npm run dictionary:build
```

运行时若内置词库版本不同，应用会在下一次完整重启时自动升级应用数据目录中的词库。

## 22. 稳定性、测试与打包加固

### 当前目录内的依赖变化

本阶段通过项目级 `devDependencies` 增加了以下测试工具，变更只记录在 `package.json`、`package-lock.json` 和当前目录的 `node_modules/`：

- `vitest`
- `jsdom`
- `@testing-library/react`
- `@testing-library/jest-dom`

没有安装全局 npm package、Rust toolchain 或系统应用，也没有新增或永久修改环境变量。项目现声明 Node.js 最低版本为 22.5.0，因为词库脚本依赖内置的 `node:sqlite`。

### 应用数据兼容性

- Tauri bundle identifier 从 `com.plaindictionary.app` 修正为 `com.plaindictionary.desktop`。
- Rust 启动逻辑会把旧 identifier 的应用数据迁移到新目录；这是应用首次运行时的用户级文件迁移，不是系统级配置修改。
- `user.sqlite` 开始使用 `PRAGMA user_version` 管理 schema 迁移。
- `dictionary.sqlite` 更新改为“临时文件校验、旧文件备份、原子替换、失败恢复”，避免升级中断后丢失可用词库。

### 新增验证命令

```bash
npm test
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri build -- --debug --bundles dmg
```

项目新增 GitHub Actions 配置 `.github/workflows/ci.yml`，计划在 `macos-latest` 和 `windows-latest` 上验证测试及 Tauri 编译。该配置只影响仓库 CI，不改变本机环境。

本机已成功生成调试 DMG：

```text
src-tauri/target/debug/bundle/dmg/简词_0.1.0_aarch64.dmg
```

该调试产物不代表已经完成 Apple Developer 签名、公证或 Windows 实机验收。

## 23. 在线词库更新功能

### 当前目录内的变化

- Rust 新增 `reqwest`、`ed25519-dalek`、`base64` 和 `zstd` 项目依赖，锁文件及 `src-tauri/target/` 随之更新。
- 新增签名发布脚本 `scripts/create-dictionary-release.mjs`。
- 新增手动 GitHub Actions workflow `.github/workflows/dictionary-release.yml`。
- `.release/` 和本地词库私钥文件已加入 `.gitignore`。

### 本机及全局环境影响

Cargo 首次构建从 crates.io 下载了上述依赖及其传递依赖，写入用户级 Cargo 缓存和项目 `src-tauri/target/`。没有安装新的全局命令、系统应用或 Rust toolchain，也没有永久修改 shell 配置或环境变量。本机原有 `/opt/homebrew/bin/zstd` 被用于发布流程验证，并非本阶段安装。

验证期间在 `/tmp` 创建了临时 Ed25519 私钥和测试发布目录：

```text
/tmp/plain-dictionary-update-test.pem
/tmp/plain-dictionary-release-test/
```

它们只包含测试密钥和由当前词库生成的测试包，不参与应用运行，可以直接删除。

正式构建可临时设置以下两个环境变量；只对设置它们的 shell 及其子进程有效，本阶段没有写入任何 shell 启动文件：

```bash
PLAIN_DICTIONARY_UPDATE_MANIFEST_URL
PLAIN_DICTIONARY_UPDATE_PUBLIC_KEY
```

GitHub Secret `DICTIONARY_PRIVATE_KEY` 属于远端仓库配置，必须由仓库管理员设置，不能提交到当前目录。
