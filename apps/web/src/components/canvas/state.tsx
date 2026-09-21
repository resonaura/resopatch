import type { Node } from '@xyflow/react';
import { createContext, useContext, useState, type PropsWithChildren } from 'react';
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { mergeRouteCache } from '../../lib/routing/worker/route-cache';
import type { Point } from '../../lib/routing/types';

interface CanvasRoutingState {
  routes: ReadonlyMap<string, Point[]>;
  powerAdapterNodes: Node[];
  animatedRouteIds: ReadonlySet<string>;
  publish: (routes: Map<string, Point[]>, powerAdapterNodes: Node[]) => void;
  markRouteAnimated: (edgeId: string) => void;
}

type CanvasRoutingStore = StoreApi<CanvasRoutingState>;

function createCanvasRoutingStore(): CanvasRoutingStore {
  return createStore<CanvasRoutingState>((set) => ({
    routes: new Map(),
    powerAdapterNodes: [],
    animatedRouteIds: new Set(),
    publish: (routes, powerAdapterNodes) =>
      set((state) => ({
        routes: mergeRouteCache(state.routes, routes),
        powerAdapterNodes,
      })),
    markRouteAnimated: (edgeId) =>
      set((state) => {
        if (state.animatedRouteIds.has(edgeId)) return state;
        return { animatedRouteIds: new Set(state.animatedRouteIds).add(edgeId) };
      }),
  }));
}

const CanvasRoutingContext = createContext<CanvasRoutingStore | null>(null);

/** Owns routing state for one canvas, preventing main/modal route-store collisions. */
export function CanvasRoutingProvider({ children }: PropsWithChildren) {
  const [store] = useState(createCanvasRoutingStore);
  return <CanvasRoutingContext.Provider value={store}>{children}</CanvasRoutingContext.Provider>;
}

export function useCanvasRouting<T>(selector: (state: CanvasRoutingState) => T): T {
  const store = useContext(CanvasRoutingContext);
  if (!store) throw new Error('useCanvasRouting must be used inside CanvasRoutingProvider');
  return useStore(store, selector);
}
