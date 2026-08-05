# Flow360 Tutorials 全功能覆盖规划

## 1. 目标

Tutorials 是 Vibe Flow360 中相对独立的学习与示范模块。它不是参数参考手册，也不是一组彼此无关的代码片段，而是一套由真实仿真问题驱动、可执行、可验证、可持续追踪覆盖率的 examples。

每个 tutorial 必须同时回答：

1. 用户要解决什么工程问题？
2. 为什么需要这些 Flow360 功能和参数？
3. 参数如何共同构成一份完整的 `SimulationParams`？
4. 用户应检查哪些网格、收敛和结果证据？
5. 改变哪些参数会形成有意义的变体？

最终验收标准不是“主要功能看起来都讲过”，而是：当前支持版本中，每一个公开、非废弃的用户功能点，都能定位到至少一个 tutorial 的基线、变体或进阶章节，并通过有效参数文件或真实工作流验证。

## 2. 覆盖边界

全覆盖分为四层，避免把“参数覆盖”误当成“产品能力覆盖”。

| 层级 | 覆盖对象 | 权威来源 | 验收方式 |
|---|---|---|---|
| L1 参数模型 | `SimulationParams`、Meshing、Models、Boundaries、Time stepping、Outputs、Run control 及所有公开子类型/枚举 | `flow360-schema` 当前目标版本的 JSON Schema 与公开 exports | 每个公开 schema path、union variant、enum family 至少被一个 tutorial manifest 引用 |
| L2 执行工作流 | 从 Geometry、SurfaceMesh、VolumeMesh、Case/restart 出发，生成网格、运行、fork、sweep、wait、logs | Flow360 Python/CLI 的公开接口 | 每条支持的工作流至少有一个可 dry-run 或集成测试的 tutorial |
| L3 结果能力 | 收敛、力/力矩、surface/volume/slice、probe、平均量、声学、报告、下载与比较 | Flow360 results/report 公开接口 | 每种结果能力有结果读取步骤、可信度判断和预期产物 |
| L4 管理能力 | Project、Folder、资源树、批处理、迁移、数据传输与组织 | Flow360 Python/CLI 的公开接口 | 管理类 tutorial 可重复执行，并明确副作用与清理方式 |

以下内容不计入覆盖目标：私有类、内部 cache 字段、兼容性 updater 的内部实现、测试辅助 API，以及只对 Flow360 开发者而非最终用户开放的接口。

## 3. Tutorial 的标准结构

每个 tutorial 使用相同的教学合同：

| 部分 | 必需内容 |
|---|---|
| Intent | 工程问题、决策目标、输入和可交付结果 |
| Assumptions | 几何单位、流体、物理模型、稳态/非稳态、精度边界 |
| Baseline | 一份最小但完整、可验证的配置 |
| Why these settings | 按工程因果关系解释参数组，不逐字段复述文档 |
| Variants | 用少量语义 diff 覆盖同一功能族的其他合法分支 |
| Run | dry-run、本地 validation、审批后云端运行步骤 |
| Evidence | 网格质量、残差、监控量、守恒、目标 KPI 与限制 |
| Coverage manifest | 本教程覆盖的 schema path、类型分支、输出和工作流 ID |

一个功能点只有满足以下条件才算 `verified`：出现在 coverage manifest 中；示例可通过目标 Flow360 版本反序列化与 validation；其工程用途有解释；并且至少有一个可检查的预期结果。仅在正文提到不算覆盖。

## 4. 第一版 Tutorial—功能覆盖矩阵

状态含义：

- `adapt`：官方仓库已有较好的可改编素材；
- `compose`：需组合多个官方示例并补齐教学闭环；
- `new`：需要为缺失能力新设计工程场景；
- `audit`：需先确认公开 API/版本边界，再决定归属。

> 官方素材路径均相对于 `/Users/juzhongsun/Projects/Flow360/examples/`。

### A. 基础、网格与几何工作流

