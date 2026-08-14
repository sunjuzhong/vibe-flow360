# 第一次仿真工作流

本流程从已有的 Flow360 Geometry 开始。除非用户明确批准，否则不会提交远程任务。

## 1. 打开 Project

启动 Vibe Flow360 并进入工作区。选择一个 Flow360 Folder，然后打开 Project。应用可以
先显示缓存的元数据，同时在后台从 Flow360 刷新 Project。

## 2. 选择起始资源

打开 **Resources**，选择 Geometry、SurfaceMesh 或 VolumeMesh。可以规划的下一阶段
取决于所选资源：

- Geometry → SurfaceMesh、VolumeMesh 或 Case 计划
- SurfaceMesh → VolumeMesh 或 Case 计划
- VolumeMesh → Case 计划

在规划运行之前，先使用对应资源工作区检查对象。

## 3. 描述工程目标

打开 **Ask AI**，说明需要得到的结论、运行工况和关注的物理量。如果规划器无法安全
推断必要信息，会要求用户补充结构化答案。

## 4. 审查计划

检查建议阶段、假设、命令预览和参数差异。缺失的必需值会显示在 Schema 驱动的控件中。
也可以使用 Form 或 JSON 模式编辑完整 Draft 参数。

## 5. 执行 preflight

Preflight 使用已安装的 Flow360 Schema 验证当前 SimulationParams。继续之前需要解决
阻塞问题并检查警告。Ask AI 可以提出修复方案，但应用之前仍会显示补丁内容。

## 6. 批准并提交

批准会锁定已经审查的版本。远程提交还需要一次独立确认，这是可能开始使用 Flow360
付费云资源的节点。

## 7. 监控并查看结果

执行视图会显示当前阶段、资源状态、可用日志和恢复操作。当 Case 产生结果后，可以进入
对应工作区查看收敛、可视化和结果文件。

如果只想无费用体验完整思路，可以先完成[浏览器教程](../tutorials/index.md)，不要提交计划。
