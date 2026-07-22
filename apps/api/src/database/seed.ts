/**
 * Seeds the database with Resonaura's actual stage setup, as documented in
 * `docs/stage-setup.md` (the source of truth for this file — read it first if something
 * here looks surprising). Re-run any time with `pnpm seed`; it drops and recreates the schema,
 * so this is meant to be the reproducible starting point you then edit from the GUI, not a
 * one-time migration.
 *
 * A few things are deliberately left unwired because the real-world facts aren't known yet
 * (see docs/stage-setup.md §12 — none of this is a blocker, just an honest gap):
 *  - Andrey's own pedalboard content (which pedals, in what order) isn't itemized.
 *  - Даня-вокал's 3 pedals exist as named slots but their power wiring is genuinely unknown
 *    (one shared PSU? two PSUs with a splitter? — see §2.2), so their power ports are left
 *    unconnected rather than guessing.
 *  - The playback laptop's own AC charger isn't listed under either Anker in §5, so it's left
 *    unconnected here too rather than inventing a socket for it.
 */
import 'dotenv/config';
import 'reflect-metadata';
import bcrypt from 'bcryptjs';
import { In } from 'typeorm';
import {
  CableType,
  CreateAdapterDto,
  CreateCableDto,
  CreateDeviceDto,
  CreateFurnitureDto,
  CreatePortDto,
  CurrentType,
  DeviceType,
  FurnitureKind,
  HostUsbType,
  InventoryStatus,
  Polarity,
  PortDirection,
  PortType,
  PowerSourceType,
} from '@resopatch/shared';
import { AppDataSource } from './data-source';
import { Setup } from './entities/setup.entity';
import { Device } from './entities/device.entity';
import { Port } from './entities/port.entity';
import { Adapter } from './entities/adapter.entity';
import { Cable } from './entities/cable.entity';
import { Furniture } from './entities/furniture.entity';
import { AuthCredential } from './entities/auth-credential.entity';
import { applyAdapterDto, applyCableDto, applyDeviceDto, applyFurnitureDto, applyPortDto } from './mappers';
import { computeAutoLayout } from '../setups/layout';