| ID | 完整工程意图 | 主要功能点 | 官方素材 | 状态 |
|---|---|---|---|---|
| T01 | 从一份飞机 CAD 得到第一组可信的升阻力结果 | units、entity grouping、`ReferenceGeometry`、`AerospaceCondition`、自动远场、Wall/Freestream、surface force fields、Geometry→Case 全链路 | `getting_started/quick_start.py` | adapt |
| T02 | 比较从 Geometry、SurfaceMesh、VolumeMesh 三种入口启动项目的差异 | Project root 类型、缺失阶段、resource tree、simulation validation context | `getting_started/template_script_load_mesh_run_case_or_sweep.py`、`workflow_management/project_management/use_cloud_project.py` | compose |
| T03 | 为三维圆柱建立曲率敏感且包含边界层的外流网格 | `MeshingDefaults`、曲率、增长率、首层厚度、`SurfaceRefinement`、`BoundaryLayer`、表面网格检查 | `basic_simulations/steady/steady_3D_cylinder.py` | adapt |
| T04 | 捕捉翼型前缘、尾缘和缝翼间隙 | `GeometryRefinement`、`SurfaceEdgeRefinement`、Angle/Height/AspectRatio refinement、ProjectAnisoSpacing、PassiveSpacing | `advanced_simulations/aerodynamics/airfoils/2D_30p30n.py` | compose |
| T05 | 在尾流、激波或关注区域布置体网格加密 | `UniformRefinement`、`StructuredBoxRefinement`、`AxisymmetricRefinement`、octree spacing、volume defaults、mesh slice output | CRM/GAW2 与 rotorcraft examples | compose |
| T06 | 自动识别外部流场，同时理解何时必须手工定义远场 | `AutomatedFarfield`、`UserDefinedFarfield`、enclosed entities、farfield method/size | `getting_started/quick_start.py` | compose |
| T07 | 为风道或歧管生成封闭内流网格 | internal flow、inlet/outlet、custom zones、seed-point/custom volume、无外部 farfield | `basic_simulations/meshing/auto_meshing_internal_flow.py` | adapt |
| T08 | 建立汽车风洞并正确模拟地面和车轮相对运动 | `WindTunnelFarfield`、Static/FullyMovingFloor、CentralBelt、WheelBelts、wheel rotation、wake refinement | `tutorials/notebooks/notebook_automotive.ipynb` | compose |
| T09 | 为螺旋桨构造旋转区并处理嵌套旋转区域 | `RotationVolume`、`RotationCylinder`、`RotationSphere`、sliding interfaces、nested rotation | `advanced_simulations/rotorcraft/isolated_propeller.py`、`nested_rotation_*.py` | adapt |
| T10 | 使用模块化/snappy 工作流为方盒和复杂零件划分网格 | `ModularMeshingWorkflow`、snappy surface/volume controls、body/region/edge refinements、quality metrics | `basic_simulations/meshing/cube_snappy.ipynb` | adapt |

### B. 工况、材料与求解物理

| ID | 完整工程意图 | 主要功能点 | 官方素材 | 状态 |
|---|---|---|---|---|
| T11 | 在给定高度、Mach 和 Reynolds 数下计算翼型性能 | `ThermalState`、standard atmosphere、`AerospaceCondition` constructors、alpha/beta、reference condition | `advanced_simulations/aerodynamics/airfoils/2D_crm.py`、`2D_gaw2.py` | adapt |
| T12 | 计算低速液体流动及重力影响 | `LiquidOperatingCondition`、Water、密度/黏度、`Gravity`、低 Mach 数处理 | 暂无完整官方 tutorial | new |
| T13 | 计算高温可压缩混合气或组分输运 | Gas、`ThermallyPerfectGas`、NASA9、Sutherland、FrozenSpecies、Species、`SpeciesTransportModel` | 暂无完整官方 tutorial | new |
| T14 | 用圆柱案例比较层流、SA 与 k-omega SST | `Fluid`、None/SpalartAllmaras/KOmegaSST、turbulence quantities、model constants、solver tolerances | steady/unsteady cylinder、airfoil examples | compose |
| T15 | 预测高攻角分离并比较 RANS、transition 与 DES | `TransitionModelSolver`、`DetachedEddySimulation`、zonal enforcement、wall distance、相关输出约束 | `advanced_simulations/aerodynamics/airfoils/2D_30p30n.py` | compose |
| T16 | 诊断困难算例并有依据地调整数值格式 | Navier–Stokes numerics、Roe/SLAU2、order、MUSCL、dissipation、Linear/Krylov solver、line search、Jacobian/equation frequency | `advanced_simulations/turbomachinery/periodic_BC.py` | compose |
| T17 | 从均匀场、表达式或已有 Case 初始化并加速收敛 | Navier–Stokes/heat initial conditions、modified restart、fork、mesh interpolation | `workflow_management/project_management/fork_*.py`、`run_case_with_fork.py` | compose |
| T18 | 计算固体导热和流固共轭换热 | `Solid`、SolidMaterial、`HeatEquationSolver`、temperature/heat-flux interface、CHT validation | `advanced_simulations/heat_transfer/cht_solver.py` | adapt |

