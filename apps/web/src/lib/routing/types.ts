/** Shared types for cable routing (kept free of runtime deps to avoid import cycles). */

export interface RectObstacle {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EdgeRouteSpec {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  start: { x: number; y: number };
  end: { x: number; y: number };
  sourceDir?: 'left' | 'right';
  targetDir?: 'left' | 'right';
  isPowerAdapter?: boolean;
}

export type Point = { x: number; y: number };
