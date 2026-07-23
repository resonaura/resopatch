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
import { Device } from './entities/device.entity';
import { Port } from './entities/port.entity';
import { applyAdapterDto, applyCableDto, applyDeviceDto, applyFurnitureDto, applyPortDto } from './mappers';
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
} from './json-db';
import { computeAutoLayout } from '../setups/layout';

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
  await mkPort(anker2, { name: 'USB-A #1 (резерв — план: микшер Дани-вокала)', portType: PortType.USB_A, direction: PortDirection.OUT, power: { maxOutputPowerW: 12 } });
  await mkPort(anker2, { name: 'USB-A #2', portType: PortType.USB_A, direction: PortDirection.OUT, power: { maxOutputPowerW: 12 } });
  await mkPort(anker2, { name: 'USB-C (PD)', portType: PortType.USB_C, direction: PortDirection.OUT, power: { maxOutputPowerW: 20 } });

  await mkCable({ sourcePortId: venueOutlet1.id, targetPortId: anker1Plug.id, cableType: CableType.POWER_LINE, length: 1.5, color: 'white' });
  await mkCable({ sourcePortId: venueOutlet2.id, targetPortId: anker2Plug.id, cableType: CableType.POWER_LINE, length: 1.5, color: 'white' });

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
    name: 'Педалборд Harley Benton SpaceShip',
    type: DeviceType.PEDALBOARD,
    ownerRole: 'Андрей',
    position: { x: -700, y: 0 },
    powerRequired: true,
    powerSourceType: PowerSourceType.DC_BARREL,
    attrs: { model: 'SpaceShip (точный размер 40/50M/60/60XL не уточнён)', originalMisnomer: 'Starship' },
    notes: 'Состав педалей — см. дочерние устройства ниже, в порядке сигнальной цепи.',
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
    imageUrl: 'guitar-andrii.webp',
    attrs: { kind: 'guitar' },
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
    name: 'Бас-гитара Андрея',
    type: DeviceType.INSTRUMENT,
    ownerRole: 'Андрей',
    position: { x: -1100, y: 150 },
    imageUrl: 'andrii-bass.png',
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

  await mkCable({ sourcePortId: andreyGuitarOut.id, targetPortId: yellowCompIn.id, cableType: CableType.AUDIO_UNBALANCED, length: 0.3, color: 'red' });
  const pedalChain: { out: Port; in: Port }[] = [
    { out: yellowCompOut, in: cs400In },
    { out: cs400Out, in: to800In },
    { out: to800Out, in: grungeIn },
    { out: grungeAmpOut, in: fs06In },
    { out: fs06Out, in: fc14In },
    { out: fc14Out, in: jetEngineIn },
    { out: jetEngineOut, in: fs05InL },
  ];
  for (const link of pedalChain) {
    await mkCable({ sourcePortId: link.out.id, targetPortId: link.in.id, cableType: CableType.AUDIO_UNBALANCED, length: 0.2, isPatchCable: true });
  }
  const stereoPedalChain: { outL: Port; outR: Port; inL: Port; inR: Port }[] = [
    { outL: fs05OutL, outR: fs05OutR, inL: dseed2InL, inR: dseed2InR },
    { outL: dseed2OutL, outR: dseed2OutR, inL: fs02InL, inR: fs02InR },
    { outL: fs02OutL, outR: fs02OutR, inL: fs07InL, inR: fs07InR },
  ];
  for (const link of stereoPedalChain) {
    await mkCable({ sourcePortId: link.outL.id, targetPortId: link.inL.id, cableType: CableType.AUDIO_UNBALANCED, length: 0.2, isPatchCable: true });
    await mkCable({ sourcePortId: link.outR.id, targetPortId: link.inR.id, cableType: CableType.AUDIO_UNBALANCED, length: 0.2, isPatchCable: true });
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
    name: 'Наушники Андрея (личный мониторинг)',
    type: DeviceType.MONITOR,
    ownerRole: 'Андрей',
    position: { x: -500, y: 550 },
    imageUrl: 'andrii-headphones.webp',
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
    name: 'IEM Дани-вокала (свои)',
    type: DeviceType.MONITOR,
    ownerRole: 'Даня-вокал',
    position: { x: 300, y: -300 },
    imageUrl: 'dan-vocalist-iem.png',
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
    name: 'Гитара Дани-вокала',
    type: DeviceType.INSTRUMENT,
    ownerRole: 'Даня-вокал',
    position: { x: 550, y: 350 },
    imageUrl: 'dan-vocalist-guitar.webp',
    attrs: { kind: 'guitar' },
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
      'Раздаёт 9V DC OUT (до 200мА) на разветвитель → Cinders + FC03 (см. ниже) — резолвит открытый вопрос docs/stage-setup.md §2.2/§12.4 про питание 3 педалей. Собственный upstream-источник питания TU-3 (что запитывает сам тюнер) пока не уточнён.',
  });
  const tu3In = await mkPort(tu3, { name: 'Input (с гитары Дани-вокала)', portType: PortType.TS_14, direction: PortDirection.IN });
  const tu3Out = await mkPort(tu3, { name: 'Output (с mute при настройке)', portType: PortType.TS_14, direction: PortDirection.OUT });
  const tu3Power = await mkPort(tu3, {
    name: 'Power In (upstream ❓)',
    portType: PortType.DC_BARREL,
    direction: PortDirection.IN,
    power: { currentType: CurrentType.DC, voltageV: 9, currentMA: 30, polarity: Polarity.CENTER_NEGATIVE },
  });
  const tu3DaisyOut = await mkPort(tu3, {
    name: '9V DC OUT (Daisy Chain, до 200мА)',
    portType: PortType.DC_BARREL,
    direction: PortDirection.OUT,
    power: { currentType: CurrentType.DC, voltageV: 9, polarity: Polarity.CENTER_NEGATIVE, maxOutputCurrentMA: 200 },
  });

  const danyaVSplitter = await mkDevice({
    name: 'Разветвитель питания 1→2 (от TU-3, на Cinders + FC03)',
    type: DeviceType.POWER_SPLITTER,
    ownerRole: 'Даня-вокал',
    position: { x: 610, y: 550 },
    notes: 'Даёт TU-3-у раздать один daisy-chain выход на 2 педали (15мА + 128мА = 143мА, укладывается в лимит 200мА).',
  });
  const splitterIn = await mkPort(danyaVSplitter, { name: 'In', portType: PortType.DC_BARREL, direction: PortDirection.IN });
  const splitterOut1 = await mkPort(danyaVSplitter, { name: 'Out 1 (→ Cinders)', portType: PortType.DC_BARREL, direction: PortDirection.OUT });
  const splitterOut2 = await mkPort(danyaVSplitter, { name: 'Out 2 (→ FC03)', portType: PortType.DC_BARREL, direction: PortDirection.OUT });
  await mkCable({ sourcePortId: tu3DaisyOut.id, targetPortId: splitterIn.id, cableType: CableType.POWER_LINE, length: 0.2 });

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
  await mkCable({ sourcePortId: splitterOut1.id, targetPortId: cindersPower.id, cableType: CableType.POWER_LINE, length: 0.3 });

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
  await mkCable({ sourcePortId: splitterOut2.id, targetPortId: fc03Power.id, cableType: CableType.POWER_LINE, length: 0.3 });

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
  await mkCable({ sourcePortId: anker2SchukoOuts[1].id, targetPortId: danyaVComboPower.id, cableType: CableType.POWER_LINE, length: 2 });

  await mkCable({ sourcePortId: danyaVGuitarOut.id, targetPortId: pedalPorts[0].in.id, cableType: CableType.AUDIO_UNBALANCED, length: 0.3 });
  await mkCable({ sourcePortId: pedalPorts[0].out.id, targetPortId: pedalPorts[1].in.id, cableType: CableType.AUDIO_UNBALANCED, length: 0.2, isPatchCable: true });
  await mkCable({ sourcePortId: pedalPorts[1].out.id, targetPortId: pedalPorts[2].in.id, cableType: CableType.AUDIO_UNBALANCED, length: 0.2, isPatchCable: true });
  await mkCable({ sourcePortId: pedalPorts[2].out.id, targetPortId: danyaVComboIn.id, cableType: CableType.AUDIO_UNBALANCED, length: 0.5 });

  const e835s = await mkDevice({
    name: 'Sennheiser e835s (микрофон комбика)',
    type: DeviceType.MICROPHONE,
    ownerRole: 'Даня-вокал',
    parentDeviceId: danyaVCombo.id,
    position: { x: 1050, y: 480 },
    imageUrl: 'dan-vocalist-guitar-amp-mic.webp',
    notes: 'Целевое состояние по rider.md (CH11) — стойка с микрофоном расположена перед диффузором комбика.',
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
    imageUrl: 'dan-vocalist-macbook.webp',
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
  await mkPort(motu, { name: 'MIDI Out (не используется)', portType: PortType.MIDI_DIN, direction: PortDirection.OUT });
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
    imageUrl: 'midi-thru5.png',
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
    imageUrl: 'andrii-keys.png',
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

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
