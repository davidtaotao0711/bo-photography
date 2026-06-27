# Bo David — Photography

一个使用 Astro 构建的极简个人摄影作品网站。图片保存在本地 `public/images`，作品和系列信息分别由 JSON 文件管理；不依赖 CMS 或第三方 UI 库，可直接静态部署到 Vercel。

## 本地运行

需要 Node.js 18.17 或更高版本。

```bash
npm install
npm run dev
```

浏览器打开终端显示的本地地址。提交或部署前可运行：

```bash
npm run build
npm run preview
```

## 本地可视化排版编辑器

运行下面的命令会启动网站，并自动打开本地编辑器：

```bash
npm run editor
```

编辑器支持：

- 在首页精选、全部照片和各分类之间切换预览；
- Street、Portrait、Scenes、Nature 和 Series detail 使用同一套 12 列隐形拼贴网格；
- 正式页使用稳定的 masonry packing，短图下方会自动被后续照片向上填充，横向和纵向间距统一为 `12px`；
- 可直接拖动作品页照片调整顺序，也可以使用卡片下方的 `← / →` 与相邻照片交换顺序；
- 选择照片后使用顶部的 **S / M / L / W / T / Full** 调整显示宽度，照片比例不会随之改变；
- 正式页默认完整显示原图；只有主动开启 **Crop** 后，才能使用 **Cover / Contain** 调整裁切；
- 首页精选继续使用原有独立排版，不受作品页拼贴设置影响；
- 可从卡片或照片设置窗口删除网站中的照片记录，并可在保存前撤销；磁盘原图不会被删除；
- 在独立的 Series 书架中创建、编辑或回收影集，上传照片、选择封面，并使用同一套拼贴预设排版；
- 手机端自动降级为稳定单列图片流；
- 修改标题、分类、横竖方向、地点、日期、系列、图片路径和图片描述；
- 一键加入或移出首页精选，并提示首页实际展示的前 12 张；
- 打开现有的 `src/data/photos.json`，检查数据后直接保存回本地文件；
- 撤销操作、搜索照片、下载 JSON 备份，以及恢复页面初始数据。

本地运行 Editor 时，完成编辑后点击“保存”会直接格式化并写回 `src/data/photos.json`。也可以先点击“打开 photos.json”取得浏览器文件权限；如果本地保存接口不可用，Editor 会自动回退到文件选择或下载 JSON 副本。Editor 页面不会出现在网站导航中，地址是 `/editor`。

### 正式页拼贴排版

作品页底层使用 12 列隐形网格和确定性的 masonry packing，公开页面不会显示网格线。短图下方会自动被后续照片向上填充，横向与纵向间距统一保持 `12px`。照片不会使用自由定位、不会互相重叠，也不会在刷新后随机变化。默认情况下，每张图片按原始比例自然撑高并完整显示。

尺寸预设如下：

- **S**：占 3 列
- **M**：占 4 列
- **T**：占 5 列，适合完整展示竖图
- **L**：占 6 列
- **W**：占 8 列
- **Full**：占 12 列

操作方法：

1. 在左侧选择 Street、Portrait、Scenes、Nature，或进入某个 Series。
2. 点击照片，在上方控制条选择宽度预设。切换预设只改变宽度，不会裁切图片。
3. 按住照片拖到另一张照片附近，释放后照片会插入目标位置；也可以点击卡片下方的 `← / →` 与当前分类中的前一张或后一张交换顺序。
4. 只有确实需要裁切时才开启 `Crop`；此时才能调整裁切高度、Cover / Contain 和焦点。
5. 点击“保存”，刷新对应公开页面检查结果。

保存后的单张照片格式如下。旧照片没有 `layout` 时会自动使用 M 尺寸，不需要批量修改：

```json
{
  "order": 1,
  "layout": {
    "colSpan": 4,
    "rowSpan": 4,
    "crop": false,
    "fit": "contain",
    "focalX": 50,
    "focalY": 50
  }
}
```

当 `crop` 为 `false` 时，`rowSpan` 不参与页面高度计算，图片高度始终由原图比例自然生成。`Full` 只代表接近整行宽度，不代表横幅裁切。

### 使用 Editor 管理 Series

Series 可以理解成一本独立的小影集。每本影集有自己的名称、网址 slug、文件夹、封面和照片顺序。以下操作只在本地 editor 中进行，editor 不会出现在公开网站导航里。

#### 1. 启动 Editor

在项目文件夹中打开终端，Windows 使用：

```bash
npm.cmd run editor
```

浏览器会打开 `/editor`。在左侧“预览版面”中选择 **Series**，即可进入影集书架。

#### 2. 新增一个 Series

