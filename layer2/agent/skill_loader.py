"""
skill_loader.py — Load và validate skill YAML files tại startup.

Eager load toàn bộ YAML khi gọi load_all() — fail fast nếu _base.yaml thiếu
hoặc bất kỳ skill YAML nào không pass Pydantic validation.

Hai index được build:
  _skills_by_issue_type: dict[str, AnalysisSkill]  — primary lookup theo issue_type
  _skills_by_id:         dict[str, AnalysisSkill]  — cho GET /skills endpoint

Fallback: nếu issue_type không có skill → dùng generic skill (generic.yaml).
Nếu generic.yaml cũng không có → raise ValueError (service không thể hoạt động).
"""
from __future__ import annotations

import logging
from pathlib import Path

import yaml
from pydantic import ValidationError

from ..models.skill import AnalysisSkill

logger = logging.getLogger(__name__)

_BASE_YAML_NAME = "_base.yaml"
_BASE_PROMPT_KEY = "base_system_prompt"
_GENERIC_SKILL_ID = "generic"


class SkillLoader:
    """Load và quản lý tất cả skill definitions từ YAML files."""

    def __init__(self) -> None:
        self.base_system_prompt: str = ""
        self._skills_by_issue_type: dict[str, AnalysisSkill] = {}
        self._skills_by_id: dict[str, AnalysisSkill] = {}
        self._loaded: bool = False

    def load_all(self, skills_dir: Path) -> None:
        """
        Eager load tất cả YAML trong skills_dir.

        Raises:
            ValueError: nếu _base.yaml không tồn tại hoặc thiếu base_system_prompt
            ValidationError: nếu bất kỳ skill YAML nào không hợp lệ
        """
        self._load_base(skills_dir)
        self._load_skills(skills_dir)
        self._loaded = True
        logger.info(
            "SkillLoader loaded: %d skills, %d issue_type mappings",
            len(self._skills_by_id),
            len(self._skills_by_issue_type),
        )

    def _load_base(self, skills_dir: Path) -> None:
        base_path = skills_dir / _BASE_YAML_NAME
        if not base_path.exists():
            raise ValueError(f"_base.yaml không tìm thấy tại {base_path}. Service không thể khởi động.")

        with base_path.open(encoding="utf-8") as f:
            data = yaml.safe_load(f)

        prompt = data.get(_BASE_PROMPT_KEY, "").strip()
        if not prompt:
            raise ValueError(f"_base.yaml thiếu field '{_BASE_PROMPT_KEY}' hoặc rỗng.")

        self.base_system_prompt = prompt
        logger.debug("Loaded _base.yaml (%d chars)", len(prompt))

    def _load_skills(self, skills_dir: Path) -> None:
        yaml_files = sorted(
            p for p in skills_dir.glob("*.yaml") if p.name != _BASE_YAML_NAME
        )
        if not yaml_files:
            logger.warning("Không tìm thấy skill YAML nào trong %s", skills_dir)
            return

        for yaml_path in yaml_files:
            self._load_one_skill(yaml_path)

    def _load_one_skill(self, yaml_path: Path) -> None:
        with yaml_path.open(encoding="utf-8") as f:
            data = yaml.safe_load(f)

        try:
            skill = AnalysisSkill(**data)
        except ValidationError as exc:
            raise ValueError(
                f"Skill YAML '{yaml_path.name}' không hợp lệ: {exc}"
            ) from exc

        if skill.skill_id in self._skills_by_id:
            logger.warning(
                "Duplicate skill_id '%s' từ file '%s' — bỏ qua",
                skill.skill_id, yaml_path.name,
            )
            return

        self._skills_by_id[skill.skill_id] = skill

        for issue_type in skill.issue_types:
            if issue_type in self._skills_by_issue_type:
                existing_id = self._skills_by_issue_type[issue_type].skill_id
                logger.warning(
                    "issue_type '%s' đã được map bởi skill '%s', bị override bởi '%s'",
                    issue_type, existing_id, skill.skill_id,
                )
            self._skills_by_issue_type[issue_type] = skill

        logger.debug(
            "Loaded skill '%s' covering issue_types: %s",
            skill.skill_id, skill.issue_types,
        )

    def get_skill(self, issue_type: str) -> AnalysisSkill:
        """
        Trả về skill cho issue_type.
        Fallback: generic skill nếu issue_type không có mapping.

        Raises:
            RuntimeError: nếu load_all() chưa được gọi
            ValueError: nếu không có skill nào (kể cả generic)
        """
        if not self._loaded:
            raise RuntimeError("SkillLoader chưa load. Gọi load_all() trước.")

        skill = self._skills_by_issue_type.get(issue_type)
        if skill is not None:
            return skill

        generic = self._skills_by_id.get(_GENERIC_SKILL_ID)
        if generic is not None:
            logger.info(
                "Không có skill cho issue_type='%s', dùng generic fallback",
                issue_type,
            )
            return generic

        raise ValueError(
            f"Không tìm thấy skill cho issue_type='{issue_type}' "
            "và không có generic.yaml fallback."
        )

    def list_skills(self) -> list[AnalysisSkill]:
        """Trả về danh sách tất cả skills — dùng cho GET /skills endpoint."""
        return list(self._skills_by_id.values())

    def get_issue_type_mapping(self) -> dict[str, str]:
        """Trả về mapping issue_type → skill_id — dùng để debug."""
        return {
            issue_type: skill.skill_id
            for issue_type, skill in self._skills_by_issue_type.items()
        }