### C. 边界条件与区域模型

| ID | 完整工程意图 | 主要功能点 | 官方素材 | 状态 |
|---|---|---|---|---|
| T19 | 建立风洞翼型的标准外流边界并利用对称面降本 | Wall、Freestream、SlipWall、SymmetryPlane、wall function、roughness、velocity、temperature/heat flux | quick start、airfoil examples | compose |
| T20 | 为喷管、管道或叶栅选择正确的入口/出口约束 | Inflow：TotalPressure/MassFlowRate/Supersonic/Mach；Outflow：Pressure/MassFlowRate；turbulence quantities | `advanced_simulations/turbomachinery/periodic_BC.py`、internal-flow example | compose |
| T21 | 只模拟一个叶栅通道并保持周向周期性 | rotational/translational `Periodic`、surface pairs、axis constraints | `advanced_simulations/turbomachinery/periodic_BC.py` | adapt |
| T22 | 用多孔跳跃面表示薄滤网并与多孔体比较 | `PorousJump`、Slater porous bleed、pressure drop、surface vs volume approximation | 暂无完整官方 tutorial | new |
| T23 | 用多孔介质模拟散热器、过滤器或蜂窝芯 | `PorousMedium`、Darcy/Forchheimer loss、volumetric heat/region assignment | internal-flow seedpoint material可复用 | new |
| T24 | 用简化动量源表示风扇或推进装置 | `ActuatorDisk`、`ForcePerArea`、force/thrust monitoring | `post_processing/special_features/actuator_disk.py` | compose |
| T25 | 用叶素理论预测孤立旋翼悬停性能 | `BETDisk`、twist/chord/sectional polar、XROTOR/DFDC/C81/XFOIL 输入、tip gap、blade count | `advanced_simulations/rotorcraft/BET_Disk.py`、`BET_eVTOL.py` | adapt |
| T26 | 建立真实旋转参考系并比较 MRF 与非定常旋转 | `Rotation`、angular velocity/angle expression、parent volumes、rotating wall、non-inertial frame | `isolated_propeller.py`、`RANS_xv15.py`、nested rotation examples | adapt |
| T27 | 用速度强迫面重建目标入流或尾流剖面 | `VelocityForcingPlane`、目标速度场、上下游验证 | 暂无完整官方 tutorial | new |

### D. 时间推进、控制与自定义逻辑

