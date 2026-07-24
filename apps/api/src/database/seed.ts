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
 *  - Dan (Vocalist)'s 3 pedals exist as named slots but their power wiring is genuinely unknown
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
      name: "{\"en\": \"Resonaura \\u2014 Live Stage Setup\", \"ru\": \"Resonaura \\u2014 \\u0421\\u0446\\u0435\\u043d\\u0438\\u0447\\u0435\\u0441\\u043a\\u0438\\u0439 \\u0441\\u0435\\u0442\\u0430\\u043f\"}",
      description: "{\"en\": \"Live inventory based on stage setup documentation.\", \"ru\": \"\\u0418\\u043d\\u0432\\u0435\\u043d\\u0442\\u0430\\u0440\\u044c \\u0438 \\u043a\\u043e\\u043c\\u043c\\u0443\\u0442\\u0430\\u0446\\u0438\\u044f \\u043d\\u0430 \\u043e\\u0441\\u043d\\u043e\\u0432\\u0435 \\u0442\\u0435\\u0445\\u043d\\u0438\\u0447\\u0435\\u0441\\u043a\\u043e\\u0439 \\u0434\\u043e\\u043a\\u0443\\u043c\\u0435\\u043d\\u0442\\u0430\\u0446\\u0438\\u0438 \\u0441\\u0446\\u0435\\u043d\\u044b.\"}",
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
    name: 'Behringer MX400 PSU (12V DC)',
    inputType: PortType.POWER_SCHUKO,
    outputType: PortType.DC_BARREL,
  });
  const adapterGoveePsu = await mkAdapter({
    name: 'Govee RGBIC Smart Lamp PSU (12V DC)',
    inputType: PortType.POWER_SCHUKO,
    outputType: PortType.DC_BARREL,
  });
  const adapterFex800Psu = await mkAdapter({
    name: 'Behringer FEX800 PSU (9V AC)',
    inputType: PortType.POWER_SCHUKO,
    outputType: PortType.DC_BARREL,
  });
  const adapterMotuPsu = await mkAdapter({
    name: 'MOTU UltraLite-mk3 Hybrid PSU (12V DC, Polarity ANY)',
    inputType: PortType.POWER_SCHUKO,
    outputType: PortType.DC_BARREL,
  });
  const adapterUsbAtoB = await mkAdapter({
    name: 'USB-A → USB-B Cable (UMC404HD, bus power)',
    inputType: PortType.USB_A,
    outputType: PortType.USB_B,
  });
  const adapterUsbCtoB = await mkAdapter({
    name: 'USB-C → USB-B Cable (MOTU UltraLite mk3)',
    inputType: PortType.USB_C,
    outputType: PortType.USB_B,
  });
  const adapterTrs14to18 = await mkAdapter({
    name: 'ANDTOBO 1/4" Male to 1/8" Female Stereo Audio Jack Adapter (Black, non-threaded)',
    inputType: PortType.TRS_14,
    outputType: PortType.TRS_18,
  });
  const adapterTrsToXlr = await mkAdapter({
    name: 'Adapter 1/4" TRS → XLR (M)',
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
    name: "{\"en\": \"Venue Outlet\", \"ru\": \"\\u0420\\u043e\\u0437\\u0435\\u0442\\u043a\\u0430 \\u043f\\u043b\\u043e\\u0449\\u0430\\u0434\\u043a\\u0438\"}",
    type: DeviceType.POWER_STRIP,
    ownerRole: 'andrii',
    inventoryStatus: InventoryStatus.VENUE_PROVIDED,
    position: { x: -600, y: 250 },
    notes: "{\"en\": \"Stage left wall outlet \\u2014 where Andrey Anker extension cord connects.\", \"ru\": \"\\u0421\\u0442\\u0435\\u043d\\u0430/\\u0449\\u0438\\u0442\\u043e\\u043a \\u043f\\u043b\\u043e\\u0449\\u0430\\u0434\\u043a\\u0438 \\u2014 \\u043a\\u0443\\u0434\\u0430 \\u0432\\u0442\\u044b\\u043a\\u0430\\u0435\\u0442\\u0441\\u044f \\u0443\\u0434\\u043b\\u0438\\u043d\\u0438\\u0442\\u0435\\u043b\\u044c Anker \\u0441\\u0442\\u043e\\u0440\\u043e\\u043d\\u044b \\u0410\\u043d\\u0434\\u0440\\u0435\\u044f.\"}",
  });
  const venueOutlet1Port = await mkPort(venueOutlet1, {
    name: 'Socket',
    portType: PortType.POWER_SCHUKO,
    direction: PortDirection.OUT,
    power: { currentType: CurrentType.AC },
  });

  const venueOutlet2 = await mkDevice({
    name: "{\"en\": \"Venue Outlet\", \"ru\": \"\\u0420\\u043e\\u0437\\u0435\\u0442\\u043a\\u0430 \\u043f\\u043b\\u043e\\u0449\\u0430\\u0434\\u043a\\u0438\"}",
    type: DeviceType.POWER_STRIP,
    ownerRole: 'danVox',
    inventoryStatus: InventoryStatus.VENUE_PROVIDED,
    position: { x: 600, y: 850 },
    notes: "{\"en\": \"Stage right wall outlet \\u2014 where Dan Anker extension cord connects.\", \"ru\": \"\\u0421\\u0442\\u0435\\u043d\\u0430/\\u0449\\u0438\\u0442\\u043e\\u043a \\u043f\\u043b\\u043e\\u0449\\u0430\\u0434\\u043a\\u0438 \\u2014 \\u043a\\u0443\\u0434\\u0430 \\u0432\\u0442\\u044b\\u043a\\u0430\\u0435\\u0442\\u0441\\u044f \\u0443\\u0434\\u043b\\u0438\\u043d\\u0438\\u0442\\u0435\\u043b\\u044c Anker \\u0441\\u0442\\u043e\\u0440\\u043e\\u043d\\u044b \\u0414\\u0430\\u043d\\u0438-\\u0432\\u043e\\u043a\\u0430\\u043b\\u0430.\"}",
  });
  const venueOutlet2Port = await mkPort(venueOutlet2, {
    name: 'Socket',
    portType: PortType.POWER_SCHUKO,
    direction: PortDirection.OUT,
    power: { currentType: CurrentType.AC },
  });

  const venueOutlet3 = await mkDevice({
    name: 'Venue outlet (near combo amp)',
    type: DeviceType.POWER_STRIP,
    ownerRole: 'danVox',
    inventoryStatus: InventoryStatus.VENUE_PROVIDED,
    position: { x: 750, y: 650 },
    notes: "{\"en\": \"Dedicated wall outlet near combo amp.\", \"ru\": \"\\u041e\\u0442\\u0434\\u0435\\u043b\\u044c\\u043d\\u0430\\u044f \\u0440\\u043e\\u0437\\u0435\\u0442\\u043a\\u0430 \\u0441\\u0442\\u0435\\u043d\\u044b/\\u0449\\u0438\\u0442\\u043a\\u0430 \\u043f\\u043b\\u043e\\u0449\\u0430\\u0434\\u043a\\u0438 \\u043f\\u0440\\u044f\\u043c\\u043e \\u0443 \\u043a\\u043e\\u043c\\u0431\\u0438\\u043a\\u0430.\"}",
  });
  const venueOutlet3Port = await mkPort(venueOutlet3, {
    name: 'Socket',
    portType: PortType.POWER_SCHUKO,
    direction: PortDirection.OUT,
    power: { currentType: CurrentType.AC },
  });

  const anker1 = await mkDevice({
    name: "{\"en\": \"Anker Surge Protector 2000J\", \"ru\": \"\\u0423\\u0434\\u043b\\u0438\\u043d\\u0438\\u0442\\u0435\\u043b\\u044c Anker 2000J\"}",
    type: DeviceType.POWER_STRIP,
    ownerRole: 'andrii',
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
  const anker1Plug = await mkPort(anker1, { name: 'Plug (venue outlet)', portType: PortType.POWER_SCHUKO, direction: PortDirection.IN, power: { currentType: CurrentType.AC } });
  const anker1SchukoOuts: Port[] = [];
  for (let i = 1; i <= 8; i++) {
    anker1SchukoOuts.push(
      await mkPort(anker1, { name: `Socket ${i}`, portType: PortType.POWER_SCHUKO, direction: PortDirection.OUT, power: { currentType: CurrentType.AC } }),
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
    name: "{\"en\": \"Anker Surge Protector 2000J\", \"ru\": \"\\u0423\\u0434\\u043b\\u0438\\u043d\\u0438\\u0442\\u0435\\u043b\\u044c Anker 2000J\"}",
    type: DeviceType.POWER_STRIP,
    ownerRole: 'danVox',
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
  const anker2Plug = await mkPort(anker2, { name: 'Plug (venue outlet)', portType: PortType.POWER_SCHUKO, direction: PortDirection.IN, power: { currentType: CurrentType.AC } });
  const anker2SchukoOuts: Port[] = [];
  for (let i = 1; i <= 8; i++) {
    anker2SchukoOuts.push(
      await mkPort(anker2, { name: `Socket ${i}`, portType: PortType.POWER_SCHUKO, direction: PortDirection.OUT, power: { currentType: CurrentType.AC } }),
    );
  }
  const anker2UsbA1 = await mkPort(anker2, { name: 'USB-A #1 (spare)', portType: PortType.USB_A, direction: PortDirection.OUT, power: { maxOutputPowerW: 12 } });
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
    name: "{\"en\": \"Harley Benton SpaceShip 60XL Pedalboard\", \"ru\": \"\\u041f\\u0435\\u0434\\u0430\\u043b\\u0431\\u043e\\u0440\\u0434 Harley Benton SpaceShip 60XL\"}",
    type: DeviceType.PEDALBOARD,
    ownerRole: 'andrii',
    position: { x: -700, y: 0 },
    powerRequired: true,
    powerSourceType: PowerSourceType.DC_BARREL,
    attrs: { manufacturer: 'Harley Benton', model: 'SpaceShip 60XL' },
    notes: "{\"en\": \"Pedalboard setup \\u2014 see child devices below in signal chain order.\", \"ru\": \"\\u0421\\u043e\\u0441\\u0442\\u0430\\u0432 \\u043f\\u0435\\u0434\\u0430\\u043b\\u0435\\u0439 \\u2014 \\u0441\\u043c. \\u0434\\u043e\\u0447\\u0435\\u0440\\u043d\\u0438\\u0435 \\u0443\\u0441\\u0442\\u0440\\u043e\\u0439\\u0441\\u0442\\u0432\\u0430 \\u043d\\u0438\\u0436\\u0435 \\u0432 \\u043f\\u043e\\u0440\\u044f\\u0434\\u043a\\u0435 \\u0441\\u0438\\u0433\\u043d\\u0430\\u043b\\u044c\\u043d\\u043e\\u0439 \\u0446\\u0435\\u043f\\u0438.\"}",
  });

  // Physically straps to the underside of the pedalboard and travels as one unit with it — part
  // of "the pedalboard" the same way the velcro and patch cables are, even though (unlike those)
  // it still has real ports/cables of its own, so it stays a full node on the canvas too.
  const iso12pro = await mkDevice({
    name: "{\"en\": \"Harley Benton PowerPlant ISO-12 Pro\", \"ru\": \"\\u0411\\u043b\\u043e\\u043a \\u043f\\u0438\\u0442\\u0430\\u043d\\u0438\\u044f Harley Benton PowerPlant ISO-12 Pro\"}",
    type: DeviceType.POWER_SUPPLY,
    ownerRole: 'andrii',
    parentDeviceId: pedalboard.id,
    position: { x: -300, y: 450 },
    powerRequired: true,
    powerSourceType: PowerSourceType.AC_MAINS,
    power: { maxOutputPowerW: 27 },
    imageUrl: 'andrii-pedalboard-power.png',
    attrs: { manufacturer: 'Harley Benton', model: 'PowerPlant ISO-12 Pro' },
    notes:
      "{\"en\": \"Isolated multi-output PSU for Andrey pedalboard. 27W global limit.\", \"ru\": \"\\u0418\\u0437\\u043e\\u043b\\u0438\\u0440\\u043e\\u0432\\u0430\\u043d\\u043d\\u044b\\u0439 \\u043c\\u0443\\u043b\\u044c\\u0442\\u0438\\u0431\\u043b\\u043e\\u043a \\u043f\\u0438\\u0442\\u0430\\u043d\\u0438\\u044f \\u043f\\u0435\\u0434\\u0430\\u043b\\u0431\\u043e\\u0440\\u0434\\u0430 \\u0410\\u043d\\u0434\\u0440\\u0435\\u044f. \\u0413\\u043b\\u043e\\u0431\\u0430\\u043b\\u044c\\u043d\\u044b\\u0439 \\u043b\\u0438\\u043c\\u0438\\u0442 27W.\"}",
  });
  const iso12ProIn = await mkPort(iso12pro, { name: 'Power In', portType: PortType.POWER_SCHUKO, direction: PortDirection.IN, power: { currentType: CurrentType.AC } });
  const iso12Pro9vGroup = await mkPort(iso12pro, {
    name: '9V Group Out (1–9)',
    portType: PortType.DC_BARREL,
    direction: PortDirection.OUT,
    power: { currentType: CurrentType.DC, voltageV: 9, polarity: Polarity.CENTER_NEGATIVE, maxOutputCurrentMA: 300 },
  });
  await mkPort(iso12pro, {
    name: 'A/B/C Group Out (9/12/18V switchable)',
    portType: PortType.DC_BARREL,
    direction: PortDirection.OUT,
    power: { currentType: CurrentType.DC, voltageV: 12, polarity: Polarity.CENTER_NEGATIVE, maxOutputCurrentMA: 500 },
  });

  await mkCable({ sourcePortId: anker1SchukoOuts[0].id, targetPortId: iso12ProIn.id, cableType: CableType.POWER_LINE, length: 1 });

  const andreyGuitar = await mkDevice({
    name: "{\"en\": \"Squier Bullet Mustang HH Guitar\", \"ru\": \"\\u042d\\u043b\\u0435\\u043a\\u0442\\u0440\\u043e\\u0433\\u0438\\u0442\\u0430\\u0440\\u0430 Squier Bullet Mustang HH\"}",
    type: DeviceType.INSTRUMENT,
    ownerRole: 'andrii',
    position: { x: -900, y: 0 },
    imageUrl: 'guitar-andrii.webp',
    attrs: { kind: 'guitar', manufacturer: 'Squier', model: 'Bullet Mustang HH', color: 'Imperial Blue' },
  });
  const andreyGuitarOut = await mkPort(andreyGuitar, { name: 'Jack Out', portType: PortType.TS_14, direction: PortDirection.OUT });

  await mkDevice({
    name: "{\"en\": \"Guitar Strap\", \"ru\": \"\\u0420\\u0435\\u043c\\u0435\\u043d\\u044c \\u0434\\u043b\\u044f \\u0433\\u0438\\u0442\\u0430\\u0440\\u044b\"}",
    type: DeviceType.ACCESSORY,
    ownerRole: 'andrii',
    parentDeviceId: andreyGuitar.id,
    position: { x: -950, y: -100 },
    imageUrl: 'andrii-guitar-strap.png',
  });
  await mkDevice({
    name: "{\"en\": \"TC Electronic PolyTune Clip Tuner\", \"ru\": \"\\u0422\\u044e\\u043d\\u0435\\u0440-\\u043f\\u0440\\u0438\\u0449\\u0435\\u043f\\u043a\\u0430 TC Electronic PolyTune Clip\"}",
    type: DeviceType.ACCESSORY,
    ownerRole: 'andrii',
    parentDeviceId: andreyGuitar.id,
    position: { x: -850, y: -100 },
    imageUrl: 'andrii-tuner.png',
    attrs: { battery: 'CR2032', batteryVoltage: 3, batteryLifeHours: 18 },
    notes: "{\"en\": \"Clip-on tuner on headstock; piezo sensor is self-contained.\", \"ru\": \"\\u041a\\u0440\\u0435\\u043f\\u0438\\u0442\\u0441\\u044f \\u043f\\u0440\\u0438\\u0449\\u0435\\u043f\\u043a\\u043e\\u0439 \\u043d\\u0430 \\u0433\\u043e\\u043b\\u043e\\u0432\\u0443 \\u0433\\u0440\\u0438\\u0444\\u0430, \\u043f\\u044c\\u0435\\u0437\\u043e\\u0434\\u0430\\u0442\\u0447\\u0438\\u043a \\u0430\\u0432\\u0442\\u043e\\u043d\\u043e\\u043c\\u043d\\u044b\\u0439.\"}",
  });

  const andreyBass = await mkDevice({
    name: "{\"en\": \"Harley Benton JB-75 Bass Guitar\", \"ru\": \"\\u0411\\u0430\\u0441-\\u0433\\u0438\\u0442\\u0430\\u0440\\u0430 Harley Benton JB-75\"}",
    type: DeviceType.INSTRUMENT,
    ownerRole: 'andrii',
    position: { x: -1100, y: 150 },
    imageUrl: 'andrii-bass.png',
    attrs: { kind: 'bass', manufacturer: 'Harley Benton', model: 'JB-75MN SB Vintage Series', color: 'Sunburst' },
    notes: "{\"en\": \"Used on select songs instead of guitar \\u2014 plugs into bass combo.\", \"ru\": \"\\u0418\\u0441\\u043f\\u043e\\u043b\\u044c\\u0437\\u0443\\u0435\\u0442\\u0441\\u044f \\u043d\\u0430 \\u043d\\u0435\\u043a\\u043e\\u0442\\u043e\\u0440\\u044b\\u0445 \\u043f\\u0435\\u0441\\u043d\\u044f\\u0445 \\u0432\\u043c\\u0435\\u0441\\u0442\\u043e \\u0433\\u0438\\u0442\\u0430\\u0440\\u044b \\u2014 \\u043f\\u043e\\u0434\\u043a\\u043b\\u044e\\u0447\\u0430\\u0435\\u0442\\u0441\\u044f \\u0432 \\u0431\\u0430\\u0441\\u043e\\u0432\\u044b\\u0439 \\u043a\\u043e\\u043c\\u0431\\u0438\\u043a.\"}",
  });
  const andreyBassOut = await mkPort(andreyBass, { name: 'Jack Out', portType: PortType.TS_14, direction: PortDirection.OUT });

  const venueBassCombo = await mkDevice({
    name: "{\"en\": \"Venue Bass Combo Amp\", \"ru\": \"\\u0411\\u0430\\u0441\\u043e\\u0432\\u044b\\u0439 \\u043a\\u043e\\u043c\\u0431\\u0438\\u043a \\u043f\\u043b\\u043e\\u0449\\u0430\\u0434\\u043a\\u0438\"}",
    type: DeviceType.AMPLIFIER,
    ownerRole: 'andrii',
    inventoryStatus: InventoryStatus.VENUE_PROVIDED,
    position: { x: -1100, y: 300 },
    notes: "{\"en\": \"Provided by venue. Own cable.\", \"ru\": \"\\u041f\\u0440\\u0435\\u0434\\u043e\\u0441\\u0442\\u0430\\u0432\\u043b\\u044f\\u0435\\u0442\\u0441\\u044f \\u043f\\u043b\\u043e\\u0449\\u0430\\u0434\\u043a\\u043e\\u0439. \\u0428\\u043d\\u0443\\u0440 \\u0441\\u0432\\u043e\\u0439.\"}",
  });
  const venueBassComboIn = await mkPort(venueBassCombo, { name: 'Input', portType: PortType.TS_14, direction: PortDirection.IN });
  await mkCable({ sourcePortId: andreyBassOut.id, targetPortId: venueBassComboIn.id, cableType: CableType.AUDIO_UNBALANCED, length: 4 });

  await mkDevice({
    name: "{\"en\": \"Pedal Velcro Strips\", \"ru\": \"\\u0412\\u0435\\u043b\\u043a\\u0440\\u043e-\\u043b\\u0435\\u043d\\u0442\\u0430 \\u0434\\u043b\\u044f \\u043f\\u0435\\u0434\\u0430\\u043b\\u0435\\u0439\"}",
    type: DeviceType.ACCESSORY,
    ownerRole: 'andrii',
    parentDeviceId: pedalboard.id,
    position: { x: -700, y: 100 },
    notes: "{\"en\": \"Included with Harley Benton SpaceShip 60XL pedalboard.\", \"ru\": \"\\u0418\\u0434\\u0451\\u0442 \\u0432 \\u043a\\u043e\\u043c\\u043f\\u043b\\u0435\\u043a\\u0442\\u0435 \\u043f\\u043e\\u0441\\u0442\\u0430\\u0432\\u043a\\u0438 \\u043f\\u0435\\u0434\\u0430\\u043b\\u0431\\u043e\\u0440\\u0434\\u0430 Harley Benton SpaceShip 60XL.\"}",
  });
  await mkDevice({
    name: "{\"en\": \"Pedalboard Patch Cables (Spare Set)\", \"ru\": \"\\u041f\\u0430\\u0442\\u0447-\\u043a\\u0430\\u0431\\u0435\\u043b\\u0438 (\\u0417\\u0430\\u043f\\u0430\\u0441\\u043d\\u043e\\u0439 \\u043a\\u043e\\u043c\\u043f\\u043b\\u0435\\u043a\\u0442)\"}",
    type: DeviceType.ACCESSORY,
    ownerRole: 'andrii',
    parentDeviceId: pedalboard.id,
    position: { x: -650, y: 100 },
    attrs: { manufacturer: 'AZOR', model: 'Guitar Patch Cable 1/4 Inch 6-Pack Right Angle, 4 Inch (Multicolored)' },
    notes: "{\"en\": \"Spare patch cable pack.\", \"ru\": \"\\u0424\\u0438\\u0437\\u0438\\u0447\\u0435\\u0441\\u043a\\u0438\\u0439 \\u0437\\u0430\\u043f\\u0430\\u0441\\u043d\\u043e\\u0439 \\u043a\\u043e\\u043c\\u043f\\u043b\\u0435\\u043a\\u0442 \\u043f\\u0430\\u0442\\u0447-\\u043a\\u0430\\u0431\\u0435\\u043b\\u0435\\u0439.\"}",
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
    name: "{\"en\": \"Mooer Yellow Comp Compressor\", \"ru\": \"\\u041a\\u043e\\u043c\\u043f\\u0440\\u0435\\u0441\\u0441\\u043e\\u0440 Mooer Yellow Comp\"}",
    type: DeviceType.PEDAL,
    ownerRole: 'andrii',
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
      controls: ['Volume', 'EQ', 'Comp'],
      footswitch: 'True Bypass',
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
    ownerRole: 'andrii',
    parentDeviceId: pedalboard.id,
    position: { x: -640, y: 150 },
    powerRequired: true,
    powerSourceType: PowerSourceType.DC_BARREL,
    power: { currentType: CurrentType.DC, voltageV: 9, currentMA: 10, polarity: Polarity.CENTER_NEGATIVE },
    pedal: { isStereoIn: false, isStereoOut: false },
    imageUrl: 'andrii-pedalboard-2-compressor-sustainer.webp',
    attrs: {
      manufacturer: 'Behringer',
      model: 'CS400',
      controls: ['LEVEL (MIN-MAX) — output level', 'TONE (LO-HI) — treble tone control', 'ATTACK (MIN-MAX) — attack time', 'SUSTAIN (MIN-MAX) — sustain depth'],
      footswitch: 'True Bypass',
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
    ownerRole: 'andrii',
    parentDeviceId: pedalboard.id,
    position: { x: -600, y: 150 },
    powerRequired: true,
    powerSourceType: PowerSourceType.DC_BARREL,
    power: { currentType: CurrentType.DC, voltageV: 9, currentMA: 10, polarity: Polarity.CENTER_NEGATIVE },
    pedal: { isStereoIn: false, isStereoOut: false },
    imageUrl: 'andrii-pedalboard-3-tube-overdrive.webp',
    attrs: {
      manufacturer: 'Behringer',
      model: 'TO800',
      controls: ['DRIVE (MIN-MAX) — overdrive gain level', 'TONE (LO-HI) — mid frequency tone filter', 'LEVEL (MIN-MAX) — output level'],
      footswitch: 'True Bypass',
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
    ownerRole: 'andrii',
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
      controls: ['LOUD — master volume', 'LOW — bass response control', 'HIGH — treble response control', 'GRUNGE — gain structure level'],
      footswitch: 'True Bypass',
    },
    notes: "{\"en\": \"MIXER OUT MONO present physically but unused \\u2014 signal goes to AMP OUT.\", \"ru\": \"MIXER OUT MONO \\u043f\\u0440\\u0438\\u0441\\u0443\\u0442\\u0441\\u0442\\u0432\\u0443\\u0435\\u0442 \\u0444\\u0438\\u0437\\u0438\\u0447\\u0435\\u0441\\u043a\\u0438, \\u043d\\u043e \\u043d\\u0435 \\u0438\\u0441\\u043f\\u043e\\u043b\\u044c\\u0437\\u0443\\u0435\\u0442\\u0441\\u044f \\u2014 \\u0432 \\u0446\\u0435\\u043f\\u044c \\u0438\\u0434\\u0451\\u0442 AMP OUT.\"}",
  });
  const grungeIn = await mkPort(grunge, { name: 'Mono In', portType: PortType.TS_14, direction: PortDirection.IN });
  const grungeAmpOut = await mkPort(grunge, { name: 'Amp Out Mono', portType: PortType.TS_14, direction: PortDirection.OUT });
  await mkPort(grunge, { name: 'Mixer Out Mono (unused)', portType: PortType.TS_14, direction: PortDirection.OUT });
  const grungePower = await mkPort(grunge, {
    name: 'Power In',
    portType: PortType.DC_BARREL,
    direction: PortDirection.IN,
    power: { currentType: CurrentType.DC, voltageV: 9, currentMA: 20, polarity: Polarity.CENTER_NEGATIVE },
  });

  const fs06 = await mkDevice({
    name: 'FLAMMA FS06 Digital Preamp',
    type: DeviceType.PEDAL,
    ownerRole: 'andrii',
    parentDeviceId: pedalboard.id,
    position: { x: -520, y: 150 },
    powerRequired: true,
    powerSourceType: PowerSourceType.DC_BARREL,
    power: { currentType: CurrentType.DC, voltageV: 9, currentMA: 300, polarity: Polarity.CENTER_NEGATIVE },
    pedal: { isStereoIn: false, isStereoOut: false, hasPresets: true },
    imageUrl: 'andrii-pedalboard-5-preamp.webp',
    attrs: {
      manufacturer: 'Flamma',
      model: 'FS06 (2-channel digital preamp)',
      controls: ['GAIN', 'BASS', 'MID', 'TREBLE', 'LEVEL', 'SAVE/SELECT — preset selection and save'],
      footswitch: 'True Bypass',
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
    ownerRole: 'andrii',
    parentDeviceId: pedalboard.id,
    position: { x: -480, y: 150 },
    powerRequired: true,
    powerSourceType: PowerSourceType.DC_BARREL,
    power: { currentType: CurrentType.DC, voltageV: 9, currentMA: 13, polarity: Polarity.CENTER_NEGATIVE },
    pedal: { isStereoIn: false, isStereoOut: false },
    imageUrl: 'andrii-pedalboard-6-chorus.webp',
    attrs: {
      manufacturer: 'Flamma',
      model: 'FC14',
      controls: ['RATE — speed (main knob)', 'LEVEL — mix ratio', 'DEPTH — modulation depth'],
      footswitch: 'True Bypass',
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
    name: "{\"en\": \"Mooer Jet Engine Flanger\", \"ru\": \"\\u0424\\u043b\\u044d\\u043d\\u0436\\u0435\\u0440 Mooer Jet Engine Flanger\"}",
    type: DeviceType.PEDAL,
    ownerRole: 'andrii',
    parentDeviceId: pedalboard.id,
    position: { x: -440, y: 150 },
    powerRequired: true,
    powerSourceType: PowerSourceType.DC_BARREL,
    power: { currentType: CurrentType.DC, voltageV: 9, currentMA: 160, polarity: Polarity.CENTER_NEGATIVE },
    pedal: { isStereoIn: false, isStereoOut: false },
    imageUrl: 'andrii-pedalboard-7-flanger.png',
    attrs: {
      manufacturer: 'Mooer',
      model: 'Jet Engine Flanger (digital multi-mode)',
      controls: ['RATE (main knob)', 'DEPTH', 'LEVEL', 'WIDTH'],
      footswitch: 'True Bypass',
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
    ownerRole: 'andrii',
    parentDeviceId: pedalboard.id,
    position: { x: -400, y: 150 },
    powerRequired: true,
    powerSourceType: PowerSourceType.DC_BARREL,
    power: { currentType: CurrentType.DC, voltageV: 9, currentMA: 300, polarity: Polarity.CENTER_NEGATIVE },
    pedal: { isStereoIn: false, isStereoOut: true, hasPresets: true, presetCount: 7 },
    imageUrl: 'andrii-pedalboard-8-mod.png',
    attrs: {
      manufacturer: 'Flamma',
      model: 'FS05 (stereo modulation multi-FX, 11 algorithms / 7 presets)',
      controls: ['RATE', 'DEPTH', 'TYPE — 11-position rotary selector', 'CTRL 1', 'CTRL 2', 'SAVE/SELECT'],
      footswitch: 'True Bypass',
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
  await mkPort(fs05, { name: 'In R (unused)', portType: PortType.TS_14, direction: PortDirection.IN });
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
    ownerRole: 'andrii',
    parentDeviceId: pedalboard.id,
    position: { x: -360, y: 150 },
    powerRequired: true,
    powerSourceType: PowerSourceType.DC_BARREL,
    power: { currentType: CurrentType.DC, voltageV: 9, currentMA: 220, polarity: Polarity.CENTER_NEGATIVE },
    pedal: { isStereoIn: true, isStereoOut: true },
    imageUrl: 'andrii-pedalboard-9-delay.webp',
    attrs: {
      manufacturer: 'Joyo',
      model: 'D-Seed II (stereo delay + 3.5-min stereo looper)',
      controls: ['TYPE — effect/Looper selector', 'TIME BEAT / LP.FX', 'LEVEL / LP.LEVEL', 'F.BACK / LP.TONE', 'PingPong stereo mode toggle'],
      footswitch:
        'Dual Footswitch. Delay: L=Tap/Presets, R=Bypass. Looper: L=Rec/Dub/Rerecord, R=Play/Stop/Clear.',
      algorithms: ['Space', 'Lo-Fi', 'Filter', 'Tape', 'Copy (Digital)', 'Analog', 'Mod', 'Reverse', 'LOOPER — up to 3.5 min stereo, unlimited overdubs'],
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
    ownerRole: 'andrii',
    parentDeviceId: pedalboard.id,
    position: { x: -320, y: 150 },
    powerRequired: true,
    powerSourceType: PowerSourceType.DC_BARREL,
    power: { currentType: CurrentType.DC, voltageV: 9, currentMA: 300, polarity: Polarity.CENTER_NEGATIVE },
    pedal: { isStereoIn: true, isStereoOut: true, hasPresets: true, presetCount: 7 },
    imageUrl: 'andrii-pedalboard-10-rev.png',
    attrs: {
      manufacturer: 'Flamma',
      model: 'FS02 Stereo Reverb',
      controls: ['LEVEL', 'DECAY', 'HI-CUT', 'LO-CUT', 'SAVE/SELECT'],
      footswitch: 'True Bypass',
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
    ownerRole: 'andrii',
    parentDeviceId: pedalboard.id,
    position: { x: -280, y: 150 },
    powerRequired: true,
    powerSourceType: PowerSourceType.DC_BARREL,
    power: { currentType: CurrentType.DC, voltageV: 9, currentMA: 300, polarity: Polarity.CENTER_NEGATIVE },
    pedal: { isStereoIn: true, isStereoOut: true },
    imageUrl: 'andrii-pedalboard-11-cab.webp',
    attrs: {
      manufacturer: 'Flamma',
      model: 'FS07 Cab Sim & IR Loader (24-bit/44.1kHz)',
      controls: ['LEVEL', 'LATENCY stereo phase adjustment', 'HIGH CUT', 'LOW CUT', 'SAVE/SELECT', 'Power Amp Sim toggle'],
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
    notes: "{\"en\": \"Supports third-party IR loading via Micro-USB.\", \"ru\": \"\\u041f\\u043e\\u0434\\u0434\\u0435\\u0440\\u0436\\u0438\\u0432\\u0430\\u0435\\u0442 \\u0437\\u0430\\u0433\\u0440\\u0443\\u0437\\u043a\\u0443 \\u0441\\u0442\\u043e\\u0440\\u043e\\u043d\\u043d\\u0438\\u0445 IR \\u0447\\u0435\\u0440\\u0435\\u0437 Micro-USB.\"}",
  });
  const fs07InL = await mkPort(fs07, { name: 'Stereo In L', portType: PortType.TS_14, direction: PortDirection.IN });
  const fs07InR = await mkPort(fs07, { name: 'Stereo In R', portType: PortType.TS_14, direction: PortDirection.IN });
  const fs07OutL = await mkPort(fs07, { name: 'Stereo Out L', portType: PortType.TS_14, direction: PortDirection.OUT });
  const fs07OutR = await mkPort(fs07, { name: 'Stereo Out R', portType: PortType.TS_14, direction: PortDirection.OUT });
  await mkPort(fs07, { name: 'Micro-USB (offline IR loading)', portType: PortType.USB_B, direction: PortDirection.BI });
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
    name: "{\"en\": \"Behringer UMC404HD Audio Interface\", \"ru\": \"\\u0410\\u0443\\u0434\\u0438\\u043e\\u0438\\u043d\\u0442\\u0435\\u0440\\u0444\\u0435\\u0439\\u0441 Behringer UMC404HD\"}",
    type: DeviceType.AUDIO_INTERFACE,
    ownerRole: 'andrii',
    position: { x: -500, y: 0 },
    powerRequired: true,
    powerSourceType: PowerSourceType.USB_BUS,
    hostUsbType: HostUsbType.USB_B,
    power: { currentType: CurrentType.DC, voltageV: 5, currentMA: 1000, polarity: Polarity.CENTER_NEGATIVE },
    imageUrl: 'umc404hd-front-back.png',
    attrs: {
      manufacturer: 'Behringer',
      model: 'UMC404HD 4x4 USB Audio Interface',
      controls: ['LINE/INST switch', 'PAD (-20dB)', 'Stereo/Mono monitor toggle', 'Main/PB 1-2 source'],
    },
    notes:
      "{\"en\": \"Bus-powered via USB-A\\u2192B from extension cord.\", \"ru\": \"Bus-powered \\u0447\\u0435\\u0440\\u0435\\u0437 USB-A\\u2192B \\u043e\\u0442 \\u0443\\u0434\\u043b\\u0438\\u043d\\u0438\\u0442\\u0435\\u043b\\u044f \\u0410\\u043d\\u0434\\u0440\\u0435\\u044f.\"}",
  });
  const umcIn1 = await mkPort(umc404hd, { name: 'Combo In 1 (Pedalboard L)', portType: PortType.COMBO_XLR_TRS, direction: PortDirection.IN });
  const umcIn2 = await mkPort(umc404hd, { name: 'Combo In 2 (Pedalboard R)', portType: PortType.COMBO_XLR_TRS, direction: PortDirection.IN });
  await mkPort(umc404hd, { name: 'Combo In 3 (unused)', portType: PortType.COMBO_XLR_TRS, direction: PortDirection.IN });
  await mkPort(umc404hd, { name: 'Combo In 4 (unused)', portType: PortType.COMBO_XLR_TRS, direction: PortDirection.IN });
  const umcOutL = await mkPort(umc404hd, { name: 'Main Out L', portType: PortType.XLR_M, direction: PortDirection.OUT });
  const umcOutR = await mkPort(umc404hd, { name: 'Main Out R', portType: PortType.XLR_M, direction: PortDirection.OUT });
  for (let i = 1; i <= 4; i++) {
    await mkPort(umc404hd, { name: `Playback Out ${i} (unused)`, portType: PortType.TRS_14, direction: PortDirection.OUT });
  }
  for (let i = 1; i <= 4; i++) {
    await mkPort(umc404hd, { name: `Analog Insert ${i} (unused)`, portType: PortType.TRS_14, direction: PortDirection.BI });
  }
  const umcPhones = await mkPort(umc404hd, { name: 'Phones Out (stereo)', portType: PortType.TRS_14, direction: PortDirection.OUT });
  await mkPort(umc404hd, { name: 'MIDI In (unused)', portType: PortType.MIDI_DIN, direction: PortDirection.IN });
  await mkPort(umc404hd, { name: 'MIDI Out (unused)', portType: PortType.MIDI_DIN, direction: PortDirection.OUT });
  const umcUsbB = await mkPort(umc404hd, { name: 'USB-B', portType: PortType.USB_B, direction: PortDirection.BI });

  await mkCable({ sourcePortId: fs07OutL.id, targetPortId: umcIn1.id, cableType: CableType.AUDIO_BALANCED, length: 1 });
  await mkCable({ sourcePortId: fs07OutR.id, targetPortId: umcIn2.id, cableType: CableType.AUDIO_BALANCED, length: 1 });
  await mkCable({ sourcePortId: anker1UsbA1.id, targetPortId: umcUsbB.id, cableType: CableType.USB_DATA, length: 1.5, adapterId: adapterUsbAtoB.id });

  const mx400 = await mkDevice({
    name: 'Behringer MX400 (Micromix)',
    type: DeviceType.MIXER,
    ownerRole: 'andrii',
    position: { x: -500, y: 250 },
    powerRequired: true,
    powerSourceType: PowerSourceType.DC_BARREL,
    power: { currentType: CurrentType.DC, voltageV: 12, currentMA: 150, polarity: Polarity.CENTER_POSITIVE },
    imageUrl: 'behringer-mx400-top.png',
    attrs: {
      manufacturer: 'Behringer',
      model: 'MX400 Micromix 4-Channel Mono Line Mixer',
      controls: ['4 independent Input Level controls (1-4)'],
    },
    notes:
      "{\"en\": \"Dedicated power supply.\", \"ru\": \"\\u041e\\u0442\\u0434\\u0435\\u043b\\u044c\\u043d\\u044b\\u0439 \\u0441\\u043e\\u0431\\u0441\\u0442\\u0432\\u0435\\u043d\\u043d\\u044b\\u0439 \\u0411\\u041f.\"}",
  });
  const mx400In1 = await mkPort(mx400, { name: 'Ch1 In (playback audio interface)', portType: PortType.TS_14, direction: PortDirection.IN });
  const mx400In2 = await mkPort(mx400, { name: 'Ch2 In (UMC404HD Phones, stereo→mono)', portType: PortType.TS_14, direction: PortDirection.IN });
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
    name: "{\"en\": \"Palmer Monicon Classic Monitor Controller\", \"ru\": \"\\u041c\\u043e\\u043d\\u0438\\u0442\\u043e\\u0440\\u043d\\u044b\\u0439 \\u043a\\u043e\\u043d\\u0442\\u0440\\u043e\\u043b\\u043b\\u0435\\u0440 Palmer Monicon Classic\"}",
    type: DeviceType.MONITOR_CONTROLLER,
    ownerRole: 'andrii',
    position: { x: -500, y: 400 },
    powerSourceType: PowerSourceType.PASSIVE_NONE,
    imageUrl: 'palmer-front.png',
    imageUrls: ['palmer-front.png', 'palmer-back.png'],
    attrs: {
      manufacturer: 'Palmer',
      model: 'Monicon Classic Passive Stereo Monitor Controller',
      controls: ['Volume', 'MUTE', 'MONO summing button'],
    },
    notes: "{\"en\": \"Fully passive \\u2014 no power required.\", \"ru\": \"\\u041f\\u043e\\u043b\\u043d\\u043e\\u0441\\u0442\\u044c\\u044e \\u043f\\u0430\\u0441\\u0441\\u0438\\u0432\\u043d\\u044b\\u0439 \\u2014 \\u043f\\u0438\\u0442\\u0430\\u043d\\u0438\\u0435 \\u043d\\u0435 \\u0442\\u0440\\u0435\\u0431\\u0443\\u0435\\u0442\\u0441\\u044f.\"}",
  });
  const palmerInCombo = await mkPort(palmer, { name: 'Combo In (from MX400)', portType: PortType.COMBO_XLR_TRS, direction: PortDirection.IN });
  await mkPort(palmer, { name: 'Mini-Jack In 3.5mm (unused)', portType: PortType.TRS_18, direction: PortDirection.IN });
  await mkPort(palmer, { name: 'Out L (XLR)', portType: PortType.XLR_M, direction: PortDirection.OUT });
  await mkPort(palmer, { name: 'Out R (XLR)', portType: PortType.XLR_M, direction: PortDirection.OUT });
  const palmerOutMini = await mkPort(palmer, { name: 'Out (3.5mm, headphones)', portType: PortType.TRS_18, direction: PortDirection.OUT });

  await mkCable({ sourcePortId: mx400Out.id, targetPortId: palmerInCombo.id, cableType: CableType.AUDIO_UNBALANCED, length: 0.5 });

  const andreyHeadphones = await mkDevice({
    name: 'Audio-Technica ATH-PRO5XWH',
    type: DeviceType.MONITOR,
    ownerRole: 'andrii',
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
    name: "{\"en\": \"1/4\\\" TRS \\u2192 1/8\\\" Screw-on Adapter\", \"ru\": \"\\u041f\\u0435\\u0440\\u0435\\u0445\\u043e\\u0434\\u043d\\u0438\\u043a 1/4\\\" TRS \\u2192 1/8\\\" (\\u043d\\u0430\\u0432\\u0438\\u043d\\u0447\\u0438\\u0432\\u0430\\u044e\\u0449\\u0438\\u0439\\u0441\\u044f)\"}",
    type: DeviceType.ACCESSORY,
    ownerRole: 'andrii',
    parentDeviceId: andreyHeadphones.id,
    position: { x: -500, y: 600 },
    notes: "{\"en\": \"Screw-on 1/4\\\" TRS \\u2192 1/8\\\" adapter for Andrey headphones.\", \"ru\": \"\\u0420\\u0435\\u0437\\u044c\\u0431\\u043e\\u0432\\u043e\\u0439 \\u043f\\u0435\\u0440\\u0435\\u0445\\u043e\\u0434\\u043d\\u0438\\u043a TRS 1/4\\\" \\u2192 1/8\\\" \\u0434\\u043b\\u044f \\u043d\\u0430\\u0443\\u0448\\u043d\\u0438\\u043a\\u043e\\u0432 \\u0410\\u043d\\u0434\\u0440\\u0435\\u044f.\"}",
  });

  const govee = await mkDevice({
    name: 'Govee RGBIC Smart Table Lamp 2',
    type: DeviceType.LIGHT,
    ownerRole: 'andrii',
    position: { x: -300, y: 0 },
    powerRequired: true,
    powerSourceType: PowerSourceType.DC_BARREL,
    power: { currentType: CurrentType.DC, voltageV: 12, currentMA: 2000 },
    imageUrl: 'andrii-lamp.png',
    attrs: { lumens: 500, musicSyncModes: 8, control: ['WiFi', 'BLE', 'Matter'] },
    notes: "{\"en\": \"Placed directly on stage.\", \"ru\": \"\\u0421\\u0442\\u0430\\u0432\\u0438\\u0442\\u0441\\u044f \\u043f\\u0440\\u044f\\u043c\\u043e \\u043d\\u0430 \\u0441\\u0446\\u0435\\u043d\\u0443.\"}",
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
  // Dan (Vocalist) — center stage. Mic -> Volt 276 -> (IEM direct | FEX800 -> stagebox).
  // Plus guitar through 3 pedals into combo amp when playing.
  // ---------------------------------------------------------------------------------------
  const danyaVMic = await mkDevice({
    name: "{\"en\": \"Shure SM58 Vocal Microphone\", \"ru\": \"\\u0412\\u043e\\u043a\\u0430\\u043b\\u044c\\u043d\\u044b\\u0439 \\u043c\\u0438\\u043a\\u0440\\u043e\\u0444\\u043e\\u043d Shure SM58\"}",
    type: DeviceType.MICROPHONE,
    ownerRole: 'danVox',
    position: { x: 300, y: -150 },
    imageUrl: 'dan-vocalist-mic.webp',
    notes: "{\"en\": \"Band-owned microphone.\", \"ru\": \"\\u041d\\u0430\\u0448 \\u043c\\u0438\\u043a\\u0440\\u043e\\u0444\\u043e\\u043d (\\u043d\\u0435 \\u043f\\u043b\\u043e\\u0449\\u0430\\u0434\\u043a\\u0438).\"}",
  });
  const danyaVMicOut = await mkPort(danyaVMic, { name: 'Out', portType: PortType.XLR_M, direction: PortDirection.OUT });
  await mkFurniture({ deviceId: danyaVMic.id, kind: FurnitureKind.MIC_STAND, isVenueProvided: true });

  const volt276 = await mkDevice({
    name: "{\"en\": \"Universal Audio Volt 276 Audio Interface\", \"ru\": \"\\u0410\\u0443\\u0434\\u0438\\u043e\\u0438\\u043d\\u0442\\u0435\\u0440\\u0444\\u0435\\u0439\\u0441 Universal Audio Volt 276\"}",
    type: DeviceType.AUDIO_INTERFACE,
    ownerRole: 'danVox',
    position: { x: 300, y: 0 },
    powerRequired: true,
    powerSourceType: PowerSourceType.USB_C_PD,
    hostUsbType: HostUsbType.USB_C,
    power: { currentType: CurrentType.DC, voltageV: 5, currentMA: 1000 },
    imageUrl: 'volt276-front.webp',
    imageUrls: ['volt276-front.webp', 'volt276-back.webp', 'volt276-top.png'],
    attrs: {
      manufacturer: 'Universal Audio',
      model: 'Volt 276 (2x2 USB-C, built-in 1176 compressor)',
      controls: ['Vintage Preamp Switch', '76 Compressor presets (VOCAL, GTR, FAST, OFF)', 'Direct Monitor'],
    },
  });
  const volt276In1 = await mkPort(volt276, { name: 'Mic In (Combo)', portType: PortType.COMBO_XLR_TRS, direction: PortDirection.IN });
  await mkPort(volt276, { name: 'In 2 (Combo, unused)', portType: PortType.COMBO_XLR_TRS, direction: PortDirection.IN });
  const volt276Out1 = await mkPort(volt276, { name: 'Output 1 (Monitor/Phones)', portType: PortType.TRS_14, direction: PortDirection.OUT });
  const volt276Out2 = await mkPort(volt276, { name: 'Output 2 (Line)', portType: PortType.TRS_14, direction: PortDirection.OUT });
  await mkPort(volt276, { name: 'MIDI In (unused)', portType: PortType.MIDI_DIN, direction: PortDirection.IN });
  await mkPort(volt276, { name: 'MIDI Out (unused)', portType: PortType.MIDI_DIN, direction: PortDirection.OUT });
  const volt276UsbC = await mkPort(volt276, { name: 'USB-C Power', portType: PortType.USB_C, direction: PortDirection.BI });

  await mkCable({ sourcePortId: danyaVMicOut.id, targetPortId: volt276In1.id, cableType: CableType.AUDIO_BALANCED, length: 5, color: 'red' });
  await mkCable({ sourcePortId: anker1UsbC.id, targetPortId: volt276UsbC.id, cableType: CableType.USB_DATA, length: 6 });

  const danyaVIem = await mkDevice({
    name: "{\"en\": \"KZ ZS10 Pro IEM Earphones\", \"ru\": \"\\u041d\\u0430\\u0443\\u0448\\u043d\\u0438\\u043a\\u0438-\\u043c\\u043e\\u043d\\u0438\\u0442\\u043e\\u0440\\u044b KZ ZS10 Pro\"}",
    type: DeviceType.MONITOR,
    ownerRole: 'danVox',
    position: { x: 300, y: -300 },
    imageUrl: 'dan-vocalist-iem.png',
    attrs: { manufacturer: 'KZ', model: 'ZS10 Pro IEM Earphones (No Mic)', color: 'Purple' },
    notes:
      "{\"en\": \"Connected directly to Volt 276 (without mixer).\", \"ru\": \"\\u041f\\u043e\\u0434\\u043a\\u043b\\u044e\\u0447\\u0435\\u043d\\u044b \\u041d\\u0410\\u041f\\u0420\\u042f\\u041c\\u0423\\u042e \\u0432 Volt 276 (\\u0431\\u0435\\u0437 \\u043c\\u0438\\u043a\\u0448\\u0435\\u0440\\u0430).\"}",
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
    ownerRole: 'danVox',
    position: { x: 300, y: 200 },
    powerRequired: true,
    powerSourceType: PowerSourceType.AC_MAINS,
    power: { currentType: CurrentType.AC, voltageV: 9, currentMA: 750 },
    imageUrl: 'fex800-front.webp',
    imageUrls: ['fex800-front.webp', 'fex800-back.webp'],
    attrs: {
      manufacturer: 'Behringer',
      model: 'FEX800 MINIFEX 16-Bit FX Processor',
      controls: ['Built-in Tap Tempo'],
      algorithms: ['Reverb', 'Delay', 'Modulation', 'Pitch Shifter'],
    },
    notes: "{\"en\": \"Only original AC adapter.\", \"ru\": \"\\u0422\\u043e\\u043b\\u044c\\u043a\\u043e \\u0440\\u043e\\u0434\\u043d\\u043e\\u0439 AC-\\u0430\\u0434\\u0430\\u043f\\u0442\\u0435\\u0440.\"}",
  });
  const fex800InL = await mkPort(fex800, { name: 'In L', portType: PortType.TS_14, direction: PortDirection.IN });
  await mkPort(fex800, { name: 'In R (unused)', portType: PortType.TS_14, direction: PortDirection.IN });
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
    ownerRole: 'danVox',
    position: { x: 550, y: 350 },
    imageUrl: 'dan-vocalist-guitar.webp',
    attrs: {
      kind: 'guitar',
      manufacturer: 'Jackson Guitars',
      model: 'JS Series Dinky Arch Top JS22-7 DKA HT, Amaranth Fingerboard',
      color: 'Satin Black',
    },
    notes: "{\"en\": \"Used on select songs.\", \"ru\": \"\\u0418\\u0441\\u043f\\u043e\\u043b\\u044c\\u0437\\u0443\\u0435\\u0442\\u0441\\u044f \\u043d\\u0435 \\u043d\\u0430 \\u0432\\u0441\\u0435\\u0445 \\u043f\\u0435\\u0441\\u043d\\u044f\\u0445.\"}",
  });
  const danyaVGuitarOut = await mkPort(danyaVGuitar, { name: 'Jack Out', portType: PortType.TS_14, direction: PortDirection.OUT });
  await mkFurniture({ deviceId: danyaVGuitar.id, kind: FurnitureKind.GUITAR_STAND, isVenueProvided: false });

  const tu3 = await mkDevice({
    name: "{\"en\": \"Boss TU-3 Chromatic Tuner\", \"ru\": \"\\u0422\\u044e\\u043d\\u0435\\u0440 Boss TU-3\"}",
    type: DeviceType.PEDAL,
    ownerRole: 'danVox',
    position: { x: 610, y: 480 },
    powerRequired: true,
    powerSourceType: PowerSourceType.DC_BARREL,
    power: { currentType: CurrentType.DC, voltageV: 9, currentMA: 30, polarity: Polarity.CENTER_NEGATIVE },
    imageUrl: 'dan-vocalist-tuner-pedal.png',
    attrs: {
      manufacturer: 'Boss',
      model: 'TU-3 Chromatic Tuner',
      controls: ['21-segment LED meter', 'Stream/Cent tuning mode', 'Flat tuning support (up to 6 semitones down)'],
      footswitch: 'True Bypass',
    },
    notes:
      "{\"en\": \"Single channel PSU powering tuner.\", \"ru\": \"\\u041e\\u0434\\u043d\\u043e\\u043a\\u0430\\u043d\\u0430\\u043b\\u044c\\u043d\\u044b\\u0439 \\u0411\\u041f \\u2014 \\u043f\\u0438\\u0442\\u0430\\u0435\\u0442 \\u0442\\u043e\\u043b\\u044c\\u043a\\u043e \\u0442\\u044e\\u043d\\u0435\\u0440.\"}",
  });
  const tu3In = await mkPort(tu3, { name: 'Input (guitar)', portType: PortType.TS_14, direction: PortDirection.IN });
  const tu3Out = await mkPort(tu3, { name: 'Output (mute tuning)', portType: PortType.TS_14, direction: PortDirection.OUT });
  const tu3Power = await mkPort(tu3, {
    name: 'Power In',
    portType: PortType.DC_BARREL,
    direction: PortDirection.IN,
    power: { currentType: CurrentType.DC, voltageV: 9, currentMA: 30, polarity: Polarity.CENTER_NEGATIVE },
  });
  const tu3DaisyOut = await mkPort(tu3, {
    name: '9V DC OUT (Daisy Chain Jumper to FC03)',
    portType: PortType.DC_BARREL,
    direction: PortDirection.OUT,
    power: { currentType: CurrentType.DC, voltageV: 9, polarity: Polarity.CENTER_NEGATIVE, maxOutputCurrentMA: 200 },
  });

  const danyaVPsu1 = await mkDevice({
    name: 'Pedal PSU #1 (9V — Boss TU-3)',
    type: DeviceType.POWER_SUPPLY,
    ownerRole: 'danVox',
    position: { x: 590, y: 550 },
    powerRequired: true,
    powerSourceType: PowerSourceType.AC_MAINS,
    power: { currentType: CurrentType.DC, voltageV: 9, maxOutputCurrentMA: 200 },
    notes: "{\"en\": \"Single channel PSU powering tuner.\", \"ru\": \"\\u041e\\u0434\\u043d\\u043e\\u043a\\u0430\\u043d\\u0430\\u043b\\u044c\\u043d\\u044b\\u0439 \\u0411\\u041f \\u2014 \\u043f\\u0438\\u0442\\u0430\\u0435\\u0442 \\u0442\\u043e\\u043b\\u044c\\u043a\\u043e \\u0442\\u044e\\u043d\\u0435\\u0440.\"}",
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
    name: 'Pedal PSU #2 (9V — Cinders)',
    type: DeviceType.POWER_SUPPLY,
    ownerRole: 'danVox',
    position: { x: 660, y: 550 },
    powerRequired: true,
    powerSourceType: PowerSourceType.AC_MAINS,
    power: { currentType: CurrentType.DC, voltageV: 9, maxOutputCurrentMA: 200 },
    notes: "{\"en\": \"Single channel PSU powering TC Electronic Cinders.\", \"ru\": \"\\u041e\\u0434\\u043d\\u043e\\u043a\\u0430\\u043d\\u0430\\u043b\\u044c\\u043d\\u044b\\u0439 \\u0411\\u041f \\u2014 \\u043f\\u0438\\u0442\\u0430\\u0435\\u0442 \\u0442\\u043e\\u043b\\u044c\\u043a\\u043e TC Electronic Cinders.\"}",
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
    name: "{\"en\": \"TC Electronic Cinders Overdrive\", \"ru\": \"\\u041e\\u0432\\u0435\\u0440\\u0434\\u0440\\u0430\\u0439\\u0432 TC Electronic Cinders\"}",
    type: DeviceType.PEDAL,
    ownerRole: 'danVox',
    position: { x: 670, y: 480 },
    powerRequired: true,
    powerSourceType: PowerSourceType.DC_BARREL,
    power: { currentType: CurrentType.DC, voltageV: 9, currentMA: 15, polarity: Polarity.CENTER_NEGATIVE },
    pedal: { isStereoIn: false, isStereoOut: false },
    imageUrl: 'dan-vocalist-cinders.png',
    attrs: {
      manufacturer: 'TC Electronic',
      model: 'Cinders Overdrive (MOSFET Tube-Like)',
      controls: ['DRIVE gain control', 'VOLUME output level', 'TONE treble control'],
      footswitch: 'True Bypass',
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
    ownerRole: 'danVox',
    position: { x: 730, y: 480 },
    powerRequired: true,
    powerSourceType: PowerSourceType.DC_BARREL,
    power: { currentType: CurrentType.DC, voltageV: 9, currentMA: 128, polarity: Polarity.CENTER_NEGATIVE },
    pedal: { isStereoIn: false, isStereoOut: false },
    imageUrl: 'dan-vocalist-delay.png',
    attrs: {
      manufacturer: 'Flamma',
      model: 'FC03 Micro Delay Pedal',
      controls: [
        '3-way Toggle: Analog / Real Echo / Tape Echo',
        'TIME control (5ms - 600ms delay time)',
        'LEVEL repeat volume',
        'F.BACK repeat count',
      ],
      footswitch: 'True Bypass',
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
    name: "{\"en\": \"Egnater Tweaker 40W Combo Amp\", \"ru\": \"\\u0413\\u0438\\u0442\\u0430\\u0440\\u043d\\u044b\\u0439 \\u043a\\u043e\\u043c\\u0431\\u0438\\u043a Egnater Tweaker 40W\"}",
    type: DeviceType.AMPLIFIER,
    ownerRole: 'danVox',
    position: { x: 750, y: 480 },
    powerRequired: true,
    powerSourceType: PowerSourceType.AC_MAINS,
    power: { currentType: CurrentType.AC },
    imageUrl: 'dan-vocalist-combo.png',
    attrs: {
      manufacturer: 'Egnater',
      model: 'Tweaker 40W All-Tube 2-Channel Combo Amp',
      controls: ['Tweaker switches: USA / AC / BRIT tone modes'],
    },
    notes: "{\"en\": \"Mic for guitar combo amp.\", \"ru\": \"\\u041f\\u043e\\u0434\\u0437\\u0432\\u0443\\u0447\\u043a\\u0430 \\u0441\\u043d\\u0438\\u043c\\u0430\\u0435\\u0442\\u0441\\u044f \\u0434\\u0438\\u043d\\u0430\\u043c\\u0438\\u0447\\u0435\\u0441\\u043a\\u0438\\u043c \\u043c\\u0438\\u043a\\u0440\\u043e\\u0444\\u043e\\u043d\\u043e\\u043c Sennheiser e835s.\"}",
  });
  const danyaVComboIn = await mkPort(danyaVCombo, { name: 'Input', portType: PortType.TS_14, direction: PortDirection.IN });
  await mkPort(danyaVCombo, { name: 'FX Loop Send (unused)', portType: PortType.TS_14, direction: PortDirection.OUT });
  await mkPort(danyaVCombo, { name: 'FX Loop Return (unused)', portType: PortType.TS_14, direction: PortDirection.IN });
  await mkPort(danyaVCombo, { name: 'Speaker Out (4/8/16 Ω, unused)', portType: PortType.TS_14, direction: PortDirection.OUT });
  const danyaVComboPower = await mkPort(danyaVCombo, { name: 'Power In', portType: PortType.POWER_SCHUKO, direction: PortDirection.IN, power: { currentType: CurrentType.AC } });
  await mkCable({ sourcePortId: venueOutlet3Port.id, targetPortId: danyaVComboPower.id, cableType: CableType.POWER_LINE, length: 2 });

  await mkCable({ sourcePortId: danyaVGuitarOut.id, targetPortId: pedalPorts[0].in.id, cableType: CableType.AUDIO_UNBALANCED, length: 0.3 });
  await mkCable({ sourcePortId: pedalPorts[0].out.id, targetPortId: pedalPorts[1].in.id, cableType: CableType.AUDIO_UNBALANCED, length: 0.2, isPatchCable: true });
  await mkCable({ sourcePortId: pedalPorts[1].out.id, targetPortId: pedalPorts[2].in.id, cableType: CableType.AUDIO_UNBALANCED, length: 0.2, isPatchCable: true });
  await mkCable({ sourcePortId: pedalPorts[2].out.id, targetPortId: danyaVComboIn.id, cableType: CableType.AUDIO_UNBALANCED, length: 0.5 });

  const e835s = await mkDevice({
    name: 'Sennheiser e835s (Combo mic)',
    type: DeviceType.MICROPHONE,
    ownerRole: 'danVox',
    position: { x: 1050, y: 480 },
    imageUrl: 'dan-vocalist-guitar-amp-mic.webp',
    notes: "{\"en\": \"Mic stand in front of combo speaker.\", \"ru\": \"\\u0421\\u0442\\u043e\\u0439\\u043a\\u0430 \\u0441 \\u043c\\u0438\\u043a\\u0440\\u043e\\u0444\\u043e\\u043d\\u043e\\u043c \\u0440\\u0430\\u0441\\u043f\\u043e\\u043b\\u043e\\u0436\\u0435\\u043d\\u0430 \\u043f\\u0435\\u0440\\u0435\\u0434 \\u0434\\u0438\\u0444\\u0444\\u0443\\u0437\\u043e\\u0440\\u043e\\u043c \\u043a\\u043e\\u043c\\u0431\\u0438\\u043a\\u0430.\"}",
  });
  const e835sOut = await mkPort(e835s, { name: 'Out', portType: PortType.XLR_M, direction: PortDirection.OUT });
  await mkFurniture({ deviceId: e835s.id, kind: FurnitureKind.MIC_STAND, isVenueProvided: true });

  // ---------------------------------------------------------------------------------------
  // ---------------------------------------------------------------------------------------
  // Dan (Vocalist) + Playback setup. Laptop (MacBook Pro M5) -> MOTU -> stagebox
  // ---------------------------------------------------------------------------------------
  const playbackLaptop = await mkDevice({
    name: "{\"en\": \"MacBook Pro 14\\\" (M5) \\u2014 Playback\", \"ru\": \"MacBook Pro 14\\\" (M5) \\u2014 \\u041f\\u043b\\u0435\\u0439\\u0431\\u0435\\u043a\\u0438\"}",
    type: DeviceType.LAPTOP,
    ownerRole: 'danVox',
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
    notes: "{\"en\": \"Main playback laptop.\", \"ru\": \"\\u041e\\u0441\\u043d\\u043e\\u0432\\u043d\\u043e\\u0439 \\u043d\\u043e\\u0443\\u0442\\u0431\\u0443\\u043a \\u0434\\u043b\\u044f \\u0432\\u043e\\u0441\\u043f\\u0440\\u043e\\u0438\\u0437\\u0432\\u0435\\u0434\\u0435\\u043d\\u0438\\u044f \\u043f\\u043b\\u0435\\u0439\\u0431\\u0435\\u043a\\u043e\\u0432 \\u0438 \\u0443\\u043f\\u0440\\u0430\\u0432\\u043b\\u0435\\u043d\\u0438\\u044f \\u0441\\u0446\\u0435\\u043d\\u043e\\u0439.\"}",
  });
  const playbackLaptopUsbC = await mkPort(playbackLaptop, { name: 'USB-C / TB4', portType: PortType.USB_C, direction: PortDirection.BI });
  const playbackLaptopPowerIn = await mkPort(playbackLaptop, { name: 'MagSafe / USB-C Power In', portType: PortType.POWER_SCHUKO, direction: PortDirection.IN });

  // Laptop Power Supply (MacBook Pro M5)
  const playbackLaptopPsu = await mkDevice({
    name: 'Apple 140W USB-C PSU',
    type: DeviceType.POWER_SUPPLY,
    ownerRole: 'danVox',
    position: { x: 1050, y: -150 },
    powerRequired: true,
    powerSourceType: PowerSourceType.AC_MAINS,
    imageUrl: 'apple-charger.webp',
    attrs: { manufacturer: 'Apple' },
    notes: "{\"en\": \"140W power supply for Dan playback laptop.\", \"ru\": \"\\u0420\\u043e\\u0434\\u043d\\u043e\\u0439 \\u0431\\u043b\\u043e\\u043a \\u043f\\u0438\\u0442\\u0430\\u043d\\u0438\\u044f 140W \\u0434\\u043b\\u044f \\u043d\\u043e\\u0443\\u0442\\u0431\\u0443\\u043a\\u0430 \\u043f\\u043b\\u0435\\u0439\\u0431\\u0435\\u043a\\u043e\\u0432 \\u0414\\u0430\\u043d\\u0438-\\u0432\\u043e\\u043a\\u0430\\u043b\\u0430.\"}",
  });
  const playbackLaptopPsuPlug = await mkPort(playbackLaptopPsu, { name: 'Plug (to Anker)', portType: PortType.POWER_SCHUKO, direction: PortDirection.IN });
  const playbackLaptopPsuOut = await mkPort(playbackLaptopPsu, { name: 'USB-C Out (140W)', portType: PortType.USB_C, direction: PortDirection.OUT, power: { maxOutputPowerW: 140 } });

  await mkCable({ sourcePortId: anker2SchukoOuts[3].id, targetPortId: playbackLaptopPsuPlug.id, cableType: CableType.POWER_LINE, length: 1.5, color: 'black' });
  await mkCable({ sourcePortId: playbackLaptopPsuOut.id, targetPortId: playbackLaptopPowerIn.id, cableType: CableType.POWER_LINE, length: 2, color: 'white' });

  const motu = await mkDevice({
    name: "{\"en\": \"MOTU UltraLite-mk3 Hybrid Audio Interface\", \"ru\": \"\\u0410\\u0443\\u0434\\u0438\\u043e\\u0438\\u043d\\u0442\\u0435\\u0440\\u0444\\u0435\\u0439\\u0441 MOTU UltraLite-mk3 Hybrid\"}",
    type: DeviceType.AUDIO_INTERFACE,
    ownerRole: 'danVox',
    position: { x: 1200, y: 0 },
    powerRequired: true,
    powerSourceType: PowerSourceType.DC_BARREL,
    power: { currentType: CurrentType.DC, voltageV: 12, currentMA: 1000, polarity: Polarity.ANY },
    imageUrl: 'motu-front-back.png',
    attrs: {
      manufacturer: 'MOTU',
      model: 'UltraLite-mk3 Hybrid Audio Interface',
    },
    notes: "{\"en\": \"Power supply polarity ANY.\", \"ru\": \"\\u041f\\u043e\\u043b\\u044f\\u0440\\u043d\\u043e\\u0441\\u0442\\u044c \\u0431\\u043b\\u043e\\u043a\\u0430 \\u043f\\u0438\\u0442\\u0430\\u043d\\u0438\\u044f \\u0443\\u0441\\u0442\\u0440\\u043e\\u0439\\u0441\\u0442\\u0432\\u0443 \\u0431\\u0435\\u0437\\u0440\\u0430\\u0437\\u043b\\u0438\\u0447\\u043d\\u0430 (ANY).\"}",
  });
  const motuUsbB = await mkPort(motu, { name: 'USB-B', portType: PortType.USB_B, direction: PortDirection.BI });
  await mkPort(motu, { name: 'Combo Mic/Guitar In 1 (unused)', portType: PortType.COMBO_XLR_TRS, direction: PortDirection.IN });
  await mkPort(motu, { name: 'Combo Mic/Guitar In 2 (unused)', portType: PortType.COMBO_XLR_TRS, direction: PortDirection.IN });
  for (let i = 1; i <= 6; i++) {
    await mkPort(motu, { name: `Line In ${i} (unused)`, portType: PortType.TRS_14, direction: PortDirection.IN });
  }
  const motuOutBassL = await mkPort(motu, { name: 'Out — Bass L', portType: PortType.TRS_14, direction: PortDirection.OUT });
  const motuOutBassR = await mkPort(motu, { name: 'Out — Bass R', portType: PortType.TRS_14, direction: PortDirection.OUT });
  const motuOutPercL = await mkPort(motu, { name: 'Out — Percussion L', portType: PortType.TRS_14, direction: PortDirection.OUT });
  const motuOutPercR = await mkPort(motu, { name: 'Out — Percussion R', portType: PortType.TRS_14, direction: PortDirection.OUT });
  const motuOutSynthL = await mkPort(motu, { name: 'Out — Synths/BVs L', portType: PortType.TRS_14, direction: PortDirection.OUT });
  const motuOutSynthR = await mkPort(motu, { name: 'Out — Synths/BVs R', portType: PortType.TRS_14, direction: PortDirection.OUT });
  const motuOutAux = await mkPort(motu, { name: 'Aux Out (drummer click)', portType: PortType.TRS_18, direction: PortDirection.OUT });
  const motuOutMonitorFeed = await mkPort(motu, { name: 'Line Out (monitor feed)', portType: PortType.TS_14, direction: PortDirection.OUT });
  await mkPort(motu, { name: 'S/PDIF In (unused)', portType: PortType.TRS_14, direction: PortDirection.IN });
  await mkPort(motu, { name: 'S/PDIF Out (unused)', portType: PortType.TRS_14, direction: PortDirection.OUT });
  await mkPort(motu, { name: 'Optical In (unused)', portType: PortType.TRS_14, direction: PortDirection.IN });
  await mkPort(motu, { name: 'Optical Out (unused)', portType: PortType.TRS_14, direction: PortDirection.OUT });
  await mkPort(motu, { name: 'MIDI In (unused)', portType: PortType.MIDI_DIN, direction: PortDirection.IN });
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
  // Devices & Cabling for Setup Mode "With Keys" (Keys + MIDI Sync)
  // ---------------------------------------------------------------------------------------
  const synthLaptop = await mkDevice({
    name: "{\"en\": \"MacBook Pro 13\\\" (M1, 2020) \\u2014 Synths/Keys\", \"ru\": \"MacBook Pro 13\\\" (M1, 2020) \\u2014 \\u0421\\u0438\\u043d\\u0442\\u044b/\\u041a\\u043b\\u0430\\u0432\\u0438\\u0448\\u0438\"}",
    type: DeviceType.LAPTOP,
    ownerRole: 'andrii',
    position: { x: -800, y: -250 },
    powerRequired: true,
    powerSourceType: PowerSourceType.USB_C_PD,
    hostUsbType: HostUsbType.USB_C,
    imageUrl: 'andrii-macbook.png',
    attrs: {
      manufacturer: 'Apple',
      model: 'MacBook Pro 13" (M1, 2020, 2x Thunderbolt/USB 4)',
      ramGB: 8,
      storageGB: 512,
      isKeysOnly: true,
    },
    notes: "{\"en\": \"Andrey laptop for soft-synths and virtual keys.\", \"ru\": \"\\u041d\\u043e\\u0443\\u0442\\u0431\\u0443\\u043a \\u0410\\u043d\\u0434\\u0440\\u0435\\u044f \\u0434\\u043b\\u044f \\u0441\\u043e\\u0444\\u0442-\\u0441\\u0438\\u043d\\u0442\\u0435\\u0437\\u0430\\u0442\\u043e\\u0440\\u043e\\u0432 \\u0438 \\u0432\\u0438\\u0440\\u0442\\u0443\\u0430\\u043b\\u044c\\u043d\\u044b\\u0445 \\u043a\\u043b\\u0430\\u0432\\u0438\\u0448\\u043d\\u044b\\u0445 \\u0438\\u043d\\u0441\\u0442\\u0440\\u0443\\u043c\\u0435\\u043d\\u0442\\u043e\\u0432.\"}",
  });
  const synthLaptopPowerIn = await mkPort(synthLaptop, { name: 'USB-C Power In', portType: PortType.POWER_SCHUKO, direction: PortDirection.IN });
  const synthLaptopUsbC = await mkPort(synthLaptop, { name: 'USB-C (MIDI/Audio)', portType: PortType.USB_C, direction: PortDirection.BI });
  await mkFurniture({ deviceId: synthLaptop.id, kind: FurnitureKind.CHAIR, isVenueProvided: true });

  const synthLaptopPsu = await mkDevice({
    name: "{\"en\": \"Anker 140W USB-C GaN Charger\", \"ru\": \"\\u0417\\u0430\\u0440\\u044f\\u0434\\u043d\\u043e\\u0435 \\u0443\\u0441\\u0442\\u0440\\u043e\\u0439\\u0441\\u0442\\u0432\\u043e Anker 140W GaN\"}",
    type: DeviceType.POWER_SUPPLY,
    ownerRole: 'andrii',
    position: { x: -600, y: -250 },
    powerRequired: true,
    powerSourceType: PowerSourceType.AC_MAINS,
    imageUrl: 'anker-charger.avif',
    attrs: { manufacturer: 'Anker', isKeysOnly: true },
    notes: "{\"en\": \"Compact Anker GaN charger.\", \"ru\": \"\\u0417\\u0430\\u0440\\u044f\\u0434\\u043a\\u0430 \\u0441\\u0438\\u043d\\u0442\\u0435\\u0437\\u0430\\u0442\\u043e\\u0440\\u043d\\u043e\\u0433\\u043e \\u043d\\u043e\\u0443\\u0442\\u0431\\u0443\\u043a\\u0430 \\u0410\\u043d\\u0434\\u0440\\u0435\\u044f \\u2014 \\u043a\\u043e\\u043c\\u043f\\u0430\\u043a\\u0442\\u043d\\u044b\\u0439 Anker GaN charger.\"}",
  });
  const synthLaptopPsuPlug = await mkPort(synthLaptopPsu, { name: 'Plug (to Anker)', portType: PortType.POWER_SCHUKO, direction: PortDirection.IN });
  const synthLaptopPsuOut = await mkPort(synthLaptopPsu, { name: 'USB-C Out (140W)', portType: PortType.USB_C, direction: PortDirection.OUT, power: { maxOutputPowerW: 140 } });

  await mkCable({ sourcePortId: anker1SchukoOuts[3].id, targetPortId: synthLaptopPsuPlug.id, cableType: CableType.POWER_LINE, length: 1.5, color: 'black' });
  await mkCable({ sourcePortId: synthLaptopPsuOut.id, targetPortId: synthLaptopPowerIn.id, cableType: CableType.POWER_LINE, length: 2, color: 'white' });

  const cmeSyncBox = await mkDevice({
    name: "{\"en\": \"CME U6MIDI Pro / Sync Box\", \"ru\": \"MIDI-\\u0441\\u0438\\u043d\\u0445\\u0440\\u043e\\u043d\\u0438\\u0437\\u0430\\u0442\\u043e\\u0440 CME U6MIDI Pro\"}",
    type: DeviceType.MIDI_DEVICE,
    ownerRole: 'danVox',
    position: { x: 950, y: 150 },
    powerRequired: true,
    powerSourceType: PowerSourceType.USB_BUS,
    imageUrl: 'midi-thru5.png',
    attrs: {
      manufacturer: 'CME',
      model: 'U6MIDI Pro MIDI Splitter & Sync Box',
      isKeysOnly: true,
    },
    notes: "{\"en\": \"MIDI synchronizer: receives MIDI clock from MOTU and sends to UMC404HD and keys.\", \"ru\": \"\\u041c\\u0438\\u0434\\u0438-\\u0441\\u0438\\u043d\\u0445\\u0440\\u043e\\u043d\\u0438\\u0437\\u0430\\u0442\\u043e\\u0440: \\u043f\\u0440\\u0438\\u043d\\u0438\\u043c\\u0430\\u0435\\u0442 MIDI-\\u043a\\u043b\\u043e\\u043a \\u0438\\u0437 MOTU \\u0438 \\u0440\\u0430\\u0437\\u0434\\u0430\\u0451\\u0442 \\u043d\\u0430 UMC404HD \\u0438 \\u043a\\u043b\\u0430\\u0432\\u0438\\u0448\\u0438.\"}",
  });
  const cmePowerIn = await mkPort(cmeSyncBox, { name: 'USB-C Power In (5V DC)', portType: PortType.USB_C, direction: PortDirection.IN, power: { voltageV: 5, currentType: CurrentType.DC } });
  const cmeMidiIn = await mkPort(cmeSyncBox, { name: 'MIDI IN', portType: PortType.MIDI_DIN, direction: PortDirection.IN });
  const cmeMidiOut1 = await mkPort(cmeSyncBox, { name: 'MIDI OUT 1', portType: PortType.MIDI_DIN, direction: PortDirection.OUT });
  await mkPort(cmeSyncBox, { name: 'MIDI OUT 2 (unused)', portType: PortType.MIDI_DIN, direction: PortDirection.OUT });

  // CME Power cable
  await mkCable({ sourcePortId: anker2UsbA1.id, targetPortId: cmePowerIn.id, cableType: CableType.POWER_LINE, length: 1.5 });

  // MIDI Sync Cables (MOTU MIDI Out -> CME Sync Box MIDI In, CME Sync Box MIDI Out 1 -> UMC404HD MIDI In)
  await mkCable({ sourcePortId: motuMidiOut.id, targetPortId: cmeMidiIn.id, cableType: CableType.MIDI, length: 3, color: 'orange' });
  const umcMidiIn = await mkPort(umc404hd, { name: 'MIDI In (Sync)', portType: PortType.MIDI_DIN, direction: PortDirection.IN });
  await mkCable({ sourcePortId: cmeMidiOut1.id, targetPortId: umcMidiIn.id, cableType: CableType.MIDI, length: 5, color: 'orange' });

  const danyaDIem = await mkDevice({
    name: 'IEM System (standalone)',
    type: DeviceType.MONITOR,
    ownerRole: 'danDrummer',
    position: { x: 1400, y: 0 },
    notes: "{\"en\": \"Standalone IEM system with full monitor mix + click.\", \"ru\": \"\\u0412\\u043a\\u043b\\u044e\\u0447\\u0430\\u0435\\u0442 \\u043f\\u043e\\u043b\\u043d\\u044b\\u0439 \\u043c\\u043e\\u043d\\u0438\\u0442\\u043e\\u0440\\u043d\\u044b\\u0439 \\u043c\\u0438\\u043a\\u0441 + \\u043a\\u043b\\u0438\\u043a.\"}",
  });
  const danyaDIemIn = await mkPort(danyaDIem, { name: 'Aux In', portType: PortType.TRS_18, direction: PortDirection.IN });
  await mkCable({ sourcePortId: motuOutAux.id, targetPortId: danyaDIemIn.id, cableType: CableType.AUDIO_UNBALANCED, length: 8 });

  await mkDevice({
    name: "{\"en\": \"Dan Drummer Cymbals Set\", \"ru\": \"\\u041a\\u043e\\u043c\\u043f\\u043b\\u0435\\u043a\\u0442 \\u0442\\u0430\\u0440\\u0435\\u043b\\u043e\\u043a (\\u0431\\u0430\\u0440\\u0430\\u0431\\u0430\\u043d\\u044b)\"}",
    type: DeviceType.ACCESSORY,
    ownerRole: 'danDrummer',
    position: { x: 1400, y: 150 },
  });

  // ---------------------------------------------------------------------------------------
  // Stage box (venue-provided) — 11 input channels matching rider.md CH1–11.
  // ---------------------------------------------------------------------------------------
  const stageBox = await mkDevice({
    name: "{\"en\": \"Venue Stage Box (16x4)\", \"ru\": \"\\u0421\\u0442\\u0435\\u0439\\u0434\\u0436\\u0431\\u043e\\u043a\\u0441 \\u043f\\u043b\\u043e\\u0449\\u0430\\u0434\\u043a\\u0438 (16x4)\"}",
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
  const ch07 = await ch('CH07 — Vocal Processing L (TRS 1/4")', PortType.TRS_14);
  const ch08 = await ch('CH08 — Vocal Processing R (TRS 1/4")', PortType.TRS_14);
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
  // Venue provided equipment
  await mkCable({ sourcePortId: fex800OutL.id, targetPortId: ch07.id, cableType: CableType.AUDIO_UNBALANCED, length: 5, isUserOwned: false });
  await mkCable({ sourcePortId: fex800OutR.id, targetPortId: ch08.id, cableType: CableType.AUDIO_UNBALANCED, length: 5, isUserOwned: false });
  await mkCable({ sourcePortId: umcOutL.id, targetPortId: ch09.id, cableType: CableType.AUDIO_BALANCED, length: 6, color: 'blue' });
  await mkCable({ sourcePortId: umcOutR.id, targetPortId: ch10.id, cableType: CableType.AUDIO_BALANCED, length: 6, color: 'green' });
  await mkCable({ sourcePortId: e835sOut.id, targetPortId: ch11.id, cableType: CableType.AUDIO_BALANCED, length: 5 });

  await mkFurniture({ deviceId: playbackLaptop.id, kind: FurnitureKind.TABLE, isVenueProvided: true });

  // ---------------------------------------------------------------------------------------
  // Keys (Setup Mode "With Keys") — physical controller
  // synth laptop above. This replaces an earlier draft (separate "big set" keyboard + second
  // laptop + a different MIDI Thru5 WC splitter, none of it ever cabled) that predated the
  // actual design landing on: same MacBook-based synth rig, CME U6MIDI Pro for clock sync,
  // and this keyboard feeding it directly over USB-C.
  // ---------------------------------------------------------------------------------------
  const keyboard = await mkDevice({
    name: 'Arturia KeyLab Essential 61 mk3',
    type: DeviceType.KEYBOARD,
    ownerRole: 'andrii',
    position: { x: -800, y: -100 },
    imageUrl: 'andrii-keys.png',
    attrs: { manufacturer: 'Arturia', model: 'KeyLab Essential 61 mk3', isKeysOnly: true },
    notes: "{\"en\": \"MIDI keyboard controller connected via USB-C to synth laptop.\", \"ru\": \"MIDI-\\u043a\\u043e\\u043d\\u0442\\u0440\\u043e\\u043b\\u043b\\u0435\\u0440 \\u043a\\u043b\\u0430\\u0432\\u0438\\u0448, \\u043f\\u043e\\u0434\\u043a\\u043b\\u044e\\u0447\\u0430\\u0435\\u0442\\u0441\\u044f \\u043f\\u043e USB-C \\u043a \\u0441\\u0438\\u043d\\u0442\\u0435\\u0437\\u0430\\u0442\\u043e\\u0440\\u043d\\u043e\\u043c\\u0443 \\u043d\\u043e\\u0443\\u0442\\u0431\\u0443\\u043a\\u0443 \\u0410\\u043d\\u0434\\u0440\\u0435\\u044f.\"}",
  });
  const keyboardUsbC = await mkPort(keyboard, { name: 'USB-C', portType: PortType.USB_C, direction: PortDirection.BI });
  await mkFurniture({ deviceId: keyboard.id, kind: FurnitureKind.KEYBOARD_STAND, isVenueProvided: false });

  await mkCable({ sourcePortId: keyboardUsbC.id, targetPortId: synthLaptopUsbC.id, cableType: CableType.USB_DATA, length: 1.5 });

  await mkDevice({
    name: 'M-Audio SP-2',
    type: DeviceType.ACCESSORY,
    ownerRole: 'andrii',
    parentDeviceId: keyboard.id,
    position: { x: -800, y: -50 },
    attrs: { manufacturer: 'M-Audio', model: 'SP-2 Sustain Pedal', isKeysOnly: true },
  });

  // Lay everything out instead of leaving the arbitrary hand-picked x/y above as the persisted
  // state — auto layout algorithm
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
