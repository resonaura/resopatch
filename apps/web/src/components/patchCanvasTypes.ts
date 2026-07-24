import DeviceNode from './DeviceNode';
import PowerAdapterNode from './PowerAdapterNode';
import RoutedEdge from './RoutedEdge';

export const patchCanvasNodeTypes = {
  device: DeviceNode,
  powerAdapter: PowerAdapterNode,
};
export const patchCanvasEdgeTypes = { routed: RoutedEdge };
