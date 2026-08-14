# Project 与资源

首页工作区围绕所连接的 Flow360 账号组织。

## Folder 与 Project

选择 Folder 后加载其中的 Project。可以搜索 Project、按照根资源类型筛选、排序，并在
列表和卡片视图之间切换。Folder 可以创建、重命名、移动和删除；Project 可以重命名和
删除。这些操作使用独立对话框，不可恢复的删除需要明确确认。

打开 Project 后进入 Project 工作台。通过 **Resources** 浏览 Geometry、SurfaceMesh、
VolumeMesh 和 Case 资源树。选择资源后会打开适合该类型的工作区。

## 同步

存在本地镜像时，应用会先读取最近的资源清单，然后刷新实时元数据。点击 **Sync** 会请求
一次完整刷新。部分失败会按资源列出，可以重试，而不必丢弃镜像中仍然可用的部分。

初次同步不会下载大型结果或网格压缩包。Geometry 可视化 manifest 和 buffer 会在打开
3D 预览时获取，之后可以从本地复用。

## 导入几何

导入流程接收支持的 CAD 文件，要求确认几何单位，并在处理前显示预期的 Flow360 命令。
STEP Library 保存不可变版本、预览通过验证的版本、使用本地文件夹组织资源，并可以从
选定版本创建 Flow360 Project。

配置模型服务后，AI Create 可以接收自然语言几何需求。它生成受约束的 CAD 操作图，使用
本地 CadQuery/OpenCascade 环境执行，并在创建 Project 前验证结果是闭合实体。

## Project 工具

工作台还提供 Project 范围的标注、Draft 管理、Ask AI，以及在存在 Case 时使用的 Case
对比功能。
