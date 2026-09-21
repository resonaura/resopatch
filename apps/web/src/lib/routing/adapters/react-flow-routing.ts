import type { Edge, Node } from '@xyflow/react';

const NIPPLE_WALL_PREFIX = '__nipple_wall__';
const PSU_OBSTACLE_PREFIX = '__psu_card__';

export function isNippleWallId(id: string): boolean {
  return id.startsWith(NIPPLE_WALL_PREFIX);
}

/** Inline PSU cards are plain obstacles and do not receive virtual nipple walls. */
export function isPsuObstacleId(id: string): boolean {
  return id.startsWith(PSU_OBSTACLE_PREFIX);
}

/** Converts visible React Flow cards into the obstacle model consumed by the routing worker. */
export function toRoutingNodesWithNippleWalls(nodes: Node[]): Node[] {
  const routingNodes: Node[] = [];

  for (const node of nodes) {
    if (isNippleWallId(node.id)) continue;

    const width = Number(
      node.measured?.width ?? node.width ?? (isPsuObstacleId(node.id) ? 148 : 240),
    );
    const height = Number(
      node.measured?.height ?? node.height ?? (isPsuObstacleId(node.id) ? 52 : 100),
    );
    routingNodes.push({
      id: node.id,
      type: node.type,
      position: { ...node.position },
      width,
      height,
      measured: { width, height },
      parentId: node.parentId,
      data: {},
    });

    if (isPsuObstacleId(node.id)) continue;

    const horizontalGutter = 12;
    const verticalGutter = 6;
    const wallWidth = Math.max(48, width - horizontalGutter * 2);
    const wallHeight = Math.max(40, height - verticalGutter * 2);
    routingNodes.push({
      id: `${NIPPLE_WALL_PREFIX}${node.id}`,
      position: {
        x: node.position.x + (width - wallWidth) / 2,
        y: node.position.y + (height - wallHeight) / 2,
      },
      width: wallWidth,
      height: wallHeight,
      measured: { width: wallWidth, height: wallHeight },
      data: {},
    });
  }

  return routingNodes;
}

/** Strips presentation-only edge data before handing an edge list to the routing worker. */
export function toRoutingEdges(edges: Edge[]): Edge[] {
  return edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle,
    targetHandle: edge.targetHandle,
    type: edge.type,
    data: {},
  }));
}
