# 插件样式指引

插件页面（侧栏功能页、首页面板、插件设置页）和插件自己的悬浮窗都是独立的网页，宿主的样式和组件进不去。为了让插件看起来和宿主一致，宿主提供三样东西：

- **样式变量**：一组 `--mojito-*` CSS 变量，宿主自动注入每个插件页面和悬浮窗，插件不用写任何代码。值随浅色、深色主题实时变化。
- **基础样式**（可选）：`/host/mojito-base.css`，引入后按钮、输入框、表格等普通 HTML 元素就和宿主一样。
- **字体**：宿主自带的 Geist，`--mojito-font-sans` 和 `--mojito-font-mono` 已经指向它，中文退回微软雅黑。

宿主不提供组件库，也不渲染表单描述。插件用什么框架都可以（React、Vue、原生 DOM、画布），只要颜色、字号、圆角和尺寸取自这些变量。

## 原则

- 颜色、字号、圆角、控件高度只用 `--mojito-*` 变量，不写具体的颜色值。宿主改版或加主题时，插件自动跟上。
- 能点的控件 8px 圆角（`--mojito-radius-control`），容器 12px（`--mojito-radius-panel`）。胶囊形状只用来表示状态和职能，不做成按钮。
- 控件默认高 30px（`--mojito-control-height`）；只有标签在上方的表单和页面的主要操作用 34px（`--mojito-control-height-large`）。同一行的控件高度一致。
- 每个区域最多一个主按钮（`--mojito-primary`）。状态要有文字，不只靠颜色。数字用等宽数字（`font-variant-numeric: tabular-nums`）。中文不小于 12px。

## 变量

约定版本是 1，可以读 `--mojito-contract` 得到。同一版本内变量只增加，不删除、不改名；确需改名时，旧名作为别名保留到下一个版本，并在这里标注。

| 变量 | 浅色 / 深色 | 用途 |
| --- | --- | --- |
| `--mojito-font-sans` | Geist，退回微软雅黑 | 正文 |
| `--mojito-font-mono` | Geist Mono | 代码、ID、需要对齐的数字 |
| `--mojito-text-xs` `-sm` `-base` `-lg` `-xl` | 12 / 13 / 14 / 16 / 20px | 说明 / 控件 / 正文 / 标题 / 大数字 |
| `--mojito-radius-small` `-control` `-panel` | 4 / 8 / 12px | 小标记 / 能点的控件 / 容器 |
| `--mojito-control-height` `-large` | 30 / 34px | 控件高度 |
| `--mojito-space-page` `-section` `-group` | 20 / 24 / 12px | 页面内边距 / 区块之间 / 组内 |
| `--mojito-ease` | | 过渡曲线，配合 150ms 左右的时长 |
| `--mojito-bg` | 白 / 深灰 | 页面底色，和宿主外框一致 |
| `--mojito-bg-subtle` | | 次级区域：表头、代码块、未选中的分段 |
| `--mojito-bg-muted` | | 进度条轨道、停用的填充 |
| `--mojito-bg-hover` | 半透明 | 行和按钮的悬停 |
| `--mojito-border` `-strong` | | 分隔线 / 输入框边框 |
| `--mojito-fg` `-secondary` `-tertiary` | | 正文 / 说明 / 占位和次要信息 |
| `--mojito-accent` | 绿 / 青柠 | 链接、选中的图标和文字 |
| `--mojito-focus` | | 焦点框 |
| `--mojito-primary` `-hover` `-fg` | 青柠 | 主按钮的底色、悬停、文字 |
| `--mojito-ok-bg` `-fg` | | “正常”类状态 |
| `--mojito-warn` `-bg` `-fg` | | 需要注意 |
| `--mojito-danger` `-bg` `-fg` | | 失败和危险操作 |
| `--mojito-tank-bg` `-fg`，`healer`，`dps` | | 防护、治疗、输出职能 |
| `--mojito-chart-grid` `-axis` | | 图表网格线、坐标轴 |
| `--mojito-shadow-raised` `-popover` | | 选中项 / 插件自己的弹出层 |

`-bg` 和 `-fg` 成对使用，深色主题下 `-bg` 是半透明的，叠在 `--mojito-bg` 上才是设计的效果。

## 用法

### 只用变量

```css
.toolbar {
  display: flex;
  gap: 8px;
}
.toolbar button {
  height: var(--mojito-control-height);
  padding: 0 12px;
  font: 500 var(--mojito-text-sm) var(--mojito-font-sans);
  color: var(--mojito-fg);
  background: var(--mojito-bg);
  border: 1px solid var(--mojito-border-strong);
  border-radius: var(--mojito-radius-control);
}
```

### 引入基础样式

```html
<link rel="stylesheet" href="/host/mojito-base.css">
```

写成以 `/` 开头的地址：插件页面的地址是 `mojito-plugin://runtime/plugin/…`，这个地址会指向宿主的 `mojito-plugin://runtime/host/mojito-base.css`。用 Vite 构建时会提示“doesn't exist at build time”，可以忽略。开发服务器上的页面同样可用。

基础样式包括：

- `body`：底色、文字颜色、字体和 `--mojito-space-page` 内边距。不想要内边距时自己覆盖。
- 标题、段落、链接、`small`、分隔线、`code`/`kbd`、焦点框、选中文字、滚动条。
- `button`：默认是次要按钮；`data-variant="primary"`、`"ghost"`、`"danger"`；`data-size="large"` 用 34px。
- `input`、`select`、`textarea`、复选框、单选框、滑块，`label`、`fieldset`。
- `table`：表头、行高 36px、悬停、等宽数字。
- 四个类：
  - `.mojito-panel`：带边框的容器，12px 圆角。
  - `.mojito-field`：一行设置，左边标签和说明，右边控件；相邻的自动加分隔线。
  - `.mojito-chip`：状态和职能标签，`data-tone="ok|warn|danger|tank|healer|dps"`。
  - `.mojito-secondary`：说明文字。