1. 点击右上角 **New Series**。
2. 在“Series 名称”中输入名称，例如 `Tokyo 2026`。
3. Editor 会自动生成 slug：`tokyo-2026`。
4. 年份通常也会从名称中自动识别；可以补充一段简短说明。
5. 确认 slug 后点击 **创建 Series**。

Slug 是这本影集使用的英文网址和文件夹名称。例如 slug 为 `tokyo-2026`，公开页面地址是 `/series/tokyo-2026`，照片目录是：

```text
public/images/series/tokyo-2026/
```

Slug 只能使用小写英文字母、数字和连字符。它可以在创建前手动调整，但创建后不建议再改。已有 slug 或同名文件夹不会被覆盖，Editor 会提示换一个 slug。

#### 3. 给 Series 上传照片

1. 在 Series 书架点击对应封面卡片。
2. 进入影集后点击 **Upload Photos**。
3. 可以选择一张或多张 JPG、JPEG、PNG、WebP 图片。
4. 超过 5 MB 的图片会先显示警告；可取消，或确认继续上传。

Editor 会自动识别横图和竖图，并把图片保存到该 Series 文件夹。文件统一使用三位连续编号：

```text
public/images/series/tokyo-2026/001.jpg
public/images/series/tokyo-2026/002.jpg
public/images/series/tokyo-2026/003.jpg
```

以后继续上传时会从文件夹现有最大编号往后增加，不会覆盖旧照片。照片记录会自动追加到 `src/data/photos.json`，包含 `id`、`series`、`order`、`size`、`aspect`、横竖方向和图片路径等字段，不需要手动填写 JSON。

#### 4. 设置 Series 封面

- 第一次上传照片时，如果影集还没有封面，第一张照片会自动成为封面。
- 已有封面不会在以后上传时被覆盖。
- 在影集管理页中，点击某张缩略图下方的 **Set as Cover**，可以随时更换封面。
- 封面会写入 `src/data/series.json` 的 `coverImage`。
- 如果 `coverImage` 为空但影集已有照片，前台会自动使用第一张照片；完全没有照片时显示简洁空状态。

#### 5. 调整 Series 顺序

返回 Series 书架，使用每张影集卡片右下方的上、下箭头调整顺序。顺序会立即保存到 `series.json` 的 `order` 字段，数字越小越靠前。

如果普通照片排版还有未保存修改，Editor 会先要求保存，再允许创建、上传或调整 Series，避免刷新时丢失修改。

#### 6. 编辑、删除和拼贴排版

- 在 Series 书架中点击卡片上的 **Edit**，可以修改名称、年份、简介、顺序和封面路径。slug 创建后保持不变，避免网址、图片文件夹和照片记录失联。
- 点击 **Delete** 后还需要第二次确认，并输入该 Series 的 slug。确认后，Series 记录和它的照片记录会从 JSON 中移除；原图片文件夹不会永久删除，而会移动到 `trash/series/[slug]/`。
- 进入某个 Series 后，点击照片并使用 S / M / L / W / T / Full 调整占位。
- 拖动照片可直接修改顺序；排版与顺序写入 `photos.json` 的 `layout` 和 `order`。
- 旧 Series 的 `layoutRows` 字段会保留，但公开详情页优先使用新的照片 `layout`，不会删除旧数据。

#### 7. 本地检查与 Build

完成后先查看公开的 `/series` 页面和对应详情页，然后在终端运行：

```bash
npm.cmd run build
```

看到 `Complete!` 表示静态网站构建成功，可以提交上线。

#### 8. Commit、Push 和 Vercel 上线

在项目文件夹运行：

```bash
git add src/data/photos.json src/data/series.json public/images/series README.md src scripts astro.config.mjs
git commit -m "Update photography series"
git push
```

GitHub 推送完成后，已经连接该仓库的 Vercel 会自动开始构建和部署。等待 Vercel 显示部署成功，再打开正式网站检查 `/series`。

## 项目结构

```text
public/images/              本地照片文件
src/data/site.json          姓名、城市、联系方式和 About 文案
src/data/photos.json        所有照片数据
src/data/series.json        所有系列数据
src/components/             导航、页脚、照片卡片、系列卡片
src/layouts/                全站页面框架
src/pages/                  Astro 页面与动态路由
src/styles/global.css       全站基础样式与响应式布局
```

## 日常维护指南

这个网站的大部分日常更新，只需要修改 `src/data/` 里的 3 个 JSON 文件，以及把照片放进 `public/images/`。JSON 可以理解成一张按固定格式填写的资料表；引号、冒号和逗号需要保留。

### 修改联系方式、姓名或所在地

打开 `src/data/site.json`：

