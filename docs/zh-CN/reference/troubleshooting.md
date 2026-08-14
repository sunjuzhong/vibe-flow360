# 故障排查

## `init` 无法找到或验证 Flow360

重新执行初始化并检查输出的可执行文件与 Profile：

```bash
./vibe-flow360 init --profile default
```

无界面登录时设置 `FLOW360_APIKEY` 并添加 `--no-login`。只有当自动发现选择了错误程序时，
才需要配置 `VIBESIM_FLOW360_BINARY`。

## Web 界面显示 Flow360 offline

确认本地服务可以使用当前 Profile 和环境运行配置的 CLI。修改 `.env` 后重新启动
`vibe-flow360 serve`。状态指示器会区分本地连接问题和仍然可用的缓存 Project 数据。

## Project 或资源已经过期

在 Project 工作台点击 **Sync**。普通打开操作可能复用较新的镜像，手动同步会请求完整的
元数据刷新。检查按资源列出的失败信息，修复登录或网络问题后重试。

## 3D 预览无法加载

可视化数据与元数据分别获取。确认当前 Flow360 环境中可以访问该资源，然后重试预览或
Project 同步。大型非可视化压缩包不会由初次镜像自动下载。

## AI Create 无法启动

AI Create 需要配置模型服务和本地 CadQuery 环境。检查 `VIBESIM_AI_API_KEY`，然后重新
运行 `./vibe-flow360 init`。如果依赖缓存不完整，运行：

```bash
make cad-runtime
```

## Preflight 失败

根据问题路径和信息修改 Draft，保存后验证新版本。只有最新保存且有效的版本才能执行。
Ask AI 可以建议补丁，但需要检查修改前后的 diff。

## 已提交任务在本地中断

重新打开已经保存的计划并使用恢复操作。恢复流程会根据已知的 Flow360 资源 ID 和状态进行
对账；不要因为本地服务重启就直接创建另一个任务。

## 测试

运行完整仓库检查：

```bash
make test
```

单独验证教程包：

```bash
make tutorials-test
```