一个设置页：

```html
<form class="mojito-panel">
  <div class="mojito-field">
    <div><label for="scope">统计范围</label><small>悬浮窗和记录里计入哪些人。</small></div>
    <select id="scope"><option>小队</option><option>团队</option></select>
  </div>
  <div class="mojito-field">
    <div><label for="hide">战斗外隐藏悬浮窗</label><small>脱战 10 秒后淡出。</small></div>
    <input id="hide" type="checkbox">
  </div>
</form>
<button data-variant="primary">保存</button>
```

### 在 JS 里取颜色

画布、图表库等需要在 JS 里拿颜色的地方，从根元素读变量，主题变化时重画：

```ts
const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(`--mojito-${name}`).trim()
const dark = matchMedia('(prefers-color-scheme: dark)')
const draw = () => chart.setOptions({ color: token('fg'), gridColor: token('chart-grid') })
dark.addEventListener('change', draw)
draw()
```

目前只有浅色和深色两种主题，`prefers-color-scheme` 的变化就是主题的变化。

## 各页面的边界

插件页面放在宿主的外框里。宿主画外框、12px 圆角、边框和上方的标题条（插件名和“功能页面”“首页面板”“插件设置”），插件画标题条下面的整个区域。

| 页面 | 插件要做的 |
| --- | --- |
| 侧栏功能页 | 底色 `--mojito-bg`，内边距 `--mojito-space-page`。页面高度固定，内容多时在页面里自己滚动。不再画外框、圆角和阴影；标题条已经有插件名，不要再用插件名做大标题，直接从工具栏或内容开始。 |
| 首页面板 | 同上。最重要的数字放在第一屏，高度有限，内容多时在面板里滚动。 |
| 插件设置页 | 同上。一组设置用 `.mojito-panel` 包起来，每项一行 `.mojito-field`；保存按钮放在底部，全页只有一个主按钮。 |

页面加载中、加载失败和插件停用时，宿主在外框里显示状态，插件不用处理；但页面应尽快画出底色，避免长时间空白。宿主打开弹出层时会暂时用截图代替插件页面，这是正常的。

## 悬浮窗

- 悬浮窗盖在游戏画面上，不跟随浅色和深色。不要用 `--mojito-bg` 铺满整个窗口；字体、字号、圆角、职能颜色和状态颜色可以用。
- 窗口默认透明。透明且不穿透时，只有画到的地方接收点击：控件、`cursor: pointer` 的元素、有背景色或背景图的元素、边框、文字、图片和画布上不透明的像素；其他地方点击会穿透到游戏。只给需要交互或需要衬底的部分加背景。
- 文字要在游戏画面上看得清：白字加阴影或半透明衬底，不小于 12px，数字用等宽数字。

OverlayPlugin 兼容模板是第三方页面，宿主不给它们注入变量。

## 保证和不保证

保证（版本 1 内不会删除或改名）：

- `--mojito-*` 变量的名字和用途，`--mojito-contract`。
- `/host/mojito-base.css` 的地址，里面的四个类名和 `data-variant`、`data-size`、`data-tone` 属性。
- 字体地址 `/host/fonts/`。

不保证：

- 具体的颜色值，会随主题和宿主改版变化。
- 宿主界面内部使用的变量和类名，插件页面里也读不到。
- 宿主外框的具体尺寸，例如标题条的高度。

## 核对清单

- [ ] 页面里没有写死的颜色值，颜色都来自 `--mojito-*`。
- [ ] 浅色和深色都看过一遍。
- [ ] 页面没有自己的外框、圆角和阴影，没有重复插件名的大标题。
- [ ] 能点的控件 8px 圆角，容器 12px；胶囊只表示状态。
- [ ] 同一行控件高度一致；每个区域最多一个主按钮。
- [ ] 状态有文字；中文不小于 12px；数字用等宽数字。
- [ ] 内容多时页面自己滚动，宿主区域不会出现两层滚动条。
- [ ] 悬浮窗没有铺满背景，透明区域点击能穿透到游戏。

## 实现位置

- 变量的来源：[packages/@ffcafe/mojito-launcher/src/renderer/public/theme.css](https://github.com/thewakingsands/mojito/blob/master/packages/@ffcafe/mojito-launcher/src/renderer/public/theme.css)（宿主的两套主题）。
- 变量名和宿主变量的对应、注入内容：[packages/@ffcafe/mojito-launcher/src/main/plugins/style.ts](https://github.com/thewakingsands/mojito/blob/master/packages/@ffcafe/mojito-launcher/src/main/plugins/style.ts)。
- 注入：`PluginView`（[src/main/plugins/view.ts](https://github.com/thewakingsands/mojito/blob/master/packages/@ffcafe/mojito-launcher/src/main/plugins/view.ts)）在页面 `dom-ready` 时调用 `insertCSS`。
- 基础样式：[packages/@ffcafe/mojito-launcher/src/renderer/public/mojito-base.css](https://github.com/thewakingsands/mojito/blob/master/packages/@ffcafe/mojito-launcher/src/renderer/public/mojito-base.css)。
- 页面的 CSP（允许的样式和字体地址）：[src/main/plugins/resources.ts](https://github.com/thewakingsands/mojito/blob/master/packages/@ffcafe/mojito-launcher/src/main/plugins/resources.ts)。
- 示例：`examples/plugin-views` 的 `home.html` 和 `settings.html`。
