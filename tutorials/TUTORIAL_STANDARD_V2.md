# Tutorial Standard v2

Vibe Flow360 tutorials teach transferable CFD judgment and Flow360 operation. A tutorial is not complete merely because it can create a valid Draft.

Every v2 tutorial must lead a beginner through the same reasoning loop:

1. State the engineering decision and the limits of the model.
2. Explain the CFD phenomena needed to predict the outcome.
3. Map those phenomena to named Flow360 objects and fields.
4. Derive teaching values from geometry, nondimensional ratios, or an explicit engineering assumption.
5. Ask the learner to predict the effect of one controlled change before revealing it.
6. Contrast at least two realistic failure modes with their symptoms, causes, and corrections.
7. Judge generated evidence with explicit pass and fail criteria.
8. Test whether the learner can transfer the reasoning to a changed scenario.
9. Create configured Project/Draft resources only after the learning and review boundary is clear.

The required machine-readable content lives in each package's `pedagogy.yaml` and is validated by `tutorials/schema/pedagogy.schema.json`. Web copy must be available in English and Simplified Chinese, including dynamic and accessible text.

## Completion standard

A learner who completes a tutorial must be able to explain why the configuration is appropriate, identify when it is inappropriate, locate its representation in Flow360 `SimulationParams`, predict the direction of a controlled change, and state which evidence would accept or reject the result.
