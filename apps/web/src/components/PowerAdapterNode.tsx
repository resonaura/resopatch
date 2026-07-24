/**
 * Real canvas node for an inline PSU / wall-wart that used to float as an
 * edge label. Being a node means: cables route around it, other cards keep out.
 */
import type { NodeProps } from '@xyflow/react';
import { memo } from 'react';
import { useI18n } from '../lib/i18n';

export const PSU_CARD_W = 148;
export const PSU_CARD_H = 52;
/** Always above cables (selected edge = 1001) and device cards. */
export const PSU_Z_INDEX = 2_147_483_647;

export const PSU_NODE_PREFIX = '__psu_card__';

export function isPsuCardId(id: string): boolean {
  return id.startsWith(PSU_NODE_PREFIX);
}

export function psuCardIdForEdge(edgeId: string): string {
  return `${PSU_NODE_PREFIX}${edgeId}`;
}

export function edgeIdFromPsuCard(nodeId: string): string {
  return nodeId.slice(PSU_NODE_PREFIX.length);
}

export type PowerAdapterNodeData = {
  fromVoltage: string;
  toVoltage: string;
  adapterName?: string;
  dcColor: string;
  edgeId: string;
  [key: string]: unknown;
};

function PowerAdapterNodeImpl({ data }: NodeProps) {
  const { t } = useI18n();
  const d = data as unknown as PowerAdapterNodeData;
  return (
    <div
      className="flex items-center gap-2 rounded-md border border-neutral-600 bg-neutral-900/95 px-2.5 py-1.5 shadow-2xl backdrop-blur-md text-[11px] font-mono text-white select-none"
      style={{
        width: PSU_CARD_W,
        height: PSU_CARD_H,
        boxSizing: 'border-box',
        zIndex: PSU_Z_INDEX,
      }}
    >
      <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-amber-500/20 text-amber-400 text-[11px] font-bold">
        🔌
      </div>
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-[9px] uppercase tracking-wider text-neutral-400 font-semibold leading-none">
          {d.adapterName || t('powerSupply')}
        </span>
        <div className="mt-0.5 flex items-center gap-1 text-[10px] font-bold leading-tight">
          <span className="text-red-400">{d.fromVoltage || '120V AC'}</span>
          <span className="text-neutral-500">➔</span>
          <span style={{ color: d.dcColor || '#FF3B30' }}>{d.toVoltage}</span>
        </div>
      </div>
    </div>
  );
}

export default memo(PowerAdapterNodeImpl);
