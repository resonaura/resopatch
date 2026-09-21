import DeviceNode from '../devices/node';
import PowerAdapterNode from './power-adapter-node';
import RoutedEdge from './routed-edge';

export const patchCanvasNodeTypes = {
  device: DeviceNode,
  powerAdapter: PowerAdapterNode,
};
export const patchCanvasEdgeTypes = { routed: RoutedEdge };
