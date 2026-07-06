# KOF AI

一个基于 [Phaser 3](https://phaser.io/) 和 TypeScript 开发的浏览器横版格斗游戏。支持单人对战 CPU、双人本地对战、角色与场景选择，以及可扩展的角色和技能系统。

> 这是一个非商业同人项目，与 SNK 或《拳皇》系列的权利方无关。

## 功能

- 单人对战 CPU 与双人共用键盘对战
- 角色选择、场景选择、血量、怒气、防御和必杀技
- 基于数据配置的技能、碰撞箱、投射物和特效系统
- 兼容 GIF 角色动画与 PNG 序列帧角色
- 可选的 AI 自定义角色生成流程
- 战斗碰撞箱调试视图

## 快速开始

需要 Node.js 20 或更高版本。

```bash
git clone https://github.com/salathleizhang/kof-ai.git
cd kof-ai
npm install
npm run dev
```

Vite 会启动本地开发服务器并在浏览器中打开游戏。

## 操作方式

### 战斗

| 操作 | 玩家 1 | 玩家 2 |
| --- | --- | --- |
| 移动 / 跳跃 | `W` `A` `S` `D` | 方向键 |
| 攻击 1 | `J` | `1` |
| 攻击 2 | `K` | `2` |
| 必杀技 | `L` | `3` |
| 防御 | 下 + 远离对手方向 | 下 + 远离对手方向 |

必杀技需要怒气蓄满后才能释放。

### 菜单与角色选择

- 主菜单：`W` / `S` 或上下方向键移动，`Enter` / `Space` 确认。
- 玩家 1：`WASD` 移动，`Space` 确认，`Shift` 取消。
- 玩家 2：方向键移动，`Enter` 确认，`Backspace` 取消。

## 开发命令

```bash
npm run dev        # 启动开发服务器
npm run typecheck  # TypeScript 类型检查
npm test           # 运行测试
npm run build      # 构建生产版本到 dist/
npm run preview    # 本地预览生产构建
```

战斗中按 `F2`，或点击右下角的“开发模式”，可以显示 pushbox、hurtbox、技能 hitbox 和投射物边界。

## 项目结构

```text
src/
├── app/          # 应用启动
├── characters/   # 角色战斗配置
├── combat/       # 技能、碰撞、投射物和特效
├── config/       # 游戏与战斗常量
├── scenes/       # Phaser 场景
├── services/     # 角色资源加载
├── objects/      # 角色与 AI 控制器
└── ui/           # 自定义角色界面

public/assets/    # 图片、动画、音乐和音效资源
server/           # 可选的本地角色生成服务
test/             # 自动化测试
```

战斗系统的设计与扩展方式见 [docs/combat-architecture.md](docs/combat-architecture.md)。

## 自定义角色（可选）

游戏本体不依赖本地 API。只有使用角色选择界面中的“新增角色”功能时，才需要启动生成服务：

```bash
npm run local-api
```

该流程还需要已登录的 MuleRun CLI 及对应的图片、视频生成服务。完整步骤见 [docs/custom-character-runbook.md](docs/custom-character-runbook.md)。

## 贡献

欢迎提交 Issue 和 Pull Request。提交代码前请运行：

```bash
npm run typecheck
npm test
npm run build
```

## 版权说明

本项目仅用于学习与技术交流。《拳皇》相关名称、角色和原始素材的权利归其各自权利方所有。仓库中的第三方素材不因代码公开而自动获得开源许可；复制、修改或再发布前，请自行确认相应素材的授权范围。
