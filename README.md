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
public/images/scenes/              场景与自然风景
public/images/series/tokyo-2026/   某个系列的照片，最后一层是系列 slug
```

文件夹不存在时可以直接新建。建议每张照片使用全站唯一的文件名，只使用小写英文、数字和连字符，例如 `tokyo-rain-01.webp`，不要使用空格。

照片复制完成后，在项目文件夹中运行：

```bash
npm run import:photos
```

脚本会扫描 `street`、`portrait`、`scenes` 和 Series 文件夹，只把尚未登记的图片追加到 `src/data/photos.json`，重复运行不会重复添加。`scenes` 文件夹中的照片会自动使用 `category: "scenes"`，显示在网站的 Scenes 页面。为了兼容以前的文件，脚本也会继续扫描旧的 `public/images/natural/` 文件夹，并将其中的新照片归入 Scenes。

每张新照片会自动生成 `id`、顺序编号 `title`、`category`、`image`、`featured: false`、`alt` 等字段，并自动整理 JSON 格式。已经存在相同图片路径的文件不会重复添加。

导入后的照片默认不在首页精选中，横竖方向默认为横图，日期默认为当前年份。建议随后打开 `src/data/photos.json`，检查并补充 `location`、`date`、`alt`，并把竖图的 `orientation` 改成 `portrait`；需要放到首页时，再把 `featured` 改成 `true`。

放进 `public/images/series/[slug]/` 的照片会自动填写相应的 Series slug。已有系列会沿用该系列现有照片的分类；全新系列无法自动判断时会暂用 `street`，请在导入后检查 `category`。全新系列还需要按照下方“新增系列”的说明，在 `src/data/series.json` 中添加系列资料，才会出现在 Series 页面。

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

1. 把系列封面和该系列照片放进 `public/images/`。
2. 打开 `src/data/series.json`，复制一个完整的系列数据块，粘贴到文件末尾。
3. 修改 `slug`、标题、年份、说明和封面图片地址。
4. 打开 `src/data/photos.json`，把属于这个系列的照片的 `series` 改成同一个 `slug`。

例如系列的 slug 是 `hangzhou-2027`，该系列每张照片都应填写：

```json
"series": "hangzhou-2027"
```

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
- `category` 只能使用 `street`、`portrait` 或 `scenes`。
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

1. 在 `src/data/series.json` 末尾新增一项：

```json
{
  "slug": "hangzhou-2027",
  "title": "Hangzhou",
  "year": "2027",
  "description": "A short note about the atmosphere of this series.",
  "coverImage": "/images/hangzhou-cover.webp"
}
```

2. 在 `src/data/photos.json` 中，把属于该系列的照片的 `series` 设置为同一个 slug：

```json
"series": "hangzhou-2027"
```

系列入口页和详情页会自动生成。详情页会根据照片顺序和横竖方向形成有大小变化的影集式排版；调整 JSON 中照片的先后顺序即可改变观看节奏。

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