```json
{
  "name": "Bo David",
  "tagline": "Light, people, and quiet places.",
  "location": "Shanghai",
  "email": "hello@bodavid.photo",
  "instagram": "https://www.instagram.com/你的账号",
  "xiaohongshu": "你的小红书主页链接",
  "about": "这里是 About 页面显示的个人简介。"
}
```

- 修改邮箱：只改 `email` 后面的文字。
- 修改 Instagram 或小红书：粘贴完整的个人主页网址。
- 修改姓名或城市：改 `name` 或 `location`。
- 修改首页大标题：改 `tagline`。
- 暂时不展示某个社交链接时，把它改成空字符串，例如 `"instagram": ""`。

保存后，顶部名称、页脚、首页、About 和各页面标题会一起更新，不需要去其他页面重复修改。

### 修改 About 文案

仍然打开 `src/data/site.json`，只修改 `about` 后面双引号中的文字。About 文案应写在同一对双引号内；正文里如果需要英文双引号，建议暂时改用单引号，避免破坏 JSON 格式。

### 批量上传照片

不需要逐张编辑 JSON。先按照照片类型，把处理好的 JPG、JPEG、PNG 或 WebP 图片复制到下面的文件夹：

```text
public/images/street/              街头摄影
public/images/portrait/            人像摄影
public/images/scenes/              空间、静物、建筑细节与环境氛围
public/images/nature/              海边、山、湖、树林、植物、云和天气
public/images/series/tokyo-2026/   某个系列的照片，最后一层是系列 slug
```

文件夹不存在时可以直接新建。建议每张照片使用全站唯一的文件名，只使用小写英文、数字和连字符，例如 `tokyo-rain-01.webp`，不要使用空格。

照片复制完成后，在项目文件夹中运行：

```bash
npm run import:photos
```

脚本会扫描 `street`、`portrait`、`scenes`、`nature` 和 Series 文件夹，只把尚未登记的图片追加到 `src/data/photos.json`，重复运行不会重复添加。`nature` 会写入 `category: "nature"`；`scenes` 继续保留给空间、静物、建筑细节和环境氛围。脚本不会自动迁移现有 Scenes 照片。为了兼容以前的文件，它也会继续扫描旧的 `public/images/natural/` 文件夹，并将其中的新照片归入 Scenes。

每张新照片会自动生成 `id`、顺序编号 `title`、`category`、`image`、`featured: false`、`alt` 等字段，并自动整理 JSON 格式。已经存在相同图片路径的文件不会重复添加。

导入后的照片默认不在首页精选中，横竖方向默认为横图，日期默认为当前年份。建议随后打开 `src/data/photos.json`，检查并补充 `location`、`date`、`alt`，并把竖图的 `orientation` 改成 `portrait`；需要放到首页时，再把 `featured` 改成 `true`。

放进 `public/images/series/[slug]/` 的照片会自动填写相应的 Series slug，并使用 `category: "series"`。全新系列仍需要先在 Editor 中创建 Series 记录，才会出现在 Series 页面；日常维护推荐直接使用 Editor 上传，而不是手动复制文件。

如果终端提示 photo id 已存在，表示另一张照片使用了相同文件名。把新照片重命名后再次运行命令即可。

### 设置首页精选

打开 `src/data/photos.json`，找到对应照片：

```json
"featured": true
```

- `true`：显示在首页 Selected Work。
- `false`：不在首页显示，但仍保留在分类页和系列页。

首页按照照片在 JSON 中的先后顺序显示前 12 张精选照片。建议选择 9–12 张，并混合横图和竖图。

### 新增 Series

推荐使用上方“使用 Editor 管理 Series”的流程。Editor 会同时创建文件夹、更新 `series.json`、上传照片并更新 `photos.json`，不需要手动复制 JSON 数据块。

### 哪些文件可以改

- `src/data/site.json`：姓名、城市、联系方式、首页标语、About 文案。
- `src/data/photos.json`：照片资料、分类、系列归属、首页精选和显示顺序。
- `src/data/series.json`：系列名称、年份、简介和封面。
- `public/images/`：新增、替换照片。

### 哪些文件不要碰

如果只是更新作品和个人资料，请不要修改下面这些内容：

- `src/pages/`：网站页面逻辑。
- `src/components/`：导航、页脚和卡片组件。
- `src/layouts/`：全站页面框架。
- `src/styles/`：排版、颜色和手机适配。
- `astro.config.mjs`、`package.json`、`package-lock.json`、`tsconfig.json`：项目运行与构建配置。
- `node_modules/`、`dist/`、`.astro/`：自动生成的文件夹，不需要手动整理或上传照片。

每次修改 JSON 后，建议先运行 `npm run dev` 浏览网站。如果页面无法打开，通常是漏了逗号、双引号或大括号；对照相邻数据块即可检查。

