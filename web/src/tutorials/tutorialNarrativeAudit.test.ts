import { describe, expect, it } from 'vitest'

const learnerFacingSources = import.meta.glob([
  '../components/TutorialTeachingBlocks.tsx',
  '../pages/TutorialLibraryPage.tsx',
  '../pages/TutorialPage.tsx',
  '../pages/T0*TutorialPage.tsx',
  '../tutorials/t0*.ts',
  '../i18n/locales/zh-CN.ts',
], {
  eager: true,
  import: 'default',
  query: '?raw',
}) as Record<string, string>

const metaNarrativePatterns = [
  /reasoning chain/i,
  /colorful (?:pressure )?contour/i,
  /green solver status/i,
  /completion is not credibility/i,
  /instead of memorizing/i,
  /teaching (?:value|values|scale|facets)/i,
  /tutorial-fidelity/i,
  /learn Flow360 through engineering decisions/i,
  /learn by building trustworthy simulations/i,
  /evidence must support a decision, not just decorate/i,
  /finer parameter value is a hypothesis/i,
  /mesh credibility—not whether a job finishes/i,
  /start from the engineering decision, not the solver/i,
  /local tutorial status/i,
  /schema capabilities are backed/i,
  /tutorial artifact/i,
  /validated by the repository/i,
  /推理链/,
  /绚丽的云图/,
  /绿色的求解器状态/,
  /教学(?:值|数值|尺度|用面片|参数)/,
  /教程保真/,
  /迁移推理方法/,
  /从工程决策出发，而不是从求解器出发/,
  /本地教程状态/,
  /教程工件/,
]

describe('tutorial learner-facing narrative', () => {
  it('states CFD knowledge and tasks without explaining the tutorial philosophy', () => {
    const violations = Object.entries(learnerFacingSources).flatMap(([path, source]) =>
      metaNarrativePatterns.flatMap((pattern) => {
        const match = source.match(pattern)
        return match ? [`${path}: ${match[0]}`] : []
      }),
    )

    expect(violations).toEqual([])
  })
})