| ID | 完整工程意图 | 主要功能点 | 官方素材 | 状态 |
|---|---|---|---|---|
| T28 | 稳态求解圆柱阻力并建立收敛判据 | `Steady`、Ramp/Adaptive CFL、max steps、residual/force convergence、`RunControl` | `basic_simulations/steady/steady_3D_cylinder.py`、`post_processing/convergence/convergence.py` | compose |
| T29 | 解析圆柱涡脱落频率并证明时间步独立性 | `Unsteady`、physical steps、step size、order、inner iterations、animation frequency、Strouhal number | `basic_simulations/unsteady/unsteady_2D_cylinder.py` | adapt |
| T30 | 在目标量稳定后自动停止长时间计算 | `StoppingCriterion`、run control、监控表达式、容差/窗口/最小步数 | 暂无完整官方 tutorial | new |
| T31 | 用自定义动力学实现攻角控制器或六自由度响应 | `UserDefinedDynamic`、state/update/input/output variables、`FromUserDefinedDynamics`、angle/angular velocity expressions | `advanced_simulations/aerodynamics/user_defined_dynamics/*.py`、dynamic derivatives | adapt |
| T32 | 用自定义表达式构造派生流场量和工程 KPI | `UserDefinedField`、表达式、单位推导、surface integral/monitor reuse | UDD、monitoring 与 field-data examples | compose |

### E. 输出、结果理解与报告

| ID | 完整工程意图 | 主要功能点 | 官方素材 | 状态 |
|---|---|---|---|---|
| T33 | 从机翼计算得到表面压力、摩擦和体流场结构 | `SurfaceOutput`、`VolumeOutput`、字段有效性、格式/频率、surface/volume results | quick start、`post_processing/field_data/volumetric_and_surface.py` | adapt |
| T34 | 用切片、等值面和流线解释尾流及涡结构 | `SliceOutput`、`IsosurfaceOutput`、`StreamlineOutput`、Q criterion、vorticity | `field_data/time_averaged_isosurfaces.py`、periodic example | compose |
| T35 | 用点探针、表面探针和表面切线监控局部非定常现象 | `ProbeOutput`、`SurfaceProbeOutput`、`SurfaceSliceOutput`、唯一命名与采样频率 | `post_processing/monitoring/monitors.py`、migration monitor conversion | compose |
| T36 | 用时间平均和移动统计区分均值、波动与未收敛漂移 | TimeAverage surface/volume/slice/probe/streamline、`MovingStatistic`、start step | `field_data/time_averaged_isosurfaces.py` | compose |
| T37 | 计算整机力矩、分段载荷和任意积分 KPI | `ForceOutput`、`ForceDistributionOutput`、`SurfaceIntegralOutput`、moment center/axes | `forces_and_moments/forces.py`、`field_data/x_force_distribution.py`、imported surface example | adapt |
| T38 | 预测旋翼或车体远场噪声 | `AeroAcousticOutput`、Observer、非定常约束、observer time step、声压结果 | `post_processing/special_features/aeroacoustics.py` | compose |
| T39 | 生成可复现的工程视图、动画和对比图 | `RenderOutput`、RenderOutputGroup、camera/projection、materials、lighting、static/animated views | 暂无完整 simulation tutorial | new |
| T40 | 自动生成包含几何、收敛和 KPI 的审查报告 | report templates、charts、captions、case comparison、evidence provenance | `post_processing/report/*.py`、automotive notebook | adapt |

### F. 批处理、资源与数据工作流

| ID | 完整工程意图 | 主要功能点 | 官方素材 | 状态 |
|---|---|---|---|---|
| T41 | 对攻角或设计变量做可审查、受预算约束的 sweep | parameter patch、case matrix、baseline/variants、budget warning、semantic diff | `post_processing/monitoring/alpha_sweep.py`、`sweep_launch_*.py` | adapt |
| T42 | 批量生成网格与 Case，同时保持 folder/project 组织清晰 | batch mesh/case submission、folders、naming、idempotency、wait/status | `workflow_management/batch_processing/*.py`、`folder/examples.ipynb` | adapt |
| T43 | 从已有 Case fork、restart 或跨网格插值形成设计分支 | fork、restart、mesh interpolation、provenance、parent-child resource tree | `workflow_management/project_management/fork_*.py` | adapt |
| T44 | 列出、搜索、下载和归档云端资源与结果 | project/case/mesh listing、pagination、download、storage、resource IDs | `workflow_management/data_management/**/*.py` | adapt |
| T45 | 把旧版 BET/Monitor 配置迁移为当前 SimulationParams | migration converters、versioning、validation、semantic diff | `migration_guide/*.py` | adapt |
| T46 | 在不同账号/环境下安全复现项目 | account/environment selection、project/folder target、credentials boundary、manifest | `workflow_management/data_management/cloud_organization/change_account_and_submit.py` | audit |

