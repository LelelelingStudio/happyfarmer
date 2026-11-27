# itch.io 发布清单 — Happy Farmer / 爱种地的农民 v1.1.0

出品：了了了岭工作室 · 了了了游（leleleling Studio · Lelelegame）  
适龄：**Ages 6+ / 6 岁以上**  
版本：`1.1.0`（`GAME_VERSION`、`SAVE_VERSION`、页面显示、资源缓存参数、存档 `saveVersion` 全部一致）

---

## 1. HTML5 静态发布包

itch.io 上传 **ZIP**，游戏入口 `index.html` 必须位于压缩包**根目录**，不能套一层文件夹。

包含（显式列出，避免误带无关文件）：

```text
index.html
legal.html
languagecontrol.js
css/
js/
langdata/
assets/
```

排除：`tools/`、`CNAME`、`surge-parallel.sh`、隐藏文件、`.DS_Store`、`Thumbs.db`、本地发布说明与源文案。

在项目根目录执行：

```bash
zip -r happy-farmer-v1.2.1.zip \
  index.html legal.html languagecontrol.js \
  css js langdata assets \
  -x '*/.*' '*/.DS_Store' '*Thumbs.db'
```

校验根目录结构：

```bash
unzip -l happy-farmer-v1.2.1.zip | head -20
```

全部资源使用相对路径加载，兼容 itch.io iframe 子路径与本地 `file://` 打开。`assets/manifest.js` 已包含 `legal.html` 与 `css/legal.css`，无 `admin.html` 残留。

---

## 2. 三个公开法律直链

无需登录，英文为默认，`&lang=zh` 可切中文。

| 文档 | 直链 |
|---|---|
| User Agreement（用户协议，玩法说明已并入） | `https://happyfarmer.game.leleleling.site/legal.html?doc=1&lang=en` |
| Privacy Policy（隐私政策） | `https://happyfarmer.game.leleleling.site/legal.html?doc=2&lang=en` |
| Terms of Service（服务条款） | `https://happyfarmer.game.leleleling.site/legal.html?doc=3&lang=en` |

`doc` 参数使用白名单映射 `{1:eula, 2:privacy, 3:terms}`，非法值回退到 EULA；参数不写入 `innerHTML`，正文经现有 Markdown 转义路径渲染。

《了了了游游戏守则》仅作为上架自查依据，**不在游戏内展示**；原独立游戏规则弹窗与 `rules-*.json` 请求已移除，入口统一指向 EULA。

---

## 3. 适龄提示与强制同意

- 起始屏显示 `Ages 6+` 徽标与简短说明，层级高于开始按钮。
- 未勾选同意时，**新游戏 / 继续缓存 / 导入存档**三个入口全部拦截。
- 切语言后的自动续玩路径也已加门禁，无法绕过。
- 同意状态使用版本化 key `farm_legal_consent_v1_1_0`，校验 `accepted === true && version === '1.1.0'`；经 `HFStorage` 持久化，无痕模式退化为内存存储。

---

## 4. 商店资料

- 英文简介：`intro-main.en.txt`（含玩法、特色、6+ 提示、无内购、离线存档与可选排行榜说明）。
- 中文源文案：`intro-main.txt`。
- 封面：使用项目内 `happyfarmer.png`（见 `RELEASE.md`）。
- itch.io 后台：分类选 "Games" / 平台勾选 HTML5，评级设为 **Everyone 6+** 或等价档位。

---

## 5. 本轮审查的 15 个真实问题与修复状态

| # | 问题 | 严重度 | 状态 |
|---|---|---|---|
| 1 | `ITCH_RELEASE.md` 缺失 | 低 | 已新建本文件 |
| 2 | 切语言自动续玩绕过法律同意门禁 | 高 | 已修复（`js/main.js`） |
| 3 | `check_i18n.js` 前缀误判导致真实缺键被静默放行 | 中 | 已改为按源码真实拼接前缀判定 |
| 4 | 校验器不扫 `legal.html`、不识别 `tr()` | 中 | 已纳入扫描与匹配 |
| 5 | HF1 对非 BMP emoji 按码元位移，产出孤立代理并被替换成 U+FFFD | 高 | 已改为码点位移，自检加样本 |
| 6 | 英文成就用中文作物名，6 个成就永不解锁 | 高 | 已改用真实英文名 |
| 7 | 规则弹窗依赖 `fetch`，`file://` 下 CORS 失败 | 中 | 已改为直接打开 EULA，移除 fetch 与弹窗结构 |
| 8 | 英文错误提示指向 `langdata/ch/rules-ch.json` | 低 | 已改为英文路径 |
| 9 | 英文事件数据残留中文物品名「普通肥料」 | 中 | 已改为 `Normal Fertilizer` |
| 10 | 英文皮肤描述夹带汉字「幽」 | 低 | 已修正 |
| 11 | 英文设置项混排中文「中文」 | 低 | 已改为 `Chinese` |
| 12 | 英文数据文件中文注释 | 低 | 源码注释，不影响界面；未逐条翻译 |
| 13 | `index.html` 中文开发注释 | 低 | 源码注释，不影响界面；未逐条翻译 |
| 14 | `SAVE_COMPRESSION` 为死常量且与实际编码行为不符 | 低 | 已删除 |
| 15 | 英文条款限定中国法域；排行榜为外部请求 | 中 | 法域已改中性表述；排行榜保留为可选联网功能，失败静默降级且隐私政策已披露 |

