from __future__ import annotations

from .base import AnalysisPipeline, AnalysisOutput
from .types import AnalysisType


class PipelineRegistry:
    """Registry of AnalysisPipeline instances keyed by AnalysisType.

    Đăng ký pipeline tại startup, route request đến đúng pipeline theo type.
    """

    def __init__(self) -> None:
        self._pipelines: dict[AnalysisType, AnalysisPipeline] = {}

    def register(self, pipeline: AnalysisPipeline) -> None:
        self._pipelines[pipeline.analysis_type] = pipeline

    def get(self, analysis_type: AnalysisType) -> AnalysisPipeline:
        pipeline = self._pipelines.get(analysis_type)
        if pipeline is None:
            raise KeyError(f"No pipeline registered for analysis_type={analysis_type!r}")
        return pipeline

    def run(self, analysis_type: AnalysisType, input_data: object) -> AnalysisOutput:
        return self.get(analysis_type).run(input_data)  # type: ignore[arg-type]

    def registered_types(self) -> list[AnalysisType]:
        return list(self._pipelines)
