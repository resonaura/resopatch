import { Injectable, NotFoundException } from '@nestjs/common';
import { CableType, CreateDeviceDto, DeviceDto, PowerBudgetResult, UpdateDeviceDto } from '@resopatch/shared';
import { applyDeviceDto, toDeviceDto } from '../database/mappers';
import { cablesRepo, devicesRepo, portsRepo, In } from '../database/json-db';

@Injectable()
export class DevicesService {
  async findBySetup(setupId: string): Promise<DeviceDto[]> {
    const devices = await devicesRepo.find({ where: { setupId }, order: { createdAt: 'ASC' } });
    return devices.map(toDeviceDto);
  }

  async findOne(id: string): Promise<DeviceDto> {
    const device = await devicesRepo.findOne({ where: { id } });
    if (!device) throw new NotFoundException('Device not found.');
    return toDeviceDto(device);
  }

  async create(dto: CreateDeviceDto): Promise<DeviceDto> {
    const device = applyDeviceDto(devicesRepo.create(), dto);
    await devicesRepo.save(device);
    return toDeviceDto(device);
  }

  async update(id: string, dto: UpdateDeviceDto): Promise<DeviceDto> {
    const device = await devicesRepo.findOne({ where: { id } });
    if (!device) throw new NotFoundException('Device not found.');
    applyDeviceDto(device, dto);
    await devicesRepo.save(device);
    return toDeviceDto(device);
  }

  async remove(id: string): Promise<void> {
    const result = await devicesRepo.delete(id);
    if (!result.affected) throw new NotFoundException('Device not found.');
  }

  /**
   * Advisory power-budget check for a power source device (PSU / splitter / power strip):
   * sums the declared draw of everything plugged into its POWER_LINE outputs against its
   * declared capacity. Never blocks anything — see docs/stage-setup.md §13. Devices with no
   * voltage/current declared yet are reported separately in `unresolvedLoads`, not silently
   * dropped or treated as zero draw.
   */
  async getPowerBudget(deviceId: string): Promise<PowerBudgetResult> {
    const device = await devicesRepo.findOne({ where: { id: deviceId } });
    if (!device) throw new NotFoundException('Device not found.');

    const sourcePorts = await portsRepo.find({ where: { deviceId } });
    const sourcePortIds = sourcePorts.map((p) => p.id);
    const cables = sourcePortIds.length
      ? await cablesRepo.find({ where: { sourcePortId: In(sourcePortIds), cableType: CableType.POWER_LINE } })
      : [];

    // Manual join (no relations in the JSON store): pull every target port + its owning device
    // once, then look them up per-cable below.
    const targetPortIds = [...new Set(cables.map((c) => c.targetPortId))];
    const targetPorts = targetPortIds.length ? await portsRepo.find({ where: { id: In(targetPortIds) } }) : [];
    const targetPortById = new Map(targetPorts.map((p) => [p.id, p]));
    const targetDeviceIds = [...new Set(targetPorts.map((p) => p.deviceId))];
    const targetDevices = targetDeviceIds.length ? await devicesRepo.find({ where: { id: In(targetDeviceIds) } }) : [];
    const targetDeviceById = new Map(targetDevices.map((d) => [d.id, d]));

    const loads: PowerBudgetResult['loads'] = [];
    const unresolvedLoads: PowerBudgetResult['unresolvedLoads'] = [];
    let drawnPowerW = 0;
    let drawnCurrentMA = 0;

    for (const cable of cables) {
      const targetPort = targetPortById.get(cable.targetPortId);
      const targetDevice = targetPort ? targetDeviceById.get(targetPort.deviceId) : undefined;
      if (!targetDevice) continue;
      const v = targetDevice.powerVoltageV;
      const ma = targetDevice.powerCurrentMA;
      if (v != null && ma != null) {
        const w = (v * ma) / 1000;
        drawnPowerW += w;
        drawnCurrentMA += ma;
        loads.push({ deviceId: targetDevice.id, deviceName: targetDevice.name, watts: w, currentMA: ma });
      } else if (ma != null) {
        drawnCurrentMA += ma;
        loads.push({ deviceId: targetDevice.id, deviceName: targetDevice.name, watts: null, currentMA: ma });
      } else {
        unresolvedLoads.push({ deviceId: targetDevice.id, deviceName: targetDevice.name });
      }
    }

    // Only ports that actually carry a POWER_LINE cable count towards the inferred capacity —
    // summing every port's cap (e.g. a power strip's unrelated USB-C PD rating) alongside AC
    // outlets that have no cap at all would produce a number that doesn't correspond to anything
    // physically meaningful for the load actually being drawn through this device.
    const poweredPortIds = new Set(cables.map((c) => c.sourcePortId));
    const portsCapacityW = sourcePorts
      .filter((p) => poweredPortIds.has(p.id))
      .reduce((sum, p) => sum + (p.powerMaxOutputPowerW ?? 0), 0);
    const maxOutputPowerW = device.powerMaxOutputPowerW ?? (portsCapacityW > 0 ? portsCapacityW : null);
    const maxOutputCurrentMA = device.powerMaxOutputCurrentMA ?? null;

    const overBudget =
      (maxOutputPowerW != null && drawnPowerW > maxOutputPowerW) ||
      (maxOutputCurrentMA != null && drawnCurrentMA > maxOutputCurrentMA);

    return {
      deviceId: device.id,
      deviceName: device.name,
      maxOutputPowerW,
      maxOutputCurrentMA,
      drawnPowerW,
      drawnCurrentMA,
      overBudget,
      loads,
      unresolvedLoads,
    };
  }
}
