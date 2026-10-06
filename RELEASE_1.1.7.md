# 🎉 1.1.7：组合框与布局体验更新

Spatial Task Graph 1.1.7 重点改善了多任务树和组合框的组织体验，让复杂看板更容易整理、查看和维护。

## 🗂️ 组合框体验

- 支持组合框嵌套，整棵任务树可以作为一个整体放入更大的组合框。
- 组合框标题显示在边框外，支持直接编辑名称、折叠、展开和进入内部查看。
- 组合框支持和任务一致的 Backlog、Pending、In progress、Finished 状态及颜色。
- 组合框可以出现在 HUD 面板中，并支持拖拽切换状态。
- 组合框内的任务保持原有字号，缩放时只调整组合框标题和控制按钮。

## 🌳 选择与连接

- 支持框选、Shift 多选，以及 Ctrl/Cmd+A 选择当前任务树。
- 只有存在直接连线且属于同一层级的对象才能创建组合框。
- 支持从组合框创建连接，不会因为连接操作展开内部任务树。
- 组合框内部视图提供路径导航，可以在多层嵌套之间进入和返回。

## ⚡ 布局与稳定性

- 创建组合框或执行 Layout 后，保持不同任务树之间原有的上下相对位置。
- 改善大型任务图启动速度，复用任务快照并减少重复读取。
- 状态菜单改用 Obsidian 原生元素创建方式，消除相关代码检查警告。
- 保留 TaskNotes 集成、层级同步、归档看板和任务索引清理功能。

## 📥 安装与更新

1. 打开 **设置 → 第三方插件**。
2. 搜索 **Spatial Task Graph**。
3. 更新到 **1.1.7** 并重新加载插件。

手动安装时，请下载 Release 中的 `main.js`、`manifest.json` 和 `styles.css`。

---

# 🎉 1.1.7: Grouping and Layout Experience Update

Spatial Task Graph 1.1.7 improves the way complex task trees are organized, viewed, and maintained on the canvas.

## 🗂️ Group experience

- Supports nested groups, so an entire task tree can be placed inside a larger group.
- Group titles appear outside the frame and support inline renaming, collapsing, expanding, and entering the group view.
- Groups support the same Backlog, Pending, In progress, and Finished statuses and colors as tasks.
- Groups appear in the HUD and can be moved between status sections by dragging.
- Tasks inside a group keep their original font size while group titles and controls scale with the group.

## 🌳 Selection and connections

- Supports marquee selection, Shift multi-select, and Ctrl/Cmd+A tree selection.
- A group can only be created from same-level objects that are directly connected within the selection.
- Connections can be created from a group without expanding its internal task tree.
- Nested group views provide path navigation for entering and returning between levels.

## ⚡ Layout and stability

- Preserves the relative vertical positions between independent task trees after grouping or running Layout.
- Improves startup performance by reusing task snapshots and reducing repeated file reads.
- Uses Obsidian-native element helpers for status menus.
- Retains TaskNotes integration, hierarchy synchronization, archived boards, and task index cleanup.

## 📥 Installation and updates

1. Open **Settings → Community plugins**.
2. Search for **Spatial Task Graph**.
3. Update to **1.1.7** and reload the plugin.

For manual installation, download `main.js`, `manifest.json`, and `styles.css` from this release.