## 5. 参数叶节点覆盖表的生成方式

上面的 46 行是“教学单元表”，用于确认每类能力都有真实工程归属；它还不能单独证明每个参数叶节点已经覆盖。实现阶段必须再生成一张机器可校验的明细表，建议保存为 `tutorials/coverage.yaml`：

```yaml
schema_version: 25.x
features:
  - id: models.surface.periodic.rotational
    schema_path: models[].Periodic.spec.Rotational
    tutorial: T21
    section: baseline
    artifact: tutorials/T21-periodic-blade-passage/simulation.json
    validation: verified
  - id: models.surface.periodic.translational
    schema_path: models[].Periodic.spec.Translational
    tutorial: T21
    section: variant-translational
    artifact: tutorials/T21-periodic-blade-passage/variants/translational.json
    validation: planned
```

建议增加一个 coverage checker：

1. 从固定版本的 Flow360 JSON Schema 获取所有公开字段、discriminated-union 分支和枚举族；
2. 排除 private、deprecated 和内部兼容字段，并记录排除理由；
3. 读取所有 tutorial manifest，建立 `feature → tutorial/section/artifact` 反向索引；
4. 对每个 artifact 执行反序列化与对应阶段 validation；
5. 输出 `covered`、`verified`、`missing`、`excluded` 四类报告；
6. CI 在新增公开功能未被映射时失败，在仅有映射但尚未验证时告警。

覆盖率应同时报告：

| 指标 | 定义 |
|---|---|
| Type coverage | 公开模型/union variant 中已被 tutorial 使用的比例 |
| Field coverage | 公开 schema leaf path 中有明确教学归属的比例 |
| Variant coverage | enum/union 合法分支中至少有一个有效 artifact 的比例 |
| Workflow coverage | 支持的项目入口和执行路径中完成 dry-run/integration validation 的比例 |
| Evidence coverage | tutorial 中包含可检查结果与可信度判据的比例 |

## 6. 实施顺序

| 阶段 | 内容 | 交付结果 |
|---|---|---|
| P0 覆盖基线 | 固定目标 Flow360 版本；导出 public feature registry；将本表拆成机器可读 manifest | 能准确列出 missing，而不是主观声称全覆盖 |
| P1 黄金路径 | T01、T03、T07、T11、T19、T28、T33、T40 | 外流、内流、网格、运行、结果和报告形成第一个完整闭环 |
| P2 核心物理 | T14–T18、T20–T26、T29 | 湍流、边界、CHT、旋转、BET、非定常主能力覆盖 |
| P3 高级结果 | T31–T39、T41、T43 | UDD/UDF、全部输出族、sweep、fork 与可信度教学 |
| P4 缺口专篇 | T12、T13、T22、T23、T27、T30、T39 | 为官方现有 examples 未充分覆盖的 schema 功能创建新场景 |
| P5 管理与迁移 | T02、T42、T44–T46 | 补齐非 SimulationParams 的 Flow360 用户工作流 |
| P6 全覆盖门禁 | CI coverage checker、版本升级 diff、缺口为零 | 每次 Flow360 schema/API 升级都能发现新功能并阻止静默漏项 |

## 7. 当前结论

官方 `examples/` 足以作为多数 tutorials 的技术种子，但不能直接等价于全功能覆盖。尤其需要新建或显著补强的区域包括：液体工况、热完善气体与组分输运、多孔跳跃/多孔介质、速度强迫面、停止准则、完整 RenderOutput，以及部分网格和入口/出口变体。

因此推荐采用“两张表”的长期结构：

1. 本文维护工程场景与 tutorial 的产品规划；
2. `tutorials/coverage.yaml` 维护 schema/API 级的机器可验证覆盖事实。

只有两者同时完成，才可以对外声明 Flow360 功能点已被 tutorials 全覆盖。
