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
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
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
import { Device } from './entities/device.entity.js';
import { Port } from './entities/port.entity.js';
import { applyAdapterDto, applyCableDto, applyDeviceDto, applyFurnitureDto, applyPortDto } from './mappers.js';
import {
  adaptersRepo,
  authRepo as authRepoStore,
  cablesRepo,
  devicesRepo,
  furnitureRepo as furnitureRepoStore,
  portsRepo,
  resetDatabase,
  setupsRepo,
  In,
} from './json-db.js';
import { computeAutoLayout } from '../setups/layout.js';

async function main() {
  // Wipes the JSON store back to empty — the one genuinely destructive step, and only ever run
  // deliberately via `pnpm seed`. Normal GUI edits live in the same file the rest of the time and
  // are never touched by restarting the server.
  resetDatabase();

  const setupRepo = setupsRepo;
  const deviceRepo = devicesRepo;
  const portRepo = portsRepo;
  const adapterRepo = adaptersRepo;
  const cableRepo = cablesRepo;
  const furnitureRepo = furnitureRepoStore;
  const authRepo = authRepoStore;

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
    name: 'ANDTOBO 1/4" Male to 1/8" Female Stereo Audio Jack Adapter (Black, non-threaded)',
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
  // ---------------------------------------------------------------------------------------
  // Power infrastructure: two venue wall outlets (one per side) + two Anker extension cords
  // (one per side of stage), + Andrey's isolated pedalboard PSU. See docs/stage-setup.md §5.
  // ---------------------------------------------------------------------------------------
  const venueOutlet1 = await mkDevice({
    name: 'Розетка площадки (сторона Андрея)',
    type: DeviceType.POWER_STRIP,
    ownerRole: 'Андрей',
    inventoryStatus: InventoryStatus.VENUE_PROVIDED,
    position: { x: -600, y: 250 },
    notes: 'Стена/щиток площадки — куда втыкается удлинитель Anker стороны Андрея.',
  });
  const venueOutlet1Port = await mkPort(venueOutlet1, {
    name: 'Розетка',
    portType: PortType.POWER_SCHUKO,
    direction: PortDirection.OUT,
    power: { currentType: CurrentType.AC },
  });

  const venueOutlet2 = await mkDevice({
    name: 'Розетка площадки (сторона Дани-вокала)',
    type: DeviceType.POWER_STRIP,
    ownerRole: 'Даня-вокал',
    inventoryStatus: InventoryStatus.VENUE_PROVIDED,
    position: { x: 600, y: 850 },
    notes: 'Стена/щиток площадки — куда втыкается удлинитель Anker стороны Дани-вокала.',
  });
  const venueOutlet2Port = await mkPort(venueOutlet2, {
    name: 'Розетка',
    portType: PortType.POWER_SCHUKO,
    direction: PortDirection.OUT,
    power: { currentType: CurrentType.AC },
  });

  const venueOutlet3 = await mkDevice({
    name: 'Розетка площадки (комбик Дани-вокала)',
    type: DeviceType.POWER_STRIP,
    ownerRole: 'Даня-вокал',
    inventoryStatus: InventoryStatus.VENUE_PROVIDED,
    position: { x: 750, y: 650 },
    notes: 'Отдельная розетка стены/щитка площадки прямо у комбика — не через удлинитель Anker.',
  });
  const venueOutlet3Port = await mkPort(venueOutlet3, {
    name: 'Розетка',
    portType: PortType.POWER_SCHUKO,
    direction: PortDirection.OUT,
    power: { currentType: CurrentType.AC },
  });

  const anker1 = await mkDevice({
    name: 'Anker Surge Protector 2000J — сторона Андрея',
    type: DeviceType.POWER_STRIP,
    ownerRole: 'Андрей',
    position: { x: -300, y: 250 },
    imageUrl: 'anker-cord.webp',
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
    imageUrl: 'anker-cord.webp',
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
  const anker2UsbA1 = await mkPort(anker2, { name: 'USB-A #1 (резерв)', portType: PortType.USB_A, direction: PortDirection.OUT, power: { maxOutputPowerW: 12 } });
  await mkPort(anker2, { name: 'USB-A #2', portType: PortType.USB_A, direction: PortDirection.OUT, power: { maxOutputPowerW: 12 } });
  await mkPort(anker2, { name: 'USB-C (PD)', portType: PortType.USB_C, direction: PortDirection.OUT, power: { maxOutputPowerW: 20 } });

  await mkCable({ sourcePortId: venueOutlet1Port.id, targetPortId: anker1Plug.id, cableType: CableType.POWER_LINE, length: 1.5, color: 'white' });
  await mkCable({ sourcePortId: venueOutlet2Port.id, targetPortId: anker2Plug.id, cableType: CableType.POWER_LINE, length: 1.5, color: 'white' });

  // ---------------------------------------------------------------------------------------
  // Andrey — stage left. Guitar/bass → pedalboard → UMC404HD, plus his personal post-gig-1
  // monitoring fix (MX400 → Palmer Monicon → headphones). See docs/stage-setup.md §1, §9.
  // ---------------------------------------------------------------------------------------
  // A real parent container: the 11 pedals + ISO-12 Pro below are all `parentDeviceId: pedalboard.id`
  // children, rendered nested inside this card (DeviceNode.tsx) rather than as loose floating
  // nodes — physically they all travel and get patched as one unit. The pedalboard itself carries
  // no ports of its own anymore (it did briefly, as a placeholder aggregate, before the individual
  // pedals were itemized) — the guitar cables straight into the first pedal and the last pedal's
  // stereo out cables straight into UMC404HD, same as ISO-12 Pro's own ports already did.
  const pedalboard = await mkDevice({
    name: 'Педалборд Harley Benton SpaceShip 60XL',
    type: DeviceType.PEDALBOARD,
    ownerRole: 'Андрей',
    position: { x: -700, y: 0 },
    powerRequired: true,
    powerSourceType: PowerSourceType.DC_BARREL,
    attrs: { manufacturer: 'Harley Benton', model: 'SpaceShip 60XL' },
    notes: 'Состав педалей — см. дочерние устройства ниже, в порядке сигнальной цепи. Велкро включено в комплект поставки.',
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
    imageUrl: 'andrii-pedalboard-power.png',
    attrs: { manufacturer: 'Harley Benton', model: 'PowerPlant ISO-12 Pro' },
    notes:
      'Изолированный мультиблок питания педалборда Андрея. Глобальный лимит 27W суммарно на все выходы. Крепится к педалборду — физически единое целое с ним. Кабели питания входят в комплект поставки блока — докупать не нужно.',
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
    name: 'Squier Bullet Mustang HH',
    type: DeviceType.INSTRUMENT,
    ownerRole: 'Андрей',
    position: { x: -900, y: 0 },
    imageUrl: 'guitar-andrii.webp',
    attrs: { kind: 'guitar', manufacturer: 'Squier', model: 'Bullet Mustang HH', color: 'Imperial Blue' },
  });
  const andreyGuitarOut = await mkPort(andreyGuitar, { name: 'Jack Out', portType: PortType.TS_14, direction: PortDirection.OUT });

  await mkDevice({
    name: 'Ремень гитары Андрея',
    type: DeviceType.ACCESSORY,
    ownerRole: 'Андрей',
    parentDeviceId: andreyGuitar.id,
    position: { x: -950, y: -100 },
    imageUrl: 'andrii-guitar-strap.png',
  });
  await mkDevice({
    name: 'TC Electronic PolyTune Clip',
    type: DeviceType.ACCESSORY,
    ownerRole: 'Андрей',
    parentDeviceId: andreyGuitar.id,
    position: { x: -850, y: -100 },
    imageUrl: 'andrii-tuner.png',
    attrs: { battery: 'CR2032', batteryVoltage: 3, batteryLifeHours: 18 },
    notes: 'Крепится прищепкой на голову грифа, пьезодатчик — автономный, без сигнальных кабелей (docs/stage-setup.md §9).',
  });

  const andreyBass = await mkDevice({
    name: 'Harley Benton JB-75MN SB Vintage Series',
    type: DeviceType.INSTRUMENT,
    ownerRole: 'Андрей',
    position: { x: -1100, y: 150 },
    imageUrl: 'andrii-bass.png',
    attrs: { kind: 'bass', manufacturer: 'Harley Benton', model: 'JB-75MN SB Vintage Series', color: 'Sunburst' },
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
    notes: 'Идёт в комплекте поставки педалборда Harley Benton SpaceShip 60XL — докупать не нужно.',
  });
  await mkDevice({
    name: 'Патч-кабели педалборда (запасной комплект)',
    type: DeviceType.ACCESSORY,
    ownerRole: 'Андрей',
    parentDeviceId: pedalboard.id,
    position: { x: -650, y: 100 },
    attrs: { manufacturer: 'AZOR', model: 'Guitar Patch Cable 1/4 Inch 6-Pack Right Angle, 4 Inch (Multicolored)' },
    notes: 'Запасная упаковка патч-кабелей — 12 коротких + 1 длинный (Cordial) уже подключены как рёбра графа между педалями; это физический запасной комплект.',
  });
  await mkFurniture({ deviceId: pedalboard.id, kind: FurnitureKind.PEDALBOARD_CASE, isVenueProvided: false });
  await mkFurniture({ deviceId: andreyGuitar.id, kind: FurnitureKind.GUITAR_STAND, isVenueProvided: false });

  // -------------------------------------------------------------------------------------
  // Andrey's 11-pedal chain, in signal order. Every pedal is a `parentDeviceId: pedalboard.id`
  // child (see pedalboard's own comment above) powered off ISO-12 Pro's shared 9V group — that
  // group is one physical multi-jack output on the real PSU, modeled here as one port with many
  // cables fanned out from it, same convention already used for every other shared power group in
  // this file (e.g. each Anker outlet). Mono until FS05 Multi Modulation, which is the point the
  // signal becomes stereo for the rest of the chain (FS05 → D-Seed II → FS02 → FS07 → UMC404HD).
  // -------------------------------------------------------------------------------------
  const yellowComp = await mkDevice({
    name: 'Mooer Yellow Comp',
    type: DeviceType.PEDAL,
    ownerRole: 'Андрей',
    parentDeviceId: pedalboard.id,
    position: { x: -680, y: 150 },
    powerRequired: true,
    powerSourceType: PowerSourceType.DC_BARREL,
    power: { currentType: CurrentType.DC, voltageV: 9, currentMA: 10, polarity: Polarity.CENTER_NEGATIVE },
    pedal: { isStereoIn: false, isStereoOut: false },
    imageUrl: 'andrii-pedalboard-1-yellow-comp.webp',
    attrs: {
      manufacturer: 'Mooer',
      model: 'Yellow Comp (Optical Compressor)',
      controls: ['Volume — выходной уровень (Gain Compensation)', 'EQ — баланс высоких и низких частот (тембр)', 'Comp — степень компрессии (центральный регулятор)'],
      footswitch: 'Mechanical True Bypass (Вкл / Выкл).',
    },
  });
  const yellowCompIn = await mkPort(yellowComp, { name: 'Mono In', portType: PortType.TS_14, direction: PortDirection.IN });
  const yellowCompOut = await mkPort(yellowComp, { name: 'Mono Out', portType: PortType.TS_14, direction: PortDirection.OUT });
  const yellowCompPower = await mkPort(yellowComp, {
    name: 'Power In',
    portType: PortType.DC_BARREL,
    direction: PortDirection.IN,
    power: { currentType: CurrentType.DC, voltageV: 9, currentMA: 10, polarity: Polarity.CENTER_NEGATIVE },
  });

  const cs400 = await mkDevice({
    name: 'Behringer CS400 Compressor-Sustainer',
    type: DeviceType.PEDAL,
    ownerRole: 'Андрей',
    parentDeviceId: pedalboard.id,
    position: { x: -640, y: 150 },
    powerRequired: true,
    powerSourceType: PowerSourceType.DC_BARREL,
    power: { currentType: CurrentType.DC, voltageV: 9, currentMA: 10, polarity: Polarity.CENTER_NEGATIVE },
    pedal: { isStereoIn: false, isStereoOut: false },
    imageUrl: 'andrii-pedalboard-2-compressor-sustainer.webp',
    attrs: {
      manufacturer: 'Behringer',
      model: 'CS400 (аналог Boss CS-3)',
      controls: ['LEVEL (MIN-MAX) — выходная громкость', 'TONE (LO-HI) — срезка/усиление верхов', 'ATTACK (MIN-MAX) — время срабатывания атаки', 'SUSTAIN (MIN-MAX) — глубина поддержания угасающего звука'],
      footswitch: 'Электронный мягкий переключатель (Вкл / Выкл).',
    },
  });
  const cs400In = await mkPort(cs400, { name: 'Mono In', portType: PortType.TS_14, direction: PortDirection.IN });
  const cs400Out = await mkPort(cs400, { name: 'Mono Out', portType: PortType.TS_14, direction: PortDirection.OUT });
  const cs400Power = await mkPort(cs400, {
    name: 'Power In',
    portType: PortType.DC_BARREL,
    direction: PortDirection.IN,
    power: { currentType: CurrentType.DC, voltageV: 9, currentMA: 10, polarity: Polarity.CENTER_NEGATIVE },
  });

  const to800 = await mkDevice({
    name: 'Behringer TO800 Vintage Tube Overdrive',
    type: DeviceType.PEDAL,
    ownerRole: 'Андрей',
    parentDeviceId: pedalboard.id,
    position: { x: -600, y: 150 },
    powerRequired: true,
    powerSourceType: PowerSourceType.DC_BARREL,
    power: { currentType: CurrentType.DC, voltageV: 9, currentMA: 10, polarity: Polarity.CENTER_NEGATIVE },
    pedal: { isStereoIn: false, isStereoOut: false },
    imageUrl: 'andrii-pedalboard-3-tube-overdrive.webp',
    attrs: {
      manufacturer: 'Behringer',
      model: 'TO800 (бюджетный аналог Ibanez TS808 Tube Screamer, чип 4558)',
      controls: ['DRIVE (MIN-MAX) — уровень перегруза / насыщения', 'TONE (LO-HI) — тембральный фильтр (горб по средней частоте)', 'LEVEL (MIN-MAX) — выходная громкость'],
      footswitch: 'Вкл / Выкл.',
    },
  });
  const to800In = await mkPort(to800, { name: 'Mono In', portType: PortType.TS_14, direction: PortDirection.IN });
  const to800Out = await mkPort(to800, { name: 'Mono Out', portType: PortType.TS_14, direction: PortDirection.OUT });
  const to800Power = await mkPort(to800, {
    name: 'Power In',
    portType: PortType.DC_BARREL,
    direction: PortDirection.IN,
    power: { currentType: CurrentType.DC, voltageV: 9, currentMA: 10, polarity: Polarity.CENTER_NEGATIVE },
  });

  const grunge = await mkDevice({
    name: 'DigiTech Grunge Distortion',
    type: DeviceType.PEDAL,
    ownerRole: 'Андрей',
    parentDeviceId: pedalboard.id,
    position: { x: -560, y: 150 },
    powerRequired: true,
    powerSourceType: PowerSourceType.DC_BARREL,
    power: { currentType: CurrentType.DC, voltageV: 9, currentMA: 20, polarity: Polarity.CENTER_NEGATIVE },
    pedal: { isStereoIn: false, isStereoOut: false },
    imageUrl: 'andrii-pedalboard-4-grunge.png',
    attrs: {
      manufacturer: 'DigiTech',
      model: 'Grunge',
      controls: ['LOUD — общая громкость', 'LOW — регулятор басового регистра', 'HIGH — регулятор высоких частот', 'GRUNGE — уровень гейна / структуры перегруза'],
      footswitch: 'Механический (Вкл / Выкл).',
    },
    notes: 'MIXER OUT MONO (параллельный выход с пассивным эмулятором кабинета) присутствует физически, но не используется — в цепь идёт только AMP OUT.',
  });
  const grungeIn = await mkPort(grunge, { name: 'Mono In', portType: PortType.TS_14, direction: PortDirection.IN });
  const grungeAmpOut = await mkPort(grunge, { name: 'Amp Out Mono (в цепь)', portType: PortType.TS_14, direction: PortDirection.OUT });
  await mkPort(grunge, { name: 'Mixer Out Mono (не используется)', portType: PortType.TS_14, direction: PortDirection.OUT });
  const grungePower = await mkPort(grunge, {
    name: 'Power In',
    portType: PortType.DC_BARREL,
    direction: PortDirection.IN,
    power: { currentType: CurrentType.DC, voltageV: 9, currentMA: 20, polarity: Polarity.CENTER_NEGATIVE },
  });

  const fs06 = await mkDevice({
    name: 'FLAMMA FS06 Digital Preamp',
    type: DeviceType.PEDAL,
    ownerRole: 'Андрей',
    parentDeviceId: pedalboard.id,
    position: { x: -520, y: 150 },
    powerRequired: true,
    powerSourceType: PowerSourceType.DC_BARREL,
    power: { currentType: CurrentType.DC, voltageV: 9, currentMA: 300, polarity: Polarity.CENTER_NEGATIVE },
    pedal: { isStereoIn: false, isStereoOut: false, hasPresets: true },
    imageUrl: 'andrii-pedalboard-5-preamp.webp',
    attrs: {
      manufacturer: 'Flamma',
      model: 'FS06 (2-канальный цифровой преамп)',
      controls: ['GAIN', 'BASS', 'MID', 'TREBLE', 'LEVEL', 'SAVE/SELECT — сохранение и выбор пресета'],
      footswitch: 'Одиночный клик — переключение Clean (синяя LED) / Drive (красная LED) канала. Удержание — переключение в режим стандартного On/Off Bypass. Ручки автосохраняются под каждый пресет.',
      algorithms: [
        'DELUXEBLUE (Fender Blues Deluxe) — Clean/Drive',
        'AC31 (VOX AC30) — Clean/Drive',
        'CORAL REEF (Two Rock Coral) — Clean/Drive',
        'PLEX50 (Marshall Plexi 50) — Clean/Drive',
        'BLUE EYE 100 (Friedman BE-100) — Clean/Drive',
        'MB5TH GEN (Mesa Boogie MARK V) — Clean/Drive',
        'HVE 5151 (EVH 5150) — Clean/Drive',
      ],
    },
  });
  const fs06In = await mkPort(fs06, { name: 'Mono In', portType: PortType.TS_14, direction: PortDirection.IN });
  const fs06Out = await mkPort(fs06, { name: 'Mono Out', portType: PortType.TS_14, direction: PortDirection.OUT });
  const fs06Power = await mkPort(fs06, {
    name: 'Power In',
    portType: PortType.DC_BARREL,
    direction: PortDirection.IN,
    power: { currentType: CurrentType.DC, voltageV: 9, currentMA: 300, polarity: Polarity.CENTER_NEGATIVE },
  });

  const fc14 = await mkDevice({
    name: 'FLAMMA FC14 Analog Chorus',
    type: DeviceType.PEDAL,
    ownerRole: 'Андрей',
    parentDeviceId: pedalboard.id,
    position: { x: -480, y: 150 },
    powerRequired: true,
    powerSourceType: PowerSourceType.DC_BARREL,
    power: { currentType: CurrentType.DC, voltageV: 9, currentMA: 13, polarity: Polarity.CENTER_NEGATIVE },
    pedal: { isStereoIn: false, isStereoOut: false },
    imageUrl: 'andrii-pedalboard-6-chorus.webp',
    attrs: {
      manufacturer: 'Flamma',
      model: 'FC14 (аналоговый хорус, микро-формат, BBD-схема)',
      controls: ['RATE — скорость (большая ручка)', 'LEVEL — микс', 'DEPTH — глубина'],
      footswitch: 'True Bypass (Вкл / Выкл).',
    },
  });
  const fc14In = await mkPort(fc14, { name: 'Mono In', portType: PortType.TS_14, direction: PortDirection.IN });
  const fc14Out = await mkPort(fc14, { name: 'Mono Out', portType: PortType.TS_14, direction: PortDirection.OUT });
  const fc14Power = await mkPort(fc14, {
    name: 'Power In',
    portType: PortType.DC_BARREL,
    direction: PortDirection.IN,
    power: { currentType: CurrentType.DC, voltageV: 9, currentMA: 13, polarity: Polarity.CENTER_NEGATIVE },
  });

  const jetEngine = await mkDevice({
    name: 'Mooer Jet Engine Flanger',
    type: DeviceType.PEDAL,
    ownerRole: 'Андрей',
    parentDeviceId: pedalboard.id,
    position: { x: -440, y: 150 },
    powerRequired: true,
    powerSourceType: PowerSourceType.DC_BARREL,
    power: { currentType: CurrentType.DC, voltageV: 9, currentMA: 160, polarity: Polarity.CENTER_NEGATIVE },
    pedal: { isStereoIn: false, isStereoOut: false },
    imageUrl: 'andrii-pedalboard-7-flanger.png',
    attrs: {
      manufacturer: 'Mooer',
      model: 'Jet Engine Flanger (цифровой многорежимный)',
      controls: ['RATE (большая ручка)', 'DEPTH', 'LEVEL', 'WIDTH'],
      footswitch: 'True Bypass (Вкл / Выкл).',
    },
  });
  const jetEngineIn = await mkPort(jetEngine, { name: 'Mono In', portType: PortType.TS_14, direction: PortDirection.IN });
  const jetEngineOut = await mkPort(jetEngine, { name: 'Mono Out', portType: PortType.TS_14, direction: PortDirection.OUT });
  const jetEnginePower = await mkPort(jetEngine, {
    name: 'Power In',
    portType: PortType.DC_BARREL,
    direction: PortDirection.IN,
    power: { currentType: CurrentType.DC, voltageV: 9, currentMA: 160, polarity: Polarity.CENTER_NEGATIVE },
  });

  // Signal becomes stereo from here on — FS05 takes a mono in and fans out to stereo L/R, and
  // every pedal after it is stereo in/out all the way to UMC404HD.
  const fs05 = await mkDevice({
    name: 'FLAMMA FS05 Multi Modulation',
    type: DeviceType.PEDAL,
    ownerRole: 'Андрей',
    parentDeviceId: pedalboard.id,
    position: { x: -400, y: 150 },
    powerRequired: true,
    powerSourceType: PowerSourceType.DC_BARREL,
    power: { currentType: CurrentType.DC, voltageV: 9, currentMA: 300, polarity: Polarity.CENTER_NEGATIVE },
    pedal: { isStereoIn: false, isStereoOut: true, hasPresets: true, presetCount: 7 },
    imageUrl: 'andrii-pedalboard-8-mod.png',
    attrs: {
      manufacturer: 'Flamma',
      model: 'FS05 (стерео комбайн эффектов модуляции, 11 алгоритмов / 7 пресетов)',
      controls: ['RATE', 'DEPTH', 'TYPE — 11-позиционная крутилка', 'CTRL 1', 'CTRL 2', 'SAVE/SELECT'],
      footswitch: 'Короткий клик — On/Off (Bypass). Удержание 1 сек — переключение пресетов (1→7), SAVE мигает.',
      algorithms: [
        '1. CHORUS (Ctrl1 Mix / Ctrl2 Tone)',
        '2. FLANGER (Mix / Feedback)',
        '3. TREMOLO (Duty / Tone)',
        '4. PHASE (Mix / Tone)',
        '5. VIBRATO (Mix / Tone)',
        '6. ROTARY (Mix / Tone)',
        '7. LIQUID (Mix / Tone)',
        '8. AUTO WAH (Mix / Tone)',
        '9. STUTTER (Duty / Tone)',
        '10. RING (Pitch / Tone)',
        '11. LOW BIT (Smooth / Bit Rate)',
      ],
    },
  });
  const fs05InL = await mkPort(fs05, { name: 'Mono In L', portType: PortType.TS_14, direction: PortDirection.IN });
  await mkPort(fs05, { name: 'In R (не используется)', portType: PortType.TS_14, direction: PortDirection.IN });
  const fs05OutL = await mkPort(fs05, { name: 'Stereo Out L', portType: PortType.TS_14, direction: PortDirection.OUT });
  const fs05OutR = await mkPort(fs05, { name: 'Stereo Out R', portType: PortType.TS_14, direction: PortDirection.OUT });
  const fs05Power = await mkPort(fs05, {
    name: 'Power In',
    portType: PortType.DC_BARREL,
    direction: PortDirection.IN,
    power: { currentType: CurrentType.DC, voltageV: 9, currentMA: 300, polarity: Polarity.CENTER_NEGATIVE },
  });

  const dseed2 = await mkDevice({
    name: 'JOYO D-Seed II Stereo Delay & Looper',
    type: DeviceType.PEDAL,
    ownerRole: 'Андрей',
    parentDeviceId: pedalboard.id,
    position: { x: -360, y: 150 },
    powerRequired: true,
    powerSourceType: PowerSourceType.DC_BARREL,
    power: { currentType: CurrentType.DC, voltageV: 9, currentMA: 220, polarity: Polarity.CENTER_NEGATIVE },
    pedal: { isStereoIn: true, isStereoOut: true },
    imageUrl: 'andrii-pedalboard-9-delay.webp',
    attrs: {
      manufacturer: 'Joyo',
      model: 'D-Seed II (стерео дилей + 3.5-мин стерео-лупер)',
      controls: ['TYPE — выбор эффекта/Looper', 'TIME BEAT / LP.FX', 'LEVEL / LP.LEVEL', 'F.BACK / LP.TONE', 'PingPong — вкл/выкл объёмное стерео-панорамирование повторов'],
      footswitch:
        'Двойной футсвич. В режиме Delay: левый = Tap Tempo / пресеты, правый = Bypass. В режиме Looper: левый = Rec / Dub / Rerecord, правый = Play / Stop / Clear.',
      algorithms: ['Space', 'Lo-Fi', 'Filter', 'Tape', 'Copy (Digital)', 'Analog', 'Mod', 'Reverse', 'LOOPER — до 3.5 мин стерео, неограниченные overdubs'],
    },
  });
  const dseed2InL = await mkPort(dseed2, { name: 'Stereo In L', portType: PortType.TS_14, direction: PortDirection.IN });
  const dseed2InR = await mkPort(dseed2, { name: 'Stereo In R', portType: PortType.TS_14, direction: PortDirection.IN });
  const dseed2OutL = await mkPort(dseed2, { name: 'Stereo Out L', portType: PortType.TS_14, direction: PortDirection.OUT });
  const dseed2OutR = await mkPort(dseed2, { name: 'Stereo Out R', portType: PortType.TS_14, direction: PortDirection.OUT });
  const dseed2Power = await mkPort(dseed2, {
    name: 'Power In',
    portType: PortType.DC_BARREL,
    direction: PortDirection.IN,
    power: { currentType: CurrentType.DC, voltageV: 9, currentMA: 220, polarity: Polarity.CENTER_NEGATIVE },
  });

  const fs02 = await mkDevice({
    name: 'FLAMMA FS02 Stereo Reverb',
    type: DeviceType.PEDAL,
    ownerRole: 'Андрей',
    parentDeviceId: pedalboard.id,
    position: { x: -320, y: 150 },
    powerRequired: true,
    powerSourceType: PowerSourceType.DC_BARREL,
    power: { currentType: CurrentType.DC, voltageV: 9, currentMA: 300, polarity: Polarity.CENTER_NEGATIVE },
    pedal: { isStereoIn: true, isStereoOut: true, hasPresets: true, presetCount: 7 },
    imageUrl: 'andrii-pedalboard-10-rev.png',
    attrs: {
      manufacturer: 'Flamma',
      model: 'FS02 (стерео ревербератор с хвостами)',
      controls: ['LEVEL', 'DECAY', 'HI-CUT', 'LO-CUT', 'SAVE/SELECT'],
      footswitch: 'Trails On/Off (затухание хвостов) — зажать футсвич при подаче питания.',
      algorithms: ['Room', 'Hall', 'Church', 'Cave', 'Plate', 'Spring', 'Mod'],
    },
  });
  const fs02InL = await mkPort(fs02, { name: 'Stereo In L', portType: PortType.TS_14, direction: PortDirection.IN });
  const fs02InR = await mkPort(fs02, { name: 'Stereo In R', portType: PortType.TS_14, direction: PortDirection.IN });
  const fs02OutL = await mkPort(fs02, { name: 'Stereo Out L', portType: PortType.TS_14, direction: PortDirection.OUT });
  const fs02OutR = await mkPort(fs02, { name: 'Stereo Out R', portType: PortType.TS_14, direction: PortDirection.OUT });
  const fs02Power = await mkPort(fs02, {
    name: 'Power In',
    portType: PortType.DC_BARREL,
    direction: PortDirection.IN,
    power: { currentType: CurrentType.DC, voltageV: 9, currentMA: 300, polarity: Polarity.CENTER_NEGATIVE },
  });

  const fs07 = await mkDevice({
    name: 'FLAMMA FS07 Stereo Cabinet Simulation',
    type: DeviceType.PEDAL,
    ownerRole: 'Андрей',
    parentDeviceId: pedalboard.id,
    position: { x: -280, y: 150 },
    powerRequired: true,
    powerSourceType: PowerSourceType.DC_BARREL,
    power: { currentType: CurrentType.DC, voltageV: 9, currentMA: 300, polarity: Polarity.CENTER_NEGATIVE },
    pedal: { isStereoIn: true, isStereoOut: true },
    imageUrl: 'andrii-pedalboard-11-cab.webp',
    attrs: {
      manufacturer: 'Flamma',
      model: 'FS07 (стерео кабсим и IR Loader, 24-bit/44.1kHz)',
      controls: ['LEVEL', 'LATENCY — фазировка стерео', 'HIGH CUT', 'LOW CUT', 'SAVE/SELECT', 'Power Amp Sim — переключатель'],
      algorithms: [
        'Fender Deluxe 1x12',
        'Vox AC30 2x12',
        'Twin Reverb 2x12',
        'Marshall 1960A 4x12',
        'Mesa Rectifier 4x12',
        'Diezel V30 4x12',
        'Orange PPC412 4x12',
        'Soldano SLO 4x12',
        'Engl Pro 4x12',
        'Peavey 5150 4x12',
        'EBS ProLine 4x10 (Bass)',
      ],
    },
    notes: 'Поддерживает загрузку сторонних IR через Micro-USB — не используется live, только для оффлайн-настройки.',
  });
  const fs07InL = await mkPort(fs07, { name: 'Stereo In L', portType: PortType.TS_14, direction: PortDirection.IN });
  const fs07InR = await mkPort(fs07, { name: 'Stereo In R', portType: PortType.TS_14, direction: PortDirection.IN });
  const fs07OutL = await mkPort(fs07, { name: 'Stereo Out L', portType: PortType.TS_14, direction: PortDirection.OUT });
  const fs07OutR = await mkPort(fs07, { name: 'Stereo Out R', portType: PortType.TS_14, direction: PortDirection.OUT });
  await mkPort(fs07, { name: 'Micro-USB (к ПК, offline IR-загрузка)', portType: PortType.USB_B, direction: PortDirection.BI });
  const fs07Power = await mkPort(fs07, {
    name: 'Power In',
    portType: PortType.DC_BARREL,
    direction: PortDirection.IN,
    power: { currentType: CurrentType.DC, voltageV: 9, currentMA: 300, polarity: Polarity.CENTER_NEGATIVE },
  });

  // Andrey's patch cable kit: 12 short (AZOR 6-pack — buy two) + 1 long (Cordial Essentials,
  // crosses from board row 2 to row 3) — see docs/stage-setup.md and Task #23 hardware catalog.
  // Exact row-crossing connection is a provisional pick (real board layout / wire specs TBD).
  const AZOR_PATCH_CABLE = 'AZOR Guitar Patch Cable 1/4 Inch 6-Pack Right Angle, 4 Inch Instrument Cables for Guitar Bass Effect Pedals (Multicolored)';
  const CORDIAL_LONG_PATCH_CABLE = 'Cordial Essentials 6.35mm TRS Balanced Cable – 1.5m CMN 220';

  await mkCable({
    sourcePortId: andreyGuitarOut.id,
    targetPortId: yellowCompIn.id,
    cableType: CableType.AUDIO_UNBALANCED,
    length: 3,
    color: 'red',
    productName: 'Fender Professional Series Tweed Instrument Cable',
  });
  const pedalChain: { out: Port; in: Port }[] = [
    { out: yellowCompOut, in: cs400In },
    { out: cs400Out, in: to800In },
    { out: to800Out, in: grungeIn },
    { out: grungeAmpOut, in: fs06In },
    { out: fs06Out, in: fc14In },
    { out: fc14Out, in: jetEngineIn }, // provisional: the one cable crossing board row 2 → row 3
    { out: jetEngineOut, in: fs05InL },
  ];
  for (const [i, link] of pedalChain.entries()) {
    const isLongCrossRow = i === 5;
    await mkCable({
      sourcePortId: link.out.id,
      targetPortId: link.in.id,
      cableType: CableType.AUDIO_UNBALANCED,
      length: isLongCrossRow ? 1.5 : 0.1,
      isPatchCable: true,
      productName: isLongCrossRow ? CORDIAL_LONG_PATCH_CABLE : AZOR_PATCH_CABLE,
    });
  }
  const stereoPedalChain: { outL: Port; outR: Port; inL: Port; inR: Port }[] = [
    { outL: fs05OutL, outR: fs05OutR, inL: dseed2InL, inR: dseed2InR },
    { outL: dseed2OutL, outR: dseed2OutR, inL: fs02InL, inR: fs02InR },
    { outL: fs02OutL, outR: fs02OutR, inL: fs07InL, inR: fs07InR },
  ];
  for (const link of stereoPedalChain) {
    await mkCable({ sourcePortId: link.outL.id, targetPortId: link.inL.id, cableType: CableType.AUDIO_UNBALANCED, length: 0.1, isPatchCable: true, productName: AZOR_PATCH_CABLE });
    await mkCable({ sourcePortId: link.outR.id, targetPortId: link.inR.id, cableType: CableType.AUDIO_UNBALANCED, length: 0.1, isPatchCable: true, productName: AZOR_PATCH_CABLE });
  }

  for (const powerIn of [yellowCompPower, cs400Power, to800Power, grungePower, fs06Power, fc14Power, jetEnginePower, fs05Power, dseed2Power, fs02Power, fs07Power]) {
    await mkCable({ sourcePortId: iso12Pro9vGroup.id, targetPortId: powerIn.id, cableType: CableType.POWER_LINE, length: 0.15 });
  }

  const umc404hd = await mkDevice({
    name: 'Behringer UMC404HD',
    type: DeviceType.AUDIO_INTERFACE,
    ownerRole: 'Андрей',
    position: { x: -500, y: 0 },
    powerRequired: true,
    powerSourceType: PowerSourceType.USB_BUS,
    hostUsbType: HostUsbType.USB_B,
    power: { currentType: CurrentType.DC, voltageV: 5, currentMA: 1000, polarity: Polarity.CENTER_NEGATIVE },
    imageUrl: 'umc404hd-front-back.png',
    attrs: {
      manufacturer: 'Behringer',
      model: 'UMC404HD — 4x4 USB 2.0, 24-bit/192kHz, MIDAS-преампы',
      controls: ['LINE/INST переключатель', 'PAD (-20dB)', 'Stereo/Mono monitoring', 'Main/PB 1-2 source'],
    },
    notes:
      'Bus-powered через USB-A→B от удлинителя Андрея (не отдельным адаптером) — docs/stage-setup.md §1.1. Альтернативно поддерживает отдельный DC 5V/1000mA адаптер (не используется сейчас).',
  });
  const umcIn1 = await mkPort(umc404hd, { name: 'Combo In 1 (Pedalboard L)', portType: PortType.COMBO_XLR_TRS, direction: PortDirection.IN });
  const umcIn2 = await mkPort(umc404hd, { name: 'Combo In 2 (Pedalboard R)', portType: PortType.COMBO_XLR_TRS, direction: PortDirection.IN });
  await mkPort(umc404hd, { name: 'Combo In 3 (не используется)', portType: PortType.COMBO_XLR_TRS, direction: PortDirection.IN });
  await mkPort(umc404hd, { name: 'Combo In 4 (не используется)', portType: PortType.COMBO_XLR_TRS, direction: PortDirection.IN });
  const umcOutL = await mkPort(umc404hd, { name: 'Main Out L', portType: PortType.XLR_M, direction: PortDirection.OUT });
  const umcOutR = await mkPort(umc404hd, { name: 'Main Out R', portType: PortType.XLR_M, direction: PortDirection.OUT });
  for (let i = 1; i <= 4; i++) {
    await mkPort(umc404hd, { name: `Playback Out ${i} (не используется)`, portType: PortType.TRS_14, direction: PortDirection.OUT });
  }
  for (let i = 1; i <= 4; i++) {
    await mkPort(umc404hd, { name: `Analog Insert ${i} (не используется)`, portType: PortType.TRS_14, direction: PortDirection.BI });
  }
  const umcPhones = await mkPort(umc404hd, { name: 'Phones Out (стерео)', portType: PortType.TRS_14, direction: PortDirection.OUT });
  await mkPort(umc404hd, { name: 'MIDI In (не используется)', portType: PortType.MIDI_DIN, direction: PortDirection.IN });
  await mkPort(umc404hd, { name: 'MIDI Out (не используется)', portType: PortType.MIDI_DIN, direction: PortDirection.OUT });
  const umcUsbB = await mkPort(umc404hd, { name: 'USB-B', portType: PortType.USB_B, direction: PortDirection.BI });

  await mkCable({ sourcePortId: fs07OutL.id, targetPortId: umcIn1.id, cableType: CableType.AUDIO_BALANCED, length: 1 });
  await mkCable({ sourcePortId: fs07OutR.id, targetPortId: umcIn2.id, cableType: CableType.AUDIO_BALANCED, length: 1 });
  await mkCable({ sourcePortId: anker1UsbA1.id, targetPortId: umcUsbB.id, cableType: CableType.USB_DATA, length: 1.5, adapterId: adapterUsbAtoB.id });

  const mx400 = await mkDevice({
    name: 'Behringer MX400 (Micromix)',
    type: DeviceType.MIXER,
    ownerRole: 'Андрей',
    position: { x: -500, y: 250 },
    powerRequired: true,
    powerSourceType: PowerSourceType.DC_BARREL,
    power: { currentType: CurrentType.DC, voltageV: 12, currentMA: 150, polarity: Polarity.CENTER_POSITIVE },
    imageUrl: 'behringer-mx400-top.png',
    attrs: {
      manufacturer: 'Behringer',
      model: 'MX400 (Micromix) — компактный 4-канальный моно линейный микшер',
      controls: ['4 независимых регулятора Input Level (1–4)'],
    },
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
    imageUrl: 'palmer-front.png',
    imageUrls: ['palmer-front.png', 'palmer-back.png'],
    attrs: {
      manufacturer: 'Palmer',
      model: 'Monicon Classic — полностью пассивный стерео мониторный контроллер',
      controls: ['Volume — массивная ручка', 'MUTE', 'MONO — суммирование сигналов в моно'],
    },
    notes: 'Полностью пассивный — питание не требуется. Правило: нельзя одновременно использовать Combo(XLR/TRS) и mini-jack 3.5мм входы (земляная петля) — сейчас используется только Combo-вход.',
  });
  const palmerInCombo = await mkPort(palmer, { name: 'Combo In (из MX400)', portType: PortType.COMBO_XLR_TRS, direction: PortDirection.IN });
  await mkPort(palmer, { name: 'Mini-Jack In 3.5mm (не используется)', portType: PortType.TRS_18, direction: PortDirection.IN });
  await mkPort(palmer, { name: 'Out L (XLR)', portType: PortType.XLR_M, direction: PortDirection.OUT });
  await mkPort(palmer, { name: 'Out R (XLR)', portType: PortType.XLR_M, direction: PortDirection.OUT });
  const palmerOutMini = await mkPort(palmer, { name: 'Out (3.5mm, в наушники)', portType: PortType.TRS_18, direction: PortDirection.OUT });

  await mkCable({ sourcePortId: mx400Out.id, targetPortId: palmerInCombo.id, cableType: CableType.AUDIO_UNBALANCED, length: 0.5 });

  const andreyHeadphones = await mkDevice({
    name: 'Audio-Technica ATH-PRO5XWH',
    type: DeviceType.MONITOR,
    ownerRole: 'Андрей',
    position: { x: -500, y: 550 },
    imageUrl: 'andrii-headphones.webp',
    attrs: {
      manufacturer: 'Audio-Technica',
      model: 'ATH-PRO5XWH Professional Closed-Back Dynamic Over-Ear DJ Monitor Headphones',
      color: 'White',
    },
  });
  const andreyHeadphonesIn = await mkPort(andreyHeadphones, { name: 'In', portType: PortType.TRS_18, direction: PortDirection.IN });
  await mkCable({ sourcePortId: palmerOutMini.id, targetPortId: andreyHeadphonesIn.id, cableType: CableType.AUDIO_UNBALANCED, length: 3 });
  await mkDevice({
    name: 'Переходник 1/4" TRS → 1/8" (навинчивающийся)',
    type: DeviceType.ACCESSORY,
    ownerRole: 'Андрей',
    parentDeviceId: andreyHeadphones.id,
    position: { x: -500, y: 600 },
    notes: 'Резьбовой (screw-on) переходник TRS 1/4" → 1/8" для наушников Андрея.',
  });

  const govee = await mkDevice({
    name: 'Govee RGBIC Smart Table Lamp 2',
    type: DeviceType.LIGHT,
    ownerRole: 'Андрей',
    position: { x: -300, y: 0 },
    powerRequired: true,
    powerSourceType: PowerSourceType.DC_BARREL,
    power: { currentType: CurrentType.DC, voltageV: 12, currentMA: 2000 },
    imageUrl: 'andrii-lamp.png',
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
    imageUrl: 'dan-vocalist-mic.webp',
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
    imageUrl: 'volt276-front.webp',
    imageUrls: ['volt276-front.webp', 'volt276-back.webp', 'volt276-top.png'],
    attrs: {
      manufacturer: 'Universal Audio',
      model: 'Volt 276 — 2x2 USB-C, встроенный аналоговый компрессор 1176',
      controls: ['Vintage Preamp Switch (ламповый окрас)', '76 Compressor presets (VOCAL, GTR, FAST, OFF)', 'Direct Monitor'],
    },
  });
  const volt276In1 = await mkPort(volt276, { name: 'Mic In (Combo)', portType: PortType.COMBO_XLR_TRS, direction: PortDirection.IN });
  await mkPort(volt276, { name: 'In 2 (Combo, не используется)', portType: PortType.COMBO_XLR_TRS, direction: PortDirection.IN });
  const volt276Out1 = await mkPort(volt276, { name: 'Output 1 (Monitor/Phones)', portType: PortType.TRS_14, direction: PortDirection.OUT });
  const volt276Out2 = await mkPort(volt276, { name: 'Output 2 (Line)', portType: PortType.TRS_14, direction: PortDirection.OUT });
  await mkPort(volt276, { name: 'MIDI In (не используется)', portType: PortType.MIDI_DIN, direction: PortDirection.IN });
  await mkPort(volt276, { name: 'MIDI Out (не используется)', portType: PortType.MIDI_DIN, direction: PortDirection.OUT });
  const volt276UsbC = await mkPort(volt276, { name: 'USB-C (питание, от удлинителя Андрея)', portType: PortType.USB_C, direction: PortDirection.BI });

  await mkCable({ sourcePortId: danyaVMicOut.id, targetPortId: volt276In1.id, cableType: CableType.AUDIO_BALANCED, length: 5, color: 'red' });
  await mkCable({ sourcePortId: anker1UsbC.id, targetPortId: volt276UsbC.id, cableType: CableType.USB_DATA, length: 6 });

  const danyaVIem = await mkDevice({
    name: 'KZ ZS10 Pro IEM Earphones (Purple, No Mic)',
    type: DeviceType.MONITOR,
    ownerRole: 'Даня-вокал',
    position: { x: 300, y: -300 },
    imageUrl: 'dan-vocalist-iem.png',
    attrs: { manufacturer: 'KZ', model: 'ZS10 Pro IEM Earphones (No Mic)', color: 'Purple' },
    notes:
      'Подключены НАПРЯМУЮ в Volt 276 (без микшера). Сейчас Даня-вокал слышит в ушах только себя, не полный мониторный микс — это нормальное текущее состояние (docs/stage-setup.md §2.1).',
  });
  const danyaVIemIn = await mkPort(danyaVIem, { name: 'In', portType: PortType.TRS_18, direction: PortDirection.IN });
  await mkCable({
    sourcePortId: volt276Out1.id,
    targetPortId: danyaVIemIn.id,
    cableType: CableType.AUDIO_UNBALANCED,
    length: 7.6,
    adapterId: adapterTrs14to18.id,
    productName: 'Pig Hog PHX14-25 1/4" TRSF to 1/4" TRSM Headphone Extension Cable, 25 Feet',
  });

  const fex800 = await mkDevice({
    name: 'Behringer FEX800 (MINIFEX)',
    type: DeviceType.VOCAL_PROCESSOR,
    ownerRole: 'Даня-вокал',
    position: { x: 300, y: 200 },
    powerRequired: true,
    powerSourceType: PowerSourceType.AC_MAINS,
    power: { currentType: CurrentType.AC, voltageV: 9, currentMA: 750 },
    imageUrl: 'fex800-front.webp',
    imageUrls: ['fex800-front.webp', 'fex800-back.webp'],
    attrs: {
      manufacturer: 'Behringer',
      model: 'FEX800 (MINIFEX) — 16-битный цифровой процессор эффектов, 16 пресетов',
      controls: ['Встроенный Tap Tempo'],
      algorithms: ['Reverb', 'Delay', 'Modulation', 'Pitch Shifter'],
    },
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
    name: 'Jackson JS Series Dinky Arch Top JS22-7 DKA HT',
    type: DeviceType.INSTRUMENT,
    ownerRole: 'Даня-вокал',
    position: { x: 550, y: 350 },
    imageUrl: 'dan-vocalist-guitar.webp',
    attrs: {
      kind: 'guitar',
      manufacturer: 'Jackson Guitars',
      model: 'JS Series Dinky Arch Top JS22-7 DKA HT, Amaranth Fingerboard',
      color: 'Satin Black',
    },
    notes: 'Используется не на всех песнях (docs/stage-setup.md §2.2).',
  });
  const danyaVGuitarOut = await mkPort(danyaVGuitar, { name: 'Jack Out', portType: PortType.TS_14, direction: PortDirection.OUT });
  await mkFurniture({ deviceId: danyaVGuitar.id, kind: FurnitureKind.GUITAR_STAND, isVenueProvided: false });

  const tu3 = await mkDevice({
    name: 'Boss TU-3 Chromatic Tuner',
    type: DeviceType.PEDAL,
    ownerRole: 'Даня-вокал',
    position: { x: 610, y: 480 },
    powerRequired: true,
    powerSourceType: PowerSourceType.DC_BARREL,
    power: { currentType: CurrentType.DC, voltageV: 9, currentMA: 30, polarity: Polarity.CENTER_NEGATIVE },
    imageUrl: 'dan-vocalist-tuner-pedal.png',
    attrs: {
      manufacturer: 'Boss',
      model: 'TU-3 (или TU-2) Chromatic Tuner',
      controls: ['21-сегментный светодиодный индикатор', 'режим Stream/Cent', 'поддержка дроп-строёв (Flat tuning до 6 полутонов)'],
      footswitch: 'Включение режима настройки — отключает сигнал на OUTPUT (Mute).',
    },
    notes:
      'Питание — отдельный одноканальный БП (см. ниже), плюс раздаёт свой daisy-chain выход джампером напрямую на FC03 (3-я педаль в цепи). Итого: 3 педали запитаны от 2 одноканальных БП + 1 джампер (docs/stage-setup.md §2.2/§12.4).',
  });
  const tu3In = await mkPort(tu3, { name: 'Input (с гитары Дани-вокала)', portType: PortType.TS_14, direction: PortDirection.IN });
  const tu3Out = await mkPort(tu3, { name: 'Output (с mute при настройке)', portType: PortType.TS_14, direction: PortDirection.OUT });
  const tu3Power = await mkPort(tu3, {
    name: 'Power In',
    portType: PortType.DC_BARREL,
    direction: PortDirection.IN,
    power: { currentType: CurrentType.DC, voltageV: 9, currentMA: 30, polarity: Polarity.CENTER_NEGATIVE },
  });
  const tu3DaisyOut = await mkPort(tu3, {
    name: '9V DC OUT (Daisy Chain, джампер на FC03)',
    portType: PortType.DC_BARREL,
    direction: PortDirection.OUT,
    power: { currentType: CurrentType.DC, voltageV: 9, polarity: Polarity.CENTER_NEGATIVE, maxOutputCurrentMA: 200 },
  });

  const danyaVPsu1 = await mkDevice({
    name: 'БП педалей Дани-вокала #1 (одноканальный, 9V — Boss TU-3)',
    type: DeviceType.POWER_SUPPLY,
    ownerRole: 'Даня-вокал',
    position: { x: 590, y: 550 },
    powerRequired: true,
    powerSourceType: PowerSourceType.AC_MAINS,
    power: { currentType: CurrentType.DC, voltageV: 9, maxOutputCurrentMA: 200 },
    notes: 'Одноканальный БП — питает только тюнер. Тюнер сам раздаёт daisy-chain джампером на FC03 (3-я педаль).',
  });
  const danyaVPsu1In = await mkPort(danyaVPsu1, { name: 'Power In', portType: PortType.POWER_SCHUKO, direction: PortDirection.IN, power: { currentType: CurrentType.AC } });
  const danyaVPsu1Out = await mkPort(danyaVPsu1, {
    name: '9V DC Out',
    portType: PortType.DC_BARREL,
    direction: PortDirection.OUT,
    power: { currentType: CurrentType.DC, voltageV: 9, polarity: Polarity.CENTER_NEGATIVE, maxOutputCurrentMA: 200 },
  });
  await mkCable({ sourcePortId: anker2SchukoOuts[1].id, targetPortId: danyaVPsu1In.id, cableType: CableType.POWER_LINE, length: 1 });
  await mkCable({ sourcePortId: danyaVPsu1Out.id, targetPortId: tu3Power.id, cableType: CableType.POWER_LINE, length: 0.3 });

  const danyaVPsu2 = await mkDevice({
    name: 'БП педалей Дани-вокала #2 (одноканальный, 9V — Cinders)',
    type: DeviceType.POWER_SUPPLY,
    ownerRole: 'Даня-вокал',
    position: { x: 660, y: 550 },
    powerRequired: true,
    powerSourceType: PowerSourceType.AC_MAINS,
    power: { currentType: CurrentType.DC, voltageV: 9, maxOutputCurrentMA: 200 },
    notes: 'Одноканальный БП — питает только TC Electronic Cinders.',
  });
  const danyaVPsu2In = await mkPort(danyaVPsu2, { name: 'Power In', portType: PortType.POWER_SCHUKO, direction: PortDirection.IN, power: { currentType: CurrentType.AC } });
  const danyaVPsu2Out = await mkPort(danyaVPsu2, {
    name: '9V DC Out',
    portType: PortType.DC_BARREL,
    direction: PortDirection.OUT,
    power: { currentType: CurrentType.DC, voltageV: 9, polarity: Polarity.CENTER_NEGATIVE, maxOutputCurrentMA: 200 },
  });
  await mkCable({ sourcePortId: anker2SchukoOuts[4].id, targetPortId: danyaVPsu2In.id, cableType: CableType.POWER_LINE, length: 1 });

  const cinders = await mkDevice({
    name: 'TC Electronic Cinders Overdrive',
    type: DeviceType.PEDAL,
    ownerRole: 'Даня-вокал',
    position: { x: 670, y: 480 },
    powerRequired: true,
    powerSourceType: PowerSourceType.DC_BARREL,
    power: { currentType: CurrentType.DC, voltageV: 9, currentMA: 15, polarity: Polarity.CENTER_NEGATIVE },
    pedal: { isStereoIn: false, isStereoOut: false },
    imageUrl: 'dan-vocalist-cinders.png',
    attrs: {
      manufacturer: 'TC Electronic',
      model: 'Cinders Overdrive (прозрачный овердрайв на MOSFET, tube-like)',
      controls: ['DRIVE — насыщение и гейн (от лёгкого буста до классического ритм-кранча)', 'VOLUME — выходной уровень', 'TONE — прозрачность и срез высоких частот'],
      footswitch: 'True Bypass, металлический кликер.',
    },
  });
  const cindersIn = await mkPort(cinders, { name: 'Input', portType: PortType.TS_14, direction: PortDirection.IN });
  const cindersOut = await mkPort(cinders, { name: 'Output', portType: PortType.TS_14, direction: PortDirection.OUT });
  const cindersPower = await mkPort(cinders, {
    name: 'Power In',
    portType: PortType.DC_BARREL,
    direction: PortDirection.IN,
    power: { currentType: CurrentType.DC, voltageV: 9, currentMA: 15, polarity: Polarity.CENTER_NEGATIVE },
  });
  await mkCable({ sourcePortId: danyaVPsu2Out.id, targetPortId: cindersPower.id, cableType: CableType.POWER_LINE, length: 0.3 });

  const fc03 = await mkDevice({
    name: 'FLAMMA FC03 Delay',
    type: DeviceType.PEDAL,
    ownerRole: 'Даня-вокал',
    position: { x: 730, y: 480 },
    powerRequired: true,
    powerSourceType: PowerSourceType.DC_BARREL,
    power: { currentType: CurrentType.DC, voltageV: 9, currentMA: 128, polarity: Polarity.CENTER_NEGATIVE },
    pedal: { isStereoIn: false, isStereoOut: false },
    imageUrl: 'dan-vocalist-delay.png',
    attrs: {
      manufacturer: 'Flamma',
      model: 'FC03 (микро-педаль дилея, 3 режима)',
      controls: [
        '3-way Toggle: Analog (тёплая аналоговая задержка с мягким спадом) / Real Echo (естественное эхо окружения) / Tape Echo (симуляция винтажного ленточного дилея)',
        'TIME (большая ручка) — время задержки, 5ms – 600ms',
        'LEVEL — уровень громкости повторов',
        'F.BACK (Feedback) — количество повторов',
      ],
      footswitch: 'True Bypass.',
    },
  });
  const fc03In = await mkPort(fc03, { name: 'Input', portType: PortType.TS_14, direction: PortDirection.IN });
  const fc03Out = await mkPort(fc03, { name: 'Output', portType: PortType.TS_14, direction: PortDirection.OUT });
  const fc03Power = await mkPort(fc03, {
    name: 'Power In',
    portType: PortType.DC_BARREL,
    direction: PortDirection.IN,
    power: { currentType: CurrentType.DC, voltageV: 9, currentMA: 128, polarity: Polarity.CENTER_NEGATIVE },
  });
  await mkCable({ sourcePortId: tu3DaisyOut.id, targetPortId: fc03Power.id, cableType: CableType.POWER_LINE, length: 0.3 });

  const pedalPorts = [
    { in: tu3In, out: tu3Out },
    { in: cindersIn, out: cindersOut },
    { in: fc03In, out: fc03Out },
  ];

  const danyaVCombo = await mkDevice({
    name: 'Комбик Дани-вокала (Egnater Tweaker 40W)',
    type: DeviceType.AMPLIFIER,
    ownerRole: 'Даня-вокал',
    position: { x: 750, y: 480 },
    powerRequired: true,
    powerSourceType: PowerSourceType.AC_MAINS,
    power: { currentType: CurrentType.AC },
    imageUrl: 'dan-vocalist-combo.png',
    attrs: {
      manufacturer: 'Egnater',
      model: 'Tweaker 40W Combo — двухканальный полностью ламповый (2x 6L6, 3x 12AX7)',
      controls: ['Переключатели Tweaker: USA / AC / BRIT — смена характера эквалайзера и структуры гейна'],
    },
    notes: 'Подзвучка снимается динамическим микрофоном Sennheiser e835s в стейджбокс (CH11) — см. ниже.',
  });
  const danyaVComboIn = await mkPort(danyaVCombo, { name: 'Input', portType: PortType.TS_14, direction: PortDirection.IN });
  await mkPort(danyaVCombo, { name: 'FX Loop Send (не используется)', portType: PortType.TS_14, direction: PortDirection.OUT });
  await mkPort(danyaVCombo, { name: 'FX Loop Return (не используется)', portType: PortType.TS_14, direction: PortDirection.IN });
  await mkPort(danyaVCombo, { name: 'Speaker Out (4/8/16 Ω, не используется — комбо, кабинет не внешний)', portType: PortType.TS_14, direction: PortDirection.OUT });
  const danyaVComboPower = await mkPort(danyaVCombo, { name: 'Power In', portType: PortType.POWER_SCHUKO, direction: PortDirection.IN, power: { currentType: CurrentType.AC } });
  await mkCable({ sourcePortId: venueOutlet3Port.id, targetPortId: danyaVComboPower.id, cableType: CableType.POWER_LINE, length: 2 });

  await mkCable({ sourcePortId: danyaVGuitarOut.id, targetPortId: pedalPorts[0].in.id, cableType: CableType.AUDIO_UNBALANCED, length: 0.3 });
  await mkCable({ sourcePortId: pedalPorts[0].out.id, targetPortId: pedalPorts[1].in.id, cableType: CableType.AUDIO_UNBALANCED, length: 0.2, isPatchCable: true });
  await mkCable({ sourcePortId: pedalPorts[1].out.id, targetPortId: pedalPorts[2].in.id, cableType: CableType.AUDIO_UNBALANCED, length: 0.2, isPatchCable: true });
  await mkCable({ sourcePortId: pedalPorts[2].out.id, targetPortId: danyaVComboIn.id, cableType: CableType.AUDIO_UNBALANCED, length: 0.5 });

  const e835s = await mkDevice({
    name: 'Sennheiser e835s (микрофон комбика)',
    type: DeviceType.MICROPHONE,
    ownerRole: 'Даня-вокал',
    position: { x: 1050, y: 480 },
    imageUrl: 'dan-vocalist-guitar-amp-mic.webp',
    notes: 'Целевое состояние по rider.md (CH11) — стойка с микрофоном расположена перед диффузором комбика.',
  });
  const e835sOut = await mkPort(e835s, { name: 'Out', portType: PortType.XLR_M, direction: PortDirection.OUT });
  await mkFurniture({ deviceId: e835s.id, kind: FurnitureKind.MIC_STAND, isVenueProvided: true });

  // ---------------------------------------------------------------------------------------
  // ---------------------------------------------------------------------------------------
  // Даня-вокал + плейбеки — сетап плейбеков. Ноут (MacBook Pro M5) → MOTU → стейджбокс
  // ---------------------------------------------------------------------------------------
  const playbackLaptop = await mkDevice({
    name: 'MacBook Pro 14" (M5) — Плейбеки',
    type: DeviceType.LAPTOP,
    ownerRole: 'Даня-вокал',
    position: { x: 1200, y: -150 },
    powerRequired: true,
    powerSourceType: PowerSourceType.USB_C_PD,
    hostUsbType: HostUsbType.USB_C,
    power: { currentType: CurrentType.DC, voltageV: 20, currentMA: 3000 },
    imageUrl: 'dan-vocalist-macbook.webp',
    attrs: {
      manufacturer: 'Apple',
      model: 'MacBook Pro 14" (M5, 2x Thunderbolt 4 / USB-C, MagSafe 3)',
      ramGB: 24,
      storageGB: 1024,
    },
    notes: 'Основной ноутбук для воспроизведения плейбеков и управления сценой.',
  });
  const playbackLaptopUsbC = await mkPort(playbackLaptop, { name: 'USB-C / TB4', portType: PortType.USB_C, direction: PortDirection.BI });
  const playbackLaptopPowerIn = await mkPort(playbackLaptop, { name: 'MagSafe / USB-C Power In', portType: PortType.POWER_SCHUKO, direction: PortDirection.IN });

  // Laptop Power Supply (MacBook Pro M5)
  const playbackLaptopPsu = await mkDevice({
    name: 'БП Apple 140W USB-C (плейбеки)',
    type: DeviceType.POWER_SUPPLY,
    ownerRole: 'Даня-вокал',
    position: { x: 1050, y: -150 },
    powerRequired: true,
    powerSourceType: PowerSourceType.AC_MAINS,
    imageUrl: 'apple-charger.webp',
    attrs: { manufacturer: 'Apple' },
    notes: 'Родной блок питания 140W для ноутбука плейбеков Дани-вокала.',
  });
  const playbackLaptopPsuPlug = await mkPort(playbackLaptopPsu, { name: 'Вилка (в Anker)', portType: PortType.POWER_SCHUKO, direction: PortDirection.IN });
  const playbackLaptopPsuOut = await mkPort(playbackLaptopPsu, { name: 'USB-C Out (140W)', portType: PortType.USB_C, direction: PortDirection.OUT, power: { maxOutputPowerW: 140 } });

  await mkCable({ sourcePortId: anker2SchukoOuts[3].id, targetPortId: playbackLaptopPsuPlug.id, cableType: CableType.POWER_LINE, length: 1.5, color: 'black' });
  await mkCable({ sourcePortId: playbackLaptopPsuOut.id, targetPortId: playbackLaptopPowerIn.id, cableType: CableType.POWER_LINE, length: 2, color: 'white' });

  const motu = await mkDevice({
    name: 'MOTU UltraLite-mk3 Hybrid',
    type: DeviceType.AUDIO_INTERFACE,
    ownerRole: 'Даня-вокал',
    position: { x: 1200, y: 0 },
    powerRequired: true,
    powerSourceType: PowerSourceType.DC_BARREL,
    power: { currentType: CurrentType.DC, voltageV: 12, currentMA: 1000, polarity: Polarity.ANY },
    imageUrl: 'motu-front-back.png',
    attrs: {
      manufacturer: 'MOTU',
      model: 'UltraLite-mk3 Hybrid — гибридный (USB 2.0 / FireWire) 10x14 интерфейс с DSP-эффектами',
    },
    notes: 'Полярность блока питания устройству безразлична (ANY) — редкий случай, зафиксировано явно.',
  });
  const motuUsbB = await mkPort(motu, { name: 'USB-B', portType: PortType.USB_B, direction: PortDirection.BI });
  await mkPort(motu, { name: 'Combo Mic/Guitar In 1 (не используется)', portType: PortType.COMBO_XLR_TRS, direction: PortDirection.IN });
  await mkPort(motu, { name: 'Combo Mic/Guitar In 2 (не используется)', portType: PortType.COMBO_XLR_TRS, direction: PortDirection.IN });
  for (let i = 1; i <= 6; i++) {
    await mkPort(motu, { name: `Line In ${i} (не используется)`, portType: PortType.TRS_14, direction: PortDirection.IN });
  }
  const motuOutBassL = await mkPort(motu, { name: 'Out — Bass L', portType: PortType.TRS_14, direction: PortDirection.OUT });
  const motuOutBassR = await mkPort(motu, { name: 'Out — Bass R', portType: PortType.TRS_14, direction: PortDirection.OUT });
  const motuOutPercL = await mkPort(motu, { name: 'Out — Percussion L', portType: PortType.TRS_14, direction: PortDirection.OUT });
  const motuOutPercR = await mkPort(motu, { name: 'Out — Percussion R', portType: PortType.TRS_14, direction: PortDirection.OUT });
  const motuOutSynthL = await mkPort(motu, { name: 'Out — Synths/BVs L', portType: PortType.TRS_14, direction: PortDirection.OUT });
  const motuOutSynthR = await mkPort(motu, { name: 'Out — Synths/BVs R', portType: PortType.TRS_14, direction: PortDirection.OUT });
  const motuOutAux = await mkPort(motu, { name: 'Aux Out (клик барабанщику)', portType: PortType.TRS_18, direction: PortDirection.OUT });
  const motuOutMonitorFeed = await mkPort(motu, { name: 'Line Out (личный монитор-фид Андрею)', portType: PortType.TS_14, direction: PortDirection.OUT });
  await mkPort(motu, { name: 'S/PDIF In (не используется)', portType: PortType.TRS_14, direction: PortDirection.IN });
  await mkPort(motu, { name: 'S/PDIF Out (не используется)', portType: PortType.TRS_14, direction: PortDirection.OUT });
  await mkPort(motu, { name: 'Optical In (не используется)', portType: PortType.TRS_14, direction: PortDirection.IN });
  await mkPort(motu, { name: 'Optical Out (не используется)', portType: PortType.TRS_14, direction: PortDirection.OUT });
  await mkPort(motu, { name: 'MIDI In (не используется)', portType: PortType.MIDI_DIN, direction: PortDirection.IN });
  const motuMidiOut = await mkPort(motu, { name: 'MIDI Out', portType: PortType.MIDI_DIN, direction: PortDirection.OUT });
  const motuPower = await mkPort(motu, {
    name: 'Power In',
    portType: PortType.DC_BARREL,
    direction: PortDirection.IN,
    power: { currentType: CurrentType.DC, voltageV: 12, currentMA: 1000, polarity: Polarity.ANY },
  });

  await mkCable({ sourcePortId: playbackLaptopUsbC.id, targetPortId: motuUsbB.id, cableType: CableType.USB_DATA, length: 1.5, adapterId: adapterUsbCtoB.id });
  await mkCable({ sourcePortId: anker2SchukoOuts[2].id, targetPortId: motuPower.id, cableType: CableType.POWER_LINE, length: 2, adapterId: adapterMotuPsu.id });
  await mkCable({
    sourcePortId: motuOutMonitorFeed.id,
    targetPortId: mx400In1.id,
    cableType: CableType.AUDIO_UNBALANCED,
    length: 10,
    productName: 'Fun Generation INS 5',
  });

  // ---------------------------------------------------------------------------------------
  // Devices & Cabling for Setup Mode "С клавишами" (Keys + MIDI Sync)
  // ---------------------------------------------------------------------------------------
  const synthLaptop = await mkDevice({
    name: 'MacBook Pro 13" (M1, 2020) — Синты/Клавиши',
    type: DeviceType.LAPTOP,
    ownerRole: 'Андрей',
    position: { x: -800, y: -250 },
    powerRequired: true,
    powerSourceType: PowerSourceType.USB_C_PD,
    hostUsbType: HostUsbType.USB_C,
    imageUrl: 'andrii-macbook.png',
    attrs: {
      manufacturer: 'Apple',
      model: 'MacBook Pro 13" (M1, 2020, 2x Thunderbolt/USB 4, без MagSafe)',
      ramGB: 8,
      storageGB: 512,
      isKeysOnly: true,
    },
    notes: 'Ноутбук Андрея для софт-синтезаторов и виртуальных клавишных инструментов.',
  });
  const synthLaptopPowerIn = await mkPort(synthLaptop, { name: 'USB-C Power In (без MagSafe)', portType: PortType.POWER_SCHUKO, direction: PortDirection.IN });
  const synthLaptopUsbC = await mkPort(synthLaptop, { name: 'USB-C (клавиши, вход MIDI/аудио)', portType: PortType.USB_C, direction: PortDirection.BI });
  await mkFurniture({ deviceId: synthLaptop.id, kind: FurnitureKind.CHAIR, isVenueProvided: true });

  const synthLaptopPsu = await mkDevice({
    name: 'БП Anker 140W USB-C GaN (синты/клавиши)',
    type: DeviceType.POWER_SUPPLY,
    ownerRole: 'Андрей',
    position: { x: -600, y: -250 },
    powerRequired: true,
    powerSourceType: PowerSourceType.AC_MAINS,
    imageUrl: 'anker-charger.avif',
    attrs: { manufacturer: 'Anker', isKeysOnly: true },
    notes: 'Зарядка синтезаторного ноутбука Андрея — не родной Apple-адаптер, а компактный Anker GaN charger.',
  });
  const synthLaptopPsuPlug = await mkPort(synthLaptopPsu, { name: 'Вилка (в Anker)', portType: PortType.POWER_SCHUKO, direction: PortDirection.IN });
  const synthLaptopPsuOut = await mkPort(synthLaptopPsu, { name: 'USB-C Out (140W)', portType: PortType.USB_C, direction: PortDirection.OUT, power: { maxOutputPowerW: 140 } });

  await mkCable({ sourcePortId: anker1SchukoOuts[3].id, targetPortId: synthLaptopPsuPlug.id, cableType: CableType.POWER_LINE, length: 1.5, color: 'black' });
  await mkCable({ sourcePortId: synthLaptopPsuOut.id, targetPortId: synthLaptopPowerIn.id, cableType: CableType.POWER_LINE, length: 2, color: 'white' });

  const cmeSyncBox = await mkDevice({
    name: 'CME U6MIDI Pro / Sync Box',
    type: DeviceType.MIDI_DEVICE,
    ownerRole: 'Даня-вокал',
    position: { x: 950, y: 150 },
    powerRequired: true,
    powerSourceType: PowerSourceType.USB_BUS,
    imageUrl: 'midi-thru5.png',
    attrs: {
      manufacturer: 'CME',
      model: 'U6MIDI Pro / Sync Box — профессиональный MIDI сплиттер и синхронизатор',
      isKeysOnly: true,
    },
    notes: 'Миди-синхронизатор: принимает MIDI-клок из MOTU и раздаёт на UMC404HD и клавиши.',
  });
  const cmePowerIn = await mkPort(cmeSyncBox, { name: 'USB-C Power In (5V DC)', portType: PortType.USB_C, direction: PortDirection.IN, power: { voltageV: 5, currentType: CurrentType.DC } });
  const cmeMidiIn = await mkPort(cmeSyncBox, { name: 'MIDI IN', portType: PortType.MIDI_DIN, direction: PortDirection.IN });
  const cmeMidiOut1 = await mkPort(cmeSyncBox, { name: 'MIDI OUT 1', portType: PortType.MIDI_DIN, direction: PortDirection.OUT });
  await mkPort(cmeSyncBox, { name: 'MIDI OUT 2 (не используется)', portType: PortType.MIDI_DIN, direction: PortDirection.OUT });

  // CME Power cable
  await mkCable({ sourcePortId: anker2UsbA1.id, targetPortId: cmePowerIn.id, cableType: CableType.POWER_LINE, length: 1.5 });

  // MIDI Sync Cables (MOTU MIDI Out -> CME Sync Box MIDI In, CME Sync Box MIDI Out 1 -> UMC404HD MIDI In)
  await mkCable({ sourcePortId: motuMidiOut.id, targetPortId: cmeMidiIn.id, cableType: CableType.MIDI, length: 3, color: 'orange' });
  const umcMidiIn = await mkPort(umc404hd, { name: 'MIDI In (Sync)', portType: PortType.MIDI_DIN, direction: PortDirection.IN });
  await mkCable({ sourcePortId: cmeMidiOut1.id, targetPortId: umcMidiIn.id, cableType: CableType.MIDI, length: 5, color: 'orange' });

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
  // Клавиши (Setup Mode "С клавишами") — the physical controller itself, wired into the
  // synth laptop above. This replaces an earlier draft (separate "big set" keyboard + second
  // laptop + a different MIDI Thru5 WC splitter, none of it ever cabled) that predated the
  // actual design landing on: same MacBook-based synth rig, CME U6MIDI Pro for clock sync,
  // and this keyboard feeding it directly over USB-C.
  // ---------------------------------------------------------------------------------------
  const keyboard = await mkDevice({
    name: 'Arturia KeyLab Essential 61 mk3',
    type: DeviceType.KEYBOARD,
    ownerRole: 'Андрей',
    position: { x: -800, y: -100 },
    imageUrl: 'andrii-keys.png',
    attrs: { manufacturer: 'Arturia', model: 'KeyLab Essential 61 mk3', isKeysOnly: true },
    notes: 'MIDI-контроллер клавиш, подключается по USB-C к синтезаторному ноутбуку Андрея.',
  });
  const keyboardUsbC = await mkPort(keyboard, { name: 'USB-C', portType: PortType.USB_C, direction: PortDirection.BI });
  await mkFurniture({ deviceId: keyboard.id, kind: FurnitureKind.KEYBOARD_STAND, isVenueProvided: false });

  await mkCable({ sourcePortId: keyboardUsbC.id, targetPortId: synthLaptopUsbC.id, cableType: CableType.USB_DATA, length: 1.5 });

  await mkDevice({
    name: 'M-Audio SP-2',
    type: DeviceType.ACCESSORY,
    ownerRole: 'Андрей',
    parentDeviceId: keyboard.id,
    position: { x: -800, y: -50 },
    attrs: { manufacturer: 'M-Audio', model: 'SP-2 Sustain Pedal', isKeysOnly: true },
  });

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
    const hasImage = d.type !== DeviceType.PEDALBOARD && (d.imageUrl || (d.imageUrls && d.imageUrls.length > 0));
    const bannerH = hasImage ? 140 : 0;
    const ownerRow = d.ownerRole ? 20 : 0;
    const portsBlock = portCount > 0 ? 1 + portCount * 23 : 0;
    estimatedSizes.set(d.id, { width: 250, height: bannerH + 28 + 30 + ownerRow + portsBlock + 40 });
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

export async function seedDatabase() {
  await main();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