审查之外一并修复的连带问题：

- 成就 #32「西瓜大亨」引用的作物在游戏中不存在，永远无法解锁 → 改为真实作物冬瓜（中英文案同步）。
- 中文包缺整个 `ui.emptyState.*` 组（9 个键），空状态文案为空白 → 已补齐。
- 英文加工品 `若木神叶 I` 残留中文 → 改为 `Ruomu Divine Leaf I`，并重新生成 `namemap-en.js`。

---

## 6. 验证记录

### 已完成（本轮）

- `node tools/check_i18n.js`：通过，中英各 900 个 key，543 处 `t()/tr()` 调用全部覆盖。
- `node --check`：所有修改过的 JS 文件语法通过。
- `selfTestSaveCodec()`：通过；含 `🏿` 与 ZWJ 家庭 emoji 的往返测试通过。
- `node tools/build-namemaps.js`：重新生成中英对照表，英文侧中文残留为 0。
- `RELEASE.md` 第 6 节记录的浏览器验证：加载页、英文默认、6+ 与同意拦截、三份法律页面渲染均已通过。

### 已完成（浏览器自动化验收，2026-11-26）

本地服务 `python3 -m http.server 8765`，浏览器 playwright-cli：

- [x] 默认英文启动，起始屏无中文；切中文后文案齐全，切回英文后正文无中文残留。
- [x] 未勾选同意点击 New Game 被拦截并显示警告；勾选后写入版本化 key 并可进入游戏；刷新后勾选状态保持，继续入口可直接进入。
- [x] `legal.html?doc=1/2/3` 均渲染正确（v1.1.0）；`doc=99` 回退到 EULA；`lang=zh` 正常显示中文。
- [x] 1.0.3 老存档刷新后升级到 1.1.0，金币 9876 / 第 33 天 / 15 块地 / 头像 `12.png` / 语言 en 全部保留。
- [x] 390×844 窄屏：设置弹窗 z-index 12000，底部工具栏自动隐藏，容器 `overflow-y:auto`；法律页无横向溢出。截图：`/tmp/ghf-legal-mobile.png`。
- [x] ZIP 已生成（30 MB）并校验：根目录含 `index.html`，无 `admin.html` / `CNAME` / `tools/` 残留；被根目录 `.gitignore` 的 `/*.zip` 忽略。
- [x] 主版本本轮修复已同步到 `happyfarmer-poki/` 子版本，两侧 i18n 校验与语法检查均通过。

### 平台侧待确认

- [ ] itch.io 上传后 iframe 子路径下资源、字体、图片、音频、存档与导入导出正常。
- [ ] itch.io 后台将评级设为 "Everyone 6+" 或等价档位。
- [ ] 从 itch.io 页面打开三个法律直链确认可访问。

---

## 7. 《了了了游游戏守则》自查

- [x] 三份法律协议：三个公开 HTTPS 直链，见第 2 节。
- [x] 诚实适龄：6+，无暴力、聊天室、UGC、赌博与内购。
- [x] 纯前端静态游戏，无构建步骤，核心玩法离线可用。
- [x] 不擅自收集个人信息；排行榜需主动加入且可匿名，自定义头像永不上传。
- [x] 无第三方反馈脚本、无广告、无违规内容。
- [x] 存档仅保存在玩家浏览器，支持导出 / 导入。

---

## 8. 已知风险

- 排行榜签名盐仍在前端代码中，属既定轻量威慑；移到服务端需修改 Cloudflare Worker（见 `RELEASE.md`）。
- 排行榜 Worker 的 CORS 需在每个目标平台来源下验证；失败为非致命，游戏保持可玩。
- 源码中的中文开发注释不影响玩家界面，本轮未逐条翻译。
