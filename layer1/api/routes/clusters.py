from __future__ import annotations

import logging

from ...models.cluster import (
    ClusterConnectionTestRequest,
    ClusterCreate,
    ClusterUpdate,
)
from ..http import get_path_param, parse_json_body

logger = logging.getLogger(__name__)


def register_cluster_routes(registry, runtime) -> None:
    def list_clusters(_req):
        items = [item.model_dump(mode="json") for item in runtime.service.list_clusters()]
        return 200, items

    def create_cluster(req):
        try:
            body = parse_json_body(req)
            data = ClusterCreate(**body)
            result = runtime.service.create_cluster(data)
            return 201, result.model_dump(mode="json")
        except ValueError as exc:
            return 400, {"message": str(exc)}
        except Exception as exc:
            return 400, {"message": str(exc)}

    def get_cluster(req):
        cluster_id = get_path_param(req, "id")
        result = runtime.service.get_cluster(cluster_id)
        if result is None:
            return 404, {"message": "Cluster not found"}
        return 200, result.model_dump(mode="json")

    def update_cluster(req):
        cluster_id = get_path_param(req, "id")
        try:
            body = parse_json_body(req)
            data = ClusterUpdate(**body)
            result = runtime.service.update_cluster(cluster_id, data)
            if result is None:
                return 404, {"message": "Cluster not found"}
            return 200, result.model_dump(mode="json")
        except Exception as exc:
            return 400, {"message": str(exc)}

    def delete_cluster(req):
        cluster_id = get_path_param(req, "id")
        deleted = runtime.service.delete_cluster(cluster_id)
        if not deleted:
            return 404, {"message": "Cluster not found"}
        return 200, {"ok": True, "cluster_id": cluster_id}

    def test_cluster(req):
        cluster_id = get_path_param(req, "id")
        cluster = runtime.service.get_cluster_config(cluster_id)
        if cluster is None:
            return 404, {"message": "Cluster not found"}
        logger.info(
            "Cluster test requested: cluster_id=%s nodes=%d host=%s port=%s database=%s username=%s password_present=%s",
            cluster.cluster_id,
            len(cluster.nodes),
            cluster.nodes[0] if cluster.nodes else "",
            cluster.port,
            cluster.database,
            cluster.username,
            bool(cluster.password),
        )
        result = runtime.service.test_cluster_connection(
            ClusterConnectionTestRequest(
                nodes=cluster.nodes,
                port=cluster.port,
                database=cluster.database,
                username=cluster.username,
                password=cluster.password,
            )
        )
        logger.info(
            "Cluster test finished: cluster_id=%s ok=%s latency_ms=%s error=%s",
            cluster.cluster_id,
            result.ok,
            result.latency_ms,
            result.error,
        )
        return 200, result.model_dump(mode="json")

    def test_unsaved_cluster(req):
        try:
            body = parse_json_body(req)
            data = ClusterConnectionTestRequest(**body)
            logger.info(
                "Ad-hoc cluster test requested: nodes=%d host=%s database=%s username=%s",
                len(data.nodes),
                data.nodes[0] if data.nodes else "",
                data.database,
                data.username,
            )
            result = runtime.service.test_cluster_connection(data)
            logger.info("Ad-hoc cluster test finished: ok=%s latency_ms=%s error=%s", result.ok, result.latency_ms, result.error)
            return 200, result.model_dump(mode="json")
        except Exception as exc:
            logger.exception("Ad-hoc cluster test failed before execution: %s", exc)
            return 400, {"message": str(exc)}

    def refresh_roles(req):
        cluster_id = get_path_param(req, "id")
        found = runtime.service.refresh_node_roles(cluster_id)
        if not found:
            return 404, {"message": "Cluster not found or not active"}
        result = runtime.service.get_cluster(cluster_id)
        return 200, result.model_dump(mode="json") if result else {"ok": True}

    registry.add("GET", "/clusters", list_clusters)
    registry.add("POST", "/clusters", create_cluster)
    registry.add("GET", "/clusters/{id}", get_cluster)
    registry.add("PUT", "/clusters/{id}", update_cluster)
    registry.add("DELETE", "/clusters/{id}", delete_cluster)
    registry.add("POST", "/clusters/{id}/test", test_cluster)
    registry.add("POST", "/clusters/{id}/refresh-roles", refresh_roles)
    registry.add("POST", "/clusters/test", test_unsaved_cluster)
