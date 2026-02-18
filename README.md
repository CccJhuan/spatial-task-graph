# Spatial Task Graph for Obsidian <img src="icon.png" alt="Logo" height="24" style="vertical-align: middle;"/>

**Spatial Task Graph** transforms your linear Obsidian tasks into a dynamic, interactive infinite canvas. Visualize dependencies, manage workflows with a Kanban-style sidebar, and organize your thoughts spatially—all with a premium Apple-style aesthetic.

## ✨ Key Features

### 1. Smart Layout & Organization

Automatically organize your messy graph with a single click. The intelligent layout algorithm centers parent nodes and sinks completed, isolated tasks to the bottom to keep your view clean.

### 2. Intuitive Graph Interactions

Manage your tasks spatially with fluid mouse gestures.

- **Connect & Edit**: Drag to connect tasks. Right-click connections to delete them.
    
- **Text Notes**: Right-click on the canvas to add sticky notes for context or headers.
    
- **Batch Move**: Hold `Left Click` to box-select multiple nodes and move them as a group.
    

|   |   |   |
|---|---|---|
|**Connect & Delete**|**Add Text Notes**|**Box Selection**|
||||

### 3. Seamless Creation Flow

Don't break your flow. Create new tasks directly from the canvas.

- **Drag-to-Create**: Drag a connection line to an empty space to instantly open the creation modal. The new task is automatically appended to the parent file and linked.
    

### 4. Powerful Workflow Management

Manage task status directly without opening files.

- **Interactive Sidebar**: Drag and drop tasks between **In Progress**, **Pending**, and **Backlog** in the left sidebar to switch their status instantly.
    
- **Real-time Sync**: Click the checkbox circle on a node to complete it. The change is immediately written to your markdown file with a timestamp (Tasks plugin format).
    
- **Quick Navigation**: Click any task text to jump directly to the source file.
    

|   |   |
|---|---|
|**Sidebar Drag & Drop**|**Click to Toggle & Navigate**|
|||

## 🚀 Installation

### Manual Installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the [Latest Release](https://www.google.com/search?q=https://github.com/TriumphC/obsidian-spatial-task-graph/releases "null").
    
2. Create a folder `obsidian-spatial-task-graph` in your vault's `.obsidian/plugins/` directory.
    
3. Move the files into that folder.
    
4. Reload Obsidian and enable the plugin.
    

## 🎮 Usage Guide

### The Interface

- **Left Sidebar (HUD)**: Your cockpit. Shows all tasks categorized by status. Click to center the view; Drag to change status.
    
- **Bottom Right (Control Panel)**: Switch between different **Boards**, apply filters (Tags/Paths), and trigger Auto Layout.
    
- **Top Left (Toolbar)**: Zoom and Fit View controls.
    

### Editing Tasks

- Click the **Pencil Icon** on a node to edit.
    
- Type `#` to autocomplete tags.
    
- Use the metadata toolbar to insert Dates (`📅`), Priorities (`🔺`), and more.
    
- Right-click a task node to quickly change its status color via the context menu.
    

## 🤝 Contributing

Contributions are welcome! Please create an issue or submit a Pull Request.

## 📄 License

MIT License