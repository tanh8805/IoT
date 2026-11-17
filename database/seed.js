// Seed: 3 người dùng mẫu và 2 thiết bị chau-01, chau-02. Chạy lại nhiều lần được (idempotent).
// Mật khẩu mẫu ở danh sách bên dưới. Đây là mật khẩu thử nghiệm, đổi khi triển khai thật.
const path = require('path');
const resolveFrom = [process.cwd(), path.join(__dirname, '..', 'backend')];
const { PrismaClient } = require(require.resolve('@prisma/client', { paths: resolveFrom }));
const bcrypt = require(require.resolve('bcryptjs', { paths: resolveFrom }));

const prisma = new PrismaClient();

const USERS = [
  { username: 'admin', password: 'Admin@123', fullName: 'Quản trị viên', role: 'ADMIN' },
  { username: 'operator', password: 'Operator@123', fullName: 'Người vận hành', role: 'OPERATOR' },
  { username: 'viewer', password: 'Viewer@123', fullName: 'Người xem', role: 'VIEWER' },
];

const DEVICES = [
  { id: 'chau-01', name: 'Chậu cây thật (ESP32)', location: 'Ban công' },
  { id: 'chau-02', name: 'Chậu cây giả lập', location: 'Phòng thử nghiệm' },
];

async function main() {
  for (const u of USERS) {
    const exists = await prisma.user.findUnique({ where: { username: u.username } });
    if (exists) continue;
    await prisma.user.create({
      data: {
        username: u.username,
        passwordHash: await bcrypt.hash(u.password, 10),
        fullName: u.fullName,
        role: u.role,
      },
    });
    console.log('seed: tạo user', u.username);
  }

  for (const d of DEVICES) {
    const exists = await prisma.device.findUnique({ where: { id: d.id } });
    if (exists) continue;
    await prisma.device.create({
      data: {
        ...d,
        // Tài khoản MQTT của hai thiết bị mẫu được backend tạo trên broker khi khởi động.
        state: 'PROVISIONED',
        stateHistory: {
          create: [
            { to: 'REGISTERED', reason: 'Seed', actor: 'seed' },
            { from: 'REGISTERED', to: 'PROVISIONED', reason: 'Seed: tài khoản MQTT tạo khi backend khởi động', actor: 'seed' },
          ],
        },
      },
    });
    console.log('seed: tạo thiết bị', d.id);
  }

  // operator và viewer được gán cả hai thiết bị
  const users = await prisma.user.findMany({ where: { role: { in: ['OPERATOR', 'VIEWER'] } } });
  for (const user of users) {
    for (const d of DEVICES) {
      await prisma.deviceAssignment.upsert({
        where: { userId_deviceId: { userId: user.id, deviceId: d.id } },
        update: {},
        create: { userId: user.id, deviceId: d.id },
      });
    }
  }
  console.log('seed: xong');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