async function main() {
  await AppDataSource.initialize();
  // Drop + recreate: this is a re-seedable starting point, not a migration.
  await AppDataSource.synchronize(true);

  const setupRepo = AppDataSource.getRepository(Setup);
  const deviceRepo = AppDataSource.getRepository(Device);
  const portRepo = AppDataSource.getRepository(Port);
  const adapterRepo = AppDataSource.getRepository(Adapter);
  const cableRepo = AppDataSource.getRepository(Cable);
  const furnitureRepo = AppDataSource.getRepository(Furniture);
  const authRepo = AppDataSource.getRepository(AuthCredential);

  // Reseeding also resets the dashboard login back to the known default — useful if it's ever
  // forgotten. Change it from the settings panel in the app once you're in.
  await authRepo.save(authRepo.create({ passphraseHash: bcrypt.hashSync('admin', 10), role: 'admin' }));

  const setup = await setupRepo.save(
    setupRepo.create({
      name: 'Resonaura — концертный сетап',
      description:
        'Живая инвентаризация по docs/stage-setup.md: активная схема текущего простого сета плюс неактивное/плановое/venue-оборудование в общем инвентаре — редактируется в GUI по мере уточнения фактов.',
    }),
  );

  const mkDevice = (overrides: Partial<CreateDeviceDto> & { name: string; type: DeviceType }) =>
    deviceRepo.save(applyDeviceDto(deviceRepo.create(), { setupId: setup.id, ...overrides }));

  const mkPort = (device: Device, overrides: Partial<CreatePortDto> & { name: string; portType: PortType; direction: PortDirection }) =>
    portRepo.save(applyPortDto(portRepo.create(), { deviceId: device.id, ...overrides }));

  const mkAdapter = (overrides: Partial<CreateAdapterDto> & { name: string; inputType: PortType; outputType: PortType }) =>
    adapterRepo.save(applyAdapterDto(adapterRepo.create(), overrides));

  const mkCable = (overrides: Partial<CreateCableDto> & { sourcePortId: string; targetPortId: string; cableType: CableType; length: number }) =>
    cableRepo.save(applyCableDto(cableRepo.create(), overrides));

  const mkFurniture = (overrides: Partial<CreateFurnitureDto> & { deviceId: string; kind: FurnitureKind }) =>
    furnitureRepo.save(applyFurnitureDto(furnitureRepo.create(), overrides));

  // ---------------------------------------------------------------------------------------
  // Adapters (created up front, referenced by id from cables below)
  // ---------------------------------------------------------------------------------------
  const adapterMx400Psu = await mkAdapter({
    name: 'БП Behringer MX400 (12V DC, Center+, собственный)',
    inputType: PortType.POWER_SCHUKO,
    outputType: PortType.DC_BARREL,
  });
  const adapterGoveePsu = await mkAdapter({
    name: 'БП Govee RGBIC Smart Table Lamp 2 (12V DC)',
    inputType: PortType.POWER_SCHUKO,
    outputType: PortType.DC_BARREL,
  });
  const adapterFex800Psu = await mkAdapter({
    name: 'БП Behringer FEX800 (9V AC, родной — только он, DC-блоки несовместимы)',
    inputType: PortType.POWER_SCHUKO,
    outputType: PortType.DC_BARREL,
  });
  const adapterMotuPsu = await mkAdapter({
    name: 'БП MOTU UltraLite-mk3 Hybrid (12V DC, полярность ANY)',
    inputType: PortType.POWER_SCHUKO,
    outputType: PortType.DC_BARREL,
  });
  const adapterUsbAtoB = await mkAdapter({
    name: 'Кабель USB-A → USB-B (для UMC404HD, bus power)',
    inputType: PortType.USB_A,
    outputType: PortType.USB_B,
  });
  const adapterUsbCtoB = await mkAdapter({
    name: 'Кабель USB-C → USB-B (для MOTU UltraLite mk3)',
    inputType: PortType.USB_C,
    outputType: PortType.USB_B,
  });
  const adapterTrs14to18 = await mkAdapter({
    name: 'Переходник TRS 1/4" → TRS 1/8" (мини-джек)',
    inputType: PortType.TRS_14,
    outputType: PortType.TRS_18,
  });
  const adapterTrsToXlr = await mkAdapter({
    name: 'Переходник TRS 1/4" → XLR (M)',
    inputType: PortType.TRS_14,
    outputType: PortType.XLR_M,
  });

  // ---------------------------------------------------------------------------------------
  // Power infrastructure: the venue's own wall outlet (root of the whole power graph — both
  // Ankers plug into it, or into whatever the venue actually gives us on the day), two Anker
  // strips (one per side of stage), + Andrey's isolated pedalboard PSU. See docs/stage-setup.md §5.
  // ---------------------------------------------------------------------------------------
  const venueOutlet = await mkDevice({
    name: 'Розетка площадки',
    type: DeviceType.POWER_STRIP,
    inventoryStatus: InventoryStatus.VENUE_PROVIDED,
    position: { x: -600, y: 850 },
    notes: 'Стена/щиток площадки — куда физически втыкаются оба удлинителя Anker. Количество и тип розеток на месте не гарантированы (docs/stage-setup.md §5.1).',
  });
  const venueOutlet1 = await mkPort(venueOutlet, { name: 'Розетка 1 (→ Anker, сторона Андрея)', portType: PortType.POWER_SCHUKO, direction: PortDirection.OUT, power: { currentType: CurrentType.AC } });
  const venueOutlet2 = await mkPort(venueOutlet, { name: 'Розетка 2 (→ Anker, сторона Дани-вокала)', portType: PortType.POWER_SCHUKO, direction: PortDirection.OUT, power: { currentType: CurrentType.AC } });

  const anker1 = await mkDevice({
    name: 'Anker Surge Protector 2000J — сторона Андрея',
    type: DeviceType.POWER_STRIP,
    ownerRole: 'Андрей',
    position: { x: -300, y: 250 },
    attrs: {
      productName:
        'Anker Surge Protector Flat Plug Power Strip 2000J, 5ft Thin Extension Cord, 8 Outlets, 2 USB A and 1 USB C Port, 20W for iPhone15, Wall Mount, Compact for Home, Office, Room, TUV Listed (White)',
      joules: 2000,
      cordFt: 5,
      outlets: 8,
    },
  });
  const anker1Plug = await mkPort(anker1, { name: 'Вилка (в розетку площадки)', portType: PortType.POWER_SCHUKO, direction: PortDirection.IN, power: { currentType: CurrentType.AC } });
  const anker1SchukoOuts: Port[] = [];
  for (let i = 1; i <= 8; i++) {
    anker1SchukoOuts.push(
      await mkPort(anker1, { name: `Розетка ${i}`, portType: PortType.POWER_SCHUKO, direction: PortDirection.OUT, power: { currentType: CurrentType.AC } }),
    );
  }
  const anker1UsbA1 = await mkPort(anker1, {
    name: 'USB-A #1',
    portType: PortType.USB_A,
    direction: PortDirection.OUT,
    power: { maxOutputPowerW: 12 },
  });
  await mkPort(anker1, { name: 'USB-A #2', portType: PortType.USB_A, direction: PortDirection.OUT, power: { maxOutputPowerW: 12 } });
  const anker1UsbC = await mkPort(anker1, {
    name: 'USB-C (PD)',
    portType: PortType.USB_C,
    direction: PortDirection.OUT,
    power: { maxOutputPowerW: 20 },
  });

  const anker2 = await mkDevice({
    name: 'Anker Surge Protector 2000J — сторона Дани-вокала / плейбеков',
    type: DeviceType.POWER_STRIP,
    ownerRole: 'Даня-вокал',
    position: { x: 900, y: 850 },
    attrs: {
      productName:
        'Anker Surge Protector Flat Plug Power Strip 2000J, 5ft Thin Extension Cord, 8 Outlets, 2 USB A and 1 USB C Port, 20W for iPhone15, Wall Mount, Compact for Home, Office, Room, TUV Listed (White)',
      joules: 2000,
      cordFt: 5,
      outlets: 8,
    },
  });
  const anker2Plug = await mkPort(anker2, { name: 'Вилка (в розетку площадки)', portType: PortType.POWER_SCHUKO, direction: PortDirection.IN, power: { currentType: CurrentType.AC } });
  const anker2SchukoOuts: Port[] = [];
  for (let i = 1; i <= 8; i++) {
    anker2SchukoOuts.push(
      await mkPort(anker2, { name: `Розетка ${i}`, portType: PortType.POWER_SCHUKO, direction: PortDirection.OUT, power: { currentType: CurrentType.AC } }),
    );
  }
  await mkPort(anker2, { name: 'USB-A #1 (резерв — план: микшер Дани-вокала)', portType: PortType.USB_A, direction: PortDirection.OUT, power: { maxOutputPowerW: 12 } });
  await mkPort(anker2, { name: 'USB-A #2', portType: PortType.USB_A, direction: PortDirection.OUT, power: { maxOutputPowerW: 12 } });
  await mkPort(anker2, { name: 'USB-C (PD)', portType: PortType.USB_C, direction: PortDirection.OUT, power: { maxOutputPowerW: 20 } });

  await mkCable({ sourcePortId: venueOutlet1.id, targetPortId: anker1Plug.id, cableType: CableType.POWER_LINE, length: 1.5, color: 'white' });
  await mkCable({ sourcePortId: venueOutlet2.id, targetPortId: anker2Plug.id, cableType: CableType.POWER_LINE, length: 1.5, color: 'white' });

  // ---------------------------------------------------------------------------------------
  // Andrey — stage left. Guitar/bass → pedalboard → UMC404HD, plus his personal post-gig-1
  // monitoring fix (MX400 → Palmer Monicon → headphones). See docs/stage-setup.md §1, §9.
  // ---------------------------------------------------------------------------------------
  const pedalboard = await mkDevice({
    name: 'Педалборд Harley Benton SpaceShip',
    type: DeviceType.PEDALBOARD,
    ownerRole: 'Андрей',
    position: { x: -700, y: 0 },
    powerRequired: true,
    powerSourceType: PowerSourceType.DC_BARREL,
    attrs: { model: 'SpaceShip (точный размер 40/50M/60/60XL не уточнён)', originalMisnomer: 'Starship' },
    notes: '❓ Состав педалей не описан поштучно — дозаполнить в GUI (docs/stage-setup.md §6, §12.2).',
  });
  const pedalboardIn = await mkPort(pedalboard, { name: 'Guitar In', portType: PortType.TS_14, direction: PortDirection.IN });
  const pedalboardOutL = await mkPort(pedalboard, { name: 'Stereo Out L', portType: PortType.TRS_14, direction: PortDirection.OUT });
  const pedalboardOutR = await mkPort(pedalboard, { name: 'Stereo Out R', portType: PortType.TRS_14, direction: PortDirection.OUT });
  const pedalboardPower = await mkPort(pedalboard, {
    name: 'Power In (педали, суммарно)',
    portType: PortType.DC_BARREL,
    direction: PortDirection.IN,
    power: { currentType: CurrentType.DC, voltageV: 9, polarity: Polarity.CENTER_NEGATIVE },
  });

  // Physically straps to the underside of the pedalboard and travels as one unit with it — part
  // of "the pedalboard" the same way the velcro and patch cables are, even though (unlike those)
  // it still has real ports/cables of its own, so it stays a full node on the canvas too.
  const iso12pro = await mkDevice({
    name: 'Harley Benton PowerPlant ISO-12 Pro',
    type: DeviceType.POWER_SUPPLY,
    ownerRole: 'Андрей',
    parentDeviceId: pedalboard.id,
    position: { x: -300, y: 450 },
    powerRequired: true,
    powerSourceType: PowerSourceType.AC_MAINS,
    power: { maxOutputPowerW: 27 },
    notes: 'Изолированный мультиблок питания педалборда Андрея. Глобальный лимит 27W суммарно на все выходы. Крепится к педалборду — физически единое целое с ним.',
  });
  const iso12ProIn = await mkPort(iso12pro, { name: 'Power In', portType: PortType.POWER_SCHUKO, direction: PortDirection.IN, power: { currentType: CurrentType.AC } });
  const iso12Pro9vGroup = await mkPort(iso12pro, {
    name: '9V Group Out (1–9)',
    portType: PortType.DC_BARREL,
    direction: PortDirection.OUT,
    power: { currentType: CurrentType.DC, voltageV: 9, polarity: Polarity.CENTER_NEGATIVE, maxOutputCurrentMA: 300 },
  });
  await mkPort(iso12pro, {
    name: 'A/B/C Group Out (9/12/18V переключаемая)',
    portType: PortType.DC_BARREL,
    direction: PortDirection.OUT,
    power: { currentType: CurrentType.DC, voltageV: 12, polarity: Polarity.CENTER_NEGATIVE, maxOutputCurrentMA: 500 },
  });

  await mkCable({ sourcePortId: anker1SchukoOuts[0].id, targetPortId: iso12ProIn.id, cableType: CableType.POWER_LINE, length: 1 });

  const andreyGuitar = await mkDevice({
    name: 'Гитара Андрея',
    type: DeviceType.INSTRUMENT,
    ownerRole: 'Андрей',
    position: { x: -900, y: 0 },
    attrs: { kind: 'guitar' },
  });
  const andreyGuitarOut = await mkPort(andreyGuitar, { name: 'Jack Out', portType: PortType.TS_14, direction: PortDirection.OUT });

  await mkDevice({
    name: 'Ремень гитары Андрея',
    type: DeviceType.ACCESSORY,
    ownerRole: 'Андрей',
    parentDeviceId: andreyGuitar.id,
    position: { x: -950, y: -100 },
  });
  await mkDevice({
    name: 'TC Electronic PolyTune Clip',
    type: DeviceType.ACCESSORY,
    ownerRole: 'Андрей',
    parentDeviceId: andreyGuitar.id,
    position: { x: -850, y: -100 },
    attrs: { battery: 'CR2032', batteryVoltage: 3, batteryLifeHours: 18 },
    notes: 'Крепится прищепкой на голову грифа, пьезодатчик — автономный, без сигнальных кабелей (docs/stage-setup.md §9).',
  });

  const andreyBass = await mkDevice({
    name: 'Бас-гитара Андрея',
    type: DeviceType.INSTRUMENT,
    ownerRole: 'Андрей',
    position: { x: -1100, y: 150 },
    attrs: { kind: 'bass' },
    notes: 'Используется на некоторых песнях вместо гитары — подключается напрямую в басовый комбик площадки.',
  });
  const andreyBassOut = await mkPort(andreyBass, { name: 'Jack Out', portType: PortType.TS_14, direction: PortDirection.OUT });

  const venueBassCombo = await mkDevice({
    name: 'Басовый комбик (площадки)',
    type: DeviceType.AMPLIFIER,
    ownerRole: 'Андрей',
    inventoryStatus: InventoryStatus.VENUE_PROVIDED,
    position: { x: -1100, y: 300 },
    notes: 'Предоставляется площадкой. Шнур свой.',
  });
  const venueBassComboIn = await mkPort(venueBassCombo, { name: 'Input', portType: PortType.TS_14, direction: PortDirection.IN });
  await mkCable({ sourcePortId: andreyBassOut.id, targetPortId: venueBassComboIn.id, cableType: CableType.AUDIO_UNBALANCED, length: 4 });

  await mkDevice({
    name: 'Липучки крепления педалей',
    type: DeviceType.ACCESSORY,
    ownerRole: 'Андрей',
    parentDeviceId: pedalboard.id,
    position: { x: -700, y: 100 },
  });
  await mkDevice({
    name: 'Патч-кабели педалборда (комплект)',
    type: DeviceType.ACCESSORY,
    ownerRole: 'Андрей',
    parentDeviceId: pedalboard.id,
    position: { x: -650, y: 100 },
  });
  await mkFurniture({ deviceId: pedalboard.id, kind: FurnitureKind.PEDALBOARD_CASE, isVenueProvided: false });
  await mkFurniture({ deviceId: andreyGuitar.id, kind: FurnitureKind.GUITAR_STAND, isVenueProvided: false });

  await mkCable({ sourcePortId: andreyGuitarOut.id, targetPortId: pedalboardIn.id, cableType: CableType.AUDIO_UNBALANCED, length: 0.3, color: 'red' });
  await mkCable({ sourcePortId: iso12Pro9vGroup.id, targetPortId: pedalboardPower.id, cableType: CableType.POWER_LINE, length: 0.3 });

  const umc404hd = await mkDevice({
    name: 'Behringer UMC404HD',
    type: DeviceType.AUDIO_INTERFACE,
    ownerRole: 'Андрей',
    position: { x: -500, y: 0 },
    powerRequired: true,
    powerSourceType: PowerSourceType.USB_BUS,
    hostUsbType: HostUsbType.USB_B,
    power: { currentType: CurrentType.DC, voltageV: 5, currentMA: 1000, polarity: Polarity.CENTER_NEGATIVE },
    notes: 'Bus-powered через USB-A→B от удлинителя Андрея (не отдельным адаптером) — docs/stage-setup.md §1.1.',
  });
  const umcIn1 = await mkPort(umc404hd, { name: 'Combo In 1 (Pedalboard L)', portType: PortType.COMBO_XLR_TRS, direction: PortDirection.IN });
  const umcIn2 = await mkPort(umc404hd, { name: 'Combo In 2 (Pedalboard R)', portType: PortType.COMBO_XLR_TRS, direction: PortDirection.IN });
  const umcOutL = await mkPort(umc404hd, { name: 'Main Out L', portType: PortType.XLR_M, direction: PortDirection.OUT });
  const umcOutR = await mkPort(umc404hd, { name: 'Main Out R', portType: PortType.XLR_M, direction: PortDirection.OUT });
  const umcPhones = await mkPort(umc404hd, { name: 'Phones Out (стерео)', portType: PortType.TRS_14, direction: PortDirection.OUT });
  const umcUsbB = await mkPort(umc404hd, { name: 'USB-B', portType: PortType.USB_B, direction: PortDirection.BI });

  await mkCable({ sourcePortId: pedalboardOutL.id, targetPortId: umcIn1.id, cableType: CableType.AUDIO_BALANCED, length: 1 });
  await mkCable({ sourcePortId: pedalboardOutR.id, targetPortId: umcIn2.id, cableType: CableType.AUDIO_BALANCED, length: 1 });
  await mkCable({ sourcePortId: anker1UsbA1.id, targetPortId: umcUsbB.id, cableType: CableType.USB_DATA, length: 1.5, adapterId: adapterUsbAtoB.id });

  const mx400 = await mkDevice({
    name: 'Behringer MX400 (Micromix)',
    type: DeviceType.MIXER,
    ownerRole: 'Андрей',
    position: { x: -500, y: 250 },
    powerRequired: true,
    powerSourceType: PowerSourceType.DC_BARREL,
    power: { currentType: CurrentType.DC, voltageV: 12, currentMA: 150, polarity: Polarity.CENTER_POSITIVE },
    notes:
      'Отдельный собственный БП — НЕ висит на педалборде/ISO-12 Pro (docs/stage-setup.md §1.3, исправление ошибки прошлого ресёрча). Добавлен после провала с мониторингом плейбеков на первом лайве.',
  });
  const mx400In1 = await mkPort(mx400, { name: 'Ch1 In (плейбек-звуковуха)', portType: PortType.TS_14, direction: PortDirection.IN });
  const mx400In2 = await mkPort(mx400, { name: 'Ch2 In (UMC404HD Phones, стерео→моно)', portType: PortType.TS_14, direction: PortDirection.IN });
  const mx400Out = await mkPort(mx400, { name: 'Mix Out', portType: PortType.TS_14, direction: PortDirection.OUT });
  const mx400Power = await mkPort(mx400, {
    name: 'Power In',
    portType: PortType.DC_BARREL,
    direction: PortDirection.IN,
    power: { currentType: CurrentType.DC, voltageV: 12, currentMA: 150, polarity: Polarity.CENTER_POSITIVE },
  });

  await mkCable({ sourcePortId: umcPhones.id, targetPortId: mx400In2.id, cableType: CableType.AUDIO_UNBALANCED, length: 1 });
  await mkCable({ sourcePortId: anker1SchukoOuts[1].id, targetPortId: mx400Power.id, cableType: CableType.POWER_LINE, length: 1.5, adapterId: adapterMx400Psu.id });

  const palmer = await mkDevice({
    name: 'Palmer Monicon Classic',
    type: DeviceType.MONITOR_CONTROLLER,
    ownerRole: 'Андрей',
    position: { x: -500, y: 400 },
    powerSourceType: PowerSourceType.PASSIVE_NONE,
    notes: 'Полностью пассивный — питание не требуется. Правило: нельзя одновременно использовать Combo(XLR/TRS) и mini-jack 3.5мм входы (земляная петля) — сейчас используется только Combo-вход.',
  });
  const palmerInCombo = await mkPort(palmer, { name: 'Combo In (из MX400)', portType: PortType.COMBO_XLR_TRS, direction: PortDirection.IN });
  await mkPort(palmer, { name: 'Mini-Jack In 3.5mm (не используется)', portType: PortType.TRS_18, direction: PortDirection.IN });
  await mkPort(palmer, { name: 'Out L (XLR)', portType: PortType.XLR_M, direction: PortDirection.OUT });
  await mkPort(palmer, { name: 'Out R (XLR)', portType: PortType.XLR_M, direction: PortDirection.OUT });
  const palmerOutMini = await mkPort(palmer, { name: 'Out (3.5mm, в наушники)', portType: PortType.TRS_18, direction: PortDirection.OUT });

  await mkCable({ sourcePortId: mx400Out.id, targetPortId: palmerInCombo.id, cableType: CableType.AUDIO_UNBALANCED, length: 0.5 });

  const andreyHeadphones = await mkDevice({
    name: 'Наушники Андрея (личный мониторинг)',
    type: DeviceType.MONITOR,
    ownerRole: 'Андрей',
    position: { x: -500, y: 550 },
  });
  const andreyHeadphonesIn = await mkPort(andreyHeadphones, { name: 'In', portType: PortType.TRS_18, direction: PortDirection.IN });
  await mkCable({ sourcePortId: palmerOutMini.id, targetPortId: andreyHeadphonesIn.id, cableType: CableType.AUDIO_UNBALANCED, length: 3 });

  const govee = await mkDevice({
    name: 'Govee RGBIC Smart Table Lamp 2',
    type: DeviceType.LIGHT,
    ownerRole: 'Андрей',
    position: { x: -300, y: 0 },
    powerRequired: true,
    powerSourceType: PowerSourceType.DC_BARREL,
    power: { currentType: CurrentType.DC, voltageV: 12, currentMA: 2000 },
    attrs: { lumens: 500, musicSyncModes: 8, control: ['WiFi', 'BLE', 'Matter'] },
    notes: 'Ставится прямо на сцену. Подключается в последнюю очередь.',
  });
  const goveePower = await mkPort(govee, {
    name: 'Power In',
    portType: PortType.DC_BARREL,
    direction: PortDirection.IN,
    power: { currentType: CurrentType.DC, voltageV: 12, currentMA: 2000 },
  });
  await mkPort(govee, { name: 'Control Link (Wi-Fi/BLE/Matter)', portType: PortType.WIRELESS, direction: PortDirection.BI });
  await mkCable({ sourcePortId: anker1SchukoOuts[2].id, targetPortId: goveePower.id, cableType: CableType.POWER_LINE, length: 1, adapterId: adapterGoveePsu.id });

  // ---------------------------------------------------------------------------------------
  // Даня-вокал — центр сцены. Мик → Volt276 → (IEM напрямую | FEX800 → стейджбокс).
  // Плюс гитара через 3 педали в свой комбик, когда играет. См. docs/stage-setup.md §2.
  // ---------------------------------------------------------------------------------------
  const danyaVMic = await mkDevice({
    name: 'Микрофон Дани-вокала',
    type: DeviceType.MICROPHONE,
    ownerRole: 'Даня-вокал',
    position: { x: 300, y: -150 },
    notes: 'Наш (не площадки) — на площадках это ненадёжно (docs/stage-setup.md §0).',
  });
  const danyaVMicOut = await mkPort(danyaVMic, { name: 'Out', portType: PortType.XLR_M, direction: PortDirection.OUT });
  await mkFurniture({ deviceId: danyaVMic.id, kind: FurnitureKind.MIC_STAND, isVenueProvided: true });

  const volt276 = await mkDevice({
    name: 'Universal Audio Volt 276',
    type: DeviceType.AUDIO_INTERFACE,
    ownerRole: 'Даня-вокал',
    position: { x: 300, y: 0 },
    powerRequired: true,
    powerSourceType: PowerSourceType.USB_C_PD,
    hostUsbType: HostUsbType.USB_C,
    power: { currentType: CurrentType.DC, voltageV: 5, currentMA: 1000 },
  });
  const volt276In1 = await mkPort(volt276, { name: 'Mic In (Combo)', portType: PortType.COMBO_XLR_TRS, direction: PortDirection.IN });
  const volt276Out1 = await mkPort(volt276, { name: 'Output 1 (Monitor/Phones)', portType: PortType.TRS_14, direction: PortDirection.OUT });
  const volt276Out2 = await mkPort(volt276, { name: 'Output 2 (Line)', portType: PortType.TRS_14, direction: PortDirection.OUT });
  const volt276UsbC = await mkPort(volt276, { name: 'USB-C (питание, от удлинителя Андрея)', portType: PortType.USB_C, direction: PortDirection.BI });

  await mkCable({ sourcePortId: danyaVMicOut.id, targetPortId: volt276In1.id, cableType: CableType.AUDIO_BALANCED, length: 5, color: 'red' });
  await mkCable({ sourcePortId: anker1UsbC.id, targetPortId: volt276UsbC.id, cableType: CableType.USB_DATA, length: 6 });

  const danyaVIem = await mkDevice({
    name: 'IEM Дани-вокала (свои)',
    type: DeviceType.MONITOR,
    ownerRole: 'Даня-вокал',
    position: { x: 300, y: -300 },
    notes:
      'Подключены НАПРЯМУЮ в Volt 276 (без микшера — см. план в §2.3). Сейчас Даня-вокал слышит в ушах только себя, не полный мониторный микс — это нормальное текущее состояние (docs/stage-setup.md §2.1).',
  });
  const danyaVIemIn = await mkPort(danyaVIem, { name: 'In', portType: PortType.TRS_18, direction: PortDirection.IN });
  await mkCable({ sourcePortId: volt276Out1.id, targetPortId: danyaVIemIn.id, cableType: CableType.AUDIO_UNBALANCED, length: 3, adapterId: adapterTrs14to18.id });

  const danyaVMixerPlanned = await mkDevice({
    name: 'Стерео-микшер Дани-вокала (план)',
    type: DeviceType.MIXER,
    ownerRole: 'Даня-вокал',
    inventoryStatus: InventoryStatus.PLANNED_NOT_OWNED,
    position: { x: 550, y: -300 },
    notes: 'Не куплен. До покупки актуальна прямая схема Volt276 → IEM (docs/stage-setup.md §2.3).',
  });
  await mkPort(danyaVMixerPlanned, { name: 'In 1 (Volt276 Phones)', portType: PortType.TRS_14, direction: PortDirection.IN });
  await mkPort(danyaVMixerPlanned, { name: 'In 2 (Playback)', portType: PortType.TRS_14, direction: PortDirection.IN });
  await mkPort(danyaVMixerPlanned, { name: 'Out (к IEM)', portType: PortType.TRS_18, direction: PortDirection.OUT });

  const fex800 = await mkDevice({
    name: 'Behringer FEX800 (MINIFEX)',
    type: DeviceType.VOCAL_PROCESSOR,
    ownerRole: 'Даня-вокал',
    position: { x: 300, y: 200 },
    powerRequired: true,
    powerSourceType: PowerSourceType.AC_MAINS,
    power: { currentType: CurrentType.AC, voltageV: 9, currentMA: 750 },
    notes: 'Только родной AC-адаптер — DC-педалбордные блоки категорически несовместимы (docs/stage-setup.md §5.3).',
  });
  const fex800InL = await mkPort(fex800, { name: 'In L', portType: PortType.TS_14, direction: PortDirection.IN });
  await mkPort(fex800, { name: 'In R (не используется)', portType: PortType.TS_14, direction: PortDirection.IN });
  const fex800OutL = await mkPort(fex800, { name: 'Out L', portType: PortType.TRS_14, direction: PortDirection.OUT });
  const fex800OutR = await mkPort(fex800, { name: 'Out R', portType: PortType.TRS_14, direction: PortDirection.OUT });
  const fex800Power = await mkPort(fex800, {
    name: 'Power In',
    portType: PortType.DC_BARREL,
    direction: PortDirection.IN,
    power: { currentType: CurrentType.AC, voltageV: 9, currentMA: 750 },
  });

  await mkCable({ sourcePortId: volt276Out2.id, targetPortId: fex800InL.id, cableType: CableType.AUDIO_UNBALANCED, length: 2 });
  await mkCable({ sourcePortId: anker2SchukoOuts[0].id, targetPortId: fex800Power.id, cableType: CableType.POWER_LINE, length: 1.5, adapterId: adapterFex800Psu.id });

  const danyaVGuitar = await mkDevice({
    name: 'Гитара Дани-вокала',
    type: DeviceType.INSTRUMENT,
    ownerRole: 'Даня-вокал',
    position: { x: 550, y: 350 },
    attrs: { kind: 'guitar' },
    notes: 'Используется не на всех песнях (docs/stage-setup.md §2.2).',
  });
  const danyaVGuitarOut = await mkPort(danyaVGuitar, { name: 'Jack Out', portType: PortType.TS_14, direction: PortDirection.OUT });
  await mkFurniture({ deviceId: danyaVGuitar.id, kind: FurnitureKind.GUITAR_STAND, isVenueProvided: false });

  const danyaVPedals: Device[] = [];
  for (let i = 1; i <= 3; i++) {
    danyaVPedals.push(
      await mkDevice({
        name: `Педаль Дани-вокала №${i} (не заполнено)`,
        type: DeviceType.PEDAL,
        ownerRole: 'Даня-вокал',
        position: { x: 550 + i * 60, y: 480 },
        notes: 'Модель/спеки не заполнены — дозаполнить в GUI (docs/stage-setup.md §2.2, §6).',
      }),
    );
  }
  const pedalPorts = await Promise.all(
    danyaVPedals.map(async (p) => ({
      in: await mkPort(p, { name: 'In', portType: PortType.TS_14, direction: PortDirection.IN }),
      out: await mkPort(p, { name: 'Out', portType: PortType.TS_14, direction: PortDirection.OUT }),
      // Power port deliberately left with no declared voltage/current/polarity — the real
      // wiring (1 shared PSU vs. 2 PSUs + splitter vs. 1 PSU + 3-way splitter) isn't known yet.
      power: await mkPort(p, { name: 'Power In (❓ схема питания не определена)', portType: PortType.DC_BARREL, direction: PortDirection.IN }),
    })),
  );

  const danyaVCombo = await mkDevice({
    name: 'Комбик Дани-вокала (Egnater Tweaker 40W)',
    type: DeviceType.AMPLIFIER,
    ownerRole: 'Даня-вокал',
    position: { x: 750, y: 480 },
    powerRequired: true,
    powerSourceType: PowerSourceType.AC_MAINS,
    power: { currentType: CurrentType.AC },
  });
  const danyaVComboIn = await mkPort(danyaVCombo, { name: 'Input', portType: PortType.TS_14, direction: PortDirection.IN });
  const danyaVComboPower = await mkPort(danyaVCombo, { name: 'Power In', portType: PortType.POWER_SCHUKO, direction: PortDirection.IN, power: { currentType: CurrentType.AC } });
  await mkCable({ sourcePortId: anker2SchukoOuts[1].id, targetPortId: danyaVComboPower.id, cableType: CableType.POWER_LINE, length: 2 });

  await mkCable({ sourcePortId: danyaVGuitarOut.id, targetPortId: pedalPorts[0].in.id, cableType: CableType.AUDIO_UNBALANCED, length: 0.3 });
  await mkCable({ sourcePortId: pedalPorts[0].out.id, targetPortId: pedalPorts[1].in.id, cableType: CableType.AUDIO_UNBALANCED, length: 0.2, isPatchCable: true });
  await mkCable({ sourcePortId: pedalPorts[1].out.id, targetPortId: pedalPorts[2].in.id, cableType: CableType.AUDIO_UNBALANCED, length: 0.2, isPatchCable: true });
  await mkCable({ sourcePortId: pedalPorts[2].out.id, targetPortId: danyaVComboIn.id, cableType: CableType.AUDIO_UNBALANCED, length: 0.5 });

  const e835s = await mkDevice({
    name: 'Sennheiser e835s (на комбик Дани-вокала)',
    type: DeviceType.MICROPHONE,
    ownerRole: 'Даня-вокал',
    position: { x: 850, y: 480 },
    notes: 'Целевое состояние по rider.md (CH11) — не успели поставить на первом лайве, обкатать вживую (docs/stage-setup.md §2.2).',
  });
  const e835sOut = await mkPort(e835s, { name: 'Out', portType: PortType.XLR_M, direction: PortDirection.OUT });
  await mkFurniture({ deviceId: e835s.id, kind: FurnitureKind.MIC_STAND, isVenueProvided: true });

  // ---------------------------------------------------------------------------------------
  // Даня-барабанщик + плейбеки — сзади сцены. Ноут → MOTU → стейджбокс (6 каналов) + клик
  // барабанщику + личный монитор-фид Андрею. См. docs/stage-setup.md §3, §4.
  // ---------------------------------------------------------------------------------------
  const playbackLaptop = await mkDevice({
    name: 'Ноут с плейбеками',
    type: DeviceType.LAPTOP,
    ownerRole: 'Даня-барабанщик',
    position: { x: 1200, y: -150 },
    powerRequired: true,
    powerSourceType: PowerSourceType.USB_C_PD,
    hostUsbType: HostUsbType.USB_C,
    power: { currentType: CurrentType.DC, voltageV: 20, currentMA: 3000 },
    notes: 'Расположен слева от барабанщика. Собственное питание ноута не значится ни в одной из таблиц §5 — не выдумываем розетку, оставлено неподключённым до уточнения.',
  });
  const playbackLaptopUsbC = await mkPort(playbackLaptop, { name: 'USB-C', portType: PortType.USB_C, direction: PortDirection.BI });

  const motu = await mkDevice({
    name: 'MOTU UltraLite-mk3 Hybrid',
    type: DeviceType.AUDIO_INTERFACE,
    ownerRole: 'Даня-барабанщик',
    position: { x: 1200, y: 0 },
    powerRequired: true,
    powerSourceType: PowerSourceType.DC_BARREL,
    power: { currentType: CurrentType.DC, voltageV: 12, currentMA: 1000, polarity: Polarity.ANY },
    notes: 'Полярность блока питания устройству безразлична (ANY) — редкий случай, зафиксировано явно.',
  });
  const motuUsbB = await mkPort(motu, { name: 'USB-B', portType: PortType.USB_B, direction: PortDirection.BI });
  const motuOutBassL = await mkPort(motu, { name: 'Out — Bass L', portType: PortType.TRS_14, direction: PortDirection.OUT });
  const motuOutBassR = await mkPort(motu, { name: 'Out — Bass R', portType: PortType.TRS_14, direction: PortDirection.OUT });
  const motuOutPercL = await mkPort(motu, { name: 'Out — Percussion L', portType: PortType.TRS_14, direction: PortDirection.OUT });
  const motuOutPercR = await mkPort(motu, { name: 'Out — Percussion R', portType: PortType.TRS_14, direction: PortDirection.OUT });
  const motuOutSynthL = await mkPort(motu, { name: 'Out — Synths/BVs L', portType: PortType.TRS_14, direction: PortDirection.OUT });
  const motuOutSynthR = await mkPort(motu, { name: 'Out — Synths/BVs R', portType: PortType.TRS_14, direction: PortDirection.OUT });
  const motuOutAux = await mkPort(motu, { name: 'Aux Out (клик барабанщику)', portType: PortType.TRS_18, direction: PortDirection.OUT });
  const motuOutMonitorFeed = await mkPort(motu, { name: 'Line Out (личный монитор-фид Андрею)', portType: PortType.TS_14, direction: PortDirection.OUT });
  const motuPower = await mkPort(motu, {
    name: 'Power In',
    portType: PortType.DC_BARREL,
    direction: PortDirection.IN,
    power: { currentType: CurrentType.DC, voltageV: 12, currentMA: 1000, polarity: Polarity.ANY },
  });

  await mkCable({ sourcePortId: playbackLaptopUsbC.id, targetPortId: motuUsbB.id, cableType: CableType.USB_DATA, length: 1.5, adapterId: adapterUsbCtoB.id });
  await mkCable({ sourcePortId: anker2SchukoOuts[2].id, targetPortId: motuPower.id, cableType: CableType.POWER_LINE, length: 2, adapterId: adapterMotuPsu.id });
  await mkCable({ sourcePortId: motuOutMonitorFeed.id, targetPortId: mx400In1.id, cableType: CableType.AUDIO_UNBALANCED, length: 10 });

  const danyaDIem = await mkDevice({
    name: 'IEM-комплект Дани-барабанщика (полностью автономный)',
    type: DeviceType.MONITOR,
    ownerRole: 'Даня-барабанщик',
    position: { x: 1400, y: 0 },
    notes: 'Включает полный мониторный микс + клик. Не зависит от площадки, не требует маршрутизации клика отдельно.',
  });
  const danyaDIemIn = await mkPort(danyaDIem, { name: 'Aux In', portType: PortType.TRS_18, direction: PortDirection.IN });
  await mkCable({ sourcePortId: motuOutAux.id, targetPortId: danyaDIemIn.id, cableType: CableType.AUDIO_UNBALANCED, length: 8 });

  await mkDevice({
    name: 'Тарелки Дани-барабанщика',
    type: DeviceType.ACCESSORY,
    ownerRole: 'Даня-барабанщик',
    position: { x: 1400, y: 150 },
  });

  // ---------------------------------------------------------------------------------------
  // Stage box (venue-provided) — 11 input channels matching rider.md CH1–11.
  // ---------------------------------------------------------------------------------------
  const stageBox = await mkDevice({
    name: 'Стейджбокс (площадка)',
    type: DeviceType.STAGE_BOX,
    ownerRole: 'FOH',
    inventoryStatus: InventoryStatus.VENUE_PROVIDED,
    position: { x: 450, y: 700 },
  });
  const ch = async (name: string, portType: PortType) => mkPort(stageBox, { name, portType, direction: PortDirection.IN });
  const ch01 = await ch('CH01 — Bass L', PortType.XLR_F);
  const ch02 = await ch('CH02 — Bass R', PortType.XLR_F);
  const ch03 = await ch('CH03 — Percussion L', PortType.XLR_F);
  const ch04 = await ch('CH04 — Percussion R', PortType.XLR_F);
  const ch05 = await ch('CH05 — Synths/BVs L', PortType.XLR_F);
  const ch06 = await ch('CH06 — Synths/BVs R', PortType.XLR_F);
  const ch07 = await ch('CH07 — Vocal Processing L (джек, под вопросом)', PortType.TRS_14);
  const ch08 = await ch('CH08 — Vocal Processing R (джек, под вопросом)', PortType.TRS_14);
  const ch09 = await ch('CH09 — Main Guitar L', PortType.XLR_F);
  const ch10 = await ch('CH10 — Main Guitar R', PortType.XLR_F);
  const ch11 = await ch("CH11 — Vocalist's Guitar Amp Mic", PortType.XLR_F);

  await mkCable({ sourcePortId: motuOutBassL.id, targetPortId: ch01.id, cableType: CableType.AUDIO_BALANCED, length: 3, adapterId: adapterTrsToXlr.id });
  await mkCable({ sourcePortId: motuOutBassR.id, targetPortId: ch02.id, cableType: CableType.AUDIO_BALANCED, length: 3, adapterId: adapterTrsToXlr.id });
  await mkCable({ sourcePortId: motuOutPercL.id, targetPortId: ch03.id, cableType: CableType.AUDIO_BALANCED, length: 3, adapterId: adapterTrsToXlr.id });
  await mkCable({ sourcePortId: motuOutPercR.id, targetPortId: ch04.id, cableType: CableType.AUDIO_BALANCED, length: 3, adapterId: adapterTrsToXlr.id });
  await mkCable({ sourcePortId: motuOutSynthL.id, targetPortId: ch05.id, cableType: CableType.AUDIO_BALANCED, length: 3, adapterId: adapterTrsToXlr.id });
  await mkCable({ sourcePortId: motuOutSynthR.id, targetPortId: ch06.id, cableType: CableType.AUDIO_BALANCED, length: 3, adapterId: adapterTrsToXlr.id });
  // isUserOwned: false — doc §12.7: cables for Volt276's output run aren't guaranteed to be ours yet
  // ("важно, чтобы предоставила площадка... свой хотя бы один пока не гарантирован").
  await mkCable({ sourcePortId: fex800OutL.id, targetPortId: ch07.id, cableType: CableType.AUDIO_UNBALANCED, length: 5, isUserOwned: false });
  await mkCable({ sourcePortId: fex800OutR.id, targetPortId: ch08.id, cableType: CableType.AUDIO_UNBALANCED, length: 5, isUserOwned: false });
  await mkCable({ sourcePortId: umcOutL.id, targetPortId: ch09.id, cableType: CableType.AUDIO_BALANCED, length: 6, color: 'blue' });
  await mkCable({ sourcePortId: umcOutR.id, targetPortId: ch10.id, cableType: CableType.AUDIO_BALANCED, length: 6, color: 'green' });
  await mkCable({ sourcePortId: e835sOut.id, targetPortId: ch11.id, cableType: CableType.AUDIO_BALANCED, length: 5 });

  await mkFurniture({ deviceId: playbackLaptop.id, kind: FurnitureKind.TABLE, isVenueProvided: true });

  // ---------------------------------------------------------------------------------------
  // MIDI infrastructure — owned, but not part of the current (simplified) active setup.
  // See docs/stage-setup.md §7.
  // ---------------------------------------------------------------------------------------
  const midiThru = await mkDevice({
    name: 'CME MIDI Thru5 WC',
    type: DeviceType.MIDI_DEVICE,
    inventoryStatus: InventoryStatus.OWNED_INACTIVE,
    position: { x: -900, y: 700 },
    attrs: { ins: 1, outs: 5, widiCoreCapable: true },
    notes: 'Для будущего большого сета — сейчас не участвует в активном сетапе (докупать/подключать не нужно).',
  });
  await mkPort(midiThru, { name: 'MIDI In', portType: PortType.MIDI_DIN, direction: PortDirection.IN });
  for (let i = 1; i <= 5; i++) {
    await mkPort(midiThru, { name: `MIDI Thru ${i}`, portType: PortType.MIDI_DIN, direction: PortDirection.OUT });
  }
  await mkPort(midiThru, { name: 'USB-C (питание, опция)', portType: PortType.USB_C, direction: PortDirection.IN });
  await mkPort(midiThru, {
    name: 'Power In (9V, опция)',
    portType: PortType.DC_BARREL,
    direction: PortDirection.IN,
    power: { currentType: CurrentType.DC, voltageV: 9, currentMA: 3, polarity: Polarity.CENTER_NEGATIVE },
  });

  for (let i = 1; i <= 3; i++) {
    await mkDevice({
      name: `MIDI-кабель 5-pin DIN #${i}`,
      type: DeviceType.ACCESSORY,
      inventoryStatus: InventoryStatus.OWNED_INACTIVE,
      position: { x: -800 + i * 40, y: 750 },
    });
  }

  // ---------------------------------------------------------------------------------------
  // 🔜 Big-set future gear — owned but not deployed, no cabling yet (open questions in
  // docs/stage-setup.md §11 need answers before this can be wired up for real).
  // ---------------------------------------------------------------------------------------
  const keyboard = await mkDevice({
    name: 'Arturia KeyLab Essential 61 mk3',
    type: DeviceType.KEYBOARD,
    inventoryStatus: InventoryStatus.OWNED_INACTIVE,
    position: { x: -900, y: 1000 },
    notes:
      'Для будущего большого сета. Открытые вопросы: тот же ли ноут с плейбеками используется или второй; своя стойка или пюпитр площадки; как переключается UMC404HD между хостами (docs/stage-setup.md §11).',
  });
  await mkPort(keyboard, { name: 'USB-C', portType: PortType.USB_C, direction: PortDirection.BI });
  await mkFurniture({ deviceId: keyboard.id, kind: FurnitureKind.KEYBOARD_STAND, isVenueProvided: false });

  await mkDevice({
    name: 'Педаль сустейна (к клавишам)',
    type: DeviceType.ACCESSORY,
    inventoryStatus: InventoryStatus.OWNED_INACTIVE,
    parentDeviceId: keyboard.id,
    position: { x: -800, y: 1000 },
  });

  const secondLaptop = await mkDevice({
    name: 'Ноут для клавиш (big set — ❓ тот же или второй)',
    type: DeviceType.LAPTOP,
    inventoryStatus: InventoryStatus.OWNED_INACTIVE,
    position: { x: -900, y: 1150 },
    powerRequired: true,
    powerSourceType: PowerSourceType.USB_C_PD,
    hostUsbType: HostUsbType.USB_C,
  });
  await mkPort(secondLaptop, { name: 'USB-C', portType: PortType.USB_C, direction: PortDirection.BI });

  // Lay everything out instead of leaving the arbitrary hand-picked x/y above as the persisted
  // state — same algorithm the dashboard's "Упорядочить" button calls, just with sizes estimated
  // from each device's port count (mirroring DeviceNode.tsx's actual box model) since there's no
  // browser here to measure real ones. The button remains available to re-run with exact sizes
  // any time — this just means the app isn't a pile of overlapping boxes on first load.
  const allDevices = await deviceRepo.find({ where: { setupId: setup.id } });
  const allPorts = allDevices.length ? await portRepo.find({ where: { deviceId: In(allDevices.map((d) => d.id)) } }) : [];
  const allCables = allPorts.length ? await cableRepo.find({ where: { sourcePortId: In(allPorts.map((p) => p.id)) } }) : [];

  const portCountByDevice = new Map<string, number>();
  for (const p of allPorts) portCountByDevice.set(p.deviceId, (portCountByDevice.get(p.deviceId) ?? 0) + 1);

  const estimatedSizes = new Map<string, { width: number; height: number }>();
  for (const d of allDevices) {
    const portCount = portCountByDevice.get(d.id) ?? 0;
    const ownerRow = d.ownerRole ? 20 : 0;
    const portsBlock = portCount > 0 ? 1 + portCount * 23 : 0;
    estimatedSizes.set(d.id, { width: 220, height: 2 + 28 + 30 + ownerRow + portsBlock });
  }

  const { positions } = computeAutoLayout(allDevices, allPorts, allCables, estimatedSizes);
  for (const d of allDevices) {
    const pos = positions.get(d.id);
    if (pos) {
      d.positionX = pos.x;
      d.positionY = pos.y;
    }
  }
  await deviceRepo.save(allDevices);

  console.log(`Seeded setup ${setup.id} ("${setup.name}")`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
  });
