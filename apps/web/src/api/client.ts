import type {
  AdapterDto,
  CableDto,
  ChangePasswordDto,
  CreateAdapterDto,
  CreateCableDto,
  CreateDeviceDto,
  CreateFurnitureDto,
  CreatePortDto,
  CreateSetupDto,
  DeviceDto,
  FurnitureDto,
  InputListRow,
  PortDto,
  PowerBudgetResult,
  RiderRow,
  SetupDto,
  UpdateCableDto,
  UpdateDeviceDto,
  UpdatePortDto,
} from '@resopatch/shared';

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3001';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      message = body.message ?? message;
      if (Array.isArray(message)) message = message.join(', ');
      if (typeof message === 'object') message = JSON.stringify(message);
    } catch {
      // ignore — use statusText
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export interface GraphDevice extends DeviceDto {
  ports: PortDto[];
  furniture: FurnitureDto | null;
}
export interface GraphCable extends CableDto {
  adapterName: string | null;
}
export interface GraphResponse {
  devices: GraphDevice[];
  cables: GraphCable[];
  adapters: AdapterDto[];
}

export const api = {
  login: (passphrase: string) => request<{ ok: true }>('/auth/login', { method: 'POST', body: JSON.stringify({ passphrase }) }),
  logout: () => request<{ ok: true }>('/auth/logout', { method: 'POST' }),
  changePassword: (dto: ChangePasswordDto) => request<{ ok: true }>('/auth/password', { method: 'PATCH', body: JSON.stringify(dto) }),

  listSetups: () => request<SetupDto[]>('/setups'),
  createSetup: (dto: CreateSetupDto) => request<SetupDto>('/setups', { method: 'POST', body: JSON.stringify(dto) }),
  getGraph: (setupId: string) => request<GraphResponse>(`/setups/${setupId}/graph`),
  getInputList: (setupId: string, hasKeys = true) =>
    request<InputListRow[]>(`/setups/${setupId}/input-list?hasKeys=${hasKeys}`),
  getRider: (setupId: string, hasKeys = true) => request<RiderRow[]>(`/setups/${setupId}/rider?hasKeys=${hasKeys}`),
  autoLayout: (setupId: string, sizes: Record<string, { width: number; height: number }>) =>
    request<{ updated: number }>(`/setups/${setupId}/auto-layout`, { method: 'POST', body: JSON.stringify({ sizes }) }),

  createDevice: (dto: CreateDeviceDto) => request<DeviceDto>('/devices', { method: 'POST', body: JSON.stringify(dto) }),
  updateDevice: (id: string, dto: UpdateDeviceDto) => request<DeviceDto>(`/devices/${id}`, { method: 'PATCH', body: JSON.stringify(dto) }),
  deleteDevice: (id: string) => request<void>(`/devices/${id}`, { method: 'DELETE' }),
  getPowerBudget: (id: string) => request<PowerBudgetResult>(`/devices/${id}/power-budget`),

  createPort: (dto: CreatePortDto) => request<PortDto>('/ports', { method: 'POST', body: JSON.stringify(dto) }),
  updatePort: (id: string, dto: UpdatePortDto) => request<PortDto>(`/ports/${id}`, { method: 'PATCH', body: JSON.stringify(dto) }),
  deletePort: (id: string) => request<void>(`/ports/${id}`, { method: 'DELETE' }),

  listAdapters: () => request<AdapterDto[]>('/adapters'),
  createAdapter: (dto: CreateAdapterDto) => request<AdapterDto>('/adapters', { method: 'POST', body: JSON.stringify(dto) }),

  createCable: (dto: CreateCableDto) => request<CableDto>('/cables', { method: 'POST', body: JSON.stringify(dto) }),
  updateCable: (id: string, dto: UpdateCableDto) => request<CableDto>(`/cables/${id}`, { method: 'PATCH', body: JSON.stringify(dto) }),
  deleteCable: (id: string) => request<void>(`/cables/${id}`, { method: 'DELETE' }),

  createFurniture: (dto: CreateFurnitureDto) => request<FurnitureDto>('/furniture', { method: 'POST', body: JSON.stringify(dto) }),
  deleteFurniture: (id: string) => request<void>(`/furniture/${id}`, { method: 'DELETE' }),

  uploadImage: (dataUrl: string, fileName?: string) =>
    request<{ url: string }>('/img/upload', { method: 'POST', body: JSON.stringify({ dataUrl, fileName }) }),
};