## 新增照片

1. 把处理好的图片放进 `public/images/`，建议使用 JPG、WebP 或 AVIF。文件名请使用小写英文和连字符，例如 `tokyo-rain-01.webp`。
2. 在 `src/data/photos.json` 数组末尾新增一项：

```json
{
  "id": "tokyo-rain-01",
  "title": "No. 13",
  "category": "street",
  "series": "tokyo-2026",
  "location": "Tokyo",
  "date": "2026-06-22",
  "image": "/images/tokyo-rain-01.webp",
  "featured": false,
  "orientation": "portrait",
  "alt": "A person waiting beneath an umbrella in Tokyo rain"
}
```

- `id` 必须唯一，会用于单图页地址。
- `category` 可使用 `street`、`portrait`、`scenes`、`nature`；Series 照片由 Editor 自动使用 `series`。
- `series` 填系列的 `slug`；不属于系列时可填空字符串。
- `orientation` 使用 `portrait` 或 `landscape`，会影响排版比例。
- `alt` 应简短、具体地描述画面，供无障碍阅读和搜索引擎使用。

保存后，分类页和单图详情页会自动生成，无需创建新的 Astro 文件。

## 修改首页精选

在 `src/data/photos.json` 中，把希望出现在首页的照片设置为：

```json
"featured": true
```

取消精选则改为 `false`。首页会按 JSON 中的顺序显示前 12 张精选照片。推荐保持 9–12 张，并混合横图与竖图。

## 新增系列

推荐运行 `npm.cmd run editor`，在 Series 书架中点击 **New Series**。只有需要修复旧数据时才建议手动编辑 `series.json`。单条 Series 的兼容格式如下：

```json
{
  "slug": "hangzhou-2027",
  "title": "Hangzhou",
  "year": "2027",
  "description": "A short note about the atmosphere of this series.",
  "coverImage": "/images/series/hangzhou-2027/001.webp",
  "order": 5,
  "layoutRows": [
    { "orientation": "landscape", "photoIds": ["hangzhou-2027-001"] },
    { "orientation": "portrait", "photoIds": ["hangzhou-2027-002", "hangzhou-2027-003"] }
  ]
}
```

旧记录没有 `order` 或 `layoutRows` 也能正常显示；Editor 第一次调整顺序或保存排版时会自动补齐。详情页优先按照 `layoutRows` 展示，没有行数据时按照片顺序自动分行。

## 部署到 Vercel

1. 将项目推送到 GitHub、GitLab 或 Bitbucket。
2. 登录 Vercel，选择 **Add New → Project**，导入仓库。
3. Vercel 通常会自动识别 Astro。确认设置为：
   - Framework Preset: `Astro`
   - Build Command: `npm run build`
   - Output Directory: `dist`
4. 点击 Deploy。

本项目使用 Astro 静态输出，不需要环境变量或数据库。以后推送到主分支时，Vercel 会自动重新部署。

也可以使用 Vercel CLI：

```bash
npm i -g vercel
vercel
```

## 图片建议

- 长边建议 2000–3000 px；网页使用通常无需上传相机原始文件。
- 优先使用 WebP 或 AVIF；JPG 品质建议约 75–85。
- 使用一致的色彩空间（推荐 sRGB）。
- 同一系列尽量保持接近的色调与明暗关系。
## 本地压缩原始照片

这个功能用来先把相机原图压成适合网站展示的图片。原始照片不会被覆盖，压缩后的图片会输出到单独文件夹。

### 使用步骤

1. 把原图复制到：

```text
import/originals/
```

2. 在项目文件夹打开终端，运行：

```bash
npm run compress:images
```

3. 压缩完成后，检查输出文件夹：

```text
import/compressed/
```

脚本会扫描 `import/originals/` 里的 JPG、JPEG、PNG、WebP。小于等于 1MB 的 JPG 会直接复制；更大的图片会限制长边到 2400px，并从 85 质量开始尝试压缩。如果还超过 1MB，会依次尝试 80、75、70、68，尽量保持画质，不会为了体积把照片压得太差。输出文件统一是 `.jpg`。

4. 确认压缩效果后，把 `import/compressed/` 里的图片复制到对应的网站图片文件夹：

```text
public/images/street/
public/images/portrait/
public/images/scenes/
public/images/nature/
public/images/series/[series-slug]/
```

5. 运行批量导入，让网站记录这些新图片：

```bash
npm run import:photos
```

6. 本地检查构建：

```bash
npm run build
```

7. 确认没问题后提交并推送，Vercel 会自动上线：

```bash
git add .
git commit -m "Add new photos"
git push
```
