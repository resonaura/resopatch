# Code architecture

ResoPatch groups source files by domain first and responsibility second. File names use kebab-case;
framework role suffixes belong in the containing directory rather than in names such as
`devices.service.ts`.

## Web application

- `components/<domain>` contains React UI only. Canvas-local Zustand state lives in
  `components/canvas/state.tsx` because it is part of the canvas integration boundary.
- `lib/<domain>` contains framework-independent domain helpers.
- `lib/layout` owns graph layout. Device classification, topology fingerprints, zone assignment,
  crossing reduction, and the layout orchestrator are separate modules.
- `lib/routing/geometry` contains pure point, segment, obstacle, path rendering, and label-placement
  mathematics.
- `lib/routing/pathfinding` contains route search and route selection algorithms.
- `lib/routing/post-processing` contains transformations applied after path search, including cable
  management and parallel-lane separation.
- `lib/routing/adapters` converts application and React Flow data into routing data. Routing
  algorithms must not import React Flow directly.
- `lib/routing/worker` owns the worker boundary, snapshot publication, and diagnostics.

## API application

Each API domain owns its `controller.ts`, `service.ts`, and `module.ts`. Cross-domain infrastructure
has dedicated directories such as `database`, `cache`, `pipeline`, and `common`. Database entity
names describe the entity once (`entities/cable.ts`, not `cable.entity.ts`).

## Shared package

- `domain` contains stable enums, types, and color definitions.
- `contracts` contains transport schemas.
- `validation` contains reusable business validation algorithms.
- `index.ts` is the package's public export boundary.

Keep calculations pure whenever practical. UI, worker, persistence, and framework adapters should
translate data at their boundaries and delegate calculations to the corresponding domain module.
