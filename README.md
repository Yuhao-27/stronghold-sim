# 卫戍协议·阵容模拟器

纯静态网页（PWA），可以离线使用，也能装到 iPhone 的主屏幕。

## 发布到 GitHub Pages（免费）

1. 在 GitHub 新建一个**公开（Public）**仓库，例如 `stronghold-sim`。免费账号只有公开仓库能开 Pages。
2. 把本文件夹里的**全部内容**（`index.html` 在仓库根目录）传上去：
   - 推荐用 git 或 GitHub Desktop。
   - 网页上传一次最多 100 个文件，头像较多，需要分几批传。
3. 打开仓库 Settings → Pages → Source 选 *Deploy from a branch*，分支选 `main`，目录选 `/ (root)`，然后保存。
4. 等一两分钟后打开 `https://你的用户名.github.io/仓库名/`。

## 装到 iPhone

1. 用 **Safari** 打开上面的网址。第一次打开时手机要联网，页面会顺便把所有文件缓存下来。
2. 点底部的「分享」按钮 → 「添加到主屏幕」。
3. 之后从主屏幕图标打开，就是全屏 App，没网也能用。

## 修改后更新

1. 改完任何文件后运行 `python build_sw.py`，它会重新生成 `sw.js`。
2. 把改动传到 GitHub。
3. 手机联网打开 App，会自动换成新版本。保存的阵容不会丢。

## 备份阵容

阵容只保存在当前设备的浏览器里，用页面上的「导出」可以备份。
